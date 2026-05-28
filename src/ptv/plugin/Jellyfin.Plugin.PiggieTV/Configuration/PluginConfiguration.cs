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
    /// Gets or sets Jellyseerr request integration settings.
    /// </summary>
    public SeerrSettings SeerrSettings { get; set; } = new();

    /// <summary>
    /// Gets or sets jfa-go account/invite integration settings.
    /// </summary>
    public JfaGoSettings JfaGoSettings { get; set; } = new();

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
/// PiggieTV versioned row-builder settings.
/// </summary>
public sealed class RowBuilderSettings
{
    /// <summary>Gets or sets the row-builder schema version.</summary>
    public int SchemaVersion { get; set; } = 2;

    /// <summary>Gets or sets a value indicating whether configured homepage rows are enabled.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether default rule initialization has run.</summary>
    public bool DefaultsInitialized { get; set; } = true;

    /// <summary>Gets or sets configured row rules.</summary>
    public List<RowBuilderRule> Rules { get; set; } = [];

    /// <summary>Gets or sets legacy configured row categories. Used only for migration from schema v1.</summary>
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
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether this rule is enabled.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets the display row name.</summary>
    public string Name { get; set; } = "New Row";

    /// <summary>Gets or sets the media type: movies, shows, cartoons, anime, music, books, liveTv, or mixed.</summary>
    public string MediaType { get; set; } = "movies";

    /// <summary>Gets or sets the source type.</summary>
    public string SourceType { get; set; } = "genre";

    /// <summary>Gets or sets the source value for the selected source type.</summary>
    public string SourceValue { get; set; } = string.Empty;

    /// <summary>Gets or sets the generation mode.</summary>
    public string GenerationMode { get; set; } = "random";

    /// <summary>Gets or sets the item limit for a generated row.</summary>
    public int ItemLimit { get; set; } = 16;

    /// <summary>Gets or sets how many rows or subrows this rule can generate.</summary>
    public int RowCount { get; set; } = 1;

    /// <summary>Gets or sets a value indicating whether genre subrows should be generated.</summary>
    public bool IncludeSubgenres { get; set; }

    /// <summary>Gets or sets how many subgenre rows should be generated.</summary>
    public int SubgenreRowCount { get; set; }

    /// <summary>Gets or sets optional seasonal settings.</summary>
    public RowSeasonalSettings? Seasonal { get; set; }

    /// <summary>Gets or sets provider hints that may enrich matching.</summary>
    public List<string> ProviderHints { get; set; } = [];

    /// <summary>Gets or sets a stable sort priority. Lower values render earlier.</summary>
    public int SortPriority { get; set; }

    /// <summary>Gets or sets the visual tier. Use 0 for automatic tiering.</summary>
    public int Tier { get; set; }

    /// <summary>Gets or sets the row presentation: auto, featured, standard, compact, mini, or library-hub.</summary>
    public string Presentation { get; set; } = "auto";

    /// <summary>Gets or sets an optional homepage group label.</summary>
    public string GroupTitle { get; set; } = string.Empty;
}

/// <summary>
/// Optional seasonal row settings.
/// </summary>
public sealed class RowSeasonalSettings
{
    /// <summary>Gets or sets the seasonal mode.</summary>
    public string Mode { get; set; } = "auto";

    /// <summary>Gets or sets the custom start month.</summary>
    public int? StartMonth { get; set; }

    /// <summary>Gets or sets the custom start day.</summary>
    public int? StartDay { get; set; }

    /// <summary>Gets or sets the custom end month.</summary>
    public int? EndMonth { get; set; }

    /// <summary>Gets or sets the custom end day.</summary>
    public int? EndDay { get; set; }
}

/// <summary>
/// PiggieTV row-builder category.
/// </summary>
public sealed class RowBuilderCategory
{
    /// <summary>Gets or sets the stable category id.</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether this category is enabled.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets the media type: movies, shows, cartoons, anime, or mixed.</summary>
    public string MediaType { get; set; } = "movies";

    /// <summary>Gets or sets the source type: genre, studio, or customTag.</summary>
    public string SourceType { get; set; } = "genre";

    /// <summary>Gets or sets the generation mode: random or specific.</summary>
    public string GenerationMode { get; set; } = "random";

    /// <summary>Gets or sets how many rows to generate in random mode.</summary>
    public int RowCount { get; set; } = 6;

    /// <summary>Gets or sets specific row entries.</summary>
    public List<string> Entries { get; set; } = [];

    /// <summary>Gets or sets optional source-pool filters for random mode.</summary>
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
/// PiggieTV jfa-go integration settings.
/// </summary>
public sealed class JfaGoSettings
{
    /// <summary>Gets or sets a value indicating whether jfa-go integration is enabled.</summary>
    public bool Enabled { get; set; }

    /// <summary>Gets or sets the display name shown in PiggieTV.</summary>
    public string DisplayName { get; set; } = "jfa-go";

    /// <summary>Gets or sets the internal jfa-go URL used by the plugin backend.</summary>
    public string InternalUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets the external jfa-go URL used as a browser fallback.</summary>
    public string ExternalUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets the jfa-go API key/token. This is write-only in public DTOs.</summary>
    public string? ApiKey { get; set; }

    /// <summary>Gets or sets a value indicating whether invalid/self-signed internal TLS certificates are allowed.</summary>
    public bool AllowSelfSignedTls { get; set; }
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
