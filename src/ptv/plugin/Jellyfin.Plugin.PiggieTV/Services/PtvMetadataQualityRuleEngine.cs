using System.Globalization;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Pure deterministic Metadata Quality rules. No rule mutates Jellyfin metadata.</summary>
public sealed partial class PtvMetadataQualityRuleEngine
{
    private static readonly HashSet<string> GenericFolders = new(StringComparer.OrdinalIgnoreCase)
    {
        "movies", "movie", "tv", "shows", "series", "media", "videos", "books", "music"
    };

    /// <summary>Analyzes one path-reduced item.</summary>
    public PtvMetadataQualityRuleResult Analyze(PtvMetadataQualityAnalysisItem item)
    {
        ArgumentNullException.ThrowIfNull(item);

        var result = new PtvMetadataQualityRuleResult();
        var matchScore = 100;
        var completenessScore = 100;
        var providerIdPresent = item.ProviderIds.Any(pair => !string.IsNullOrWhiteSpace(pair.Value));
        var requiresPrimaryImage = RequiresPrimaryImage(item.ItemType);
        var requiresOverview = RequiresOverview(item.ItemType);
        result.Signals.ProviderIdPresent = providerIdPresent;
        result.Signals.MissingPrimaryImage = requiresPrimaryImage && !item.HasPrimaryImage;
        result.Signals.MissingOverview = requiresOverview && !item.HasOverview;

        if (!providerIdPresent)
        {
            completenessScore -= 25;
            AddReason(result, PtvMetadataQualityReasonCodes.ProviderIdMissing, "warning", 0, "No metadata provider identifier is present.");
        }

        if (!item.ProductionYear.HasValue && RequiresYear(item.ItemType))
        {
            completenessScore -= 20;
            AddReason(result, PtvMetadataQualityReasonCodes.MissingYear, "warning", 0, "The production year is missing.");
        }

        if (!item.HasPrimaryImage && requiresPrimaryImage)
        {
            completenessScore -= 20;
            AddReason(result, PtvMetadataQualityReasonCodes.MissingArtwork, "warning", 0, "Primary artwork is missing.");
        }

        if (!item.HasOverview && requiresOverview)
        {
            completenessScore -= 10;
            AddReason(result, PtvMetadataQualityReasonCodes.MissingOverview, "info", 0, "The overview is missing.");
        }

        if (IsEpisode(item.ItemType))
        {
            AnalyzeEpisodeNumbering(item, result, ref matchScore);
        }
        else if (IsMovieOrSeries(item.ItemType))
        {
            AnalyzePathAgreement(item, result, ref matchScore);
        }

        result.MatchConfidence = result.HasHardConflict
            ? Math.Min(Math.Clamp(matchScore, 0, 100), 49)
            : Math.Clamp(matchScore, 0, 100);
        result.CompletenessScore = Math.Clamp(completenessScore, 0, 100);
        return result;
    }

    /// <summary>Normalizes file/folder labels while retaining meaningful title numbers.</summary>
    public static string NormalizeTitle(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var normalized = value.Normalize().ToLowerInvariant();
        normalized = MediaExtensionRegex().Replace(normalized, string.Empty);
        normalized = BracketedReleaseTagRegex().Replace(normalized, " ");
        normalized = ReleaseTagRegex().Replace(normalized, " ");
        normalized = YearRegex().Replace(normalized, " ");
        normalized = SeparatorRegex().Replace(normalized, " ");
        return WhitespaceRegex().Replace(normalized, " ").Trim();
    }

    /// <summary>Computes conservative title-token similarity from zero to one.</summary>
    public static double Similarity(string? left, string? right)
    {
        var leftTokens = NormalizeTitle(left).Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var rightTokens = NormalizeTitle(right).Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (leftTokens.Count == 0 || rightTokens.Count == 0) return 0;
        var intersection = leftTokens.Intersect(rightTokens, StringComparer.OrdinalIgnoreCase).Count();
        var union = leftTokens.Union(rightTokens, StringComparer.OrdinalIgnoreCase).Count();
        return union == 0 ? 0 : (double)intersection / union;
    }

    private static void AnalyzePathAgreement(
        PtvMetadataQualityAnalysisItem item,
        PtvMetadataQualityRuleResult result,
        ref int matchScore)
    {
        var filenameSimilarity = BestTitleSimilarity(item.FileName, item.Name, item.OriginalTitle);
        var normalizedFolder = NormalizeTitle(item.FolderName);
        var folderSimilarity = BestTitleSimilarity(item.FolderName, item.Name, item.OriginalTitle);
        result.Signals.FilenameTitleSimilarity = string.IsNullOrWhiteSpace(item.FileName) ? null : filenameSimilarity;
        result.Signals.FolderTitleSimilarity = string.IsNullOrWhiteSpace(item.FolderName) ? null : folderSimilarity;

        if (!string.IsNullOrWhiteSpace(item.FileName) && filenameSimilarity < 0.34)
        {
            matchScore -= 20;
            AddReason(result, PtvMetadataQualityReasonCodes.FilenameConflict, "warning", -20, "The file name has little agreement with the current title.", item.FileName);
        }

        if (!string.IsNullOrWhiteSpace(normalizedFolder)
            && !GenericFolders.Contains(normalizedFolder)
            && folderSimilarity < 0.34)
        {
            matchScore -= 15;
            AddReason(result, PtvMetadataQualityReasonCodes.FolderConflict, "warning", -15, "The folder name has little agreement with the current title.", item.FolderName);
        }

        var pathYear = ExtractYear(item.FileName) ?? ExtractYear(item.FolderName);
        result.Signals.FilenameYear = pathYear;
        if (pathYear.HasValue && item.ProductionYear.HasValue)
        {
            var difference = Math.Abs(pathYear.Value - item.ProductionYear.Value);
            result.Signals.YearDifference = difference;
            var tolerance = string.Equals(item.ItemType, "Series", StringComparison.OrdinalIgnoreCase) ? 2 : 1;
            if (difference > tolerance)
            {
                matchScore -= difference >= 10 ? 30 : 20;
                AddReason(result, PtvMetadataQualityReasonCodes.YearMismatch, difference >= 10 ? "error" : "warning", difference >= 10 ? -30 : -20, "The file or folder year conflicts with the current production year.", $"{pathYear.Value} vs {item.ProductionYear.Value}");
                if (difference >= 10) result.HasHardConflict = true;
            }
        }
    }

    private static void AnalyzeEpisodeNumbering(
        PtvMetadataQualityAnalysisItem item,
        PtvMetadataQualityRuleResult result,
        ref int matchScore)
    {
        var source = $"{item.FolderName} {item.FileName}";
        if (item.IsSpecial && SpecialLabelRegex().IsMatch(source)) return;

        var match = EpisodeNumberRegex().Match(source);
        if (!match.Success) return; // Absolute anime numbering is intentionally not guessed.

        var parsedSeason = int.Parse(match.Groups["season"].Value, CultureInfo.InvariantCulture);
        var parsedEpisode = int.Parse(match.Groups["episode"].Value, CultureInfo.InvariantCulture);
        var parsedEnd = match.Groups["end"].Success
            ? int.Parse(match.Groups["end"].Value, CultureInfo.InvariantCulture)
            : parsedEpisode;

        if (item.ParentIndexNumber.HasValue && parsedSeason != item.ParentIndexNumber.Value)
        {
            result.Signals.SeasonConflict = true;
            matchScore -= 35;
            result.HasHardConflict = true;
            AddReason(result, PtvMetadataQualityReasonCodes.SeasonNumberConflict, "error", -35, "The season number conflicts with the file name.", $"S{parsedSeason:00} vs S{item.ParentIndexNumber.Value:00}");
        }

        if (item.IndexNumber.HasValue)
        {
            var configuredEnd = item.IndexNumberEnd ?? item.IndexNumber.Value;
            var rangesOverlap = parsedEpisode <= configuredEnd && parsedEnd >= item.IndexNumber.Value;
            if (!rangesOverlap)
            {
                result.Signals.EpisodeConflict = true;
                matchScore -= 35;
                result.HasHardConflict = true;
                AddReason(result, PtvMetadataQualityReasonCodes.EpisodeNumberConflict, "error", -35, "The episode number conflicts with the file name.", $"E{parsedEpisode:00}-E{parsedEnd:00} vs E{item.IndexNumber.Value:00}-E{configuredEnd:00}");
            }
        }
    }

    /// <summary>Extracts the last plausible release year from a filename or folder label.</summary>
    public static int? ExtractYear(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var matches = YearRegex().Matches(value);
        if (matches.Count == 0) return null;
        for (var index = matches.Count - 1; index >= 0; index--)
        {
            if (int.TryParse(matches[index].Groups["year"].Value, CultureInfo.InvariantCulture, out var year)
                && year != 2160) // 2160p is display resolution, never a release year.
            {
                return year;
            }
        }

        return null;
    }

    private static bool IsMovieOrSeries(string itemType) =>
        string.Equals(itemType, "Movie", StringComparison.OrdinalIgnoreCase)
        || string.Equals(itemType, "Series", StringComparison.OrdinalIgnoreCase);

    private static bool IsEpisode(string itemType) => string.Equals(itemType, "Episode", StringComparison.OrdinalIgnoreCase);

    private static double BestTitleSimilarity(string? source, string currentTitle, string? originalTitle) => Math.Max(
        Similarity(source, currentTitle),
        string.IsNullOrWhiteSpace(originalTitle) ? 0 : Similarity(source, originalTitle));

    private static bool RequiresYear(string itemType) =>
        IsMovieOrSeries(itemType)
        || string.Equals(itemType, "Book", StringComparison.OrdinalIgnoreCase)
        || string.Equals(itemType, "MusicAlbum", StringComparison.OrdinalIgnoreCase);

    private static bool RequiresOverview(string itemType) =>
        IsMovieOrSeries(itemType)
        || IsEpisode(itemType)
        || string.Equals(itemType, "Book", StringComparison.OrdinalIgnoreCase);

    private static bool RequiresPrimaryImage(string itemType) =>
        IsMovieOrSeries(itemType)
        || string.Equals(itemType, "Book", StringComparison.OrdinalIgnoreCase)
        || string.Equals(itemType, "MusicAlbum", StringComparison.OrdinalIgnoreCase)
        || string.Equals(itemType, "MusicArtist", StringComparison.OrdinalIgnoreCase)
        || string.Equals(itemType, "BoxSet", StringComparison.OrdinalIgnoreCase);

    private static void AddReason(
        PtvMetadataQualityRuleResult result,
        string code,
        string severity,
        int scoreImpact,
        string message,
        string? evidence = null) => result.Reasons.Add(new PtvMetadataQualityReason
        {
            Code = code,
            Severity = severity,
            ScoreImpact = scoreImpact,
            Message = message,
            Evidence = string.IsNullOrWhiteSpace(evidence) ? null : evidence.Length <= 160 ? evidence : evidence[..160]
        });

    [GeneratedRegex(@"(?<![\p{L}\p{N}])(?:2160p|1080p|720p|480p|4k|uhd|web[ ._-]?dl|webrip|bluray|blu[ ._-]?ray|remux|hdtv|x26[45]|h26[45]|hevc|av1|aac|dts(?:-hd)?|atmos|hdr10?\+?|dolby[ ._-]?vision|dv)(?![\p{L}\p{N}])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, 100)]
    private static partial Regex ReleaseTagRegex();

    [GeneratedRegex(@"[\[(](?:2160p|1080p|720p|4k|web[ ._-]?dl|webrip|bluray|remux|x26[45]|h26[45]|hevc|av1|hdr|dv)[^\])]*[\])]", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, 100)]
    private static partial Regex BracketedReleaseTagRegex();

    [GeneratedRegex(@"(?<!\d)(?<year>(?:18|19|20|21)\d{2})(?!\d)", RegexOptions.CultureInvariant, 100)]
    private static partial Regex YearRegex();

    [GeneratedRegex(@"[^\p{L}\p{N}]+", RegexOptions.CultureInvariant, 100)]
    private static partial Regex SeparatorRegex();

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant, 100)]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex(@"(?<![a-z0-9])s(?<season>\d{1,3})[ ._-]*e(?<episode>\d{1,4})(?:[ ._-]*(?:-|e)[ ._-]*?(?<end>\d{1,4}))?(?!\d)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, 100)]
    private static partial Regex EpisodeNumberRegex();

    [GeneratedRegex(@"\b(?:specials?|ova|oad|bonus)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, 100)]
    private static partial Regex SpecialLabelRegex();

    [GeneratedRegex(@"\.(?:mkv|mp4|avi|mov|m4v|ts|m2ts|webm|iso|mp3|flac|m4a|aac|epub|pdf|cbz|cbr)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, 100)]
    private static partial Regex MediaExtensionRegex();
}
