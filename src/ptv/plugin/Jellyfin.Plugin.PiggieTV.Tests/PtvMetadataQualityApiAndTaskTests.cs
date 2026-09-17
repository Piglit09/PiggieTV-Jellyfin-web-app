using System.Security.Claims;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using MediaBrowser.Model.Tasks;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvMetadataQualityApiAndTaskTests
{
    [Fact]
    public void ControllerIsAuthenticatedAndExposesOnlyTheBoundedV1Contract()
    {
        Assert.NotNull(Assert.Single(typeof(PtvMetadataQualityController).GetCustomAttributes(typeof(AuthorizeAttribute), true)));
        Assert.Equal("Ptv/v1/metadata-quality", Assert.Single(typeof(PtvMetadataQualityController)
            .GetCustomAttributes(typeof(RouteAttribute), true).Cast<RouteAttribute>()).Template);

        AssertRoute(nameof(PtvMetadataQualityController.GetStatus), typeof(HttpGetAttribute), "status");
        AssertRoute(nameof(PtvMetadataQualityController.GetSummary), typeof(HttpGetAttribute), "summary");
        AssertRoute(nameof(PtvMetadataQualityController.GetResults), typeof(HttpGetAttribute), "results");
        AssertRoute(nameof(PtvMetadataQualityController.GetResult), typeof(HttpGetAttribute), "results/{itemId:guid}");
        AssertRoute(nameof(PtvMetadataQualityController.StartScan), typeof(HttpPostAttribute), "scan");
        AssertRoute(nameof(PtvMetadataQualityController.CancelScan), typeof(HttpPostAttribute), "scan/cancel");
        AssertRoute(nameof(PtvMetadataQualityController.Resolve), typeof(HttpPostAttribute), "results/{itemId:guid}/resolve");
        AssertRoute(nameof(PtvMetadataQualityController.RebuildIndex), typeof(HttpPostAttribute), "index/rebuild");
        AssertRoute(nameof(PtvMetadataQualityController.GetSettings), typeof(HttpGetAttribute), "settings");
        AssertRoute(nameof(PtvMetadataQualityController.SaveSettings), typeof(HttpPostAttribute), "settings");
        AssertRoute(nameof(PtvMetadataQualityController.TestAiConnection), typeof(HttpPostAttribute), "ai/test");
        Assert.DoesNotContain(typeof(PtvMetadataQualityController).GetMethods(), method =>
            method.Name.Contains("fix", StringComparison.OrdinalIgnoreCase)
            || method.Name.Contains("apply", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(typeof(List<PtvMetadataQualityResultSummary>), typeof(PtvMetadataQualityResultsResponse).GetProperty(nameof(PtvMetadataQualityResultsResponse.Items))!.PropertyType);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task MemberOrUnauthenticatedAuthorizationFailureBlocksEveryEndpointBeforeServiceCall(bool authenticated)
    {
        var service = new RecordingService();
        var controller = CreateController(service, allow: false, authenticated);
        var itemId = Guid.NewGuid();

        var status = await controller.GetStatus(CancellationToken.None);
        var summary = await controller.GetSummary(CancellationToken.None);
        var results = await controller.GetResults(new PtvMetadataQualityResultQuery(), CancellationToken.None);
        var result = await controller.GetResult(itemId, CancellationToken.None);
        var scan = await controller.StartScan(new PtvMetadataQualityScanRequest(), CancellationToken.None);
        var cancel = await controller.CancelScan(CancellationToken.None);
        var resolve = await controller.Resolve(itemId, new PtvMetadataQualityResolveRequest { Action = "dismiss" }, CancellationToken.None);
        var rebuild = await controller.RebuildIndex(
            new PtvMetadataQualityIndexRebuildRequest { Confirm = true },
            CancellationToken.None);
        var settings = await controller.GetSettings(CancellationToken.None);
        var save = await controller.SaveSettings(new PtvMetadataQualitySettings(), CancellationToken.None);
        var aiTest = await controller.TestAiConnection(new PtvMetadataAiConnectionTestRequest(), CancellationToken.None);

        Assert.IsType<ForbidResult>(status.Result);
        Assert.IsType<ForbidResult>(summary.Result);
        Assert.IsType<ForbidResult>(results.Result);
        Assert.IsType<ForbidResult>(result.Result);
        Assert.IsType<ForbidResult>(scan.Result);
        Assert.IsType<ForbidResult>(cancel.Result);
        Assert.IsType<ForbidResult>(resolve.Result);
        Assert.IsType<ForbidResult>(rebuild.Result);
        Assert.IsType<ForbidResult>(settings.Result);
        Assert.IsType<ForbidResult>(save.Result);
        Assert.IsType<ForbidResult>(aiTest.Result);
        Assert.Equal(0, service.CallCount);
    }

    [Fact]
    public async Task AdministratorCanReachEveryReadAndExplicitWriteEndpoint()
    {
        var service = new RecordingService();
        var controller = CreateController(service, allow: true);
        var itemId = Guid.NewGuid();

        Assert.IsType<OkObjectResult>((await controller.GetStatus(CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.GetSummary(CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.GetResults(new PtvMetadataQualityResultQuery(), CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.GetResult(itemId, CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.StartScan(new PtvMetadataQualityScanRequest { Mode = "changed" }, CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.CancelScan(CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.Resolve(itemId, new PtvMetadataQualityResolveRequest { Action = "keep_current" }, CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.RebuildIndex(
            new PtvMetadataQualityIndexRebuildRequest { Confirm = true },
            CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.GetSettings(CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.SaveSettings(new PtvMetadataQualitySettings(), CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.TestAiConnection(new PtvMetadataAiConnectionTestRequest(), CancellationToken.None)).Result);
        Assert.Equal(11, service.CallCount);
        Assert.Equal(1, service.StartCalls);
    }

    [Fact]
    public async Task AdministratorMustExplicitlyConfirmTheControlledIndexRebuild()
    {
        var service = new RecordingService();
        var controller = CreateController(service, allow: true);

        var missing = await controller.RebuildIndex(null, CancellationToken.None);
        var declined = await controller.RebuildIndex(
            new PtvMetadataQualityIndexRebuildRequest { Confirm = false },
            CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(missing.Result);
        Assert.IsType<BadRequestObjectResult>(declined.Result);
        Assert.Equal(0, service.CallCount);

        var confirmed = await controller.RebuildIndex(
            new PtvMetadataQualityIndexRebuildRequest { Confirm = true },
            CancellationToken.None);

        Assert.IsType<OkObjectResult>(confirmed.Result);
        Assert.Equal(1, service.CallCount);
    }

    [Fact]
    public async Task ReadTimingSeparatesAuthorizationApplicationAndTotalDurations()
    {
        var controller = CreateController(new RecordingService(), allow: true);

        var action = await controller.GetSummary(CancellationToken.None);
        var response = Assert.IsType<OkObjectResult>(action.Result);
        var summary = Assert.IsType<PtvMetadataQualitySummaryResponse>(response.Value);
        var timing = controller.Response.Headers["Server-Timing"].ToString();

        Assert.Contains("authorization;dur=", timing, StringComparison.Ordinal);
        Assert.Contains("application;dur=12.50", timing, StringComparison.Ordinal);
        Assert.Contains("total;dur=", timing, StringComparison.Ordinal);
        Assert.True(summary.Diagnostics.Stages.ContainsKey("authorization"));
        Assert.True(summary.Diagnostics.TotalMs >= 12.5);
    }

    [Fact]
    public async Task ScheduledTaskRunsIncrementalServiceAndHasOneDailyTrigger()
    {
        var service = new RecordingService();
        var task = new PtvMetadataQualityTask(service);

        await task.ExecuteAsync(new Progress<double>(), CancellationToken.None);

        Assert.Equal("PTV Metadata Quality Scan", task.Name);
        Assert.Equal("PtvMetadataQualityScan", task.Key);
        Assert.Equal(1, service.ScheduledCalls);
        var trigger = Assert.Single(task.GetDefaultTriggers());
        Assert.Equal(TaskTriggerInfoType.DailyTrigger, trigger.Type);
    }

    private static void AssertRoute(string methodName, Type attributeType, string route)
    {
        var method = typeof(PtvMetadataQualityController).GetMethod(methodName)!;
        var attribute = Assert.Single(method.GetCustomAttributes(attributeType, true).Cast<HttpMethodAttribute>());
        Assert.Equal(route, attribute.Template);
    }

    private static PtvMetadataQualityController CreateController(
        IPtvMetadataQualityService service,
        bool allow,
        bool authenticated = true) => new(
        service,
        new StaticAuthorizationService(allow))
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

    private sealed class StaticAuthorizationService(bool allow) : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource, IEnumerable<IAuthorizationRequirement> requirements) =>
            Task.FromResult(allow ? AuthorizationResult.Success() : AuthorizationResult.Failed());

        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource, string policyName) =>
            Task.FromResult(allow ? AuthorizationResult.Success() : AuthorizationResult.Failed());
    }

    private sealed class RecordingService : IPtvMetadataQualityService
    {
        public int CallCount { get; private set; }

        public int StartCalls { get; private set; }

        public int ScheduledCalls { get; private set; }

        public Task<PtvMetadataQualitySummaryResponse> GetSummaryAsync(CancellationToken cancellationToken = default)
        {
            CallCount++;
            return Task.FromResult(new PtvMetadataQualitySummaryResponse
            {
                Diagnostics = new PtvMetadataQualityRequestDiagnostics { TotalMs = 12.5 }
            });
        }

        public Task<PtvMetadataQualityStatusResponse> GetStatusAsync(CancellationToken cancellationToken = default)
        {
            CallCount++;
            return Task.FromResult(new PtvMetadataQualityStatusResponse());
        }

        public Task<PtvMetadataQualityResultsResponse> GetResultsAsync(PtvMetadataQualityResultQuery query, CancellationToken cancellationToken = default)
        {
            CallCount++;
            return Task.FromResult(new PtvMetadataQualityResultsResponse
            {
                Diagnostics = new PtvMetadataQualityRequestDiagnostics { TotalMs = 12.5 }
            });
        }

        public Task<PtvMetadataQualityResult?> GetResultAsync(Guid itemId, CancellationToken cancellationToken = default)
        {
            CallCount++;
            return Task.FromResult<PtvMetadataQualityResult?>(new PtvMetadataQualityResult { ItemId = itemId });
        }

        public Task<PtvMetadataQualitySummaryResponse> StartScanAsync(PtvMetadataQualityScanRequest request, CancellationToken cancellationToken = default)
        {
            CallCount++;
            StartCalls++;
            return Task.FromResult(new PtvMetadataQualitySummaryResponse());
        }

        public Task<PtvMetadataQualitySummaryResponse> CancelScanAsync(CancellationToken cancellationToken = default)
        {
            CallCount++;
            return Task.FromResult(new PtvMetadataQualitySummaryResponse());
        }

        public Task<PtvMetadataQualityResult?> ResolveAsync(Guid itemId, string action, CancellationToken cancellationToken = default)
        {
            CallCount++;
            return Task.FromResult<PtvMetadataQualityResult?>(new PtvMetadataQualityResult { ItemId = itemId });
        }

        public Task<PtvMetadataQualitySummaryResponse> RebuildIndexAsync(CancellationToken cancellationToken = default)
        {
            CallCount++;
            return Task.FromResult(new PtvMetadataQualitySummaryResponse());
        }

        public Task<PtvMetadataQualitySettings> GetSettingsAsync(CancellationToken cancellationToken = default)
        {
            CallCount++;
            return Task.FromResult(new PtvMetadataQualitySettings());
        }

        public Task<PtvMetadataQualitySettings> SaveSettingsAsync(PtvMetadataQualitySettings settings, CancellationToken cancellationToken = default)
        {
            CallCount++;
            return Task.FromResult(settings);
        }

        public Task<PtvMetadataAiConnectionTestResponse> TestAiConnectionAsync(
            PtvMetadataAiConnectionTestRequest request,
            CancellationToken cancellationToken = default)
        {
            CallCount++;
            return Task.FromResult(new PtvMetadataAiConnectionTestResponse
            {
                Success = true,
                Status = PtvMetadataAiErrorCodes.Success
            });
        }

        public Task RunScheduledScanAsync(IProgress<double> progress, CancellationToken cancellationToken)
        {
            ScheduledCalls++;
            return Task.CompletedTask;
        }
    }
}
