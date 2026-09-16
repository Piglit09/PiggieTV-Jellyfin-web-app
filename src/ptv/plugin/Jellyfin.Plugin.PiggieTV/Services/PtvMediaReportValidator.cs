using System.Text.Json;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Strict normalization for the privacy-minimized media-report contract.</summary>
internal static class PtvMediaReportValidator
{
    internal const int MaximumRequestBytes = 16 * 1024;
    internal const int MaximumDetailsLength = 1024;
    internal const long MaximumPlaybackPositionMs = 31L * 24 * 60 * 60 * 1000;

    private const int MaximumIdentifierLength = 128;
    private const int MaximumLabelLength = 64;
    private static readonly Regex BareFilenamePattern = new(
        @"(?<![\w.-])[\w][\w .-]{0,127}\.[A-Za-z][A-Za-z0-9]{0,9}(?![\w.-])",
        RegexOptions.Compiled | RegexOptions.CultureInvariant,
        TimeSpan.FromMilliseconds(50));
    private static readonly Regex UnixAbsolutePathPattern = new(
        @"(?<![A-Za-z0-9:])/(?:[^\s/]+/)*[^\s/]+",
        RegexOptions.Compiled | RegexOptions.CultureInvariant,
        TimeSpan.FromMilliseconds(50));

    private static readonly HashSet<string> AllowedReasons = new(StringComparer.Ordinal)
    {
        "audio-language",
        "custom",
        "playback",
        "sound-sync",
        "subtitle-sync",
        "wrong-movie",
        "wrong-subtitles"
    };

    private static readonly HashSet<string> AllowedSources = new(StringComparer.Ordinal)
    {
        "native-home",
        "playback"
    };

    /// <summary>Validates and normalizes one client request without retaining unknown fields.</summary>
    public static bool TryNormalize(
        PtvMediaReportRequest? request,
        out Guid itemId,
        out PtvMediaReportRecord normalized,
        out string errorCode,
        out string errorMessage)
    {
        itemId = Guid.Empty;
        normalized = new PtvMediaReportRecord();
        errorCode = "PTV_MEDIA_REPORT_INVALID";
        errorMessage = "A valid schema-v1 media report is required.";

        if (request is null || request.SchemaVersion != 1)
        {
            return false;
        }

        if (!Guid.TryParse(request.ItemId?.Trim(), out itemId) || itemId == Guid.Empty)
        {
            errorCode = "PTV_MEDIA_REPORT_ITEM_INVALID";
            errorMessage = "itemId must be a valid Jellyfin item identifier.";
            return false;
        }

        var source = request.Source?.Trim().ToLowerInvariant();
        if (source is null || !AllowedSources.Contains(source))
        {
            errorCode = "PTV_MEDIA_REPORT_SOURCE_INVALID";
            errorMessage = "source is not supported by the media-report contract.";
            return false;
        }

        var reason = request.Reason?.Trim().ToLowerInvariant();
        if (reason is null || !AllowedReasons.Contains(reason))
        {
            errorCode = "PTV_MEDIA_REPORT_REASON_INVALID";
            errorMessage = "reason is not supported by the media-report contract.";
            return false;
        }

        if (!TryNormalizeOptionalLabel(request.ItemType, MaximumLabelLength, out var itemType)
            || !TryNormalizeOptionalIdentifier(request.MediaSourceId, out var mediaSourceId)
            || !TryNormalizeOptionalLabel(request.PlayMethod, MaximumLabelLength, out var playMethod))
        {
            errorCode = "PTV_MEDIA_REPORT_FIELD_INVALID";
            errorMessage = "An optional media-report field is malformed or too long.";
            return false;
        }

        if (request.PlaybackPositionMs is < 0 or > MaximumPlaybackPositionMs)
        {
            errorCode = "PTV_MEDIA_REPORT_POSITION_INVALID";
            errorMessage = "playbackPositionMs is outside the supported range.";
            return false;
        }

        var details = request.Details?.Trim();
        if (details?.Length > MaximumDetailsLength)
        {
            errorCode = "PTV_MEDIA_REPORT_DETAILS_TOO_LONG";
            errorMessage = $"details is limited to {MaximumDetailsLength} characters.";
            return false;
        }

        if (reason == "custom" && string.IsNullOrWhiteSpace(details))
        {
            errorCode = "PTV_MEDIA_REPORT_DETAILS_REQUIRED";
            errorMessage = "details is required when reason is custom.";
            return false;
        }

        normalized = new PtvMediaReportRecord
        {
            Details = SanitizeDetails(details),
            ItemId = itemId.ToString("N"),
            ItemType = itemType,
            MediaSourceId = mediaSourceId,
            PlaybackPositionMs = request.PlaybackPositionMs,
            PlayMethod = playMethod,
            Reason = reason,
            Source = source
        };
        return true;
    }

    /// <summary>Verifies that a persisted record still conforms exactly to the normalized contract.</summary>
    internal static bool IsNormalizedRecord(PtvMediaReportRecord report)
    {
        var request = new PtvMediaReportRequest
        {
            Details = report.Details,
            ItemId = report.ItemId,
            ItemType = report.ItemType,
            MediaSourceId = report.MediaSourceId,
            PlaybackPositionMs = report.PlaybackPositionMs,
            PlayMethod = report.PlayMethod,
            Reason = report.Reason,
            SchemaVersion = report.SchemaVersion,
            Source = report.Source
        };
        if (!TryNormalize(request, out _, out var normalized, out _, out _))
        {
            return false;
        }

        return string.Equals(report.Details, normalized.Details, StringComparison.Ordinal)
            && string.Equals(report.ItemId, normalized.ItemId, StringComparison.Ordinal)
            && string.Equals(report.ItemType, normalized.ItemType, StringComparison.Ordinal)
            && string.Equals(report.MediaSourceId, normalized.MediaSourceId, StringComparison.Ordinal)
            && report.PlaybackPositionMs == normalized.PlaybackPositionMs
            && string.Equals(report.PlayMethod, normalized.PlayMethod, StringComparison.Ordinal)
            && string.Equals(report.Reason, normalized.Reason, StringComparison.Ordinal)
            && string.Equals(report.Source, normalized.Source, StringComparison.Ordinal);
    }

    private static bool TryNormalizeOptionalIdentifier(string? value, out string? normalized)
    {
        normalized = value?.Trim();
        if (string.IsNullOrEmpty(normalized))
        {
            normalized = null;
            return true;
        }

        if (normalized.Length > MaximumIdentifierLength
            || normalized.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not '-' and not '_' and not '.' and not ':'))
        {
            return false;
        }

        normalized = SanitizeString(normalized);
        if (string.Equals(normalized, "[redacted]", StringComparison.Ordinal))
        {
            normalized = null;
        }

        return true;
    }

    private static bool TryNormalizeOptionalLabel(string? value, int maximumLength, out string? normalized)
    {
        normalized = value?.Trim();
        if (string.IsNullOrEmpty(normalized))
        {
            normalized = null;
            return true;
        }

        if (normalized.Length > maximumLength || normalized.Any(char.IsControl))
        {
            return false;
        }

        normalized = SanitizeString(normalized);
        return true;
    }

    private static string? SanitizeDetails(string? details)
    {
        if (string.IsNullOrWhiteSpace(details))
        {
            return null;
        }

        return SanitizeString(details);
    }

    private static string? SanitizeString(string value)
    {
        if (UnixAbsolutePathPattern.IsMatch(value) || BareFilenamePattern.IsMatch(value))
        {
            return "[redacted]";
        }

        var raw = JsonSerializer.SerializeToElement(new { value });
        return PtvDiagnosticsSanitizer.Sanitize(raw).GetProperty("value").GetString();
    }
}
