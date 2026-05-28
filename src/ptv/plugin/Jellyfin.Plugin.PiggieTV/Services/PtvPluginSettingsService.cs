using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// File-backed Jellyfin plugin configuration service.
/// </summary>
public sealed class PtvPluginSettingsService : IPtvPluginSettingsService
{
    private readonly ILogger<PtvPluginSettingsService> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvPluginSettingsService"/> class.
    /// </summary>
    /// <param name="logger">Logger.</param>
    public PtvPluginSettingsService(ILogger<PtvPluginSettingsService> logger)
    {
        _logger = logger;
        _logger.LogInformation("PiggieTV plugin settings service constructed.");
    }

    /// <inheritdoc />
    public PtvPluginSettingsDto GetSettings()
    {
        _logger.LogInformation("PiggieTV plugin settings load started.");
        var configuration = GetConfiguration();

        PtvPluginSettingsNormalizer.Normalize(configuration);

        _logger.LogInformation("PiggieTV plugin settings load finished.");

        return PtvPluginSettingsDto.FromConfiguration(configuration);
    }

    /// <inheritdoc />
    public PtvPluginSettingsDto SaveSettings(PtvPluginSettingsPatchDto settings)
    {
        var configuration = GetConfiguration();

        PtvPluginSettingsNormalizer.Normalize(configuration);
        configuration.FeatureSettings ??= new FeatureSettings();
        configuration.HeroSettings ??= new HeroSettings();
        configuration.RowSettings ??= new RowSettings();
        configuration.Rows ??= RowBuilderSettings.CreateDefault();
        configuration.CacheSettings ??= new CacheSettings();
        configuration.PerformanceSettings ??= new PerformanceSettings();
        configuration.TmdbSettings ??= new TmdbSettings();
        configuration.SeerrSettings ??= new SeerrSettings();
        configuration.JfaGoSettings ??= new JfaGoSettings();
        configuration.ArrSettings ??= new ArrSettings();
        configuration.DownloadSettings ??= new DownloadSettings();
        configuration.TagSettings ??= new TagSettings();
        configuration.RandomSettings ??= new RandomSettings();

        var oldRefreshIntervalHours = configuration.CacheSettings.RefreshIntervalHours;
        var oldHeroMaxItems = configuration.HeroSettings.HeroMaxItems;
        var patchKeys = DescribePatchKeys(settings);

        ApplyFeatureSettingsPatch(configuration.FeatureSettings, settings.FeatureSettings);
        ApplyHeroSettingsPatch(configuration.HeroSettings, settings.HeroSettings);
        ApplyRowSettingsPatch(configuration.RowSettings, settings.RowSettings);
        ApplyRowsPatch(configuration, settings.Rows);
        ApplyCacheSettingsPatch(configuration.CacheSettings, settings.CacheSettings ?? settings.Cache);
        ApplyPerformanceSettingsPatch(configuration.PerformanceSettings, settings.PerformanceSettings);
        ApplyTmdbSettingsPatch(configuration, settings.TmdbSettings);
        ApplySeerrSettingsPatch(configuration.SeerrSettings, settings.SeerrSettings);
        ApplyJfaGoSettingsPatch(configuration.JfaGoSettings, settings.JfaGoSettings);
        ApplyArrSettingsPatch(configuration.ArrSettings, settings.ArrSettings);
        ApplyDownloadSettingsPatch(configuration.DownloadSettings, settings.DownloadSettings);
        ApplyTagSettingsPatch(configuration.TagSettings, settings.TagSettings);
        ApplyRandomSettingsPatch(configuration.RandomSettings, settings.RandomSettings);

        PtvPluginSettingsNormalizer.Normalize(configuration);
        _logger.LogInformation(
            "Saving PiggieTV plugin settings. Sections={Sections}; Keys={Keys}; RefreshIntervalHours {OldRefreshIntervalHours}->{NewRefreshIntervalHours}; TtlMs={TtlMs}; HeroMaxItems {OldHeroMaxItems}->{NewHeroMaxItems}.",
            DescribeSections(settings),
            patchKeys,
            oldRefreshIntervalHours,
            configuration.CacheSettings.RefreshIntervalHours,
            configuration.CacheSettings.RefreshIntervalHours * 60L * 60L * 1000L,
            oldHeroMaxItems,
            configuration.HeroSettings.HeroMaxItems);
        SaveConfiguration(configuration);

        return PtvPluginSettingsDto.FromConfiguration(configuration);
    }

    /// <inheritdoc />
    public PtvPluginSettingsDto ResetSettings()
    {
        var configuration = new PluginConfiguration();

        PtvPluginSettingsNormalizer.Normalize(configuration);
        SaveConfiguration(configuration);

        return PtvPluginSettingsDto.FromConfiguration(configuration);
    }

    private static PluginConfiguration GetConfiguration()
    {
        return Plugin.Instance?.Configuration ?? new PluginConfiguration();
    }

    private void SaveConfiguration(PluginConfiguration configuration)
    {
        if (Plugin.Instance is null)
        {
            throw new InvalidOperationException("PiggieTV plugin instance is unavailable.");
        }

        _logger.LogInformation("Saving PiggieTV plugin settings.");
        Plugin.Instance.UpdateConfiguration(configuration);
    }

    private static void ApplyFeatureSettingsPatch(FeatureSettings target, PtvFeatureSettingsPatch? patch)
    {
        if (patch is null) return;

        target.HeroEnabled = patch.HeroEnabled ?? target.HeroEnabled;
        target.HomeRowsEnabled = patch.HomeRowsEnabled ?? target.HomeRowsEnabled;
        target.DynamicBackdropsEnabled = patch.DynamicBackdropsEnabled ?? target.DynamicBackdropsEnabled;
        target.TvLowPowerModeEnabled = patch.TvLowPowerModeEnabled ?? target.TvLowPowerModeEnabled;
        target.DebugModeEnabled = patch.DebugModeEnabled ?? target.DebugModeEnabled;
    }

    private static void ApplyHeroSettingsPatch(HeroSettings target, PtvHeroSettingsPatch? patch)
    {
        if (patch is null) return;

        target.HeroAutoRotateEnabled = patch.HeroAutoRotateEnabled ?? target.HeroAutoRotateEnabled;
        target.HeroRotationSeconds = patch.HeroRotationSeconds ?? target.HeroRotationSeconds;
        target.HeroMaxItems = patch.HeroMaxItems ?? target.HeroMaxItems;
        target.HeroBackdropMaxWidth = patch.HeroBackdropMaxWidth ?? target.HeroBackdropMaxWidth;
        target.HeroLogoMaxWidth = patch.HeroLogoMaxWidth ?? target.HeroLogoMaxWidth;
    }

    private static void ApplyRowSettingsPatch(RowSettings target, PtvRowSettingsPatch? patch)
    {
        if (patch is null) return;

        target.RowMaxItems = patch.RowMaxItems ?? target.RowMaxItems;
        target.RowRefreshHours = patch.RowRefreshHours ?? target.RowRefreshHours;
        target.EnableSeasonalRows = patch.EnableSeasonalRows ?? target.EnableSeasonalRows;
        target.EnableCollectionRows = patch.EnableCollectionRows ?? target.EnableCollectionRows;
        target.EnableRecentlyAddedRows = patch.EnableRecentlyAddedRows ?? target.EnableRecentlyAddedRows;
        target.EnableRecommendedRows = patch.EnableRecommendedRows ?? target.EnableRecommendedRows;
    }

    private static void ApplyRowsPatch(PluginConfiguration configuration, RowBuilderSettings? patch)
    {
        if (patch is null) return;

        configuration.Rows = PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(patch);
    }

    private static void ApplyCacheSettingsPatch(CacheSettings target, PtvCacheSettingsPatch? patch)
    {
        if (patch is null) return;

        target.RefreshIntervalHours = patch.RefreshIntervalHours ?? target.RefreshIntervalHours;
    }

    private static void ApplyPerformanceSettingsPatch(PerformanceSettings target, PtvPerformanceSettingsPatch? patch)
    {
        if (patch is null) return;

        target.MaxCachePayloadBytes = patch.MaxCachePayloadBytes ?? target.MaxCachePayloadBytes;
        target.ImagePreloadLimit = patch.ImagePreloadLimit ?? target.ImagePreloadLimit;
        target.EnableAnimatedRows = patch.EnableAnimatedRows ?? target.EnableAnimatedRows;
        target.EnableBackdropBlur = patch.EnableBackdropBlur ?? target.EnableBackdropBlur;
        target.LowPowerDisableBlur = patch.LowPowerDisableBlur ?? target.LowPowerDisableBlur;
        target.LowPowerDisableAnimations = patch.LowPowerDisableAnimations ?? target.LowPowerDisableAnimations;
    }

    private static void ApplyTmdbSettingsPatch(PluginConfiguration configuration, PtvTmdbSettingsPatch? patch)
    {
        if (patch is null) return;

        configuration.TmdbSettings ??= new TmdbSettings();
        configuration.TmdbSettings.TmdbEnabled = patch.TmdbEnabled ?? configuration.TmdbSettings.TmdbEnabled;
        configuration.TmdbSettings.TmdbLanguage = patch.TmdbLanguage ?? configuration.TmdbSettings.TmdbLanguage;
        configuration.TmdbSettings.TmdbRegion = patch.TmdbRegion ?? configuration.TmdbSettings.TmdbRegion;
        configuration.TmdbSettings.UseTmdbForRowAccuracy = patch.UseTmdbForRowAccuracy ?? configuration.TmdbSettings.UseTmdbForRowAccuracy;

        if (!string.IsNullOrWhiteSpace(patch.TmdbApiToken))
        {
            configuration.TmdbSettings.TmdbApiToken = patch.TmdbApiToken.Trim();
            configuration.TmdbReadAccessToken = configuration.TmdbSettings.TmdbApiToken;
        }
    }

    private static void ApplySeerrSettingsPatch(SeerrSettings target, PtvSeerrSettingsPatch? patch)
    {
        if (patch is null) return;

        target.Enabled = patch.Enabled ?? target.Enabled;
        target.DisplayName = patch.DisplayName ?? target.DisplayName;
        target.InternalUrl = patch.InternalUrl ?? target.InternalUrl;
        target.ExternalUrl = patch.ExternalUrl ?? target.ExternalUrl;
        target.EnableRequestsPage = patch.EnableRequestsPage ?? target.EnableRequestsPage;
        target.EnableSearchIntegration = patch.EnableSearchIntegration ?? target.EnableSearchIntegration;
        target.EnableAutoRequest = patch.EnableAutoRequest ?? target.EnableAutoRequest;
        target.OpenRequestsInPtv = patch.OpenRequestsInPtv ?? target.OpenRequestsInPtv;
        target.OpenExternalFallback = patch.OpenExternalFallback ?? target.OpenExternalFallback;

        if (!string.IsNullOrWhiteSpace(patch.ApiKey))
        {
            target.ApiKey = patch.ApiKey.Trim();
        }
    }

    private static void ApplyJfaGoSettingsPatch(JfaGoSettings target, PtvJfaGoSettingsPatch? patch)
    {
        if (patch is null) return;

        target.Enabled = patch.Enabled ?? target.Enabled;
        target.DisplayName = patch.DisplayName ?? target.DisplayName;
        target.InternalUrl = patch.InternalUrl ?? target.InternalUrl;
        target.ExternalUrl = patch.ExternalUrl ?? target.ExternalUrl;
        target.AllowSelfSignedTls = patch.AllowSelfSignedTls ?? patch.InsecureTls ?? target.AllowSelfSignedTls;

        if (!string.IsNullOrWhiteSpace(patch.ApiKey))
        {
            target.ApiKey = patch.ApiKey.Trim();
        }
    }

    private static void ApplyArrSettingsPatch(ArrSettings target, PtvArrSettingsPatch? patch)
    {
        if (patch is null) return;

        target.Sonarr ??= new ArrServiceSettings();
        target.Radarr ??= new ArrServiceSettings();
        target.Lidarr ??= new ArrServiceSettings();
        target.Prowlarr ??= new ArrServiceSettings();

        ApplyArrServiceSettingsPatch(target.Sonarr, patch.Sonarr);
        ApplyArrServiceSettingsPatch(target.Radarr, patch.Radarr);
        ApplyArrServiceSettingsPatch(target.Lidarr, patch.Lidarr);
        ApplyArrServiceSettingsPatch(target.Prowlarr, patch.Prowlarr);
    }

    private static void ApplyArrServiceSettingsPatch(ArrServiceSettings target, PtvArrServiceSettingsPatch? patch)
    {
        if (patch is null) return;

        target.Enabled = patch.Enabled ?? target.Enabled;
        target.InternalUrl = patch.InternalUrl ?? target.InternalUrl;
        target.ExternalUrl = patch.ExternalUrl ?? target.ExternalUrl;

        if (!string.IsNullOrWhiteSpace(patch.ApiKey))
        {
            target.ApiKey = patch.ApiKey.Trim();
        }
    }

    private static void ApplyDownloadSettingsPatch(DownloadSettings target, PtvDownloadSettingsPatch? patch)
    {
        if (patch is null) return;

        target.Enabled = patch.Enabled ?? target.Enabled;
        target.Provider = patch.Provider ?? target.Provider;
        target.InternalUrl = patch.InternalUrl ?? target.InternalUrl;
        target.ExternalUrl = patch.ExternalUrl ?? target.ExternalUrl;

        if (!string.IsNullOrWhiteSpace(patch.Username))
        {
            target.Username = patch.Username.Trim();
        }

        if (!string.IsNullOrWhiteSpace(patch.Password))
        {
            target.Password = patch.Password.Trim();
        }
    }

    private static void ApplyTagSettingsPatch(TagSettings target, PtvTagSettingsPatch? patch)
    {
        if (patch is null) return;

        target.Enabled = patch.Enabled ?? target.Enabled;
        target.EnableTagRows = patch.EnableTagRows ?? target.EnableTagRows;
        target.EnableTagFilters = patch.EnableTagFilters ?? target.EnableTagFilters;
        target.IncludeTags = patch.IncludeTags ?? target.IncludeTags;
        target.ExcludeTags = patch.ExcludeTags ?? target.ExcludeTags;
        target.RowDefinitions = patch.RowDefinitions ?? target.RowDefinitions;
    }

    private static void ApplyRandomSettingsPatch(RandomSettings target, PtvRandomSettingsPatch? patch)
    {
        if (patch is null) return;

        target.Enabled = patch.Enabled ?? target.Enabled;
        target.EnableRandomMovie = patch.EnableRandomMovie ?? target.EnableRandomMovie;
        target.EnableRandomEpisode = patch.EnableRandomEpisode ?? target.EnableRandomEpisode;
        target.EnableRandomAnime = patch.EnableRandomAnime ?? target.EnableRandomAnime;
        target.EnableRandomFromCurrentLibrary = patch.EnableRandomFromCurrentLibrary ?? target.EnableRandomFromCurrentLibrary;
        target.RespectParentalRating = patch.RespectParentalRating ?? target.RespectParentalRating;
        target.RespectHiddenContent = patch.RespectHiddenContent ?? target.RespectHiddenContent;
        target.UseUnwatchedOnlyOption = patch.UseUnwatchedOnlyOption ?? target.UseUnwatchedOnlyOption;
        target.Behavior = patch.Behavior ?? target.Behavior;
    }

    private static string DescribeSections(PtvPluginSettingsPatchDto settings)
    {
        var sections = new List<string>();

        if (settings.FeatureSettings is not null) sections.Add("featureSettings");
        if (settings.HeroSettings is not null) sections.Add("heroSettings");
        if (settings.RowSettings is not null) sections.Add("rowSettings");
        if (settings.Rows is not null) sections.Add("rows");
        if (settings.CacheSettings is not null) sections.Add("cacheSettings");
        if (settings.Cache is not null) sections.Add("cache");
        if (settings.PerformanceSettings is not null) sections.Add("performanceSettings");
        if (settings.TmdbSettings is not null) sections.Add("tmdbSettings");
        if (settings.SeerrSettings is not null) sections.Add("seerrSettings");
        if (settings.JfaGoSettings is not null) sections.Add("jfaGoSettings");
        if (settings.ArrSettings is not null) sections.Add("arrSettings");
        if (settings.DownloadSettings is not null) sections.Add("downloadSettings");
        if (settings.TagSettings is not null) sections.Add("tagSettings");
        if (settings.RandomSettings is not null) sections.Add("randomSettings");

        return sections.Count == 0 ? "none" : string.Join(",", sections);
    }

    private static string DescribePatchKeys(PtvPluginSettingsPatchDto settings)
    {
        var keys = new List<string>();

        if (settings.FeatureSettings is { } featureSettings)
        {
            AddIfPresent(keys, featureSettings.HeroEnabled, "featureSettings.heroEnabled");
            AddIfPresent(keys, featureSettings.HomeRowsEnabled, "featureSettings.homeRowsEnabled");
            AddIfPresent(keys, featureSettings.DynamicBackdropsEnabled, "featureSettings.dynamicBackdropsEnabled");
            AddIfPresent(keys, featureSettings.TvLowPowerModeEnabled, "featureSettings.tvLowPowerModeEnabled");
            AddIfPresent(keys, featureSettings.DebugModeEnabled, "featureSettings.debugModeEnabled");
        }

        if (settings.HeroSettings is { } heroSettings)
        {
            AddIfPresent(keys, heroSettings.HeroAutoRotateEnabled, "heroSettings.heroAutoRotateEnabled");
            AddIfPresent(keys, heroSettings.HeroRotationSeconds, "heroSettings.heroRotationSeconds");
            AddIfPresent(keys, heroSettings.HeroMaxItems, "heroSettings.heroMaxItems");
            AddIfPresent(keys, heroSettings.HeroBackdropMaxWidth, "heroSettings.heroBackdropMaxWidth");
            AddIfPresent(keys, heroSettings.HeroLogoMaxWidth, "heroSettings.heroLogoMaxWidth");
        }

        if (settings.RowSettings is { } rowSettings)
        {
            AddIfPresent(keys, rowSettings.RowMaxItems, "rowSettings.rowMaxItems");
            AddIfPresent(keys, rowSettings.RowRefreshHours, "rowSettings.rowRefreshHours");
            AddIfPresent(keys, rowSettings.EnableSeasonalRows, "rowSettings.enableSeasonalRows");
            AddIfPresent(keys, rowSettings.EnableCollectionRows, "rowSettings.enableCollectionRows");
            AddIfPresent(keys, rowSettings.EnableRecentlyAddedRows, "rowSettings.enableRecentlyAddedRows");
            AddIfPresent(keys, rowSettings.EnableRecommendedRows, "rowSettings.enableRecommendedRows");
        }

        if (settings.Rows is { } rows)
        {
            keys.Add($"rows.schemaVersion:{rows.SchemaVersion}");
            keys.Add($"rows.enabled:{rows.Enabled}");
            keys.Add($"rows.categories:{rows.Categories.Count}");
        }

        if ((settings.CacheSettings ?? settings.Cache) is { } cacheSettings)
        {
            AddIfPresent(keys, cacheSettings.RefreshIntervalHours, "cache.refreshIntervalHours");
        }

        if (settings.PerformanceSettings is { } performanceSettings)
        {
            AddIfPresent(keys, performanceSettings.MaxCachePayloadBytes, "performanceSettings.maxCachePayloadBytes");
            AddIfPresent(keys, performanceSettings.ImagePreloadLimit, "performanceSettings.imagePreloadLimit");
            AddIfPresent(keys, performanceSettings.EnableAnimatedRows, "performanceSettings.enableAnimatedRows");
            AddIfPresent(keys, performanceSettings.EnableBackdropBlur, "performanceSettings.enableBackdropBlur");
            AddIfPresent(keys, performanceSettings.LowPowerDisableBlur, "performanceSettings.lowPowerDisableBlur");
            AddIfPresent(keys, performanceSettings.LowPowerDisableAnimations, "performanceSettings.lowPowerDisableAnimations");
        }

        if (settings.TmdbSettings is { } tmdbSettings)
        {
            AddIfPresent(keys, tmdbSettings.TmdbEnabled, "tmdbSettings.tmdbEnabled");
            AddIfPresent(keys, tmdbSettings.TmdbLanguage, "tmdbSettings.tmdbLanguage");
            AddIfPresent(keys, tmdbSettings.TmdbRegion, "tmdbSettings.tmdbRegion");
            AddIfPresent(keys, tmdbSettings.UseTmdbForRowAccuracy, "tmdbSettings.useTmdbForRowAccuracy");

            if (tmdbSettings.TmdbApiToken is not null)
            {
                keys.Add("tmdbSettings.tmdbApiToken:<redacted>");
            }
        }

        if (settings.SeerrSettings is { } seerrSettings)
        {
            AddIfPresent(keys, seerrSettings.Enabled, "seerrSettings.enabled");
            AddIfPresent(keys, seerrSettings.DisplayName, "seerrSettings.displayName");
            AddIfPresent(keys, seerrSettings.InternalUrl, "seerrSettings.internalUrl");
            AddIfPresent(keys, seerrSettings.ExternalUrl, "seerrSettings.externalUrl");
            AddIfPresent(keys, seerrSettings.EnableRequestsPage, "seerrSettings.enableRequestsPage");
            AddIfPresent(keys, seerrSettings.EnableSearchIntegration, "seerrSettings.enableSearchIntegration");
            AddIfPresent(keys, seerrSettings.EnableAutoRequest, "seerrSettings.enableAutoRequest");
            AddIfPresent(keys, seerrSettings.OpenRequestsInPtv, "seerrSettings.openRequestsInPtv");
            AddIfPresent(keys, seerrSettings.OpenExternalFallback, "seerrSettings.openExternalFallback");

            if (seerrSettings.ApiKey is not null)
            {
                keys.Add("seerrSettings.apiKey:<redacted>");
            }
        }

        if (settings.JfaGoSettings is { } jfaGoSettings)
        {
            AddIfPresent(keys, jfaGoSettings.Enabled, "jfaGoSettings.enabled");
            AddIfPresent(keys, jfaGoSettings.DisplayName, "jfaGoSettings.displayName");
            AddIfPresent(keys, jfaGoSettings.InternalUrl, "jfaGoSettings.internalUrl");
            AddIfPresent(keys, jfaGoSettings.ExternalUrl, "jfaGoSettings.externalUrl");
            AddIfPresent(keys, jfaGoSettings.AllowSelfSignedTls, "jfaGoSettings.allowSelfSignedTls");

            if (jfaGoSettings.ApiKey is not null)
            {
                keys.Add("jfaGoSettings.apiKey:<redacted>");
            }
        }

        if (settings.ArrSettings is { } arrSettings)
        {
            AddArrServiceKeys(keys, arrSettings.Sonarr, "arrSettings.sonarr");
            AddArrServiceKeys(keys, arrSettings.Radarr, "arrSettings.radarr");
            AddArrServiceKeys(keys, arrSettings.Lidarr, "arrSettings.lidarr");
            AddArrServiceKeys(keys, arrSettings.Prowlarr, "arrSettings.prowlarr");
        }

        if (settings.DownloadSettings is { } downloadSettings)
        {
            AddIfPresent(keys, downloadSettings.Enabled, "downloadSettings.enabled");
            AddIfPresent(keys, downloadSettings.Provider, "downloadSettings.provider");
            AddIfPresent(keys, downloadSettings.InternalUrl, "downloadSettings.internalUrl");
            AddIfPresent(keys, downloadSettings.ExternalUrl, "downloadSettings.externalUrl");

            if (downloadSettings.Username is not null)
            {
                keys.Add("downloadSettings.username:<redacted>");
            }

            if (downloadSettings.Password is not null)
            {
                keys.Add("downloadSettings.password:<redacted>");
            }
        }

        if (settings.TagSettings is { } tagSettings)
        {
            AddIfPresent(keys, tagSettings.Enabled, "tagSettings.enabled");
            AddIfPresent(keys, tagSettings.EnableTagRows, "tagSettings.enableTagRows");
            AddIfPresent(keys, tagSettings.EnableTagFilters, "tagSettings.enableTagFilters");
            if (tagSettings.IncludeTags is not null) keys.Add("tagSettings.includeTags");
            if (tagSettings.ExcludeTags is not null) keys.Add("tagSettings.excludeTags");
            if (tagSettings.RowDefinitions is not null) keys.Add("tagSettings.rowDefinitions");
        }

        if (settings.RandomSettings is { } randomSettings)
        {
            AddIfPresent(keys, randomSettings.Enabled, "randomSettings.enabled");
            AddIfPresent(keys, randomSettings.EnableRandomMovie, "randomSettings.enableRandomMovie");
            AddIfPresent(keys, randomSettings.EnableRandomEpisode, "randomSettings.enableRandomEpisode");
            AddIfPresent(keys, randomSettings.EnableRandomAnime, "randomSettings.enableRandomAnime");
            AddIfPresent(keys, randomSettings.EnableRandomFromCurrentLibrary, "randomSettings.enableRandomFromCurrentLibrary");
            AddIfPresent(keys, randomSettings.RespectParentalRating, "randomSettings.respectParentalRating");
            AddIfPresent(keys, randomSettings.RespectHiddenContent, "randomSettings.respectHiddenContent");
            AddIfPresent(keys, randomSettings.UseUnwatchedOnlyOption, "randomSettings.useUnwatchedOnlyOption");
            AddIfPresent(keys, randomSettings.Behavior, "randomSettings.behavior");
        }

        return keys.Count == 0 ? "none" : string.Join(",", keys);
    }

    private static void AddIfPresent<T>(ICollection<string> keys, T? value, string key)
        where T : struct
    {
        if (value.HasValue) keys.Add(key);
    }

    private static void AddIfPresent(ICollection<string> keys, string? value, string key)
    {
        if (value is not null) keys.Add(key);
    }

    private static void AddArrServiceKeys(ICollection<string> keys, PtvArrServiceSettingsPatch? settings, string prefix)
    {
        if (settings is null) return;

        AddIfPresent(keys, settings.Enabled, $"{prefix}.enabled");
        AddIfPresent(keys, settings.InternalUrl, $"{prefix}.internalUrl");
        AddIfPresent(keys, settings.ExternalUrl, $"{prefix}.externalUrl");

        if (settings.ApiKey is not null)
        {
            keys.Add($"{prefix}.apiKey:<redacted>");
        }
    }
}
