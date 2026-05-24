using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Shared PiggieTV featured-content cache document.
/// </summary>
public sealed class PtvFeaturedContentDocument
{
    /// <summary>
    /// Gets or sets the server cache document version.
    /// </summary>
    [JsonPropertyName("version")]
    public int? Version { get; set; }

    /// <summary>
    /// Gets or sets the compact featured-content cache entry produced by the web client.
    /// </summary>
    [JsonPropertyName("featuredContent")]
    public JsonNode? FeaturedContent { get; set; }

    /// <summary>
    /// Gets or sets the featured-content cache settings.
    /// </summary>
    [JsonPropertyName("featuredContentSettings")]
    public JsonNode? FeaturedContentSettings { get; set; }

    /// <summary>
    /// Gets or sets the last update timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("updatedAt")]
    public long UpdatedAt { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}
