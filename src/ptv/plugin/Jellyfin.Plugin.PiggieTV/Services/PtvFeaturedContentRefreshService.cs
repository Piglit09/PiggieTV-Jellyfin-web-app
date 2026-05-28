using System.Collections;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Configuration;
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
    private static readonly TimeSpan TmdbMetadataTimeout = TimeSpan.FromSeconds(20);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };
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
    private static readonly string[] StarWarsTerms = [
        "star wars",
        "a new hope",
        "empire strikes back",
        "return of the jedi",
        "phantom menace",
        "attack of the clones",
        "revenge of the sith",
        "force awakens",
        "last jedi",
        "rise of skywalker",
        "rogue one",
        "clone wars",
        "bad batch",
        "mandalorian",
        "jedi",
        "sith",
        "skywalker",
        "ahsoka",
        "andor",
        "obi wan",
        "boba fett",
        "lucasfilm"
    ];
    private static readonly string[] StarTrekTerms = [
        "star trek",
        "original series",
        "next generation",
        "deep space nine",
        "voyager",
        "star trek enterprise",
        "star trek discovery",
        "star trek picard",
        "strange new worlds",
        "lower decks",
        "star trek prodigy",
        "wrath of khan",
        "search for spock",
        "voyage home",
        "undiscovered country",
        "first contact",
        "starfleet",
        "federation",
        "klingon",
        "vulcan",
        "romulan"
    ];
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<PtvFeaturedContentRefreshService> _logger;
    private readonly IPtvFeaturedContentStore _store;
    private readonly IPtvTmdbMetadataService _tmdbMetadataService;
    private long? _lastRefreshCompletedAt;
    private long? _lastRefreshDurationMs;
    private string? _lastRefreshError;
    private string? _lastRefreshWarning;
    private long? _lastRefreshStartedAt;
    private long? _nextRefreshAt;
    private bool _refreshInProgress;

    private sealed record PtvHeroCacheItem(BaseItem Item, string Label);

    private sealed record GeneratedRow(
        string Id,
        string Title,
        RowBuilderRule Rule,
        string Source,
        string SectionType,
        string ProviderUsed,
        string? ProviderError,
        IReadOnlyList<BaseItem> Items,
        int FilteredDuplicateCount,
        long GenerationTimeMs,
        string? EmptyResultReason);

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

        _logger.LogInformation("PiggieTV featured-content refresh service constructed.");
    }

    /// <inheritdoc />
    public PtvFeaturedContentRefreshStatus GetRefreshStatus(PtvFeaturedContentStoreStatus? storeStatus = null)
    {
        return new PtvFeaturedContentRefreshStatus
        {
            LastRefreshCompletedAt = _lastRefreshCompletedAt,
            LastRefreshDurationMs = _lastRefreshDurationMs,
            LastRefreshError = _lastRefreshError,
            LastRefreshWarning = _lastRefreshWarning,
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
        _lastRefreshWarning = null;

        try
        {
            using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutSource.CancelAfter(GetRefreshTimeout());
            var refreshToken = timeoutSource.Token;
            var configuration = GetConfiguration();

            _logger.LogInformation("PiggieTV featured-content refresh started.");

            var existingDocument = await _store.ReadAsync(refreshToken).ConfigureAwait(false);
            refreshIntervalMs = GetRefreshIntervalMs(existingDocument, configuration);
            _logger.LogInformation(
                "PiggieTV featured-content refresh interval resolved. CacheRefreshIntervalHours={RefreshIntervalHours}. TtlMs={TtlMs}.",
                configuration.CacheSettings.RefreshIntervalHours,
                refreshIntervalMs);
            var payload = await BuildFeaturedPayloadAsync(configuration, refreshToken).ConfigureAwait(false);
            var document = CreateFeaturedContentDocument(payload, startedAt, refreshIntervalMs);

            document = TrimDocumentToMaxSize(document);
            _logger.LogInformation(
                "PiggieTV featured-content payload size before write: {PayloadBytes} bytes.",
                GetDocumentSize(document));

            var storedDocument = await _store.WriteAsync(document, refreshToken).ConfigureAwait(false);
            var status = await _store.GetStatusAsync(refreshToken).ConfigureAwait(false);
            var completedAt = DateTimeOffset.UtcNow;

            stopwatch.Stop();
            _lastRefreshCompletedAt = completedAt.ToUnixTimeMilliseconds();
            _lastRefreshDurationMs = stopwatch.ElapsedMilliseconds;
            _lastRefreshError = null;
            _nextRefreshAt = PtvFeaturedContentStatus.FromDocument(storedDocument).ExpiresAt;

            _logger.LogInformation(
                "PiggieTV featured-content cache refreshed in {DurationMs} ms.",
                _lastRefreshDurationMs);

            return status;
        }
        catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            stopwatch.Stop();
            _lastRefreshCompletedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            _lastRefreshDurationMs = stopwatch.ElapsedMilliseconds;
            _lastRefreshError = $"Featured-content refresh timed out after {FormatDuration(stopwatch.ElapsedMilliseconds)}.";
            _nextRefreshAt = DateTimeOffset.UtcNow.AddMilliseconds(refreshIntervalMs).ToUnixTimeMilliseconds();

            _logger.LogWarning(ex, "PiggieTV featured-content cache refresh timed out after {DurationMs} ms.", stopwatch.ElapsedMilliseconds);

            return await _store.GetStatusAsync(CancellationToken.None).ConfigureAwait(false);
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
    public async Task<PtvRowPreviewResponse> PreviewRowsAsync(RowBuilderSettings? settings, CancellationToken cancellationToken)
    {
        var configuration = GetConfiguration();
        var rowSettings = PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(
            CloneRowBuilderSettings(settings ?? configuration.Rows));
        var validation = ValidateRowBuilderSettings(rowSettings);
        var candidates = GetCandidateItems();
        var tmdbFacts = await GetTmdbFactsSafelyAsync(candidates).ConfigureAwait(false);
        var generatedRows = BuildConfiguredRows(
            rowSettings,
            candidates,
            tmdbFacts,
            configuration.RowSettings.RowMaxItems,
            includeEmptyRows: true,
            cancellationToken: cancellationToken);

        foreach (var row in generatedRows.Where(row => row.Items.Count == 0))
        {
            validation.Warnings.Add($"Row '{row.Title}' has no matching items.");
        }

        validation.Ok = validation.Errors.Count == 0;

        return new PtvRowPreviewResponse
        {
            Ok = true,
            Settings = rowSettings,
            Validation = validation,
            Rows = generatedRows.Select(ToPreviewItem).ToList(),
            Diagnostics = generatedRows.Select(ToGenerationDiagnostic).ToList(),
            ProviderStatus = BuildProviderStatus()
        };
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("PiggieTV featured-content refresh background service starting.");
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

    private static PluginConfiguration GetConfiguration()
    {
        var configuration = Plugin.Instance?.Configuration ?? new PluginConfiguration();

        PtvPluginSettingsNormalizer.Normalize(configuration);

        return configuration;
    }

    private static TimeSpan GetRefreshTimeout()
    {
        return TimeSpan.FromMinutes(10);
    }

    private static string FormatDuration(long durationMs)
    {
        return durationMs < 1000
            ? $"{durationMs} ms"
            : $"{durationMs / 1000D:0.0} seconds";
    }

    private static long GetRefreshIntervalMs(PtvFeaturedContentDocument? document)
    {
        return GetRefreshIntervalMs(document, GetConfiguration());
    }

    private static long GetRefreshIntervalMs(PtvFeaturedContentDocument? document, PluginConfiguration configuration)
    {
        var configuredIntervalMs = configuration.CacheSettings.RefreshIntervalHours * 60L * 60L * 1000L;

        if (configuredIntervalMs > 0)
        {
            return ClampRefreshIntervalMs(configuredIntervalMs);
        }

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

    private PtvFeaturedContentDocument TrimDocumentToMaxSize(PtvFeaturedContentDocument document)
    {
        var maxDocumentBytes = PtvFeaturedContentValidator.GetMaxDocumentBytes();
        var originalSize = GetDocumentSize(document);

        if (originalSize <= maxDocumentBytes)
        {
            return document;
        }

        if (document.FeaturedContent is not JsonObject featuredContent
            || featuredContent["payload"] is not JsonObject payload)
        {
            throw new InvalidOperationException("Featured-content document cannot be trimmed because its payload is missing.");
        }

        _logger.LogWarning(
            "PiggieTV featured-content payload is {PayloadBytes} bytes, above {MaxPayloadBytes}. Trimming cache payload.",
            originalSize,
            maxDocumentBytes);

        RemoveVerbosePayloadFields(payload);

        while (GetDocumentSize(document) > maxDocumentBytes && TrimLargestSectionItem(payload))
        {
        }

        while (GetDocumentSize(document) > maxDocumentBytes && TrimHeroItem(payload))
        {
        }

        while (GetDocumentSize(document) > maxDocumentBytes && RemoveLargestSection(payload))
        {
        }

        var trimmedSize = GetDocumentSize(document);

        if (trimmedSize > maxDocumentBytes)
        {
            throw new InvalidOperationException(
                $"Featured-content cache is still {trimmedSize} bytes after trimming; maximum is {maxDocumentBytes} bytes.");
        }

        _lastRefreshWarning = $"Featured-content payload was trimmed from {originalSize} to {trimmedSize} bytes.";
        _logger.LogWarning(_lastRefreshWarning);

        return document;
    }

    private static int GetDocumentSize(PtvFeaturedContentDocument document)
    {
        return JsonSerializer.SerializeToUtf8Bytes(document, JsonOptions).Length;
    }

    private static void RemoveVerbosePayloadFields(JsonObject payload)
    {
        if (payload["heroItems"] is JsonArray heroItems)
        {
            RemoveVerboseItemFields(heroItems);
        }

        if (payload["sectionItems"] is JsonObject sectionItems)
        {
            foreach (var section in sectionItems.ToArray())
            {
                if (section.Value is JsonArray items)
                {
                    RemoveVerboseItemFields(items);
                }
            }
        }
    }

    private static void RemoveVerboseItemFields(JsonArray items)
    {
        foreach (var item in items)
        {
            if (item is not JsonObject itemObject)
            {
                continue;
            }

            itemObject.Remove("Overview");
            itemObject.Remove("ProviderIds");
        }
    }

    private static bool TrimLargestSectionItem(JsonObject payload)
    {
        if (payload["sectionItems"] is not JsonObject sectionItems)
        {
            return false;
        }

        var largestSection = sectionItems
            .Select(section => new
            {
                section.Key,
                Items = section.Value as JsonArray
            })
            .Where(section => section.Items is { Count: > 1 })
            .OrderByDescending(section => section.Items?.Count ?? 0)
            .FirstOrDefault();

        if (largestSection?.Items is null)
        {
            return false;
        }

        largestSection.Items.RemoveAt(largestSection.Items.Count - 1);
        return true;
    }

    private static bool TrimHeroItem(JsonObject payload)
    {
        if (payload["heroItems"] is not JsonArray heroItems || heroItems.Count <= 1)
        {
            return false;
        }

        heroItems.RemoveAt(heroItems.Count - 1);
        return true;
    }

    private static bool RemoveLargestSection(JsonObject payload)
    {
        if (payload["sectionItems"] is not JsonObject sectionItems || sectionItems.Count == 0)
        {
            return false;
        }

        var largestSection = sectionItems
            .Select(section => new
            {
                section.Key,
                ItemCount = section.Value is JsonArray items ? items.Count : 0
            })
            .OrderByDescending(section => section.ItemCount)
            .FirstOrDefault();

        if (largestSection is null)
        {
            return false;
        }

        sectionItems.Remove(largestSection.Key);
        return true;
    }

    private async Task<JsonObject> BuildFeaturedPayloadAsync(
        PluginConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var rowLimit = configuration.RowSettings.RowMaxItems;
        var heroMaxItems = configuration.HeroSettings.HeroMaxItems;
        var candidates = GetCandidateItems();
        _logger.LogInformation("PiggieTV featured-content candidate items fetched: {CandidateCount}.", candidates.Count);
        var tmdbFacts = await GetTmdbFactsSafelyAsync(candidates).ConfigureAwait(false);
        var movies = candidates.Where(item => IsType(item, MovieTypes)).ToArray();
        var series = candidates.Where(item => IsType(item, SeriesTypes)).ToArray();
        var albums = candidates.Where(item => IsType(item, MusicTypes)).ToArray();
        var heroShowLimit = Math.Min(HeroShowLimit, Math.Max(1, heroMaxItems / 3));
        var heroMovieLimit = Math.Min(HeroMovieLimit, Math.Max(0, heroMaxItems - heroShowLimit));
        var heroItems = SelectHeroItems(series, heroShowLimit, "Recommended Shows")
            .Concat(SelectHeroItems(movies, heroMovieLimit, "Recommended Movies"))
            .Take(heroMaxItems)
            .ToArray();
        var rowSettings = PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(configuration.Rows);
        var generatedRows = BuildConfiguredRows(
            rowSettings,
            candidates,
            tmdbFacts,
            rowLimit,
            includeEmptyRows: true,
            cancellationToken: cancellationToken);
        var rowConfigApplied = rowSettings.SchemaVersion >= 2;
        var sectionItems = rowConfigApplied
            ? ToSectionItemsJson(generatedRows)
            : BuildLegacySectionItems(configuration, candidates, albums, tmdbFacts, rowLimit);
        var sectionDefinitions = rowConfigApplied
            ? ToSectionDefinitionsJson(generatedRows)
            : ToLegacySectionDefinitionsJson(sectionItems);
        var rowDiagnostics = rowConfigApplied
            ? ToDiagnosticsJson(generatedRows)
            : [];

        _logger.LogInformation(
            "PiggieTV featured-content heroes selected: {HeroCount}/{HeroMaxItems}. Sections built: {SectionCount}.",
            heroItems.Length,
            heroMaxItems,
            sectionItems.Count);

        return new JsonObject
        {
            ["heroItems"] = ToHeroJsonArray(heroItems),
            ["sectionItems"] = sectionItems,
            ["sections"] = sectionDefinitions,
            ["rowConfigApplied"] = rowConfigApplied,
            ["rowDiagnostics"] = rowDiagnostics
        };
    }

    private JsonObject BuildLegacySectionItems(
        PluginConfiguration configuration,
        IReadOnlyList<BaseItem> candidates,
        IReadOnlyList<BaseItem> albums,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts> tmdbFacts,
        int rowLimit)
    {
        var series = candidates.Where(item => IsType(item, SeriesTypes)).ToArray();
        var movies = candidates.Where(item => IsType(item, MovieTypes)).ToArray();
        var sectionItems = new JsonObject
        {
            ["latest-shows"] = BuildSection("latest-shows", () => SelectLatestItems(series, rowLimit)),
            ["latest-movies"] = BuildSection("latest-movies", () => SelectLatestItems(movies, rowLimit)),
            ["latest-music"] = BuildSection("latest-music", () => SelectLatestItems(albums, rowLimit)),
            ["horror"] = BuildSection("horror", () => SelectMatchedItems(candidates, item => MatchesAny(item, ["horror"], tmdbFacts), VideoTypes, rowLimit)),
            ["comedy"] = BuildSection("comedy", () => SelectMatchedItems(candidates, item => MatchesAny(item, ["comedy"], tmdbFacts), VideoTypes, rowLimit)),
            ["family-animation"] = BuildSection("family-animation", () => SelectMatchedItems(candidates, item => IsFamilyAnimationItem(item, tmdbFacts), VideoTypes, rowLimit)),
            ["drama"] = BuildSection("drama", () => SelectMatchedItems(candidates, item => MatchesAny(item, ["drama"], tmdbFacts), VideoTypes, rowLimit)),
            ["science-fiction"] = BuildSection("science-fiction", () => SelectMatchedItems(candidates, item => MatchesAny(item, ["science fiction", "sci-fi", "sci fi", "space"], tmdbFacts), VideoTypes, rowLimit)),
            ["anime"] = BuildSection("anime", () => SelectMatchedItems(candidates, item => IsAnimeItem(item, tmdbFacts), VideoTypes, rowLimit)),
            ["music"] = BuildSection("music", () => SelectRankedItems(albums, rowLimit)),
            ["family"] = BuildSection("family", () => SelectMatchedItems(candidates, item => MatchesAny(item, ["family"], tmdbFacts), VideoTypes, rowLimit)),
            ["action"] = BuildSection("action", () => SelectMatchedItems(candidates, item => MatchesAny(item, ["action"], tmdbFacts), VideoTypes, rowLimit)),
            ["disney"] = BuildSection("disney", () => SelectMatchedItems(candidates, item => IsDisneyItem(item, tmdbFacts), VideoTypes, rowLimit)),
            ["marvel"] = BuildSection("marvel", () => SelectMatchedItems(candidates, item => MatchesAny(item, ["marvel", "avengers", "spider-man", "x-men"], tmdbFacts), VideoTypes, rowLimit)),
            ["star-wars"] = BuildSection("star-wars", () => SelectMatchedItems(candidates, item => MatchesAny(item, StarWarsTerms, tmdbFacts), VideoTypes, rowLimit)),
            ["star-trek"] = BuildSection("star-trek", () => SelectMatchedItems(candidates, item => MatchesAny(item, StarTrekTerms, tmdbFacts), VideoTypes, rowLimit)),
            ["adult-animation"] = BuildSection("adult-animation", () => SelectMatchedItems(candidates, item => MatchesAny(item, ["adult animation", "adult swim", "animation"], tmdbFacts), VideoTypes, rowLimit)),
            ["crime"] = BuildSection("crime", () => SelectMatchedItems(candidates, item => MatchesAny(item, ["crime", "detective", "mystery"], tmdbFacts), VideoTypes, rowLimit))
        };

        if (configuration.TagSettings.Enabled && configuration.TagSettings.EnableTagRows)
        {
            foreach (var rowDefinition in configuration.TagSettings.RowDefinitions.Where(row => row.Enabled))
            {
                IReadOnlyCollection<string> allowedTypes = rowDefinition.IncludeItemTypes.Count == 0 ? VideoTypes : rowDefinition.IncludeItemTypes;
                var limit = Math.Clamp(rowDefinition.Limit, 1, rowLimit);

                sectionItems[rowDefinition.Id] = BuildSection(
                    rowDefinition.Id,
                    () => SelectMatchedItems(
                        candidates,
                        item => MatchesTagRow(item, rowDefinition, configuration.TagSettings),
                        allowedTypes,
                        limit));
            }
        }

        return sectionItems;
    }

    private List<GeneratedRow> BuildConfiguredRows(
        RowBuilderSettings settings,
        IReadOnlyList<BaseItem> candidates,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts> tmdbFacts,
        int rowLimit,
        bool includeEmptyRows,
        CancellationToken cancellationToken)
    {
        settings = PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(settings);

        if (!settings.Enabled)
        {
            return [];
        }

        var rows = new List<GeneratedRow>();
        var seenRowIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var seenSourceKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var rule in settings.Rules.Where(rule => rule.Enabled).OrderBy(rule => rule.SortPriority))
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (IsVirtualRowRule(rule))
            {
                rows.Add(CreateVirtualRuleRow(rule, seenRowIds));
                continue;
            }

            var sources = GetRuleSources(rule, candidates, tmdbFacts)
                .Where(source => seenSourceKeys.Add(GetSourceDeduplicationKey(rule, source)))
                .ToArray();

            foreach (var source in sources)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var stopwatch = Stopwatch.StartNew();
                var matchingItems = candidates.Where(item =>
                    IsAllowedForRule(item, rule, tmdbFacts)
                    && MatchesRuleSource(item, rule, source, tmdbFacts));
                var selectedItems = SelectRuleItems(matchingItems, rule, rowLimit, out var duplicateCount);
                stopwatch.Stop();

                if (!includeEmptyRows && selectedItems.Count == 0)
                {
                    continue;
                }

                rows.Add(new GeneratedRow(
                    MakeRowId(rule, source, seenRowIds),
                    GetRuleRowTitle(rule, source),
                    rule,
                    source,
                    "featured",
                    GetProviderUsed(rule, tmdbFacts),
                    GetProviderError(rule),
                    selectedItems,
                    duplicateCount,
                    stopwatch.ElapsedMilliseconds,
                    selectedItems.Count == 0 ? "No matching Jellyfin items were found." : null));
            }
        }

        return rows;
    }

    private static bool IsVirtualRowRule(RowBuilderRule rule)
    {
        return string.Equals(rule.SourceType, "continueWatching", StringComparison.OrdinalIgnoreCase)
            || string.Equals(rule.SourceType, "requested", StringComparison.OrdinalIgnoreCase);
    }

    private static GeneratedRow CreateVirtualRuleRow(RowBuilderRule rule, ISet<string> seenRowIds)
    {
        var sectionType = string.Equals(rule.SourceType, "requested", StringComparison.OrdinalIgnoreCase)
            ? "seerr-requests"
            : "continue";

        return new GeneratedRow(
            MakeRowId(rule, rule.SourceValue, seenRowIds),
            rule.Name,
            rule,
            rule.SourceValue,
            sectionType,
            "jellyfin",
            null,
            [],
            0,
            0,
            string.Equals(rule.SourceType, "requested", StringComparison.OrdinalIgnoreCase)
                ? "No requests found or Jellyseerr is not configured."
                : null);
    }

    private static RowBuilderSettings CloneRowBuilderSettings(RowBuilderSettings settings)
    {
        return new RowBuilderSettings
        {
            SchemaVersion = settings.SchemaVersion,
            Enabled = settings.Enabled,
            DefaultsInitialized = settings.DefaultsInitialized,
            Rules = settings.Rules
                .Select(rule => new RowBuilderRule
                {
                    Id = rule.Id,
                    Enabled = rule.Enabled,
                    Name = rule.Name,
                    MediaType = rule.MediaType,
                    SourceType = rule.SourceType,
                    SourceValue = rule.SourceValue,
                    GenerationMode = rule.GenerationMode,
                    ItemLimit = rule.ItemLimit,
                    RowCount = rule.RowCount,
                    IncludeSubgenres = rule.IncludeSubgenres,
                    SubgenreRowCount = rule.SubgenreRowCount,
                    Seasonal = rule.Seasonal is null
                        ? null
                        : new RowSeasonalSettings
                        {
                            Mode = rule.Seasonal.Mode,
                            StartMonth = rule.Seasonal.StartMonth,
                            StartDay = rule.Seasonal.StartDay,
                            EndMonth = rule.Seasonal.EndMonth,
                            EndDay = rule.Seasonal.EndDay
                    },
                    ProviderHints = rule.ProviderHints.ToList(),
                    SortPriority = rule.SortPriority,
                    Tier = rule.Tier,
                    Presentation = rule.Presentation,
                    GroupTitle = rule.GroupTitle
                })
                .ToList(),
            Categories = settings.Categories
                .Select(category => new RowBuilderCategory
                {
                    Id = category.Id,
                    Enabled = category.Enabled,
                    MediaType = category.MediaType,
                    SourceType = category.SourceType,
                    GenerationMode = category.GenerationMode,
                    RowCount = category.RowCount,
                    Entries = category.Entries.ToList(),
                    SourcePoolFilters = category.SourcePoolFilters.ToList()
                })
                .ToList()
        };
    }

    private static string GetSourceDeduplicationKey(RowBuilderCategory category, string source)
    {
        return string.Join(
            '|',
            NormalizeSearchText(category.MediaType),
            NormalizeSearchText(category.SourceType),
            NormalizeSearchText(source));
    }

    private static string GetSourceDeduplicationKey(RowBuilderRule rule, string source)
    {
        return string.Join(
            '|',
            NormalizeSearchText(rule.MediaType),
            NormalizeSearchText(rule.SourceType),
            NormalizeSearchText(source));
    }

    private static IReadOnlyList<string> GetRuleSources(
        RowBuilderRule rule,
        IReadOnlyList<BaseItem> candidates,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts> tmdbFacts)
    {
        if (string.Equals(rule.SourceType, "seasonal", StringComparison.OrdinalIgnoreCase))
        {
            return [ResolveSeasonalMode(rule)];
        }

        if (string.Equals(rule.SourceType, "latest", StringComparison.OrdinalIgnoreCase))
        {
            return [rule.SourceValue];
        }

        if (string.Equals(rule.SourceType, "genre", StringComparison.OrdinalIgnoreCase)
            && string.Equals(rule.GenerationMode, "random", StringComparison.OrdinalIgnoreCase)
            && rule.IncludeSubgenres)
        {
            var subgenres = GetSubgenres(rule.SourceValue)
                .Take(Math.Max(1, rule.SubgenreRowCount > 0 ? rule.SubgenreRowCount : rule.RowCount))
                .ToArray();

            return subgenres.Length > 0 ? subgenres : [rule.SourceValue];
        }

        if (!string.IsNullOrWhiteSpace(rule.SourceValue))
        {
            return [rule.SourceValue];
        }

        var sources = candidates
            .Where(item => IsAllowedForRule(item, rule, tmdbFacts))
            .SelectMany(item => GetSourceValues(item, rule.SourceType))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .GroupBy(NormalizeSearchText)
            .Where(group => !string.IsNullOrWhiteSpace(group.Key))
            .Select(group => new
            {
                Name = group.First(),
                Count = group.Count()
            })
            .OrderByDescending(source => source.Count)
            .ThenBy(source => source.Name, StringComparer.OrdinalIgnoreCase)
            .Take(Math.Max(1, rule.RowCount))
            .Select(source => source.Name)
            .ToArray();

        return sources.Length > 0 ? sources : [rule.Name];
    }

    private static IReadOnlyList<string> GetCategorySources(
        RowBuilderCategory category,
        IReadOnlyList<BaseItem> candidates,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts> tmdbFacts)
    {
        if (string.Equals(category.GenerationMode, "specific", StringComparison.OrdinalIgnoreCase))
        {
            return category.Entries;
        }

        var poolFilters = category.SourcePoolFilters
            .Select(NormalizeSearchText)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToArray();
        var sources = candidates
            .Where(item => IsAllowedForCategory(item, category, tmdbFacts))
            .SelectMany(item => GetSourceValues(item, category.SourceType))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Where(value => poolFilters.Length == 0 || poolFilters.Any(filter => MatchesSourceValue(value, filter)))
            .GroupBy(NormalizeSearchText)
            .Where(group => !string.IsNullOrWhiteSpace(group.Key))
            .Select(group => new
            {
                Name = group.First(),
                Count = group.Count()
            })
            .OrderByDescending(source => source.Count)
            .ThenBy(source => source.Name, StringComparer.OrdinalIgnoreCase)
            .Take(Math.Max(1, category.RowCount))
            .Select(source => source.Name)
            .ToArray();

        return sources.Length > 0 ? sources : category.SourcePoolFilters.Take(Math.Max(1, category.RowCount)).ToArray();
    }

    private static IEnumerable<string> GetSourceValues(BaseItem item, string sourceType)
    {
        if (string.Equals(sourceType, "studio", StringComparison.OrdinalIgnoreCase))
        {
            return item.Studios ?? Array.Empty<string>();
        }

        if (string.Equals(sourceType, "collection", StringComparison.OrdinalIgnoreCase)
            || string.Equals(sourceType, "customTag", StringComparison.OrdinalIgnoreCase))
        {
            return (item.Tags ?? Array.Empty<string>()).Concat(item.Genres ?? Array.Empty<string>());
        }

        if (string.Equals(sourceType, "library", StringComparison.OrdinalIgnoreCase))
        {
            return (item.Tags ?? Array.Empty<string>()).DefaultIfEmpty(GetItemType(item));
        }

        return item.Genres ?? Array.Empty<string>();
    }

    private static bool IsAllowedForRule(
        BaseItem item,
        RowBuilderRule rule,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts>? tmdbFacts)
    {
        if (!IsType(item, GetAllowedTypes(rule.MediaType)))
        {
            return false;
        }

        if (string.Equals(rule.MediaType, "anime", StringComparison.OrdinalIgnoreCase))
        {
            return IsAnimeItem(item, tmdbFacts);
        }

        if (string.Equals(rule.MediaType, "cartoons", StringComparison.OrdinalIgnoreCase))
        {
            return IsFamilyAnimationItem(item, tmdbFacts);
        }

        return true;
    }

    private static bool IsAllowedForCategory(
        BaseItem item,
        RowBuilderCategory category,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts>? tmdbFacts)
    {
        if (!IsType(item, GetAllowedTypes(category.MediaType)))
        {
            return false;
        }

        if (string.Equals(category.MediaType, "anime", StringComparison.OrdinalIgnoreCase))
        {
            return IsAnimeItem(item, tmdbFacts);
        }

        if (string.Equals(category.MediaType, "cartoons", StringComparison.OrdinalIgnoreCase))
        {
            return IsFamilyAnimationItem(item, tmdbFacts);
        }

        return true;
    }

    private static IReadOnlyCollection<string> GetAllowedTypes(string mediaType)
    {
        return mediaType.ToLowerInvariant() switch
        {
            "movies" => MovieTypes,
            "shows" => SeriesTypes,
            "music" => MusicTypes,
            "books" => ["Book"],
            "livetv" => ["LiveTvProgram"],
            "liveTv" => ["LiveTvProgram"],
            "anime" => VideoTypes,
            "cartoons" => VideoTypes,
            "mixed" => VideoTypes,
            _ => VideoTypes
        };
    }

    private static bool MatchesRuleSource(
        BaseItem item,
        RowBuilderRule rule,
        string source,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts> tmdbFacts)
    {
        if (string.Equals(rule.SourceType, "latest", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (string.Equals(rule.SourceType, "seasonal", StringComparison.OrdinalIgnoreCase))
        {
            return MatchesAny(item, GetSeasonalTerms(source), tmdbFacts);
        }

        if (string.Equals(rule.SourceType, "studio", StringComparison.OrdinalIgnoreCase))
        {
            return item.Studios?.Any(studio => MatchesSourceValue(studio, source)) == true;
        }

        if (string.Equals(rule.SourceType, "genre", StringComparison.OrdinalIgnoreCase))
        {
            return item.Genres?.Any(genre => MatchesSourceValue(genre, source)) == true
                || MatchesAny(item, [source], tmdbFacts);
        }

        if (string.Equals(rule.SourceType, "library", StringComparison.OrdinalIgnoreCase))
        {
            return MatchesSourceValue(GetItemType(item), source)
                || (!string.IsNullOrWhiteSpace(item.Path) && item.Path.Contains(source, StringComparison.OrdinalIgnoreCase));
        }

        if (string.Equals(rule.SourceType, "collection", StringComparison.OrdinalIgnoreCase))
        {
            return MatchesAny(item, [source], tmdbFacts);
        }

        return MatchesAny(item, [source], tmdbFacts);
    }

    private static bool MatchesCategorySource(
        BaseItem item,
        RowBuilderCategory category,
        string source,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts> tmdbFacts)
    {
        if (string.Equals(category.SourceType, "studio", StringComparison.OrdinalIgnoreCase))
        {
            return item.Studios?.Any(studio => MatchesSourceValue(studio, source)) == true;
        }

        if (string.Equals(category.SourceType, "genre", StringComparison.OrdinalIgnoreCase))
        {
            return item.Genres?.Any(genre => MatchesSourceValue(genre, source)) == true;
        }

        return MatchesAny(item, [source], tmdbFacts);
    }

    private static bool MatchesSourceValue(string value, string source)
    {
        var normalizedValue = NormalizeSearchText(value);
        var normalizedSource = NormalizeSearchText(source);

        return normalizedValue.Contains(normalizedSource, StringComparison.Ordinal)
            || normalizedSource.Contains(normalizedValue, StringComparison.Ordinal);
    }

    private static IReadOnlyList<BaseItem> SelectRankedDistinctItems(
        IEnumerable<BaseItem> items,
        int limit,
        out int duplicateCount)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var selected = new List<BaseItem>();
        duplicateCount = 0;

        foreach (var item in items.OrderByDescending(GetTrendScore).ThenByDescending(GetSortDate))
        {
            if (!seen.Add(GetPresentationKey(item)))
            {
                duplicateCount++;
                continue;
            }

            selected.Add(item);

            if (selected.Count >= limit)
            {
                break;
            }
        }

        return selected;
    }

    private static IReadOnlyList<BaseItem> SelectRuleItems(
        IEnumerable<BaseItem> items,
        RowBuilderRule rule,
        int rowLimit,
        out int duplicateCount)
    {
        var limit = Math.Clamp(rule.ItemLimit > 0 ? rule.ItemLimit : rowLimit, 1, Math.Max(1, rowLimit));
        var orderedItems = rule.GenerationMode switch
        {
            "latest" => items.OrderByDescending(GetSortDate),
            "highestRated" => items.OrderByDescending(GetRatingScore).ThenByDescending(GetSortDate),
            "popular" => items.OrderByDescending(GetTrendScore).ThenByDescending(GetSortDate),
            _ => items.OrderBy(_ => Guid.NewGuid())
        };

        return SelectDistinctItems(orderedItems, limit, out duplicateCount);
    }

    private static IReadOnlyList<BaseItem> SelectDistinctItems(
        IEnumerable<BaseItem> items,
        int limit,
        out int duplicateCount)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var selected = new List<BaseItem>();
        duplicateCount = 0;

        foreach (var item in items)
        {
            if (!seen.Add(GetPresentationKey(item)))
            {
                duplicateCount++;
                continue;
            }

            selected.Add(item);

            if (selected.Count >= limit)
            {
                break;
            }
        }

        return selected;
    }

    private static double GetRatingScore(BaseItem item)
    {
        return item.CommunityRating
            ?? item.CriticRating
            ?? 0;
    }

    private static string GetPresentationKey(BaseItem item)
    {
        foreach (var providerKey in new[] { "Tmdb", "Imdb", "Tvdb" })
        {
            if (item.ProviderIds.TryGetValue(providerKey, out var providerId)
                && !string.IsNullOrWhiteSpace(providerId))
            {
                return $"{providerKey}:{providerId}";
            }
        }

        return NormalizeSearchText($"{GetItemType(item)} {item.Name} {item.ProductionYear ?? item.PremiereDate?.Year ?? 0}");
    }

    private static string MakeRowId(RowBuilderRule rule, string source, ISet<string> seenRowIds)
    {
        var baseId = Slugify(string.Equals(rule.SourceValue, source, StringComparison.OrdinalIgnoreCase)
            ? rule.Id
            : $"{rule.Id}-{source}");
        var rowId = baseId;
        var suffix = 2;

        while (!seenRowIds.Add(rowId))
        {
            rowId = $"{baseId}-{suffix++}";
        }

        return rowId;
    }

    private static string GetRuleRowTitle(RowBuilderRule rule, string source)
    {
        if (!string.Equals(rule.SourceType, "genre", StringComparison.OrdinalIgnoreCase)
            || string.Equals(rule.SourceValue, source, StringComparison.OrdinalIgnoreCase))
        {
            return rule.Name;
        }

        return GetRowTitle(source);
    }

    private static string Slugify(string value)
    {
        var slug = new string(value
            .Trim()
            .ToLowerInvariant()
            .Select(character => char.IsLetterOrDigit(character) ? character : '-')
            .ToArray());

        while (slug.Contains("--", StringComparison.Ordinal))
        {
            slug = slug.Replace("--", "-", StringComparison.Ordinal);
        }

        slug = slug.Trim('-');

        return slug.Length > 80 ? slug[..80] : slug;
    }

    private static string GetRowTitle(string source)
    {
        return string.Join(' ', source
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => word.Length == 0 ? word : char.ToUpperInvariant(word[0]) + word[1..]));
    }

    private static string GetProviderUsed(
        RowBuilderRule rule,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts> tmdbFacts)
    {
        if (string.Equals(rule.MediaType, "movies", StringComparison.OrdinalIgnoreCase) && tmdbFacts.Count > 0)
        {
            return "tmdb";
        }

        if (string.Equals(rule.MediaType, "music", StringComparison.OrdinalIgnoreCase))
        {
            return "jellyfin/musicbrainz";
        }

        return "jellyfin";
    }

    private string? GetProviderError(RowBuilderRule rule)
    {
        if (!string.Equals(rule.MediaType, "movies", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return _tmdbMetadataService.GetStatus().LastError;
    }

    private JsonObject ToSectionItemsJson(IEnumerable<GeneratedRow> rows)
    {
        var sectionItems = new JsonObject();

        foreach (var row in rows)
        {
            sectionItems[row.Id] = BuildSection(row.Id, () => row.Items);
        }

        return sectionItems;
    }

    private static JsonArray ToSectionDefinitionsJson(IEnumerable<GeneratedRow> rows)
    {
        var definitions = new JsonArray();

        foreach (var row in rows)
        {
            definitions.Add(new JsonObject
            {
                ["id"] = row.Id,
                ["title"] = row.Title,
                ["type"] = row.SectionType,
                ["ruleId"] = row.Rule.Id,
                ["ruleName"] = row.Rule.Name,
                ["mediaType"] = row.Rule.MediaType,
                ["sourceType"] = row.Rule.SourceType,
                ["generationMode"] = row.Rule.GenerationMode,
                ["source"] = row.Source,
                ["sourceValue"] = row.Rule.SourceValue,
                ["tier"] = row.Rule.Tier,
                ["presentation"] = row.Rule.Presentation,
                ["groupTitle"] = row.Rule.GroupTitle,
                ["itemCount"] = row.Items.Count,
                ["showWhenEmpty"] = true,
                ["emptyResultReason"] = row.EmptyResultReason,
                ["shape"] = GetRowShape(row.Rule.MediaType),
                ["includeItemTypes"] = string.Join(",", GetAllowedTypes(row.Rule.MediaType))
            });
        }

        return definitions;
    }

    private static JsonArray ToLegacySectionDefinitionsJson(JsonObject sectionItems)
    {
        var definitions = new JsonArray();

        foreach (var section in sectionItems)
        {
            definitions.Add(new JsonObject
            {
                ["id"] = section.Key,
                ["title"] = GetRowTitle(section.Key.Replace('-', ' ')),
                ["type"] = "featured",
                ["mediaType"] = "mixed",
                ["sourceType"] = "legacy",
                ["generationMode"] = "legacy",
                ["source"] = section.Key,
                ["itemCount"] = section.Value is JsonArray items ? items.Count : 0
            });
        }

        return definitions;
    }

    private static JsonArray ToDiagnosticsJson(IEnumerable<GeneratedRow> rows)
    {
        var diagnostics = new JsonArray();

        foreach (var row in rows)
        {
            diagnostics.Add(new JsonObject
            {
                ["categoryId"] = row.Rule.Id,
                ["ruleId"] = row.Rule.Id,
                ["ruleName"] = row.Rule.Name,
                ["sourceType"] = row.Rule.SourceType,
                ["mediaType"] = row.Rule.MediaType,
                ["generationMode"] = row.Rule.GenerationMode,
                ["searchTerm"] = row.Source,
                ["sourceValue"] = row.Rule.SourceValue,
                ["providerUsed"] = row.ProviderUsed,
                ["providerError"] = row.ProviderError,
                ["itemCount"] = row.Items.Count,
                ["filteredDuplicateCount"] = row.FilteredDuplicateCount,
                ["emptyResultReason"] = row.EmptyResultReason,
                ["generationTimeMs"] = row.GenerationTimeMs
            });
        }

        return diagnostics;
    }

    private static string GetRowShape(string mediaType)
    {
        return mediaType.ToLowerInvariant() switch
        {
            "movies" => "portrait",
            "shows" => "portrait",
            _ => "landscape"
        };
    }

    private static PtvRowPreviewItem ToPreviewItem(GeneratedRow row)
    {
        var warnings = new List<string>();

        if (row.Items.Count == 0)
        {
            warnings.Add(row.EmptyResultReason ?? "No matching items.");
        }
        else if (row.Items.Count < 4)
        {
            warnings.Add("Weak row: fewer than 4 matching items.");
        }

        if (row.FilteredDuplicateCount > 0)
        {
            warnings.Add($"{row.FilteredDuplicateCount} duplicate item(s) filtered.");
        }

        return new PtvRowPreviewItem
        {
            Id = row.Id,
            Title = row.Title,
            CategoryId = row.Rule.Id,
            RuleId = row.Rule.Id,
            RuleName = row.Rule.Name,
            MediaType = row.Rule.MediaType,
            SourceType = row.Rule.SourceType,
            GenerationMode = row.Rule.GenerationMode,
            Source = row.Source,
            ProviderUsed = row.ProviderUsed,
            ItemCount = row.Items.Count,
            Empty = row.Items.Count == 0,
            Weak = row.Items.Count is > 0 and < 4,
            Warnings = warnings
        };
    }

    private static PtvRowGenerationDiagnostic ToGenerationDiagnostic(GeneratedRow row)
    {
        return new PtvRowGenerationDiagnostic
        {
            CategoryId = row.Rule.Id,
            RuleId = row.Rule.Id,
            RuleName = row.Rule.Name,
            SourceType = row.Rule.SourceType,
            MediaType = row.Rule.MediaType,
            GenerationMode = row.Rule.GenerationMode,
            SearchTerm = row.Source,
            SourceValue = row.Rule.SourceValue,
            ProviderUsed = row.ProviderUsed,
            ProviderError = row.ProviderError,
            ItemCount = row.Items.Count,
            FilteredDuplicateCount = row.FilteredDuplicateCount,
            EmptyResultReason = row.EmptyResultReason,
            GenerationTimeMs = row.GenerationTimeMs
        };
    }

    private static PtvRowValidationResult ValidateRowBuilderSettings(RowBuilderSettings settings)
    {
        settings = PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(settings);
        var result = new PtvRowValidationResult();
        var ruleIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var rule in settings.Rules)
        {
            if (!ruleIds.Add(rule.Id))
            {
                result.Errors.Add($"Duplicate rule id '{rule.Id}'.");
            }

            if (string.IsNullOrWhiteSpace(rule.Name))
            {
                result.Errors.Add($"Rule '{rule.Id}' needs a row name.");
            }

            if (RequiresSourceValue(rule) && string.IsNullOrWhiteSpace(rule.SourceValue))
            {
                result.Errors.Add($"Rule '{rule.Name}' needs a source value.");
            }

            if (string.Equals(rule.SourceType, "requested", StringComparison.OrdinalIgnoreCase))
            {
                result.Warnings.Add($"Rule '{rule.Name}' depends on a configured Jellyseerr/Jellyseer integration.");
            }

            if (rule.RowCount > 30 || rule.SubgenreRowCount > 20 || rule.ItemLimit > 60)
            {
                result.Warnings.Add($"Rule '{rule.Name}' may be heavy. Preview before refreshing the cache.");
            }
        }

        result.Ok = result.Errors.Count == 0;

        return result;
    }

    private static bool RequiresSourceValue(RowBuilderRule rule)
    {
        return rule.SourceType is "genre" or "studio" or "library" or "collection";
    }

    private static IReadOnlyList<string> GetSubgenres(string genre)
    {
        var normalizedGenre = NormalizeSearchText(genre);

        if (normalizedGenre.Contains("horror", StringComparison.Ordinal))
        {
            return [
                "Supernatural Horror",
                "Slasher",
                "Creature Feature",
                "Psychological Horror",
                "Horror Comedy",
                "Vampire",
                "Zombie",
                "Found Footage"
            ];
        }

        if (normalizedGenre.Contains("science fiction", StringComparison.Ordinal)
            || normalizedGenre.Contains("sci fi", StringComparison.Ordinal))
        {
            return ["Space Opera", "Cyberpunk", "Dystopian", "Time Travel", "Alien", "Robot", "Post Apocalyptic"];
        }

        if (normalizedGenre.Contains("fantasy", StringComparison.Ordinal))
        {
            return ["High Fantasy", "Urban Fantasy", "Sword and Sorcery", "Dark Fantasy", "Magic"];
        }

        if (normalizedGenre.Contains("anime", StringComparison.Ordinal))
        {
            return ["Isekai", "Mecha", "Shonen", "Shojo", "Slice of Life", "Supernatural"];
        }

        return [];
    }

    private static string ResolveSeasonalMode(RowBuilderRule rule)
    {
        var mode = rule.Seasonal?.Mode ?? rule.SourceValue;

        if (!string.Equals(mode, "auto", StringComparison.OrdinalIgnoreCase))
        {
            return mode;
        }

        var now = DateTimeOffset.Now;
        var month = now.Month;
        var day = now.Day;

        if (month == 10) return "halloween";
        if (month == 11 && day >= 10 && day <= 30) return "thanksgiving";
        if (month == 12) return "christmas";
        if (month == 1 && day <= 14) return "newYear";
        if (month == 2 && day <= 18) return "valentines";
        if (month is >= 6 and <= 8) return "summer";
        if (month is 1 or 2) return "winter";

        return "seasonal";
    }

    private static IReadOnlyList<string> GetSeasonalTerms(string mode)
    {
        return NormalizeSearchText(mode) switch
        {
            "halloween" => ["halloween", "horror", "haunted", "ghost", "witch", "monster", "pumpkin"],
            "christmas" => ["christmas", "holiday", "santa", "xmas", "winter"],
            "thanksgiving" => ["thanksgiving", "family", "autumn", "fall"],
            "valentines" => ["valentine", "romance", "love", "romantic"],
            "summer" => ["summer", "beach", "vacation", "camp"],
            "winter" => ["winter", "snow", "christmas", "holiday"],
            "newyear" => ["new year", "party", "celebration"],
            _ => [mode, "seasonal", "holiday"]
        };
    }

    private Dictionary<string, object?> BuildProviderStatus()
    {
        var tmdbStatus = _tmdbMetadataService.GetStatus();

        return new Dictionary<string, object?>
        {
            ["jellyfin"] = new
            {
                enabled = true,
                configured = true,
                lastError = (string?)null
            },
            ["tmdb"] = new
            {
                tmdbStatus.Enabled,
                tmdbStatus.Configured,
                tmdbStatus.CacheHits,
                tmdbStatus.CacheMisses,
                tmdbStatus.LastError,
                tmdbStatus.LastErrorCode
            },
            ["omdb"] = new
            {
                enabled = false,
                configured = false,
                lastError = "Not configured."
            },
            ["tvmaze"] = new
            {
                enabled = false,
                configured = false,
                lastError = "Not configured."
            },
            ["tvdb"] = new
            {
                enabled = false,
                configured = false,
                lastError = "Not configured."
            },
            ["anidb"] = new
            {
                enabled = false,
                configured = false,
                lastError = "Not configured."
            },
            ["anilist"] = new
            {
                enabled = false,
                configured = false,
                lastError = "Not configured."
            }
        };
    }

    private async Task<IReadOnlyDictionary<Guid, PtvTmdbItemFacts>> GetTmdbFactsSafelyAsync(
        IReadOnlyList<BaseItem> candidates)
    {
        if (!_tmdbMetadataService.GetStatus().Enabled)
        {
            return new Dictionary<Guid, PtvTmdbItemFacts>();
        }

        using var tmdbTimeoutSource = new CancellationTokenSource(TmdbMetadataTimeout);

        try
        {
            var facts = await _tmdbMetadataService.GetFactsAsync(candidates, tmdbTimeoutSource.Token).ConfigureAwait(false);
            var status = _tmdbMetadataService.GetStatus();

            if (!string.IsNullOrWhiteSpace(status.LastError))
            {
                _lastRefreshWarning = $"TMDb metadata failed: {NormalizeTmdbStatusMessage(status)}";
                _logger.LogWarning("PiggieTV featured-content refresh continued without TMDb metadata. Reason={Reason}", status.LastError);
            }

            return facts;
        }
        catch (OperationCanceledException)
        {
            _lastRefreshWarning = "TMDb metadata failed: timed out.";
            _logger.LogWarning("PiggieTV TMDb metadata enrichment timed out. Featured-content refresh will continue with Jellyfin metadata only.");
        }
        catch (Exception ex)
        {
            _lastRefreshWarning = $"TMDb metadata failed: {ex.Message}";
            _logger.LogWarning(ex, "PiggieTV TMDb metadata enrichment failed. Featured-content refresh will continue with Jellyfin metadata only.");
        }

        return new Dictionary<Guid, PtvTmdbItemFacts>();
    }

    private static string NormalizeTmdbStatusMessage(PtvTmdbMetadataStatus status)
    {
        if (string.Equals(status.LastErrorCode, "unauthorized", StringComparison.OrdinalIgnoreCase)
            || (status.LastError?.Contains("401", StringComparison.OrdinalIgnoreCase) ?? false)
            || (status.LastError?.Contains("unauthorized", StringComparison.OrdinalIgnoreCase) ?? false))
        {
            return "unauthorized.";
        }

        if (string.Equals(status.LastErrorCode, "missing-credential", StringComparison.OrdinalIgnoreCase))
        {
            return "missing credential.";
        }

        return status.LastError ?? "unknown error.";
    }

    private IReadOnlyList<BaseItem> GetCandidateItems()
    {
        var salt = (DateTimeOffset.UtcNow.Year * 400) + DateTimeOffset.UtcNow.DayOfYear;
        IReadOnlyList<BaseItem> children;

        try
        {
            children = _libraryManager.RootFolder.GetRecursiveChildren().ToArray();
            _logger.LogInformation("PiggieTV featured-content recursive item count: {ItemCount}.", children.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV featured-content item fetch failed.");
            throw;
        }

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
            .DistinctBy(GetPresentationKey, StringComparer.OrdinalIgnoreCase)
            .Take(limit)
            .ToArray();
    }

    private JsonArray BuildSection(string sectionName, Func<IReadOnlyList<BaseItem>> selector)
    {
        try
        {
            var items = selector();

            _logger.LogInformation("PiggieTV featured-content section {SectionName}: {ItemCount} items.", sectionName, items.Count);

            return ToJsonArray(items);
        }
        catch (Exception ex)
        {
            _lastRefreshWarning = $"Section {sectionName} failed and was returned empty.";
            _logger.LogWarning(ex, "PiggieTV featured-content section {SectionName} failed. Returning an empty partial row.", sectionName);

            return [];
        }
    }

    private static IReadOnlyList<BaseItem> SelectMatchedItems(
        IEnumerable<BaseItem> items,
        Func<BaseItem, bool> matcher,
        IReadOnlyCollection<string> allowedTypes,
        int limit)
    {
        return SelectRankedItems(items.Where(item => IsType(item, allowedTypes) && matcher(item)), limit);
    }

    private static IReadOnlyList<BaseItem> SelectRankedItems(IEnumerable<BaseItem> items, int limit)
    {
        return items
            .OrderByDescending(GetTrendScore)
            .ThenByDescending(GetSortDate)
            .DistinctBy(GetPresentationKey, StringComparer.OrdinalIgnoreCase)
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
            GetReflectedString(item, "OriginalTitle"),
            GetReflectedString(item, "SortName"),
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

    private static bool MatchesTagRow(BaseItem item, TagRowDefinition rowDefinition, TagSettings tagSettings)
    {
        var itemTags = (item.Tags ?? Array.Empty<string>())
            .Select(NormalizeSearchText)
            .ToHashSet(StringComparer.Ordinal);

        if (tagSettings.ExcludeTags.Any(tag => itemTags.Contains(NormalizeSearchText(tag))))
        {
            return false;
        }

        if (tagSettings.IncludeTags.Count > 0 && !tagSettings.IncludeTags.Any(tag => itemTags.Contains(NormalizeSearchText(tag))))
        {
            return false;
        }

        return rowDefinition.Tags.Count == 0 || rowDefinition.Tags.Any(tag => itemTags.Contains(NormalizeSearchText(tag)));
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
            GetReflectedString(item, "OriginalTitle"),
            GetReflectedString(item, "SortName"),
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
        AddMediaFacts(json, item);

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

    private static void AddMediaFacts(JsonObject json, BaseItem item)
    {
        AddValue(json, "Width", GetReflectedNumber(item, "Width"));
        AddValue(json, "Height", GetReflectedNumber(item, "Height"));
        AddValue(json, "VideoRange", GetReflectedString(item, "VideoRange"));
        AddValue(json, "VideoCodec", GetReflectedString(item, "VideoCodec"));

        var mediaSources = GetCompactMediaSources(item);

        if (mediaSources.Count > 0)
        {
            json["MediaSources"] = mediaSources;
        }

        var mediaStreams = GetCompactMediaStreams(item);

        if (mediaStreams.Count > 0)
        {
            json["MediaStreams"] = mediaStreams;
        }
    }

    private static JsonArray GetCompactMediaSources(BaseItem item)
    {
        var mediaSources = new JsonArray();

        foreach (var source in GetEnumerableProperty(item, "MediaSources").Take(2))
        {
            var sourceJson = new JsonObject();

            AddReflectedValue(sourceJson, "Container", source, "Container");
            AddReflectedValue(sourceJson, "Protocol", source, "Protocol");
            AddReflectedValue(sourceJson, "Type", source, "Type");
            AddReflectedValue(sourceJson, "MediaSourceType", source, "MediaSourceType");
            AddReflectedValue(sourceJson, "Width", source, "Width");
            AddReflectedValue(sourceJson, "Height", source, "Height");
            AddReflectedValue(sourceJson, "VideoRange", source, "VideoRange");
            AddReflectedValue(sourceJson, "VideoCodec", source, "VideoCodec");

            var streams = GetCompactMediaStreams(source);

            if (streams.Count > 0)
            {
                sourceJson["MediaStreams"] = streams;
            }

            if (sourceJson.Count > 0)
            {
                mediaSources.Add(sourceJson);
            }
        }

        return mediaSources;
    }

    private static JsonArray GetCompactMediaStreams(object source)
    {
        var mediaStreams = new JsonArray();

        foreach (var stream in GetEnumerableProperty(source, "MediaStreams").Take(8))
        {
            var streamJson = new JsonObject();

            AddReflectedValue(streamJson, "Type", stream, "Type");
            AddReflectedValue(streamJson, "Codec", stream, "Codec");
            AddReflectedValue(streamJson, "CodecTag", stream, "CodecTag");
            AddReflectedValue(streamJson, "Profile", stream, "Profile");
            AddReflectedValue(streamJson, "Title", stream, "Title");
            AddReflectedValue(streamJson, "DisplayTitle", stream, "DisplayTitle");
            AddReflectedValue(streamJson, "Width", stream, "Width");
            AddReflectedValue(streamJson, "Height", stream, "Height");
            AddReflectedValue(streamJson, "VideoRange", stream, "VideoRange");
            AddReflectedValue(streamJson, "VideoRangeType", stream, "VideoRangeType");
            AddReflectedValue(streamJson, "VideoDoViTitle", stream, "VideoDoViTitle");
            AddReflectedValue(streamJson, "Video3DFormat", stream, "Video3DFormat");
            AddReflectedValue(streamJson, "Channels", stream, "Channels");

            if (streamJson.Count > 0)
            {
                mediaStreams.Add(streamJson);
            }
        }

        return mediaStreams;
    }

    private static IEnumerable<object> GetEnumerableProperty(object source, string propertyName)
    {
        var value = GetReflectedValue(source, propertyName);

        if (value is not IEnumerable enumerable || value is string)
        {
            yield break;
        }

        foreach (var item in enumerable)
        {
            if (item is not null)
            {
                yield return item;
            }
        }
    }

    private static void AddReflectedValue(JsonObject json, string jsonPropertyName, object source, string propertyName)
    {
        AddValue(json, jsonPropertyName, GetReflectedValue(source, propertyName));
    }

    private static string? GetReflectedString(object source, string propertyName)
    {
        return Convert.ToString(GetReflectedValue(source, propertyName), CultureInfo.InvariantCulture);
    }

    private static int? GetReflectedNumber(object source, string propertyName)
    {
        var value = GetReflectedValue(source, propertyName);

        if (value is null)
        {
            return null;
        }

        if (value is IConvertible convertible)
        {
            try
            {
                var number = convertible.ToInt32(CultureInfo.InvariantCulture);

                return number > 0 ? number : null;
            }
            catch (FormatException)
            {
                return null;
            }
            catch (InvalidCastException)
            {
                return null;
            }
        }

        return null;
    }

    private static object? GetReflectedValue(object source, string propertyName)
    {
        return source.GetType().GetProperty(propertyName)?.GetValue(source);
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
