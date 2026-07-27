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
    private const int MinRecommendationRowItems = 12;
    private const int MaxRecommendationAlbumRepeats = 2;
    private const int MaxRecommendationArtistRepeats = 1;
    private const int MaxRecommendationSeriesRepeats = 2;
    private const string RowVariantDelimiter = "||";
    private static readonly TimeSpan TmdbMetadataTimeout = TimeSpan.FromSeconds(8);
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
        int CandidateCount,
        int MatchedCount,
        bool FallbackUsed,
        string QueryUsed,
        IReadOnlyList<string> MetadataSourceFieldsUsed,
        IReadOnlyList<string> First10MatchedItemNames,
        int FilteredDuplicateCount,
        long GenerationTimeMs,
        string? EmptyResultReason,
        int PlannedRowCount,
        int GeneratedSourceCount,
        int SourceIndex,
        string? DropReason);

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
            var queuedAt = Stopwatch.StartNew();

            _logger.LogInformation("PiggieTV featured-content refresh requested while another refresh is running; waiting to rebuild.");
            await _refreshGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            queuedAt.Stop();
            _logger.LogInformation(
                "PiggieTV featured-content refresh acquired after waiting {WaitDurationMs} ms.",
                queuedAt.ElapsedMilliseconds);
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
            var semanticStatus = PtvFeaturedContentValidator.GetSemanticStatus(payload);

            _logger.LogInformation(
                "PiggieTV featured-content generation classified. Classification={Classification}. HeroCount={HeroCount}. SectionCount={SectionCount}. PopulatedSectionCount={PopulatedSectionCount}. ItemCount={ItemCount}.",
                semanticStatus.Classification,
                semanticStatus.HeroCount,
                semanticStatus.SectionCount,
                semanticStatus.PopulatedSectionCount,
                semanticStatus.ItemCount);

            if (!semanticStatus.UsableForPersistence)
            {
                _lastRefreshWarning = $"Generated featured content was {semanticStatus.Classification}; the prior cache was retained.";
                throw new InvalidOperationException(_lastRefreshWarning);
            }

            var document = CreateFeaturedContentDocument(payload, startedAt, refreshIntervalMs);

            document = TrimDocumentToMaxSize(document);
            var preWriteStatus = PtvFeaturedContentStatus.FromDocument(document);
            _logger.LogInformation(
                "PiggieTV featured-content payload before write. PayloadBytes={PayloadBytes}. HasPayload={HasPayload}. HeroCount={HeroCount}. SectionCount={SectionCount}. ItemCount={ItemCount}.",
                GetDocumentSize(document),
                preWriteStatus.HasPayload,
                preWriteStatus.HeroCount,
                preWriteStatus.SectionCount,
                preWriteStatus.ItemCount);

            var storedDocument = await _store.WriteAsync(document, refreshToken).ConfigureAwait(false);
            var status = await _store.GetStatusAsync(refreshToken).ConfigureAwait(false);
            var storedContentStatus = PtvFeaturedContentStatus.FromDocument(storedDocument);
            var completedAt = DateTimeOffset.UtcNow;

            stopwatch.Stop();
            _lastRefreshCompletedAt = completedAt.ToUnixTimeMilliseconds();
            _lastRefreshDurationMs = stopwatch.ElapsedMilliseconds;
            _lastRefreshError = null;
            _nextRefreshAt = PtvFeaturedContentStatus.FromDocument(storedDocument).ExpiresAt;

            _logger.LogInformation(
                "PiggieTV featured-content cache refreshed in {DurationMs} ms. CacheExists={CacheExists}. CachePayloadBytes={CachePayloadBytes}. HeroCount={HeroCount}. SectionCount={SectionCount}. ItemCount={ItemCount}. CacheWriteError={CacheWriteError}.",
                _lastRefreshDurationMs,
                status.FeaturedCacheExists,
                status.CachePayloadBytes,
                storedContentStatus.HeroCount,
                storedContentStatus.SectionCount,
                storedContentStatus.ItemCount,
                status.CacheWriteError);

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
        var peopleByItemId = NeedsPeopleMetadata(rowSettings)
            ? BuildPeopleMetadataIndex(candidates)
            : new Dictionary<Guid, IReadOnlyList<string>>();
        var generatedRows = BuildConfiguredRows(
            rowSettings,
            candidates,
            tmdbFacts,
            peopleByItemId,
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
        var recommendationSettings = PtvPluginSettingsNormalizer.NormalizeRecommendationSettings(configuration.Recommendations);
        var rowConfigHash = ComputeRowConfigHash(rowSettings);
        var recommendationConfigHash = string.IsNullOrWhiteSpace(recommendationSettings.RecommendationConfigHash)
            ? ComputeRecommendationConfigHash(recommendationSettings)
            : recommendationSettings.RecommendationConfigHash;
        var rowConfigApplied = rowSettings.SchemaVersion >= 2;
        var includeConfiguredRows = rowConfigApplied && rowSettings.Enabled;
        var peopleByItemId = includeConfiguredRows && NeedsPeopleMetadata(rowSettings)
            ? BuildPeopleMetadataIndex(candidates)
            : new Dictionary<Guid, IReadOnlyList<string>>();
        var generatedRows = includeConfiguredRows
            ? BuildConfiguredRows(
                rowSettings,
                candidates,
                tmdbFacts,
                peopleByItemId,
                rowLimit,
                includeEmptyRows: false,
                cancellationToken: cancellationToken)
            : [];
        var sectionItems = rowConfigApplied
            ? ToSectionItemsJson(generatedRows)
            : BuildLegacySectionItems(configuration, candidates, albums, tmdbFacts, rowLimit);
        var sectionDefinitions = rowConfigApplied
            ? ToSectionDefinitionsJson(generatedRows, rowConfigHash)
            : ToLegacySectionDefinitionsJson(sectionItems);
        var rowDiagnostics = rowConfigApplied
            ? ToDiagnosticsJson(generatedRows, rowConfigHash)
            : [];
        var appendedRecommendationRows = AppendRecommendationRows(
            sectionItems,
            sectionDefinitions,
            rowDiagnostics,
            recommendationSettings,
            configuration.RowSettings.EnableRecommendedRows,
            recommendationConfigHash);

        LogFinalSections(sectionDefinitions);
        _logger.LogInformation(
            "PiggieTV featured-content heroes selected: {HeroCount}/{HeroMaxItems}. RowBuilderEnabled={RowBuilderEnabled}. GeneratedRowCount={GeneratedRowCount}. Sections built: {SectionCount}. RecommendationRows={RecommendationRows}.",
            heroItems.Length,
            heroMaxItems,
            includeConfiguredRows,
            generatedRows.Count,
            sectionItems.Count,
            appendedRecommendationRows);

        return new JsonObject
        {
            ["heroItems"] = ToHeroJsonArray(heroItems),
            ["sectionItems"] = sectionItems,
            ["sections"] = sectionDefinitions,
            ["rowConfigApplied"] = rowConfigApplied,
            ["rowConfigHash"] = rowConfigHash,
            ["recommendationConfigHash"] = recommendationConfigHash,
            ["rowConfigVersion"] = rowSettings.SchemaVersion,
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
        IReadOnlyDictionary<Guid, IReadOnlyList<string>> peopleByItemId,
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

        foreach (var rule in settings.Rules.Where(rule => rule.Enabled).OrderBy(rule => rule.SortPriority))
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (IsVirtualRowRule(rule))
            {
                rows.Add(CreateVirtualRuleRow(rule));
                continue;
            }

            var sources = GetRuleSources(rule, candidates, tmdbFacts, peopleByItemId)
                .Where(source => !string.IsNullOrWhiteSpace(source))
                .ToArray();
            var plannedRowCount = GetPlannedRuleRowCount(rule);
            var generatedSourceCount = sources.Length;

            for (var sourceIndex = 0; sourceIndex < sources.Length; sourceIndex++)
            {
                var source = sources[sourceIndex];

                cancellationToken.ThrowIfCancellationRequested();
                var stopwatch = Stopwatch.StartNew();
                var ruleCandidates = candidates
                    .Where(item => IsAllowedForRule(item, rule, tmdbFacts))
                    .ToArray();
                var matchingItems = ruleCandidates
                    .Where(item => MatchesRuleSource(item, rule, source, tmdbFacts, peopleByItemId))
                    .ToArray();
                var selectionItems = matchingItems;
                var fallbackUsed = false;

                if (ShouldFallbackToBaseGenre(rule, source, matchingItems))
                {
                    selectionItems = ruleCandidates
                        .Where(item => MatchesRuleSource(item, rule, rule.SourceValue, tmdbFacts, peopleByItemId))
                        .ToArray();
                    fallbackUsed = selectionItems.Length > 0;
                }

                var selectedItems = SelectRuleItems(selectionItems, rule, rowLimit, source, out var duplicateCount);
                var metadataSourceFieldsUsed = GetMetadataSourceFieldsUsed(rule);
                var emptyResultReason = selectedItems.Count == 0
                    ? GetEmptyResultReason(rule, source, ruleCandidates, selectionItems, tmdbFacts, peopleByItemId)
                    : null;
                var dropReason = selectedItems.Count == 0 ? emptyResultReason : null;
                var queryUsed = GetRuleQueryDebug(rule, source, fallbackUsed);
                var first10MatchedItems = (matchingItems.Length > 0 ? matchingItems : selectionItems)
                    .Take(10)
                    .Select(item => item.Name)
                    .Where(name => !string.IsNullOrWhiteSpace(name))
                    .ToArray();
                var rowTitle = GetRuleRowTitle(rule, source, fallbackUsed, sourceIndex);
                stopwatch.Stop();

                if (string.Equals(rule.SourceType, "studio", StringComparison.OrdinalIgnoreCase))
                {
                    _logger.LogInformation(
                        "PiggieTV studio row generated. RowId={RowId}; RowTitle={RowTitle}; RuleType={RuleType}; StudioFilter={StudioFilter}; QueryUsed={QueryUsed}; CandidateCount={CandidateCount}; MatchedCount={MatchedCount}; FallbackUsed={FallbackUsed}; First10ItemNames={First10ItemNames}.",
                        rule.Id,
                        rowTitle,
                        rule.SourceType,
                        source,
                        queryUsed,
                        ruleCandidates.Length,
                        selectionItems.Length,
                        fallbackUsed,
                        string.Join(" | ", matchingItems.Take(10).Select(item => item.Name)));
                }

                if (!includeEmptyRows && selectedItems.Count == 0)
                {
                    continue;
                }

                rows.Add(new GeneratedRow(
                    MakeRowId(rule, source, sourceIndex),
                    rowTitle,
                    rule,
                    source,
                    "featured",
                    GetProviderUsed(rule, tmdbFacts),
                    GetProviderError(rule),
                    selectedItems,
                    ruleCandidates.Length,
                    selectionItems.Length,
                    fallbackUsed,
                    queryUsed,
                    metadataSourceFieldsUsed,
                    first10MatchedItems,
                    duplicateCount,
                    stopwatch.ElapsedMilliseconds,
                    emptyResultReason,
                    plannedRowCount,
                    generatedSourceCount,
                    sourceIndex,
                    dropReason));
            }
        }

        LogGeneratedRows("expandedRowsBeforeDedupe", rows);
        var dedupedRows = DeduplicateRowsById(rows);
        LogGeneratedRows("dedupedRows", dedupedRows);

        return dedupedRows;
    }

    private static bool IsVirtualRowRule(RowBuilderRule rule)
    {
        return string.Equals(rule.SourceType, "continueWatching", StringComparison.OrdinalIgnoreCase)
            || string.Equals(rule.SourceType, "becauseYouWatched", StringComparison.OrdinalIgnoreCase)
            || string.Equals(rule.SourceType, "requested", StringComparison.OrdinalIgnoreCase);
    }

    private static GeneratedRow CreateVirtualRuleRow(RowBuilderRule rule)
    {
        var sectionType = rule.SourceType.ToLowerInvariant() switch
        {
            "requested" => "seerr-requests",
            "becauseyouwatched" => "because-you-watched",
            _ => "continue"
        };

        return new GeneratedRow(
            MakeRowId(rule, rule.SourceValue, 0),
            rule.Name,
            rule,
            rule.SourceValue,
            sectionType,
            "jellyfin",
            null,
            [],
            0,
            0,
            false,
            $"virtual:{rule.SourceType}",
            GetMetadataSourceFieldsUsed(rule),
            [],
            0,
            0,
            rule.SourceType.ToLowerInvariant() switch
            {
                "requested" => "No requests found or Jellyseerr is not configured.",
                "becauseyouwatched" => "No watched content found for this user yet.",
                _ => null
            },
            1,
            1,
            0,
            null);
    }

    private static RowBuilderSettings CloneRowBuilderSettings(RowBuilderSettings settings)
    {
        return new RowBuilderSettings
        {
            SchemaVersion = settings.SchemaVersion,
            Enabled = settings.Enabled,
            DefaultsInitialized = settings.DefaultsInitialized,
            ShowConfiguredRowsOnHome = settings.ShowConfiguredRowsOnHome,
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

    private void LogGeneratedRows(string stage, IReadOnlyList<GeneratedRow> rows)
    {
        _logger.LogInformation(
            "PiggieTV Row Rules {Stage}: {Rows}",
            stage,
            JsonSerializer.Serialize(rows.Select(row => new
            {
                row.Id,
                row.Title,
                RuleId = row.Rule.Id,
                row.Rule.SourceType,
                row.Rule.SourceValue,
                row.Source,
                row.QueryUsed,
                ItemCount = row.Items.Count,
                row.CandidateCount,
                row.MatchedCount,
                row.FallbackUsed,
                row.PlannedRowCount,
                row.GeneratedSourceCount,
                row.SourceIndex,
                row.DropReason,
                row.EmptyResultReason
            }), JsonOptions));
    }

    private static List<GeneratedRow> DeduplicateRowsById(IEnumerable<GeneratedRow> rows)
    {
        var seenRowIds = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var dedupedRows = new List<GeneratedRow>();

        foreach (var row in rows)
        {
            if (!seenRowIds.TryGetValue(row.Id, out var duplicateCount))
            {
                seenRowIds[row.Id] = 0;
                dedupedRows.Add(row);
                continue;
            }

            duplicateCount += 1;
            seenRowIds[row.Id] = duplicateCount;
            var uniqueId = $"{row.Id}-{duplicateCount}";

            while (seenRowIds.ContainsKey(uniqueId))
            {
                duplicateCount += 1;
                seenRowIds[row.Id] = duplicateCount;
                uniqueId = $"{row.Id}-{duplicateCount}";
            }

            seenRowIds[uniqueId] = 0;
            dedupedRows.Add(row with
            {
                Id = uniqueId
            });
        }

        return dedupedRows;
    }

    private static IReadOnlyList<string> GetRuleSources(
        RowBuilderRule rule,
        IReadOnlyList<BaseItem> candidates,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts> tmdbFacts,
        IReadOnlyDictionary<Guid, IReadOnlyList<string>> peopleByItemId)
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
            && string.Equals(rule.GenerationMode, "random", StringComparison.OrdinalIgnoreCase))
        {
            return GetGeneratedGenreSources(rule, candidates, tmdbFacts, peopleByItemId);
        }

        if (!string.IsNullOrWhiteSpace(rule.SourceValue))
        {
            return [rule.SourceValue];
        }

        var sources = candidates
            .Where(item => IsAllowedForRule(item, rule, tmdbFacts))
            .SelectMany(item => GetSourceValues(item, rule.SourceType, tmdbFacts, peopleByItemId))
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

    private static IReadOnlyList<string> GetGeneratedGenreSources(
        RowBuilderRule rule,
        IReadOnlyList<BaseItem> candidates,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts> tmdbFacts,
        IReadOnlyDictionary<Guid, IReadOnlyList<string>> peopleByItemId)
    {
        var baseSource = rule.SourceValue;

        if (string.IsNullOrWhiteSpace(baseSource))
        {
            return [rule.Name];
        }

        var baseRows = Math.Max(1, rule.RowCount);
        var sources = new List<string> { baseSource };
        var subgenreRowLimit = rule.IncludeSubgenres
            ? Math.Min(Math.Max(0, rule.SubgenreRowCount), Math.Max(0, baseRows - 1))
            : 0;

        if (subgenreRowLimit > 0)
        {
            sources.AddRange(GetGeneratedSubgenreSources(
                rule,
                baseSource,
                candidates,
                tmdbFacts,
                peopleByItemId,
                subgenreRowLimit));
        }

        while (sources.Count < baseRows)
        {
            sources.Add(CreateGenreVariationSource(baseSource, sources.Count + 1));
        }

        return sources.Take(baseRows).ToArray();
    }

    private static IReadOnlyList<string> GetGeneratedSubgenreSources(
        RowBuilderRule rule,
        string baseSource,
        IReadOnlyList<BaseItem> candidates,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts> tmdbFacts,
        IReadOnlyDictionary<Guid, IReadOnlyList<string>> peopleByItemId,
        int limit)
    {
        if (limit <= 0)
        {
            return [];
        }

        var normalizedBase = NormalizeSearchText(baseSource);
        var allowedCandidates = candidates
            .Where(item => IsAllowedForRule(item, rule, tmdbFacts))
            .Where(item => MatchesRuleSource(item, rule, baseSource, tmdbFacts, peopleByItemId))
            .ToArray();
        var observedSubgenres = allowedCandidates
            .SelectMany(item => item.Genres ?? Array.Empty<string>())
            .Where(genre => !string.IsNullOrWhiteSpace(genre))
            .Where(genre => !string.Equals(NormalizeSearchText(genre), normalizedBase, StringComparison.Ordinal))
            .GroupBy(NormalizeSearchText)
            .Where(group => !string.IsNullOrWhiteSpace(group.Key))
            .Select(group => new
            {
                Name = group.First(),
                Count = group.Count(),
                CuratedRank = GetSubgenreRank(baseSource, group.First())
            })
            .OrderBy(source => source.CuratedRank < 0 ? int.MaxValue : source.CuratedRank)
            .ThenByDescending(source => source.Count)
            .ThenBy(source => source.Name, StringComparer.OrdinalIgnoreCase)
            .Select(source => source.Name);
        var curatedSubgenres = GetSubgenres(baseSource)
            .Where(subgenre => !string.IsNullOrWhiteSpace(subgenre))
            .Where(subgenre => !string.Equals(NormalizeSearchText(subgenre), normalizedBase, StringComparison.Ordinal))
            .Where(subgenre => allowedCandidates.Any(item => MatchesRuleSource(item, rule, subgenre, tmdbFacts, peopleByItemId)));
        var sources = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var source in observedSubgenres.Concat(curatedSubgenres))
        {
            var key = NormalizeSearchText(source);

            if (string.IsNullOrWhiteSpace(key) || !seen.Add(key))
            {
                continue;
            }

            sources.Add(source);

            if (sources.Count >= limit)
            {
                break;
            }
        }

        return sources;
    }

    private static int GetSubgenreRank(string baseSource, string candidate)
    {
        var normalizedCandidate = NormalizeSearchText(candidate);
        var curated = GetSubgenres(baseSource);

        for (var index = 0; index < curated.Count; index++)
        {
            var normalizedCurated = NormalizeSearchText(curated[index]);

            if (string.Equals(normalizedCandidate, normalizedCurated, StringComparison.Ordinal)
                || normalizedCandidate.Contains(normalizedCurated, StringComparison.Ordinal)
                || normalizedCurated.Contains(normalizedCandidate, StringComparison.Ordinal))
            {
                return index;
            }
        }

        return -1;
    }

    private static int GetPlannedRuleRowCount(RowBuilderRule rule)
    {
        if (!rule.Enabled)
        {
            return 0;
        }

        if (IsVirtualRowRule(rule))
        {
            return 1;
        }

        if (string.Equals(rule.SourceType, "genre", StringComparison.OrdinalIgnoreCase)
            && string.Equals(rule.GenerationMode, "random", StringComparison.OrdinalIgnoreCase))
        {
            return Math.Max(1, rule.RowCount);
        }

        if (!string.IsNullOrWhiteSpace(rule.SourceValue))
        {
            return 1;
        }

        return Math.Max(1, rule.RowCount);
    }

    private static string CreateGenreVariationSource(string baseSource, int rowNumber)
    {
        return $"{baseSource}{RowVariantDelimiter}mix-{rowNumber}";
    }

    private static bool ShouldFallbackToBaseGenre(RowBuilderRule rule, string source, IReadOnlyList<BaseItem> matchingItems)
    {
        return matchingItems.Count == 0
            && string.Equals(rule.SourceType, "genre", StringComparison.OrdinalIgnoreCase)
            && string.Equals(rule.GenerationMode, "random", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(rule.SourceValue)
            && !string.Equals(GetRuleMatchSource(source), rule.SourceValue, StringComparison.OrdinalIgnoreCase);
    }

    private static string GetRuleMatchSource(string source)
    {
        var delimiterIndex = source.IndexOf(RowVariantDelimiter, StringComparison.Ordinal);

        return delimiterIndex > 0 ? source[..delimiterIndex] : source;
    }

    private static bool IsRuleVariantSource(string source)
    {
        return source.IndexOf(RowVariantDelimiter, StringComparison.Ordinal) > 0;
    }

    private static string GetRuleSourceDisplayLabel(string source)
    {
        var delimiterIndex = source.IndexOf(RowVariantDelimiter, StringComparison.Ordinal);

        if (delimiterIndex <= 0)
        {
            return GetRowTitle(source);
        }

        var variation = source[(delimiterIndex + RowVariantDelimiter.Length)..];

        if (variation.StartsWith("mix-", StringComparison.OrdinalIgnoreCase)
            && int.TryParse(variation[4..], NumberStyles.Integer, CultureInfo.InvariantCulture, out var mixNumber))
        {
            return $"Mix {mixNumber}";
        }

        return GetRowTitle(variation.Replace('-', ' '));
    }

    private static IEnumerable<string> GetSourceValues(
        BaseItem item,
        string sourceType,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts>? tmdbFacts = null,
        IReadOnlyDictionary<Guid, IReadOnlyList<string>>? peopleByItemId = null)
    {
        if (string.Equals(sourceType, "studio", StringComparison.OrdinalIgnoreCase))
        {
            return item.Studios ?? Array.Empty<string>();
        }

        if (string.Equals(sourceType, "genre", StringComparison.OrdinalIgnoreCase))
        {
            return item.Genres ?? Array.Empty<string>();
        }

        if (string.Equals(sourceType, "tag", StringComparison.OrdinalIgnoreCase)
            || string.Equals(sourceType, "tags", StringComparison.OrdinalIgnoreCase))
        {
            return item.Tags ?? Array.Empty<string>();
        }

        if (string.Equals(sourceType, "providerId", StringComparison.OrdinalIgnoreCase)
            || string.Equals(sourceType, "providerIds", StringComparison.OrdinalIgnoreCase))
        {
            return GetProviderIdSourceValues(item);
        }

        if (string.Equals(sourceType, "person", StringComparison.OrdinalIgnoreCase)
            || string.Equals(sourceType, "people", StringComparison.OrdinalIgnoreCase))
        {
            return GetPeopleSourceValues(item, peopleByItemId);
        }

        if (string.Equals(sourceType, "productionYear", StringComparison.OrdinalIgnoreCase))
        {
            return item.ProductionYear is null ? [] : [item.ProductionYear.Value.ToString(CultureInfo.InvariantCulture)];
        }

        if (string.Equals(sourceType, "officialRating", StringComparison.OrdinalIgnoreCase))
        {
            return string.IsNullOrWhiteSpace(item.OfficialRating) ? [] : [item.OfficialRating];
        }

        if (string.Equals(sourceType, "communityRating", StringComparison.OrdinalIgnoreCase))
        {
            return item.CommunityRating is null ? [] : [item.CommunityRating.Value.ToString("0.0", CultureInfo.InvariantCulture)];
        }

        if (string.Equals(sourceType, "premiereDate", StringComparison.OrdinalIgnoreCase))
        {
            return GetDateSourceValues(item.PremiereDate);
        }

        if (string.Equals(sourceType, "image", StringComparison.OrdinalIgnoreCase)
            || string.Equals(sourceType, "images", StringComparison.OrdinalIgnoreCase))
        {
            return GetImageSourceValues(item);
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

    private static IEnumerable<string> GetProviderIdSourceValues(BaseItem item)
    {
        if (item.ProviderIds is null || item.ProviderIds.Count == 0)
        {
            return [];
        }

        var values = new List<string>();

        foreach (var providerId in item.ProviderIds)
        {
            var normalizedProvider = NormalizeProviderIdKey(providerId.Key);

            if (normalizedProvider is null || string.IsNullOrWhiteSpace(providerId.Value))
            {
                continue;
            }

            values.Add($"{normalizedProvider}:{providerId.Value}");
            values.Add(providerId.Value);
            values.Add(normalizedProvider);
        }

        return values;
    }

    private static string? NormalizeProviderIdKey(string provider)
    {
        return provider.ToLowerInvariant() switch
        {
            "tmdb" or "themoviedb" or "moviedb" => "Tmdb",
            "imdb" => "Imdb",
            "tvdb" or "thetvdb" => "Tvdb",
            _ => null
        };
    }

    private static IEnumerable<string> GetPeopleSourceValues(
        BaseItem item,
        IReadOnlyDictionary<Guid, IReadOnlyList<string>>? peopleByItemId)
    {
        return peopleByItemId is not null && peopleByItemId.TryGetValue(item.Id, out var people)
            ? people
            : [];
    }

    private static IEnumerable<string> GetDateSourceValues(DateTime? value)
    {
        if (value is null)
        {
            return [];
        }

        return [
            value.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            value.Value.ToString("yyyy-MM", CultureInfo.InvariantCulture),
            value.Value.Year.ToString(CultureInfo.InvariantCulture)
        ];
    }

    private static IEnumerable<string> GetImageSourceValues(BaseItem item)
    {
        var values = new List<string>();

        if (GetImageTag(item, ImageType.Primary) is not null)
        {
            values.AddRange(["any", "images", "primary", "imageTags.primary"]);
        }

        if (GetImageTag(item, ImageType.Thumb) is not null)
        {
            values.AddRange(["any", "images", "thumb", "imageTags.thumb"]);
        }

        if (GetImageTag(item, ImageType.Logo) is not null)
        {
            values.AddRange(["any", "images", "logo", "imageTags.logo"]);
        }

        if (GetImageTag(item, ImageType.Backdrop) is not null)
        {
            values.AddRange(["any", "images", "backdrop", "backdropImageTags"]);
        }

        return values;
    }

    private static bool NeedsPeopleMetadata(RowBuilderSettings settings)
    {
        return settings.Rules.Any(rule => rule.Enabled
            && (string.Equals(rule.SourceType, "person", StringComparison.OrdinalIgnoreCase)
                || string.Equals(rule.SourceType, "people", StringComparison.OrdinalIgnoreCase)))
            || settings.Categories.Any(category => category.Enabled
                && (string.Equals(category.SourceType, "person", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(category.SourceType, "people", StringComparison.OrdinalIgnoreCase)));
    }

    private IReadOnlyDictionary<Guid, IReadOnlyList<string>> BuildPeopleMetadataIndex(IReadOnlyList<BaseItem> candidates)
    {
        var peopleByItemId = new Dictionary<Guid, IReadOnlyList<string>>();

        foreach (var item in candidates)
        {
            try
            {
                var values = _libraryManager.GetPeople(item)
                    .SelectMany(person => new[]
                    {
                        person.Name,
                        person.Role,
                        string.IsNullOrWhiteSpace(person.Type.ToString()) || string.IsNullOrWhiteSpace(person.Name)
                            ? string.Empty
                            : $"{person.Type}:{person.Name}"
                    })
                    .Where(value => !string.IsNullOrWhiteSpace(value))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray();

                if (values.Length > 0)
                {
                    peopleByItemId[item.Id] = values;
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "PiggieTV could not read people metadata for item {ItemId}.", item.Id);
            }
        }

        return peopleByItemId;
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
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts> tmdbFacts,
        IReadOnlyDictionary<Guid, IReadOnlyList<string>> peopleByItemId)
    {
        var matchSource = GetRuleMatchSource(source);

        if (string.Equals(rule.SourceType, "latest", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (string.Equals(rule.SourceType, "seasonal", StringComparison.OrdinalIgnoreCase))
        {
            return MatchesAny(item, GetSeasonalTerms(matchSource), tmdbFacts);
        }

        if (string.Equals(rule.SourceType, "studio", StringComparison.OrdinalIgnoreCase))
        {
            return MatchesMetadataSource(item, "studio", matchSource, tmdbFacts, peopleByItemId);
        }

        if (string.Equals(rule.SourceType, "genre", StringComparison.OrdinalIgnoreCase))
        {
            return MatchesMetadataSource(item, "genre", matchSource, tmdbFacts, peopleByItemId);
        }

        if (string.Equals(rule.SourceType, "library", StringComparison.OrdinalIgnoreCase))
        {
            return MatchesSourceValue(GetItemType(item), matchSource)
                || (!string.IsNullOrWhiteSpace(item.Path) && item.Path.Contains(matchSource, StringComparison.OrdinalIgnoreCase));
        }

        if (IsStructuredMetadataSource(rule.SourceType))
        {
            return MatchesMetadataSource(item, rule.SourceType, matchSource, tmdbFacts, peopleByItemId);
        }

        if (string.Equals(rule.SourceType, "collection", StringComparison.OrdinalIgnoreCase))
        {
            return MatchesAny(item, [matchSource], tmdbFacts);
        }

        return MatchesAny(item, [matchSource], tmdbFacts);
    }

    private static bool MatchesCategorySource(
        BaseItem item,
        RowBuilderCategory category,
        string source,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts> tmdbFacts)
    {
        if (string.Equals(category.SourceType, "studio", StringComparison.OrdinalIgnoreCase))
        {
            return MatchesMetadataSource(item, "studio", source, tmdbFacts, null);
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

        if (string.IsNullOrWhiteSpace(normalizedValue) || string.IsNullOrWhiteSpace(normalizedSource))
        {
            return false;
        }

        return normalizedValue.Contains(normalizedSource, StringComparison.Ordinal)
            || normalizedSource.Contains(normalizedValue, StringComparison.Ordinal);
    }

    private static bool IsStructuredMetadataSource(string sourceType)
    {
        return sourceType.Equals("studio", StringComparison.OrdinalIgnoreCase)
            || sourceType.Equals("genre", StringComparison.OrdinalIgnoreCase)
            || sourceType.Equals("tag", StringComparison.OrdinalIgnoreCase)
            || sourceType.Equals("tags", StringComparison.OrdinalIgnoreCase)
            || sourceType.Equals("providerId", StringComparison.OrdinalIgnoreCase)
            || sourceType.Equals("providerIds", StringComparison.OrdinalIgnoreCase)
            || sourceType.Equals("person", StringComparison.OrdinalIgnoreCase)
            || sourceType.Equals("people", StringComparison.OrdinalIgnoreCase)
            || sourceType.Equals("productionYear", StringComparison.OrdinalIgnoreCase)
            || sourceType.Equals("officialRating", StringComparison.OrdinalIgnoreCase)
            || sourceType.Equals("communityRating", StringComparison.OrdinalIgnoreCase)
            || sourceType.Equals("premiereDate", StringComparison.OrdinalIgnoreCase)
            || sourceType.Equals("image", StringComparison.OrdinalIgnoreCase)
            || sourceType.Equals("images", StringComparison.OrdinalIgnoreCase);
    }

    private static bool MatchesMetadataSource(
        BaseItem item,
        string sourceType,
        string source,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts>? tmdbFacts,
        IReadOnlyDictionary<Guid, IReadOnlyList<string>>? peopleByItemId)
    {
        if (string.Equals(sourceType, "communityRating", StringComparison.OrdinalIgnoreCase)
            && MatchesNumericSource(item.CommunityRating, source))
        {
            return true;
        }

        if (string.Equals(sourceType, "productionYear", StringComparison.OrdinalIgnoreCase)
            && item.ProductionYear is not null
            && MatchesIntegerSource(item.ProductionYear.Value, source))
        {
            return true;
        }

        return GetSourceValues(item, sourceType, tmdbFacts, peopleByItemId)
            .Any(value => MatchesSourceValue(value, source));
    }

    private static bool HasExactMetadataSourceValue(
        BaseItem item,
        string sourceType,
        string source,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts>? tmdbFacts,
        IReadOnlyDictionary<Guid, IReadOnlyList<string>>? peopleByItemId)
    {
        var normalizedSource = NormalizeSearchText(source);

        return !string.IsNullOrWhiteSpace(normalizedSource)
            && GetSourceValues(item, sourceType, tmdbFacts, peopleByItemId)
                .Any(value => string.Equals(NormalizeSearchText(value), normalizedSource, StringComparison.Ordinal));
    }

    private static bool MatchesNumericSource(float? value, string source)
    {
        if (value is null)
        {
            return false;
        }

        var trimmed = source.Trim();

        if (trimmed.StartsWith(">=", StringComparison.Ordinal)
            && float.TryParse(trimmed[2..].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var minimum))
        {
            return value.Value >= minimum;
        }

        if (trimmed.StartsWith("<=", StringComparison.Ordinal)
            && float.TryParse(trimmed[2..].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var maximum))
        {
            return value.Value <= maximum;
        }

        if (trimmed.StartsWith(">", StringComparison.Ordinal)
            && float.TryParse(trimmed[1..].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var greaterThan))
        {
            return value.Value > greaterThan;
        }

        if (trimmed.StartsWith("<", StringComparison.Ordinal)
            && float.TryParse(trimmed[1..].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var lessThan))
        {
            return value.Value < lessThan;
        }

        return float.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var exact)
            && Math.Abs(value.Value - exact) < 0.05;
    }

    private static bool MatchesIntegerSource(int value, string source)
    {
        var trimmed = source.Trim();
        var rangeParts = trimmed.Split('-', 2, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

        if (rangeParts.Length == 2
            && int.TryParse(rangeParts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var minimum)
            && int.TryParse(rangeParts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var maximum))
        {
            return value >= Math.Min(minimum, maximum) && value <= Math.Max(minimum, maximum);
        }

        return int.TryParse(trimmed, NumberStyles.Integer, CultureInfo.InvariantCulture, out var exact)
            && value == exact;
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
        string source,
        out int duplicateCount)
    {
        var limit = Math.Clamp(rule.ItemLimit > 0 ? rule.ItemLimit : rowLimit, 1, Math.Max(1, rowLimit));
        var orderedItems = rule.GenerationMode switch
        {
            "latest" => items.OrderByDescending(GetSortDate),
            "highestRated" => items.OrderByDescending(GetRatingScore).ThenByDescending(GetSortDate),
            "popular" => items.OrderByDescending(GetTrendScore).ThenByDescending(GetSortDate),
            _ => items.OrderBy(item => GetStableRandomSortKey(item, $"{rule.Id}:{rule.SourceType}:{source}"))
                .ThenByDescending(GetTrendScore)
        };

        return SelectDistinctItems(orderedItems, limit, out duplicateCount);
    }

    private static uint GetStableRandomSortKey(BaseItem item, string seed)
    {
        var text = $"{seed}:{item.Id:N}:{item.Name}:{item.ProductionYear ?? item.PremiereDate?.Year ?? 0}";

        unchecked
        {
            uint hash = 2166136261;

            foreach (var character in text)
            {
                hash ^= character;
                hash *= 16777619;
            }

            return hash;
        }
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

    private static string MakeRowId(RowBuilderRule rule, string source, int sourceIndex)
    {
        if (string.Equals(rule.SourceType, "genre", StringComparison.OrdinalIgnoreCase)
            && string.Equals(rule.GenerationMode, "random", StringComparison.OrdinalIgnoreCase))
        {
            var genreId = Slugify(GetRuleMatchSource(rule.SourceValue));

            if (string.IsNullOrWhiteSpace(genreId))
            {
                genreId = Slugify(rule.Name);
            }

            if (string.IsNullOrWhiteSpace(genreId))
            {
                genreId = Slugify(rule.Id);
            }

            return $"{genreId}-{sourceIndex}";
        }

        return Slugify(string.Equals(rule.SourceValue, source, StringComparison.OrdinalIgnoreCase)
            ? rule.Id
            : $"{rule.Id}-{source}");
    }

    private static string ComputeRowConfigHash(RowBuilderSettings settings)
    {
        var node = JsonSerializer.SerializeToNode(settings, JsonOptions);
        return ComputeStableHash(node);
    }

    private static string ComputeRecommendationConfigHash(RecommendationRowSettings settings)
    {
        var hashableSettings = new RecommendationRowSettings
        {
            Enabled = settings.Enabled,
            GeneratedAt = settings.GeneratedAt,
            RowDiagnostics = settings.RowDiagnostics,
            RowConfigHash = settings.RowConfigHash,
            SchemaVersion = settings.SchemaVersion,
            SourceCounts = settings.SourceCounts,
            SourceTimingsJson = settings.SourceTimingsJson,
            Rows = settings.Rows.Select(row => new RecommendationRowDefinition
            {
                Accepted = row.Accepted,
                Diagnostics = row.Diagnostics,
                Draft = row.Draft,
                Enabled = row.Enabled,
                Explanation = row.Explanation,
                GeneratedAt = row.GeneratedAt,
                Id = row.Id,
                Items = row.Items,
                MediaType = row.MediaType,
                RowConfigHash = row.RowConfigHash,
                SourceCounts = row.SourceCounts,
                SourceTimingsJson = row.SourceTimingsJson,
                Title = row.Title
            }).ToList()
        };
        var node = JsonSerializer.SerializeToNode(hashableSettings, JsonOptions);
        return ComputeStableHash(node);
    }

    private static string ComputeStableHash(JsonNode? node)
    {
        var stableJson = ToStableJson(node);
        long hash = 5381;

        foreach (var character in stableJson)
        {
            hash = ((hash * 33) + character) % int.MaxValue;
        }

        return hash.ToString(CultureInfo.InvariantCulture);
    }

    private static string ToStableJson(JsonNode? node)
    {
        if (node is null)
        {
            return "null";
        }

        if (node is JsonArray array)
        {
            return $"[{string.Join(",", array.Select(ToStableJson))}]";
        }

        if (node is JsonObject jsonObject)
        {
            return $"{{{string.Join(",", jsonObject
                .OrderBy(entry => entry.Key, StringComparer.Ordinal)
                .Select(entry => $"{JsonSerializer.Serialize(entry.Key, JsonOptions)}:{ToStableJson(entry.Value)}"))}}}";
        }

        return node.ToJsonString(JsonOptions);
    }

    private static string GetRuleRowTitle(
        RowBuilderRule rule,
        string source,
        bool fallbackUsed = false,
        int sourceIndex = 0)
    {
        if (string.Equals(rule.SourceType, "genre", StringComparison.OrdinalIgnoreCase)
            && string.Equals(rule.GenerationMode, "random", StringComparison.OrdinalIgnoreCase))
        {
            if (string.Equals(rule.SourceValue, GetRuleMatchSource(source), StringComparison.OrdinalIgnoreCase)
                && !IsRuleVariantSource(source))
            {
                return rule.Name;
            }

            var label = GetRuleSourceDisplayLabel(source);

            if (fallbackUsed)
            {
                return IsRuleVariantSource(source)
                    ? $"{rule.Name} {label}"
                    : label;
            }

            return IsRuleVariantSource(source)
                ? $"{rule.Name} {label}"
                : label;
        }

        if (!string.Equals(rule.SourceType, "genre", StringComparison.OrdinalIgnoreCase)
            || string.Equals(rule.SourceValue, GetRuleMatchSource(source), StringComparison.OrdinalIgnoreCase)
            && !IsRuleVariantSource(source))
        {
            return rule.Name;
        }

        return IsRuleVariantSource(source)
            ? $"{rule.Name} {GetRuleSourceDisplayLabel(source)}"
            : $"{rule.Name}: {GetRuleSourceDisplayLabel(source)}";
    }

    private static string GetRuleQueryDebug(RowBuilderRule rule, string source, bool fallbackUsed = false)
    {
        var fields = string.Join(",", GetMetadataSourceFieldsUsed(rule));
        var matchSource = GetRuleMatchSource(source);
        var variation = IsRuleVariantSource(source)
            ? $"; variation=\"{GetRuleSourceDisplayLabel(source)}\""
            : string.Empty;
        var fallback = fallbackUsed && !string.IsNullOrWhiteSpace(rule.SourceValue)
            ? $"; fallbackGenreFilter=\"{rule.SourceValue}\""
            : string.Empty;

        if (string.Equals(rule.SourceType, "studio", StringComparison.OrdinalIgnoreCase))
        {
            return $"mediaType={rule.MediaType}; sourceType=studio; studioFilter=\"{matchSource}\"; matchFields={fields}; mode={rule.GenerationMode}{variation}{fallback}";
        }

        if (string.Equals(rule.SourceType, "genre", StringComparison.OrdinalIgnoreCase))
        {
            return $"mediaType={rule.MediaType}; sourceType=genre; genreFilter=\"{matchSource}\"; matchFields={fields}; mode={rule.GenerationMode}{variation}{fallback}";
        }

        if (IsStructuredMetadataSource(rule.SourceType))
        {
            return $"mediaType={rule.MediaType}; sourceType={rule.SourceType}; source=\"{matchSource}\"; matchFields={fields}; mode={rule.GenerationMode}{variation}{fallback}";
        }

        return $"mediaType={rule.MediaType}; sourceType={rule.SourceType}; source=\"{matchSource}\"; mode={rule.GenerationMode}{variation}{fallback}";
    }

    private static IReadOnlyList<string> GetMetadataSourceFieldsUsed(RowBuilderRule rule)
    {
        return rule.SourceType.ToLowerInvariant() switch
        {
            "studio" => ["Studios"],
            "genre" => ["Genres"],
            "tag" or "tags" => ["Tags"],
            "providerid" or "providerids" => ["ProviderIds.Tmdb", "ProviderIds.Imdb", "ProviderIds.Tvdb"],
            "person" or "people" => ["People.Name", "People.Role", "People.Type"],
            "productionyear" => ["ProductionYear"],
            "officialrating" => ["OfficialRating"],
            "communityrating" => ["CommunityRating"],
            "premieredate" => ["PremiereDate"],
            "image" or "images" => ["ImageTags", "BackdropImageTags"],
            "collection" => ["Tags", "Genres"],
            "library" => ["Path", "Type"],
            "latest" => ["DateCreated", "PremiereDate"],
            "seasonal" => ["Name", "Overview", "Genres", "Tags", "Studios"],
            _ => ["Genres", "Tags", "Name", "Overview"]
        };
    }

    private static string? GetEmptyResultReason(
        RowBuilderRule rule,
        string source,
        IReadOnlyList<BaseItem> candidates,
        IReadOnlyList<BaseItem> matchingItems,
        IReadOnlyDictionary<Guid, PtvTmdbItemFacts> tmdbFacts,
        IReadOnlyDictionary<Guid, IReadOnlyList<string>> peopleByItemId)
    {
        var matchSource = GetRuleMatchSource(source);

        if (matchingItems.Count > 0)
        {
            return "No matching Jellyfin items remained after duplicate filtering.";
        }

        if (!IsStructuredMetadataSource(rule.SourceType))
        {
            return $"No items matched '{matchSource}'.";
        }

        var hasMetadata = candidates.Any(item => GetSourceValues(item, rule.SourceType, tmdbFacts, peopleByItemId).Any());
        var label = GetMetadataSourceLabel(rule.SourceType);

        if (!hasMetadata)
        {
            return string.Equals(rule.SourceType, "studio", StringComparison.OrdinalIgnoreCase)
                ? "No studio metadata found."
                : $"No {label} metadata found.";
        }

        return string.Equals(rule.SourceType, "studio", StringComparison.OrdinalIgnoreCase)
            ? $"No items matched studio '{matchSource}'."
            : $"No items matched {label} '{matchSource}'.";
    }

    private static string GetMetadataSourceLabel(string sourceType)
    {
        return sourceType.ToLowerInvariant() switch
        {
            "studio" => "studio",
            "genre" => "genre",
            "tag" or "tags" => "tag",
            "providerid" or "providerids" => "provider id",
            "person" or "people" => "person",
            "productionyear" => "production year",
            "officialrating" => "official rating",
            "communityrating" => "community rating",
            "premieredate" => "premiere date",
            "image" or "images" => "image",
            _ => sourceType
        };
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
        if (IsStructuredMetadataSource(rule.SourceType))
        {
            return "jellyfin";
        }

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
        if (IsStructuredMetadataSource(rule.SourceType))
        {
            return null;
        }

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

    private static int AppendRecommendationRows(
        JsonObject sectionItems,
        JsonArray sectionDefinitions,
        JsonArray rowDiagnostics,
        RecommendationRowSettings recommendationSettings,
        bool recommendationFeatureEnabled,
        string recommendationConfigHash)
    {
        if (!recommendationFeatureEnabled || !recommendationSettings.Enabled)
        {
            var reason = recommendationFeatureEnabled ? "recommendation-settings-disabled" : "recommendation-feature-disabled";

            foreach (var row in recommendationSettings.Rows)
            {
                AddRecommendationDiagnostic(rowDiagnostics, row, $"recommendation-{Slugify(row.Id)}", recommendationConfigHash, 0, reason);
            }

            return 0;
        }

        var appended = 0;
        var seenRecommendationSectionIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var row in recommendationSettings.Rows)
        {
            var sectionId = $"recommendation-{Slugify(row.Id)}";

            if (!seenRecommendationSectionIds.Add(sectionId))
            {
                AddRecommendationDiagnostic(rowDiagnostics, row, sectionId, recommendationConfigHash, 0, "duplicate-recommendation-section-id");
                continue;
            }

            if (!row.Accepted || row.Draft)
            {
                AddRecommendationDiagnostic(rowDiagnostics, row, sectionId, recommendationConfigHash, 0, "recommendation-row-draft");
                continue;
            }

            if (!row.Enabled)
            {
                AddRecommendationDiagnostic(rowDiagnostics, row, sectionId, recommendationConfigHash, 0, "recommendation-row-disabled");
                continue;
            }

            var dedupedItems = DeduplicateRecommendationItems(row.Items).ToArray();
            var items = ToRecommendationItemsJson(dedupedItems);
            var cacheDedupeRemovals = Math.Max(0, row.Items.Count - dedupedItems.Length);
            var finalDedupeRemovals = Math.Max(0, row.Diagnostics.DedupeRemovals + cacheDedupeRemovals);

            if (items.Count < MinRecommendationRowItems)
            {
                AddRecommendationDiagnostic(rowDiagnostics, row, sectionId, recommendationConfigHash, items.Count, "below-minimum-items-after-dedupe");
                continue;
            }

            if (sectionItems.ContainsKey(sectionId))
            {
                AddRecommendationDiagnostic(rowDiagnostics, row, sectionId, recommendationConfigHash, items.Count, "duplicate-cache-section-id");
                continue;
            }

            sectionItems[sectionId] = items;
            sectionDefinitions.Add(new JsonObject
            {
                ["id"] = sectionId,
                ["title"] = row.Title,
                ["rowType"] = "generated-recommendation",
                ["type"] = "recommendation",
                ["ruleName"] = row.Title,
                ["mediaType"] = row.MediaType,
                ["sourceType"] = "recommendation",
                ["generationMode"] = "persisted",
                ["rowKicker"] = "RECOMMENDED",
                ["source"] = row.Id,
                ["sourceValue"] = row.Id,
                ["sourceGroupId"] = "recommendation-rows",
                ["sourceRecommendationId"] = row.Id,
                ["recommendationConfigHash"] = recommendationConfigHash,
                ["rowConfigHash"] = row.RowConfigHash ?? recommendationSettings.RowConfigHash,
                ["configHash"] = recommendationConfigHash,
                ["cacheHash"] = recommendationConfigHash,
                ["enabled"] = true,
                ["candidateCount"] = row.Diagnostics.CandidateCount,
                ["dedupeRemovals"] = finalDedupeRemovals,
                ["hydrationRemovals"] = row.Diagnostics.HydrationRemovals,
                ["itemCount"] = items.Count,
                ["finalRenderedCount"] = items.Count,
                ["primaryCandidateCount"] = row.Diagnostics.PrimaryCandidateCount,
                ["secondaryFallbackCount"] = row.Diagnostics.SecondaryFallbackCount,
                ["discoveryFallbackCount"] = row.Diagnostics.DiscoveryFallbackCount,
                ["showWhenEmpty"] = false,
                ["emptyResultReason"] = null,
                ["shape"] = GetRowShape(row.MediaType),
                ["generatedAt"] = row.GeneratedAt ?? recommendationSettings.GeneratedAt
            });
            AddRecommendationDiagnostic(rowDiagnostics, row, sectionId, recommendationConfigHash, items.Count, null);
            appended += 1;
        }

        return appended;
    }

    private static void AddRecommendationDiagnostic(
        JsonArray rowDiagnostics,
        RecommendationRowDefinition row,
        string sectionId,
        string recommendationConfigHash,
        int itemCount,
        string? skipReason)
    {
        rowDiagnostics.Add(new JsonObject
        {
            ["categoryId"] = row.Id,
            ["rowId"] = sectionId,
            ["rowTitle"] = row.Title,
            ["rowType"] = "generated-recommendation",
            ["sourceType"] = "recommendation",
            ["sourceValue"] = row.Id,
            ["sourceGroupId"] = "recommendation-rows",
            ["sourceRecommendationId"] = row.Id,
            ["sourceRuleId"] = null,
            ["recommendationConfigHash"] = recommendationConfigHash,
            ["configHash"] = recommendationConfigHash,
            ["cacheHash"] = recommendationConfigHash,
            ["enabled"] = row.Enabled && row.Accepted && !row.Draft && skipReason is null,
            ["candidateCount"] = row.Diagnostics.CandidateCount,
            ["dedupeRemovals"] = itemCount > 0
                ? Math.Max(0, row.Diagnostics.DedupeRemovals + row.Items.Count - itemCount)
                : row.Diagnostics.DedupeRemovals,
            ["hydrationRemovals"] = row.Diagnostics.HydrationRemovals,
            ["itemCount"] = itemCount,
            ["finalRenderedCount"] = itemCount,
            ["primaryCandidateCount"] = row.Diagnostics.PrimaryCandidateCount,
            ["secondaryFallbackCount"] = row.Diagnostics.SecondaryFallbackCount,
            ["discoveryFallbackCount"] = row.Diagnostics.DiscoveryFallbackCount,
            ["generationMode"] = "persisted",
            ["dropReason"] = skipReason,
            ["generatedAt"] = row.GeneratedAt
        });
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

    private static JsonArray ToRecommendationItemsJson(IEnumerable<RecommendationItemSnapshot> items)
    {
        var jsonItems = new JsonArray();

        foreach (var item in items)
        {
            var imageTags = new JsonObject();

            if (!string.IsNullOrWhiteSpace(item.ImageTags.Primary)) imageTags["Primary"] = item.ImageTags.Primary;
            if (!string.IsNullOrWhiteSpace(item.ImageTags.Thumb)) imageTags["Thumb"] = item.ImageTags.Thumb;
            if (!string.IsNullOrWhiteSpace(item.ImageTags.Logo)) imageTags["Logo"] = item.ImageTags.Logo;

            var jsonItem = new JsonObject
            {
                ["Id"] = item.Id,
                ["Name"] = item.Name,
                ["Type"] = item.Type,
                ["MediaType"] = item.MediaType,
                ["Overview"] = item.Overview,
                ["ImageTags"] = imageTags,
                ["BackdropImageTags"] = ToStringArray(item.BackdropImageTags),
                ["ParentBackdropImageTags"] = ToStringArray(item.ParentBackdropImageTags),
                ["Genres"] = ToStringArray(item.Genres),
                ["Studios"] = ToStringArray(item.Studios),
                ["Artists"] = ToStringArray(item.Artists),
                ["AlbumArtist"] = item.AlbumArtist,
                ["Album"] = item.Album,
                ["AlbumId"] = item.AlbumId,
                ["AlbumPrimaryImageItemId"] = item.AlbumPrimaryImageItemId,
                ["AlbumPrimaryImageTag"] = item.AlbumPrimaryImageTag,
                ["ParentPrimaryImageItemId"] = item.ParentPrimaryImageItemId,
                ["ParentPrimaryImageTag"] = item.ParentPrimaryImageTag,
                ["ParentThumbItemId"] = item.ParentThumbItemId,
                ["ParentThumbImageTag"] = item.ParentThumbImageTag,
                ["ParentId"] = item.ParentId,
                ["SeriesId"] = item.SeriesId,
                ["SeriesName"] = item.SeriesName,
                ["SeriesPrimaryImageTag"] = item.SeriesPrimaryImageTag,
                ["ProductionYear"] = item.ProductionYear,
                ["CommunityRating"] = item.CommunityRating,
                ["PrimaryImageAspectRatio"] = item.PrimaryImageAspectRatio,
                ["RunTimeTicks"] = item.RunTimeTicks,
                ["DateCreated"] = item.DateCreated,
                ["PremiereDate"] = item.PremiereDate
            };

            jsonItems.Add(jsonItem);
        }

        return jsonItems;
    }

    private static JsonArray ToSectionDefinitionsJson(IEnumerable<GeneratedRow> rows, string rowConfigHash)
    {
        var definitions = new JsonArray();

        foreach (var row in rows)
        {
            definitions.Add(new JsonObject
            {
                ["id"] = row.Id,
                ["title"] = row.Title,
                ["rowType"] = "configured-rule",
                ["type"] = row.SectionType,
                ["ruleId"] = row.Rule.Id,
                ["ruleName"] = row.Rule.Name,
                ["mediaType"] = row.Rule.MediaType,
                ["sourceType"] = row.Rule.SourceType,
                ["generationMode"] = row.Rule.GenerationMode,
                ["rowKicker"] = GetRowKicker(row.Rule),
                ["source"] = row.Source,
                ["sourceValue"] = row.Rule.SourceValue,
                ["sourceRuleId"] = row.Rule.Id,
                ["sourceGroupId"] = string.IsNullOrWhiteSpace(row.Rule.GroupTitle) ? "configured-rules" : Slugify(row.Rule.GroupTitle),
                ["rowConfigHash"] = rowConfigHash,
                ["configHash"] = rowConfigHash,
                ["cacheHash"] = rowConfigHash,
                ["enabled"] = row.Rule.Enabled,
                ["candidateCount"] = row.CandidateCount,
                ["matchedCount"] = row.MatchedCount,
                ["fallbackUsed"] = row.FallbackUsed,
                ["plannedRowCount"] = row.PlannedRowCount,
                ["generatedSourceCount"] = row.GeneratedSourceCount,
                ["sourceIndex"] = row.SourceIndex,
                ["dropReason"] = row.DropReason,
                ["queryUsed"] = row.QueryUsed,
                ["metadataSourceFieldsUsed"] = ToStringArray(row.MetadataSourceFieldsUsed),
                ["studioFilter"] = string.Equals(row.Rule.SourceType, "studio", StringComparison.OrdinalIgnoreCase) ? row.Source : null,
                ["first10ItemNames"] = ToStringArray(row.First10MatchedItemNames),
                ["first10MatchedItemNames"] = ToStringArray(row.First10MatchedItemNames),
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

    private void LogFinalSections(JsonArray sectionDefinitions)
    {
        _logger.LogInformation(
            "PiggieTV Row Rules finalSections: {FinalSections}",
            JsonSerializer.Serialize(sectionDefinitions
                .OfType<JsonObject>()
                .Select(section => new
                {
                    Id = section["id"]?.ToString(),
                    Title = section["title"]?.ToString(),
                    RuleId = section["ruleId"]?.ToString(),
                    SourceType = section["sourceType"]?.ToString(),
                    RowKicker = section["rowKicker"]?.ToString(),
                    ItemCount = section["itemCount"]?.ToString()
                }), JsonOptions));
    }

    private static string GetRowKicker(RowBuilderRule rule)
    {
        if (string.Equals(rule.SourceType, "studio", StringComparison.OrdinalIgnoreCase))
        {
            return "STUDIOS";
        }

        if (string.Equals(rule.SourceType, "genre", StringComparison.OrdinalIgnoreCase))
        {
            return "GENRE";
        }

        return "FEATURED";
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

    private static JsonArray ToDiagnosticsJson(IEnumerable<GeneratedRow> rows, string rowConfigHash)
    {
        var diagnostics = new JsonArray();

        foreach (var row in rows)
        {
            diagnostics.Add(new JsonObject
            {
                ["categoryId"] = row.Rule.Id,
                ["rowId"] = row.Id,
                ["ruleId"] = row.Rule.Id,
                ["ruleName"] = row.Rule.Name,
                ["rowTitle"] = row.Title,
                ["rowType"] = "configured-rule",
                ["sourceType"] = row.Rule.SourceType,
                ["ruleType"] = row.Rule.SourceType,
                ["sourceRuleId"] = row.Rule.Id,
                ["sourceGroupId"] = string.IsNullOrWhiteSpace(row.Rule.GroupTitle) ? "configured-rules" : Slugify(row.Rule.GroupTitle),
                ["rowConfigHash"] = rowConfigHash,
                ["configHash"] = rowConfigHash,
                ["cacheHash"] = rowConfigHash,
                ["enabled"] = row.Rule.Enabled,
                ["mediaType"] = row.Rule.MediaType,
                ["generationMode"] = row.Rule.GenerationMode,
                ["searchTerm"] = row.Source,
                ["sourceValue"] = row.Rule.SourceValue,
                ["studioFilter"] = string.Equals(row.Rule.SourceType, "studio", StringComparison.OrdinalIgnoreCase) ? row.Source : null,
                ["queryUsed"] = row.QueryUsed,
                ["candidateCount"] = row.CandidateCount,
                ["matchedCount"] = row.MatchedCount,
                ["fallbackUsed"] = row.FallbackUsed,
                ["plannedRowCount"] = row.PlannedRowCount,
                ["generatedSourceCount"] = row.GeneratedSourceCount,
                ["droppedSourceCount"] = Math.Max(0, row.PlannedRowCount - row.GeneratedSourceCount),
                ["sourceIndex"] = row.SourceIndex,
                ["dropReason"] = row.DropReason,
                ["metadataSourceFieldsUsed"] = ToStringArray(row.MetadataSourceFieldsUsed),
                ["first10ItemNames"] = ToStringArray(row.First10MatchedItemNames),
                ["first10MatchedItemNames"] = ToStringArray(row.First10MatchedItemNames),
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
            RuleType = row.Rule.SourceType,
            MediaType = row.Rule.MediaType,
            GenerationMode = row.Rule.GenerationMode,
            RowId = row.Id,
            RowTitle = row.Title,
            SearchTerm = row.Source,
            SourceValue = row.Rule.SourceValue,
            StudioFilter = string.Equals(row.Rule.SourceType, "studio", StringComparison.OrdinalIgnoreCase) ? row.Source : null,
            QueryUsed = row.QueryUsed,
            CandidateCount = row.CandidateCount,
            MatchedCount = row.MatchedCount,
            FallbackUsed = row.FallbackUsed,
            PlannedRowCount = row.PlannedRowCount,
            GeneratedSourceCount = row.GeneratedSourceCount,
            DroppedSourceCount = Math.Max(0, row.PlannedRowCount - row.GeneratedSourceCount),
            DropReason = row.DropReason,
            MetadataSourceFieldsUsed = row.MetadataSourceFieldsUsed.ToList(),
            First10ItemNames = row.First10MatchedItemNames.ToList(),
            First10MatchedItemNames = row.First10MatchedItemNames.ToList(),
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

            if (rule.RowCount > 30 || rule.ItemLimit > 60)
            {
                result.Warnings.Add($"Rule '{rule.Name}' may be heavy. Preview before refreshing the cache.");
            }
        }

        result.Ok = result.Errors.Count == 0;

        return result;
    }

    private static bool RequiresSourceValue(RowBuilderRule rule)
    {
        return IsStructuredMetadataSource(rule.SourceType)
            || rule.SourceType is "library" or "collection";
    }

    private static IReadOnlyList<string> GetSubgenres(string genre)
    {
        var normalizedGenre = NormalizeSearchText(genre);

        if (normalizedGenre.Contains("horror", StringComparison.Ordinal))
        {
            return [
                "Supernatural Horror",
                "Slasher Horror",
                "Creature Horror",
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

        if (normalizedGenre.Contains("action", StringComparison.Ordinal))
        {
            return ["Action Adventure", "Martial Arts Action", "Superhero Action", "Action Thriller", "Spy Action", "Crime Action"];
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

            if (IsFatalTmdbStatus(status))
            {
                _lastRefreshWarning = $"TMDb metadata failed: {NormalizeTmdbStatusMessage(status)}";
                _logger.LogWarning("PiggieTV featured-content refresh continued without TMDb metadata. Reason={Reason}", status.LastError);
            }
            else if (status.LastPartial)
            {
                _logger.LogInformation(
                    "PiggieTV TMDb enrichment completed partially without failing featured refresh. Requested={Requested}; Cached={Cached}; Attempted={Attempted}; Completed={Completed}; Skipped={Skipped}; Failed={Failed}; Cancelled={Cancelled}.",
                    status.LastRequestedCount,
                    status.LastCachedCount,
                    status.LastAttemptedCount,
                    status.LastCompletedCount,
                    status.LastSkippedCount,
                    status.LastFailedCount,
                    status.LastCancelledCount);
            }

            return facts;
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("PiggieTV TMDb metadata enrichment reached its time budget. Featured-content refresh will continue with Jellyfin metadata only.");
        }
        catch (Exception ex)
        {
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

    private static bool IsFatalTmdbStatus(PtvTmdbMetadataStatus status)
    {
        return string.Equals(status.LastErrorCode, "unauthorized", StringComparison.OrdinalIgnoreCase)
            || string.Equals(status.LastErrorCode, "missing-credential", StringComparison.OrdinalIgnoreCase)
            || string.Equals(status.LastErrorCode, "validation-failed", StringComparison.OrdinalIgnoreCase);
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
            ["Genres"] = ToStringArray(item.Genres),
            ["Tags"] = ToStringArray(item.Tags)
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
