using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Background worker that prepares the shared PiggieTV featured-content cache on the server.
/// </summary>
public sealed class PtvFeaturedContentRefreshService : BackgroundService, IPtvFeaturedContentRefreshService
{
    /// <summary>
    /// Default server-side featured-content refresh interval.
    /// </summary>
    public const long DefaultRefreshIntervalMs = 12 * 60 * 60 * 1000;

    private const int HeroShowLimit = 5;
    private const int HeroMovieLimit = 10;
    private const long MaxRefreshIntervalMs = 7 * 24 * 60 * 60 * 1000;
    private const long MinRefreshIntervalMs = 60 * 60 * 1000;
    private const int RowItemLimit = 16;
    private const int MaxCandidateItems = 1200;
    private const int MaxTextLength = 700;
    private static readonly string[] MovieTypes = ["Movie"];
    private static readonly string[] SeriesTypes = ["Series"];
    private static readonly string[] MusicTypes = ["MusicAlbum"];
    private static readonly string[] VideoTypes = ["Movie", "Series"];
    private static readonly string[] FamilyAnimationTerms = [
        "animation",
        "animated",
        "cartoon",
        "walt disney animation",
        "disney television animation",
        "pixar",
        "dreamworks animation",
        "illumination",
        "studio ghibli",
        "cartoon network",
        "nickelodeon"
    ];
    private static readonly string[] FamilyAudienceTerms = [
        "family",
        "children",
        "kids",
        "disney",
        "pixar",
        "dreamworks",
        "illumination",
        "cartoon network",
        "nickelodeon",
        "disney channel",
        "disney junior"
    ];
    private static readonly string[] AdultAnimationTerms = [
        "adult animation",
        "adult swim",
        "mature",
        "tv ma"
    ];
    private static readonly string[] AnimeStrongTerms = [
        "anime",
        "manga",
        "crunchyroll",
        "funimation",
        "toonami",
        "toei animation",
        "mappa",
        "bones",
        "madhouse",
        "studio pierrot",
        "trigger",
        "a 1 pictures",
        "kyoto animation",
        "sunrise",
        "production i g",
        "ufotable",
        "shaft",
        "wit studio",
        "cloverworks"
    ];
    private static readonly string[] AnimeSupportingTerms = [
        "animation",
        "animated",
        "japan",
        "japanese"
    ];
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<PtvFeaturedContentRefreshService> _logger;
    private readonly IPtvFeaturedContentStore _store;
    private readonly IPtvTmdbMetadataService _tmdbMetadataService;
    private long? _lastRefreshCompletedAt;
    private long? _lastRefreshDurationMs;
    private string? _lastRefreshError;
    private long? _lastRefreshStartedAt;
    private long? _nextRefreshAt;
    private bool _refreshInProgress;

    private sealed record PtvHeroCacheItem(BaseItem Item, string Label);

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvFeaturedContentRefreshService"/> class.
    /// </summary>
    /// <param name="store">Featured-content store.</param>
    /// <param name="libraryManager">Jellyfin library manager.</param>
    /// <param name="logger">Logger.</param>
    /// <param name="tmdbMetadataService">Optional TMDb metadata enrichment service.</param>
    public PtvFeaturedContentRefreshService(
        IPtvFeaturedContentStore store,
        ILibraryManager libraryManager,
        ILogger<PtvFeaturedContentRefreshService> logger,
        IPtvTmdbMetadataService tmdbMetadataService)
    {
        _store = store;
        _libraryManager = libraryManager;
        _logger = logger;
        _tmdbMetadataService = tmdbMetadataService;
    }

    /// <inheritdoc />
    public PtvFeaturedContentRefreshStatus GetRefreshStatus(PtvFeaturedContentStoreStatus? storeStatus = null)
    {
        return new PtvFeaturedContentRefreshStatus
        {
            LastRefreshCompletedAt = _lastRefreshCompletedAt,
            LastRefreshDurationMs = _lastRefreshDurationMs,
            LastRefreshError = _lastRefreshError,
            LastRefreshStartedAt = _lastRefreshStartedAt,
            NextRefreshAt = _nextRefreshAt ?? storeStatus?.FeaturedCacheExpiresAt,
            RefreshInProgress = _refreshInProgress
        };
    }

    /// <inheritdoc />
    public async Task<PtvFeaturedContentStoreStatus> RefreshIfNeededAsync(CancellationToken cancellationToken)
    {
        var storeStatus = await _store.GetStatusAsync(cancellationToken).ConfigureAwait(false);

        if (!NeedsRefresh(storeStatus))
        {
            _nextRefreshAt = storeStatus.FeaturedCacheExpiresAt;

            return storeStatus;
        }

        return await RefreshAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<PtvFeaturedContentStoreStatus> RefreshAsync(CancellationToken cancellationToken)
    {
        if (!await _refreshGate.WaitAsync(0, cancellationToken).ConfigureAwait(false))
        {
            return await _store.GetStatusAsync(cancellationToken).ConfigureAwait(false);
        }

        var startedAt = DateTimeOffset.UtcNow;
        var stopwatch = Stopwatch.StartNew();
        var refreshIntervalMs = DefaultRefreshIntervalMs;

        _refreshInProgress = true;
        _lastRefreshStartedAt = startedAt.ToUnixTimeMilliseconds();
        _lastRefreshError = null;

        try
        {
            var existingDocument = await _store.ReadAsync(cancellationToken).ConfigureAwait(false);
            refreshIntervalMs = GetRefreshIntervalMs(existingDocument);
            var payload = await BuildFeaturedPayloadAsync(cancellationToken).ConfigureAwait(false);
            var document = CreateFeaturedContentDocument(payload, startedAt, refreshIntervalMs);
            var storedDocument = await _store.WriteAsync(document, cancellationToken).ConfigureAwait(false);
            var status = await _store.GetStatusAsync(cancellationToken).ConfigureAwait(false);
            var completedAt = DateTimeOffset.UtcNow;

            stopwatch.Stop();
            _lastRefreshCompletedAt = completedAt.ToUnixTimeMilliseconds();
            _lastRefreshDurationMs = stopwatch.ElapsedMilliseconds;
            _nextRefreshAt = PtvFeaturedContentStatus.FromDocument(storedDocument).ExpiresAt;

            _logger.LogInformation(
                "PiggieTV featured-content cache refreshed in {DurationMs} ms.",
                _lastRefreshDurationMs);

            return status;
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            _lastRefreshCompletedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            _lastRefreshDurationMs = stopwatch.ElapsedMilliseconds;
            _lastRefreshError = ex.Message;
            _nextRefreshAt = DateTimeOffset.UtcNow.AddMilliseconds(refreshIntervalMs).ToUnixTimeMilliseconds();

            _logger.LogWarning(ex, "PiggieTV featured-content cache refresh failed. Existing stale cache will continue to be served.");

            return await _store.GetStatusAsync(CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            _refreshInProgress = false;
            _refreshGate.Release();
        }
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await DelayQuietly(TimeSpan.FromSeconds(10), stoppingToken).ConfigureAwait(false);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var status = await RefreshIfNeededAsync(stoppingToken).ConfigureAwait(false);
                var delay = GetDelayUntilNextRefresh(status);

                await DelayQuietly(delay, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _lastRefreshError = ex.Message;
                _logger.LogWarning(ex, "PiggieTV featured-content refresh loop failed.");
                await DelayQuietly(TimeSpan.FromMinutes(15), stoppingToken).ConfigureAwait(false);
            }
        }
    }

    private static bool NeedsRefresh(PtvFeaturedContentStoreStatus storeStatus)
    {
        if (!storeStatus.FeaturedCacheExists || !storeStatus.FeaturedCacheFresh)
        {
            return true;
        }

        return storeStatus.FeaturedCacheExpiresAt is null
            || storeStatus.FeaturedCacheExpiresAt.Value <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    private static TimeSpan GetDelayUntilNextRefresh(PtvFeaturedContentStoreStatus storeStatus)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var nextRefreshAt = storeStatus.FeaturedCacheExpiresAt ?? now + DefaultRefreshIntervalMs;
        var delayMs = Math.Max(60 * 1000, nextRefreshAt - now);

        return TimeSpan.FromMilliseconds(delayMs);
    }

    private static async Task DelayQuietly(TimeSpan delay, CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }

    private static long GetRefreshIntervalMs(PtvFeaturedContentDocument? document)
    {
        if (document?.FeaturedContentSettings is JsonObject settings
            && TryGetLong(settings["ttlMs"], out var ttlMs))
        {
            return ClampRefreshIntervalMs(ttlMs);
        }

        return DefaultRefreshIntervalMs;
    }

    private static bool TryGetLong(JsonNode? node, out long result)
    {
        result = 0;

        if (node is not JsonValue value)
        {
            return false;
        }

        if (value.TryGetValue<long>(out var longValue))
        {
            result = longValue;
            return true;
        }

        if (value.TryGetValue<int>(out var intValue))
        {
            result = intValue;
            return true;
        }

        if (value.TryGetValue<double>(out var doubleValue) && double.IsFinite(doubleValue))
        {
            result = Convert.ToInt64(Math.Round(doubleValue, MidpointRounding.AwayFromZero));
            return true;
        }

        return false;
    }

    private static long ClampRefreshIntervalMs(long refreshIntervalMs)
    {
        return Math.Clamp(refreshIntervalMs, MinRefreshIntervalMs, MaxRefreshIntervalMs);
    }

    private PtvFeaturedContentDocument CreateFeaturedContentDocument(JsonObject payload, DateTimeOffset createdAt, long refreshIntervalMs)
    {
        refreshIntervalMs = ClampRefreshIntervalMs(refreshIntervalMs);

        var createdAtMs = createdAt.ToUnixTimeMilliseconds();
        var expiresAtMs = createdAtMs + refreshIntervalMs;

        return new PtvFeaturedContentDocument
        {
            FeaturedContent = new JsonObject
            {
                ["version"] = PtvFeaturedContentValidator.FeaturedCacheVersion,
                ["createdAt"] = createdAtMs,
                ["expiresAt"] = expiresAtMs,
                ["payload"] = payload
            },
            FeaturedContentSettings = new JsonObject
            {
                ["ttlMs"] = refreshIntervalMs
            },
            UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Version = PtvFeaturedContentValidator.DocumentVersion
        };
    }

    private async Task<JsonObject> BuildFeaturedPayloadAsync(CancellationToken cancellationToken)
    {
        var candidates = GetCandidateItems();
        var tmdbFacts = await _tmdbMetadataService.GetFactsAsync(candidates, cancellationToken).ConfigureAwait(false);
        var movies = candidates.Where(item => IsType(item, MovieTypes)).ToArray();
        var series = candidates.Where(item => IsType(item, SeriesTypes)).ToArray();
        var albums = candidates.Where(item => IsType(item, MusicTypes)).ToArray();
        var heroItems = SelectHeroItems(series, HeroShowLimit, "Recommended Shows")
            .Concat(SelectHeroItems(movies, HeroMovieLimit, "Recommended Movies"));

        return new JsonObject
        {
            ["heroItems"] = ToHeroJsonArray(heroItems),
            ["sectionItems"] = new JsonObject
            {
                ["latest-shows"] = ToJsonArray(SelectLatestItems(series, RowItemLimit)),
                ["latest-movies"] = ToJsonArray(SelectLatestItems(movies, RowItemLimit)),
                ["latest-music"] = ToJsonArray(SelectLatestItems(albums, RowItemLimit)),
                ["horror"] = ToJsonArray(SelectMatchedItems(candidates, item => MatchesAny(item, ["horror"], tmdbFacts), VideoTypes)),
                ["comedy"] = ToJsonArray(SelectMatchedItems(candidates, item => MatchesAny(item, ["comedy"], tmdbFacts), VideoTypes)),
                ["family-animation"] = ToJsonArray(SelectMatchedItems(candidates, item => IsFamilyAnimationItem(item, tmdbFacts), VideoTypes)),
                ["drama"] = ToJsonArray(SelectMatchedItems(candidates, item => MatchesAny(item, ["drama"], tmdbFacts), VideoTypes)),
                ["science-fiction"] = ToJsonArray(SelectMatchedItems(candidates, item => MatchesAny(item, ["science fiction", "sci-fi", "sci fi", "space"], tmdbFacts), VideoTypes)),
                ["anime"] = ToJsonArray(SelectMatchedItems(candidates, item => IsAnimeItem(item, tmdbFacts), VideoTypes)),
                ["music"] = ToJsonArray(SelectRankedItems(albums, RowItemLimit)),
                ["family"] = ToJsonArray(SelectMatchedItems(candidates, item => MatchesAny(item, ["family"], tmdbFacts), VideoTypes)),
                ["action"] = ToJsonArray(SelectMatchedItems(candidates, item => MatchesAny(item, ["action"], tmdbFacts), VideoTypes)),
                ["disney"] = ToJsonArray(SelectMatchedItems(candidates, item => IsDisneyItem(item, tmdbFacts), VideoTypes)),
                ["marvel"] = ToJsonArray(SelectMatchedItems(candidates, item => MatchesAny(item, ["marvel", "avengers", "spider-man", "x-men"], tmdbFacts), VideoTypes)),
                ["star-wars"] = ToJsonArray(SelectMatchedItems(candidates, item => MatchesAny(item, ["star wars", "jedi", "sith", "skywalker"], tmdbFacts), VideoTypes)),
                ["star-trek"] = ToJsonArray(SelectMatchedItems(candidates, item => MatchesAny(item, ["star trek", "enterprise", "starfleet"], tmdbFacts), VideoTypes)),
                ["adult-animation"] = ToJsonArray(SelectMatchedItems(candidates, item => MatchesAny(item, ["adult animation", "adult swim", "animation"], tmdbFacts), VideoTypes)),
                ["crime"] = ToJsonArray(SelectMatchedItems(candidates, item => MatchesAny(item, ["crime", "detective", "mystery"], tmdbFacts), VideoTypes))
            }
        };
    }

    private IReadOnlyList<BaseItem> GetCandidateItems()
    {
        var salt = (DateTimeOffset.UtcNow.Year * 400) + DateTimeOffset.UtcNow.DayOfYear;
        var children = _libraryManager.RootFolder.GetRecursiveChildren();

        return children
            .Where(IsSupportedType)
            .Where(HasRenderableImage)
            .OrderBy(item => GetStableScore(item.Id, salt))
            .Take(MaxCandidateItems)
            .ToArray();
    }

    private static IReadOnlyList<PtvHeroCacheItem> SelectHeroItems(IEnumerable<BaseItem> items, int limit, string label)
    {
        return SelectRankedItems(items, limit)
            .Select(item => new PtvHeroCacheItem(item, label))
            .ToArray();
    }

    private static IReadOnlyList<BaseItem> SelectLatestItems(IEnumerable<BaseItem> items, int limit)
    {
        return items
            .OrderByDescending(GetSortDate)
            .ThenByDescending(GetTrendScore)
            .Take(limit)
            .ToArray();
    }

    private static IReadOnlyList<BaseItem> SelectMatchedItems(
        IEnumerable<BaseItem> items,
        Func<BaseItem, bool> matcher,
        IReadOnlyCollection<string> allowedTypes)
    {
        return SelectRankedItems(items.Where(item => IsType(item, allowedTypes) && matcher(item)), RowItemLimit);
    }

    private static IReadOnlyList<BaseItem> SelectRankedItems(IEnumerable<BaseItem> items, int limit)
    {
        return items
            .OrderByDescending(GetTrendScore)
            .ThenByDescending(GetSortDate)
            .Take(limit)
            .ToArray();
    }

    private static bool IsSupportedType(BaseItem item)
    {
        return IsType(item, MovieTypes)
            || IsType(item, SeriesTypes)
            || IsType(item, MusicTypes);
    }

    private static bool IsType(BaseItem item, IReadOnlyCollection<string> allowedTypes)
    {
        return allowedTypes.Contains(GetItemType(item), StringComparer.OrdinalIgnoreCase);
    }

    private static string GetItemType(BaseItem item)
    {
        return item.GetType().Name;
    }

    private static bool HasRenderableImage(BaseItem item)
    {
        return GetImageTag(item, ImageType.Primary) is not null
            || GetImageTag(item, ImageType.Thumb) is not null
            || GetImageTag(item, ImageType.Backdrop) is not null;
    }

    private static int GetStableScore(Guid id, int salt)
    {
        unchecked
        {
            var hash = salt;

            foreach (var value in id.ToByteArray())
            {
                hash = (hash * 31) + value;
            }

            return hash;
        }
    }

    private static DateTime GetSortDate(BaseItem item)
    {
        return item.PremiereDate ?? item.DateCreated;
    }

    private static double GetTrendScore(BaseItem item)
    {
        var communityScore = (item.CommunityRating ?? 0) * 10;
        var criticScore = item.CriticRating ?? 0;
        var releaseYear = item.ProductionYear ?? item.PremiereDate?.Year ?? 0;
        var recencyBoost = releaseYear > 0 ? Math.Clamp(releaseYear - 2014, 0, 12) : 0;

        return (criticScore * 0.55) + (communityScore * 0.45) + recencyBoost;
    }

    private static bool MatchesAny(
        BaseItem item,
        IReadOnlyCollection<string> terms,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts>? tmdbFacts = null)
    {
        var haystack = NormalizeSearchText(string.Join(
            " ",
            item.Name,
            item.Overview,
            item.OfficialRating,
            string.Join(" ", item.Genres),
            string.Join(" ", item.Studios),
            string.Join(" ", item.Tags),
            string.Join(" ", item.ProviderIds.Values),
            GetTmdbSearchText(item, tmdbFacts)));

        return terms.Any(term => haystack.Contains(NormalizeSearchText(term), StringComparison.Ordinal));
    }

    private static bool MetadataMatchesAny(
        BaseItem item,
        IReadOnlyCollection<string> terms,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts>? tmdbFacts = null)
    {
        var haystack = GetMetadataSearchText(item, tmdbFacts);

        return terms.Any(term => haystack.Contains(NormalizeSearchText(term), StringComparison.Ordinal));
    }

    private static bool IsFamilyAnimationItem(
        BaseItem item,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts>? tmdbFacts = null)
    {
        return MetadataMatchesAny(item, FamilyAnimationTerms, tmdbFacts)
            && MetadataMatchesAny(item, FamilyAudienceTerms, tmdbFacts)
            && !MetadataMatchesAny(item, AdultAnimationTerms, tmdbFacts);
    }

    private static bool IsAnimeItem(
        BaseItem item,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts>? tmdbFacts = null)
    {
        if (MetadataMatchesAny(item, AnimeStrongTerms, tmdbFacts))
        {
            return true;
        }

        return MetadataMatchesAny(item, ["japan", "japanese", "jp", "ja"], tmdbFacts)
            && MetadataMatchesAny(item, AnimeSupportingTerms, tmdbFacts);
    }

    private static bool IsDisneyItem(
        BaseItem item,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts>? tmdbFacts = null)
    {
        return MatchesAny(item, [
            "disney",
            "pixar",
            "lion king",
            "frozen",
            "moana",
            "aladdin",
            "little mermaid",
            "beauty and the beast",
            "mulan",
            "hercules",
            "tarzan",
            "lilo stitch",
            "tangled",
            "zootopia",
            "encanto",
            "wreck it ralph",
            "goof troop",
            "talespin",
            "ducktales",
            "duck tales",
            "quack pack",
            "darkwing duck",
            "chip dale",
            "gargoyles",
            "recess",
            "kim possible",
            "proud family",
            "gravity falls",
            "phineas and ferb",
            "american dragon",
            "house of mouse"
        ], tmdbFacts);
    }

    private static string NormalizeSearchText(string value)
    {
        var normalized = value.ToLowerInvariant();

        foreach (var character in new[] { '\'', '’', ':', '-', '_', '.', ',', '&' })
        {
            normalized = normalized.Replace(character, ' ');
        }

        return string.Join(' ', normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    private static string GetMetadataSearchText(
        BaseItem item,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts>? tmdbFacts = null)
    {
        return NormalizeSearchText(string.Join(
            " ",
            item.Name,
            item.OfficialRating,
            string.Join(" ", item.Genres),
            string.Join(" ", item.Studios),
            string.Join(" ", item.Tags),
            string.Join(" ", item.ProviderIds.Values),
            GetTmdbSearchText(item, tmdbFacts)));
    }

    private static string GetTmdbSearchText(
        BaseItem item,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts>? tmdbFacts)
    {
        if (tmdbFacts is null || !tmdbFacts.TryGetValue(item.Id, out var facts))
        {
            return string.Empty;
        }

        return facts.SearchText;
    }

    private static JsonArray ToJsonArray(IEnumerable<BaseItem> items)
    {
        var array = new JsonArray();

        foreach (var item in items)
        {
            array.Add(ToJsonObject(item));
        }

        return array;
    }

    private static JsonObject ToJsonObject(BaseItem item)
    {
        var json = new JsonObject
        {
            ["Id"] = item.Id.ToString("N"),
            ["Name"] = item.Name,
            ["Type"] = GetItemType(item),
            ["ImageTags"] = GetImageTags(item),
            ["BackdropImageTags"] = GetBackdropImageTags(item),
            ["Studios"] = ToStringArray(item.Studios),
            ["Genres"] = ToStringArray(item.Genres)
        };

        AddValue(json, "CommunityRating", item.CommunityRating);
        AddValue(json, "CriticRating", item.CriticRating);
        AddValue(json, "DateCreated", item.DateCreated);
        AddValue(json, "MediaType", item.MediaType.ToString());
        AddValue(json, "OfficialRating", item.OfficialRating);
        AddValue(json, "Overview", Truncate(item.Overview));
        AddValue(json, "PremiereDate", item.PremiereDate);
        AddValue(json, "PrimaryImageTag", GetImageTag(item, ImageType.Primary));
        AddValue(json, "ProductionYear", item.ProductionYear);
        AddValue(json, "RunTimeTicks", item.RunTimeTicks);

        var providerIds = ToProviderIdObject(item.ProviderIds);

        if (providerIds.Count > 0)
        {
            json["ProviderIds"] = providerIds;
        }

        return json;
    }

    private static JsonArray ToHeroJsonArray(IEnumerable<PtvHeroCacheItem> items)
    {
        var array = new JsonArray();

        foreach (var heroItem in items)
        {
            var json = ToJsonObject(heroItem.Item);

            json["PtvHeroSource"] = "featured";
            json["PtvHeroRecommendationLabel"] = heroItem.Label;
            array.Add(json);
        }

        return array;
    }

    private static JsonObject GetImageTags(BaseItem item)
    {
        var imageTags = new JsonObject();
        AddValue(imageTags, "Primary", GetImageTag(item, ImageType.Primary));
        AddValue(imageTags, "Logo", GetImageTag(item, ImageType.Logo));
        AddValue(imageTags, "Thumb", GetImageTag(item, ImageType.Thumb));

        return imageTags;
    }

    private static JsonArray GetBackdropImageTags(BaseItem item)
    {
        var imageTags = new JsonArray();

        for (var index = 0; index < 3; index++)
        {
            var tag = GetImageTag(item, ImageType.Backdrop, index);

            if (tag is null)
            {
                break;
            }

            imageTags.Add(tag);
        }

        return imageTags;
    }

    private static string? GetImageTag(BaseItem item, ImageType imageType, int imageIndex = 0)
    {
        try
        {
            var image = item.GetImageInfo(imageType, imageIndex);

            return image?.DateModified.Ticks.ToString(CultureInfo.InvariantCulture);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    private static JsonArray ToStringArray(IEnumerable<string>? values)
    {
        var array = new JsonArray();

        if (values is null)
        {
            return array;
        }

        foreach (var value in values.Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            array.Add(value);
        }

        return array;
    }

    private static JsonObject ToProviderIdObject(IReadOnlyDictionary<string, string>? providerIds)
    {
        var providerObject = new JsonObject();

        if (providerIds is null)
        {
            return providerObject;
        }

        foreach (var provider in providerIds)
        {
            if (string.IsNullOrWhiteSpace(provider.Key) || string.IsNullOrWhiteSpace(provider.Value))
            {
                continue;
            }

            providerObject[provider.Key] = provider.Value;
        }

        return providerObject;
    }

    private static void AddValue(JsonObject target, string propertyName, object? value)
    {
        switch (value)
        {
            case null:
                return;
            case string stringValue when string.IsNullOrWhiteSpace(stringValue):
                return;
            case string stringValue:
                target[propertyName] = stringValue;
                return;
            case DateTime dateTime:
                target[propertyName] = dateTime.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
                return;
            case int intValue:
                target[propertyName] = intValue;
                return;
            case long longValue:
                target[propertyName] = longValue;
                return;
            case float floatValue:
                target[propertyName] = floatValue;
                return;
            case double doubleValue:
                target[propertyName] = doubleValue;
                return;
            case bool boolValue:
                target[propertyName] = boolValue;
                return;
            default:
                target[propertyName] = Convert.ToString(value, CultureInfo.InvariantCulture);
                return;
        }
    }

    private static string? Truncate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Length <= MaxTextLength ? value : value[..MaxTextLength];
    }
}
