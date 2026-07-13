using System.Text.Json.Serialization;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Services;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Public PiggieTV plugin settings DTO. Secrets are write-only.
/// </summary>
public sealed class PtvPluginSettingsDto
{
    /// <summary>Gets or sets feature toggles.</summary>
    [JsonPropertyName("featureSettings")]
    public FeatureSettings FeatureSettings { get; set; } = new();

    /// <summary>Gets or sets hero settings.</summary>
    [JsonPropertyName("heroSettings")]
    public HeroSettings HeroSettings { get; set; } = new();

    /// <summary>Gets or sets row settings.</summary>
    [JsonPropertyName("rowSettings")]
    public RowSettings RowSettings { get; set; } = new();

    /// <summary>Gets or sets versioned row-builder settings.</summary>
    [JsonPropertyName("rows")]
    public RowBuilderSettings Rows { get; set; } = RowBuilderSettings.CreateDefault();

    /// <summary>Gets or sets persisted generated recommendation rows.</summary>
    [JsonPropertyName("recommendations")]
    public RecommendationRowSettings Recommendations { get; set; } = RecommendationRowSettings.CreateDefault();

    /// <summary>Gets or sets featured cache settings.</summary>
    [JsonPropertyName("cacheSettings")]
    public CacheSettings CacheSettings { get; set; } = new();

    /// <summary>Gets or sets featured cache settings using the canonical dashboard key.</summary>
    [JsonPropertyName("cache")]
    public CacheSettings Cache { get; set; } = new();

    /// <summary>Gets or sets performance settings.</summary>
    [JsonPropertyName("performanceSettings")]
    public PerformanceSettings PerformanceSettings { get; set; } = new();

    /// <summary>Gets or sets TMDb settings.</summary>
    [JsonPropertyName("tmdbSettings")]
    public PtvPublicTmdbSettings TmdbSettings { get; set; } = new();

    /// <summary>Gets or sets music metadata lookup settings.</summary>
    [JsonPropertyName("musicMetadataSettings")]
    public PtvPublicMusicMetadataSettings MusicMetadataSettings { get; set; } = new();

    /// <summary>Gets or sets Google Books reading metadata lookup settings.</summary>
    [JsonPropertyName("googleBooksSettings")]
    public PtvPublicGoogleBooksSettings GoogleBooksSettings { get; set; } = new();

    /// <summary>Gets or sets Jellyseerr settings.</summary>
    [JsonPropertyName("seerrSettings")]
    public PtvPublicSeerrSettings SeerrSettings { get; set; } = new();

    /// <summary>Gets or sets *Arr integration settings.</summary>
    [JsonPropertyName("arrSettings")]
    public PtvPublicArrSettings ArrSettings { get; set; } = new();

    /// <summary>Gets or sets download provider settings.</summary>
    [JsonPropertyName("downloadSettings")]
    public PtvPublicDownloadSettings DownloadSettings { get; set; } = new();

    /// <summary>Gets or sets tag row/filter settings.</summary>
    [JsonPropertyName("tagSettings")]
    public TagSettings TagSettings { get; set; } = new();

    /// <summary>Gets or sets random discovery settings.</summary>
    [JsonPropertyName("randomSettings")]
    public RandomSettings RandomSettings { get; set; } = new();

    /// <summary>
    /// Creates a public settings DTO from plugin configuration.
    /// </summary>
    /// <param name="configuration">Plugin configuration.</param>
    /// <returns>Public settings DTO.</returns>
    public static PtvPluginSettingsDto FromConfiguration(PluginConfiguration configuration)
    {
        PtvPluginSettingsNormalizer.Normalize(configuration);

        return new PtvPluginSettingsDto
        {
            FeatureSettings = configuration.FeatureSettings,
            Cache = configuration.CacheSettings,
            CacheSettings = configuration.CacheSettings,
            HeroSettings = configuration.HeroSettings,
            PerformanceSettings = configuration.PerformanceSettings,
            RowSettings = configuration.RowSettings,
            Rows = configuration.Rows,
            Recommendations = configuration.Recommendations,
            TmdbSettings = PtvPublicTmdbSettings.FromConfiguration(configuration),
            MusicMetadataSettings = PtvPublicMusicMetadataSettings.FromConfiguration(configuration),
            GoogleBooksSettings = PtvPublicGoogleBooksSettings.FromConfiguration(configuration),
            SeerrSettings = PtvPublicSeerrSettings.FromConfiguration(configuration),
            ArrSettings = PtvPublicArrSettings.FromConfiguration(configuration),
            DownloadSettings = PtvPublicDownloadSettings.FromConfiguration(configuration),
            TagSettings = configuration.TagSettings,
            RandomSettings = configuration.RandomSettings
        };
    }
}

/// <summary>
/// Partial PiggieTV plugin settings patch. Missing values preserve existing configuration.
/// </summary>
public sealed class PtvPluginSettingsPatchDto
{
    /// <summary>Gets or sets feature toggle updates.</summary>
    [JsonPropertyName("featureSettings")]
    public PtvFeatureSettingsPatch? FeatureSettings { get; set; }

    /// <summary>Gets or sets hero setting updates.</summary>
    [JsonPropertyName("heroSettings")]
    public PtvHeroSettingsPatch? HeroSettings { get; set; }

    /// <summary>Gets or sets row setting updates.</summary>
    [JsonPropertyName("rowSettings")]
    public PtvRowSettingsPatch? RowSettings { get; set; }

    /// <summary>Gets or sets row-builder setting updates.</summary>
    [JsonPropertyName("rows")]
    public RowBuilderSettings? Rows { get; set; }

    /// <summary>Gets or sets persisted recommendation row updates.</summary>
    [JsonPropertyName("recommendations")]
    public RecommendationRowSettings? Recommendations { get; set; }

    /// <summary>Gets or sets featured cache setting updates.</summary>
    [JsonPropertyName("cacheSettings")]
    public PtvCacheSettingsPatch? CacheSettings { get; set; }

    /// <summary>Gets or sets featured cache setting updates using the canonical dashboard key.</summary>
    [JsonPropertyName("cache")]
    public PtvCacheSettingsPatch? Cache { get; set; }

    /// <summary>Gets or sets performance setting updates.</summary>
    [JsonPropertyName("performanceSettings")]
    public PtvPerformanceSettingsPatch? PerformanceSettings { get; set; }

    /// <summary>Gets or sets TMDb setting updates.</summary>
    [JsonPropertyName("tmdbSettings")]
    public PtvTmdbSettingsPatch? TmdbSettings { get; set; }

    /// <summary>Gets or sets music metadata lookup setting updates.</summary>
    [JsonPropertyName("musicMetadataSettings")]
    public PtvMusicMetadataSettingsPatch? MusicMetadataSettings { get; set; }

    /// <summary>Gets or sets Google Books reading metadata lookup setting updates.</summary>
    [JsonPropertyName("googleBooksSettings")]
    public PtvGoogleBooksSettingsPatch? GoogleBooksSettings { get; set; }

    /// <summary>Gets or sets Jellyseerr setting updates.</summary>
    [JsonPropertyName("seerrSettings")]
    public PtvSeerrSettingsPatch? SeerrSettings { get; set; }

    /// <summary>Gets or sets *Arr setting updates.</summary>
    [JsonPropertyName("arrSettings")]
    public PtvArrSettingsPatch? ArrSettings { get; set; }

    /// <summary>Gets or sets download provider setting updates.</summary>
    [JsonPropertyName("downloadSettings")]
    public PtvDownloadSettingsPatch? DownloadSettings { get; set; }

    /// <summary>Gets or sets tag row/filter setting updates.</summary>
    [JsonPropertyName("tagSettings")]
    public PtvTagSettingsPatch? TagSettings { get; set; }

    /// <summary>Gets or sets random discovery setting updates.</summary>
    [JsonPropertyName("randomSettings")]
    public PtvRandomSettingsPatch? RandomSettings { get; set; }
}

/// <summary>
/// Partial feature settings patch.
/// </summary>
public sealed class PtvFeatureSettingsPatch
{
    /// <summary>Gets or sets whether the hero is enabled.</summary>
    [JsonPropertyName("heroEnabled")]
    public bool? HeroEnabled { get; set; }

    /// <summary>Gets or sets whether home rows are enabled.</summary>
    [JsonPropertyName("homeRowsEnabled")]
    public bool? HomeRowsEnabled { get; set; }

    /// <summary>Gets or sets whether dynamic backdrops are enabled.</summary>
    [JsonPropertyName("dynamicBackdropsEnabled")]
    public bool? DynamicBackdropsEnabled { get; set; }

    /// <summary>Gets or sets whether TV low-power mode is enabled.</summary>
    [JsonPropertyName("tvLowPowerModeEnabled")]
    public bool? TvLowPowerModeEnabled { get; set; }

    /// <summary>Gets or sets the PiggieTV playback profile mode.</summary>
    [JsonPropertyName("playbackMode")]
    public string? PlaybackMode { get; set; }

    /// <summary>Gets or sets whether debug mode is enabled.</summary>
    [JsonPropertyName("debugModeEnabled")]
    public bool? DebugModeEnabled { get; set; }
}

/// <summary>
/// Partial hero settings patch.
/// </summary>
public sealed class PtvHeroSettingsPatch
{
    /// <summary>Gets or sets whether hero auto-rotation is enabled.</summary>
    [JsonPropertyName("heroAutoRotateEnabled")]
    public bool? HeroAutoRotateEnabled { get; set; }

    /// <summary>Gets or sets hero rotation seconds.</summary>
    [JsonPropertyName("heroRotationSeconds")]
    public int? HeroRotationSeconds { get; set; }

    /// <summary>Gets or sets max hero items.</summary>
    [JsonPropertyName("heroMaxItems")]
    public int? HeroMaxItems { get; set; }

    /// <summary>Gets or sets backdrop max width.</summary>
    [JsonPropertyName("heroBackdropMaxWidth")]
    public int? HeroBackdropMaxWidth { get; set; }

    /// <summary>Gets or sets logo max width.</summary>
    [JsonPropertyName("heroLogoMaxWidth")]
    public int? HeroLogoMaxWidth { get; set; }
}

/// <summary>
/// Partial row settings patch.
/// </summary>
public sealed class PtvRowSettingsPatch
{
    /// <summary>Gets or sets max items per row.</summary>
    [JsonPropertyName("rowMaxItems")]
    public int? RowMaxItems { get; set; }

    /// <summary>Gets or sets featured refresh interval in hours.</summary>
    [JsonPropertyName("rowRefreshHours")]
    public int? RowRefreshHours { get; set; }

    /// <summary>Gets or sets whether seasonal rows are enabled.</summary>
    [JsonPropertyName("enableSeasonalRows")]
    public bool? EnableSeasonalRows { get; set; }

    /// <summary>Gets or sets whether collection rows are enabled.</summary>
    [JsonPropertyName("enableCollectionRows")]
    public bool? EnableCollectionRows { get; set; }

    /// <summary>Gets or sets whether recently added rows are enabled.</summary>
    [JsonPropertyName("enableRecentlyAddedRows")]
    public bool? EnableRecentlyAddedRows { get; set; }

    /// <summary>Gets or sets whether recommended rows are enabled.</summary>
    [JsonPropertyName("enableRecommendedRows")]
    public bool? EnableRecommendedRows { get; set; }
}

/// <summary>
/// Partial featured cache settings patch.
/// </summary>
public sealed class PtvCacheSettingsPatch
{
    /// <summary>Gets or sets featured cache refresh interval in hours.</summary>
    [JsonPropertyName("refreshIntervalHours")]
    public int? RefreshIntervalHours { get; set; }
}

/// <summary>
/// Partial performance settings patch.
/// </summary>
public sealed class PtvPerformanceSettingsPatch
{
    /// <summary>Gets or sets max cache payload bytes.</summary>
    [JsonPropertyName("maxCachePayloadBytes")]
    public int? MaxCachePayloadBytes { get; set; }

    /// <summary>Gets or sets image preload limit.</summary>
    [JsonPropertyName("imagePreloadLimit")]
    public int? ImagePreloadLimit { get; set; }

    /// <summary>Gets or sets whether animated rows are enabled.</summary>
    [JsonPropertyName("enableAnimatedRows")]
    public bool? EnableAnimatedRows { get; set; }

    /// <summary>Gets or sets whether backdrop blur is enabled.</summary>
    [JsonPropertyName("enableBackdropBlur")]
    public bool? EnableBackdropBlur { get; set; }

    /// <summary>Gets or sets whether low power disables blur.</summary>
    [JsonPropertyName("lowPowerDisableBlur")]
    public bool? LowPowerDisableBlur { get; set; }

    /// <summary>Gets or sets whether low power disables animations.</summary>
    [JsonPropertyName("lowPowerDisableAnimations")]
    public bool? LowPowerDisableAnimations { get; set; }
}

/// <summary>
/// Partial TMDb settings patch.
/// </summary>
public sealed class PtvTmdbSettingsPatch
{
    /// <summary>Gets or sets whether TMDb is enabled.</summary>
    [JsonPropertyName("tmdbEnabled")]
    public bool? TmdbEnabled { get; set; }

    /// <summary>Gets or sets a write-only TMDb API token replacement.</summary>
    [JsonPropertyName("tmdbApiToken")]
    public string? TmdbApiToken { get; set; }

    /// <summary>Gets or sets TMDb language.</summary>
    [JsonPropertyName("tmdbLanguage")]
    public string? TmdbLanguage { get; set; }

    /// <summary>Gets or sets TMDb region.</summary>
    [JsonPropertyName("tmdbRegion")]
    public string? TmdbRegion { get; set; }

    /// <summary>Gets or sets whether TMDb influences row accuracy.</summary>
    [JsonPropertyName("useTmdbForRowAccuracy")]
    public bool? UseTmdbForRowAccuracy { get; set; }
}

/// <summary>
/// Partial music metadata lookup settings patch. Discogs token is write-only.
/// </summary>
public sealed class PtvMusicMetadataSettingsPatch
{
    /// <summary>Gets or sets whether MusicBrainz lookup is enabled.</summary>
    [JsonPropertyName("musicBrainzEnabled")]
    public bool? MusicBrainzEnabled { get; set; }

    /// <summary>Gets or sets whether Discogs lookup is enabled.</summary>
    [JsonPropertyName("discogsEnabled")]
    public bool? DiscogsEnabled { get; set; }

    /// <summary>Gets or sets a write-only Discogs token replacement.</summary>
    [JsonPropertyName("discogsToken")]
    public string? DiscogsToken { get; set; }

    /// <summary>Gets or sets the maximum candidate count per lookup.</summary>
    [JsonPropertyName("maxResults")]
    public int? MaxResults { get; set; }
}

/// <summary>
/// Partial Google Books metadata lookup settings patch. API key is write-only.
/// </summary>
public sealed class PtvGoogleBooksSettingsPatch
{
    /// <summary>Gets or sets whether native Google Books lookup is enabled.</summary>
    [JsonPropertyName("googleBooksEnabled")]
    public bool? GoogleBooksEnabled { get; set; }

    /// <summary>Gets or sets whether the saved Google Books API key should be cleared.</summary>
    [JsonPropertyName("clearGoogleBooksApiKey")]
    public bool? ClearGoogleBooksApiKey { get; set; }

    /// <summary>Gets or sets a write-only Google Books API key replacement.</summary>
    [JsonPropertyName("googleBooksApiKey")]
    public string? GoogleBooksApiKey { get; set; }

    /// <summary>Gets or sets the maximum candidate count per lookup.</summary>
    [JsonPropertyName("maxResults")]
    public int? MaxResults { get; set; }
}

/// <summary>
/// Partial Jellyseerr settings patch. API key is write-only.
/// </summary>
public sealed class PtvSeerrSettingsPatch
{
    /// <summary>Gets or sets whether Jellyseerr integration is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool? Enabled { get; set; }

    /// <summary>Gets or sets the display name.</summary>
    [JsonPropertyName("displayName")]
    public string? DisplayName { get; set; }

    /// <summary>Gets or sets the internal URL.</summary>
    [JsonPropertyName("internalUrl")]
    public string? InternalUrl { get; set; }

    /// <summary>Gets or sets the external URL.</summary>
    [JsonPropertyName("externalUrl")]
    public string? ExternalUrl { get; set; }

    /// <summary>Gets or sets a write-only API key replacement.</summary>
    [JsonPropertyName("apiKey")]
    public string? ApiKey { get; set; }

    /// <summary>Gets or sets whether request pages are enabled.</summary>
    [JsonPropertyName("enableRequestsPage")]
    public bool? EnableRequestsPage { get; set; }

    /// <summary>Gets or sets whether search integration is enabled.</summary>
    [JsonPropertyName("enableSearchIntegration")]
    public bool? EnableSearchIntegration { get; set; }

    /// <summary>Gets or sets whether auto-request is enabled.</summary>
    [JsonPropertyName("enableAutoRequest")]
    public bool? EnableAutoRequest { get; set; }

    /// <summary>Gets or sets whether requests open inside PiggieTV.</summary>
    [JsonPropertyName("openRequestsInPtv")]
    public bool? OpenRequestsInPtv { get; set; }

    /// <summary>Gets or sets whether external fallback is enabled.</summary>
    [JsonPropertyName("openExternalFallback")]
    public bool? OpenExternalFallback { get; set; }
}

/// <summary>
/// Partial *Arr integration settings patch.
/// </summary>
public sealed class PtvArrSettingsPatch
{
    /// <summary>Gets or sets Sonarr updates.</summary>
    [JsonPropertyName("sonarr")]
    public PtvArrServiceSettingsPatch? Sonarr { get; set; }

    /// <summary>Gets or sets Radarr updates.</summary>
    [JsonPropertyName("radarr")]
    public PtvArrServiceSettingsPatch? Radarr { get; set; }

    /// <summary>Gets or sets Lidarr updates.</summary>
    [JsonPropertyName("lidarr")]
    public PtvArrServiceSettingsPatch? Lidarr { get; set; }

    /// <summary>Gets or sets Prowlarr updates.</summary>
    [JsonPropertyName("prowlarr")]
    public PtvArrServiceSettingsPatch? Prowlarr { get; set; }
}

/// <summary>
/// Partial individual *Arr service settings patch.
/// </summary>
public sealed class PtvArrServiceSettingsPatch
{
    /// <summary>Gets or sets whether the service is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool? Enabled { get; set; }

    /// <summary>Gets or sets the internal URL.</summary>
    [JsonPropertyName("internalUrl")]
    public string? InternalUrl { get; set; }

    /// <summary>Gets or sets the external URL.</summary>
    [JsonPropertyName("externalUrl")]
    public string? ExternalUrl { get; set; }

    /// <summary>Gets or sets a write-only API key replacement.</summary>
    [JsonPropertyName("apiKey")]
    public string? ApiKey { get; set; }
}

/// <summary>
/// Partial download provider settings patch.
/// </summary>
public sealed class PtvDownloadSettingsPatch
{
    /// <summary>Gets or sets whether downloads integration is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool? Enabled { get; set; }

    /// <summary>Gets or sets provider name.</summary>
    [JsonPropertyName("provider")]
    public string? Provider { get; set; }

    /// <summary>Gets or sets the internal URL.</summary>
    [JsonPropertyName("internalUrl")]
    public string? InternalUrl { get; set; }

    /// <summary>Gets or sets the external URL.</summary>
    [JsonPropertyName("externalUrl")]
    public string? ExternalUrl { get; set; }

    /// <summary>Gets or sets a write-only username replacement.</summary>
    [JsonPropertyName("username")]
    public string? Username { get; set; }

    /// <summary>Gets or sets a write-only password replacement.</summary>
    [JsonPropertyName("password")]
    public string? Password { get; set; }
}

/// <summary>
/// Partial tag row/filter settings patch.
/// </summary>
public sealed class PtvTagSettingsPatch
{
    /// <summary>Gets or sets whether tag features are enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool? Enabled { get; set; }

    /// <summary>Gets or sets whether tag rows are enabled.</summary>
    [JsonPropertyName("enableTagRows")]
    public bool? EnableTagRows { get; set; }

    /// <summary>Gets or sets whether tag filters are enabled.</summary>
    [JsonPropertyName("enableTagFilters")]
    public bool? EnableTagFilters { get; set; }

    /// <summary>Gets or sets included tags.</summary>
    [JsonPropertyName("includeTags")]
    public List<string>? IncludeTags { get; set; }

    /// <summary>Gets or sets excluded tags.</summary>
    [JsonPropertyName("excludeTags")]
    public List<string>? ExcludeTags { get; set; }

    /// <summary>Gets or sets custom row definitions.</summary>
    [JsonPropertyName("rowDefinitions")]
    public List<TagRowDefinition>? RowDefinitions { get; set; }
}

/// <summary>
/// Partial random discovery settings patch.
/// </summary>
public sealed class PtvRandomSettingsPatch
{
    /// <summary>Gets or sets whether random discovery is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool? Enabled { get; set; }

    /// <summary>Gets or sets whether random movie is enabled.</summary>
    [JsonPropertyName("enableRandomMovie")]
    public bool? EnableRandomMovie { get; set; }

    /// <summary>Gets or sets whether random episode is enabled.</summary>
    [JsonPropertyName("enableRandomEpisode")]
    public bool? EnableRandomEpisode { get; set; }

    /// <summary>Gets or sets whether random anime is enabled.</summary>
    [JsonPropertyName("enableRandomAnime")]
    public bool? EnableRandomAnime { get; set; }

    /// <summary>Gets or sets whether current-library random is enabled.</summary>
    [JsonPropertyName("enableRandomFromCurrentLibrary")]
    public bool? EnableRandomFromCurrentLibrary { get; set; }

    /// <summary>Gets or sets whether parental ratings are respected.</summary>
    [JsonPropertyName("respectParentalRating")]
    public bool? RespectParentalRating { get; set; }

    /// <summary>Gets or sets whether hidden content is respected.</summary>
    [JsonPropertyName("respectHiddenContent")]
    public bool? RespectHiddenContent { get; set; }

    /// <summary>Gets or sets whether unwatched-only option is shown.</summary>
    [JsonPropertyName("useUnwatchedOnlyOption")]
    public bool? UseUnwatchedOnlyOption { get; set; }

    /// <summary>Gets or sets random action behavior.</summary>
    [JsonPropertyName("behavior")]
    public string? Behavior { get; set; }
}

/// <summary>
/// Public TMDb settings DTO that never returns the stored token.
/// </summary>
public sealed class PtvPublicTmdbSettings
{
    /// <summary>Gets or sets a value indicating whether TMDb enrichment is enabled.</summary>
    [JsonPropertyName("tmdbEnabled")]
    public bool TmdbEnabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether a TMDb API token is configured.</summary>
    [JsonPropertyName("tmdbApiTokenConfigured")]
    public bool TmdbApiTokenConfigured { get; set; }

    /// <summary>Gets or sets a write-only TMDb API token replacement.</summary>
    [JsonPropertyName("tmdbApiToken")]
    public string? TmdbApiToken { get; set; }

    /// <summary>Gets or sets the TMDb language.</summary>
    [JsonPropertyName("tmdbLanguage")]
    public string TmdbLanguage { get; set; } = "en-US";

    /// <summary>Gets or sets the TMDb region.</summary>
    [JsonPropertyName("tmdbRegion")]
    public string TmdbRegion { get; set; } = "US";

    /// <summary>Gets or sets a value indicating whether TMDb should influence row matching.</summary>
    [JsonPropertyName("useTmdbForRowAccuracy")]
    public bool UseTmdbForRowAccuracy { get; set; } = true;

    /// <summary>
    /// Creates a public TMDb DTO from plugin configuration.
    /// </summary>
    /// <param name="configuration">Plugin configuration.</param>
    /// <returns>Public TMDb settings DTO.</returns>
    public static PtvPublicTmdbSettings FromConfiguration(PluginConfiguration configuration)
    {
        var tmdbSettings = configuration.TmdbSettings;
        var hasToken = !string.IsNullOrWhiteSpace(tmdbSettings.TmdbApiToken)
            || !string.IsNullOrWhiteSpace(configuration.TmdbReadAccessToken)
            || !string.IsNullOrWhiteSpace(configuration.TmdbApiKey)
            || !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PTV_TMDB_READ_ACCESS_TOKEN"))
            || !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PTV_TMDB_API_KEY"));

        return new PtvPublicTmdbSettings
        {
            TmdbApiToken = null,
            TmdbApiTokenConfigured = hasToken,
            TmdbEnabled = tmdbSettings.TmdbEnabled,
            TmdbLanguage = tmdbSettings.TmdbLanguage,
            TmdbRegion = tmdbSettings.TmdbRegion,
            UseTmdbForRowAccuracy = tmdbSettings.UseTmdbForRowAccuracy
        };
    }
}

/// <summary>
/// Public music metadata lookup settings DTO that never returns the stored Discogs token.
/// </summary>
public sealed class PtvPublicMusicMetadataSettings
{
    /// <summary>Gets or sets a value indicating whether MusicBrainz lookup is enabled.</summary>
    [JsonPropertyName("musicBrainzEnabled")]
    public bool MusicBrainzEnabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether Discogs lookup is enabled.</summary>
    [JsonPropertyName("discogsEnabled")]
    public bool DiscogsEnabled { get; set; }

    /// <summary>Gets or sets a value indicating whether a Discogs token is configured.</summary>
    [JsonPropertyName("discogsTokenConfigured")]
    public bool DiscogsTokenConfigured { get; set; }

    /// <summary>Gets or sets a write-only Discogs token replacement.</summary>
    [JsonPropertyName("discogsToken")]
    public string? DiscogsToken { get; set; }

    /// <summary>Gets or sets the maximum candidate count per lookup.</summary>
    [JsonPropertyName("maxResults")]
    public int MaxResults { get; set; } = 6;

    /// <summary>
    /// Creates public music metadata lookup settings.
    /// </summary>
    /// <param name="configuration">Plugin configuration.</param>
    /// <returns>Public music metadata settings.</returns>
    public static PtvPublicMusicMetadataSettings FromConfiguration(PluginConfiguration configuration)
    {
        var settings = configuration.MusicMetadataSettings;

        return new PtvPublicMusicMetadataSettings
        {
            DiscogsEnabled = settings.DiscogsEnabled,
            DiscogsToken = null,
            DiscogsTokenConfigured = !string.IsNullOrWhiteSpace(settings.DiscogsToken),
            MaxResults = settings.MaxResults,
            MusicBrainzEnabled = settings.MusicBrainzEnabled
        };
    }
}

/// <summary>
/// Public Google Books metadata lookup settings DTO that never returns the stored API key.
/// </summary>
public sealed class PtvPublicGoogleBooksSettings
{
    /// <summary>Gets or sets a value indicating whether Google Books lookup is enabled.</summary>
    [JsonPropertyName("googleBooksEnabled")]
    public bool GoogleBooksEnabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether a Google Books API key is configured.</summary>
    [JsonPropertyName("googleBooksApiKeyConfigured")]
    public bool GoogleBooksApiKeyConfigured { get; set; }

    /// <summary>Gets or sets a write-only Google Books API key replacement.</summary>
    [JsonPropertyName("googleBooksApiKey")]
    public string? GoogleBooksApiKey { get; set; }

    /// <summary>Gets or sets the maximum candidate count per lookup.</summary>
    [JsonPropertyName("maxResults")]
    public int MaxResults { get; set; } = 10;

    /// <summary>
    /// Creates public Google Books metadata lookup settings.
    /// </summary>
    /// <param name="configuration">Plugin configuration.</param>
    /// <returns>Public Google Books metadata settings.</returns>
    public static PtvPublicGoogleBooksSettings FromConfiguration(PluginConfiguration configuration)
    {
        var settings = configuration.GoogleBooksSettings;

        return new PtvPublicGoogleBooksSettings
        {
            GoogleBooksApiKey = null,
            GoogleBooksApiKeyConfigured = !string.IsNullOrWhiteSpace(settings.GoogleBooksApiKey)
                || !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PTV_GOOGLE_BOOKS_API_KEY")),
            GoogleBooksEnabled = settings.GoogleBooksEnabled,
            MaxResults = settings.MaxResults
        };
    }
}

/// <summary>
/// Public Jellyseerr settings DTO that never returns the stored API key.
/// </summary>
public sealed class PtvPublicSeerrSettings
{
    /// <summary>Gets or sets whether Jellyseerr integration is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    /// <summary>Gets or sets the display name.</summary>
    [JsonPropertyName("displayName")]
    public string DisplayName { get; set; } = "Jellyseerr";

    /// <summary>Gets or sets the internal URL.</summary>
    [JsonPropertyName("internalUrl")]
    public string InternalUrl { get; set; } = "http://10.16.0.226:5055";

    /// <summary>Gets or sets the external URL.</summary>
    [JsonPropertyName("externalUrl")]
    public string ExternalUrl { get; set; } = "https://request.piggietv.com";

    /// <summary>Gets or sets whether an API key is configured.</summary>
    [JsonPropertyName("apiKeyConfigured")]
    public bool ApiKeyConfigured { get; set; }

    /// <summary>Gets or sets a write-only API key replacement.</summary>
    [JsonPropertyName("apiKey")]
    public string? ApiKey { get; set; }

    /// <summary>Gets or sets whether request pages are enabled.</summary>
    [JsonPropertyName("enableRequestsPage")]
    public bool EnableRequestsPage { get; set; } = true;

    /// <summary>Gets or sets whether search integration is enabled.</summary>
    [JsonPropertyName("enableSearchIntegration")]
    public bool EnableSearchIntegration { get; set; } = true;

    /// <summary>Gets or sets whether auto-request is enabled.</summary>
    [JsonPropertyName("enableAutoRequest")]
    public bool EnableAutoRequest { get; set; }

    /// <summary>Gets or sets whether requests open inside PiggieTV.</summary>
    [JsonPropertyName("openRequestsInPtv")]
    public bool OpenRequestsInPtv { get; set; } = true;

    /// <summary>Gets or sets whether external fallback is enabled.</summary>
    [JsonPropertyName("openExternalFallback")]
    public bool OpenExternalFallback { get; set; } = true;

    /// <summary>Creates public Jellyseerr settings.</summary>
    /// <param name="configuration">Plugin configuration.</param>
    /// <returns>Public Jellyseerr settings.</returns>
    public static PtvPublicSeerrSettings FromConfiguration(PluginConfiguration configuration)
    {
        var settings = configuration.SeerrSettings;

        return new PtvPublicSeerrSettings
        {
            ApiKey = null,
            ApiKeyConfigured = !string.IsNullOrWhiteSpace(settings.ApiKey),
            DisplayName = settings.DisplayName,
            Enabled = settings.Enabled,
            EnableAutoRequest = settings.EnableAutoRequest,
            EnableRequestsPage = settings.EnableRequestsPage,
            EnableSearchIntegration = settings.EnableSearchIntegration,
            ExternalUrl = settings.ExternalUrl,
            InternalUrl = settings.InternalUrl,
            OpenExternalFallback = settings.OpenExternalFallback,
            OpenRequestsInPtv = settings.OpenRequestsInPtv
        };
    }
}

/// <summary>
/// Public *Arr settings DTO that never returns API keys.
/// </summary>
public sealed class PtvPublicArrSettings
{
    /// <summary>Gets or sets public Sonarr settings.</summary>
    [JsonPropertyName("sonarr")]
    public PtvPublicArrServiceSettings Sonarr { get; set; } = new();

    /// <summary>Gets or sets public Radarr settings.</summary>
    [JsonPropertyName("radarr")]
    public PtvPublicArrServiceSettings Radarr { get; set; } = new();

    /// <summary>Gets or sets public Lidarr settings.</summary>
    [JsonPropertyName("lidarr")]
    public PtvPublicArrServiceSettings Lidarr { get; set; } = new();

    /// <summary>Gets or sets public Prowlarr settings.</summary>
    [JsonPropertyName("prowlarr")]
    public PtvPublicArrServiceSettings Prowlarr { get; set; } = new();

    /// <summary>Creates public *Arr settings.</summary>
    /// <param name="configuration">Plugin configuration.</param>
    /// <returns>Public *Arr settings.</returns>
    public static PtvPublicArrSettings FromConfiguration(PluginConfiguration configuration)
    {
        return new PtvPublicArrSettings
        {
            Sonarr = PtvPublicArrServiceSettings.FromConfiguration(configuration.ArrSettings.Sonarr),
            Radarr = PtvPublicArrServiceSettings.FromConfiguration(configuration.ArrSettings.Radarr),
            Lidarr = PtvPublicArrServiceSettings.FromConfiguration(configuration.ArrSettings.Lidarr),
            Prowlarr = PtvPublicArrServiceSettings.FromConfiguration(configuration.ArrSettings.Prowlarr)
        };
    }
}

/// <summary>
/// Public individual *Arr service settings DTO.
/// </summary>
public sealed class PtvPublicArrServiceSettings
{
    /// <summary>Gets or sets whether the service is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    /// <summary>Gets or sets the internal URL.</summary>
    [JsonPropertyName("internalUrl")]
    public string InternalUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets the external URL.</summary>
    [JsonPropertyName("externalUrl")]
    public string ExternalUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets whether an API key is configured.</summary>
    [JsonPropertyName("apiKeyConfigured")]
    public bool ApiKeyConfigured { get; set; }

    /// <summary>Gets or sets a write-only API key replacement.</summary>
    [JsonPropertyName("apiKey")]
    public string? ApiKey { get; set; }

    /// <summary>Creates public service settings.</summary>
    /// <param name="settings">Private service settings.</param>
    /// <returns>Public service settings.</returns>
    public static PtvPublicArrServiceSettings FromConfiguration(ArrServiceSettings settings)
    {
        return new PtvPublicArrServiceSettings
        {
            ApiKey = null,
            ApiKeyConfigured = !string.IsNullOrWhiteSpace(settings.ApiKey),
            Enabled = settings.Enabled,
            ExternalUrl = settings.ExternalUrl,
            InternalUrl = settings.InternalUrl
        };
    }
}

/// <summary>
/// Public download settings DTO that never returns credentials.
/// </summary>
public sealed class PtvPublicDownloadSettings
{
    /// <summary>Gets or sets whether download integration is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    /// <summary>Gets or sets the provider name.</summary>
    [JsonPropertyName("provider")]
    public string Provider { get; set; } = "qbittorrent";

    /// <summary>Gets or sets the internal URL.</summary>
    [JsonPropertyName("internalUrl")]
    public string InternalUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets the external URL.</summary>
    [JsonPropertyName("externalUrl")]
    public string ExternalUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets whether a username is configured.</summary>
    [JsonPropertyName("usernameConfigured")]
    public bool UsernameConfigured { get; set; }

    /// <summary>Gets or sets whether a password is configured.</summary>
    [JsonPropertyName("passwordConfigured")]
    public bool PasswordConfigured { get; set; }

    /// <summary>Gets or sets a write-only username replacement.</summary>
    [JsonPropertyName("username")]
    public string? Username { get; set; }

    /// <summary>Gets or sets a write-only password replacement.</summary>
    [JsonPropertyName("password")]
    public string? Password { get; set; }

    /// <summary>Creates public download settings.</summary>
    /// <param name="configuration">Plugin configuration.</param>
    /// <returns>Public download settings.</returns>
    public static PtvPublicDownloadSettings FromConfiguration(PluginConfiguration configuration)
    {
        var settings = configuration.DownloadSettings;

        return new PtvPublicDownloadSettings
        {
            Enabled = settings.Enabled,
            ExternalUrl = settings.ExternalUrl,
            InternalUrl = settings.InternalUrl,
            Password = null,
            PasswordConfigured = !string.IsNullOrWhiteSpace(settings.Password),
            Provider = settings.Provider,
            Username = null,
            UsernameConfigured = !string.IsNullOrWhiteSpace(settings.Username)
        };
    }
}
