using System.Diagnostics;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Provider-neutral Reading identification coordinator.</summary>
public sealed class PtvReadingMetadataIdentificationService : IPtvReadingMetadataIdentificationService
{
    private const int MaximumCandidates = 30;
    private readonly ILibraryManager _libraryManager;
    private readonly IPtvReadingLocalMetadataInspector _localInspector;
    private readonly ILogger<PtvReadingMetadataIdentificationService> _logger;
    private readonly PtvReadingMetadataParser _parser;
    private readonly IReadOnlyList<IPtvReadingMetadataProvider> _providers;
    private readonly PtvReadingMetadataScorer _scorer;

    public PtvReadingMetadataIdentificationService(
        ILibraryManager libraryManager,
        IEnumerable<IPtvReadingMetadataProvider> providers,
        IPtvReadingLocalMetadataInspector localInspector,
        PtvReadingMetadataParser parser,
        PtvReadingMetadataScorer scorer,
        ILogger<PtvReadingMetadataIdentificationService> logger)
    {
        _libraryManager = libraryManager;
        _localInspector = localInspector;
        _providers = providers.OrderBy(provider => provider.Id, StringComparer.OrdinalIgnoreCase).ToArray();
        _parser = parser;
        _scorer = scorer;
        _logger = logger;
    }

    public async Task<PtvReadingMetadataProvidersResponse> GetProvidersAsync(CancellationToken cancellationToken)
    {
        var settled = await Task.WhenAll(_providers.Select(async provider =>
        {
            try
            {
                var status = await provider.GetStatusAsync(cancellationToken).ConfigureAwait(false);
                return new PtvReadingMetadataProviderStatusResponse
                {
                    Provider = provider.Id,
                    DisplayName = provider.DisplayName,
                    State = status.State,
                    Message = Bound(status.Message, 512),
                    RetryAfterSeconds = status.RetryAfterSeconds
                };
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    "Reading metadata provider status failed. Provider={Provider}; Failure={FailureType}.",
                    provider.Id,
                    ex.GetType().Name);
                return new PtvReadingMetadataProviderStatusResponse
                {
                    Provider = provider.Id,
                    DisplayName = provider.DisplayName,
                    State = PtvReadingProviderState.Unreachable,
                    Message = $"{provider.DisplayName} is temporarily unavailable."
                };
            }
        })).ConfigureAwait(false);

        return new PtvReadingMetadataProvidersResponse { Providers = settled.ToList() };
    }

    public async Task<PtvReadingMetadataSearchResponse> SearchAsync(
        PtvReadingMetadataSearchRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var item = GetItem(request.ItemId);
        var context = CreateContext(item, request);
        var query = _parser.Parse(context.FileName ?? item.Name, context);
        var localInspection = new PtvReadingLocalMetadataInspectionResult();
        if (!string.IsNullOrWhiteSpace(item.Path))
        {
            localInspection = await _localInspector.InspectAsync(item.Path, context, query, cancellationToken)
                .ConfigureAwait(false);
            ApplyLocalEvidence(query, localInspection, request.MediaClass is not null);
        }

        query = ApplyOverrides(query, request);
        context.MediaClassOverride = query.MediaClass;
        var selectedProviders = SelectProviders(request.Provider, context);
        if (selectedProviders.Count == 0)
        {
            throw new PtvReadingMetadataServiceException(
                "PTV_READING_PROVIDER_UNAVAILABLE",
                "No available Reading metadata provider supports this search.");
        }

        // A direct identifier is meaningful only after the provider has been selected explicitly.
        // Passing one opaque id to every provider would produce incorrect cross-provider lookups.
        var directProviderId = query.ProviderId?.Id;
        var providerResults = await Task.WhenAll(selectedProviders.Select(provider =>
            SearchProviderAsync(provider, query, directProviderId, cancellationToken))).ConfigureAwait(false);

        var merged = MergeCorroboratedMangaCandidates(providerResults.SelectMany(result => result.Candidates));
        var ranked = _scorer.Rank(query, merged)
            .Take(MaximumCandidates)
            .Select(result =>
            {
                result.Candidate.Score = result.Match.Score;
                result.Candidate.ScoreReasons = result.Match.Reasons;
                return result.Candidate.ToBoundedTransportModel();
            })
            .ToList();

        return new PtvReadingMetadataSearchResponse
        {
            Query = query,
            LocalMetadata = new PtvReadingLocalMetadataSummary
            {
                State = localInspection.State,
                Sources = localInspection.Sources
                    .Where(source => source is "ComicInfo.xml" or "OPF")
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Take(2)
                    .ToList(),
                Warnings = localInspection.Warnings
                    .Select(warning => Clean(warning, 128))
                    .Where(warning => warning.Length > 0)
                    .Distinct(StringComparer.Ordinal)
                    .Take(8)
                    .ToList()
            },
            ProviderResults = providerResults.Select(result => ToTransportResult(result, query)).ToList(),
            Candidates = ranked
        };
    }

    private async Task<PtvReadingProviderSearchResult> SearchProviderAsync(
        IPtvReadingMetadataProvider provider,
        PtvStructuredMetadataQuery query,
        string? directProviderId,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(directProviderId))
        {
            var stopwatch = Stopwatch.StartNew();
            try
            {
                var candidate = await provider.GetByIdAsync(Clean(directProviderId, 256), cancellationToken)
                    .ConfigureAwait(false);
                return new PtvReadingProviderSearchResult
                {
                    Provider = provider.Id,
                    State = PtvReadingProviderState.Available,
                    Candidates = candidate is null ? [] : [candidate],
                    DurationMilliseconds = stopwatch.ElapsedMilliseconds
                };
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    "Direct Reading metadata lookup failed. Provider={Provider}; Failure={FailureType}.",
                    provider.Id,
                    ex.GetType().Name);
                return Failed(provider, PtvReadingProviderFailureKind.Unavailable, "provider-direct-lookup-failed", stopwatch.ElapsedMilliseconds);
            }
        }

        try
        {
            return await provider.SearchAsync(query, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                "Reading metadata search failed. Provider={Provider}; Failure={FailureType}.",
                provider.Id,
                ex.GetType().Name);
            return Failed(provider, PtvReadingProviderFailureKind.Unavailable, "provider-search-failed", 0);
        }
    }

    private PtvReadingProviderSearchResult ToTransportResult(
        PtvReadingProviderSearchResult source,
        PtvStructuredMetadataQuery query)
    {
        var candidates = _scorer.Rank(query, source.Candidates)
            .Take(MaximumCandidates)
            .Select(result =>
            {
                result.Candidate.Score = result.Match.Score;
                result.Candidate.ScoreReasons = result.Match.Reasons;
                return result.Candidate.ToBoundedTransportModel();
            })
            .ToList();
        return new PtvReadingProviderSearchResult
        {
            Provider = Clean(source.Provider, 128),
            State = source.State,
            Candidates = candidates,
            Failure = source.Failure is null ? null : new PtvReadingProviderFailure
            {
                Provider = Clean(source.Failure.Provider, 128),
                Kind = source.Failure.Kind,
                Code = Clean(source.Failure.Code, 128),
                Message = Clean(source.Failure.Message, 512),
                RetryAfterSeconds = source.Failure.RetryAfterSeconds
            },
            DurationMilliseconds = Math.Max(0, source.DurationMilliseconds),
            CacheHit = source.CacheHit
        };
    }

    private IReadOnlyList<IPtvReadingMetadataProvider> SelectProviders(
        string? requestedProvider,
        PtvMetadataSearchContext context)
    {
        var normalized = NormalizeProviderId(requestedProvider);
        if (!string.IsNullOrEmpty(normalized) && normalized != "auto")
        {
            return _providers.Where(provider => NormalizeProviderId(provider.Id) == normalized).Take(1).ToArray();
        }

        var supported = _providers.Where(provider => provider.Supports(context)).ToArray();
        return supported.Length > 0 ? supported : _providers;
    }

    private BaseItem GetItem(string? itemId)
    {
        if (!Guid.TryParse(itemId, out var id) || id == Guid.Empty)
        {
            throw new PtvReadingMetadataServiceException(
                "PTV_READING_ITEM_INVALID",
                "Choose a valid Reading item.");
        }

        var item = _libraryManager.GetItemById(id);
        return item ?? throw new PtvReadingMetadataServiceException(
            "PTV_READING_ITEM_NOT_FOUND",
            "This Reading item is no longer available.");
    }

    private static PtvMetadataSearchContext CreateContext(BaseItem item, PtvReadingMetadataSearchRequest request)
    {
        var fileName = SafeFileName(item.Path);
        var folderName = SafeFolderName(item.Path);
        return new PtvMetadataSearchContext
        {
            ItemId = item.Id.ToString("N"),
            ItemType = item.GetType().Name,
            FileName = fileName,
            FolderName = folderName,
            ExistingTitle = item.Name,
            ExistingOriginalTitle = item.OriginalTitle,
            Author = CleanNullable(request.Author, 256),
            Isbn = CleanNullable(request.Isbn, 64),
            ProductionYear = item.ProductionYear,
            PremiereDate = item.PremiereDate,
            MediaClassOverride = request.MediaClass,
            ExistingProviderIds = item.ProviderIds
                .Where(pair => !string.IsNullOrWhiteSpace(pair.Key) && !string.IsNullOrWhiteSpace(pair.Value))
                .Take(PtvReadingMetadataLimits.MaximumExternalIds)
                .ToDictionary(pair => Clean(pair.Key, 64), pair => Clean(pair.Value, 256), StringComparer.OrdinalIgnoreCase)
        };
    }

    private static PtvStructuredMetadataQuery ApplyOverrides(
        PtvStructuredMetadataQuery query,
        PtvReadingMetadataSearchRequest request)
    {
        var title = CleanNullable(request.Title, PtvReadingMetadataLimits.MaximumTitleLength);
        var series = CleanNullable(request.SeriesTitle, PtvReadingMetadataLimits.MaximumTitleLength);
        if (title is not null) query.CleanedTitle = title;
        if (series is not null)
        {
            query.SeriesTitle = series;
            query.SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.Administrator;
        }
        else if (title is not null && string.IsNullOrWhiteSpace(query.SeriesTitle)) query.SeriesTitle = title;
        var requestedIssue = NormalizeRequestedNumber(request.IssueNumber);
        if (requestedIssue is not null)
        {
            query.IssueNumber = requestedIssue;
            query.IssueNumberEvidence = PtvReadingIdentityEvidenceSource.Administrator;
        }
        query.VolumeNumber = NormalizeRequestedNumber(request.VolumeNumber) ?? query.VolumeNumber;
        query.ChapterNumber = NormalizeRequestedNumber(request.ChapterNumber) ?? query.ChapterNumber;
        query.Author = CleanNullable(request.Author, 256) ?? query.Author;
        query.Isbn = CleanNullable(request.Isbn, 64) ?? query.Isbn;
        if (request.Year is >= 1000 and <= 3000)
        {
            query.Year = request.Year;
            if (query.MediaClass == PtvReadingMediaClass.Comic && request.SeriesStartYear is null)
            {
                query.SeriesStartYear = request.Year;
                query.SeriesStartYearEvidence = PtvReadingIdentityEvidenceSource.Administrator;
            }
        }

        if (request.SeriesStartYear is >= 1000 and <= 3000)
        {
            query.SeriesStartYear = request.SeriesStartYear;
            query.Year = request.SeriesStartYear;
            query.SeriesStartYearEvidence = PtvReadingIdentityEvidenceSource.Administrator;
        }

        if (request.IssuePublicationYear is >= 1000 and <= 3000)
        {
            query.IssuePublicationYear = request.IssuePublicationYear;
            query.IssuePublicationEvidence = PtvReadingIdentityEvidenceSource.Administrator;
        }

        if (request.IssuePublicationDate is not null)
        {
            query.IssuePublicationDate = request.IssuePublicationDate;
            query.IssuePublicationYear ??= request.IssuePublicationDate.Value.Year;
            query.IssuePublicationEvidence = PtvReadingIdentityEvidenceSource.Administrator;
        }
        if (request.MediaClass is not null)
        {
            query.MediaClass = request.MediaClass.Value;
            query.Classification = new PtvReadingMediaClassification
            {
                MediaClass = request.MediaClass.Value,
                Confidence = 1,
                Reasons = ["Administrator classification override"]
            };
        }

        var provider = NormalizeProviderId(request.Provider);
        var providerId = CleanNullable(request.ProviderId, PtvReadingMetadataLimits.MaximumIdentifierLength);
        if (providerId is not null && !string.IsNullOrEmpty(provider) && provider != "auto")
        {
            query.ProviderId = new PtvReadingProviderIdentifier { Provider = provider, Id = providerId };
        }

        return query;
    }

    private static void ApplyLocalEvidence(
        PtvStructuredMetadataQuery query,
        PtvReadingLocalMetadataInspectionResult inspection,
        bool hasAdminClassOverride)
    {
        if (inspection.State != PtvReadingLocalInspectionState.Inspected) return;
        var local = inspection.Metadata;
        query.CleanedTitle = CleanNullable(local.Title, PtvReadingMetadataLimits.MaximumTitleLength)
            ?? query.CleanedTitle;
        var localSeriesTitle = CleanNullable(local.SeriesTitle, PtvReadingMetadataLimits.MaximumTitleLength);
        if (localSeriesTitle is not null)
        {
            query.SeriesTitle = localSeriesTitle;
            query.SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.LocalMetadata;
        }

        if (query.IssueNumber is null)
        {
            query.IssueNumber = NormalizeRequestedNumber(local.IssueNumber);
            if (query.IssueNumber is not null)
            {
                query.IssueNumberEvidence = PtvReadingIdentityEvidenceSource.LocalMetadata;
            }
        }
        query.VolumeNumber ??= NormalizeRequestedNumber(local.VolumeNumber);
        query.ChapterNumber ??= NormalizeRequestedNumber(local.ChapterNumber);
        if (query.MediaClass == PtvReadingMediaClass.Comic)
        {
            if (query.IssuePublicationYear is null && local.Year is not null)
            {
                query.IssuePublicationYear = local.Year;
                query.IssuePublicationEvidence = PtvReadingIdentityEvidenceSource.LocalMetadata;
            }
            if (query.IssuePublicationDate is null
                && local.Year is not null
                && local.Month is >= 1 and <= 12
                && local.Day is >= 1 and <= 31
                && DateTimeOffset.TryParse(
                    $"{local.Year.Value:0000}-{local.Month.Value:00}-{local.Day.Value:00}",
                    System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.AssumeUniversal,
                    out var localDate))
            {
                query.IssuePublicationDate = localDate;
                query.IssuePublicationEvidence = PtvReadingIdentityEvidenceSource.LocalMetadata;
            }
        }
        else
        {
            query.Year ??= local.Year;
        }
        query.Author ??= local.Credits.FirstOrDefault(credit =>
            credit.Role?.Contains("writer", StringComparison.OrdinalIgnoreCase) == true)?.Name;
        query.Isbn ??= local.Isbn13 ?? local.Isbn10;
        query.OriginalLanguage ??= CleanNullable(local.Language, 64);
        query.AlternateTitles = query.AlternateTitles.Concat(local.AlternateTitles)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(PtvReadingMetadataLimits.MaximumCollectionItems)
            .ToList();
        foreach (var pair in local.ExternalIds) query.ExistingProviderIds.TryAdd(pair.Key, pair.Value);
        if (!hasAdminClassOverride
            && !string.IsNullOrWhiteSpace(local.Manga)
            && !local.Manga.Equals("No", StringComparison.OrdinalIgnoreCase))
        {
            query.MediaClass = PtvReadingMediaClass.Manga;
            query.Classification = new PtvReadingMediaClassification
            {
                MediaClass = PtvReadingMediaClass.Manga,
                Confidence = 0.98,
                Reasons = ["ComicInfo identifies this item as manga"]
            };
        }
    }

    private static List<PtvNormalizedMetadataCandidate> MergeCorroboratedMangaCandidates(
        IEnumerable<PtvNormalizedMetadataCandidate> source)
    {
        var candidates = source.Where(candidate => !string.IsNullOrWhiteSpace(candidate.Title)).ToList();
        var used = new HashSet<PtvNormalizedMetadataCandidate>();
        var merged = new List<PtvNormalizedMetadataCandidate>();
        foreach (var aniList in candidates.Where(candidate => IsProvider(candidate, "anilist")))
        {
            var mangaDex = candidates.FirstOrDefault(candidate =>
                !used.Contains(candidate)
                && IsProvider(candidate, "mangadex")
                && CanCorroborate(aniList, candidate));
            if (mangaDex is null) continue;
            used.Add(aniList);
            used.Add(mangaDex);
            merged.Add(Merge(aniList, mangaDex));
        }

        merged.AddRange(candidates.Where(candidate => !used.Contains(candidate)));
        return merged;
    }

    private static bool CanCorroborate(PtvNormalizedMetadataCandidate left, PtvNormalizedMetadataCandidate right)
    {
        var leftTitles = CandidateTitles(left);
        var rightTitles = CandidateTitles(right);
        var exactTitle = leftTitles.Any(title => rightTitles.Contains(title, StringComparer.Ordinal));
        if (!exactTitle) return false;
        var leftYear = left.StartYear ?? left.Year;
        var rightYear = right.StartYear ?? right.Year;
        if (leftYear is null || rightYear is null || Math.Abs(leftYear.Value - rightYear.Value) > 1) return false;
        var leftPeople = left.Authors.Concat(left.Artists).Select(person => PtvReadingMetadataParser.NormalizeTitle(person.Name)).Where(value => value.Length > 0).ToHashSet(StringComparer.Ordinal);
        var rightPeople = right.Authors.Concat(right.Artists).Select(person => PtvReadingMetadataParser.NormalizeTitle(person.Name)).Where(value => value.Length > 0).ToHashSet(StringComparer.Ordinal);
        return leftPeople.Overlaps(rightPeople);
    }

    private static PtvNormalizedMetadataCandidate Merge(
        PtvNormalizedMetadataCandidate aniList,
        PtvNormalizedMetadataCandidate mangaDex)
    {
        var externalIds = new Dictionary<string, string>(aniList.ExternalIds, StringComparer.OrdinalIgnoreCase);
        foreach (var pair in mangaDex.ExternalIds) externalIds.TryAdd(pair.Key, pair.Value);
        externalIds["AniList"] = aniList.ProviderId;
        externalIds["MangaDex"] = mangaDex.ProviderId;
        return new PtvNormalizedMetadataCandidate
        {
            Provider = "AniList + MangaDex",
            ProviderId = aniList.ProviderId,
            MediaClass = aniList.MediaClass == PtvReadingMediaClass.Unknown ? mangaDex.MediaClass : aniList.MediaClass,
            Title = aniList.Title,
            AlternateTitles = MergeStrings(aniList.AlternateTitles, mangaDex.AlternateTitles),
            LocalizedTitles = MergeDictionaries(aniList.LocalizedTitles, mangaDex.LocalizedTitles),
            SeriesTitle = aniList.SeriesTitle ?? mangaDex.SeriesTitle,
            SeriesTitleEvidence = PreferredEvidence(aniList.SeriesTitleEvidence, mangaDex.SeriesTitleEvidence),
            IssueNumber = aniList.IssueNumber ?? mangaDex.IssueNumber,
            IssueNumberEvidence = PreferredEvidence(aniList.IssueNumberEvidence, mangaDex.IssueNumberEvidence),
            EditionKind = aniList.EditionKindEvidence != PtvReadingIdentityEvidenceSource.Unknown
                ? aniList.EditionKind
                : mangaDex.EditionKind,
            EditionKindEvidence = PreferredEvidence(aniList.EditionKindEvidence, mangaDex.EditionKindEvidence),
            VolumeNumber = aniList.VolumeNumber ?? mangaDex.VolumeNumber,
            ChapterNumber = aniList.ChapterNumber ?? mangaDex.ChapterNumber,
            Year = aniList.Year ?? mangaDex.Year,
            StartYear = aniList.StartYear ?? mangaDex.StartYear,
            SeriesStartYearEvidence = PreferredEvidence(aniList.SeriesStartYearEvidence, mangaDex.SeriesStartYearEvidence),
            EndYear = aniList.EndYear ?? mangaDex.EndYear,
            IssuePublicationYear = aniList.IssuePublicationYear ?? mangaDex.IssuePublicationYear,
            IssuePublicationDate = aniList.IssuePublicationDate ?? mangaDex.IssuePublicationDate,
            IssuePublicationEvidence = PreferredEvidence(aniList.IssuePublicationEvidence, mangaDex.IssuePublicationEvidence),
            VolumeId = aniList.VolumeId ?? mangaDex.VolumeId,
            Description = aniList.Description ?? mangaDex.Description,
            Authors = MergeCredits(aniList.Authors, mangaDex.Authors),
            Artists = MergeCredits(aniList.Artists, mangaDex.Artists),
            Genres = MergeStrings(aniList.Genres, mangaDex.Genres),
            Tags = MergeStrings(aniList.Tags, mangaDex.Tags),
            Publisher = aniList.Publisher ?? mangaDex.Publisher,
            CountryOfOrigin = aniList.CountryOfOrigin ?? mangaDex.CountryOfOrigin,
            Language = aniList.Language ?? mangaDex.Language,
            Status = aniList.Status ?? mangaDex.Status,
            TotalVolumes = aniList.TotalVolumes,
            TotalChapters = aniList.TotalChapters,
            CoverUrl = aniList.CoverUrl ?? mangaDex.CoverUrl,
            BannerUrl = aniList.BannerUrl ?? mangaDex.BannerUrl,
            ExternalIds = externalIds,
            SourceUrl = aniList.SourceUrl ?? mangaDex.SourceUrl
        };
    }

    private static IReadOnlyList<string> CandidateTitles(PtvNormalizedMetadataCandidate candidate) =>
        new[] { candidate.Title, candidate.SeriesTitle }
            .Concat(candidate.AlternateTitles)
            .Concat(candidate.LocalizedTitles.Values)
            .Select(PtvReadingMetadataParser.NormalizeTitle)
            .Where(value => value.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

    private static bool IsProvider(PtvNormalizedMetadataCandidate candidate, string provider) =>
        NormalizeProviderId(candidate.Provider) == provider;

    private static PtvReadingIdentityEvidenceSource PreferredEvidence(
        PtvReadingIdentityEvidenceSource left,
        PtvReadingIdentityEvidenceSource right) =>
        left != PtvReadingIdentityEvidenceSource.Unknown ? left : right;

    private static List<string> MergeStrings(IEnumerable<string> left, IEnumerable<string> right) =>
        left.Concat(right).Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(PtvReadingMetadataLimits.MaximumCollectionItems).ToList();

    private static List<PtvReadingPersonCredit> MergeCredits(
        IEnumerable<PtvReadingPersonCredit> left,
        IEnumerable<PtvReadingPersonCredit> right) =>
        left.Concat(right).Where(value => !string.IsNullOrWhiteSpace(value.Name))
            .GroupBy(value => $"{value.Name}|{value.Role}", StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First()).Take(PtvReadingMetadataLimits.MaximumCollectionItems).ToList();

    private static Dictionary<string, string> MergeDictionaries(
        IReadOnlyDictionary<string, string> left,
        IReadOnlyDictionary<string, string> right)
    {
        var result = new Dictionary<string, string>(left, StringComparer.OrdinalIgnoreCase);
        foreach (var pair in right) result.TryAdd(pair.Key, pair.Value);
        return result;
    }

    private static PtvReadingProviderSearchResult Failed(
        IPtvReadingMetadataProvider provider,
        PtvReadingProviderFailureKind kind,
        string code,
        long duration) => new()
        {
            Provider = provider.Id,
            State = PtvReadingProviderState.Unreachable,
            DurationMilliseconds = duration,
            Failure = new PtvReadingProviderFailure
            {
                Provider = provider.Id,
                Kind = kind,
                Code = code,
                Message = $"{provider.DisplayName} is temporarily unavailable."
            }
        };

    private static string SafeFileName(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return string.Empty;
        try { return Clean(Path.GetFileName(path), PtvReadingMetadataLimits.MaximumTitleLength); }
        catch { return string.Empty; }
    }

    private static string SafeFolderName(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return string.Empty;
        try { return Clean(Directory.GetParent(path)?.Name, PtvReadingMetadataLimits.MaximumTitleLength); }
        catch { return string.Empty; }
    }

    private static string? NormalizeRequestedNumber(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : PtvReadingMetadataParser.NormalizeNumber(value, allowRomanNumeral: true);

    private static string NormalizeProviderId(string? value)
    {
        var normalized = new string((value ?? "auto").Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
        return normalized switch
        {
            "" => "auto",
            "comicvine" => "comicvine",
            "googlebooks" => "googlebooks",
            _ => normalized
        };
    }

    private static string Clean(string? value, int maximumLength)
    {
        var normalized = value?.Trim() ?? string.Empty;
        return normalized.Length <= maximumLength ? normalized : normalized[..maximumLength];
    }

    private static string? CleanNullable(string? value, int maximumLength)
    {
        var cleaned = Clean(value, maximumLength);
        return cleaned.Length == 0 ? null : cleaned;
    }

    private static string? Bound(string? value, int maximumLength) => CleanNullable(value, maximumLength);
}
