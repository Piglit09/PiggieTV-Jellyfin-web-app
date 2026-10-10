using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvReadingIdentityAssessorTests
{
    public static IEnumerable<object[]> UnsafeIdentityCases() =>
        from source in new[] { "ComicInfo", "CurrentItem", "FileName", "ImmediateFolder", "Provider" }
        from text in new[] { "https://private.invalid/?token=secret", "download?opaque-secret", "download%3Fopaque-secret", "download#opaque-secret", "download%23opaque-secret", "download%253Fopaque-secret" }
        select new object[] { source, text };

    [Theory]
    [MemberData(nameof(UnsafeIdentityCases))]
    public void UnsafeSourceIdentityIsRedactedAndRemainsMaterialUncertainty(string source, string secret)
    {
        var sources = Sources(); var candidate = Candidate();
        var record = source switch
        {
            "ComicInfo" => sources.ComicInfo, "CurrentItem" => sources.CurrentItem,
            "FileName" => sources.FileName, "ImmediateFolder" => sources.ImmediateFolder, _ => null
        };
        if (record is not null) record.SeriesTitle = secret;
        else candidate.SeriesTitle = secret;
        var result = _assessor.Assess(sources, candidate);
        var serialized = System.Text.Json.JsonSerializer.Serialize(result);
        Assert.DoesNotContain("private.invalid", serialized);
        Assert.DoesNotContain("secret", serialized);
        Assert.True(result.RequiresUnverifiedAcknowledgment);
        Assert.Equal(PtvComicInfoArchiveInspectionState.Inspected, result.Sources.ArchiveState);
        Assert.Contains(result.Findings, f => f.Code == "IDENTITY_TEXT_REDACTED");
        Assert.NotEqual(_assessor.Assess(Sources(), Candidate()).AssessmentDigest, result.AssessmentDigest);
    }

    [Theory]
    [InlineData("https://private.invalid/?token=secret")]
    [InlineData("download?opaque-secret")]
    [InlineData("download#opaque-secret")]
    public void ProviderProjectionRetainsRedactionUncertaintyThroughRepeatedBounding(string unsafeText)
    {
        var candidate = Candidate(); candidate.SeriesTitle = unsafeText;
        candidate.VolumeNumber = unsafeText;
        var bounded = candidate.ToBoundedTransportModel().ToBoundedTransportModel();
        var result = _assessor.Assess(Sources(), bounded);
        Assert.DoesNotContain("secret", System.Text.Json.JsonSerializer.Serialize(new { bounded, result }));
        Assert.True(result.RequiresUnverifiedAcknowledgment);
        Assert.Contains(result.Findings, f => f.Code == "IDENTITY_TEXT_REDACTED");
    }

    [Theory]
    [InlineData("Who?")]
    [InlineData("Orbit #9")]
    public void OrdinaryTrailingQuestionAndIssueMarkersRemainReadable(string title)
    {
        var sources = Sources(); sources.ComicInfo.SeriesTitle = title; sources.FileName.SeriesTitle = title;
        var candidate = Candidate(); candidate.SeriesTitle = title;
        var result = _assessor.Assess(sources, candidate.ToBoundedTransportModel());
        Assert.Equal(title, result.Candidate.SeriesTitle);
        Assert.False(result.RequiresUnverifiedAcknowledgment);
        Assert.False(result.Candidate.HasRedactedIdentity);
    }

    private readonly PtvReadingIdentityAssessor _assessor = new();
    private static PtvReadingIdentitySources Sources() => new()
    {
        ArchiveState = PtvComicInfoArchiveInspectionState.Inspected,
        ComicInfo = new() { SeriesTitle = "Orbit", IssueNumber = "009" },
        FileName = new() { SeriesTitle = "Orbit", IssueNumber = "9" }
    };
    private static PtvNormalizedMetadataCandidate Candidate() => new()
    {
        Provider = "gcd", ProviderId = "123", SeriesTitle = "Orbit", IssueNumber = "9"
    };

    [Fact]
    public void SourceConstructionKeepsPublicationFolderAndComicInfoSeparateFromOpf()
    {
        var result = PtvReadingIdentityAssessor.CreateSources(new()
        {
            FileName = "Orbit #009 (2019).cbz", FolderName = "Orbit (2018)", ProductionYear = 2020
        }, new()
        {
            State = PtvReadingLocalInspectionState.Inspected,
            Metadata = new() { SeriesTitle = "OPF", Year = 2020 },
            ComicInfo = new() { State = PtvComicInfoArchiveInspectionState.Unverified, ReasonCode = "HELPER_TIMEOUT" }
        }, new() { SeriesTitle = "Current", IssueNumber = "9" });
        Assert.Equal("Orbit", result.FileName.SeriesTitle);
        Assert.Equal(2019, result.FileName.IssuePublicationYear);
        Assert.Null(result.FileName.VolumeOrRunLabel);
        Assert.Equal("2018", result.ImmediateFolder.VolumeOrRunLabel);
        Assert.Equal(PtvReadingRunEvidenceKind.ExplicitRun, result.ImmediateFolder.RunEvidenceKind);
        Assert.Null(result.ComicInfo.SeriesTitle);
        Assert.Null(result.CurrentItem.IssuePublicationYear);
        Assert.Equal(PtvComicInfoArchiveInspectionState.Unverified, result.ArchiveState);
    }

    [Fact]
    public void PublicationComparisonDoesNotUseGenericCandidateYear()
    {
        var sources = Sources(); sources.ComicInfo.IssuePublicationYear = 2019;
        var candidate = Candidate(); candidate.Year = 2018; candidate.StartYear = 2018;
        Assert.False(_assessor.Assess(sources, candidate).RequiresConflictAcknowledgment);
        candidate.IssuePublicationYear = 2018; candidate.IssuePublicationEvidence = PtvReadingIdentityEvidenceSource.Provider;
        Assert.Contains(_assessor.Assess(sources, candidate).Findings, f => f.Code == "ISSUE_PUBLICATION_YEAR_CONFLICT");
    }

    [Fact]
    public void ContradictoryTypedIdsCannotProduceExactAgreement()
    {
        var sources = Sources();
        sources.CurrentItem.ProviderIds = [new() { Namespace = "GCD", Scope = PtvReadingProviderIdScope.Issue, Value = "123" }];
        var candidate = Candidate(); candidate.IdentityProviderIds =
        [new() { Namespace = "GCD", Scope = PtvReadingProviderIdScope.Issue, Value = "123" },
         new() { Namespace = "GCD", Scope = PtvReadingProviderIdScope.Issue, Value = "456" }];
        var result = _assessor.Assess(sources, candidate);
        Assert.True(result.RequiresUnverifiedAcknowledgment);
        Assert.DoesNotContain(result.Findings, f => f.Code == "PROVIDER_ID_AGREEMENT");
    }

    [Fact]
    public void TypedProviderProjectionDropsUrlSecretsWithoutTruncatingIds()
    {
        var candidate = Candidate();
        candidate.IdentityProviderIds = [new() { Namespace = "GCD", Scope = PtvReadingProviderIdScope.Issue, Value = "https://private.invalid/?token=secret" }];
        var bounded = candidate.ToBoundedTransportModel();
        Assert.Equal(string.Empty, Assert.Single(bounded.IdentityProviderIds).Value);
        candidate.IdentityProviderIds[0].Value = new string('1', 300);
        Assert.Equal(string.Empty, Assert.Single(candidate.ToBoundedTransportModel().IdentityProviderIds).Value);
    }

    [Fact]
    public void DigestIsIndependentOfProviderIdInsertionOrder()
    {
        var sources = Sources(); var candidate = Candidate();
        candidate.IdentityProviderIds = [new() { Namespace = "GCD", Scope = PtvReadingProviderIdScope.Issue, Value = "123" }, new() { Namespace = "GCDSeries", Scope = PtvReadingProviderIdScope.Series, Value = "456" }];
        var first = _assessor.Assess(sources, candidate).AssessmentDigest;
        candidate.IdentityProviderIds.Reverse();
        Assert.Equal(first, _assessor.Assess(sources, candidate).AssessmentDigest);
    }

    [Fact]
    public void EmbeddedSeriesConflictSurvivesMergedQuery()
    {
        var sources = Sources();
        sources.FileName.SeriesTitle = "Other";
        var result = _assessor.Assess(sources, Candidate());
        var conflict = Assert.Single(result.Findings, f => f.Code == "SERIES_TITLE_CONFLICT");
        Assert.Equal(PtvReadingIdentitySource.ComicInfo, conflict.LeftSource);
        Assert.Equal("Orbit", conflict.LeftValue);
        Assert.Equal(PtvReadingIdentitySource.FileName, conflict.RightSource);
        Assert.Equal("Other", conflict.RightValue);
        Assert.True(result.RequiresConflictAcknowledgment);
    }

    [Fact]
    public void IssueNumberConflict()
    {
        var candidate = Candidate(); candidate.IssueNumber = "10";
        var result = _assessor.Assess(Sources(), candidate);
        Assert.Contains(result.Findings, f => f.Code == "ISSUE_NUMBER_CONFLICT" && f.RightValue == "10");
        Assert.True(result.RequiresConflictAcknowledgment);
    }

    [Fact]
    public void UnknownGcdRunRequiresReview()
    {
        var sources = Sources(); sources.ComicInfo.VolumeOrRunLabel = "2018";
        var candidate = Candidate(); candidate.StartYear = 2018;
        var result = _assessor.Assess(sources, candidate);
        Assert.Contains(result.Findings, f => f.Code == "RUN_IDENTITY_UNDETERMINED");
        Assert.True(result.RequiresUnverifiedAcknowledgment);
        Assert.False(result.RequiresConflictAcknowledgment);
    }

    [Fact]
    public void Run2018Publication2019Compatible()
    {
        var sources = Sources(); sources.ComicInfo.VolumeOrRunLabel = "2018";
        sources.ComicInfo.RunEvidenceKind = PtvReadingRunEvidenceKind.ExplicitRun;
        sources.ComicInfo.IssuePublicationYear = 2019;
        var candidate = Candidate(); candidate.StartYear = 2018;
        candidate.RunEvidenceKind = PtvReadingRunEvidenceKind.ExplicitRun;
        candidate.IssuePublicationYear = 2019;
        candidate.IssuePublicationEvidence = PtvReadingIdentityEvidenceSource.Provider;
        var result = _assessor.Assess(sources, candidate);
        Assert.False(result.RequiresConflictAcknowledgment);
        Assert.False(result.RequiresUnverifiedAcknowledgment);
    }

    [Fact]
    public void DirectIdScore100DoesNotClearConflict()
    {
        var sources = Sources(); sources.ComicInfo.SeriesTitle = "Embedded";
        sources.CurrentItem.ProviderIds = [new() { Namespace = "GCD", Scope = PtvReadingProviderIdScope.Issue, Value = "123" }];
        var candidate = Candidate(); candidate.Score = 100;
        candidate.IdentityProviderIds = [new() { Namespace = "GCD", Scope = PtvReadingProviderIdScope.Issue, Value = "123" }];
        var result = _assessor.Assess(sources, candidate);
        Assert.Contains(result.Findings, f => f.Code == "PROVIDER_ID_AGREEMENT");
        Assert.True(result.RequiresConflictAcknowledgment);
        Assert.Equal(100, candidate.Score);
    }

    [Fact]
    public void GcdIssueAndSeriesIdsUseOwnScopes()
    {
        var sources = Sources();
        sources.CurrentItem.ProviderIds = [new() { Namespace = "GCD", Scope = PtvReadingProviderIdScope.Issue, Value = "123" }, new() { Namespace = "GCDSeries", Scope = PtvReadingProviderIdScope.Series, Value = "456" }];
        var candidate = Candidate();
        candidate.IdentityProviderIds = [new() { Namespace = "GCD", Scope = PtvReadingProviderIdScope.Issue, Value = "123" }, new() { Namespace = "GCDSeries", Scope = PtvReadingProviderIdScope.Series, Value = "789" }];
        var result = _assessor.Assess(sources, candidate);
        Assert.Single(result.Findings, f => f.Code == "PROVIDER_ID_AGREEMENT" && f.Field == "GCD");
        Assert.Single(result.Findings, f => f.Code == "PROVIDER_ID_CONFLICT" && f.Field == "GCDSeries");
        candidate.IdentityProviderIds[0].Scope = PtvReadingProviderIdScope.Series;
        Assert.DoesNotContain(_assessor.Assess(sources, candidate).Findings, f => f.Code == "PROVIDER_ID_AGREEMENT");
    }

    [Fact]
    public void ComicVineScopeUnknown()
    {
        var candidate = Candidate(); candidate.Provider = "comic-vine";
        candidate.IdentityProviderIds = [new() { Namespace = "ComicVine", Value = "123" }];
        var result = _assessor.Assess(Sources(), candidate);
        Assert.Contains(result.Findings, f => f.Code == "PROVIDER_ID_UNDETERMINED");
        Assert.True(result.RequiresUnverifiedAcknowledgment);
        Assert.DoesNotContain(result.Findings, f => f.Code == "PROVIDER_ID_AGREEMENT");
    }

    [Theory]
    [InlineData(PtvComicInfoArchiveInspectionState.Absent, false)]
    [InlineData(PtvComicInfoArchiveInspectionState.Unverified, true)]
    [InlineData(PtvComicInfoArchiveInspectionState.NotAttempted, true)]
    public void ArchiveStateControlsAcknowledgment(PtvComicInfoArchiveInspectionState state, bool required)
    {
        var result = _assessor.Assess(new() { ArchiveState = state }, Candidate());
        Assert.Equal(required, result.RequiresUnverifiedAcknowledgment);
    }

    [Fact]
    public void MissingEmbeddedOrCandidateIdentityIsMaterial()
    {
        var sources = Sources(); sources.ComicInfo.IssueNumber = null;
        var candidate = Candidate(); candidate.SeriesTitle = null;
        var result = _assessor.Assess(sources, candidate);
        Assert.True(result.RequiresUnverifiedAcknowledgment);
        Assert.Contains(result.Findings, f => f.Code == "ISSUE_NUMBER_UNDETERMINED");
        Assert.Contains(result.Findings, f => f.Code == "SERIES_TITLE_UNDETERMINED");
    }

    [Fact]
    public void DigestBindsDisplayedValuesAndBothFlags()
    {
        var sources = Sources(); var candidate = Candidate();
        var original = _assessor.Assess(sources, candidate);
        candidate.Score = 100;
        Assert.Equal(original.AssessmentDigest, _assessor.Assess(sources, candidate).AssessmentDigest);
        sources.CurrentItem.SeriesTitle = "Elsewhere";
        Assert.NotEqual(original.AssessmentDigest, _assessor.Assess(sources, candidate).AssessmentDigest);
        sources.ArchiveState = PtvComicInfoArchiveInspectionState.Unverified;
        Assert.NotEqual(original.AssessmentDigest, _assessor.Assess(sources, candidate).AssessmentDigest);
    }

    [Fact]
    public void ExplicitFolderRunConflictsEvenWhenCandidateRunUnknown()
    {
        var sources = Sources(); sources.ComicInfo.VolumeOrRunLabel = "2018";
        sources.ImmediateFolder = new() { SeriesTitle = "Orbit", VolumeOrRunLabel = "2019", RunEvidenceKind = PtvReadingRunEvidenceKind.ExplicitRun };
        var result = _assessor.Assess(sources, Candidate());
        Assert.True(result.RequiresConflictAcknowledgment);
        Assert.True(result.RequiresUnverifiedAcknowledgment);
        Assert.Contains(result.Findings, f => f.Code == "RUN_LABEL_CONFLICT");
    }

    [Fact]
    public void DisplayValuesAreBoundedAndNoComicInfoIdsAreExactEvidence()
    {
        var sources = Sources(); sources.ComicInfo.SeriesTitle = new string('x', 900);
        sources.ComicInfo.ProviderIds = [new() { Namespace = "GCD", Scope = PtvReadingProviderIdScope.Issue, Value = "123" }];
        var result = _assessor.Assess(sources, Candidate());
        Assert.Equal(512, result.Sources.ComicInfo.SeriesTitle!.Length);
        Assert.Empty(result.Sources.ComicInfo.ProviderIds);
        Assert.All(result.Findings, f => Assert.True((f.LeftValue?.Length ?? 0) <= 512));
    }
}
