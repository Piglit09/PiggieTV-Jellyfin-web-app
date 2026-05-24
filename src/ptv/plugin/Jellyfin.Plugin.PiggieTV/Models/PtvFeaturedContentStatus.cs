using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Summary of the stored featured-content cache.
/// </summary>
public sealed class PtvFeaturedContentStatus
{
    /// <summary>
    /// Gets or sets a value indicating whether a featured cache payload exists.
    /// </summary>
    [JsonPropertyName("hasPayload")]
    public bool HasPayload { get; set; }

    /// <summary>
    /// Gets or sets the featured cache version.
    /// </summary>
    [JsonPropertyName("cacheVersion")]
    public int CacheVersion { get; set; }

    /// <summary>
    /// Gets or sets the number of cached hero items.
    /// </summary>
    [JsonPropertyName("heroCount")]
    public int HeroCount { get; set; }

    /// <summary>
    /// Gets or sets the number of cached row sections.
    /// </summary>
    [JsonPropertyName("sectionCount")]
    public int SectionCount { get; set; }

    /// <summary>
    /// Gets or sets the number of cached row items.
    /// </summary>
    [JsonPropertyName("itemCount")]
    public int ItemCount { get; set; }

    /// <summary>
    /// Gets or sets the cache creation timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("createdAt")]
    public long? CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the cache expiry timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("expiresAt")]
    public long? ExpiresAt { get; set; }

    /// <summary>
    /// Gets or sets the document update timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("updatedAt")]
    public long UpdatedAt { get; set; }

    /// <summary>
    /// Creates a status object from a stored document.
    /// </summary>
    /// <param name="document">Featured-content document.</param>
    /// <returns>Featured-content status.</returns>
    public static PtvFeaturedContentStatus FromDocument(PtvFeaturedContentDocument document)
    {
        var featuredContent = document.FeaturedContent as JsonObject;
        var payload = featuredContent?["payload"] as JsonObject;
        var heroItems = payload?["heroItems"] as JsonArray;
        var sectionItems = payload?["sectionItems"] as JsonObject;
        var itemCount = 0;

        if (sectionItems is not null)
        {
            foreach (var section in sectionItems)
            {
                itemCount += section.Value is JsonArray items ? items.Count : 0;
            }
        }

        return new PtvFeaturedContentStatus
        {
            CacheVersion = GetInt(featuredContent, "version"),
            CreatedAt = GetLong(featuredContent, "createdAt"),
            ExpiresAt = GetLong(featuredContent, "expiresAt"),
            HasPayload = payload is not null,
            HeroCount = heroItems?.Count ?? 0,
            ItemCount = itemCount,
            SectionCount = sectionItems?.Count ?? 0,
            UpdatedAt = document.UpdatedAt
        };
    }

    private static int GetInt(JsonObject? source, string propertyName)
    {
        return source is not null
            && source.TryGetPropertyValue(propertyName, out var value)
            && value is JsonValue jsonValue
            && jsonValue.TryGetValue<int>(out var result)
            ? result
            : 0;
    }

    private static long? GetLong(JsonObject? source, string propertyName)
    {
        return source is not null
            && source.TryGetPropertyValue(propertyName, out var value)
            && value is JsonValue jsonValue
            && jsonValue.TryGetValue<long>(out var result)
            ? result
            : null;
    }
}
