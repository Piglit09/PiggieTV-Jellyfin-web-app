using System.Net;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Bounds and sanitizes provider-controlled Reading metadata.</summary>
internal static partial class PtvReadingMetadataSafety
{
    public static string? PlainText(string? value, int maximumLength = 16_384)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var decoded = WebUtility.HtmlDecode(value);
        var withoutTags = HtmlTagRegex().Replace(decoded, " ");
        var normalized = WhitespaceRegex().Replace(withoutTags, " ").Trim();
        return normalized.Length <= maximumLength ? normalized : normalized[..maximumLength];
    }

    public static string? Text(string? value, int maximumLength = 512)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = WhitespaceRegex().Replace(value, " ").Trim();
        return normalized.Length <= maximumLength ? normalized : normalized[..maximumLength];
    }

    public static string? HttpUrl(string? value, params string[] allowedHosts)
    {
        return PtvReadingUrlSafety.HttpUrl(value, PtvReadingMetadataLimits.MaximumUrlLength, allowedHosts);
    }

    public static List<string> Strings(IEnumerable<string?> values, int maximum = 64, int maximumLength = 512) =>
        values
            .Select(value => Text(value, maximumLength))
            .Where(value => value is not null)
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(maximum)
            .ToList();

    [GeneratedRegex("<[^>]*>", RegexOptions.Compiled)]
    private static partial Regex HtmlTagRegex();

    [GeneratedRegex("\\s+", RegexOptions.Compiled)]
    private static partial Regex WhitespaceRegex();
}
