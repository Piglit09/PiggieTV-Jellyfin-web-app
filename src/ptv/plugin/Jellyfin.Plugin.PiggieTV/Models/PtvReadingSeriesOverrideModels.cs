namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Administrator Reading series overrides returned to the web client.
/// </summary>
public sealed class PtvReadingSeriesOverridesResponse
{
    /// <summary>Gets or sets the persistence schema version.</summary>
    public int SchemaVersion { get; set; } = 1;

    /// <summary>Gets or sets the normalized Reading route kind.</summary>
    public string RouteKind { get; set; } = string.Empty;

    /// <summary>Gets or sets overrides indexed by Jellyfin item id.</summary>
    public Dictionary<string, PtvReadingSeriesOverrideDto> Overrides { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>
/// Request body used to replace overrides for one Reading route kind.
/// </summary>
public sealed class PtvReadingSeriesOverridesUpdate
{
    /// <summary>Gets or sets overrides indexed by Jellyfin item id.</summary>
    public Dictionary<string, PtvReadingSeriesOverrideDto> Overrides { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>
/// One Reading series correction transferred between the plugin and web client.
/// </summary>
public sealed class PtvReadingSeriesOverrideDto
{
    /// <summary>Gets or sets the preferred cover item id.</summary>
    public string? CoverItemId { get; set; }

    /// <summary>Gets or sets a value indicating whether the item is excluded from inferred grouping.</summary>
    public bool? Excluded { get; set; }

    /// <summary>Gets or sets the corrected issue number.</summary>
    public double? IssueNumber { get; set; }

    /// <summary>Gets or sets an explicit media classification.</summary>
    public string? MediaKind { get; set; }

    /// <summary>Gets or sets a stable administrator series key.</summary>
    public string? SeriesKey { get; set; }

    /// <summary>Gets or sets the corrected series title.</summary>
    public string? SeriesTitle { get; set; }

    /// <summary>Gets or sets the display year.</summary>
    public int? SeriesYear { get; set; }

    /// <summary>Gets or sets the corrected volume number.</summary>
    public double? VolumeNumber { get; set; }
}
