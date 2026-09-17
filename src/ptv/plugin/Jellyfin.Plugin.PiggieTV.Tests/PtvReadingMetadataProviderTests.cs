using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Providers;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvReadingMetadataProviderTests
{
    [Fact]
    public async Task AniListNormalizesLocalizedTitlesCreditsAndPlainTextDescription()
    {
        var coordinator = new StubCoordinator(_ => Success(AnilistSearchJson));
        var provider = new PtvAniListReadingMetadataProvider(coordinator);

        var result = await provider.SearchAsync(Query("Vagabond", PtvReadingMediaClass.Manga), CancellationToken.None);

        var candidate = Assert.Single(result.Candidates);
        Assert.Equal(PtvReadingProviderState.Available, result.State);
        Assert.Equal("30013", candidate.ProviderId);
        Assert.Equal("Vagabond", candidate.Title);
        Assert.Equal("バガボンド", candidate.LocalizedTitles["ja"]);
        Assert.Equal(PtvReadingMediaClass.Manga, candidate.MediaClass);
        Assert.Contains(candidate.Authors, credit => credit.Name == "Takehiko Inoue");
        Assert.Contains(candidate.Artists, credit => credit.Name == "Takehiko Inoue");
        Assert.Equal("A wandering swordsman learns restraint.", candidate.Description);
        Assert.DoesNotContain('<', candidate.Description!);
        Assert.Equal("30013", candidate.ExternalIds["AniList"]);
        Assert.Null(candidate.RawProviderMetadata);
    }

    [Fact]
    public async Task AniListKeepsUsableCandidatesWhenGraphQlReturnsPartialErrors()
    {
        var partial = AnilistSearchJson.Replace(
            "{\"data\"",
            "{\"errors\":[{\"message\":\"one field unavailable\"}],\"data\"",
            StringComparison.Ordinal);
        var provider = new PtvAniListReadingMetadataProvider(new StubCoordinator(_ => Success(partial)));

        var result = await provider.SearchAsync(Query("Vagabond", PtvReadingMediaClass.Manga), CancellationToken.None);

        Assert.Equal(PtvReadingProviderState.Available, result.State);
        Assert.Single(result.Candidates);
        Assert.Equal("anilist-partial-response", result.Failure?.Code);
        Assert.DoesNotContain("one field", result.Failure?.Message ?? string.Empty, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task AniListMalformedAndUnavailableResponsesDegradeIndependently()
    {
        var malformedProvider = new PtvAniListReadingMetadataProvider(new StubCoordinator(_ => Success("not-json")));
        var malformed = await malformedProvider.SearchAsync(Query("Item", PtvReadingMediaClass.Manga), CancellationToken.None);
        Assert.Equal(PtvReadingProviderFailureKind.Parse, malformed.Failure?.Kind);

        var failure = new PtvReadingMetadataHttpResult
        {
            Failure = new PtvReadingProviderFailure
            {
                Provider = "anilist",
                Kind = PtvReadingProviderFailureKind.RateLimit,
                Code = "provider-rate-limit-active",
                Message = "The provider asked PiggieTV to pause requests.",
                RetryAfterSeconds = 20
            }
        };
        var unavailableProvider = new PtvAniListReadingMetadataProvider(new StubCoordinator(_ => failure));
        var unavailable = await unavailableProvider.SearchAsync(Query("Item", PtvReadingMediaClass.Manga), CancellationToken.None);
        Assert.Equal(PtvReadingProviderState.RateLimited, unavailable.State);
        Assert.Empty(unavailable.Candidates);
    }

    [Fact]
    public async Task MangaDexNormalizesAliasesRelationshipsAndSafeCover()
    {
        var provider = new PtvMangaDexReadingMetadataProvider(new StubCoordinator(_ => Success(MangaDexSearchJson)));

        var result = await provider.SearchAsync(Query("Solo Leveling", PtvReadingMediaClass.Manhwa), CancellationToken.None);

        var candidate = Assert.Single(result.Candidates);
        Assert.Equal(PtvReadingMediaClass.Manhwa, candidate.MediaClass);
        Assert.Equal("Solo Leveling", candidate.Title);
        Assert.Equal("나 혼자만 레벨업", candidate.LocalizedTitles["ko"]);
        Assert.Contains("I Level Up Alone", candidate.AlternateTitles);
        Assert.Contains(candidate.Authors, credit => credit.Name == "Chugong");
        Assert.Contains(candidate.Artists, credit => credit.Name == "DUBU");
        Assert.StartsWith("https://uploads.mangadex.org/covers/", candidate.CoverUrl);
        Assert.Equal("77", candidate.ExternalIds["AniList"]);
        Assert.Equal("A hunter grows stronger.", candidate.Description);
    }

    [Fact]
    public async Task MangaDexDirectLookupUsesOneOptionalAggregateRequestWithoutSearchFanout()
    {
        var operations = new List<string>();
        var coordinator = new StubCoordinator(request =>
        {
            operations.Add(request.Key.Operation);
            return Success(request.Key.Operation == "aggregate"
                ? MangaDexAggregateJson
                : MangaDexDirectJson);
        });
        var provider = new PtvMangaDexReadingMetadataProvider(coordinator);

        var candidate = await provider.GetByIdAsync("f9c33607-9180-4ba6-b85c-e4b5faee7192", CancellationToken.None);

        Assert.NotNull(candidate);
        Assert.Equal(2, candidate.TotalVolumes);
        Assert.Equal(17, candidate.TotalChapters);
        Assert.Equal(["by-id", "aggregate"], operations);
    }

    [Fact]
    public async Task GoogleBooksAdapterUsesExistingLookupAndReturnsNoRawDto()
    {
        var lookup = new StubGoogleBooksLookup(new PtvGoogleBooksMetadataLookupResponse
        {
            Ok = true,
            Provider = { Enabled = true, Cached = true },
            Candidates =
            [
                new PtvGoogleBooksMetadataCandidate
                {
                    Name = "Understanding Comics",
                    Overview = "<p>Sequential art &amp; visual language.</p>",
                    Authors = ["Scott McCloud"],
                    Publisher = "HarperCollins",
                    ImageUrl = "https://books.google.com/cover.jpg",
                    ProviderIds = new Dictionary<string, string>
                    {
                        ["GoogleBooks"] = "abc123",
                        ["ISBN13"] = "9780060976255"
                    }
                }
            ]
        });
        var provider = new PtvGoogleBooksReadingMetadataProvider(lookup);

        var result = await provider.SearchAsync(Query("Understanding Comics", PtvReadingMediaClass.Book), CancellationToken.None);

        var candidate = Assert.Single(result.Candidates);
        Assert.True(result.CacheHit);
        Assert.Equal("abc123", candidate.ProviderId);
        Assert.Equal("Sequential art & visual language.", candidate.Description);
        Assert.Equal("9780060976255", candidate.Isbn13);
        Assert.Null(candidate.RawProviderMetadata);
        Assert.Equal("Understanding Comics", lookup.LastRequest?.Title);
    }

    [Fact]
    public async Task ComicVineUsesOneStructuredBookQueryAndReplacesDuplicateProviderKeySafely()
    {
        RemoteSearchQuery<BookInfo>? captured = null;
        var provider = new PtvComicVineReadingMetadataProvider(
            (query, _) =>
            {
                captured = query;
                return Task.FromResult<IEnumerable<RemoteSearchResult>>
                ([
                    new RemoteSearchResult
                    {
                        Name = "Saga #1",
                        ProductionYear = 2012,
                        PremiereDate = new DateTime(2012, 3, 14, 0, 0, 0, DateTimeKind.Utc),
                        IndexNumber = 1,
                        SearchProviderName = "Comic Vine",
                        ImageUrl = "https://comicvine.gamespot.com/cover.jpg",
                        ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                        {
                            ["ComicVine"] = "4000-1234"
                        }
                    }
                ]);
            },
            () => true,
            NullLogger<PtvComicVineReadingMetadataProvider>.Instance);
        var query = Query("Saga", PtvReadingMediaClass.Comic);
        query.SeriesTitle = "Saga";
        query.IssueNumber = "1";
        query.VolumeNumber = "2";
        query.SeriesStartYear = 2012;
        query.ExistingProviderIds["comic vine"] = "stale";
        query.ProviderId = new PtvReadingProviderIdentifier { Provider = "comic-vine", Id = "4000-1234" };

        var result = await provider.SearchAsync(query, CancellationToken.None);

        var candidate = Assert.Single(result.Candidates);
        Assert.NotNull(captured);
        Assert.Equal("Comic Vine", captured.SearchProviderName);
        Assert.Equal("Saga", captured.SearchInfo.SeriesName);
        Assert.Equal(2012, captured.SearchInfo.Year);
        Assert.Equal(1, captured.SearchInfo.IndexNumber);
        Assert.Equal(2, captured.SearchInfo.ParentIndexNumber);
        Assert.Single(captured.SearchInfo.ProviderIds);
        Assert.Equal("4000-1234", captured.SearchInfo.ProviderIds["Comic Vine"]);
        Assert.Equal("4000-1234", candidate.ProviderId);
        Assert.Equal("1", candidate.IssueNumber);
        Assert.Equal(2012, candidate.IssuePublicationYear);
        Assert.Equal(2012, candidate.IssuePublicationDate?.Year);
        Assert.Null(candidate.StartYear);
        Assert.Equal("Saga", candidate.SeriesTitle);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Provider, candidate.SeriesTitleEvidence);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Provider, candidate.IssueNumberEvidence);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Provider, candidate.IssuePublicationEvidence);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Unknown, candidate.SeriesStartYearEvidence);
    }

    [Fact]
    public async Task ComicVineNormalizesDefaultIssueTitleWithoutInventingSeriesRun()
    {
        var provider = new PtvComicVineReadingMetadataProvider(
            (_, _) => Task.FromResult<IEnumerable<RemoteSearchResult>>
            ([
                new RemoteSearchResult
                {
                    Name = "#009",
                    ProductionYear = 2020,
                    PremiereDate = new DateTime(2020, 1, 15, 0, 0, 0, DateTimeKind.Utc),
                    SearchProviderName = "Comic Vine",
                    ProviderIds = new Dictionary<string, string>
                    {
                        ["ComicVine"] = "77815"
                    }
                }
            ]),
            () => true,
            NullLogger<PtvComicVineReadingMetadataProvider>.Instance);
        var query = Query("Deadpool", PtvReadingMediaClass.Comic);
        query.SeriesTitle = "Deadpool";
        query.SeriesStartYear = 2019;
        query.IssueNumber = "009";

        var candidate = Assert.Single((await provider.SearchAsync(query, CancellationToken.None)).Candidates);

        Assert.Equal("9", candidate.IssueNumber);
        Assert.Equal(2020, candidate.Year);
        Assert.Equal(2020, candidate.IssuePublicationYear);
        Assert.Equal(2020, candidate.IssuePublicationDate?.Year);
        Assert.Null(candidate.StartYear);
        Assert.Null(candidate.SeriesTitle);
        Assert.Null(candidate.VolumeId);
    }

    [Fact]
    public async Task ComicVinePreservesDecimalIssueTextWhenBookInfoCannotRepresentIt()
    {
        RemoteSearchQuery<BookInfo>? captured = null;
        var provider = new PtvComicVineReadingMetadataProvider(
            (query, _) =>
            {
                captured = query;
                return Task.FromResult<IEnumerable<RemoteSearchResult>>
                ([
                    new RemoteSearchResult
                    {
                        Name = "Deadpool #1.5",
                        SearchProviderName = "Comic Vine",
                        ProviderIds = new Dictionary<string, string> { ["ComicVine"] = "4000-decimal" }
                    }
                ]);
            },
            () => true,
            NullLogger<PtvComicVineReadingMetadataProvider>.Instance);
        var query = Query("Deadpool #1.5", PtvReadingMediaClass.Comic);
        query.SeriesTitle = "Deadpool";
        query.IssueNumber = "1.5";

        var candidate = Assert.Single((await provider.SearchAsync(query, CancellationToken.None)).Candidates);

        Assert.NotNull(captured);
        Assert.Null(captured.SearchInfo.IndexNumber);
        Assert.Equal("Deadpool #1.5", captured.SearchInfo.OriginalTitle);
        Assert.Equal("Deadpool", candidate.SeriesTitle);
        Assert.Equal("1.5", candidate.IssueNumber);
    }

    [Fact]
    public async Task ComicVineReportsExplicitAnnualEditionAsProviderEvidence()
    {
        var provider = new PtvComicVineReadingMetadataProvider(
            (_, _) => Task.FromResult<IEnumerable<RemoteSearchResult>>
            ([
                new RemoteSearchResult
                {
                    Name = "X-Men Annual #1",
                    IndexNumber = 1,
                    SearchProviderName = "Comic Vine",
                    ProviderIds = new Dictionary<string, string> { ["ComicVine"] = "4000-annual" }
                }
            ]),
            () => true,
            NullLogger<PtvComicVineReadingMetadataProvider>.Instance);

        var candidate = Assert.Single((await provider.SearchAsync(Query("X-Men Annual #1", PtvReadingMediaClass.Comic), CancellationToken.None)).Candidates);

        Assert.Equal("X-Men", candidate.SeriesTitle);
        Assert.Equal(PtvReadingEditionKind.Annual, candidate.EditionKind);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Provider, candidate.EditionKindEvidence);
    }

    [Fact]
    public async Task ComicVineRetainsBoundedRawCandidatesBeyondPublicLimitForDownstreamScoring()
    {
        var raw = Enumerable.Range(1, 300)
            .Select(index => new RemoteSearchResult
            {
                Name = index == 40 ? "Deadpool #9" : $"Unrelated Series {index} #9",
                IndexNumber = 9,
                SearchProviderName = "Comic Vine",
                ProviderIds = new Dictionary<string, string> { ["ComicVine"] = $"4000-{index}" }
            })
            .ToArray();
        var provider = new PtvComicVineReadingMetadataProvider(
            (_, _) => Task.FromResult<IEnumerable<RemoteSearchResult>>(raw),
            () => true,
            NullLogger<PtvComicVineReadingMetadataProvider>.Instance);

        var result = await provider.SearchAsync(Query("Deadpool", PtvReadingMediaClass.Comic), CancellationToken.None);

        Assert.Equal(256, result.Candidates.Count);
        Assert.Contains(result.Candidates, candidate => candidate.ProviderId == "4000-40");
        Assert.Contains(result.Candidates, candidate => candidate.ProviderId == "4000-256");
        Assert.DoesNotContain(result.Candidates, candidate => candidate.ProviderId == "4000-257");
    }

    [Fact]
    public async Task ComicVineCancelledOnlyFlightRemovesItselfWhenSharedLookupFinishes()
    {
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var provider = new PtvComicVineReadingMetadataProvider(
            async (_, cancellationToken) =>
            {
                await release.Task.WaitAsync(cancellationToken);
                return [];
            },
            () => true,
            NullLogger<PtvComicVineReadingMetadataProvider>.Instance);
        using var cancellationSource = new CancellationTokenSource(TimeSpan.FromMilliseconds(5));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            provider.SearchAsync(Query("Saga", PtvReadingMediaClass.Comic), cancellationSource.Token));
        release.SetResult();
        await Task.Delay(30);

        Assert.Equal(0, provider.InflightCount);
    }

    private static PtvStructuredMetadataQuery Query(string title, PtvReadingMediaClass mediaClass) => new()
    {
        RawTitle = title,
        CleanedTitle = title,
        MediaClass = mediaClass
    };

    private static PtvReadingMetadataHttpResult Success(string body) => new()
    {
        Succeeded = true,
        StatusCode = 200,
        Body = body,
        DurationMilliseconds = 4
    };

    private sealed class StubCoordinator(
        Func<PtvReadingMetadataHttpRequest, PtvReadingMetadataHttpResult> resultFactory) : IPtvReadingMetadataRequestCoordinator
    {
        public Task<PtvReadingMetadataHttpResult> ExecuteAsync(
            PtvReadingMetadataHttpRequest request,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(resultFactory(request));
        }

        public PtvReadingProviderStatus GetStatus(string provider) => new()
        {
            Provider = provider,
            State = PtvReadingProviderState.Available,
            Message = "Ready"
        };
    }

    private sealed class StubGoogleBooksLookup(PtvGoogleBooksMetadataLookupResponse response) : IPtvGoogleBooksMetadataLookupService
    {
        public PtvGoogleBooksMetadataLookupRequest? LastRequest { get; private set; }

        public Task<PtvGoogleBooksMetadataLookupResponse> SearchAsync(
            PtvGoogleBooksMetadataLookupRequest request,
            CancellationToken cancellationToken)
        {
            LastRequest = request;
            return Task.FromResult(response);
        }
    }

    private const string AnilistSearchJson = """
        {"data":{"Page":{"media":[{
          "id":30013,"idMal":656,
          "title":{"romaji":"Vagabond","english":"Vagabond","native":"バガボンド","userPreferred":"Vagabond"},
          "synonyms":["Musashi"],"format":"MANGA","status":"HIATUS",
          "description":"<b>A wandering swordsman</b> learns restraint.",
          "startDate":{"year":1998,"month":9,"day":3},"endDate":{"year":null,"month":null,"day":null},
          "chapters":327,"volumes":37,"countryOfOrigin":"JP",
          "coverImage":{"extraLarge":"https://s4.anilist.co/file/cover.jpg","large":null,"medium":null},
          "bannerImage":"https://s4.anilist.co/file/banner.jpg","genres":["Action","Drama"],
          "tags":[{"name":"Samurai","rank":95,"isMediaSpoiler":false,"isGeneralSpoiler":false}],
          "staff":{"edges":[{"role":"Story & Art","node":{"id":90193,"name":{"full":"Takehiko Inoue","native":"井上雄彦"}}}]},
          "siteUrl":"https://anilist.co/manga/30013"
        }]}}}
        """;

    private const string MangaDexSearchJson = """
        {"result":"ok","data":[{
          "id":"f9c33607-9180-4ba6-b85c-e4b5faee7192","type":"manga",
          "attributes":{
            "title":{"en":"Solo Leveling","ko":"나 혼자만 레벨업"},
            "altTitles":[{"en":"I Level Up Alone"}],
            "description":{"en":"<p>A hunter grows stronger.</p>"},
            "originalLanguage":"ko","lastVolume":"14","lastChapter":"200","status":"completed","year":2018,
            "tags":[{"attributes":{"name":{"en":"Action"},"group":"genre"}}],
            "links":{"al":"77","mal":"52299"}
          },
          "relationships":[
            {"id":"11111111-1111-1111-1111-111111111111","type":"author","attributes":{"name":"Chugong"}},
            {"id":"22222222-2222-2222-2222-222222222222","type":"artist","attributes":{"name":"DUBU"}},
            {"id":"33333333-3333-3333-3333-333333333333","type":"cover_art","attributes":{"fileName":"cover.jpg"}}
          ]
        }]}
        """;

    private const string MangaDexDirectJson = """
        {"result":"ok","data":{
          "id":"f9c33607-9180-4ba6-b85c-e4b5faee7192","type":"manga",
          "attributes":{"title":{"en":"Solo Leveling"},"altTitles":[],"description":{"en":"Description"},"originalLanguage":"ko","lastVolume":null,"lastChapter":null,"status":"completed","year":2018,"tags":[],"links":{}},
          "relationships":[]
        }}
        """;

    private const string MangaDexAggregateJson = """
        {"result":"ok","volumes":{"1":{"volume":"1","count":10,"chapters":{"1":{"chapter":"1"},"10":{"chapter":"10"}}},"2":{"volume":"2","count":7,"chapters":{"11":{"chapter":"11"},"17":{"chapter":"17"}}}}}
        """;
}
