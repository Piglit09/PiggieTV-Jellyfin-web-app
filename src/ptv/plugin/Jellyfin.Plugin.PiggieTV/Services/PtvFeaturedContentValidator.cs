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
    public const int FeaturedCacheVersion = 7;

    /// <summary>
    /// Maximum serialized document size accepted from clients.
    /// </summary>
    public const int MaxDocumentBytes = 4 * 1024 * 1024;

    private const long MinTtlMs = 60 * 60 * 1000;
    private const long MaxTtlMs = 7 * 24 * 60 * 60 * 1000;
    private const long ClockSkewMs = 5 * 60 * 1000;
    private static readonly string[] UnsafePropertyNames = [
        "file",
        "filename",
        "filepath",
        "localpath",
        "originalpath",
        "path",
        "sourcepath"
    ];

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
    /// Gets the currently configured maximum document size.
    /// </summary>
    /// <returns>Maximum document size in bytes.</returns>
    public static int GetMaxDocumentBytes()
    {
        var configuredValue = Plugin.Instance?.Configuration?.PerformanceSettings?.MaxCachePayloadBytes ?? MaxDocumentBytes;

        return Math.Clamp(
            configuredValue,
            PtvPluginSettingsNormalizer.MinMaxCachePayloadBytes,
            PtvPluginSettingsNormalizer.MaxMaxCachePayloadBytes);
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

        var semanticStatus = GetSemanticStatus(payload);

        if (!semanticStatus.UsableForPersistence)
        {
            throw Invalid(
                "PTV_CACHE_INCOMPLETE_PAYLOAD",
                $"Featured-content payload is {semanticStatus.Classification}; heroCount={semanticStatus.HeroCount}, itemCount={semanticStatus.ItemCount}, sectionCount={semanticStatus.SectionCount}.");
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

        semanticStatus = GetSemanticStatus(payload);

        if (!semanticStatus.UsableForPersistence)
        {
            throw Invalid("PTV_CACHE_TRIMMED_TO_INCOMPLETE", "Featured-content payload became incomplete while enforcing the cache size limit.");
        }

        return document;
    }

    /// <summary>Classifies whether a generated payload contains semantic Home content.</summary>
    /// <param name="payload">Featured payload object.</param>
    /// <returns>Count-only semantic status.</returns>
    public static PtvFeaturedContentSemanticStatus GetSemanticStatus(JsonObject payload)
    {
        var heroCount = payload["heroItems"] is JsonArray heroItems ? heroItems.Count : 0;
        var sectionItems = payload["sectionItems"] as JsonObject;
        var sectionDefinitions = payload["sections"] as JsonArray;
        var itemCount = 0;
        var populatedSectionCount = 0;

        if (sectionItems is not null)
        {
            foreach (var section in sectionItems)
            {
                var count = section.Value is JsonArray items ? items.Count : 0;
                itemCount += count;
                if (count > 0) populatedSectionCount++;
            }
        }

        var sectionCount = Math.Max(sectionItems?.Count ?? 0, sectionDefinitions?.Count ?? 0);
        var generationState = GetString(payload["generationState"]);
        var explicitlyEmpty = GetBool(payload["emptyLibraryConfirmed"])
            || string.Equals(generationState, "intentional-empty", StringComparison.OrdinalIgnoreCase)
            || string.Equals(generationState, "valid-empty-library", StringComparison.OrdinalIgnoreCase);
        var degraded = IsDegradedGenerationState(generationState);
        var classification = heroCount + itemCount > 0
            ? degraded ? "partial" : "complete"
            : explicitlyEmpty ? "intentional-empty"
            : sectionCount > 0 ? "configuration-only"
            : degraded ? "degraded"
            : "empty";

        return new PtvFeaturedContentSemanticStatus(
            classification,
            heroCount,
            itemCount,
            sectionCount,
            populatedSectionCount,
            classification is "complete" or "intentional-empty");
    }

    private static bool IsDegradedGenerationState(string? value)
    {
        return value?.Trim().ToLowerInvariant() is
            "authentication-lost" or "cancelled" or "canceled" or "degraded" or "incomplete" or
            "malformed" or "partial" or "timed-out" or "timeout";
    }

    private static string? GetString(JsonNode? node)
    {
        return node is JsonValue value && value.TryGetValue<string>(out var result) ? result : null;
    }

    private static bool GetBool(JsonNode? node)
    {
        return node is JsonValue value && value.TryGetValue<bool>(out var result) && result;
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
        var maxDocumentBytes = GetMaxDocumentBytes();
        var serialized = JsonSerializer.SerializeToUtf8Bytes(document, jsonOptions);

        if (serialized.Length <= maxDocumentBytes)
        {
            return;
        }

        var originalBytes = serialized.Length;

        TrimDocumentToSafeSize(document, jsonOptions, maxDocumentBytes);
        serialized = JsonSerializer.SerializeToUtf8Bytes(document, jsonOptions);

        if (serialized.Length > maxDocumentBytes)
        {
            throw Invalid(
                "PTV_CACHE_PAYLOAD_TOO_LARGE",
                $"Payload exceeded maxCachePayloadBytes: {originalBytes} > {maxDocumentBytes}; trimmed to {serialized.Length} bytes but still could not fit.");
        }
    }

    private static void TrimDocumentToSafeSize(
        PtvFeaturedContentDocument document,
        JsonSerializerOptions jsonOptions,
        int maxDocumentBytes)
    {
        if (document.FeaturedContent is not JsonObject featuredContent
            || featuredContent["payload"] is not JsonObject payload)
        {
            throw Invalid("PTV_CACHE_PAYLOAD_TOO_LARGE", "Payload exceeded maxCachePayloadBytes and could not be trimmed because featuredContent.payload is missing.");
        }

        var originalBytes = JsonSerializer.SerializeToUtf8Bytes(document, jsonOptions).Length;

        MarkPayloadTrimmed(document, originalBytes, originalBytes);
        RemoveVerbosePayloadFields(payload);

        while (JsonSerializer.SerializeToUtf8Bytes(document, jsonOptions).Length > maxDocumentBytes
            && TrimLargestSectionItem(payload))
        {
        }

        while (JsonSerializer.SerializeToUtf8Bytes(document, jsonOptions).Length > maxDocumentBytes
            && TrimHeroItem(payload))
        {
        }

        while (JsonSerializer.SerializeToUtf8Bytes(document, jsonOptions).Length > maxDocumentBytes
            && RemoveLargestSection(payload))
        {
        }

        MarkPayloadTrimmed(document, originalBytes, JsonSerializer.SerializeToUtf8Bytes(document, jsonOptions).Length);
    }

    private static void MarkPayloadTrimmed(PtvFeaturedContentDocument document, int originalBytes, int storedBytes)
    {
        if (document.FeaturedContent is JsonObject featuredContent)
        {
            featuredContent["payloadTrimmed"] = true;
            featuredContent["payloadOriginalBytes"] = originalBytes;
            featuredContent["payloadStoredBytes"] = storedBytes;
        }

        var settings = document.FeaturedContentSettings as JsonObject ?? new JsonObject();
        settings["payloadTrimmed"] = true;
        settings["payloadOriginalBytes"] = originalBytes;
        settings["payloadStoredBytes"] = storedBytes;
        document.FeaturedContentSettings = settings;
    }

    private static void RemoveVerbosePayloadFields(JsonObject payload)
    {
        if (payload["heroItems"] is JsonArray heroItems)
        {
            RemoveVerboseItemFields(heroItems);
        }

        if (payload["sectionItems"] is JsonObject sectionItems)
        {
            foreach (var section in sectionItems.ToArray())
            {
                if (section.Value is JsonArray items)
                {
                    RemoveVerboseItemFields(items);
                }
            }
        }
    }

    private static void RemoveVerboseItemFields(JsonArray items)
    {
        foreach (var item in items)
        {
            if (item is not JsonObject itemObject)
            {
                continue;
            }

            itemObject.Remove("Overview");
            itemObject.Remove("ProviderIds");
        }
    }

    private static bool TrimLargestSectionItem(JsonObject payload)
    {
        if (payload["sectionItems"] is not JsonObject sectionItems)
        {
            return false;
        }

        var largestSection = sectionItems
            .Select(section => new
            {
                section.Key,
                Items = section.Value as JsonArray
            })
            .Where(section => section.Items is { Count: > 1 })
            .OrderByDescending(section => section.Items?.Count ?? 0)
            .FirstOrDefault();

        if (largestSection?.Items is null)
        {
            return false;
        }

        largestSection.Items.RemoveAt(largestSection.Items.Count - 1);
        return true;
    }

    private static bool TrimHeroItem(JsonObject payload)
    {
        if (payload["heroItems"] is not JsonArray heroItems || heroItems.Count <= 1)
        {
            return false;
        }

        heroItems.RemoveAt(heroItems.Count - 1);
        return true;
    }

    private static bool RemoveLargestSection(JsonObject payload)
    {
        if (payload["sectionItems"] is not JsonObject sectionItems || sectionItems.Count == 0)
        {
            return false;
        }

        var largestSection = sectionItems
            .Select(section => new
            {
                section.Key,
                ItemCount = section.Value is JsonArray items ? items.Count : 0
            })
            .OrderByDescending(section => section.ItemCount)
            .FirstOrDefault();

        if (largestSection is null)
        {
            return false;
        }

        sectionItems.Remove(largestSection.Key);
        return true;
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
        var normalizedName = new string(propertyName
            .Where(char.IsLetterOrDigit)
            .Select(char.ToLowerInvariant)
            .ToArray());

        return UnsafePropertyNames.Contains(normalizedName, StringComparer.Ordinal)
            || normalizedName.EndsWith("path", StringComparison.Ordinal)
            || normalizedName.EndsWith("filename", StringComparison.Ordinal);
    }
}

/// <summary>Count-only semantic classification for a featured-content payload.</summary>
public sealed record PtvFeaturedContentSemanticStatus(
    string Classification,
    int HeroCount,
    int ItemCount,
    int SectionCount,
    int PopulatedSectionCount,
    bool UsableForPersistence);
