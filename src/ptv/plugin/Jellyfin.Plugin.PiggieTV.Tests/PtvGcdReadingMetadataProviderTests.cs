using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvGcdReadingMetadataProviderTests
{
    [Fact]
    public async Task DeadpoolSeriesSearchFollowsPagesAndMatchesDescriptorWithoutHardRunEvidence()
    {
        var firstPage = Page(
            [Series("100", "Unrelated", 2019, [("200", "8")])],
            "https://www.comics.org/api/series/name/Deadpool/?format=json&page=2");
        var secondPage = Page(
            [Series("152889", "Deadpool", 2020, [("2177000", "8"), ("2177121", "9 (324)"), ("2177222", "10")])]);
        var coordinator = new RecordingCoordinator((_, call) => Success(call == 1 ? firstPage : secondPage));
        var provider = new PtvGcdReadingMetadataProvider(coordinator);
        var query = ComicQuery("Deadpool", "009", 2019);

        var result = await provider.SearchAsync(query, CancellationToken.None);

        var candidate = Assert.Single(result.Candidates);
        Assert.Equal(2, coordinator.Calls.Count);
        Assert.Equal("gcd", candidate.Provider);
        Assert.Equal("2177121", candidate.ProviderId);
        Assert.Equal("152889", candidate.VolumeId);
        Assert.Equal("Deadpool", candidate.SeriesTitle);
        Assert.Equal("9", candidate.IssueNumber);
        Assert.Equal(2020, candidate.StartYear);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Provider, candidate.SeriesTitleEvidence);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Provider, candidate.IssueNumberEvidence);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Unknown, candidate.SeriesStartYearEvidence);
        Assert.Equal("2177121", candidate.ExternalIds["GCD"]);
        Assert.Equal("152889", candidate.ExternalIds["GCDSeries"]);
        Assert.Equal("https://www.comics.org/issue/2177121/", candidate.SourceUrl);
        Assert.Null(candidate.RawProviderMetadata);

        var score = new PtvReadingMetadataScorer().Score(query, candidate);
        Assert.False(score.HasHardConflict);
        Assert.False(score.IsRejected);
        Assert.DoesNotContain(score.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.SeriesRunYearMismatch);
    }

    [Theory]
    [InlineData("9", "009")]
    [InlineData("0", "#00")]
    [InlineData("1.5", "Issue #1.5")]
    [InlineData("Annual #001", "001")]
    [InlineData("Special 02", "02")]
    public async Task SearchNormalizesIssueDescriptors(string descriptor, string requested)
    {
        var provider = new PtvGcdReadingMetadataProvider(new RecordingCoordinator((_, _) =>
            Success(Page([Series("12", "Series", 2020, [("34", descriptor)])]))));
        var query = ComicQuery("Series", requested, 2020);
        query.EditionKind = descriptor.Contains("Annual", StringComparison.OrdinalIgnoreCase)
            ? PtvReadingEditionKind.Annual
            : descriptor.Contains("Special", StringComparison.OrdinalIgnoreCase)
                ? PtvReadingEditionKind.Special
                : PtvReadingEditionKind.Standard;

        var candidate = Assert.Single((await provider.SearchAsync(query, CancellationToken.None)).Candidates);

        Assert.Equal(PtvReadingMetadataParser.NormalizeNumber(
            System.Text.RegularExpressions.Regex.Match(requested, "[0-9]+(?:\\.[0-9]+)?").Value), candidate.IssueNumber);
    }

    [Fact]
    public async Task SearchExcludesIssueMismatchBeforeSharedScoring()
    {
        var provider = new PtvGcdReadingMetadataProvider(new RecordingCoordinator((_, _) => Success(Page(
        [
            Series("1", "Deadpool", 2020, [("11", "6"), ("12", "9"), ("13", "10")])
        ]))));

        var candidates = (await provider.SearchAsync(ComicQuery("Deadpool", "9", 2019), CancellationToken.None)).Candidates;

        var candidate = Assert.Single(candidates);
        Assert.Equal("12", candidate.ProviderId);
        Assert.Equal("9", candidate.IssueNumber);
    }

    [Fact]
    public async Task SearchRetainsCorrectCandidateBeyondPositionThirtyForSharedRanking()
    {
        var series = Enumerable.Range(1, 40)
            .Select(index => Series(
                index.ToString(),
                index == 40 ? "Deadpool" : $"Unrelated {index}",
                2020,
                [((1000 + index).ToString(), "9")]))
            .ToArray();
        var provider = new PtvGcdReadingMetadataProvider(new RecordingCoordinator((_, _) => Success(Page(series))));

        var candidates = (await provider.SearchAsync(ComicQuery("Deadpool", "9", 2019), CancellationToken.None)).Candidates;

        Assert.Equal(40, candidates.Count);
        Assert.Contains(candidates, candidate => candidate.ProviderId == "1040" && candidate.SeriesTitle == "Deadpool");
    }

    [Fact]
    public async Task SearchCapsRawCandidatesAtTwoHundredFiftySix()
    {
        var series = Enumerable.Range(1, 300)
            .Select(index => Series(
                index.ToString(),
                $"Series {index}",
                2020,
                [((1000 + index).ToString(), "9")]))
            .ToArray();
        var provider = new PtvGcdReadingMetadataProvider(new RecordingCoordinator((_, _) => Success(Page(series))));

        var candidates = (await provider.SearchAsync(ComicQuery("Series", "9", 2020), CancellationToken.None)).Candidates;

        Assert.Equal(256, candidates.Count);
        Assert.Contains(candidates, candidate => candidate.ProviderId == "1256");
        Assert.DoesNotContain(candidates, candidate => candidate.ProviderId == "1257");
    }

    [Fact]
    public async Task DirectIssueLookupReturnsRichBoundedMetadataAndSafeUrls()
    {
        var coordinator = new RecordingCoordinator((_, _) => Success(DeadpoolIssue));
        var provider = new PtvGcdReadingMetadataProvider(coordinator);

        var candidate = await provider.GetByIdAsync("2177121", CancellationToken.None);

        Assert.NotNull(candidate);
        Assert.Equal("Deadpool", candidate.SeriesTitle);
        Assert.Equal("9", candidate.IssueNumber);
        Assert.Equal(2020, candidate.StartYear);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Unknown, candidate.SeriesStartYearEvidence);
        Assert.Equal(2020, candidate.IssuePublicationYear);
        Assert.Equal(new DateTimeOffset(2020, 12, 16, 0, 0, 0, TimeSpan.Zero), candidate.IssuePublicationDate);
        Assert.Equal("Marvel Worldwide Inc.", candidate.Publisher);
        Assert.Equal("https://files1.comics.org/img/gcd/covers_by_id/1405/w400/1405107.jpg", candidate.CoverUrl);
        Assert.Equal("https://www.comics.org/issue/2177121/", candidate.SourceUrl);
        Assert.Equal("152889", candidate.ExternalIds["GCDSeries"]);
        Assert.Contains(candidate.Authors, credit => credit.Name == "Kelly Thompson" && credit.Role == "Writer");
        Assert.Contains(candidate.Artists, credit => credit.Name == "Gerardo Sandoval" && credit.Role == "Pencils");
        Assert.Equal("Deadpool fights safely.", candidate.Description);
        Assert.Contains("superhero", candidate.Genres);
        Assert.Null(candidate.RawProviderMetadata);
        Assert.Single(coordinator.Calls);
    }

    [Theory]
    [InlineData("")]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("2177121/../../settings")]
    [InlineData("2177121?token=secret")]
    [InlineData("not-a-number")]
    public async Task DirectLookupRejectsNonNumericOrMutableIdentity(string id)
    {
        var coordinator = new RecordingCoordinator((_, _) => Success(DeadpoolIssue));
        var provider = new PtvGcdReadingMetadataProvider(coordinator);

        Assert.Null(await provider.GetByIdAsync(id, CancellationToken.None));
        Assert.Empty(coordinator.Calls);
    }

    [Fact]
    public async Task SearchUsesEncodedPathAndConservativeAnonymousTransportPolicy()
    {
        var coordinator = new RecordingCoordinator((_, _) => Success(Page([])));
        var provider = new PtvGcdReadingMetadataProvider(coordinator);

        await provider.SearchAsync(ComicQuery("Deadpool/../?token=secret", "9", 2019), CancellationToken.None);

        var policy = Assert.Single(coordinator.Calls);
        using var request = policy.CreateRequest();
        Assert.Equal(1, policy.MaximumConcurrency);
        Assert.Equal(TimeSpan.FromSeconds(2), policy.MinimumInterval);
        Assert.Equal(TimeSpan.FromSeconds(15), policy.Timeout);
        Assert.Equal(TimeSpan.FromDays(7), policy.CacheTtl);
        Assert.Equal(TimeSpan.FromMinutes(60), policy.HeaderlessRateLimitBackoff);
        Assert.Equal(4 * 1024 * 1024, policy.MaximumResponseBytes);
        Assert.Equal(["page", "title"], policy.Key.Parameters.Keys.Order(StringComparer.Ordinal));
        Assert.Equal("www.comics.org", request.RequestUri?.Host);
        Assert.Contains("Deadpool%2F..%2F%3Ftoken%3Dsecret", request.RequestUri?.AbsoluteUri, StringComparison.Ordinal);
        Assert.DoesNotContain("token=secret", request.RequestUri?.AbsoluteUri, StringComparison.Ordinal);
        Assert.NotEmpty(request.Headers.UserAgent);
        Assert.Null(request.Headers.Authorization);
    }

    [Fact]
    public async Task MonthOnlyPublicationDateRetainsYearWithoutInventingDayPrecision()
    {
        var monthOnly = DeadpoolIssue
            .Replace("\"on_sale_date\":\"2020-12-16\"", "\"on_sale_date\":\"\"", StringComparison.Ordinal)
            .Replace("\"key_date\":\"2021-02-00\"", "\"key_date\":\"\"", StringComparison.Ordinal);
        var provider = new PtvGcdReadingMetadataProvider(new RecordingCoordinator((_, _) => Success(monthOnly)));

        var candidate = await provider.GetByIdAsync("2177121", CancellationToken.None);

        Assert.NotNull(candidate);
        Assert.Equal(2021, candidate.IssuePublicationYear);
        Assert.Null(candidate.IssuePublicationDate);
    }

    [Fact]
    public async Task MalformedAndSchemaDriftResponsesFailSafelyWithoutRawPayload()
    {
        var malformed = new PtvGcdReadingMetadataProvider(new RecordingCoordinator((_, _) => Success("not-json")));
        var malformedResult = await malformed.SearchAsync(ComicQuery("Deadpool", "9", 2019), CancellationToken.None);
        Assert.Equal(PtvReadingProviderFailureKind.Parse, malformedResult.Failure?.Kind);
        Assert.Empty(malformedResult.Candidates);

        var drift = new PtvGcdReadingMetadataProvider(new RecordingCoordinator((_, _) => Success(
            "{\"next\":null,\"results\":[{\"api_url\":42,\"active_issues\":{},\"issue_descriptors\":[null]}]}")));
        var driftResult = await drift.SearchAsync(ComicQuery("Deadpool", "9", 2019), CancellationToken.None);
        Assert.Equal(PtvReadingProviderState.Available, driftResult.State);
        Assert.Empty(driftResult.Candidates);

        var hostileDetail = DeadpoolIssue.Replace(
            "https://files1.comics.org/img/gcd/covers_by_id/1405/w400/1405107.jpg",
            "https://evil.example/cover.jpg?token=secret",
            StringComparison.Ordinal);
        var detailProvider = new PtvGcdReadingMetadataProvider(new RecordingCoordinator((_, _) => Success(hostileDetail)));
        var detail = await detailProvider.GetByIdAsync("2177121", CancellationToken.None);
        Assert.NotNull(detail);
        Assert.Null(detail.CoverUrl);
        Assert.Null(detail.RawProviderMetadata);
    }

    [Fact]
    public async Task RateLimitAndStatusRemainNormalizedAndMentionAttribution()
    {
        var failure = new PtvReadingMetadataHttpResult
        {
            Failure = new PtvReadingProviderFailure
            {
                Provider = "gcd",
                Kind = PtvReadingProviderFailureKind.RateLimit,
                Code = "provider-rate-limit-active",
                Message = "The provider asked PiggieTV to pause requests.",
                RetryAfterSeconds = 3600
            }
        };
        var coordinator = new RecordingCoordinator((_, _) => failure)
        {
            Status = new PtvReadingProviderStatus
            {
                Provider = "gcd",
                State = PtvReadingProviderState.RateLimited,
                Message = "The provider asked PiggieTV to pause requests.",
                RetryAfterSeconds = 3600
            }
        };
        var provider = new PtvGcdReadingMetadataProvider(coordinator);

        var result = await provider.SearchAsync(ComicQuery("Deadpool", "9", 2019), CancellationToken.None);
        var status = await provider.GetStatusAsync(CancellationToken.None);

        Assert.Equal(PtvReadingProviderState.RateLimited, result.State);
        Assert.Equal(PtvReadingProviderFailureKind.RateLimit, result.Failure?.Kind);
        Assert.Equal(PtvReadingProviderState.RateLimited, status.State);
        Assert.Contains("CC BY-SA", status.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("key", status.Message ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void PluginRegistrationIncludesGrandComicsDatabaseProvider()
    {
        var services = new ServiceCollection();
        new PluginServiceRegistrator().RegisterServices(services, applicationHost: null!);

        var providers = services
            .Where(descriptor => descriptor.ServiceType == typeof(IPtvReadingMetadataProvider))
            .Select(descriptor => descriptor.ImplementationType)
            .ToArray();

        Assert.Equal(5, providers.Length);
        Assert.Contains(typeof(PtvGcdReadingMetadataProvider), providers);
    }

    private static PtvStructuredMetadataQuery ComicQuery(string series, string issue, int runYear) => new()
    {
        RawTitle = $"{series} {issue}",
        CleanedTitle = series,
        SeriesTitle = series,
        SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.FileName,
        IssueNumber = issue,
        IssueNumberEvidence = PtvReadingIdentityEvidenceSource.FileName,
        SeriesStartYear = runYear,
        SeriesStartYearEvidence = PtvReadingIdentityEvidenceSource.Folder,
        MediaClass = PtvReadingMediaClass.Comic
    };

    private static object Series(
        string seriesId,
        string name,
        int year,
        IReadOnlyList<(string Id, string Descriptor)> issues) => new
        {
            api_url = $"https://www.comics.org/api/series/{seriesId}/?format=json",
            name,
            country = "us",
            language = "en",
            active_issues = issues.Select(issue => $"https://www.comics.org/api/issue/{issue.Id}/?format=json").ToArray(),
            issue_descriptors = issues.Select(issue => issue.Descriptor).ToArray(),
            year_began = year,
            year_ended = (int?)null,
            publishing_format = "ongoing series",
            publisher = "https://www.comics.org/api/publisher/78/?format=json"
        };

    private static string Page(IEnumerable<object> series, string? next = null) => JsonSerializer.Serialize(new
    {
        count = series.Count(),
        next,
        previous = (string?)null,
        results = series
    });

    private static PtvReadingMetadataHttpResult Success(string body) => new()
    {
        Succeeded = true,
        StatusCode = 200,
        Body = body,
        DurationMilliseconds = 4
    };

    private sealed class RecordingCoordinator(
        Func<PtvReadingMetadataHttpRequest, int, PtvReadingMetadataHttpResult> resultFactory)
        : IPtvReadingMetadataRequestCoordinator
    {
        public List<PtvReadingMetadataHttpRequest> Calls { get; } = [];

        public PtvReadingProviderStatus Status { get; set; } = new()
        {
            Provider = "gcd",
            State = PtvReadingProviderState.Available,
            Message = "Ready"
        };

        public Task<PtvReadingMetadataHttpResult> ExecuteAsync(
            PtvReadingMetadataHttpRequest request,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Calls.Add(request);
            return Task.FromResult(resultFactory(request, Calls.Count));
        }

        public PtvReadingProviderStatus GetStatus(string provider) => Status;
    }

    private const string DeadpoolIssue = """
        {
          "api_url":"https://www.comics.org/api/issue/2177121/?format=json",
          "series_name":"Deadpool (2020 series)",
          "descriptor":"9 (324)",
          "number":"9 (324)",
          "volume":"",
          "variant_name":"",
          "title":"King of the Monsters",
          "publication_date":"February 2021",
          "key_date":"2021-02-00",
          "on_sale_date":"2020-12-16",
          "indicia_publisher":"Marvel Worldwide Inc.",
          "series":"https://www.comics.org/api/series/152889/?format=json",
          "story_set":[{
            "type":"comic story",
            "script":"Kelly Thompson",
            "pencils":"Gerardo Sandoval",
            "inks":"Victor Nava",
            "colors":"Chris Sotomayor",
            "letters":"Joe Sabino",
            "genre":"humor; superhero",
            "synopsis":"<b>Deadpool</b> fights safely."
          }],
          "cover":"https://files1.comics.org/img/gcd/covers_by_id/1405/w400/1405107.jpg"
        }
        """;
}
