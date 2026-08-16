using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Public AniList GraphQL adapter for manga, manhwa and manhua metadata.</summary>
public sealed class PtvAniListReadingMetadataProvider : IPtvReadingMetadataProvider
{
    private const string ProviderId = "anilist";
    private const string Endpoint = "https://graphql.anilist.co";
    private const int MaximumCandidates = 10;
    private static readonly string UserAgent = $"PiggieTV/{typeof(PtvAniListReadingMetadataProvider).Assembly.GetName().Version?.ToString(3) ?? "unknown"} (Jellyfin Reading metadata identification)";
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan SearchCacheTtl = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan EntityCacheTtl = TimeSpan.FromHours(24);
    private static readonly TimeSpan MinimumInterval = TimeSpan.FromSeconds(2);
    private readonly IPtvReadingMetadataRequestCoordinator _coordinator;

    public PtvAniListReadingMetadataProvider(IPtvReadingMetadataRequestCoordinator coordinator)
    {
        _coordinator = coordinator;
    }

    public string Id => ProviderId;

    public string DisplayName => "AniList";

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
            return BadRequest("A title is required for AniList search.");
        }

        var payload = JsonSerializer.Serialize(new
        {
            query = SearchGraphQl,
            variables = new { search = title, perPage = MaximumCandidates }
        });
        var result = await _coordinator.ExecuteAsync(
            CreateRequest(
                PtvReadingMetadataRequestKey.Create(
                    "search",
                    ("title", title),
                    ("year", query.Year?.ToString()),
                    ("class", query.MediaClass.ToString())),
                payload,
                SearchCacheTtl),
            cancellationToken).ConfigureAwait(false);
        return ParseSearchResult(result, query);
    }

    public async Task<PtvNormalizedMetadataCandidate?> GetByIdAsync(
        string providerId,
        CancellationToken cancellationToken)
    {
        if (!int.TryParse(providerId, out var id) || id <= 0)
        {
            return null;
        }

        var payload = JsonSerializer.Serialize(new
        {
            query = DirectGraphQl,
            variables = new { id }
        });
        var result = await _coordinator.ExecuteAsync(
            CreateRequest(
                PtvReadingMetadataRequestKey.Create("by-id", ("id", id.ToString())),
                payload,
                EntityCacheTtl),
            cancellationToken).ConfigureAwait(false);
        if (!result.Succeeded || string.IsNullOrWhiteSpace(result.Body))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(result.Body, JsonOptions);
            if (!TryGet(document.RootElement, "data", out var data)
                || !TryGet(data, "Media", out var media)
                || media.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            return Normalize(media)?.ToBoundedTransportModel();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public Task<PtvReadingProviderStatus> GetStatusAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_coordinator.GetStatus(ProviderId));
    }

    private PtvReadingProviderSearchResult ParseSearchResult(
        PtvReadingMetadataHttpResult result,
        PtvStructuredMetadataQuery query)
    {
        if (!result.Succeeded || string.IsNullOrWhiteSpace(result.Body))
        {
            return FromTransport(result);
        }

        try
        {
            using var document = JsonDocument.Parse(result.Body, JsonOptions);
            var hasErrors = TryGet(document.RootElement, "errors", out var errors)
                && errors.ValueKind == JsonValueKind.Array
                && errors.GetArrayLength() > 0;
            var candidates = new List<PtvNormalizedMetadataCandidate>();
            if (TryGet(document.RootElement, "data", out var data)
                && TryGet(data, "Page", out var page)
                && TryGet(page, "media", out var mediaArray)
                && mediaArray.ValueKind == JsonValueKind.Array)
            {
                foreach (var media in mediaArray.EnumerateArray().Take(MaximumCandidates))
                {
                    var candidate = Normalize(media);
                    if (candidate is not null)
                    {
                        candidates.Add(candidate.ToBoundedTransportModel());
                    }
                }
            }

            if (candidates.Count == 0 && hasErrors)
            {
                return ParseFailure(result, "AniList could not complete this query.");
            }

            return new PtvReadingProviderSearchResult
            {
                Provider = ProviderId,
                State = PtvReadingProviderState.Available,
                Candidates = candidates,
                CacheHit = result.CacheHit,
                DurationMilliseconds = result.DurationMilliseconds,
                Failure = hasErrors
                    ? new PtvReadingProviderFailure
                    {
                        Provider = ProviderId,
                        Kind = PtvReadingProviderFailureKind.Unavailable,
                        Code = "anilist-partial-response",
                        Message = "AniList returned partial results."
                    }
                    : null
            };
        }
        catch (JsonException)
        {
            return ParseFailure(result, "AniList returned an unreadable response.");
        }
    }

    private static PtvNormalizedMetadataCandidate? Normalize(JsonElement media)
    {
        var id = GetInt(media, "id");
        if (id is null || !TryGet(media, "title", out var titleObject))
        {
            return null;
        }

        var romaji = GetString(titleObject, "romaji");
        var english = GetString(titleObject, "english");
        var native = GetString(titleObject, "native");
        var preferred = GetString(titleObject, "userPreferred");
        var title = PtvReadingMetadataSafety.Text(preferred ?? english ?? romaji ?? native);
        if (title is null)
        {
            return null;
        }

        var country = GetString(media, "countryOfOrigin");
        var candidate = new PtvNormalizedMetadataCandidate
        {
            Provider = ProviderId,
            ProviderId = id.Value.ToString(),
            MediaClass = Classify(country),
            Title = title,
            CountryOfOrigin = PtvReadingMetadataSafety.Text(country, 32),
            Status = PtvReadingMetadataSafety.Text(GetString(media, "status"), 64),
            Description = PtvReadingMetadataSafety.PlainText(GetString(media, "description")),
            TotalVolumes = Positive(GetInt(media, "volumes")),
            TotalChapters = Positive(GetInt(media, "chapters")),
            SourceUrl = PtvReadingMetadataSafety.HttpUrl(
                GetString(media, "siteUrl") ?? $"https://anilist.co/manga/{id.Value}",
                "anilist.co"),
            Genres = GetStringArray(media, "genres"),
            AlternateTitles = PtvReadingMetadataSafety.Strings(
                new[] { romaji, english, native }.Concat(GetStringArray(media, "synonyms")))
        };

        AddLocalizedTitle(candidate, "x-romaji", romaji);
        AddLocalizedTitle(candidate, "en", english);
        AddLocalizedTitle(candidate, NativeLanguage(country), native);
        if (TryGet(media, "startDate", out var startDate))
        {
            candidate.StartYear = GetInt(startDate, "year");
            candidate.Year = candidate.StartYear;
        }

        if (TryGet(media, "endDate", out var endDate))
        {
            candidate.EndYear = GetInt(endDate, "year");
        }

        if (TryGet(media, "coverImage", out var cover))
        {
            candidate.CoverUrl = PtvReadingMetadataSafety.HttpUrl(
                GetString(cover, "extraLarge") ?? GetString(cover, "large") ?? GetString(cover, "medium"),
                "anilist.co",
                "anilist.co");
        }

        candidate.BannerUrl = PtvReadingMetadataSafety.HttpUrl(GetString(media, "bannerImage"), "anilist.co");
        candidate.ExternalIds["AniList"] = id.Value.ToString();
        if (GetInt(media, "idMal") is { } malId)
        {
            candidate.ExternalIds["MyAnimeList"] = malId.ToString();
        }

        if (TryGet(media, "tags", out var tags) && tags.ValueKind == JsonValueKind.Array)
        {
            candidate.Tags = PtvReadingMetadataSafety.Strings(
                tags.EnumerateArray()
                    .Where(tag => GetBool(tag, "isMediaSpoiler") != true && GetBool(tag, "isGeneralSpoiler") != true)
                    .OrderByDescending(tag => GetInt(tag, "rank") ?? 0)
                    .Select(tag => GetString(tag, "name")));
        }

        AddStaff(candidate, media);
        return candidate;
    }

    private static void AddStaff(PtvNormalizedMetadataCandidate candidate, JsonElement media)
    {
        if (!TryGet(media, "staff", out var staff)
            || !TryGet(staff, "edges", out var edges)
            || edges.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var edge in edges.EnumerateArray().Take(32))
        {
            var role = PtvReadingMetadataSafety.Text(GetString(edge, "role"), 128);
            if (!TryGet(edge, "node", out var node)
                || !TryGet(node, "name", out var nameObject))
            {
                continue;
            }

            var name = PtvReadingMetadataSafety.Text(GetString(nameObject, "full") ?? GetString(nameObject, "native"));
            if (name is null)
            {
                continue;
            }

            var credit = new PtvReadingPersonCredit
            {
                Name = name,
                Role = role,
                ProviderId = GetInt(node, "id")?.ToString()
            };
            var artRole = role?.Contains("art", StringComparison.OrdinalIgnoreCase) == true
                || role?.Contains("illustr", StringComparison.OrdinalIgnoreCase) == true;
            if (artRole)
            {
                candidate.Artists.Add(credit);
            }

            if (!artRole || role?.Contains("story", StringComparison.OrdinalIgnoreCase) == true)
            {
                candidate.Authors.Add(credit);
            }
        }
    }

    private PtvReadingMetadataHttpRequest CreateRequest(
        PtvReadingMetadataRequestKey key,
        string payload,
        TimeSpan cacheTtl) => new()
        {
            Provider = ProviderId,
            Key = key,
            MaximumConcurrency = 1,
            MinimumInterval = MinimumInterval,
            Timeout = RequestTimeout,
            CacheTtl = cacheTtl,
            HeaderlessRateLimitBackoff = TimeSpan.FromSeconds(60),
            MaximumResponseBytes = 1_048_576,
            CreateRequest = () =>
            {
                var request = new HttpRequestMessage(HttpMethod.Post, Endpoint)
                {
                    Content = new StringContent(payload, Encoding.UTF8, "application/json")
                };
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

    private static PtvReadingProviderSearchResult ParseFailure(PtvReadingMetadataHttpResult result, string message) => new()
    {
        Provider = ProviderId,
        State = PtvReadingProviderState.Unreachable,
        CacheHit = result.CacheHit,
        DurationMilliseconds = result.DurationMilliseconds,
        Failure = new PtvReadingProviderFailure
        {
            Provider = ProviderId,
            Kind = PtvReadingProviderFailureKind.Parse,
            Code = "anilist-malformed-response",
            Message = message
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
            Code = "anilist-title-required",
            Message = message
        }
    };

    private static PtvReadingMediaClass Classify(string? country) => country?.ToUpperInvariant() switch
    {
        "KR" => PtvReadingMediaClass.Manhwa,
        "CN" or "TW" or "HK" => PtvReadingMediaClass.Manhua,
        _ => PtvReadingMediaClass.Manga
    };

    private static string NativeLanguage(string? country) => country?.ToUpperInvariant() switch
    {
        "KR" => "ko",
        "CN" => "zh-CN",
        "TW" or "HK" => "zh-TW",
        _ => "ja"
    };

    private static void AddLocalizedTitle(PtvNormalizedMetadataCandidate candidate, string key, string? value)
    {
        var safe = PtvReadingMetadataSafety.Text(value);
        if (safe is not null)
        {
            candidate.LocalizedTitles[key] = safe;
        }
    }

    private static int? Positive(int? value) => value > 0 ? value : null;

    private static bool TryGet(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out value))
        {
            return true;
        }

        value = default;
        return false;
    }

    private static string? GetString(JsonElement element, string name) =>
        TryGet(element, name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static int? GetInt(JsonElement element, string name)
    {
        if (!TryGet(element, name, out var value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) ? number : null;
    }

    private static bool? GetBool(JsonElement element, string name) =>
        TryGet(element, name, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean()
            : null;

    private static List<string> GetStringArray(JsonElement element, string name) =>
        TryGet(element, name, out var value) && value.ValueKind == JsonValueKind.Array
            ? PtvReadingMetadataSafety.Strings(value.EnumerateArray().Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : null))
            : [];

    private static readonly JsonDocumentOptions JsonOptions = new()
    {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = 64
    };

    private const string MediaFields = """
        id idMal
        title { romaji english native userPreferred }
        synonyms format status description(asHtml: false)
        startDate { year month day } endDate { year month day }
        chapters volumes countryOfOrigin
        coverImage { extraLarge large medium }
        bannerImage genres
        tags { name rank isMediaSpoiler isGeneralSpoiler }
        staff(perPage: 32) { edges { role node { id name { full native } } } }
        siteUrl
        """;

    private const string SearchGraphQl = "query($search:String!,$perPage:Int!){Page(page:1,perPage:$perPage){media(search:$search,type:MANGA,sort:SEARCH_MATCH){" + MediaFields + "}}}";
    private const string DirectGraphQl = "query($id:Int!){Media(id:$id,type:MANGA){" + MediaFields + "}}";
}
