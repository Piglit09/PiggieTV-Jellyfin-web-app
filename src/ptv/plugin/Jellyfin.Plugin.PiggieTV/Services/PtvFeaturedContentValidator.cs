using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Validation and normalization rules for the shared featured-content cache document.
/// </summary>
public static class PtvFeaturedContentValidator
{
    /// <summary>
    /// Current outer plugin cache document version.
    /// </summary>
    public const int DocumentVersion = 1;

    /// <summary>
    /// Current supported frontend featured-content cache payload version.
    /// </summary>
    public const int FeaturedCacheVersion = 6;

    /// <summary>
    /// Maximum serialized document size accepted from clients.
    /// </summary>
    public const int MaxDocumentBytes = 4 * 1024 * 1024;

    private const long MinTtlMs = 60 * 60 * 1000;
    private const long MaxTtlMs = 7 * 24 * 60 * 60 * 1000;
    private const long ClockSkewMs = 5 * 60 * 1000;
    private static readonly string[] UnsafePropertyNameFragments = ["path", "file", "filename"];

    /// <summary>
    /// Creates an empty, safe document.
    /// </summary>
    /// <returns>Empty featured-content cache document.</returns>
    public static PtvFeaturedContentDocument CreateEmptyDocument()
    {
        return new PtvFeaturedContentDocument
        {
            Version = DocumentVersion,
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
    }

    /// <summary>
    /// Normalizes a stored document for reads without trusting client-write metadata.
    /// </summary>
    /// <param name="document">Stored document.</param>
    /// <returns>Normalized document.</returns>
    public static PtvFeaturedContentDocument NormalizeStoredDocument(PtvFeaturedContentDocument? document)
    {
        if (document is null)
        {
            return CreateEmptyDocument();
        }

        document.Version = DocumentVersion;

        if (document.UpdatedAt <= 0)
        {
            document.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        return document;
    }

    /// <summary>
    /// Validates a document before saving it to the fixed plugin cache location.
    /// </summary>
    /// <param name="document">Incoming document.</param>
    /// <param name="jsonOptions">Serializer options used by the store.</param>
    /// <returns>Validated and normalized document.</returns>
    /// <exception cref="PtvFeaturedContentValidationException">Thrown when the document is invalid.</exception>
    public static PtvFeaturedContentDocument ValidateForSave(
        PtvFeaturedContentDocument? document,
        JsonSerializerOptions jsonOptions)
    {
        if (document is null)
        {
            throw Invalid("PTV_CACHE_NULL_DOCUMENT", "A featured-content cache document is required.");
        }

        if (document.Version is null)
        {
            throw Invalid("PTV_CACHE_MISSING_VERSION", "The featured-content document version is required.");
        }

        if (document.Version != DocumentVersion)
        {
            throw Invalid("PTV_CACHE_UNSUPPORTED_VERSION", "Unsupported featured-content document version.");
        }

        var featuredContent = document.FeaturedContent as JsonObject
            ?? throw Invalid("PTV_CACHE_MISSING_FEATURED_CONTENT", "A featured-content payload is required.");

        var cacheVersion = RequireInt(featuredContent, "version", "featuredContent.version");

        if (cacheVersion != FeaturedCacheVersion)
        {
            throw Invalid("PTV_CACHE_UNSUPPORTED_PAYLOAD_VERSION", "Unsupported featured-content payload version.");
        }

        var payload = featuredContent["payload"] as JsonObject
            ?? throw Invalid("PTV_CACHE_MISSING_PAYLOAD", "featuredContent.payload is required.");

        if (payload["heroItems"] is not JsonArray)
        {
            throw Invalid("PTV_CACHE_MISSING_HERO_ITEMS", "featuredContent.payload.heroItems must be an array.");
        }

        var sectionItems = payload["sectionItems"] as JsonObject
            ?? throw Invalid("PTV_CACHE_MISSING_SECTION_ITEMS", "featuredContent.payload.sectionItems must be an object.");

        foreach (var section in sectionItems)
        {
            if (section.Value is not JsonArray)
            {
                throw Invalid("PTV_CACHE_INVALID_SECTION_ITEMS", "Every featured-content section must contain an item array.");
            }
        }

        EnsureNoUnsafeClientValues(document.FeaturedContent);
        EnsureNoUnsafeClientValues(document.FeaturedContentSettings);

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var createdAt = NormalizeCreatedAt(RequireLong(featuredContent, "createdAt", "featuredContent.createdAt"), now);
        var expiresAt = Clamp(
            RequireLong(featuredContent, "expiresAt", "featuredContent.expiresAt"),
            createdAt + MinTtlMs,
            createdAt + MaxTtlMs);

        featuredContent["createdAt"] = createdAt;
        featuredContent["expiresAt"] = expiresAt;
        document.FeaturedContentSettings = NormalizeSettings(document.FeaturedContentSettings);
        document.UpdatedAt = now;
        document.Version = DocumentVersion;

        EnsureSafeSize(document, jsonOptions);

        return document;
    }

    private static JsonNode? NormalizeSettings(JsonNode? settingsNode)
    {
        if (settingsNode is null)
        {
            return null;
        }

        if (settingsNode is not JsonObject settings)
        {
            throw Invalid("PTV_CACHE_INVALID_SETTINGS", "featuredContentSettings must be an object.");
        }

        if (TryGetLong(settings["ttlMs"], out var ttlMs))
        {
            settings["ttlMs"] = Clamp(ttlMs, MinTtlMs, MaxTtlMs);
        }
        else
        {
            settings.Remove("ttlMs");
        }

        return settings;
    }

    private static long NormalizeCreatedAt(long createdAt, long now)
    {
        if (createdAt <= 0 || createdAt > now + ClockSkewMs || createdAt < now - MaxTtlMs)
        {
            return now;
        }

        return createdAt;
    }

    private static int RequireInt(JsonObject source, string propertyName, string displayName)
    {
        var value = RequireLong(source, propertyName, displayName);

        if (value is < int.MinValue or > int.MaxValue)
        {
            throw Invalid("PTV_CACHE_INVALID_NUMBER", $"{displayName} must fit in a 32-bit integer.");
        }

        return (int)value;
    }

    private static long RequireLong(JsonObject source, string propertyName, string displayName)
    {
        if (source.TryGetPropertyValue(propertyName, out var value) && TryGetLong(value, out var result))
        {
            return result;
        }

        throw Invalid("PTV_CACHE_INVALID_TIMESTAMP", $"{displayName} is required.");
    }

    private static bool TryGetLong(JsonNode? node, out long result)
    {
        result = 0;

        if (node is not JsonValue value)
        {
            return false;
        }

        if (value.TryGetValue<long>(out var longValue))
        {
            result = longValue;
            return true;
        }

        if (value.TryGetValue<int>(out var intValue))
        {
            result = intValue;
            return true;
        }

        if (value.TryGetValue<double>(out var doubleValue) && double.IsFinite(doubleValue))
        {
            result = Convert.ToInt64(Math.Round(doubleValue, MidpointRounding.AwayFromZero));
            return true;
        }

        return false;
    }

    private static long Clamp(long value, long minimum, long maximum)
    {
        return Math.Min(maximum, Math.Max(minimum, value));
    }

    private static void EnsureSafeSize(PtvFeaturedContentDocument document, JsonSerializerOptions jsonOptions)
    {
        var serialized = JsonSerializer.SerializeToUtf8Bytes(document, jsonOptions);

        if (serialized.Length > MaxDocumentBytes)
        {
            throw Invalid("PTV_CACHE_PAYLOAD_TOO_LARGE", "The featured-content document exceeds the safe payload size limit.");
        }
    }

    private static PtvFeaturedContentValidationException Invalid(string code, string message)
    {
        return new PtvFeaturedContentValidationException(code, message);
    }

    private static void EnsureNoUnsafeClientValues(JsonNode? node, string path = "$")
    {
        switch (node)
        {
            case JsonObject jsonObject:
                foreach (var property in jsonObject)
                {
                    if (IsUnsafePropertyName(property.Key))
                    {
                        throw Invalid("PTV_CACHE_UNSAFE_CLIENT_FIELD", $"Client-provided file/path fields are not allowed: {path}.{property.Key}.");
                    }

                    EnsureNoUnsafeClientValues(property.Value, $"{path}.{property.Key}");
                }

                break;
            case JsonArray jsonArray:
                for (var index = 0; index < jsonArray.Count; index++)
                {
                    EnsureNoUnsafeClientValues(jsonArray[index], $"{path}[{index}]");
                }

                break;
            case JsonValue jsonValue when jsonValue.TryGetValue<string>(out var stringValue):
                if (stringValue.IndexOf('\0') >= 0)
                {
                    throw Invalid("PTV_CACHE_UNSAFE_STRING", $"Unsafe string value is not allowed at {path}.");
                }

                break;
        }
    }

    private static bool IsUnsafePropertyName(string propertyName)
    {
        return UnsafePropertyNameFragments.Any(
            fragment => propertyName.Contains(fragment, StringComparison.OrdinalIgnoreCase));
    }
}
