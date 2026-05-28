using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Controller.Entities;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Optional TMDb metadata client used only by the PiggieTV plugin backend.
/// </summary>
public sealed class PtvTmdbMetadataService : IPtvTmdbMetadataService
{
    private const int DefaultMaxEnrichmentItems = 280;
    private const int MaxAllowedEnrichmentItems = 600;
    private const int MaxFactCacheEntries = 1600;
    private const int MaxParallelRequests = 4;
    private const string UnauthorizedErrorCode = "unauthorized";
    private const string ReadAccessTokenEnvironmentVariable = "PTV_TMDB_READ_ACCESS_TOKEN";
    private const string ApiKeyEnvironmentVariable = "PTV_TMDB_API_KEY";
    private static readonly HttpClient Client = new()
    {
        Timeout = TimeSpan.FromSeconds(8)
    };

    private readonly ConcurrentDictionary<string, PtvTmdbItemFacts> _factCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly ILogger<PtvTmdbMetadataService> _logger;
    private long _cacheHits;
    private long _cacheMisses;
    private long? _lastDurationMs;
    private string? _lastError;
    private string? _lastErrorCode;

    private sealed record TmdbRequest(BaseItem Item, string Endpoint, string TmdbId)
    {
        public string CacheKey => $"{Endpoint}:{TmdbId}";
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvTmdbMetadataService"/> class.
    /// </summary>
    /// <param name="logger">Logger.</param>
    public PtvTmdbMetadataService(ILogger<PtvTmdbMetadataService> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public bool IsConfigured => GetCredentials().Configured;

    /// <inheritdoc />
    public async Task<IReadOnlyDictionary<Guid, PtvTmdbItemFacts>> GetFactsAsync(
        IEnumerable<BaseItem> items,
        CancellationToken cancellationToken)
    {
        var credentials = GetCredentials();

        if (!IsEnabled() || !credentials.Configured)
        {
            if (IsEnabled() && !credentials.Configured)
            {
                _lastError = "TMDb metadata is enabled, but no TMDb read access token or API key is configured.";
                _lastErrorCode = "missing-credential";
            }

            return new Dictionary<Guid, PtvTmdbItemFacts>();
        }

        var stopwatch = Stopwatch.StartNew();
        var requests = items
            .Select(CreateRequest)
            .Where(request => request is not null)
            .Select(request => request!)
            .GroupBy(request => request.CacheKey, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Take(GetMaxEnrichmentItems())
            .ToArray();

        if (requests.Length == 0)
        {
            return new Dictionary<Guid, PtvTmdbItemFacts>();
        }

        if (!await ValidateCredentialsAsync(credentials, cancellationToken).ConfigureAwait(false))
        {
            return new Dictionary<Guid, PtvTmdbItemFacts>();
        }

        var result = new ConcurrentDictionary<Guid, PtvTmdbItemFacts>();
        using var gate = new SemaphoreSlim(MaxParallelRequests, MaxParallelRequests);
        var tasks = requests.Select(async request =>
        {
            await gate.WaitAsync(cancellationToken).ConfigureAwait(false);

            try
            {
                var facts = await GetOrFetchFactsAsync(request, credentials, cancellationToken).ConfigureAwait(false);

                if (facts.HasFacts)
                {
                    result[request.Item.Id] = facts;
                }
            }
            finally
            {
                gate.Release();
            }
        });

        try
        {
            await Task.WhenAll(tasks).ConfigureAwait(false);

            if (!string.Equals(_lastErrorCode, UnauthorizedErrorCode, StringComparison.OrdinalIgnoreCase))
            {
                _lastError = null;
                _lastErrorCode = null;
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            _lastError = "TMDb metadata enrichment timed out or was canceled.";
            _lastErrorCode = "canceled";
        }
        catch (Exception ex)
        {
            _lastError = ex.Message;
            _lastErrorCode = "error";
            _logger.LogDebug(ex, "PiggieTV TMDb metadata enrichment failed.");
        }
        finally
        {
            stopwatch.Stop();
            _lastDurationMs = stopwatch.ElapsedMilliseconds;
            TrimFactCache();
        }

        return result;
    }

    /// <inheritdoc />
    public PtvTmdbMetadataStatus GetStatus()
    {
        var credentials = GetCredentials();

        return new PtvTmdbMetadataStatus
        {
            CacheHits = Interlocked.Read(ref _cacheHits),
            CacheMisses = Interlocked.Read(ref _cacheMisses),
            CacheSize = _factCache.Count,
            Configured = credentials.Configured,
            Enabled = IsEnabled(),
            LastErrorCode = _lastErrorCode,
            LastDurationMs = _lastDurationMs,
            LastError = _lastError
        };
    }

    private async Task<bool> ValidateCredentialsAsync(
        TmdbCredentials credentials,
        CancellationToken cancellationToken)
    {
        try
        {
            using var message = new HttpRequestMessage(HttpMethod.Get, BuildValidationUrl(credentials));

            if (!string.IsNullOrWhiteSpace(credentials.ReadAccessToken))
            {
                message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credentials.ReadAccessToken);
            }

            message.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            using var response = await Client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);

            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                MarkUnauthorized();
                return false;
            }

            if (!response.IsSuccessStatusCode)
            {
                _lastError = $"TMDb credential validation returned {(int)response.StatusCode}. Metadata enrichment skipped for this refresh.";
                _lastErrorCode = "validation-failed";
                return false;
            }

            _lastError = null;
            _lastErrorCode = null;
            return true;
        }
        catch (OperationCanceledException)
        {
            _lastError = "TMDb credential validation timed out or was canceled. Metadata enrichment skipped for this refresh.";
            _lastErrorCode = "canceled";
            return false;
        }
        catch (Exception ex)
        {
            _lastError = $"TMDb credential validation failed: {ex.Message}";
            _lastErrorCode = "validation-failed";
            _logger.LogDebug(ex, "PiggieTV TMDb credential validation failed.");
            return false;
        }
    }

    private async Task<PtvTmdbItemFacts> GetOrFetchFactsAsync(
        TmdbRequest request,
        TmdbCredentials credentials,
        CancellationToken cancellationToken)
    {
        if (_factCache.TryGetValue(request.CacheKey, out var cachedFacts))
        {
            Interlocked.Increment(ref _cacheHits);
            return cachedFacts;
        }

        Interlocked.Increment(ref _cacheMisses);
        var facts = await FetchFactsAsync(request, credentials, cancellationToken).ConfigureAwait(false);

        if (facts.HasFacts)
        {
            _factCache[request.CacheKey] = facts;
        }

        return facts;
    }

    private async Task<PtvTmdbItemFacts> FetchFactsAsync(
        TmdbRequest request,
        TmdbCredentials credentials,
        CancellationToken cancellationToken)
    {
        var url = BuildUrl(request, credentials);
        using var message = new HttpRequestMessage(HttpMethod.Get, url);

        if (!string.IsNullOrWhiteSpace(credentials.ReadAccessToken))
        {
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credentials.ReadAccessToken);
        }

        message.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        using var response = await Client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                MarkUnauthorized();
            }
            else
            {
                _lastError = $"TMDb {request.Endpoint} metadata returned {(int)response.StatusCode}.";
                _lastErrorCode = "request-failed";
            }

            return PtvTmdbItemFacts.Empty;
        }

        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        var json = JsonNode.Parse(body);

        return ParseFacts(json);
    }

    private void MarkUnauthorized()
    {
        _lastError = "TMDb metadata unauthorized. Check the TMDb read access token or API key.";
        _lastErrorCode = UnauthorizedErrorCode;
    }

    private static PtvTmdbItemFacts ParseFacts(JsonNode? json)
    {
        if (json is not JsonObject root)
        {
            return PtvTmdbItemFacts.Empty;
        }

        var keywordRoot = root["keywords"];

        return new PtvTmdbItemFacts
        {
            Genres = ReadNameArray(root["genres"]),
            Keywords = ReadNameArray(keywordRoot?["keywords"] ?? keywordRoot?["results"]),
            Networks = ReadNameArray(root["networks"]),
            OriginCountries = ReadStringArray(root["origin_country"])
                .Concat(ReadNameArray(root["production_countries"]))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            OriginalLanguage = root["original_language"]?.GetValue<string>(),
            ProductionCompanies = ReadNameArray(root["production_companies"])
        };
    }

    private static string[] ReadNameArray(JsonNode? node)
    {
        if (node is not JsonArray array)
        {
            return [];
        }

        return array
            .OfType<JsonObject>()
            .Select(entry => entry["name"]?.GetValue<string>())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string[] ReadStringArray(JsonNode? node)
    {
        if (node is not JsonArray array)
        {
            return [];
        }

        return array
            .Select(entry => entry?.GetValue<string>())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static Uri BuildUrl(TmdbRequest request, TmdbCredentials credentials)
    {
        var query = "append_to_response=keywords";

        if (string.IsNullOrWhiteSpace(credentials.ReadAccessToken) && !string.IsNullOrWhiteSpace(credentials.ApiKey))
        {
            query += $"&api_key={Uri.EscapeDataString(credentials.ApiKey)}";
        }

        return new Uri($"https://api.themoviedb.org/3/{request.Endpoint}/{Uri.EscapeDataString(request.TmdbId)}?{query}");
    }

    private static Uri BuildValidationUrl(TmdbCredentials credentials)
    {
        var query = "language=en-US";

        if (string.IsNullOrWhiteSpace(credentials.ReadAccessToken) && !string.IsNullOrWhiteSpace(credentials.ApiKey))
        {
            query += $"&api_key={Uri.EscapeDataString(credentials.ApiKey)}";
        }

        return new Uri($"https://api.themoviedb.org/3/configuration?{query}");
    }

    private static TmdbRequest? CreateRequest(BaseItem item)
    {
        if (!TryGetTmdbId(item, out var tmdbId))
        {
            return null;
        }

        var endpoint = item.GetType().Name switch
        {
            "Movie" => "movie",
            "Series" => "tv",
            _ => null
        };

        return endpoint is null ? null : new TmdbRequest(item, endpoint, tmdbId);
    }

    private static bool TryGetTmdbId(BaseItem item, out string tmdbId)
    {
        tmdbId = string.Empty;

        foreach (var providerId in item.ProviderIds)
        {
            if (!IsTmdbProviderKey(providerId.Key) || string.IsNullOrWhiteSpace(providerId.Value))
            {
                continue;
            }

            tmdbId = providerId.Value.Trim();
            return true;
        }

        return false;
    }

    private static bool IsTmdbProviderKey(string key)
    {
        return key.Equals("Tmdb", StringComparison.OrdinalIgnoreCase)
            || key.Equals("TheMovieDb", StringComparison.OrdinalIgnoreCase)
            || key.Equals("TheMovieDbId", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsEnabled()
    {
        var configuration = Plugin.Instance?.Configuration ?? new PluginConfiguration();

        PtvPluginSettingsNormalizer.Normalize(configuration);

        return configuration.TmdbSettings.TmdbEnabled && configuration.TmdbSettings.UseTmdbForRowAccuracy;
    }

    private static int GetMaxEnrichmentItems()
    {
        var configuration = Plugin.Instance?.Configuration ?? new PluginConfiguration();

        PtvPluginSettingsNormalizer.Normalize(configuration);

        var configuredValue = configuration.TmdbMaxEnrichmentItems > 0
            ? configuration.TmdbMaxEnrichmentItems
            : DefaultMaxEnrichmentItems;

        return Math.Clamp(configuredValue, 0, MaxAllowedEnrichmentItems);
    }

    private static TmdbCredentials GetCredentials()
    {
        var configuration = Plugin.Instance?.Configuration ?? new PluginConfiguration();

        PtvPluginSettingsNormalizer.Normalize(configuration);

        var readAccessToken = Environment.GetEnvironmentVariable(ReadAccessTokenEnvironmentVariable);
        var apiKey = Environment.GetEnvironmentVariable(ApiKeyEnvironmentVariable);

        if (string.IsNullOrWhiteSpace(readAccessToken))
        {
            readAccessToken = configuration.TmdbSettings.TmdbApiToken ?? configuration.TmdbReadAccessToken;
        }

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            apiKey = configuration.TmdbApiKey;
        }

        return new TmdbCredentials(
            CleanSecret(readAccessToken),
            CleanSecret(apiKey));
    }

    private static string? CleanSecret(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private void TrimFactCache()
    {
        var trimCount = _factCache.Count - MaxFactCacheEntries;

        if (trimCount <= 0)
        {
            return;
        }

        foreach (var key in _factCache.Keys.Take(trimCount))
        {
            _factCache.TryRemove(key, out _);
        }
    }

    private sealed record TmdbCredentials(string? ReadAccessToken, string? ApiKey)
    {
        public bool Configured => !string.IsNullOrWhiteSpace(ReadAccessToken) || !string.IsNullOrWhiteSpace(ApiKey);
    }
}
