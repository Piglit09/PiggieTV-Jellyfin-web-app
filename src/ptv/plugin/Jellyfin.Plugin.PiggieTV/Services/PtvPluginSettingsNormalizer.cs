using Jellyfin.Plugin.PiggieTV.Configuration;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Normalizes PiggieTV plugin settings and preserves safe defaults for older installs.
/// </summary>
public static class PtvPluginSettingsNormalizer
{
    private const int DefaultHeroMaxItems = 15;

    /// <summary>Minimum hero rotation interval in seconds.</summary>
    public const int MinHeroRotationSeconds = 5;

    /// <summary>Maximum hero rotation interval in seconds.</summary>
    public const int MaxHeroRotationSeconds = 120;

    /// <summary>Minimum hero item count.</summary>
    public const int MinHeroMaxItems = 1;

    /// <summary>Maximum hero item count.</summary>
    public const int MaxHeroMaxItems = 50;

    /// <summary>Minimum row item count.</summary>
    public const int MinRowMaxItems = 5;

    /// <summary>Maximum row item count.</summary>
    public const int MaxRowMaxItems = 100;

    /// <summary>Minimum row refresh interval in hours.</summary>
    public const int MinRowRefreshHours = 1;

    /// <summary>Maximum row refresh interval in hours.</summary>
    public const int MaxRowRefreshHours = 168;

    /// <summary>Legacy maximum configured row-builder categories.</summary>
    public const int MaxRowBuilderCategories = 40;

    /// <summary>Legacy maximum generated rows per random category.</summary>
    public const int MaxRowBuilderRandomRows = 24;

    /// <summary>Minimum featured cache refresh interval in hours.</summary>
    public const int MinCacheRefreshHours = 1;

    /// <summary>Maximum featured cache refresh interval in hours.</summary>
    public const int MaxCacheRefreshHours = 168;

    /// <summary>Minimum image preload limit.</summary>
    public const int MinImagePreloadLimit = 1;

    /// <summary>Maximum image preload limit.</summary>
    public const int MaxImagePreloadLimit = 10;

    /// <summary>Minimum cache payload size in bytes.</summary>
    public const int MinMaxCachePayloadBytes = 1_048_576;

    /// <summary>Maximum cache payload size in bytes.</summary>
    public const int MaxMaxCachePayloadBytes = 52_428_800;

    /// <summary>
    /// Normalizes a plugin configuration in place.
    /// </summary>
    /// <param name="configuration">Plugin configuration.</param>
    /// <returns>Normalized plugin configuration.</returns>
    public static PluginConfiguration Normalize(PluginConfiguration configuration)
    {
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
        configuration.ArrSettings.Sonarr ??= new ArrServiceSettings();
        configuration.ArrSettings.Radarr ??= new ArrServiceSettings();
        configuration.ArrSettings.Lidarr ??= new ArrServiceSettings();
        configuration.ArrSettings.Prowlarr ??= new ArrServiceSettings();

        configuration.HeroSettings.HeroRotationSeconds = Clamp(
            configuration.HeroSettings.HeroRotationSeconds,
            MinHeroRotationSeconds,
            MaxHeroRotationSeconds);
        configuration.HeroSettings.HeroMaxItems = NormalizeHeroMaxItems(configuration.HeroSettings.HeroMaxItems);
        configuration.HeroSettings.HeroBackdropMaxWidth = Clamp(
            configuration.HeroSettings.HeroBackdropMaxWidth,
            640,
            3840);
        configuration.HeroSettings.HeroLogoMaxWidth = Clamp(
            configuration.HeroSettings.HeroLogoMaxWidth,
            160,
            1600);

        configuration.RowSettings.RowMaxItems = Clamp(
            configuration.RowSettings.RowMaxItems,
            MinRowMaxItems,
            MaxRowMaxItems);
        configuration.RowSettings.RowRefreshHours = Clamp(
            configuration.RowSettings.RowRefreshHours,
            MinRowRefreshHours,
            MaxRowRefreshHours);
        NormalizeRowBuilderSettings(configuration.Rows);
        configuration.CacheSettings.RefreshIntervalHours = Clamp(
            configuration.CacheSettings.RefreshIntervalHours,
            MinCacheRefreshHours,
            MaxCacheRefreshHours);

        configuration.PerformanceSettings.MaxCachePayloadBytes = Clamp(
            configuration.PerformanceSettings.MaxCachePayloadBytes,
            MinMaxCachePayloadBytes,
            MaxMaxCachePayloadBytes);
        configuration.PerformanceSettings.ImagePreloadLimit = Clamp(
            configuration.PerformanceSettings.ImagePreloadLimit,
            MinImagePreloadLimit,
            MaxImagePreloadLimit);

        configuration.TmdbSettings.TmdbLanguage = CleanText(configuration.TmdbSettings.TmdbLanguage, "en-US");
        configuration.TmdbSettings.TmdbRegion = CleanText(configuration.TmdbSettings.TmdbRegion, "US");
        configuration.TmdbSettings.TmdbApiToken = CleanSecret(configuration.TmdbSettings.TmdbApiToken);

        configuration.SeerrSettings.DisplayName = CleanText(configuration.SeerrSettings.DisplayName, "Jellyseerr", 48);
        configuration.SeerrSettings.InternalUrl = CleanUrl(configuration.SeerrSettings.InternalUrl, "http://10.16.0.226:5055");
        configuration.SeerrSettings.ExternalUrl = CleanUrl(configuration.SeerrSettings.ExternalUrl, "https://request.piggietv.com");
        configuration.SeerrSettings.ApiKey = CleanSecret(configuration.SeerrSettings.ApiKey);

        configuration.JfaGoSettings.DisplayName = CleanText(configuration.JfaGoSettings.DisplayName, "jfa-go", 48);
        configuration.JfaGoSettings.InternalUrl = CleanUrl(configuration.JfaGoSettings.InternalUrl, string.Empty);
        configuration.JfaGoSettings.ExternalUrl = CleanUrl(configuration.JfaGoSettings.ExternalUrl, string.Empty);
        configuration.JfaGoSettings.ApiKey = CleanSecret(configuration.JfaGoSettings.ApiKey);

        NormalizeArrService(configuration.ArrSettings.Sonarr);
        NormalizeArrService(configuration.ArrSettings.Radarr);
        NormalizeArrService(configuration.ArrSettings.Lidarr);
        NormalizeArrService(configuration.ArrSettings.Prowlarr);

        configuration.DownloadSettings.Provider = CleanText(configuration.DownloadSettings.Provider, "qbittorrent", 32);
        configuration.DownloadSettings.InternalUrl = CleanUrl(configuration.DownloadSettings.InternalUrl, string.Empty);
        configuration.DownloadSettings.ExternalUrl = CleanUrl(configuration.DownloadSettings.ExternalUrl, string.Empty);
        configuration.DownloadSettings.Username = CleanSecret(configuration.DownloadSettings.Username);
        configuration.DownloadSettings.Password = CleanSecret(configuration.DownloadSettings.Password);

        configuration.TagSettings.IncludeTags = CleanStringList(configuration.TagSettings.IncludeTags, 80);
        configuration.TagSettings.ExcludeTags = CleanStringList(configuration.TagSettings.ExcludeTags, 80);
        configuration.TagSettings.RowDefinitions = configuration.TagSettings.RowDefinitions
            .Where(row => row is not null)
            .Select(NormalizeTagRow)
            .Where(row => !string.IsNullOrWhiteSpace(row.Id) && !string.IsNullOrWhiteSpace(row.Name))
            .Take(40)
            .ToList();

        configuration.RandomSettings.Behavior = CleanRandomBehavior(configuration.RandomSettings.Behavior);

        configuration.EnableTmdbMetadata = configuration.TmdbSettings.TmdbEnabled;
        configuration.TmdbReadAccessToken = configuration.TmdbSettings.TmdbApiToken ?? CleanSecret(configuration.TmdbReadAccessToken);
        configuration.TmdbApiKey = CleanSecret(configuration.TmdbApiKey);
        configuration.TmdbMaxEnrichmentItems = Clamp(
            configuration.TmdbMaxEnrichmentItems,
            0,
            600);

        return configuration;
    }

    /// <summary>
    /// Normalizes row-builder settings in place.
    /// </summary>
    /// <param name="settings">Row-builder settings.</param>
    /// <returns>Normalized row-builder settings.</returns>
    public static RowBuilderSettings NormalizeRowBuilderSettings(RowBuilderSettings? settings)
    {
        settings ??= RowBuilderSettings.CreateDefault();
        settings.Categories = (settings.Categories ?? [])
            .Where(category => category is not null)
            .Select(NormalizeRowBuilderCategory)
            .Where(category => !string.IsNullOrWhiteSpace(category.Id))
            .DistinctBy(category => category.Id, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if ((settings.Rules is null || settings.Rules.Count == 0) && settings.Categories.Count > 0)
        {
            settings.Rules = MigrateRowBuilderCategories(settings.Categories);
        }

        settings.SchemaVersion = 2;
        settings.DefaultsInitialized = true;
        settings.Rules = (settings.Rules ?? [])
            .Where(rule => rule is not null)
            .Select(NormalizeRowBuilderRule)
            .Where(rule => !string.IsNullOrWhiteSpace(rule.Id))
            .DistinctBy(rule => rule.Id, StringComparer.OrdinalIgnoreCase)
            .OrderBy(rule => rule.SortPriority)
            .ThenBy(rule => rule.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (settings.Rules.Count == 0)
        {
            settings.Rules = RowBuilderSettings.CreateDefault().Rules;
        }

        settings.Categories = [];

        return settings;
    }

    private static int Clamp(int value, int minimum, int maximum)
    {
        return Math.Clamp(value, minimum, maximum);
    }

    private static int NormalizeHeroMaxItems(int value)
    {
        if (value <= MinHeroMaxItems)
        {
            return DefaultHeroMaxItems;
        }

        return Clamp(value, MinHeroMaxItems, MaxHeroMaxItems);
    }

    private static void NormalizeArrService(ArrServiceSettings settings)
    {
        settings.InternalUrl = CleanUrl(settings.InternalUrl, string.Empty);
        settings.ExternalUrl = CleanUrl(settings.ExternalUrl, string.Empty);
        settings.ApiKey = CleanSecret(settings.ApiKey);
    }

    private static TagRowDefinition NormalizeTagRow(TagRowDefinition row)
    {
        row.Id = CleanIdentifier(row.Id, row.Name);
        row.Name = CleanText(row.Name, "Tag Row", 80);
        row.Tags = CleanStringList(row.Tags, 24);
        row.IncludeItemTypes = CleanStringList(row.IncludeItemTypes, 8);
        row.SortBy = CleanText(row.SortBy, "Random", 32);
        row.Limit = Clamp(row.Limit, 1, MaxRowMaxItems);

        if (row.IncludeItemTypes.Count == 0)
        {
            row.IncludeItemTypes = ["Movie", "Series"];
        }

        return row;
    }

    private static RowBuilderCategory NormalizeRowBuilderCategory(RowBuilderCategory category)
    {
        category.MediaType = CleanChoice(
            category.MediaType,
            "movies",
            ["movies", "shows", "cartoons", "anime", "mixed"]);
        category.SourceType = CleanChoice(
            category.SourceType,
            "genre",
            ["genre", "studio", "customTag"]);
        category.GenerationMode = CleanChoice(
            category.GenerationMode,
            "random",
            ["random", "specific"]);
        category.Id = CleanIdentifier(
            category.Id,
            $"{category.MediaType}-{category.SourceType}-{category.GenerationMode}");
        category.RowCount = Math.Max(0, category.RowCount);
        category.Entries = CleanStringList(category.Entries, 40);
        category.SourcePoolFilters = CleanStringList(category.SourcePoolFilters, 80);

        if (category.GenerationMode == "random" && category.RowCount <= 0)
        {
            category.RowCount = 6;
        }

        return category;
    }

    private static RowBuilderRule NormalizeRowBuilderRule(RowBuilderRule rule)
    {
        rule.MediaType = CleanChoice(
            rule.MediaType,
            "movies",
            ["movies", "shows", "cartoons", "anime", "music", "books", "liveTv", "mixed"]);
        rule.SourceType = CleanChoice(
            rule.SourceType,
            "genre",
            ["genre", "studio", "library", "collection", "requested", "continueWatching", "latest", "seasonal"]);
        rule.GenerationMode = CleanChoice(
            rule.GenerationMode,
            "random",
            ["random", "latest", "popular", "highestRated"]);
        rule.Name = CleanText(rule.Name, "New Row", 80);
        rule.Id = CleanIdentifier(rule.Id, rule.Name);
        rule.SourceValue = CleanText(GetDefaultRuleSourceValue(rule), string.Empty, 120);
        rule.ItemLimit = Clamp(rule.ItemLimit, 1, MaxRowMaxItems);
        rule.RowCount = Math.Max(0, rule.RowCount);
        rule.SubgenreRowCount = Math.Max(0, rule.SubgenreRowCount);
        rule.ProviderHints = CleanStringList(rule.ProviderHints, 32);
        rule.Tier = Clamp(rule.Tier, 0, 3);
        rule.Presentation = CleanChoice(
            rule.Presentation,
            "auto",
            ["auto", "featured", "standard", "compact", "mini", "library-hub"]);
        rule.GroupTitle = CleanText(rule.GroupTitle, string.Empty, 80);

        if (rule.SourceType == "seasonal")
        {
            rule.Seasonal ??= new RowSeasonalSettings();
            rule.Seasonal.Mode = CleanChoice(
                rule.Seasonal.Mode,
                "auto",
                ["auto", "halloween", "christmas", "thanksgiving", "valentines", "summer", "winter", "newYear", "custom"]);
            rule.Seasonal.StartMonth = NormalizeNullableDatePart(rule.Seasonal.StartMonth, 1, 12);
            rule.Seasonal.StartDay = NormalizeNullableDatePart(rule.Seasonal.StartDay, 1, 31);
            rule.Seasonal.EndMonth = NormalizeNullableDatePart(rule.Seasonal.EndMonth, 1, 12);
            rule.Seasonal.EndDay = NormalizeNullableDatePart(rule.Seasonal.EndDay, 1, 31);
        }
        else
        {
            rule.Seasonal = null;
        }

        return rule;
    }

    private static int? NormalizeNullableDatePart(int? value, int minimum, int maximum)
    {
        return value is null ? null : Clamp(value.Value, minimum, maximum);
    }

    private static string GetDefaultRuleSourceValue(RowBuilderRule rule)
    {
        if (!string.IsNullOrWhiteSpace(rule.SourceValue))
        {
            return rule.SourceValue;
        }

        return rule.SourceType switch
        {
            "continueWatching" => "continue",
            "latest" => rule.MediaType,
            "requested" => "jellyseerr",
            "seasonal" => rule.Seasonal?.Mode ?? "auto",
            _ => string.Empty
        };
    }

    private static List<RowBuilderRule> MigrateRowBuilderCategories(IEnumerable<RowBuilderCategory> categories)
    {
        var rules = new List<RowBuilderRule>();
        var priority = 100;

        foreach (var category in categories)
        {
            if (string.Equals(category.GenerationMode, "specific", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var entry in category.Entries)
                {
                    rules.Add(new RowBuilderRule
                    {
                        Id = CleanIdentifier($"{category.Id}-{entry}", category.Id),
                        Enabled = category.Enabled,
                        Name = CleanText(entry, category.Id, 80),
                        MediaType = category.MediaType,
                        SourceType = MapLegacySourceType(category.SourceType),
                        SourceValue = entry,
                        GenerationMode = "popular",
                        ItemLimit = MaxRowMaxItems,
                        RowCount = 1,
                        SortPriority = priority++
                    });
                }

                continue;
            }

            IEnumerable<string> sources = category.SourcePoolFilters.Count > 0
                ? category.SourcePoolFilters
                : [category.MediaType];

            foreach (var source in sources)
            {
                rules.Add(new RowBuilderRule
                {
                    Id = CleanIdentifier($"{category.Id}-{source}", category.Id),
                    Enabled = category.Enabled,
                    Name = CleanText(source, category.Id, 80),
                    MediaType = category.MediaType,
                    SourceType = MapLegacySourceType(category.SourceType),
                    SourceValue = source,
                    GenerationMode = "random",
                    ItemLimit = MaxRowMaxItems,
                    RowCount = Math.Max(1, category.RowCount),
                    SortPriority = priority++
                });
            }
        }

        return rules;
    }

    private static string MapLegacySourceType(string sourceType)
    {
        return sourceType switch
        {
            "studio" => "studio",
            "genre" => "genre",
            _ => "collection"
        };
    }

    private static string CleanText(string? value, string fallback, int maxLength = 16)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return fallback;
        }

        var cleaned = value.Trim();

        return cleaned.Length > maxLength ? cleaned[..maxLength] : cleaned;
    }

    private static string CleanUrl(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return fallback;
        }

        var cleaned = value.Trim();

        return cleaned.Length > 240 ? cleaned[..240] : cleaned;
    }

    private static string CleanIdentifier(string? value, string? fallback)
    {
        var source = string.IsNullOrWhiteSpace(value) ? fallback : value;
        var cleaned = new string((source ?? string.Empty)
            .Trim()
            .ToLowerInvariant()
            .Select(character => char.IsLetterOrDigit(character) ? character : '-')
            .ToArray());

        while (cleaned.Contains("--", StringComparison.Ordinal))
        {
            cleaned = cleaned.Replace("--", "-", StringComparison.Ordinal);
        }

        cleaned = cleaned.Trim('-');

        return cleaned.Length > 64 ? cleaned[..64] : cleaned;
    }

    private static List<string> CleanStringList(IEnumerable<string>? values, int maxItems)
    {
        if (values is null)
        {
            return [];
        }

        return values
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => CleanText(value, string.Empty, 80))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(maxItems)
            .ToList();
    }

    private static string CleanRandomBehavior(string? value)
    {
        var cleaned = CleanText(value, "details", 16).ToLowerInvariant();

        return cleaned is "play" or "details" ? cleaned : "details";
    }

    private static string CleanChoice(string? value, string fallback, IReadOnlyCollection<string> allowedValues)
    {
        var cleaned = CleanText(value, fallback, 32);
        var match = allowedValues.FirstOrDefault(allowed => string.Equals(allowed, cleaned, StringComparison.OrdinalIgnoreCase));

        return match ?? fallback;
    }

    private static string? CleanSecret(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
