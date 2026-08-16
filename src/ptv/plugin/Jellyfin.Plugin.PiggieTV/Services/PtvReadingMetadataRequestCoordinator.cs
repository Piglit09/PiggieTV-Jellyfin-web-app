using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Jellyfin.Plugin.PiggieTV.Models;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Shared bounded request coordinator for public Reading metadata providers.
/// It owns concurrency, pacing, single-flight, caching, timeouts and provider-directed rate-limit blocks.
/// </summary>
public sealed class PtvReadingMetadataRequestCoordinator : IPtvReadingMetadataRequestCoordinator
{
    private const int MaximumCacheEntries = 512;
    private static readonly HttpClient SharedHttpClient = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.Brotli | DecompressionMethods.Deflate | DecompressionMethods.GZip,
        PooledConnectionLifetime = TimeSpan.FromMinutes(10)
    })
    {
        Timeout = Timeout.InfiniteTimeSpan
    };

    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, Lazy<Task<PtvReadingMetadataHttpResult>>> _inflight = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, ProviderState> _providers = new(StringComparer.OrdinalIgnoreCase);
    private readonly HttpClient _httpClient;
    private readonly ILogger<PtvReadingMetadataRequestCoordinator> _logger;
    private readonly Func<DateTimeOffset> _utcNow;

    public PtvReadingMetadataRequestCoordinator(ILogger<PtvReadingMetadataRequestCoordinator> logger)
        : this(SharedHttpClient, logger, () => DateTimeOffset.UtcNow)
    {
    }

    internal PtvReadingMetadataRequestCoordinator(
        HttpClient httpClient,
        ILogger<PtvReadingMetadataRequestCoordinator> logger,
        Func<DateTimeOffset>? utcNow = null)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
    }

    internal int CacheCount => _cache.Count;

    internal int InflightCount => _inflight.Count;

    public async Task<PtvReadingMetadataHttpResult> ExecuteAsync(
        PtvReadingMetadataHttpRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        cancellationToken.ThrowIfCancellationRequested();

        var provider = NormalizeProvider(request.Provider);
        var cacheKey = CreateCacheKey(provider, request.Key);
        if (TryGetCache(cacheKey, out var cached))
        {
            return Clone(cached.Result, cacheHit: true);
        }

        var operation = _inflight.GetOrAdd(
            cacheKey,
            _ =>
            {
                Lazy<Task<PtvReadingMetadataHttpResult>>? created = null;
                created = new Lazy<Task<PtvReadingMetadataHttpResult>>(
                    () => ExecuteAndRemoveAsync(provider, cacheKey, request, created!),
                    LazyThreadSafetyMode.ExecutionAndPublication);
                return created;
            });

        // Caller cancellation ends that caller's wait. The shared bounded flight continues for
        // other waiters and always has its own timeout, avoiding one caller cancelling everyone.
        return await operation.Value.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task<PtvReadingMetadataHttpResult> ExecuteAndRemoveAsync(
        string provider,
        string cacheKey,
        PtvReadingMetadataHttpRequest request,
        Lazy<Task<PtvReadingMetadataHttpResult>> operation)
    {
        try
        {
            return await ExecuteCoreAsync(provider, cacheKey, request).ConfigureAwait(false);
        }
        finally
        {
            _inflight.TryRemove(new KeyValuePair<string, Lazy<Task<PtvReadingMetadataHttpResult>>>(cacheKey, operation));
        }
    }

    public PtvReadingProviderStatus GetStatus(string provider)
    {
        provider = NormalizeProvider(provider);
        if (_providers.TryGetValue(provider, out var state))
        {
            var blockedUntil = state.BlockedUntilUtc;
            var now = _utcNow();
            if (blockedUntil > now)
            {
                return new PtvReadingProviderStatus
                {
                    Provider = provider,
                    State = PtvReadingProviderState.RateLimited,
                    Message = "The provider asked PiggieTV to pause requests.",
                    RetryAfterSeconds = RemainingSeconds(blockedUntil, now)
                };
            }
        }

        return new PtvReadingProviderStatus
        {
            Provider = provider,
            State = PtvReadingProviderState.Available,
            Message = "Ready"
        };
    }

    private async Task<PtvReadingMetadataHttpResult> ExecuteCoreAsync(
        string provider,
        string cacheKey,
        PtvReadingMetadataHttpRequest request)
    {
        var stopwatch = Stopwatch.StartNew();
        var state = _providers.GetOrAdd(provider, _ => new ProviderState(Math.Max(1, request.MaximumConcurrency)));
        var blocked = CreateBlockedResult(provider, state, stopwatch.ElapsedMilliseconds);
        if (blocked is not null)
        {
            return blocked;
        }

        using var timeoutSource = new CancellationTokenSource(request.Timeout > TimeSpan.Zero
            ? request.Timeout
            : TimeSpan.FromSeconds(15));
        var token = timeoutSource.Token;

        try
        {
            await state.Concurrency.WaitAsync(token).ConfigureAwait(false);
            try
            {
                blocked = CreateBlockedResult(provider, state, stopwatch.ElapsedMilliseconds);
                if (blocked is not null)
                {
                    return blocked;
                }

                await PaceAsync(state, request.MinimumInterval, token).ConfigureAwait(false);
                using var message = request.CreateRequest();
                using var response = await _httpClient.SendAsync(
                    message,
                    HttpCompletionOption.ResponseHeadersRead,
                    token).ConfigureAwait(false);

                var statusCode = (int)response.StatusCode;
                if (response.StatusCode == HttpStatusCode.TooManyRequests)
                {
                    var retryAfter = ResolveRetryAfter(response, request.HeaderlessRateLimitBackoff);
                    state.BlockUntil(_utcNow().Add(retryAfter));
                    return Failure(
                        provider,
                        PtvReadingProviderFailureKind.RateLimit,
                        "provider-rate-limited",
                        "The provider temporarily limited requests.",
                        stopwatch.ElapsedMilliseconds,
                        statusCode,
                        (int)Math.Ceiling(retryAfter.TotalSeconds));
                }

                if (!response.IsSuccessStatusCode)
                {
                    var kind = response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden
                        ? PtvReadingProviderFailureKind.Authentication
                        : (int)response.StatusCode >= 500
                            ? PtvReadingProviderFailureKind.Unavailable
                            : PtvReadingProviderFailureKind.BadRequest;
                    return Failure(
                        provider,
                        kind,
                        $"provider-http-{statusCode.ToString(CultureInfo.InvariantCulture)}",
                        "The provider could not complete this request.",
                        stopwatch.ElapsedMilliseconds,
                        statusCode);
                }

                ApplySuccessfulRateLimitHeaders(response, state);

                var body = await ReadBoundedBodyAsync(
                    response.Content,
                    Math.Clamp(request.MaximumResponseBytes, 1_024, 4_194_304),
                    token).ConfigureAwait(false);
                if (body is null)
                {
                    return Failure(
                        provider,
                        PtvReadingProviderFailureKind.Parse,
                        "provider-response-too-large",
                        "The provider returned more data than PiggieTV can safely process.",
                        stopwatch.ElapsedMilliseconds,
                        statusCode);
                }

                var result = new PtvReadingMetadataHttpResult
                {
                    Succeeded = true,
                    StatusCode = statusCode,
                    Body = body,
                    DurationMilliseconds = stopwatch.ElapsedMilliseconds
                };
                _cache[cacheKey] = new CacheEntry(
                    Clone(result, cacheHit: false),
                    _utcNow().Add(request.CacheTtl > TimeSpan.Zero ? request.CacheTtl : TimeSpan.FromHours(1)),
                    _utcNow());
                TrimCache();
                return result;
            }
            finally
            {
                state.Concurrency.Release();
            }
        }
        catch (OperationCanceledException)
        {
            return Failure(
                provider,
                PtvReadingProviderFailureKind.Timeout,
                "provider-timeout",
                "The provider did not respond in time.",
                stopwatch.ElapsedMilliseconds);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(
                "Reading metadata provider request failed. Provider={Provider}; Failure={FailureType}.",
                provider,
                ex.GetType().Name);
            return Failure(
                provider,
                PtvReadingProviderFailureKind.Network,
                "provider-network-failure",
                "The provider is temporarily unreachable.",
                stopwatch.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                "Reading metadata provider request failed. Provider={Provider}; Failure={FailureType}.",
                provider,
                ex.GetType().Name);
            return Failure(
                provider,
                PtvReadingProviderFailureKind.Unknown,
                "provider-request-failed",
                "The provider request failed.",
                stopwatch.ElapsedMilliseconds);
        }
        finally
        {
            stopwatch.Stop();
        }
    }

    private async Task PaceAsync(ProviderState state, TimeSpan minimumInterval, CancellationToken cancellationToken)
    {
        var providerInterval = state.GetRecommendedMinimumInterval(_utcNow());
        var effectiveInterval = providerInterval > minimumInterval ? providerInterval : minimumInterval;
        if (effectiveInterval <= TimeSpan.Zero)
        {
            return;
        }

        await state.Pacing.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var delay = state.LastRequestStartedUtc.Add(effectiveInterval) - _utcNow();
            if (delay > TimeSpan.Zero)
            {
                await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
            }

            state.LastRequestStartedUtc = _utcNow();
        }
        finally
        {
            state.Pacing.Release();
        }
    }

    private void ApplySuccessfulRateLimitHeaders(HttpResponseMessage response, ProviderState state)
    {
        if (!TryGetIntegerHeader(response, "X-RateLimit-Remaining", out var remaining)
            || !TryGetEpochHeader(response, "X-RateLimit-Reset", out var resetAt))
        {
            return;
        }

        var now = _utcNow();
        if (resetAt <= now)
        {
            return;
        }

        if (remaining <= 0)
        {
            state.BlockUntil(resetAt);
            return;
        }

        // Spread the remaining allowance across the provider's current window. This reacts to
        // AniList's reported capacity instead of assuming its historical nominal rate.
        var intervalTicks = (resetAt - now).Ticks / Math.Max(1, remaining);
        var interval = TimeSpan.FromTicks(Math.Clamp(
            intervalTicks,
            TimeSpan.Zero.Ticks,
            TimeSpan.FromMinutes(1).Ticks));
        state.RecommendMinimumInterval(interval, resetAt);
    }

    private PtvReadingMetadataHttpResult? CreateBlockedResult(
        string provider,
        ProviderState state,
        long durationMilliseconds)
    {
        var now = _utcNow();
        var blockedUntil = state.BlockedUntilUtc;
        return blockedUntil > now
            ? Failure(
                provider,
                PtvReadingProviderFailureKind.RateLimit,
                "provider-rate-limit-active",
                "The provider asked PiggieTV to pause requests.",
                durationMilliseconds,
                retryAfterSeconds: RemainingSeconds(blockedUntil, now))
            : null;
    }

    private static async Task<string?> ReadBoundedBodyAsync(
        HttpContent content,
        int maximumBytes,
        CancellationToken cancellationToken)
    {
        await using var stream = await content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var buffer = new MemoryStream(Math.Min(maximumBytes, 64 * 1024));
        var chunk = new byte[16 * 1024];
        while (true)
        {
            var read = await stream.ReadAsync(chunk.AsMemory(0, chunk.Length), cancellationToken).ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }

            if (buffer.Length + read > maximumBytes)
            {
                return null;
            }

            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
        }

        return Encoding.UTF8.GetString(buffer.GetBuffer(), 0, checked((int)buffer.Length));
    }

    private TimeSpan ResolveRetryAfter(HttpResponseMessage response, TimeSpan fallback)
    {
        var now = _utcNow();
        var candidates = new List<DateTimeOffset>();
        if (response.Headers.RetryAfter?.Delta is { } delta)
        {
            candidates.Add(now.Add(delta));
        }

        if (response.Headers.RetryAfter?.Date is { } date)
        {
            candidates.Add(date);
        }

        AddEpochHeader(response, "X-RateLimit-Reset", candidates);
        AddEpochHeader(response, "X-RateLimit-Retry-After", candidates);
        var until = candidates.Where(candidate => candidate > now).DefaultIfEmpty(now.Add(
            fallback > TimeSpan.Zero ? fallback : TimeSpan.FromSeconds(30))).Max();
        var bounded = until - now;
        return bounded > TimeSpan.FromHours(1) ? TimeSpan.FromHours(1) : bounded;
    }

    private static void AddEpochHeader(
        HttpResponseMessage response,
        string header,
        ICollection<DateTimeOffset> candidates)
    {
        if (!response.Headers.TryGetValues(header, out var values))
        {
            return;
        }

        foreach (var value in values)
        {
            if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var epoch))
            {
                try
                {
                    candidates.Add(DateTimeOffset.FromUnixTimeSeconds(epoch));
                }
                catch (ArgumentOutOfRangeException)
                {
                    // Ignore malformed provider-controlled epoch headers.
                }
            }
        }
    }

    private static bool TryGetIntegerHeader(HttpResponseMessage response, string header, out int value)
    {
        value = 0;
        if (!response.Headers.TryGetValues(header, out var values))
        {
            return false;
        }

        foreach (var candidate in values)
        {
            if (int.TryParse(candidate, NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
            {
                return true;
            }
        }

        return false;
    }

    private static bool TryGetEpochHeader(
        HttpResponseMessage response,
        string header,
        out DateTimeOffset value)
    {
        value = default;
        if (!response.Headers.TryGetValues(header, out var values))
        {
            return false;
        }

        foreach (var candidate in values)
        {
            if (!long.TryParse(candidate, NumberStyles.Integer, CultureInfo.InvariantCulture, out var epoch))
            {
                continue;
            }

            try
            {
                value = DateTimeOffset.FromUnixTimeSeconds(epoch);
                return true;
            }
            catch (ArgumentOutOfRangeException)
            {
                // Ignore malformed provider-controlled epoch headers.
            }
        }

        return false;
    }

    private bool TryGetCache(string key, out CacheEntry entry)
    {
        if (_cache.TryGetValue(key, out entry!) && entry.ExpiresAtUtc > _utcNow())
        {
            return true;
        }

        _cache.TryRemove(key, out _);
        entry = null!;
        return false;
    }

    private void TrimCache()
    {
        if (_cache.Count <= MaximumCacheEntries)
        {
            return;
        }

        foreach (var key in _cache
            .OrderBy(pair => pair.Value.CreatedAtUtc)
            .Take(_cache.Count - (MaximumCacheEntries * 3 / 4))
            .Select(pair => pair.Key))
        {
            _cache.TryRemove(key, out _);
        }
    }

    private static string CreateCacheKey(string provider, PtvReadingMetadataRequestKey key)
    {
        var canonical = new StringBuilder(provider)
            .Append('\n')
            .Append(key.Operation.Trim().ToUpperInvariant());
        foreach (var pair in key.Parameters.OrderBy(pair => pair.Key, StringComparer.Ordinal))
        {
            canonical.Append('\n')
                .Append(pair.Key.Trim().ToUpperInvariant())
                .Append('=')
                .Append(pair.Value?.Trim() ?? string.Empty);
        }

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical.ToString())));
    }

    private static string NormalizeProvider(string? provider) =>
        string.IsNullOrWhiteSpace(provider) ? "unknown" : provider.Trim();

    private static int RemainingSeconds(DateTimeOffset until, DateTimeOffset now) =>
        Math.Max(1, (int)Math.Ceiling((until - now).TotalSeconds));

    private static PtvReadingMetadataHttpResult Failure(
        string provider,
        PtvReadingProviderFailureKind kind,
        string code,
        string message,
        long durationMilliseconds,
        int? statusCode = null,
        int? retryAfterSeconds = null) => new()
        {
            Succeeded = false,
            StatusCode = statusCode,
            DurationMilliseconds = durationMilliseconds,
            Failure = new PtvReadingProviderFailure
            {
                Provider = provider,
                Kind = kind,
                Code = code,
                Message = message,
                RetryAfterSeconds = retryAfterSeconds
            }
        };

    private static PtvReadingMetadataHttpResult Clone(PtvReadingMetadataHttpResult source, bool cacheHit) => new()
    {
        Succeeded = source.Succeeded,
        StatusCode = source.StatusCode,
        Body = source.Body,
        CacheHit = cacheHit,
        DurationMilliseconds = source.DurationMilliseconds,
        Failure = source.Failure is null ? null : new PtvReadingProviderFailure
        {
            Provider = source.Failure.Provider,
            Kind = source.Failure.Kind,
            Code = source.Failure.Code,
            Message = source.Failure.Message,
            RetryAfterSeconds = source.Failure.RetryAfterSeconds
        }
    };

    private sealed record CacheEntry(
        PtvReadingMetadataHttpResult Result,
        DateTimeOffset ExpiresAtUtc,
        DateTimeOffset CreatedAtUtc);

    private sealed class ProviderState
    {
        private long _blockedUntilUnixMilliseconds;
        private long _recommendedIntervalTicks;
        private long _recommendedUntilUnixMilliseconds;

        public ProviderState(int maximumConcurrency)
        {
            Concurrency = new SemaphoreSlim(maximumConcurrency, maximumConcurrency);
        }

        public SemaphoreSlim Concurrency { get; }

        public SemaphoreSlim Pacing { get; } = new(1, 1);

        public DateTimeOffset LastRequestStartedUtc { get; set; } = DateTimeOffset.MinValue;

        public DateTimeOffset BlockedUntilUtc => DateTimeOffset.FromUnixTimeMilliseconds(
            Interlocked.Read(ref _blockedUntilUnixMilliseconds));

        public TimeSpan GetRecommendedMinimumInterval(DateTimeOffset now)
        {
            if (Interlocked.Read(ref _recommendedUntilUnixMilliseconds) <= now.ToUnixTimeMilliseconds())
            {
                return TimeSpan.Zero;
            }

            return TimeSpan.FromTicks(Math.Max(0, Interlocked.Read(ref _recommendedIntervalTicks)));
        }

        public void RecommendMinimumInterval(TimeSpan interval, DateTimeOffset until)
        {
            Interlocked.Exchange(ref _recommendedIntervalTicks, Math.Max(0, interval.Ticks));
            Interlocked.Exchange(ref _recommendedUntilUnixMilliseconds, until.ToUnixTimeMilliseconds());
        }

        public void BlockUntil(DateTimeOffset until)
        {
            var desired = until.ToUnixTimeMilliseconds();
            while (true)
            {
                var current = Interlocked.Read(ref _blockedUntilUnixMilliseconds);
                if (current >= desired || Interlocked.CompareExchange(ref _blockedUntilUnixMilliseconds, desired, current) == current)
                {
                    return;
                }
            }
        }
    }
}
