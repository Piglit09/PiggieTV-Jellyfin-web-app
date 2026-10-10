using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Providers;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Adapter for the installed Jellyfin Comic Vine Book provider. Credential ownership remains
/// with that provider; PiggieTV never creates a second Comic Vine API-key contract.
/// </summary>
public sealed class PtvComicVineReadingMetadataProvider : IPtvReadingMetadataProvider
{
    private const string ProviderId = "comic-vine";
    private const string JellyfinProviderName = "Comic Vine";
    // Keep a defensive bound around provider-controlled responses without applying the
    // public 30-result projection before the shared deterministic scorer has ranked them.
    private const int MaximumRawCandidates = 256;
    private const int MaximumCacheEntries = 256;
    private static readonly TimeSpan CacheTtl = TimeSpan.FromDays(7);
    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, Lazy<Task<SearchAttempt>>> _inflight = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _concurrency = new(2, 2);
    private readonly Func<RemoteSearchQuery<BookInfo>, CancellationToken, Task<IEnumerable<RemoteSearchResult>>> _lookup;
    private readonly Func<bool> _isInstalled;
    private readonly ILogger<PtvComicVineReadingMetadataProvider> _logger;
    private readonly Func<DateTimeOffset> _utcNow;

    public PtvComicVineReadingMetadataProvider(
        IProviderManager providerManager,
        ILogger<PtvComicVineReadingMetadataProvider> logger)
        : this(
            (query, cancellationToken) => providerManager.GetRemoteSearchResults<Book, BookInfo>(query, cancellationToken),
            () => providerManager.GetAllMetadataPlugins().Any(plugin =>
            {
                var name = plugin.GetType().GetProperty("Name")?.GetValue(plugin)?.ToString();
                return name?.Contains(JellyfinProviderName, StringComparison.OrdinalIgnoreCase) == true;
            }),
            logger,
            () => DateTimeOffset.UtcNow)
    {
    }

    internal PtvComicVineReadingMetadataProvider(
        Func<RemoteSearchQuery<BookInfo>, CancellationToken, Task<IEnumerable<RemoteSearchResult>>> lookup,
        Func<bool> isInstalled,
        ILogger<PtvComicVineReadingMetadataProvider> logger,
        Func<DateTimeOffset>? utcNow = null)
    {
        _lookup = lookup;
        _isInstalled = isInstalled;
        _logger = logger;
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
    }

    public string Id => ProviderId;

    public string DisplayName => JellyfinProviderName;

    internal int InflightCount => _inflight.Count;

    public bool Supports(PtvMetadataSearchContext context) =>
        context.MediaClassOverride is null
            or PtvReadingMediaClass.Unknown
            or PtvReadingMediaClass.Comic
            or PtvReadingMediaClass.GraphicNovel
            or PtvReadingMediaClass.Book;

    public async Task<PtvReadingProviderSearchResult> SearchAsync(
        PtvStructuredMetadataQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (!_isInstalled())
        {
            return Unavailable("The Comic Vine metadata provider is not installed or enabled.");
        }

        var search = CreateSearchQuery(query);
        if (string.IsNullOrWhiteSpace(search.SearchInfo.Name)
            && search.SearchInfo.ProviderIds.Count == 0)
        {
            return BadRequest();
        }

        var key = CreateCacheKey(search.SearchInfo);
        if (TryGetCache(key, out var cached))
        {
            return Success(CloneCandidates(cached.Candidates), cached.DurationMilliseconds, cacheHit: true);
        }

        var operation = _inflight.GetOrAdd(
            key,
            _ =>
            {
                Lazy<Task<SearchAttempt>>? created = null;
                created = new Lazy<Task<SearchAttempt>>(
                    () => ExecuteLookupAndRemoveAsync(key, search, created!),
                    LazyThreadSafetyMode.ExecutionAndPublication);
                return created;
            });
        var attempt = await operation.Value.WaitAsync(cancellationToken).ConfigureAwait(false);
        if (attempt.Failure is not null)
        {
            return new PtvReadingProviderSearchResult
            {
                Provider = ProviderId,
                State = PtvReadingProviderState.Unreachable,
                Failure = attempt.Failure,
                DurationMilliseconds = attempt.DurationMilliseconds
            };
        }

        _cache[key] = new CacheEntry(CloneCandidates(attempt.Candidates), _utcNow().Add(CacheTtl), attempt.DurationMilliseconds, _utcNow());
        TrimCache();
        return Success(CloneCandidates(attempt.Candidates), attempt.DurationMilliseconds, cacheHit: false);
    }

    private async Task<SearchAttempt> ExecuteLookupAndRemoveAsync(
        string key,
        RemoteSearchQuery<BookInfo> query,
        Lazy<Task<SearchAttempt>> operation)
    {
        try
        {
            return await ExecuteLookupAsync(query).ConfigureAwait(false);
        }
        finally
        {
            _inflight.TryRemove(new KeyValuePair<string, Lazy<Task<SearchAttempt>>>(key, operation));
        }
    }

    public async Task<PtvNormalizedMetadataCandidate?> GetByIdAsync(
        string providerId,
        CancellationToken cancellationToken)
    {
        var id = PtvReadingMetadataSafety.Text(providerId, 256);
        if (id is null)
        {
            return null;
        }

        var result = await SearchAsync(
            new PtvStructuredMetadataQuery
            {
                ProviderId = new PtvReadingProviderIdentifier { Provider = ProviderId, Id = id },
                ExistingProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                {
                    [JellyfinProviderName] = id
                },
                MediaClass = PtvReadingMediaClass.Comic
            },
            cancellationToken).ConfigureAwait(false);
        return result.Candidates.FirstOrDefault(candidate => candidate.ProviderId.Equals(id, StringComparison.OrdinalIgnoreCase));
    }

    public Task<PtvReadingProviderStatus> GetStatusAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var installed = _isInstalled();
        return Task.FromResult(new PtvReadingProviderStatus
        {
            Provider = ProviderId,
            State = installed ? PtvReadingProviderState.Available : PtvReadingProviderState.Disabled,
            Message = installed ? "Ready" : "Comic Vine provider not available"
        });
    }

    private async Task<SearchAttempt> ExecuteLookupAsync(RemoteSearchQuery<BookInfo> query)
    {
        var stopwatch = Stopwatch.StartNew();
        using var timeoutSource = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        try
        {
            await _concurrency.WaitAsync(timeoutSource.Token).ConfigureAwait(false);
            try
            {
                var results = await _lookup(query, timeoutSource.Token).ConfigureAwait(false);
                return new SearchAttempt(
                    Normalize(results),
                    null,
                    stopwatch.ElapsedMilliseconds);
            }
            finally
            {
                _concurrency.Release();
            }
        }
        catch (OperationCanceledException)
        {
            return FailedAttempt(
                PtvReadingProviderFailureKind.Timeout,
                "comic-vine-timeout",
                "Comic Vine did not respond in time.",
                stopwatch.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                "Comic Vine metadata lookup failed through Jellyfin. Failure={FailureType}.",
                ex.GetType().Name);
            return FailedAttempt(
                PtvReadingProviderFailureKind.Unavailable,
                "comic-vine-unavailable",
                "Comic Vine is temporarily unavailable.",
                stopwatch.ElapsedMilliseconds);
        }
        finally
        {
            stopwatch.Stop();
        }
    }

    private static RemoteSearchQuery<BookInfo> CreateSearchQuery(PtvStructuredMetadataQuery query)
    {
        var providerIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in query.ExistingProviderIds.Take(32))
        {
            var key = PtvReadingMetadataSafety.Text(pair.Key, 64);
            var value = PtvReadingMetadataSafety.Text(pair.Value, 256);
            if (key is not null && value is not null)
            {
                // Assignment intentionally replaces duplicate case-insensitive keys instead of Add throwing.
                providerIds[key] = value;
            }
        }

        if (query.ProviderId is { } direct
            && (direct.Provider.Equals(ProviderId, StringComparison.OrdinalIgnoreCase)
                || direct.Provider.Equals(JellyfinProviderName, StringComparison.OrdinalIgnoreCase)))
        {
            var directId = PtvReadingMetadataSafety.Text(direct.Id, 256);
            if (directId is not null)
            {
                providerIds[JellyfinProviderName] = directId;
            }
        }

        var searchInfo = new BookInfo
        {
            Name = PtvReadingMetadataSafety.Text(query.SeriesTitle ?? query.CleanedTitle) ?? string.Empty,
            OriginalTitle = PtvReadingMetadataSafety.Text(query.RawTitle),
            SeriesName = PtvReadingMetadataSafety.Text(query.SeriesTitle),
            // Comic Vine uses this value to narrow a run search. Never substitute the issue's
            // cover/publication year for the run start year.
            Year = query.SeriesStartYear ?? query.Year,
            ProviderIds = providerIds,
            // Jellyfin's BookInfo issue fields are nullable integers. Decimal issues such
            // as #1.5 therefore cannot be represented in IndexNumber without corruption;
            // the exact raw title is preserved in OriginalTitle for provider text search.
            IndexNumber = ParseNumber(query.IssueNumber),
            ParentIndexNumber = ParseNumber(query.VolumeNumber)
        };
        return new RemoteSearchQuery<BookInfo>
        {
            IncludeDisabledProviders = false,
            SearchProviderName = JellyfinProviderName,
            SearchInfo = searchInfo
        };
    }

    private static List<PtvNormalizedMetadataCandidate> Normalize(IEnumerable<RemoteSearchResult>? results)
    {
        var candidates = new List<PtvNormalizedMetadataCandidate>();
        var identities = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var parser = new PtvReadingMetadataParser();
        foreach (var result in results ?? [])
        {
            var title = PtvReadingMetadataSafety.Text(result.Name);
            var claimedIds = result.ProviderIds
                .Where(pair => pair.Key.Contains("ComicVine", StringComparison.OrdinalIgnoreCase)
                    || pair.Key.Contains("Comic Vine", StringComparison.OrdinalIgnoreCase))
                .Select(pair => pair.Value?.Trim()).Distinct(StringComparer.Ordinal).ToArray();
            // Upstream issue/volume key semantics are unproved. Never silently pick one
            // when that namespace makes contradictory claims, or truncate an opaque ID.
            if (claimedIds.Length != 1 || claimedIds[0] is not { Length: > 0 and <= 256 }
                || !claimedIds[0]!.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_')) continue;
            var providerId = claimedIds[0];
            providerId = PtvReadingMetadataSafety.Text(providerId, 256);
            if (title is null || providerId is null || !identities.Add(providerId))
            {
                continue;
            }

            var parsedIdentity = parser.Parse(title, new PtvMetadataSearchContext
            {
                ItemType = "Book",
                LibraryType = "books",
                MediaClassOverride = PtvReadingMediaClass.Comic
            });
            var issueNumber = NormalizeIssueNumber(result) ?? parsedIdentity.IssueNumber;
            var seriesTitle = IsIssueOnlyDisplayTitle(title, issueNumber)
                ? null
                : parsedIdentity.SeriesTitle;
            var editionKind = PtvReadingMetadataParser.DetectEditionKind(title);
            var candidate = new PtvNormalizedMetadataCandidate
            {
                Provider = ProviderId,
                ProviderId = providerId,
                MediaClass = PtvReadingMediaClass.Comic,
                Title = title,
                SeriesTitle = seriesTitle,
                SeriesTitleEvidence = string.IsNullOrWhiteSpace(seriesTitle)
                    ? PtvReadingIdentityEvidenceSource.Unknown
                    : PtvReadingIdentityEvidenceSource.Provider,
                Year = result.ProductionYear,
                IssuePublicationYear = result.ProductionYear,
                IssuePublicationDate = result.PremiereDate,
                IssuePublicationEvidence = result.ProductionYear is not null || result.PremiereDate is not null
                    ? PtvReadingIdentityEvidenceSource.Provider
                    : PtvReadingIdentityEvidenceSource.Unknown,
                IssueNumber = issueNumber,
                IssueNumberEvidence = issueNumber is null
                    ? PtvReadingIdentityEvidenceSource.Unknown
                    : PtvReadingIdentityEvidenceSource.Provider,
                EditionKind = editionKind,
                EditionKindEvidence = editionKind == PtvReadingEditionKind.Standard
                    ? PtvReadingIdentityEvidenceSource.Unknown
                    : PtvReadingIdentityEvidenceSource.Provider,
                VolumeNumber = result.ParentIndexNumber?.ToString(CultureInfo.InvariantCulture),
                Description = PtvReadingMetadataSafety.PlainText(result.Overview),
                CoverUrl = PtvReadingMetadataSafety.HttpUrl(result.ImageUrl)
            };
            candidate.ExternalIds["ComicVine"] = providerId;
            candidate.IdentityProviderIds = [new() { Namespace = "ComicVine", Scope = PtvReadingProviderIdScope.Unknown, Value = providerId }];
            foreach (var pair in result.ProviderIds.Take(32))
            {
                var key = PtvReadingMetadataSafety.Text(pair.Key, 64);
                var value = PtvReadingMetadataSafety.Text(pair.Value, 256);
                if (key is not null && value is not null)
                {
                    candidate.ExternalIds[key] = value;
                }
            }

            candidates.Add(candidate.ToBoundedTransportModel());
            if (candidates.Count == MaximumRawCandidates)
            {
                break;
            }
        }

        return candidates;
    }

    private bool TryGetCache(string key, out CacheEntry entry)
    {
        if (_cache.TryGetValue(key, out entry!) && entry.ExpiresAtUtc > _utcNow()) return true;
        _cache.TryRemove(key, out _);
        entry = null!;
        return false;
    }

    private void TrimCache()
    {
        if (_cache.Count <= MaximumCacheEntries) return;
        foreach (var key in _cache.OrderBy(pair => pair.Value.CreatedAtUtc)
            .Take(_cache.Count - 192)
            .Select(pair => pair.Key))
        {
            _cache.TryRemove(key, out _);
        }
    }

    private static string CreateCacheKey(BookInfo info)
    {
        var canonical = string.Join(
            '\n',
            info.Name,
            info.OriginalTitle,
            info.SeriesName,
            info.Year?.ToString(),
            info.IndexNumber?.ToString(CultureInfo.InvariantCulture),
            info.ParentIndexNumber?.ToString(CultureInfo.InvariantCulture),
            string.Join(';', info.ProviderIds.OrderBy(pair => pair.Key).Select(pair => $"{pair.Key}={pair.Value}")));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private static int? ParseNumber(string? value) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) ? number : null;

    private static string? NormalizeIssueNumber(RemoteSearchResult result)
    {
        if (result.IndexNumber is not null)
        {
            return PtvReadingMetadataParser.NormalizeNumber(
                result.IndexNumber.Value.ToString(CultureInfo.InvariantCulture));
        }

        var title = result.Name?.Trim();
        return title?.StartsWith('#') == true
            ? PtvReadingMetadataParser.NormalizeNumber(title)
            : null;
    }

    private static bool IsIssueOnlyDisplayTitle(string title, string? issueNumber)
    {
        if (issueNumber is null)
        {
            return false;
        }

        var normalizedDisplay = PtvReadingMetadataParser.NormalizeNumber(title);
        return normalizedDisplay is not null
            && string.Equals(normalizedDisplay, issueNumber, StringComparison.Ordinal);
    }

    private static List<PtvNormalizedMetadataCandidate> CloneCandidates(IEnumerable<PtvNormalizedMetadataCandidate> candidates) =>
        candidates.Select(candidate => candidate.ToBoundedTransportModel()).ToList();

    private static PtvReadingProviderSearchResult Success(
        List<PtvNormalizedMetadataCandidate> candidates,
        long durationMilliseconds,
        bool cacheHit) => new()
        {
            Provider = ProviderId,
            State = PtvReadingProviderState.Available,
            Candidates = candidates,
            DurationMilliseconds = durationMilliseconds,
            CacheHit = cacheHit
        };

    private static PtvReadingProviderSearchResult Unavailable(string message) => new()
    {
        Provider = ProviderId,
        State = PtvReadingProviderState.Disabled,
        Failure = new PtvReadingProviderFailure
        {
            Provider = ProviderId,
            Kind = PtvReadingProviderFailureKind.Unavailable,
            Code = "comic-vine-not-installed",
            Message = message
        }
    };

    private static PtvReadingProviderSearchResult BadRequest() => new()
    {
        Provider = ProviderId,
        State = PtvReadingProviderState.Available,
        Failure = new PtvReadingProviderFailure
        {
            Provider = ProviderId,
            Kind = PtvReadingProviderFailureKind.BadRequest,
            Code = "comic-vine-query-required",
            Message = "A title or Comic Vine identifier is required."
        }
    };

    private static SearchAttempt FailedAttempt(
        PtvReadingProviderFailureKind kind,
        string code,
        string message,
        long durationMilliseconds) => new(
            [],
            new PtvReadingProviderFailure
            {
                Provider = ProviderId,
                Kind = kind,
                Code = code,
                Message = message
            },
            durationMilliseconds);

    private sealed record CacheEntry(
        List<PtvNormalizedMetadataCandidate> Candidates,
        DateTimeOffset ExpiresAtUtc,
        long DurationMilliseconds,
        DateTimeOffset CreatedAtUtc);

    private sealed record SearchAttempt(
        List<PtvNormalizedMetadataCandidate> Candidates,
        PtvReadingProviderFailure? Failure,
        long DurationMilliseconds);
}
