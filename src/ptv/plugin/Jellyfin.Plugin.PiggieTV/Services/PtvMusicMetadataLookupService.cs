using System.Collections;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Server-side MusicBrainz and Discogs lookup client for administrator metadata repair workflows.
/// </summary>
public sealed class PtvMusicMetadataLookupService : IPtvMusicMetadataLookupService
{
    private const int ProviderMinRequestIntervalMs = 1100;
    private const int CacheTtlMinutes = 60;
    private const int MaxCacheEntries = 240;
    private const string MusicBrainzProvider = "musicbrainz";
    private const string DiscogsProvider = "discogs";
    private static readonly string UserAgent = $"PiggieTV/{typeof(PtvMusicMetadataLookupService).Assembly.GetName().Version} (Jellyfin.Plugin.PiggieTV)";
    private static readonly HttpClient Client = new()
    {
        Timeout = TimeSpan.FromSeconds(8)
    };

    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new(StringComparer.OrdinalIgnoreCase);
    private readonly SemaphoreSlim _discogsGate = new(1, 1);
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<PtvMusicMetadataLookupService> _logger;
    private readonly SemaphoreSlim _musicBrainzGate = new(1, 1);
    private DateTimeOffset _lastDiscogsRequestAt = DateTimeOffset.MinValue;
    private DateTimeOffset _lastMusicBrainzRequestAt = DateTimeOffset.MinValue;

    private sealed record CacheEntry(DateTimeOffset ExpiresAt, List<PtvMusicMetadataCandidate> Candidates);

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvMusicMetadataLookupService"/> class.
    /// </summary>
    /// <param name="libraryManager">Jellyfin library manager.</param>
    /// <param name="logger">Logger.</param>
    public PtvMusicMetadataLookupService(
        ILibraryManager libraryManager,
        ILogger<PtvMusicMetadataLookupService> logger)
    {
        _libraryManager = libraryManager;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<PtvMusicMetadataLookupResponse> SearchAsync(
        PtvMusicMetadataLookupRequest request,
        CancellationToken cancellationToken)
    {
        var configuration = GetNormalizedConfiguration();
        var settings = configuration.MusicMetadataSettings;
        var response = new PtvMusicMetadataLookupResponse();
        var query = HydrateLookupTerms(request, response);
        var limit = Math.Clamp(
            query.Limit ?? settings.MaxResults,
            PtvPluginSettingsNormalizer.MinMusicMetadataResults,
            PtvPluginSettingsNormalizer.MaxMusicMetadataResults);

        response.Title = query.Title;
        response.Artist = query.Artist;
        response.Album = query.Album;
        response.Year = query.Year;

        if (!HasLookupTerms(query))
        {
            response.Ok = false;
            response.Diagnostics.Add("Lookup skipped because no title, artist, or album terms were available.");
            response.Providers.Add(CreateProviderStatus(MusicBrainzProvider, settings.MusicBrainzEnabled));
            response.Providers.Add(CreateProviderStatus(DiscogsProvider, settings.DiscogsEnabled, !string.IsNullOrWhiteSpace(settings.DiscogsToken)));
            return response;
        }

        if (settings.MusicBrainzEnabled)
        {
            var providerStatus = CreateProviderStatus(MusicBrainzProvider, enabled: true);
            response.Providers.Add(providerStatus);
            response.Candidates.AddRange(await GetProviderCandidatesAsync(
                MusicBrainzProvider,
                query,
                limit,
                providerStatus,
                () => SearchMusicBrainzAsync(query, limit, providerStatus, cancellationToken)).ConfigureAwait(false));
        }
        else
        {
            response.Diagnostics.Add("MusicBrainz lookup is disabled in PiggieTV music metadata settings.");
            response.Providers.Add(CreateProviderStatus(MusicBrainzProvider, enabled: false));
        }

        var discogsConfigured = !string.IsNullOrWhiteSpace(settings.DiscogsToken);
        if (settings.DiscogsEnabled && discogsConfigured)
        {
            var providerStatus = CreateProviderStatus(DiscogsProvider, enabled: true, configured: true);
            response.Providers.Add(providerStatus);
            response.Candidates.AddRange(await GetProviderCandidatesAsync(
                DiscogsProvider,
                query,
                limit,
                providerStatus,
                () => SearchDiscogsAsync(query, settings.DiscogsToken!, limit, providerStatus, cancellationToken)).ConfigureAwait(false));
        }
        else
        {
            var providerStatus = CreateProviderStatus(DiscogsProvider, settings.DiscogsEnabled, discogsConfigured);

            if (!settings.DiscogsEnabled)
            {
                providerStatus.Error = "Discogs lookup is disabled in PiggieTV music metadata settings.";
            }
            else
            {
                providerStatus.Error = "Discogs lookup requires a Discogs personal access token saved in PiggieTV settings.";
            }

            response.Diagnostics.Add(providerStatus.Error);
            response.Providers.Add(providerStatus);
        }

        response.Candidates = response.Candidates
            .OrderByDescending(candidate => candidate.Confidence)
            .ThenBy(candidate => candidate.Provider, StringComparer.OrdinalIgnoreCase)
            .Take(limit * 2)
            .ToList();
        response.Ok = true;

        return response;
    }

    private async Task<List<PtvMusicMetadataCandidate>> GetProviderCandidatesAsync(
        string provider,
        PtvMusicMetadataLookupRequest query,
        int limit,
        PtvMusicMetadataProviderStatus providerStatus,
        Func<Task<List<PtvMusicMetadataCandidate>>> fetch)
    {
        var cacheKey = BuildCacheKey(provider, query, limit);

        if (_cache.TryGetValue(cacheKey, out var entry) && entry.ExpiresAt > DateTimeOffset.UtcNow)
        {
            providerStatus.Cached = true;
            providerStatus.CandidateCount = entry.Candidates.Count;
            return CloneCandidates(entry.Candidates);
        }

        try
        {
            var candidates = await fetch().ConfigureAwait(false);

            providerStatus.CandidateCount = candidates.Count;
            SetCached(cacheKey, candidates);
            return candidates;
        }
        catch (OperationCanceledException)
        {
            providerStatus.Error = $"{provider} lookup timed out or was canceled.";
            return [];
        }
        catch (Exception ex)
        {
            providerStatus.Error = ex.Message;
            _logger.LogDebug(ex, "PiggieTV music metadata lookup failed for provider {Provider}.", provider);
            return [];
        }
    }

    private async Task<List<PtvMusicMetadataCandidate>> SearchMusicBrainzAsync(
        PtvMusicMetadataLookupRequest query,
        int limit,
        PtvMusicMetadataProviderStatus providerStatus,
        CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        var url = BuildUrl(
            "https://musicbrainz.org/ws/2/recording",
            new Dictionary<string, string?>
            {
                ["query"] = BuildMusicBrainzQuery(query),
                ["limit"] = limit.ToString(CultureInfo.InvariantCulture),
                ["fmt"] = "json"
            });

        using var message = new HttpRequestMessage(HttpMethod.Get, url);
        ApplyCommonHeaders(message);

        using var response = await SendProviderRequestAsync(MusicBrainzProvider, message, cancellationToken).ConfigureAwait(false);
        providerStatus.StatusCode = (int)response.StatusCode;
        providerStatus.DurationMs = stopwatch.ElapsedMilliseconds;

        if (!response.IsSuccessStatusCode)
        {
            providerStatus.Error = $"MusicBrainz returned HTTP {(int)response.StatusCode}.";
            return [];
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);

        return document.RootElement.TryGetProperty("recordings", out var recordings) && recordings.ValueKind == JsonValueKind.Array
            ? recordings.EnumerateArray().Select(BuildMusicBrainzCandidate).Where(candidate => candidate is not null).Select(candidate => candidate!).Take(limit).ToList()
            : [];
    }

    private async Task<List<PtvMusicMetadataCandidate>> SearchDiscogsAsync(
        PtvMusicMetadataLookupRequest query,
        string token,
        int limit,
        PtvMusicMetadataProviderStatus providerStatus,
        CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        var url = BuildUrl(
            "https://api.discogs.com/database/search",
            new Dictionary<string, string?>
            {
                ["type"] = "release",
                ["q"] = string.Join(" ", new[] { query.Artist, query.Album, query.Title }.Where(value => !string.IsNullOrWhiteSpace(value))),
                ["artist"] = query.Artist,
                ["track"] = query.Title,
                ["release_title"] = query.Album,
                ["year"] = query.Year?.ToString(CultureInfo.InvariantCulture),
                ["per_page"] = limit.ToString(CultureInfo.InvariantCulture)
            });

        using var message = new HttpRequestMessage(HttpMethod.Get, url);
        ApplyCommonHeaders(message);
        message.Headers.TryAddWithoutValidation("Authorization", $"Discogs token={token}");

        using var response = await SendProviderRequestAsync(DiscogsProvider, message, cancellationToken).ConfigureAwait(false);
        providerStatus.StatusCode = (int)response.StatusCode;
        providerStatus.DurationMs = stopwatch.ElapsedMilliseconds;

        if (!response.IsSuccessStatusCode)
        {
            providerStatus.Error = $"Discogs returned HTTP {(int)response.StatusCode}.";
            return [];
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);

        return document.RootElement.TryGetProperty("results", out var results) && results.ValueKind == JsonValueKind.Array
            ? results.EnumerateArray().Select(result => BuildDiscogsCandidate(result, query)).Where(candidate => candidate is not null).Select(candidate => candidate!).Take(limit).ToList()
            : [];
    }

    private async Task<HttpResponseMessage> SendProviderRequestAsync(
        string provider,
        HttpRequestMessage message,
        CancellationToken cancellationToken)
    {
        var gate = string.Equals(provider, DiscogsProvider, StringComparison.OrdinalIgnoreCase)
            ? _discogsGate
            : _musicBrainzGate;

        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            var now = DateTimeOffset.UtcNow;
            var lastRequestAt = string.Equals(provider, DiscogsProvider, StringComparison.OrdinalIgnoreCase)
                ? _lastDiscogsRequestAt
                : _lastMusicBrainzRequestAt;
            var waitMs = ProviderMinRequestIntervalMs - (int)(now - lastRequestAt).TotalMilliseconds;

            if (waitMs > 0)
            {
                await Task.Delay(waitMs, cancellationToken).ConfigureAwait(false);
            }

            if (string.Equals(provider, DiscogsProvider, StringComparison.OrdinalIgnoreCase))
            {
                _lastDiscogsRequestAt = DateTimeOffset.UtcNow;
            }
            else
            {
                _lastMusicBrainzRequestAt = DateTimeOffset.UtcNow;
            }

            return await Client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
    }

    private PtvMusicMetadataLookupRequest HydrateLookupTerms(
        PtvMusicMetadataLookupRequest request,
        PtvMusicMetadataLookupResponse response)
    {
        var query = new PtvMusicMetadataLookupRequest
        {
            Album = CleanLookupText(request.Album),
            Artist = CleanLookupText(request.Artist),
            ItemId = CleanLookupText(request.ItemId),
            Limit = request.Limit,
            Title = CleanLookupText(request.Title),
            Year = request.Year
        };

        if (string.IsNullOrWhiteSpace(query.ItemId))
        {
            return query;
        }

        response.ItemId = query.ItemId;

        if (!TryParseItemId(query.ItemId, out var itemId))
        {
            response.Diagnostics.Add("Jellyfin item id could not be parsed, so only explicit query terms were used.");
            return query;
        }

        var item = _libraryManager.GetItemById(itemId);

        if (item is null)
        {
            response.Diagnostics.Add("Jellyfin item was not found, so only explicit query terms were used.");
            return query;
        }

        response.ItemName = item.Name;
        query.Title = CleanLookupText(query.Title) ?? CleanLookupText(ReadStringProperty(item, "Name"));
        query.Album = CleanLookupText(query.Album)
            ?? CleanLookupText(ReadStringProperty(item, "Album"))
            ?? CleanLookupText(ReadStringProperty(item, "AlbumName"));
        query.Artist = CleanLookupText(query.Artist) ?? GetArtistName(item);
        query.Year ??= ReadIntProperty(item, "ProductionYear");

        var providerIds = ReadProviderIds(item);

        if (providerIds.Count > 0)
        {
            response.Diagnostics.Add($"Existing provider ids: {string.Join(", ", providerIds.Keys.OrderBy(key => key, StringComparer.OrdinalIgnoreCase))}");
        }

        return query;
    }

    private static PtvMusicMetadataCandidate? BuildMusicBrainzCandidate(JsonElement recording)
    {
        var recordingId = ReadString(recording, "id");

        if (string.IsNullOrWhiteSpace(recordingId))
        {
            return null;
        }

        var releases = ReadArray(recording, "releases");
        var release = releases.FirstOrDefault();
        var artistNames = ReadMusicBrainzArtistNames(recording);
        var releaseGroup = ReadObject(release, "release-group");
        var releaseDate = ReadString(release, "date") ?? ReadString(recording, "first-release-date");
        var title = ReadString(recording, "title");
        var album = ReadString(release, "title");
        var candidate = new PtvMusicMetadataCandidate
        {
            Album = album,
            Artist = string.Join(", ", artistNames),
            Confidence = ReadDouble(recording, "score") ?? 0,
            Genres = CleanStringList(ReadTagNames(recording, "genres").Concat(ReadTagNames(releaseGroup, "genres"))),
            Provider = MusicBrainzProvider,
            Tags = CleanStringList(ReadTagNames(recording, "tags").Concat(ReadTagNames(releaseGroup, "tags"))),
            Title = title,
            Url = $"https://musicbrainz.org/recording/{recordingId}",
            Year = ParseYear(releaseDate)
        };

        candidate.ProviderIds["MusicBrainzRecording"] = recordingId;

        var releaseId = ReadString(release, "id");
        var releaseGroupId = ReadString(releaseGroup, "id");

        if (!string.IsNullOrWhiteSpace(releaseId))
        {
            candidate.ProviderIds["MusicBrainzRelease"] = releaseId;
        }

        if (!string.IsNullOrWhiteSpace(releaseGroupId))
        {
            candidate.ProviderIds["MusicBrainzReleaseGroup"] = releaseGroupId;
        }

        candidate.Summary = BuildCandidateSummary(candidate);
        return candidate;
    }

    private static PtvMusicMetadataCandidate? BuildDiscogsCandidate(JsonElement result, PtvMusicMetadataLookupRequest query)
    {
        var releaseId = ReadString(result, "id");

        if (string.IsNullOrWhiteSpace(releaseId))
        {
            return null;
        }

        var title = ReadString(result, "title");
        var parts = SplitDiscogsTitle(title);
        var masterId = ReadString(result, "master_id");
        var candidate = new PtvMusicMetadataCandidate
        {
            Album = parts.ReleaseTitle ?? query.Album ?? title,
            Artist = parts.Artist ?? query.Artist,
            Confidence = ScoreDiscogsCandidate(result, query),
            Genres = CleanStringList(ReadStringArray(result, "genre")),
            Labels = CleanStringList(ReadStringArray(result, "label")),
            Provider = DiscogsProvider,
            Styles = CleanStringList(ReadStringArray(result, "style")),
            Tags = CleanStringList(ReadStringArray(result, "genre").Concat(ReadStringArray(result, "style")).Concat(ReadStringArray(result, "label"))),
            Title = query.Title,
            Url = $"https://www.discogs.com/release/{releaseId}",
            Year = ReadInt(result, "year")
        };

        candidate.ProviderIds["DiscogsRelease"] = releaseId;

        if (!string.IsNullOrWhiteSpace(masterId) && masterId != "0")
        {
            candidate.ProviderIds["DiscogsMaster"] = masterId;
        }

        candidate.Summary = BuildCandidateSummary(candidate);
        return candidate;
    }

    private static double ScoreDiscogsCandidate(JsonElement result, PtvMusicMetadataLookupRequest query)
    {
        var title = ReadString(result, "title") ?? string.Empty;
        var score = 45d;

        if (!string.IsNullOrWhiteSpace(query.Artist) && title.Contains(query.Artist, StringComparison.OrdinalIgnoreCase))
        {
            score += 20;
        }

        if (!string.IsNullOrWhiteSpace(query.Album) && title.Contains(query.Album, StringComparison.OrdinalIgnoreCase))
        {
            score += 20;
        }

        if (query.Year is not null && ReadInt(result, "year") == query.Year)
        {
            score += 10;
        }

        return Math.Min(100, score);
    }

    private static string BuildMusicBrainzQuery(PtvMusicMetadataLookupRequest query)
    {
        var parts = new List<string>();

        if (!string.IsNullOrWhiteSpace(query.Title))
        {
            parts.Add($"recording:\"{EscapeMusicBrainzQuery(query.Title)}\"");
        }

        if (!string.IsNullOrWhiteSpace(query.Artist))
        {
            parts.Add($"artist:\"{EscapeMusicBrainzQuery(query.Artist.Split(',')[0].Trim())}\"");
        }

        if (!string.IsNullOrWhiteSpace(query.Album))
        {
            parts.Add($"release:\"{EscapeMusicBrainzQuery(query.Album)}\"");
        }

        if (query.Year is not null)
        {
            parts.Add($"date:{query.Year.Value.ToString(CultureInfo.InvariantCulture)}");
        }

        return parts.Count > 0 ? string.Join(" AND ", parts) : "*";
    }

    private static string BuildUrl(string baseUrl, IReadOnlyDictionary<string, string?> parameters)
    {
        var query = parameters
            .Where(pair => !string.IsNullOrWhiteSpace(pair.Value))
            .Select(pair => $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value!)}");

        return $"{baseUrl}?{string.Join("&", query)}";
    }

    private static void ApplyCommonHeaders(HttpRequestMessage message)
    {
        message.Headers.TryAddWithoutValidation("Accept", "application/json");
        message.Headers.TryAddWithoutValidation("User-Agent", UserAgent);
    }

    private static PtvMusicMetadataProviderStatus CreateProviderStatus(
        string provider,
        bool enabled,
        bool configured = true)
    {
        return new PtvMusicMetadataProviderStatus
        {
            Configured = configured,
            Enabled = enabled,
            Provider = provider
        };
    }

    private void SetCached(string cacheKey, List<PtvMusicMetadataCandidate> candidates)
    {
        _cache[cacheKey] = new CacheEntry(DateTimeOffset.UtcNow.AddMinutes(CacheTtlMinutes), CloneCandidates(candidates));

        if (_cache.Count <= MaxCacheEntries)
        {
            return;
        }

        foreach (var key in _cache
                     .OrderBy(pair => pair.Value.ExpiresAt)
                     .Take(Math.Max(1, _cache.Count - MaxCacheEntries))
                     .Select(pair => pair.Key))
        {
            _cache.TryRemove(key, out _);
        }
    }

    private static List<PtvMusicMetadataCandidate> CloneCandidates(IEnumerable<PtvMusicMetadataCandidate> candidates)
    {
        return candidates.Select(candidate => new PtvMusicMetadataCandidate
        {
            Album = candidate.Album,
            Artist = candidate.Artist,
            Confidence = candidate.Confidence,
            Genres = [.. candidate.Genres],
            Labels = [.. candidate.Labels],
            Provider = candidate.Provider,
            ProviderIds = new Dictionary<string, string>(candidate.ProviderIds, StringComparer.OrdinalIgnoreCase),
            Styles = [.. candidate.Styles],
            Summary = candidate.Summary,
            Tags = [.. candidate.Tags],
            Title = candidate.Title,
            Url = candidate.Url,
            Year = candidate.Year
        }).ToList();
    }

    private static string BuildCacheKey(string provider, PtvMusicMetadataLookupRequest query, int limit)
    {
        return string.Join(
            "|",
            provider,
            NormalizeCacheTerm(query.Title),
            NormalizeCacheTerm(query.Artist),
            NormalizeCacheTerm(query.Album),
            query.Year?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            limit.ToString(CultureInfo.InvariantCulture));
    }

    private static bool HasLookupTerms(PtvMusicMetadataLookupRequest query)
    {
        return !string.IsNullOrWhiteSpace(query.Title)
            || !string.IsNullOrWhiteSpace(query.Artist)
            || !string.IsNullOrWhiteSpace(query.Album);
    }

    private static PluginConfiguration GetNormalizedConfiguration()
    {
        var configuration = Plugin.Instance?.Configuration ?? new PluginConfiguration();

        return PtvPluginSettingsNormalizer.Normalize(configuration);
    }

    private static bool TryParseItemId(string value, out Guid itemId)
    {
        var normalized = value.Trim();

        return Guid.TryParse(normalized, out itemId)
            || Guid.TryParseExact(normalized, "N", out itemId);
    }

    private static string? GetArtistName(BaseItem item)
    {
        return CleanLookupText(ReadStringProperty(item, "Artist"))
            ?? CleanLookupText(string.Join(", ", ReadStringListProperty(item, "Artists")))
            ?? CleanLookupText(string.Join(", ", ReadObjectNameListProperty(item, "ArtistItems")))
            ?? CleanLookupText(ReadStringProperty(item, "AlbumArtist"))
            ?? CleanLookupText(string.Join(", ", ReadObjectNameListProperty(item, "AlbumArtists")));
    }

    private static string? ReadStringProperty(object target, string propertyName)
    {
        return ReadProperty(target, propertyName) switch
        {
            string value => value,
            IConvertible value => Convert.ToString(value, CultureInfo.InvariantCulture),
            _ => null
        };
    }

    private static int? ReadIntProperty(object target, string propertyName)
    {
        var value = ReadProperty(target, propertyName);

        if (value is int intValue) return intValue;
        if (value is IConvertible convertible && int.TryParse(Convert.ToString(convertible, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }

        return null;
    }

    private static object? ReadProperty(object target, string propertyName)
    {
        return target.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)?.GetValue(target);
    }

    private static List<string> ReadStringListProperty(object target, string propertyName)
    {
        return ReadProperty(target, propertyName) switch
        {
            IEnumerable<string> values => CleanStringList(values),
            IEnumerable values => CleanStringList(values.Cast<object>().Select(value => Convert.ToString(value, CultureInfo.InvariantCulture))),
            _ => []
        };
    }

    private static List<string> ReadObjectNameListProperty(object target, string propertyName)
    {
        var value = ReadProperty(target, propertyName);

        if (value is not IEnumerable values || value is string)
        {
            return [];
        }

        return CleanStringList(values.Cast<object>().Select(item => ReadStringProperty(item, "Name")));
    }

    private static Dictionary<string, string> ReadProviderIds(BaseItem item)
    {
        var value = ReadProperty(item, "ProviderIds");
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (value is not IEnumerable values)
        {
            return result;
        }

        foreach (var entry in values)
        {
            var key = ReadStringProperty(entry, "Key");
            var providerValue = ReadStringProperty(entry, "Value");

            if (!string.IsNullOrWhiteSpace(key) && !string.IsNullOrWhiteSpace(providerValue))
            {
                result[key] = providerValue;
            }
        }

        return result;
    }

    private static IEnumerable<JsonElement> ReadArray(JsonElement element, string propertyName)
    {
        return element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty(propertyName, out var property)
            && property.ValueKind == JsonValueKind.Array
                ? property.EnumerateArray()
                : [];
    }

    private static JsonElement ReadObject(JsonElement element, string propertyName)
    {
        return element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty(propertyName, out var property)
            && property.ValueKind == JsonValueKind.Object
                ? property
                : default;
    }

    private static string? ReadString(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        return property.ValueKind switch
        {
            JsonValueKind.String => property.GetString(),
            JsonValueKind.Number => property.GetRawText(),
            _ => null
        };
    }

    private static int? ReadInt(JsonElement element, string propertyName)
    {
        var value = ReadString(element, propertyName);

        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedValue)
            ? parsedValue
            : null;
    }

    private static double? ReadDouble(JsonElement element, string propertyName)
    {
        var value = ReadString(element, propertyName);

        return double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedValue)
            ? parsedValue
            : null;
    }

    private static List<string> ReadStringArray(JsonElement element, string propertyName)
    {
        return CleanStringList(ReadArray(element, propertyName).Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.GetRawText()));
    }

    private static List<string> ReadTagNames(JsonElement element, string propertyName)
    {
        return CleanStringList(ReadArray(element, propertyName).Select(tag => ReadString(tag, "name")));
    }

    private static List<string> ReadMusicBrainzArtistNames(JsonElement recording)
    {
        return CleanStringList(ReadArray(recording, "artist-credit")
            .Select(credit => ReadString(credit, "name") ?? ReadString(ReadObject(credit, "artist"), "name")));
    }

    private static List<string> CleanStringList(IEnumerable<string?> values)
    {
        return values
            .Select(CleanLookupText)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(24)
            .ToList();
    }

    private static string? CleanLookupText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var cleaned = value.Trim();

        return cleaned.Length > 180 ? cleaned[..180] : cleaned;
    }

    private static string NormalizeCacheTerm(string? value)
    {
        return (CleanLookupText(value) ?? string.Empty).ToLowerInvariant();
    }

    private static string EscapeMusicBrainzQuery(string value)
    {
        return value
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("\"", "\\\"", StringComparison.Ordinal);
    }

    private static int? ParseYear(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length < 4)
        {
            return null;
        }

        return int.TryParse(value[..4], NumberStyles.Integer, CultureInfo.InvariantCulture, out var year)
            ? year
            : null;
    }

    private static (string? Artist, string? ReleaseTitle) SplitDiscogsTitle(string? title)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            return (null, null);
        }

        var parts = title.Split(" - ", 2, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

        return parts.Length == 2
            ? (CleanDiscogsName(parts[0]), CleanLookupText(parts[1]))
            : (null, CleanLookupText(title));
    }

    private static string? CleanDiscogsName(string? value)
    {
        var cleaned = CleanLookupText(value);

        if (string.IsNullOrWhiteSpace(cleaned))
        {
            return null;
        }

        while (cleaned.EndsWith(")", StringComparison.Ordinal) && cleaned.LastIndexOf(" (", StringComparison.Ordinal) > 0)
        {
            var suffixStart = cleaned.LastIndexOf(" (", StringComparison.Ordinal);
            var suffix = cleaned[suffixStart..];

            if (suffix.Length > 2 && suffix.Skip(2).Take(suffix.Length - 3).All(char.IsDigit))
            {
                cleaned = cleaned[..suffixStart].Trim();
                continue;
            }

            break;
        }

        return cleaned;
    }

    private static string BuildCandidateSummary(PtvMusicMetadataCandidate candidate)
    {
        var summary = new StringBuilder();

        if (!string.IsNullOrWhiteSpace(candidate.Artist))
        {
            summary.Append(candidate.Artist);
        }

        if (!string.IsNullOrWhiteSpace(candidate.Title))
        {
            if (summary.Length > 0) summary.Append(" - ");
            summary.Append(candidate.Title);
        }

        if (!string.IsNullOrWhiteSpace(candidate.Album))
        {
            if (summary.Length > 0) summary.Append(" | ");
            summary.Append(candidate.Album);
        }

        if (candidate.Year is not null)
        {
            if (summary.Length > 0) summary.Append(" | ");
            summary.Append(candidate.Year.Value.ToString(CultureInfo.InvariantCulture));
        }

        return summary.ToString();
    }
}
