using System.Text.Json;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>Stable Metadata Quality persistence and scanner contracts.</summary>
public static class PtvMetadataQualityConstants
{
    /// <summary>Current on-disk document schema.</summary>
    public const int SchemaVersion = 1;

    /// <summary>Current scanner implementation version.</summary>
    public const string ScannerVersion = "3";

    /// <summary>Current deterministic rule-set version.</summary>
    public const string RuleVersion = "3";

    /// <summary>Maximum number of stored scan runs.</summary>
    public const int MaximumRunHistory = 20;

    /// <summary>Maximum result page size exposed by the API.</summary>
    public const int MaximumPageSize = 50;

    /// <summary>Safe code fallback when no server or environment model is configured.</summary>
    public const string DefaultOpenAiModel = "gpt-5.6-luna";

    /// <summary>Maximum accepted length of an opaque OpenAI API model identifier.</summary>
    public const int MaximumOpenAiModelLength = 256;
}

/// <summary>Stable, non-secret OpenAI credential source values.</summary>
public static class PtvMetadataAiCredentialSources
{
    public const string Environment = "environment";
    public const string Missing = "missing";
}

/// <summary>Stable effective-model source values.</summary>
public static class PtvMetadataAiModelSources
{
    public const string Environment = "environment";
    public const string Settings = "settings";
    public const string Default = "default";
    public const string Invalid = "invalid";
}

/// <summary>Stable normalized OpenAI operation states and error codes.</summary>
public static class PtvMetadataAiErrorCodes
{
    public const string Success = "success";
    public const string Failure = "failure";
    public const string MissingCredential = "missing-credential";
    public const string InvalidCredential = "invalid-credential";
    public const string PermissionDenied = "permission-denied";
    public const string ModelUnavailable = "model-unavailable";
    public const string InvalidModel = "invalid-model";
    public const string QuotaUnavailable = "quota-unavailable";
    public const string RateLimited = "rate-limited";
    public const string Timeout = "timeout";
    public const string ApiUnavailable = "api-unavailable";
    public const string MalformedResponse = "malformed-response";
    public const string ResponseTooLarge = "response-too-large";
    public const string Refused = "refused";
    public const string TestInProgress = "test-in-progress";
    public const string UnknownFailure = "unknown-failure";
}

/// <summary>Stable Metadata Quality status values.</summary>
public static class PtvMetadataQualityStatuses
{
    public const string Healthy = "healthy";
    public const string Review = "review";
    public const string LikelyWrong = "likely_wrong";
    public const string Incomplete = "incomplete";
    public const string Unavailable = "unavailable";
}

/// <summary>Stable Metadata Quality scan states.</summary>
public static class PtvMetadataQualityScanStates
{
    public const string Idle = "idle";
    public const string Running = "running";
    public const string Completed = "completed";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";
    public const string Interrupted = "interrupted";
}

/// <summary>Stable rule and operational reason codes.</summary>
public static class PtvMetadataQualityReasonCodes
{
    public const string TitleMismatch = "TITLE_MISMATCH";
    public const string YearMismatch = "YEAR_MISMATCH";
    public const string RuntimeMismatch = "RUNTIME_MISMATCH";
    public const string ProviderIdMissing = "PROVIDER_ID_MISSING";
    public const string ProviderIdConflict = "PROVIDER_ID_CONFLICT";
    public const string DuplicateProviderId = "DUPLICATE_PROVIDER_ID";
    public const string MediaTypeConflict = "MEDIA_TYPE_CONFLICT";
    public const string EpisodeNumberConflict = "EPISODE_NUMBER_CONFLICT";
    public const string SeasonNumberConflict = "SEASON_NUMBER_CONFLICT";
    public const string FilenameConflict = "FILENAME_CONFLICT";
    public const string FolderConflict = "FOLDER_CONFLICT";
    public const string MissingArtwork = "MISSING_ARTWORK";
    public const string MissingYear = "MISSING_YEAR";
    public const string MissingOverview = "MISSING_OVERVIEW";
    public const string BetterProviderCandidate = "BETTER_PROVIDER_CANDIDATE";
    public const string AiAmbiguous = "AI_AMBIGUOUS";
    public const string ProviderLookupFailed = "PROVIDER_LOOKUP_FAILED";
    public const string ItemAnalysisFailed = "ITEM_ANALYSIS_FAILED";
}

/// <summary>A safe bounded provider candidate used by both provider and AI stages.</summary>
public sealed class PtvMetadataMatchSummary
{
    public string Name { get; set; } = string.Empty;

    public int? ProductionYear { get; set; }

    /// <summary>The provider-neutral Reading media class used by comic/manga identification.</summary>
    public PtvReadingMediaClass MediaClass { get; set; } = PtvReadingMediaClass.Unknown;

    public PtvReadingEditionKind EditionKind { get; set; } = PtvReadingEditionKind.Standard;

    public PtvReadingIdentityEvidenceSource EditionKindEvidence { get; set; }

    /// <summary>Structured Reading series/run identity. This is never inferred from a provider slug.</summary>
    public string? SeriesTitle { get; set; }

    public PtvReadingIdentityEvidenceSource SeriesTitleEvidence { get; set; }

    /// <summary>True when the provider result inherited the bounded search scope rather than returning a series title.</summary>
    public bool SeriesTitleFromSearchContext { get; set; }

    /// <summary>Normalized issue identity, preserving decimal and suffix semantics where supported.</summary>
    public string? NormalizedIssueNumber { get; set; }

    public PtvReadingIdentityEvidenceSource IssueNumberEvidence { get; set; }

    /// <summary>Physical/local volume numbering; distinct from an immutable provider run identifier.</summary>
    public string? VolumeNumber { get; set; }

    /// <summary>The year the series run began; distinct from an issue's publication year.</summary>
    public int? SeriesStartYear { get; set; }

    public PtvReadingIdentityEvidenceSource SeriesStartYearEvidence { get; set; }

    /// <summary>The issue publication year; distinct from the series run's start year.</summary>
    public int? IssuePublicationYear { get; set; }

    public DateTimeOffset? IssuePublicationDate { get; set; }

    public PtvReadingIdentityEvidenceSource IssuePublicationEvidence { get; set; }

    public string? Publisher { get; set; }

    /// <summary>Provider-neutral volume/run identity when it is authoritatively available.</summary>
    public string? VolumeId { get; set; }

    public string? ProviderName { get; set; }

    public string? Type { get; set; }

    /// <summary>Whether <see cref="Type"/> came from an authoritative typed provider contract.</summary>
    public bool TypeVerified { get; set; }

    public double? RuntimeMinutes { get; set; }

    public Dictionary<string, string> ProviderIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>Minimal, path-reduced item evidence used by the scanner.</summary>
public sealed class PtvMetadataQualityAnalysisItem
{
    public Guid ItemId { get; set; }

    public Guid? LibraryId { get; set; }

    public string? LibraryName { get; set; }

    public string ItemType { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? OriginalTitle { get; set; }

    public string? FileName { get; set; }

    public string? FolderName { get; set; }

    public int? ProductionYear { get; set; }

    public long? RunTimeTicks { get; set; }

    public int? IndexNumber { get; set; }

    public int? IndexNumberEnd { get; set; }

    public int? ParentIndexNumber { get; set; }

    public string? SeriesName { get; set; }

    public string? SeriesTitle { get; set; }

    public PtvReadingIdentityEvidenceSource SeriesTitleEvidence { get; set; }

    public string? NormalizedIssueNumber { get; set; }

    public PtvReadingIdentityEvidenceSource IssueNumberEvidence { get; set; }

    public int? SeriesStartYear { get; set; }

    public PtvReadingIdentityEvidenceSource SeriesStartYearEvidence { get; set; }

    public int? IssuePublicationYear { get; set; }

    public DateTimeOffset? IssuePublicationDate { get; set; }

    public PtvReadingIdentityEvidenceSource IssuePublicationEvidence { get; set; }

    public bool FolderCorroboratesSeriesTitle { get; set; }

    public bool FolderCorroboratesSeriesStartYear { get; set; }

    public List<PtvReadingIdentityConflict> IdentityConflicts { get; set; } = [];

    public PtvReadingMediaClass ReadingMediaClass { get; set; } = PtvReadingMediaClass.Unknown;

    public PtvReadingEditionKind ReadingEditionKind { get; set; } = PtvReadingEditionKind.Standard;

    public PtvReadingIdentityEvidenceSource ReadingEditionKindEvidence { get; set; }

    public string? Publisher { get; set; }

    /// <summary>Physical/local volume numbering parsed from the item.</summary>
    public string? VolumeNumber { get; set; }

    /// <summary>Immutable provider run identity. Never populated from a physical volume number.</summary>
    public string? VolumeId { get; set; }

    public bool IsSpecial { get; set; }

    public bool HasPrimaryImage { get; set; }

    public bool HasBackdropImage { get; set; }

    public bool HasOverview { get; set; }

    public DateTimeOffset? DateModified { get; set; }

    public DateTimeOffset? DateLastSaved { get; set; }

    public Dictionary<string, string> ProviderIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>Normalized signals produced without external provider access.</summary>
public sealed class PtvMetadataQualitySignals
{
    public double? FilenameTitleSimilarity { get; set; }

    public double? FolderTitleSimilarity { get; set; }

    public int? FilenameYear { get; set; }

    public int? YearDifference { get; set; }

    public double? RuntimeDifferencePercent { get; set; }

    public bool ProviderIdPresent { get; set; }

    public bool ProviderIdConflict { get; set; }

    public bool ItemTypeConflict { get; set; }

    public bool SeasonConflict { get; set; }

    public bool EpisodeConflict { get; set; }

    public bool MissingPrimaryImage { get; set; }

    public bool MissingOverview { get; set; }

    public int? CandidateCount { get; set; }
}

/// <summary>One explainable deterministic or verification finding.</summary>
public sealed class PtvMetadataQualityReason
{
    public string Code { get; set; } = string.Empty;

    public string Severity { get; set; } = "info";

    public int ScoreImpact { get; set; }

    public string Message { get; set; } = string.Empty;

    public string? Evidence { get; set; }
}

/// <summary>Result of deterministic rules before provider and AI enrichment.</summary>
public sealed class PtvMetadataQualityRuleResult
{
    public int MatchConfidence { get; set; } = 100;

    public int CompletenessScore { get; set; } = 100;

    public bool HasHardConflict { get; set; }

    public PtvMetadataQualitySignals Signals { get; set; } = new();

    public List<PtvMetadataQualityReason> Reasons { get; set; } = [];
}

/// <summary>Request supplied to the server-owned provider-verification adapter.</summary>
public sealed class PtvMetadataProviderVerificationRequest
{
    public Guid ItemId { get; set; }

    public string ItemType { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? OriginalTitle { get; set; }

    public int? ProductionYear { get; set; }

    public PtvReadingMediaClass MediaClass { get; set; } = PtvReadingMediaClass.Unknown;

    public PtvReadingEditionKind EditionKind { get; set; } = PtvReadingEditionKind.Standard;

    public PtvReadingIdentityEvidenceSource EditionKindEvidence { get; set; }

    public string? SeriesTitle { get; set; }

    public PtvReadingIdentityEvidenceSource SeriesTitleEvidence { get; set; }

    public string? NormalizedIssueNumber { get; set; }

    public PtvReadingIdentityEvidenceSource IssueNumberEvidence { get; set; }

    public string? VolumeNumber { get; set; }

    public int? SeriesStartYear { get; set; }

    public PtvReadingIdentityEvidenceSource SeriesStartYearEvidence { get; set; }

    public int? IssuePublicationYear { get; set; }

    public DateTimeOffset? IssuePublicationDate { get; set; }

    public PtvReadingIdentityEvidenceSource IssuePublicationEvidence { get; set; }

    public string? Publisher { get; set; }

    public string? VolumeId { get; set; }

    public Dictionary<string, string> ProviderIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Path-derived, privacy-reduced title evidence used for a bounded alternate search.</summary>
    public string? EvidenceName { get; set; }

    /// <summary>Path-derived production year evidence used for a bounded alternate search.</summary>
    public int? EvidenceYear { get; set; }
}

/// <summary>Thread-safe per-run logical provider-request budget.</summary>
public sealed class PtvMetadataProviderVerificationBudget
{
    private int _consumed;

    public PtvMetadataProviderVerificationBudget(int maximumLogicalRequests)
    {
        MaximumLogicalRequests = Math.Max(0, maximumLogicalRequests);
    }

    public int MaximumLogicalRequests { get; }

    public int Consumed => Math.Min(MaximumLogicalRequests, Volatile.Read(ref _consumed));

    public int Remaining => Math.Max(0, MaximumLogicalRequests - Consumed);

    public bool TryConsume()
    {
        while (true)
        {
            var current = Volatile.Read(ref _consumed);
            if (current >= MaximumLogicalRequests) return false;
            if (Interlocked.CompareExchange(ref _consumed, current + 1, current) == current) return true;
        }
    }
}

/// <summary>Bounded provider-verification result.</summary>
public sealed class PtvMetadataProviderVerificationResult
{
    public bool Available { get; set; }

    public bool Attempted { get; set; }

    public bool CacheHit { get; set; }

    public string? ErrorCode { get; set; }

    public int LogicalRequestCount { get; set; }

    public List<PtvMetadataMatchSummary> Candidates { get; set; } = [];
}

/// <summary>Minimal untrusted-data payload supplied to the optional AI analyzer.</summary>
public sealed class PtvMetadataAiAnalysisInput
{
    public string ItemType { get; set; } = string.Empty;

    public string CurrentTitle { get; set; } = string.Empty;

    public int? CurrentYear { get; set; }

    public long? RunTimeTicks { get; set; }

    public string? FileName { get; set; }

    public string? FolderName { get; set; }

    public Dictionary<string, string> CurrentProviderIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public List<string> DeterministicReasonCodes { get; set; } = [];

    public bool HasHardConflict { get; set; }

    public List<PtvMetadataMatchSummary> VerifiedCandidates { get; set; } = [];
}

/// <summary>Schema-validated optional AI analysis.</summary>
public sealed class PtvMetadataAiAnalysisResult
{
    public bool Reviewed { get; set; }

    public int? Confidence { get; set; }

    public string? Classification { get; set; }

    public List<string> ReasonCodes { get; set; } = [];

    public string? Summary { get; set; }

    public int? SuggestedCandidateIndex { get; set; }

    public string? ErrorCode { get; set; }

    public string? Provider { get; set; }

    public string? Model { get; set; }

    public string? PromptVersion { get; set; }
}

/// <summary>Latest quality assessment for one immutable Jellyfin item ID.</summary>
public sealed class PtvMetadataQualityResult
{
    public Guid ItemId { get; set; }

    public Guid? LibraryId { get; set; }

    public string? LibraryName { get; set; }

    public string ItemType { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string? FileName { get; set; }

    public string? FolderName { get; set; }

    public string ScanFingerprint { get; set; } = string.Empty;

    public DateTimeOffset ScannedAt { get; set; }

    public string ScannerVersion { get; set; } = PtvMetadataQualityConstants.ScannerVersion;

    public string RuleVersion { get; set; } = PtvMetadataQualityConstants.RuleVersion;

    public string Status { get; set; } = PtvMetadataQualityStatuses.Healthy;

    public int MatchConfidence { get; set; } = 100;

    public int CompletenessScore { get; set; } = 100;

    public int RuleScore { get; set; } = 100;

    public int? ProviderScore { get; set; }

    public int? AiScore { get; set; }

    public PtvMetadataQualitySignals Signals { get; set; } = new();

    public List<PtvMetadataQualityReason> Reasons { get; set; } = [];

    public PtvMetadataMatchSummary? CurrentMatch { get; set; }

    public PtvMetadataMatchSummary? SuggestedMatch { get; set; }

    public List<PtvMetadataQualityCandidate> Candidates { get; set; } = [];

    public bool ProviderVerified { get; set; }

    public bool AiReviewed { get; set; }

    public string? AiProvider { get; set; }

    public string? AiModel { get; set; }

    public string? AiPromptVersion { get; set; }

    public bool Dismissed { get; set; }

    public DateTimeOffset? DismissedAt { get; set; }

    public string? DismissedFingerprint { get; set; }

    public string? DismissedReasonSignature { get; set; }

    public PtvMetadataQualityResolution? Resolution { get; set; }
}

/// <summary>Provider candidate with scanner ranking evidence.</summary>
public sealed class PtvMetadataQualityCandidate
{
    public string Name { get; set; } = string.Empty;

    public int? ProductionYear { get; set; }

    /// <summary>The provider-neutral Reading media class used by the review handoff.</summary>
    public PtvReadingMediaClass MediaClass { get; set; } = PtvReadingMediaClass.Unknown;

    public PtvReadingEditionKind EditionKind { get; set; } = PtvReadingEditionKind.Standard;

    public PtvReadingIdentityEvidenceSource EditionKindEvidence { get; set; }

    public string? SeriesTitle { get; set; }

    public PtvReadingIdentityEvidenceSource SeriesTitleEvidence { get; set; }

    public bool SeriesTitleFromSearchContext { get; set; }

    public string? NormalizedIssueNumber { get; set; }

    public PtvReadingIdentityEvidenceSource IssueNumberEvidence { get; set; }

    public string? VolumeNumber { get; set; }

    public int? SeriesStartYear { get; set; }

    public PtvReadingIdentityEvidenceSource SeriesStartYearEvidence { get; set; }

    public int? IssuePublicationYear { get; set; }

    public DateTimeOffset? IssuePublicationDate { get; set; }

    public PtvReadingIdentityEvidenceSource IssuePublicationEvidence { get; set; }

    public string? Publisher { get; set; }

    public string? VolumeId { get; set; }

    public string? Type { get; set; }

    public bool TypeVerified { get; set; }

    public double? RuntimeMinutes { get; set; }

    public Dictionary<string, string> ProviderIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public int? Score { get; set; }

    public string Confidence { get; set; } = "weak";

    public bool HasHardConflict { get; set; }

    public bool Rejected { get; set; }

    public List<PtvMetadataQualityReason> Reasons { get; set; } = [];

    public string? Source { get; set; }
}

/// <summary>Lightweight review resolution retained with the latest result.</summary>
public sealed class PtvMetadataQualityResolution
{
    public string State { get; set; } = string.Empty;

    public DateTimeOffset ResolvedAt { get; set; }

    public string? Fingerprint { get; set; }

    public string? PreviousStatus { get; set; }
}

/// <summary>Bounded aggregate record for a scan run.</summary>
public sealed class PtvMetadataQualityScanRun
{
    public Guid RunId { get; set; }

    public string Mode { get; set; } = "changed";

    public string State { get; set; } = PtvMetadataQualityScanStates.Idle;

    public DateTimeOffset StartedAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    public int ItemsConsidered { get; set; }

    /// <summary>Total number of items reported by Jellyfin for the selected libraries.</summary>
    public int ItemCount { get; set; }

    public int ItemsScanned { get; set; }

    public int ItemsSkipped { get; set; }

    public int Healthy { get; set; }

    public int Review { get; set; }

    public int LikelyWrong { get; set; }

    public int Incomplete { get; set; }

    public int Unavailable { get; set; }

    public int ProviderRequests { get; set; }

    public int ProviderCacheHits { get; set; }

    public int AiRequests { get; set; }

    public int AiEligible { get; set; }

    public int AiAnalyzed { get; set; }

    public int AiSkipped { get; set; }

    public int AiFailures { get; set; }

    public int AiBudgetSkipped { get; set; }

    public int AiCircuitSkipped { get; set; }

    public string? AiErrorCode { get; set; }

    public int Errors { get; set; }

    public double ProgressPercent { get; set; }

    public string? ErrorCode { get; set; }
}

/// <summary>Versioned durable Metadata Quality state.</summary>
public sealed class PtvMetadataQualityDocument
{
    public int SchemaVersion { get; set; } = PtvMetadataQualityConstants.SchemaVersion;

    public string ScannerVersion { get; set; } = PtvMetadataQualityConstants.ScannerVersion;

    public string RuleVersion { get; set; } = PtvMetadataQualityConstants.RuleVersion;

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset? LastFullScan { get; set; }

    public DateTimeOffset? LastIncrementalScan { get; set; }

    public Dictionary<string, PtvMetadataQualityResult> ItemResults { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public List<PtvMetadataQualityScanRun> ScanRuns { get; set; } = [];
}

/// <summary>Server-owned Metadata Quality settings; secrets are intentionally absent.</summary>
public sealed class PtvMetadataQualitySettings
{
    public int SchemaVersion { get; set; } = PtvMetadataQualityConstants.SchemaVersion;

    /// <summary>Optimistic-concurrency revision incremented by the authoritative settings store.</summary>
    public long Revision { get; set; }

    public bool Enabled { get; set; } = true;

    public bool ScheduledIncrementalScan { get; set; } = true;

    /// <summary>Runtime-only compatibility projection; never persisted with settings.</summary>
    [JsonIgnore]
    public bool AiConfigured { get; set; }

    public int ReviewThreshold { get; set; } = 70;

    public int LikelyWrongThreshold { get; set; } = 50;

    public bool ProviderVerificationEnabled { get; set; } = true;

    public int ProviderVerificationThreshold { get; set; } = 85;

    public int ProviderMaximumRequestsPerRun { get; set; } = 250;

    public bool AiEnabled { get; set; }

    public string AiModel { get; set; } = PtvMetadataQualityConstants.DefaultOpenAiModel;

    public int AiThreshold { get; set; } = 70;

    public int AiMinimumConfidence { get; set; } = 35;

    public int AiMaxItemsPerRun { get; set; } = 100;

    public List<Guid> SelectedLibraryIds { get; set; } = [];

    /// <summary>Forward-compatible fields retained from the authoritative settings document.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtensionData { get; set; }
}

/// <summary>Optional model override for a synthetic OpenAI connection test.</summary>
public sealed class PtvMetadataAiConnectionTestRequest
{
    public string? Model { get; set; }
}

/// <summary>Safe normalized result of a synthetic server-side OpenAI connection test.</summary>
public sealed class PtvMetadataAiConnectionTestResponse
{
    public bool Success { get; set; }

    public string Status { get; set; } = PtvMetadataAiErrorCodes.UnknownFailure;

    public string? ErrorCode { get; set; }

    public string Message { get; set; } = string.Empty;

    public string? Model { get; set; }

    public DateTimeOffset TestedAt { get; set; }

    public long? LatencyMilliseconds { get; set; }
}

/// <summary>Non-secret OpenAI readiness projection nested in Metadata Quality status.</summary>
public sealed class PtvMetadataAiStatusResponse
{
    public bool Enabled { get; set; }

    public bool CredentialConfigured { get; set; }

    public string CredentialSource { get; set; } = PtvMetadataAiCredentialSources.Missing;

    public string ConfiguredModel { get; set; } = PtvMetadataQualityConstants.DefaultOpenAiModel;

    public string? EffectiveModel { get; set; }

    public string ModelSource { get; set; } = PtvMetadataAiModelSources.Default;

    public string? LastTestStatus { get; set; }

    public DateTimeOffset? LastTestAt { get; set; }

    public string? LastTestErrorCode { get; set; }

    public string? LastTestModel { get; set; }
}

/// <summary>Starts a bounded scanner run.</summary>
public sealed class PtvMetadataQualityScanRequest
{
    public string Mode { get; set; } = "changed";

    public List<Guid>? LibraryIds { get; set; }
}

/// <summary>Resolves or dismisses the current finding without changing Jellyfin metadata.</summary>
public sealed class PtvMetadataQualityResolveRequest
{
    public string Action { get; set; } = string.Empty;
}

/// <summary>Explicit confirmation for replacing the derived Metadata Quality index.</summary>
public sealed class PtvMetadataQualityIndexRebuildRequest
{
    public bool Confirm { get; set; }
}

/// <summary>Filtered paginated result query.</summary>
public sealed class PtvMetadataQualityResultQuery
{
    public string? Status { get; set; }

    public Guid? LibraryId { get; set; }

    public string? ItemType { get; set; }

    public int? MinConfidence { get; set; }

    public int? MaxConfidence { get; set; }

    public string? Reason { get; set; }

    public bool? AiReviewed { get; set; }

    public string? Provider { get; set; }

    public string? Search { get; set; }

    public string? Sort { get; set; }

    public int StartIndex { get; set; }

    public int Limit { get; set; } = PtvMetadataQualityConstants.MaximumPageSize;
}

/// <summary>Paginated Metadata Quality result response.</summary>
public sealed class PtvMetadataQualityResultsResponse
{
    public int TotalRecordCount { get; set; }

    public int StartIndex { get; set; }

    public int Limit { get; set; } = PtvMetadataQualityConstants.MaximumPageSize;

    public List<PtvMetadataQualityResultSummary> Items { get; set; } = [];

    public PtvMetadataQualityRequestDiagnostics Diagnostics { get; set; } = new();
}

/// <summary>Bounded list-row projection; full evidence and candidates are detail-only.</summary>
public sealed class PtvMetadataQualityResultSummary
{
    public Guid ItemId { get; set; }

    public Guid? LibraryId { get; set; }

    public string? LibraryName { get; set; }

    public string ItemType { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string? FileName { get; set; }

    public string? FolderName { get; set; }

    public DateTimeOffset ScannedAt { get; set; }

    public string Status { get; set; } = PtvMetadataQualityStatuses.Healthy;

    public int MatchConfidence { get; set; }

    public int CompletenessScore { get; set; }

    public PtvMetadataMatchSummary? CurrentMatch { get; set; }

    public PtvMetadataMatchSummary? SuggestedMatch { get; set; }

    public List<PtvMetadataQualityReason> Reasons { get; set; } = [];

    public bool ProviderVerified { get; set; }

    public bool AiReviewed { get; set; }

    public PtvMetadataQualityResolution? Resolution { get; set; }
}

/// <summary>Cheap status and aggregate summary response.</summary>
public sealed class PtvMetadataQualitySummaryResponse
{
    public PtvMetadataQualityCounts Counts { get; set; } = new();

    public DateTimeOffset? LastScanAt { get; set; }

    public List<PtvMetadataQualityLibrarySummary> Libraries { get; set; } = [];

    public string RuleVersion { get; set; } = PtvMetadataQualityConstants.RuleVersion;

    public string ScannerVersion { get; set; } = PtvMetadataQualityConstants.ScannerVersion;

    public PtvMetadataQualityScanProgress Scan { get; set; } = new();

    public PtvMetadataQualityRequestDiagnostics Diagnostics { get; set; } = new();
}

/// <summary>Privacy-safe stage timing and operation counts for one admin read request.</summary>
public sealed class PtvMetadataQualityRequestDiagnostics
{
    public string CacheState { get; set; } = "unknown";

    public double TotalMs { get; set; }

    public int PersistedResultsLoaded { get; set; }

    public int ItemsEvaluated { get; set; }

    public int RowsReturned { get; set; }

    public Dictionary<string, double> Stages { get; set; } = new(StringComparer.Ordinal);

    public Dictionary<string, long> Operations { get; set; } = new(StringComparer.Ordinal);
}

/// <summary>Cheap dashboard counts.</summary>
public sealed class PtvMetadataQualityCounts
{
    public int TotalScanned { get; set; }

    public int Healthy { get; set; }

    public int NeedsReview { get; set; }

    public int LikelyIncorrect { get; set; }

    public int Incomplete { get; set; }

    public int Unavailable { get; set; }

    public int Dismissed { get; set; }

    public int Resolved { get; set; }
}

/// <summary>Immutable library identity shown in scanner filters.</summary>
public sealed class PtvMetadataQualityLibrarySummary
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;
}

/// <summary>Current or latest scan progress for the UI.</summary>
public sealed class PtvMetadataQualityScanProgress
{
    public Guid? RunId { get; set; }

    public string State { get; set; } = PtvMetadataQualityScanStates.Idle;

    public string? Mode { get; set; }

    public DateTimeOffset? StartedAt { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    public int? ItemCount { get; set; }

    public int? ProcessedCount { get; set; }

    public string? ErrorMessage { get; set; }
}

/// <summary>Current scanner state.</summary>
public sealed class PtvMetadataQualityStatusResponse
{
    public string State { get; set; } = PtvMetadataQualityScanStates.Idle;

    public PtvMetadataQualityScanRun? ActiveRun { get; set; }

    public string? StoreErrorCode { get; set; }

    public bool ProviderVerificationEnabled { get; set; }

    public bool AiEnabled { get; set; }

    public bool AiConfigured { get; set; }

    public PtvMetadataAiStatusResponse Ai { get; set; } = new();
}

/// <summary>Stable operation response for scan and resolution commands.</summary>
public sealed class PtvMetadataQualityOperationResponse
{
    public bool Ok { get; set; }

    public string Code { get; set; } = string.Empty;

    public string Message { get; set; } = string.Empty;

    public Guid? RunId { get; set; }
}
