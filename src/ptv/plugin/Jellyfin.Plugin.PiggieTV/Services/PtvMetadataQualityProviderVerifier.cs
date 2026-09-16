using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Providers;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Uses Jellyfin's configured remote metadata providers to verify suspicious matches.
/// Search results are observational and are never applied to library items.
/// </summary>
public sealed class PtvMetadataQualityProviderVerifier : IPtvMetadataQualityProviderVerifier
{
    // Keep provider I/O bounded, but retain enough of the single provider response
    // for deterministic scoring to happen before the public top-five projection.
    // This is a provider-safety bound, not the review projection. Reading candidates are
    // scored below this layer before Metadata Quality selects its public top five.
    private const int MaximumRawCandidates = 256;
    private const int MaximumCacheEntries = 4096;
    private const int MaximumProviderIds = 12;
    private const int MaximumTextLength = 256;
    private static readonly TimeSpan DefaultRequestTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan PositiveCacheTtl = TimeSpan.FromDays(14);
    private static readonly TimeSpan EmptyCacheTtl = TimeSpan.FromHours(1);

    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _lookupGates = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _concurrencyGate;
    private readonly Func<PtvMetadataProviderVerificationRequest, CancellationToken, Task<IEnumerable<RemoteSearchResult>>> _lookup;
    private readonly ILogger<PtvMetadataQualityProviderVerifier> _logger;
    private readonly PtvReadingMetadataParser _readingParser;
    private readonly TimeSpan _requestTimeout;
    private readonly Func<DateTimeOffset> _utcNow;

    internal int LookupGateCount => _lookupGates.Count;

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvMetadataQualityProviderVerifier"/> class.
    /// </summary>
    /// <param name="providerManager">Jellyfin metadata provider manager.</param>
    /// <param name="readingParser">The shared provider-neutral Reading parser.</param>
    /// <param name="logger">Logger.</param>
    public PtvMetadataQualityProviderVerifier(
        IProviderManager providerManager,
        PtvReadingMetadataParser readingParser,
        ILogger<PtvMetadataQualityProviderVerifier> logger)
        : this(
            (request, cancellationToken) => SearchConfiguredProvidersAsync(providerManager, request, cancellationToken),
            logger,
            DefaultRequestTimeout,
            maxConcurrency: 2,
            () => DateTimeOffset.UtcNow,
            readingParser)
    {
    }

    internal PtvMetadataQualityProviderVerifier(
        Func<PtvMetadataProviderVerificationRequest, CancellationToken, Task<IEnumerable<RemoteSearchResult>>> lookup,
        ILogger<PtvMetadataQualityProviderVerifier> logger,
        TimeSpan requestTimeout,
        int maxConcurrency = 2,
        Func<DateTimeOffset>? utcNow = null,
        PtvReadingMetadataParser? readingParser = null)
    {
        _lookup = lookup ?? throw new ArgumentNullException(nameof(lookup));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _requestTimeout = requestTimeout > TimeSpan.Zero ? requestTimeout : DefaultRequestTimeout;
        _concurrencyGate = new SemaphoreSlim(Math.Max(1, maxConcurrency), Math.Max(1, maxConcurrency));
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
        _readingParser = readingParser ?? new PtvReadingMetadataParser();
    }

    /// <inheritdoc />
    public async Task<PtvMetadataProviderVerificationResult> VerifyAsync(
        PtvMetadataProviderVerificationRequest request,
        PtvMetadataProviderVerificationBudget budget,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(budget);
        cancellationToken.ThrowIfCancellationRequested();

        var itemType = NormalizeItemType(request.ItemType);
        if (!IsSupported(itemType))
        {
            return Unavailable("unsupported-item-type");
        }

        var cacheKey = CreateCacheKey(request, itemType);
        if (TryGetCached(cacheKey, out var cached))
        {
            return FromCache(cached);
        }

        var lookupGate = _lookupGates.GetOrAdd(cacheKey, static _ => new SemaphoreSlim(1, 1));
        await lookupGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (TryGetCached(cacheKey, out cached))
            {
                return FromCache(cached);
            }

            await _concurrencyGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (!budget.TryConsume())
                {
                    return Unavailable("budget-exhausted");
                }

                var currentLookup = await LookupAsync(request, itemType, cancellationToken).ConfigureAwait(false);
                if (!currentLookup.Succeeded)
                {
                    return Failed(currentLookup.ErrorCode ?? "provider-lookup-failed", logicalRequestCount: 1);
                }

                var candidates = currentLookup.Candidates;
                var logicalRequestCount = 1;
                if (ShouldSearchPathEvidence(request, itemType))
                {
                    if (!budget.TryConsume())
                    {
                        return Partial(candidates, logicalRequestCount, "alternate-budget-exhausted");
                    }

                    logicalRequestCount++;
                    var evidenceLookup = await LookupAsync(
                        CreatePathEvidenceRequest(request),
                        itemType,
                        cancellationToken).ConfigureAwait(false);
                    if (!evidenceLookup.Succeeded)
                    {
                        return Partial(
                            candidates,
                            logicalRequestCount,
                            $"alternate-{evidenceLookup.ErrorCode ?? "provider-lookup-failed"}");
                    }

                    candidates = MergeCandidates(
                        candidates,
                        evidenceLookup.Candidates,
                        string.Equals(itemType, "Book", StringComparison.Ordinal) ? MaximumRawCandidates : 5);
                }

                var now = _utcNow();
                var entry = new CacheEntry(
                    candidates,
                    now.Add(candidates.Count == 0 ? EmptyCacheTtl : PositiveCacheTtl),
                    now);
                _cache[cacheKey] = entry;
                TrimCaches();

                return new PtvMetadataProviderVerificationResult
                {
                    Available = true,
                    Attempted = true,
                    LogicalRequestCount = logicalRequestCount,
                    Candidates = CloneCandidates(candidates)
                };
            }
            finally
            {
                _concurrencyGate.Release();
            }
        }
        finally
        {
            lookupGate.Release();
            // Failed and timed-out lookups are intentionally not cached. Trim
            // their now-idle single-flight gates as well so a provider outage
            // across a large library cannot grow this dictionary without bound.
            TrimCaches();
        }
    }

    private async Task<LookupAttempt> LookupAsync(
        PtvMetadataProviderVerificationRequest request,
        string itemType,
        CancellationToken cancellationToken)
    {
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(_requestTimeout);

        try
        {
            var providerResults = await _lookup(request, timeoutSource.Token).ConfigureAwait(false);
            return new LookupAttempt(true, null, NormalizeCandidates(providerResults, itemType, request));
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(
                "PiggieTV Metadata Quality provider verification timed out. ItemType={ItemType}.",
                itemType);
            return new LookupAttempt(false, "timeout", []);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                "PiggieTV Metadata Quality provider verification failed. ItemType={ItemType}; Failure={FailureType}.",
                itemType,
                ex.GetType().Name);
            return new LookupAttempt(false, "provider-lookup-failed", []);
        }
    }

    private static async Task<IEnumerable<RemoteSearchResult>> SearchConfiguredProvidersAsync(
        IProviderManager providerManager,
        PtvMetadataProviderVerificationRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(providerManager);

        return NormalizeItemType(request.ItemType) switch
        {
            "Movie" => await SearchAsync<Movie, MovieInfo>(providerManager, request, cancellationToken).ConfigureAwait(false),
            "Series" => await SearchAsync<Series, SeriesInfo>(providerManager, request, cancellationToken).ConfigureAwait(false),
            "BoxSet" => await SearchAsync<BoxSet, BoxSetInfo>(providerManager, request, cancellationToken).ConfigureAwait(false),
            "Book" => await SearchBookAsync(providerManager, request, cancellationToken).ConfigureAwait(false),
            "MusicAlbum" => await SearchAsync<MusicAlbum, AlbumInfo>(providerManager, request, cancellationToken).ConfigureAwait(false),
            "MusicArtist" => await SearchAsync<MusicArtist, ArtistInfo>(providerManager, request, cancellationToken).ConfigureAwait(false),
            _ => Array.Empty<RemoteSearchResult>()
        };
    }

    private static Task<IEnumerable<RemoteSearchResult>> SearchAsync<TItem, TLookup>(
        IProviderManager providerManager,
        PtvMetadataProviderVerificationRequest request,
        CancellationToken cancellationToken)
        where TItem : BaseItem, new()
        where TLookup : ItemLookupInfo, new()
    {
        var search = new RemoteSearchQuery<TLookup>
        {
            ItemId = request.ItemId,
            IncludeDisabledProviders = false,
            SearchInfo = new TLookup
            {
                Name = CleanText(request.Name),
                OriginalTitle = CleanNullableText(request.OriginalTitle),
                Year = request.ProductionYear,
                ProviderIds = CopyProviderIds(request.ProviderIds)
            }
        };

        return providerManager.GetRemoteSearchResults<TItem, TLookup>(search, cancellationToken);
    }

    private static Task<IEnumerable<RemoteSearchResult>> SearchBookAsync(
        IProviderManager providerManager,
        PtvMetadataProviderVerificationRequest request,
        CancellationToken cancellationToken)
    {
        var search = new RemoteSearchQuery<BookInfo>
        {
            ItemId = request.ItemId,
            IncludeDisabledProviders = false,
            SearchInfo = new BookInfo
            {
                Name = CleanText(request.SeriesTitle ?? request.Name),
                OriginalTitle = CleanNullableText(request.OriginalTitle),
                SeriesName = CleanNullableText(request.SeriesTitle),
                Year = request.SeriesStartYear ?? request.ProductionYear,
                IndexNumber = ParseWholeNumber(request.NormalizedIssueNumber),
                ParentIndexNumber = ParseWholeNumber(request.VolumeNumber),
                ProviderIds = CopyProviderIds(request.ProviderIds)
            }
        };

        return providerManager.GetRemoteSearchResults<Book, BookInfo>(search, cancellationToken);
    }

    private bool TryGetCached(string cacheKey, out CacheEntry entry)
    {
        if (_cache.TryGetValue(cacheKey, out entry!) && entry.ExpiresAt > _utcNow())
        {
            return true;
        }

        _cache.TryRemove(cacheKey, out _);
        entry = null!;
        return false;
    }

    private static PtvMetadataProviderVerificationResult FromCache(CacheEntry entry) => new()
    {
        Available = true,
        CacheHit = true,
        Candidates = CloneCandidates(entry.Candidates)
    };

    private static PtvMetadataProviderVerificationResult Unavailable(string errorCode) => new()
    {
        Available = false,
        ErrorCode = errorCode
    };

    private static PtvMetadataProviderVerificationResult Failed(string errorCode, int logicalRequestCount) => new()
    {
        Available = false,
        Attempted = true,
        LogicalRequestCount = logicalRequestCount,
        ErrorCode = errorCode
    };

    private static PtvMetadataProviderVerificationResult Partial(
        IEnumerable<PtvMetadataMatchSummary> candidates,
        int logicalRequestCount,
        string errorCode) => new()
        {
            Available = true,
            Attempted = true,
            LogicalRequestCount = logicalRequestCount,
            ErrorCode = errorCode,
            Candidates = CloneCandidates(candidates)
        };

    private static bool ShouldSearchPathEvidence(
        PtvMetadataProviderVerificationRequest request,
        string itemType)
    {
        // Book requests already carry parser-derived series, issue, run, and volume fields.
        // A second path-shaped lookup would repeat provider traffic without stronger evidence.
        if (string.Equals(itemType, "Book", StringComparison.Ordinal))
        {
            return false;
        }

        var evidenceName = PtvMetadataQualityRuleEngine.NormalizeTitle(request.EvidenceName);
        if (evidenceName.Length == 0)
        {
            return false;
        }

        var currentName = PtvMetadataQualityRuleEngine.NormalizeTitle(request.Name);
        var originalTitle = PtvMetadataQualityRuleEngine.NormalizeTitle(request.OriginalTitle);
        var bestTitleSimilarity = Math.Max(
            PtvMetadataQualityRuleEngine.Similarity(evidenceName, currentName),
            PtvMetadataQualityRuleEngine.Similarity(evidenceName, originalTitle));
        var nameMateriallyDiffers = currentName.Length == 0 || bestTitleSimilarity < 0.75;

        var yearTolerance = string.Equals(itemType, "Series", StringComparison.Ordinal) ? 2 : 1;
        var yearConflicts = request.EvidenceYear.HasValue
            && request.ProductionYear.HasValue
            && Math.Abs(request.EvidenceYear.Value - request.ProductionYear.Value) > yearTolerance;

        return nameMateriallyDiffers || yearConflicts;
    }

    private static PtvMetadataProviderVerificationRequest CreatePathEvidenceRequest(
        PtvMetadataProviderVerificationRequest request) => new()
        {
            ItemId = request.ItemId,
            ItemType = request.ItemType,
            Name = PtvMetadataQualityRuleEngine.NormalizeTitle(request.EvidenceName),
            ProductionYear = request.EvidenceYear,
            MediaClass = request.MediaClass,
            EditionKind = request.EditionKind,
            EditionKindEvidence = request.EditionKindEvidence,
            SeriesTitle = request.SeriesTitle,
            SeriesTitleEvidence = request.SeriesTitleEvidence,
            NormalizedIssueNumber = request.NormalizedIssueNumber,
            IssueNumberEvidence = request.IssueNumberEvidence,
            VolumeNumber = request.VolumeNumber,
            SeriesStartYear = request.SeriesStartYear,
            SeriesStartYearEvidence = request.SeriesStartYearEvidence,
            IssuePublicationYear = request.IssuePublicationYear,
            IssuePublicationDate = request.IssuePublicationDate,
            IssuePublicationEvidence = request.IssuePublicationEvidence,
            Publisher = request.Publisher,
            VolumeId = request.VolumeId,
            ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        };

    private static List<PtvMetadataMatchSummary> MergeCandidates(
        IReadOnlyCollection<PtvMetadataMatchSummary> currentCandidates,
        IReadOnlyCollection<PtvMetadataMatchSummary> evidenceCandidates,
        int maximumCandidates)
    {
        var merged = new List<PtvMetadataMatchSummary>(maximumCandidates);
        var identities = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void AddCandidates(IEnumerable<PtvMetadataMatchSummary> candidates)
        {
            foreach (var candidate in candidates)
            {
                if (merged.Count == maximumCandidates)
                {
                    return;
                }

                if (identities.Add(CreateCandidateIdentity(candidate)))
                {
                    merged.Add(candidate);
                }
            }
        }

        if (maximumCandidates == 5)
        {
            // Preserve the established non-Reading compatibility behavior.
            AddCandidates(currentCandidates.Take(4));
            AddCandidates(evidenceCandidates);
            AddCandidates(currentCandidates.Skip(4));
        }
        else
        {
            // Reading candidates are ranked after this bounded union. Provider
            // order must never decide which five reach the review contract.
            AddCandidates(currentCandidates);
            AddCandidates(evidenceCandidates);
        }
        return merged;
    }

    private List<PtvMetadataMatchSummary> NormalizeCandidates(
        IEnumerable<RemoteSearchResult>? providerResults,
        string itemType,
        PtvMetadataProviderVerificationRequest request)
    {
        var maximumCandidates = string.Equals(itemType, "Book", StringComparison.Ordinal)
            ? MaximumRawCandidates
            : 5;
        var candidates = new List<PtvMetadataMatchSummary>(maximumCandidates);
        var identities = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var result in providerResults ?? Array.Empty<RemoteSearchResult>())
        {
            var name = CleanText(result.Name);
            if (name.Length == 0)
            {
                continue;
            }

            var providerIds = CopyProviderIds(result.ProviderIds);
            var identity = CreateCandidateIdentity(name, result.ProductionYear, providerIds);
            if (!identities.Add(identity))
            {
                continue;
            }

            var publicationDate = result.PremiereDate;
            var publicationYear = publicationDate?.Year ?? result.ProductionYear;
            var parsedReading = string.Equals(itemType, "Book", StringComparison.Ordinal)
                ? _readingParser.Parse(name, new PtvMetadataSearchContext
                {
                    ItemType = "Book",
                    LibraryType = "books",
                    ExistingTitle = name
                })
                : null;
            var issueNumber = result.IndexNumber?.ToString(CultureInfo.InvariantCulture)
                ?? parsedReading?.IssueNumber;
            var normalizedIssueNumber = PtvReadingMetadataParser.NormalizeNumber(issueNumber, allowRomanNumeral: true);
            var seriesTitle = CleanNullableText(parsedReading?.SeriesTitle);
            if (IsIssueOnlySeriesTitle(seriesTitle, normalizedIssueNumber))
            {
                seriesTitle = null;
            }

            candidates.Add(new PtvMetadataMatchSummary
            {
                Name = name,
                ProductionYear = publicationYear,
                MediaClass = InferReadingMediaClass(result.SearchProviderName, parsedReading?.MediaClass),
                EditionKind = parsedReading?.EditionKind ?? PtvReadingEditionKind.Standard,
                EditionKindEvidence = parsedReading?.EditionKind is not null and not PtvReadingEditionKind.Standard
                    ? PtvReadingIdentityEvidenceSource.Provider
                    : PtvReadingIdentityEvidenceSource.Unknown,
                SeriesTitle = seriesTitle,
                SeriesTitleEvidence = string.IsNullOrWhiteSpace(seriesTitle)
                    ? PtvReadingIdentityEvidenceSource.Unknown
                    : PtvReadingIdentityEvidenceSource.Provider,
                NormalizedIssueNumber = normalizedIssueNumber,
                IssueNumberEvidence = string.IsNullOrWhiteSpace(issueNumber)
                    ? PtvReadingIdentityEvidenceSource.Unknown
                    : PtvReadingIdentityEvidenceSource.Provider,
                VolumeNumber = result.ParentIndexNumber?.ToString(CultureInfo.InvariantCulture),
                // ProductionYear/PremiereDate describe the issue result. Only an
                // explicit run year parsed from the provider title may populate this field.
                SeriesStartYear = parsedReading?.SeriesStartYear,
                SeriesStartYearEvidence = parsedReading?.SeriesStartYear is null
                    ? PtvReadingIdentityEvidenceSource.Unknown
                    : PtvReadingIdentityEvidenceSource.Provider,
                IssuePublicationYear = publicationYear,
                IssuePublicationDate = publicationDate,
                IssuePublicationEvidence = publicationYear.HasValue
                    ? PtvReadingIdentityEvidenceSource.Provider
                    : PtvReadingIdentityEvidenceSource.Unknown,
                VolumeId = null,
                ProviderName = CleanNullableText(result.SearchProviderName),
                Type = itemType,
                TypeVerified = true,
                ProviderIds = providerIds
            });

            if (candidates.Count == maximumCandidates)
            {
                break;
            }
        }

        return candidates;
    }

    private static bool IsIssueOnlySeriesTitle(string? seriesTitle, string? normalizedIssueNumber)
    {
        if (string.IsNullOrWhiteSpace(seriesTitle) || string.IsNullOrWhiteSpace(normalizedIssueNumber))
        {
            return false;
        }

        var value = seriesTitle.Trim();
        if (value.StartsWith("issue", StringComparison.OrdinalIgnoreCase))
        {
            value = value["issue".Length..].Trim();
        }

        value = value.TrimStart('#').Trim();
        return string.Equals(
            PtvReadingMetadataParser.NormalizeNumber(value, allowRomanNumeral: true),
            normalizedIssueNumber,
            StringComparison.Ordinal);
    }

    private static string CreateCandidateIdentity(PtvMetadataMatchSummary candidate) =>
        CreateCandidateIdentity(candidate.Name, candidate.ProductionYear, candidate.ProviderIds);

    private static string CreateCandidateIdentity(
        string name,
        int? productionYear,
        IEnumerable<KeyValuePair<string, string>> providerIds) => string.Join(
            '|',
            CleanText(name).ToUpperInvariant(),
            productionYear?.ToString() ?? string.Empty,
            string.Join(';', providerIds
                .OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
                .Select(pair => $"{pair.Key.ToUpperInvariant()}={pair.Value}")));

    private static List<PtvMetadataMatchSummary> CloneCandidates(IEnumerable<PtvMetadataMatchSummary> candidates) =>
        candidates.Select(candidate => new PtvMetadataMatchSummary
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
            ProviderName = candidate.ProviderName,
            Type = candidate.Type,
            TypeVerified = candidate.TypeVerified,
            RuntimeMinutes = candidate.RuntimeMinutes,
            ProviderIds = CopyProviderIds(candidate.ProviderIds)
        }).ToList();

    private static PtvReadingMediaClass InferReadingMediaClass(
        string? providerName,
        PtvReadingMediaClass? parsedMediaClass)
    {
        if (providerName?.Contains("comic", StringComparison.OrdinalIgnoreCase) == true)
        {
            return PtvReadingMediaClass.Comic;
        }

        if (providerName?.Contains("manga", StringComparison.OrdinalIgnoreCase) == true
            || providerName?.Contains("anilist", StringComparison.OrdinalIgnoreCase) == true)
        {
            return PtvReadingMediaClass.Manga;
        }

        if (providerName?.Contains("book", StringComparison.OrdinalIgnoreCase) == true)
        {
            return PtvReadingMediaClass.Book;
        }

        return parsedMediaClass ?? PtvReadingMediaClass.Unknown;
    }

    private static Dictionary<string, string> CopyProviderIds(IEnumerable<KeyValuePair<string, string>>? providerIds)
    {
        var copy = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (providerIds is null)
        {
            return copy;
        }

        foreach (var pair in providerIds)
        {
            var key = CleanText(pair.Key);
            var value = CleanText(pair.Value);
            if (key.Length == 0 || value.Length == 0)
            {
                continue;
            }

            copy[key] = value;
            if (copy.Count == MaximumProviderIds)
            {
                break;
            }
        }

        return copy;
    }

    private static string CreateCacheKey(PtvMetadataProviderVerificationRequest request, string itemType)
    {
        var canonical = string.Join(
            '\n',
            PtvMetadataQualityConstants.RuleVersion,
            itemType,
            CleanText(request.Name).ToUpperInvariant(),
            CleanText(request.OriginalTitle).ToUpperInvariant(),
            request.ProductionYear?.ToString() ?? string.Empty,
            request.MediaClass.ToString(),
            request.EditionKind.ToString(),
            request.EditionKindEvidence.ToString(),
            PtvReadingMetadataParser.NormalizeTitle(request.SeriesTitle).ToUpperInvariant(),
            PtvReadingMetadataParser.NormalizeNumber(request.NormalizedIssueNumber, allowRomanNumeral: true) ?? string.Empty,
            PtvReadingMetadataParser.NormalizeNumber(request.VolumeNumber, allowRomanNumeral: true) ?? string.Empty,
            request.SeriesStartYear?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            request.IssuePublicationYear?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            request.VolumeId ?? string.Empty,
            string.Join(';', CopyProviderIds(request.ProviderIds)
                .OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
                .Select(pair => $"{pair.Key.ToUpperInvariant()}={pair.Value}")),
            PtvMetadataQualityRuleEngine.NormalizeTitle(request.EvidenceName).ToUpperInvariant(),
            request.EvidenceYear?.ToString() ?? string.Empty);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private static int? ParseWholeNumber(string? value)
    {
        var normalized = PtvReadingMetadataParser.NormalizeNumber(value, allowRomanNumeral: true);
        return int.TryParse(normalized, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private static string NormalizeItemType(string? itemType)
    {
        if (string.Equals(itemType, "Movie", StringComparison.OrdinalIgnoreCase)) return "Movie";
        if (string.Equals(itemType, "Series", StringComparison.OrdinalIgnoreCase)) return "Series";
        if (string.Equals(itemType, "BoxSet", StringComparison.OrdinalIgnoreCase)) return "BoxSet";
        if (string.Equals(itemType, "Book", StringComparison.OrdinalIgnoreCase)) return "Book";
        if (string.Equals(itemType, "MusicAlbum", StringComparison.OrdinalIgnoreCase)) return "MusicAlbum";
        if (string.Equals(itemType, "MusicArtist", StringComparison.OrdinalIgnoreCase)) return "MusicArtist";
        return CleanText(itemType);
    }

    private static bool IsSupported(string itemType) => itemType is
        "Movie" or "Series" or "BoxSet" or "Book" or "MusicAlbum" or "MusicArtist";

    private static string CleanText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var cleaned = value.Trim();
        return cleaned.Length <= MaximumTextLength ? cleaned : cleaned[..MaximumTextLength];
    }

    private static string? CleanNullableText(string? value)
    {
        var cleaned = CleanText(value);
        return cleaned.Length == 0 ? null : cleaned;
    }

    private void TrimCaches()
    {
        var now = _utcNow();
        foreach (var expired in _cache.Where(pair => pair.Value.ExpiresAt <= now).Select(pair => pair.Key).ToArray())
        {
            _cache.TryRemove(expired, out _);
        }

        var overflow = _cache.Count - MaximumCacheEntries;
        if (overflow > 0)
        {
            foreach (var key in _cache.OrderBy(pair => pair.Value.CreatedAt).Take(overflow).Select(pair => pair.Key).ToArray())
            {
                _cache.TryRemove(key, out _);
            }
        }

        if (_lookupGates.Count <= MaximumCacheEntries)
        {
            return;
        }

        foreach (var pair in _lookupGates.Where(pair => pair.Value.CurrentCount == 1).Take(_lookupGates.Count - MaximumCacheEntries).ToArray())
        {
            _lookupGates.TryRemove(pair.Key, out _);
        }
    }

    private sealed record CacheEntry(
        List<PtvMetadataMatchSummary> Candidates,
        DateTimeOffset ExpiresAt,
        DateTimeOffset CreatedAt);

    private sealed record LookupAttempt(
        bool Succeeded,
        string? ErrorCode,
        List<PtvMetadataMatchSummary> Candidates);
}
