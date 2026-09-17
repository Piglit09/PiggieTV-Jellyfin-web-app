using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvMediaReportsContractTests : IDisposable
{
    private static readonly Guid ItemId = Guid.Parse("01234567-89ab-cdef-0123-456789abcdef");
    private static readonly Guid UserId = Guid.Parse("11111111-2222-3333-4444-555555555555");
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "ptv-media-report-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task AuthenticatedVisibleItemIsDurablyAcceptedWithoutTitlesIdentityOrSensitiveDetail()
    {
        var filePath = Path.Combine(_directory, "media-reports.json");
        var store = CreateStore(filePath);
        var controller = CreateController(store, new AllowAuthorizationService(), canAccessItem: true);
        var sensitiveDetail = string.Concat("See https", "://private.example/path?", "credential=value");
        var wireJson = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            itemId = ItemId.ToString("N"),
            title = "Private movie title",
            subtitle = "Private episode title",
            source = "playback",
            reason = "subtitle-sync",
            itemType = string.Concat("https", "://private.example/type"),
            playbackPositionMs = 120_000,
            mediaSourceId = string.Concat("sk", "-proj-", new string('A', 48)),
            playMethod = "credential=value",
            details = sensitiveDetail
        });
        var request = JsonSerializer.Deserialize<PtvMediaReportRequest>(wireJson);

        var action = await controller.Submit(request, CancellationToken.None);

        var accepted = Assert.IsType<AcceptedResult>(action.Result);
        var response = Assert.IsType<PtvMediaReportAcceptedResponse>(accepted.Value);
        Assert.Equal("accepted", response.Status);
        Assert.True(Guid.TryParseExact(response.ReportId, "N", out _));

        var stored = Assert.Single(await store.GetReportsAsync(10));
        Assert.Equal(ItemId.ToString("N"), stored.ItemId);
        Assert.Equal("[redacted]", stored.Details);
        Assert.Equal("[redacted]", stored.ItemType);
        Assert.Null(stored.MediaSourceId);
        Assert.Equal("[redacted]", stored.PlayMethod);
        Assert.Equal("subtitle-sync", stored.Reason);

        var disk = await File.ReadAllTextAsync(filePath);
        Assert.DoesNotContain("Private movie title", disk, StringComparison.Ordinal);
        Assert.DoesNotContain("Private episode title", disk, StringComparison.Ordinal);
        Assert.DoesNotContain(UserId.ToString("N"), disk, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(sensitiveDetail, disk, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AuthenticationVisibilityAndValidationFailuresAreBounded()
    {
        var store = CreateStore(Path.Combine(_directory, "media-reports.json"));
        var anonymous = CreateController(store, new AllowAuthorizationService(), authenticated: false);
        var unauthorized = await anonymous.Submit(ValidRequest(), CancellationToken.None);
        Assert.IsType<UnauthorizedObjectResult>(unauthorized.Result);

        var hidden = CreateController(store, new AllowAuthorizationService(), canAccessItem: false);
        var notFound = await hidden.Submit(ValidRequest(), CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(notFound.Result);

        var controller = CreateController(store, new AllowAuthorizationService());
        var malformed = ValidRequest();
        malformed.Reason = "unsupported";
        Assert.IsType<BadRequestObjectResult>((await controller.Submit(malformed, CancellationToken.None)).Result);

        var oversized = ValidRequest();
        oversized.Details = new string('x', PtvMediaReportValidator.MaximumDetailsLength + 1);
        Assert.IsType<BadRequestObjectResult>((await controller.Submit(oversized, CancellationToken.None)).Result);
        Assert.Empty(await store.GetReportsAsync(10));
    }

    [Fact]
    public async Task SubmissionRateLimitReturnsRetryAfterAndDoesNotAddAnotherRecord()
    {
        var store = CreateStore(
            Path.Combine(_directory, "media-reports.json"),
            submissionsPerWindow: 1);
        var controller = CreateController(store, new AllowAuthorizationService());

        Assert.IsType<AcceptedResult>((await controller.Submit(ValidRequest(), CancellationToken.None)).Result);
        var limited = await controller.Submit(ValidRequest(), CancellationToken.None);

        var result = Assert.IsType<ObjectResult>(limited.Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, result.StatusCode);
        Assert.Equal("600", controller.Response.Headers.RetryAfter.ToString());
        Assert.Single(await store.GetReportsAsync(10));
    }

    [Fact]
    public async Task PersistenceFailureNeverReturnsSuccess()
    {
        Directory.CreateDirectory(_directory);
        var blockingPath = Path.Combine(_directory, "not-a-directory");
        await File.WriteAllTextAsync(blockingPath, "blocked");
        var store = CreateStore(Path.Combine(blockingPath, "media-reports.json"));
        var controller = CreateController(store, new AllowAuthorizationService());

        var action = await controller.Submit(ValidRequest(), CancellationToken.None);

        var result = Assert.IsType<ObjectResult>(action.Result);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, result.StatusCode);
    }

    [Fact]
    public async Task MalformedExistingStoreIsLeftUntouchedAndFailsClosed()
    {
        Directory.CreateDirectory(_directory);
        var filePath = Path.Combine(_directory, "media-reports.json");
        const string malformed = "{\"schemaVersion\":1,\"reports\":[null]}";
        await File.WriteAllTextAsync(filePath, malformed);
        var store = CreateStore(filePath);
        var controller = CreateController(store, new AllowAuthorizationService());

        var action = await controller.Submit(ValidRequest(), CancellationToken.None);

        var result = Assert.IsType<ObjectResult>(action.Result);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, result.StatusCode);
        Assert.Equal(malformed, await File.ReadAllTextAsync(filePath));
    }

    [Theory]
    [InlineData("/home/alice/private.mkv")]
    [InlineData("private-release-name.mkv")]
    public void FilesystemDetailsAreRedactedBeforePersistence(string details)
    {
        var request = ValidRequest();
        request.Details = details;

        Assert.True(PtvMediaReportValidator.TryNormalize(request, out _, out var normalized, out _, out _));
        Assert.Equal("[redacted]", normalized.Details);
    }

    [Fact]
    public void DetailsBoundaryIsPreservedExactlyAndLargerInputIsRejected()
    {
        var request = ValidRequest();
        request.Details = new string('x', PtvMediaReportValidator.MaximumDetailsLength);

        Assert.True(PtvMediaReportValidator.TryNormalize(request, out _, out var normalized, out _, out _));
        Assert.Equal(request.Details, normalized.Details);

        request.Details += "x";
        Assert.False(PtvMediaReportValidator.TryNormalize(request, out _, out _, out var errorCode, out _));
        Assert.Equal("PTV_MEDIA_REPORT_DETAILS_TOO_LONG", errorCode);
    }

    [Fact]
    public async Task OversizedExistingStoreIsNotReadOrOverwritten()
    {
        Directory.CreateDirectory(_directory);
        var filePath = Path.Combine(_directory, "media-reports.json");
        await File.WriteAllBytesAsync(filePath, new byte[PtvMediaReportStore.MaximumStorageBytes + 1]);
        var store = CreateStore(filePath);
        var controller = CreateController(store, new AllowAuthorizationService());

        var action = await controller.Submit(ValidRequest(), CancellationToken.None);

        var result = Assert.IsType<ObjectResult>(action.Result);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, result.StatusCode);
        Assert.Equal(PtvMediaReportStore.MaximumStorageBytes + 1, new FileInfo(filePath).Length);
    }

    [Fact]
    public void IncompleteTemporarySnapshotIsRemovedOnRestart()
    {
        Directory.CreateDirectory(_directory);
        var filePath = Path.Combine(_directory, "media-reports.json");
        var temporaryPath = filePath + ".tmp";
        File.WriteAllText(temporaryPath, "incomplete-private-report");

        _ = CreateStore(filePath);

        Assert.False(File.Exists(temporaryPath));
    }

    [Fact]
    public async Task LoadedOverCapSnapshotIsRewrittenOnFirstRead()
    {
        Directory.CreateDirectory(_directory);
        var filePath = Path.Combine(_directory, "media-reports.json");
        var now = new DateTimeOffset(2026, 8, 26, 12, 0, 0, TimeSpan.Zero);
        var reports = Enumerable.Range(1, 3).Select(index =>
        {
            var record = ValidRecord(Guid.Parse($"00000000-0000-0000-0000-{index:D12}"));
            record.ReceivedAtUtc = now.AddMinutes(index);
            record.ReportId = Guid.Parse($"10000000-0000-0000-0000-{index:D12}").ToString("N");
            return record;
        }).ToArray();
        await File.WriteAllTextAsync(filePath, JsonSerializer.Serialize(new { schemaVersion = 1, reports }));
        var store = CreateStore(filePath, () => now.AddMinutes(4), maximumReports: 2, submissionsPerWindow: 100);

        Assert.Equal(2, (await store.GetReportsAsync(10)).Count);

        using var document = JsonDocument.Parse(await File.ReadAllTextAsync(filePath));
        Assert.Equal(2, document.RootElement.GetProperty("reports").GetArrayLength());
    }

    [Fact]
    public async Task StoreSurvivesRestartAndPrunesByCountAndRetention()
    {
        var now = new DateTimeOffset(2026, 8, 26, 12, 0, 0, TimeSpan.Zero);
        var filePath = Path.Combine(_directory, "media-reports.json");
        var store = CreateStore(filePath, () => now, maximumReports: 2, submissionsPerWindow: 100);

        for (var index = 0; index < 3; index += 1)
        {
            var report = ValidRecord(Guid.Parse($"00000000-0000-0000-0000-{index + 1:D12}"));
            Assert.Equal(
                PtvMediaReportSubmissionStatus.Accepted,
                (await store.SubmitAsync("owner", report)).Status);
            now = now.AddSeconds(1);
        }

        Assert.Equal(2, (await store.GetReportsAsync(10)).Count);
        var restarted = CreateStore(filePath, () => now, maximumReports: 2, submissionsPerWindow: 100);
        Assert.Equal(2, (await restarted.GetReportsAsync(10)).Count);

        now = now.Add(PtvMediaReportStore.DefaultRetention).AddSeconds(1);
        Assert.Empty(await restarted.GetReportsAsync(10));
        Assert.DoesNotContain("reportId", await File.ReadAllTextAsync(filePath), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ConcurrentSubmissionsDoNotLoseAcceptedRecords()
    {
        var store = CreateStore(
            Path.Combine(_directory, "media-reports.json"),
            maximumReports: 100,
            submissionsPerWindow: 100);
        var submissions = Enumerable.Range(1, 20)
            .Select(index => store.SubmitAsync($"owner-{index}", ValidRecord(Guid.NewGuid())))
            .ToArray();

        var results = await Task.WhenAll(submissions);

        Assert.All(results, result => Assert.Equal(PtvMediaReportSubmissionStatus.Accepted, result.Status));
        Assert.Equal(20, (await store.GetReportsAsync(100)).Count);
    }

    [Fact]
    public async Task AdministratorCanListAndDeleteWhileOrdinaryUserCannotReadQueue()
    {
        var store = CreateStore(Path.Combine(_directory, "media-reports.json"));
        var admin = CreateController(store, new AllowAuthorizationService());
        var accepted = Assert.IsType<PtvMediaReportAcceptedResponse>(
            Assert.IsType<AcceptedResult>((await admin.Submit(ValidRequest(), CancellationToken.None)).Result).Value);

        var read = await admin.GetReports(100, CancellationToken.None);
        Assert.Single(Assert.IsAssignableFrom<IReadOnlyList<PtvMediaReportRecord>>(Assert.IsType<OkObjectResult>(read.Result).Value));
        Assert.IsType<NoContentResult>(await admin.Delete(accepted.ReportId, CancellationToken.None));
        Assert.Empty(await store.GetReportsAsync(10));

        var ordinaryUser = CreateController(store, new DenyAuthorizationService());
        Assert.IsType<ForbidResult>((await ordinaryUser.GetReports(100, CancellationToken.None)).Result);
    }

    [Fact]
    public void RouteRequiresAuthenticationAndAdvertisesTheExactBodyLimit()
    {
        Assert.NotNull(typeof(PtvMediaReportsController).GetCustomAttribute<AuthorizeAttribute>());
        var route = Assert.Single(typeof(PtvMediaReportsController).GetCustomAttributes<RouteAttribute>());
        Assert.Equal("Ptv/v1/reports/media", route.Template);

        var submit = typeof(PtvMediaReportsController).GetMethod(nameof(PtvMediaReportsController.Submit));
        var limit = Assert.Single(
            submit!.CustomAttributes,
            attribute => attribute.AttributeType == typeof(RequestSizeLimitAttribute));
        var configuredBytes = Assert.IsType<long>(Assert.Single(limit.ConstructorArguments).Value);
        Assert.Equal(PtvMediaReportValidator.MaximumRequestBytes, configuredBytes);
        Assert.Equal(16 * 1024, configuredBytes);
    }

    [Fact]
    public async Task DefaultStatusAdvertisesMediaReportsCapability()
    {
        var controller = new PtvStatusController(
            NullLogger<PtvStatusController>.Instance,
            new ServiceCollection().BuildServiceProvider());

        var status = await controller.GetStatus(full: false, CancellationToken.None);
        var value = Assert.IsType<OkObjectResult>(status).Value;
        var json = JsonSerializer.SerializeToElement(value);

        Assert.True(json.GetProperty("featureFlags").GetProperty("mediaReports").GetBoolean());
        Assert.Contains("mediaReports", json.GetProperty("features").EnumerateArray().Select(item => item.GetString()));
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory))
        {
            Directory.Delete(_directory, recursive: true);
        }
    }

    private PtvMediaReportStore CreateStore(
        string filePath,
        Func<DateTimeOffset>? clock = null,
        int maximumReports = PtvMediaReportStore.DefaultMaximumReports,
        int submissionsPerWindow = PtvMediaReportStore.DefaultSubmissionsPerWindow) => new(
            filePath,
            NullLogger<PtvMediaReportStore>.Instance,
            clock ?? (() => new DateTimeOffset(2026, 8, 26, 12, 0, 0, TimeSpan.Zero)),
            maximumReports,
            PtvMediaReportStore.DefaultRetention,
            submissionsPerWindow,
            PtvMediaReportStore.DefaultRateWindow);

    private static PtvMediaReportsController CreateController(
        IPtvMediaReportStore store,
        IAuthorizationService authorizationService,
        bool authenticated = true,
        bool canAccessItem = true)
    {
        var identity = authenticated
            ? new ClaimsIdentity([new Claim("Jellyfin-UserId", UserId.ToString("N"))], "test")
            : new ClaimsIdentity();
        return new PtvMediaReportsController(
            NullLogger<PtvMediaReportsController>.Instance,
            store,
            authorizationService,
            (_, _) => canAccessItem)
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

    private static PtvMediaReportRequest ValidRequest() => new()
    {
        Details = "Subtitles are late.",
        ItemId = ItemId.ToString("N"),
        ItemType = "Movie",
        MediaSourceId = "source-1",
        PlaybackPositionMs = 120_000,
        PlayMethod = "DirectPlay",
        Reason = "subtitle-sync",
        SchemaVersion = 1,
        Source = "playback"
    };

    private static PtvMediaReportRecord ValidRecord(Guid itemId) => new()
    {
        Details = "Playback issue.",
        ItemId = itemId.ToString("N"),
        ItemType = "Movie",
        Reason = "playback",
        SchemaVersion = 1,
        Source = "playback"
    };

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

    private sealed class DenyAuthorizationService : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            IEnumerable<IAuthorizationRequirement> requirements) => Task.FromResult(AuthorizationResult.Failed());

        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            string policyName) => Task.FromResult(AuthorizationResult.Failed());
    }
}
