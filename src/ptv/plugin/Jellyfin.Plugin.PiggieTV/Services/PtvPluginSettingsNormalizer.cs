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

    /// <summary>Minimum music metadata candidate count.</summary>
    public const int MinMusicMetadataResults = 1;

    /// <summary>Maximum music metadata candidate count.</summary>
    public const int MaxMusicMetadataResults = 12;

    /// <summary>Minimum Google Books candidate count.</summary>
    public const int MinGoogleBooksMetadataResults = 1;

    /// <summary>Maximum Google Books candidate count.</summary>
    public const int MaxGoogleBooksMetadataResults = 20;

    private const int MinRecommendationRowItems = 12;
    private const int MaxRecommendationAlbumRepeats = 2;
    private const int MaxRecommendationArtistRepeats = 1;
    private const int MaxRecommendationSeriesRepeats = 2;
    private const string SubgenresDisabledProviderHint = "ptv-subgenres-disabled";

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
        configuration.Recommendations ??= RecommendationRowSettings.CreateDefault();
        configuration.CacheSettings ??= new CacheSettings();
        configuration.PerformanceSettings ??= new PerformanceSettings();
        configuration.TmdbSettings ??= new TmdbSettings();
        configuration.MusicMetadataSettings ??= new MusicMetadataSettings();
        configuration.GoogleBooksSettings ??= new GoogleBooksSettings();
        configuration.SeerrSettings ??= new SeerrSettings();
        configuration.SignupSettings ??= new SignupSettings();
        configuration.ArrSettings ??= new ArrSettings();
        configuration.DownloadSettings ??= new DownloadSettings();
        configuration.TagSettings ??= new TagSettings();
        configuration.RandomSettings ??= new RandomSettings();
        configuration.ArrSettings.Sonarr ??= new ArrServiceSettings();
        configuration.ArrSettings.Radarr ??= new ArrServiceSettings();
        configuration.ArrSettings.Lidarr ??= new ArrServiceSettings();
        configuration.ArrSettings.Prowlarr ??= new ArrServiceSettings();

        configuration.FeatureSettings.PlaybackMode = CleanPlaybackMode(configuration.FeatureSettings.PlaybackMode);

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
        NormalizeRecommendationSettings(configuration.Recommendations);
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
        configuration.TmdbSettings.TmdbApiToken = CleanTmdbCredential(configuration.TmdbSettings.TmdbApiToken);

        configuration.MusicMetadataSettings.DiscogsToken = CleanSecret(configuration.MusicMetadataSettings.DiscogsToken);
        configuration.MusicMetadataSettings.MaxResults = Clamp(
            configuration.MusicMetadataSettings.MaxResults,
            MinMusicMetadataResults,
            MaxMusicMetadataResults);

        configuration.GoogleBooksSettings.GoogleBooksApiKey = CleanSecret(configuration.GoogleBooksSettings.GoogleBooksApiKey);
        configuration.GoogleBooksSettings.MaxResults = Clamp(
            configuration.GoogleBooksSettings.MaxResults,
            MinGoogleBooksMetadataResults,
            MaxGoogleBooksMetadataResults);

        configuration.SeerrSettings.DisplayName = CleanText(configuration.SeerrSettings.DisplayName, "Jellyseerr", 48);
        configuration.SeerrSettings.InternalUrl = CleanUrl(configuration.SeerrSettings.InternalUrl, "http://10.16.0.226:5055");
        configuration.SeerrSettings.ExternalUrl = CleanUrl(configuration.SeerrSettings.ExternalUrl, "https://request.piggietv.com");
        configuration.SeerrSettings.ApiKey = CleanSecret(configuration.SeerrSettings.ApiKey);

        NormalizeSignupSettings(configuration.SignupSettings);

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
        configuration.TmdbReadAccessToken = configuration.TmdbSettings.TmdbApiToken ?? CleanTmdbCredential(configuration.TmdbReadAccessToken);
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

        settings.Categories = [];

        return settings;
    }

    /// <summary>
    /// Normalizes persisted recommendation row settings in place.
    /// </summary>
    /// <param name="settings">Recommendation settings.</param>
    /// <returns>Normalized recommendation settings.</returns>
    public static RecommendationRowSettings NormalizeRecommendationSettings(RecommendationRowSettings? settings)
    {
        settings ??= RecommendationRowSettings.CreateDefault();
        settings.SchemaVersion = 1;
        settings.RowConfigHash = CleanOptionalText(settings.RowConfigHash, 128);
        settings.RecommendationConfigHash = CleanOptionalText(settings.RecommendationConfigHash, 128);
        settings.SourceCounts = NormalizeSourceCounts(settings.SourceCounts, 80);
        settings.SourceTimingsJson = string.Empty;
        var diagnosticsByRowId = NormalizeRecommendationRowDiagnostics(settings.RowDiagnostics);
        settings.Rows = (settings.Rows ?? [])
            .Where(row => row is not null)
            .Select(row => NormalizeRecommendationRow(row, diagnosticsByRowId))
            .Where(row => !string.IsNullOrWhiteSpace(row.Id) && row.Items.Count >= MinRecommendationRowItems)
            .DistinctBy(row => row.Id, StringComparer.OrdinalIgnoreCase)
            .Take(40)
            .ToList();
        settings.RowDiagnostics = settings.Rows
            .Select(row => NormalizeRecommendationDiagnostic(row.Diagnostics, row.Id, row.Title, row.Items.Count))
            .ToList();

        return settings;
    }

    private static RecommendationRowDefinition NormalizeRecommendationRow(
        RecommendationRowDefinition row,
        IReadOnlyDictionary<string, RecommendationRowDiagnostics> diagnosticsByRowId)
    {
        var wasAccepted = row.Accepted;
        row.Id = CleanIdentifier(row.Id, row.Title);
        row.Title = CleanText(row.Title, "Recommended", 120);
        row.Explanation = CleanText(row.Explanation, string.Empty, 300);
        row.MediaType = CleanChoice(
            row.MediaType,
            "mixed",
            ["anime", "audiobook", "book", "comic", "game", "manga", "movie", "music", "show", "mixed", "unknown"]);
        row.RowConfigHash = CleanOptionalText(row.RowConfigHash, 128);
        row.RecommendationConfigHash = CleanOptionalText(row.RecommendationConfigHash, 128);
        row.SourceCounts = NormalizeSourceCounts(row.SourceCounts, 80);
        row.SourceTimingsJson = string.Empty;
        diagnosticsByRowId.TryGetValue(row.Id, out var fallbackDiagnostic);
        row.Diagnostics = MergeRecommendationDiagnostic(
            row.Diagnostics,
            fallbackDiagnostic,
            row.Id,
            row.Title,
            row.Items?.Count ?? 0);
        var normalizedItems = (row.Items ?? [])
            .Where(item => item is not null)
            .Select(NormalizeRecommendationItem)
            .Where(item => !string.IsNullOrWhiteSpace(item.Id) && !string.IsNullOrWhiteSpace(item.Name))
            .ToList();
        row.Items = DeduplicateRecommendationItems(normalizedItems)
            .Take(MaxRowMaxItems)
            .ToList();
        row.Diagnostics.CandidateCount = Math.Max(row.Diagnostics.CandidateCount, normalizedItems.Count);
        row.Diagnostics.DedupeRemovals = Math.Max(0, row.Diagnostics.DedupeRemovals + normalizedItems.Count - row.Items.Count);
        row.Diagnostics.FinalRenderedCount = row.Items.Count;
        row.Diagnostics.HydrationRemovals = Math.Max(0, row.Diagnostics.HydrationRemovals);
        row.Diagnostics.PrimaryCandidateCount = Math.Max(row.Diagnostics.PrimaryCandidateCount, row.Diagnostics.CandidateCount);
        row.Diagnostics.SecondaryFallbackCount = Math.Max(0, row.Diagnostics.SecondaryFallbackCount);
        row.Diagnostics.DiscoveryFallbackCount = Math.Max(0, row.Diagnostics.DiscoveryFallbackCount);
        row.Diagnostics.RowId = row.Id;
        row.Diagnostics.Title = row.Title;
        row.Diagnostics.ItemCount = row.Items.Count;

        if (row.Items.Count >= MinRecommendationRowItems)
        {
            row.Accepted = true;
            row.Draft = false;
            row.Enabled = wasAccepted ? row.Enabled : true;
        }
        else
        {
            row.Enabled = false;
            row.Accepted = false;
            row.Draft = true;
        }

        return row;
    }

    private static IReadOnlyDictionary<string, RecommendationRowDiagnostics> NormalizeRecommendationRowDiagnostics(
        IEnumerable<RecommendationRowDiagnostics>? diagnostics)
    {
        var normalized = new Dictionary<string, RecommendationRowDiagnostics>(StringComparer.OrdinalIgnoreCase);

        foreach (var diagnostic in diagnostics ?? [])
        {
            if (diagnostic is null)
            {
                continue;
            }

            var rowId = CleanIdentifier(diagnostic.RowId, diagnostic.Title);

            if (string.IsNullOrWhiteSpace(rowId))
            {
                continue;
            }

            normalized[rowId] = NormalizeRecommendationDiagnostic(
                diagnostic,
                rowId,
                CleanText(diagnostic.Title, string.Empty, 120),
                diagnostic.ItemCount);
        }

        return normalized;
    }

    private static RecommendationRowDiagnostics MergeRecommendationDiagnostic(
        RecommendationRowDiagnostics? primary,
        RecommendationRowDiagnostics? fallback,
        string rowId,
        string title,
        int itemCount)
    {
        return new RecommendationRowDiagnostics
        {
            RowId = rowId,
            Title = title,
            CandidateCount = Math.Max(primary?.CandidateCount ?? 0, fallback?.CandidateCount ?? 0),
            DedupeRemovals = Math.Max(primary?.DedupeRemovals ?? 0, fallback?.DedupeRemovals ?? 0),
            DiscoveryFallbackCount = Math.Max(primary?.DiscoveryFallbackCount ?? 0, fallback?.DiscoveryFallbackCount ?? 0),
            FinalRenderedCount = Math.Max(primary?.FinalRenderedCount ?? 0, fallback?.FinalRenderedCount ?? itemCount),
            HydrationRemovals = Math.Max(primary?.HydrationRemovals ?? 0, fallback?.HydrationRemovals ?? 0),
            ItemCount = Math.Max(primary?.ItemCount ?? 0, fallback?.ItemCount ?? itemCount),
            PrimaryCandidateCount = Math.Max(primary?.PrimaryCandidateCount ?? 0, fallback?.PrimaryCandidateCount ?? 0),
            SecondaryFallbackCount = Math.Max(primary?.SecondaryFallbackCount ?? 0, fallback?.SecondaryFallbackCount ?? 0)
        };
    }

    private static RecommendationRowDiagnostics NormalizeRecommendationDiagnostic(
        RecommendationRowDiagnostics? diagnostic,
        string rowId,
        string title,
        int itemCount)
    {
        diagnostic ??= new RecommendationRowDiagnostics();

        return new RecommendationRowDiagnostics
        {
            RowId = CleanIdentifier(rowId, title),
            Title = CleanText(title, string.Empty, 120),
            CandidateCount = Math.Max(0, diagnostic.CandidateCount),
            DedupeRemovals = Math.Max(0, diagnostic.DedupeRemovals),
            DiscoveryFallbackCount = Math.Max(0, diagnostic.DiscoveryFallbackCount),
            FinalRenderedCount = Math.Max(0, diagnostic.FinalRenderedCount),
            HydrationRemovals = Math.Max(0, diagnostic.HydrationRemovals),
            ItemCount = Math.Max(0, itemCount),
            PrimaryCandidateCount = Math.Max(0, diagnostic.PrimaryCandidateCount),
            SecondaryFallbackCount = Math.Max(0, diagnostic.SecondaryFallbackCount)
        };
    }

    private static IEnumerable<RecommendationItemSnapshot> DeduplicateRecommendationItems(IEnumerable<RecommendationItemSnapshot> items)
    {
        var seenKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var albumCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var artistCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var seriesCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in items)
        {
            var exactKeys = GetRecommendationExactDedupeKeys(item, includeAlbumAndSeries: false)
                .Where(key => !string.IsNullOrWhiteSpace(key))
                .ToArray();

            if (exactKeys.Any(key => seenKeys.Contains(key)))
            {
                continue;
            }

            var seriesKey = GetRecommendationSeriesDedupeKey(item);
            if (!string.IsNullOrWhiteSpace(seriesKey)
                && seriesCounts.TryGetValue(seriesKey, out var seriesCount)
                && seriesCount >= MaxRecommendationSeriesRepeats)
            {
                continue;
            }

            var albumKey = GetRecommendationAlbumDedupeKey(item);
            if (!string.IsNullOrWhiteSpace(albumKey)
                && albumCounts.TryGetValue(albumKey, out var albumCount)
                && albumCount >= MaxRecommendationAlbumRepeats)
            {
                continue;
            }

            var artistKeys = GetRecommendationArtistKeys(item).ToArray();

            if (artistKeys.Any(key => artistCounts.TryGetValue(key, out var count) && count >= MaxRecommendationArtistRepeats))
            {
                continue;
            }

            foreach (var key in exactKeys)
            {
                seenKeys.Add(key);
            }

            if (!string.IsNullOrWhiteSpace(seriesKey))
            {
                seriesCounts[seriesKey] = seriesCounts.TryGetValue(seriesKey, out var count) ? count + 1 : 1;
            }

            if (!string.IsNullOrWhiteSpace(albumKey))
            {
                albumCounts[albumKey] = albumCounts.TryGetValue(albumKey, out var count) ? count + 1 : 1;
            }

            foreach (var artistKey in artistKeys)
            {
                artistCounts[artistKey] = artistCounts.TryGetValue(artistKey, out var count) ? count + 1 : 1;
            }

            yield return item;
        }
    }

    private static IEnumerable<string> GetRecommendationExactDedupeKeys(RecommendationItemSnapshot item, bool includeAlbumAndSeries = true)
    {
        var itemKey = NormalizeRecommendationKey(item.Id);
        if (!string.IsNullOrWhiteSpace(itemKey))
        {
            yield return $"item:{itemKey}";
        }

        if (!includeAlbumAndSeries)
        {
            yield break;
        }

        var seriesKey = GetRecommendationSeriesDedupeKey(item);
        if (!string.IsNullOrWhiteSpace(seriesKey))
        {
            yield return seriesKey;
        }

        var albumKey = GetRecommendationAlbumDedupeKey(item);
        if (!string.IsNullOrWhiteSpace(albumKey))
        {
            yield return albumKey;
        }
    }

    private static string GetRecommendationSeriesDedupeKey(RecommendationItemSnapshot item)
    {
        var type = NormalizeRecommendationKey(item.Type);
        var seriesId = NormalizeRecommendationKey(item.SeriesId);
        var seriesName = NormalizeRecommendationKey(item.SeriesName);

        if (string.IsNullOrWhiteSpace(seriesId) && string.IsNullOrWhiteSpace(seriesName))
        {
            return string.Empty;
        }

        if (type is "episode" or "season")
        {
            return $"series:{seriesId}:{seriesName}";
        }

        return !string.IsNullOrWhiteSpace(seriesId) && !string.Equals(seriesId, NormalizeRecommendationKey(item.Id), StringComparison.OrdinalIgnoreCase)
            ? $"series:{seriesId}"
            : string.Empty;
    }

    private static string GetRecommendationAlbumDedupeKey(RecommendationItemSnapshot item)
    {
        var type = NormalizeRecommendationKey(item.Type);

        if (type is not ("audio" or "music"))
        {
            return string.Empty;
        }

        var albumId = NormalizeRecommendationKey(item.AlbumId);
        var album = NormalizeRecommendationKey(item.Album);

        return string.IsNullOrWhiteSpace(albumId) && string.IsNullOrWhiteSpace(album)
            ? string.Empty
            : $"album:{albumId}:{album}";
    }

    private static IEnumerable<string> GetRecommendationArtistKeys(RecommendationItemSnapshot item)
    {
        return (item.Artists ?? [])
            .Concat([item.AlbumArtist ?? string.Empty])
            .Select(NormalizeRecommendationKey)
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .Distinct(StringComparer.OrdinalIgnoreCase);
    }

    private static string NormalizeRecommendationKey(string? value)
    {
        return string.IsNullOrWhiteSpace(value)
            ? string.Empty
            : string.Join(' ', value.Trim().ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    private static RecommendationItemSnapshot NormalizeRecommendationItem(RecommendationItemSnapshot item)
    {
        item.Id = CleanText(item.Id, string.Empty, 64);
        item.Name = CleanText(item.Name, "Untitled", 160);
        item.Type = CleanText(item.Type, string.Empty, 40);
        item.MediaType = CleanOptionalText(item.MediaType, 40);
        item.Overview = CleanOptionalText(item.Overview, 700);
        item.ImageTags ??= new RecommendationItemImageTags();
        item.ImageTags.Primary = CleanOptionalText(item.ImageTags.Primary, 80);
        item.ImageTags.Thumb = CleanOptionalText(item.ImageTags.Thumb, 80);
        item.ImageTags.Logo = CleanOptionalText(item.ImageTags.Logo, 80);
        item.BackdropImageTags = CleanStringList(item.BackdropImageTags, 20);
        item.ParentBackdropImageTags = CleanStringList(item.ParentBackdropImageTags, 20);
        item.Genres = CleanStringList(item.Genres, 40);
        item.Studios = CleanStringList(item.Studios, 40);
        item.Artists = CleanStringList(item.Artists, 40);
        item.AlbumArtist = CleanOptionalText(item.AlbumArtist, 160);
        item.Album = CleanOptionalText(item.Album, 160);
        item.AlbumId = CleanOptionalText(item.AlbumId, 64);
        item.AlbumPrimaryImageItemId = CleanOptionalText(item.AlbumPrimaryImageItemId, 64);
        item.AlbumPrimaryImageTag = CleanOptionalText(item.AlbumPrimaryImageTag, 80);
        item.ParentPrimaryImageItemId = CleanOptionalText(item.ParentPrimaryImageItemId, 64);
        item.ParentPrimaryImageTag = CleanOptionalText(item.ParentPrimaryImageTag, 80);
        item.ParentThumbItemId = CleanOptionalText(item.ParentThumbItemId, 64);
        item.ParentThumbImageTag = CleanOptionalText(item.ParentThumbImageTag, 80);
        item.ParentId = CleanOptionalText(item.ParentId, 64);
        item.SeriesId = CleanOptionalText(item.SeriesId, 64);
        item.SeriesName = CleanOptionalText(item.SeriesName, 160);
        item.SeriesPrimaryImageTag = CleanOptionalText(item.SeriesPrimaryImageTag, 80);
        item.ProductionYear = item.ProductionYear is null ? null : Math.Max(0, item.ProductionYear.Value);
        item.CommunityRating = item.CommunityRating is null ? null : Math.Max(0, item.CommunityRating.Value);
        item.PrimaryImageAspectRatio = item.PrimaryImageAspectRatio is null ? null : Math.Max(0, item.PrimaryImageAspectRatio.Value);
        item.RunTimeTicks = item.RunTimeTicks is null ? null : Math.Max(0, item.RunTimeTicks.Value);
        item.DateCreated = CleanOptionalText(item.DateCreated, 64);
        item.PremiereDate = CleanOptionalText(item.PremiereDate, 64);

        return item;
    }

    private static List<RecommendationSourceCount> NormalizeSourceCounts(List<RecommendationSourceCount>? sourceCounts, int maxCount)
    {
        if (sourceCounts is null || sourceCounts.Count == 0)
        {
            return [];
        }

        return sourceCounts
            .Where(entry => entry is not null && !string.IsNullOrWhiteSpace(entry.Source))
            .Select(entry => new
            {
                Count = Math.Max(0, entry.Count),
                Key = CleanIdentifier(entry.Source, "source")
            })
            .GroupBy(entry => entry.Key, StringComparer.OrdinalIgnoreCase)
            .Take(maxCount)
            .Select(group => new RecommendationSourceCount
            {
                Count = group.Sum(entry => entry.Count),
                Source = group.Key
            })
            .ToList();
    }

    private static string? CleanOptionalText(string? value, int maxLength)
    {
        var cleaned = CleanText(value, string.Empty, maxLength);

        return string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
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

    private static void NormalizeSignupSettings(SignupSettings settings)
    {
        settings.FailedAttemptLimit = Clamp(settings.FailedAttemptLimit, 3, 30);
        settings.LockoutMinutes = Clamp(settings.LockoutMinutes, 1, 120);
        settings.DefaultPolicyPresetId = CleanIdentifier(settings.DefaultPolicyPresetId, "standard");
        settings.DefaultEnabledFolderIds = CleanStringList(settings.DefaultEnabledFolderIds, 120);
        settings.EmailSettings ??= new SignupEmailSettings();
        NormalizeSignupEmailSettings(settings.EmailSettings);
        settings.PolicyPresets = (settings.PolicyPresets ?? [])
            .Where(preset => preset is not null)
            .Select(NormalizeSignupPolicyPreset)
            .Where(preset => !string.IsNullOrWhiteSpace(preset.Id))
            .DistinctBy(preset => preset.Id, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (settings.PolicyPresets.Count == 0)
        {
            settings.PolicyPresets = SignupSettings.CreateDefaultPolicyPresets();
        }

        settings.Invites = (settings.Invites ?? [])
            .Where(invite => invite is not null && !string.IsNullOrWhiteSpace(invite.Id) && !string.IsNullOrWhiteSpace(invite.CodeHash))
            .Select(NormalizeSignupInvite)
            .DistinctBy(invite => invite.Id, StringComparer.OrdinalIgnoreCase)
            .Take(500)
            .ToList();

        settings.Users = (settings.Users ?? [])
            .Where(user => user is not null && !string.IsNullOrWhiteSpace(user.Username) && !string.IsNullOrWhiteSpace(user.Email))
            .Select(NormalizeSignupUser)
            .DistinctBy(user => user.Email, StringComparer.OrdinalIgnoreCase)
            .Take(1000)
            .ToList();

        MigrateSignupInviteUsageRecords(settings);

        var pendingCutoff = DateTimeOffset.UtcNow.AddHours(-24);
        settings.PendingVerifications = (settings.PendingVerifications ?? [])
            .Where(pending => pending is not null
                && !string.IsNullOrWhiteSpace(pending.Id)
                && !string.IsNullOrWhiteSpace(pending.Username)
                && !string.IsNullOrWhiteSpace(pending.Email)
                && !string.IsNullOrWhiteSpace(pending.ProtectedPassword)
                && !string.IsNullOrWhiteSpace(pending.TokenHash)
                && pending.ExpiresAtUtc > pendingCutoff)
            .Select(NormalizeSignupPendingVerification)
            .DistinctBy(pending => pending.Email, StringComparer.OrdinalIgnoreCase)
            .Take(500)
            .ToList();

        var resetCutoff = DateTimeOffset.UtcNow.AddHours(-24);
        settings.PasswordResetCodes = (settings.PasswordResetCodes ?? [])
            .Where(code => code is not null
                && !string.IsNullOrWhiteSpace(code.Email)
                && !string.IsNullOrWhiteSpace(code.Username)
                && !string.IsNullOrWhiteSpace(code.CodeHash)
                && code.ExpiresAtUtc > resetCutoff)
            .Select(NormalizeSignupResetCode)
            .TakeLast(250)
            .ToList();

        var rateLimitCutoff = DateTimeOffset.UtcNow.AddHours(-6);
        settings.RateLimits = (settings.RateLimits ?? [])
            .Where(record => record is not null
                && !string.IsNullOrWhiteSpace(record.Action)
                && !string.IsNullOrWhiteSpace(record.KeyHash)
                && ((record.LockedUntilUtc is not null && record.LockedUntilUtc > DateTimeOffset.UtcNow)
                    || record.WindowStartedAtUtc > rateLimitCutoff))
            .Select(NormalizeSignupRateLimit)
            .TakeLast(1000)
            .ToList();
    }

    private static void NormalizeSignupEmailSettings(SignupEmailSettings settings)
    {
        settings.SmtpHost = CleanText(settings.SmtpHost, string.Empty, 160);
        settings.SmtpPort = Clamp(settings.SmtpPort, 1, 65535);
        settings.Username = CleanSecret(settings.Username);
        settings.Password = CleanSecret(settings.Password);
        settings.FromAddress = CleanText(settings.FromAddress, string.Empty, 160).ToLowerInvariant();
        settings.FromName = CleanText(settings.FromName, "PiggieTV", 80);
        settings.LogoUrl = CleanPublicAssetUrl(settings.LogoUrl, SignupEmailSettings.DefaultLogoUrl);
        settings.ResetSubject = CleanText(settings.ResetSubject, "Your PiggieTV password reset code", 120);
        settings.ResetCodeMinutes = Clamp(settings.ResetCodeMinutes, 5, 120);
        settings.VerificationSubject = CleanText(settings.VerificationSubject, "Verify your PiggieTV email", 120);
        settings.VerificationLinkMinutes = Clamp(settings.VerificationLinkMinutes, 10, 1440);
    }

    private static SignupPolicyPreset NormalizeSignupPolicyPreset(SignupPolicyPreset preset)
    {
        preset.Id = CleanIdentifier(preset.Id, preset.Name);
        preset.Name = CleanText(preset.Name, "Signup Preset", 80);
        preset.EnabledFolderIds = CleanStringList(preset.EnabledFolderIds, 120);
        preset.RemoteClientBitrateLimit = Math.Max(0, preset.RemoteClientBitrateLimit);
        preset.MaxActiveSessions = Math.Max(0, preset.MaxActiveSessions);
        preset.MaxParentalRating = preset.MaxParentalRating is null ? null : Math.Max(0, preset.MaxParentalRating.Value);

        return preset;
    }

    private static SignupInvite NormalizeSignupInvite(SignupInvite invite)
    {
        invite.Id = CleanIdentifier(invite.Id, invite.Label);
        invite.CodeHash = CleanText(invite.CodeHash, string.Empty, 128);
        invite.CodePreview = CleanText(invite.CodePreview, string.Empty, 16);
        invite.Label = CleanText(invite.Label, "Invite", 80);
        invite.MaxUses = Math.Max(0, invite.MaxUses);
        invite.PolicyPresetId = CleanIdentifier(invite.PolicyPresetId, "standard");
        invite.EnabledFolderIds = CleanStringList(invite.EnabledFolderIds, 120);
        invite.FailedAttempts = Math.Max(0, invite.FailedAttempts);
        invite.UsageRecords = (invite.UsageRecords ?? [])
            .Where(record => record is not null && !string.IsNullOrWhiteSpace(record.Username))
            .Take(500)
            .ToList();

        return invite;
    }

    private static SignupUserRecord NormalizeSignupUser(SignupUserRecord user)
    {
        user.UserId = CleanText(user.UserId, string.Empty, 64);
        user.Username = CleanText(user.Username, string.Empty, 80);
        user.Email = CleanText(user.Email, string.Empty, 160).ToLowerInvariant();
        user.PolicyPresetId = CleanIdentifier(user.PolicyPresetId, "standard");
        user.RemoteAddress = CleanText(user.RemoteAddress, string.Empty, 80);

        return user;
    }

    private static SignupPendingVerification NormalizeSignupPendingVerification(SignupPendingVerification pending)
    {
        pending.Id = CleanIdentifier(pending.Id, "pending");
        pending.Username = CleanText(pending.Username, string.Empty, 80);
        pending.Email = CleanText(pending.Email, string.Empty, 160).ToLowerInvariant();
        pending.ProtectedPassword = CleanText(pending.ProtectedPassword, string.Empty, 4096);
        pending.TokenHash = CleanText(pending.TokenHash, string.Empty, 128);
        pending.PolicyPresetId = CleanIdentifier(pending.PolicyPresetId, "standard");
        pending.EnabledFolderIds = CleanStringList(pending.EnabledFolderIds, 120);
        pending.RemoteAddress = CleanText(pending.RemoteAddress, string.Empty, 80);

        return pending;
    }

    private static SignupPasswordResetCode NormalizeSignupResetCode(SignupPasswordResetCode code)
    {
        code.Email = CleanText(code.Email, string.Empty, 160).ToLowerInvariant();
        code.Username = CleanText(code.Username, string.Empty, 80);
        code.CodeHash = CleanText(code.CodeHash, string.Empty, 128);
        code.FailedAttempts = Math.Max(0, code.FailedAttempts);
        code.RemoteAddress = CleanText(code.RemoteAddress, string.Empty, 80);

        return code;
    }

    private static SignupRateLimitRecord NormalizeSignupRateLimit(SignupRateLimitRecord record)
    {
        record.Action = CleanIdentifier(record.Action, "signup");
        record.KeyHash = CleanText(record.KeyHash, string.Empty, 128);
        record.Count = Math.Max(0, record.Count);

        return record;
    }

    private static void MigrateSignupInviteUsageRecords(SignupSettings settings)
    {
        foreach (var record in settings.Invites.SelectMany(invite => invite.UsageRecords))
        {
            if (string.IsNullOrWhiteSpace(record.Email)
                || settings.Users.Any(user => string.Equals(user.Email, record.Email, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            settings.Users.Add(new SignupUserRecord
            {
                CreatedAtUtc = record.UsedAtUtc,
                Email = CleanText(record.Email, string.Empty, 160).ToLowerInvariant(),
                PolicyPresetId = "standard",
                RemoteAddress = record.RemoteAddress,
                UserId = record.UserId,
                Username = record.Username
            });
        }
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
            [
                "genre",
                "studio",
                "library",
                "collection",
                "tag",
                "tags",
                "providerId",
                "providerIds",
                "person",
                "people",
                "productionYear",
                "officialRating",
                "communityRating",
                "premiereDate",
                "image",
                "images",
                "becauseYouWatched",
                "requested",
                "continueWatching",
                "latest",
                "seasonal"
            ]);
        rule.GenerationMode = CleanChoice(
            rule.GenerationMode,
            "random",
            ["random", "latest", "popular", "highestRated"]);
        rule.Name = CleanText(rule.Name, "New Row", 80);
        rule.Id = CleanIdentifier(rule.Id, rule.Name);
        rule.SourceValue = CleanText(GetDefaultRuleSourceValue(rule), string.Empty, 120);
        rule.ItemLimit = Clamp(rule.ItemLimit, 1, MaxRowMaxItems);
        rule.RowCount = Math.Max(0, rule.RowCount);
        rule.ProviderHints = CleanStringList(rule.ProviderHints, 32);
        var isRandomGenreRule = string.Equals(rule.SourceType, "genre", StringComparison.OrdinalIgnoreCase)
            && string.Equals(rule.GenerationMode, "random", StringComparison.OrdinalIgnoreCase);
        var subgenresExplicitlyDisabled = rule.ProviderHints.Any(
            hint => string.Equals(hint, SubgenresDisabledProviderHint, StringComparison.OrdinalIgnoreCase));
        if (isRandomGenreRule && (rule.IncludeSubgenres || (!subgenresExplicitlyDisabled && rule.RowCount > 1)))
        {
            rule.IncludeSubgenres = true;
            rule.ProviderHints.RemoveAll(hint => string.Equals(hint, SubgenresDisabledProviderHint, StringComparison.OrdinalIgnoreCase));
            var maximumSubgenreRows = Math.Max(0, rule.RowCount - 1);
            rule.SubgenreRowCount = rule.SubgenreRowCount <= 0
                ? maximumSubgenreRows
                : Clamp(rule.SubgenreRowCount, 0, maximumSubgenreRows);
        }
        else
        {
            rule.IncludeSubgenres = false;
            rule.SubgenreRowCount = 0;
        }
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
            "becauseYouWatched" => "watched",
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

    private static string CleanPublicAssetUrl(string? value, string fallback)
    {
        var cleaned = CleanUrl(value, fallback);
        var decoded = cleaned;

        for (var index = 0; index < 3; index++)
        {
            if (decoded.Contains('\0', StringComparison.Ordinal)
                || decoded.Contains("..", StringComparison.Ordinal)
                || decoded.Contains('\\', StringComparison.Ordinal)
                || decoded.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
            {
                return fallback;
            }

            var next = Uri.UnescapeDataString(decoded);
            if (string.Equals(next, decoded, StringComparison.Ordinal))
            {
                break;
            }

            decoded = next;
        }

        return cleaned;
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

    private static string CleanPlaybackMode(string? value)
    {
        var cleaned = CleanText(value, "auto", 16).ToLowerInvariant();

        return cleaned is "auto" or "compatible" or "performance" ? cleaned : "auto";
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

    private static string? CleanTmdbCredential(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;

        var cleaned = value.Trim();

        if (cleaned.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            cleaned = cleaned[7..].Trim();
        }

        return string.Concat(cleaned.Where(character => !char.IsWhiteSpace(character)));
    }
}
