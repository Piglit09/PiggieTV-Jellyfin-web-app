using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>Hard bounds for provider-controlled metadata crossing the PTV API boundary.</summary>
public static class PtvReadingMetadataLimits
{
    public const int MaximumTitleLength = 512;
    public const int MaximumDescriptionLength = 16_384;
    public const int MaximumIdentifierLength = 256;
    public const int MaximumUrlLength = 2_048;
    public const int MaximumCollectionItems = 64;
    public const int MaximumExternalIds = 32;
}

/// <summary>One strict URL boundary shared by local and remote Reading metadata.</summary>
internal static class PtvReadingUrlSafety
{
    private static readonly HashSet<string> SensitiveQueryKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "access_token", "apikey", "api_key", "authorization", "auth_token", "key", "password", "secret", "token"
    };

    public static string? HttpUrl(string? value, int maximumLength, params string[] allowedHosts)
    {
        if (string.IsNullOrWhiteSpace(value)
            || value.Length > maximumLength
            || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || !string.IsNullOrEmpty(uri.UserInfo)
            || HasSensitiveQuery(uri))
        {
            return null;
        }

        if (allowedHosts.Length > 0
            && !allowedHosts.Any(host => uri.Host.Equals(host, StringComparison.OrdinalIgnoreCase)
                || uri.Host.EndsWith($".{host}", StringComparison.OrdinalIgnoreCase)))
        {
            return null;
        }

        return uri.AbsoluteUri;
    }

    private static bool HasSensitiveQuery(Uri uri)
    {
        if (string.IsNullOrEmpty(uri.Query)) return false;
        try
        {
            return uri.Query.TrimStart('?')
                .Split('&', StringSplitOptions.RemoveEmptyEntries)
                .Select(part => part.Split('=', 2)[0])
                .Select(Uri.UnescapeDataString)
                .Any(SensitiveQueryKeys.Contains);
        }
        catch (UriFormatException)
        {
            return true;
        }
    }
}

/// <summary>Provider-neutral media classes used by Reading identification.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PtvReadingMediaClass>))]
public enum PtvReadingMediaClass
{
    [JsonStringEnumMemberName("unknown")]
    Unknown,

    [JsonStringEnumMemberName("comic")]
    Comic,

    [JsonStringEnumMemberName("manga")]
    Manga,

    [JsonStringEnumMemberName("manhwa")]
    Manhwa,

    [JsonStringEnumMemberName("manhua")]
    Manhua,

    [JsonStringEnumMemberName("graphic-novel")]
    GraphicNovel,

    [JsonStringEnumMemberName("book")]
    Book
}

/// <summary>Detected edition semantics that must not be conflated with issue numbering.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PtvReadingEditionKind>))]
public enum PtvReadingEditionKind
{
    [JsonStringEnumMemberName("standard")]
    Standard,

    [JsonStringEnumMemberName("annual")]
    Annual,

    [JsonStringEnumMemberName("special")]
    Special,

    [JsonStringEnumMemberName("omnibus")]
    Omnibus,

    [JsonStringEnumMemberName("trade-paperback")]
    TradePaperback
}

/// <summary>Normalized provider availability states.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PtvReadingProviderState>))]
public enum PtvReadingProviderState
{
    [JsonStringEnumMemberName("available")]
    Available,

    [JsonStringEnumMemberName("misconfigured")]
    Misconfigured,

    [JsonStringEnumMemberName("rate-limited")]
    RateLimited,

    [JsonStringEnumMemberName("unreachable")]
    Unreachable,

    [JsonStringEnumMemberName("disabled")]
    Disabled,

    [JsonStringEnumMemberName("unknown")]
    Unknown
}

/// <summary>Safe, provider-independent failure categories.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PtvReadingProviderFailureKind>))]
public enum PtvReadingProviderFailureKind
{
    [JsonStringEnumMemberName("network")]
    Network,

    [JsonStringEnumMemberName("timeout")]
    Timeout,

    [JsonStringEnumMemberName("rate-limit")]
    RateLimit,

    [JsonStringEnumMemberName("authentication")]
    Authentication,

    [JsonStringEnumMemberName("bad-request")]
    BadRequest,

    [JsonStringEnumMemberName("unavailable")]
    Unavailable,

    [JsonStringEnumMemberName("parse")]
    Parse,

    [JsonStringEnumMemberName("cancelled")]
    Cancelled,

    [JsonStringEnumMemberName("unknown")]
    Unknown
}

/// <summary>Stable reason codes emitted by the deterministic Reading scorer.</summary>
public static class PtvReadingMatchReasonCodes
{
    public const string ExactTitle = "EXACT_TITLE";
    public const string ExactAlternateTitle = "EXACT_ALTERNATE_TITLE";
    public const string StrongTitle = "STRONG_TITLE";
    public const string PartialTitle = "PARTIAL_TITLE";
    public const string TitleMismatch = "TITLE_MISMATCH";
    public const string IssueMatch = "ISSUE_MATCH";
    public const string IssueMismatch = "ISSUE_MISMATCH";
    public const string IssueMissing = "ISSUE_MISSING";
    public const string EditionMatch = "EDITION_MATCH";
    public const string EditionMismatch = "EDITION_MISMATCH";
    public const string EditionMissing = "EDITION_MISSING";
    public const string SeriesTitleMissing = "SERIES_TITLE_MISSING";
    public const string FolderSeriesCorroboration = "FOLDER_SERIES_CORROBORATION";
    public const string FolderRunCorroboration = "FOLDER_RUN_CORROBORATION";
    public const string LocalIdentityConflict = "LOCAL_IDENTITY_CONFLICT";
    public const string VolumeMatch = "VOLUME_MATCH";
    public const string VolumeMismatch = "VOLUME_MISMATCH";
    public const string VolumeMissing = "VOLUME_MISSING";
    public const string ChapterMatch = "CHAPTER_MATCH";
    public const string ChapterMismatch = "CHAPTER_MISMATCH";
    public const string ChapterMissing = "CHAPTER_MISSING";
    public const string YearMatch = "YEAR_MATCH";
    public const string YearNear = "YEAR_NEAR";
    public const string YearMismatch = "YEAR_MISMATCH";
    public const string SeriesRunYearMatch = "SERIES_RUN_YEAR_MATCH";
    public const string SeriesRunYearMissing = "SERIES_RUN_YEAR_MISSING";
    public const string SeriesRunYearMismatch = "SERIES_RUN_YEAR_MISMATCH";
    public const string IssuePublicationYearMatch = "ISSUE_PUBLICATION_YEAR_MATCH";
    public const string IssuePublicationYearNear = "ISSUE_PUBLICATION_YEAR_NEAR";
    public const string IssuePublicationYearMismatch = "ISSUE_PUBLICATION_YEAR_MISMATCH";
    public const string MediaClassMatch = "MEDIA_CLASS_MATCH";
    public const string MediaClassCompatible = "MEDIA_CLASS_COMPATIBLE";
    public const string MediaClassMismatch = "MEDIA_CLASS_MISMATCH";
    public const string ProviderIdMatch = "PROVIDER_ID_MATCH";
    public const string ProviderIdMismatch = "PROVIDER_ID_MISMATCH";
    public const string AuthorMatch = "AUTHOR_MATCH";
    public const string PublisherMatch = "PUBLISHER_MATCH";
}

/// <summary>Authoritative local source for one parsed Reading identity field.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PtvReadingIdentityEvidenceSource>))]
public enum PtvReadingIdentityEvidenceSource
{
    [JsonStringEnumMemberName("unknown")]
    Unknown,

    [JsonStringEnumMemberName("filename")]
    FileName,

    [JsonStringEnumMemberName("folder")]
    Folder,

    [JsonStringEnumMemberName("existing-metadata")]
    ExistingMetadata,

    [JsonStringEnumMemberName("local-metadata")]
    LocalMetadata,

    [JsonStringEnumMemberName("administrator")]
    Administrator,

    [JsonStringEnumMemberName("provider")]
    Provider
}

/// <summary>A bounded disagreement between two local identity sources.</summary>
public sealed class PtvReadingIdentityConflict
{
    public string Field { get; set; } = string.Empty;

    public PtvReadingIdentityEvidenceSource PreferredSource { get; set; }

    public string PreferredValue { get; set; } = string.Empty;

    public PtvReadingIdentityEvidenceSource ConflictingSource { get; set; }

    public string ConflictingValue { get; set; } = string.Empty;
}

/// <summary>Immutable provider identifier supplied by a direct lookup or existing item match.</summary>
public sealed class PtvReadingProviderIdentifier
{
    public string Provider { get; set; } = string.Empty;

    public string Id { get; set; } = string.Empty;
}

/// <summary>Local and Jellyfin context used to parse and route a Reading search.</summary>
public sealed class PtvMetadataSearchContext
{
    public string? ItemId { get; set; }

    public string? LibraryId { get; set; }

    public string? ItemType { get; set; }

    public string? LibraryType { get; set; }

    /// <summary>The file name only. Full server paths must not enter search contracts.</summary>
    public string? FileName { get; set; }

    /// <summary>The immediate folder name only. Full server paths must not enter search contracts.</summary>
    public string? FolderName { get; set; }

    public string? ExistingTitle { get; set; }

    public string? ExistingOriginalTitle { get; set; }

    public string? Author { get; set; }

    public string? Isbn { get; set; }

    public int? ProductionYear { get; set; }

    public DateTimeOffset? PremiereDate { get; set; }

    public string? OriginalLanguage { get; set; }

    public PtvReadingMediaClass? MediaClassOverride { get; set; }

    public Dictionary<string, string> ExistingProviderIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public List<string> LocalAlternateTitles { get; set; } = [];
}

/// <summary>Explainable media-class detection.</summary>
public sealed class PtvReadingMediaClassification
{
    public PtvReadingMediaClass MediaClass { get; set; } = PtvReadingMediaClass.Unknown;

    /// <summary>Confidence from zero through one.</summary>
    public double Confidence { get; set; }

    public List<string> Reasons { get; set; } = [];
}

/// <summary>Provider-neutral, parsed Reading identification request.</summary>
public sealed class PtvStructuredMetadataQuery
{
    public string RawTitle { get; set; } = string.Empty;

    /// <summary>The base file name only, retained for safe diagnostics.</summary>
    public string RawFileName { get; set; } = string.Empty;

    public string CleanedTitle { get; set; } = string.Empty;

    public string? SeriesTitle { get; set; }

    public PtvReadingIdentityEvidenceSource SeriesTitleEvidence { get; set; }

    /// <summary>Local issue identity; never inferred from a provider volume.</summary>
    public string? IssueNumber { get; set; }

    public PtvReadingIdentityEvidenceSource IssueNumberEvidence { get; set; }

    /// <summary>Local volume identity; distinct from provider total-volume counts.</summary>
    public string? VolumeNumber { get; set; }

    /// <summary>Local chapter identity; distinct from provider total-chapter counts.</summary>
    public string? ChapterNumber { get; set; }

    /// <summary>
    /// Compatibility year retained for existing provider contracts. Comic matching must use
    /// <see cref="SeriesStartYear"/> and <see cref="IssuePublicationYear"/> instead.
    /// </summary>
    public int? Year { get; set; }

    /// <summary>The first year of the comic series run, not this issue's cover/publication year.</summary>
    public int? SeriesStartYear { get; set; }

    /// <summary>The cover/publication year of this issue, distinct from the series run.</summary>
    public int? IssuePublicationYear { get; set; }

    /// <summary>The cover/publication date of this issue when authoritative local metadata provides it.</summary>
    public DateTimeOffset? IssuePublicationDate { get; set; }

    public PtvReadingIdentityEvidenceSource IssuePublicationEvidence { get; set; }

    public PtvReadingIdentityEvidenceSource SeriesStartYearEvidence { get; set; }

    public bool FolderCorroboratesSeriesTitle { get; set; }

    public bool FolderCorroboratesSeriesStartYear { get; set; }

    public List<PtvReadingIdentityConflict> IdentityConflicts { get; set; } = [];

    public string? Author { get; set; }

    public string? Isbn { get; set; }

    public string? OriginalLanguage { get; set; }

    public PtvReadingMediaClass MediaClass { get; set; } = PtvReadingMediaClass.Unknown;

    public PtvReadingEditionKind EditionKind { get; set; } = PtvReadingEditionKind.Standard;

    /// <summary>Provenance for an explicitly detected local edition marker.</summary>
    public PtvReadingIdentityEvidenceSource EditionKindEvidence { get; set; }

    public PtvReadingProviderIdentifier? ProviderId { get; set; }

    public Dictionary<string, string> ExistingProviderIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public List<string> AlternateTitles { get; set; } = [];

    public List<string> IgnoredFilenameTokens { get; set; } = [];

    public PtvReadingMediaClassification Classification { get; set; } = new();
}

/// <summary>One normalized creator contribution.</summary>
public sealed class PtvReadingPersonCredit
{
    public string Name { get; set; } = string.Empty;

    public string? Role { get; set; }

    public string? ProviderId { get; set; }
}

/// <summary>One stable, explainable score contribution.</summary>
public sealed class PtvReadingMatchScoreReason
{
    public string Code { get; set; } = string.Empty;

    public int Impact { get; set; }

    public bool IsPositive => Impact > 0;

    public string Message { get; set; } = string.Empty;

    public string? Evidence { get; set; }
}

/// <summary>A safe normalized result shared by every Reading metadata provider.</summary>
public sealed class PtvNormalizedMetadataCandidate
{
    public string Provider { get; set; } = string.Empty;

    public string ProviderId { get; set; } = string.Empty;

    public PtvReadingMediaClass MediaClass { get; set; } = PtvReadingMediaClass.Unknown;

    public string Title { get; set; } = string.Empty;

    public List<string> AlternateTitles { get; set; } = [];

    /// <summary>Localized provider titles keyed by BCP-47-like provider language code.</summary>
    public Dictionary<string, string> LocalizedTitles { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public string? SeriesTitle { get; set; }

    public PtvReadingIdentityEvidenceSource SeriesTitleEvidence { get; set; }

    /// <summary>The provider record's issue identity, not the local item's issue.</summary>
    public string? IssueNumber { get; set; }

    public PtvReadingIdentityEvidenceSource IssueNumberEvidence { get; set; }

    /// <summary>The provider record's edition identity when explicitly present in provider data.</summary>
    public PtvReadingEditionKind EditionKind { get; set; } = PtvReadingEditionKind.Standard;

    /// <summary>Provenance for <see cref="EditionKind"/>; Unknown means Standard was only the default.</summary>
    public PtvReadingIdentityEvidenceSource EditionKindEvidence { get; set; }

    /// <summary>The provider record's volume identity, not total volumes and not the local item's volume.</summary>
    public string? VolumeNumber { get; set; }

    /// <summary>The provider record's chapter identity, not total chapters and not the local item's chapter.</summary>
    public string? ChapterNumber { get; set; }

    /// <summary>
    /// Compatibility year used by non-comic providers. Comic candidates store the issue
    /// publication year here as well as in <see cref="IssuePublicationYear"/>.
    /// </summary>
    public int? Year { get; set; }

    /// <summary>The first year of the provider series/run. Never inferred from an issue cover date.</summary>
    public int? StartYear { get; set; }

    public PtvReadingIdentityEvidenceSource SeriesStartYearEvidence { get; set; }

    public int? EndYear { get; set; }

    /// <summary>The issue cover/publication year.</summary>
    public int? IssuePublicationYear { get; set; }

    /// <summary>The issue cover/publication date.</summary>
    public DateTimeOffset? IssuePublicationDate { get; set; }

    public PtvReadingIdentityEvidenceSource IssuePublicationEvidence { get; set; }

    /// <summary>Immutable provider volume identity when the provider exposes one.</summary>
    public string? VolumeId { get; set; }

    public string? Description { get; set; }

    public List<PtvReadingPersonCredit> Authors { get; set; } = [];

    public List<PtvReadingPersonCredit> Artists { get; set; } = [];

    public List<string> Genres { get; set; } = [];

    public List<string> Tags { get; set; } = [];

    public string? Publisher { get; set; }

    public string? CountryOfOrigin { get; set; }

    public string? Language { get; set; }

    public string? Status { get; set; }

    public int? TotalVolumes { get; set; }

    public int? TotalChapters { get; set; }

    public string? Isbn10 { get; set; }

    public string? Isbn13 { get; set; }

    public string? CoverUrl { get; set; }

    public string? BannerUrl { get; set; }

    public Dictionary<string, string> ExternalIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public string? SourceUrl { get; set; }

    public int? Score { get; set; }

    public List<PtvReadingMatchScoreReason> ScoreReasons { get; set; } = [];

    /// <summary>Provider payloads are server-internal and never serialized to the browser.</summary>
    [JsonIgnore]
    public object? RawProviderMetadata { get; set; }

    /// <summary>Creates a bounded, transport-safe copy and strips any raw provider payload.</summary>
    public PtvNormalizedMetadataCandidate ToBoundedTransportModel()
    {
        return new PtvNormalizedMetadataCandidate
        {
            Provider = Bound(Provider, PtvReadingMetadataLimits.MaximumIdentifierLength),
            ProviderId = Bound(ProviderId, PtvReadingMetadataLimits.MaximumIdentifierLength),
            MediaClass = MediaClass,
            Title = Bound(Title, PtvReadingMetadataLimits.MaximumTitleLength),
            AlternateTitles = BoundStrings(AlternateTitles, PtvReadingMetadataLimits.MaximumTitleLength),
            LocalizedTitles = BoundDictionary(LocalizedTitles, PtvReadingMetadataLimits.MaximumTitleLength),
            SeriesTitle = BoundNullable(SeriesTitle, PtvReadingMetadataLimits.MaximumTitleLength),
            SeriesTitleEvidence = SeriesTitleEvidence,
            IssueNumber = BoundNullable(IssueNumber, 32),
            IssueNumberEvidence = IssueNumberEvidence,
            EditionKind = EditionKind,
            EditionKindEvidence = EditionKindEvidence,
            VolumeNumber = BoundNullable(VolumeNumber, 32),
            ChapterNumber = BoundNullable(ChapterNumber, 32),
            Year = Year,
            StartYear = StartYear,
            SeriesStartYearEvidence = SeriesStartYearEvidence,
            EndYear = EndYear,
            IssuePublicationYear = IssuePublicationYear,
            IssuePublicationDate = IssuePublicationDate,
            IssuePublicationEvidence = IssuePublicationEvidence,
            VolumeId = BoundNullable(VolumeId, PtvReadingMetadataLimits.MaximumIdentifierLength),
            Description = BoundNullable(Description, PtvReadingMetadataLimits.MaximumDescriptionLength),
            Authors = BoundCredits(Authors),
            Artists = BoundCredits(Artists),
            Genres = BoundStrings(Genres, 128),
            Tags = BoundStrings(Tags, 128),
            Publisher = BoundNullable(Publisher, PtvReadingMetadataLimits.MaximumTitleLength),
            CountryOfOrigin = BoundNullable(CountryOfOrigin, 64),
            Language = BoundNullable(Language, 64),
            Status = BoundNullable(Status, 64),
            TotalVolumes = TotalVolumes,
            TotalChapters = TotalChapters,
            Isbn10 = BoundNullable(Isbn10, 32),
            Isbn13 = BoundNullable(Isbn13, 32),
            CoverUrl = SafeHttpUrl(CoverUrl),
            BannerUrl = SafeHttpUrl(BannerUrl),
            ExternalIds = BoundDictionary(ExternalIds, PtvReadingMetadataLimits.MaximumIdentifierLength),
            SourceUrl = SafeHttpUrl(SourceUrl),
            Score = Score is null ? null : Math.Clamp(Score.Value, 0, 100),
            ScoreReasons = (ScoreReasons ?? []).Where(reason => reason is not null)
                .Take(PtvReadingMetadataLimits.MaximumCollectionItems)
                .Select(reason => new PtvReadingMatchScoreReason
                {
                    Code = Bound(reason.Code, 128),
                    Impact = Math.Clamp(reason.Impact, -100, 100),
                    Message = Bound(reason.Message, 512),
                    Evidence = BoundNullable(reason.Evidence, 512)
                })
                .ToList()
        };
    }

    private static string Bound(string? value, int maximumLength)
    {
        var normalized = value?.Trim() ?? string.Empty;
        return normalized.Length <= maximumLength ? normalized : normalized[..maximumLength];
    }

    private static string? BoundNullable(string? value, int maximumLength)
    {
        var bounded = Bound(value, maximumLength);
        return bounded.Length == 0 ? null : bounded;
    }

    private static List<string> BoundStrings(IEnumerable<string>? values, int maximumLength)
    {
        return (values ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => Bound(value, maximumLength))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(PtvReadingMetadataLimits.MaximumCollectionItems)
            .ToList();
    }

    private static List<PtvReadingPersonCredit> BoundCredits(IEnumerable<PtvReadingPersonCredit>? credits)
    {
        return (credits ?? [])
            .Where(credit => credit is not null && !string.IsNullOrWhiteSpace(credit.Name))
            .Take(PtvReadingMetadataLimits.MaximumCollectionItems)
            .Select(credit => new PtvReadingPersonCredit
            {
                Name = Bound(credit.Name, PtvReadingMetadataLimits.MaximumTitleLength),
                Role = BoundNullable(credit.Role, 128),
                ProviderId = BoundNullable(credit.ProviderId, PtvReadingMetadataLimits.MaximumIdentifierLength)
            })
            .ToList();
    }

    private static Dictionary<string, string> BoundDictionary(
        IEnumerable<KeyValuePair<string, string>>? values,
        int maximumValueLength)
    {
        var bounded = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in (values ?? []).Where(pair => !string.IsNullOrWhiteSpace(pair.Key) && !string.IsNullOrWhiteSpace(pair.Value)))
        {
            var key = Bound(pair.Key, 64);
            if (bounded.ContainsKey(key))
            {
                continue;
            }

            bounded[key] = Bound(pair.Value, maximumValueLength);
            if (bounded.Count >= PtvReadingMetadataLimits.MaximumExternalIds)
            {
                break;
            }
        }

        return bounded;
    }

    private static string? SafeHttpUrl(string? value)
    {
        return PtvReadingUrlSafety.HttpUrl(value, PtvReadingMetadataLimits.MaximumUrlLength);
    }
}

/// <summary>Safe provider health state returned without secrets or exception details.</summary>
public sealed class PtvReadingProviderStatus
{
    public string Provider { get; set; } = string.Empty;

    public PtvReadingProviderState State { get; set; } = PtvReadingProviderState.Unknown;

    public string? Message { get; set; }

    public int? RetryAfterSeconds { get; set; }
}

/// <summary>Normalized provider failure safe for the admin UI.</summary>
public sealed class PtvReadingProviderFailure
{
    public string Provider { get; set; } = string.Empty;

    public PtvReadingProviderFailureKind Kind { get; set; } = PtvReadingProviderFailureKind.Unknown;

    public string Code { get; set; } = string.Empty;

    public string Message { get; set; } = string.Empty;

    public int? RetryAfterSeconds { get; set; }
}

/// <summary>One independently settled provider result.</summary>
public sealed class PtvReadingProviderSearchResult
{
    public string Provider { get; set; } = string.Empty;

    public PtvReadingProviderState State { get; set; } = PtvReadingProviderState.Unknown;

    public List<PtvNormalizedMetadataCandidate> Candidates { get; set; } = [];

    public PtvReadingProviderFailure? Failure { get; set; }

    public long DurationMilliseconds { get; set; }

    public bool CacheHit { get; set; }
}

/// <summary>Deterministic score and explanation for one candidate.</summary>
public sealed class PtvReadingCandidateScore
{
    public int Score { get; set; }

    public string Confidence { get; set; } = "weak";

    public bool HasHardConflict { get; set; }

    /// <summary>An explicit issue or comic-run contradiction makes this candidate unsafe to suggest.</summary>
    public bool IsRejected { get; set; }

    public List<PtvReadingMatchScoreReason> Reasons { get; set; } = [];
}

/// <summary>A candidate paired with its deterministic ranking evidence.</summary>
public sealed class PtvRankedMetadataCandidate
{
    public required PtvNormalizedMetadataCandidate Candidate { get; init; }

    public required PtvReadingCandidateScore Match { get; init; }
}
