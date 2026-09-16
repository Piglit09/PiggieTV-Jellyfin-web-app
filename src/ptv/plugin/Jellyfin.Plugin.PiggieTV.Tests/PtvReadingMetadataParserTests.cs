using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvReadingMetadataParserTests
{
    private readonly PtvReadingMetadataParser _parser = new();

    [Fact]
    public void DeadpoolSceneFilenameProducesIssueAwareComicQuery()
    {
        var result = _parser.Parse(
            "Deadpool 009 (2019) (Digital) (Zone-Empire).cbr",
            new PtvMetadataSearchContext
            {
                FolderName = "Deadpool 2019",
                ProductionYear = 2020,
                PremiereDate = new DateTimeOffset(2020, 1, 15, 0, 0, 0, TimeSpan.Zero)
            });

        Assert.Equal("Deadpool", result.SeriesTitle);
        Assert.Equal("9", result.IssueNumber);
        Assert.Null(result.VolumeNumber);
        Assert.Null(result.ChapterNumber);
        Assert.Equal(2019, result.Year);
        Assert.Equal(2019, result.SeriesStartYear);
        Assert.Equal(2020, result.IssuePublicationYear);
        Assert.Equal(2020, result.IssuePublicationDate?.Year);
        Assert.Equal(PtvReadingIdentityEvidenceSource.FileName, result.SeriesTitleEvidence);
        Assert.Equal(PtvReadingIdentityEvidenceSource.FileName, result.IssueNumberEvidence);
        Assert.Equal(PtvReadingIdentityEvidenceSource.FileName, result.SeriesStartYearEvidence);
        Assert.Equal(PtvReadingIdentityEvidenceSource.ExistingMetadata, result.IssuePublicationEvidence);
        Assert.True(result.FolderCorroboratesSeriesTitle);
        Assert.True(result.FolderCorroboratesSeriesStartYear);
        Assert.Empty(result.IdentityConflicts);
        Assert.Equal(PtvReadingMediaClass.Comic, result.MediaClass);
        Assert.Contains(result.IgnoredFilenameTokens, token => token.Equals("Digital", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.IgnoredFilenameTokens, token => token.Equals("Zone-Empire", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void FolderRunSuppliesMissingSeriesAndRunForIssueOnlyFilename()
    {
        var result = _parser.Parse("009.cbr", new PtvMetadataSearchContext
        {
            FolderName = "Deadpool 2019"
        });

        Assert.Equal("Deadpool", result.SeriesTitle);
        Assert.Equal("9", result.IssueNumber);
        Assert.Equal(2019, result.SeriesStartYear);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Folder, result.SeriesTitleEvidence);
        Assert.Equal(PtvReadingIdentityEvidenceSource.FileName, result.IssueNumberEvidence);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Folder, result.SeriesStartYearEvidence);
        Assert.Equal(PtvReadingMediaClass.Comic, result.MediaClass);
        Assert.Empty(result.IdentityConflicts);
    }

    [Fact]
    public void FilenameIdentityWinsAndRecordsFolderConflicts()
    {
        var result = _parser.Parse("Deadpool 009 (2019).cbr", new PtvMetadataSearchContext
        {
            FolderName = "Batman 2022"
        });

        Assert.Equal("Deadpool", result.SeriesTitle);
        Assert.Equal(2019, result.SeriesStartYear);
        Assert.False(result.FolderCorroboratesSeriesTitle);
        Assert.False(result.FolderCorroboratesSeriesStartYear);
        Assert.Contains(result.IdentityConflicts, conflict =>
            conflict.Field == "seriesTitle"
            && conflict.PreferredSource == PtvReadingIdentityEvidenceSource.FileName
            && conflict.ConflictingSource == PtvReadingIdentityEvidenceSource.Folder);
        Assert.Contains(result.IdentityConflicts, conflict =>
            conflict.Field == "seriesStartYear"
            && conflict.PreferredValue == "2019"
            && conflict.ConflictingValue == "2022");
    }

    [Fact]
    public void InlineComicRunYearWinsAndRecordsConflictingFolderRun()
    {
        var result = _parser.Parse("Deadpool 2022 #9.cbr", new PtvMetadataSearchContext
        {
            FolderName = "Deadpool 2019"
        });

        Assert.Equal("Deadpool", result.SeriesTitle);
        Assert.Equal("9", result.IssueNumber);
        Assert.Equal(2022, result.SeriesStartYear);
        Assert.Equal(PtvReadingIdentityEvidenceSource.FileName, result.SeriesStartYearEvidence);
        Assert.True(result.FolderCorroboratesSeriesTitle);
        Assert.False(result.FolderCorroboratesSeriesStartYear);
        var conflict = Assert.Single(result.IdentityConflicts, value => value.Field == "seriesStartYear");
        Assert.Equal("2022", conflict.PreferredValue);
        Assert.Equal(PtvReadingIdentityEvidenceSource.FileName, conflict.PreferredSource);
        Assert.Equal("2019", conflict.ConflictingValue);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Folder, conflict.ConflictingSource);
        Assert.DoesNotContain(result.IdentityConflicts, value => value.Field == "seriesTitle");
    }

    [Theory]
    [InlineData("Deadpool #006", "6")]
    [InlineData("Deadpool Issue 00", "0")]
    [InlineData("Deadpool No. 0", "0")]
    [InlineData("Deadpool #1.5", "1.5")]
    public void ExplicitIssueSyntaxNormalizesWithoutLosingDecimalIdentity(string input, string expected)
    {
        var result = _parser.Parse(input);

        Assert.Equal("Deadpool", result.SeriesTitle);
        Assert.Equal(expected, result.IssueNumber);
        Assert.Null(result.VolumeNumber);
        Assert.Equal(PtvReadingMediaClass.Comic, result.MediaClass);
    }

    [Theory]
    [InlineData("One Piece Vol. 006", "6")]
    [InlineData("One Piece Volume.006", "6")]
    [InlineData("One Piece v06", "6")]
    [InlineData("One Piece - Vol 06", "6")]
    [InlineData("One Piece Volume VI", "6")]
    [InlineData("One Piece Book X", "10")]
    public void ExplicitVolumeSyntaxKeepsLocalVolumeSeparateFromSeries(string input, string expected)
    {
        var result = _parser.Parse(input);

        Assert.Equal("One Piece", result.SeriesTitle);
        Assert.Equal(expected, result.VolumeNumber);
        Assert.Null(result.IssueNumber);
        Assert.Null(result.ChapterNumber);
        Assert.Equal(PtvReadingMediaClass.Manga, result.MediaClass);
    }

    [Theory]
    [InlineData("One Piece - Chapter 006", "6")]
    [InlineData("One Piece Ch. 006", "6")]
    [InlineData("One Piece Ch006", "6")]
    [InlineData("One Piece Chapter 1.5", "1.5")]
    public void ChapterSyntaxUsesItsOwnNumberNamespace(string input, string expected)
    {
        var result = _parser.Parse(input);

        Assert.Equal("One Piece", result.SeriesTitle);
        Assert.Equal(expected, result.ChapterNumber);
        Assert.Null(result.IssueNumber);
        Assert.Null(result.VolumeNumber);
    }

    [Fact]
    public void AnnualAndSpecialRemainIssueEditions()
    {
        var annual = _parser.Parse("Deadpool Annual #1.cbz");
        var special = _parser.Parse("Deadpool Special #00.cbz");

        Assert.Equal(PtvReadingEditionKind.Annual, annual.EditionKind);
        Assert.Equal(PtvReadingIdentityEvidenceSource.FileName, annual.EditionKindEvidence);
        Assert.Equal("Deadpool", annual.SeriesTitle);
        Assert.Equal("1", annual.IssueNumber);
        Assert.Equal(PtvReadingMediaClass.Comic, annual.MediaClass);
        Assert.Equal(PtvReadingEditionKind.Special, special.EditionKind);
        Assert.Equal(PtvReadingIdentityEvidenceSource.FileName, special.EditionKindEvidence);
        Assert.Equal("0", special.IssueNumber);
        Assert.Equal(PtvReadingMediaClass.Comic, special.MediaClass);
    }

    [Theory]
    [InlineData("Batman Omnibus Vol. II.cbz", PtvReadingEditionKind.Omnibus, "2")]
    [InlineData("Saga TPB Vol 01.cbz", PtvReadingEditionKind.TradePaperback, "1")]
    [InlineData("Monstress Trade Paperback Volume 3.cbz", PtvReadingEditionKind.TradePaperback, "3")]
    public void CollectedEditionsClassifyAsGraphicNovels(
        string input,
        PtvReadingEditionKind expectedEdition,
        string expectedVolume)
    {
        var result = _parser.Parse(input);

        Assert.Equal(expectedEdition, result.EditionKind);
        Assert.Equal(expectedVolume, result.VolumeNumber);
        Assert.Equal(PtvReadingMediaClass.GraphicNovel, result.MediaClass);
        Assert.Null(result.IssueNumber);
    }

    [Theory]
    [InlineData("進撃の巨人 Vol. 06.cbz", "進撃の巨人", "6")]
    [InlineData("나 혼자만 레벨업 Vol. 06.cbz", "나 혼자만 레벨업", "6")]
    [InlineData("一人之下 Volume.006.cbz", "一人之下", "6")]
    [InlineData("JoJo’s Bizarre Adventure Vol. 2.cbz", "JoJo’s Bizarre Adventure", "2")]
    public void UnicodeAndApostrophesArePreservedInDisplaySeries(string input, string expectedSeries, string expectedVolume)
    {
        var result = _parser.Parse(input);

        Assert.Equal(expectedSeries, result.SeriesTitle);
        Assert.Equal(expectedVolume, result.VolumeNumber);
        Assert.DoesNotContain('�', result.CleanedTitle);
    }

    [Fact]
    public void ApostropheVariantsNormalizeForComparisonOnly()
    {
        Assert.Equal(
            PtvReadingMetadataParser.NormalizeTitle("JoJo’s Bizarre Adventure"),
            PtvReadingMetadataParser.NormalizeTitle("JoJo's Bizarre Adventure"));
        Assert.Equal("五等分の花嫁", PtvReadingMetadataParser.NormalizeTitle("五等分の花嫁"));
    }

    [Theory]
    [InlineData("1984")]
    [InlineData("2000 AD")]
    [InlineData("Apollo 13")]
    [InlineData("Catch-22")]
    [InlineData("Ocean's 11")]
    [InlineData("20th Century Boys")]
    [InlineData("The 100")]
    public void UnqualifiedTitleNumbersAreNotBlindlyParsed(string input)
    {
        var result = _parser.Parse(input);

        Assert.Null(result.IssueNumber);
        Assert.Null(result.VolumeNumber);
        Assert.Null(result.ChapterNumber);
        Assert.Equal(input, result.CleanedTitle);
    }

    [Fact]
    public void AmbiguousTrailingPaddedNumberRequiresLocalMediaEvidence()
    {
        var unknown = _parser.Parse("One Piece 006.cbz");
        var manga = _parser.Parse("One Piece 006.cbz", new PtvMetadataSearchContext
        {
            MediaClassOverride = PtvReadingMediaClass.Manga
        });
        var comic = _parser.Parse("Deadpool 009.cbz", new PtvMetadataSearchContext
        {
            MediaClassOverride = PtvReadingMediaClass.Comic
        });

        Assert.Null(unknown.IssueNumber);
        Assert.Null(unknown.VolumeNumber);
        Assert.Equal("6", manga.VolumeNumber);
        Assert.Equal("9", comic.IssueNumber);
    }

    [Fact]
    public void DiagnosticsRetainOnlyBaseFilenameNotServerPath()
    {
        var result = _parser.Parse(@"D:\private\Comics\Deadpool\Deadpool #006.cbz");

        Assert.Equal("Deadpool #006.cbz", result.RawFileName);
        Assert.DoesNotContain("private", result.RawFileName, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CbzExtensionAloneDoesNotMeanManga()
    {
        var result = _parser.Parse("Empire.cbz");

        Assert.Equal("Empire", result.SeriesTitle);
        Assert.Equal(PtvReadingMediaClass.Unknown, result.MediaClass);
        Assert.DoesNotContain(result.IgnoredFilenameTokens, token => token.Equals("Empire", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData("ComicVine", PtvReadingMediaClass.Comic)]
    [InlineData("AniList", PtvReadingMediaClass.Manga)]
    [InlineData("MangaDex", PtvReadingMediaClass.Manga)]
    [InlineData("GoogleBooks", PtvReadingMediaClass.Book)]
    public void ExistingProviderIdentityIsStrongClassificationEvidence(string provider, PtvReadingMediaClass expected)
    {
        var result = _parser.Parse("Series", new PtvMetadataSearchContext
        {
            ExistingProviderIds = new Dictionary<string, string> { [provider] = "verified" }
        });

        Assert.Equal(expected, result.MediaClass);
        Assert.True(result.Classification.Confidence >= 0.95);
    }

    [Theory]
    [InlineData("006", false, "6")]
    [InlineData("00", false, "0")]
    [InlineData("1.50", false, "1.5")]
    [InlineData("VI", true, "6")]
    [InlineData("VI", false, null)]
    public void NumberNormalizationIsContextual(string input, bool romanContext, string? expected)
    {
        Assert.Equal(expected, PtvReadingMetadataParser.NormalizeNumber(input, romanContext));
    }

    [Theory]
    [InlineData("9")]
    [InlineData("09")]
    [InlineData("009")]
    [InlineData("#9")]
    [InlineData("#09")]
    [InlineData("#009")]
    [InlineData("Issue 9")]
    [InlineData("Issue #009")]
    public void IssuePaddingNormalizesToOneIdentity(string input)
    {
        Assert.Equal("9", PtvReadingMetadataParser.NormalizeNumber(input));
    }

    [Fact]
    public void IssueOnlyProviderDisplayDoesNotBecomeSeriesIdentity()
    {
        var result = _parser.Parse("#009", new PtvMetadataSearchContext
        {
            ExistingTitle = "#009",
            MediaClassOverride = PtvReadingMediaClass.Comic
        });

        Assert.Null(result.SeriesTitle);
        Assert.Equal("9", result.IssueNumber);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Unknown, result.SeriesTitleEvidence);
    }

    [Fact]
    public void NegativeIssueNumbersRemainExplicitlyUnsupported()
    {
        Assert.Null(PtvReadingMetadataParser.NormalizeNumber("-1"));
        Assert.Null(_parser.Parse("Deadpool #-1.cbr").IssueNumber);
    }

    [Fact]
    public void TransportModelBoundsProviderContentAndRejectsDangerousUrls()
    {
        var candidate = new PtvNormalizedMetadataCandidate
        {
            Provider = "provider",
            ProviderId = "id",
            Title = new string('t', PtvReadingMetadataLimits.MaximumTitleLength + 50),
            Description = new string('d', PtvReadingMetadataLimits.MaximumDescriptionLength + 50),
            CoverUrl = "https://example.invalid/cover.jpg?access_token=private",
            BannerUrl = "https://example.invalid/banner.jpg",
            SourceUrl = "https://user:password@example.invalid/provider",
            AlternateTitles = Enumerable.Range(0, 100).Select(index => $"Alias {index}").ToList(),
            ExternalIds = Enumerable.Range(0, 50).ToDictionary(index => $"id-{index}", index => index.ToString()),
            RawProviderMetadata = new { Secret = "redacted" }
        };

        var bounded = candidate.ToBoundedTransportModel();
        var json = JsonSerializer.Serialize(bounded, JsonSerializerOptions.Web);

        Assert.Equal(PtvReadingMetadataLimits.MaximumTitleLength, bounded.Title.Length);
        Assert.Equal(PtvReadingMetadataLimits.MaximumDescriptionLength, bounded.Description?.Length);
        Assert.Equal(PtvReadingMetadataLimits.MaximumCollectionItems, bounded.AlternateTitles.Count);
        Assert.Equal(PtvReadingMetadataLimits.MaximumExternalIds, bounded.ExternalIds.Count);
        Assert.Null(bounded.CoverUrl);
        Assert.Null(bounded.SourceUrl);
        Assert.Equal("https://example.invalid/banner.jpg", bounded.BannerUrl);
        Assert.DoesNotContain("must-not-serialize", json, StringComparison.Ordinal);
        Assert.DoesNotContain("private", json, StringComparison.Ordinal);
    }

    [Fact]
    public void TransportKeepsLocalVolumeNumberSeparateFromProviderVolumeIdentity()
    {
        var bounded = new PtvNormalizedMetadataCandidate
        {
            Provider = "comic-vine",
            ProviderId = "4000-123",
            Title = "Issue",
            VolumeNumber = "1.5",
            VolumeId = "4050-987"
        }.ToBoundedTransportModel();

        Assert.Equal("1.5", bounded.VolumeNumber);
        Assert.Equal("4050-987", bounded.VolumeId);
    }

    [Fact]
    public void EnumContractsSerializeAsFrontendFriendlyStableStrings()
    {
        var json = JsonSerializer.Serialize(new PtvNormalizedMetadataCandidate
        {
            Provider = "provider",
            ProviderId = "id",
            Title = "Title",
            MediaClass = PtvReadingMediaClass.GraphicNovel
        }, JsonSerializerOptions.Web);

        Assert.Contains("\"mediaClass\":\"graphic-novel\"", json, StringComparison.Ordinal);
    }
}
