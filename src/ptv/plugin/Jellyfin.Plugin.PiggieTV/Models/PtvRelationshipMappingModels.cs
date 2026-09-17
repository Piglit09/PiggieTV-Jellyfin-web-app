using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Authenticated relationship lookup response for one source item.
/// </summary>
public sealed class PtvRelationshipMappingsResponse
{
    /// <summary>Gets or sets the response schema version.</summary>
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; } = 1;

    /// <summary>Gets or sets visible, enabled relationships in deterministic order.</summary>
    [JsonPropertyName("relationships")]
    public PtvRelationshipMappingDto[] Relationships { get; set; } = [];
}

/// <summary>
/// One visible authoritative relationship. It intentionally contains no media metadata.
/// </summary>
public sealed class PtvRelationshipMappingDto
{
    /// <summary>Gets or sets the stable mapping identity.</summary>
    [JsonPropertyName("mappingId")]
    public string MappingId { get; set; } = string.Empty;

    /// <summary>Gets or sets the destination Jellyfin item identity relative to the requested source.</summary>
    [JsonPropertyName("targetItemId")]
    public string TargetItemId { get; set; } = string.Empty;

    /// <summary>Gets or sets the allowlisted relationship category.</summary>
    [JsonPropertyName("category")]
    public string Category { get; set; } = string.Empty;

    /// <summary>Gets or sets the relationship direction.</summary>
    [JsonPropertyName("direction")]
    public string Direction { get; set; } = "source-to-target";

    /// <summary>Gets or sets deterministic display ordering.</summary>
    [JsonPropertyName("displayOrder")]
    public int DisplayOrder { get; set; }

    /// <summary>Gets or sets whether the relationship is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets the mapping schema version.</summary>
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; } = 1;
}

/// <summary>
/// Administrator request to create an authoritative relationship.
/// </summary>
public sealed class PtvRelationshipMappingCreateRequest
{
    /// <summary>Gets or sets the source Jellyfin item identity.</summary>
    [JsonPropertyName("sourceItemId")]
    public string? SourceItemId { get; set; }

    /// <summary>Gets or sets the target Jellyfin item identity.</summary>
    [JsonPropertyName("targetItemId")]
    public string? TargetItemId { get; set; }

    /// <summary>Gets or sets the allowlisted relationship category.</summary>
    [JsonPropertyName("category")]
    public string? Category { get; set; }

    /// <summary>Gets or sets optional relationship direction.</summary>
    [JsonPropertyName("direction")]
    public string? Direction { get; set; }

    /// <summary>Gets or sets optional deterministic display ordering.</summary>
    [JsonPropertyName("displayOrder")]
    public int? DisplayOrder { get; set; }

    /// <summary>Gets or sets optional enabled state.</summary>
    [JsonPropertyName("enabled")]
    public bool? Enabled { get; set; }
}

/// <summary>
/// Administrator request to update mutable relationship properties.
/// </summary>
public sealed class PtvRelationshipMappingUpdateRequest
{
    /// <summary>Gets or sets an updated allowlisted category.</summary>
    [JsonPropertyName("category")]
    public string? Category { get; set; }

    /// <summary>Gets or sets an updated relationship direction.</summary>
    [JsonPropertyName("direction")]
    public string? Direction { get; set; }

    /// <summary>Gets or sets updated deterministic display ordering.</summary>
    [JsonPropertyName("displayOrder")]
    public int? DisplayOrder { get; set; }

    /// <summary>Gets or sets updated enabled state.</summary>
    [JsonPropertyName("enabled")]
    public bool? Enabled { get; set; }
}
