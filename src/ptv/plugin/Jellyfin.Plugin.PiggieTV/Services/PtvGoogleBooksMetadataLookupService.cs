using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Native server-side Google Books metadata lookup for reading items.
/// </summary>
public sealed partial class PtvGoogleBooksMetadataLookupService : IPtvGoogleBooksMetadataLookupService
{
    private static readonly HttpClient HttpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(8)
    };

    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(45);
    private static readonly ConcurrentDictionary<string, CacheEntry> Cache = new(StringComparer.OrdinalIgnoreCase);
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<PtvGoogleBooksMetadataLookupService> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvGoogleBooksMetadataLookupService"/> class.
    /// </summary>
    /// <param name="logger">Logger.</param>
    /// <param name="libraryManager">Jellyfin library manager.</param>
    public PtvGoogleBooksMetadataLookupService(
        ILogger<PtvGoogleBooksMetadataLookupService> logger,
        ILibraryManager libraryManager)
    {
        _logger = logger;
        _libraryManager = libraryManager;
    }

    /// <inheritdoc />
    public async Task<PtvGoogleBooksMetadataLookupResponse> SearchAsync(
        PtvGoogleBooksMetadataLookupRequest request,
        CancellationToken cancellationToken)
    {
        var configuration = GetConfiguration();
        var settings = configuration.GoogleBooksSettings;
        var response = new PtvGoogleBooksMetadataLookupResponse
        {
            Provider =
            {
                Enabled = settings.GoogleBooksEnabled,
                Configured = HasApiKey(configuration)
            }
        };

        if (!settings.GoogleBooksEnabled)
        {
            response.Diagnostics.Add("Google Books lookup is disabled.");
            return response;
        }

        HydrateRequestFromItem(request);

        var volumeId = CleanText(request.GoogleBooksId, 128);
        var query = BuildQuery(request);
        if (string.IsNullOrWhiteSpace(volumeId) && string.IsNullOrWhiteSpace(query))
        {
            response.Provider.Error = "title-or-isbn-required";
            response.Diagnostics.Add("No title, ISBN, or Google Books id was provided.");
            return response;
        }

        var limit = Math.Clamp(
            request.Limit ?? settings.MaxResults,
            PtvPluginSettingsNormalizer.MinGoogleBooksMetadataResults,
            PtvPluginSettingsNormalizer.MaxGoogleBooksMetadataResults);
        var cacheKey = $"{volumeId}|{query}|{request.Author}|{request.Year}|{limit}".ToLowerInvariant();

        if (Cache.TryGetValue(cacheKey, out var cachedEntry)
            && DateTimeOffset.UtcNow - cachedEntry.CreatedAtUtc < CacheTtl)
        {
            response.Ok = true;
            response.Provider.Cached = true;
            response.Provider.CandidateCount = cachedEntry.Candidates.Count;
            response.Candidates = cachedEntry.Candidates;
            response.Diagnostics.Add("served-from-google-books-cache");
            return response;
        }

        var stopwatch = Stopwatch.StartNew();
        try
        {
            using var httpResponse = string.IsNullOrWhiteSpace(volumeId)
                ? await HttpClient.GetAsync(BuildSearchUrl(configuration, query, limit), cancellationToken).ConfigureAwait(false)
                : await HttpClient.GetAsync(BuildVolumeUrl(configuration, volumeId), cancellationToken).ConfigureAwait(false);

            response.Provider.StatusCode = (int)httpResponse.StatusCode;
            var payload = await httpResponse.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

            if (!httpResponse.IsSuccessStatusCode)
            {
                response.Provider.Error = $"google-books-http-{(int)httpResponse.StatusCode}";
                response.Diagnostics.Add($"Google Books returned HTTP {(int)httpResponse.StatusCode}.");
                _logger.LogWarning(
                    "Google Books lookup failed. StatusCode={StatusCode}; Query={Query}; VolumeId={VolumeId}.",
                    (int)httpResponse.StatusCode,
                    query,
                    volumeId);
                return response;
            }

            response.Candidates = string.IsNullOrWhiteSpace(volumeId)
                ? ParseSearchPayload(payload, request)
                : ParseVolumePayload(payload, request);
            response.Candidates = response.Candidates
                .OrderByDescending(candidate => candidate.Confidence)
                .ThenBy(candidate => candidate.Name, StringComparer.OrdinalIgnoreCase)
                .Take(limit)
                .ToList();
            response.Ok = true;
            response.Provider.CandidateCount = response.Candidates.Count;
            response.Diagnostics.Add($"google-books-query={query}");
            Cache[cacheKey] = new CacheEntry(DateTimeOffset.UtcNow, response.Candidates);
            TrimCache();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            response.Provider.Error = "cancelled";
            response.Diagnostics.Add("Lookup was cancelled.");
            throw;
        }
        catch (Exception ex)
        {
            response.Provider.Error = ex.GetType().Name;
            response.Diagnostics.Add($"Google Books lookup failed: {ex.Message}");
            _logger.LogWarning(ex, "Google Books lookup failed. Query={Query}; VolumeId={VolumeId}.", query, volumeId);
        }
        finally
        {
            stopwatch.Stop();
            response.Provider.DurationMs = stopwatch.ElapsedMilliseconds;
        }

        return response;
    }

    private static PluginConfiguration GetConfiguration()
    {
        var configuration = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        return PtvPluginSettingsNormalizer.Normalize(configuration);
    }

    private static bool HasApiKey(PluginConfiguration configuration)
    {
        return !string.IsNullOrWhiteSpace(GetApiKey(configuration));
    }

    private static string? GetApiKey(PluginConfiguration configuration)
    {
        return !string.IsNullOrWhiteSpace(configuration.GoogleBooksSettings.GoogleBooksApiKey)
            ? configuration.GoogleBooksSettings.GoogleBooksApiKey
            : Environment.GetEnvironmentVariable("PTV_GOOGLE_BOOKS_API_KEY");
    }

    private static string BuildSearchUrl(PluginConfiguration configuration, string query, int limit)
    {
        var url = $"https://www.googleapis.com/books/v1/volumes?q={Uri.EscapeDataString(query)}&maxResults={limit.ToString(CultureInfo.InvariantCulture)}&printType=books&projection=full";
        var apiKey = GetApiKey(configuration);
        return string.IsNullOrWhiteSpace(apiKey) ? url : $"{url}&key={Uri.EscapeDataString(apiKey)}";
    }

    private static string BuildVolumeUrl(PluginConfiguration configuration, string volumeId)
    {
        var url = $"https://www.googleapis.com/books/v1/volumes/{Uri.EscapeDataString(volumeId)}";
        var apiKey = GetApiKey(configuration);
        return string.IsNullOrWhiteSpace(apiKey) ? url : $"{url}?key={Uri.EscapeDataString(apiKey)}";
    }

    private void HydrateRequestFromItem(PtvGoogleBooksMetadataLookupRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.ItemId) || !Guid.TryParse(request.ItemId, out var itemGuid))
        {
            return;
        }

        try
        {
            var item = _libraryManager.GetItemById(itemGuid);
            if (item is null)
            {
                return;
            }

            request.Title = string.IsNullOrWhiteSpace(request.Title) ? item.Name : request.Title;
            request.Year ??= item.ProductionYear;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Unable to hydrate Google Books lookup from Jellyfin item {ItemId}.", request.ItemId);
        }
    }

    private static string BuildQuery(PtvGoogleBooksMetadataLookupRequest request)
    {
        var isbn = CleanIsbn(request.Isbn);
        if (!string.IsNullOrWhiteSpace(isbn))
        {
            return $"isbn:{isbn}";
        }

        var title = CleanText(request.Title, 180);
        var author = CleanText(request.Author, 120);

        if (string.IsNullOrWhiteSpace(title))
        {
            return string.Empty;
        }

        return string.IsNullOrWhiteSpace(author)
            ? $"intitle:{title}"
            : $"intitle:{title} inauthor:{author}";
    }

    private static List<PtvGoogleBooksMetadataCandidate> ParseSearchPayload(
        string payload,
        PtvGoogleBooksMetadataLookupRequest request)
    {
        using var document = JsonDocument.Parse(payload);
        if (!document.RootElement.TryGetProperty("items", out var items)
            || items.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return items.EnumerateArray()
            .Select(item => CreateCandidate(item, request))
            .Where(candidate => !string.IsNullOrWhiteSpace(candidate.Name))
            .ToList();
    }

    private static List<PtvGoogleBooksMetadataCandidate> ParseVolumePayload(
        string payload,
        PtvGoogleBooksMetadataLookupRequest request)
    {
        using var document = JsonDocument.Parse(payload);
        var candidate = CreateCandidate(document.RootElement, request);
        return string.IsNullOrWhiteSpace(candidate.Name) ? [] : [candidate];
    }

    private static PtvGoogleBooksMetadataCandidate CreateCandidate(
        JsonElement item,
        PtvGoogleBooksMetadataLookupRequest request)
    {
        item.TryGetProperty("volumeInfo", out var volume);
        var id = GetString(item, "id");
        var title = GetString(volume, "title");
        var subtitle = GetString(volume, "subtitle");
        var authors = GetStringArray(volume, "authors");
        var categories = GetStringArray(volume, "categories");
        var publisher = GetString(volume, "publisher");
        var publishedDate = GetString(volume, "publishedDate");
        var year = GetYear(publishedDate);
        var imageUrl = GetImageUrl(volume);
        var canonicalUrl = GetString(volume, "canonicalVolumeLink") ?? GetString(volume, "infoLink");
        var candidate = new PtvGoogleBooksMetadataCandidate
        {
            Authors = authors,
            Confidence = ScoreCandidate(title, authors, year, imageUrl, request),
            Genres = categories,
            ImageUrl = imageUrl,
            Language = GetString(volume, "language"),
            MatchReason = BuildMatchReason(title, authors, year, request),
            Name = CombineTitle(title, subtitle),
            OriginalTitle = title,
            Overview = CleanHtml(GetString(volume, "description")),
            PageCount = GetInt(volume, "pageCount"),
            PremiereDate = NormalizeDate(publishedDate),
            ProductionYear = year,
            Publisher = publisher,
            Tags = categories,
            Url = canonicalUrl
        };

        if (!string.IsNullOrWhiteSpace(id))
        {
            candidate.ProviderIds["GoogleBooks"] = id;
        }

        AddIndustryIdentifiers(candidate, volume);

        candidate.People = authors
            .Select(author => new PtvGoogleBooksPerson { Name = author, Type = "Author" })
            .ToList();

        if (!string.IsNullOrWhiteSpace(publisher))
        {
            candidate.Studios.Add(new PtvGoogleBooksNamedValue { Name = publisher });
        }

        return candidate;
    }

    private static void AddIndustryIdentifiers(PtvGoogleBooksMetadataCandidate candidate, JsonElement volume)
    {
        if (!volume.TryGetProperty("industryIdentifiers", out var identifiers)
            || identifiers.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var identifier in identifiers.EnumerateArray())
        {
            var type = GetString(identifier, "type");
            var value = CleanIsbn(GetString(identifier, "identifier"));

            if (string.IsNullOrWhiteSpace(type) || string.IsNullOrWhiteSpace(value))
            {
                continue;
            }

            if (type.Equals("ISBN_13", StringComparison.OrdinalIgnoreCase))
            {
                candidate.ProviderIds["ISBN"] = value;
                candidate.ProviderIds["ISBN13"] = value;
            }
            else if (type.Equals("ISBN_10", StringComparison.OrdinalIgnoreCase))
            {
                candidate.ProviderIds.TryAdd("ISBN", value);
                candidate.ProviderIds["ISBN10"] = value;
            }
        }
    }

    private static double ScoreCandidate(
        string? title,
        IReadOnlyCollection<string> authors,
        int? year,
        string? imageUrl,
        PtvGoogleBooksMetadataLookupRequest request)
    {
        var score = 35d;
        var requestTitle = CleanText(request.Title, 180);
        if (!string.IsNullOrWhiteSpace(requestTitle) && !string.IsNullOrWhiteSpace(title))
        {
            var normalizedTitle = NormalizeForCompare(title);
            var normalizedRequest = NormalizeForCompare(requestTitle);
            if (normalizedTitle.Equals(normalizedRequest, StringComparison.OrdinalIgnoreCase))
            {
                score += 32;
            }
            else if (normalizedTitle.Contains(normalizedRequest, StringComparison.OrdinalIgnoreCase)
                || normalizedRequest.Contains(normalizedTitle, StringComparison.OrdinalIgnoreCase))
            {
                score += 18;
            }
        }

        var requestAuthor = NormalizeForCompare(request.Author);
        if (!string.IsNullOrWhiteSpace(requestAuthor)
            && authors.Any(author => NormalizeForCompare(author).Contains(requestAuthor, StringComparison.OrdinalIgnoreCase)))
        {
            score += 16;
        }

        if (request.Year is not null && year == request.Year)
        {
            score += 10;
        }

        if (!string.IsNullOrWhiteSpace(request.Isbn))
        {
            score += 20;
        }

        if (!string.IsNullOrWhiteSpace(imageUrl))
        {
            score += 4;
        }

        return Math.Min(100, score);
    }

    private static string BuildMatchReason(
        string? title,
        IReadOnlyCollection<string> authors,
        int? year,
        PtvGoogleBooksMetadataLookupRequest request)
    {
        var reasons = new List<string>();
        if (!string.IsNullOrWhiteSpace(request.Isbn)) reasons.Add("ISBN match");
        if (!string.IsNullOrWhiteSpace(request.Title) && !string.IsNullOrWhiteSpace(title)) reasons.Add("title match");
        if (!string.IsNullOrWhiteSpace(request.Author) && authors.Count > 0) reasons.Add("author match");
        if (request.Year is not null && request.Year == year) reasons.Add("year match");

        return reasons.Count == 0 ? "Google Books result" : string.Join(", ", reasons);
    }

    private static string CombineTitle(string? title, string? subtitle)
    {
        if (string.IsNullOrWhiteSpace(title)) return string.Empty;
        if (string.IsNullOrWhiteSpace(subtitle)) return title.Trim();
        if (title.Contains(subtitle, StringComparison.OrdinalIgnoreCase)) return title.Trim();

        return $"{title.Trim()}: {subtitle.Trim()}";
    }

    private static string? GetImageUrl(JsonElement volume)
    {
        if (!volume.TryGetProperty("imageLinks", out var imageLinks)
            || imageLinks.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var url = GetString(imageLinks, "extraLarge")
            ?? GetString(imageLinks, "large")
            ?? GetString(imageLinks, "medium")
            ?? GetString(imageLinks, "thumbnail")
            ?? GetString(imageLinks, "smallThumbnail");

        if (string.IsNullOrWhiteSpace(url))
        {
            return null;
        }

        return url.StartsWith("http:", StringComparison.OrdinalIgnoreCase)
            ? $"https:{url[5..]}"
            : url;
    }

    private static string? GetString(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty(propertyName, out var value)
            || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
    }

    private static int? GetInt(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty(propertyName, out var value))
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var intValue))
        {
            return intValue;
        }

        return int.TryParse(value.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }

    private static List<string> GetStringArray(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty(propertyName, out var value)
            || value.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return value.EnumerateArray()
            .Select(entry => entry.ValueKind == JsonValueKind.String ? entry.GetString() : entry.ToString())
            .Where(entry => !string.IsNullOrWhiteSpace(entry))
            .Select(entry => entry!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(20)
            .ToList();
    }

    private static int? GetYear(string? publishedDate)
    {
        if (string.IsNullOrWhiteSpace(publishedDate)) return null;

        var match = YearRegex().Match(publishedDate);
        return match.Success && int.TryParse(match.Value, CultureInfo.InvariantCulture, out var year) ? year : null;
    }

    private static string? NormalizeDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed))
        {
            return parsed.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        var year = GetYear(value);
        return year is null ? null : $"{year.Value.ToString(CultureInfo.InvariantCulture)}-01-01";
    }

    private static string CleanText(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var cleaned = value.Trim();
        return cleaned.Length > maxLength ? cleaned[..maxLength] : cleaned;
    }

    private static string CleanIsbn(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        return new string(value.Where(character => char.IsLetterOrDigit(character)).ToArray()).ToUpperInvariant();
    }

    private static string CleanHtml(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var decoded = WebUtility.HtmlDecode(value);
        var withoutTags = HtmlTagRegex().Replace(decoded, " ");
        return WhitespaceRegex().Replace(withoutTags, " ").Trim();
    }

    private static string NormalizeForCompare(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var cleaned = new string(value.ToLowerInvariant()
            .Select(character => char.IsLetterOrDigit(character) ? character : ' ')
            .ToArray());
        return WhitespaceRegex().Replace(cleaned, " ").Trim();
    }

    private static void TrimCache()
    {
        if (Cache.Count <= 240)
        {
            return;
        }

        foreach (var key in Cache.OrderBy(entry => entry.Value.CreatedAtUtc).Take(Cache.Count - 180).Select(entry => entry.Key))
        {
            Cache.TryRemove(key, out _);
        }
    }

    [GeneratedRegex("<[^>]+>", RegexOptions.Compiled)]
    private static partial Regex HtmlTagRegex();

    [GeneratedRegex("\\s+", RegexOptions.Compiled)]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex("\\b(?:19|20)\\d{2}\\b", RegexOptions.Compiled)]
    private static partial Regex YearRegex();

    private sealed record CacheEntry(DateTimeOffset CreatedAtUtc, List<PtvGoogleBooksMetadataCandidate> Candidates);
}
