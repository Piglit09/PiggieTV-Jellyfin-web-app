using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Diagnostic information for a Jellyfin item's stored image metadata and image endpoints.
/// </summary>
public sealed class PtvItemImageDiagnosticResponse
{
    /// <summary>
    /// Gets or sets a value indicating whether the diagnostic completed successfully.
    /// </summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    /// <summary>
    /// Gets or sets the Jellyfin item id.
    /// </summary>
    [JsonPropertyName("itemId")]
    public string ItemId { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the Jellyfin item name.
    /// </summary>
    [JsonPropertyName("itemName")]
    public string? ItemName { get; set; }

    /// <summary>
    /// Gets or sets the concrete Jellyfin item type.
    /// </summary>
    [JsonPropertyName("itemType")]
    public string? ItemType { get; set; }

    /// <summary>
    /// Gets or sets the Jellyfin media type.
    /// </summary>
    [JsonPropertyName("mediaType")]
    public string? MediaType { get; set; }

    /// <summary>
    /// Gets or sets the primary image tag currently recorded by Jellyfin.
    /// </summary>
    [JsonPropertyName("primaryImageTag")]
    public string? PrimaryImageTag { get; set; }

    /// <summary>
    /// Gets or sets the primary image file path currently recorded by Jellyfin.
    /// </summary>
    [JsonPropertyName("primaryImagePath")]
    public string? PrimaryImagePath { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the primary image path exists on disk.
    /// </summary>
    [JsonPropertyName("primaryImageFileExists")]
    public bool PrimaryImageFileExists { get; set; }

    /// <summary>
    /// Gets or sets the tagged primary image endpoint status.
    /// </summary>
    [JsonPropertyName("primaryImageEndpointStatus")]
    public int? PrimaryImageEndpointStatus { get; set; }

    /// <summary>
    /// Gets or sets per-image diagnostic entries.
    /// </summary>
    [JsonPropertyName("images")]
    public List<PtvItemImageDiagnosticEntry> Images { get; set; } = [];

    /// <summary>
    /// Gets or sets diagnostic warnings.
    /// </summary>
    [JsonPropertyName("warnings")]
    public List<string> Warnings { get; set; } = [];
}

/// <summary>
/// Diagnostic information for one stored Jellyfin image slot.
/// </summary>
public sealed class PtvItemImageDiagnosticEntry
{
    /// <summary>
    /// Gets or sets the Jellyfin image type.
    /// </summary>
    [JsonPropertyName("imageType")]
    public string ImageType { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the image index.
    /// </summary>
    [JsonPropertyName("imageIndex")]
    public int ImageIndex { get; set; }

    /// <summary>
    /// Gets or sets the stored image tag.
    /// </summary>
    [JsonPropertyName("imageTag")]
    public string? ImageTag { get; set; }

    /// <summary>
    /// Gets or sets the stored image file path.
    /// </summary>
    [JsonPropertyName("imagePath")]
    public string? ImagePath { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the stored image file exists.
    /// </summary>
    [JsonPropertyName("fileExists")]
    public bool FileExists { get; set; }

    /// <summary>
    /// Gets or sets the relative tagged Jellyfin image endpoint.
    /// </summary>
    [JsonPropertyName("taggedEndpoint")]
    public string? TaggedEndpoint { get; set; }

    /// <summary>
    /// Gets or sets the tagged Jellyfin image endpoint HTTP status.
    /// </summary>
    [JsonPropertyName("taggedEndpointStatus")]
    public int? TaggedEndpointStatus { get; set; }

    /// <summary>
    /// Gets or sets the relative untagged Jellyfin image endpoint.
    /// </summary>
    [JsonPropertyName("untaggedEndpoint")]
    public string? UntaggedEndpoint { get; set; }

    /// <summary>
    /// Gets or sets the untagged Jellyfin image endpoint HTTP status.
    /// </summary>
    [JsonPropertyName("untaggedEndpointStatus")]
    public int? UntaggedEndpointStatus { get; set; }

    /// <summary>
    /// Gets or sets the sanitized endpoint probe error, if any.
    /// </summary>
    [JsonPropertyName("probeError")]
    public string? ProbeError { get; set; }

    /// <summary>
    /// Gets a value indicating whether a tagged endpoint failed but the untagged endpoint worked.
    /// </summary>
    [JsonPropertyName("staleTagDetected")]
    public bool StaleTagDetected => TaggedEndpointStatus == 404 && UntaggedEndpointStatus is >= 200 and < 300;
}
