using System.Security.Cryptography;
using System.Text;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Creates a privacy-preserving fingerprint from fields that affect metadata analysis.</summary>
public static class PtvMetadataQualityFingerprint
{
    /// <summary>Computes the current versioned scan fingerprint.</summary>
    public static string Create(PtvMetadataQualityAnalysisItem item)
        => Create(item, PtvMetadataQualityConstants.ScannerVersion, PtvMetadataQualityConstants.RuleVersion);

    /// <summary>Creates a fingerprint for an explicit semantic-version pair for compatibility tests.</summary>
    internal static string Create(
        PtvMetadataQualityAnalysisItem item,
        string scannerVersion,
        string ruleVersion)
    {
        ArgumentNullException.ThrowIfNull(item);

        var providerIds = string.Join(
            ';',
            item.ProviderIds
                .Where(pair => !string.IsNullOrWhiteSpace(pair.Key) && !string.IsNullOrWhiteSpace(pair.Value))
                .OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
                .Select(pair => $"{pair.Key.Trim().ToUpperInvariant()}={pair.Value.Trim()}"));

        var payload = string.Join(
            '\u001f',
            scannerVersion,
            ruleVersion,
            item.ItemId.ToString("N"),
            item.LibraryId?.ToString("N") ?? string.Empty,
            item.ItemType,
            item.Name,
            item.OriginalTitle ?? string.Empty,
            item.FileName ?? string.Empty,
            item.FolderName ?? string.Empty,
            item.ProductionYear?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty,
            item.RunTimeTicks?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty,
            item.ParentIndexNumber?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty,
            item.IndexNumber?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty,
            item.IndexNumberEnd?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty,
            item.SeriesName ?? string.Empty,
            item.SeriesTitle ?? string.Empty,
            item.SeriesTitleEvidence.ToString(),
            item.NormalizedIssueNumber ?? string.Empty,
            item.IssueNumberEvidence.ToString(),
            item.VolumeNumber ?? string.Empty,
            item.SeriesStartYear?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty,
            item.SeriesStartYearEvidence.ToString(),
            item.IssuePublicationYear?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty,
            item.IssuePublicationDate?.UtcTicks.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty,
            item.IssuePublicationEvidence.ToString(),
            item.Publisher ?? string.Empty,
            item.VolumeId ?? string.Empty,
            item.FolderCorroboratesSeriesTitle ? "1" : "0",
            item.FolderCorroboratesSeriesStartYear ? "1" : "0",
            item.ReadingMediaClass.ToString(),
            item.ReadingEditionKind.ToString(),
            item.ReadingEditionKindEvidence.ToString(),
            item.IsSpecial ? "1" : "0",
            item.HasPrimaryImage ? "1" : "0",
            item.HasBackdropImage ? "1" : "0",
            item.HasOverview ? "1" : "0",
            item.DateModified?.UtcTicks.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty,
            item.DateLastSaved?.UtcTicks.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty,
            providerIds);

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
    }
}
