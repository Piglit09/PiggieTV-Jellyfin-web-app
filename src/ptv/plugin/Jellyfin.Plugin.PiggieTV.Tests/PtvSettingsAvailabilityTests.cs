using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using System.Security.Claims;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvSettingsAvailabilityTests
{
    [Fact]
    public async Task MissingSettingsServiceReturnsUnavailableInsteadOfWritableDefaults()
    {
        var controller = CreateController();

        var settingsResult = Assert.IsType<ObjectResult>((await controller.GetSettings()).Result);
        var rowsResult = Assert.IsType<ObjectResult>((await controller.GetRows()).Result);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, settingsResult.StatusCode);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, rowsResult.StatusCode);
        Assert.Equal(
            "PTV_SETTINGS_UNAVAILABLE",
            Assert.IsType<PtvErrorResponse>(settingsResult.Value).Code);
        Assert.Equal(
            "PTV_ROWS_UNAVAILABLE",
            Assert.IsType<PtvErrorResponse>(rowsResult.Value).Code);
    }

    private static PtvStatusController CreateController()
    {
        var services = new ServiceCollection()
            .AddSingleton<IAuthorizationService>(new AllowAuthorizationService())
            .BuildServiceProvider();

        return new PtvStatusController(NullLogger<PtvStatusController>.Instance, services)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity())
                }
            }
        };
    }

    private sealed class AllowAuthorizationService : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            IEnumerable<IAuthorizationRequirement> requirements) =>
            Task.FromResult(AuthorizationResult.Success());

        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            string policyName) => Task.FromResult(AuthorizationResult.Success());
    }
}
