using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvArrCalendarContractTests
{
    private static readonly DateTime Start = new(2026, 8, 23, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime End = new(2026, 10, 14, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void CalendarRoutesRemainAuthenticatedGetEndpoints()
    {
        var controllerAuthorization = typeof(PtvStatusController)
            .GetCustomAttributes(typeof(AuthorizeAttribute), inherit: true);
        var method = typeof(PtvStatusController).GetMethod(nameof(PtvStatusController.GetArrCalendar));
        var routes = method!
            .GetCustomAttributes(typeof(HttpGetAttribute), inherit: true)
            .Cast<HttpGetAttribute>()
            .Select(attribute => attribute.Template)
            .ToArray();

        Assert.NotEmpty(controllerAuthorization);
        Assert.Contains("calendar", routes);
        Assert.Contains("integrations/arr/calendar", routes);
    }

    [Fact]
    public void RadarrSelectsTheReleaseDateInsideTheRequestedWindow()
    {
        var item = JsonNode.Parse(
            """
            {
              "inCinemas": "1986-12-11T00:00:00Z",
              "digitalRelease": "2026-09-04T00:00:00Z",
              "physicalRelease": "2026-10-30T00:00:00Z"
            }
            """)!.AsObject();

        var selected = PtvStatusController.SelectArrCalendarDate("radarr", item, Start, End);

        Assert.Equal("2026-09-04", selected);
    }

    [Fact]
    public void LidarrUsesItsAuthoritativeReleaseDateAndKeepsItTimezoneInvariant()
    {
        var item = JsonNode.Parse(
            """
            {
              "releaseDate": "2026-09-18T00:00:00Z"
            }
            """)!.AsObject();

        var selected = PtvStatusController.SelectArrCalendarDate("lidarr", item, Start, End);

        Assert.Equal("2026-09-18", selected);
    }

    [Fact]
    public void LidarrRejectsAReleaseDateOutsideTheRequestedWindow()
    {
        var item = JsonNode.Parse(
            """
            {
              "releaseDate": "2024-06-27T00:00:00Z"
            }
            """)!.AsObject();

        Assert.Null(PtvStatusController.SelectArrCalendarDate("lidarr", item, Start, End));
    }

    [Fact]
    public void SonarrPreservesTheUtcTimestampInsideTheRequestedWindow()
    {
        var item = JsonNode.Parse(
            """
            {
              "airDateUtc": "2026-08-30T00:30:00Z",
              "airDate": "2026-08-30"
            }
            """)!.AsObject();

        var selected = PtvStatusController.SelectArrCalendarDate("sonarr", item, Start, End);

        Assert.Equal("2026-08-30T00:30:00Z", selected);
    }

    [Theory]
    [InlineData("1986-12-11T00:00:00Z", "1996-06-09T00:00:00Z")]
    [InlineData("not-a-date", null)]
    public void CalendarRejectsItemsWithoutAParseableDateInsideTheRequestedWindow(
        string firstDate,
        string? secondDate)
    {
        var item = new JsonObject
        {
            ["inCinemas"] = firstDate,
            ["digitalRelease"] = secondDate
        };

        var selected = PtvStatusController.SelectArrCalendarDate("radarr", item, Start, End);

        Assert.Null(selected);
    }

    [Fact]
    public void CalendarUsesExplicitUtcFullDayBoundariesForServarrRequests()
    {
        var path = PtvStatusController.GetArrCalendarPath("sonarr", Start, End);

        Assert.StartsWith("/api/v3/calendar?", path, StringComparison.Ordinal);
        Assert.Contains("start=2026-08-23T00%3A00%3A00.0000000Z", path, StringComparison.Ordinal);
        Assert.Contains("end=2026-10-14T23%3A59%3A59.9999999Z", path, StringComparison.Ordinal);
        Assert.Contains("includeSeries=true&includeEpisodeFile=true", path, StringComparison.Ordinal);
    }

    [Fact]
    public void LidarrCalendarRequestsAuthoritativeArtistContext()
    {
        var path = PtvStatusController.GetArrCalendarPath("lidarr", Start, End);

        Assert.StartsWith("/api/v1/calendar?", path, StringComparison.Ordinal);
        Assert.Contains("includeArtist=true", path, StringComparison.Ordinal);
    }

    [Fact]
    public void CalendarCapsCallerSuppliedRanges()
    {
        var (start, end) = PtvStatusController.NormalizeArrCalendarRange(
            new DateTimeOffset(2020, 1, 1, 0, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2030, 1, 1, 0, 0, 0, TimeSpan.Zero),
            daysBefore: 7,
            daysAfter: 45,
            new DateTime(2026, 8, 29, 0, 0, 0, DateTimeKind.Utc));

        Assert.Equal(new DateTime(2020, 1, 1), start);
        Assert.Equal(start.AddDays(360), end);
    }

    [Theory]
    [InlineData("timeout")]
    [InlineData("network")]
    [InlineData("malformed")]
    [InlineData("unknown")]
    public void CalendarFailureCategoriesNeverExposePrivateExceptionDetails(string category)
    {
        const string PrivateUrl = "http://private-host:8989/api/v3/calendar";
        Exception exception = category switch
        {
            "timeout" => new TaskCanceledException(PrivateUrl),
            "network" => new HttpRequestException(PrivateUrl),
            "malformed" => new System.Text.Json.JsonException(PrivateUrl),
            _ => new InvalidOperationException(PrivateUrl)
        };

        var result = PtvStatusController.ClassifyArrCalendarFailure(exception);

        Assert.DoesNotContain("private-host", result, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("8989", result, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ClientCalendarAvailabilityNeverSerializesCredentialsOrIntegrationUrls()
    {
        const string Credential = "PTV_PRIVATE_SERVARR_CREDENTIAL";
        const string PrivateUrl = "http://private-host:8989";
        var settings = new ArrSettings
        {
            Sonarr = new ArrServiceSettings
            {
                ApiKey = Credential,
                Enabled = true,
                ExternalUrl = "https://private-external.example",
                InternalUrl = PrivateUrl
            }
        };

        var json = JsonSerializer.Serialize(PtvStatusController.CreateArrCalendarAvailability(settings));

        Assert.Contains("\"configuredServices\":[\"sonarr\"]", json, StringComparison.Ordinal);
        Assert.DoesNotContain(Credential, json, StringComparison.Ordinal);
        Assert.DoesNotContain(PrivateUrl, json, StringComparison.Ordinal);
        Assert.DoesNotContain("private-external", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("apiKey", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("internalUrl", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("externalUrl", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void DisabledConfiguredProviderIsNeitherAdvertisedNorFetched()
    {
        const string Credential = "PTV_PRIVATE_DISABLED_SERVARR_CREDENTIAL";
        const string PrivateUrl = "http://private-disabled-host:8989";
        var service = new ArrServiceSettings
        {
            ApiKey = Credential,
            Enabled = false,
            InternalUrl = PrivateUrl
        };
        var settings = new ArrSettings
        {
            Sonarr = service
        };

        var json = JsonSerializer.Serialize(PtvStatusController.CreateArrCalendarAvailability(settings));
        using var document = JsonDocument.Parse(json);
        var configuredServices = document.RootElement.GetProperty("configuredServices");
        var sonarr = document.RootElement
            .GetProperty("services")
            .EnumerateArray()
            .Single(candidate => candidate.GetProperty("service").GetString() == "sonarr");

        Assert.Empty(configuredServices.EnumerateArray());
        Assert.True(sonarr.GetProperty("configured").GetBoolean());
        Assert.False(sonarr.GetProperty("enabled").GetBoolean());
        Assert.False(PtvStatusController.ShouldFetchArrCalendarService("sonarr", service));
        Assert.DoesNotContain(Credential, json, StringComparison.Ordinal);
        Assert.DoesNotContain(PrivateUrl, json, StringComparison.Ordinal);
    }

    [Fact]
    public void EnabledConfiguredProviderRemainsEligibleForCalendarFetch()
    {
        var service = new ArrServiceSettings
        {
            ApiKey = "disposable-key",
            Enabled = true,
            InternalUrl = "http://servarr.internal"
        };

        Assert.True(PtvStatusController.ShouldFetchArrCalendarService("sonarr", service));
    }

    [Fact]
    public void EmptyCalendarArrayIsAValidHealthyProviderPayload()
    {
        var payload = JsonNode.Parse("[]")!;

        var accepted = PtvStatusController.TryGetArrCalendarSourceItems(
            payload,
            out var items,
            out var error);

        Assert.True(accepted);
        Assert.Empty(items);
        Assert.Null(error);
    }

    [Theory]
    [InlineData("{\"unexpected\":\"http://private-host:8989/calendar\"}")]
    [InlineData("[{},1]")]
    [InlineData("42")]
    public void StructurallyMalformedCalendarPayloadIsRejectedWithSafeProviderError(string json)
    {
        var payload = JsonNode.Parse(json)!;

        var accepted = PtvStatusController.TryGetArrCalendarSourceItems(
            payload,
            out var items,
            out var error);

        Assert.False(accepted);
        Assert.Empty(items);
        Assert.Equal("Calendar provider returned malformed data.", error);
        Assert.DoesNotContain("private-host", error, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("8989", error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DetailedIntegrationStatusRequiresAdministratorAuthorization()
    {
        var services = new ServiceCollection()
            .AddSingleton<IAuthorizationService>(new DenyAuthorizationService())
            .BuildServiceProvider();
        var controller = new PtvStatusController(NullLogger<PtvStatusController>.Instance, services)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity())
                }
            }
        };

        var result = await controller.GetIntegrationsStatus();
        var forbidden = Assert.IsType<ObjectResult>(result);

        Assert.Equal(StatusCodes.Status403Forbidden, forbidden.StatusCode);
    }

    private sealed class DenyAuthorizationService : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            IEnumerable<IAuthorizationRequirement> requirements) =>
            Task.FromResult(AuthorizationResult.Failed());

        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            string policyName) => Task.FromResult(AuthorizationResult.Failed());
    }
}
