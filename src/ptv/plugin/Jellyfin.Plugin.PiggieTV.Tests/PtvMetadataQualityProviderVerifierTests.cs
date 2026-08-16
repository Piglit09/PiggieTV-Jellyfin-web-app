using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Model.Providers;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvMetadataQualityProviderVerifierTests
{
    [Fact]
    public async Task VerifyAsyncReturnsAtMostFiveNormalizedCandidates()
    {
        var verifier = CreateVerifier((_, _) => Task.FromResult<IEnumerable<RemoteSearchResult>>(
            Enumerable.Range(0, 8).Select(index => new RemoteSearchResult
            {
                Name = $"Candidate {index}",
                ProductionYear = 1980 + index,
                SearchProviderName = "Test provider",
                ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                {
                    ["Tmdb"] = (1000 + index).ToString()
                }
            })));
        var budget = new PtvMetadataProviderVerificationBudget(2);

        var result = await verifier.VerifyAsync(CreateRequest("Movie", "The Thing"), budget, CancellationToken.None);

        Assert.True(result.Available);
        Assert.True(result.Attempted);
        Assert.False(result.CacheHit);
        Assert.Equal(1, result.LogicalRequestCount);
        Assert.Equal(1, budget.Consumed);
        Assert.Equal(5, result.Candidates.Count);
        Assert.All(result.Candidates, candidate => Assert.Equal("Movie", candidate.Type));
        Assert.Equal("1000", result.Candidates[0].ProviderIds["Tmdb"]);
    }

    [Fact]
    public async Task VerifyAsyncKeepsBoundedReadingPoolForRankingWithoutExtraProviderCalls()
    {
        var lookups = 0;
        var verifier = CreateVerifier((_, _) =>
        {
            Interlocked.Increment(ref lookups);
            return Task.FromResult<IEnumerable<RemoteSearchResult>>(
                Enumerable.Range(1, 8).Select(issue => new RemoteSearchResult
                {
                    Name = $"#{issue:D3}",
                    ProductionYear = 2020,
                    IndexNumber = issue,
                    SearchProviderName = "Comic Vine",
                    ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                    {
                        ["ComicVine"] = $"issue-{issue}"
                    }
                }));
        });
        var request = CreateRequest("Book", "Deadpool 009 (2019)");
        request.ProviderIds.Clear();
        request.MediaClass = PtvReadingMediaClass.Comic;
        request.SeriesTitle = "Deadpool";
        request.NormalizedIssueNumber = "9";
        request.SeriesStartYear = 2019;
        request.EvidenceName = "different path title";
        var budget = new PtvMetadataProviderVerificationBudget(2);

        var result = await verifier.VerifyAsync(request, budget, CancellationToken.None);

        Assert.True(result.Available);
        Assert.True(result.Attempted);
        Assert.Equal(1, lookups);
        Assert.Equal(1, budget.Consumed);
        Assert.Equal(8, result.Candidates.Count);
        Assert.All(result.Candidates, candidate =>
        {
            Assert.Equal(PtvReadingMediaClass.Comic, candidate.MediaClass);
            Assert.Null(candidate.SeriesTitle);
            Assert.Null(candidate.SeriesStartYear);
            Assert.Equal(2020, candidate.IssuePublicationYear);
            Assert.Null(candidate.VolumeId);
        });
        Assert.Equal("1", result.Candidates[0].NormalizedIssueNumber);
    }

    [Fact]
    public async Task VerifyAsyncRetainsReadingCandidateBeyondPositionThirtyForDownstreamScoring()
    {
        var verifier = CreateVerifier((_, _) => Task.FromResult<IEnumerable<RemoteSearchResult>>(
            Enumerable.Range(1, 75).Select(index => new RemoteSearchResult
            {
                Name = index == 40 ? "Deadpool 009 (2019)" : $"Unrelated Series {index} #006",
                ProductionYear = index == 40 ? 2020 : 2026,
                IndexNumber = index == 40 ? 9 : 6,
                SearchProviderName = "Comic Vine",
                ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                {
                    ["ComicVine"] = index == 40 ? "77815" : $"unrelated-{index}"
                }
            })));
        var request = CreateRequest("Book", "Deadpool 009 (2019)");
        request.ProviderIds.Clear();
        request.MediaClass = PtvReadingMediaClass.Comic;
        request.SeriesTitle = "Deadpool";
        request.NormalizedIssueNumber = "9";
        request.SeriesStartYear = 2019;

        var result = await verifier.VerifyAsync(
            request,
            new PtvMetadataProviderVerificationBudget(1),
            CancellationToken.None);

        Assert.Equal(75, result.Candidates.Count);
        var candidate = Assert.Single(result.Candidates, candidate => candidate.ProviderIds.GetValueOrDefault("ComicVine") == "77815");
        Assert.Equal("9", candidate.NormalizedIssueNumber);
        Assert.Equal(2019, candidate.SeriesStartYear);
        Assert.Equal(2020, candidate.IssuePublicationYear);
    }

    [Fact]
    public async Task VerifyAsyncSeparatesExplicitComicRunYearFromIssuePublicationYear()
    {
        var verifier = CreateVerifier((_, _) => Task.FromResult<IEnumerable<RemoteSearchResult>>(
        [
            new RemoteSearchResult
            {
                Name = "Deadpool 009 (2019)",
                ProductionYear = 2020,
                IndexNumber = 9,
                SearchProviderName = "Comic Vine",
                ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                {
                    ["ComicVine"] = "77815"
                }
            }
        ]));
        var request = CreateRequest("Book", "Deadpool 009 (2019)");
        request.ProviderIds.Clear();

        var result = await verifier.VerifyAsync(
            request,
            new PtvMetadataProviderVerificationBudget(1),
            CancellationToken.None);

        var candidate = Assert.Single(result.Candidates);
        Assert.Equal("Deadpool", candidate.SeriesTitle);
        Assert.Equal("9", candidate.NormalizedIssueNumber);
        Assert.Equal(2019, candidate.SeriesStartYear);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Provider, candidate.SeriesStartYearEvidence);
        Assert.Equal(2020, candidate.IssuePublicationYear);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Provider, candidate.IssuePublicationEvidence);
    }

    [Fact]
    public async Task VerifyAsyncUsesCacheWithoutConsumingBudgetAgain()
    {
        var lookups = 0;
        var verifier = CreateVerifier((_, _) =>
        {
            Interlocked.Increment(ref lookups);
            return Task.FromResult<IEnumerable<RemoteSearchResult>>(
            [
                new RemoteSearchResult { Name = "The Thing", ProductionYear = 1982 }
            ]);
        });
        var request = CreateRequest("Movie", "The Thing");
        var budget = new PtvMetadataProviderVerificationBudget(1);

        var first = await verifier.VerifyAsync(request, budget, CancellationToken.None);
        first.Candidates[0].Name = "Caller mutation";
        var second = await verifier.VerifyAsync(request, budget, CancellationToken.None);

        Assert.Equal(1, lookups);
        Assert.Equal(1, budget.Consumed);
        Assert.True(second.CacheHit);
        Assert.False(second.Attempted);
        Assert.Equal(0, second.LogicalRequestCount);
        Assert.Equal("The Thing", second.Candidates[0].Name);
    }

    [Fact]
    public async Task VerifyAsyncUsesPathYearEvidenceToSurfaceWrongRemakeCandidate()
    {
        var requests = new List<PtvMetadataProviderVerificationRequest>();
        var verifier = CreateVerifier((request, _) =>
        {
            requests.Add(request);
            if (request.ProviderIds.Count > 0)
            {
                return Task.FromResult<IEnumerable<RemoteSearchResult>>(
                    Enumerable.Range(0, 5).Select(index => new RemoteSearchResult
                    {
                        Name = index == 0 ? "The Thing" : $"Current candidate {index}",
                        ProductionYear = 2011,
                        ProviderIds = new Dictionary<string, string> { ["Tmdb"] = (60935 + index).ToString() }
                    }));
            }

            return Task.FromResult<IEnumerable<RemoteSearchResult>>(
            [
                new RemoteSearchResult
                {
                    Name = "The Thing",
                    ProductionYear = 1982,
                    ProviderIds = new Dictionary<string, string> { ["Tmdb"] = "1091" }
                }
            ]);
        });
        var request = CreateRequest("Movie", "The Thing");
        request.ProductionYear = 2011;
        request.ProviderIds["Tmdb"] = "60935";
        request.EvidenceName = "The.Thing.1982.2160p";
        request.EvidenceYear = 1982;
        var budget = new PtvMetadataProviderVerificationBudget(2);

        var result = await verifier.VerifyAsync(request, budget, CancellationToken.None);

        Assert.True(result.Available);
        Assert.Equal(2, result.LogicalRequestCount);
        Assert.Equal(2, budget.Consumed);
        Assert.Equal(2, requests.Count);
        Assert.Equal("the thing", requests[1].Name);
        Assert.Equal(1982, requests[1].ProductionYear);
        Assert.Empty(requests[1].ProviderIds);
        Assert.Contains(result.Candidates, candidate => candidate.ProviderIds.GetValueOrDefault("Tmdb") == "1091");
        Assert.Equal(5, result.Candidates.Count);
    }

    [Fact]
    public async Task VerifyAsyncDoesNotRunPathEvidenceSearchWhenSecondBudgetIsUnavailable()
    {
        var lookups = 0;
        var verifier = CreateVerifier((_, _) =>
        {
            Interlocked.Increment(ref lookups);
            return Task.FromResult<IEnumerable<RemoteSearchResult>>(
            [
                new RemoteSearchResult { Name = "The Thing", ProductionYear = 2011 }
            ]);
        });
        var request = CreateRequest("Movie", "The Thing");
        request.ProductionYear = 2011;
        request.EvidenceName = "The Thing";
        request.EvidenceYear = 1982;
        var budget = new PtvMetadataProviderVerificationBudget(1);

        var result = await verifier.VerifyAsync(request, budget, CancellationToken.None);

        Assert.True(result.Available);
        Assert.Equal("alternate-budget-exhausted", result.ErrorCode);
        Assert.Equal(1, result.LogicalRequestCount);
        Assert.Equal(1, budget.Consumed);
        Assert.Equal(1, lookups);
    }

    [Fact]
    public async Task VerifyAsyncDoesNotRunExtraSearchWhenPathEvidenceMatches()
    {
        var lookups = 0;
        var verifier = CreateVerifier((_, _) =>
        {
            Interlocked.Increment(ref lookups);
            return Task.FromResult<IEnumerable<RemoteSearchResult>>(
            [
                new RemoteSearchResult { Name = "The Thing", ProductionYear = 1982 }
            ]);
        });
        var request = CreateRequest("Movie", "The Thing");
        request.EvidenceName = "The.Thing.1982.2160p";
        request.EvidenceYear = 1982;
        var budget = new PtvMetadataProviderVerificationBudget(2);

        var result = await verifier.VerifyAsync(request, budget, CancellationToken.None);

        Assert.True(result.Available);
        Assert.Equal(1, result.LogicalRequestCount);
        Assert.Equal(1, budget.Consumed);
        Assert.Equal(1, lookups);
    }

    [Theory]
    [InlineData("Episode")]
    [InlineData("Season")]
    [InlineData("Audio")]
    [InlineData("Unknown")]
    public async Task VerifyAsyncDoesNotSearchUnsupportedItemTypes(string itemType)
    {
        var lookups = 0;
        var verifier = CreateVerifier((_, _) =>
        {
            Interlocked.Increment(ref lookups);
            return Task.FromResult<IEnumerable<RemoteSearchResult>>([]);
        });
        var budget = new PtvMetadataProviderVerificationBudget(1);

        var result = await verifier.VerifyAsync(CreateRequest(itemType, "Item"), budget, CancellationToken.None);

        Assert.False(result.Available);
        Assert.False(result.Attempted);
        Assert.Equal("unsupported-item-type", result.ErrorCode);
        Assert.Equal(0, budget.Consumed);
        Assert.Equal(0, lookups);
    }

    [Theory]
    [InlineData("Movie")]
    [InlineData("Series")]
    [InlineData("BoxSet")]
    [InlineData("Book")]
    [InlineData("MusicAlbum")]
    [InlineData("MusicArtist")]
    public async Task VerifyAsyncSearchesOnlyTheSupportedTypedFamilies(string itemType)
    {
        var lookups = 0;
        var verifier = CreateVerifier((_, _) =>
        {
            Interlocked.Increment(ref lookups);
            return Task.FromResult<IEnumerable<RemoteSearchResult>>([]);
        });

        var result = await verifier.VerifyAsync(
            CreateRequest(itemType, "Supported"),
            new PtvMetadataProviderVerificationBudget(1),
            CancellationToken.None);

        Assert.True(result.Available);
        Assert.True(result.Attempted);
        Assert.Equal(1, lookups);
    }

    [Fact]
    public async Task VerifyAsyncHonorsPerRunBudget()
    {
        var lookups = 0;
        var verifier = CreateVerifier((_, _) =>
        {
            Interlocked.Increment(ref lookups);
            return Task.FromResult<IEnumerable<RemoteSearchResult>>([]);
        });

        var result = await verifier.VerifyAsync(
            CreateRequest("Movie", "Item"),
            new PtvMetadataProviderVerificationBudget(0),
            CancellationToken.None);

        Assert.False(result.Available);
        Assert.False(result.Attempted);
        Assert.Equal("budget-exhausted", result.ErrorCode);
        Assert.Equal(0, lookups);
    }

    [Fact]
    public async Task VerifyAsyncBoundsConcurrentRemoteLookupsAtTwo()
    {
        var active = 0;
        var maximumActive = 0;
        var verifier = CreateVerifier(async (_, cancellationToken) =>
        {
            var current = Interlocked.Increment(ref active);
            maximumActive = Math.Max(maximumActive, current);
            try
            {
                await Task.Delay(35, cancellationToken);
                return [];
            }
            finally
            {
                Interlocked.Decrement(ref active);
            }
        });
        var budget = new PtvMetadataProviderVerificationBudget(10);

        await Task.WhenAll(Enumerable.Range(0, 6).Select(index => verifier.VerifyAsync(
            CreateRequest("Movie", $"Item {index}"),
            budget,
            CancellationToken.None)));

        Assert.InRange(maximumActive, 1, 2);
        Assert.Equal(6, budget.Consumed);
    }

    [Fact]
    public async Task VerifyAsyncSingleFlightsIdenticalConcurrentLookups()
    {
        var lookups = 0;
        var verifier = CreateVerifier(async (_, cancellationToken) =>
        {
            Interlocked.Increment(ref lookups);
            await Task.Delay(25, cancellationToken);
            return [new RemoteSearchResult { Name = "Shared" }];
        });
        var budget = new PtvMetadataProviderVerificationBudget(10);
        var request = CreateRequest("Movie", "Shared");

        var results = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ =>
            verifier.VerifyAsync(request, budget, CancellationToken.None)));

        Assert.Equal(1, lookups);
        Assert.Equal(1, budget.Consumed);
        Assert.Single(results, result => result.Attempted);
        Assert.Equal(4, results.Count(result => result.CacheHit));
    }

    [Fact]
    public async Task VerifyAsyncTimesOutWithoutThrowingAwayScannerProgress()
    {
        var verifier = CreateVerifier(
            async (_, cancellationToken) =>
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                return [];
            },
            TimeSpan.FromMilliseconds(20));

        var result = await verifier.VerifyAsync(
            CreateRequest("Movie", "Slow"),
            new PtvMetadataProviderVerificationBudget(1),
            CancellationToken.None);

        Assert.False(result.Available);
        Assert.True(result.Attempted);
        Assert.Equal("timeout", result.ErrorCode);
    }

    [Fact]
    public async Task VerifyAsyncPropagatesCallerCancellation()
    {
        var verifier = CreateVerifier(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return [];
        });
        using var cancellationSource = new CancellationTokenSource(TimeSpan.FromMilliseconds(20));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => verifier.VerifyAsync(
            CreateRequest("Movie", "Cancelled"),
            new PtvMetadataProviderVerificationBudget(1),
            cancellationSource.Token));
    }

    [Fact]
    public async Task FailedUniqueLookupsDoNotLeaveAnUnboundedSingleFlightGateSet()
    {
        var verifier = CreateVerifier((_, _) => throw new InvalidOperationException("provider offline"));

        for (var index = 0; index < 4200; index++)
        {
            await verifier.VerifyAsync(
                CreateRequest("Movie", $"Unavailable {index}"),
                new PtvMetadataProviderVerificationBudget(1),
                CancellationToken.None);
        }

        Assert.InRange(verifier.LookupGateCount, 0, 4096);
    }

    private static PtvMetadataQualityProviderVerifier CreateVerifier(
        Func<PtvMetadataProviderVerificationRequest, CancellationToken, Task<IEnumerable<RemoteSearchResult>>> lookup,
        TimeSpan? timeout = null) => new(
            lookup,
            NullLogger<PtvMetadataQualityProviderVerifier>.Instance,
            timeout ?? TimeSpan.FromSeconds(2),
            maxConcurrency: 2);

    private static PtvMetadataProviderVerificationRequest CreateRequest(string itemType, string name) => new()
    {
        ItemId = Guid.NewGuid(),
        ItemType = itemType,
        Name = name,
        ProductionYear = 1982,
        ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Tmdb"] = "1091"
        }
    };
}
