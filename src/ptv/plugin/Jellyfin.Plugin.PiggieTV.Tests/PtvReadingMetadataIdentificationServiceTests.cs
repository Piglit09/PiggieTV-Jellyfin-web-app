using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvReadingMetadataIdentificationServiceTests
{
    [Fact]
    public void ControllerContractIsAdminOnlyBoundedAndObservational()
    {
        Assert.NotNull(Assert.Single(typeof(PtvReadingMetadataController)
            .GetCustomAttributes(typeof(AuthorizeAttribute), inherit: true)));
        Assert.Equal("Ptv/v1/reading/metadata", Assert.Single(typeof(PtvReadingMetadataController)
            .GetCustomAttributes(typeof(RouteAttribute), inherit: true)
            .Cast<RouteAttribute>()).Template);

        AssertRoute(nameof(PtvReadingMetadataController.GetProviders), typeof(HttpGetAttribute), "providers");
        AssertRoute(nameof(PtvReadingMetadataController.Search), typeof(HttpPostAttribute), "search");

        var declaredActions = typeof(PtvReadingMetadataController)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(method => method.GetCustomAttributes<HttpMethodAttribute>(inherit: true).Any())
            .ToArray();
        Assert.Equal(2, declaredActions.Length);
        Assert.DoesNotContain(declaredActions, method =>
            method.GetCustomAttributes(inherit: true).Any(attribute =>
                attribute is HttpPutAttribute or HttpPatchAttribute or HttpDeleteAttribute)
            || method.Name.Contains("apply", StringComparison.OrdinalIgnoreCase)
            || method.Name.Contains("fix", StringComparison.OrdinalIgnoreCase)
            || method.Name.Contains("update", StringComparison.OrdinalIgnoreCase)
            || method.Name.Contains("delete", StringComparison.OrdinalIgnoreCase));

        Assert.Equal(
            [nameof(IPtvReadingMetadataIdentificationService.GetProvidersAsync), nameof(IPtvReadingMetadataIdentificationService.SearchAsync)],
            typeof(IPtvReadingMetadataIdentificationService).GetMethods().Select(method => method.Name).Order().ToArray());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ElevationFailureBlocksBothEndpointsBeforeServiceCall(bool authenticated)
    {
        var service = new RecordingIdentificationService();
        var authorization = new RecordingAuthorizationService(allow: false);
        var controller = CreateController(service, authorization, authenticated);

        var providers = await controller.GetProviders(CancellationToken.None);
        var search = await controller.Search(new PtvReadingMetadataSearchRequest { ItemId = Guid.NewGuid().ToString("N") }, CancellationToken.None);

        Assert.IsType<ForbidResult>(providers.Result);
        Assert.IsType<ForbidResult>(search.Result);
        Assert.Equal(0, service.CallCount);
        Assert.Equal([Policies.RequiresElevation, Policies.RequiresElevation], authorization.PolicyNames);
    }

    [Fact]
    public async Task AdministratorCanReachBothReadOnlyIdentificationEndpoints()
    {
        var service = new RecordingIdentificationService();
        var authorization = new RecordingAuthorizationService(allow: true);
        var controller = CreateController(service, authorization);

        Assert.IsType<OkObjectResult>((await controller.GetProviders(CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.Search(
            new PtvReadingMetadataSearchRequest { ItemId = Guid.NewGuid().ToString("N") },
            CancellationToken.None)).Result);

        Assert.Equal(2, service.CallCount);
        Assert.Equal([Policies.RequiresElevation, Policies.RequiresElevation], authorization.PolicyNames);
    }

    [Fact]
    public async Task ControllerMapsExpectedItemErrorsWithoutLeakingExceptionDetails()
    {
        var invalid = CreateController(
            new ThrowingIdentificationService(new PtvReadingMetadataServiceException(
                "PTV_READING_ITEM_INVALID",
                "Choose a valid Reading item.")),
            new RecordingAuthorizationService(allow: true));
        var missing = CreateController(
            new ThrowingIdentificationService(new PtvReadingMetadataServiceException(
                "PTV_READING_ITEM_NOT_FOUND",
                "This Reading item is no longer available.")),
            new RecordingAuthorizationService(allow: true));
        var unexpected = CreateController(
            new ThrowingIdentificationService(new InvalidOperationException("secret backend detail")),
            new RecordingAuthorizationService(allow: true));

        var invalidResult = Assert.IsType<BadRequestObjectResult>((await invalid.Search(new(), CancellationToken.None)).Result);
        var missingResult = Assert.IsType<NotFoundObjectResult>((await missing.Search(new(), CancellationToken.None)).Result);
        var unexpectedResult = Assert.IsType<ObjectResult>((await unexpected.Search(new(), CancellationToken.None)).Result);

        Assert.Equal("PTV_READING_ITEM_INVALID", Assert.IsType<PtvErrorResponse>(invalidResult.Value).Code);
        Assert.Equal("PTV_READING_ITEM_NOT_FOUND", Assert.IsType<PtvErrorResponse>(missingResult.Value).Code);
        var normalized = Assert.IsType<PtvErrorResponse>(unexpectedResult.Value);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, unexpectedResult.StatusCode);
        Assert.Equal("PTV_READING_METADATA_UNAVAILABLE", normalized.Code);
        Assert.DoesNotContain("secret", normalized.Error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task InvalidAndMissingItemIdsFailBeforeInspectionOrProviderAccess()
    {
        var provider = Provider("Comic Vine", PtvReadingMediaClass.Comic);
        var inspector = new RecordingInspector();
        var invalidService = CreateService(item: null, [provider], inspector);

        var invalid = await Assert.ThrowsAsync<PtvReadingMetadataServiceException>(() => invalidService.SearchAsync(
            new PtvReadingMetadataSearchRequest { ItemId = "not-a-guid", MediaClass = PtvReadingMediaClass.Comic },
            CancellationToken.None));
        var missing = await Assert.ThrowsAsync<PtvReadingMetadataServiceException>(() => invalidService.SearchAsync(
            new PtvReadingMetadataSearchRequest { ItemId = Guid.NewGuid().ToString("N"), MediaClass = PtvReadingMediaClass.Comic },
            CancellationToken.None));

        Assert.Equal("PTV_READING_ITEM_INVALID", invalid.Code);
        Assert.Equal("PTV_READING_ITEM_NOT_FOUND", missing.Code);
        Assert.Equal(0, inspector.Calls);
        Assert.Equal(0, provider.TotalCalls);
    }

    [Theory]
    [InlineData(PtvReadingMediaClass.Comic, "Comic Vine")]
    [InlineData(PtvReadingMediaClass.Manga, "AniList,MangaDex")]
    [InlineData(PtvReadingMediaClass.Book, "Google Books")]
    public async Task AutoRoutingSelectsOnlyProvidersForTheStructuredMediaClass(
        PtvReadingMediaClass mediaClass,
        string expectedProviders)
    {
        var comicVine = Provider("Comic Vine", PtvReadingMediaClass.Comic);
        var aniList = Provider("AniList", PtvReadingMediaClass.Manga, PtvReadingMediaClass.Manhwa, PtvReadingMediaClass.Manhua);
        var mangaDex = Provider("MangaDex", PtvReadingMediaClass.Manga, PtvReadingMediaClass.Manhwa, PtvReadingMediaClass.Manhua);
        var googleBooks = Provider("Google Books", PtvReadingMediaClass.Book);
        var item = ReadingItem("Sample 001.cbz");
        var service = CreateService(item, [comicVine, aniList, mangaDex, googleBooks]);

        await service.SearchAsync(new PtvReadingMetadataSearchRequest
        {
            ItemId = item.Id.ToString("N"),
            MediaClass = mediaClass,
            Title = "Sample"
        }, CancellationToken.None);

        var expected = expectedProviders.Split(',').ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var provider in new[] { comicVine, aniList, mangaDex, googleBooks })
        {
            Assert.Equal(expected.Contains(provider.Id) ? 1 : 0, provider.SearchCalls);
        }
    }

    [Fact]
    public async Task ExplicitProviderIdUsesOnlyDirectLookupAndBypassesFuzzySearch()
    {
        var aniList = Provider("AniList", PtvReadingMediaClass.Manga);
        var mangaDex = Provider("MangaDex", PtvReadingMediaClass.Manga);
        mangaDex.DirectCandidate = Candidate("MangaDex", "md-42", "Vagabond", PtvReadingMediaClass.Manga);
        var item = ReadingItem("Vagabond Vol 1.cbz");
        var service = CreateService(item, [aniList, mangaDex]);

        var response = await service.SearchAsync(new PtvReadingMetadataSearchRequest
        {
            ItemId = item.Id.ToString("N"),
            MediaClass = PtvReadingMediaClass.Manga,
            Provider = "MangaDex",
            ProviderId = "md-42",
            Title = "this title must not drive fuzzy search"
        }, CancellationToken.None);

        var candidate = Assert.Single(response.Candidates);
        Assert.Equal("md-42", candidate.ProviderId);
        Assert.Equal(0, mangaDex.SearchCalls);
        Assert.Equal(1, mangaDex.DirectCalls);
        Assert.Equal("md-42", mangaDex.LastDirectProviderId);
        Assert.Equal(0, aniList.TotalCalls);
    }

    [Fact]
    public async Task OneProviderFailurePreservesSuccessfulProviderCandidates()
    {
        var failing = Provider("AniList", PtvReadingMediaClass.Manga);
        failing.SearchException = new TimeoutException("provider detail must stay server-side");
        var healthy = Provider("MangaDex", PtvReadingMediaClass.Manga);
        healthy.SearchCandidates = [Candidate("MangaDex", "md-1", "Monster", PtvReadingMediaClass.Manga)];
        var item = ReadingItem("Monster Vol 1.cbz");
        var service = CreateService(item, [failing, healthy]);

        var response = await service.SearchAsync(new PtvReadingMetadataSearchRequest
        {
            ItemId = item.Id.ToString("N"),
            MediaClass = PtvReadingMediaClass.Manga,
            Title = "Monster"
        }, CancellationToken.None);

        Assert.Contains(response.Candidates, candidate => candidate.ProviderId == "md-1");
        var failed = Assert.Single(response.ProviderResults, result => result.Provider == "AniList");
        Assert.Equal(PtvReadingProviderState.Unreachable, failed.State);
        Assert.Equal("provider-search-failed", failed.Failure?.Code);
        Assert.DoesNotContain("provider detail", failed.Failure?.Message ?? string.Empty, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(PtvReadingProviderState.Available, Assert.Single(response.ProviderResults, result => result.Provider == "MangaDex").State);
    }

    [Fact]
    public async Task GlobalCandidateOrderUsesPtvScoreInsteadOfProviderOrResponseOrder()
    {
        var alpha = Provider("Alpha", PtvReadingMediaClass.Comic);
        alpha.SearchCandidates = [Candidate("Alpha", "weak", "Unrelated Annual", PtvReadingMediaClass.Comic)];
        var zulu = Provider("Zulu", PtvReadingMediaClass.Comic);
        zulu.SearchCandidates = [Candidate("Zulu", "strong", "Saga", PtvReadingMediaClass.Comic, issue: "1", year: 2012)];
        var item = ReadingItem("Saga 001 (2012).cbz");
        var service = CreateService(item, [zulu, alpha]);

        var response = await service.SearchAsync(new PtvReadingMetadataSearchRequest
        {
            ItemId = item.Id.ToString("N"),
            MediaClass = PtvReadingMediaClass.Comic,
            Title = "Saga",
            IssueNumber = "1",
            Year = 2012
        }, CancellationToken.None);

        Assert.Equal("strong", response.Candidates[0].ProviderId);
        Assert.True(response.Candidates[0].Score > response.Candidates[1].Score);
        Assert.Equal(["Alpha", "Zulu"], response.ProviderResults.Select(result => result.Provider).ToArray());
    }

    [Fact]
    public async Task CorrectComicCandidateBeyondFirstThirtyIsScoredBeforePublicTruncation()
    {
        var provider = Provider("Comic Vine", PtvReadingMediaClass.Comic);
        provider.SearchCandidates = Enumerable.Range(1, 75)
            .Select(index => Candidate(
                "Comic Vine",
                $"candidate-{index}",
                index == 40 ? "Deadpool" : $"Unrelated Series {index}",
                PtvReadingMediaClass.Comic,
                issue: "9",
                year: 2019))
            .ToList();
        var item = ReadingItem("Deadpool 009 (2019).cbz");
        var service = CreateService(item, [provider]);

        var response = await service.SearchAsync(new PtvReadingMetadataSearchRequest
        {
            ItemId = item.Id.ToString("N"),
            MediaClass = PtvReadingMediaClass.Comic,
            Title = "Deadpool",
            IssueNumber = "9",
            SeriesStartYear = 2019
        }, CancellationToken.None);

        Assert.Equal(30, response.Candidates.Count);
        Assert.Equal("candidate-40", response.Candidates[0].ProviderId);
        Assert.Equal("candidate-40", Assert.Single(response.ProviderResults).Candidates[0].ProviderId);
    }

    [Fact]
    public async Task ExactAliasYearAndCreatorMergeAniListAndMangaDexWithoutCollapsingProviderIds()
    {
        var aniList = Provider("AniList", PtvReadingMediaClass.Manga);
        aniList.SearchCandidates =
        [
            Candidate(
                "AniList",
                "30013",
                "Vagabond",
                PtvReadingMediaClass.Manga,
                year: 1998,
                alternateTitles: ["バガボンド"],
                author: "Takehiko Inoue")
        ];
        var mangaDex = Provider("MangaDex", PtvReadingMediaClass.Manga);
        mangaDex.SearchCandidates =
        [
            Candidate(
                "MangaDex",
                "a1b2",
                "Vagabond (Viz)",
                PtvReadingMediaClass.Manga,
                year: 1998,
                alternateTitles: ["バガボンド"],
                author: "Takehiko Inoue")
        ];
        var item = ReadingItem("Vagabond Vol 1.cbz");
        var service = CreateService(item, [aniList, mangaDex]);

        var response = await service.SearchAsync(new PtvReadingMetadataSearchRequest
        {
            ItemId = item.Id.ToString("N"),
            MediaClass = PtvReadingMediaClass.Manga,
            Title = "Vagabond",
            Author = "Takehiko Inoue",
            Year = 1998
        }, CancellationToken.None);

        var merged = Assert.Single(response.Candidates);
        Assert.Equal("AniList + MangaDex", merged.Provider);
        Assert.Equal("30013", merged.ProviderId);
        Assert.Equal("30013", merged.ExternalIds["AniList"]);
        Assert.Equal("a1b2", merged.ExternalIds["MangaDex"]);
    }

    [Fact]
    public async Task VagueSharedTitleWithoutSharedCreatorDoesNotMergeProviders()
    {
        var aniList = Provider("AniList", PtvReadingMediaClass.Manga);
        aniList.SearchCandidates = [Candidate("AniList", "one", "Orange", PtvReadingMediaClass.Manga, year: 2012, author: "Ichigo Takano")];
        var mangaDex = Provider("MangaDex", PtvReadingMediaClass.Manga);
        mangaDex.SearchCandidates = [Candidate("MangaDex", "two", "Orange", PtvReadingMediaClass.Manga, year: 2012, author: "Different Creator")];
        var item = ReadingItem("Orange Vol 1.cbz");
        var service = CreateService(item, [aniList, mangaDex]);

        var response = await service.SearchAsync(new PtvReadingMetadataSearchRequest
        {
            ItemId = item.Id.ToString("N"),
            MediaClass = PtvReadingMediaClass.Manga,
            Title = "Orange",
            Year = 2012
        }, CancellationToken.None);

        Assert.Equal(2, response.Candidates.Count);
        Assert.DoesNotContain(response.Candidates, candidate => candidate.Provider == "AniList + MangaDex");
    }

    [Theory]
    [InlineData(null, 2012)]
    [InlineData(2012, null)]
    [InlineData(null, null)]
    [InlineData(2012, 2015)]
    public async Task CorroborationRequiresBothCompatibleYears(
        int? aniListYear,
        int? mangaDexYear)
    {
        var aniList = Provider("AniList", PtvReadingMediaClass.Manga);
        aniList.SearchCandidates =
        [
            Candidate(
                "AniList",
                "one",
                "Localized Title A",
                PtvReadingMediaClass.Manga,
                year: aniListYear,
                alternateTitles: ["共有タイトル"],
                author: "Shared Creator")
        ];
        var mangaDex = Provider("MangaDex", PtvReadingMediaClass.Manga);
        mangaDex.SearchCandidates =
        [
            Candidate(
                "MangaDex",
                "two",
                "Localized Title B",
                PtvReadingMediaClass.Manga,
                year: mangaDexYear,
                alternateTitles: ["共有タイトル"],
                author: "Shared Creator")
        ];
        var item = ReadingItem("Shared Creator Series Vol 1.cbz");
        var service = CreateService(item, [aniList, mangaDex]);

        var response = await service.SearchAsync(new PtvReadingMetadataSearchRequest
        {
            ItemId = item.Id.ToString("N"),
            MediaClass = PtvReadingMediaClass.Manga,
            Title = "共有タイトル"
        }, CancellationToken.None);

        Assert.Equal(2, response.Candidates.Count);
        Assert.DoesNotContain(response.Candidates, candidate => candidate.Provider == "AniList + MangaDex");
    }

    [Fact]
    public async Task TransportCandidatesAreBoundedStripRawPayloadAndRejectUnsafeUrls()
    {
        var provider = Provider("Comic Vine", PtvReadingMediaClass.Comic);
        provider.SearchCandidates = Enumerable.Range(0, 40).Select(index => new PtvNormalizedMetadataCandidate
        {
            Provider = "Comic Vine",
            ProviderId = $"id-{index}",
            MediaClass = PtvReadingMediaClass.Comic,
            Title = new string('T', 800) + index,
            CoverUrl = "javascript:alert(1)",
            BannerUrl = "https://user:secret@example.test/banner.jpg",
            SourceUrl = "file:///server/private/metadata.json",
            RawProviderMetadata = new { Token = "provider-secret" }
        }).ToList();
        var item = ReadingItem("Bounded 001.cbz");
        var service = CreateService(item, [provider]);

        var response = await service.SearchAsync(new PtvReadingMetadataSearchRequest
        {
            ItemId = item.Id.ToString("N"),
            MediaClass = PtvReadingMediaClass.Comic,
            Title = "Bounded"
        }, CancellationToken.None);

        Assert.Equal(30, response.Candidates.Count);
        var transported = response.Candidates
            .Concat(Assert.Single(response.ProviderResults).Candidates)
            .ToArray();
        Assert.All(transported, candidate =>
        {
            Assert.True(candidate.Title.Length <= PtvReadingMetadataLimits.MaximumTitleLength);
            Assert.Null(candidate.CoverUrl);
            Assert.Null(candidate.BannerUrl);
            Assert.Null(candidate.SourceUrl);
            Assert.Null(candidate.RawProviderMetadata);
        });
        var json = JsonSerializer.Serialize(response);
        Assert.DoesNotContain("RawProviderMetadata", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("provider-secret", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("javascript:", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task LocalInspectionEvidenceIsAppliedBeforeProviderSearch()
    {
        var provider = Provider("AniList", PtvReadingMediaClass.Manga);
        provider.SearchCandidates = [Candidate("AniList", "local", "Correct Series", PtvReadingMediaClass.Manga)];
        var inspector = new RecordingInspector
        {
            Result = new PtvReadingLocalMetadataInspectionResult
            {
                State = PtvReadingLocalInspectionState.Inspected,
                Sources = ["ComicInfo.xml"],
                Warnings = ["LOCAL_DIAGNOSTIC_CODE"],
                Metadata = new PtvReadingLocalMetadataEvidence
                {
                    Title = "Correct Series",
                    SeriesTitle = "Correct Series",
                    VolumeNumber = "4",
                    Manga = "YesAndRightToLeft",
                    Credits = [new PtvReadingPersonCredit { Name = "Local Author", Role = "Writer" }]
                }
            }
        };
        var item = ReadingItem("Unhelpful Name.cbz");
        var service = CreateService(item, [provider], inspector);

        var response = await service.SearchAsync(new PtvReadingMetadataSearchRequest
        {
            ItemId = item.Id.ToString("N")
        }, CancellationToken.None);

        Assert.Equal(1, inspector.Calls);
        Assert.Equal(item.Path, inspector.LastSourcePath);
        Assert.Equal("Correct Series", provider.LastQuery?.SeriesTitle);
        Assert.Equal("4", provider.LastQuery?.VolumeNumber);
        Assert.Equal("Local Author", provider.LastQuery?.Author);
        Assert.Equal(PtvReadingMediaClass.Manga, provider.LastQuery?.MediaClass);
        Assert.Equal("Correct Series", response.Query.SeriesTitle);
        Assert.Equal(PtvReadingLocalInspectionState.Inspected, response.LocalMetadata.State);
        Assert.Equal(["ComicInfo.xml"], response.LocalMetadata.Sources);
        Assert.Equal(["LOCAL_DIAGNOSTIC_CODE"], response.LocalMetadata.Warnings);
        Assert.DoesNotContain("C:\\Media\\Reading", JsonSerializer.Serialize(response), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void SearchContractSerializesIssueVolumeAndChapterAsDistinctFields()
    {
        var request = new PtvReadingMetadataSearchRequest
        {
            ItemId = Guid.NewGuid().ToString("N"),
            Title = "Series",
            SeriesTitle = "Series",
            IssueNumber = "1.5",
            VolumeNumber = "4",
            ChapterNumber = "37.2",
            Provider = "AniList",
            ProviderId = "30013"
        };
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);

        var json = JsonSerializer.Serialize(request, options);
        var roundTrip = JsonSerializer.Deserialize<PtvReadingMetadataSearchRequest>(json, options)!;

        Assert.Contains("\"issueNumber\":\"1.5\"", json, StringComparison.Ordinal);
        Assert.Contains("\"volumeNumber\":\"4\"", json, StringComparison.Ordinal);
        Assert.Contains("\"chapterNumber\":\"37.2\"", json, StringComparison.Ordinal);
        Assert.Equal("1.5", roundTrip.IssueNumber);
        Assert.Equal("4", roundTrip.VolumeNumber);
        Assert.Equal("37.2", roundTrip.ChapterNumber);
    }

    [Fact]
    public void PluginRegistrationContainsOneCoordinatorAndAllFiveProviderAdapters()
    {
        var services = new ServiceCollection();
        new PluginServiceRegistrator().RegisterServices(services, applicationHost: null!);

        var coordinator = Assert.Single(services, descriptor =>
            descriptor.ServiceType == typeof(IPtvReadingMetadataIdentificationService));
        Assert.Equal(ServiceLifetime.Singleton, coordinator.Lifetime);
        Assert.Equal(typeof(PtvReadingMetadataIdentificationService), coordinator.ImplementationType);

        var providers = services.Where(descriptor => descriptor.ServiceType == typeof(IPtvReadingMetadataProvider)).ToArray();
        Assert.Equal(5, providers.Length);
        Assert.Equal(
            new[]
            {
                typeof(PtvAniListReadingMetadataProvider),
                typeof(PtvComicVineReadingMetadataProvider),
                typeof(PtvGcdReadingMetadataProvider),
                typeof(PtvGoogleBooksReadingMetadataProvider),
                typeof(PtvMangaDexReadingMetadataProvider)
            },
            providers.Select(descriptor => descriptor.ImplementationType).OrderBy(type => type!.Name).ToArray());
    }

    private static PtvReadingMetadataIdentificationService CreateService(
        BaseItem? item,
        IEnumerable<IPtvReadingMetadataProvider> providers,
        IPtvReadingLocalMetadataInspector? inspector = null) => new(
            CreateLibraryManager(item),
            providers,
            inspector ?? new RecordingInspector(),
            new PtvReadingMetadataParser(),
            new PtvReadingMetadataScorer(),
            NullLogger<PtvReadingMetadataIdentificationService>.Instance);

    private static ILibraryManager CreateLibraryManager(BaseItem? item)
    {
        var manager = DispatchProxy.Create<ILibraryManager, LibraryManagerProxy>();
        ((LibraryManagerProxy)(object)manager).Item = item;
        return manager;
    }

    private static Book ReadingItem(string fileName) => new()
    {
        Id = Guid.NewGuid(),
        Name = Path.GetFileNameWithoutExtension(fileName),
        Path = Path.Combine("C:\\Media\\Reading", fileName),
        ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    };

    private static RecordingProvider Provider(string id, params PtvReadingMediaClass[] supportedClasses) =>
        new(id, supportedClasses);

    private static PtvNormalizedMetadataCandidate Candidate(
        string provider,
        string providerId,
        string title,
        PtvReadingMediaClass mediaClass,
        string? issue = null,
        int? year = null,
        IReadOnlyList<string>? alternateTitles = null,
        string? author = null) => new()
        {
            Provider = provider,
            ProviderId = providerId,
            Title = title,
            SeriesTitle = title,
            SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.Provider,
            MediaClass = mediaClass,
            IssueNumber = issue,
            IssueNumberEvidence = issue is null
                ? PtvReadingIdentityEvidenceSource.Unknown
                : PtvReadingIdentityEvidenceSource.Provider,
            Year = year,
            AlternateTitles = alternateTitles?.ToList() ?? [],
            Authors = string.IsNullOrWhiteSpace(author)
                ? []
                : [new PtvReadingPersonCredit { Name = author, Role = "Writer" }],
            ExternalIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { [provider] = providerId }
        };

    private static PtvReadingMetadataController CreateController(
        IPtvReadingMetadataIdentificationService service,
        IAuthorizationService authorization,
        bool authenticated = true) => new(service, authorization)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = authenticated
                        ? new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "admin")], "Test"))
                        : new ClaimsPrincipal(new ClaimsIdentity())
                }
            }
        };

    private static void AssertRoute(string methodName, Type attributeType, string expectedTemplate)
    {
        var method = typeof(PtvReadingMetadataController).GetMethod(methodName)!;
        var attribute = Assert.Single(method.GetCustomAttributes(attributeType, inherit: true).Cast<HttpMethodAttribute>());
        Assert.Equal(expectedTemplate, attribute.Template);
    }

    public class LibraryManagerProxy : DispatchProxy
    {
        public BaseItem? Item { get; set; }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name == nameof(ILibraryManager.GetItemById)
                && args is [{ } id]
                && id is Guid guid)
            {
                return Item?.Id == guid ? Item : null;
            }

            if (targetMethod?.ReturnType == typeof(void)) return null;
            return targetMethod?.ReturnType.IsValueType == true
                ? Activator.CreateInstance(targetMethod.ReturnType)
                : null;
        }
    }

    private sealed class RecordingInspector : IPtvReadingLocalMetadataInspector
    {
        public int Calls { get; private set; }

        public string? LastSourcePath { get; private set; }

        public PtvReadingLocalMetadataInspectionResult Result { get; init; } = new();

        public Task<PtvReadingLocalMetadataInspectionResult> InspectAsync(
            string sourcePath,
            PtvMetadataSearchContext context,
            PtvStructuredMetadataQuery query,
            CancellationToken cancellationToken)
        {
            Calls++;
            LastSourcePath = sourcePath;
            return Task.FromResult(Result);
        }
    }

    private sealed class RecordingProvider : IPtvReadingMetadataProvider
    {
        private readonly HashSet<PtvReadingMediaClass> _supportedClasses;

        public RecordingProvider(string id, IEnumerable<PtvReadingMediaClass> supportedClasses)
        {
            Id = id;
            DisplayName = id;
            _supportedClasses = supportedClasses.ToHashSet();
        }

        public string Id { get; }

        public string DisplayName { get; }

        public int SearchCalls { get; private set; }

        public int DirectCalls { get; private set; }

        public int StatusCalls { get; private set; }

        public int TotalCalls => SearchCalls + DirectCalls + StatusCalls;

        public string? LastDirectProviderId { get; private set; }

        public PtvStructuredMetadataQuery? LastQuery { get; private set; }

        public Exception? SearchException { get; set; }

        public List<PtvNormalizedMetadataCandidate> SearchCandidates { get; set; } = [];

        public PtvNormalizedMetadataCandidate? DirectCandidate { get; set; }

        public bool Supports(PtvMetadataSearchContext context) =>
            context.MediaClassOverride is { } mediaClass && _supportedClasses.Contains(mediaClass);

        public Task<PtvReadingProviderSearchResult> SearchAsync(
            PtvStructuredMetadataQuery query,
            CancellationToken cancellationToken)
        {
            SearchCalls++;
            LastQuery = query;
            if (SearchException is not null) throw SearchException;
            return Task.FromResult(new PtvReadingProviderSearchResult
            {
                Provider = Id,
                State = PtvReadingProviderState.Available,
                Candidates = SearchCandidates
            });
        }

        public Task<PtvNormalizedMetadataCandidate?> GetByIdAsync(
            string providerId,
            CancellationToken cancellationToken)
        {
            DirectCalls++;
            LastDirectProviderId = providerId;
            return Task.FromResult(DirectCandidate);
        }

        public Task<PtvReadingProviderStatus> GetStatusAsync(CancellationToken cancellationToken)
        {
            StatusCalls++;
            return Task.FromResult(new PtvReadingProviderStatus
            {
                Provider = Id,
                State = PtvReadingProviderState.Available
            });
        }
    }

    private sealed class RecordingIdentificationService : IPtvReadingMetadataIdentificationService
    {
        public int CallCount { get; private set; }

        public Task<PtvReadingMetadataProvidersResponse> GetProvidersAsync(CancellationToken cancellationToken)
        {
            CallCount++;
            return Task.FromResult(new PtvReadingMetadataProvidersResponse());
        }

        public Task<PtvReadingMetadataSearchResponse> SearchAsync(
            PtvReadingMetadataSearchRequest request,
            CancellationToken cancellationToken)
        {
            CallCount++;
            return Task.FromResult(new PtvReadingMetadataSearchResponse
            {
                Query = new PtvStructuredMetadataQuery()
            });
        }
    }

    private sealed class ThrowingIdentificationService(Exception exception) : IPtvReadingMetadataIdentificationService
    {
        public Task<PtvReadingMetadataProvidersResponse> GetProvidersAsync(CancellationToken cancellationToken) =>
            Task.FromException<PtvReadingMetadataProvidersResponse>(exception);

        public Task<PtvReadingMetadataSearchResponse> SearchAsync(
            PtvReadingMetadataSearchRequest request,
            CancellationToken cancellationToken) =>
            Task.FromException<PtvReadingMetadataSearchResponse>(exception);
    }

    private sealed class RecordingAuthorizationService(bool allow) : IAuthorizationService
    {
        public List<string> PolicyNames { get; } = [];

        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            IEnumerable<IAuthorizationRequirement> requirements) =>
            Task.FromResult(allow ? AuthorizationResult.Success() : AuthorizationResult.Failed());

        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            string policyName)
        {
            PolicyNames.Add(policyName);
            return Task.FromResult(allow ? AuthorizationResult.Success() : AuthorizationResult.Failed());
        }
    }
}
