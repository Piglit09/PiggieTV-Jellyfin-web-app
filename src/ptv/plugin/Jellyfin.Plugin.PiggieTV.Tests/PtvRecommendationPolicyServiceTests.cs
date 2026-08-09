using System.Security.Claims;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Jellyfin.Plugin.PiggieTV.Api;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvRecommendationPolicyServiceTests
{
    [Fact]
    public void RadioUsesPremiumSurfaceConstraints()
    {
        var constraints = PtvRecommendationPolicyService.GetConstraints(PtvRecommendationSurface.Radio);

        Assert.Equal(0.75, constraints.DiscoveryTarget);
        Assert.Equal(0.25, constraints.FamiliarTarget);
        Assert.Equal(2, constraints.MaxConsecutiveArtist);
        Assert.Equal(2, constraints.MaxItemsPerAlbum);
    }

    [Fact]
    public void RadioIsDeterministicAndRejectsUnrelatedCandidates()
    {
        var service = new PtvRecommendationPolicyService();
        var request = CreateRequest();
        request.Candidates.Add(Candidate(
            "unrelated",
            "Unrelated",
            "artist-z",
            "album-z",
            ["country"],
            "discovery",
            false,
            500));

        var first = service.Rank(request);
        request.Candidates.Reverse();
        var repeated = service.Rank(request);

        Assert.Equal(first.Items.Select(item => item.Id), repeated.Items.Select(item => item.Id));
        Assert.DoesNotContain(first.Items, item => item.Id == "unrelated");
        Assert.All(first.Items, item => Assert.Contains(item.Reasons, reason => reason.StartsWith("shared-", StringComparison.Ordinal)));
    }

    [Fact]
    public void RadioAvoidsThirdConsecutiveArtistAndHonorsArtistCaps()
    {
        var service = new PtvRecommendationPolicyService();
        var request = CreateRequest();

        var response = service.Rank(request);
        var ids = response.Items.Select(item => item.Id).ToArray();

        Assert.Equal(6, ids.Length);
        Assert.InRange(ids.Take(3).Count(id => id.StartsWith("a", StringComparison.Ordinal)), 1, 2);
        Assert.InRange(ids.Count(id => id.StartsWith("a", StringComparison.Ordinal)), 1, 3);
        Assert.Equal(Enumerable.Range(1, response.Items.Count), response.Items.Select(item => item.Rank));
    }

    [Fact]
    public void RadioRejectsMalformedSeedAffinity()
    {
        var service = new PtvRecommendationPolicyService();
        var request = CreateRequest();
        request.Seed = new PtvRecommendationPolicySeed { Id = "seed" };

        var exception = Assert.Throws<PtvRecommendationPolicyValidationException>(() => service.Rank(request));

        Assert.Equal("PTV_RECOMMENDATION_RADIO_SEED_INVALID", exception.Code);
    }

    [Fact]
    public void RadioReportsWhenValidSeedHasNoCandidateAffinity()
    {
        var service = new PtvRecommendationPolicyService();
        var request = CreateRequest();
        request.Seed = new PtvRecommendationPolicySeed
        {
            ArtistIds = ["missing-artist"],
            Id = "seed"
        };

        var response = service.Rank(request);

        Assert.Empty(response.Items);
        Assert.Equal("seed-affinity-required", response.FallbackReason);
    }

    [Fact]
    public void FallbackReasonsDistinguishSupplyFromDiversity()
    {
        var service = new PtvRecommendationPolicyService();
        var supplyRequest = CreateRequest();
        supplyRequest.Limit = supplyRequest.Candidates.Count + 1;

        var supplyResponse = service.Rank(supplyRequest);

        Assert.Equal("insufficient-candidates", supplyResponse.FallbackReason);

        var diversityRequest = CreateRequest();
        diversityRequest.Surface = PtvRecommendationSurface.Related;
        diversityRequest.Limit = 4;
        diversityRequest.Candidates =
        [
            Candidate("same-1", "Same One", "same-artist", "same-album-1", ["alternative"], "affinity", true, 4),
            Candidate("same-2", "Same Two", "same-artist", "same-album-2", ["alternative"], "affinity", true, 3),
            Candidate("same-3", "Same Three", "same-artist", "same-album-3", ["alternative"], "affinity", true, 2),
            Candidate("same-4", "Same Four", "same-artist", "same-album-4", ["alternative"], "affinity", true, 1)
        ];

        var diversityResponse = service.Rank(diversityRequest);

        Assert.Equal("insufficient-diverse-candidates", diversityResponse.FallbackReason);
    }

    [Fact]
    public void MissingRequestIdAndDuplicateTiesAreInputOrderIndependent()
    {
        var service = new PtvRecommendationPolicyService();
        var request = CreateRequest();
        request.RequestId = null;
        request.Candidates.Add(Candidate(
            "duplicate",
            "Long Duplicate",
            "artist-b",
            "album-x",
            ["alternative"],
            "discovery",
            false,
            50));
        request.Candidates.Add(Candidate(
            "duplicate",
            "Alt Duplicate",
            "artist-c",
            "album-y",
            ["alternative"],
            "discovery",
            false,
            50));

        var first = service.Rank(request);
        request.Candidates.Reverse();
        var reversed = service.Rank(request);

        Assert.Equal(64, first.RequestId.Length);
        Assert.Equal(first.RequestId, reversed.RequestId);
        Assert.Equal(
            first.Items.Select(item => (item.Id, item.Title)),
            reversed.Items.Select(item => (item.Id, item.Title)));
        Assert.Single(first.Items, item => item.Id == "duplicate");
    }

    [Theory]
    [InlineData("unsupported-policy", 6, "PTV_RECOMMENDATION_POLICY_UNSUPPORTED")]
    [InlineData("music-premium-v2", 0, "PTV_RECOMMENDATION_LIMIT_INVALID")]
    [InlineData("music-premium-v2", 201, "PTV_RECOMMENDATION_LIMIT_INVALID")]
    public void InvalidPolicyAndLimitsAreRejected(string policyVersion, int limit, string expectedCode)
    {
        var service = new PtvRecommendationPolicyService();
        var request = CreateRequest();
        request.PolicyVersion = policyVersion;
        request.Limit = limit;

        var exception = Assert.Throws<PtvRecommendationPolicyValidationException>(() => service.Rank(request));

        Assert.Equal(expectedCode, exception.Code);
    }

    [Fact]
    public void UnknownSurfaceAndInvalidCandidatesAreRejected()
    {
        var service = new PtvRecommendationPolicyService();
        var request = CreateRequest();
        request.Surface = (PtvRecommendationSurface)999;

        var surfaceError = Assert.Throws<PtvRecommendationPolicyValidationException>(() => service.Rank(request));
        Assert.Equal("PTV_RECOMMENDATION_SURFACE_UNSUPPORTED", surfaceError.Code);

        request = CreateRequest();
        request.Candidates[0].BaseScore = double.NaN;
        var candidateError = Assert.Throws<PtvRecommendationPolicyValidationException>(() => service.Rank(request));
        Assert.Equal("PTV_RECOMMENDATION_CANDIDATE_INVALID", candidateError.Code);
    }

    [Fact]
    public void ResponseAlwaysIdentifiesTheImplementedPolicy()
    {
        var response = new PtvRecommendationPolicyService().Rank(CreateRequest());

        Assert.Equal("music-premium-v2", response.PolicyVersion);
        Assert.Equal("ptv-diversified-sequence-v2", response.AlgorithmId);
    }

    [Fact]
    public void ControllerDerivesUserAndServerScopesFromTheAuthenticatedRequest()
    {
        var userId = Guid.NewGuid();
        var fakeService = new FakePolicyService();
        var controller = CreateController(fakeService, userId, "server-system-id");
        var request = CreateRequest();
        request.UserId = "current-user";
        request.ServerId = "current-server";

        var action = controller.Rank(request);

        Assert.IsType<OkObjectResult>(action.Result);
        Assert.Equal(1, fakeService.RankCalls);
        Assert.NotNull(fakeService.LastRequest);
        Assert.Equal(userId.ToString("N"), fakeService.LastRequest.UserId);
        Assert.Equal("server-system-id", fakeService.LastRequest.ServerId);
    }

    [Fact]
    public void ControllerRejectsMissingOrMismatchedAuthenticatedScope()
    {
        var userId = Guid.NewGuid();
        var fakeService = new FakePolicyService();
        var request = CreateRequest();
        request.UserId = "current-user";
        request.ServerId = "current-server";

        var unauthenticated = CreateController(fakeService, null, "server-system-id").Rank(request);
        Assert.IsType<UnauthorizedObjectResult>(unauthenticated.Result);

        request = CreateRequest();
        request.UserId = Guid.NewGuid().ToString("N");
        request.ServerId = "current-server";
        var wrongUser = CreateController(fakeService, userId, "server-system-id").Rank(request);
        Assert.Equal(
            StatusCodes.Status403Forbidden,
            Assert.IsType<ObjectResult>(wrongUser.Result).StatusCode);

        request = CreateRequest();
        request.UserId = "current-user";
        request.ServerId = "another-server";
        var wrongServer = CreateController(fakeService, userId, "server-system-id").Rank(request);
        Assert.Equal(
            StatusCodes.Status403Forbidden,
            Assert.IsType<ObjectResult>(wrongServer.Result).StatusCode);
        Assert.Equal(0, fakeService.RankCalls);
    }

    [Fact]
    public void ControllerReturnsStructuredErrorsForRuntimePolicyValidation()
    {
        var userId = Guid.NewGuid();
        var controller = CreateController(new PtvRecommendationPolicyService(), userId, "server-system-id");
        var request = CreateRequest();
        request.UserId = "current-user";
        request.ServerId = "current-server";
        request.PolicyVersion = "future-policy";

        var unsupported = controller.Rank(request);
        var unsupportedResult = Assert.IsType<BadRequestObjectResult>(unsupported.Result);
        Assert.Equal(
            "PTV_RECOMMENDATION_POLICY_UNSUPPORTED",
            Assert.IsType<PtvErrorResponse>(unsupportedResult.Value).Code);

        request = CreateRequest();
        request.UserId = "current-user";
        request.ServerId = "current-server";
        request.Seed = new PtvRecommendationPolicySeed { Id = "seed" };
        var malformedRadio = controller.Rank(request);
        var malformedResult = Assert.IsType<BadRequestObjectResult>(malformedRadio.Result);
        Assert.Equal(
            "PTV_RECOMMENDATION_RADIO_SEED_INVALID",
            Assert.IsType<PtvErrorResponse>(malformedResult.Value).Code);
    }

    [Fact]
    public void PersistedRecommendationsCannotEchoAnotherUserScope()
    {
        var userId = Guid.NewGuid();
        var controller = CreateController(new FakePolicyService(), userId, "server-system-id");

        var action = controller.GetPersistedRecommendations("current-server", Guid.NewGuid().ToString("N"));

        Assert.Equal(
            StatusCodes.Status403Forbidden,
            Assert.IsType<ObjectResult>(action).StatusCode);
    }

    [Fact]
    public void ClassificationIsAuthoritativeWhenLegacyFamiliarHintConflicts()
    {
        var discovery = Candidate("d", "Discovery", "artist-d", "album-d", ["alternative"], "discovery", true, 1);
        var affinity = Candidate("a", "Affinity", "artist-a", "album-a", ["alternative"], "affinity", false, 1);
        var mixed = Candidate("m", "Mixed", "artist-m", "album-m", ["alternative"], "mixed", false, 1);

        Assert.True(PtvRecommendationPolicyService.IsDiscovery(discovery));
        Assert.False(PtvRecommendationPolicyService.IsDiscovery(affinity));
        Assert.False(PtvRecommendationPolicyService.IsDiscovery(mixed));
    }

    private static PtvRecommendationPolicyRequest CreateRequest() => new()
    {
        Candidates =
        [
            Candidate("a1", "A One", "artist-a", "album-b", ["alternative"], "affinity", true, 90),
            Candidate("a2", "A Two", "artist-a", "album-c", ["alternative"], "affinity", true, 88),
            Candidate("a3", "A Three", "artist-a", "album-d", ["alternative"], "affinity", true, 86),
            Candidate("b1", "B One", "artist-b", "album-e", ["alternative"], "discovery", false, 84),
            Candidate("c1", "C One", "artist-c", "album-f", ["alternative"], "discovery", false, 82),
            Candidate("d1", "D One", "artist-d", "album-g", ["alternative"], "discovery", false, 80)
        ],
        Cohort = "test",
        ContractVersion = "2.0",
        Limit = 6,
        PolicyVersion = "music-premium-v2",
        RequestId = "fixture-request",
        Seed = new PtvRecommendationPolicySeed
        {
            AlbumId = "album-a",
            ArtistIds = ["artist-a"],
            Genres = ["alternative"],
            Id = "seed"
        },
        ServerId = "server",
        Surface = PtvRecommendationSurface.Radio,
        UserId = "user"
    };

    private static PtvRecommendationPolicyCandidate Candidate(
        string id,
        string title,
        string artist,
        string album,
        List<string> genres,
        string classification,
        bool familiar,
        double score) => new()
        {
            AlbumId = album,
            ArtistIds = [artist],
            BaseScore = score,
            Classification = classification,
            Familiar = familiar,
            Genres = genres,
            Id = id,
            MediaType = "music",
            Source = "fixture",
            Title = title
        };

    private static PtvRecommendationController CreateController(
        IPtvRecommendationPolicyService service,
        Guid? userId,
        string serverSystemId)
    {
        var claims = userId is null
            ? Array.Empty<Claim>()
            : [new Claim("Jellyfin-UserId", userId.Value.ToString("N"))];
        return new PtvRecommendationController(service, () => serverSystemId)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"))
                }
            }
        };
    }

    private sealed class FakePolicyService : IPtvRecommendationPolicyService
    {
        public int RankCalls { get; private set; }

        public PtvRecommendationPolicyRequest? LastRequest { get; private set; }

        public PtvRecommendationPolicyResponse Rank(PtvRecommendationPolicyRequest request)
        {
            RankCalls++;
            LastRequest = request;
            return new PtvRecommendationPolicyResponse
            {
                PolicyVersion = "music-premium-v2",
                RequestId = request.RequestId ?? "derived",
                Surface = request.Surface
            };
        }
    }
}
