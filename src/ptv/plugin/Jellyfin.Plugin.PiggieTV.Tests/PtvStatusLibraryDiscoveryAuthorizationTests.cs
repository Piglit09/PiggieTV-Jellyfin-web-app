using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.PiggieTV.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

[Collection("Configured row association serial")]
public sealed class PtvStatusLibraryDiscoveryAuthorizationTests
{
    private static readonly Guid RestrictedUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid OtherUserId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid UserRootId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid VisibleMovieId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid OtherMovieId = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");

    [Fact]
    public void TagsAndRandomDiscoveryUseTheCurrentUsersVisibleItemQuery()
    {
        using var fixture = new Fixture();
        var controller = fixture.Controller(RestrictedUserId.ToString("N"));

        var tags = Payload(controller.GetTags());
        var random = Payload(controller.GetRandomMovie());

        Assert.True(tags.GetProperty("ok").GetBoolean());
        Assert.Equal(["visible-tag"], tags.GetProperty("tags").EnumerateArray().Select(tag => tag.GetString()));
        Assert.True(random.GetProperty("ok").GetBoolean());
        Assert.Equal(VisibleMovieId.ToString("N"), random.GetProperty("item").GetProperty("id").GetString(), ignoreCase: true);
        Assert.Equal(2, fixture.Library.QueryCount);
        Assert.Equal(0, fixture.Library.GlobalRootAccessCount);
        Assert.All(fixture.Library.Queries, query =>
        {
            Assert.Same(fixture.Users.Users[RestrictedUserId], query.User);
            Assert.Equal(UserRootId, query.ParentId);
            Assert.True(query.Recursive);
        });
    }

    [Fact]
    public void DifferentUsersReceiveDifferentTagsWithoutSharingAQueryResult()
    {
        using var fixture = new Fixture();

        var restricted = Payload(fixture.Controller(RestrictedUserId.ToString("N")).GetTags());
        var other = Payload(fixture.Controller(OtherUserId.ToString("N")).GetTags());
        var restrictedAgain = Payload(fixture.Controller(RestrictedUserId.ToString("N")).GetTags());

        Assert.Equal(["visible-tag"], restricted.GetProperty("tags").EnumerateArray().Select(tag => tag.GetString()));
        Assert.Equal(["other-tag"], other.GetProperty("tags").EnumerateArray().Select(tag => tag.GetString()));
        Assert.Equal(["visible-tag"], restrictedAgain.GetProperty("tags").EnumerateArray().Select(tag => tag.GetString()));
        Assert.Equal([RestrictedUserId, OtherUserId, RestrictedUserId],
            fixture.Library.Queries.Select(query => query.User!.Id));
        Assert.Equal(0, fixture.Library.GlobalRootAccessCount);
    }

    [Fact]
    public void RequestedMediaMatchesOnlyItemsVisibleToTheCurrentUser()
    {
        using var fixture = new Fixture();
        var controller = fixture.Controller(RestrictedUserId.ToString("N"));
        var mediaType = typeof(PtvStatusController).GetNestedType("PtvSeerrRequestedMedia", BindingFlags.NonPublic)!;
        var constructor = mediaType.GetConstructors(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
            .Single(candidate => candidate.GetParameters().Length == 5);
        var requestedMedia = Array.CreateInstance(mediaType, 2);
        requestedMedia.SetValue(constructor.Invoke(["101", null, null, "movie", null]), 0);
        requestedMedia.SetValue(constructor.Invoke(["202", null, null, "movie", null]), 1);
        var match = typeof(PtvStatusController).GetMethod("GetRequestedLibraryItems", BindingFlags.Instance | BindingFlags.NonPublic)!;

        var items = (IReadOnlyList<BaseItem>)match.Invoke(controller, [requestedMedia, 10])!;

        Assert.Equal(VisibleMovieId, Assert.Single(items).Id);
        Assert.Single(fixture.Library.Queries);
        Assert.Same(fixture.Users.Users[RestrictedUserId], fixture.Library.Queries[0].User);
        Assert.Equal(0, fixture.Library.GlobalRootAccessCount);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("not-a-guid")]
    public void MissingOrMalformedIdentityNeverEnumeratesLibrary(string? claim)
    {
        using var fixture = new Fixture();
        var tags = Payload(fixture.Controller(claim).GetTags());

        Assert.False(tags.GetProperty("ok").GetBoolean());
        Assert.Equal(0, fixture.Library.QueryCount);
        Assert.Equal(0, fixture.Library.GlobalRootAccessCount);
    }

    [Fact]
    public void DeletedOrConflictingIdentityNeverEnumeratesLibrary()
    {
        using var fixture = new Fixture();
        var deleted = Payload(fixture.Controller(Guid.NewGuid().ToString("N")).GetTags());
        var conflicting = fixture.Controller(RestrictedUserId.ToString("N"));
        conflicting.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim("Jellyfin-UserId", RestrictedUserId.ToString("N")),
            new Claim("Jellyfin-UserId", OtherUserId.ToString("N"))
        ], "test"));
        var ambiguous = Payload(conflicting.GetTags());

        Assert.False(deleted.GetProperty("ok").GetBoolean());
        Assert.False(ambiguous.GetProperty("ok").GetBoolean());
        Assert.Equal(0, fixture.Library.QueryCount);
        Assert.Equal(0, fixture.Library.GlobalRootAccessCount);
    }

    private static JsonElement Payload(ActionResult result) =>
        JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(result).Value);

    private sealed class Fixture : IDisposable
    {
        private readonly ServiceProvider _services;
        public UserProxy Users { get; }
        public LibraryProxy Library { get; }

        public Fixture()
        {
            var userManager = DispatchProxy.Create<IUserManager, UserProxy>();
            Users = (UserProxy)(object)userManager;
            Users.Users[RestrictedUserId] = new User("restricted", "test", "reset") { Id = RestrictedUserId };
            Users.Users[OtherUserId] = new User("other", "test", "reset") { Id = OtherUserId };
            var libraryManager = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
            Library = (LibraryProxy)(object)libraryManager;
            Library.VisibleItems[RestrictedUserId] =
            [
                new Movie
                {
                    Id = VisibleMovieId,
                    Name = "Visible movie",
                    Tags = ["visible-tag"],
                    ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["Tmdb"] = "101" }
                }
            ];
            Library.VisibleItems[OtherUserId] =
            [
                new Movie
                {
                    Id = OtherMovieId,
                    Name = "Other movie",
                    Tags = ["other-tag"],
                    ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["Tmdb"] = "202" }
                }
            ];
            _services = new ServiceCollection()
                .AddSingleton(userManager)
                .AddSingleton(libraryManager)
                .BuildServiceProvider();
        }

        public PtvStatusController Controller(string? claim)
        {
            var claims = claim is null ? [] : new[] { new Claim("Jellyfin-UserId", claim) };
            return new PtvStatusController(NullLogger<PtvStatusController>.Instance, _services)
            {
                ControllerContext = new ControllerContext
                {
                    HttpContext = new DefaultHttpContext
                    {
                        User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test"))
                    }
                }
            };
        }

        public void Dispose() => _services.Dispose();
    }

    public class UserProxy : DispatchProxy
    {
        public Dictionary<Guid, User> Users { get; } = [];

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method?.Name == nameof(IUserManager.GetUserById) && args is [Guid id])
                return Users.GetValueOrDefault(id);
            throw new NotSupportedException(method?.Name);
        }
    }

    public class LibraryProxy : DispatchProxy
    {
        public Dictionary<Guid, List<BaseItem>> VisibleItems { get; } = [];
        public List<InternalItemsQuery> Queries { get; } = [];
        public int QueryCount => Queries.Count;
        public int GlobalRootAccessCount { get; private set; }

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method?.Name == "get_RootFolder")
            {
                GlobalRootAccessCount++;
                throw new InvalidOperationException("Global root must not be enumerated for a user response.");
            }
            if (method?.Name == nameof(ILibraryManager.GetUserRootFolder))
                return new Folder { Id = UserRootId };
            if (method?.Name == nameof(ILibraryManager.GetItemList) && args is [InternalItemsQuery query])
            {
                Queries.Add(query);
                if (query.User is null || !VisibleItems.ContainsKey(query.User.Id)
                    || query.ParentId != UserRootId || !query.Recursive)
                    throw new InvalidOperationException("The item query was not scoped to the current user and root.");
                return VisibleItems[query.User.Id];
            }
            throw new NotSupportedException(method?.Name);
        }
    }
}
