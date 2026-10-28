using System.Globalization;
using System.Security.Cryptography;
using System.IO.Compression;
using System.Net;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Bounded, read-only inspector for local ComicInfo.xml and OPF metadata. It never extracts archive
/// entries, follows sidecar links, or returns the server path supplied by Jellyfin.
/// </summary>
public sealed partial class PtvReadingLocalMetadataInspector : IPtvReadingLocalMetadataInspector
{
    private readonly IPtvArchiveInspectionHost? _archiveHost;

    /// <summary>Preserves the search-only registration until the Apply host is configured.</summary>
    public PtvReadingLocalMetadataInspector() { }

    /// <summary>Uses a configured isolated host for fresh Apply reassessment.</summary>
    public PtvReadingLocalMetadataInspector(IPtvArchiveInspectionHost archiveHost) =>
        _archiveHost = archiveHost ?? throw new ArgumentNullException(nameof(archiveHost));

    internal const int MaximumArchiveEntries = 4_096;
    internal const int MaximumXmlBytes = 512 * 1024;
    internal const int MaximumCompressionRatio = 100;
    private const int MaximumXmlCharacters = 1_000_000;
    private const int MaximumSidecarCandidates = 4;
    private static readonly StringComparer PathComparer = OperatingSystem.IsWindows()
        ? StringComparer.OrdinalIgnoreCase
        : StringComparer.Ordinal;

    /// <inheritdoc />
    public async Task<PtvReadingLocalMetadataInspectionResult> InspectAsync(
        string sourcePath,
        PtvMetadataSearchContext context,
        PtvStructuredMetadataQuery query,
        CancellationToken cancellationToken) =>
        await InspectCoreAsync(sourcePath, context, query, forApply: false, cancellationToken).ConfigureAwait(false);

    /// <inheritdoc />
    public async Task<PtvReadingLocalMetadataInspectionResult> InspectForApplyAsync(
        string sourcePath,
        PtvMetadataSearchContext context,
        PtvStructuredMetadataQuery query,
        CancellationToken cancellationToken) =>
        await InspectCoreAsync(sourcePath, context, query, forApply: true, cancellationToken).ConfigureAwait(false);

    private async Task<PtvReadingLocalMetadataInspectionResult> InspectCoreAsync(
        string sourcePath,
        PtvMetadataSearchContext context,
        PtvStructuredMetadataQuery query,
        bool forApply,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(query);

        var sourcePathAccepted = !string.IsNullOrWhiteSpace(sourcePath) && IsFullyQualifiedPath(sourcePath);
        var (sourceFileName, sourceFolderName) = sourcePathAccepted
            ? GetSafePathComponents(sourcePath)
            : (null, null);
        var result = new PtvReadingLocalMetadataInspectionResult
        {
            FileName = GetSafeContextFileName(context.FileName)
                ?? GetSafeContextFileName(query.RawFileName)
                ?? sourceFileName,
            FolderName = GetSafeName(context.FolderName)
                ?? sourceFolderName
        };

        if (!sourcePathAccepted)
        {
            var missing = string.IsNullOrWhiteSpace(sourcePath);
            result.State = missing && forApply
                ? PtvReadingLocalInspectionState.Unavailable
                : PtvReadingLocalInspectionState.Rejected;
            result.Warnings.Add(missing && forApply ? "LOCAL_SOURCE_UNAVAILABLE" : "LOCAL_SOURCE_PATH_REJECTED");
            if (!missing)
                result.ComicInfo = Unverified("LOCAL_SOURCE_PATH_REJECTED");
            return result;
        }

        string fullSourcePath;
        try
        {
            fullSourcePath = Path.GetFullPath(sourcePath);
            if (!File.Exists(fullSourcePath))
            {
                result.State = PtvReadingLocalInspectionState.Unavailable;
                result.Warnings.Add("LOCAL_SOURCE_UNAVAILABLE");
                result.ComicInfo = Unverified("LOCAL_SOURCE_UNAVAILABLE");
                return result;
            }

            if (IsReparsePoint(fullSourcePath))
            {
                result.State = PtvReadingLocalInspectionState.Rejected;
                result.Warnings.Add("LOCAL_SOURCE_LINK_REJECTED");
                result.ComicInfo = Unverified("LOCAL_SOURCE_LINK_REJECTED");
                return result;
            }
        }
        catch (Exception exception) when (IsSafeFileFailure(exception))
        {
            result.State = PtvReadingLocalInspectionState.Unavailable;
            result.Warnings.Add("LOCAL_SOURCE_UNAVAILABLE");
            result.ComicInfo = Unverified("LOCAL_SOURCE_UNAVAILABLE");
            return result;
        }

        var extension = Path.GetExtension(fullSourcePath);
        var isComicArchive = extension.Equals(".cbz", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".zip", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".cbr", StringComparison.OrdinalIgnoreCase);
        if (forApply && !isComicArchive)
            result.ComicInfo = Unverified("COMICINFO_ARCHIVE_UNSUPPORTED");
        if (!forApply && extension.Equals(".cbr", StringComparison.OrdinalIgnoreCase))
        {
            result.State = PtvReadingLocalInspectionState.Unsupported;
            result.Warnings.Add("CBR_LOCAL_METADATA_UNSUPPORTED");
            result.ComicInfo = Unverified("CBR_LOCAL_METADATA_UNSUPPORTED");
            return result;
        }

        var encounteredRejectedDocument = false;
        var encounteredUnavailableDocument = false;
        if (extension.Equals(".cbz", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".zip", StringComparison.OrdinalIgnoreCase)
            || forApply && extension.Equals(".cbr", StringComparison.OrdinalIgnoreCase))
        {
            var comicInfo = forApply
                ? await ReadIsolatedComicInfoAsync(fullSourcePath, cancellationToken).ConfigureAwait(false)
                : await ReadComicInfoAsync(fullSourcePath, cancellationToken).ConfigureAwait(false);
            result.ComicInfo = ToArchiveInspection(comicInfo);
            encounteredRejectedDocument |= comicInfo.Rejected;
            encounteredUnavailableDocument |= comicInfo.IsUnavailable;
            AddWarning(result, comicInfo.Warning);
            if (comicInfo.Metadata is not null)
            {
                Merge(result.Metadata, comicInfo.Metadata);
                result.Sources.Add("ComicInfo.xml");
            }
        }

        var opf = await ReadAdjacentOpfAsync(fullSourcePath, cancellationToken).ConfigureAwait(false);
        encounteredRejectedDocument |= opf.Rejected;
        encounteredUnavailableDocument |= opf.IsUnavailable;
        AddWarning(result, opf.Warning);
        if (opf.Metadata is not null)
        {
            Merge(result.Metadata, opf.Metadata);
            result.Sources.Add("OPF");
        }

        result.Sources = result.Sources.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        result.Warnings = result.Warnings.Distinct(StringComparer.Ordinal).ToList();
        result.State = result.Sources.Count > 0
            ? PtvReadingLocalInspectionState.Inspected
            : encounteredRejectedDocument
                ? PtvReadingLocalInspectionState.Rejected
                : encounteredUnavailableDocument
                    ? PtvReadingLocalInspectionState.Unavailable
                    : PtvReadingLocalInspectionState.NotFound;
        return result;
    }

    private async Task<DocumentInspection> ReadIsolatedComicInfoAsync(string sourcePath, CancellationToken cancellationToken)
    {
        if (_archiveHost is null)
            return DocumentInspection.Unavailable("HELPER_UNAVAILABLE");

        var archive = await _archiveHost.ReadComicInfoAsync(sourcePath, cancellationToken).ConfigureAwait(false);
        return archive.State switch
        {
            "inspected" => ParseComicInfo(archive.Bytes) with { ContentDigest = Convert.ToHexString(SHA256.HashData(archive.Bytes)) },
            "absent" => DocumentInspection.Empty(),
            _ => DocumentInspection.Unavailable(archive.ReasonCode)
        };
    }

    private static PtvComicInfoArchiveInspection ToArchiveInspection(DocumentInspection inspection) =>
        inspection.Metadata is not null
            ? new PtvComicInfoArchiveInspection
            {
                State = PtvComicInfoArchiveInspectionState.Inspected,
                ReasonCode = "COMICINFO_FOUND",
                Metadata = inspection.Metadata,
                ContentDigest = inspection.ContentDigest
            }
            : inspection.Rejected || inspection.IsUnavailable
                ? new PtvComicInfoArchiveInspection { State = PtvComicInfoArchiveInspectionState.Unverified, ReasonCode = inspection.Warning ?? "COMICINFO_UNAVAILABLE", ContentDigest = inspection.ContentDigest }
                : new PtvComicInfoArchiveInspection
                {
                    State = PtvComicInfoArchiveInspectionState.Absent,
                    ReasonCode = "COMICINFO_ABSENT"
                };

    private static PtvComicInfoArchiveInspection Unverified(string reasonCode) => new()
    {
        State = PtvComicInfoArchiveInspectionState.Unverified,
        ReasonCode = reasonCode
    };

    private static async Task<DocumentInspection> ReadComicInfoAsync(
        string sourcePath,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var file = new FileStream(
                sourcePath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 16 * 1024,
                useAsync: true);
            using var archive = new ZipArchive(file, ZipArchiveMode.Read, leaveOpen: false);
            if (archive.Entries.Count > MaximumArchiveEntries)
            {
                return DocumentInspection.Reject("COMICINFO_ARCHIVE_ENTRY_LIMIT");
            }

            var unsafeComicInfo = archive.Entries.Any(entry =>
                entry.Name.Equals("ComicInfo.xml", StringComparison.OrdinalIgnoreCase)
                && !IsSafeRootEntry(entry));
            if (unsafeComicInfo)
            {
                return DocumentInspection.Reject("COMICINFO_ENTRY_PATH_REJECTED");
            }

            var entries = archive.Entries
                .Where(entry => IsSafeRootEntry(entry)
                    && entry.Name.Equals("ComicInfo.xml", StringComparison.OrdinalIgnoreCase))
                .Take(2)
                .ToList();
            if (entries.Count == 0)
            {
                return DocumentInspection.Empty();
            }

            if (entries.Count > 1)
            {
                return DocumentInspection.Reject("COMICINFO_ENTRY_AMBIGUOUS");
            }

            var entry = entries[0];
            if (!IsSafeCompressedDocument(entry))
            {
                return DocumentInspection.Reject("COMICINFO_SIZE_LIMIT");
            }

            await using var entryStream = entry.Open();
            var bytes = await ReadBoundedAsync(entryStream, cancellationToken).ConfigureAwait(false);
            return ParseComicInfo(bytes) with { ContentDigest = Convert.ToHexString(SHA256.HashData(bytes)) };
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (PtvReadingLocalMetadataLimitException)
        {
            return DocumentInspection.Reject("COMICINFO_SIZE_LIMIT");
        }
        catch (Exception exception) when (IsSafeArchiveFailure(exception))
        {
            return DocumentInspection.Unavailable("COMICINFO_UNAVAILABLE");
        }
    }

    private static async Task<DocumentInspection> ReadAdjacentOpfAsync(
        string sourcePath,
        CancellationToken cancellationToken)
    {
        string? directory;
        try
        {
            directory = Path.GetDirectoryName(sourcePath);
            if (string.IsNullOrWhiteSpace(directory))
            {
                return DocumentInspection.Empty();
            }

            directory = Path.GetFullPath(directory);
        }
        catch (Exception exception) when (IsSafeFileFailure(exception))
        {
            return DocumentInspection.Unavailable("OPF_UNAVAILABLE");
        }

        var names = new List<string>();
        if (Path.GetExtension(sourcePath).Equals(".opf", StringComparison.OrdinalIgnoreCase))
        {
            names.Add(Path.GetFileName(sourcePath));
        }
        else
        {
            names.Add(Path.GetFileNameWithoutExtension(sourcePath) + ".opf");
        }

        names.Add("metadata.opf");
        names.Add("book.opf");

        DocumentInspection? firstFailure = null;
        foreach (var name in names
                     .Where(name => !string.IsNullOrWhiteSpace(name))
                     .Distinct(PathComparer)
                     .Take(MaximumSidecarCandidates))
        {
            cancellationToken.ThrowIfCancellationRequested();
            string candidate;
            try
            {
                candidate = Path.GetFullPath(Path.Combine(directory, name));
                if (!IsImmediateChild(directory, candidate) || !File.Exists(candidate))
                {
                    continue;
                }

                if (IsReparsePoint(candidate))
                {
                    firstFailure ??= DocumentInspection.Reject("OPF_LINK_REJECTED");
                    continue;
                }

                var info = new FileInfo(candidate);
                if (info.Length < 0 || info.Length > MaximumXmlBytes)
                {
                    firstFailure ??= DocumentInspection.Reject("OPF_SIZE_LIMIT");
                    continue;
                }

                await using var stream = new FileStream(
                    candidate,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read,
                    bufferSize: 16 * 1024,
                    useAsync: true);
                var bytes = await ReadBoundedAsync(stream, cancellationToken).ConfigureAwait(false);
                var parsed = ParseOpf(bytes);
                if (parsed.Metadata is not null)
                {
                    return parsed;
                }

                firstFailure ??= parsed;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (PtvReadingLocalMetadataLimitException)
            {
                firstFailure ??= DocumentInspection.Reject("OPF_SIZE_LIMIT");
            }
            catch (Exception exception) when (IsSafeFileFailure(exception))
            {
                firstFailure ??= DocumentInspection.Unavailable("OPF_UNAVAILABLE");
            }
        }

        return firstFailure ?? DocumentInspection.Empty();
    }

    private static DocumentInspection ParseComicInfo(byte[] bytes)
    {
        var document = ParseXml(bytes, "ComicInfo", "COMICINFO_XML_REJECTED");
        if (document.Document is null)
        {
            return document.Failure!;
        }

        var root = document.Document.Root!;
        var metadata = new PtvReadingLocalMetadataEvidence
        {
            Title = ElementText(root, "Title", PtvReadingMetadataLimits.MaximumTitleLength),
            SeriesTitle = ElementText(root, "Series", PtvReadingMetadataLimits.MaximumTitleLength),
            IssueNumber = ElementText(root, "Number", 32),
            VolumeNumber = ElementText(root, "Volume", 32),
            Year = ParseInteger(ElementText(root, "Year", 8), 1000, 9999),
            Month = ParseInteger(ElementText(root, "Month", 4), 1, 12),
            Day = ParseInteger(ElementText(root, "Day", 4), 1, 31),
            Description = ElementPlainText(root, "Summary", PtvReadingMetadataLimits.MaximumDescriptionLength),
            Publisher = ElementText(root, "Publisher", PtvReadingMetadataLimits.MaximumTitleLength),
            SourceUrl = SafeHttpUrl(ElementText(root, "Web", PtvReadingMetadataLimits.MaximumUrlLength)),
            Language = ElementText(root, "LanguageISO", 64),
            Manga = ElementText(root, "Manga", 64)
        };

        AddAlternate(metadata, ElementText(root, "AlternateSeries", PtvReadingMetadataLimits.MaximumTitleLength));
        AddDelimited(metadata.Genres, ElementText(root, "Genre", 4_096));
        AddDelimited(metadata.Tags, ElementText(root, "Tags", 4_096));
        AddCredits(metadata, root, "Writer", "Writer");
        AddCredits(metadata, root, "Penciller", "Penciller");
        AddCredits(metadata, root, "Inker", "Inker");
        AddCredits(metadata, root, "Colorist", "Colorist");
        AddCredits(metadata, root, "Letterer", "Letterer");
        AddCredits(metadata, root, "CoverArtist", "Cover Artist");
        AddCredits(metadata, root, "Editor", "Editor");
        AddCredits(metadata, root, "Translator", "Translator");
        NormalizeCollections(metadata);
        return DocumentInspection.Success(metadata);
    }

    private static DocumentInspection ParseOpf(byte[] bytes)
    {
        var parsed = ParseXml(bytes, "package", "OPF_XML_REJECTED");
        if (parsed.Document is null)
        {
            return parsed.Failure!;
        }

        var document = parsed.Document;
        var metadata = new PtvReadingLocalMetadataEvidence
        {
            Title = DescendantText(document, "title", PtvReadingMetadataLimits.MaximumTitleLength),
            Publisher = DescendantText(document, "publisher", PtvReadingMetadataLimits.MaximumTitleLength),
            Language = DescendantText(document, "language", 64),
            Description = DescendantPlainText(document, "description", PtvReadingMetadataLimits.MaximumDescriptionLength)
        };

        var date = DescendantText(document, "date", 128);
        metadata.Year = ParseYear(date);

        foreach (var creator in document.Descendants().Where(element =>
                     element.Name.LocalName.Equals("creator", StringComparison.OrdinalIgnoreCase)))
        {
            var name = NormalizeText(creator.Value, PtvReadingMetadataLimits.MaximumTitleLength);
            if (string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            var roleValue = creator.Attributes().FirstOrDefault(attribute =>
                attribute.Name.LocalName.Equals("role", StringComparison.OrdinalIgnoreCase))?.Value;
            metadata.Credits.Add(new PtvReadingPersonCredit
            {
                Name = name,
                Role = NormalizeCreatorRole(roleValue)
            });
        }

        foreach (var subject in document.Descendants().Where(element =>
                     element.Name.LocalName.Equals("subject", StringComparison.OrdinalIgnoreCase)))
        {
            AddDelimited(metadata.Genres, subject.Value);
            AddDelimited(metadata.Tags, subject.Value);
        }

        foreach (var identifier in document.Descendants().Where(element =>
                     element.Name.LocalName.Equals("identifier", StringComparison.OrdinalIgnoreCase)))
        {
            AddOpfIdentifier(metadata, identifier);
        }

        foreach (var meta in document.Descendants().Where(element =>
                     element.Name.LocalName.Equals("meta", StringComparison.OrdinalIgnoreCase)))
        {
            var name = meta.Attributes().FirstOrDefault(attribute =>
                attribute.Name.LocalName.Equals("name", StringComparison.OrdinalIgnoreCase))?.Value;
            var property = meta.Attributes().FirstOrDefault(attribute =>
                attribute.Name.LocalName.Equals("property", StringComparison.OrdinalIgnoreCase))?.Value;
            var content = meta.Attributes().FirstOrDefault(attribute =>
                attribute.Name.LocalName.Equals("content", StringComparison.OrdinalIgnoreCase))?.Value
                ?? meta.Value;

            if (string.Equals(name, "calibre:series", StringComparison.OrdinalIgnoreCase)
                || string.Equals(property, "belongs-to-collection", StringComparison.OrdinalIgnoreCase))
            {
                metadata.SeriesTitle ??= NormalizeText(content, PtvReadingMetadataLimits.MaximumTitleLength);
            }
            else if (string.Equals(name, "calibre:series_index", StringComparison.OrdinalIgnoreCase)
                     || string.Equals(property, "group-position", StringComparison.OrdinalIgnoreCase))
            {
                metadata.VolumeNumber ??= NormalizeText(content, 32);
            }
        }

        NormalizeCollections(metadata);
        return DocumentInspection.Success(metadata);
    }

    private static XmlParseResult ParseXml(byte[] bytes, string expectedRoot, string failureCode)
    {
        if (bytes.Length == 0 || bytes.Length > MaximumXmlBytes)
        {
            return XmlParseResult.Fail(DocumentInspection.Reject(failureCode));
        }

        try
        {
            using var stream = new MemoryStream(bytes, writable: false);
            var settings = new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null,
                MaxCharactersInDocument = MaximumXmlCharacters,
                MaxCharactersFromEntities = 0,
                IgnoreComments = true,
                IgnoreProcessingInstructions = true
            };
            using var reader = XmlReader.Create(stream, settings);
            var document = XDocument.Load(reader, LoadOptions.None);
            if (document.Root is null
                || !document.Root.Name.LocalName.Equals(expectedRoot, StringComparison.OrdinalIgnoreCase))
            {
                return XmlParseResult.Fail(DocumentInspection.Reject(failureCode));
            }

            return XmlParseResult.Success(document);
        }
        catch (XmlException)
        {
            return XmlParseResult.Fail(DocumentInspection.Reject(failureCode));
        }
        catch (InvalidOperationException)
        {
            return XmlParseResult.Fail(DocumentInspection.Reject(failureCode));
        }
    }

    private static async Task<byte[]> ReadBoundedAsync(Stream stream, CancellationToken cancellationToken)
    {
        using var output = new MemoryStream(capacity: Math.Min(MaximumXmlBytes, 16 * 1024));
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }

            if (output.Length + read > MaximumXmlBytes)
            {
                throw new PtvReadingLocalMetadataLimitException();
            }

            output.Write(buffer, 0, read);
        }

        return output.ToArray();
    }

    private static bool IsSafeCompressedDocument(ZipArchiveEntry entry)
    {
        if (entry.Length < 0 || entry.Length > MaximumXmlBytes)
        {
            return false;
        }

        if (entry.Length == 0)
        {
            return true;
        }

        if (entry.CompressedLength <= 0)
        {
            return false;
        }

        return entry.Length <= entry.CompressedLength * (long)MaximumCompressionRatio;
    }

    private static bool IsSafeRootEntry(ZipArchiveEntry entry)
    {
        if (string.IsNullOrWhiteSpace(entry.Name)
            || !entry.FullName.Equals(entry.Name, StringComparison.Ordinal))
        {
            return false;
        }

        return !entry.FullName.Contains('/')
            && !entry.FullName.Contains('\\')
            && !entry.FullName.Equals(".", StringComparison.Ordinal)
            && !entry.FullName.Equals("..", StringComparison.Ordinal);
    }

    private static bool IsImmediateChild(string directory, string candidate)
    {
        var candidateDirectory = Path.GetDirectoryName(candidate);
        return candidateDirectory is not null
            && PathComparer.Equals(Path.TrimEndingDirectorySeparator(directory), Path.TrimEndingDirectorySeparator(candidateDirectory));
    }

    private static bool IsReparsePoint(string path)
    {
        return (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;
    }

    private static string? ElementText(XElement root, string localName, int maximumLength)
    {
        var value = root.Elements().FirstOrDefault(element =>
            element.Name.LocalName.Equals(localName, StringComparison.OrdinalIgnoreCase))?.Value;
        return NormalizeText(value, maximumLength);
    }

    private static string? ElementPlainText(XElement root, string localName, int maximumLength)
    {
        var value = root.Elements().FirstOrDefault(element =>
            element.Name.LocalName.Equals(localName, StringComparison.OrdinalIgnoreCase))?.Value;
        return NormalizePlainText(value, maximumLength);
    }

    private static string? DescendantText(XDocument document, string localName, int maximumLength)
    {
        var value = document.Descendants().FirstOrDefault(element =>
            element.Name.LocalName.Equals(localName, StringComparison.OrdinalIgnoreCase))?.Value;
        return NormalizeText(value, maximumLength);
    }

    private static string? DescendantPlainText(XDocument document, string localName, int maximumLength)
    {
        var value = document.Descendants().FirstOrDefault(element =>
            element.Name.LocalName.Equals(localName, StringComparison.OrdinalIgnoreCase))?.Value;
        return NormalizePlainText(value, maximumLength);
    }

    private static string? NormalizeText(string? value, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var withoutControls = new string(value
            .Where(character => !char.IsControl(character) || character is '\t' or '\r' or '\n')
            .ToArray());
        var normalized = WhitespaceRegex().Replace(withoutControls, " ").Trim();
        return normalized.Length == 0
            ? null
            : normalized.Length <= maximumLength
                ? normalized
                : normalized[..maximumLength];
    }

    private static string? NormalizePlainText(string? value, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var decoded = WebUtility.HtmlDecode(value);
        var withoutMarkup = HtmlTagRegex().Replace(decoded, " ");
        return NormalizeText(withoutMarkup, maximumLength);
    }

    private static string? SafeHttpUrl(string? value)
    {
        var normalized = NormalizeText(value, PtvReadingMetadataLimits.MaximumUrlLength);
        return PtvReadingUrlSafety.HttpUrl(normalized, PtvReadingMetadataLimits.MaximumUrlLength);
    }

    private static int? ParseInteger(string? value, int minimum, int maximum)
    {
        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
               && parsed >= minimum
               && parsed <= maximum
            ? parsed
            : null;
    }

    private static int? ParseYear(string? value)
    {
        var match = YearRegex().Match(value ?? string.Empty);
        return match.Success
               && int.TryParse(match.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var year)
            ? year
            : null;
    }

    private static string NormalizeCreatorRole(string? role)
    {
        return role?.Trim().ToLowerInvariant() switch
        {
            "aut" or "author" => "Author",
            "edt" or "editor" => "Editor",
            "trl" or "translator" => "Translator",
            "ill" or "illustrator" => "Illustrator",
            _ => "Author"
        };
    }

    private static void AddCredits(
        PtvReadingLocalMetadataEvidence metadata,
        XElement root,
        string elementName,
        string role)
    {
        var value = ElementText(root, elementName, 4_096);
        foreach (var name in SplitValues(value))
        {
            metadata.Credits.Add(new PtvReadingPersonCredit { Name = name, Role = role });
        }
    }

    private static void AddDelimited(List<string> target, string? value)
    {
        target.AddRange(SplitValues(value));
    }

    private static IEnumerable<string> SplitValues(string? value)
    {
        return string.IsNullOrWhiteSpace(value)
            ? []
            : value.Split([',', ';', '|'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(entry => NormalizeText(entry, 256))
                .Where(entry => !string.IsNullOrWhiteSpace(entry))
                .Cast<string>();
    }

    private static void AddAlternate(PtvReadingLocalMetadataEvidence metadata, string? title)
    {
        if (!string.IsNullOrWhiteSpace(title)
            && !string.Equals(title, metadata.Title, StringComparison.OrdinalIgnoreCase))
        {
            metadata.AlternateTitles.Add(title);
        }
    }

    private static void AddOpfIdentifier(PtvReadingLocalMetadataEvidence metadata, XElement identifier)
    {
        var raw = NormalizeText(identifier.Value, 256);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return;
        }

        var scheme = identifier.Attributes().FirstOrDefault(attribute =>
            attribute.Name.LocalName.Equals("scheme", StringComparison.OrdinalIgnoreCase))?.Value;
        var isIsbn = string.Equals(scheme, "ISBN", StringComparison.OrdinalIgnoreCase)
            || raw.StartsWith("urn:isbn:", StringComparison.OrdinalIgnoreCase);
        if (!isIsbn)
        {
            return;
        }

        var isbn = new string(raw
            .Replace("urn:isbn:", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Where(character => char.IsAsciiLetterOrDigit(character))
            .ToArray())
            .ToUpperInvariant();
        if (isbn.Length == 10)
        {
            metadata.Isbn10 ??= isbn;
            metadata.ExternalIds.TryAdd("ISBN10", isbn);
        }
        else if (isbn.Length == 13)
        {
            metadata.Isbn13 ??= isbn;
            metadata.ExternalIds.TryAdd("ISBN13", isbn);
        }
    }

    private static void Merge(
        PtvReadingLocalMetadataEvidence target,
        PtvReadingLocalMetadataEvidence incoming)
    {
        target.Title ??= incoming.Title;
        target.SeriesTitle ??= incoming.SeriesTitle;
        target.IssueNumber ??= incoming.IssueNumber;
        target.VolumeNumber ??= incoming.VolumeNumber;
        target.ChapterNumber ??= incoming.ChapterNumber;
        target.Year ??= incoming.Year;
        target.Month ??= incoming.Month;
        target.Day ??= incoming.Day;
        target.Description ??= incoming.Description;
        target.Publisher ??= incoming.Publisher;
        target.SourceUrl ??= incoming.SourceUrl;
        target.Language ??= incoming.Language;
        target.Manga ??= incoming.Manga;
        target.Isbn10 ??= incoming.Isbn10;
        target.Isbn13 ??= incoming.Isbn13;
        target.AlternateTitles.AddRange(incoming.AlternateTitles);
        target.Credits.AddRange(incoming.Credits);
        target.Genres.AddRange(incoming.Genres);
        target.Tags.AddRange(incoming.Tags);
        foreach (var pair in incoming.ExternalIds)
        {
            target.ExternalIds.TryAdd(pair.Key, pair.Value);
        }

        NormalizeCollections(target);
    }

    private static void NormalizeCollections(PtvReadingLocalMetadataEvidence metadata)
    {
        metadata.AlternateTitles = metadata.AlternateTitles
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(PtvReadingMetadataLimits.MaximumCollectionItems)
            .ToList();
        metadata.Credits = metadata.Credits
            .Where(credit => !string.IsNullOrWhiteSpace(credit.Name))
            .DistinctBy(credit => $"{credit.Name}\u001f{credit.Role}", StringComparer.OrdinalIgnoreCase)
            .Take(PtvReadingMetadataLimits.MaximumCollectionItems)
            .ToList();
        metadata.Genres = metadata.Genres
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(PtvReadingMetadataLimits.MaximumCollectionItems)
            .ToList();
        metadata.Tags = metadata.Tags
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(PtvReadingMetadataLimits.MaximumCollectionItems)
            .ToList();
        metadata.ExternalIds = metadata.ExternalIds
            .Take(PtvReadingMetadataLimits.MaximumExternalIds)
            .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
    }

    private static string? GetSafeName(string? value)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(value)
                || Path.IsPathFullyQualified(value)
                || value.Contains('/')
                || value.Contains('\\'))
            {
                return null;
            }

            return NormalizeText(value, 512);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    private static string? GetSafeContextFileName(string? value)
    {
        try
        {
            return GetSafeName(Path.GetFileName(value));
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    private static (string? FileName, string? FolderName) GetSafePathComponents(string? path)
    {
        try
        {
            return (
                GetSafeName(Path.GetFileName(path)),
                GetSafeName(Path.GetFileName(Path.GetDirectoryName(path))));
        }
        catch (ArgumentException)
        {
            return (null, null);
        }
    }

    private static bool IsFullyQualifiedPath(string path)
    {
        try
        {
            return Path.IsPathFullyQualified(path);
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    private static void AddWarning(PtvReadingLocalMetadataInspectionResult result, string? warning)
    {
        if (!string.IsNullOrWhiteSpace(warning))
        {
            result.Warnings.Add(warning);
        }
    }

    private static bool IsSafeArchiveFailure(Exception exception)
    {
        return exception is IOException
            or UnauthorizedAccessException
            or InvalidDataException
            or NotSupportedException;
    }

    private static bool IsSafeFileFailure(Exception exception)
    {
        return exception is IOException
            or UnauthorizedAccessException
            or NotSupportedException
            or ArgumentException;
    }

    [GeneratedRegex("</?[A-Za-z][^>]{0,512}>", RegexOptions.Compiled)]
    private static partial Regex HtmlTagRegex();

    [GeneratedRegex("\\s+", RegexOptions.Compiled)]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex("\\b(?:1[0-9]{3}|2[0-9]{3})\\b", RegexOptions.Compiled)]
    private static partial Regex YearRegex();

    private sealed record DocumentInspection(
        PtvReadingLocalMetadataEvidence? Metadata,
        string? Warning,
        bool Rejected,
        bool IsUnavailable)
    {
        public string? ContentDigest { get; init; }

        public static DocumentInspection Success(PtvReadingLocalMetadataEvidence metadata) => new(metadata, null, false, false);

        public static DocumentInspection Empty() => new(null, null, false, false);

        public static DocumentInspection Reject(string warning) => new(null, warning, true, false);

        public static DocumentInspection Unavailable(string warning) => new(null, warning, false, true);
    }

    private sealed record XmlParseResult(
        XDocument? Document,
        DocumentInspection? Failure)
    {
        public static XmlParseResult Success(XDocument document) => new(document, null);

        public static XmlParseResult Fail(DocumentInspection failure) => new(null, failure);
    }

    private sealed class PtvReadingLocalMetadataLimitException : Exception
    {
    }
}
