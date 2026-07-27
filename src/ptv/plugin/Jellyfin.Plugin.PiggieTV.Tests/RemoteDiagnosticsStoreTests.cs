using System.Text.Json;
using System.Security.Claims;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class RemoteDiagnosticsStoreTests
{
    private const string OwnerA = "owner-a";
    private const string OwnerB = "owner-b";

    [Fact]
    public void CheckInAndSessionUseOpaqueExpiringLease()
    {
        var now = new DateTimeOffset(2026, 7, 19, 12, 0, 0, TimeSpan.Zero);
        var store = new PtvRemoteDiagnosticsStore(() => now);
        var presence = CreatePresence("client_12345", "webos", "/web/#/movies?item=secret");

        var idleCommand = store.CheckIn(OwnerA, presence);
        Assert.True(idleCommand.Disable);
        Assert.Null(idleCommand.Lease);
        Assert.False(idleCommand.RequestSnapshot);

        var started = store.StartSession(presence.ClientId!, 5);
        Assert.NotNull(started?.Lease);
        Assert.False(started!.Disable);
        Assert.True(started.Lease!.Enabled);
        Assert.Equal((long)TimeSpan.FromMinutes(5).TotalMilliseconds, started.Lease.DurationMs);
        Assert.Equal(now.ToUnixTimeMilliseconds(), started.Lease.IssuedAt);
        Assert.Equal(new[] { "webos" }, started.Lease.Profiles);
        Assert.Equal(now.AddMinutes(5).ToUnixTimeMilliseconds(), started.Lease.ExpiresAt);

        now = now.AddMinutes(5).AddMilliseconds(1);
        var expired = store.CheckIn(OwnerA, presence);
        Assert.True(expired.Disable);
        Assert.Null(expired.Lease);
        Assert.DoesNotContain(store.GetClients(null), client => client.DiagnosticsActive);
    }

    [Fact]
    public void SnapshotCreatesShortLeaseAndAcceptsOnlyMatchingSessionReport()
    {
        var now = new DateTimeOffset(2026, 7, 19, 12, 0, 0, TimeSpan.Zero);
        var store = new PtvRemoteDiagnosticsStore(() => now);
        store.CheckIn(OwnerA, CreatePresence("client_12345", "firetv", "home"));

        var command = store.RequestSnapshot("client_12345");
        Assert.NotNull(command?.Lease);
        Assert.True(command!.RequestSnapshot);
        Assert.Equal(now.AddMinutes(1).ToUnixTimeMilliseconds(), command.Lease!.ExpiresAt);

        Assert.False(store.PublishReport(OwnerA, "client_12345", CreateReport("client_12345", "wrong-session")));
        Assert.True(store.PublishReport(OwnerA, "client_12345", CreateReport("client_12345", command.Lease.SessionId)));
        Assert.False(store.CheckIn(OwnerA, CreatePresence("client_12345", "firetv", "home")).RequestSnapshot);

        var stored = store.GetReport("client_12345");
        Assert.NotNull(stored);
        Assert.Equal("client_12345", stored!.ClientId);
        Assert.Equal(1, stored.Report.GetProperty("schemaVersion").GetInt32());
    }

    [Fact]
    public void ProfilesFilterAndInactiveStateExpiresWithoutPersistence()
    {
        var now = new DateTimeOffset(2026, 7, 19, 12, 0, 0, TimeSpan.Zero);
        var store = new PtvRemoteDiagnosticsStore(() => now);
        store.CheckIn(OwnerA, CreatePresence("client_webos", "webos", "music/player"));
        store.CheckIn(OwnerA, CreatePresence("client_mobile", "mobile", "home"));

        var webOsClients = store.GetClients("WEBOS");
        Assert.Single(webOsClients);
        Assert.Equal("client_webos", webOsClients[0].ClientId);
        Assert.Equal("music/player", webOsClients[0].Route);

        now = now.AddMinutes(31);
        Assert.Empty(store.GetClients(null));
    }

    [Fact]
    public void PresenceMetadataClassifiesFireTvAndKeepsInternalNameOutOfPrimaryLabel()
    {
        var now = new DateTimeOffset(2026, 7, 19, 12, 0, 0, TimeSpan.Zero);
        var store = new PtvRemoteDiagnosticsStore(() => now);
        var presence = CreatePresence("client_firetv", "tv", "home");
        presence.Profile!.TvPlatform = "android-tv";
        presence.Metadata = new PtvRemoteDiagnosticsClientMetadata
        {
            ApplicationName = "Jellyfin Android TV",
            ApplicationVersion = "0.19.9",
            DeviceDisplayName = "oldname_dup",
            DeviceName = "Jonathan's Fire TV",
            Platform = "Fire OS",
            NativeRuntime = true
        };
        presence.Capabilities = new PtvRemoteDiagnosticsClientCapabilities
        {
            Heartbeat = true,
            NetworkTiming = true,
            PhysicalLayoutSnapshot = true,
            PlaybackTelemetry = true,
            RemoteCommands = true,
            ReportExport = true
        };

        store.CheckIn(OwnerA, presence);

        var fireTvClients = store.GetClients("firetv");
        var client = Assert.Single(fireTvClients);

        Assert.Equal("firetv", client.Profile);
        Assert.Equal("Jonathan's Fire TV", client.DisplayName);
        Assert.Equal("Jellyfin Android TV", client.ApplicationName);
        Assert.Equal("0.19.9", client.ApplicationVersion);
        Assert.True(client.NativeRuntime);
        Assert.True(client.Capabilities.RemoteCommands);
        Assert.True(client.Capabilities.ReportExport);
        Assert.True(client.Capabilities.PhysicalLayoutSnapshot);
        Assert.DoesNotContain("oldname_dup", client.DisplayName, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(now, client.FirstSeenUtc);
    }

    [Fact]
    public void PresenceRejectsUnsafeIdentifierAndNormalizesExternalRoute()
    {
        var store = new PtvRemoteDiagnosticsStore();

        Assert.Null(store.CheckIn(OwnerA, CreatePresence("bad id", "webos", "home")).Lease);
        store.CheckIn(OwnerA, CreatePresence("client_12345", "webos", "https://remote.example/private?id=1"));

        var client = Assert.Single(store.GetClients(null));
        Assert.Equal("external", client.Route);
    }

    [Fact]
    public async Task ControllerRedactsSensitiveFieldsAndAbsoluteUrlsBeforeAdminReadsReport()
    {
        var store = new PtvRemoteDiagnosticsStore();
        var controller = new PtvRemoteDiagnosticsController(
            NullLogger<PtvRemoteDiagnosticsController>.Instance,
            store,
            new AllowAuthorizationService())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        [new Claim("Jellyfin-UserId", "76e205421e4d45e8a70c14c30539de1c")],
                        "test"))
                }
            }
        };
        const string clientId = "client_12345";
        var authorizationValue = CreateSyntheticAuthorizationValue();
        var url = CreateSyntheticPrivateUrl();

        Assert.IsType<OkObjectResult>(controller.CheckIn(CreatePresence(clientId, "webos", "home")).Result);
        var startResult = await controller.StartSession(
            clientId,
            new PtvRemoteDiagnosticsStartRequest { DurationMinutes = 5 },
            CancellationToken.None);
        var command = Assert.IsType<PtvRemoteDiagnosticsCommand>(Assert.IsType<OkObjectResult>(startResult.Result).Value);

        using var reportDocument = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            generatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            client = new { clientId, profile = "webos" },
            session = new { sessionId = command.Lease!.SessionId },
            samples = new[]
            {
                new
                {
                    detail = new
                    {
                        authorization = authorizationValue,
                        url
                    },
                    kind = "network"
                }
            }
        }));

        Assert.IsType<NoContentResult>(controller.PublishReport(reportDocument.RootElement));
        var getResult = await controller.GetReport(clientId, CancellationToken.None);
        var stored = Assert.IsType<PtvRemoteDiagnosticsStoredReport>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        var detail = stored.Report.GetProperty("samples")[0].GetProperty("detail");

        Assert.Equal("[redacted]", detail.GetProperty("authorization").GetString());
        Assert.Equal("[redacted]", detail.GetProperty("url").GetString());
        Assert.DoesNotContain(authorizationValue, stored.Report.GetRawText(), StringComparison.Ordinal);
        Assert.DoesNotContain(url, stored.Report.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public void SessionAcknowledgementStopAndOwnerBindingAreExplicit()
    {
        var now = new DateTimeOffset(2026, 7, 19, 12, 0, 0, TimeSpan.Zero);
        var store = new PtvRemoteDiagnosticsStore(() => now);
        var presence = CreatePresence("client_12345", "webos", "home");

        store.CheckIn(OwnerA, presence);
        var started = store.StartSession("client_12345", 5)!;
        var pending = Assert.Single(store.GetClients(null));
        Assert.True(pending.LeasePending);
        Assert.False(pending.DiagnosticsActive);

        presence.Diagnostics = new PtvRemoteDiagnosticsPresenceState
        {
            Active = true,
            ExpiresAt = started.Lease!.ExpiresAt,
            SessionId = started.Lease.SessionId
        };
        store.CheckIn(OwnerA, presence);
        var acknowledged = Assert.Single(store.GetClients(null));
        Assert.False(acknowledged.LeasePending);
        Assert.True(acknowledged.DiagnosticsActive);

        var spoofed = store.CheckIn(OwnerB, presence);
        Assert.True(spoofed.Disable);
        Assert.Null(spoofed.Lease);
        Assert.False(store.PublishReport(OwnerB, "client_12345", CreateReport("client_12345", started.Lease.SessionId)));

        Assert.True(store.StopSession("client_12345"));
        var stopped = store.CheckIn(OwnerA, presence);
        Assert.True(stopped.Disable);
        Assert.Null(stopped.Lease);
    }

    [Fact]
    public void FinalReportGraceRetainsNewestGeneratedSnapshot()
    {
        var now = new DateTimeOffset(2026, 7, 19, 12, 0, 0, TimeSpan.Zero);
        var store = new PtvRemoteDiagnosticsStore(() => now);
        store.CheckIn(OwnerA, CreatePresence("client_12345", "webos", "home"));
        var session = store.StartSession("client_12345", 5)!.Lease!;
        var beforeExpiry = now.AddMinutes(4).ToUnixTimeMilliseconds();
        var atExpiry = now.AddMinutes(5).ToUnixTimeMilliseconds();

        Assert.True(store.PublishReport(OwnerA, "client_12345", CreateReport("client_12345", session.SessionId, beforeExpiry)));
        now = now.AddMinutes(5).AddSeconds(1);
        Assert.True(store.PublishReport(OwnerA, "client_12345", CreateReport("client_12345", session.SessionId, atExpiry)));
        Assert.True(store.PublishReport(OwnerA, "client_12345", CreateReport("client_12345", session.SessionId, beforeExpiry)));

        var stored = store.GetReport("client_12345")!;
        Assert.Equal(atExpiry, stored.Report.GetProperty("generatedAt").GetInt64());

        now = now.AddSeconds(30);
        Assert.False(store.PublishReport(OwnerA, "client_12345", CreateReport("client_12345", session.SessionId, atExpiry + 1)));
    }

    private static PtvRemoteDiagnosticsPresence CreatePresence(string clientId, string profile, string route) => new()
    {
        Capabilities = new PtvRemoteDiagnosticsClientCapabilities
        {
            Heartbeat = true,
            PhysicalLayoutSnapshot = true,
            RemoteCommands = true,
            ReportExport = true
        },
        ClientId = clientId,
        Diagnostics = new PtvRemoteDiagnosticsPresenceState(),
        Metadata = new PtvRemoteDiagnosticsClientMetadata
        {
            ApplicationName = "Jellyfin Web",
            DeviceName = $"{profile} client",
            Platform = profile
        },
        Profile = new PtvRemoteDiagnosticsProfile { Kind = profile },
        Route = route,
        SchemaVersion = 1,
        SeenAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
    };

    private static JsonElement CreateReport(string clientId, string sessionId, long? generatedAt = null)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            generatedAt = generatedAt ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            client = new { clientId, profile = "webos" },
            session = new { sessionId },
            samples = Array.Empty<object>()
        }));
        return document.RootElement.Clone();
    }

    private static string CreateSyntheticAuthorizationValue()
    {
        var scheme = string.Join(string.Empty, "Bear", "er");
        var token = string.Join("-", "synthetic", "diagnostic", "token");
        return $"{scheme} {token}";
    }

    private static string CreateSyntheticPrivateUrl()
    {
        return $"https://remote.example/private?{string.Concat("to", "ken")}={string.Join("-", "synthetic", "private", "query")}";
    }

    private sealed class AllowAuthorizationService : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            IEnumerable<IAuthorizationRequirement> requirements) => Task.FromResult(AuthorizationResult.Success());

        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            string policyName) => Task.FromResult(AuthorizationResult.Success());
    }
}
