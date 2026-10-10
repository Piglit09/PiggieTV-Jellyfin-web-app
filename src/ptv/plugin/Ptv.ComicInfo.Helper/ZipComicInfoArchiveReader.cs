using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Ptv.ComicInfo.Helper;

/// <summary>Validates ZIP metadata before decoding a bounded, detached compressed snapshot.</summary>
internal static class ZipComicInfoArchiveReader
{
    private const string Invalid64 = "COMICINFO_ZIP64_INVALID";
    private const string Mismatch = "COMICINFO_ZIP_HEADER_MISMATCH";
    private const string Unsupported = "COMICINFO_ZIP_UNSUPPORTED";
    private sealed record Entry(byte[] Name, ushort Flags, ushort Method, uint Crc,
        ulong CompressedSize, ulong Size, uint Attributes, ulong LocalOffset, bool Zip64, long DataOffset = 0);
    private sealed record DirectoryLocation(int Count, long Offset, long End);
    private sealed class Rejection(string code) : Exception(code)
    {
        internal string Code { get; } = code;
    }

    private static void Require(bool condition, string code)
    {
        if (!condition) throw new Rejection(code);
    }

    private static ushort U16(ReadOnlySpan<byte> bytes, int offset) => BinaryPrimitives.ReadUInt16LittleEndian(bytes[offset..]);
    private static uint U32(ReadOnlySpan<byte> bytes, int offset) => BinaryPrimitives.ReadUInt32LittleEndian(bytes[offset..]);
    private static ulong U64(ReadOnlySpan<byte> bytes, int offset) => BinaryPrimitives.ReadUInt64LittleEndian(bytes[offset..]);
    private static bool Fits(ulong offset, ulong length, ulong boundary) => offset <= boundary && length <= boundary - offset;

    internal static PtvComicInfoBytesResult Read(Stream file)
    {
        try { return ReadCore(file); }
        catch (Rejection error) { return new("unverified", error.Code, []); }
    }

    private static PtvComicInfoBytesResult ReadCore(Stream file)
    {
        var directory = ReadDirectory(file);
        file.Position = directory.Offset;
        Entry? selected = null;
        for (var index = 0; index < directory.Count; index++)
        {
            Require(file.Position <= directory.End - 46, "COMICINFO_UNAVAILABLE");
            var central = ReadBytes(file, 46);
            Require(U32(central, 0) == 0x02014b50, "COMICINFO_UNAVAILABLE");
            var variableLength = U16(central, 28) + U16(central, 30) + U16(central, 32);
            Require(variableLength <= directory.End - file.Position, "COMICINFO_UNAVAILABLE");
            var name = ReadBytes(file, U16(central, 28));
            var extra = ReadBytes(file, U16(central, 30));
            var next = file.Position + U16(central, 32);
            var entry = ReadCentralEntry(central, name, extra);
            var key = Encoding.UTF8.GetString(name);
            var leaf = key.Replace('\\', '/').TrimEnd('/').Split('/').Last();
            var candidate = leaf.Equals("ComicInfo.xml", StringComparison.OrdinalIgnoreCase);
            if (candidate)
            {
                var type = (entry.Attributes >> 16) & 0xf000;
                Require(key.Equals("ComicInfo.xml", StringComparison.OrdinalIgnoreCase)
                    && type is 0 or 0x8000 && (entry.Attributes & 0x410) == 0, "COMICINFO_ENTRY_PATH_REJECTED");
                Require(selected is null, "COMICINFO_ENTRY_AMBIGUOUS");
                // Short-circuit the size caps before multiplication of untrusted 64-bit values.
                Require(entry.Size <= 524288 && entry.CompressedSize <= 1048576
                    && (entry.Size == 0 || (entry.CompressedSize > 0 && entry.Size <= entry.CompressedSize * 100)),
                    "COMICINFO_SIZE_LIMIT");
            }
            entry = ValidateLocal(file, entry, (ulong)directory.Offset);
            if (candidate) selected = entry;
            file.Position = next;
        }
        Require(file.Position == directory.End, "COMICINFO_UNAVAILABLE");
        if (selected is null) return new("absent", "COMICINFO_ABSENT", []);
        Require((selected.Flags & 0x41) == 0, "COMICINFO_ENCRYPTED");
        Require(selected.Method is 0 or 8 or 9 && (selected.Flags & ~0x080e) == 0, Unsupported);

        // This snapshot is the decoder's entire input. No decoder reopens the
        // archive or consumes mutable local headers / ZIP64 extra fields.
        file.Position = selected.DataOffset;
        var compressed = ReadBytes(file, (int)selected.CompressedSize);
        using var snapshot = new MemoryStream(compressed, writable: false);
        using Stream decoder = selected.Method switch
        {
            0 => snapshot,
            8 => new DeflateStream(snapshot, CompressionMode.Decompress),
            9 => new SharpCompress.Compressors.Deflate64.Deflate64Stream(snapshot, SharpCompress.Compressors.CompressionMode.Decompress),
            _ => throw new InvalidDataException()
        };
        var bytes = ReadBytes(decoder, (int)selected.Size);
        Require(decoder.ReadByte() == -1, "COMICINFO_SIZE_LIMIT");
        Require(ComicInfoArchiveReader.Crc32(bytes) == selected.Crc, "COMICINFO_UNAVAILABLE");
        return new("inspected", "COMICINFO_READ", bytes);
    }

    private static DirectoryLocation ReadDirectory(Stream file)
    {
        // EOCD plus its maximum 16-bit comment; no whole-archive scan/snapshot.
        var tailLength = (int)Math.Min(file.Length, 65557);
        file.Position = file.Length - tailLength;
        var tail = ReadBytes(file, tailLength);
        var end = -1;
        for (var index = tail.Length - 22; index >= 0; index--)
        {
            if (U32(tail, index) == 0x06054b50 && index + 22 + U16(tail, index + 20) == tail.Length)
            {
                end = index;
                break;
            }
        }
        Require(end >= 0, "COMICINFO_UNAVAILABLE");
        var endOffset = (ulong)(file.Length - tailLength + end);
        ulong count = U16(tail, end + 10);
        ulong size = U32(tail, end + 12);
        ulong offset = U32(tail, end + 16);
        var needs64 = count == ushort.MaxValue || U16(tail, end + 8) == ushort.MaxValue
            || size == uint.MaxValue || offset == uint.MaxValue
            || U16(tail, end + 4) == ushort.MaxValue || U16(tail, end + 6) == ushort.MaxValue;
        var locator = endOffset >= 20 ? ReadAt(file, endOffset - 20, 20) : [];
        // A classic central comment can contain the locator signature. If its
        // declared directory reaches EOCD, those bytes belong to that directory;
        // a real optional ZIP64 record/locator lies after the directory instead.
        var completeClassicDirectory = !needs64 && Fits(offset, size, endOffset) && offset + size == endOffset;
        var has64 = !completeClassicDirectory && locator.Length == 20 && U32(locator, 0) == 0x07064b50;
        Require(!needs64 || has64, Invalid64);
        var boundary = endOffset;
        if (has64)
        {
            Require(U32(locator, 4) == 0 && U32(locator, 16) == 1, Unsupported);
            var recordOffset = U64(locator, 8);
            Require(Fits(recordOffset, 56, endOffset - 20), Invalid64);
            var record = ReadAt(file, recordOffset, 56);
            Require(U32(record, 0) == 0x06064b50 && U64(record, 4) >= 44, Invalid64);
            // Extensible/encrypted ZIP64 EOCD layouts remain unsupported; never
            // guess at them or allocate their attacker-declared record length.
            Require(U64(record, 4) == 44, Unsupported);
            Require(recordOffset + 56 == endOffset - 20, Invalid64);
            Require(U32(record, 16) == 0 && U32(record, 20) == 0, Unsupported);
            count = U64(record, 32);
            Require(U64(record, 24) == count, Invalid64);
            size = U64(record, 40);
            offset = U64(record, 48);
            Require(AgreesWith64(U16(tail, end + 4), ushort.MaxValue, 0)
                && AgreesWith64(U16(tail, end + 6), ushort.MaxValue, 0)
                && AgreesWith64(U16(tail, end + 8), ushort.MaxValue, count)
                && AgreesWith64(U16(tail, end + 10), ushort.MaxValue, count)
                && AgreesWith64(U32(tail, end + 12), uint.MaxValue, size)
                && AgreesWith64(U32(tail, end + 16), uint.MaxValue, offset), Invalid64);
            boundary = recordOffset;
        }
        else
        {
            Require(U16(tail, end + 4) == 0 && U16(tail, end + 6) == 0, Unsupported);
            Require(U16(tail, end + 8) == count, "COMICINFO_UNAVAILABLE");
        }
        Require(count <= 4096, "COMICINFO_ARCHIVE_ENTRY_LIMIT");
        Require(Fits(offset, size, boundary) && offset + size == boundary, has64 ? Invalid64 : Unsupported);
        return new((int)count, (long)offset, (long)(offset + size));
    }

    private static bool AgreesWith64(ulong value, ulong sentinel, ulong expanded) => value == sentinel || value == expanded;

    private static Entry ReadCentralEntry(byte[] header, byte[] name, byte[] extra)
    {
        ulong size = U32(header, 24), compressed = U32(header, 20), offset = U32(header, 42);
        uint disk = U16(header, 34);
        var block = Zip64Extra(extra);
        var needed = (size == uint.MaxValue ? 8 : 0) + (compressed == uint.MaxValue ? 8 : 0)
            + (offset == uint.MaxValue ? 8 : 0) + (disk == ushort.MaxValue ? 4 : 0);
        Require(needed == 0 || block is not null, Invalid64);
        if (block is { } data)
        {
            // APPNOTE 4.5.3: central values are present only for sentinel fields,
            // in size / compressed-size / local-offset / disk order.
            Require(data.Length == needed, Invalid64);
            var cursor = 0;
            if (size == uint.MaxValue) { size = U64(data.Span, cursor); cursor += 8; }
            if (compressed == uint.MaxValue) { compressed = U64(data.Span, cursor); cursor += 8; }
            if (offset == uint.MaxValue) { offset = U64(data.Span, cursor); cursor += 8; }
            if (disk == ushort.MaxValue) disk = U32(data.Span, cursor);
        }
        Require(disk == 0, Unsupported);
        return new(name, U16(header, 8), U16(header, 10), U32(header, 16), compressed, size,
            U32(header, 38), offset, block is not null);
    }

    private static Entry ValidateLocal(Stream file, Entry entry, ulong directoryOffset)
    {
        Require(Fits(entry.LocalOffset, 30, directoryOffset), Mismatch);
        var local = ReadAt(file, entry.LocalOffset, 30);
        var variable = (ulong)U16(local, 26) + U16(local, 28);
        Require(Fits(entry.LocalOffset + 30, variable, directoryOffset), Mismatch);
        var name = ReadBytes(file, U16(local, 26));
        var extra = ReadBytes(file, U16(local, 28));
        var descriptor = (entry.Flags & 8) != 0;
        var block = Zip64Extra(extra);
        ulong size = U32(local, 22), compressed = U32(local, 18);
        Require((size != uint.MaxValue && compressed != uint.MaxValue) || block is not null, Invalid64);
        if (block is { } data)
        {
            // Unlike central conditional fields, local ZIP64 always carries both sizes.
            Require(data.Length == 16, Invalid64);
            var size64 = U64(data.Span, 0);
            var compressed64 = U64(data.Span, 8);
            Require((size == uint.MaxValue || Agrees(size, size64, descriptor))
                && (compressed == uint.MaxValue || Agrees(compressed, compressed64, descriptor)), Mismatch);
            size = size64;
            compressed = compressed64;
        }
        Require(U32(local, 0) == 0x04034b50 && U16(local, 6) == entry.Flags && U16(local, 8) == entry.Method
            && name.AsSpan().SequenceEqual(entry.Name) && Agrees(U32(local, 14), entry.Crc, descriptor)
            && Agrees(compressed, entry.CompressedSize, descriptor) && Agrees(size, entry.Size, descriptor), Mismatch);
        var dataOffset = (ulong)file.Position;
        Require(Fits(dataOffset, entry.CompressedSize, directoryOffset), Mismatch);
        if (descriptor)
            Require(DescriptorMatches(file, dataOffset + entry.CompressedSize, entry,
                entry.Zip64 || block is not null, directoryOffset), Mismatch);
        return entry with { DataOffset = (long)dataOffset };
    }

    private static bool Agrees(ulong local, ulong expected, bool descriptor) => local == expected || (descriptor && local == 0);

    private static bool DescriptorMatches(Stream file, ulong offset, Entry entry, bool wide, ulong boundary)
    {
        var bodyLength = wide ? 20 : 12;
        if (!Fits(offset, (ulong)bodyLength, boundary)) return false;
        var values = ReadAt(file, offset, (int)Math.Min((ulong)(bodyLength + 4), boundary - offset));
        bool Matches(int start) => values.Length >= start + bodyLength && U32(values, start) == entry.Crc
            && (wide ? U64(values, start + 4) : U32(values, start + 4)) == entry.CompressedSize
            && (wide ? U64(values, start + 12) : U32(values, start + 8)) == entry.Size;
        var unsigned = Matches(0);
        var signed = U32(values, 0) == 0x08074b50 && Matches(4);
        // CRC can equal the optional signature. Accept only one interpretation.
        return unsigned != signed;
    }

    private static ReadOnlyMemory<byte>? Zip64Extra(byte[] extra)
    {
        ReadOnlyMemory<byte>? result = null;
        for (var cursor = 0; cursor < extra.Length;)
        {
            Require(extra.Length - cursor >= 4, Invalid64);
            var tag = U16(extra, cursor);
            var length = U16(extra, cursor + 2);
            cursor += 4;
            Require(length <= extra.Length - cursor, Invalid64);
            if (tag == 1)
            {
                Require(result is null, Invalid64);
                result = extra.AsMemory(cursor, length);
            }
            cursor += length;
        }
        return result;
    }

    private static byte[] ReadAt(Stream file, ulong offset, int length)
    {
        file.Position = (long)offset; // Every caller proves the range against the <=1 GiB source first.
        return ReadBytes(file, length);
    }

    private static byte[] ReadBytes(Stream stream, int count)
    {
        var bytes = new byte[count];
        stream.ReadExactly(bytes);
        return bytes;
    }
}
