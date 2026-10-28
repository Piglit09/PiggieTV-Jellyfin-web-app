using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvFeaturedContentAuthorizationTests
{
    private static readonly Guid AdminUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid RestrictedUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid RestrictedUserBId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid LibraryAItemId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid LibraryBItemId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private const string LibraryASentinel = "LIBRARY_A_PRIVATE_SENTINEL";
    private const string RestrictedSentinel = "LIBRARY_B_PRIVATE_SENTINEL";
    private const string CaseVariantSentinel = "CASE_VARIANT_PRIVATE_SENTINEL";

    [Fact]
    public async Task SharedFeaturedCacheIsFilteredBeforeRestrictedHttpSerialization()
    {
        var sharedDocument = CreateSharedDocument();
        var sourceBefore = JsonSerializer.Serialize(sharedDocument);
        var store = new TestFeaturedContentStore(sharedDocument);
        var users = CreateUserManager(AdminUserId, RestrictedUserId);
        var libraries = CreateLibraryManager(new Dictionary<Guid, IReadOnlySet<Guid>>
        {
            [AdminUserId] = new HashSet<Guid> { LibraryAItemId, LibraryBItemId },
            [RestrictedUserId] = new HashSet<Guid> { LibraryAItemId }
        });

        var admin = CreateController(store, users, libraries, AdminUserId);
        var restricted = CreateController(store, users, libraries, RestrictedUserId);

        var restrictedJson = await GetSerializedPayloadAsync(restricted);
        var adminJson = await GetSerializedPayloadAsync(admin);

        Assert.Contains(LibraryAItemId.ToString("N"), adminJson, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(LibraryBItemId.ToString("N"), adminJson, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(LibraryAItemId.ToString("N"), restrictedJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(LibraryBItemId.ToString("N"), restrictedJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(RestrictedSentinel, restrictedJson, StringComparison.Ordinal);
        Assert.DoesNotContain("BoxSet", restrictedJson, StringComparison.Ordinal);
        Assert.DoesNotContain("2099-12-31", restrictedJson, StringComparison.Ordinal);
        Assert.DoesNotContain("2099-11-30", restrictedJson, StringComparison.Ordinal);
        Assert.DoesNotContain("987123456789", restrictedJson, StringComparison.Ordinal);
        Assert.DoesNotContain("9.871234", restrictedJson, StringComparison.Ordinal);
        Assert.DoesNotContain("98.71234", restrictedJson, StringComparison.Ordinal);
        Assert.Equal(sourceBefore, JsonSerializer.Serialize(sharedDocument));
        Assert.Equal(sourceBefore, JsonSerializer.Serialize(store.Document));

        using var restrictedDocument = JsonDocument.Parse(restrictedJson);
        var payload = restrictedDocument.RootElement.GetProperty("featuredContent").GetProperty("payload");
        Assert.Equal(PtvFeaturedContentValidator.FeaturedCacheVersion, restrictedDocument.RootElement
            .GetProperty("featuredContent")
            .GetProperty("version")
            .GetInt32());
        Assert.Single(payload.GetProperty("heroItems").EnumerateArray());
        var filteredMixed = payload.GetProperty("sectionItems").GetProperty("section");
        var sections = payload.GetProperty("sections").EnumerateArray().ToArray();
        Assert.Equal(3, sections.Length);
        var filteredMixedDefinition = Assert.Single(sections, section => section.GetProperty("id").GetString() == "section");
        Assert.Single(filteredMixed.EnumerateArray());
        Assert.Equal(1, filteredMixedDefinition.GetProperty("itemCount").GetInt32());
        Assert.Equal(1, filteredMixedDefinition.GetProperty("finalRenderedCount").GetInt32());
        Assert.Empty(payload.GetProperty("rowDiagnostics").EnumerateArray());
        Assert.Equal(3_600_000, restrictedDocument.RootElement
            .GetProperty("featuredContentSettings")
            .GetProperty("ttlMs")
            .GetInt32());
        Assert.Equal(1_788_000_000_000, restrictedDocument.RootElement.GetProperty("updatedAt").GetInt64());
        Assert.Equal(1_788_000_000_000, restrictedDocument.RootElement
            .GetProperty("featuredContent")
            .GetProperty("createdAt")
            .GetInt64());
        Assert.Equal(1_788_003_600_000, restrictedDocument.RootElement
            .GetProperty("featuredContent")
            .GetProperty("expiresAt")
            .GetInt64());
        Assert.Equal("private, no-store", restricted.Response.Headers.CacheControl.ToString());
        Assert.Equal("no-cache", restricted.Response.Headers.Pragma.ToString());
    }

    [Fact]
    public async Task TemporaryBroadAccessCannotAuthorizeAnyPluginFeaturedSectionBeforeDurableProof()
    {
        var store = new TestFeaturedContentStore(CreateSharedDocument());
        var users = CreateUserManager(RestrictedUserId);
        var libraries = CreateLibraryManager(new Dictionary<Guid, IReadOnlySet<Guid>>
        {
            [RestrictedUserId] = new HashSet<Guid> { LibraryAItemId, LibraryBItemId }
        });
        var services = BuildServices(store, users, libraries, proven: false);

        var response = await GetSerializedPayloadAsync(CreateController(services, RestrictedUserId));
        using var document = JsonDocument.Parse(response);
        var payload = document.RootElement.GetProperty("featuredContent").GetProperty("payload");
        Assert.Empty(payload.GetProperty("sections").EnumerateArray());
        Assert.Empty(payload.GetProperty("sectionItems").EnumerateObject());
        Assert.Empty(payload.GetProperty("heroItems").EnumerateArray());
    }

    [Fact]
    public async Task CaseVariantDuplicateMetadataKeysCannotBypassCanonicalProjection()
    {
        var sharedDocument = CreateSharedDocument();
        var featuredContent = Assert.IsType<JsonObject>(sharedDocument.FeaturedContent);
        var payload = Assert.IsType<JsonObject>(featuredContent["payload"]);
        var heroItems = Assert.IsType<JsonArray>(payload["heroItems"]);
        var metadataSmuggle = CreateItem(LibraryAItemId, LibraryASentinel);
        metadataSmuggle["name"] = CaseVariantSentinel;
        metadataSmuggle["providerids"] = new JsonObject { ["Private"] = CaseVariantSentinel };
        metadataSmuggle["imagetags"] = new JsonObject { ["Primary"] = CaseVariantSentinel };
        metadataSmuggle["mediasources"] = new JsonArray(new JsonObject { ["Path"] = CaseVariantSentinel });
        heroItems.Add(metadataSmuggle);

        var store = new TestFeaturedContentStore(sharedDocument);
        var users = CreateUserManager(RestrictedUserId);
        var libraries = CreateLibraryManager(new Dictionary<Guid, IReadOnlySet<Guid>>
        {
            [RestrictedUserId] = new HashSet<Guid> { LibraryAItemId }
        });

        var projected = new PtvFeaturedContentAuthorizationService(users, libraries)
            .AuthorizeForUser(sharedDocument, RestrictedUserId).Document;
        var projectionJson = JsonSerializer.Serialize(projected);
        Assert.DoesNotContain(CaseVariantSentinel, projectionJson, StringComparison.Ordinal);
        var projectedPayload = JsonDocument.Parse(projectionJson).RootElement
            .GetProperty("featuredContent").GetProperty("payload");
        var projectedHeroes = projectedPayload.GetProperty("heroItems").EnumerateArray().ToArray();
        Assert.Equal(2, projectedHeroes.Length);
        Assert.All(projectedHeroes, item =>
        {
            var propertyNames = item.EnumerateObject().Select(property => property.Name).ToArray();
            Assert.Equal(propertyNames.Length, propertyNames.Distinct(StringComparer.OrdinalIgnoreCase).Count());
        });
        Assert.Single(projectedHeroes, item => item.TryGetProperty("Name", out _));
        Assert.Single(projectedHeroes, item => item.TryGetProperty("ProviderIds", out _));
        Assert.Single(projectedHeroes, item => item.TryGetProperty("ImageTags", out _));
        Assert.Single(projectedHeroes, item => item.TryGetProperty("MediaSources", out _));

        var response = await GetSerializedPayloadAsync(CreateController(store, users, libraries, RestrictedUserId));

        Assert.DoesNotContain(CaseVariantSentinel, response, StringComparison.Ordinal);
        Assert.DoesNotContain(LibraryBItemId.ToString("N"), response, StringComparison.OrdinalIgnoreCase);
        using var document = JsonDocument.Parse(response);
        var deliveredHeroes = document.RootElement
            .GetProperty("featuredContent")
            .GetProperty("payload")
            .GetProperty("heroItems")
            .EnumerateArray()
            .ToArray();
        Assert.All(deliveredHeroes, item => Assert.Equal(LibraryAItemId.ToString("N"),
            item.GetProperty("Id").GetString()));
    }

    [Fact]
    public async Task NeutralizedSectionIdsCannotOverwriteSurvivingSourceRows()
    {
        var sharedDocument = CreateSharedDocument();
        var featuredContent = Assert.IsType<JsonObject>(sharedDocument.FeaturedContent);
        var payload = Assert.IsType<JsonObject>(featuredContent["payload"]);
        var sectionItems = Assert.IsType<JsonObject>(payload["sectionItems"]);
        var sections = Assert.IsType<JsonArray>(payload["sections"]);
        sectionItems["section"] = new JsonArray(CreateItem(LibraryAItemId, LibraryASentinel));
        sections.Add(new JsonObject
        {
            ["id"] = "section",
            ["title"] = "Stable section",
            ["source"] = "latest",
            ["itemCount"] = 1
        });
        var store = new TestFeaturedContentStore(sharedDocument);
        var users = CreateUserManager(RestrictedUserId);
        var libraries = CreateLibraryManager(new Dictionary<Guid, IReadOnlySet<Guid>>
        {
            [RestrictedUserId] = new HashSet<Guid> { LibraryAItemId }
        });

        var response = await GetSerializedPayloadAsync(CreateController(store, users, libraries, RestrictedUserId));

        using var document = JsonDocument.Parse(response);
        var projectedPayload = document.RootElement.GetProperty("featuredContent").GetProperty("payload");
        var projectedSectionItems = projectedPayload.GetProperty("sectionItems");
        var projectedSectionIds = projectedPayload
            .GetProperty("sections")
            .EnumerateArray()
            .Select(section => section.GetProperty("id").GetString()!)
            .ToArray();
        Assert.Equal(
            projectedSectionIds.Length,
            projectedSectionIds.Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.Contains("section", projectedSectionIds, StringComparer.OrdinalIgnoreCase);
        Assert.Contains("section-2", projectedSectionIds, StringComparer.OrdinalIgnoreCase);
        Assert.All(projectedSectionIds, sectionId => Assert.True(projectedSectionItems.TryGetProperty(sectionId, out _)));
    }

    [Fact]
    public async Task DifferentRestrictedUsersReceiveIsolatedResponsesFromOneSharedService()
    {
        var store = new TestFeaturedContentStore(CreateSharedDocument());
        var users = CreateUserManager(RestrictedUserId, RestrictedUserBId);
        var libraries = CreateLibraryManager(new Dictionary<Guid, IReadOnlySet<Guid>>
        {
            [RestrictedUserId] = new HashSet<Guid> { LibraryAItemId },
            [RestrictedUserBId] = new HashSet<Guid> { LibraryBItemId }
        });
        var services = BuildServices(store, users, libraries);

        var libraryAResponse = await GetSerializedPayloadAsync(CreateController(services, RestrictedUserId));
        var libraryBResponse = await GetSerializedPayloadAsync(CreateController(services, RestrictedUserBId));

        Assert.Contains(LibraryAItemId.ToString("N"), libraryAResponse, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(LibraryBItemId.ToString("N"), libraryAResponse, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(LibraryASentinel, libraryAResponse, StringComparison.Ordinal);
        Assert.DoesNotContain(RestrictedSentinel, libraryAResponse, StringComparison.Ordinal);
        Assert.Contains(LibraryBItemId.ToString("N"), libraryBResponse, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(LibraryAItemId.ToString("N"), libraryBResponse, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(RestrictedSentinel, libraryBResponse, StringComparison.Ordinal);
        Assert.DoesNotContain(LibraryASentinel, libraryBResponse, StringComparison.Ordinal);
    }

    [Fact]
    public async Task PermissionChangesAreReevaluatedWithoutMutatingTheSharedCache()
    {
        var sharedDocument = CreateSharedDocument();
        var sourceBefore = JsonSerializer.Serialize(sharedDocument);
        var store = new TestFeaturedContentStore(sharedDocument);
        var users = CreateUserManager(RestrictedUserId);
        var access = new Dictionary<Guid, IReadOnlySet<Guid>>
        {
            [RestrictedUserId] = new HashSet<Guid> { LibraryAItemId }
        };
        var libraries = CreateLibraryManager(access);
        var services = BuildServices(store, users, libraries);

        var first = await GetSerializedPayloadAsync(CreateController(services, RestrictedUserId));
        access[RestrictedUserId] = new HashSet<Guid> { LibraryBItemId };
        var second = await GetSerializedPayloadAsync(CreateController(services, RestrictedUserId));

        Assert.Contains(LibraryAItemId.ToString("N"), first, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(LibraryBItemId.ToString("N"), first, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(LibraryBItemId.ToString("N"), second, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(LibraryAItemId.ToString("N"), second, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(sourceBefore, JsonSerializer.Serialize(sharedDocument));
    }

    [Fact]
    public async Task MissingMalformedAnonymousAndUnresolvedUsersFailClosed()
    {
        var store = new TestFeaturedContentStore(CreateSharedDocument());
        var users = CreateUserManager(AdminUserId, RestrictedUserId);
        var libraries = CreateLibraryManager(new Dictionary<Guid, IReadOnlySet<Guid>>
        {
            [AdminUserId] = new HashSet<Guid> { LibraryAItemId, LibraryBItemId },
            [RestrictedUserId] = new HashSet<Guid> { LibraryAItemId }
        });
        var services = BuildServices(store, users, libraries);

        var missing = CreateController(services, claimValue: null, authenticated: true);
        var malformed = CreateController(services, claimValue: "not-a-guid", authenticated: true);
        var anonymous = CreateController(services, claimValue: RestrictedUserId.ToString("N"), authenticated: false);
        var unresolved = CreateController(services, Guid.NewGuid());
        var mixedIdentity = CreateController(services, claimValue: null, authenticated: true);
        mixedIdentity.HttpContext.User = new ClaimsPrincipal(
        [
            new ClaimsIdentity(authenticationType: "test"),
            new ClaimsIdentity([new Claim("Jellyfin-UserId", RestrictedUserId.ToString("N"))])
        ]);
        var conflictingFallbackIdentity = CreateController(services, claimValue: null, authenticated: true);
        conflictingFallbackIdentity.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim("Jellyfin-UserId", RestrictedUserId.ToString("N")),
            new Claim(ClaimTypes.NameIdentifier, AdminUserId.ToString("N"))
        ], "test"));
        var conflictingAuthoritativeIdentity = CreateController(services, claimValue: null, authenticated: true);
        conflictingAuthoritativeIdentity.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim("Jellyfin-UserId", RestrictedUserId.ToString("N")),
            new Claim("Jellyfin-UserId", AdminUserId.ToString("N"))
        ], "test"));
        var malformedAuthoritativeIdentity = CreateController(services, claimValue: null, authenticated: true);
        malformedAuthoritativeIdentity.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim("Jellyfin-UserId", "not-a-guid"),
            new Claim("sub", AdminUserId.ToString("N"))
        ], "test"));

        Assert.IsType<UnauthorizedObjectResult>((await missing.GetFeaturedContent(CancellationToken.None)).Result);
        Assert.IsType<UnauthorizedObjectResult>((await malformed.GetFeaturedContent(CancellationToken.None)).Result);
        Assert.IsType<UnauthorizedObjectResult>((await anonymous.GetFeaturedContent(CancellationToken.None)).Result);
        Assert.IsType<UnauthorizedObjectResult>((await unresolved.GetFeaturedContent(CancellationToken.None)).Result);
        Assert.IsType<UnauthorizedObjectResult>((await mixedIdentity.GetFeaturedContent(CancellationToken.None)).Result);
        var authoritativeResponse = await GetSerializedPayloadAsync(conflictingFallbackIdentity);
        Assert.Contains(LibraryAItemId.ToString("N"), authoritativeResponse, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(LibraryBItemId.ToString("N"), authoritativeResponse, StringComparison.OrdinalIgnoreCase);
        Assert.IsType<UnauthorizedObjectResult>((await conflictingAuthoritativeIdentity.GetFeaturedContent(CancellationToken.None)).Result);
        Assert.IsType<UnauthorizedObjectResult>((await malformedAuthoritativeIdentity.GetFeaturedContent(CancellationToken.None)).Result);
        Assert.Equal("private, no-store", unresolved.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public async Task ConcurrentAdminAndRestrictedRequestsCannotCrossContaminate()
    {
        var sharedDocument = CreateSharedDocument();
        var sourceBefore = JsonSerializer.Serialize(sharedDocument);
        var store = new TestFeaturedContentStore(sharedDocument);
        var users = CreateUserManager(AdminUserId, RestrictedUserId);
        var libraries = CreateLibraryManager(new Dictionary<Guid, IReadOnlySet<Guid>>
        {
            [AdminUserId] = new HashSet<Guid> { LibraryAItemId, LibraryBItemId },
            [RestrictedUserId] = new HashSet<Guid> { LibraryAItemId }
        });
        var services = BuildServices(store, users, libraries);
        var releaseRequests = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var arrived = 0;
        store.BeforeStatus = async () =>
        {
            if (Interlocked.Increment(ref arrived) == 2)
            {
                releaseRequests.TrySetResult();
            }

            await releaseRequests.Task.WaitAsync(TimeSpan.FromSeconds(5));
        };

        var adminRequest = GetSerializedPayloadAsync(CreateController(services, AdminUserId));
        var restrictedRequest = GetSerializedPayloadAsync(CreateController(services, RestrictedUserId));
        var responses = await Task.WhenAll(adminRequest, restrictedRequest);

        Assert.Contains(LibraryBItemId.ToString("N"), responses[0], StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(LibraryBItemId.ToString("N"), responses[1], StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(RestrictedSentinel, responses[1], StringComparison.Ordinal);
        Assert.Equal(2, arrived);
        Assert.Equal(sourceBefore, JsonSerializer.Serialize(sharedDocument));
    }

    [Fact]
    public async Task UsesResolvedJellyfinUserOverloadOncePerDistinctCandidate()
    {
        var store = new TestFeaturedContentStore(CreateSharedDocument());
        var users = CreateUserManager(RestrictedUserId);
        var libraries = CreateLibraryManager(new Dictionary<Guid, IReadOnlySet<Guid>>
        {
            [RestrictedUserId] = new HashSet<Guid> { LibraryAItemId }
        });
        var proxy = (LibraryManagerProxy)(object)libraries;

        _ = await GetSerializedPayloadAsync(CreateController(store, users, libraries, RestrictedUserId));

        Assert.Equal(2, proxy.ResolvedUserOverloadCalls);
        Assert.Equal(0, proxy.UserIdOverloadCalls);
    }

    [Fact]
    public async Task AuthorizationLookupFailureReturnsNoFeaturedPayload()
    {
        var store = new TestFeaturedContentStore(CreateSharedDocument());
        var users = CreateUserManager(RestrictedUserId);
        var libraries = CreateLibraryManager(new Dictionary<Guid, IReadOnlySet<Guid>>
        {
            [RestrictedUserId] = new HashSet<Guid> { LibraryAItemId }
        });
        ((LibraryManagerProxy)(object)libraries).ThrowOnResolvedUserLookup = true;

        var action = await CreateController(store, users, libraries, RestrictedUserId)
            .GetFeaturedContent(CancellationToken.None);
        var failure = Assert.IsType<ObjectResult>(action.Result);
        var serializedFailure = JsonSerializer.Serialize(failure.Value);

        Assert.Equal(StatusCodes.Status500InternalServerError, failure.StatusCode);
        Assert.DoesNotContain(LibraryAItemId.ToString("N"), serializedFailure, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(LibraryBItemId.ToString("N"), serializedFailure, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(RestrictedSentinel, serializedFailure, StringComparison.Ordinal);
        Assert.DoesNotContain("sensitive failure details", serializedFailure, StringComparison.Ordinal);
    }

    [Fact]
    public void FeaturedEndpointAndServiceRegistrationPreserveSecurityContract()
    {
        Assert.NotNull(typeof(PtvStatusController).GetCustomAttribute<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>());
        var method = typeof(PtvStatusController).GetMethod(nameof(PtvStatusController.GetFeaturedContent));
        var responseCache = Assert.Single(method!.GetCustomAttributes<ResponseCacheAttribute>());
        Assert.True(responseCache.NoStore);
        Assert.Equal(ResponseCacheLocation.None, responseCache.Location);

        var services = new ServiceCollection();
        new PluginServiceRegistrator().RegisterServices(services, applicationHost: null!);
        var registration = Assert.Single(services, descriptor =>
            descriptor.ServiceType == typeof(IPtvFeaturedContentAuthorizationService));
        Assert.Equal(ServiceLifetime.Singleton, registration.Lifetime);
        Assert.Equal(typeof(PtvFeaturedContentAuthorizationService), registration.ImplementationType);

        var publicStatus = PtvStatusResponse.FromStoreStatus(new PtvFeaturedContentStoreStatus
        {
            CacheFilePath = "private-file-path",
            CachePath = "private-directory-path",
            Document = PtvFeaturedContentValidator.CreateEmptyDocument()
        }, canWriteFeaturedContent: false);
        Assert.Null(publicStatus.CacheFilePath);
        Assert.Null(publicStatus.CachePath);
    }

    private static async Task<string> GetSerializedPayloadAsync(PtvStatusController controller)
    {
        var action = await controller.GetFeaturedContent(CancellationToken.None);
        var result = Assert.IsType<OkObjectResult>(action.Result);
        return JsonSerializer.Serialize(result.Value);
    }

    private static PtvStatusController CreateController(
        IPtvFeaturedContentStore store,
        IUserManager userManager,
        ILibraryManager libraryManager,
        Guid userId)
    {
        return CreateController(BuildServices(store, userManager, libraryManager), userId);
    }

    private static IServiceProvider BuildServices(
        IPtvFeaturedContentStore store,
        IUserManager userManager,
        ILibraryManager libraryManager,
        bool proven = true)
    {
        // These tests isolate per-item Featured projection. A narrow already-proven
        // user authority keeps that projection reachable through the HTTP endpoint.
        var access = DispatchProxy.Create<IPtvHomeUserAccessLedger, HomeAccessProxy>();
        var services = new ServiceCollection()
            .AddSingleton(store)
            .AddSingleton(userManager)
            .AddSingleton(libraryManager)
            .AddSingleton<IPtvFeaturedContentAuthorizationService>(
                new PtvFeaturedContentAuthorizationService(userManager, libraryManager));
        if (proven) services.AddSingleton(access);
        return services.BuildServiceProvider();
    }

    private static PtvStatusController CreateController(IServiceProvider services, Guid userId) =>
        CreateController(services, userId.ToString("N"), authenticated: true);

    private static PtvStatusController CreateController(
        IServiceProvider services,
        string? claimValue,
        bool authenticated)
    {
        var claims = string.IsNullOrWhiteSpace(claimValue)
            ? Array.Empty<Claim>()
            : [new Claim("Jellyfin-UserId", claimValue)];
        var identity = new ClaimsIdentity(
            claims,
            authenticated ? "test" : null);

        return new PtvStatusController(NullLogger<PtvStatusController>.Instance, services)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(identity)
                }
            }
        };
    }

    private static IUserManager CreateUserManager(params Guid[] userIds)
    {
        var manager = DispatchProxy.Create<IUserManager, UserManagerProxy>();
        ((UserManagerProxy)(object)manager).Users = userIds.ToDictionary(userId => userId, userId =>
        {
            var user = new User("test-user", "test-auth", "test-reset") { Id = userId };
            if (userId == AdminUserId)
            {
                user.Permissions.Add(new Permission(PermissionKind.IsAdministrator, true));
            }

            return user;
        });
        return manager;
    }

    private static ILibraryManager CreateLibraryManager(IReadOnlyDictionary<Guid, IReadOnlySet<Guid>> access)
    {
        var manager = DispatchProxy.Create<ILibraryManager, LibraryManagerProxy>();
        ((LibraryManagerProxy)(object)manager).Access = access;
        return manager;
    }

    private static PtvFeaturedContentDocument CreateSharedDocument()
    {
        var itemA = CreateItem(LibraryAItemId, LibraryASentinel);
        var itemB = CreateItem(LibraryBItemId, RestrictedSentinel);
        var caseVariantIdSmuggle = CreateItem(LibraryAItemId, LibraryASentinel);
        caseVariantIdSmuggle["id"] = LibraryBItemId.ToString("N");
        caseVariantIdSmuggle["name"] = RestrictedSentinel;

        return new PtvFeaturedContentDocument
        {
            Version = PtvFeaturedContentValidator.DocumentVersion,
            UpdatedAt = 1_788_000_000_000,
            FeaturedContent = new JsonObject
            {
                ["version"] = PtvFeaturedContentValidator.FeaturedCacheVersion,
                ["createdAt"] = 1_788_000_000_000,
                ["expiresAt"] = 1_788_003_600_000,
                ["payload"] = new JsonObject
                {
                    ["scopeSchemaVersion"] = 2,
                    ["heroItems"] = new JsonArray(
                        itemA.DeepClone(),
                        itemB.DeepClone(),
                        caseVariantIdSmuggle,
                        new JsonObject { ["Id"] = "not-a-guid", ["Name"] = RestrictedSentinel }),
                    ["sectionItems"] = new JsonObject
                    {
                        ["mixed"] = new JsonArray(itemA.DeepClone(), itemB.DeepClone()),
                        ["ambiguous"] = new JsonArray(itemB.DeepClone()),
                        ["Ambiguous"] = new JsonArray(itemA.DeepClone()),
                        ["ambiguous-discriminator"] = new JsonArray(itemA.DeepClone()),
                        ["restricted-only"] = new JsonArray(itemB.DeepClone()),
                        ["recommendation-" + RestrictedSentinel] = new JsonArray(itemA.DeepClone())
                    },
                    ["sections"] = new JsonArray(
                        new JsonObject
                        {
                            ["id"] = "ambiguous",
                            ["title"] = RestrictedSentinel,
                            ["source"] = RestrictedSentinel,
                            ["itemCount"] = 1
                        },
                        new JsonObject
                        {
                            ["id"] = "ambiguous-discriminator",
                            ["sourceType"] = "recommendation",
                            ["SourceType"] = "latest",
                            ["title"] = RestrictedSentinel,
                            ["source"] = RestrictedSentinel,
                            ["sourceValue"] = RestrictedSentinel,
                            ["itemCount"] = 1
                        },
                        new JsonObject
                        {
                            ["id"] = "mixed",
                            ["title"] = "Mixed",
                            ["source"] = RestrictedSentinel,
                            ["sourceValue"] = RestrictedSentinel,
                            ["studioFilter"] = RestrictedSentinel,
                            ["editorialDescription"] = RestrictedSentinel,
                            ["itemCount"] = 2,
                            ["finalRenderedCount"] = 2,
                            ["first10ItemNames"] = new JsonArray(LibraryASentinel, RestrictedSentinel),
                            ["first10MatchedItemNames"] = new JsonArray(LibraryASentinel, RestrictedSentinel)
                        },
                        new JsonObject
                        {
                            ["id"] = "restricted-only",
                            ["title"] = RestrictedSentinel,
                            ["source"] = RestrictedSentinel,
                            ["queryUsed"] = RestrictedSentinel,
                            ["emptyResultReason"] = RestrictedSentinel,
                            ["itemCount"] = 1
                        },
                        new JsonObject
                        {
                            ["id"] = "embedded-private",
                            ["title"] = RestrictedSentinel,
                            ["source"] = RestrictedSentinel,
                            ["items"] = new JsonArray(itemB.DeepClone())
                        },
                        new JsonObject
                        {
                            ["id"] = "fallback-" + RestrictedSentinel,
                            ["title"] = RestrictedSentinel,
                            ["source"] = RestrictedSentinel,
                            ["sourceValue"] = RestrictedSentinel,
                            ["studioFilter"] = RestrictedSentinel,
                            ["ruleName"] = RestrictedSentinel,
                            ["fallbackUsed"] = true,
                            ["items"] = new JsonArray(itemA.DeepClone(), itemB.DeepClone())
                        },
                        new JsonObject
                        {
                            ["id"] = "recommendation-" + RestrictedSentinel,
                            ["title"] = "Because You Watched " + RestrictedSentinel,
                            ["ruleName"] = RestrictedSentinel,
                            ["source"] = RestrictedSentinel,
                            ["sourceValue"] = RestrictedSentinel,
                            ["sourceRuleId"] = RestrictedSentinel,
                            ["sourceType"] = "recommendation",
                            ["type"] = "recommendation",
                            ["rowType"] = "generated-recommendation",
                            ["recommendationConfigHash"] = RestrictedSentinel,
                            ["itemCount"] = 1
                        }),
                    ["rowDiagnostics"] = new JsonArray(new JsonObject
                    {
                        ["rowId"] = "mixed",
                        ["itemCount"] = 2,
                        ["candidateCount"] = 2,
                        ["first10ItemNames"] = new JsonArray(LibraryASentinel, RestrictedSentinel),
                        ["first10MatchedItemNames"] = new JsonArray(LibraryASentinel, RestrictedSentinel)
                    }),
                    ["recommendationConfigHash"] = RestrictedSentinel,
                    ["privateExtension"] = RestrictedSentinel
                }
            },
            FeaturedContentSettings = new JsonObject
            {
                ["ttlMs"] = 3_600_000,
                ["privateExtension"] = RestrictedSentinel
            }
        };
    }

    private static JsonObject CreateItem(Guid id, string sentinel) => new()
    {
        ["Id"] = id.ToString("N"),
        ["Name"] = sentinel,
        ["Type"] = id == LibraryBItemId ? "BoxSet" : "Movie",
        ["Overview"] = sentinel + " overview",
        ["ImageTags"] = new JsonObject { ["Primary"] = sentinel + " image" },
        ["ProviderIds"] = new JsonObject { ["Tmdb"] = sentinel + " provider" },
        ["Genres"] = new JsonArray(sentinel + " genre"),
        ["Tags"] = new JsonArray(sentinel + " tag"),
        ["CommunityRating"] = id == LibraryBItemId ? 9.871234 : 7.0,
        ["CriticRating"] = id == LibraryBItemId ? 98.71234 : 70.0,
        ["OfficialRating"] = sentinel + " rating",
        ["DateCreated"] = id == LibraryBItemId ? "2099-12-31T23:59:59Z" : "2020-01-01T00:00:00Z",
        ["PremiereDate"] = id == LibraryBItemId ? "2099-11-30T00:00:00Z" : "2020-01-01T00:00:00Z",
        ["ProductionYear"] = id == LibraryBItemId ? 2099 : 2020,
        ["RunTimeTicks"] = id == LibraryBItemId ? 987_123_456_789 : 1_000_000,
        ["BackdropImageTags"] = new JsonArray(sentinel + " backdrop"),
        ["PtvHeroRecommendationLabel"] = RestrictedSentinel,
        ["ArtistItems"] = new JsonArray(new JsonObject
        {
            ["Id"] = LibraryBItemId.ToString("N"),
            ["Name"] = RestrictedSentinel
        }),
        ["AlbumArtists"] = new JsonArray(new JsonObject
        {
            ["Id"] = LibraryBItemId.ToString("N"),
            ["Name"] = RestrictedSentinel
        }),
        ["PrivateNested"] = RestrictedSentinel,
        ["MediaSources"] = new JsonArray(new JsonObject
        {
            ["Container"] = "mkv",
            ["Path"] = RestrictedSentinel,
            ["MediaStreams"] = new JsonArray(new JsonObject
            {
                ["Type"] = "Video",
                ["Codec"] = "hevc",
                ["Path"] = RestrictedSentinel
            })
        })
    };

    public class UserManagerProxy : DispatchProxy
    {
        public IReadOnlyDictionary<Guid, User> Users { get; set; } = new Dictionary<Guid, User>();

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name == nameof(IUserManager.GetUserById)
                && args is [Guid userId])
            {
                return Users.GetValueOrDefault(userId);
            }

            if (targetMethod?.ReturnType == typeof(void)) return null;
            return targetMethod?.ReturnType.IsValueType == true
                ? Activator.CreateInstance(targetMethod.ReturnType)
                : null;
        }
    }

    public class LibraryManagerProxy : DispatchProxy
    {
        public IReadOnlyDictionary<Guid, IReadOnlySet<Guid>> Access { get; set; } =
            new Dictionary<Guid, IReadOnlySet<Guid>>();

        public int ResolvedUserOverloadCalls;

        public int UserIdOverloadCalls;

        public bool ThrowOnResolvedUserLookup { get; set; }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name == nameof(ILibraryManager.GetVirtualFolders))
                return new List<MediaBrowser.Model.Entities.VirtualFolderInfo>();
            if (targetMethod?.Name == nameof(ILibraryManager.GetItemById)
                && args is [Guid itemId, User user])
            {
                Interlocked.Increment(ref ResolvedUserOverloadCalls);
                if (ThrowOnResolvedUserLookup)
                {
                    throw new InvalidOperationException("sensitive failure details");
                }

                return Access.TryGetValue(user.Id, out var allowed) && allowed.Contains(itemId)
                    ? new Movie { Id = itemId, Name = "Authorized item" }
                    : null;
            }

            if (targetMethod?.Name == nameof(ILibraryManager.GetItemById)
                && args is [Guid, Guid])
            {
                Interlocked.Increment(ref UserIdOverloadCalls);
                return null;
            }

            if (targetMethod?.ReturnType == typeof(void)) return null;
            return targetMethod?.ReturnType.IsValueType == true
                ? Activator.CreateInstance(targetMethod.ReturnType)
                : null;
        }
    }

    public class HomeAccessProxy : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name == nameof(IPtvHomeUserAccessLedger.ReadAsync)
                && args is { Length: >= 3 } && args[0] is Guid userId)
                return Task.FromResult(new PtvHomeUserAccessView
                {
                    UserId = userId.ToString("N"), AccessEpoch = new string('E', 64),
                    Held = false, PolicyProven = true, State = "policy-attested"
                });
            throw new NotSupportedException(targetMethod?.Name);
        }
    }

    private sealed class TestFeaturedContentStore(PtvFeaturedContentDocument document) : IPtvFeaturedContentStore
    {
        public PtvFeaturedContentDocument Document => document;

        public Func<Task>? BeforeStatus { get; set; }

        public Task<PtvFeaturedContentDocument> ReadAsync(CancellationToken cancellationToken) => Task.FromResult(document);

        public Task<PtvFeaturedContentDocument> WriteAsync(PtvFeaturedContentDocument value, CancellationToken cancellationToken) =>
            Task.FromResult(value);

        public Task ClearAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public async Task<PtvFeaturedContentStoreStatus> GetStatusAsync(CancellationToken cancellationToken)
        {
            if (BeforeStatus is not null)
            {
                await BeforeStatus();
            }

            return new PtvFeaturedContentStoreStatus
            {
                CachePayloadBytes = JsonSerializer.SerializeToUtf8Bytes(document).Length,
                Document = document,
                FeaturedCacheExists = true,
                FeaturedCacheFresh = true
            };
        }

        public PtvFeaturedContentDocument ValidateDocument(PtvFeaturedContentDocument? value) => value ?? document;
    }
}
