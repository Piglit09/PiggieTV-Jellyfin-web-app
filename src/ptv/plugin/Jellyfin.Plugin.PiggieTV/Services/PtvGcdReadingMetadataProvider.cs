using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Anonymous, read-only adapter for the Grand Comics Database initial API. This provider is
/// intentionally used by explicit Reading Identify searches only; Metadata Quality bulk
/// verification has a separate provider contract and does not call it.
/// </summary>
public sealed partial class PtvGcdReadingMetadataProvider : IPtvReadingMetadataProvider
{
    private const string ProviderId = "gcd";
    private const string ApiRoot = "https://www.comics.org/api";
    private const string PublicRoot = "https://www.comics.org";
    private const int MaximumRawCandidates = 256;
    // Anonymous GCD access is currently limited to 30 requests/hour. Two series pages are
    // sufficient for the known Deadpool run while keeping one manual search to <= 2 calls.
    private const int MaximumSeriesPages = 2;
    private const int MaximumResponseBytes = 4 * 1024 * 1024;
    private static readonly TimeSpan CacheTtl = TimeSpan.FromDays(7);
    private static readonly string UserAgent =
        $"PiggieTV/{typeof(PtvGcdReadingMetadataProvider).Assembly.GetName().Version?.ToString(3) ?? "unknown"} (Jellyfin Reading metadata identification; https://github.com/Piglit09/PiggieTV-Jellyfin-web-app)";
    private readonly IPtvReadingMetadataRequestCoordinator _coordinator;

    /// <summary>Initializes the provider with PiggieTV's shared bounded request coordinator.</summary>
    /// <param name="coordinator">The request coordinator.</param>
    public PtvGcdReadingMetadataProvider(IPtvReadingMetadataRequestCoordinator coordinator)
    {
        _coordinator = coordinator ?? throw new ArgumentNullException(nameof(coordinator));
    }

    /// <inheritdoc />
    public string Id => ProviderId;

    /// <inheritdoc />
    public string DisplayName => "Grand Comics Database (GCD)";

    /// <inheritdoc />
    public bool Supports(PtvMetadataSearchContext context) =>
        context.MediaClassOverride is null
            or PtvReadingMediaClass.Unknown
            or PtvReadingMediaClass.Comic
            or PtvReadingMediaClass.GraphicNovel;

    /// <inheritdoc />
    public async Task<PtvReadingProviderSearchResult> SearchAsync(
        PtvStructuredMetadataQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (query.ProviderId is { } direct
            && direct.Provider.Equals(ProviderId, StringComparison.OrdinalIgnoreCase))
        {
            var directCandidate = await GetByIdAsync(direct.Id, cancellationToken).ConfigureAwait(false);
            return new PtvReadingProviderSearchResult
            {
                Provider = ProviderId,
                State = directCandidate is null
                    ? PtvReadingProviderState.Unreachable
                    : PtvReadingProviderState.Available,
                Candidates = directCandidate is null ? [] : [directCandidate]
            };
        }

        var seriesTitle = PtvReadingMetadataSafety.Text(query.SeriesTitle ?? query.CleanedTitle, 256);
        var issueNumber = NormalizeIssueNumber(query.IssueNumber);
        if (seriesTitle is null || issueNumber is null)
        {
            return BadRequest("A comic series title and issue number are required for GCD search.");
        }

        var candidates = new List<PtvNormalizedMetadataCandidate>();
        var identities = new HashSet<string>(StringComparer.Ordinal);
        var durationMilliseconds = 0L;
        var allCacheHits = true;
        PtvReadingProviderFailure? partialFailure = null;

        for (var page = 1; page <= MaximumSeriesPages && candidates.Count < MaximumRawCandidates; page++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var response = await _coordinator.ExecuteAsync(
                CreateRequest(
                    PtvReadingMetadataRequestKey.Create(
                        "series-search",
                        ("title", seriesTitle),
                        ("page", page.ToString(CultureInfo.InvariantCulture))),
                    BuildSeriesSearchUrl(seriesTitle, page)),
                cancellationToken).ConfigureAwait(false);
            durationMilliseconds += Math.Max(0, response.DurationMilliseconds);
            allCacheHits &= response.CacheHit;

            if (!response.Succeeded || string.IsNullOrWhiteSpace(response.Body))
            {
                if (candidates.Count == 0)
                {
                    return FromTransport(response, durationMilliseconds);
                }

                partialFailure = response.Failure;
                break;
            }

            SeriesPage parsed;
            try
            {
                parsed = ParseSeriesPage(response.Body, issueNumber, candidates, identities);
            }
            catch (JsonException)
            {
                if (candidates.Count == 0)
                {
                    return ParseFailure(durationMilliseconds, allCacheHits);
                }

                partialFailure = ParseFailure(durationMilliseconds, allCacheHits).Failure;
                break;
            }

            if (!parsed.HasNextPage)
            {
                break;
            }
        }

        return new PtvReadingProviderSearchResult
        {
            Provider = ProviderId,
            State = PtvReadingProviderState.Available,
            Candidates = candidates,
            Failure = partialFailure,
            CacheHit = allCacheHits,
            DurationMilliseconds = durationMilliseconds
        };
    }

    /// <inheritdoc />
    public async Task<PtvNormalizedMetadataCandidate?> GetByIdAsync(
        string providerId,
        CancellationToken cancellationToken)
    {
        if (!TryNormalizeNumericId(providerId, out var issueId))
        {
            return null;
        }

        var response = await _coordinator.ExecuteAsync(
            CreateRequest(
                PtvReadingMetadataRequestKey.Create("issue-by-id", ("id", issueId)),
                $"{ApiRoot}/issue/{issueId}/?format=json"),
            cancellationToken).ConfigureAwait(false);
        if (!response.Succeeded || string.IsNullOrWhiteSpace(response.Body))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(response.Body, JsonOptions);
            return NormalizeIssueDetail(document.RootElement, issueId)?.ToBoundedTransportModel();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <inheritdoc />
    public Task<PtvReadingProviderStatus> GetStatusAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var status = _coordinator.GetStatus(ProviderId);
        return Task.FromResult(new PtvReadingProviderStatus
        {
            Provider = ProviderId,
            State = status.State,
            RetryAfterSeconds = status.RetryAfterSeconds,
            Message = status.State == PtvReadingProviderState.Available
                ? "Anonymous initial API ready. GCD data is available under CC BY-SA."
                : $"{PtvReadingMetadataSafety.Text(status.Message, 256) ?? "GCD is temporarily unavailable."} GCD data is CC BY-SA."
        });
    }

    private static string BuildSeriesSearchUrl(string seriesTitle, int page)
    {
        var url = $"{ApiRoot}/series/name/{Uri.EscapeDataString(seriesTitle)}/?format=json";
        return page <= 1 ? url : $"{url}&page={page.ToString(CultureInfo.InvariantCulture)}";
    }

    private static PtvReadingMetadataHttpRequest CreateRequest(
        PtvReadingMetadataRequestKey key,
        string url) => new()
        {
            Provider = ProviderId,
            Key = key,
            MaximumConcurrency = 1,
            MinimumInterval = TimeSpan.FromSeconds(2),
            Timeout = TimeSpan.FromSeconds(15),
            CacheTtl = CacheTtl,
            HeaderlessRateLimitBackoff = TimeSpan.FromMinutes(60),
            MaximumResponseBytes = MaximumResponseBytes,
            CreateRequest = () =>
            {
                var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                request.Headers.UserAgent.ParseAdd(UserAgent);
                return request;
            }
        };

    private static SeriesPage ParseSeriesPage(
        string body,
        string requestedIssue,
        ICollection<PtvNormalizedMetadataCandidate> candidates,
        ISet<string> identities)
    {
        using var document = JsonDocument.Parse(body, JsonOptions);
        if (!TryGet(document.RootElement, "results", out var results)
            || results.ValueKind != JsonValueKind.Array)
        {
            throw new JsonException("GCD series results were missing.");
        }

        foreach (var series in results.EnumerateArray())
        {
            if (candidates.Count >= MaximumRawCandidates)
            {
                break;
            }

            AddSeriesCandidates(series, requestedIssue, candidates, identities);
        }

        var hasNext = TryGet(document.RootElement, "next", out var next)
            && next.ValueKind == JsonValueKind.String
            && IsSafeNextPage(next.GetString());
        return new SeriesPage(hasNext);
    }

    private static void AddSeriesCandidates(
        JsonElement series,
        string requestedIssue,
        ICollection<PtvNormalizedMetadataCandidate> candidates,
        ISet<string> identities)
    {
        var seriesTitle = PtvReadingMetadataSafety.Text(GetString(series, "name"));
        if (seriesTitle is null
            || !TryExtractApiId(GetString(series, "api_url"), "series", out var seriesId)
            || !TryGet(series, "active_issues", out var issues)
            || issues.ValueKind != JsonValueKind.Array
            || !TryGet(series, "issue_descriptors", out var descriptors)
            || descriptors.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        var issueValues = issues.EnumerateArray().ToArray();
        var descriptorValues = descriptors.EnumerateArray().ToArray();
        var alignedCount = Math.Min(issueValues.Length, descriptorValues.Length);
        var yearBegan = GetInt(series, "year_began");
        var yearEnded = GetInt(series, "year_ended");
        var country = PtvReadingMetadataSafety.Text(GetString(series, "country"), 64);
        var language = PtvReadingMetadataSafety.Text(GetString(series, "language"), 64);
        var publishingFormat = PtvReadingMetadataSafety.Text(GetString(series, "publishing_format"), 128);

        for (var index = 0; index < alignedCount && candidates.Count < MaximumRawCandidates; index++)
        {
            if (issueValues[index].ValueKind != JsonValueKind.String
                || descriptorValues[index].ValueKind != JsonValueKind.String)
            {
                continue;
            }

            var descriptor = PtvReadingMetadataSafety.Text(descriptorValues[index].GetString(), 256);
            var normalizedIssue = NormalizeIssueNumber(descriptor);
            if (normalizedIssue is null
                || !normalizedIssue.Equals(requestedIssue, StringComparison.Ordinal)
                || !TryExtractApiId(issueValues[index].GetString(), "issue", out var issueId)
                || !identities.Add(issueId))
            {
                continue;
            }

            var editionKind = PtvReadingMetadataParser.DetectEditionKind(
                string.Join(' ', new[] { seriesTitle, descriptor, publishingFormat }.Where(value => !string.IsNullOrWhiteSpace(value))));
            var mediaClass = ClassifyMediaClass(editionKind, publishingFormat);
            var candidate = new PtvNormalizedMetadataCandidate
            {
                Provider = ProviderId,
                ProviderId = issueId,
                MediaClass = mediaClass,
                Title = $"{seriesTitle} #{normalizedIssue}",
                SeriesTitle = seriesTitle,
                SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.Provider,
                IssueNumber = normalizedIssue,
                IssueNumberEvidence = PtvReadingIdentityEvidenceSource.Provider,
                EditionKind = editionKind,
                EditionKindEvidence = editionKind == PtvReadingEditionKind.Standard
                    ? PtvReadingIdentityEvidenceSource.Unknown
                    : PtvReadingIdentityEvidenceSource.Provider,
                // GCD calls this a catalog year. It is useful for display, but cannot be used as
                // authoritative run evidence because catalog years can differ from local run labels.
                StartYear = yearBegan,
                SeriesStartYearEvidence = PtvReadingIdentityEvidenceSource.Unknown,
                EndYear = yearEnded,
                VolumeId = seriesId,
                CountryOfOrigin = country,
                Language = language,
                SourceUrl = $"{PublicRoot}/issue/{issueId}/"
            };
            candidate.ExternalIds["GCD"] = issueId;
            candidate.ExternalIds["GCDSeries"] = seriesId;
            candidate.IdentityProviderIds =
            [
                new() { Namespace = "GCD", Scope = PtvReadingProviderIdScope.Issue, Value = issueId },
                new() { Namespace = "GCDSeries", Scope = PtvReadingProviderIdScope.Series, Value = seriesId }
            ];
            candidates.Add(candidate.ToBoundedTransportModel());
        }
    }

    private static PtvNormalizedMetadataCandidate? NormalizeIssueDetail(JsonElement issue, string expectedIssueId)
    {
        if (issue.ValueKind != JsonValueKind.Object
            || !TryExtractApiId(GetString(issue, "api_url"), "issue", out var issueId)
            || !issueId.Equals(expectedIssueId, StringComparison.Ordinal)
            || !TryExtractApiId(GetString(issue, "series"), "series", out var seriesId))
        {
            return null;
        }

        var rawSeriesName = PtvReadingMetadataSafety.Text(GetString(issue, "series_name"));
        var issueNumber = NormalizeIssueNumber(GetString(issue, "number") ?? GetString(issue, "descriptor"));
        if (rawSeriesName is null || issueNumber is null)
        {
            return null;
        }

        var seriesTitle = NormalizeDetailSeriesName(rawSeriesName, out var catalogYear);
        var descriptor = PtvReadingMetadataSafety.Text(GetString(issue, "descriptor"), 256);
        var variant = PtvReadingMetadataSafety.Text(GetString(issue, "variant_name"), 256);
        var issueTitle = PtvReadingMetadataSafety.Text(GetString(issue, "title"));
        var editionKind = PtvReadingMetadataParser.DetectEditionKind(
            string.Join(' ', new[] { rawSeriesName, descriptor, variant, issueTitle }.Where(value => !string.IsNullOrWhiteSpace(value))));
        var publicationDate = ReadPublicationDate(issue);
        var publicationYear = publicationDate?.Year
            ?? ReadDateYear(GetString(issue, "key_date"))
            ?? ReadDateYear(GetString(issue, "publication_date"));
        var candidate = new PtvNormalizedMetadataCandidate
        {
            Provider = ProviderId,
            ProviderId = issueId,
            MediaClass = ClassifyMediaClass(editionKind, null),
            Title = $"{seriesTitle} #{issueNumber}",
            SeriesTitle = seriesTitle,
            SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.Provider,
            IssueNumber = issueNumber,
            IssueNumberEvidence = PtvReadingIdentityEvidenceSource.Provider,
            EditionKind = editionKind,
            EditionKindEvidence = editionKind == PtvReadingEditionKind.Standard
                ? PtvReadingIdentityEvidenceSource.Unknown
                : PtvReadingIdentityEvidenceSource.Provider,
            VolumeNumber = NormalizeIssueNumber(GetString(issue, "volume")),
            Year = publicationYear,
            StartYear = catalogYear,
            SeriesStartYearEvidence = PtvReadingIdentityEvidenceSource.Unknown,
            IssuePublicationYear = publicationYear,
            IssuePublicationDate = publicationDate,
            IssuePublicationEvidence = publicationYear is null
                ? PtvReadingIdentityEvidenceSource.Unknown
                : PtvReadingIdentityEvidenceSource.Provider,
            VolumeId = seriesId,
            Publisher = PtvReadingMetadataSafety.PlainText(GetString(issue, "indicia_publisher"), 512),
            CoverUrl = PtvReadingMetadataSafety.HttpUrl(GetString(issue, "cover"), "comics.org"),
            SourceUrl = $"{PublicRoot}/issue/{issueId}/"
        };
        if (issueTitle is not null)
        {
            candidate.AlternateTitles.Add(issueTitle);
        }

        AddStoryEvidence(candidate, issue);
        candidate.ExternalIds["GCD"] = issueId;
        candidate.ExternalIds["GCDSeries"] = seriesId;
        candidate.IdentityProviderIds =
        [
            new() { Namespace = "GCD", Scope = PtvReadingProviderIdScope.Issue, Value = issueId },
            new() { Namespace = "GCDSeries", Scope = PtvReadingProviderIdScope.Series, Value = seriesId }
        ];
        return candidate;
    }

    private static void AddStoryEvidence(PtvNormalizedMetadataCandidate candidate, JsonElement issue)
    {
        if (!TryGet(issue, "story_set", out var stories) || stories.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        var genres = new List<string?>();
        foreach (var story in stories.EnumerateArray().Take(16))
        {
            if (story.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            AddCredits(candidate.Authors, GetString(story, "script"), "Writer");
            AddCredits(candidate.Artists, GetString(story, "pencils"), "Pencils");
            AddCredits(candidate.Artists, GetString(story, "inks"), "Inks");
            AddCredits(candidate.Artists, GetString(story, "colors"), "Colors");
            AddCredits(candidate.Artists, GetString(story, "letters"), "Letters");
            genres.AddRange(SplitProviderList(GetString(story, "genre"), 16));
            candidate.Description ??= PtvReadingMetadataSafety.PlainText(GetString(story, "synopsis"));
        }

        candidate.Authors = candidate.Authors
            .DistinctBy(credit => $"{credit.Name}\n{credit.Role}", StringComparer.OrdinalIgnoreCase)
            .Take(32)
            .ToList();
        candidate.Artists = candidate.Artists
            .DistinctBy(credit => $"{credit.Name}\n{credit.Role}", StringComparer.OrdinalIgnoreCase)
            .Take(48)
            .ToList();
        candidate.Genres = PtvReadingMetadataSafety.Strings(genres, 32, 128);
    }

    private static void AddCredits(ICollection<PtvReadingPersonCredit> target, string? raw, string role)
    {
        foreach (var value in SplitProviderList(raw, 16))
        {
            if (value.Equals("None", StringComparison.OrdinalIgnoreCase)
                || value.Equals("?", StringComparison.Ordinal))
            {
                continue;
            }

            target.Add(new PtvReadingPersonCredit { Name = value, Role = role });
        }
    }

    private static IEnumerable<string> SplitProviderList(string? raw, int maximum)
    {
        var text = PtvReadingMetadataSafety.PlainText(raw, 2_048);
        return text is null
            ? []
            : text.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(value => PtvReadingMetadataSafety.Text(value, 512))
                .Where(value => value is not null)
                .Select(value => value!)
                .Take(maximum);
    }

    private static DateTimeOffset? ReadPublicationDate(JsonElement issue)
    {
        foreach (var field in new[] { "on_sale_date", "key_date", "publication_date" })
        {
            var raw = GetString(issue, field);
            if (DateTime.TryParseExact(
                    raw,
                    "yyyy-MM-dd",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out var parsed)
                && parsed.Year is >= 1000 and <= 3000
                && parsed.Day >= 1)
            {
                return new DateTimeOffset(parsed, TimeSpan.Zero);
            }
        }

        return null;
    }

    private static int? ReadDateYear(string? raw)
    {
        var match = YearPattern().Match(raw ?? string.Empty);
        return match.Success
            && int.TryParse(match.Groups["year"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var year)
            && year is >= 1000 and <= 3000
                ? year
                : null;
    }

    private static string NormalizeDetailSeriesName(string rawSeriesName, out int? catalogYear)
    {
        var match = SeriesCatalogSuffixPattern().Match(rawSeriesName);
        catalogYear = match.Success
            && int.TryParse(match.Groups["year"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var year)
            ? year
            : null;
        var title = match.Success ? rawSeriesName[..match.Index] : rawSeriesName;
        return PtvReadingMetadataSafety.Text(title) ?? rawSeriesName;
    }

    private static PtvReadingMediaClass ClassifyMediaClass(
        PtvReadingEditionKind editionKind,
        string? publishingFormat)
    {
        if (editionKind is PtvReadingEditionKind.TradePaperback or PtvReadingEditionKind.Omnibus
            || publishingFormat?.Contains("graphic novel", StringComparison.OrdinalIgnoreCase) == true
            || publishingFormat?.Contains("collected edition", StringComparison.OrdinalIgnoreCase) == true
            || publishingFormat?.Contains("trade paperback", StringComparison.OrdinalIgnoreCase) == true)
        {
            return PtvReadingMediaClass.GraphicNovel;
        }

        return PtvReadingMediaClass.Comic;
    }

    private static string? NormalizeIssueNumber(string? value)
    {
        var safe = PtvReadingMetadataSafety.Text(value, 256);
        if (safe is null)
        {
            return null;
        }

        var match = IssueNumberPattern().Match(safe);
        return match.Success
            ? PtvReadingMetadataParser.NormalizeNumber(match.Groups["number"].Value)
            : null;
    }

    private static bool TryNormalizeNumericId(string? value, out string normalized)
    {
        normalized = string.Empty;
        var safe = PtvReadingMetadataSafety.Text(value, 32);
        if (safe is null
            || !long.TryParse(safe, NumberStyles.None, CultureInfo.InvariantCulture, out var id)
            || id <= 0)
        {
            return false;
        }

        normalized = id.ToString(CultureInfo.InvariantCulture);
        return true;
    }

    private static bool TryExtractApiId(string? value, string resource, out string id)
    {
        id = string.Empty;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || (!uri.Host.Equals("www.comics.org", StringComparison.OrdinalIgnoreCase)
                && !uri.Host.Equals("comics.org", StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        var match = Regex.Match(
            uri.AbsolutePath,
            $"^/api/{Regex.Escape(resource)}/(?<id>[1-9][0-9]{{0,18}})/?$",
            RegexOptions.CultureInvariant,
            TimeSpan.FromMilliseconds(100));
        return match.Success && TryNormalizeNumericId(match.Groups["id"].Value, out id);
    }

    private static bool IsSafeNextPage(string? value)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && uri.Scheme == Uri.UriSchemeHttps
            && (uri.Host.Equals("www.comics.org", StringComparison.OrdinalIgnoreCase)
                || uri.Host.Equals("comics.org", StringComparison.OrdinalIgnoreCase))
            && uri.AbsolutePath.StartsWith("/api/series/name/", StringComparison.Ordinal)
            && !string.IsNullOrEmpty(uri.Query);
    }

    private static bool TryGet(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty(name, out value))
            {
                return true;
            }

            foreach (var property in element.EnumerateObject())
            {
                if (property.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
        }

        value = default;
        return false;
    }

    private static string? GetString(JsonElement element, string name) =>
        TryGet(element, name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int? GetInt(JsonElement element, string name)
    {
        if (!TryGet(element, name, out var value))
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
        {
            return number;
        }

        return value.ValueKind == JsonValueKind.String
            && int.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out number)
                ? number
                : null;
    }

    private static PtvReadingProviderSearchResult FromTransport(
        PtvReadingMetadataHttpResult response,
        long durationMilliseconds) => new()
        {
            Provider = ProviderId,
            State = response.Failure?.Kind switch
            {
                PtvReadingProviderFailureKind.RateLimit => PtvReadingProviderState.RateLimited,
                PtvReadingProviderFailureKind.Authentication => PtvReadingProviderState.Misconfigured,
                _ => PtvReadingProviderState.Unreachable
            },
            Failure = response.Failure,
            CacheHit = response.CacheHit,
            DurationMilliseconds = durationMilliseconds
        };

    private static PtvReadingProviderSearchResult ParseFailure(long durationMilliseconds, bool cacheHit) => new()
    {
        Provider = ProviderId,
        State = PtvReadingProviderState.Unreachable,
        CacheHit = cacheHit,
        DurationMilliseconds = durationMilliseconds,
        Failure = new PtvReadingProviderFailure
        {
            Provider = ProviderId,
            Kind = PtvReadingProviderFailureKind.Parse,
            Code = "gcd-malformed-response",
            Message = "Grand Comics Database returned an unreadable response."
        }
    };

    private static PtvReadingProviderSearchResult BadRequest(string message) => new()
    {
        Provider = ProviderId,
        State = PtvReadingProviderState.Available,
        Failure = new PtvReadingProviderFailure
        {
            Provider = ProviderId,
            Kind = PtvReadingProviderFailureKind.BadRequest,
            Code = "gcd-series-and-issue-required",
            Message = message
        }
    };

    private sealed record SeriesPage(bool HasNextPage);

    private static readonly JsonDocumentOptions JsonOptions = new()
    {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = 64
    };

    [GeneratedRegex(@"(?:^|\b)(?:(?:issue|number|no\.?|annual|special)\s*)?#?\s*(?<number>[0-9]+(?:\.[0-9]+)?)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex IssueNumberPattern();

    [GeneratedRegex(@"\s*\((?<year>[12][0-9]{3})(?:\s*[-–]\s*[12][0-9]{3})?\s+series\)\s*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SeriesCatalogSuffixPattern();

    [GeneratedRegex(@"(?<![0-9])(?<year>[12][0-9]{3})(?![0-9])", RegexOptions.CultureInvariant)]
    private static partial Regex YearPattern();
}
