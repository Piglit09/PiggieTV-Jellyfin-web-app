using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
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
    private const string V3ApiKeyCredentialType = "v3-api-key";
    private const string V4BearerCredentialType = "v4-bearer";
    private static readonly Regex SensitiveResponsePattern = new(
        "(\"?(?:api[_-]?key|token|authorization)\"?\\s*[:=]\\s*\"?)[^\"&,}\\s]+",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
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
    private string? _credentialStatus;
    private string? _lastErrorBody;
    private int? _lastValidationStatusCode;
    private DateTimeOffset? _lastValidatedAt;

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

        if (!await ValidateCredentialsCoreAsync(credentials, cancellationToken).ConfigureAwait(false))
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
        var isEnabled = IsEnabled();

        return new PtvTmdbMetadataStatus
        {
            CacheHits = Interlocked.Read(ref _cacheHits),
            CacheMisses = Interlocked.Read(ref _cacheMisses),
            CacheSize = _factCache.Count,
            Configured = credentials.Configured,
            CredentialLength = credentials.CredentialLength,
            CredentialStatus = _credentialStatus ?? GetCredentialStatus(isEnabled, credentials.Configured),
            CredentialType = credentials.CredentialType,
            Enabled = isEnabled,
            LastErrorCode = _lastErrorCode,
            LastDurationMs = _lastDurationMs,
            LastError = _lastError,
            LastErrorBody = _lastErrorBody,
            LastStatusCode = _lastValidationStatusCode,
            LastValidatedAt = _lastValidatedAt
        };
    }

    /// <inheritdoc />
    public async Task<PtvTmdbMetadataStatus> ValidateCredentialsAsync(CancellationToken cancellationToken)
    {
        var credentials = GetCredentials();

        if (!IsEnabled())
        {
            _credentialStatus = "disabled";
            _lastError = null;
            _lastErrorCode = null;
            _lastValidationStatusCode = null;
            _lastValidatedAt = DateTimeOffset.UtcNow;
            return GetStatus();
        }

        if (!credentials.Configured)
        {
            _credentialStatus = "missing";
            _lastError = "TMDb metadata is enabled, but no TMDb read access token or API key is configured.";
            _lastErrorCode = "missing-credential";
            _lastValidationStatusCode = null;
            _lastValidatedAt = DateTimeOffset.UtcNow;
            return GetStatus();
        }

        await ValidateCredentialsCoreAsync(credentials, cancellationToken).ConfigureAwait(false);

        return GetStatus();
    }

    private async Task<bool> ValidateCredentialsCoreAsync(
        TmdbCredentials credentials,
        CancellationToken cancellationToken)
    {
        try
        {
            using var message = new HttpRequestMessage(HttpMethod.Get, BuildValidationUrl(credentials));

            ApplyAuthorization(message, credentials);
            message.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            _logger.LogInformation(
                "PiggieTV TMDb credential validation started. CredentialType={CredentialType}; CredentialLength={CredentialLength}.",
                credentials.CredentialType,
                credentials.CredentialLength);

            using var response = await Client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
            _lastValidationStatusCode = (int)response.StatusCode;
            _lastValidatedAt = DateTimeOffset.UtcNow;
            _lastErrorBody = response.IsSuccessStatusCode
                ? null
                : await ReadSanitizedResponseBodyAsync(response.Content, cancellationToken).ConfigureAwait(false);
            _logger.LogInformation(
                "PiggieTV TMDb credential validation returned HTTP {StatusCode}. CredentialType={CredentialType}; CredentialLength={CredentialLength}; ErrorBody={ErrorBody}.",
                (int)response.StatusCode,
                credentials.CredentialType,
                credentials.CredentialLength,
                _lastErrorBody ?? "none");

            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                MarkUnauthorized(_lastErrorBody);
                return false;
            }

            if (!response.IsSuccessStatusCode)
            {
                _lastError = $"TMDb credential validation returned {(int)response.StatusCode}. Metadata enrichment skipped for this refresh.";
                _lastErrorCode = "validation-failed";
                _credentialStatus = "invalid";
                return false;
            }

            _lastError = null;
            _lastErrorCode = null;
            _lastErrorBody = null;
            _credentialStatus = "valid";
            return true;
        }
        catch (OperationCanceledException)
        {
            _lastError = "TMDb credential validation timed out or was canceled. Metadata enrichment skipped for this refresh.";
            _lastErrorCode = "canceled";
            _lastErrorBody = null;
            _credentialStatus = "timeout";
            _lastValidationStatusCode = null;
            _lastValidatedAt = DateTimeOffset.UtcNow;
            return false;
        }
        catch (Exception ex)
        {
            _lastError = $"TMDb credential validation failed: {ex.Message}";
            _lastErrorCode = "validation-failed";
            _lastErrorBody = null;
            _credentialStatus = "error";
            _lastValidationStatusCode = null;
            _lastValidatedAt = DateTimeOffset.UtcNow;
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

        ApplyAuthorization(message, credentials);
        message.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        using var response = await Client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            _lastValidationStatusCode = (int)response.StatusCode;
            _lastErrorBody = await ReadSanitizedResponseBodyAsync(response.Content, cancellationToken).ConfigureAwait(false);
            _logger.LogDebug(
                "PiggieTV TMDb {Endpoint} request returned HTTP {StatusCode}. CredentialType={CredentialType}; CredentialLength={CredentialLength}; ErrorBody={ErrorBody}.",
                request.Endpoint,
                (int)response.StatusCode,
                credentials.CredentialType,
                credentials.CredentialLength,
                _lastErrorBody ?? "none");

            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                MarkUnauthorized(_lastErrorBody);
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

    private void MarkUnauthorized(string? errorBody = null)
    {
        _lastError = "TMDb metadata unauthorized. Check the TMDb v4 Read Access Token or legacy v3 API key.";
        _lastErrorCode = UnauthorizedErrorCode;
        _lastErrorBody = errorBody;
        _credentialStatus = "unauthorized";
    }

    private static string GetCredentialStatus(bool enabled, bool configured)
    {
        if (!enabled) return "disabled";
        if (!configured) return "missing";

        return "unknown";
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

        if (credentials.CredentialType == V3ApiKeyCredentialType && !string.IsNullOrWhiteSpace(credentials.ApiKey))
        {
            query += $"&api_key={Uri.EscapeDataString(credentials.ApiKey)}";
        }

        return new Uri($"https://api.themoviedb.org/3/{request.Endpoint}/{Uri.EscapeDataString(request.TmdbId)}?{query}");
    }

    private static Uri BuildValidationUrl(TmdbCredentials credentials)
    {
        var query = "language=en-US";

        if (credentials.CredentialType == V3ApiKeyCredentialType && !string.IsNullOrWhiteSpace(credentials.ApiKey))
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

        var primaryCredential = CreateCredentials(readAccessToken);

        return primaryCredential.Configured ? primaryCredential : CreateCredentials(apiKey);
    }

    private static string? CleanSecret(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;

        var cleaned = value.Trim();

        if (cleaned.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            cleaned = cleaned[7..].Trim();
        }

        return string.Concat(cleaned.Where(character => !char.IsWhiteSpace(character)));
    }

    private static TmdbCredentials CreateCredentials(string? value)
    {
        var credential = CleanSecret(value);

        if (string.IsNullOrWhiteSpace(credential))
        {
            return TmdbCredentials.Empty;
        }

        if (IsLegacyV3ApiKey(credential))
        {
            return new TmdbCredentials(null, credential, V3ApiKeyCredentialType, credential.Length);
        }

        return new TmdbCredentials(credential, null, V4BearerCredentialType, credential.Length);
    }

    private static bool IsLegacyV3ApiKey(string value)
    {
        return value.Length == 32 && value.All(Uri.IsHexDigit);
    }

    private static void ApplyAuthorization(HttpRequestMessage message, TmdbCredentials credentials)
    {
        if (credentials.CredentialType == V4BearerCredentialType && !string.IsNullOrWhiteSpace(credentials.ReadAccessToken))
        {
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credentials.ReadAccessToken);
        }
    }

    private static async Task<string?> ReadSanitizedResponseBodyAsync(HttpContent content, CancellationToken cancellationToken)
    {
        var body = await content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        return SanitizeResponseBody(body);
    }

    private static string? SanitizeResponseBody(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;

        var sanitized = SensitiveResponsePattern.Replace(body.Trim(), "$1[redacted]");

        return sanitized.Length > 600 ? sanitized[..600] : sanitized;
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

    private sealed record TmdbCredentials(string? ReadAccessToken, string? ApiKey, string CredentialType, int CredentialLength)
    {
        public static TmdbCredentials Empty { get; } = new(null, null, "missing", 0);

        public bool Configured => CredentialLength > 0;
    }
}
