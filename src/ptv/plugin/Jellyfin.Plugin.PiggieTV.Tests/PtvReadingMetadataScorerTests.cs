using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvReadingMetadataScorerTests
{
    private readonly PtvReadingMetadataScorer _scorer = new();

    [Fact]
    public void CorrectDeadpoolIssueCrushesUnrelatedNumericTitle()
    {
        var query = ComicQuery("Deadpool", "6", 2019);
        var correct = Candidate("comic-vine", "correct", "Deadpool", PtvReadingMediaClass.Comic, issue: "006", year: 2020, startYear: 2019);
        var unrelated = Candidate("comic-vine", "unrelated", "Agent 006", PtvReadingMediaClass.Comic, issue: "6", year: 2020, startYear: 2019);

        var correctScore = _scorer.Score(query, correct);
        var unrelatedScore = _scorer.Score(query, unrelated);

        Assert.True(correctScore.Score - unrelatedScore.Score >= 60, $"Expected a decisive margin, got {correctScore.Score} vs {unrelatedScore.Score}.");
        Assert.Contains(correctScore.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.ExactTitle);
        Assert.Contains(correctScore.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.IssueMatch);
        Assert.Contains(unrelatedScore.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.TitleMismatch);
    }

    [Fact]
    public void WrongIssueIsHardEvidenceEvenWhenTitleAndYearMatch()
    {
        var result = _scorer.Score(
            ComicQuery("Deadpool", "6", 2019),
            Candidate("comic-vine", "wrong-issue", "Deadpool", PtvReadingMediaClass.Comic, issue: "9", year: 2019));

        Assert.True(result.HasHardConflict);
        Assert.True(result.IsRejected);
        Assert.Equal("rejected", result.Confidence);
        Assert.True(result.Score <= 39);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.IssueMismatch && reason.Impact == -70);
    }

    [Fact]
    public void DeadpoolIssueNineRejectsIssueSixEvenWhenProviderIdentifierContains009()
    {
        var query = ComicQuery("Deadpool", "009", 2019);
        query.IssuePublicationYear = 2020;
        var correct = Candidate(
            "comic-vine",
            "77815",
            "Deadpool",
            PtvReadingMediaClass.Comic,
            issue: "9",
            year: 2020,
            startYear: 2019,
            issuePublicationYear: 2020);
        var wrong = Candidate(
            "comic-vine",
            "deadpool-009-search-slug",
            "Deadpool",
            PtvReadingMediaClass.Comic,
            issue: "006",
            year: 2026,
            startYear: 2019,
            issuePublicationYear: 2026);

        var correctScore = _scorer.Score(query, correct);
        var wrongScore = _scorer.Score(query, wrong);

        Assert.Equal(100, correctScore.Score);
        Assert.False(correctScore.IsRejected);
        Assert.True(wrongScore.IsRejected);
        Assert.True(wrongScore.Score <= 39);
        Assert.DoesNotContain(
            wrongScore.Reasons,
            reason => string.Equals(reason.Evidence, wrong.ProviderId, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void IssueAndVolumeAreNeverInterchangeable()
    {
        var query = ComicQuery("Deadpool", "6", 2019);
        var volumeOnly = Candidate("provider", "volume", "Deadpool", PtvReadingMediaClass.Comic, volume: "6", year: 2019);

        var result = _scorer.Score(query, volumeOnly);

        Assert.DoesNotContain(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.IssueMatch);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.IssueMissing);
    }

    [Fact]
    public void ChapterAndVolumeAreNeverInterchangeable()
    {
        var query = MangaQuery("One Piece", volume: null);
        query.ChapterNumber = "6";
        var volumeOnly = Candidate("provider", "volume", "One Piece", PtvReadingMediaClass.Manga, volume: "6");

        var result = _scorer.Score(query, volumeOnly);

        Assert.DoesNotContain(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.ChapterMatch);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.ChapterMissing);
    }

    [Fact]
    public void WrongVolumeIsPenalizedWithoutComparingProviderTotals()
    {
        var query = MangaQuery("One Piece", volume: "6");
        var wrongPhysicalVolume = Candidate("mangadex", "wrong", "One Piece", PtvReadingMediaClass.Manga, volume: "7", startYear: 1997);
        wrongPhysicalVolume.TotalVolumes = 110;

        var result = _scorer.Score(query, wrongPhysicalVolume);

        Assert.True(result.HasHardConflict);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.VolumeMismatch);
        Assert.DoesNotContain(result.Reasons, reason => reason.Evidence == "110");
    }

    [Fact]
    public void SeriesLevelMangaCandidateDoesNotPretendTotalVolumesAreLocalVolume()
    {
        var query = MangaQuery("One Piece", volume: "6");
        var series = Candidate("anilist", "30013", "One Piece", PtvReadingMediaClass.Manga, startYear: 1997);
        series.TotalVolumes = 110;

        var result = _scorer.Score(query, series);

        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.VolumeMissing);
        Assert.DoesNotContain(result.Reasons, reason => reason.Code is PtvReadingMatchReasonCodes.VolumeMatch or PtvReadingMatchReasonCodes.VolumeMismatch);
        Assert.False(result.HasHardConflict);
    }

    [Fact]
    public void CorrectSeriesRunDisambiguatesSameTitleRuns()
    {
        var query = ComicQuery("Deadpool", "6", 2019);
        query.IssuePublicationYear = 2020;
        var correctRun = Candidate("comic-vine", "2019-run", "Deadpool", PtvReadingMediaClass.Comic, issue: "6", year: 2020, startYear: 2019, issuePublicationYear: 2020);
        var priorRun = Candidate("comic-vine", "2018-run", "Deadpool", PtvReadingMediaClass.Comic, issue: "6", year: 2019, startYear: 2018, issuePublicationYear: 2019);
        var futureRun = Candidate("comic-vine", "2022-run", "Deadpool", PtvReadingMediaClass.Comic, issue: "6", year: 2022, startYear: 2022, issuePublicationYear: 2022);

        var correct = _scorer.Score(query, correctRun);
        var prior = _scorer.Score(query, priorRun);
        var future = _scorer.Score(query, futureRun);

        Assert.True(correct.Score - prior.Score >= 60);
        Assert.True(correct.Score - future.Score >= 60);
        Assert.False(correct.HasHardConflict);
        Assert.True(prior.IsRejected);
        Assert.True(future.IsRejected);
        Assert.Contains(prior.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.SeriesRunYearMismatch);
        Assert.Contains(future.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.SeriesRunYearMismatch);
    }

    [Fact]
    public void FolderCorroborationIsVisibleSupportingEvidence()
    {
        var query = ComicQuery("Deadpool", "9", 2022);
        query.FolderCorroboratesSeriesTitle = true;
        query.FolderCorroboratesSeriesStartYear = true;

        var result = _scorer.Score(
            query,
            Candidate("comic-vine", "match", "Deadpool", PtvReadingMediaClass.Comic, issue: "9", startYear: 2022));

        Assert.Contains(result.Reasons, reason =>
            reason.Code == PtvReadingMatchReasonCodes.FolderSeriesCorroboration && reason.Impact == 4);
        Assert.Contains(result.Reasons, reason =>
            reason.Code == PtvReadingMatchReasonCodes.FolderRunCorroboration && reason.Impact == 4);
    }

    [Fact]
    public void ConflictingLocalRunEvidencePreventsStrongConfidence()
    {
        var query = ComicQuery("Deadpool", "9", 2022);
        query.IdentityConflicts =
        [
            new PtvReadingIdentityConflict
            {
                Field = "seriesStartYear",
                PreferredValue = "2022",
                PreferredSource = PtvReadingIdentityEvidenceSource.FileName,
                ConflictingValue = "2019",
                ConflictingSource = PtvReadingIdentityEvidenceSource.Folder
            }
        ];

        var result = _scorer.Score(
            query,
            Candidate("comic-vine", "match", "Deadpool", PtvReadingMediaClass.Comic, issue: "9", startYear: 2022));

        Assert.True(result.HasHardConflict);
        Assert.False(result.IsRejected);
        Assert.True(result.Score <= 69);
        Assert.Contains(result.Reasons, reason =>
            reason.Code == PtvReadingMatchReasonCodes.LocalIdentityConflict && reason.Impact == -20);
    }

    [Fact]
    public void UnknownSeriesProvenanceCannotReceiveExactSeriesCredit()
    {
        var candidate = Candidate(
            "comic-vine",
            "issue-only",
            "Deadpool",
            PtvReadingMediaClass.Comic,
            issue: "9",
            startYear: 2022);
        candidate.SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.Unknown;

        var result = _scorer.Score(ComicQuery("Deadpool", "9", 2022), candidate);

        Assert.True(result.Score <= 69);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.SeriesTitleMissing);
        Assert.DoesNotContain(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.ExactTitle);
    }

    [Fact]
    public void ExplicitAnnualIdentityRequiresCompatibleProviderEdition()
    {
        var query = ComicQuery("X-Men", "1", 2023);
        query.EditionKind = PtvReadingEditionKind.Annual;
        query.EditionKindEvidence = PtvReadingIdentityEvidenceSource.FileName;
        var candidate = Candidate("comic-vine", "annual", "X-Men", PtvReadingMediaClass.Comic, issue: "1", startYear: 2023);
        candidate.EditionKind = PtvReadingEditionKind.Annual;
        candidate.EditionKindEvidence = PtvReadingIdentityEvidenceSource.Provider;

        var result = _scorer.Score(query, candidate);

        Assert.False(result.IsRejected);
        Assert.Contains(result.Reasons, reason =>
            reason.Code == PtvReadingMatchReasonCodes.EditionMatch && reason.Impact == 20);
    }

    [Fact]
    public void AnnualAndSpecialCandidatesDoNotConflate()
    {
        var query = ComicQuery("X-Men", "1", 2023);
        query.EditionKind = PtvReadingEditionKind.Annual;
        query.EditionKindEvidence = PtvReadingIdentityEvidenceSource.FileName;
        var candidate = Candidate("comic-vine", "special", "X-Men", PtvReadingMediaClass.Comic, issue: "1", startYear: 2023);
        candidate.EditionKind = PtvReadingEditionKind.Special;
        candidate.EditionKindEvidence = PtvReadingIdentityEvidenceSource.Provider;

        var result = _scorer.Score(query, candidate);

        Assert.True(result.IsRejected);
        Assert.True(result.Score <= 39);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.EditionMismatch);
    }

    [Fact]
    public void MissingProviderEditionKeepsExplicitAnnualBelowStrongConfidence()
    {
        var query = ComicQuery("X-Men", "1", 2023);
        query.EditionKind = PtvReadingEditionKind.Annual;
        query.EditionKindEvidence = PtvReadingIdentityEvidenceSource.FileName;
        var candidate = Candidate("comic-vine", "unknown-edition", "X-Men", PtvReadingMediaClass.Comic, issue: "1", startYear: 2023);

        var result = _scorer.Score(query, candidate);

        Assert.False(result.IsRejected);
        Assert.True(result.Score <= 69);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.EditionMissing);
    }

    [Fact]
    public void ProviderEditionIsNeutralWhenLocalEditionWasNotExplicit()
    {
        var query = ComicQuery("X-Men", "1", 2023);
        var candidate = Candidate("comic-vine", "annual", "X-Men", PtvReadingMediaClass.Comic, issue: "1", startYear: 2023);
        candidate.EditionKind = PtvReadingEditionKind.Annual;
        candidate.EditionKindEvidence = PtvReadingIdentityEvidenceSource.Provider;

        var result = _scorer.Score(query, candidate);

        Assert.False(result.IsRejected);
        Assert.DoesNotContain(result.Reasons, reason => reason.Code is
            PtvReadingMatchReasonCodes.EditionMatch or
            PtvReadingMatchReasonCodes.EditionMismatch or
            PtvReadingMatchReasonCodes.EditionMissing);
    }

    [Fact]
    public void IssuePublicationYearDoesNotConflictWithDifferentSeriesStartYear()
    {
        var query = ComicQuery("Deadpool", "9", 2019);
        query.IssuePublicationYear = 2020;
        var candidate = Candidate(
            "comic-vine",
            "77815",
            "Deadpool",
            PtvReadingMediaClass.Comic,
            issue: "009",
            year: 2020,
            startYear: 2019,
            issuePublicationYear: 2020);

        var result = _scorer.Score(query, candidate);

        Assert.False(result.HasHardConflict);
        Assert.False(result.IsRejected);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.SeriesRunYearMatch);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.IssuePublicationYearMatch);
        Assert.DoesNotContain(result.Reasons, reason => reason.Code is PtvReadingMatchReasonCodes.SeriesRunYearMismatch or PtvReadingMatchReasonCodes.IssuePublicationYearMismatch);
    }

    [Fact]
    public void ExactAlternateAndLocalizedTitlesScoreNearlyAsStronglyAsPrimaryTitle()
    {
        var query = MangaQuery("Gotoubun no Hanayome", volume: "6");
        var candidate = Candidate("mangadex", "series", "The Quintessential Quintuplets", PtvReadingMediaClass.Manga);
        candidate.AlternateTitles = ["Gotoubun no Hanayome"];
        candidate.LocalizedTitles = new Dictionary<string, string>
        {
            ["ja"] = "五等分の花嫁",
            ["ja-ro"] = "Gotoubun no Hanayome"
        };

        var result = _scorer.Score(query, candidate);

        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.ExactAlternateTitle && reason.Impact == 38);
        Assert.True(result.Score >= 45);
    }

    [Fact]
    public void NativeUnicodeAlternateTitleCanIdentifySameWork()
    {
        var query = MangaQuery("五等分の花嫁", volume: "6");
        var candidate = Candidate("anilist", "series", "The Quintessential Quintuplets", PtvReadingMediaClass.Manga);
        candidate.AlternateTitles = ["Gotoubun no Hanayome", "五等分の花嫁"];

        Assert.Contains(
            _scorer.Score(query, candidate).Reasons,
            reason => reason.Code == PtvReadingMatchReasonCodes.ExactAlternateTitle);
    }

    [Fact]
    public void VerifiedExactProviderIdWinsAfterValidation()
    {
        var query = ComicQuery("Deadpool", "6", 2019);
        query.ProviderId = new PtvReadingProviderIdentifier { Provider = "Comic Vine", Id = "4000-123" };
        var exact = Candidate("ComicVine", "4000-123", "Unexpected display title", PtvReadingMediaClass.Comic, issue: "6", year: 2020, startYear: 2019, issuePublicationYear: 2020);

        var result = _scorer.Score(query, exact);

        Assert.Equal(100, result.Score);
        Assert.False(result.HasHardConflict);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.ProviderIdMatch && reason.Impact == 100);
    }

    [Fact]
    public void ContradictoryKnownProviderIdIsHardEvidence()
    {
        var query = ComicQuery("Deadpool", "6", 2019);
        query.ExistingProviderIds["ComicVine"] = "4000-correct";
        var candidate = Candidate("Comic Vine", "4000-other", "Deadpool", PtvReadingMediaClass.Comic, issue: "6", year: 2019);

        var result = _scorer.Score(query, candidate);

        Assert.True(result.HasHardConflict);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.ProviderIdMismatch && reason.Impact == -60);
    }

    [Fact]
    public void ProviderResponseOrderingCannotDetermineFinalRanking()
    {
        var query = ComicQuery("Deadpool", "6", 2019);
        var weak = Candidate("comic-vine", "weak", "Agent 006", PtvReadingMediaClass.Comic, issue: "6", year: 2019);
        var strong = Candidate("comic-vine", "strong", "Deadpool", PtvReadingMediaClass.Comic, issue: "6", year: 2019);
        var wrongRun = Candidate("comic-vine", "wrong-run", "Deadpool", PtvReadingMediaClass.Comic, issue: "6", year: 2022);

        var forward = _scorer.Rank(query, new[] { weak, wrongRun, strong }).Select(result => result.Candidate.ProviderId).ToArray();
        var reverse = _scorer.Rank(query, new[] { strong, wrongRun, weak }).Select(result => result.Candidate.ProviderId).ToArray();

        Assert.Equal(new[] { "strong", "wrong-run", "weak" }, forward);
        Assert.Equal(forward, reverse);
    }

    [Fact]
    public void MediaClassConflictCannotReceiveAHealthyScoreFromTitleAlone()
    {
        var query = MangaQuery("One Piece", volume: "6");
        var book = Candidate("google-books", "book", "One Piece", PtvReadingMediaClass.Book);

        var result = _scorer.Score(query, book);

        Assert.True(result.HasHardConflict);
        Assert.True(result.Score < 55);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.MediaClassMismatch);
    }

    [Fact]
    public void NormalizedIssueZerosCompareEqual()
    {
        var query = ComicQuery("Deadpool", "006", 2019);
        var candidate = Candidate("comic-vine", "issue", "Deadpool", PtvReadingMediaClass.Comic, issue: "6", year: 2019);

        Assert.Contains(
            _scorer.Score(query, candidate).Reasons,
            reason => reason.Code == PtvReadingMatchReasonCodes.IssueMatch);
    }

    [Theory]
    [InlineData("#0", "00")]
    [InlineData("#00", "0")]
    [InlineData("#1.5", "1.50")]
    public void EdgeIssueNumbersRemainExactIdentities(string local, string provider)
    {
        var result = _scorer.Score(
            ComicQuery("Batman", local, 2022),
            Candidate("comic-vine", provider, "Batman", PtvReadingMediaClass.Comic, issue: provider, startYear: 2022));

        Assert.False(result.IsRejected);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.IssueMatch);
    }

    [Fact]
    public void NamedComicCorpusHasExactConfidenceDistribution()
    {
        var corpus = new[]
        {
            ScoreCase("Batman legacy zero", ComicQuery("Batman", "0", 1940),
                Candidate("comic-vine", "batman-0", "Batman", PtvReadingMediaClass.Comic, issue: "00", startYear: 1940)),
            ScoreCase("Amazing Spider-Man decimal", ComicQuery("Amazing Spider-Man", "1.5", 2014),
                Candidate("comic-vine", "asm-1-5", "Amazing Spider-Man", PtvReadingMediaClass.Comic, issue: "1.50", startYear: 2014)),
            ScoreCase("X-Men annual", ExplicitEditionQuery("X-Men", "1", 2023, PtvReadingEditionKind.Annual),
                EditionCandidate("xmen-annual", "X-Men", "1", 2023, PtvReadingEditionKind.Annual)),
            ScoreCase("Deadpool modern run", ComicQuery("Deadpool", "9", 2022),
                Candidate("comic-vine", "deadpool-9", "Deadpool", PtvReadingMediaClass.Comic, issue: "9", startYear: 2022)),
            ScoreCase("Star Wars special zero", ExplicitEditionQuery("Star Wars", "00", 1977, PtvReadingEditionKind.Special),
                EditionCandidate("star-wars-special", "Star Wars", "0", 1977, PtvReadingEditionKind.Special)),
            ScoreCase("Amazing Spider-Man partial series", ComicQuery("Amazing Spider-Man", "9", 2022),
                Candidate("comic-vine", "spider-man-9", "Spider-Man", PtvReadingMediaClass.Unknown, issue: "9", startYear: 2022)),
            ScoreCase("Batman missing provider issue", ComicQuery("Batman", "9", 2016),
                Candidate("comic-vine", "batman-series", "Batman", PtvReadingMediaClass.Comic, startYear: 2016)),
            ScoreCase("Star Wars wrong series", ComicQuery("Star Wars", "9", 2015),
                Candidate("comic-vine", "star-trek-9", "Star Trek", PtvReadingMediaClass.Comic, issue: "9", startYear: 2015)),
            ScoreCase("Deadpool wrong issue", ComicQuery("Deadpool", "9", 2019),
                Candidate("comic-vine", "deadpool-8", "Deadpool", PtvReadingMediaClass.Comic, issue: "8", startYear: 2019))
        };

        Assert.Equal(5, corpus.Count(item => item.Result.Confidence == "excellent"));
        Assert.Equal(1, corpus.Count(item => item.Result.Confidence == "strong"));
        Assert.Equal(1, corpus.Count(item => item.Result.Confidence == "possible"));
        Assert.Equal(1, corpus.Count(item => item.Result.Confidence == "weak"));
        Assert.Equal(1, corpus.Count(item => item.Result.Confidence == "rejected"));
        Assert.Equal(9, corpus.Select(item => item.Name).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void CandidateRankingReturnsBoundedTransportModels()
    {
        var candidate = Candidate("provider", "id", "One Piece", PtvReadingMediaClass.Manga);
        candidate.CoverUrl = "javascript:alert(1)";
        candidate.RawProviderMetadata = new { Huge = new string('x', 10_000) };

        var ranked = Assert.Single(_scorer.Rank(MangaQuery("One Piece", null), new[] { candidate }));

        Assert.Null(ranked.Candidate.CoverUrl);
        Assert.Null(ranked.Candidate.RawProviderMetadata);
        Assert.Equal(ranked.Match.Score, ranked.Candidate.Score);
        Assert.Equal(ranked.Match.Reasons.Count, ranked.Candidate.ScoreReasons.Count);
    }

    private static PtvStructuredMetadataQuery ComicQuery(string series, string issue, int year) => new()
    {
        RawTitle = series,
        CleanedTitle = series,
        SeriesTitle = series,
        IssueNumber = issue,
        Year = year,
        SeriesStartYear = year,
        MediaClass = PtvReadingMediaClass.Comic,
        Classification = new PtvReadingMediaClassification { MediaClass = PtvReadingMediaClass.Comic, Confidence = 1 }
    };

    private static PtvStructuredMetadataQuery MangaQuery(string series, string? volume) => new()
    {
        RawTitle = series,
        CleanedTitle = series,
        SeriesTitle = series,
        VolumeNumber = volume,
        MediaClass = PtvReadingMediaClass.Manga,
        Classification = new PtvReadingMediaClassification { MediaClass = PtvReadingMediaClass.Manga, Confidence = 1 }
    };

    private (string Name, PtvReadingCandidateScore Result) ScoreCase(
        string name,
        PtvStructuredMetadataQuery query,
        PtvNormalizedMetadataCandidate candidate) => (name, _scorer.Score(query, candidate));

    private static PtvStructuredMetadataQuery ExplicitEditionQuery(
        string series,
        string issue,
        int year,
        PtvReadingEditionKind edition)
    {
        var query = ComicQuery(series, issue, year);
        query.EditionKind = edition;
        query.EditionKindEvidence = PtvReadingIdentityEvidenceSource.FileName;
        return query;
    }

    private static PtvNormalizedMetadataCandidate EditionCandidate(
        string id,
        string title,
        string issue,
        int year,
        PtvReadingEditionKind edition)
    {
        var candidate = Candidate("comic-vine", id, title, PtvReadingMediaClass.Comic, issue: issue, startYear: year);
        candidate.EditionKind = edition;
        candidate.EditionKindEvidence = PtvReadingIdentityEvidenceSource.Provider;
        return candidate;
    }

    private static PtvNormalizedMetadataCandidate Candidate(
        string provider,
        string id,
        string title,
        PtvReadingMediaClass mediaClass,
        string? issue = null,
        string? volume = null,
        string? chapter = null,
        int? year = null,
        int? startYear = null,
        int? issuePublicationYear = null) => new()
        {
            Provider = provider,
            ProviderId = id,
            Title = title,
            SeriesTitle = title,
            SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.Provider,
            MediaClass = mediaClass,
            IssueNumber = issue,
            IssueNumberEvidence = issue is null
                ? PtvReadingIdentityEvidenceSource.Unknown
                : PtvReadingIdentityEvidenceSource.Provider,
            VolumeNumber = volume,
            ChapterNumber = chapter,
            Year = year,
            StartYear = startYear,
            SeriesStartYearEvidence = startYear is null
                ? PtvReadingIdentityEvidenceSource.Unknown
                : PtvReadingIdentityEvidenceSource.Provider,
            IssuePublicationYear = issuePublicationYear,
            IssuePublicationEvidence = issuePublicationYear is null
                ? PtvReadingIdentityEvidenceSource.Unknown
                : PtvReadingIdentityEvidenceSource.Provider
        };
}
