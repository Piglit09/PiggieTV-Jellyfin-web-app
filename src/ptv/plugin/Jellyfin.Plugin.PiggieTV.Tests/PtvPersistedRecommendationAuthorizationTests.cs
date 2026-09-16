using System.Collections.Concurrent;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

// Real controller + serialized response. Only external Jellyfin authority is modeled;
// hosted authentication middleware and physical Jellyfin policy are separate acceptance gates.
[Collection("Configured row association serial")]
public sealed class PtvPersistedRecommendationAuthorizationTests
{
    private static readonly Guid AdminId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid RestrictedId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid[] ItemIds = Enumerable.Range(1, 4)
        .Select(i => Guid.Parse($"aaaaaaaa-aaaa-aaaa-aaaa-{i:D12}")).ToArray();
    private const string HiddenSubject = "PRIVATE-SUBJECT-73";

    [Theory]
    [InlineData(4)]
    [InlineData(2)]
    [InlineData(1)]
    [InlineData(0)]
    public void VisibleSurvivorsOnlyAreSerializedInCandidateOrder(int visibleCount)
    {
        using var fixture = new Fixture();
        // Keep the last candidates, so raw indexes would expose removed positions.
        var expected = ItemIds.Skip(4 - visibleCount).ToArray();
        fixture.Allow(RestrictedId, expected);
        var before = JsonSerializer.Serialize(fixture.Configuration);
        var json = fixture.Read(RestrictedId);

        Assert.Equal(expected.Select(id => id.ToString("N")), Ids(json));
        Assert.Equal(Enumerable.Range(0, visibleCount).Select(i => Math.Max(0, 100 - i)), Scores(json));
        Assert.Equal(visibleCount == 0 ? 0 : 1, json["rows"]!.AsArray().Count);
        Assert.DoesNotContain(HiddenSubject, json.ToJsonString());
        foreach (var hidden in ItemIds.Except(expected))
        {
            Assert.DoesNotContain(hidden.ToString("N"), json.ToJsonString());
        }
        Assert.Equal(before, JsonSerializer.Serialize(fixture.Configuration));
        fixture.AssertAuthority(RestrictedId, ItemIds);
    }

    [Fact]
    public void CurrentResolvedMetadataReplacesAllPersistedMetadata()
    {
        using var fixture = new Fixture();
        var json = fixture.Read(AdminId);
        var items = Items(json);
        Assert.Equal(new[] { "Current movie", "Current show", "Current song", "Current movie four" }, items.Select(i => i!["title"]!.GetValue<string>()));
        Assert.Equal(new[] { "movie", "show", "music", "movie" }, items.Select(i => i!["mediaType"]!.GetValue<string>()));
        Assert.DoesNotContain(HiddenSubject, json.ToJsonString());
        Assert.Equal("1.0", json["contractVersion"]!.GetValue<string>());
        Assert.Equal(3, json["cacheVersion"]!.GetValue<int>());
        Assert.Equal("server-a", json["serverId"]!.GetValue<string>());
        Assert.Equal(AdminId.ToString("N"), json["userId"]!.GetValue<string>());
        Assert.Equal(new[] { "cacheVersion", "contractVersion", "generatedAt", "rows", "serverId", "userId" }, json.AsObject().Select(p => p.Key).OrderBy(k => k));
        Assert.Equal(new[] { "explanation", "id", "items", "mediaType", "source", "title" }, json["rows"]![0]!.AsObject().Select(p => p.Key).OrderBy(k => k));
        Assert.Equal(new[] { "classification", "id", "mediaType", "reasons", "score", "source", "title" }, items[0]!.AsObject().Select(p => p.Key).OrderBy(k => k));
        fixture.AssertAuthority(AdminId, ItemIds);
    }

    [Fact]
    public void HiddenHeadingSubjectAbsentFromItemsCannotLeakThroughRowOrReasons()
    {
        using var fixture = new Fixture();
        var hiddenId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb").ToString("N");
        var row = fixture.Settings.Rows[0];
        row.Id = $"becauseYouWatched-{hiddenId}";
        row.Title = $"Because you watched {HiddenSubject}";
        row.Explanation = $"More like {HiddenSubject} ({hiddenId})";
        row.MediaType = HiddenSubject;

        var json = fixture.Read(AdminId);
        Assert.DoesNotContain(hiddenId, json.ToJsonString());
        Assert.DoesNotContain(HiddenSubject, json.ToJsonString());
        var first = json["rows"]![0]!;
        Assert.Equal("recommendation-1", first["id"]!.GetValue<string>());
        Assert.Equal("Recommended", first["title"]!.GetValue<string>());
        Assert.Equal("Recommended for you.", first["explanation"]!.GetValue<string>());
        Assert.Equal("mixed", first["mediaType"]!.GetValue<string>());
        Assert.All(Items(json), item =>
        {
            Assert.Equal("recommendation-1", item!["source"]!.GetValue<string>());
            Assert.Equal("Recommended for you.", item["reasons"]![0]!["text"]!.GetValue<string>());
        });
    }

    [Fact]
    public void EmptyRowsDoNotAffectResponseIdsOrRevealHiddenMembership()
    {
        using var fixture = new Fixture();
        fixture.Allow(RestrictedId, ItemIds[1]);
        fixture.Settings.Rows = [Row(ItemIds[0]), Row(ItemIds[1]), Row(ItemIds[2]), Row(ItemIds[1])];
        var json = fixture.Read(RestrictedId);
        Assert.Equal(new[] { "recommendation-1", "recommendation-2" }, json["rows"]!.AsArray().Select(r => r!["id"]!.GetValue<string>()));
        Assert.Equal(new[] { ItemIds[1].ToString("N"), ItemIds[1].ToString("N") }, Ids(json));
        fixture.Settings.Rows.RemoveAt(0);
        fixture.Settings.Rows.RemoveAt(1);
        Assert.Equal(json.ToJsonString(), fixture.Read(RestrictedId).ToJsonString());
    }

    [Fact]
    public void MissingDeletedAndUnavailableItemsFailClosedIndividually()
    {
        using var fixture = new Fixture();
        fixture.Library.Catalog.Remove(ItemIds[1]);
        fixture.Library.ThrowFor.Add(ItemIds[2]);
        var json = fixture.Read(AdminId);
        Assert.Equal(new[] { ItemIds[0].ToString("N"), ItemIds[3].ToString("N") }, Ids(json));
        Assert.DoesNotContain("private lookup failure", json.ToJsonString());
        fixture.AssertAuthority(AdminId, ItemIds);
    }

    [Theory]
    [InlineData("library")]
    [InlineData("parental")]
    public void RestrictedLibraryAndContentPolicyAreDelegatedToJellyfin(string deniedBy)
    {
        using var fixture = new Fixture();
        fixture.Library.Policies[RestrictedId] = deniedBy == "library"
            ? new Policy(new HashSet<string> { "public" }, 100)
            : new Policy(new HashSet<string> { "public", "private" }, 12);
        var restricted = fixture.Read(RestrictedId);
        Assert.Equal(deniedBy == "library"
            ? new[] { ItemIds[0].ToString("N"), ItemIds[2].ToString("N"), ItemIds[3].ToString("N") }
            : new[] { ItemIds[0].ToString("N"), ItemIds[1].ToString("N"), ItemIds[3].ToString("N") }, Ids(restricted));
        fixture.AssertAuthority(RestrictedId, ItemIds);
        Assert.Equal(ItemIds.Select(id => id.ToString("N")), Ids(fixture.Read(AdminId)));
        fixture.AssertAuthority(AdminId, ItemIds);
    }

    [Fact]
    public async Task ConcurrentAdminAndRestrictedRequestsHaveIndependentProjections()
    {
        using var fixture = new Fixture();
        fixture.Allow(RestrictedId, ItemIds[1], ItemIds[3]);
        var before = JsonSerializer.Serialize(fixture.Configuration);
        using var barrier = new Barrier(2);
        var entered = new ConcurrentDictionary<Guid, byte>();
        fixture.Library.BeforeResolve = (_, user) =>
        {
            if (entered.TryAdd(user.Id, 0)) Assert.True(barrier.SignalAndWait(TimeSpan.FromSeconds(10)));
        };
        var responses = await Task.WhenAll(Task.Run(() => fixture.Read(AdminId)), Task.Run(() => fixture.Read(RestrictedId)));
        Assert.Equal(ItemIds.Select(id => id.ToString("N")), Ids(responses[0]));
        Assert.Equal(new[] { ItemIds[1].ToString("N"), ItemIds[3].ToString("N") }, Ids(responses[1]));
        Assert.Equal(before, JsonSerializer.Serialize(fixture.Configuration));
        fixture.AssertAuthority(AdminId, ItemIds);
        fixture.AssertAuthority(RestrictedId, ItemIds);
    }

    [Fact]
    public void RepeatedRequestsRemainDeterministicAndRecheckAuthority()
    {
        using var fixture = new Fixture();
        fixture.Allow(RestrictedId, ItemIds[0], ItemIds[2]);
        Assert.Equal(fixture.Read(RestrictedId).ToJsonString(), fixture.Read(RestrictedId).ToJsonString());
        fixture.AssertAuthority(RestrictedId, ItemIds.Concat(ItemIds));
        Assert.Equal(2, fixture.Users.Lookups.Count(id => id == RestrictedId));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void PermissionChangesBetweenRequestsNeverReuseAuthorizationOrDenial(bool losesPermission)
    {
        using var fixture = new Fixture();
        fixture.Allow(RestrictedId, losesPermission ? ItemIds : [ItemIds[0]]);
        Assert.Equal(losesPermission ? 4 : 1, Ids(fixture.Read(RestrictedId)).Length);
        fixture.Allow(RestrictedId, losesPermission ? [ItemIds[0]] : ItemIds);
        Assert.Equal(losesPermission ? 1 : 4, Ids(fixture.Read(RestrictedId)).Length);
        fixture.AssertAuthority(RestrictedId, ItemIds.Concat(ItemIds));
    }

    [Theory]
    [InlineData("other-user", "current-server", "PTV_RECOMMENDATION_USER_SCOPE_MISMATCH")]
    [InlineData("current-user", "other-server", "PTV_RECOMMENDATION_SERVER_SCOPE_MISMATCH")]
    public void ScopeMismatchRemainsForbidden(string userScope, string serverScope, string error)
    {
        using var fixture = new Fixture();
        var result = fixture.Controller(RestrictedId).GetPersistedRecommendations(serverScope, userScope);
        var response = Assert.IsType<ObjectResult>(result);
        Assert.Equal(403, response.StatusCode);
        Assert.Contains(error, JsonSerializer.Serialize(response.Value));
        Assert.Empty(fixture.Library.Lookups);
    }

    [Theory]
    [InlineData("anonymous")]
    [InlineData("unauthenticated-with-valid-claim")]
    [InlineData("missing")]
    [InlineData("invalid")]
    [InlineData("empty-guid")]
    [InlineData("conflicting-claims")]
    [InlineData("conflicting-identities")]
    [InlineData("invalid-secondary-claim")]
    public void InvalidOrAmbiguousAuthenticationIsRejectedBeforeItemLookup(string kind)
    {
        using var fixture = new Fixture();
        var controller = fixture.Controller(RestrictedId);
        var valid = new Claim("Jellyfin-UserId", RestrictedId.ToString("N"));
        controller.HttpContext.User = kind switch
        {
            "anonymous" => new ClaimsPrincipal(new ClaimsIdentity()),
            "unauthenticated-with-valid-claim" => new ClaimsPrincipal(new ClaimsIdentity([valid])),
            "missing" => Principal([]),
            "invalid" => Principal([new Claim("Jellyfin-UserId", "invalid")]),
            "empty-guid" => Principal([new Claim("Jellyfin-UserId", Guid.Empty.ToString())]),
            "conflicting-claims" => Principal([valid, new Claim("sub", AdminId.ToString())]),
            "conflicting-identities" => new ClaimsPrincipal([new ClaimsIdentity([valid], "test"), new ClaimsIdentity([new Claim("Jellyfin-UserId", AdminId.ToString())], "other")]),
            _ => Principal([valid, new Claim(ClaimTypes.NameIdentifier, "invalid")])
        };
        var result = controller.GetPersistedRecommendations("current-server", "current-user");
        Assert.IsType<UnauthorizedObjectResult>(result);
        Assert.Empty(fixture.Library.Lookups);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("unavailable")]
    [InlineData("wrong-user")]
    public void MissingUnavailableOrWrongResolvedUserFailsClosed(string mode)
    {
        using var fixture = new Fixture();
        if (mode == "missing") fixture.Users.Users.Remove(RestrictedId);
        if (mode == "unavailable") fixture.Users.ThrowOnLookup = true;
        if (mode == "wrong-user") fixture.Users.Users[RestrictedId] = fixture.Users.Users[AdminId];
        var result = fixture.Controller(RestrictedId).GetPersistedRecommendations(null, null);
        Assert.IsType<UnauthorizedObjectResult>(result);
        Assert.Empty(fixture.Library.Lookups);
        Assert.DoesNotContain("private user failure", JsonSerializer.Serialize(((ObjectResult)result).Value));
    }

    [Fact]
    public void EquivalentValidClaimsAndScopeAliasesResolveOneActualUser()
    {
        using var fixture = new Fixture();
        var controller = fixture.Controller(RestrictedId);
        controller.HttpContext.User = Principal([new Claim("Jellyfin-UserId", RestrictedId.ToString("N")), new Claim("sub", RestrictedId.ToString("D"))]);
        var response = Serialize(controller.GetPersistedRecommendations(null, null));
        Assert.Equal(RestrictedId.ToString("N"), response["userId"]!.GetValue<string>());
        fixture.AssertAuthority(RestrictedId, ItemIds);
    }

    [Fact]
    public void MalformedEmptyAndSyntheticIdsAreNotLibraryCandidates()
    {
        using var fixture = new Fixture();
        fixture.Settings.Rows[0].Items.InsertRange(0, [Snapshot("not-a-guid"), Snapshot(""), Snapshot(Guid.Empty.ToString()), Snapshot("synthetic:recommendation")]);
        var json = fixture.Read(AdminId);
        Assert.Equal(ItemIds.Select(id => id.ToString("N")), Ids(json));
        Assert.DoesNotContain("synthetic", json.ToJsonString());
        fixture.AssertAuthority(AdminId, ItemIds);
    }

    [Fact]
    public void DuplicateAuthorizedOccurrencesPreserveOrderAndSurvivorScores()
    {
        using var fixture = new Fixture();
        fixture.Settings.Rows = [Row(ItemIds[0], ItemIds[1], ItemIds[0], ItemIds[2])];
        fixture.Allow(RestrictedId, ItemIds[0], ItemIds[2]);
        var json = fixture.Read(RestrictedId);
        Assert.Equal(new[] { ItemIds[0].ToString("N"), ItemIds[0].ToString("N"), ItemIds[2].ToString("N") }, Ids(json));
        Assert.Equal(new[] { 100, 99, 98 }, Scores(json));
        fixture.AssertAuthority(RestrictedId, [ItemIds[0], ItemIds[1], ItemIds[0], ItemIds[2]]);
    }

    [Fact]
    public async Task ConfigurationMutationDuringProjectionUsesDetachedSnapshotWithoutHoldingGate()
    {
        using var fixture = new Fixture();
        fixture.Allow(RestrictedId, ItemIds[0], ItemIds[2]);
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var release = new ManualResetEventSlim();
        fixture.Library.BeforeResolve = (_, _) =>
        {
            Assert.False(Monitor.IsEntered(PtvConfiguredRowAssociationService.ConfigurationGate));
            started.TrySetResult();
            Assert.True(release.Wait(TimeSpan.FromSeconds(10)));
        };
        var projecting = Task.Run(() => fixture.Read(RestrictedId));
        string changed;
        try
        {
            await started.Task.WaitAsync(TimeSpan.FromSeconds(10));
            lock (PtvConfiguredRowAssociationService.ConfigurationGate)
            {
                fixture.Settings.Rows[0].Items[0].Id = ItemIds[3].ToString("N");
                fixture.Settings.Rows[0].Items.Clear();
                fixture.Settings.Rows = [Row(ItemIds[3])];
                fixture.Settings.SchemaVersion = 99;
                fixture.Settings.GeneratedAt = 1800000000000;
                changed = JsonSerializer.Serialize(fixture.Configuration);
            }
        }
        finally
        {
            release.Set();
        }
        var json = await projecting;
        Assert.Equal(new[] { ItemIds[0].ToString("N"), ItemIds[2].ToString("N") }, Ids(json));
        Assert.Equal(3, json["cacheVersion"]!.GetValue<int>());
        Assert.Equal(changed, JsonSerializer.Serialize(fixture.Configuration));
        fixture.AssertAuthority(RestrictedId, ItemIds);
    }

    [Fact]
    public void ReturnedResultIsEagerAndDetachedFromLaterConfigurationAndItemMutation()
    {
        using var fixture = new Fixture();
        var action = fixture.Controller(AdminId).GetPersistedRecommendations(null, null);
        fixture.AssertAuthority(AdminId, ItemIds);
        foreach (var entry in fixture.Library.Catalog.Values) entry.Item.Name = HiddenSubject;
        fixture.Settings.Rows[0].Items.Clear();
        fixture.Settings.Rows.Clear();
        var json = Serialize(action);
        Assert.Equal(ItemIds.Select(id => id.ToString("N")), Ids(json));
        Assert.Equal("Current movie", Items(json)[0]!["title"]!.GetValue<string>());
        Assert.DoesNotContain(HiddenSubject, json.ToJsonString());
    }

    [Fact]
    public void IneligibleRowsAreNotResolvedOrReturned()
    {
        using var fixture = new Fixture();
        fixture.Settings.Rows = [Row(ItemIds[0]), Row(ItemIds[1]), Row(ItemIds[2])];
        fixture.Settings.Rows[0].Enabled = false;
        fixture.Settings.Rows[1].Draft = true;
        fixture.Settings.Rows[1].Accepted = false;
        Assert.Equal(new[] { ItemIds[2].ToString("N") }, Ids(fixture.Read(AdminId)));
        fixture.AssertAuthority(AdminId, [ItemIds[2]]);
    }

    [Fact]
    public void UnavailableConfigurationSnapshotFailsSafelyWithoutPrivateDetails()
    {
        using var fixture = new Fixture();
        fixture.Settings.Rows = null!;
        var result = fixture.Controller(AdminId).GetPersistedRecommendations(null, null);
        var failure = Assert.IsType<ObjectResult>(result);
        Assert.Equal(503, failure.StatusCode);
        Assert.DoesNotContain(HiddenSubject, JsonSerializer.Serialize(failure.Value));
        Assert.Empty(fixture.Library.Lookups);
    }

    [Fact]
    public void ResponseCannotBeStoredInSharedOrPrivateCaches()
    {
        using var fixture = new Fixture();
        var controller = fixture.Controller(AdminId);
        _ = controller.GetPersistedRecommendations(null, null);
        Assert.Equal("private, no-store", controller.Response.Headers.CacheControl.ToString());
        Assert.Equal("no-cache", controller.Response.Headers.Pragma.ToString());
        Assert.Equal("0", controller.Response.Headers.Expires.ToString());
        Assert.NotEmpty(typeof(PtvRecommendationController).GetCustomAttributes<AuthorizeAttribute>());
    }

    private static ClaimsPrincipal Principal(Claim[] claims) => new(new ClaimsIdentity(claims, "test"));
    private static JsonNode Serialize(ActionResult action) => JsonSerializer.SerializeToNode(Assert.IsType<OkObjectResult>(action).Value)!;
    private static JsonNode?[] Items(JsonNode json) => json["rows"]!.AsArray().SelectMany(row => row!["items"]!.AsArray()).ToArray();
    private static string[] Ids(JsonNode json) => Items(json).Select(i => i!["id"]!.GetValue<string>()).ToArray();
    private static int[] Scores(JsonNode json) => Items(json).Select(i => i!["score"]!.GetValue<int>()).ToArray();
    private static RecommendationItemSnapshot Snapshot(string id) => new() { Id = id, Name = HiddenSubject, Type = HiddenSubject, MediaType = HiddenSubject, Overview = HiddenSubject };
    private static RecommendationRowDefinition Row(params Guid[] ids) => new()
    {
        Id = HiddenSubject,
        Title = HiddenSubject,
        Explanation = HiddenSubject,
        MediaType = HiddenSubject,
        Enabled = true,
        Draft = false,
        Items = ids.Select(id => Snapshot(id.ToString("N"))).ToList()
    };

    private sealed class Fixture : IDisposable
    {
        private readonly Plugin? _previous = Plugin.Instance;
        private readonly ServiceProvider _services;
        private readonly string _directory = Path.Combine(Path.GetTempPath(), "ptv-recommendations-auth-" + Guid.NewGuid().ToString("N"));
        public PluginConfiguration Configuration { get; } = new();
        public RecommendationRowSettings Settings => Configuration.Recommendations;
        public UserProxy Users { get; }
        public LibraryProxy Library { get; }

        public Fixture()
        {
            var users = DispatchProxy.Create<IUserManager, UserProxy>();
            Users = (UserProxy)(object)users;
            Users.Users[AdminId] = new User("admin", "test", "reset") { Id = AdminId };
            Users.Users[RestrictedId] = new User("restricted", "test", "reset") { Id = RestrictedId };
            var library = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
            Library = (LibraryProxy)(object)library;
            Library.Catalog[ItemIds[0]] = new(new Movie { Id = ItemIds[0], Name = "Current movie" }, "public", 0);
            Library.Catalog[ItemIds[1]] = new(new Series { Id = ItemIds[1], Name = "Current show" }, "private", 0);
            Library.Catalog[ItemIds[2]] = new(new Audio { Id = ItemIds[2], Name = "Current song" }, "public", 18);
            Library.Catalog[ItemIds[3]] = new(new Movie { Id = ItemIds[3], Name = "Current movie four" }, "public", 0);
            Allow(AdminId, ItemIds);
            Allow(RestrictedId, ItemIds);
            var paths = DispatchProxy.Create<IApplicationPaths, InfrastructureProxy>();
            ((InfrastructureProxy)(object)paths).Path = _directory;
            var plugin = new Plugin(paths, DispatchProxy.Create<IXmlSerializer, InfrastructureProxy>());
            Configuration.Recommendations = new RecommendationRowSettings { SchemaVersion = 3, GeneratedAt = 1700000000000, Rows = [Row(ItemIds)] };
            plugin.UpdateConfiguration(Configuration);
            _services = new ServiceCollection()
                .AddSingleton<IPtvRecommendationPolicyService>(new PtvRecommendationPolicyService())
                .AddSingleton(DispatchProxy.Create<IServerApplicationHost, InfrastructureProxy>())
                .AddSingleton(users).AddSingleton(library).BuildServiceProvider();
        }

        public void Allow(Guid userId, params Guid[] ids) => Library.Allowed[userId] = ids.ToHashSet();
        public PtvRecommendationController Controller(Guid userId)
        {
            var controller = ActivatorUtilities.CreateInstance<PtvRecommendationController>(_services);
            controller.ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = Principal([new Claim("Jellyfin-UserId", userId.ToString("N"))]) }
            };
            return controller;
        }
        public JsonNode Read(Guid userId) => Serialize(Controller(userId).GetPersistedRecommendations("current-server", "current-user"));
        public void AssertAuthority(Guid userId, IEnumerable<Guid> itemIds)
        {
            Assert.Contains(userId, Users.Lookups);
            var calls = Library.Lookups.Where(c => c.User?.Id == userId).ToArray();
            Assert.Equal(itemIds, calls.Select(c => c.Id));
            Assert.All(calls, call =>
            {
                Assert.Same(Users.Users[userId], call.User);
                Assert.Equal(typeof(BaseItem), call.GenericType);
            });
            Assert.Equal(0, Library.UnsafeLookupCalls);
        }
        public void Dispose()
        {
            _services.Dispose();
            typeof(Plugin).GetField("<Instance>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic)!.SetValue(null, _previous);
            if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
        }
    }

    public sealed record CatalogEntry(BaseItem Item, string LibraryId, int ContentRating);
    public sealed record Policy(IReadOnlySet<string> Libraries, int MaximumRating);
    public sealed record Lookup(Guid Id, User? User, Type? GenericType);

    public class UserProxy : DispatchProxy
    {
        public Dictionary<Guid, User> Users { get; } = [];
        public ConcurrentQueue<Guid> Lookups { get; } = new();
        public bool ThrowOnLookup { get; set; }
        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method?.Name == nameof(IUserManager.GetUserById) && args is [Guid userId])
            {
                Lookups.Enqueue(userId);
                if (ThrowOnLookup) throw new InvalidOperationException("private user failure");
                return Users.GetValueOrDefault(userId);
            }
            throw new NotSupportedException(method?.Name);
        }
    }

    public class LibraryProxy : DispatchProxy
    {
        public Dictionary<Guid, CatalogEntry> Catalog { get; } = [];
        public Dictionary<Guid, HashSet<Guid>> Allowed { get; } = [];
        public Dictionary<Guid, Policy> Policies { get; } = [];
        public HashSet<Guid> ThrowFor { get; } = [];
        public ConcurrentQueue<Lookup> Lookups { get; } = new();
        public Action<Guid, User>? BeforeResolve { get; set; }
        public int UnsafeLookupCalls;
        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method?.Name == nameof(ILibraryManager.GetItemById) && args is [Guid id, User user])
            {
                Lookups.Enqueue(new(id, user, method.GetGenericArguments().SingleOrDefault()));
                BeforeResolve?.Invoke(id, user);
                if (ThrowFor.Contains(id)) throw new InvalidOperationException("private lookup failure");
                if (!Catalog.TryGetValue(id, out var entry) || !Allowed.GetValueOrDefault(user.Id, []).Contains(id)) return null;
                if (Policies.TryGetValue(user.Id, out var policy)
                    && (!policy.Libraries.Contains(entry.LibraryId) || entry.ContentRating > policy.MaximumRating)) return null;
                return entry.Item;
            }
            if (method?.Name == nameof(ILibraryManager.GetItemById) && args?[0] is Guid unsafeId)
            {
                Interlocked.Increment(ref UnsafeLookupCalls);
                return Catalog.GetValueOrDefault(unsafeId)?.Item;
            }
            throw new NotSupportedException(method?.Name);
        }
    }

    public class InfrastructureProxy : DispatchProxy
    {
        public string Path { get; set; } = string.Empty;
        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method?.Name == "get_SystemId") return "server-a";
            if (method?.Name == "SerializeToFile") return null;
            if (method?.Name.StartsWith("get_", StringComparison.Ordinal) == true && method.ReturnType == typeof(string)) return Path;
            throw new NotSupportedException(method?.Name);
        }
    }
}
