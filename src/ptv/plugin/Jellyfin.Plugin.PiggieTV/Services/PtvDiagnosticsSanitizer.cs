using System.Text.Json;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.PiggieTV.Configuration;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Shared bounded sanitizer for in-memory reports and persistent diagnostics.</summary>
public static class PtvDiagnosticsSanitizer
{
    private const int MaximumJsonDepth = 10;
    private const int MaximumJsonNodes = 4000;
    private const int MaximumArrayItems = 500;
    private const int MaximumObjectProperties = 96;
    private const int MaximumStringLength = 1024;
    private static readonly string[] SensitivePropertyFragments = ["authorization", "cookie", "password", "secret", "token", "apikey", "api-key", "accesskey"];
    private static readonly Regex SensitiveStringPattern = new(@"(?:https?://|file://|[a-z]:\\|\\\\|(?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret|token)\s*[:=])", RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase, TimeSpan.FromMilliseconds(50));
    private static readonly Regex QueryValuePattern = new(@"[?&][a-z0-9_.~-]{1,64}=[^&#\s)""']*", RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase, TimeSpan.FromMilliseconds(50));

    /// <summary>Sanitizes a JSON value using the configured disk privacy policy.</summary>
    public static JsonElement Sanitize(JsonElement value, PtvDiagnosticsStorageSettings? settings = null)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            var remainingNodes = MaximumJsonNodes;
            Write(writer, value, null, 0, ref remainingNodes, settings ?? new PtvDiagnosticsStorageSettings());
        }

        using var document = JsonDocument.Parse(buffer.ToArray());
        return document.RootElement.Clone();
    }

    private static void Write(Utf8JsonWriter writer, JsonElement element, string? propertyName, int depth, ref int remainingNodes, PtvDiagnosticsStorageSettings settings)
    {
        if (remainingNodes-- <= 0 || depth > MaximumJsonDepth)
        {
            writer.WriteStringValue("[truncated]");
            return;
        }

        if (IsSensitiveProperty(propertyName) || (!settings.IncludeItemIds && IsIdentifierProperty(propertyName)))
        {
            writer.WriteStringValue("[redacted]");
            return;
        }

        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in element.EnumerateObject().Take(MaximumObjectProperties))
                {
                    var safeName = Truncate(property.Name, 64);
                    writer.WritePropertyName(safeName);
                    Write(writer, property.Value, safeName, depth + 1, ref remainingNodes, settings);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in element.EnumerateArray().Take(MaximumArrayItems)) Write(writer, item, propertyName, depth + 1, ref remainingNodes, settings);
                writer.WriteEndArray();
                break;
            case JsonValueKind.String:
                writer.WriteStringValue(SanitizeString(element.GetString(), settings));
                break;
            case JsonValueKind.Number:
                element.WriteTo(writer);
                break;
            case JsonValueKind.True:
                writer.WriteBooleanValue(true);
                break;
            case JsonValueKind.False:
                writer.WriteBooleanValue(false);
                break;
            default:
                writer.WriteNullValue();
                break;
        }
    }

    private static bool IsSensitiveProperty(string? name) => !string.IsNullOrWhiteSpace(name)
        && SensitivePropertyFragments.Any(fragment => name.Replace("_", string.Empty, StringComparison.Ordinal).Replace("-", string.Empty, StringComparison.Ordinal).Contains(fragment.Replace("-", string.Empty, StringComparison.Ordinal), StringComparison.OrdinalIgnoreCase));

    private static bool IsIdentifierProperty(string? name) => !string.IsNullOrWhiteSpace(name)
        && (name.Contains("itemid", StringComparison.OrdinalIgnoreCase) || name.Contains("userid", StringComparison.OrdinalIgnoreCase) || name.Contains("clientid", StringComparison.OrdinalIgnoreCase) || name.Contains("deviceid", StringComparison.OrdinalIgnoreCase));

    private static string SanitizeString(string? value, PtvDiagnosticsStorageSettings settings)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;
        var normalized = value.ReplaceLineEndings("\n");
        if (normalized.Contains("Bearer ", StringComparison.OrdinalIgnoreCase) || SensitiveStringPattern.IsMatch(normalized)) return "[redacted]";
        if (!settings.IncludeFilesystemPaths && (normalized.Contains("file://", StringComparison.OrdinalIgnoreCase) || Regex.IsMatch(normalized, @"(?:[a-z]:\\|\\\\)", RegexOptions.IgnoreCase))) return "[redacted]";
        if (!settings.IncludeRequestUrls && normalized.Contains("://", StringComparison.OrdinalIgnoreCase)) return "[redacted]";
        return Truncate(QueryValuePattern.Replace(normalized, "[query-omitted]"), MaximumStringLength);
    }

    private static string Truncate(string value, int maximumLength) => value.Length <= maximumLength ? value : value[..maximumLength];
}
