using System.IO.Compression;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed partial class PtvComicInfoArchiveReaderTests
{
    public static IEnumerable<object[]> Zip64Variants()
    {
        foreach (ushort method in new ushort[] { 0, 8, 9 })
        foreach (var end in new[] { false, true })
        foreach (var descriptor in new[] { 0, 1, 2 })
            yield return [method, end, descriptor];
    }

    [Theory]
    [MemberData(nameof(Zip64Variants))]
    public void Zip64TinyArchiveMatchesNativeReader(ushort method, bool end, int descriptor)
    {
        var path = ZipLayout(method, descriptor != 0, true, zip64End: end,
            signedDescriptor: descriptor != 2, zip64Offset: true, zeroLocalSizes: descriptor != 0);
        AssertNativeBytes(path);
        var result = Read(path);
        Assert.Equal("inspected", result.State);
        Assert.Equal(Xml, result.Bytes);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Zip64WithoutComicInfoIsAbsent(bool end)
    {
        var path = ZipLayout(0, false, true, zip64End: end, entryName: "pages/001.txt");
        AssertNativeBytes(path);
        var result = Read(path);
        Assert.Equal("absent", result.State);
        Assert.Equal("COMICINFO_ABSENT", result.Reason);
        Assert.Empty(result.Bytes);
    }

    [Theory]
    [InlineData(0, "absent")]
    [InlineData(4096, "absent")]
    [InlineData(4097, "unverified")]
    public void Zip64DirectoryEntryBoundary(int count, string state)
    {
        var path = PromoteDirectoryToZip64(Zip(Enumerable.Range(0, count)
            .Select(index => ($"pages/{index}.jpg", Array.Empty<byte>(), 0)).ToArray()));
        var result = Read(path);
        Assert.Equal(state, result.State);
        if (count > 4096) Assert.Equal("COMICINFO_ARCHIVE_ENTRY_LIMIT", result.Reason);
    }

    [Theory]
    [InlineData("locator-missing")]
    [InlineData("locator-offset-overflow")]
    [InlineData("record-truncated")]
    [InlineData("record-size-underflow")]
    [InlineData("directory-overflow")]
    [InlineData("directory-size-overflow")]
    [InlineData("count-inconsistent")]
    [InlineData("classic-inconsistent")]
    public void Zip64DirectoryMalformedIsUnverified(string mutation)
    {
        var path = ZipLayout(0, false, true, zip64End: true);
        var bytes = File.ReadAllBytes(path);
        var end64 = FindSignature(bytes, 0x06064b50);
        var locator = FindSignature(bytes, 0x07064b50);
        var end = FindSignature(bytes, 0x06054b50);
        switch (mutation)
        {
            case "locator-missing": bytes[locator] = 0; break;
            case "locator-offset-overflow": Put64(bytes, locator + 8, ulong.MaxValue); break;
            case "record-truncated": Put64(bytes, locator + 8, (ulong)(locator - 20)); break;
            case "record-size-underflow": Put64(bytes, end64 + 4, 43); break;
            case "directory-overflow": Put64(bytes, end64 + 48, ulong.MaxValue); break;
            case "directory-size-overflow": Put64(bytes, end64 + 40, ulong.MaxValue); break;
            case "count-inconsistent": Put64(bytes, end64 + 24, 2); break;
            case "classic-inconsistent": BitConverter.GetBytes((ushort)2).CopyTo(bytes, end + 10); break;
        }
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_ZIP64_INVALID");
    }

    [Theory]
    [InlineData("locator-disk")]
    [InlineData("locator-total-disks")]
    [InlineData("record-disk")]
    public void Zip64MultiDiskIsUnverified(string mutation)
    {
        var path = ZipLayout(0, false, true, zip64End: true);
        var bytes = File.ReadAllBytes(path);
        var offset = mutation == "record-disk"
            ? FindSignature(bytes, 0x06064b50) + 16
            : FindSignature(bytes, 0x07064b50) + (mutation == "locator-disk" ? 4 : 16);
        BitConverter.GetBytes(mutation == "locator-total-disks" ? 2u : 1u).CopyTo(bytes, offset);
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_ZIP_UNSUPPORTED");
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("truncated")]
    [InlineData("duplicate")]
    public void Zip64RequiredExtraMustBeUnambiguous(string mutation)
    {
        var path = ZipLayout(0, false, true);
        var bytes = File.ReadAllBytes(path);
        var central = FindSignature(bytes, 0x02014b50);
        var extra = central + 46 + BitConverter.ToUInt16(bytes, central + 28);
        if (mutation == "missing") bytes[extra] = 2;
        else if (mutation == "truncated") BitConverter.GetBytes((ushort)7).CopyTo(bytes, extra + 2);
        else
        {
            BitConverter.GetBytes((ushort)8).CopyTo(bytes, extra + 2);
            BitConverter.GetBytes((ushort)1).CopyTo(bytes, extra + 12);
            BitConverter.GetBytes((ushort)4).CopyTo(bytes, extra + 14);
        }
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_ZIP64_INVALID");
    }

    [Fact]
    public void Zip64LocalSizeMustMatchImmutableCentralValue()
    {
        var path = ZipLayout(0, false, true);
        var bytes = File.ReadAllBytes(path);
        var extra = 30 + BitConverter.ToUInt16(bytes, 26);
        Put64(bytes, extra + 4, (ulong)Xml.Length + 1);
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_ZIP_HEADER_MISMATCH");
    }

    [Theory]
    [InlineData("uncompressed")]
    [InlineData("compressed")]
    [InlineData("compressed-overflow")]
    [InlineData("ratio")]
    public void Zip64CannotBypassDocumentCaps(string mutation)
    {
        var path = ZipLayout(0, false, true);
        var bytes = File.ReadAllBytes(path);
        var central = FindSignature(bytes, 0x02014b50);
        var extra = central + 46 + BitConverter.ToUInt16(bytes, central + 28);
        Put64(bytes, extra + (mutation.StartsWith("compressed", StringComparison.Ordinal) ? 12 : 4),
            mutation == "compressed-overflow" ? ulong.MaxValue
                : mutation == "compressed" ? 1048577UL : mutation == "ratio" ? 10000UL : 524289UL);
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_SIZE_LIMIT");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Zip64DescriptorUsesFull64BitSizes(bool signed)
    {
        var path = ZipLayout(0, true, true, signedDescriptor: signed);
        var bytes = File.ReadAllBytes(path);
        var descriptor = 30 + BitConverter.ToUInt16(bytes, 26) + BitConverter.ToUInt16(bytes, 28) + Xml.Length;
        var compressed = descriptor + (signed ? 8 : 4);
        Put64(bytes, compressed, 0x100000000UL + (ulong)Xml.Length);
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_ZIP_HEADER_MISMATCH");
    }

    [Fact]
    public void Zip64PayloadStillRequiresOriginalCrc()
    {
        var path = ZipLayout(0, false, true);
        var bytes = File.ReadAllBytes(path);
        var data = 30 + BitConverter.ToUInt16(bytes, 26) + BitConverter.ToUInt16(bytes, 28);
        bytes[data + 20] ^= 1;
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_UNAVAILABLE");
    }

    [Theory]
    [InlineData("size")]
    [InlineData("compressed")]
    [InlineData("offset")]
    [InlineData("disk")]
    public void Zip64CentralFieldsFollowConditionalOrder(string field)
    {
        var path = ZipLayout(0, false, true);
        var bytes = File.ReadAllBytes(path);
        var central = FindSignature(bytes, 0x02014b50);
        var extra = central + 46 + BitConverter.ToUInt16(bytes, central + 28);
        BitConverter.GetBytes((uint)Xml.Length).CopyTo(bytes, central + 20);
        BitConverter.GetBytes((uint)Xml.Length).CopyTo(bytes, central + 24);
        Array.Clear(bytes, extra + 4, 16);
        var payloadLength = field == "disk" ? 4 : 8;
        BitConverter.GetBytes((ushort)payloadLength).CopyTo(bytes, extra + 2);
        if (field == "disk") BitConverter.GetBytes(ushort.MaxValue).CopyTo(bytes, central + 34);
        else
        {
            var primary = field == "size" ? 24 : field == "compressed" ? 20 : 42;
            BitConverter.GetBytes(uint.MaxValue).CopyTo(bytes, central + primary);
            Put64(bytes, extra + 4, field == "offset" ? 0UL : (ulong)Xml.Length);
        }
        // Keep the total extra-field byte length fixed with an unrelated, valid TLV.
        BitConverter.GetBytes((ushort)0xbeef).CopyTo(bytes, extra + 4 + payloadLength);
        BitConverter.GetBytes((ushort)(12 - payloadLength)).CopyTo(bytes, extra + 6 + payloadLength);
        File.WriteAllBytes(path, bytes);
        // .NET rejects even disk 0 when it is supplied through this redundant
        // sentinel. The gate independently requires the expanded value to be 0.
        if (field != "disk") AssertNativeBytes(path);
        Assert.Equal(Xml, Read(path).Bytes);
    }

    [Fact]
    public void Zip64NonSentinelClassicFieldsMustAgree()
    {
        var path = ZipLayout(0, false, true, zip64End: true);
        var bytes = File.ReadAllBytes(path);
        var end64 = FindSignature(bytes, 0x06064b50);
        var end = FindSignature(bytes, 0x06054b50);
        BitConverter.GetBytes((ushort)1).CopyTo(bytes, end + 8);
        BitConverter.GetBytes((ushort)1).CopyTo(bytes, end + 10);
        BitConverter.GetBytes((uint)BitConverter.ToUInt64(bytes, end64 + 40)).CopyTo(bytes, end + 12);
        BitConverter.GetBytes((uint)BitConverter.ToUInt64(bytes, end64 + 48)).CopyTo(bytes, end + 16);
        File.WriteAllBytes(path, bytes);
        AssertNativeBytes(path);
        Assert.Equal(Xml, Read(path).Bytes);
    }

    [Theory]
    [InlineData(4097UL)]
    [InlineData(ulong.MaxValue)]
    public void Zip64DeclaredEntryCountCannotOverflowOrBypassLimit(ulong count)
    {
        var path = ZipLayout(0, false, true, zip64End: true);
        var bytes = File.ReadAllBytes(path);
        var end64 = FindSignature(bytes, 0x06064b50);
        Put64(bytes, end64 + 24, count);
        Put64(bytes, end64 + 32, count);
        File.WriteAllBytes(path, bytes);
        Rejected(path, "COMICINFO_ARCHIVE_ENTRY_LIMIT");
    }

    [Theory]
    [InlineData("offset-overflow")]
    [InlineData("compressed-overflow")]
    [InlineData("local-extra-truncated")]
    public void Zip64CannotEscapeSourceBounds(string mutation)
    {
        var path = ZipLayout(0, false, true, entryName: "pages/001.txt", zip64Offset: true);
        var bytes = File.ReadAllBytes(path);
        var central = FindSignature(bytes, 0x02014b50);
        var extra = central + 46 + BitConverter.ToUInt16(bytes, central + 28);
        if (mutation == "offset-overflow") Put64(bytes, extra + 20, ulong.MaxValue);
        else if (mutation == "compressed-overflow") Put64(bytes, extra + 12, ulong.MaxValue);
        else BitConverter.GetBytes((ushort)24).CopyTo(bytes, 32 + BitConverter.ToUInt16(bytes, 26));
        File.WriteAllBytes(path, bytes);
        Rejected(path, mutation == "local-extra-truncated" ? "COMICINFO_ZIP64_INVALID" : "COMICINFO_ZIP_HEADER_MISMATCH");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(8)]
    [InlineData(9)]
    public async Task WindowsFramedHelperReadsZip64UnderHardLimits(ushort method)
    {
        if (!OperatingSystem.IsWindows()) return;
        var path = ZipLayout(method, true, true, zip64End: true, zip64Offset: true, zeroLocalSizes: true);
        var runner = new Services.PtvWindowsJobRunner(Path.Combine(AppContext.BaseDirectory, "Ptv.ComicInfo.Helper.exe"));
        var result = await new Services.PtvArchiveInspectionHost(runner).ReadComicInfoAsync(path, CancellationToken.None);
        Assert.Equal("inspected", result.State);
        Assert.Equal(Xml, result.Bytes);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Zip64DescriptorCrcMayEqualOptionalSignature(bool signed)
    {
        byte[] payload = [0xac, 0x0a, 0x7a, 0xd5];
        Assert.Equal(0x08074b50u, FixtureCrc(payload));
        var path = ZipLayout(0, true, true, signedDescriptor: signed, payload: payload);
        AssertNativeBytes(path, payload);
        Assert.Equal(payload, Read(path).Bytes);
    }

    [Fact]
    public void Zip64ExactDocumentBoundaryRemainsReadable()
    {
        var payload = new byte[524288];
        var path = ZipLayout(0, false, true, zip64End: true, payload: payload);
        AssertNativeBytes(path, payload);
        Assert.Equal(payload, Read(path).Bytes);
    }

    [Fact]
    public void ClassicZipCommentIsNotMistakenForOptionalZip64Locator()
    {
        var path = Zip(("ComicInfo.xml", Xml, 0));
        var bytes = File.ReadAllBytes(path);
        var central = FindSignature(bytes, 0x02014b50);
        var endOffset = FindSignature(bytes, 0x06054b50);
        var end = bytes[endOffset..];
        BitConverter.GetBytes((ushort)20).CopyTo(bytes, central + 32);
        BitConverter.GetBytes(BitConverter.ToUInt32(end, 12) + 20u).CopyTo(end, 12);
        byte[] comment = new byte[20];
        BitConverter.GetBytes(0x07064b50u).CopyTo(comment, 0);
        File.WriteAllBytes(path, bytes[..endOffset].Concat(comment).Concat(end).ToArray());
        AssertNativeBytes(path);
        Assert.Equal(Xml, Read(path).Bytes);
    }

    [Theory]
    [InlineData(1073741824L, "inspected")]
    [InlineData(1073741825L, "unverified")]
    public void Zip64ArchiveSizeBoundary(long length, string state)
    {
        var path = ZipLayout(0, false, true, zip64End: true);
        var bytes = File.ReadAllBytes(path);
        var central = FindSignature(bytes, 0x02014b50);
        var trailer = bytes[central..];
        var newCentral = length - trailer.Length;
        var end64 = FindSignature(trailer, 0x06064b50);
        Put64(trailer, end64 + 48, (ulong)newCentral);
        Put64(trailer, FindSignature(trailer, 0x07064b50) + 8, (ulong)(newCentral + end64));
        using (var file = new FileStream(path, FileMode.Create, FileAccess.Write))
        {
            file.Write(bytes.AsSpan(0, central));
            file.Position = newCentral;
            file.Write(trailer);
        }
        var result = Read(path);
        Assert.Equal(state, result.State);
        if (state == "inspected") Assert.Equal(Xml, result.Bytes);
        else Assert.Equal("COMICINFO_ARCHIVE_SIZE_LIMIT", result.Reason);
    }

    private static void AssertNativeBytes(string path, byte[]? expected = null)
    {
        using var file = File.OpenRead(path);
        using var archive = new ZipArchive(file, ZipArchiveMode.Read);
        using var stream = archive.Entries.Single().Open();
        using var output = new MemoryStream();
        stream.CopyTo(output);
        Assert.Equal(expected ?? Xml, output.ToArray());
    }

    private static void Put64(byte[] bytes, int offset, ulong value) => BitConverter.GetBytes(value).CopyTo(bytes, offset);

    private static string PromoteDirectoryToZip64(string path)
    {
        var bytes = File.ReadAllBytes(path);
        var endOffset = FindSignature(bytes, 0x06054b50);
        var end = bytes[endOffset..];
        using var writer = new BinaryWriter(File.Create(path));
        writer.Write(bytes.AsSpan(0, endOffset));
        WriteZip64End(writer, BitConverter.ToUInt16(end, 10), BitConverter.ToUInt32(end, 12), BitConverter.ToUInt32(end, 16));
        BitConverter.GetBytes(ushort.MaxValue).CopyTo(end, 8);
        BitConverter.GetBytes(ushort.MaxValue).CopyTo(end, 10);
        BitConverter.GetBytes(uint.MaxValue).CopyTo(end, 12);
        BitConverter.GetBytes(uint.MaxValue).CopyTo(end, 16);
        writer.Write(end);
        return path;
    }
}
