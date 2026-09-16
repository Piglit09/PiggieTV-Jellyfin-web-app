using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Public MangaDex adapter for manga, manhwa and manhua metadata.</summary>
public sealed class PtvMangaDexReadingMetadataProvider : IPtvReadingMetadataProvider
{
    private const string ProviderId = "mangadex";
    private const string ApiRoot = "https://api.mangadex.org";
    private const int MaximumCandidates = 10;
    private static readonly string UserAgent = $"PiggieTV/{typeof(PtvMangaDexReadingMetadataProvider).Assembly.GetName().Version?.ToString(3) ?? "unknown"} (Jellyfin Reading metadata identification)";
    private readonly IPtvReadingMetadataRequestCoordinator _coordinator;

    public PtvMangaDexReadingMetadataProvider(IPtvReadingMetadataRequestCoordinator coordinator)
    {
        _coordinator = coordinator;
    }

    public string Id => ProviderId;

    public string DisplayName => "MangaDex";

    public bool Supports(PtvMetadataSearchContext context) =>
        context.MediaClassOverride is null
            or PtvReadingMediaClass.Unknown
            or PtvReadingMediaClass.Manga
            or PtvReadingMediaClass.Manhwa
            or PtvReadingMediaClass.Manhua
            or PtvReadingMediaClass.GraphicNovel;

    public async Task<PtvReadingProviderSearchResult> SearchAsync(
        PtvStructuredMetadataQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (query.ProviderId is { } direct
            && direct.Provider.Equals(ProviderId, StringComparison.OrdinalIgnoreCase))
        {
            var candidate = await GetByIdAsync(direct.Id, cancellationToken).ConfigureAwait(false);
            return new PtvReadingProviderSearchResult
            {
                Provider = ProviderId,
                State = candidate is null ? PtvReadingProviderState.Unreachable : PtvReadingProviderState.Available,
                Candidates = candidate is null ? [] : [candidate]
            };
        }

        var title = PtvReadingMetadataSafety.Text(query.SeriesTitle ?? query.CleanedTitle, 256);
        if (title is null)
        {
            return BadRequest("A title is required for MangaDex search.");
        }

        var url = new StringBuilder(ApiRoot)
            .Append("/manga?limit=").Append(MaximumCandidates.ToString(CultureInfo.InvariantCulture))
            .Append("&title=").Append(Uri.EscapeDataString(title))
            .Append("&order%5Brelevance%5D=desc")
            .Append("&includes%5B%5D=author&includes%5B%5D=artist&includes%5B%5D=cover_art")
            .ToString();
        var response = await _coordinator.ExecuteAsync(
            CreateRequest(
                PtvReadingMetadataRequestKey.Create(
                    "search",
                    ("title", title),
                    ("year", query.Year?.ToString()),
                    ("class", query.MediaClass.ToString())),
                url,
                TimeSpan.FromMinutes(30)),
            cancellationToken).ConfigureAwait(false);
        return ParseSearchResult(response);
    }

    public async Task<PtvNormalizedMetadataCandidate?> GetByIdAsync(
        string providerId,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(providerId, out var parsedId))
        {
            return null;
        }

        var id = parsedId.ToString("D");
        var response = await _coordinator.ExecuteAsync(
            CreateRequest(
                PtvReadingMetadataRequestKey.Create("by-id", ("id", id)),
                $"{ApiRoot}/manga/{id}?includes%5B%5D=author&includes%5B%5D=artist&includes%5B%5D=cover_art",
                TimeSpan.FromHours(24)),
            cancellationToken).ConfigureAwait(false);
        if (!response.Succeeded || string.IsNullOrWhiteSpace(response.Body))
        {
            return null;
        }

        PtvNormalizedMetadataCandidate? candidate;
        try
        {
            using var document = JsonDocument.Parse(response.Body, JsonOptions);
            candidate = TryGet(document.RootElement, "data", out var data) ? Normalize(data) : null;
        }
        catch (JsonException)
        {
            return null;
        }

        if (candidate is null)
        {
            return null;
        }

        // Aggregate evidence is one bounded direct-record enrichment, never per row in search results.
        var aggregate = await _coordinator.ExecuteAsync(
            CreateRequest(
                PtvReadingMetadataRequestKey.Create("aggregate", ("id", id)),
                $"{ApiRoot}/manga/{id}/aggregate",
                TimeSpan.FromHours(12),
                maximumBytes: 512 * 1024),
            cancellationToken).ConfigureAwait(false);
        if (aggregate.Succeeded && !string.IsNullOrWhiteSpace(aggregate.Body))
        {
            ApplyAggregateEvidence(candidate, aggregate.Body);
        }

        return candidate.ToBoundedTransportModel();
    }

    public Task<PtvReadingProviderStatus> GetStatusAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_coordinator.GetStatus(ProviderId));
    }

    private static PtvReadingProviderSearchResult ParseSearchResult(PtvReadingMetadataHttpResult response)
    {
        if (!response.Succeeded || string.IsNullOrWhiteSpace(response.Body))
        {
            return FromTransport(response);
        }

        try
        {
            using var document = JsonDocument.Parse(response.Body, JsonOptions);
            if (!TryGet(document.RootElement, "data", out var data) || data.ValueKind != JsonValueKind.Array)
            {
                return ParseFailure(response);
            }

            var candidates = data.EnumerateArray()
                .Take(MaximumCandidates)
                .Select(Normalize)
                .Where(candidate => candidate is not null)
                .Select(candidate => candidate!.ToBoundedTransportModel())
                .ToList();
            return new PtvReadingProviderSearchResult
            {
                Provider = ProviderId,
                State = PtvReadingProviderState.Available,
                Candidates = candidates,
                CacheHit = response.CacheHit,
                DurationMilliseconds = response.DurationMilliseconds
            };
        }
        catch (JsonException)
        {
            return ParseFailure(response);
        }
    }

    private static PtvNormalizedMetadataCandidate? Normalize(JsonElement data)
    {
        var id = GetString(data, "id");
        if (!Guid.TryParse(id, out var parsedId)
            || !TryGet(data, "attributes", out var attributes)
            || !TryGet(attributes, "title", out var titleObject))
        {
            return null;
        }

        var localizedTitles = ReadLocalizedDictionary(titleObject);
        var originalLanguage = GetString(attributes, "originalLanguage");
        // Use the provider's English display title when present while retaining the
        // original/localized title map for identity scoring and locale-aware UIs.
        var preferredTitle = ChooseLocalized(localizedTitles, "en");
        if (preferredTitle is null)
        {
            return null;
        }

        var candidate = new PtvNormalizedMetadataCandidate
        {
            Provider = ProviderId,
            ProviderId = parsedId.ToString("D"),
            MediaClass = Classify(originalLanguage),
            Title = preferredTitle,
            LocalizedTitles = localizedTitles,
            AlternateTitles = ReadAltTitles(attributes),
            Description = ReadDescription(attributes, originalLanguage),
            Language = PtvReadingMetadataSafety.Text(originalLanguage, 32),
            CountryOfOrigin = CountryForLanguage(originalLanguage),
            Status = PtvReadingMetadataSafety.Text(GetString(attributes, "status"), 64),
            Year = GetInt(attributes, "year"),
            StartYear = GetInt(attributes, "year"),
            TotalVolumes = ParsePositiveInteger(GetString(attributes, "lastVolume")),
            TotalChapters = ParsePositiveInteger(GetString(attributes, "lastChapter")),
            SourceUrl = $"https://mangadex.org/title/{parsedId:D}"
        };
        candidate.ExternalIds["MangaDex"] = parsedId.ToString("D");
        AddTags(candidate, attributes);
        AddLinks(candidate, attributes);
        AddRelationships(candidate, data, parsedId);
        return candidate;
    }

    private static void AddRelationships(
        PtvNormalizedMetadataCandidate candidate,
        JsonElement data,
        Guid mangaId)
    {
        if (!TryGet(data, "relationships", out var relationships)
            || relationships.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var relationship in relationships.EnumerateArray().Take(64))
        {
            var type = GetString(relationship, "type");
            var relationshipId = GetString(relationship, "id");
            if (!TryGet(relationship, "attributes", out var attributes))
            {
                continue;
            }

            if (type is "author" or "artist")
            {
                var name = PtvReadingMetadataSafety.Text(GetString(attributes, "name"));
                if (name is null)
                {
                    continue;
                }

                var credit = new PtvReadingPersonCredit
                {
                    Name = name,
                    Role = type == "author" ? "Author" : "Artist",
                    ProviderId = PtvReadingMetadataSafety.Text(relationshipId, 64)
                };
                if (type == "author") candidate.Authors.Add(credit);
                else candidate.Artists.Add(credit);
            }
            else if (type == "cover_art")
            {
                var fileName = GetString(attributes, "fileName");
                if (!string.IsNullOrWhiteSpace(fileName)
                    && fileName.Length <= 256
                    && fileName.IndexOfAny(['/', '\\']) < 0)
                {
                    candidate.CoverUrl = PtvReadingMetadataSafety.HttpUrl(
                        $"https://uploads.mangadex.org/covers/{mangaId:D}/{Uri.EscapeDataString(fileName)}",
                        "uploads.mangadex.org");
                }
            }
        }
    }

    private static void AddTags(PtvNormalizedMetadataCandidate candidate, JsonElement attributes)
    {
        if (!TryGet(attributes, "tags", out var tags) || tags.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        var genres = new List<string?>();
        var allTags = new List<string?>();
        foreach (var tag in tags.EnumerateArray().Take(64))
        {
            if (!TryGet(tag, "attributes", out var tagAttributes)
                || !TryGet(tagAttributes, "name", out var names))
            {
                continue;
            }

            var name = ChooseLocalized(ReadLocalizedDictionary(names), "en");
            allTags.Add(name);
            if (GetString(tagAttributes, "group") == "genre")
            {
                genres.Add(name);
            }
        }

        candidate.Tags = PtvReadingMetadataSafety.Strings(allTags);
        candidate.Genres = PtvReadingMetadataSafety.Strings(genres);
    }

    private static void AddLinks(PtvNormalizedMetadataCandidate candidate, JsonElement attributes)
    {
        if (!TryGet(attributes, "links", out var links) || links.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        foreach (var property in links.EnumerateObject().Take(24))
        {
            if (property.Value.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            var value = PtvReadingMetadataSafety.Text(property.Value.GetString(), 128);
            if (value is null)
            {
                continue;
            }

            var key = property.Name switch
            {
                "al" => "AniList",
                "mal" => "MyAnimeList",
                "mu" => "MangaUpdates",
                "bw" => "BookWalker",
                _ => $"MangaDex:{property.Name}"
            };
            candidate.ExternalIds[key] = value;
        }
    }

    private static void ApplyAggregateEvidence(PtvNormalizedMetadataCandidate candidate, string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload, JsonOptions);
            if (!TryGet(document.RootElement, "volumes", out var volumes)
                || volumes.ValueKind != JsonValueKind.Object)
            {
                return;
            }

            var maxVolume = candidate.TotalVolumes ?? 0;
            var maxChapter = candidate.TotalChapters ?? 0;
            foreach (var volume in volumes.EnumerateObject().Take(256))
            {
                maxVolume = Math.Max(maxVolume, ParsePositiveInteger(volume.Name) ?? 0);
                if (!TryGet(volume.Value, "chapters", out var chapters)
                    || chapters.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                foreach (var chapter in chapters.EnumerateObject().Take(1_024))
                {
                    maxChapter = Math.Max(maxChapter, ParsePositiveInteger(chapter.Name) ?? 0);
                }
            }

            candidate.TotalVolumes = maxVolume > 0 ? maxVolume : candidate.TotalVolumes;
            candidate.TotalChapters = maxChapter > 0 ? maxChapter : candidate.TotalChapters;
        }
        catch (JsonException)
        {
            // Aggregate evidence is optional; the authoritative manga record remains usable.
        }
    }

    private static Dictionary<string, string> ReadLocalizedDictionary(JsonElement element)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (element.ValueKind != JsonValueKind.Object)
        {
            return values;
        }

        foreach (var property in element.EnumerateObject().Take(32))
        {
            var safe = property.Value.ValueKind == JsonValueKind.String
                ? PtvReadingMetadataSafety.Text(property.Value.GetString())
                : null;
            if (safe is not null)
            {
                values[PtvReadingMetadataSafety.Text(property.Name, 32) ?? "und"] = safe;
            }
        }

        return values;
    }

    private static List<string> ReadAltTitles(JsonElement attributes)
    {
        if (!TryGet(attributes, "altTitles", out var altTitles)
            || altTitles.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return PtvReadingMetadataSafety.Strings(
            altTitles.EnumerateArray()
                .Where(value => value.ValueKind == JsonValueKind.Object)
                .SelectMany(value => value.EnumerateObject())
                .Select(value => value.Value.ValueKind == JsonValueKind.String ? value.Value.GetString() : null));
    }

    private static string? ReadDescription(JsonElement attributes, string? originalLanguage)
    {
        if (!TryGet(attributes, "description", out var description))
        {
            return null;
        }

        return PtvReadingMetadataSafety.PlainText(
            ChooseLocalized(ReadLocalizedDictionary(description), originalLanguage));
    }

    private static string? ChooseLocalized(IReadOnlyDictionary<string, string> values, string? language)
    {
        if (!string.IsNullOrWhiteSpace(language) && values.TryGetValue(language, out var exact)) return exact;
        if (values.TryGetValue("en", out var english)) return english;
        return values.Values.FirstOrDefault();
    }

    private static PtvReadingMediaClass Classify(string? language) => language?.ToLowerInvariant() switch
    {
        "ko" => PtvReadingMediaClass.Manhwa,
        "zh" or "zh-hk" or "zh-ro" => PtvReadingMediaClass.Manhua,
        _ => PtvReadingMediaClass.Manga
    };

    private static string? CountryForLanguage(string? language) => language?.ToLowerInvariant() switch
    {
        "ko" => "KR",
        "zh" => "CN",
        "zh-hk" => "HK",
        "zh-ro" => "TW",
        "ja" or "ja-ro" => "JP",
        _ => null
    };

    private static int? ParsePositiveInteger(string? value)
    {
        if (!decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var number)
            || number <= 0
            || number > int.MaxValue)
        {
            return null;
        }

        return (int)Math.Ceiling(number);
    }

    private static PtvReadingMetadataHttpRequest CreateRequest(
        PtvReadingMetadataRequestKey key,
        string url,
        TimeSpan cacheTtl,
        int maximumBytes = 1_048_576) => new()
        {
            Provider = ProviderId,
            Key = key,
            MaximumConcurrency = 2,
            MinimumInterval = TimeSpan.FromMilliseconds(250),
            Timeout = TimeSpan.FromSeconds(15),
            CacheTtl = cacheTtl,
            HeaderlessRateLimitBackoff = TimeSpan.FromSeconds(30),
            MaximumResponseBytes = maximumBytes,
            CreateRequest = () =>
            {
                var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                request.Headers.UserAgent.ParseAdd(UserAgent);
                return request;
            }
        };

    private static PtvReadingProviderSearchResult FromTransport(PtvReadingMetadataHttpResult result) => new()
    {
        Provider = ProviderId,
        State = result.Failure?.Kind switch
        {
            PtvReadingProviderFailureKind.RateLimit => PtvReadingProviderState.RateLimited,
            PtvReadingProviderFailureKind.Authentication => PtvReadingProviderState.Misconfigured,
            _ => PtvReadingProviderState.Unreachable
        },
        Failure = result.Failure,
        CacheHit = result.CacheHit,
        DurationMilliseconds = result.DurationMilliseconds
    };

    private static PtvReadingProviderSearchResult ParseFailure(PtvReadingMetadataHttpResult result) => new()
    {
        Provider = ProviderId,
        State = PtvReadingProviderState.Unreachable,
        CacheHit = result.CacheHit,
        DurationMilliseconds = result.DurationMilliseconds,
        Failure = new PtvReadingProviderFailure
        {
            Provider = ProviderId,
            Kind = PtvReadingProviderFailureKind.Parse,
            Code = "mangadex-malformed-response",
            Message = "MangaDex returned an unreadable response."
        }
    };

    private static PtvReadingProviderSearchResult BadRequest(string message) => new()
    {
        Provider = ProviderId,
        State = PtvReadingProviderState.Available,
        Failure = new PtvReadingProviderFailure
        {
            Provider = ProviderId,
            Kind = PtvReadingProviderFailureKind.BadRequest,
            Code = "mangadex-title-required",
            Message = message
        }
    };

    private static bool TryGet(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out value)) return true;
        value = default;
        return false;
    }

    private static string? GetString(JsonElement element, string name) =>
        TryGet(element, name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static int? GetInt(JsonElement element, string name) =>
        TryGet(element, name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)
            ? number
            : null;

    private static readonly JsonDocumentOptions JsonOptions = new()
    {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = 64
    };
}
