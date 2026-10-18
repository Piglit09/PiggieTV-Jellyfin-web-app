using System.Reflection;
using System.Security.Claims;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

[Collection("Configured row association serial")]
public sealed class PtvSeerrRequestWriteAuthorizationTests
{
    private static readonly Guid CurrentUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OtherUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public async Task RestrictedUserCannotWriteThroughSharedSeerrKeyEvenWhenIntegrationIsDisabled()
    {
        using var fixture = new Fixture();
        var result = await fixture.Controller(CurrentUserId.ToString("N"), elevated: false)
            .RequestSeerr(JsonNode.Parse("""{"mediaType":"movie","mediaId":123}""")!.AsObject(), CancellationToken.None);

        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(result).StatusCode);
    }

    [Fact]
    public async Task MissingAmbiguousOrDeletedPrincipalCannotWriteThroughSharedSeerrKey()
    {
        using var fixture = new Fixture();
        var missing = fixture.Controller(null, elevated: true);
        var ambiguous = fixture.Controller(CurrentUserId.ToString("N"), elevated: true);
        ambiguous.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim("Jellyfin-UserId", CurrentUserId.ToString("N")),
            new Claim("Jellyfin-UserId", OtherUserId.ToString("N"))
        ], "test"));
        var deleted = fixture.Controller(Guid.NewGuid().ToString("N"), elevated: true);

        foreach (var controller in new[] { missing, ambiguous, deleted })
        {
            var result = await controller.RequestSeerr(
                JsonNode.Parse("""{"mediaType":"movie","mediaId":123}""")!.AsObject(), CancellationToken.None);
            Assert.Equal(StatusCodes.Status401Unauthorized, Assert.IsType<UnauthorizedObjectResult>(result).StatusCode);
        }
    }

    [Theory]
    [InlineData("""{"mediaType":"movie","mediaId":123,"userId":7}""")]
    [InlineData("""{"mediaType":"movie","mediaId":123,"ignoreQuota":true}""")]
    [InlineData("""{"mediaType":"tv","mediaId":123,"serverId":4}""")]
    [InlineData("""{"mediaType":"movie","mediaId":123,"is4k":true}""")]
    [InlineData("""{"mediaType":"movie","mediaId":123,"profileId":5}""")]
    public async Task EvenAdministratorCannotForwardPrivilegedOrConfigurationFields(string json)
    {
        using var fixture = new Fixture();
        var result = await fixture.Controller(CurrentUserId.ToString("N"), elevated: true)
            .RequestSeerr(JsonNode.Parse(json)!.AsObject(), CancellationToken.None);

        Assert.Equal(StatusCodes.Status400BadRequest, Assert.IsType<BadRequestObjectResult>(result).StatusCode);
    }

    [Theory]
    [InlineData("""{"mediaType":"movie","mediaId":0}""")]
    [InlineData("""{"mediaType":"movie","mediaId":"123"}""")]
    [InlineData("""{"mediaType":"tv","mediaId":123,"seasons":[1,1]}""")]
    [InlineData("""{"mediaType":"movie","mediaId":123,"seasons":[1]}""")]
    [InlineData("""{"mediaType":"movie","mediaId":123,"Seasons":[1]}""")]
    public async Task InvalidOrAmbiguousRequestShapeIsRejectedBeforeConfiguredKeyIsUsed(string json)
    {
        using var fixture = new Fixture();
        var result = await fixture.Controller(CurrentUserId.ToString("N"), elevated: true)
            .RequestSeerr(JsonNode.Parse(json)!.AsObject(), CancellationToken.None);

        Assert.Equal(StatusCodes.Status400BadRequest, Assert.IsType<BadRequestObjectResult>(result).StatusCode);
    }

    [Fact]
    public async Task AuthorizedSafeRequestRetainsDisabledIntegrationAvailabilityResponse()
    {
        using var fixture = new Fixture();
        var result = await fixture.Controller(CurrentUserId.ToString("N"), elevated: true)
            .RequestSeerr(JsonNode.Parse("""{"mediaType":"tv","mediaId":123,"seasons":[1,2]}""")!.AsObject(), CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
    }

    [Theory]
    [InlineData("""{"mediaType":"movie","mediaId":123}""")]
    [InlineData("""{"mediaType":"tv","mediaId":123,"seasons":[0,2]}""")]
    public async Task AuthorizedRequestSendsOnlyAllowlistedFieldsToFixtureSeerr(string json)
    {
        using var seerr = new LoopbackSeerrServer();
        using var fixture = new Fixture(seerr.Url);
        var inbound = seerr.ReadOneRequestAsync();

        var result = await fixture.Controller(CurrentUserId.ToString("N"), elevated: true)
            .RequestSeerr(JsonNode.Parse(json)!.AsObject(), CancellationToken.None);
        var sent = await inbound;

        Assert.IsType<OkObjectResult>(result);
        Assert.Equal("POST /api/v1/request HTTP/1.1", sent.RequestLine);
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(json), JsonNode.Parse(sent.Body)));
    }

    private sealed class Fixture : IDisposable
    {
        private readonly Plugin? _previousPlugin = Plugin.Instance;
        private readonly string _directory = Path.Combine(Path.GetTempPath(), "ptv-seerr-write-auth-" + Guid.NewGuid().ToString("N"));
        private readonly ServiceProvider _services;

        public Fixture(string? seerrUrl = null)
        {
            var paths = DispatchProxy.Create<IApplicationPaths, InfrastructureProxy>();
            ((InfrastructureProxy)(object)paths).Path = _directory;
            var plugin = new Plugin(paths, DispatchProxy.Create<IXmlSerializer, InfrastructureProxy>());
            plugin.UpdateConfiguration(new PluginConfiguration
            {
                SeerrSettings = new SeerrSettings
                {
                    Enabled = seerrUrl is not null,
                    EnableRequestsPage = true,
                    InternalUrl = seerrUrl ?? "http://127.0.0.1:1",
                    ApiKey = seerrUrl is not null ? "fixture-key" : null
                }
            });
            var users = DispatchProxy.Create<IUserManager, UserProxy>();
            ((UserProxy)(object)users).User = new User("current", "test", "reset") { Id = CurrentUserId };
            _services = new ServiceCollection()
                .AddSingleton(users)
                .AddSingleton<IAuthorizationService>(new AuthorizationStub())
                .BuildServiceProvider();
        }

        public PtvStatusController Controller(string? userId, bool elevated)
        {
            var claims = userId is null ? [] : new[]
            {
                new Claim("Jellyfin-UserId", userId),
                new Claim("test-elevated", elevated.ToString())
            };
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

    private sealed class LoopbackSeerrServer : IDisposable
    {
        private readonly TcpListener _listener = new(IPAddress.Loopback, 0);

        public LoopbackSeerrServer()
        {
            _listener.Start();
            Url = $"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}";
        }

        public string Url { get; }

        public async Task<(string RequestLine, string Body)> ReadOneRequestAsync()
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            using var client = await _listener.AcceptTcpClientAsync(timeout.Token);
            using var stream = client.GetStream();
            using var reader = new StreamReader(stream, Encoding.UTF8, leaveOpen: true);
            var requestLine = await reader.ReadLineAsync(timeout.Token) ?? string.Empty;
            var contentLength = 0;
            string? header;
            while (!string.IsNullOrEmpty(header = await reader.ReadLineAsync(timeout.Token)))
            {
                if (header.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                    contentLength = int.Parse(header["Content-Length:".Length..].Trim(), System.Globalization.CultureInfo.InvariantCulture);
            }

            var buffer = new char[contentLength];
            var received = 0;
            while (received < buffer.Length)
            {
                var count = await reader.ReadAsync(buffer.AsMemory(received), timeout.Token);
                if (count == 0) throw new EndOfStreamException();
                received += count;
            }
            var response = Encoding.ASCII.GetBytes("HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}");
            await stream.WriteAsync(response, timeout.Token);
            await stream.FlushAsync(timeout.Token);
            return (requestLine, new string(buffer));
        }

        public void Dispose() => _listener.Stop();
    }

    private sealed class AuthorizationStub : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user, object? resource, IEnumerable<IAuthorizationRequirement> requirements) =>
            Task.FromResult(Authorized(user));

        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user, object? resource, string policyName) =>
            Task.FromResult(Authorized(user));

        private static AuthorizationResult Authorized(ClaimsPrincipal user) =>
            user.FindFirst("test-elevated")?.Value == bool.TrueString
                ? AuthorizationResult.Success()
                : AuthorizationResult.Failed();
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
