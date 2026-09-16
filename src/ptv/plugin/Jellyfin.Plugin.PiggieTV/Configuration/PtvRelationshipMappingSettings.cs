using System.Text.Json.Serialization;
using System.Xml.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Configuration;

/// <summary>
/// Server-persisted authoritative cross-library relationship mappings.
/// </summary>
public sealed class PtvRelationshipMappingSettings
{
    private List<PtvRelationshipMappingDefinition> _mappings = [];

    /// <summary>Gets or sets the persistence schema version.</summary>
    public int SchemaVersion { get; set; } = 1;

    /// <summary>Gets or sets the deterministic XML-safe mapping representation.</summary>
    [JsonIgnore]
    [XmlArray("Mappings")]
    [XmlArrayItem("Mapping")]
    public PtvRelationshipMappingDefinition[] Mappings
    {
        get => Order(_mappings).Select(Clone).ToArray();
        set => _mappings = Order(value ?? []).Select(Clone).ToList();
    }

    /// <summary>Gets a defensive, deterministic snapshot of all mappings.</summary>
    /// <returns>Persisted mappings.</returns>
    public IReadOnlyList<PtvRelationshipMappingDefinition> GetMappings() =>
        Order(_mappings).Select(Clone).ToArray();

    /// <summary>Replaces all mappings with a defensive, deterministic snapshot.</summary>
    /// <param name="mappings">Mappings to persist.</param>
    public void SetMappings(IEnumerable<PtvRelationshipMappingDefinition>? mappings)
    {
        _mappings = Order(mappings ?? []).Select(Clone).ToList();
    }

    private static IOrderedEnumerable<PtvRelationshipMappingDefinition> Order(
        IEnumerable<PtvRelationshipMappingDefinition> mappings) => mappings
            .Where(mapping => mapping is not null)
            .OrderBy(mapping => mapping.SourceItemId, StringComparer.OrdinalIgnoreCase)
            .ThenBy(mapping => mapping.DisplayOrder)
            .ThenBy(mapping => mapping.Category, StringComparer.OrdinalIgnoreCase)
            .ThenBy(mapping => mapping.TargetItemId, StringComparer.OrdinalIgnoreCase)
            .ThenBy(mapping => mapping.MappingId, StringComparer.OrdinalIgnoreCase);

    private static PtvRelationshipMappingDefinition Clone(PtvRelationshipMappingDefinition mapping) => new()
    {
        Category = mapping.Category,
        Direction = mapping.Direction,
        DisplayOrder = mapping.DisplayOrder,
        Enabled = mapping.Enabled,
        MappingId = mapping.MappingId,
        SchemaVersion = mapping.SchemaVersion,
        SourceItemId = mapping.SourceItemId,
        TargetItemId = mapping.TargetItemId
    };
}

/// <summary>
/// One administrator-defined relationship between two stable Jellyfin item identities.
/// </summary>
public sealed class PtvRelationshipMappingDefinition
{
    /// <summary>Gets or sets the mapping identity.</summary>
    [XmlAttribute("Id")]
    public string MappingId { get; set; } = string.Empty;

    /// <summary>Gets or sets the source Jellyfin item identity.</summary>
    [XmlAttribute("SourceItemId")]
    public string SourceItemId { get; set; } = string.Empty;

    /// <summary>Gets or sets the target Jellyfin item identity.</summary>
    [XmlAttribute("TargetItemId")]
    public string TargetItemId { get; set; } = string.Empty;

    /// <summary>Gets or sets the allowlisted relationship category.</summary>
    [XmlAttribute("Category")]
    public string Category { get; set; } = string.Empty;

    /// <summary>Gets or sets the relationship direction.</summary>
    [XmlAttribute("Direction")]
    public string Direction { get; set; } = "source-to-target";

    /// <summary>Gets or sets deterministic display ordering.</summary>
    [XmlAttribute("DisplayOrder")]
    public int DisplayOrder { get; set; }

    /// <summary>Gets or sets whether the relationship is active.</summary>
    [XmlAttribute("Enabled")]
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets the mapping schema version.</summary>
    [XmlAttribute("SchemaVersion")]
    public int SchemaVersion { get; set; } = 1;
}
