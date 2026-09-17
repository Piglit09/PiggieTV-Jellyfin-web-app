using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Shared detached API projections for legacy and indexed stores.</summary>
internal static class PtvMetadataQualityProjection
{
    internal static string GetDisplayStatus(PtvMetadataQualityResult result)
    {
        if (result.Dismissed) return "dismissed";
        if (result.Resolution?.State is "kept_current" or "corrected") return "resolved";
        return result.Status;
    }

    internal static int StatusPriority(string status) => status switch
    {
        PtvMetadataQualityStatuses.LikelyWrong => 0,
        PtvMetadataQualityStatuses.Review => 1,
        PtvMetadataQualityStatuses.Incomplete => 2,
        PtvMetadataQualityStatuses.Unavailable => 3,
        "dismissed" => 4,
        "resolved" => 5,
        _ => 6
    };

    internal static PtvMetadataQualityResultSummary ToResultSummary(PtvMetadataQualityResult result) => new()
    {
        ItemId = result.ItemId,
        LibraryId = result.LibraryId,
        LibraryName = result.LibraryName,
        ItemType = result.ItemType,
        Title = result.Title,
        FileName = result.FileName,
        FolderName = result.FolderName,
        ScannedAt = result.ScannedAt,
        Status = GetDisplayStatus(result),
        MatchConfidence = result.MatchConfidence,
        CompletenessScore = result.CompletenessScore,
        CurrentMatch = CloneMatch(result.CurrentMatch),
        SuggestedMatch = CloneMatch(result.SuggestedMatch),
        Reasons = result.Reasons.Take(3).Select(CloneReason).ToList(),
        ProviderVerified = result.ProviderVerified,
        AiReviewed = result.AiReviewed,
        Resolution = CloneResolution(result.Resolution)
    };

    internal static PtvMetadataQualityResult CloneResult(PtvMetadataQualityResult result) => new()
    {
        ItemId = result.ItemId,
        LibraryId = result.LibraryId,
        LibraryName = result.LibraryName,
        ItemType = result.ItemType,
        Title = result.Title,
        FileName = result.FileName,
        FolderName = result.FolderName,
        ScanFingerprint = result.ScanFingerprint,
        ScannedAt = result.ScannedAt,
        ScannerVersion = result.ScannerVersion,
        RuleVersion = result.RuleVersion,
        Status = result.Status,
        MatchConfidence = result.MatchConfidence,
        CompletenessScore = result.CompletenessScore,
        RuleScore = result.RuleScore,
        ProviderScore = result.ProviderScore,
        AiScore = result.AiScore,
        Signals = CloneSignals(result.Signals),
        Reasons = result.Reasons.Select(CloneReason).ToList(),
        CurrentMatch = CloneMatch(result.CurrentMatch),
        SuggestedMatch = CloneMatch(result.SuggestedMatch),
        Candidates = result.Candidates.Select(CloneCandidate).ToList(),
        ProviderVerified = result.ProviderVerified,
        AiReviewed = result.AiReviewed,
        AiProvider = result.AiProvider,
        AiModel = result.AiModel,
        AiPromptVersion = result.AiPromptVersion,
        Dismissed = result.Dismissed,
        DismissedAt = result.DismissedAt,
        DismissedFingerprint = result.DismissedFingerprint,
        DismissedReasonSignature = result.DismissedReasonSignature,
        Resolution = CloneResolution(result.Resolution)
    };

    internal static PtvMetadataQualitySignals CloneSignals(PtvMetadataQualitySignals signals) => new()
    {
        FilenameTitleSimilarity = signals.FilenameTitleSimilarity,
        FolderTitleSimilarity = signals.FolderTitleSimilarity,
        FilenameYear = signals.FilenameYear,
        YearDifference = signals.YearDifference,
        RuntimeDifferencePercent = signals.RuntimeDifferencePercent,
        ProviderIdPresent = signals.ProviderIdPresent,
        ProviderIdConflict = signals.ProviderIdConflict,
        ItemTypeConflict = signals.ItemTypeConflict,
        SeasonConflict = signals.SeasonConflict,
        EpisodeConflict = signals.EpisodeConflict,
        MissingPrimaryImage = signals.MissingPrimaryImage,
        MissingOverview = signals.MissingOverview,
        CandidateCount = signals.CandidateCount
    };

    internal static PtvMetadataQualityReason CloneReason(PtvMetadataQualityReason reason) => new()
    {
        Code = reason.Code,
        Severity = reason.Severity,
        ScoreImpact = reason.ScoreImpact,
        Message = reason.Message,
        Evidence = reason.Evidence
    };

    internal static PtvMetadataMatchSummary? CloneMatch(PtvMetadataMatchSummary? match) => match is null ? null : new()
    {
        Name = match.Name,
        ProductionYear = match.ProductionYear,
        MediaClass = match.MediaClass,
        EditionKind = match.EditionKind,
        EditionKindEvidence = match.EditionKindEvidence,
        SeriesTitle = match.SeriesTitle,
        SeriesTitleEvidence = match.SeriesTitleEvidence,
        SeriesTitleFromSearchContext = match.SeriesTitleFromSearchContext,
        NormalizedIssueNumber = match.NormalizedIssueNumber,
        IssueNumberEvidence = match.IssueNumberEvidence,
        VolumeNumber = match.VolumeNumber,
        SeriesStartYear = match.SeriesStartYear,
        SeriesStartYearEvidence = match.SeriesStartYearEvidence,
        IssuePublicationYear = match.IssuePublicationYear,
        IssuePublicationDate = match.IssuePublicationDate,
        IssuePublicationEvidence = match.IssuePublicationEvidence,
        Publisher = match.Publisher,
        VolumeId = match.VolumeId,
        ProviderName = match.ProviderName,
        Type = match.Type,
        TypeVerified = match.TypeVerified,
        RuntimeMinutes = match.RuntimeMinutes,
        ProviderIds = new Dictionary<string, string>(match.ProviderIds, StringComparer.OrdinalIgnoreCase)
    };

    internal static PtvMetadataQualityCandidate CloneCandidate(PtvMetadataQualityCandidate candidate) => new()
    {
        Name = candidate.Name,
        ProductionYear = candidate.ProductionYear,
        MediaClass = candidate.MediaClass,
        EditionKind = candidate.EditionKind,
        EditionKindEvidence = candidate.EditionKindEvidence,
        SeriesTitle = candidate.SeriesTitle,
        SeriesTitleEvidence = candidate.SeriesTitleEvidence,
        SeriesTitleFromSearchContext = candidate.SeriesTitleFromSearchContext,
        NormalizedIssueNumber = candidate.NormalizedIssueNumber,
        IssueNumberEvidence = candidate.IssueNumberEvidence,
        VolumeNumber = candidate.VolumeNumber,
        SeriesStartYear = candidate.SeriesStartYear,
        SeriesStartYearEvidence = candidate.SeriesStartYearEvidence,
        IssuePublicationYear = candidate.IssuePublicationYear,
        IssuePublicationDate = candidate.IssuePublicationDate,
        IssuePublicationEvidence = candidate.IssuePublicationEvidence,
        Publisher = candidate.Publisher,
        VolumeId = candidate.VolumeId,
        Type = candidate.Type,
        TypeVerified = candidate.TypeVerified,
        RuntimeMinutes = candidate.RuntimeMinutes,
        ProviderIds = new Dictionary<string, string>(candidate.ProviderIds, StringComparer.OrdinalIgnoreCase),
        Score = candidate.Score,
        Confidence = candidate.Confidence,
        HasHardConflict = candidate.HasHardConflict,
        Rejected = candidate.Rejected,
        Reasons = candidate.Reasons.Select(CloneReason).ToList(),
        Source = candidate.Source
    };

    internal static PtvMetadataQualityResolution? CloneResolution(PtvMetadataQualityResolution? resolution) => resolution is null ? null : new()
    {
        State = resolution.State,
        ResolvedAt = resolution.ResolvedAt,
        Fingerprint = resolution.Fingerprint,
        PreviousStatus = resolution.PreviousStatus
    };

    internal static PtvMetadataQualityScanRun CloneRun(PtvMetadataQualityScanRun run) => new()
    {
        RunId = run.RunId,
        Mode = run.Mode,
        State = run.State,
        StartedAt = run.StartedAt,
        CompletedAt = run.CompletedAt,
        ItemsConsidered = run.ItemsConsidered,
        ItemCount = run.ItemCount,
        ItemsScanned = run.ItemsScanned,
        ItemsSkipped = run.ItemsSkipped,
        Healthy = run.Healthy,
        Review = run.Review,
        LikelyWrong = run.LikelyWrong,
        Incomplete = run.Incomplete,
        Unavailable = run.Unavailable,
        ProviderRequests = run.ProviderRequests,
        ProviderCacheHits = run.ProviderCacheHits,
        AiRequests = run.AiRequests,
        AiEligible = run.AiEligible,
        AiAnalyzed = run.AiAnalyzed,
        AiSkipped = run.AiSkipped,
        AiFailures = run.AiFailures,
        AiBudgetSkipped = run.AiBudgetSkipped,
        AiCircuitSkipped = run.AiCircuitSkipped,
        AiErrorCode = run.AiErrorCode,
        Errors = run.Errors,
        ProgressPercent = run.ProgressPercent,
        ErrorCode = run.ErrorCode
    };
}
