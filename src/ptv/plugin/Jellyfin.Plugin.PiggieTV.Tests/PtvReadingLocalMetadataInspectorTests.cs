using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvReadingLocalMetadataInspectorTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        "ptv-reading-local-metadata-tests",
        Guid.NewGuid().ToString("N"));

    public PtvReadingLocalMetadataInspectorTests()
    {
        Directory.CreateDirectory(_root);
    }

    [Fact]
    public async Task ComicInfoExtractionIsBoundedPlainTextAndDoesNotMutateArchive()
    {
        var path = CreateArchive("book.cbz", "ComicInfo.xml", """
            <?xml version="1.0" encoding="utf-8"?>
            <ComicInfo>
              <Title>Monstress</Title>
              <AlternateSeries>Monstress Deluxe</AlternateSeries>
              <Series>Monstress</Series>
              <Number>12.5</Number>
              <Volume>2</Volume>
              <Writer>Marjorie Liu; Guest Writer</Writer>
              <Penciller>Sana Takeda</Penciller>
              <Publisher>Image Comics</Publisher>
              <Genre>Fantasy, Comic</Genre>
              <Tags>award winner; mature</Tags>
              <Web>https://example.test/monstress</Web>
              <Year>2018</Year>
              <Month>3</Month>
              <Day>7</Day>
              <LanguageISO>en</LanguageISO>
              <Manga>YesAndRightToLeft</Manga>
              <Summary>&lt;p&gt;A &lt;strong&gt;dark&lt;/strong&gt; fantasy.&lt;/p&gt;&lt;script&gt;ignored()&lt;/script&gt;</Summary>
            </ComicInfo>
            """);
        var bytesBefore = await File.ReadAllBytesAsync(path);
        var timestampBefore = File.GetLastWriteTimeUtc(path);

        var result = await CreateInspector().InspectAsync(path, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvReadingLocalInspectionState.Inspected, result.State);
        Assert.Equal("book.cbz", result.FileName);
        Assert.Equal(Path.GetFileName(_root), result.FolderName);
        Assert.Equal(["ComicInfo.xml"], result.Sources);
        Assert.Equal("Monstress", result.Metadata.Title);
        Assert.Equal("Monstress", result.Metadata.SeriesTitle);
        Assert.Equal("12.5", result.Metadata.IssueNumber);
        Assert.Equal("2", result.Metadata.VolumeNumber);
        Assert.Equal(2018, result.Metadata.Year);
        Assert.Equal(3, result.Metadata.Month);
        Assert.Equal(7, result.Metadata.Day);
        Assert.Equal("Image Comics", result.Metadata.Publisher);
        Assert.Equal("en", result.Metadata.Language);
        Assert.Equal("YesAndRightToLeft", result.Metadata.Manga);
        Assert.Equal("https://example.test/monstress", result.Metadata.SourceUrl);
        Assert.Contains(result.Metadata.Credits, credit => credit.Name == "Marjorie Liu" && credit.Role == "Writer");
        Assert.Contains(result.Metadata.Credits, credit => credit.Name == "Sana Takeda" && credit.Role == "Penciller");
        Assert.DoesNotContain('<', result.Metadata.Description!);
        Assert.DoesNotContain('>', result.Metadata.Description!);
        Assert.Contains("A dark fantasy.", result.Metadata.Description!, StringComparison.Ordinal);
        Assert.DoesNotContain("<script", JsonSerializer.Serialize(result), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(_root, JsonSerializer.Serialize(result), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(Convert.ToHexString(SHA256.HashData(bytesBefore)), Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(path))));
        Assert.Equal(timestampBefore, File.GetLastWriteTimeUtc(path));
    }

    [Fact]
    public async Task AdjacentOpfProvidesBookIdentityWithoutReturningServerPath()
    {
        var sourcePath = Path.Combine(_root, "The Dispossessed.epub");
        await File.WriteAllBytesAsync(sourcePath, [1, 2, 3, 4]);
        var opfPath = Path.Combine(_root, "The Dispossessed.opf");
        await File.WriteAllTextAsync(opfPath, """
            <?xml version="1.0" encoding="utf-8"?>
            <package xmlns="http://www.idpf.org/2007/opf"
                     xmlns:dc="http://purl.org/dc/elements/1.1/"
                     unique-identifier="book-id">
              <metadata>
                <dc:title>The Dispossessed</dc:title>
                <dc:creator xmlns:opf="http://www.idpf.org/2007/opf" opf:role="aut">Ursula K. Le Guin</dc:creator>
                <dc:identifier xmlns:opf="http://www.idpf.org/2007/opf" opf:scheme="ISBN">9780061054884</dc:identifier>
                <dc:date>1974-05-01</dc:date>
                <dc:publisher>Harper</dc:publisher>
                <dc:language>en</dc:language>
                <dc:subject>Science Fiction</dc:subject>
                <dc:description>&lt;em&gt;An ambiguous utopia.&lt;/em&gt;</dc:description>
                <meta name="calibre:series" content="Hainish Cycle" />
                <meta name="calibre:series_index" content="6" />
              </metadata>
            </package>
            """);
        var sourceBytes = await File.ReadAllBytesAsync(sourcePath);
        var opfBytes = await File.ReadAllBytesAsync(opfPath);

        var result = await CreateInspector().InspectAsync(sourcePath, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvReadingLocalInspectionState.Inspected, result.State);
        Assert.Equal(["OPF"], result.Sources);
        Assert.Equal("The Dispossessed", result.Metadata.Title);
        Assert.Equal("Hainish Cycle", result.Metadata.SeriesTitle);
        Assert.Equal("6", result.Metadata.VolumeNumber);
        Assert.Equal(1974, result.Metadata.Year);
        Assert.Equal("9780061054884", result.Metadata.Isbn13);
        Assert.Equal("9780061054884", result.Metadata.ExternalIds["ISBN13"]);
        Assert.Contains(result.Metadata.Credits, credit => credit.Name == "Ursula K. Le Guin" && credit.Role == "Author");
        Assert.Equal("An ambiguous utopia.", result.Metadata.Description);
        var json = JsonSerializer.Serialize(result);
        Assert.DoesNotContain(sourcePath, json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(opfPath, json, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(sourceBytes, await File.ReadAllBytesAsync(sourcePath));
        Assert.Equal(opfBytes, await File.ReadAllBytesAsync(opfPath));
    }

    [Fact]
    public async Task TraversalComicInfoEntryIsRejectedAndNeverExtracted()
    {
        var path = CreateArchive("traversal.cbz", "../ComicInfo.xml", "<ComicInfo><Title>Traversal</Title></ComicInfo>");

        var result = await CreateInspector().InspectAsync(path, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvReadingLocalInspectionState.Rejected, result.State);
        Assert.Contains("COMICINFO_ENTRY_PATH_REJECTED", result.Warnings);
        Assert.Null(result.Metadata.Title);
    }

    [Fact]
    public async Task HighlyCompressedComicInfoIsRejectedBeforeDecompression()
    {
        var repeated = new string('A', 300_000);
        var path = CreateArchive(
            "compression-bomb.cbz",
            "ComicInfo.xml",
            $"<ComicInfo><Summary>{repeated}</Summary></ComicInfo>",
            CompressionLevel.SmallestSize);

        var result = await CreateInspector().InspectAsync(path, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvReadingLocalInspectionState.Rejected, result.State);
        Assert.Contains("COMICINFO_SIZE_LIMIT", result.Warnings);
        Assert.Null(result.Metadata.Description);
    }

    [Fact]
    public async Task DtdAndExternalEntityAreRejectedWithoutReadingTarget()
    {
        var secretPath = Path.Combine(_root, "not-metadata.txt");
        await File.WriteAllTextAsync(secretPath, "SHOULD-NOT-APPEAR");
        var uri = new Uri(secretPath).AbsoluteUri;
        var path = CreateArchive("dtd.cbz", "ComicInfo.xml", $"""
            <!DOCTYPE ComicInfo [<!ENTITY xxe SYSTEM "{uri}">]>
            <ComicInfo><Title>&xxe;</Title></ComicInfo>
            """);

        var result = await CreateInspector().InspectAsync(path, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvReadingLocalInspectionState.Rejected, result.State);
        Assert.Contains("COMICINFO_XML_REJECTED", result.Warnings);
        Assert.DoesNotContain("SHOULD-NOT-APPEAR", JsonSerializer.Serialize(result), StringComparison.Ordinal);
    }

    [Fact]
    public async Task MalformedComicInfoFailsIndividuallyAndAdjacentOpfStillLoads()
    {
        var path = CreateArchive("malformed.cbz", "ComicInfo.xml", "<ComicInfo><Title>not closed");
        await File.WriteAllTextAsync(Path.ChangeExtension(path, ".opf"), """
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
              <metadata><dc:title>Safe OPF fallback</dc:title></metadata>
            </package>
            """);

        var result = await CreateInspector().InspectAsync(path, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvReadingLocalInspectionState.Inspected, result.State);
        Assert.Equal(["OPF"], result.Sources);
        Assert.Contains("COMICINFO_XML_REJECTED", result.Warnings);
        Assert.Equal("Safe OPF fallback", result.Metadata.Title);
    }

    [Fact]
    public async Task OpfCannotMaskComicInfoFailure()
    {
        var path = CreateArchive("broken.cbz", "ComicInfo.xml", "<ComicInfo><Title>broken");
        await File.WriteAllTextAsync(Path.ChangeExtension(path, ".opf"),
            "<package><metadata><title>OPF title</title></metadata></package>");

        var result = await CreateInspector().InspectAsync(path, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvReadingLocalInspectionState.Inspected, result.State);
        Assert.Equal(PtvComicInfoArchiveInspectionState.Unverified, result.ComicInfo.State);
        Assert.Equal("COMICINFO_XML_REJECTED", result.ComicInfo.ReasonCode);
        Assert.Null(result.ComicInfo.Metadata);
        Assert.Equal("OPF title", result.Metadata.Title);
    }

    [Fact]
    public async Task MissingPathIsNotAttempted()
    {
        var host = new ReadingArchiveHost(new PtvComicInfoBytesResult("inspected", "COMICINFO_FOUND",
            Encoding.UTF8.GetBytes("<ComicInfo><Series>Must not read</Series></ComicInfo>")));

        var result = await new PtvReadingLocalMetadataInspector(host).InspectForApplyAsync(
            "", CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvComicInfoArchiveInspectionState.NotAttempted, result.ComicInfo.State);
        Assert.Null(result.ComicInfo.Metadata);
        Assert.Equal(0, host.Calls);
    }

    [Fact]
    public async Task CbrRootComicInfoParsed()
    {
        var path = Path.Combine(_root, "comic.cbr");
        await File.WriteAllBytesAsync(path, [1, 2, 3]);
        var host = new ReadingArchiveHost(new PtvComicInfoBytesResult("inspected", "COMICINFO_FOUND",
            Encoding.UTF8.GetBytes("<ComicInfo><Series>Orbit</Series><Number>9</Number><Volume>2018</Volume></ComicInfo>")));

        var result = await new PtvReadingLocalMetadataInspector(host).InspectForApplyAsync(
            path, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvComicInfoArchiveInspectionState.Inspected, result.ComicInfo.State);
        Assert.Equal("Orbit", result.ComicInfo.Metadata?.SeriesTitle);
        Assert.Equal("9", result.ComicInfo.Metadata?.IssueNumber);
        Assert.Equal("2018", result.ComicInfo.Metadata?.VolumeNumber);
        Assert.Equal(path, host.LastPath);
    }

    [Theory]
    [InlineData("<ComicInfo><Series>broken")]
    [InlineData("<!DOCTYPE ComicInfo [<!ENTITY xxe SYSTEM 'file:///private/secret'>]><ComicInfo><Series>&xxe;</Series></ComicInfo>")]
    public async Task MalformedOrDtdXmlUnverified(string xml)
    {
        var path = Path.Combine(_root, "unsafe.cbr");
        await File.WriteAllBytesAsync(path, [1, 2, 3]);
        var host = new ReadingArchiveHost(new PtvComicInfoBytesResult("inspected", "COMICINFO_FOUND", Encoding.UTF8.GetBytes(xml)));

        var result = await new PtvReadingLocalMetadataInspector(host).InspectForApplyAsync(
            path, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvComicInfoArchiveInspectionState.Unverified, result.ComicInfo.State);
        Assert.Equal("COMICINFO_XML_REJECTED", result.ComicInfo.ReasonCode);
        Assert.Null(result.ComicInfo.Metadata);
        Assert.DoesNotContain("private", JsonSerializer.Serialize(result), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task InspectForApplyReadsFreshBytes()
    {
        var path = Path.Combine(_root, "changing.cbz");
        await File.WriteAllTextAsync(path, "<ComicInfo><Series>Before</Series></ComicInfo>");
        var host = new FileReadingArchiveHost();
        var inspector = new PtvReadingLocalMetadataInspector(host);

        var first = await inspector.InspectForApplyAsync(path, CreateContext(), CreateQuery(), CancellationToken.None);
        await File.WriteAllTextAsync(path, "<ComicInfo><Series>After</Series></ComicInfo>");
        var second = await inspector.InspectForApplyAsync(path, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal("Before", first.ComicInfo.Metadata?.SeriesTitle);
        Assert.Equal("After", second.ComicInfo.Metadata?.SeriesTitle);
        Assert.Equal(2, host.Calls);
    }

    [Fact]
    public async Task UnsupportedApplyFormatIsUnverifiedWithoutHostRead()
    {
        var path = Path.Combine(_root, "unknown.bin");
        await File.WriteAllBytesAsync(path, [1, 2, 3]);
        var host = new ReadingArchiveHost(new PtvComicInfoBytesResult("absent", "COMICINFO_ABSENT", []));

        var result = await new PtvReadingLocalMetadataInspector(host).InspectForApplyAsync(
            path, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvComicInfoArchiveInspectionState.Unverified, result.ComicInfo.State);
        Assert.Equal("COMICINFO_ARCHIVE_UNSUPPORTED", result.ComicInfo.ReasonCode);
        Assert.Equal(0, host.Calls);
    }

    [Fact]
    public async Task UnconfiguredApplyHostIsUnverifiedEvenWhenOpfSucceeds()
    {
        var path = CreateArchive("offline.cbz", "ComicInfo.xml", "<ComicInfo><Series>Archive</Series></ComicInfo>");
        await File.WriteAllTextAsync(Path.ChangeExtension(path, ".opf"),
            "<package><metadata><title>OPF title</title></metadata></package>");

        var result = await CreateInspector().InspectForApplyAsync(
            path, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvReadingLocalInspectionState.Inspected, result.State);
        Assert.Equal(PtvComicInfoArchiveInspectionState.Unverified, result.ComicInfo.State);
        Assert.Equal("HELPER_UNAVAILABLE", result.ComicInfo.ReasonCode);
        Assert.Equal("OPF title", result.Metadata.Title);
    }

    [Fact]
    public async Task CbrIsExplicitlyUnsupportedAndNeverOpenedOrMutated()
    {
        var path = Path.Combine(_root, "legacy.cbr");
        var bytes = Encoding.UTF8.GetBytes("not-a-rar-but-must-not-be-read");
        await File.WriteAllBytesAsync(path, bytes);
        await File.WriteAllTextAsync(Path.ChangeExtension(path, ".opf"), "<package><metadata><title>Ignored</title></metadata></package>");

        var result = await CreateInspector().InspectAsync(path, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvReadingLocalInspectionState.Unsupported, result.State);
        Assert.Contains("CBR_LOCAL_METADATA_UNSUPPORTED", result.Warnings);
        Assert.Empty(result.Sources);
        Assert.Null(result.Metadata.Title);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(path));
    }

    [Fact]
    public async Task RelativeSourcePathFailsClosedWithoutFileSystemLookup()
    {
        var context = CreateContext();
        context.FileName = "../secret.cbz";
        var query = CreateQuery();
        query.RawFileName = "C:\\private\\secret.cbz";

        var result = await CreateInspector().InspectAsync("../secret.cbz", context, query, CancellationToken.None);

        Assert.Equal(PtvReadingLocalInspectionState.Rejected, result.State);
        Assert.Contains("LOCAL_SOURCE_PATH_REJECTED", result.Warnings);
        Assert.Equal("secret.cbz", result.FileName);
        Assert.DoesNotContain("private", JsonSerializer.Serialize(result), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task InvalidPathCharactersFailClosedWithoutThrowingOrEchoingInput()
    {
        const string invalidPath = "private\0secret.cbz";

        var result = await CreateInspector().InspectAsync(invalidPath, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvReadingLocalInspectionState.Rejected, result.State);
        Assert.Contains("LOCAL_SOURCE_PATH_REJECTED", result.Warnings);
        Assert.DoesNotContain("private", JsonSerializer.Serialize(result), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ArchiveEntryCountLimitRejectsPathologicalContainer()
    {
        var path = Path.Combine(_root, "too-many.cbz");
        using (var stream = File.Create(path))
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create))
        {
            for (var index = 0; index <= PtvReadingLocalMetadataInspector.MaximumArchiveEntries; index++)
            {
                archive.CreateEntry($"page-{index}.txt");
            }
        }

        var result = await CreateInspector().InspectAsync(path, CreateContext(), CreateQuery(), CancellationToken.None);

        Assert.Equal(PtvReadingLocalInspectionState.Rejected, result.State);
        Assert.Contains("COMICINFO_ARCHIVE_ENTRY_LIMIT", result.Warnings);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private static PtvReadingLocalMetadataInspector CreateInspector() => new();

    private sealed class ReadingArchiveHost(PtvComicInfoBytesResult result) : IPtvArchiveInspectionHost
    {
        public int Calls { get; private set; }
        public string? LastPath { get; private set; }
        public Task<PtvComicInfoBytesResult> ReadComicInfoAsync(string authoritativePath, CancellationToken cancellationToken)
        {
            Calls++;
            LastPath = authoritativePath;
            return Task.FromResult(result);
        }
    }

    private sealed class FileReadingArchiveHost : IPtvArchiveInspectionHost
    {
        public int Calls { get; private set; }
        public async Task<PtvComicInfoBytesResult> ReadComicInfoAsync(string authoritativePath, CancellationToken cancellationToken)
        {
            Calls++;
            return new PtvComicInfoBytesResult("inspected", "COMICINFO_FOUND",
                await File.ReadAllBytesAsync(authoritativePath, cancellationToken));
        }
    }

    private static PtvMetadataSearchContext CreateContext() => new();

    private static PtvStructuredMetadataQuery CreateQuery() => new();

    private string CreateArchive(
        string fileName,
        string entryName,
        string contents,
        CompressionLevel compressionLevel = CompressionLevel.Optimal)
    {
        var path = Path.Combine(_root, fileName);
        using var stream = File.Create(path);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Create);
        var entry = archive.CreateEntry(entryName, compressionLevel);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        writer.Write(contents);
        return path;
    }
}
