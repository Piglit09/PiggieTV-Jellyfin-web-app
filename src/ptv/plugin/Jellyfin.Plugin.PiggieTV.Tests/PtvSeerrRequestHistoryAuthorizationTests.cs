using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

[Collection("Configured row association serial")]
public sealed class PtvSeerrRequestHistoryAuthorizationTests
{
    private static readonly Guid CurrentUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OtherUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public async Task CallerCannotReadAnotherUsersSeerrHistoryEvenWhenIntegrationIsDisabled()
    {
        using var fixture = new Fixture();
        var result = await fixture.Controller(CurrentUserId.ToString("N"))
            .GetSeerrRequestedItems(OtherUserId.ToString("N"), null, CancellationToken.None);

        var denied = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, denied.StatusCode);
        Assert.DoesNotContain(OtherUserId.ToString("N"), JsonSerializer.Serialize(denied.Value), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("not-a-guid")]
    public async Task RequestedHistoryRequiresAValidTargetIdentity(string? requestedUserId)
    {
        using var fixture = new Fixture();
        var result = await fixture.Controller(CurrentUserId.ToString("N"))
            .GetSeerrRequestedItems(requestedUserId, null, CancellationToken.None);

        Assert.Equal(StatusCodes.Status400BadRequest, Assert.IsType<BadRequestObjectResult>(result).StatusCode);
    }

    [Fact]
    public async Task MissingAmbiguousOrDeletedPrincipalCannotReadRequestHistory()
    {
        using var fixture = new Fixture();
        var missing = fixture.Controller(null);
        var ambiguous = fixture.Controller(CurrentUserId.ToString("N"));
        ambiguous.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim("Jellyfin-UserId", CurrentUserId.ToString("N")),
            new Claim("Jellyfin-UserId", OtherUserId.ToString("N"))
        ], "test"));
        var deleted = fixture.Controller(Guid.NewGuid().ToString("N"));

        foreach (var controller in new[] { missing, ambiguous, deleted })
        {
            var result = await controller.GetSeerrRequestedItems(OtherUserId.ToString("N"), null, CancellationToken.None);
            Assert.Equal(StatusCodes.Status401Unauthorized,
                Assert.IsType<UnauthorizedObjectResult>(result).StatusCode);
        }
    }

    [Fact]
    public async Task MatchingCurrentUserGuidRetainsNormalIntegrationAvailabilityResult()
    {
        using var fixture = new Fixture();
        var result = await fixture.Controller(CurrentUserId.ToString("N"))
            .GetSeerrRequestedItems(CurrentUserId.ToString("D"), null, CancellationToken.None);

        var payload = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(result).Value);
        Assert.False(payload.GetProperty("ok").GetBoolean());
        Assert.Contains("not configured", payload.GetProperty("error").GetString(), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("null", false)]
    [InlineData("\"not-an-id\"", false)]
    [InlineData("{\"id\":74}", false)]
    [InlineData("{\"id\":73}", true)]
    public void GlobalRequestFallbackRequiresProvenExactRequester(string? requesterJson, bool expectedMatch)
    {
        var requester = requesterJson is null ? string.Empty : ",\"requestedBy\":" + requesterJson;
        var payload = JsonNode.Parse("{\"results\":[{\"media\":{\"tmdbId\":\"123\",\"mediaType\":\"movie\"}" + requester + "}]}")!;
        var extract = typeof(PtvStatusController).GetMethod("ExtractSeerrRequestedMedia", BindingFlags.Static | BindingFlags.NonPublic)!;
        var media = ((System.Collections.IEnumerable)extract.Invoke(null, [payload])!).Cast<object>().Single();
        var match = typeof(PtvStatusController).GetMethod("MatchesSeerrRequester", BindingFlags.Static | BindingFlags.NonPublic)!;

        Assert.Equal(expectedMatch, (bool)match.Invoke(null, [media, 73])!);
    }

    private sealed class Fixture : IDisposable
    {
        private readonly Plugin? _previousPlugin = Plugin.Instance;
        private readonly string _directory = Path.Combine(Path.GetTempPath(), "ptv-seerr-history-auth-" + Guid.NewGuid().ToString("N"));
        private readonly ServiceProvider _services;

        public Fixture()
        {
            var paths = DispatchProxy.Create<IApplicationPaths, InfrastructureProxy>();
            ((InfrastructureProxy)(object)paths).Path = _directory;
            var plugin = new Plugin(paths, DispatchProxy.Create<IXmlSerializer, InfrastructureProxy>());
            plugin.UpdateConfiguration(new PluginConfiguration
            {
                SeerrSettings = new SeerrSettings { Enabled = false, EnableRequestsPage = true }
            });
            var users = DispatchProxy.Create<IUserManager, UserProxy>();
            ((UserProxy)(object)users).User = new User("current", "test", "reset") { Id = CurrentUserId };
            _services = new ServiceCollection().AddSingleton(users).BuildServiceProvider();
        }

        public PtvStatusController Controller(string? userId)
        {
            var claims = userId is null ? [] : new[] { new Claim("Jellyfin-UserId", userId) };
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

        public void Dispose()
        {
            _services.Dispose();
            typeof(Plugin).GetField("<Instance>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic)!
                .SetValue(null, _previousPlugin);
            if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
        }
    }

    public class UserProxy : DispatchProxy
    {
        public User User { get; set; } = null!;

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method?.Name == nameof(IUserManager.GetUserById) && args is [Guid id])
                return id == User.Id ? User : null;
            throw new NotSupportedException(method?.Name);
        }
    }

    public class InfrastructureProxy : DispatchProxy
    {
        public string Path { get; set; } = string.Empty;

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method?.Name == "SerializeToFile") return null;
            if (method?.Name.StartsWith("get_", StringComparison.Ordinal) == true
                && method.ReturnType == typeof(string)) return Path;
            throw new NotSupportedException(method?.Name);
        }
    }
}
