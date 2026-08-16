using System.Diagnostics;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Bounded background Metadata Quality scanner and review queue.</summary>
public sealed class PtvMetadataQualityService : IPtvMetadataQualityService
{
    private const int EnumerationBatchSize = 200;
    private const int MinimumItemsBeforeSystemicErrorAbort = 100;
    private const double SystemicErrorRatio = 0.25;
    private static readonly TimeSpan DocumentLoadTimeout = TimeSpan.FromMinutes(2);
    private static readonly BaseItemKind[] SupportedItemTypes =
    [
        BaseItemKind.Movie,
        BaseItemKind.Series,
        BaseItemKind.Season,
        BaseItemKind.Episode,
        BaseItemKind.Book,
        BaseItemKind.MusicAlbum,
        BaseItemKind.MusicArtist,
        BaseItemKind.Audio,
        BaseItemKind.BoxSet
    ];

    private readonly object _stateGate = new();
    private readonly Func<List<PtvMetadataQualityLibrarySummary>> _getLibraries;
    private readonly Func<Guid, int, int, PtvMetadataQualityItemBatch> _queryItems;
    private readonly IPtvMetadataQualityStore _store;
    private readonly IPtvMetadataQualityIndexedStore? _indexedStore;
    private readonly PtvMetadataQualityRuleEngine _ruleEngine;
    private readonly PtvReadingMetadataParser _readingParser;
    private readonly PtvReadingMetadataScorer _readingScorer;
    private readonly IPtvMetadataQualityProviderVerifier _providerVerifier;
    private readonly IPtvMetadataAiAnalyzer _aiAnalyzer;
    private readonly ILogger<PtvMetadataQualityService> _logger;
    private readonly object _documentCacheGate = new();
    private readonly object _documentLoadOperationGate = new();
    private readonly object _summaryCacheGate = new();
    private readonly SemaphoreSlim _summaryLoadGate = new(1, 1);
    private PtvMetadataQualityScanRun? _activeRun;
    private CancellationTokenSource? _activeCancellation;
    private PtvMetadataQualityDocument? _documentSnapshot;
    private DocumentLoadOperation? _documentLoadOperation;
    private long _documentRevision;
    private long _documentSnapshotRevision = -1;
    private PtvMetadataQualitySummarySnapshot? _summarySnapshot;
    private long _summaryRevision;
    private long _summarySnapshotRevision = -1;

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvMetadataQualityService"/> class.
    /// </summary>
    /// <param name="libraryManager">Jellyfin library access.</param>
    /// <param name="store">Persistent Metadata Quality document store.</param>
    /// <param name="ruleEngine">Deterministic quality rule engine.</param>
    /// <param name="providerVerifier">Bounded provider-verification service.</param>
    /// <param name="aiAnalyzer">Optional AI analysis service.</param>
    /// <param name="indexedStore">Generation-safe indexed result store.</param>
    /// <param name="readingParser">Shared provider-neutral Reading parser.</param>
    /// <param name="readingScorer">Shared Reading candidate scorer.</param>
    /// <param name="logger">Logger.</param>
    public PtvMetadataQualityService(
        ILibraryManager libraryManager,
        IPtvMetadataQualityStore store,
        PtvMetadataQualityRuleEngine ruleEngine,
        IPtvMetadataQualityProviderVerifier providerVerifier,
        IPtvMetadataAiAnalyzer aiAnalyzer,
        IPtvMetadataQualityIndexedStore indexedStore,
        PtvReadingMetadataParser readingParser,
        PtvReadingMetadataScorer readingScorer,
        ILogger<PtvMetadataQualityService> logger)
    {
        ArgumentNullException.ThrowIfNull(libraryManager);
        _getLibraries = () => CreateLibrarySummaries(libraryManager);
        _queryItems = (libraryId, startIndex, limit) =>
        {
            var result = libraryManager.QueryItems(new InternalItemsQuery
            {
                AncestorIds = [libraryId],
                Recursive = true,
                IncludeItemTypes = SupportedItemTypes,
                StartIndex = startIndex,
                Limit = limit,
                EnableTotalRecordCount = true
            });
            return new PtvMetadataQualityItemBatch(result.Items, result.TotalRecordCount);
        };
        _store = store;
        _indexedStore = indexedStore;
        _ruleEngine = ruleEngine;
        _providerVerifier = providerVerifier;
        _aiAnalyzer = aiAnalyzer;
        _readingParser = readingParser;
        _readingScorer = readingScorer;
        _logger = logger;
    }

    internal PtvMetadataQualityService(
        Func<List<PtvMetadataQualityLibrarySummary>> getLibraries,
        Func<Guid, int, int, PtvMetadataQualityItemBatch> queryItems,
        IPtvMetadataQualityStore store,
        PtvMetadataQualityRuleEngine ruleEngine,
        IPtvMetadataQualityProviderVerifier providerVerifier,
        IPtvMetadataAiAnalyzer aiAnalyzer,
        ILogger<PtvMetadataQualityService> logger,
        IPtvMetadataQualityIndexedStore? indexedStore = null,
        PtvReadingMetadataParser? readingParser = null,
        PtvReadingMetadataScorer? readingScorer = null)
    {
        _getLibraries = getLibraries ?? throw new ArgumentNullException(nameof(getLibraries));
        _queryItems = queryItems ?? throw new ArgumentNullException(nameof(queryItems));
        _store = store;
        _indexedStore = indexedStore;
        _ruleEngine = ruleEngine;
        _providerVerifier = providerVerifier;
        _aiAnalyzer = aiAnalyzer;
        _readingParser = readingParser ?? new PtvReadingMetadataParser();
        _readingScorer = readingScorer ?? new PtvReadingMetadataScorer();
        _logger = logger;
    }

    public async Task<PtvMetadataQualitySummaryResponse> GetSummaryAsync(CancellationToken cancellationToken = default)
    {
        if (_indexedStore is not null)
        {
            var indexedTotalStarted = Stopwatch.GetTimestamp();
            var indexed = await _indexedStore.ReadSummaryAsync(cancellationToken).ConfigureAwait(false);
            var indexedLibraryStarted = Stopwatch.GetTimestamp();
            var indexedLibraries = GetLibrariesSafe();
            SetStage(indexed.Diagnostics, "libraryDiscovery", ElapsedMilliseconds(indexedLibraryStarted));
            IncrementOperation(indexed.Diagnostics, "libraryDiscoveryCalls");
            indexed.Diagnostics.PersistedResultsLoaded = indexed.Counts.TotalScanned;
            indexed.Diagnostics.TotalMs = ElapsedMilliseconds(indexedTotalStarted);
            var indexedResponse = BuildSummary(
                new PtvMetadataQualitySummarySnapshot(
                    indexed.Counts,
                    indexed.LastScanAt,
                    indexed.RuleVersion,
                    indexed.ScannerVersion,
                    indexed.LatestRun),
                indexedLibraries,
                GetActiveRun());
            indexedResponse.Diagnostics = indexed.Diagnostics;
            return indexedResponse;
        }

        var totalStarted = Stopwatch.GetTimestamp();
        var diagnostics = CreateReadDiagnostics();
        var snapshot = await GetSummarySnapshotAsync(cancellationToken, diagnostics).ConfigureAwait(false);
        diagnostics.PersistedResultsLoaded = snapshot.Counts.TotalScanned;

        var libraryStarted = Stopwatch.GetTimestamp();
        var libraries = GetLibrariesSafe();
        SetStage(diagnostics, "libraryDiscovery", ElapsedMilliseconds(libraryStarted));
        IncrementOperation(diagnostics, "libraryDiscoveryCalls");

        var responseStarted = Stopwatch.GetTimestamp();
        var response = BuildSummary(snapshot, libraries, GetActiveRun());
        SetStage(diagnostics, "responseBuild", ElapsedMilliseconds(responseStarted));
        diagnostics.TotalMs = ElapsedMilliseconds(totalStarted);
        response.Diagnostics = diagnostics;
        LogColdRead("summary", diagnostics);
        return response;
    }

    public async Task<PtvMetadataQualityStatusResponse> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        var settings = await _store.ReadSettingsAsync(cancellationToken).ConfigureAwait(false);
        var active = GetActiveRun();
        var aiStatus = _aiAnalyzer.GetStatus(settings.AiEnabled, settings.AiModel);
        return new PtvMetadataQualityStatusResponse
        {
            State = active is null ? PtvMetadataQualityScanStates.Idle : active.State,
            ActiveRun = active,
            StoreErrorCode = _indexedStore is null
                ? await _store.GetErrorCodeAsync(cancellationToken).ConfigureAwait(false)
                : await _indexedStore.GetErrorCodeAsync(cancellationToken).ConfigureAwait(false)
                    ?? await _store.GetErrorCodeAsync(cancellationToken).ConfigureAwait(false),
            ProviderVerificationEnabled = settings.ProviderVerificationEnabled,
            AiEnabled = settings.AiEnabled,
            AiConfigured = aiStatus.CredentialConfigured,
            Ai = aiStatus
        };
    }

    public async Task<PtvMetadataQualityResultsResponse> GetResultsAsync(
        PtvMetadataQualityResultQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (_indexedStore is not null)
        {
            var page = await _indexedStore.QueryResultsAsync(query, cancellationToken).ConfigureAwait(false);
            return new PtvMetadataQualityResultsResponse
            {
                TotalRecordCount = page.TotalRecordCount,
                StartIndex = page.StartIndex,
                Limit = page.Limit,
                Items = page.Items,
                Diagnostics = page.Diagnostics
            };
        }

        var totalStarted = Stopwatch.GetTimestamp();
        var diagnostics = CreateReadDiagnostics();
        var document = await ReadDocumentWithInterruptedRunProjectionAsync(cancellationToken, diagnostics).ConfigureAwait(false);
        diagnostics.PersistedResultsLoaded = document.ItemResults.Count;
        IEnumerable<PtvMetadataQualityResult> results = document.ItemResults.Values;

        if (!string.IsNullOrWhiteSpace(query.Status))
        {
            var status = query.Status.Trim();
            results = results.Where(result => string.Equals(GetDisplayStatus(result), status, StringComparison.OrdinalIgnoreCase));
        }

        if (query.LibraryId.HasValue) results = results.Where(result => result.LibraryId == query.LibraryId);
        if (!string.IsNullOrWhiteSpace(query.ItemType)) results = results.Where(result => string.Equals(result.ItemType, query.ItemType.Trim(), StringComparison.OrdinalIgnoreCase));
        if (query.MinConfidence.HasValue) results = results.Where(result => result.MatchConfidence >= query.MinConfidence.Value);
        if (query.MaxConfidence.HasValue) results = results.Where(result => result.MatchConfidence <= query.MaxConfidence.Value);
        if (query.AiReviewed.HasValue) results = results.Where(result => result.AiReviewed == query.AiReviewed.Value);
        if (!string.IsNullOrWhiteSpace(query.Reason)) results = results.Where(result => result.Reasons.Any(reason => string.Equals(reason.Code, query.Reason.Trim(), StringComparison.OrdinalIgnoreCase)));
        if (!string.IsNullOrWhiteSpace(query.Provider))
        {
            var provider = query.Provider.Trim();
            results = results.Where(result => HasProvider(result.CurrentMatch, provider) || HasProvider(result.SuggestedMatch, provider));
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var search = query.Search.Trim();
            results = results.Where(result =>
                Contains(result.Title, search)
                || Contains(result.FileName, search)
                || result.CurrentMatch?.ProviderIds.Any(pair => Contains(pair.Value, search)) == true
                || result.SuggestedMatch?.ProviderIds.Any(pair => Contains(pair.Value, search)) == true);
        }

        results = ApplySort(results, query.Sort);
        var countStarted = Stopwatch.GetTimestamp();
        var total = results.Count();
        SetStage(diagnostics, "resultFilterCount", ElapsedMilliseconds(countStarted));
        IncrementOperation(diagnostics, "persistedResultsFiltered", document.ItemResults.Count);
        var startIndex = Math.Max(0, query.StartIndex);
        var limit = Math.Clamp(query.Limit, 1, PtvMetadataQualityConstants.MaximumPageSize);
        var pageStarted = Stopwatch.GetTimestamp();
        var items = results.Skip(startIndex).Take(limit).Select(ToResultSummary).ToList();
        SetStage(diagnostics, "resultSortPageProjection", ElapsedMilliseconds(pageStarted));
        diagnostics.RowsReturned = items.Count;
        IncrementOperation(diagnostics, "rowsProjected", items.Count);
        diagnostics.TotalMs = ElapsedMilliseconds(totalStarted);
        var response = new PtvMetadataQualityResultsResponse
        {
            TotalRecordCount = total,
            StartIndex = startIndex,
            Limit = limit,
            Items = items,
            Diagnostics = diagnostics
        };
        LogColdRead("results", diagnostics);
        return response;
    }

    public async Task<PtvMetadataQualityResult?> GetResultAsync(Guid itemId, CancellationToken cancellationToken = default)
    {
        if (itemId == Guid.Empty) return null;
        if (_indexedStore is not null)
        {
            return await _indexedStore.ReadResultAsync(itemId, cancellationToken).ConfigureAwait(false);
        }

        var document = await ReadDocumentWithInterruptedRunProjectionAsync(cancellationToken).ConfigureAwait(false);
        var result = document.ItemResults.GetValueOrDefault(itemId.ToString("N"));
        return result is null ? null : CloneResult(result);
    }

    public async Task<PtvMetadataQualitySummaryResponse> StartScanAsync(
        PtvMetadataQualityScanRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var mode = NormalizeMode(request.Mode);
        var settings = await _store.ReadSettingsAsync(cancellationToken).ConfigureAwait(false);
        if (!settings.Enabled)
        {
            throw new PtvMetadataQualityServiceException("PTV_METADATA_QUALITY_DISABLED", "Metadata Quality scanning is disabled.");
        }

        var run = BeginRun(mode);
        var libraryIds = NormalizeLibraryIds(request.LibraryIds, settings.SelectedLibraryIds);
        var cancellation = GetActiveCancellation()!;
        _ = Task.Run(() => ExecuteRunAsync(run, libraryIds, settings, null, propagateFailure: false, cancellation.Token), CancellationToken.None);

        return await GetSummaryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<PtvMetadataQualitySummaryResponse> CancelScanAsync(CancellationToken cancellationToken = default)
    {
        lock (_stateGate)
        {
            _activeCancellation?.Cancel();
        }

        return await GetSummaryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<PtvMetadataQualityResult?> ResolveAsync(
        Guid itemId,
        string action,
        CancellationToken cancellationToken = default)
    {
        if (itemId == Guid.Empty) return null;
        var normalizedAction = action?.Trim().ToLowerInvariant();
        if (normalizedAction is not ("keep_current" or "dismiss"))
        {
            throw new PtvMetadataQualityServiceException("PTV_METADATA_QUALITY_ACTION_INVALID", "The requested review action is not supported.");
        }

        if (_indexedStore is not null)
        {
            return await _indexedStore.ResolveAsync(itemId, normalizedAction, cancellationToken).ConfigureAwait(false);
        }

        PtvMetadataQualityResult? resolved = null;
        await UpdateDocumentAsync(document =>
        {
            if (!document.ItemResults.TryGetValue(itemId.ToString("N"), out var result)) return document;
            var now = DateTimeOffset.UtcNow;
            result.Dismissed = normalizedAction == "dismiss";
            result.DismissedAt = result.Dismissed ? now : null;
            result.DismissedFingerprint = result.Dismissed ? result.ScanFingerprint : null;
            result.DismissedReasonSignature = result.Dismissed ? CreateReasonSignature(result.Reasons) : null;
            result.Resolution = new PtvMetadataQualityResolution
            {
                State = normalizedAction == "dismiss" ? "dismissed" : "kept_current",
                ResolvedAt = now,
                Fingerprint = result.ScanFingerprint,
                PreviousStatus = result.Status
            };
            resolved = result;
            return document;
        }, cancellationToken).ConfigureAwait(false);
        return resolved;
    }

    /// <inheritdoc />
    public async Task<PtvMetadataQualitySummaryResponse> RebuildIndexAsync(
        CancellationToken cancellationToken = default)
    {
        if (_indexedStore is null)
        {
            throw new PtvMetadataQualityServiceException(
                "PTV_METADATA_QUALITY_INDEX_UNAVAILABLE",
                "Metadata Quality indexed storage is unavailable.");
        }

        lock (_stateGate)
        {
            if (_activeRun is not null)
            {
                throw new PtvMetadataQualityServiceException(
                    "PTV_METADATA_QUALITY_SCAN_RUNNING",
                    "Stop the active Metadata Quality scan before rebuilding its index.");
            }
        }

        await _indexedStore.RebuildFromLegacyAsync(cancellationToken).ConfigureAwait(false);
        return await GetSummaryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<PtvMetadataQualitySettings> GetSettingsAsync(CancellationToken cancellationToken = default)
    {
        var settings = await _store.ReadSettingsAsync(cancellationToken).ConfigureAwait(false);
        settings.AiConfigured = _aiAnalyzer.IsConfigured;
        settings.ExtensionData = null;
        return settings;
    }

    public async Task<PtvMetadataQualitySettings> SaveSettingsAsync(
        PtvMetadataQualitySettings settings,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var normalizedModel = PtvMetadataQualityStore.NormalizeModel(
            settings.AiModel,
            Environment.GetEnvironmentVariable(PtvOpenAiSecretSafety.ApiKeyEnvironmentVariable));
        var saved = await _store.UpdateSettingsAsync(settings.Revision, current =>
        {
            current.Enabled = settings.Enabled;
            current.ScheduledIncrementalScan = settings.ScheduledIncrementalScan;
            current.ReviewThreshold = settings.ReviewThreshold;
            current.LikelyWrongThreshold = settings.LikelyWrongThreshold;
            current.ProviderVerificationEnabled = settings.ProviderVerificationEnabled;
            current.ProviderVerificationThreshold = settings.ProviderVerificationThreshold;
            current.ProviderMaximumRequestsPerRun = settings.ProviderMaximumRequestsPerRun;
            current.AiEnabled = settings.AiEnabled;
            current.AiModel = normalizedModel;
            current.AiThreshold = settings.AiThreshold;
            current.AiMinimumConfidence = settings.AiMinimumConfidence;
            current.AiMaxItemsPerRun = settings.AiMaxItemsPerRun;
            current.SelectedLibraryIds = (settings.SelectedLibraryIds ?? []).ToList();
            return current;
        }, cancellationToken).ConfigureAwait(false);
        saved.AiConfigured = _aiAnalyzer.IsConfigured;
        saved.ExtensionData = null;
        return saved;
    }

    public async Task<PtvMetadataAiConnectionTestResponse> TestAiConnectionAsync(
        PtvMetadataAiConnectionTestRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var settings = await _store.ReadSettingsAsync(cancellationToken).ConfigureAwait(false);
        var model = request.Model is null ? settings.AiModel : request.Model;
        return await _aiAnalyzer.TestConnectionAsync(model, cancellationToken).ConfigureAwait(false);
    }

    public async Task RunScheduledScanAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(progress);
        var settings = await _store.ReadSettingsAsync(cancellationToken).ConfigureAwait(false);
        if (!settings.Enabled || !settings.ScheduledIncrementalScan)
        {
            progress.Report(100);
            return;
        }

        var run = BeginRun("changed", cancellationToken);
        await ExecuteRunAsync(run, settings.SelectedLibraryIds, settings, progress, propagateFailure: true, GetActiveCancellation()!.Token).ConfigureAwait(false);
    }

    private async Task ExecuteRunAsync(
        PtvMetadataQualityScanRun run,
        IReadOnlyCollection<Guid> requestedLibraryIds,
        PtvMetadataQualitySettings settings,
        IProgress<double>? progress,
        bool propagateFailure,
        CancellationToken cancellationToken)
    {
        if (_indexedStore is not null)
        {
            await ExecuteIndexedRunAsync(
                run,
                requestedLibraryIds,
                settings,
                progress,
                propagateFailure,
                cancellationToken).ConfigureAwait(false);
            return;
        }

        var runResults = new Dictionary<string, PtvMetadataQualityResult>(StringComparer.OrdinalIgnoreCase);
        var seenItemIds = new HashSet<Guid>();
        var scannedLibraryIds = new HashSet<Guid>();
        var duplicateProviderIds = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        var providerBudget = new PtvMetadataProviderVerificationBudget(settings.ProviderMaximumRequestsPerRun);
        var aiState = new PtvMetadataAiRunState();

        try
        {
            await MarkRunStartedAsync(run, cancellationToken).ConfigureAwait(false);
            var existingResults = (await _store.ReadAsync(cancellationToken).ConfigureAwait(false)).ItemResults;
            foreach (var existing in existingResults.Values)
            {
                foreach (var pair in existing.CurrentMatch?.ProviderIds ?? [])
                {
                    if (!string.IsNullOrWhiteSpace(pair.Key) && !string.IsNullOrWhiteSpace(pair.Value))
                    {
                        duplicateProviderIds.TryAdd($"{pair.Key.Trim().ToUpperInvariant()}:{pair.Value.Trim()}", existing.ItemId);
                    }
                }
            }
            var libraries = GetLibrariesRequired();
            var availableLibraryIds = libraries.Select(library => library.Id).ToHashSet();
            var scanAllLibraries = requestedLibraryIds.Count == 0;
            var removedRequestedLibraryIds = requestedLibraryIds
                .Where(libraryId => !availableLibraryIds.Contains(libraryId))
                .ToHashSet();
            var selected = libraries
                .Where(library => requestedLibraryIds.Count == 0 || requestedLibraryIds.Contains(library.Id))
                .ToList();
            if (requestedLibraryIds.Count > 0 && selected.Count == 0)
            {
                var hasStoredResultsInRemovedScope = existingResults.Values.Any(result =>
                    result.LibraryId.HasValue && removedRequestedLibraryIds.Contains(result.LibraryId.Value));
                if (!hasStoredResultsInRemovedScope)
                {
                    throw new PtvMetadataQualityServiceException("PTV_METADATA_QUALITY_LIBRARY_NOT_FOUND", "None of the selected libraries are available.");
                }
            }

            run.ItemCount = selected.Sum(library => _queryItems(library.Id, 0, 1).TotalRecordCount);
            await PersistBatchAsync(run, runResults, cancellationToken).ConfigureAwait(false);

            foreach (var library in selected)
            {
                cancellationToken.ThrowIfCancellationRequested();
                scannedLibraryIds.Add(library.Id);
                var startIndex = 0;
                while (true)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var queryResult = _queryItems(library.Id, startIndex, EnumerationBatchSize);

                    var batch = queryResult.Items;
                    if (batch.Count == 0) break;

                    foreach (var item in batch)
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        run.ItemsConsidered++;
                        seenItemIds.Add(item.Id);
                        try
                        {
                            var analysisItem = CreateAnalysisItem(item, library.Id, library.Name);
                            var fingerprint = PtvMetadataQualityFingerprint.Create(analysisItem);
                            existingResults.TryGetValue(item.Id.ToString("N"), out var existing);
                            if (run.Mode == "changed"
                                && existing is not null
                                && string.Equals(existing.ScanFingerprint, fingerprint, StringComparison.Ordinal)
                                && string.Equals(existing.ScannerVersion, PtvMetadataQualityConstants.ScannerVersion, StringComparison.Ordinal)
                                && string.Equals(existing.RuleVersion, PtvMetadataQualityConstants.RuleVersion, StringComparison.Ordinal))
                            {
                                run.ItemsSkipped++;
                            }
                            else
                            {
                                var result = await AnalyzeItemAsync(
                                    analysisItem,
                                    fingerprint,
                                     settings,
                                     providerBudget,
                                     run,
                                     aiState,
                                     () => run.ProviderCacheHits++,
                                    cancellationToken).ConfigureAwait(false);
                                ApplyDuplicateProviderRule(result, duplicateProviderIds);
                                result.Status = Classify(result.MatchConfidence, result.CompletenessScore, settings);
                                ApplyResolutionHistory(result, existing, fingerprint);
                                runResults[item.Id.ToString("N")] = result;
                                existingResults[item.Id.ToString("N")] = result;
                                run.ItemsScanned++;
                                CountStatus(run, result.Status);
                            }
                        }
                        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                        {
                            throw;
                        }
                        catch (Exception ex)
                        {
                            run.Errors++;
                            run.ItemsScanned++;
                            run.Unavailable++;
                            runResults[item.Id.ToString("N")] = CreateUnavailableResult(item, library.Id, library.Name);
                            _logger.LogWarning(ex, "PiggieTV Metadata Quality could not analyze item {ItemId}.", item.Id.ToString("N"));
                        }
                    }

                    run.ProviderRequests = providerBudget.Consumed;
                    run.ProgressPercent = run.ItemCount <= 0 ? 0 : Math.Clamp((double)run.ItemsConsidered / run.ItemCount * 100, 0, 99);
                    progress?.Report(run.ProgressPercent);
                    await PersistBatchAsync(run, runResults, cancellationToken).ConfigureAwait(false);
                    runResults.Clear();

                    if (run.ItemsScanned >= MinimumItemsBeforeSystemicErrorAbort
                        && (double)run.Errors / run.ItemsScanned > SystemicErrorRatio)
                    {
                        throw new PtvMetadataQualityServiceException("PTV_METADATA_QUALITY_SYSTEMIC_FAILURE", "The scan stopped after too many items failed analysis.");
                    }

                    startIndex += batch.Count;
                    if (batch.Count < EnumerationBatchSize || startIndex >= queryResult.TotalRecordCount) break;
                }
            }

            await CompleteRunAsync(
                run,
                seenItemIds,
                scannedLibraryIds,
                availableLibraryIds,
                removedRequestedLibraryIds,
                scanAllLibraries,
                cancellationToken).ConfigureAwait(false);
            progress?.Report(100);
            _logger.LogInformation(
                "PiggieTV Metadata Quality scan completed. Mode={Mode} Considered={Considered} Scanned={Scanned} Skipped={Skipped} ProviderRequests={ProviderRequests} AiRequests={AiRequests} Errors={Errors}.",
                run.Mode,
                run.ItemsConsidered,
                run.ItemsScanned,
                run.ItemsSkipped,
                run.ProviderRequests,
                run.AiRequests,
                run.Errors);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            run.State = PtvMetadataQualityScanStates.Cancelled;
            run.CompletedAt = DateTimeOffset.UtcNow;
            await PersistTerminalRunBestEffortAsync(run).ConfigureAwait(false);
            if (propagateFailure) throw;
        }
        catch (Exception ex)
        {
            run.State = PtvMetadataQualityScanStates.Failed;
            run.CompletedAt = DateTimeOffset.UtcNow;
            run.ErrorCode = ex is PtvMetadataQualityServiceException serviceException
                ? serviceException.Code
                : ex is PtvMetadataQualityStoreException storeException
                    ? storeException.Code
                    : "PTV_METADATA_QUALITY_SCAN_FAILED";
            _logger.LogError(ex, "PiggieTV Metadata Quality scan failed. Code={ErrorCode}.", run.ErrorCode);
            await PersistTerminalRunBestEffortAsync(run).ConfigureAwait(false);
            if (propagateFailure) throw;
        }
        finally
        {
            EndRun(run.RunId);
        }
    }

    private async Task ExecuteIndexedRunAsync(
        PtvMetadataQualityScanRun run,
        IReadOnlyCollection<Guid> requestedLibraryIds,
        PtvMetadataQualitySettings settings,
        IProgress<double>? progress,
        bool propagateFailure,
        CancellationToken cancellationToken)
    {
        var indexedStore = _indexedStore
            ?? throw new InvalidOperationException("The indexed Metadata Quality store is unavailable.");
        PtvMetadataQualityGenerationHandle? generation = null;
        var providerBudget = new PtvMetadataProviderVerificationBudget(settings.ProviderMaximumRequestsPerRun);
        var aiState = new PtvMetadataAiRunState();

        try
        {
            var libraries = GetLibrariesRequired();
            var availableLibraryIds = libraries.Select(library => library.Id).ToHashSet();
            var scanAllLibraries = requestedLibraryIds.Count == 0;
            var removedRequestedLibraryIds = requestedLibraryIds
                .Where(libraryId => !availableLibraryIds.Contains(libraryId))
                .ToHashSet();
            var selected = libraries
                .Where(library => scanAllLibraries || requestedLibraryIds.Contains(library.Id))
                .ToList();
            var resetLibraryIds = selected
                .Select(library => library.Id)
                .Concat(removedRequestedLibraryIds)
                .Distinct()
                .ToArray();

            generation = await indexedStore.BeginGenerationAsync(
                run,
                resetAllResults: scanAllLibraries,
                resetLibraryIds,
                cancellationToken).ConfigureAwait(false);

            if (requestedLibraryIds.Count > 0 && selected.Count == 0
                && !await indexedStore.HasResultsInLibrariesAsync(
                    generation.GenerationId,
                    removedRequestedLibraryIds,
                    cancellationToken).ConfigureAwait(false))
            {
                throw new PtvMetadataQualityServiceException(
                    "PTV_METADATA_QUALITY_LIBRARY_NOT_FOUND",
                    "None of the selected libraries are available.");
            }

            var duplicateProviderIds = await indexedStore.ReadCurrentProviderIdentityMapAsync(
                generation.GenerationId,
                cancellationToken).ConfigureAwait(false);
            run.ItemCount = selected.Sum(library => _queryItems(library.Id, 0, 1).TotalRecordCount);
            await indexedStore.WriteGenerationBatchAsync(
                generation.GenerationId,
                run,
                new Dictionary<string, PtvMetadataQualityResult>(StringComparer.OrdinalIgnoreCase),
                Array.Empty<Guid>(),
                cancellationToken).ConfigureAwait(false);

            foreach (var library in selected)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var startIndex = 0;
                while (true)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var queryResult = _queryItems(library.Id, startIndex, EnumerationBatchSize);
                    var batch = queryResult.Items;
                    if (batch.Count == 0) break;

                    var batchIds = batch.Select(item => item.Id).ToArray();
                    var baselines = await indexedStore.ReadScanBaselinesAsync(
                        generation.GenerationId,
                        batchIds,
                        cancellationToken).ConfigureAwait(false);
                    var changedResults = new Dictionary<string, PtvMetadataQualityResult>(
                        batch.Count,
                        StringComparer.OrdinalIgnoreCase);

                    foreach (var item in batch)
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        run.ItemsConsidered++;
                        baselines.TryGetValue(item.Id, out var baseline);
                        try
                        {
                            var analysisItem = CreateAnalysisItem(item, library.Id, library.Name);
                            var fingerprint = PtvMetadataQualityFingerprint.Create(analysisItem);
                            if (run.Mode == "changed"
                                && baseline is not null
                                && string.Equals(baseline.ScanFingerprint, fingerprint, StringComparison.Ordinal)
                                && string.Equals(baseline.ScannerVersion, PtvMetadataQualityConstants.ScannerVersion, StringComparison.Ordinal)
                                && string.Equals(baseline.RuleVersion, PtvMetadataQualityConstants.RuleVersion, StringComparison.Ordinal))
                            {
                                run.ItemsSkipped++;
                                continue;
                            }

                            var result = await AnalyzeItemAsync(
                                analysisItem,
                                fingerprint,
                                settings,
                                providerBudget,
                                run,
                                aiState,
                                () => run.ProviderCacheHits++,
                                cancellationToken).ConfigureAwait(false);
                            ApplyDuplicateProviderRule(result, duplicateProviderIds);
                            result.Status = Classify(result.MatchConfidence, result.CompletenessScore, settings);
                            ApplyResolutionHistory(result, baseline?.ToHistoryResult(), fingerprint);
                            changedResults[item.Id.ToString("N")] = result;
                            run.ItemsScanned++;
                            CountStatus(run, result.Status);
                        }
                        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                        {
                            throw;
                        }
                        catch (Exception ex)
                        {
                            run.Errors++;
                            run.ItemsScanned++;
                            run.Unavailable++;
                            var unavailable = CreateUnavailableResult(item, library.Id, library.Name);
                            ApplyResolutionHistory(
                                unavailable,
                                baseline?.ToHistoryResult(),
                                unavailable.ScanFingerprint);
                            changedResults[item.Id.ToString("N")] = unavailable;
                            _logger.LogWarning(
                                ex,
                                "PiggieTV Metadata Quality could not analyze item {ItemId}.",
                                item.Id.ToString("N"));
                        }
                    }

                    run.ProviderRequests = providerBudget.Consumed;
                    run.ProgressPercent = run.ItemCount <= 0
                        ? 0
                        : Math.Clamp((double)run.ItemsConsidered / run.ItemCount * 100, 0, 99);
                    progress?.Report(run.ProgressPercent);
                    await indexedStore.WriteGenerationBatchAsync(
                        generation.GenerationId,
                        run,
                        changedResults,
                        batchIds,
                        cancellationToken).ConfigureAwait(false);

                    if (run.ItemsScanned >= MinimumItemsBeforeSystemicErrorAbort
                        && (double)run.Errors / run.ItemsScanned > SystemicErrorRatio)
                    {
                        throw new PtvMetadataQualityServiceException(
                            "PTV_METADATA_QUALITY_SYSTEMIC_FAILURE",
                            "The scan stopped after too many items failed analysis.");
                    }

                    startIndex += batch.Count;
                    if (batch.Count < EnumerationBatchSize || startIndex >= queryResult.TotalRecordCount) break;
                }
            }

            run.State = PtvMetadataQualityScanStates.Completed;
            run.CompletedAt = DateTimeOffset.UtcNow;
            run.ProgressPercent = 100;
            await indexedStore.CompleteGenerationAsync(
                generation.GenerationId,
                run,
                cancellationToken).ConfigureAwait(false);
            progress?.Report(100);
            _logger.LogInformation(
                "PiggieTV Metadata Quality indexed scan completed. Mode={Mode} Considered={Considered} Scanned={Scanned} Skipped={Skipped} ProviderRequests={ProviderRequests} AiRequests={AiRequests} Errors={Errors}.",
                run.Mode,
                run.ItemsConsidered,
                run.ItemsScanned,
                run.ItemsSkipped,
                run.ProviderRequests,
                run.AiRequests,
                run.Errors);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            run.State = PtvMetadataQualityScanStates.Cancelled;
            run.CompletedAt = DateTimeOffset.UtcNow;
            if (generation is not null)
            {
                await FailIndexedGenerationBestEffortAsync(indexedStore, generation.GenerationId, run).ConfigureAwait(false);
            }

            if (propagateFailure) throw;
        }
        catch (Exception ex)
        {
            run.State = PtvMetadataQualityScanStates.Failed;
            run.CompletedAt = DateTimeOffset.UtcNow;
            run.ErrorCode = ex is PtvMetadataQualityServiceException serviceException
                ? serviceException.Code
                : ex is PtvMetadataQualityStoreException storeException
                    ? storeException.Code
                    : "PTV_METADATA_QUALITY_SCAN_FAILED";
            _logger.LogError(
                ex,
                "PiggieTV Metadata Quality indexed scan failed. Code={ErrorCode}.",
                run.ErrorCode);
            if (generation is not null)
            {
                await FailIndexedGenerationBestEffortAsync(indexedStore, generation.GenerationId, run).ConfigureAwait(false);
            }

            if (propagateFailure) throw;
        }
        finally
        {
            EndRun(run.RunId);
        }
    }

    private async Task FailIndexedGenerationBestEffortAsync(
        IPtvMetadataQualityIndexedStore indexedStore,
        Guid generationId,
        PtvMetadataQualityScanRun run)
    {
        try
        {
            await indexedStore.FailGenerationAsync(generationId, run, CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV Metadata Quality could not persist a failed indexed generation.");
        }
    }

    private async Task<PtvMetadataQualityResult> AnalyzeItemAsync(
        PtvMetadataQualityAnalysisItem item,
        string fingerprint,
        PtvMetadataQualitySettings settings,
        PtvMetadataProviderVerificationBudget providerBudget,
        PtvMetadataQualityScanRun run,
        PtvMetadataAiRunState aiState,
        Action recordProviderCacheHit,
        CancellationToken cancellationToken)
    {
        var readingQuery = IsReadingQualityItem(item)
            ? CreateReadingQuery(item)
            : null;
        var rule = _ruleEngine.Analyze(item);
        var result = new PtvMetadataQualityResult
        {
            ItemId = item.ItemId,
            LibraryId = item.LibraryId,
            LibraryName = item.LibraryName,
            ItemType = item.ItemType,
            Title = item.Name,
            FileName = item.FileName,
            FolderName = item.FolderName,
            ScanFingerprint = fingerprint,
            ScannedAt = DateTimeOffset.UtcNow,
            MatchConfidence = rule.MatchConfidence,
            CompletenessScore = rule.CompletenessScore,
            RuleScore = rule.MatchConfidence,
            Signals = rule.Signals,
            Reasons = rule.Reasons,
            CurrentMatch = new PtvMetadataMatchSummary
            {
                Name = item.Name,
                ProductionYear = item.ProductionYear,
                MediaClass = item.ReadingMediaClass,
                EditionKind = item.ReadingEditionKind,
                EditionKindEvidence = item.ReadingEditionKindEvidence,
                SeriesTitle = item.SeriesTitle,
                SeriesTitleEvidence = item.SeriesTitleEvidence,
                NormalizedIssueNumber = item.NormalizedIssueNumber,
                IssueNumberEvidence = item.IssueNumberEvidence,
                VolumeNumber = item.VolumeNumber,
                SeriesStartYear = item.SeriesStartYear,
                SeriesStartYearEvidence = item.SeriesStartYearEvidence,
                IssuePublicationYear = item.IssuePublicationYear,
                IssuePublicationDate = item.IssuePublicationDate,
                IssuePublicationEvidence = item.IssuePublicationEvidence,
                Publisher = item.Publisher,
                VolumeId = item.VolumeId,
                Type = item.ItemType,
                RuntimeMinutes = item.RunTimeTicks.HasValue ? Math.Round(TimeSpan.FromTicks(item.RunTimeTicks.Value).TotalMinutes, 1) : null,
                ProviderIds = new Dictionary<string, string>(item.ProviderIds, StringComparer.OrdinalIgnoreCase)
            }
        };

        var incompleteProviderCapableItem = IsProviderCapableCompletenessType(item.ItemType)
            && result.CompletenessScore < 100;
        if (settings.ProviderVerificationEnabled
            && (result.MatchConfidence < settings.ProviderVerificationThreshold || incompleteProviderCapableItem)
            && providerBudget.Remaining > 0)
        {
            var verification = await _providerVerifier.VerifyAsync(new PtvMetadataProviderVerificationRequest
            {
                ItemId = item.ItemId,
                ItemType = item.ItemType,
                Name = item.Name,
                OriginalTitle = item.OriginalTitle,
                ProductionYear = item.ProductionYear,
                MediaClass = item.ReadingMediaClass,
                EditionKind = item.ReadingEditionKind,
                EditionKindEvidence = item.ReadingEditionKindEvidence,
                SeriesTitle = item.SeriesTitle,
                SeriesTitleEvidence = item.SeriesTitleEvidence,
                NormalizedIssueNumber = item.NormalizedIssueNumber,
                IssueNumberEvidence = item.IssueNumberEvidence,
                VolumeNumber = item.VolumeNumber,
                SeriesStartYear = item.SeriesStartYear,
                SeriesStartYearEvidence = item.SeriesStartYearEvidence,
                IssuePublicationYear = item.IssuePublicationYear,
                IssuePublicationDate = item.IssuePublicationDate,
                IssuePublicationEvidence = item.IssuePublicationEvidence,
                Publisher = item.Publisher,
                VolumeId = item.VolumeId,
                ProviderIds = new Dictionary<string, string>(item.ProviderIds, StringComparer.OrdinalIgnoreCase),
                EvidenceName = SelectProviderEvidenceName(item),
                EvidenceYear = result.Signals.FilenameYear
            }, providerBudget, cancellationToken).ConfigureAwait(false);
            if (verification.CacheHit) recordProviderCacheHit();
            ApplyProviderVerification(item, result, rule.HasHardConflict, verification, readingQuery);
        }

        var hardConflict = rule.HasHardConflict
            || result.Signals.ProviderIdConflict
            || result.Signals.ItemTypeConflict
            || result.Signals.RuntimeDifferencePercent > 75;
        var enforceReliableAiCandidates = readingQuery is not null;
        var aiCandidates = enforceReliableAiCandidates
            ? result.Candidates.Where(IsReliableCandidate).ToList()
            : result.Candidates.ToList();
        var aiEligible = settings.AiEnabled
            && !hardConflict
            && result.MatchConfidence >= settings.AiMinimumConfidence
            && result.MatchConfidence <= settings.AiThreshold
            && aiCandidates.Count > 0;
        if (aiEligible)
        {
            run.AiEligible++;
            if (aiState.CircuitOpen)
            {
                run.AiSkipped++;
                run.AiCircuitSkipped++;
            }
            else if (!_aiAnalyzer.IsConfigured)
            {
                run.AiSkipped++;
                run.AiFailures++;
                OpenAiCircuit(run, aiState, PtvMetadataAiErrorCodes.MissingCredential);
            }
            else if (run.AiRequests >= settings.AiMaxItemsPerRun)
            {
                run.AiSkipped++;
                run.AiBudgetSkipped++;
            }
            else
            {
                run.AiRequests++;
                var ai = await _aiAnalyzer.AnalyzeAsync(new PtvMetadataAiAnalysisInput
                {
                    ItemType = item.ItemType,
                    CurrentTitle = item.Name,
                    CurrentYear = item.ProductionYear,
                    RunTimeTicks = item.RunTimeTicks,
                    FileName = item.FileName,
                    FolderName = item.FolderName,
                    // AI receives structured facts and stable candidate indexes, never
                    // raw provider values whose opaque slugs can mimic issue numbers.
                    CurrentProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase),
                    HasHardConflict = hardConflict,
                    DeterministicReasonCodes = result.Reasons.Select(reason => reason.Code).Distinct(StringComparer.Ordinal).ToList(),
                    VerifiedCandidates = aiCandidates.Select(ToAiMatchSummary).ToList()
                }, settings.AiModel, cancellationToken).ConfigureAwait(false);
                if (ai.Reviewed)
                {
                    run.AiAnalyzed++;
                    ApplyAiResult(result, ai, hardConflict, aiCandidates, enforceReliableAiCandidates);
                }
                else
                {
                    run.AiFailures++;
                    var errorCode = string.IsNullOrWhiteSpace(ai.ErrorCode)
                        ? PtvMetadataAiErrorCodes.UnknownFailure
                        : ai.ErrorCode;
                    run.AiErrorCode = errorCode;
                    if (ShouldSuppressFurtherAiAttemptsForRun(errorCode))
                    {
                        OpenAiCircuit(run, aiState, errorCode);
                    }
                }
            }
        }

        result.Status = Classify(result.MatchConfidence, result.CompletenessScore, settings);
        return result;
    }

    private void ApplyProviderVerification(
        PtvMetadataQualityAnalysisItem item,
        PtvMetadataQualityResult result,
        bool hasHardConflict,
        PtvMetadataProviderVerificationResult verification,
        PtvStructuredMetadataQuery? readingQuery)
    {
        if (!verification.Attempted && !verification.CacheHit) return;
        if (!verification.Available)
        {
            result.Reasons.Add(new PtvMetadataQualityReason
            {
                Code = PtvMetadataQualityReasonCodes.ProviderLookupFailed,
                Severity = "info",
                Message = "The metadata provider could not verify this item."
            });
            return;
        }

        result.ProviderVerified = true;
        result.Signals.CandidateCount = verification.Candidates.Count;
        if (readingQuery is not null)
        {
            ApplyReadingProviderVerification(item, result, hasHardConflict, verification, readingQuery);
            return;
        }

        foreach (var candidate in verification.Candidates.Take(5))
        {
            var candidateScore = ScoreCandidate(item, candidate);
            result.Candidates.Add(new PtvMetadataQualityCandidate
            {
                Name = candidate.Name,
                ProductionYear = candidate.ProductionYear,
                Type = candidate.Type ?? item.ItemType,
                TypeVerified = candidate.TypeVerified,
                RuntimeMinutes = candidate.RuntimeMinutes,
                ProviderIds = new Dictionary<string, string>(candidate.ProviderIds, StringComparer.OrdinalIgnoreCase),
                Source = candidate.ProviderName,
                Score = candidateScore,
                Confidence = ConfidenceForScore(candidateScore)
            });
        }

        var best = result.Candidates.OrderByDescending(candidate => candidate.Score).FirstOrDefault();
        if (best is null) return;
        result.ProviderScore = best.Score;
        result.MatchConfidence = (int)Math.Round((result.MatchConfidence * 0.65) + ((best.Score ?? result.MatchConfidence) * 0.35));
        ApplyRuntimeEvidence(item, result, best);
        ApplyMediaTypeEvidence(item, result, best);
        var providerConflict = HasConflictingProviderId(item.ProviderIds, best.ProviderIds);
        if (providerConflict && best.Score >= 75)
        {
            result.Signals.ProviderIdConflict = true;
            result.MatchConfidence = Math.Min(result.MatchConfidence, 49);
            result.Reasons.Add(new PtvMetadataQualityReason
            {
                Code = PtvMetadataQualityReasonCodes.ProviderIdConflict,
                Severity = "error",
                ScoreImpact = -35,
                Message = "A verified candidate conflicts with the current provider identifier."
            });
        }

        if ((best.Score ?? 0) >= 70 && (!SameIdentity(item, best) || providerConflict))
        {
            result.SuggestedMatch = ToMatchSummary(best);
            result.Reasons.Add(new PtvMetadataQualityReason
            {
                Code = PtvMetadataQualityReasonCodes.BetterProviderCandidate,
                Severity = "warning",
                Message = "A verified provider candidate matches the available evidence more closely."
            });
        }

        if (hasHardConflict) result.MatchConfidence = Math.Min(result.MatchConfidence, 49);
    }

    private void ApplyReadingProviderVerification(
        PtvMetadataQualityAnalysisItem item,
        PtvMetadataQualityResult result,
        bool hasHardConflict,
        PtvMetadataProviderVerificationResult verification,
        PtvStructuredMetadataQuery query)
    {
        var ranked = verification.Candidates
            .Select(candidate =>
            {
                var normalized = ToReadingCandidate(candidate, query, out var seriesFromSearchContext);
                var match = _readingScorer.Score(query, normalized);
                var score = match.Score;
                var reasons = match.Reasons.Select(ToQualityReason).ToList();

                // A series title inherited from the already-bounded search scope is
                // useful corroboration, but is deliberately weaker than provider data.
                if (seriesFromSearchContext && score > 0)
                {
                    score = Math.Max(0, score - 15);
                    reasons.Add(new PtvMetadataQualityReason
                    {
                        Code = "SERIES_SEARCH_CONTEXT",
                        Severity = "info",
                        ScoreImpact = -15,
                        Message = "The series title came from the search scope rather than the provider record."
                    });
                }

                if (!string.IsNullOrWhiteSpace(item.Publisher)
                    && !string.IsNullOrWhiteSpace(candidate.Publisher)
                    && string.Equals(
                        PtvReadingMetadataParser.NormalizeTitle(item.Publisher),
                        PtvReadingMetadataParser.NormalizeTitle(candidate.Publisher),
                        StringComparison.Ordinal))
                {
                    score = Math.Min(100, score + 5);
                    reasons.Add(new PtvMetadataQualityReason
                    {
                        Code = PtvReadingMatchReasonCodes.PublisherMatch,
                        Severity = "info",
                        ScoreImpact = 5,
                        Message = "The publisher matches."
                    });
                }

                if (match.IsRejected) score = Math.Min(score, 39);
                return new PtvMetadataQualityCandidate
                {
                    Name = candidate.Name,
                    ProductionYear = candidate.ProductionYear,
                    MediaClass = normalized.MediaClass,
                    EditionKind = normalized.EditionKind,
                    EditionKindEvidence = normalized.EditionKindEvidence,
                    SeriesTitle = normalized.SeriesTitle,
                    SeriesTitleEvidence = normalized.SeriesTitleEvidence,
                    SeriesTitleFromSearchContext = seriesFromSearchContext,
                    NormalizedIssueNumber = normalized.IssueNumber,
                    IssueNumberEvidence = normalized.IssueNumberEvidence,
                    VolumeNumber = normalized.VolumeNumber,
                    SeriesStartYear = normalized.StartYear,
                    SeriesStartYearEvidence = normalized.SeriesStartYearEvidence,
                    IssuePublicationYear = normalized.IssuePublicationYear,
                    IssuePublicationDate = normalized.IssuePublicationDate,
                    IssuePublicationEvidence = normalized.IssuePublicationEvidence,
                    Publisher = normalized.Publisher,
                    VolumeId = normalized.VolumeId,
                    Type = candidate.Type ?? item.ItemType,
                    TypeVerified = candidate.TypeVerified,
                    RuntimeMinutes = candidate.RuntimeMinutes,
                    ProviderIds = new Dictionary<string, string>(candidate.ProviderIds, StringComparer.OrdinalIgnoreCase),
                    Source = candidate.ProviderName,
                    Score = score,
                    Confidence = match.IsRejected ? "rejected" : ConfidenceForScore(score),
                    HasHardConflict = match.HasHardConflict,
                    Rejected = match.IsRejected,
                    Reasons = reasons
                };
            })
            .OrderByDescending(candidate => candidate.Score)
            .ThenBy(candidate => candidate.HasHardConflict)
            .ThenBy(candidate => PtvReadingMetadataParser.NormalizeTitle(candidate.Name), StringComparer.Ordinal)
            .ThenBy(candidate => candidate.Source, StringComparer.OrdinalIgnoreCase)
            .Take(5)
            .ToList();

        result.Candidates.AddRange(ranked);
        var best = ranked.FirstOrDefault();
        if (best is null) return;
        result.ProviderScore = best.Score;
        ApplyRuntimeEvidence(item, result, best);
        ApplyMediaTypeEvidence(item, result, best);

        // Weak, possible, or rejected candidates are evidence of no reliable match;
        // they cannot lower/raise the item's identity score or become suggestions.
        if (!IsReliableCandidate(best))
        {
            return;
        }

        result.MatchConfidence = (int)Math.Round(
            (result.MatchConfidence * 0.65) + ((best.Score ?? result.MatchConfidence) * 0.35));
        var providerConflict = HasConflictingProviderId(item.ProviderIds, best.ProviderIds);
        if (providerConflict)
        {
            result.Signals.ProviderIdConflict = true;
            result.MatchConfidence = Math.Min(result.MatchConfidence, 49);
            result.Reasons.Add(new PtvMetadataQualityReason
            {
                Code = PtvMetadataQualityReasonCodes.ProviderIdConflict,
                Severity = "error",
                ScoreImpact = -35,
                Message = "A verified candidate conflicts with the current provider identifier."
            });
        }

        var suppliesMissingProviderIdentity = item.ProviderIds.Count == 0 && best.ProviderIds.Count > 0;
        if (!SameReadingIdentity(item, best) || providerConflict || suppliesMissingProviderIdentity)
        {
            result.SuggestedMatch = ToMatchSummary(best);
            result.Reasons.Add(new PtvMetadataQualityReason
            {
                Code = PtvMetadataQualityReasonCodes.BetterProviderCandidate,
                Severity = "warning",
                Message = "A verified provider candidate matches the comic identity evidence more closely."
            });
        }

        if (hasHardConflict) result.MatchConfidence = Math.Min(result.MatchConfidence, 49);
    }

    private static PtvNormalizedMetadataCandidate ToReadingCandidate(
        PtvMetadataMatchSummary candidate,
        PtvStructuredMetadataQuery query,
        out bool seriesFromSearchContext)
    {
        seriesFromSearchContext = string.IsNullOrWhiteSpace(candidate.SeriesTitle)
            && !string.IsNullOrWhiteSpace(candidate.NormalizedIssueNumber)
            && !string.IsNullOrWhiteSpace(query.SeriesTitle);
        var providerId = candidate.ProviderIds.FirstOrDefault(pair => !string.IsNullOrWhiteSpace(pair.Value));
        return new PtvNormalizedMetadataCandidate
        {
            Provider = candidate.ProviderName ?? providerId.Key ?? string.Empty,
            ProviderId = providerId.Value ?? string.Empty,
            MediaClass = candidate.MediaClass != PtvReadingMediaClass.Unknown
                ? candidate.MediaClass
                : InferReadingMediaClass(candidate.ProviderName),
            EditionKind = candidate.EditionKind,
            EditionKindEvidence = candidate.EditionKindEvidence,
            Title = candidate.Name,
            SeriesTitle = seriesFromSearchContext ? query.SeriesTitle : candidate.SeriesTitle,
            SeriesTitleEvidence = seriesFromSearchContext
                ? PtvReadingIdentityEvidenceSource.Unknown
                : candidate.SeriesTitleEvidence,
            IssueNumber = candidate.NormalizedIssueNumber,
            IssueNumberEvidence = candidate.IssueNumberEvidence,
            VolumeNumber = candidate.VolumeNumber,
            Year = candidate.IssuePublicationYear ?? candidate.ProductionYear,
            StartYear = candidate.SeriesStartYear,
            SeriesStartYearEvidence = candidate.SeriesStartYearEvidence,
            IssuePublicationYear = candidate.IssuePublicationYear ?? candidate.ProductionYear,
            IssuePublicationDate = candidate.IssuePublicationDate,
            IssuePublicationEvidence = candidate.IssuePublicationEvidence,
            VolumeId = candidate.VolumeId,
            Publisher = candidate.Publisher,
            ExternalIds = new Dictionary<string, string>(candidate.ProviderIds, StringComparer.OrdinalIgnoreCase)
        };
    }

    private static PtvReadingMediaClass InferReadingMediaClass(string? providerName)
    {
        if (Contains(providerName, "comic")) return PtvReadingMediaClass.Comic;
        if (Contains(providerName, "manga") || Contains(providerName, "anilist")) return PtvReadingMediaClass.Manga;
        if (Contains(providerName, "book")) return PtvReadingMediaClass.Book;
        return PtvReadingMediaClass.Unknown;
    }

    private static PtvMetadataQualityReason ToQualityReason(PtvReadingMatchScoreReason reason) => new()
    {
        Code = reason.Code,
        Severity = reason.Impact <= -25 ? "error" : reason.Impact < 0 ? "warning" : "info",
        ScoreImpact = reason.Impact,
        Message = reason.Message,
        Evidence = reason.Evidence
    };

    private static string ConfidenceForScore(int score) => score switch
    {
        >= 90 => "excellent",
        >= 75 => "strong",
        >= 55 => "possible",
        _ => "weak"
    };

    private static bool IsReliableCandidate(PtvMetadataQualityCandidate candidate) =>
        !candidate.Rejected
        && !candidate.HasHardConflict
        && candidate.Score >= 75
        && candidate.Confidence is "strong" or "excellent";

    private static bool SameReadingIdentity(
        PtvMetadataQualityAnalysisItem item,
        PtvMetadataQualityCandidate candidate)
    {
        var issueMatches = string.IsNullOrWhiteSpace(item.NormalizedIssueNumber)
            || string.Equals(
                PtvReadingMetadataParser.NormalizeNumber(item.NormalizedIssueNumber, allowRomanNumeral: true),
                PtvReadingMetadataParser.NormalizeNumber(candidate.NormalizedIssueNumber, allowRomanNumeral: true),
                StringComparison.Ordinal);
        var seriesMatches = string.IsNullOrWhiteSpace(item.SeriesTitle)
            || string.IsNullOrWhiteSpace(candidate.SeriesTitle)
            || string.Equals(
                PtvReadingMetadataParser.NormalizeTitle(item.SeriesTitle),
                PtvReadingMetadataParser.NormalizeTitle(candidate.SeriesTitle),
                StringComparison.Ordinal);
        var runMatches = !item.SeriesStartYear.HasValue
            || !candidate.SeriesStartYear.HasValue
            || item.SeriesStartYear == candidate.SeriesStartYear;
        return issueMatches && seriesMatches && runMatches;
    }

    private static void ApplyAiResult(
        PtvMetadataQualityResult result,
        PtvMetadataAiAnalysisResult ai,
        bool hardConflict,
        IReadOnlyList<PtvMetadataQualityCandidate> eligibleCandidates,
        bool enforceReliableCandidate)
    {
        if (!ai.Reviewed || !ai.Confidence.HasValue) return;
        result.AiReviewed = true;
        result.AiScore = Math.Clamp(ai.Confidence.Value, 0, 100);
        result.AiProvider = ai.Provider;
        result.AiModel = ai.Model;
        result.AiPromptVersion = ai.PromptVersion;
        result.MatchConfidence = (int)Math.Round((result.MatchConfidence * 0.85) + (result.AiScore.Value * 0.15));
        if (hardConflict) result.MatchConfidence = Math.Min(result.MatchConfidence, 49);

        if (ai.SuggestedCandidateIndex is int index
            && index >= 0
            && index < eligibleCandidates.Count
            && (!enforceReliableCandidate || IsReliableCandidate(eligibleCandidates[index])))
        {
            result.SuggestedMatch = ToMatchSummary(eligibleCandidates[index]);
        }

        if (!string.IsNullOrWhiteSpace(ai.Summary))
        {
            result.Reasons.Add(new PtvMetadataQualityReason
            {
                Code = ai.ReasonCodes.Contains(PtvMetadataQualityReasonCodes.AiAmbiguous, StringComparer.Ordinal)
                    ? PtvMetadataQualityReasonCodes.AiAmbiguous
                    : ai.ReasonCodes.FirstOrDefault(IsKnownReasonCode) ?? PtvMetadataQualityReasonCodes.AiAmbiguous,
                Severity = "info",
                Message = ai.Summary.Length <= 400 ? ai.Summary : ai.Summary[..400]
            });
        }
    }

    private static bool ShouldSuppressFurtherAiAttemptsForRun(string errorCode) => errorCode switch
    {
        // Clear configuration/authorization failures are systemic for the entire scan.
        PtvMetadataAiErrorCodes.MissingCredential
            or PtvMetadataAiErrorCodes.InvalidCredential
            or PtvMetadataAiErrorCodes.PermissionDenied
            or PtvMetadataAiErrorCodes.ModelUnavailable
            or PtvMetadataAiErrorCodes.InvalidModel
            or PtvMetadataAiErrorCodes.QuotaUnavailable => true,

        // A scan never retries transient failures. Suppressing the remaining sequential
        // attempts prevents rate-limit storms and repeated 30-second outage timeouts.
        PtvMetadataAiErrorCodes.RateLimited
            or PtvMetadataAiErrorCodes.Timeout
            or PtvMetadataAiErrorCodes.ApiUnavailable => true,

        // Contract failures are model/adapter-wide until a later scan can retry safely.
        PtvMetadataAiErrorCodes.MalformedResponse
            or PtvMetadataAiErrorCodes.ResponseTooLarge
            or PtvMetadataAiErrorCodes.UnknownFailure => true,
        _ => false
    };

    private static void OpenAiCircuit(
        PtvMetadataQualityScanRun run,
        PtvMetadataAiRunState state,
        string errorCode)
    {
        state.CircuitOpen = true;
        state.ErrorCode = errorCode;
        run.AiErrorCode = errorCode;
    }

    private async Task MarkRunStartedAsync(PtvMetadataQualityScanRun run, CancellationToken cancellationToken)
    {
        await UpdateDocumentAsync(document =>
        {
            MarkPersistedRunningScansInterrupted(document);
            document.ScanRuns.Add(run);
            return document;
        }, cancellationToken).ConfigureAwait(false);
    }

    private async Task PersistBatchAsync(
        PtvMetadataQualityScanRun run,
        IReadOnlyDictionary<string, PtvMetadataQualityResult> results,
        CancellationToken cancellationToken)
    {
        await UpdateDocumentAsync(document =>
        {
            foreach (var pair in results)
            {
                // A review action can be recorded while provider or AI analysis is
                // still in flight. Merge the latest durable review state at the
                // serialization boundary so the scanner cannot overwrite a
                // same-fingerprint Keep Current or Dismiss decision.
                document.ItemResults.TryGetValue(pair.Key, out var current);
                ApplyResolutionHistory(pair.Value, current, pair.Value.ScanFingerprint);
                document.ItemResults[pair.Key] = pair.Value;
            }

            ReplaceRun(document, run);
            return document;
        }, cancellationToken).ConfigureAwait(false);
    }

    private async Task CompleteRunAsync(
        PtvMetadataQualityScanRun run,
        IReadOnlySet<Guid> seenItemIds,
        IReadOnlySet<Guid> scannedLibraryIds,
        IReadOnlySet<Guid> availableLibraryIds,
        IReadOnlySet<Guid> removedRequestedLibraryIds,
        bool scanAllLibraries,
        CancellationToken cancellationToken)
    {
        run.State = PtvMetadataQualityScanStates.Completed;
        run.CompletedAt = DateTimeOffset.UtcNow;
        run.ProgressPercent = 100;
        await UpdateDocumentAsync(document =>
        {
            foreach (var staleKey in document.ItemResults
                .Where(pair => pair.Value.LibraryId.HasValue
                    && ((scannedLibraryIds.Contains(pair.Value.LibraryId.Value)
                            && !seenItemIds.Contains(pair.Value.ItemId))
                        || removedRequestedLibraryIds.Contains(pair.Value.LibraryId.Value)
                        || (scanAllLibraries && !availableLibraryIds.Contains(pair.Value.LibraryId.Value))))
                .Select(pair => pair.Key)
                .ToList())
            {
                document.ItemResults.Remove(staleKey);
            }

            if (run.Mode == "full") document.LastFullScan = run.CompletedAt;
            else document.LastIncrementalScan = run.CompletedAt;
            ReplaceRun(document, run);
            return document;
        }, cancellationToken).ConfigureAwait(false);
    }

    private async Task PersistTerminalRunBestEffortAsync(PtvMetadataQualityScanRun run)
    {
        try
        {
            await UpdateDocumentAsync(document =>
            {
                ReplaceRun(document, run);
                return document;
            }, CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV Metadata Quality could not persist terminal scan state.");
        }
    }

    private PtvMetadataQualityScanRun BeginRun(string mode, CancellationToken externalCancellation = default)
    {
        lock (_stateGate)
        {
            if (_activeRun is not null)
            {
                throw new PtvMetadataQualityServiceException("PTV_METADATA_QUALITY_SCAN_RUNNING", "A Metadata Quality scan is already running.");
            }

            _activeCancellation = externalCancellation.CanBeCanceled
                ? CancellationTokenSource.CreateLinkedTokenSource(externalCancellation)
                : new CancellationTokenSource();
            _activeRun = new PtvMetadataQualityScanRun
            {
                RunId = Guid.NewGuid(),
                Mode = mode,
                State = PtvMetadataQualityScanStates.Running,
                StartedAt = DateTimeOffset.UtcNow
            };
            return _activeRun;
        }
    }

    private void EndRun(Guid runId)
    {
        lock (_stateGate)
        {
            if (_activeRun?.RunId != runId) return;
            _activeCancellation?.Dispose();
            _activeCancellation = null;
            _activeRun = null;
        }
    }

    private CancellationTokenSource? GetActiveCancellation()
    {
        lock (_stateGate) return _activeCancellation;
    }

    private PtvMetadataQualityScanRun? GetActiveRun()
    {
        lock (_stateGate) return _activeRun is null ? null : CloneRun(_activeRun);
    }

    private List<PtvMetadataQualityLibrarySummary> GetLibrariesSafe()
    {
        try
        {
            return GetLibrariesRequired();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PiggieTV Metadata Quality could not enumerate library summaries.");
            return [];
        }
    }

    private List<PtvMetadataQualityLibrarySummary> GetLibrariesRequired() => _getLibraries();

    private async Task<PtvMetadataQualitySummarySnapshot> GetSummarySnapshotAsync(
        CancellationToken cancellationToken,
        PtvMetadataQualityRequestDiagnostics? diagnostics = null)
    {
        while (true)
        {
            var cacheLookupStarted = Stopwatch.GetTimestamp();
            var requestedRevision = Volatile.Read(ref _summaryRevision);
            lock (_summaryCacheGate)
            {
                if (_summarySnapshot is not null && _summarySnapshotRevision == requestedRevision)
                {
                    AddStage(diagnostics, "summaryCacheLookup", ElapsedMilliseconds(cacheLookupStarted));
                    SetCacheStateIfUnknown(diagnostics, "summary-hit");
                    IncrementOperation(diagnostics, "summaryCacheHits");
                    return _summarySnapshot;
                }
            }
            AddStage(diagnostics, "summaryCacheLookup", ElapsedMilliseconds(cacheLookupStarted));

            var gateStarted = Stopwatch.GetTimestamp();
            await _summaryLoadGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            AddStage(diagnostics, "summaryGateWait", ElapsedMilliseconds(gateStarted));
            try
            {
                cacheLookupStarted = Stopwatch.GetTimestamp();
                requestedRevision = Volatile.Read(ref _summaryRevision);
                lock (_summaryCacheGate)
                {
                    if (_summarySnapshot is not null && _summarySnapshotRevision == requestedRevision)
                    {
                        AddStage(diagnostics, "summaryCacheLookup", ElapsedMilliseconds(cacheLookupStarted));
                        SetCacheStateIfUnknown(diagnostics, "summary-shared");
                        IncrementOperation(diagnostics, "summaryCacheHits");
                        return _summarySnapshot;
                    }
                }
                AddStage(diagnostics, "summaryCacheLookup", ElapsedMilliseconds(cacheLookupStarted));
                IncrementOperation(diagnostics, "summaryCacheMisses");

                var document = await ReadDocumentWithInterruptedRunProjectionAsync(cancellationToken, diagnostics).ConfigureAwait(false);
                var aggregateStarted = Stopwatch.GetTimestamp();
                var snapshot = CreateSummarySnapshot(document);
                AddStage(diagnostics, "summaryAggregation", ElapsedMilliseconds(aggregateStarted));
                IncrementOperation(diagnostics, "summaryResultsTraversed", document.ItemResults.Count);
                lock (_summaryCacheGate)
                {
                    if (requestedRevision == Volatile.Read(ref _summaryRevision))
                    {
                        _summarySnapshot = snapshot;
                        _summarySnapshotRevision = requestedRevision;
                        return snapshot;
                    }
                }
            }
            finally
            {
                _summaryLoadGate.Release();
            }
        }
    }

    private async Task<PtvMetadataQualityDocument> UpdateDocumentAsync(
        Func<PtvMetadataQualityDocument, PtvMetadataQualityDocument> update,
        CancellationToken cancellationToken)
    {
        var document = await _store.UpdateAsync(update, cancellationToken).ConfigureAwait(false);
        var documentRevision = Interlocked.Increment(ref _documentRevision);
        lock (_documentCacheGate)
        {
            // The store returns an isolated, normalized document. Seed the read
            // snapshot directly so the UI never has to deserialize the same
            // large result file again immediately after a scan batch or review.
            _documentSnapshot = document;
            _documentSnapshotRevision = documentRevision;
        }

        Interlocked.Increment(ref _summaryRevision);
        lock (_summaryCacheGate)
        {
            _summarySnapshot = null;
            _summarySnapshotRevision = -1;
        }

        return document;
    }

    private async Task<PtvMetadataQualityDocument> GetDocumentSnapshotAsync(
        CancellationToken cancellationToken,
        PtvMetadataQualityRequestDiagnostics? diagnostics = null)
    {
        while (true)
        {
            var cacheLookupStarted = Stopwatch.GetTimestamp();
            var requestedRevision = Volatile.Read(ref _documentRevision);
            lock (_documentCacheGate)
            {
                if (_documentSnapshot is not null && _documentSnapshotRevision == requestedRevision)
                {
                    AddStage(diagnostics, "documentCacheLookup", ElapsedMilliseconds(cacheLookupStarted));
                    SetCacheStateIfUnknown(diagnostics, "document-hit");
                    IncrementOperation(diagnostics, "documentCacheHits");
                    return _documentSnapshot;
                }
            }
            AddStage(diagnostics, "documentCacheLookup", ElapsedMilliseconds(cacheLookupStarted));

            var operation = GetOrStartDocumentLoad(requestedRevision);
            var gateStarted = Stopwatch.GetTimestamp();
            var outcome = await operation.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
            AddStage(diagnostics, "documentGateWait", ElapsedMilliseconds(gateStarted));
            if (operation.TryClaimDiagnostics())
            {
                SetCacheStateIfUnknown(diagnostics, "miss");
                MergeStoreDiagnostics(diagnostics, outcome.Diagnostics);
            }
            else
            {
                SetCacheStateIfUnknown(diagnostics, "document-shared");
                IncrementOperation(diagnostics, "documentCacheHits");
            }

            // The service-owned operation populates the cache only when its
            // source revision is still current. Loop to recheck after a
            // concurrent mutation without allowing any HTTP caller to own or
            // cancel the shared physical read.
        }
    }

    private DocumentLoadOperation GetOrStartDocumentLoad(long requestedRevision)
    {
        lock (_documentLoadOperationGate)
        {
            if (_documentLoadOperation is not null)
            {
                return _documentLoadOperation;
            }

            var operation = new DocumentLoadOperation();
            _documentLoadOperation = operation;
            operation.Task = LoadAndCacheDocumentAsync(requestedRevision);
            _ = operation.Task.ContinueWith(
                _ => ClearDocumentLoadOperation(operation),
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
            return operation;
        }
    }

    private async Task<DocumentLoadOutcome> LoadAndCacheDocumentAsync(long requestedRevision)
    {
        using var timeout = new CancellationTokenSource(DocumentLoadTimeout);
        PtvMetadataQualityStoreReadResult read;
        if (_store is IPtvMetadataQualityDiagnosticStore diagnosticStore)
        {
            read = await diagnosticStore.ReadWithDiagnosticsAsync(timeout.Token).ConfigureAwait(false);
        }
        else
        {
            var storeStarted = Stopwatch.GetTimestamp();
            var document = await _store.ReadAsync(timeout.Token).ConfigureAwait(false);
            read = new PtvMetadataQualityStoreReadResult(
                document,
                new PtvMetadataQualityStoreReadDiagnostics
                {
                    PersistedResults = document.ItemResults.Count,
                    TotalMs = ElapsedMilliseconds(storeStarted),
                    Stages = new Dictionary<string, double>(StringComparer.Ordinal)
                    {
                        ["storeRead"] = ElapsedMilliseconds(storeStarted)
                    },
                    Operations = new Dictionary<string, long>(StringComparer.Ordinal)
                    {
                        ["storeReads"] = 1,
                        ["metadataWrites"] = 0
                    }
                });
        }

        lock (_documentCacheGate)
        {
            if (requestedRevision == Volatile.Read(ref _documentRevision))
            {
                _documentSnapshot = read.Document;
                _documentSnapshotRevision = requestedRevision;
            }
        }

        return new DocumentLoadOutcome(read.Diagnostics);
    }

    private void ClearDocumentLoadOperation(DocumentLoadOperation operation)
    {
        lock (_documentLoadOperationGate)
        {
            if (ReferenceEquals(_documentLoadOperation, operation))
            {
                _documentLoadOperation = null;
            }
        }
    }

    private async Task<PtvMetadataQualityDocument> ReadDocumentWithInterruptedRunProjectionAsync(
        CancellationToken cancellationToken,
        PtvMetadataQualityRequestDiagnostics? diagnostics = null)
    {
        var document = await GetDocumentSnapshotAsync(cancellationToken, diagnostics).ConfigureAwait(false);
        if (GetActiveRun() is not null
            || !document.ScanRuns.Any(run => run.State == PtvMetadataQualityScanStates.Running))
        {
            return document;
        }

        // A GET must remain observational. Project stale durable "running"
        // records as interrupted for presentation, but persist that recovery
        // only when an explicit scan start next updates the store.
        var projectionStarted = Stopwatch.GetTimestamp();
        var projection = new PtvMetadataQualityDocument
        {
            SchemaVersion = document.SchemaVersion,
            ScannerVersion = document.ScannerVersion,
            RuleVersion = document.RuleVersion,
            UpdatedAt = document.UpdatedAt,
            LastFullScan = document.LastFullScan,
            LastIncrementalScan = document.LastIncrementalScan,
            ItemResults = new Dictionary<string, PtvMetadataQualityResult>(document.ItemResults, StringComparer.OrdinalIgnoreCase),
            ScanRuns = document.ScanRuns.Select(CloneRun).ToList()
        };
        MarkPersistedRunningScansInterrupted(projection);
        AddStage(diagnostics, "interruptedRunProjection", ElapsedMilliseconds(projectionStarted));
        IncrementOperation(diagnostics, "interruptedRunProjections");
        return projection;
    }

    private static void MarkPersistedRunningScansInterrupted(PtvMetadataQualityDocument document)
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var previous in document.ScanRuns.Where(candidate => candidate.State == PtvMetadataQualityScanStates.Running))
        {
            previous.State = PtvMetadataQualityScanStates.Interrupted;
            previous.CompletedAt = now;
            previous.ErrorCode ??= "PTV_METADATA_QUALITY_SCAN_INTERRUPTED";
        }
    }

    private static List<PtvMetadataQualityLibrarySummary> CreateLibrarySummaries(ILibraryManager libraryManager) => libraryManager.GetVirtualFolders()
            .Select(folder => Guid.TryParse(folder.ItemId, out var id) && id != Guid.Empty
                ? new PtvMetadataQualityLibrarySummary { Id = id, Name = folder.Name ?? "Unnamed library" }
                : null)
            .Where(library => library is not null)
            .Cast<PtvMetadataQualityLibrarySummary>()
            .ToList();

    private PtvMetadataQualityAnalysisItem CreateAnalysisItem(BaseItem item, Guid libraryId, string libraryName)
    {
        var path = item.Path;
        var fileName = SafeFileName(path);
        var folderName = SafeFolderName(path, item.ContainingFolderPath);
        var episode = item as Episode;
        var analysis = new PtvMetadataQualityAnalysisItem
        {
            ItemId = item.Id,
            LibraryId = libraryId,
            LibraryName = libraryName,
            ItemType = NormalizeItemType(item.GetType().Name),
            Name = item.Name ?? string.Empty,
            OriginalTitle = item.OriginalTitle,
            FileName = fileName,
            FolderName = folderName,
            ProductionYear = item.ProductionYear,
            RunTimeTicks = item.RunTimeTicks,
            IndexNumber = item.IndexNumber,
            IndexNumberEnd = episode?.IndexNumberEnd,
            ParentIndexNumber = item.ParentIndexNumber,
            SeriesName = episode?.SeriesName,
            IsSpecial = item.ParentIndexNumber == 0 || ContainsSpecialLabel(fileName) || ContainsSpecialLabel(folderName),
            HasPrimaryImage = item.HasImage(ImageType.Primary, 0),
            HasBackdropImage = item.HasImage(ImageType.Backdrop, 0),
            HasOverview = !string.IsNullOrWhiteSpace(item.Overview),
            DateModified = new DateTimeOffset(item.DateModified.ToUniversalTime()),
            ProviderIds = new Dictionary<string, string>(item.ProviderIds, StringComparer.OrdinalIgnoreCase)
        };

        if (!IsReadingQualityItem(analysis))
        {
            return analysis;
        }

        var parsed = _readingParser.Parse(fileName ?? analysis.Name, new PtvMetadataSearchContext
        {
            ItemId = item.Id.ToString("N"),
            LibraryId = libraryId.ToString("N"),
            ItemType = analysis.ItemType,
            LibraryType = libraryName,
            FileName = fileName,
            FolderName = folderName,
            ExistingTitle = analysis.Name,
            ExistingOriginalTitle = analysis.OriginalTitle,
            ProductionYear = analysis.ProductionYear,
            PremiereDate = item.PremiereDate,
            ExistingProviderIds = new Dictionary<string, string>(analysis.ProviderIds, StringComparer.OrdinalIgnoreCase)
        });
        analysis.SeriesTitle = parsed.SeriesTitle;
        analysis.SeriesTitleEvidence = parsed.SeriesTitleEvidence;
        analysis.NormalizedIssueNumber = parsed.IssueNumber;
        analysis.IssueNumberEvidence = parsed.IssueNumberEvidence;
        analysis.SeriesStartYear = parsed.SeriesStartYear;
        analysis.SeriesStartYearEvidence = parsed.SeriesStartYearEvidence;
        analysis.IssuePublicationYear = parsed.IssuePublicationYear;
        analysis.IssuePublicationDate = parsed.IssuePublicationDate;
        analysis.IssuePublicationEvidence = parsed.IssuePublicationEvidence;
        analysis.Publisher = item.Studios?.FirstOrDefault();
        analysis.VolumeNumber = parsed.VolumeNumber;
        analysis.VolumeId = null;
        analysis.FolderCorroboratesSeriesTitle = parsed.FolderCorroboratesSeriesTitle;
        analysis.FolderCorroboratesSeriesStartYear = parsed.FolderCorroboratesSeriesStartYear;
        analysis.IdentityConflicts = parsed.IdentityConflicts;
        analysis.ReadingMediaClass = parsed.MediaClass;
        analysis.ReadingEditionKind = parsed.EditionKind;
        analysis.ReadingEditionKindEvidence = parsed.EditionKindEvidence;
        return analysis;
    }

    private static bool IsReadingQualityItem(PtvMetadataQualityAnalysisItem item) =>
        string.Equals(item.ItemType, "Book", StringComparison.Ordinal);

    private static PtvStructuredMetadataQuery CreateReadingQuery(PtvMetadataQualityAnalysisItem item) => new()
    {
        RawTitle = item.Name,
        RawFileName = item.FileName ?? item.Name,
        CleanedTitle = item.SeriesTitle ?? item.Name,
        SeriesTitle = item.SeriesTitle,
        SeriesTitleEvidence = item.SeriesTitleEvidence,
        IssueNumber = item.NormalizedIssueNumber,
        IssueNumberEvidence = item.IssueNumberEvidence,
        VolumeNumber = item.VolumeNumber,
        Year = item.ReadingMediaClass == PtvReadingMediaClass.Comic
            ? item.SeriesStartYear
            : item.ProductionYear,
        SeriesStartYear = item.SeriesStartYear,
        SeriesStartYearEvidence = item.SeriesStartYearEvidence,
        IssuePublicationYear = item.IssuePublicationYear,
        IssuePublicationDate = item.IssuePublicationDate,
        IssuePublicationEvidence = item.IssuePublicationEvidence,
        FolderCorroboratesSeriesTitle = item.FolderCorroboratesSeriesTitle,
        FolderCorroboratesSeriesStartYear = item.FolderCorroboratesSeriesStartYear,
        IdentityConflicts = item.IdentityConflicts.ToList(),
        MediaClass = item.ReadingMediaClass,
        EditionKind = item.ReadingEditionKind,
        EditionKindEvidence = item.ReadingEditionKindEvidence,
        ExistingProviderIds = new Dictionary<string, string>(item.ProviderIds, StringComparer.OrdinalIgnoreCase),
        AlternateTitles = new[] { item.Name, item.OriginalTitle }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList(),
        Classification = new PtvReadingMediaClassification
        {
            MediaClass = item.ReadingMediaClass,
            Confidence = item.ReadingMediaClass == PtvReadingMediaClass.Unknown ? 0 : 1
        }
    };

    private PtvMetadataQualityResult CreateUnavailableResult(BaseItem item, Guid libraryId, string libraryName)
    {
        var analysis = CreateAnalysisItem(item, libraryId, libraryName);
        return new PtvMetadataQualityResult
        {
            ItemId = item.Id,
            LibraryId = libraryId,
            LibraryName = libraryName,
            ItemType = analysis.ItemType,
            Title = item.Name ?? "Unavailable item",
            FileName = analysis.FileName,
            FolderName = analysis.FolderName,
            ScanFingerprint = PtvMetadataQualityFingerprint.Create(analysis),
            ScannedAt = DateTimeOffset.UtcNow,
            Status = PtvMetadataQualityStatuses.Unavailable,
            MatchConfidence = 0,
            CompletenessScore = 0,
            Reasons =
            [
                new PtvMetadataQualityReason
                {
                    Code = PtvMetadataQualityReasonCodes.ItemAnalysisFailed,
                    Severity = "error",
                    Message = "This item could not be analyzed safely."
                }
            ]
        };
    }

    internal static int ScoreCandidate(PtvMetadataQualityAnalysisItem item, PtvMetadataMatchSummary candidate)
    {
        var pathSimilarity = Math.Max(
            PtvMetadataQualityRuleEngine.Similarity(item.FileName, candidate.Name),
            PtvMetadataQualityRuleEngine.Similarity(item.FolderName, candidate.Name));
        var score = (int)Math.Round(pathSimilarity * 65);
        var evidenceYear = PtvMetadataQualityRuleEngine.ExtractYear(item.FileName)
            ?? PtvMetadataQualityRuleEngine.ExtractYear(item.FolderName)
            ?? item.ProductionYear;
        if (evidenceYear.HasValue && candidate.ProductionYear.HasValue)
        {
            var difference = Math.Abs(evidenceYear.Value - candidate.ProductionYear.Value);
            score += difference switch { 0 => 25, 1 => 18, 2 => 8, _ => 0 };
        }

        if (SharesProviderId(item.ProviderIds, candidate.ProviderIds)) score += 10;
        if (TryGetRuntimeDifferencePercent(item, candidate.RuntimeMinutes, out var runtimeDifference))
        {
            score += runtimeDifference switch
            {
                <= 10 => 10,
                <= 25 => 5,
                > 75 => -25,
                > 50 => -10,
                _ => 0
            };
        }

        if (TryGetVerifiedTypePair(item.ItemType, candidate.Type, candidate.TypeVerified, out var currentType, out var candidateType))
        {
            score += string.Equals(currentType, candidateType, StringComparison.Ordinal) ? 5 : -30;
        }

        return Math.Clamp(score, 0, 100);
    }

    private static void ApplyRuntimeEvidence(
        PtvMetadataQualityAnalysisItem item,
        PtvMetadataQualityResult result,
        PtvMetadataQualityCandidate candidate)
    {
        if (!TryGetRuntimeDifferencePercent(item, candidate.RuntimeMinutes, out var difference)) return;
        result.Signals.RuntimeDifferencePercent = Math.Round(difference, 1);
        if (difference <= 50) return;

        var extreme = difference > 75;
        if (extreme) result.MatchConfidence = Math.Min(result.MatchConfidence, 49);
        result.Reasons.Add(new PtvMetadataQualityReason
        {
            Code = PtvMetadataQualityReasonCodes.RuntimeMismatch,
            Severity = extreme ? "error" : "warning",
            ScoreImpact = extreme ? -25 : -10,
            Message = extreme
                ? "The verified candidate runtime differs drastically from this media item."
                : "The verified candidate runtime differs substantially from this media item.",
            Evidence = $"{Math.Round(TimeSpan.FromTicks(item.RunTimeTicks!.Value).TotalMinutes)} min vs {Math.Round(candidate.RuntimeMinutes!.Value)} min"
        });
    }

    private static void ApplyMediaTypeEvidence(
        PtvMetadataQualityAnalysisItem item,
        PtvMetadataQualityResult result,
        PtvMetadataQualityCandidate candidate)
    {
        if (!TryGetVerifiedTypePair(item.ItemType, candidate.Type, candidate.TypeVerified, out var currentType, out var candidateType)
            || string.Equals(currentType, candidateType, StringComparison.Ordinal))
        {
            return;
        }

        result.Signals.ItemTypeConflict = true;
        result.MatchConfidence = Math.Min(result.MatchConfidence, 49);
        result.Reasons.Add(new PtvMetadataQualityReason
        {
            Code = PtvMetadataQualityReasonCodes.MediaTypeConflict,
            Severity = "error",
            ScoreImpact = -30,
            Message = "The verified provider candidate is a different media type."
        });
    }

    private static void ApplyDuplicateProviderRule(PtvMetadataQualityResult result, IDictionary<string, Guid> providerIds)
    {
        foreach (var pair in result.CurrentMatch?.ProviderIds ?? [])
        {
            if (string.IsNullOrWhiteSpace(pair.Key) || string.IsNullOrWhiteSpace(pair.Value)) continue;
            var key = $"{pair.Key.Trim().ToUpperInvariant()}:{pair.Value.Trim()}";
            if (providerIds.TryGetValue(key, out var otherItemId) && otherItemId != result.ItemId)
            {
                result.MatchConfidence = Math.Min(result.MatchConfidence, 69);
                result.Reasons.Add(new PtvMetadataQualityReason
                {
                    Code = PtvMetadataQualityReasonCodes.DuplicateProviderId,
                    Severity = "warning",
                    ScoreImpact = -15,
                    Message = "The same provider identifier appears on another item."
                });
            }
            else
            {
                providerIds[key] = result.ItemId;
            }
        }
    }

    private static void ApplyResolutionHistory(
        PtvMetadataQualityResult result,
        PtvMetadataQualityResult? previous,
        string fingerprint)
    {
        if (previous is null) return;
        if (string.Equals(previous.ScanFingerprint, fingerprint, StringComparison.Ordinal))
        {
            var currentReasonSignature = CreateReasonSignature(result.Reasons);
            var dismissalStillMatches = previous.Dismissed
                && string.Equals(previous.DismissedFingerprint, fingerprint, StringComparison.Ordinal)
                && string.Equals(previous.DismissedReasonSignature, currentReasonSignature, StringComparison.Ordinal);
            result.Dismissed = dismissalStillMatches;
            result.DismissedAt = dismissalStillMatches ? previous.DismissedAt : null;
            result.DismissedFingerprint = dismissalStillMatches ? previous.DismissedFingerprint : null;
            result.DismissedReasonSignature = dismissalStillMatches ? previous.DismissedReasonSignature : null;
            result.Resolution = previous.Resolution?.State == "dismissed" && !dismissalStillMatches
                ? null
                : previous.Resolution;
            return;
        }

        if (previous.Status is PtvMetadataQualityStatuses.Review or PtvMetadataQualityStatuses.LikelyWrong or PtvMetadataQualityStatuses.Incomplete
            && result.Status == PtvMetadataQualityStatuses.Healthy)
        {
            result.Resolution = new PtvMetadataQualityResolution
            {
                State = "corrected",
                ResolvedAt = DateTimeOffset.UtcNow,
                Fingerprint = fingerprint,
                PreviousStatus = previous.Status
            };
        }
    }

    private static PtvMetadataQualitySummarySnapshot CreateSummarySnapshot(
        PtvMetadataQualityDocument document)
    {
        var counts = new PtvMetadataQualityCounts { TotalScanned = document.ItemResults.Count };
        foreach (var result in document.ItemResults.Values)
        {
            switch (GetDisplayStatus(result))
            {
                case PtvMetadataQualityStatuses.Healthy: counts.Healthy++; break;
                case PtvMetadataQualityStatuses.Review: counts.NeedsReview++; break;
                case PtvMetadataQualityStatuses.LikelyWrong: counts.LikelyIncorrect++; break;
                case PtvMetadataQualityStatuses.Incomplete: counts.Incomplete++; break;
                case PtvMetadataQualityStatuses.Unavailable: counts.Unavailable++; break;
                case "dismissed": counts.Dismissed++; break;
                case "resolved": counts.Resolved++; break;
            }
        }

        var latest = document.ScanRuns.OrderByDescending(run => run.StartedAt).FirstOrDefault();
        return new PtvMetadataQualitySummarySnapshot(
            counts,
            Max(document.LastFullScan, document.LastIncrementalScan),
            document.RuleVersion,
            document.ScannerVersion,
            latest is null ? null : CloneRun(latest));
    }

    private static PtvMetadataQualityRequestDiagnostics CreateReadDiagnostics() => new()
    {
        Stages = new Dictionary<string, double>(StringComparer.Ordinal)
        {
            ["authorization"] = 0,
            ["summaryCacheLookup"] = 0,
            ["summaryGateWait"] = 0,
            ["documentCacheLookup"] = 0,
            ["documentGateWait"] = 0,
            ["storeGateWait"] = 0,
            ["fileOpen"] = 0,
            ["jsonDeserialize"] = 0,
            ["documentNormalize"] = 0,
            ["isolationCloneSerialize"] = 0,
            ["isolationCloneDeserialize"] = 0,
            ["interruptedRunProjection"] = 0,
            ["jellyfinItemEnumeration"] = 0,
            ["metadataExtraction"] = 0,
            ["providerIdInspection"] = 0,
            ["localMetadataInspection"] = 0,
            ["readingClassification"] = 0,
            ["qualityScoring"] = 0,
            ["suggestionGeneration"] = 0,
            ["externalProviderCalls"] = 0,
            ["databaseCalls"] = 0,
            ["summaryAggregation"] = 0,
            ["resultFilterCount"] = 0,
            ["resultSortPageProjection"] = 0,
            ["libraryDiscovery"] = 0,
            ["responseBuild"] = 0
        },
        Operations = new Dictionary<string, long>(StringComparer.Ordinal)
        {
            ["storeReads"] = 0,
            ["storeFileReads"] = 0,
            ["fileBytesRead"] = 0,
            ["jsonDeserializations"] = 0,
            ["jsonSerializations"] = 0,
            ["jellyfinQueries"] = 0,
            ["databaseQueries"] = 0,
            ["providerRequests"] = 0,
            ["archiveReads"] = 0,
            ["sidecarReads"] = 0,
            ["metadataWrites"] = 0,
            ["itemsEvaluated"] = 0
        }
    };

    private static void MergeStoreDiagnostics(
        PtvMetadataQualityRequestDiagnostics? target,
        PtvMetadataQualityStoreReadDiagnostics source)
    {
        if (target is null) return;
        foreach (var stage in source.Stages) AddStage(target, stage.Key, stage.Value);
        foreach (var operation in source.Operations) IncrementOperation(target, operation.Key, operation.Value);
        IncrementOperation(target, "storeReads");
        IncrementOperation(target, "fileBytesRead", source.FileBytes);
        target.PersistedResultsLoaded = source.PersistedResults;
    }

    private static void SetStage(PtvMetadataQualityRequestDiagnostics? diagnostics, string name, double milliseconds)
    {
        if (diagnostics is not null) diagnostics.Stages[name] = milliseconds;
    }

    private static void AddStage(PtvMetadataQualityRequestDiagnostics? diagnostics, string name, double milliseconds)
    {
        if (diagnostics is null) return;
        diagnostics.Stages[name] = diagnostics.Stages.GetValueOrDefault(name) + milliseconds;
    }

    private static void IncrementOperation(
        PtvMetadataQualityRequestDiagnostics? diagnostics,
        string name,
        long amount = 1)
    {
        if (diagnostics is null) return;
        diagnostics.Operations[name] = diagnostics.Operations.GetValueOrDefault(name) + amount;
    }

    private static void SetCacheStateIfUnknown(PtvMetadataQualityRequestDiagnostics? diagnostics, string state)
    {
        if (diagnostics is not null && diagnostics.CacheState == "unknown") diagnostics.CacheState = state;
    }

    private static double ElapsedMilliseconds(long started) => Stopwatch.GetElapsedTime(started).TotalMilliseconds;

    private void LogColdRead(string endpoint, PtvMetadataQualityRequestDiagnostics diagnostics)
    {
        if (diagnostics.CacheState != "miss") return;
        _logger.LogInformation(
            "PiggieTV Metadata Quality cold {Endpoint} read completed. TotalMs={TotalMs:F1} PersistedResults={PersistedResults} FileBytes={FileBytes} DeserializeMs={DeserializeMs:F1} NormalizeMs={NormalizeMs:F1} CloneSerializeMs={CloneSerializeMs:F1} CloneDeserializeMs={CloneDeserializeMs:F1} ProviderRequests={ProviderRequests} ArchiveReads={ArchiveReads} MetadataWrites={MetadataWrites}.",
            endpoint,
            diagnostics.TotalMs,
            diagnostics.PersistedResultsLoaded,
            diagnostics.Operations.GetValueOrDefault("fileBytesRead"),
            diagnostics.Stages.GetValueOrDefault("jsonDeserialize"),
            diagnostics.Stages.GetValueOrDefault("documentNormalize"),
            diagnostics.Stages.GetValueOrDefault("isolationCloneSerialize"),
            diagnostics.Stages.GetValueOrDefault("isolationCloneDeserialize"),
            diagnostics.Operations.GetValueOrDefault("providerRequests"),
            diagnostics.Operations.GetValueOrDefault("archiveReads"),
            diagnostics.Operations.GetValueOrDefault("metadataWrites"));
    }

    private static PtvMetadataQualitySummaryResponse BuildSummary(
        PtvMetadataQualitySummarySnapshot snapshot,
        List<PtvMetadataQualityLibrarySummary> libraries,
        PtvMetadataQualityScanRun? activeRun)
    {
        var latest = activeRun ?? snapshot.LatestRun;
        return new PtvMetadataQualitySummaryResponse
        {
            Counts = new PtvMetadataQualityCounts
            {
                TotalScanned = snapshot.Counts.TotalScanned,
                Healthy = snapshot.Counts.Healthy,
                NeedsReview = snapshot.Counts.NeedsReview,
                LikelyIncorrect = snapshot.Counts.LikelyIncorrect,
                Incomplete = snapshot.Counts.Incomplete,
                Unavailable = snapshot.Counts.Unavailable,
                Dismissed = snapshot.Counts.Dismissed,
                Resolved = snapshot.Counts.Resolved
            },
            Libraries = libraries,
            LastScanAt = snapshot.LastScanAt,
            RuleVersion = snapshot.RuleVersion,
            ScannerVersion = snapshot.ScannerVersion,
            Scan = latest is null ? new PtvMetadataQualityScanProgress() : new PtvMetadataQualityScanProgress
            {
                RunId = latest.RunId,
                State = latest.State,
                Mode = latest.Mode,
                StartedAt = latest.StartedAt,
                CompletedAt = latest.CompletedAt,
                ProcessedCount = latest.ItemsConsidered,
                ItemCount = latest.ItemCount > 0 ? latest.ItemCount : null,
                ErrorMessage = latest.ErrorCode is null ? null : "The Metadata Quality scan did not finish."
            }
        };
    }

    private static string Classify(int matchConfidence, int completenessScore, PtvMetadataQualitySettings settings)
    {
        if (matchConfidence < settings.LikelyWrongThreshold) return PtvMetadataQualityStatuses.LikelyWrong;
        if (matchConfidence < settings.ReviewThreshold) return PtvMetadataQualityStatuses.Review;
        if (completenessScore < 100) return PtvMetadataQualityStatuses.Incomplete;
        return PtvMetadataQualityStatuses.Healthy;
    }

    private static string GetDisplayStatus(PtvMetadataQualityResult result)
    {
        if (result.Dismissed) return "dismissed";
        if (result.Resolution?.State is "kept_current" or "corrected") return "resolved";
        return result.Status;
    }

    private static IEnumerable<PtvMetadataQualityResult> ApplySort(IEnumerable<PtvMetadataQualityResult> results, string? sort) =>
        sort?.Trim().ToLowerInvariant() switch
        {
            "confidence" => results.OrderBy(result => result.MatchConfidence).ThenBy(result => result.Title, StringComparer.OrdinalIgnoreCase),
            "library" => results.OrderBy(result => result.LibraryName, StringComparer.OrdinalIgnoreCase).ThenBy(result => result.Title, StringComparer.OrdinalIgnoreCase),
            "recent" => results.OrderByDescending(result => result.ScannedAt),
            "title" => results.OrderBy(result => result.Title, StringComparer.OrdinalIgnoreCase),
            _ => results.OrderBy(result => StatusPriority(GetDisplayStatus(result))).ThenBy(result => result.MatchConfidence).ThenByDescending(result => result.ScannedAt)
        };

    private static int StatusPriority(string status) => status switch
    {
        PtvMetadataQualityStatuses.LikelyWrong => 0,
        PtvMetadataQualityStatuses.Review => 1,
        PtvMetadataQualityStatuses.Incomplete => 2,
        PtvMetadataQualityStatuses.Unavailable => 3,
        "dismissed" => 4,
        "resolved" => 5,
        _ => 6
    };

    private static PtvMetadataQualityResultSummary ToResultSummary(PtvMetadataQualityResult result) => new()
    {
        ItemId = result.ItemId,
        LibraryId = result.LibraryId,
        LibraryName = result.LibraryName,
        ItemType = result.ItemType,
        Title = result.Title,
        FileName = result.FileName,
        FolderName = result.FolderName,
        ScannedAt = result.ScannedAt,
        Status = GetDisplayStatus(result),
        MatchConfidence = result.MatchConfidence,
        CompletenessScore = result.CompletenessScore,
        CurrentMatch = CloneMatch(result.CurrentMatch),
        SuggestedMatch = CloneMatch(result.SuggestedMatch),
        Reasons = result.Reasons.Take(3).Select(CloneReason).ToList(),
        ProviderVerified = result.ProviderVerified,
        AiReviewed = result.AiReviewed,
        Resolution = CloneResolution(result.Resolution)
    };

    private static PtvMetadataQualityResult CloneResult(PtvMetadataQualityResult result) => new()
    {
        ItemId = result.ItemId,
        LibraryId = result.LibraryId,
        LibraryName = result.LibraryName,
        ItemType = result.ItemType,
        Title = result.Title,
        FileName = result.FileName,
        FolderName = result.FolderName,
        ScanFingerprint = result.ScanFingerprint,
        ScannedAt = result.ScannedAt,
        ScannerVersion = result.ScannerVersion,
        RuleVersion = result.RuleVersion,
        Status = result.Status,
        MatchConfidence = result.MatchConfidence,
        CompletenessScore = result.CompletenessScore,
        RuleScore = result.RuleScore,
        ProviderScore = result.ProviderScore,
        AiScore = result.AiScore,
        Signals = CloneSignals(result.Signals),
        Reasons = result.Reasons.Select(CloneReason).ToList(),
        CurrentMatch = CloneMatch(result.CurrentMatch),
        SuggestedMatch = CloneMatch(result.SuggestedMatch),
        Candidates = result.Candidates.Select(CloneCandidate).ToList(),
        ProviderVerified = result.ProviderVerified,
        AiReviewed = result.AiReviewed,
        AiProvider = result.AiProvider,
        AiModel = result.AiModel,
        AiPromptVersion = result.AiPromptVersion,
        Dismissed = result.Dismissed,
        DismissedAt = result.DismissedAt,
        DismissedFingerprint = result.DismissedFingerprint,
        DismissedReasonSignature = result.DismissedReasonSignature,
        Resolution = CloneResolution(result.Resolution)
    };

    private static PtvMetadataQualitySignals CloneSignals(PtvMetadataQualitySignals signals) => new()
    {
        FilenameTitleSimilarity = signals.FilenameTitleSimilarity,
        FolderTitleSimilarity = signals.FolderTitleSimilarity,
        FilenameYear = signals.FilenameYear,
        YearDifference = signals.YearDifference,
        RuntimeDifferencePercent = signals.RuntimeDifferencePercent,
        ProviderIdPresent = signals.ProviderIdPresent,
        ProviderIdConflict = signals.ProviderIdConflict,
        ItemTypeConflict = signals.ItemTypeConflict,
        SeasonConflict = signals.SeasonConflict,
        EpisodeConflict = signals.EpisodeConflict,
        MissingPrimaryImage = signals.MissingPrimaryImage,
        MissingOverview = signals.MissingOverview,
        CandidateCount = signals.CandidateCount
    };

    private static PtvMetadataQualityReason CloneReason(PtvMetadataQualityReason reason) => new()
    {
        Code = reason.Code,
        Severity = reason.Severity,
        ScoreImpact = reason.ScoreImpact,
        Message = reason.Message,
        Evidence = reason.Evidence
    };

    private static PtvMetadataMatchSummary? CloneMatch(PtvMetadataMatchSummary? match) => match is null ? null : new()
    {
        Name = match.Name,
        ProductionYear = match.ProductionYear,
        MediaClass = match.MediaClass,
        EditionKind = match.EditionKind,
        EditionKindEvidence = match.EditionKindEvidence,
        SeriesTitle = match.SeriesTitle,
        SeriesTitleEvidence = match.SeriesTitleEvidence,
        SeriesTitleFromSearchContext = match.SeriesTitleFromSearchContext,
        NormalizedIssueNumber = match.NormalizedIssueNumber,
        IssueNumberEvidence = match.IssueNumberEvidence,
        VolumeNumber = match.VolumeNumber,
        SeriesStartYear = match.SeriesStartYear,
        SeriesStartYearEvidence = match.SeriesStartYearEvidence,
        IssuePublicationYear = match.IssuePublicationYear,
        IssuePublicationDate = match.IssuePublicationDate,
        IssuePublicationEvidence = match.IssuePublicationEvidence,
        Publisher = match.Publisher,
        VolumeId = match.VolumeId,
        ProviderName = match.ProviderName,
        Type = match.Type,
        TypeVerified = match.TypeVerified,
        RuntimeMinutes = match.RuntimeMinutes,
        ProviderIds = new Dictionary<string, string>(match.ProviderIds, StringComparer.OrdinalIgnoreCase)
    };

    private static PtvMetadataQualityCandidate CloneCandidate(PtvMetadataQualityCandidate candidate) => new()
    {
        Name = candidate.Name,
        ProductionYear = candidate.ProductionYear,
        MediaClass = candidate.MediaClass,
        EditionKind = candidate.EditionKind,
        EditionKindEvidence = candidate.EditionKindEvidence,
        SeriesTitle = candidate.SeriesTitle,
        SeriesTitleEvidence = candidate.SeriesTitleEvidence,
        SeriesTitleFromSearchContext = candidate.SeriesTitleFromSearchContext,
        NormalizedIssueNumber = candidate.NormalizedIssueNumber,
        IssueNumberEvidence = candidate.IssueNumberEvidence,
        VolumeNumber = candidate.VolumeNumber,
        SeriesStartYear = candidate.SeriesStartYear,
        SeriesStartYearEvidence = candidate.SeriesStartYearEvidence,
        IssuePublicationYear = candidate.IssuePublicationYear,
        IssuePublicationDate = candidate.IssuePublicationDate,
        IssuePublicationEvidence = candidate.IssuePublicationEvidence,
        Publisher = candidate.Publisher,
        VolumeId = candidate.VolumeId,
        Type = candidate.Type,
        TypeVerified = candidate.TypeVerified,
        RuntimeMinutes = candidate.RuntimeMinutes,
        ProviderIds = new Dictionary<string, string>(candidate.ProviderIds, StringComparer.OrdinalIgnoreCase),
        Score = candidate.Score,
        Confidence = candidate.Confidence,
        HasHardConflict = candidate.HasHardConflict,
        Rejected = candidate.Rejected,
        Reasons = candidate.Reasons.Select(CloneReason).ToList(),
        Source = candidate.Source
    };

    private static PtvMetadataQualityResolution? CloneResolution(PtvMetadataQualityResolution? resolution) => resolution is null ? null : new()
    {
        State = resolution.State,
        ResolvedAt = resolution.ResolvedAt,
        Fingerprint = resolution.Fingerprint,
        PreviousStatus = resolution.PreviousStatus
    };

    private static IReadOnlyCollection<Guid> NormalizeLibraryIds(IEnumerable<Guid>? requested, IEnumerable<Guid> configured)
    {
        var source = requested?.Any() == true ? requested : configured;
        return source.Where(id => id != Guid.Empty).Distinct().ToArray();
    }

    private static string NormalizeMode(string? mode) => mode?.Trim().ToLowerInvariant() switch
    {
        "changed" or "incremental" => "changed",
        "full" => "full",
        _ => throw new PtvMetadataQualityServiceException("PTV_METADATA_QUALITY_MODE_INVALID", "Scan mode must be changed or full.")
    };

    private static bool HasProvider(PtvMetadataMatchSummary? match, string provider) => match is not null
        && (string.Equals(match.ProviderName, provider, StringComparison.OrdinalIgnoreCase)
            || match.ProviderIds.Keys.Any(key => string.Equals(key, provider, StringComparison.OrdinalIgnoreCase)));

    private static string? SelectProviderEvidenceName(PtvMetadataQualityAnalysisItem item)
    {
        var fileStem = string.IsNullOrWhiteSpace(item.FileName)
            ? null
            : Path.GetFileNameWithoutExtension(item.FileName);
        var normalizedFile = PtvMetadataQualityRuleEngine.NormalizeTitle(fileStem);
        if (normalizedFile.Length > 0 && !IsGenericPathEvidence(normalizedFile))
        {
            return normalizedFile;
        }

        var normalizedFolder = PtvMetadataQualityRuleEngine.NormalizeTitle(item.FolderName);
        return normalizedFolder.Length > 0 && !IsGenericPathEvidence(normalizedFolder)
            ? normalizedFolder
            : null;
    }

    private static bool IsGenericPathEvidence(string value) => value is
        "movies" or "movie" or "tv" or "shows" or "series" or "media" or "videos" or "books" or "music";

    private static bool Contains(string? value, string search) => value?.Contains(search, StringComparison.OrdinalIgnoreCase) == true;

    private static bool SharesProviderId(IReadOnlyDictionary<string, string> current, IReadOnlyDictionary<string, string> candidate) =>
        current.Any(pair => candidate.TryGetValue(pair.Key, out var value) && string.Equals(pair.Value, value, StringComparison.OrdinalIgnoreCase));

    private static bool HasConflictingProviderId(IReadOnlyDictionary<string, string> current, IReadOnlyDictionary<string, string> candidate) =>
        current.Any(pair => candidate.TryGetValue(pair.Key, out var value) && !string.Equals(pair.Value, value, StringComparison.OrdinalIgnoreCase));

    private static bool SameIdentity(PtvMetadataQualityAnalysisItem item, PtvMetadataQualityCandidate candidate) =>
        string.Equals(PtvMetadataQualityRuleEngine.NormalizeTitle(item.Name), PtvMetadataQualityRuleEngine.NormalizeTitle(candidate.Name), StringComparison.Ordinal)
        && (!item.ProductionYear.HasValue || !candidate.ProductionYear.HasValue || Math.Abs(item.ProductionYear.Value - candidate.ProductionYear.Value) <= 1);

    private static PtvMetadataMatchSummary ToMatchSummary(PtvMetadataQualityCandidate candidate) => new()
    {
        Name = candidate.Name,
        ProductionYear = candidate.ProductionYear,
        MediaClass = candidate.MediaClass,
        EditionKind = candidate.EditionKind,
        EditionKindEvidence = candidate.EditionKindEvidence,
        SeriesTitle = candidate.SeriesTitle,
        SeriesTitleEvidence = candidate.SeriesTitleEvidence,
        SeriesTitleFromSearchContext = candidate.SeriesTitleFromSearchContext,
        NormalizedIssueNumber = candidate.NormalizedIssueNumber,
        IssueNumberEvidence = candidate.IssueNumberEvidence,
        VolumeNumber = candidate.VolumeNumber,
        SeriesStartYear = candidate.SeriesStartYear,
        SeriesStartYearEvidence = candidate.SeriesStartYearEvidence,
        IssuePublicationYear = candidate.IssuePublicationYear,
        IssuePublicationDate = candidate.IssuePublicationDate,
        IssuePublicationEvidence = candidate.IssuePublicationEvidence,
        Publisher = candidate.Publisher,
        VolumeId = candidate.VolumeId,
        Type = candidate.Type,
        TypeVerified = candidate.TypeVerified,
        RuntimeMinutes = candidate.RuntimeMinutes,
        ProviderName = candidate.Source,
        ProviderIds = new Dictionary<string, string>(candidate.ProviderIds, StringComparer.OrdinalIgnoreCase)
    };

    private static PtvMetadataMatchSummary ToMatchSummary(PtvMetadataMatchSummary candidate) => new()
    {
        Name = candidate.Name,
        ProductionYear = candidate.ProductionYear,
        MediaClass = candidate.MediaClass,
        EditionKind = candidate.EditionKind,
        EditionKindEvidence = candidate.EditionKindEvidence,
        SeriesTitle = candidate.SeriesTitle,
        SeriesTitleEvidence = candidate.SeriesTitleEvidence,
        SeriesTitleFromSearchContext = candidate.SeriesTitleFromSearchContext,
        NormalizedIssueNumber = candidate.NormalizedIssueNumber,
        IssueNumberEvidence = candidate.IssueNumberEvidence,
        VolumeNumber = candidate.VolumeNumber,
        SeriesStartYear = candidate.SeriesStartYear,
        SeriesStartYearEvidence = candidate.SeriesStartYearEvidence,
        IssuePublicationYear = candidate.IssuePublicationYear,
        IssuePublicationDate = candidate.IssuePublicationDate,
        IssuePublicationEvidence = candidate.IssuePublicationEvidence,
        Publisher = candidate.Publisher,
        VolumeId = candidate.VolumeId,
        Type = candidate.Type,
        TypeVerified = candidate.TypeVerified,
        RuntimeMinutes = candidate.RuntimeMinutes,
        ProviderName = candidate.ProviderName,
        ProviderIds = new Dictionary<string, string>(candidate.ProviderIds, StringComparer.OrdinalIgnoreCase)
    };

    private static PtvMetadataMatchSummary ToAiMatchSummary(PtvMetadataQualityCandidate candidate)
    {
        var match = ToMatchSummary(candidate);
        match.ProviderIds.Clear();
        return match;
    }

    private static bool IsKnownReasonCode(string code) => typeof(PtvMetadataQualityReasonCodes)
        .GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
        .Select(field => field.GetValue(null) as string)
        .Contains(code, StringComparer.Ordinal);

    private static string CreateReasonSignature(IEnumerable<PtvMetadataQualityReason> reasons) => string.Join(
        '|',
        reasons.Select(reason => reason.Code).Where(code => !string.IsNullOrWhiteSpace(code)).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal));

    private static bool IsProviderCapableCompletenessType(string itemType) => itemType is
        "Book" or "BoxSet" or "MusicAlbum" or "MusicArtist";

    private static bool TryGetRuntimeDifferencePercent(
        PtvMetadataQualityAnalysisItem item,
        double? candidateRuntimeMinutes,
        out double differencePercent)
    {
        differencePercent = 0;
        if (!SupportsRuntimeEvidence(item.ItemType)
            || !item.RunTimeTicks.HasValue
            || item.RunTimeTicks.Value <= 0
            || !candidateRuntimeMinutes.HasValue
            || !double.IsFinite(candidateRuntimeMinutes.Value)
            || candidateRuntimeMinutes.Value <= 0)
        {
            return false;
        }

        var actualMinutes = TimeSpan.FromTicks(item.RunTimeTicks.Value).TotalMinutes;
        var denominator = Math.Max(actualMinutes, candidateRuntimeMinutes.Value);
        if (denominator <= 0) return false;
        differencePercent = Math.Abs(actualMinutes - candidateRuntimeMinutes.Value) / denominator * 100;
        return true;
    }

    private static bool SupportsRuntimeEvidence(string itemType) => itemType is
        "Movie" or "Episode" or "Book" or "MusicAlbum" or "Audio";

    private static bool TryGetVerifiedTypePair(
        string currentType,
        string? candidateType,
        bool candidateTypeVerified,
        out string normalizedCurrentType,
        out string normalizedCandidateType)
    {
        normalizedCurrentType = NormalizeKnownItemType(currentType) ?? string.Empty;
        normalizedCandidateType = candidateTypeVerified
            ? NormalizeKnownItemType(candidateType) ?? string.Empty
            : string.Empty;
        return normalizedCurrentType.Length > 0 && normalizedCandidateType.Length > 0;
    }

    private static string? NormalizeKnownItemType(string? itemType) => itemType?.Trim().ToLowerInvariant() switch
    {
        "movie" => "Movie",
        "series" => "Series",
        "season" => "Season",
        "episode" => "Episode",
        "book" => "Book",
        "musicalbum" => "MusicAlbum",
        "musicartist" => "MusicArtist",
        "audio" => "Audio",
        "boxset" => "BoxSet",
        _ => null
    };

    private static string NormalizeItemType(string typeName) => typeName switch
    {
        "Audio" => "Audio",
        "Book" => "Book",
        "BoxSet" => "BoxSet",
        "Episode" => "Episode",
        "Movie" => "Movie",
        "MusicAlbum" => "MusicAlbum",
        "MusicArtist" => "MusicArtist",
        "Season" => "Season",
        "Series" => "Series",
        _ => typeName
    };

    private static string? SafeFileName(string? path)
    {
        try { return string.IsNullOrWhiteSpace(path) ? null : Path.GetFileName(path); }
        catch (ArgumentException) { return null; }
    }

    private static string? SafeFolderName(string? path, string? containingFolderPath)
    {
        try
        {
            var directory = !string.IsNullOrWhiteSpace(containingFolderPath) ? containingFolderPath : Path.GetDirectoryName(path);
            return string.IsNullOrWhiteSpace(directory) ? null : Path.GetFileName(directory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    private static bool ContainsSpecialLabel(string? value) => value?.Contains("special", StringComparison.OrdinalIgnoreCase) == true
        || value?.Contains("ova", StringComparison.OrdinalIgnoreCase) == true
        || value?.Contains("oad", StringComparison.OrdinalIgnoreCase) == true;

    private static void CountStatus(PtvMetadataQualityScanRun run, string status)
    {
        switch (status)
        {
            case PtvMetadataQualityStatuses.Healthy: run.Healthy++; break;
            case PtvMetadataQualityStatuses.Review: run.Review++; break;
            case PtvMetadataQualityStatuses.LikelyWrong: run.LikelyWrong++; break;
            case PtvMetadataQualityStatuses.Incomplete: run.Incomplete++; break;
            default: run.Unavailable++; break;
        }
    }

    private static void ReplaceRun(PtvMetadataQualityDocument document, PtvMetadataQualityScanRun run)
    {
        var index = document.ScanRuns.FindIndex(candidate => candidate.RunId == run.RunId);
        if (index >= 0) document.ScanRuns[index] = CloneRun(run);
        else document.ScanRuns.Add(CloneRun(run));
    }

    private static PtvMetadataQualityScanRun CloneRun(PtvMetadataQualityScanRun run) => new()
    {
        RunId = run.RunId,
        Mode = run.Mode,
        State = run.State,
        StartedAt = run.StartedAt,
        CompletedAt = run.CompletedAt,
        ItemsConsidered = run.ItemsConsidered,
        ItemCount = run.ItemCount,
        ItemsScanned = run.ItemsScanned,
        ItemsSkipped = run.ItemsSkipped,
        Healthy = run.Healthy,
        Review = run.Review,
        LikelyWrong = run.LikelyWrong,
        Incomplete = run.Incomplete,
        Unavailable = run.Unavailable,
        ProviderRequests = run.ProviderRequests,
        ProviderCacheHits = run.ProviderCacheHits,
        AiRequests = run.AiRequests,
        AiEligible = run.AiEligible,
        AiAnalyzed = run.AiAnalyzed,
        AiSkipped = run.AiSkipped,
        AiFailures = run.AiFailures,
        AiBudgetSkipped = run.AiBudgetSkipped,
        AiCircuitSkipped = run.AiCircuitSkipped,
        AiErrorCode = run.AiErrorCode,
        Errors = run.Errors,
        ProgressPercent = run.ProgressPercent,
        ErrorCode = run.ErrorCode
    };

    private static DateTimeOffset? Max(DateTimeOffset? left, DateTimeOffset? right) =>
        left.HasValue && right.HasValue ? (left > right ? left : right) : left ?? right;

    private sealed class DocumentLoadOperation
    {
        private int _diagnosticsClaimed;

        public Task<DocumentLoadOutcome> Task { get; set; } = null!;

        public bool TryClaimDiagnostics() => Interlocked.CompareExchange(ref _diagnosticsClaimed, 1, 0) == 0;
    }

    private sealed record DocumentLoadOutcome(PtvMetadataQualityStoreReadDiagnostics Diagnostics);

    private sealed class PtvMetadataAiRunState
    {
        public bool CircuitOpen { get; set; }

        public string? ErrorCode { get; set; }
    }
}

internal sealed record PtvMetadataQualityItemBatch(IReadOnlyList<BaseItem> Items, int TotalRecordCount);

internal sealed record PtvMetadataQualitySummarySnapshot(
    PtvMetadataQualityCounts Counts,
    DateTimeOffset? LastScanAt,
    string RuleVersion,
    string ScannerVersion,
    PtvMetadataQualityScanRun? LatestRun);
