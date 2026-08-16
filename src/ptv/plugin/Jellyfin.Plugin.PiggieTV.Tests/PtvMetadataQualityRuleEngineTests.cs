using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvMetadataQualityRuleEngineTests
{
    private readonly PtvMetadataQualityRuleEngine _engine = new();

    [Fact]
    public void HealthyMovieWithReleaseTagsKeepsStrongIdentityConfidence()
    {
        var result = _engine.Analyze(Movie(
            name: "The Thing",
            file: "The.Thing.1982.2160p.BluRay.Remux.HEVC.mkv",
            folder: "The Thing (1982)",
            year: 1982));

        Assert.Equal(100, result.MatchConfidence);
        Assert.Equal(100, result.CompletenessScore);
        Assert.Empty(result.Reasons);
        Assert.Equal("the thing", PtvMetadataQualityRuleEngine.NormalizeTitle("The.Thing.1982.2160p.BluRay.Remux.HEVC.mkv"));
    }

    [Fact]
    public void WrongRemakeYearCreatesHardExplainableConflict()
    {
        var result = _engine.Analyze(Movie(
            name: "The Thing",
            file: "The.Thing.1982.2160p.mkv",
            folder: "The Thing (1982)",
            year: 2011));

        Assert.True(result.HasHardConflict);
        Assert.InRange(result.MatchConfidence, 0, 49);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvMetadataQualityReasonCodes.YearMismatch);
        Assert.Equal(29, result.Signals.YearDifference);
    }

    [Theory]
    [InlineData(1981)]
    [InlineData(1983)]
    public void OneYearReleaseDifferenceIsNotSevere(int currentYear)
    {
        var result = _engine.Analyze(Movie("The Thing", "The.Thing.1982.mkv", "The Thing (1982)", currentYear));

        Assert.False(result.HasHardConflict);
        Assert.DoesNotContain(result.Reasons, reason => reason.Code == PtvMetadataQualityReasonCodes.YearMismatch);
    }

    [Fact]
    public void MissingFieldsReduceCompletenessWithoutDamagingIdentityConfidence()
    {
        var item = Movie("Arrival", "Arrival.2016.mkv", "Arrival (2016)", 2016);
        item.ProviderIds.Clear();
        item.HasPrimaryImage = false;
        item.HasOverview = false;

        var result = _engine.Analyze(item);

        Assert.Equal(100, result.MatchConfidence);
        Assert.True(result.CompletenessScore < 100);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvMetadataQualityReasonCodes.ProviderIdMissing);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvMetadataQualityReasonCodes.MissingArtwork);
    }

    [Fact]
    public void LocalizedFilenameCanMatchOriginalTitleAlias()
    {
        var item = Movie("Spirited Away", "Sen.to.Chihiro.no.kamikakushi.2001.mkv", "Sen to Chihiro no kamikakushi (2001)", 2001);
        item.OriginalTitle = "Sen to Chihiro no kamikakushi";

        var result = _engine.Analyze(item);

        Assert.DoesNotContain(result.Reasons, reason => reason.Code is PtvMetadataQualityReasonCodes.FilenameConflict or PtvMetadataQualityReasonCodes.FolderConflict);
    }

    [Fact]
    public void EpisodeNumberConflictIsHardEvidence()
    {
        var result = _engine.Analyze(Episode("Show.Name.S02E05.mkv", season: 3, episode: 9));

        Assert.True(result.HasHardConflict);
        Assert.True(result.Signals.SeasonConflict);
        Assert.True(result.Signals.EpisodeConflict);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvMetadataQualityReasonCodes.SeasonNumberConflict);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvMetadataQualityReasonCodes.EpisodeNumberConflict);
    }

    [Fact]
    public void MultiEpisodeRangeThatOverlapsJellyfinRangeIsAccepted()
    {
        var item = Episode("Show.Name.S01E01-E02.mkv", season: 1, episode: 1);
        item.IndexNumberEnd = 2;

        var result = _engine.Analyze(item);

        Assert.False(result.HasHardConflict);
        Assert.DoesNotContain(result.Reasons, reason => reason.Code == PtvMetadataQualityReasonCodes.EpisodeNumberConflict);
    }

    [Fact]
    public void SpecialsAndAnimeAbsoluteNumberingAreNotGuessed()
    {
        var special = Episode("Show.Name.OVA.S00E03.mkv", season: 0, episode: 1);
        special.IsSpecial = true;
        var absolute = Episode("Anime.Title.105.mkv", season: 4, episode: 7);

        Assert.False(_engine.Analyze(special).HasHardConflict);
        Assert.False(_engine.Analyze(absolute).HasHardConflict);
    }

    [Theory]
    [InlineData("Audio")]
    [InlineData("Episode")]
    [InlineData("Season")]
    public void ItemTypesThatCanInheritArtworkAreNotMarkedIncompleteForMissingOwnImage(string itemType)
    {
        var item = new PtvMetadataQualityAnalysisItem
        {
            ItemId = Guid.NewGuid(),
            ItemType = itemType,
            Name = "Item",
            HasPrimaryImage = false,
            HasOverview = true,
            ProviderIds = new Dictionary<string, string> { ["Provider"] = "id" }
        };

        var result = _engine.Analyze(item);

        Assert.DoesNotContain(result.Reasons, reason => reason.Code == PtvMetadataQualityReasonCodes.MissingArtwork);
        Assert.False(result.Signals.MissingPrimaryImage);
    }

    [Fact]
    public void CandidateRankingUsesFilenameYearInsteadOfPossiblyWrongCurrentYear()
    {
        var item = Movie("The Thing", "The.Thing.1982.2160p.mkv", "The Thing (1982)", 2011);
        var original = new PtvMetadataMatchSummary { Name = "The Thing", ProductionYear = 1982 };
        var remake = new PtvMetadataMatchSummary { Name = "The Thing", ProductionYear = 2011 };

        Assert.True(PtvMetadataQualityService.ScoreCandidate(item, original) > PtvMetadataQualityService.ScoreCandidate(item, remake));
    }

    [Fact]
    public void FingerprintIsStableAcrossProviderOrderingAndChangesForMeaningfulMetadata()
    {
        var first = Movie("Alien", "Alien.1979.mkv", "Alien (1979)", 1979);
        first.ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["Tmdb"] = "348", ["Imdb"] = "tt0078748" };
        var second = Movie("Alien", "Alien.1979.mkv", "Alien (1979)", 1979);
        second.ItemId = first.ItemId;
        second.LibraryId = first.LibraryId;
        second.ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["Imdb"] = "tt0078748", ["Tmdb"] = "348" };

        Assert.Equal(PtvMetadataQualityFingerprint.Create(first), PtvMetadataQualityFingerprint.Create(second));
        second.ProductionYear = 1980;
        Assert.NotEqual(PtvMetadataQualityFingerprint.Create(first), PtvMetadataQualityFingerprint.Create(second));
    }

    private static PtvMetadataQualityAnalysisItem Movie(string name, string file, string folder, int year) => new()
    {
        ItemId = Guid.NewGuid(),
        LibraryId = Guid.NewGuid(),
        ItemType = "Movie",
        Name = name,
        FileName = file,
        FolderName = folder,
        ProductionYear = year,
        HasPrimaryImage = true,
        HasOverview = true,
        ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["Tmdb"] = "verified" }
    };

    private static PtvMetadataQualityAnalysisItem Episode(string file, int season, int episode) => new()
    {
        ItemId = Guid.NewGuid(),
        LibraryId = Guid.NewGuid(),
        ItemType = "Episode",
        Name = "Episode",
        SeriesName = "Show Name",
        FileName = file,
        FolderName = $"Season {season}",
        ParentIndexNumber = season,
        IndexNumber = episode,
        HasPrimaryImage = true,
        HasOverview = true,
        ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["Tvdb"] = "verified" }
    };
}
