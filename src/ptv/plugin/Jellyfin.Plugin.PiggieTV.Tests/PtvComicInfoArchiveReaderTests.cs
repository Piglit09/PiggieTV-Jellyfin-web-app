extern alias archivehelper;

using System.IO.Compression;
using System.Text;
using Xunit;
using ArchiveReader = archivehelper::Ptv.ComicInfo.Helper.ComicInfoArchiveReader;

namespace Jellyfin.Plugin.PiggieTV.Tests;

[Collection("Archive host")]
public sealed partial class PtvComicInfoArchiveReaderTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "ptv-comic-test-" + Guid.NewGuid().ToString("N"));

    private static readonly byte[] Xml = Encoding.UTF8.GetBytes("<ComicInfo><Series>Synthetic</Series><Number>9</Number></ComicInfo>");

    public PtvComicInfoArchiveReaderTests() => Directory.CreateDirectory(root);
    public void Dispose() => Directory.Delete(root, true);

    private static (string State, string Reason, byte[] Bytes) Read(string path)
    {
        var result = ArchiveReader.Read(path);
        return (result.State, result.ReasonCode, result.Bytes);
    }

    private string Zip(params (string Name, byte[] Bytes, int Attributes)[] entries)
    {
        var path = Path.Combine(root, Guid.NewGuid() + ".cbz");
        using var file = File.Create(path);
        using var zip = new ZipArchive(file, ZipArchiveMode.Create);
        foreach (var (name, bytes, attributes) in entries)
        {
            var entry = zip.CreateEntry(name, CompressionLevel.NoCompression);
            entry.ExternalAttributes = attributes;
            using var stream = entry.Open();
            stream.Write(bytes);
        }
        return path;
    }

    private static void Rejected(string path, string reason)
    {
        var result = Read(path);
        Assert.Equal("unverified", result.State);
        Assert.Equal(reason, result.Reason);
        Assert.Empty(result.Bytes);
    }

    [Fact]
    public void RootComicInfoOnly()
    {
        var result = Read(Zip(("ComicInfo.xml", Xml, 0)));
        Assert.Equal("inspected", result.State);
        Assert.Equal(Xml, result.Bytes);
    }

    [Fact]
    public void NestedPagesRemainValid()
    {
        var result = Read(Zip(("pages/001.jpg", [1, 2, 3], 0), ("cOmIcInFo.XmL", Xml, 0)));
        Assert.Equal("inspected", result.State);
        Assert.Equal(Xml, result.Bytes);
    }

    [Theory]
    [InlineData("nested/ComicInfo.xml")]
    [InlineData("../ComicInfo.xml")]
    [InlineData("..\\ComicInfo.xml")]
    [InlineData("/ComicInfo.xml")]
    [InlineData("ComicInfo.xml/")]
    public void NestedOrDuplicateComicInfoUnverified(string name) => Rejected(Zip((name, Xml, 0)), "COMICINFO_ENTRY_PATH_REJECTED");

    [Fact]
    public void CaseInsensitiveDuplicateUnverified() => Rejected(Zip(("ComicInfo.xml", Xml, 0), ("comicinfo.XML", Xml, 0)), "COMICINFO_ENTRY_AMBIGUOUS");

    [Theory]
    [InlineData(unchecked((int)0xA1FF0000))]
    [InlineData(0x400)]
    public void LinkComicInfoUnverified(int attributes) => Rejected(Zip(("ComicInfo.xml", Xml, attributes)), "COMICINFO_ENTRY_PATH_REJECTED");

    [Fact]
    public void NoRootComicInfoAbsent()
    {
        var result = Read(Zip(("pages/001.jpg", [1], 0)));
        Assert.Equal("absent", result.State);
        Assert.Equal("COMICINFO_ABSENT", result.Reason);
        Assert.Empty(result.Bytes);
    }

    [Fact]
    public void OverLimitDocumentUnverified() => Rejected(Zip(("ComicInfo.xml", new byte[524289], 0)), "COMICINFO_SIZE_LIMIT");

    [Fact]
    public void ExactDocumentBoundaryAccepted() => Assert.Equal(524288, Read(Zip(("ComicInfo.xml", new byte[524288], 0))).Bytes.Length);

    [Theory]
    [InlineData(4096, "absent")]
    [InlineData(4097, "unverified")]
    public void EntryBoundary(int count, string state)
    {
        var result = Read(Zip(Enumerable.Range(0, count).Select(i => ($"pages/{i}.jpg", Array.Empty<byte>(), 0)).ToArray()));
        Assert.Equal(state, result.State);
        if (count > 4096)
            Assert.Equal("COMICINFO_ARCHIVE_ENTRY_LIMIT", result.Reason);
    }

    [Theory]
    [InlineData(1073741824L, "COMICINFO_UNAVAILABLE")]
    [InlineData(1073741825L, "COMICINFO_ARCHIVE_SIZE_LIMIT")]
    public void ArchiveSizeBoundary(long length, string reason)
    {
        var path = Path.Combine(root, "large.cbz");
        using (var f = File.Create(path))
            f.SetLength(length);
        Rejected(path, reason);
    }

    [Fact]
    public void NoArchiveWritesOrSiblingOpens()
    {
        var path = Zip(("ComicInfo.xml", Xml, 0));
        var bytes = File.ReadAllBytes(path);
        var time = File.GetLastWriteTimeUtc(path);
        var sibling = Path.Combine(root, "ComicInfo.xml");
        File.WriteAllText(sibling, "not archive metadata");
        using var exclusiveSibling = new FileStream(sibling, FileMode.Open, FileAccess.Read, FileShare.None);
        Assert.Equal(Xml, Read(path).Bytes);
        Assert.Equal(bytes, File.ReadAllBytes(path));
        Assert.Equal(time, File.GetLastWriteTimeUtc(path));
        Assert.Equal(2, Directory.GetFiles(root).Length);
    }

    private string Rar(ushort flags = 0, string name = "ComicInfo.xml", ushort fileFlags = 0x8000, uint attributes = 0x20, byte[]? payload = null)
    {
        payload ??= Xml;
        var path = Path.Combine(root, Guid.NewGuid() + ".cbr");
        using var output = new BinaryWriter(File.Create(path));
        output.Write(new byte[] { 0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00 });
        void Header(byte type, ushort headerFlags, byte[] body)
        {
            using var buffer = new MemoryStream();
            using var writer = new BinaryWriter(buffer);
            writer.Write(type);
            writer.Write(headerFlags);
            writer.Write((ushort)(7 + body.Length));
            writer.Write(body);
            var bytes = buffer.ToArray();
            output.Write((ushort)FixtureCrc(bytes));
            output.Write(bytes);
        }
        Header(0x73, flags, new byte[6]);
        using (var buffer = new MemoryStream())
        {
            using var writer = new BinaryWriter(buffer);
            var nameBytes = Encoding.ASCII.GetBytes(name);
            writer.Write((uint)payload.Length);
            writer.Write((uint)payload.Length);
            writer.Write((byte)3);
            writer.Write(FixtureCrc(payload));
            writer.Write(0u);
            writer.Write((byte)20);
            writer.Write((byte)0x30);
            writer.Write((ushort)nameBytes.Length);
            writer.Write(attributes);
            writer.Write(nameBytes);
            Header(0x74, fileFlags, buffer.ToArray());
            output.Write(payload);
        }
        Header(0x7b, 0, []);
        return path;
    }

    [Fact]
    public void RarRootComicInfoOnly()
    {
        var r = Read(Rar());
        Assert.Equal("inspected", r.State);
        Assert.Equal(Xml, r.Bytes);
    }

    [Theory]
    [InlineData(8)]
    [InlineData(1)]
    public void SolidOrMultipartRarUnverified(ushort flags) => Rejected(Rar(flags), "COMICINFO_RAR_UNSUPPORTED");

    [Fact]
    public void EncryptedRarUnverified() => Rejected(Rar(fileFlags: 0x8004), "COMICINFO_RAR_UNSUPPORTED");

    [Fact]
    public void SplitRarUnverified() => Rejected(Rar(fileFlags: 0x8002), "COMICINFO_RAR_UNSUPPORTED");

    [Fact]
    public void RarLinkUnverified() => Rejected(Rar(attributes: 0xa1ff), "COMICINFO_ENTRY_PATH_REJECTED");

    [Fact]
    public void RarNestedUnverified() => Rejected(Rar(name: "pages/ComicInfo.xml"), "COMICINFO_ENTRY_PATH_REJECTED");

    [Fact]
    public void RarNoComicInfoAbsent() => Assert.Equal("absent", Read(Rar(name: "pages/001.jpg")).State);

    [Fact]
    public void RarNoSiblingOpensOrWrites()
    {
        var path = Rar();
        var sibling = Path.ChangeExtension(path, "r00");
        File.WriteAllText(sibling, "private");
        using var locked = new FileStream(sibling, FileMode.Open, FileAccess.Read, FileShare.None);
        var original = File.ReadAllBytes(path);
        Assert.Equal(Xml, Read(path).Bytes);
        Assert.Equal(original, File.ReadAllBytes(path));
        Assert.Equal(2, Directory.GetFiles(root).Length);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(8)]
    [InlineData(9)]
    public async Task WindowsFramedHelperReturnsArchiveBytes(ushort method)
    {
        if (!OperatingSystem.IsWindows())
            return;
        var runner = new Services.PtvWindowsJobRunner(Path.Combine(AppContext.BaseDirectory, "Ptv.ComicInfo.Helper.exe"));
        var result = await new Services.PtvArchiveInspectionHost(runner).ReadComicInfoAsync(ZipLayout(method, false, false), CancellationToken.None);
        Assert.Equal("inspected", result.State);
        Assert.Equal(Xml, result.Bytes);
    }

    [Fact]
    public void CompressionRatioRejected()
    {
        var path = Path.Combine(root, "ratio.cbz");
        using (var f = File.Create(path))
        using (var zip = new ZipArchive(f, ZipArchiveMode.Create))
        using (var stream = zip.CreateEntry("ComicInfo.xml", CompressionLevel.SmallestSize).Open())
            stream.Write(new byte[524288]);
        Rejected(path, "COMICINFO_SIZE_LIMIT");
    }

    [Fact]
    public void CompressedSizeLimitRejected()
    {
        var path = Zip(("ComicInfo.xml", Xml, 0));
        var bytes = File.ReadAllBytes(path);
        var central = FindSignature(bytes, 0x02014b50);
        BitConverter.GetBytes(1048577u).CopyTo(bytes, central + 20);
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_SIZE_LIMIT");
    }

    [Fact]
    public void MalformedArchiveUnverified()
    {
        var path = Path.Combine(root, "bad.cbr");
        File.WriteAllText(path, "not a rar");
        Rejected(path, "COMICINFO_UNAVAILABLE");
    }

    private string CombineRar(params string[] archives)
    {
        var path = Path.Combine(root, Guid.NewGuid() + ".cbr");
        using var stream = File.Create(path);
        var first = File.ReadAllBytes(archives[0]);
        stream.Write(first.AsSpan(0, 20));
        foreach (var item in archives)
        {
            var bytes = File.ReadAllBytes(item);
            stream.Write(bytes.AsSpan(20, bytes.Length - 27));
        }
        stream.Write(first.AsSpan(first.Length - 7));
        return path;
    }

    [Fact]
    public void RarNestedPagesRemainValid() => Assert.Equal(Xml, Read(CombineRar(Rar(name: "pages/001.jpg"), Rar())).Bytes);

    [Fact]
    public void RarDuplicateUnverified() => Rejected(CombineRar(Rar(), Rar(name: "comicinfo.XML")), "COMICINFO_ENTRY_AMBIGUOUS");

    [Theory]
    [InlineData(4096, "absent")]
    [InlineData(4097, "unverified")]
    public void RarEntryBoundary(int count, string state)
    {
        var page = Rar(name: "pages/001.jpg");
        var r = Read(CombineRar(Enumerable.Repeat(page, count).ToArray()));
        Assert.Equal(state, r.State);
        if (count > 4096)
            Assert.Equal("COMICINFO_ARCHIVE_ENTRY_LIMIT", r.Reason);
    }

    [Theory]
    [InlineData(0, "absent")]
    [InlineData(8, "unverified")]
    [InlineData(1, "unverified")]
    public void EmptyRarHeaderFlags(ushort flags, string state)
    {
        var path = Rar(flags);
        var bytes = File.ReadAllBytes(path);
        File.WriteAllBytes(path, bytes[..20].Concat(bytes[^7..]).ToArray());
        Assert.Equal(state, Read(path).State);
    }

    [Fact]
    public void RarDocumentLimit() => Rejected(Rar(payload: new byte[524289]), "COMICINFO_SIZE_LIMIT");

    [Fact]
    public void CorruptSelectedZipPayloadUnverified()
    {
        var path = Zip(("ComicInfo.xml", Xml, 0));
        var bytes = File.ReadAllBytes(path);
        var start = 30 + BitConverter.ToUInt16(bytes, 26) + BitConverter.ToUInt16(bytes, 28);
        bytes[start + 20] ^= 1;
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_UNAVAILABLE");
    }

    [Fact]
    public void CorruptSelectedRarPayloadUnverified()
    {
        var path = Rar();
        var bytes = File.ReadAllBytes(path);
        var start = 20 + BitConverter.ToUInt16(bytes, 25);
        bytes[start + 20] ^= 1;
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_UNAVAILABLE");
    }

    [Fact]
    public void Rar5StoredRootComicInfo()
    {
        var path = Path.Combine(root, "synthetic-rar5.cbr");
        using (var output = new BinaryWriter(File.Create(path)))
        {
            output.Write(new byte[] { 0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00 });
            static void WriteVarUInt(BinaryWriter writer, uint value)
            {
                while (value >= 128)
                {
                    writer.Write((byte)(value | 128));
                    value >>= 7;
                }
                writer.Write((byte)value);
            }
            void Header(byte[] body)
            {
                using var buffer = new MemoryStream();
                using var writer = new BinaryWriter(buffer);
                WriteVarUInt(writer, (uint)body.Length);
                writer.Write(body);
                var bytes = buffer.ToArray();
                output.Write(FixtureCrc(bytes));
                output.Write(bytes);
            }
            Header([1, 0, 0]);
            using (var buffer = new MemoryStream())
            {
                using var writer = new BinaryWriter(buffer);
                var name = Encoding.UTF8.GetBytes("ComicInfo.xml");
                WriteVarUInt(writer, 2);
                WriteVarUInt(writer, 2);
                WriteVarUInt(writer, (uint)Xml.Length);
                WriteVarUInt(writer, 4);
                WriteVarUInt(writer, (uint)Xml.Length);
                WriteVarUInt(writer, 0x81a4);
                writer.Write(FixtureCrc(Xml));
                WriteVarUInt(writer, 0);
                WriteVarUInt(writer, 1);
                WriteVarUInt(writer, (uint)name.Length);
                writer.Write(name);
                Header(buffer.ToArray());
                output.Write(Xml);
            }
            Header([5, 0, 0]);
        }
        var result = Read(path);
        Assert.Equal("inspected", result.State);
        Assert.Equal(Xml, result.Bytes);
    }

    [Theory]
    [InlineData("name")]
    [InlineData("compressed-size")]
    [InlineData("uncompressed-size")]
    [InlineData("flags")]
    [InlineData("encryption")]
    [InlineData("method")]
    public void ZipLocalCentralMismatchRejectedBeforeDecode(string field)
    {
        var path = Zip(("ComicInfo.xml", Xml, 0));
        var bytes = File.ReadAllBytes(path);
        switch (field)
        {
            case "name":
                bytes[30] = (byte)'X';
                break;
            case "compressed-size":
                BitConverter.GetBytes(1048577u).CopyTo(bytes, 18);
                break;
            case "uncompressed-size":
                BitConverter.GetBytes(524289u).CopyTo(bytes, 22);
                break;
            case "flags":
                bytes[7] ^= 8;
                break;
            case "encryption":
                bytes[6] ^= 1;
                break;
            case "method":
                bytes[8] = 8;
                break;
        }
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_ZIP_HEADER_MISMATCH");
    }

    [Fact]
    public void ZipOriginalCentralCrcCannotBeReplacedByLocalHeader()
    {
        var path = Zip(("ComicInfo.xml", Xml, 0));
        var bytes = File.ReadAllBytes(path);
        var payloadStart = 30 + BitConverter.ToUInt16(bytes, 26) + BitConverter.ToUInt16(bytes, 28);
        bytes[payloadStart + 20] ^= 1;
        uint crc = uint.MaxValue;
        foreach (var value in bytes.AsSpan(payloadStart, Xml.Length))
        {
            crc ^= value;
            for (var bit = 0; bit < 8; bit++)
                crc = (crc >> 1) ^ ((crc & 1) == 0 ? 0 : 0xedb88320u);
        }
        BitConverter.GetBytes(~crc).CopyTo(bytes, 14);
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_ZIP_HEADER_MISMATCH");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void DeflateZipAndDataDescriptorRemainReadable(bool descriptor)
    {
        var path = ZipLayout(8, descriptor, false);
        Assert.Equal(Xml, Read(path).Bytes);
    }

    [Theory]
    [InlineData(0, true, "inspected")]
    [InlineData(9, false, "inspected")]
    public void ExistingZipReaderCompatibilityIsExplicit(ushort method, bool zip64, string expectedState)
    {
        var path = ZipLayout(method, false, zip64);
        using (var file = File.OpenRead(path))
        using (var archive = new ZipArchive(file, ZipArchiveMode.Read))
        using (var stream = archive.Entries.Single().Open())
        using (var output = new MemoryStream())
        {
            stream.CopyTo(output);
            Assert.Equal(Xml, output.ToArray());
        }
        var result = Read(path);
        Assert.Equal(expectedState, result.State);
        if (expectedState == "inspected")
            Assert.Equal(Xml, result.Bytes);
        else
            Assert.Equal("COMICINFO_ZIP_UNSUPPORTED", result.Reason);
    }

    [Fact]
    public void DescriptorCrcMismatchRejectedBeforeDecode()
    {
        var path = ZipLayout(8, true, false);
        var bytes = File.ReadAllBytes(path);
        var descriptor = FindSignature(bytes, 0x08074b50);
        bytes[descriptor + 4] ^= 1;
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_ZIP_HEADER_MISMATCH");
    }

    private string ZipLayout(ushort method, bool descriptor, bool zip64,
        bool zip64End = false, string entryName = "ComicInfo.xml", bool signedDescriptor = true,
        bool zip64Offset = false, bool zeroLocalSizes = false, byte[]? payload = null)
    {
        var content = payload ?? Xml;
        var path = Path.Combine(root, Guid.NewGuid() + ".cbz");
        byte[] compressed;
        if (method == 8)
        {
            using var buffer = new MemoryStream();
            using (var compressor = new DeflateStream(buffer, CompressionLevel.Optimal, leaveOpen: true))
                compressor.Write(content);
            compressed = buffer.ToArray();
        }
        else if (method == 9)
        {
            // Deflate64's uncompressed final block uses this same five-byte prefix.
            compressed = new byte[content.Length + 5];
            compressed[0] = 1;
            BitConverter.GetBytes((ushort)content.Length).CopyTo(compressed, 1);
            BitConverter.GetBytes((ushort)~content.Length).CopyTo(compressed, 3);
            content.CopyTo(compressed, 5);
        }
        else
            compressed = content;
        var name = Encoding.ASCII.GetBytes(entryName);
        var crc = FixtureCrc(content);
        var flags = (ushort)(descriptor ? 8 : 0);
        using var writer = new BinaryWriter(File.Create(path));
        byte[] Extra(bool central)
        {
            if (!zip64)
                return [];
            using var buffer = new MemoryStream();
            using var extra = new BinaryWriter(buffer);
            extra.Write((ushort)1);
            extra.Write((ushort)(central && zip64Offset ? 24 : 16));
            extra.Write(!central && zeroLocalSizes ? 0UL : (ulong)content.Length);
            extra.Write(!central && zeroLocalSizes ? 0UL : (ulong)compressed.Length);
            if (central && zip64Offset) extra.Write(0UL);
            return buffer.ToArray();
        }
        var localExtra = Extra(false);
        var centralExtra = Extra(true);
        var compressedSize = zip64 ? uint.MaxValue : (uint)compressed.Length;
        var size = zip64 ? uint.MaxValue : (uint)content.Length;
        writer.Write(0x04034b50u);
        writer.Write((ushort)(zip64 ? 45 : 20));
        writer.Write(flags);
        writer.Write(method);
        writer.Write(0u);
        writer.Write(descriptor ? 0u : crc);
        writer.Write(descriptor && !zip64 ? 0u : compressedSize);
        writer.Write(descriptor && !zip64 ? 0u : size);
        writer.Write((ushort)name.Length);
        writer.Write((ushort)localExtra.Length);
        writer.Write(name);
        writer.Write(localExtra);
        writer.Write(compressed);
        if (descriptor)
        {
            if (signedDescriptor) writer.Write(0x08074b50u);
            writer.Write(crc);
            if (zip64)
            {
                writer.Write((ulong)compressed.Length);
                writer.Write((ulong)content.Length);
            }
            else
            {
                writer.Write((uint)compressed.Length);
                writer.Write((uint)content.Length);
            }
        }
        var centralOffset = (uint)writer.BaseStream.Position;
        writer.Write(0x02014b50u);
        writer.Write((ushort)20);
        writer.Write((ushort)(zip64 ? 45 : 20));
        writer.Write(flags);
        writer.Write(method);
        writer.Write(0u);
        writer.Write(crc);
        writer.Write(compressedSize);
        writer.Write(size);
        writer.Write((ushort)name.Length);
        writer.Write((ushort)centralExtra.Length);
        writer.Write((ushort)0);
        writer.Write((ushort)0);
        writer.Write((ushort)0);
        writer.Write(0u);
        writer.Write(zip64Offset ? uint.MaxValue : 0u);
        writer.Write(name);
        writer.Write(centralExtra);
        var centralSize = (uint)writer.BaseStream.Position - centralOffset;
        if (zip64End) WriteZip64End(writer, 1, centralSize, centralOffset);
        writer.Write(0x06054b50u);
        writer.Write((ushort)0);
        writer.Write((ushort)0);
        writer.Write(zip64End ? ushort.MaxValue : (ushort)1);
        writer.Write(zip64End ? ushort.MaxValue : (ushort)1);
        writer.Write(zip64End ? uint.MaxValue : centralSize);
        writer.Write(zip64End ? uint.MaxValue : centralOffset);
        writer.Write((ushort)0);
        return path;
    }

    private static void WriteZip64End(BinaryWriter writer, ulong count, ulong directorySize, ulong directoryOffset)
    {
        var endOffset = (ulong)writer.BaseStream.Position;
        writer.Write(0x06064b50u);
        writer.Write(44UL);
        writer.Write((ushort)45);
        writer.Write((ushort)45);
        writer.Write(0u);
        writer.Write(0u);
        writer.Write(count);
        writer.Write(count);
        writer.Write(directorySize);
        writer.Write(directoryOffset);
        writer.Write(0x07064b50u);
        writer.Write(0u);
        writer.Write(endOffset);
        writer.Write(1u);
    }

    private static int FindSignature(byte[] bytes, uint signature)
    {
        for (var index = 0; index <= bytes.Length - 4; index++)
            if (BitConverter.ToUInt32(bytes, index) == signature)
                return index;
        throw new InvalidDataException("Synthetic fixture signature missing.");
    }

    private static uint FixtureCrc(byte[] bytes)
    {
        uint crc = uint.MaxValue;
        foreach (var value in bytes)
        {
            crc ^= value;
            for (var bit = 0; bit < 8; bit++)
                crc = (crc >> 1) ^ ((crc & 1) == 0 ? 0 : 0xedb88320u);
        }
        return ~crc;
    }
}
