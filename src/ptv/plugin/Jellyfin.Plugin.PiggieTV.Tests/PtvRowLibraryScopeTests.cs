using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Model.Entities;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvRowLibraryScopeTests
{
    private static readonly Guid AnimeId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid ReplacementId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public void RenameKeepsPinnedId()
    {
        var rule = AnimeRule(AnimeId);
        var folder = Folder(AnimeId, "Renamed Anime", CollectionTypeOptions.tvshows);
        var resolved = PtvHomeLibraryScopeResolver.Resolve(rule, [folder]);
        Assert.Equal("resolved", resolved.Status);
        Assert.Equal(AnimeId, resolved.LibraryId);
        Assert.False(resolved.NeedsBinding);
    }

    [Fact]
    public void SameNameReplacementDoesNotRebind()
    {
        var resolved = PtvHomeLibraryScopeResolver.Resolve(AnimeRule(AnimeId),
            [Folder(ReplacementId, "Anime", CollectionTypeOptions.tvshows)]);
        Assert.Equal("deleted", resolved.Status);
        Assert.Null(resolved.LibraryId);
    }

    [Fact]
    public void MissingOrAmbiguousBootstrapFailsClosed()
    {
        var rule = AnimeRule(null);
        Assert.Equal("missing", PtvHomeLibraryScopeResolver.Resolve(rule, []).Status);
        Assert.Equal("ambiguous", PtvHomeLibraryScopeResolver.Resolve(rule,
            [Folder(AnimeId, "Anime", CollectionTypeOptions.tvshows), Folder(ReplacementId, "Anime", CollectionTypeOptions.tvshows)]).Status);
        Assert.Equal("bindingRequired", PtvHomeLibraryScopeResolver.Resolve(rule,
            [Folder(AnimeId, "Anime", CollectionTypeOptions.tvshows)]).Status);
    }

    [Fact]
    public void ExplicitIdTypeConflictFailsClosed()
    {
        var rule = new RowBuilderRule
        {
            Id = "custom-anime", MediaType = "anime", SourceType = "latest", SourceValue = "anime",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = AnimeId.ToString("N") }
        };
        var resolved = PtvHomeLibraryScopeResolver.Resolve(rule, [Folder(AnimeId, "Anime", CollectionTypeOptions.movies)]);
        Assert.Equal("typeConflict", resolved.Status);
        Assert.Null(resolved.LibraryId);
    }

    private static RowBuilderRule AnimeRule(Guid? id) => new()
    {
        Id = "latest-anime", MediaType = "anime", SourceType = "latest", SourceValue = "anime",
        LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "anime", VirtualFolderId = id?.ToString("N") }
    };

    private static VirtualFolderInfo Folder(Guid id, string name, CollectionTypeOptions type) => new()
    {
        ItemId = id.ToString("N"), Name = name, CollectionType = type, Locations = ["/fake"]
    };

    [Fact]
    public void CanonicalV2RuleMigratesByIdAndSemanticTupleNotDisplayName()
    {
        var rows = new RowBuilderSettings
        {
            SchemaVersion = 2,
            Rules = [new RowBuilderRule
            {
                Id = "latest-anime",
                Name = "My renamed shelf",
                MediaType = "anime",
                SourceType = "latest",
                SourceValue = "anime"
            }]
        };

        PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(rows);
        var document = JsonSerializer.SerializeToDocument(rows);

        Assert.Equal(3, rows.SchemaVersion);
        var scope = document.RootElement.GetProperty("rules")[0].GetProperty("libraryScope");
        Assert.Equal("defaultLibrary", scope.GetProperty("mode").GetString());
        Assert.Equal("anime", scope.GetProperty("defaultKey").GetString());
        Assert.True(scope.GetProperty("virtualFolderId").ValueKind is JsonValueKind.Null or JsonValueKind.Undefined);
    }

    [Fact]
    public void LegacySourceTypeLibraryWithoutScopeFailsClosed()
    {
        var rows = new RowBuilderSettings
        {
            SchemaVersion = 2,
            Rules = [new RowBuilderRule
            {
                Id = "custom-library",
                MediaType = "shows",
                SourceType = "library",
                SourceValue = "Shows"
            }]
        };

        PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(rows);
        var document = JsonSerializer.SerializeToDocument(rows);
        var scope = document.RootElement.GetProperty("rules")[0].GetProperty("libraryScope");

        Assert.NotEqual("global", scope.GetProperty("mode").GetString());
    }

    [Fact]
    public void InvalidScopeNeverBecomesGlobal()
    {
        const string input = """
            {"schemaVersion":3,"rules":[{"id":"unsafe","sourceType":"latest","mediaType":"movies","libraryScope":{"mode":"unsupported","defaultKey":"movies"}}]}
            """;
        var rows = JsonSerializer.Deserialize<RowBuilderSettings>(input)!;

        PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(rows);
        var document = JsonSerializer.SerializeToDocument(rows);
        var scope = document.RootElement.GetProperty("rules")[0].GetProperty("libraryScope");

        Assert.NotEqual("global", scope.GetProperty("mode").GetString());
    }

    [Fact]
    public void EmptyPinnedIdNeverBootstrapsOrThrows()
    {
        var rows = new RowBuilderSettings
        {
            SchemaVersion = 3,
            Rules = [new RowBuilderRule
            {
                Id = "latest-anime", MediaType = "anime", SourceType = "latest", SourceValue = "anime",
                LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "anime", VirtualFolderId = string.Empty }
            }]
        };
        PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(rows);
        Assert.Equal("invalid", rows.Rules.Single().LibraryScope?.Mode);
    }

    [Theory]
    [InlineData("custom-anime", "anime", "latest", "anime", "anime")]
    [InlineData("latest-anime", "anime", "genre", "Animation", "anime")]
    [InlineData("latest-anime", "anime", "latest", "anime", "movies")]
    public void BoundDefaultLibraryRequiresCanonicalRuleAndMatchingKey(
        string ruleId, string mediaType, string sourceType, string sourceValue, string defaultKey)
    {
        var rows = new RowBuilderSettings
        {
            SchemaVersion = 3,
            Rules = [new RowBuilderRule
            {
                Id = ruleId,
                MediaType = mediaType,
                SourceType = sourceType,
                SourceValue = sourceValue,
                LibraryScope = new RowLibraryScope
                {
                    Mode = "defaultLibrary", DefaultKey = defaultKey, VirtualFolderId = AnimeId.ToString("N")
                }
            }]
        };

        PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(rows);

        Assert.Equal("invalid", rows.Rules.Single().LibraryScope?.Mode);
    }

    [Fact]
    public void BoundCanonicalDefaultLibraryKeepsPinnedIdAfterRename()
    {
        var rows = new RowBuilderSettings
        {
            SchemaVersion = 3,
            Rules = [new RowBuilderRule
            {
                Id = "latest-anime",
                Name = "My renamed shelf",
                MediaType = "anime",
                SourceType = "latest",
                SourceValue = "anime",
                LibraryScope = new RowLibraryScope
                {
                    Mode = "defaultLibrary", DefaultKey = "anime", VirtualFolderId = AnimeId.ToString("N")
                }
            }]
        };

        PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(rows);

        Assert.Equal("defaultLibrary", rows.Rules.Single().LibraryScope?.Mode);
        Assert.Equal(AnimeId.ToString("N"), rows.Rules.Single().LibraryScope?.VirtualFolderId);
    }

    [Fact]
    public void ChangedBuiltInTupleDoesNotAcquireLibraryOwnershipByIdAlone()
    {
        var rows = new RowBuilderSettings
        {
            SchemaVersion = 2,
            Rules = [new RowBuilderRule
            {
                Id = "latest-anime",
                MediaType = "anime",
                SourceType = "genre",
                SourceValue = "Animation"
            }]
        };

        PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(rows);
        var document = JsonSerializer.SerializeToDocument(rows);
        var scope = document.RootElement.GetProperty("rules")[0].GetProperty("libraryScope");

        Assert.NotEqual("global", scope.GetProperty("mode").GetString());
    }
}
