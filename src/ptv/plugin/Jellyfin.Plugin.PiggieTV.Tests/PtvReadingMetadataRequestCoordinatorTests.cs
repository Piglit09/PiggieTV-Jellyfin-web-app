using System.Net;
using System.Text;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvReadingMetadataRequestCoordinatorTests
{
    [Fact]
    public async Task IdenticalConcurrentRequestsShareOneFlightAndCacheAClone()
    {
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        using var client = new HttpClient(new StubHandler(async (_, cancellationToken) =>
        {
            Interlocked.Increment(ref calls);
            await release.Task.WaitAsync(cancellationToken);
            return Json("{\"ok\":true}");
        }));
        var coordinator = CreateCoordinator(client);
        var request = Request("anilist", "same");

        var operations = Enumerable.Range(0, 5)
            .Select(_ => coordinator.ExecuteAsync(request, CancellationToken.None))
            .ToArray();
        await Task.Delay(20);
        release.SetResult();
        var results = await Task.WhenAll(operations);
        var cached = await coordinator.ExecuteAsync(request, CancellationToken.None);

        Assert.Equal(1, calls);
        Assert.All(results, result => Assert.True(result.Succeeded));
        Assert.True(cached.CacheHit);
        Assert.Equal("{\"ok\":true}", cached.Body);
        Assert.Equal(0, coordinator.InflightCount);
    }

    [Fact]
    public async Task StructuredKeySeparatesProviderAndParameters()
    {
        var calls = 0;
        using var client = new HttpClient(new StubHandler((_, _) =>
        {
            var call = Interlocked.Increment(ref calls);
            return Task.FromResult(Json($"{{\"call\":{call}}}"));
        }));
        var coordinator = CreateCoordinator(client);

        var first = await coordinator.ExecuteAsync(Request("anilist", "one"), CancellationToken.None);
        var second = await coordinator.ExecuteAsync(Request("anilist", "two"), CancellationToken.None);
        var otherProvider = await coordinator.ExecuteAsync(Request("mangadex", "one"), CancellationToken.None);

        Assert.Equal(3, calls);
        Assert.NotEqual(first.Body, second.Body);
        Assert.NotEqual(first.Body, otherProvider.Body);
    }

    [Fact]
    public async Task RetryAfterSecondsBlocksProviderWithoutRapidRetry()
    {
        var calls = 0;
        using var client = new HttpClient(new StubHandler((_, _) =>
        {
            Interlocked.Increment(ref calls);
            var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            response.Headers.TryAddWithoutValidation("Retry-After", "45");
            return Task.FromResult(response);
        }));
        var coordinator = CreateCoordinator(client);

        var first = await coordinator.ExecuteAsync(Request("anilist", "first"), CancellationToken.None);
        var second = await coordinator.ExecuteAsync(Request("anilist", "second"), CancellationToken.None);

        Assert.Equal(PtvReadingProviderFailureKind.RateLimit, first.Failure?.Kind);
        Assert.InRange(first.Failure?.RetryAfterSeconds ?? 0, 44, 45);
        Assert.Equal("provider-rate-limit-active", second.Failure?.Code);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task MangaDexEpochHeaderAndHeaderlessFallbackBothBlockProvider()
    {
        var now = new DateTimeOffset(2026, 8, 15, 12, 0, 0, TimeSpan.Zero);
        var calls = 0;
        using var client = new HttpClient(new StubHandler((request, _) =>
        {
            Interlocked.Increment(ref calls);
            var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            if (request.RequestUri?.Query.Contains("epoch", StringComparison.Ordinal) == true)
            {
                response.Headers.TryAddWithoutValidation(
                    "X-RateLimit-Retry-After",
                    now.AddSeconds(20).ToUnixTimeSeconds().ToString());
            }

            return Task.FromResult(response);
        }));
        var epochCoordinator = new PtvReadingMetadataRequestCoordinator(
            client,
            NullLogger<PtvReadingMetadataRequestCoordinator>.Instance,
            () => now);
        var epoch = await epochCoordinator.ExecuteAsync(
            Request("mangadex", "epoch", "https://example.test/?epoch=1"),
            CancellationToken.None);
        Assert.Equal(20, epoch.Failure?.RetryAfterSeconds);

        var fallbackCoordinator = new PtvReadingMetadataRequestCoordinator(
            client,
            NullLogger<PtvReadingMetadataRequestCoordinator>.Instance,
            () => now);
        var fallbackRequest = Request("mangadex", "fallback");
        fallbackRequest = new PtvReadingMetadataHttpRequest
        {
            Provider = fallbackRequest.Provider,
            Key = fallbackRequest.Key,
            CreateRequest = fallbackRequest.CreateRequest,
            HeaderlessRateLimitBackoff = TimeSpan.FromSeconds(12)
        };
        var fallback = await fallbackCoordinator.ExecuteAsync(fallbackRequest, CancellationToken.None);
        Assert.Equal(12, fallback.Failure?.RetryAfterSeconds);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task SuccessfulResponseExhaustingReportedAllowanceBlocksTheNextRequest()
    {
        var now = new DateTimeOffset(2026, 8, 15, 12, 0, 0, TimeSpan.Zero);
        var calls = 0;
        using var client = new HttpClient(new StubHandler((_, _) =>
        {
            Interlocked.Increment(ref calls);
            var response = Json("{\"ok\":true}");
            response.Headers.TryAddWithoutValidation("X-RateLimit-Remaining", "0");
            response.Headers.TryAddWithoutValidation(
                "X-RateLimit-Reset",
                now.AddSeconds(20).ToUnixTimeSeconds().ToString());
            return Task.FromResult(response);
        }));
        var coordinator = new PtvReadingMetadataRequestCoordinator(
            client,
            NullLogger<PtvReadingMetadataRequestCoordinator>.Instance,
            () => now);

        var first = await coordinator.ExecuteAsync(Request("anilist", "first"), CancellationToken.None);
        var second = await coordinator.ExecuteAsync(Request("anilist", "second"), CancellationToken.None);

        Assert.True(first.Succeeded);
        Assert.Equal("provider-rate-limit-active", second.Failure?.Code);
        Assert.Equal(20, second.Failure?.RetryAfterSeconds);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task TimeoutAndOversizedPayloadReturnSafeNormalizedFailures()
    {
        using var timeoutClient = new HttpClient(new StubHandler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return Json("{}");
        }));
        var timeoutCoordinator = CreateCoordinator(timeoutClient);
        var timeoutRequest = Request("anilist", "slow");
        timeoutRequest = Copy(timeoutRequest, timeout: TimeSpan.FromMilliseconds(20));
        var timeout = await timeoutCoordinator.ExecuteAsync(timeoutRequest, CancellationToken.None);
        Assert.Equal(PtvReadingProviderFailureKind.Timeout, timeout.Failure?.Kind);

        using var largeClient = new HttpClient(new StubHandler((_, _) =>
            Task.FromResult(Json(new string('x', 4_096)))));
        var largeCoordinator = CreateCoordinator(largeClient);
        var largeRequest = Copy(Request("mangadex", "large"), maximumBytes: 1_024);
        var large = await largeCoordinator.ExecuteAsync(largeRequest, CancellationToken.None);
        Assert.Equal("provider-response-too-large", large.Failure?.Code);
        Assert.DoesNotContain("xxxx", large.Failure?.Message ?? string.Empty);
    }

    [Fact]
    public async Task RedirectResponseIsRejectedWithoutAcceptingRedirectMetadata()
    {
        var calls = 0;
        using var client = new HttpClient(new StubHandler((_, _) =>
        {
            Interlocked.Increment(ref calls);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Redirect)
            {
                Headers = { Location = new Uri("http://127.0.0.1/private") }
            });
        }));
        var coordinator = CreateCoordinator(client);

        var result = await coordinator.ExecuteAsync(Request("anilist", "redirect"), CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.Equal(PtvReadingProviderFailureKind.BadRequest, result.Failure?.Kind);
        Assert.Equal("provider-http-302", result.Failure?.Code);
        Assert.Equal(1, calls);
        Assert.DoesNotContain("127.0.0.1", result.Failure?.Message ?? string.Empty, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CallerCancellationEndsWaitWithoutCancellingSharedFlight()
    {
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var client = new HttpClient(new StubHandler(async (_, cancellationToken) =>
        {
            await release.Task.WaitAsync(cancellationToken);
            return Json("{}");
        }));
        var coordinator = CreateCoordinator(client);
        var request = Request("anilist", "cancel-one-waiter");
        using var cancellationSource = new CancellationTokenSource(TimeSpan.FromMilliseconds(20));

        var cancelled = coordinator.ExecuteAsync(request, cancellationSource.Token);
        var surviving = coordinator.ExecuteAsync(request, CancellationToken.None);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => cancelled);
        release.SetResult();
        Assert.True((await surviving).Succeeded);
    }

    [Fact]
    public async Task CancelledOnlyFlightRemovesItselfAfterItsBoundedTimeout()
    {
        using var client = new HttpClient(new StubHandler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return Json("{}");
        }));
        var coordinator = CreateCoordinator(client);
        var request = Copy(Request("anilist", "cancel-only"), timeout: TimeSpan.FromMilliseconds(30));
        using var cancellationSource = new CancellationTokenSource(TimeSpan.FromMilliseconds(5));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            coordinator.ExecuteAsync(request, cancellationSource.Token));
        await Task.Delay(80);

        Assert.Equal(0, coordinator.InflightCount);
    }

    [Fact]
    public async Task PerProviderConcurrencyAndCacheRemainBounded()
    {
        var active = 0;
        var maximumActive = 0;
        using var client = new HttpClient(new StubHandler(async (_, cancellationToken) =>
        {
            var current = Interlocked.Increment(ref active);
            maximumActive = Math.Max(maximumActive, current);
            try
            {
                await Task.Delay(5, cancellationToken);
                return Json("{}");
            }
            finally
            {
                Interlocked.Decrement(ref active);
            }
        }));
        var coordinator = CreateCoordinator(client);

        await Task.WhenAll(Enumerable.Range(0, 8).Select(index =>
            coordinator.ExecuteAsync(Request("mangadex", $"concurrent-{index}"), CancellationToken.None)));
        for (var index = 0; index < 520; index++)
        {
            await coordinator.ExecuteAsync(Request("anilist", $"cache-{index}"), CancellationToken.None);
        }

        Assert.InRange(maximumActive, 1, 2);
        Assert.InRange(coordinator.CacheCount, 1, 512);
    }

    private static PtvReadingMetadataRequestCoordinator CreateCoordinator(HttpClient client) => new(
        client,
        NullLogger<PtvReadingMetadataRequestCoordinator>.Instance);

    private static PtvReadingMetadataHttpRequest Request(
        string provider,
        string identity,
        string url = "https://example.test/") => new()
        {
            Provider = provider,
            Key = PtvReadingMetadataRequestKey.Create("search", ("query", identity)),
            CreateRequest = () => new HttpRequestMessage(HttpMethod.Get, url),
            CacheTtl = TimeSpan.FromMinutes(10),
            MaximumConcurrency = 2,
            Timeout = TimeSpan.FromSeconds(2)
        };

    private static PtvReadingMetadataHttpRequest Copy(
        PtvReadingMetadataHttpRequest request,
        TimeSpan? timeout = null,
        int? maximumBytes = null) => new()
        {
            Provider = request.Provider,
            Key = request.Key,
            CreateRequest = request.CreateRequest,
            CacheTtl = request.CacheTtl,
            MaximumConcurrency = request.MaximumConcurrency,
            Timeout = timeout ?? request.Timeout,
            MaximumResponseBytes = maximumBytes ?? request.MaximumResponseBytes
        };

    private static HttpResponseMessage Json(string value) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(value, Encoding.UTF8, "application/json")
    };

    private sealed class StubHandler(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> responseFactory) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) => responseFactory(request, cancellationToken);
    }
}
