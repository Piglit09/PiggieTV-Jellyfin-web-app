using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Coordinates bounded, cached, rate-aware external Reading provider requests.</summary>
public interface IPtvReadingMetadataRequestCoordinator
{
    Task<PtvReadingMetadataHttpResult> ExecuteAsync(
        PtvReadingMetadataHttpRequest request,
        CancellationToken cancellationToken);

    PtvReadingProviderStatus GetStatus(string provider);
}

/// <summary>A structured request identity. Values are canonicalized and hashed before cache use.</summary>
public sealed record PtvReadingMetadataRequestKey(
    string Operation,
    IReadOnlyDictionary<string, string?> Parameters)
{
    public static PtvReadingMetadataRequestKey Create(string operation, params (string Name, string? Value)[] parameters) =>
        new(operation, parameters.ToDictionary(pair => pair.Name, pair => pair.Value, StringComparer.Ordinal));
}

/// <summary>Provider-specific transport policy and request factory.</summary>
public sealed class PtvReadingMetadataHttpRequest
{
    public required string Provider { get; init; }

    public required PtvReadingMetadataRequestKey Key { get; init; }

    public required Func<HttpRequestMessage> CreateRequest { get; init; }

    public int MaximumConcurrency { get; init; } = 2;

    public TimeSpan MinimumInterval { get; init; } = TimeSpan.Zero;

    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(15);

    public TimeSpan CacheTtl { get; init; } = TimeSpan.FromDays(7);

    public TimeSpan HeaderlessRateLimitBackoff { get; init; } = TimeSpan.FromSeconds(30);

    public int MaximumResponseBytes { get; init; } = 1_048_576;
}

/// <summary>Bounded transport result; raw response objects never escape the coordinator.</summary>
public sealed class PtvReadingMetadataHttpResult
{
    public bool Succeeded { get; init; }

    public int? StatusCode { get; init; }

    public string? Body { get; init; }

    public bool CacheHit { get; init; }

    public long DurationMilliseconds { get; init; }

    public PtvReadingProviderFailure? Failure { get; init; }
}
