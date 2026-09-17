using System.Text.Json.Serialization;
using System.Xml.Serialization;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.PiggieTV.Configuration;

/// <summary>
/// PiggieTV plugin configuration.
/// </summary>
public class PiggieTVPluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets feature toggle settings.
    /// </summary>
    public FeatureSettings FeatureSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets hero settings.
    /// </summary>
    public HeroSettings HeroSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets home-row settings.
    /// </summary>
    public RowSettings RowSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets versioned row-builder settings.
    /// </summary>
    public RowBuilderSettings Rows { get; set; } = RowBuilderSettings.CreateDefault();

    /// <summary>
    /// Gets or sets persisted generated recommendation rows.
    /// </summary>
    public RecommendationRowSettings Recommendations { get; set; } = RecommendationRowSettings.CreateDefault();

    /// <summary>
    /// Gets or sets featured cache settings.
    /// </summary>
    public CacheSettings CacheSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets performance settings.
    /// </summary>
    public PerformanceSettings PerformanceSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets metadata provider settings.
    /// </summary>
    public TmdbSettings TmdbSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets music metadata provider settings.
    /// </summary>
    public MusicMetadataSettings MusicMetadataSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets reading metadata provider settings.
    /// </summary>
    public GoogleBooksSettings GoogleBooksSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets administrator Reading series corrections shared by every client.
    /// </summary>
    public ReadingSeriesOverrideSettings ReadingSeriesOverrides { get; set; } = new();

    /// <summary>
    /// Gets or sets administrator-defined authoritative cross-library relationships.
    /// </summary>
    public PtvRelationshipMappingSettings RelationshipMappings { get; set; } = new();

    /// <summary>
    /// Gets or sets Jellyseerr request integration settings.
    /// </summary>
    public SeerrSettings SeerrSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets native PiggieTV signup settings.
    /// </summary>
    public SignupSettings SignupSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets *Arr automation integration settings.
    /// </summary>
    public ArrSettings ArrSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets download provider integration settings.
    /// </summary>
    public DownloadSettings DownloadSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets tag-based row/filter settings.
    /// </summary>
    public TagSettings TagSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets random discovery settings.
    /// </summary>
    public RandomSettings RandomSettings { get; set; } = new();

    /// <summary>Gets or sets bounded persistent diagnostics storage settings.</summary>
    public PtvDiagnosticsStorageSettings DiagnosticsStorageSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets a legacy TMDb enable flag from older plugin builds.
    /// </summary>
    public bool EnableTmdbMetadata { get; set; } = true;

    /// <summary>
    /// Gets or sets a legacy TMDb API read access token from older plugin builds.
    /// </summary>
    public string? TmdbReadAccessToken { get; set; }

    /// <summary>
    /// Gets or sets a legacy TMDb v3 API key from older plugin builds.
    /// </summary>
    public string? TmdbApiKey { get; set; }

    /// <summary>
    /// Gets or sets a legacy maximum number of Jellyfin items enriched from TMDb during a single refresh.
    /// </summary>
    public int TmdbMaxEnrichmentItems { get; set; } = 280;
}

/// <summary>
/// Jellyfin plugin configuration type.
/// </summary>
public sealed class PluginConfiguration : PiggieTVPluginConfiguration
{
}

/// <summary>
/// Server-persisted Reading series corrections grouped by Reading route kind.
/// </summary>
public sealed class ReadingSeriesOverrideSettings
{
    private readonly Dictionary<string, Dictionary<string, ReadingSeriesOverrideDefinition>> _routes =
        new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Gets or sets the persistence schema version.</summary>
    public int SchemaVersion { get; set; } = 1;

    /// <summary>Gets or sets the deterministic XML-safe representation persisted by Jellyfin.</summary>
    [JsonIgnore]
    [XmlArray("Routes")]
    [XmlArrayItem("Route")]
    public ReadingSeriesOverrideRouteEntry[] Routes
    {
        get => _routes
            .OrderBy(entry => entry.Key, StringComparer.OrdinalIgnoreCase)
            .Select(entry => new ReadingSeriesOverrideRouteEntry
            {
                RouteKind = entry.Key,
                Overrides = entry.Value
                    .OrderBy(item => item.Key, StringComparer.OrdinalIgnoreCase)
                    .Select(item => new ReadingSeriesOverrideItemEntry
                    {
                        ItemId = item.Key,
                        Value = item.Value
                    })
                    .ToArray()
            })
            .ToArray();
        set
        {
            _routes.Clear();

            foreach (var route in value ?? [])
            {
                var routeKind = NormalizeKey(route.RouteKind);

                if (routeKind is null)
                {
                    continue;
                }

                var items = new Dictionary<string, ReadingSeriesOverrideDefinition>(StringComparer.OrdinalIgnoreCase);

                foreach (var item in route.Overrides ?? [])
                {
                    var itemId = NormalizeKey(item.ItemId);

                    if (itemId is not null && item.Value is not null)
                    {
                        items[itemId] = item.Value;
                    }
                }

                _routes[routeKind] = items;
            }
        }
    }

    /// <summary>Gets a defensive snapshot of the overrides for one Reading route.</summary>
    /// <param name="routeKind">Reading route kind.</param>
    /// <returns>Overrides indexed by Jellyfin item id.</returns>
    public IReadOnlyDictionary<string, ReadingSeriesOverrideDefinition> GetRoute(string? routeKind)
    {
        var key = NormalizeKey(routeKind);

        if (key is null || !_routes.TryGetValue(key, out var items))
        {
            return new Dictionary<string, ReadingSeriesOverrideDefinition>(StringComparer.OrdinalIgnoreCase);
        }

        return new Dictionary<string, ReadingSeriesOverrideDefinition>(items, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Replaces the overrides for one Reading route.</summary>
    /// <param name="routeKind">Reading route kind.</param>
    /// <param name="overrides">Overrides indexed by Jellyfin item id.</param>
    public void SetRoute(
        string? routeKind,
        IReadOnlyDictionary<string, ReadingSeriesOverrideDefinition>? overrides)
    {
        var key = NormalizeKey(routeKind);

        if (key is null)
        {
            throw new ArgumentException("Reading route kind is required.", nameof(routeKind));
        }

        var items = new Dictionary<string, ReadingSeriesOverrideDefinition>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in overrides ?? new Dictionary<string, ReadingSeriesOverrideDefinition>())
        {
            var itemId = NormalizeKey(item.Key);

            if (itemId is not null && item.Value is not null)
            {
                items[itemId] = item.Value;
            }
        }

        _routes[key] = items;
    }

    /// <summary>Removes all overrides for one Reading route.</summary>
    /// <param name="routeKind">Reading route kind.</param>
    /// <returns><see langword="true"/> when a route was removed.</returns>
    public bool RemoveRoute(string? routeKind)
    {
        var key = NormalizeKey(routeKind);

        return key is not null && _routes.Remove(key);
    }

    private static string? NormalizeKey(string? value)
    {
        var normalized = value?.Trim();

        return string.IsNullOrWhiteSpace(normalized) ? null : normalized;
    }
}

/// <summary>
/// XML-safe persisted Reading route entry.
/// </summary>
public sealed class ReadingSeriesOverrideRouteEntry
{
    /// <summary>Gets or sets the Reading route kind.</summary>
    [XmlAttribute("Kind")]
    public string RouteKind { get; set; } = string.Empty;

    /// <summary>Gets or sets the persisted item corrections.</summary>
    [XmlArray("Overrides")]
    [XmlArrayItem("Override")]
    public ReadingSeriesOverrideItemEntry[] Overrides { get; set; } = [];
}

/// <summary>
/// XML-safe persisted Reading item correction entry.
/// </summary>
public sealed class ReadingSeriesOverrideItemEntry
{
    /// <summary>Gets or sets the Jellyfin item id.</summary>
    [XmlAttribute("ItemId")]
    public string ItemId { get; set; } = string.Empty;

    /// <summary>Gets or sets the correction value.</summary>
    public ReadingSeriesOverrideDefinition? Value { get; set; }
}

/// <summary>
/// One administrator-defined Reading series correction.
/// </summary>
public sealed class ReadingSeriesOverrideDefinition
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

    /// <summary>Gets or sets the display year; it is not part of series identity.</summary>
    public int? SeriesYear { get; set; }

    /// <summary>Gets or sets the corrected volume number.</summary>
    public double? VolumeNumber { get; set; }
}

/// <summary>
/// PiggieTV feature toggles.
/// </summary>
public sealed class FeatureSettings
{
    /// <summary>Gets or sets a value indicating whether the PiggieTV hero is enabled.</summary>
    public bool HeroEnabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether PiggieTV home rows are enabled.</summary>
    public bool HomeRowsEnabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether dynamic backdrops are enabled.</summary>
    public bool DynamicBackdropsEnabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether TV low-power mode is enabled.</summary>
    public bool TvLowPowerModeEnabled { get; set; } = true;

    /// <summary>Gets or sets the PiggieTV playback profile mode.</summary>
    public string PlaybackMode { get; set; } = "auto";

    /// <summary>Gets or sets a value indicating whether backend debug mode is enabled.</summary>
    public bool DebugModeEnabled { get; set; }
}

/// <summary>
/// PiggieTV hero settings.
/// </summary>
public sealed class HeroSettings
{
    /// <summary>Gets or sets a value indicating whether hero auto-rotation is enabled.</summary>
    public bool HeroAutoRotateEnabled { get; set; } = true;

    /// <summary>Gets or sets the hero rotation interval in seconds.</summary>
    public int HeroRotationSeconds { get; set; } = 12;

    /// <summary>Gets or sets the maximum shared hero item count.</summary>
    public int HeroMaxItems { get; set; } = 15;

    /// <summary>Gets or sets the maximum hero backdrop width.</summary>
    public int HeroBackdropMaxWidth { get; set; } = 1920;

    /// <summary>Gets or sets the maximum hero logo width.</summary>
    public int HeroLogoMaxWidth { get; set; } = 800;
}

/// <summary>
/// PiggieTV home-row settings.
/// </summary>
public sealed class RowSettings
{
    /// <summary>Gets or sets the maximum item count per row.</summary>
    public int RowMaxItems { get; set; } = 16;

    /// <summary>Gets or sets the featured row refresh interval in hours.</summary>
    public int RowRefreshHours { get; set; } = 12;

    /// <summary>Gets or sets a value indicating whether seasonal rows are enabled.</summary>
    public bool EnableSeasonalRows { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether collection rows are enabled.</summary>
    public bool EnableCollectionRows { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether recently added rows are enabled.</summary>
    public bool EnableRecentlyAddedRows { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether recommended rows are enabled.</summary>
    public bool EnableRecommendedRows { get; set; } = true;
}

/// <summary>
/// Persisted generated recommendation row settings.
/// </summary>
public sealed class RecommendationRowSettings
{
    /// <summary>Gets or sets the recommendation settings schema version.</summary>
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; } = 1;

    /// <summary>Gets or sets a value indicating whether persisted recommendation rows are enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets the last generation timestamp.</summary>
    [JsonPropertyName("generatedAt")]
    public long? GeneratedAt { get; set; }

    /// <summary>Gets or sets the row-builder hash used when rows were generated.</summary>
    [JsonPropertyName("rowConfigHash")]
    public string? RowConfigHash { get; set; }

    /// <summary>Gets or sets the persisted recommendation config hash.</summary>
    [JsonPropertyName("recommendationConfigHash")]
    public string? RecommendationConfigHash { get; set; }

    /// <summary>Gets or sets source item counts from the last generation.</summary>
    [JsonPropertyName("sourceCounts")]
    public List<RecommendationSourceCount> SourceCounts { get; set; } = [];

    /// <summary>Gets or sets row diagnostics indexed by recommendation row id.</summary>
    [JsonPropertyName("rowDiagnostics")]
    public List<RecommendationRowDiagnostics> RowDiagnostics { get; set; } = [];

    /// <summary>Gets or sets legacy source timing diagnostics. Normalization clears this before storage.</summary>
    [JsonPropertyName("sourceTimingsJson")]
    public string SourceTimingsJson { get; set; } = string.Empty;

    /// <summary>Gets or sets persisted generated rows.</summary>
    [JsonPropertyName("rows")]
    public List<RecommendationRowDefinition> Rows { get; set; } = [];

    /// <summary>
    /// Creates default recommendation row settings.
    /// </summary>
    /// <returns>Default recommendation settings.</returns>
    public static RecommendationRowSettings CreateDefault() => new()
    {
        SchemaVersion = 1,
        Enabled = true,
        Rows = []
    };
}

/// <summary>
/// Persisted generated recommendation row.
/// </summary>
public sealed class RecommendationRowDefinition
{
    /// <summary>Gets or sets the stable recommendation row id.</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether this recommendation row is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether this generated row has been explicitly accepted for Home.</summary>
    [JsonPropertyName("accepted")]
    public bool Accepted { get; set; }

    /// <summary>Gets or sets a value indicating whether this generated row is still a draft.</summary>
    [JsonPropertyName("draft")]
    public bool Draft { get; set; } = true;

    /// <summary>Gets or sets the row title.</summary>
    [JsonPropertyName("title")]
    public string Title { get; set; } = "Recommended";

    /// <summary>Gets or sets a short explanation for the generated row.</summary>
    [JsonPropertyName("explanation")]
    public string Explanation { get; set; } = string.Empty;

    /// <summary>Gets or sets the recommendation row media type.</summary>
    [JsonPropertyName("mediaType")]
    public string MediaType { get; set; } = "mixed";

    /// <summary>Gets or sets the row generation timestamp.</summary>
    [JsonPropertyName("generatedAt")]
    public long? GeneratedAt { get; set; }

    /// <summary>Gets or sets the row-builder hash used when this row was generated.</summary>
    [JsonPropertyName("rowConfigHash")]
    public string? RowConfigHash { get; set; }

    /// <summary>Gets or sets the persisted recommendation config hash.</summary>
    [JsonPropertyName("recommendationConfigHash")]
    public string? RecommendationConfigHash { get; set; }

    /// <summary>Gets or sets source item counts from generation.</summary>
    [JsonPropertyName("sourceCounts")]
    public List<RecommendationSourceCount> SourceCounts { get; set; } = [];

    /// <summary>Gets or sets row generation and hydration diagnostics.</summary>
    [JsonPropertyName("diagnostics")]
    public RecommendationRowDiagnostics Diagnostics { get; set; } = new();

    /// <summary>Gets or sets legacy source timing diagnostics. Normalization clears this before storage.</summary>
    [JsonPropertyName("sourceTimingsJson")]
    public string SourceTimingsJson { get; set; } = string.Empty;

    /// <summary>Gets or sets Jellyfin items backing this row.</summary>
    [JsonPropertyName("items")]
    public List<RecommendationItemSnapshot> Items { get; set; } = [];
}

/// <summary>
/// Persisted recommendation row diagnostics.
/// </summary>
public sealed class RecommendationRowDiagnostics
{
    /// <summary>Gets or sets the recommendation row id this diagnostic describes.</summary>
    [JsonPropertyName("rowId")]
    public string RowId { get; set; } = string.Empty;

    /// <summary>Gets or sets the recommendation row title this diagnostic describes.</summary>
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    /// <summary>Gets or sets candidate count before row selection.</summary>
    [JsonPropertyName("candidateCount")]
    public int CandidateCount { get; set; }

    /// <summary>Gets or sets item removals caused by row-level dedupe/diversity.</summary>
    [JsonPropertyName("dedupeRemovals")]
    public int DedupeRemovals { get; set; }

    /// <summary>Gets or sets item removals caused by hydration/persistence.</summary>
    [JsonPropertyName("hydrationRemovals")]
    public int HydrationRemovals { get; set; }

    /// <summary>Gets or sets final rendered item count.</summary>
    [JsonPropertyName("finalRenderedCount")]
    public int FinalRenderedCount { get; set; }

    /// <summary>Gets or sets current persisted item count.</summary>
    [JsonPropertyName("itemCount")]
    public int ItemCount { get; set; }

    /// <summary>Gets or sets primary candidate count before fallback fill.</summary>
    [JsonPropertyName("primaryCandidateCount")]
    public int PrimaryCandidateCount { get; set; }

    /// <summary>Gets or sets secondary fallback item count used during fill.</summary>
    [JsonPropertyName("secondaryFallbackCount")]
    public int SecondaryFallbackCount { get; set; }

    /// <summary>Gets or sets discovery fallback item count used during fill.</summary>
    [JsonPropertyName("discoveryFallbackCount")]
    public int DiscoveryFallbackCount { get; set; }
}

/// <summary>
/// Persisted recommendation source count.
/// </summary>
public sealed class RecommendationSourceCount
{
    /// <summary>Gets or sets the source name.</summary>
    [JsonPropertyName("source")]
    public string Source { get; set; } = string.Empty;

    /// <summary>Gets or sets the source item count.</summary>
    [JsonPropertyName("count")]
    public int Count { get; set; }
}

/// <summary>
/// Persisted item image tags for generated recommendation rows.
/// </summary>
public sealed class RecommendationItemImageTags
{
    /// <summary>Gets or sets the primary image tag.</summary>
    [JsonPropertyName("Primary")]
    public string? Primary { get; set; }

    /// <summary>Gets or sets the thumb image tag.</summary>
    [JsonPropertyName("Thumb")]
    public string? Thumb { get; set; }

    /// <summary>Gets or sets the logo image tag.</summary>
    [JsonPropertyName("Logo")]
    public string? Logo { get; set; }
}

/// <summary>
/// Persisted Jellyfin item snapshot for generated recommendation rows.
/// </summary>
public sealed class RecommendationItemSnapshot
{
    /// <summary>Gets or sets the Jellyfin item id.</summary>
    [JsonPropertyName("Id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets the item name.</summary>
    [JsonPropertyName("Name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>Gets or sets the Jellyfin item type.</summary>
    [JsonPropertyName("Type")]
    public string Type { get; set; } = string.Empty;

    /// <summary>Gets or sets the media type.</summary>
    [JsonPropertyName("MediaType")]
    public string? MediaType { get; set; }

    /// <summary>Gets or sets the overview.</summary>
    [JsonPropertyName("Overview")]
    public string? Overview { get; set; }

    /// <summary>Gets or sets image tags.</summary>
    [JsonPropertyName("ImageTags")]
    public RecommendationItemImageTags ImageTags { get; set; } = new();

    /// <summary>Gets or sets backdrop image tags.</summary>
    [JsonPropertyName("BackdropImageTags")]
    public List<string> BackdropImageTags { get; set; } = [];

    /// <summary>Gets or sets parent backdrop image tags.</summary>
    [JsonPropertyName("ParentBackdropImageTags")]
    public List<string> ParentBackdropImageTags { get; set; } = [];

    /// <summary>Gets or sets genres.</summary>
    [JsonPropertyName("Genres")]
    public List<string> Genres { get; set; } = [];

    /// <summary>Gets or sets studios.</summary>
    [JsonPropertyName("Studios")]
    public List<string> Studios { get; set; } = [];

    /// <summary>Gets or sets artists.</summary>
    [JsonPropertyName("Artists")]
    public List<string> Artists { get; set; } = [];

    /// <summary>Gets or sets album artist.</summary>
    [JsonPropertyName("AlbumArtist")]
    public string? AlbumArtist { get; set; }

    /// <summary>Gets or sets album name.</summary>
    [JsonPropertyName("Album")]
    public string? Album { get; set; }

    /// <summary>Gets or sets album id.</summary>
    [JsonPropertyName("AlbumId")]
    public string? AlbumId { get; set; }

    /// <summary>Gets or sets album primary image item id.</summary>
    [JsonPropertyName("AlbumPrimaryImageItemId")]
    public string? AlbumPrimaryImageItemId { get; set; }

    /// <summary>Gets or sets album primary image tag.</summary>
    [JsonPropertyName("AlbumPrimaryImageTag")]
    public string? AlbumPrimaryImageTag { get; set; }

    /// <summary>Gets or sets parent primary image item id.</summary>
    [JsonPropertyName("ParentPrimaryImageItemId")]
    public string? ParentPrimaryImageItemId { get; set; }

    /// <summary>Gets or sets parent primary image tag.</summary>
    [JsonPropertyName("ParentPrimaryImageTag")]
    public string? ParentPrimaryImageTag { get; set; }

    /// <summary>Gets or sets parent thumb item id.</summary>
    [JsonPropertyName("ParentThumbItemId")]
    public string? ParentThumbItemId { get; set; }

    /// <summary>Gets or sets parent thumb image tag.</summary>
    [JsonPropertyName("ParentThumbImageTag")]
    public string? ParentThumbImageTag { get; set; }

    /// <summary>Gets or sets parent id.</summary>
    [JsonPropertyName("ParentId")]
    public string? ParentId { get; set; }

    /// <summary>Gets or sets series id.</summary>
    [JsonPropertyName("SeriesId")]
    public string? SeriesId { get; set; }

    /// <summary>Gets or sets series name.</summary>
    [JsonPropertyName("SeriesName")]
    public string? SeriesName { get; set; }

    /// <summary>Gets or sets series primary image tag.</summary>
    [JsonPropertyName("SeriesPrimaryImageTag")]
    public string? SeriesPrimaryImageTag { get; set; }

    /// <summary>Gets or sets production year.</summary>
    [JsonPropertyName("ProductionYear")]
    public int? ProductionYear { get; set; }

    /// <summary>Gets or sets community rating.</summary>
    [JsonPropertyName("CommunityRating")]
    public float? CommunityRating { get; set; }

    /// <summary>Gets or sets primary image aspect ratio.</summary>
    [JsonPropertyName("PrimaryImageAspectRatio")]
    public double? PrimaryImageAspectRatio { get; set; }

    /// <summary>Gets or sets runtime ticks.</summary>
    [JsonPropertyName("RunTimeTicks")]
    public long? RunTimeTicks { get; set; }

    /// <summary>Gets or sets date created.</summary>
    [JsonPropertyName("DateCreated")]
    public string? DateCreated { get; set; }

    /// <summary>Gets or sets premiere date.</summary>
    [JsonPropertyName("PremiereDate")]
    public string? PremiereDate { get; set; }
}

/// <summary>
/// PiggieTV versioned row-builder settings.
/// </summary>
public sealed class RowBuilderSettings
{
    /// <summary>Gets or sets the row-builder schema version.</summary>
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; } = 2;

    /// <summary>Gets or sets a value indicating whether configured homepage rows are enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether default rule initialization has run.</summary>
    [JsonPropertyName("defaultsInitialized")]
    public bool DefaultsInitialized { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether configured Row Builder rows should render on Home.</summary>
    [JsonPropertyName("showConfiguredRowsOnHome")]
    public bool ShowConfiguredRowsOnHome { get; set; }

    /// <summary>Gets or sets configured row rules.</summary>
    [JsonPropertyName("rules")]
    public List<RowBuilderRule> Rules { get; set; } = [];

    /// <summary>Gets or sets legacy configured row categories. Used only for migration from schema v1.</summary>
    [JsonPropertyName("categories")]
    public List<RowBuilderCategory> Categories { get; set; } = [];

    /// <summary>
    /// Creates the default row-builder settings.
    /// </summary>
    /// <returns>Default row-builder settings.</returns>
    public static RowBuilderSettings CreateDefault() => new()
    {
        SchemaVersion = 2,
        Enabled = true,
        DefaultsInitialized = true,
        Rules =
        [
            new()
            {
                Id = "continue-watching",
                Enabled = true,
                Name = "Continue Watching",
                MediaType = "mixed",
                SourceType = "continueWatching",
                SourceValue = "continue",
                GenerationMode = "latest",
                ItemLimit = 16,
                RowCount = 1
            },
            new()
            {
                Id = "latest-movies",
                Enabled = true,
                Name = "Latest Movies",
                MediaType = "movies",
                SourceType = "latest",
                SourceValue = "movies",
                GenerationMode = "latest",
                ItemLimit = 16,
                RowCount = 1
            },
            new()
            {
                Id = "latest-shows",
                Enabled = true,
                Name = "Latest Shows",
                MediaType = "shows",
                SourceType = "latest",
                SourceValue = "shows",
                GenerationMode = "latest",
                ItemLimit = 16,
                RowCount = 1
            },
            new()
            {
                Id = "latest-cartoons",
                Enabled = true,
                Name = "Latest Cartoons",
                MediaType = "cartoons",
                SourceType = "latest",
                SourceValue = "cartoons",
                GenerationMode = "latest",
                ItemLimit = 16,
                RowCount = 1
            },
            new()
            {
                Id = "latest-anime",
                Enabled = true,
                Name = "Latest Anime",
                MediaType = "anime",
                SourceType = "latest",
                SourceValue = "anime",
                GenerationMode = "latest",
                ItemLimit = 16,
                RowCount = 1
            },
            new()
            {
                Id = "latest-music",
                Enabled = true,
                Name = "Latest Music",
                MediaType = "music",
                SourceType = "latest",
                SourceValue = "music",
                GenerationMode = "latest",
                ItemLimit = 16,
                RowCount = 1
            },
            new()
            {
                Id = "requested-by-you",
                Enabled = false,
                Name = "Requested By You",
                MediaType = "mixed",
                SourceType = "requested",
                SourceValue = "jellyseerr",
                GenerationMode = "latest",
                ItemLimit = 16,
                RowCount = 1
            }
        ]
    };
}

/// <summary>
/// PiggieTV unified row-builder rule.
/// </summary>
public sealed class RowBuilderRule
{
    /// <summary>Gets or sets the stable rule id.</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether this rule is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets the display row name.</summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = "New Row";

    /// <summary>Gets or sets the media type: movies, shows, cartoons, anime, music, books, liveTv, or mixed.</summary>
    [JsonPropertyName("mediaType")]
    public string MediaType { get; set; } = "movies";

    /// <summary>Gets or sets the source type.</summary>
    [JsonPropertyName("sourceType")]
    public string SourceType { get; set; } = "genre";

    /// <summary>Gets or sets the source value for the selected source type.</summary>
    [JsonPropertyName("sourceValue")]
    public string SourceValue { get; set; } = string.Empty;

    /// <summary>Gets or sets the generation mode.</summary>
    [JsonPropertyName("generationMode")]
    public string GenerationMode { get; set; } = "random";

    /// <summary>Gets or sets the item limit for a generated row.</summary>
    [JsonPropertyName("itemLimit")]
    public int ItemLimit { get; set; } = 16;

    /// <summary>Gets or sets how many rows or subrows this rule can generate.</summary>
    [JsonPropertyName("rowCount")]
    public int RowCount { get; set; } = 1;

    /// <summary>Gets or sets a value indicating whether genre subrows should be generated.</summary>
    [JsonPropertyName("includeSubgenres")]
    public bool IncludeSubgenres { get; set; }

    /// <summary>Gets or sets how many subgenre rows should be generated.</summary>
    [JsonPropertyName("subgenreRowCount")]
    public int SubgenreRowCount { get; set; }

    /// <summary>Gets or sets optional seasonal settings.</summary>
    [JsonPropertyName("seasonal")]
    public RowSeasonalSettings? Seasonal { get; set; }

    /// <summary>Gets or sets provider hints that may enrich matching.</summary>
    [JsonPropertyName("providerHints")]
    public List<string> ProviderHints { get; set; } = [];

    /// <summary>Gets or sets a stable sort priority. Lower values render earlier.</summary>
    [JsonPropertyName("sortPriority")]
    public int SortPriority { get; set; }

    /// <summary>Gets or sets the visual tier. Use 0 for automatic tiering.</summary>
    [JsonPropertyName("tier")]
    public int Tier { get; set; }

    /// <summary>Gets or sets the row presentation: auto, featured, standard, compact, mini, or library-hub.</summary>
    [JsonPropertyName("presentation")]
    public string Presentation { get; set; } = "auto";

    /// <summary>Gets or sets an optional homepage group label.</summary>
    [JsonPropertyName("groupTitle")]
    public string GroupTitle { get; set; } = string.Empty;
}

/// <summary>
/// Optional seasonal row settings.
/// </summary>
public sealed class RowSeasonalSettings
{
    /// <summary>Gets or sets the seasonal mode.</summary>
    [JsonPropertyName("mode")]
    public string Mode { get; set; } = "auto";

    /// <summary>Gets or sets the custom start month.</summary>
    [JsonPropertyName("startMonth")]
    public int? StartMonth { get; set; }

    /// <summary>Gets or sets the custom start day.</summary>
    [JsonPropertyName("startDay")]
    public int? StartDay { get; set; }

    /// <summary>Gets or sets the custom end month.</summary>
    [JsonPropertyName("endMonth")]
    public int? EndMonth { get; set; }

    /// <summary>Gets or sets the custom end day.</summary>
    [JsonPropertyName("endDay")]
    public int? EndDay { get; set; }
}

/// <summary>
/// PiggieTV row-builder category.
/// </summary>
public sealed class RowBuilderCategory
{
    /// <summary>Gets or sets the stable category id.</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether this category is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets the media type: movies, shows, cartoons, anime, or mixed.</summary>
    [JsonPropertyName("mediaType")]
    public string MediaType { get; set; } = "movies";

    /// <summary>Gets or sets the source type: genre, studio, or customTag.</summary>
    [JsonPropertyName("sourceType")]
    public string SourceType { get; set; } = "genre";

    /// <summary>Gets or sets the generation mode: random or specific.</summary>
    [JsonPropertyName("generationMode")]
    public string GenerationMode { get; set; } = "random";

    /// <summary>Gets or sets how many rows to generate in random mode.</summary>
    [JsonPropertyName("rowCount")]
    public int RowCount { get; set; } = 6;

    /// <summary>Gets or sets specific row entries.</summary>
    [JsonPropertyName("entries")]
    public List<string> Entries { get; set; } = [];

    /// <summary>Gets or sets optional source-pool filters for random mode.</summary>
    [JsonPropertyName("sourcePoolFilters")]
    public List<string> SourcePoolFilters { get; set; } = [];
}

/// <summary>
/// PiggieTV featured cache settings.
/// </summary>
public sealed class CacheSettings
{
    /// <summary>Gets or sets the featured cache refresh interval in hours.</summary>
    public int RefreshIntervalHours { get; set; } = 12;
}

/// <summary>
/// PiggieTV performance settings.
/// </summary>
public sealed class PerformanceSettings
{
    /// <summary>Gets or sets the maximum cache payload size in bytes.</summary>
    public int MaxCachePayloadBytes { get; set; } = 4 * 1024 * 1024;

    /// <summary>Gets or sets the maximum number of images to preload.</summary>
    public int ImagePreloadLimit { get; set; } = 4;

    /// <summary>Gets or sets a value indicating whether animated rows are enabled.</summary>
    public bool EnableAnimatedRows { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether backdrop blur is enabled.</summary>
    public bool EnableBackdropBlur { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether low-power clients should disable blur.</summary>
    public bool LowPowerDisableBlur { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether low-power clients should disable animations.</summary>
    public bool LowPowerDisableAnimations { get; set; } = true;
}

/// <summary>
/// PiggieTV TMDb settings.
/// </summary>
public sealed class TmdbSettings
{
    /// <summary>Gets or sets a value indicating whether TMDb metadata is enabled.</summary>
    public bool TmdbEnabled { get; set; } = true;

    /// <summary>Gets or sets the TMDb API token. This is write-only in public DTOs.</summary>
    public string? TmdbApiToken { get; set; }

    /// <summary>Gets or sets the TMDb language.</summary>
    public string TmdbLanguage { get; set; } = "en-US";

    /// <summary>Gets or sets the TMDb region.</summary>
    public string TmdbRegion { get; set; } = "US";

    /// <summary>Gets or sets a value indicating whether TMDb should influence row matching.</summary>
    public bool UseTmdbForRowAccuracy { get; set; } = true;
}

/// <summary>
/// PiggieTV music metadata lookup settings.
/// </summary>
public sealed class MusicMetadataSettings
{
    /// <summary>Gets or sets a value indicating whether MusicBrainz lookups are enabled.</summary>
    public bool MusicBrainzEnabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether Discogs lookups are enabled.</summary>
    public bool DiscogsEnabled { get; set; }

    /// <summary>Gets or sets the Discogs personal access token. This is write-only in public DTOs.</summary>
    public string? DiscogsToken { get; set; }

    /// <summary>Gets or sets the maximum number of candidates returned per lookup.</summary>
    public int MaxResults { get; set; } = 6;
}

/// <summary>
/// PiggieTV Google Books metadata lookup settings.
/// </summary>
public sealed class GoogleBooksSettings
{
    /// <summary>Gets or sets a value indicating whether native Google Books lookup is enabled.</summary>
    public bool GoogleBooksEnabled { get; set; } = true;

    /// <summary>Gets or sets the Google Books API key. This is write-only in public DTOs.</summary>
    public string? GoogleBooksApiKey { get; set; }

    /// <summary>Gets or sets the maximum number of candidates returned per lookup.</summary>
    public int MaxResults { get; set; } = 10;
}

/// <summary>
/// PiggieTV Jellyseerr integration settings.
/// </summary>
public sealed class SeerrSettings
{
    /// <summary>Gets or sets a value indicating whether Jellyseerr integration is enabled.</summary>
    public bool Enabled { get; set; }

    /// <summary>Gets or sets the display name shown in PiggieTV.</summary>
    public string DisplayName { get; set; } = "Jellyseerr";

    /// <summary>Gets or sets the internal Jellyseerr URL used by the plugin backend.</summary>
    public string InternalUrl { get; set; } = "http://10.16.0.226:5055";

    /// <summary>Gets or sets the external Jellyseerr URL used as a browser fallback.</summary>
    public string ExternalUrl { get; set; } = "https://request.piggietv.com";

    /// <summary>Gets or sets the Jellyseerr API key. This is write-only in public DTOs.</summary>
    public string? ApiKey { get; set; }

    /// <summary>Gets or sets a value indicating whether the request page is enabled.</summary>
    public bool EnableRequestsPage { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether search integration is enabled.</summary>
    public bool EnableSearchIntegration { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether automatic request actions are enabled.</summary>
    public bool EnableAutoRequest { get; set; }

    /// <summary>Gets or sets a value indicating whether requests should open inside PiggieTV.</summary>
    public bool OpenRequestsInPtv { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether external fallback should be offered.</summary>
    public bool OpenExternalFallback { get; set; } = true;
}

/// <summary>
/// PiggieTV *Arr integration settings.
/// </summary>
public sealed class ArrSettings
{
    /// <summary>Gets or sets Sonarr settings.</summary>
    public ArrServiceSettings Sonarr { get; set; } = new();

    /// <summary>Gets or sets Radarr settings.</summary>
    public ArrServiceSettings Radarr { get; set; } = new();

    /// <summary>Gets or sets Lidarr settings.</summary>
    public ArrServiceSettings Lidarr { get; set; } = new();

    /// <summary>Gets or sets Prowlarr settings.</summary>
    public ArrServiceSettings Prowlarr { get; set; } = new();
}

/// <summary>
/// PiggieTV individual *Arr service settings.
/// </summary>
public sealed class ArrServiceSettings
{
    /// <summary>Gets or sets a value indicating whether the service is enabled.</summary>
    public bool Enabled { get; set; }

    /// <summary>Gets or sets the internal service URL used by the plugin backend.</summary>
    public string InternalUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets the external service URL used as a browser fallback.</summary>
    public string ExternalUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets the service API key. This is write-only in public DTOs.</summary>
    public string? ApiKey { get; set; }
}

/// <summary>
/// PiggieTV download provider settings.
/// </summary>
public sealed class DownloadSettings
{
    /// <summary>Gets or sets a value indicating whether download provider integration is enabled.</summary>
    public bool Enabled { get; set; }

    /// <summary>Gets or sets the download provider name.</summary>
    public string Provider { get; set; } = "qbittorrent";

    /// <summary>Gets or sets the internal provider URL used by the plugin backend.</summary>
    public string InternalUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets the external provider URL used as a browser fallback.</summary>
    public string ExternalUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets the provider username. This is write-only in public DTOs.</summary>
    public string? Username { get; set; }

    /// <summary>Gets or sets the provider password. This is write-only in public DTOs.</summary>
    public string? Password { get; set; }
}

/// <summary>
/// PiggieTV tag-based row and filtering settings.
/// </summary>
public sealed class TagSettings
{
    /// <summary>Gets or sets a value indicating whether tag features are enabled.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether tag rows are enabled.</summary>
    public bool EnableTagRows { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether tag filters are enabled.</summary>
    public bool EnableTagFilters { get; set; } = true;

    /// <summary>Gets or sets tags that should be included in smart row/filter matching.</summary>
    public List<string> IncludeTags { get; set; } = [];

    /// <summary>Gets or sets tags that should be excluded from smart row/filter matching.</summary>
    public List<string> ExcludeTags { get; set; } = [];

    /// <summary>Gets or sets custom tag row definitions.</summary>
    public List<TagRowDefinition> RowDefinitions { get; set; } =
    [
        new()
        {
            Id = "disney-animation",
            Name = "Disney Animation",
            Tags = ["disney", "animation"],
            IncludeItemTypes = ["Movie", "Series"],
            SortBy = "Random",
            Limit = 16,
            Enabled = true
        }
    ];
}

/// <summary>
/// PiggieTV tag row definition.
/// </summary>
public sealed class TagRowDefinition
{
    /// <summary>Gets or sets the stable row id.</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets the row display name.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Gets or sets tags matched by the row.</summary>
    public List<string> Tags { get; set; } = [];

    /// <summary>Gets or sets allowed Jellyfin item types.</summary>
    public List<string> IncludeItemTypes { get; set; } = ["Movie", "Series"];

    /// <summary>Gets or sets the row sort mode.</summary>
    public string SortBy { get; set; } = "Random";

    /// <summary>Gets or sets maximum row items.</summary>
    public int Limit { get; set; } = 16;

    /// <summary>Gets or sets a value indicating whether the row is enabled.</summary>
    public bool Enabled { get; set; } = true;
}

/// <summary>
/// PiggieTV random discovery settings.
/// </summary>
public sealed class RandomSettings
{
    /// <summary>Gets or sets a value indicating whether random discovery is enabled.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether random movie is enabled.</summary>
    public bool EnableRandomMovie { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether random episode is enabled.</summary>
    public bool EnableRandomEpisode { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether random anime is enabled.</summary>
    public bool EnableRandomAnime { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether random from current library is enabled.</summary>
    public bool EnableRandomFromCurrentLibrary { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether random discovery should respect parental rating.</summary>
    public bool RespectParentalRating { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether random discovery should respect hidden content.</summary>
    public bool RespectHiddenContent { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether unwatched-only option is available.</summary>
    public bool UseUnwatchedOnlyOption { get; set; } = true;

    /// <summary>Gets or sets random action behavior.</summary>
    public string Behavior { get; set; } = "details";
}
