using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Querying;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

// Component/controller calls, not hosted HTTP or Jellyfin middleware integration tests.
[Collection("Configured row association serial")]
public sealed partial class PtvConfiguredRowAssociationTests
{
    private static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OtherUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid[] ItemIds = Enumerable.Range(1, 4).Select(i => Guid.Parse($"aaaaaaaa-aaaa-aaaa-aaaa-{i:D12}")).ToArray();

    [Fact]
    public async Task OwnedLatestRowsUseExactLibraryBeforeSelectionAndPreview()
    {
        using var fixture = new Fixture();
        var ids = new[] { "anime", "cartoons", "shows", "movies" }
            .ToDictionary(key => key, key => Guid.Parse($"dddddddd-dddd-dddd-dddd-{Array.IndexOf(new[] { "anime", "cartoons", "shows", "movies" }, key) + 1:D12}"));
        fixture.Configuration.Rows = new RowBuilderSettings
        {
            SchemaVersion = 3,
            Rules = ids.Select(pair => new RowBuilderRule
            {
                Id = "latest-" + pair.Key,
                Name = "Latest " + pair.Key,
                MediaType = pair.Key,
                SourceType = "latest",
                SourceValue = pair.Key,
                GenerationMode = "latest",
                LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = pair.Key, VirtualFolderId = pair.Value.ToString("N") }
            }).ToList()
        };
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Folders = ids.Select(pair => new VirtualFolderInfo
        {
            ItemId = pair.Value.ToString("N"),
            Name = char.ToUpperInvariant(pair.Key[0]) + pair.Key[1..],
            CollectionType = pair.Key == "movies" ? CollectionTypeOptions.movies : CollectionTypeOptions.tvshows,
            Locations = pair.Key == "anime" ? ["/media-local/Anime", "/mnt/ptv-media/Anime"] : ["/fake"]
        }).ToArray();
        proxy.ScopedItems = ids.ToDictionary(pair => pair.Value, pair =>
            Enumerable.Range(1, 2).Select(index => pair.Key == "movies"
                ? (BaseItem)NewMovie(pair.Key, index)
                : NewSeries(pair.Key, index)).ToArray());
        proxy.Root = new AggregateFolder
        {
            Children = Enumerable.Range(1, 1301).Select(index => (BaseItem)new Movie
            {
                Id = Guid.Parse($"abababab-abab-abab-abab-{index:D12}"),
                Name = "Foreign movie " + index,
                ForcedSortName = "Foreign movie " + index,
                ImageInfos = [new ItemImageInfo { Type = ImageType.Primary, DateModified = DateTime.UtcNow, Path = "test-image" }]
            }).ToArray()
        };
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var preview = await refresh.PreviewRowsAsync(fixture.Configuration.Rows, CancellationToken.None);
        Assert.Equal(4, preview.Rows.Count);
        Assert.All(preview.Rows, row => Assert.Equal(2, row.ItemCount));

        var status = await refresh.RefreshAsync(CancellationToken.None);
        Assert.Equal(9, status.Document.FeaturedContent!["version"]!.GetValue<int>());
        Assert.Equal(2, Payload(status.Document)["scopeSchemaVersion"]!.GetValue<int>());
        foreach (var section in Sections(status.Document))
        {
            var ruleId = section!["sourceRuleId"]!.GetValue<string>();
            var key = ruleId["latest-".Length..];
            Assert.Equal("library", section["scopeType"]!.GetValue<string>());
            Assert.Equal(ids[key].ToString("N"), section["libraryId"]!.GetValue<string>());
            Assert.False(string.IsNullOrWhiteSpace(section["resolvedScopeHash"]!.GetValue<string>()));
        }
        var sectionItems = Payload(status.Document)["sectionItems"]!.AsObject();
        foreach (var pair in ids)
        {
            var actual = sectionItems["latest-" + pair.Key]!.AsArray()
                .Select(item => Guid.Parse(item!["Id"]!.GetValue<string>())).ToArray();
            Assert.Equal(proxy.ScopedItems[pair.Value].Select(item => item.Id), actual);
        }
        Assert.Equal(8, proxy.ScopedQueryCalls); // preview and refresh, one complete page per library
    }

    private static Series NewSeries(string category, int index) => new()
    {
        Id = Guid.Parse($"eeeeeeee-eeee-eeee-{Math.Abs(category.GetHashCode()) % 10000:D4}-{index:D12}"),
        Name = category + " " + index,
        ForcedSortName = category + " " + index,
        Path = category == "anime" ? (index == 1 ? "/media-local/Anime/one" : "/mnt/ptv-media/Anime/two") : "/fake/" + category,
        DateCreated = DateTime.UtcNow.AddMinutes(-index),
        ImageInfos = [new ItemImageInfo { Type = ImageType.Primary, DateModified = DateTime.UtcNow, Path = "test-image" }]
    };

    private static Movie NewMovie(string category, int index) => new()
    {
        Id = Guid.Parse($"ffffffff-ffff-ffff-ffff-{index:D12}"),
        Name = category + " anime-like " + index,
        ForcedSortName = category + " anime-like " + index,
        DateCreated = DateTime.UtcNow.AddMinutes(-index),
        ImageInfos = [new ItemImageInfo { Type = ImageType.Primary, DateModified = DateTime.UtcNow, Path = "test-image" }]
    };

    [Fact]
    public async Task OwnedQueryFailureWithholdsOnlyAffectedRow()
    {
        using var fixture = new Fixture();
        var libraryId = Guid.Parse("99999999-9999-9999-9999-999999999999");
        fixture.Configuration.Rows = new RowBuilderSettings
        {
            SchemaVersion = 3,
            Rules =
            [
                new RowBuilderRule { Id = "owned", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = libraryId.ToString("N") } },
                new RowBuilderRule { Id = "editorial", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } }
            ]
        };
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Root = new AggregateFolder { Children = [NewMovie("global", 1)] };
        proxy.Folders = [new VirtualFolderInfo { ItemId = libraryId.ToString("N"), Name = "Movies", CollectionType = CollectionTypeOptions.movies, Locations = ["/fake"] }];
        proxy.FailScopedQuery = true;
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var status = await refresh.RefreshAsync(CancellationToken.None);
        var sections = Payload(status.Document)["sectionItems"]!.AsObject();
        Assert.Null(sections["owned"]);
        Assert.Single(sections["editorial"]!.AsArray());
    }

    [Theory]
    [InlineData("latest", "latest", "movies")]
    [InlineData("latest", "random", "movies")]
    [InlineData("latest", "highestRated", "movies")]
    [InlineData("genre", "latest", "Comedy")]
    [InlineData("studio", "latest", "Studio")]
    public async Task OwnedMembershipPrecedesEveryConfiguredRanking(string sourceType, string generationMode, string sourceValue)
    {
        using var fixture = new Fixture();
        var libraryId = Guid.Parse("77777777-7777-7777-7777-777777777777");
        var owned = NewMovie("owned", 1);
        owned.Genres = ["Comedy"];
        owned.Studios = ["Studio"];
        owned.CommunityRating = 5;
        var foreign = NewMovie("global", 2);
        foreign.Genres = ["Comedy"];
        foreign.Studios = ["Studio"];
        foreign.CommunityRating = 10;
        fixture.Configuration.Rows = new RowBuilderSettings
        {
            SchemaVersion = 3,
            Rules = [new RowBuilderRule
            {
                Id = "owned-rank", MediaType = "movies", SourceType = sourceType, SourceValue = sourceValue,
                GenerationMode = generationMode,
                LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = libraryId.ToString("N") }
            }]
        };
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Root = new AggregateFolder { Children = [foreign] };
        proxy.Folders = [new VirtualFolderInfo { ItemId = libraryId.ToString("N"), Name = "Movies", CollectionType = CollectionTypeOptions.movies, Locations = ["/fake"] }];
        proxy.ScopedItems[libraryId] = [owned];
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var status = await refresh.RefreshAsync(CancellationToken.None);
        var rows = Payload(status.Document)["sectionItems"]!.AsObject();
        var row = Assert.Single(rows);
        Assert.Equal(owned.Id.ToString("N"), Guid.Parse(Assert.Single(row.Value!.AsArray())!["Id"]!.GetValue<string>()).ToString("N"));
    }

    [Theory]
    [InlineData("renamed", true)]
    [InlineData("libraryDenied", false)]
    [InlineData("deleted", false)]
    [InlineData("rebound", false)]
    [InlineData("wrongType", false)]
    [InlineData("hashMismatch", false)]
    [InlineData("legacyV7", false)]
    public async Task OwnedResponseRevalidatesScopeAndRemovesOrphanItems(string scenario, bool expectRow)
    {
        using var fixture = new Fixture();
        var libraryId = Guid.Parse("66666666-6666-6666-6666-666666666666");
        var item = NewMovie("owned", 1);
        fixture.Configuration.Rows = new RowBuilderSettings
        {
            SchemaVersion = 3,
            Rules = [new RowBuilderRule
            {
                Id = "owned", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
                LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = libraryId.ToString("N") }
            }]
        };
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Root = new AggregateFolder { Children = [] };
        proxy.Folders = [new VirtualFolderInfo { ItemId = libraryId.ToString("N"), Name = "Movies", CollectionType = CollectionTypeOptions.movies, Locations = ["/fake"] }];
        proxy.ScopedItems[libraryId] = [item];
        proxy.Allowed = [item.Id, libraryId];
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        await refresh.RefreshAsync(CancellationToken.None);
        var document = await fixture.Store.ReadAsync(CancellationToken.None);
        Assert.Single(Sections(document));

        switch (scenario)
        {
            case "renamed": proxy.Folders[0].Name = "Renamed Movies"; break;
            case "libraryDenied": proxy.Allowed.Remove(libraryId); break;
            case "deleted": proxy.Folders = []; break;
            case "rebound": fixture.Configuration.Rows.Rules[0].LibraryScope!.VirtualFolderId = Guid.NewGuid().ToString("N"); break;
            case "wrongType": proxy.Folders[0].CollectionType = CollectionTypeOptions.tvshows; break;
            case "hashMismatch": Sections(document)[0]!["resolvedScopeHash"] = "forged"; break;
            case "legacyV7": document.FeaturedContent!["version"] = 7; break;
        }

        var response = new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, fixture.Authority)
            .AuthorizeForUser(document, UserId).Document!;
        Assert.Equal(expectRow ? 1 : 0, Sections(response).Count);
        Assert.Equal(expectRow ? 1 : 0, Payload(response)["sectionItems"]!.AsObject().Count);
    }

    [Fact]
    public async Task ClientCannotForgeOwnedCacheWrite()
    {
        using var fixture = new Fixture();
        var libraryId = Guid.Parse("55555555-5555-5555-5555-555555555555");
        fixture.Configuration.Rows.Rules[0].LibraryScope = new RowLibraryScope
        {
            Mode = "virtualFolder", VirtualFolderId = libraryId.ToString("N")
        };
        var forged = Document();
        Payload(forged)["scopeSchemaVersion"] = 2;
        var section = Assert.Single(Sections(forged))!.AsObject();
        section["scopeType"] = "library";
        section["libraryId"] = libraryId.ToString("N");
        section["resolvedScopeHash"] = "forged";

        await Assert.ThrowsAsync<PtvFeaturedContentValidationException>(
            () => fixture.Store.WriteAsync(forged, CancellationToken.None));
    }

    [Theory]
    [InlineData("SourceRuleId", "owned")]
    [InlineData("ScopeType", "library")]
    [InlineData("scopeType", "library")]
    public async Task ClientScopeValidationRejectsCaseVariantsAndAmbiguity(string field, string value)
    {
        using var fixture = new Fixture();
        fixture.Configuration.Rows.Rules[0].LibraryScope = new RowLibraryScope
        {
            Mode = "virtualFolder", VirtualFolderId = Guid.NewGuid().ToString("N")
        };
        fixture.Configuration.Rows.Rules[0].Id = "owned";
        var forged = Document();
        var section = Assert.Single(Sections(forged))!.AsObject();
        if (field == "SourceRuleId") section.Remove("sourceRuleId");
        section[field] = value;

        await Assert.ThrowsAsync<PtvFeaturedContentValidationException>(
            () => fixture.Store.WriteAsync(forged, CancellationToken.None));
    }

    [Theory]
    [InlineData("case-conflict")]
    [InlineData("non-string")]
    [InlineData("trimmed-owned")]
    [InlineData("contradictory-rules")]
    public async Task ClientScopeValidationRejectsMalformedClaims(string scenario)
    {
        using var fixture = new Fixture();
        fixture.Configuration.Rows.Rules[0].Id = "owned";
        fixture.Configuration.Rows.Rules[0].LibraryScope = new RowLibraryScope
        {
            Mode = "virtualFolder", VirtualFolderId = Guid.NewGuid().ToString("N")
        };
        var document = Document();
        var section = Assert.Single(Sections(document))!.AsObject();
        switch (scenario)
        {
            case "case-conflict": section["scopeType"] = "global"; section["ScopeType"] = "library"; break;
            case "non-string": section["scopeType"] = new JsonObject(); break;
            case "trimmed-owned": section["scopeType"] = " Library "; break;
            case "contradictory-rules": section["ruleId"] = "owned"; break;
        }

        await Assert.ThrowsAsync<PtvFeaturedContentValidationException>(
            () => fixture.Store.WriteAsync(document, CancellationToken.None));
    }

    [Fact]
    public void VersionEightOrphanItemsNeverBecomeGenericRows()
    {
        using var fixture = new Fixture();
        var document = Document();
        Payload(document)["sections"] = new JsonArray();
        Payload(document).Remove("scopeSchemaVersion");

        var response = fixture.Project(document, 1, associations: false);

        Assert.Empty(Sections(response));
        Assert.Empty(Payload(response)["sectionItems"]!.AsObject());
    }

    [Fact]
    public void LegacyGlobalDocumentIsNotRelabelledAsVersionEight()
    {
        using var fixture = new Fixture();
        var document = Document();
        document.FeaturedContent!["version"] = 7;

        var response = fixture.Project(document, 1, associations: false);

        Assert.Equal(7, response.FeaturedContent!["version"]!.GetValue<int>());
        Assert.Empty(Sections(response));
        Assert.Empty(Payload(response)["sectionItems"]!.AsObject());
    }

    [Fact]
    public async Task OwnedClaimWithNonconfiguredRowTypeIsRejected()
    {
        using var fixture = new Fixture();
        var libraryId = Guid.Parse("55555555-5555-5555-5555-555555555555");
        fixture.Configuration.Rows.Rules[0].LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = libraryId.ToString("N") };
        var item = NewMovie("owned", 1);
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Root = new AggregateFolder { Children = [] };
        proxy.Folders = [new VirtualFolderInfo { ItemId = libraryId.ToString("N"), Name = "Movies", CollectionType = CollectionTypeOptions.movies, Locations = ["/fake"] }];
        proxy.ScopedItems[libraryId] = [item];
        proxy.Allowed = [libraryId, item.Id];
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var document = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        Assert.Single(Sections(document));
        Sections(document)[0]!["rowType"] = "generic";

        var response = new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, fixture.Authority)
            .AuthorizeForUser(document, UserId).Document!;

        Assert.Empty(Sections(response));
        Assert.Empty(Payload(response)["sectionItems"]!.AsObject());
    }

    [Fact]
    public void PartiallyRedactedOwnedRowRetainsScopeWithoutPrivateSectionIdentity()
    {
        using var fixture = new Fixture();
        var libraryId = Guid.Parse("55555555-5555-5555-5555-555555555555");
        fixture.Configuration.Rows.Rules[0].LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = libraryId.ToString("N") };
        var document = Document(("PRIVATE_SENTINEL_section", "rule-a"));
        Payload(document)["scopeSchemaVersion"] = 2;
        var section = Assert.Single(Sections(document))!.AsObject();
        section["scopeType"] = "library";
        section["libraryId"] = libraryId.ToString("N");
        section["bindingKey"] = "";
        section["topologyEpoch"] = fixture.Ledger.State.Epoch;
        section["bindingGeneration"] = 0L;
        section["resolvedScopeHash"] = PtvHomeLibraryScopeResolver.ComputeScopeHash(fixture.Configuration.Rows.Rules[0], "resolved");
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Folders = [new VirtualFolderInfo { ItemId = libraryId.ToString("N"), Name = "Movies", CollectionType = CollectionTypeOptions.movies, Locations = ["/fake"] }];
        proxy.Allowed = ItemIds.Take(1).Append(libraryId).ToHashSet();

        var response = new PtvFeaturedContentAuthorizationService(Users(UserId, OtherUserId), libraries, fixture.Authority)
            .AuthorizeForUser(document, OtherUserId).Document!;
        var projected = Assert.Single(Sections(response))!;
        var wire = JsonSerializer.Serialize(response);

        Assert.DoesNotContain("PRIVATE_SENTINEL", wire);
        Assert.DoesNotContain("PRIVATE_SELECTOR", wire);
        Assert.Null(projected["sourceRuleId"]);
        Assert.Equal("library", projected["scopeType"]!.GetValue<string>());
        Assert.Equal(libraryId.ToString("N"), projected["libraryId"]!.GetValue<string>());
        Assert.Single(Payload(response)["sectionItems"]!.AsObject());
    }

    [Fact]
    public void RepeatedRejectedOwnedDocumentLogsOneSafeReasonPerGeneration()
    {
        using var fixture = new Fixture();
        fixture.Configuration.Rows.Rules[0].LibraryScope = new RowLibraryScope
        {
            Mode = "virtualFolder", VirtualFolderId = Guid.NewGuid().ToString("N")
        };
        var document = Document();
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var logger = new ScopeLogger();
        var projector = new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, fixture.Authority, logger);

        projector.AuthorizeForUser(document, UserId);
        projector.AuthorizeForUser(document, UserId);

        Assert.Single(logger.Messages);
        Assert.Contains("home-poisoned-payload-rejected", logger.Messages[0]);
        Assert.DoesNotContain("PRIVATE_SELECTOR", logger.Messages[0]);
        Assert.DoesNotContain(ItemIds[0].ToString("N"), logger.Messages[0]);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void MigratesCanonicalV2RulesAndPersistsIds(bool failSave)
    {
        using var fixture = new Fixture();
        var original = Plugin.Instance;
        var xml = DispatchProxy.Create<IXmlSerializer, XmlProxy>();
        var proxy = (XmlProxy)(object)xml;
        var plugin = new Plugin(fixture.Paths, xml);
        var pinned = Guid.Parse("33333333-3333-3333-3333-333333333333");
        try
        {
            plugin.UpdateConfiguration(new PluginConfiguration
            {
                Rows = new RowBuilderSettings
                {
                    SchemaVersion = 2,
                    Rules = [new RowBuilderRule { Id = "latest-anime", Name = "Renamed shelf", MediaType = "anime", SourceType = "latest", SourceValue = "anime" }]
                }
            });
            proxy.FailWrites = failSave;
            var service = new PtvPluginSettingsService(NullLogger<PtvPluginSettingsService>.Instance);
            var folders = new[] { new VirtualFolderInfo { ItemId = pinned.ToString("N"), Name = "Anime", CollectionType = CollectionTypeOptions.tvshows, Locations = ["/fake"] } };

            Assert.Equal(!failSave, service.BindDefaultLibraries(folders));
            var read = service.GetSettings();
            Assert.Equal(failSave ? null : pinned.ToString("N"), read.Rows.Rules.Single().LibraryScope?.VirtualFolderId);
            if (failSave)
            {
                Assert.True(PtvHomeLibraryScopeResolver.Resolve(read.Rows.Rules.Single(), folders).NeedsBinding);
            }
            Assert.Equal(failSave ? 1 : 2, proxy.Writes);
            if (!failSave)
            {
                var epoch = new PtvConfiguredRowAssociationService("server-a").CaptureGeneration()!.Epoch;
                Assert.True(service.BindDefaultLibraries(folders));
                Assert.Equal(epoch, new PtvConfiguredRowAssociationService("server-a").CaptureGeneration()!.Epoch);
                Assert.Equal(2, proxy.Writes);
            }
        }
        finally
        {
            typeof(Plugin).GetField("<Instance>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic)!.SetValue(null, original);
        }
    }

    [Fact]
    public async Task ResetResaveAndDefaultPinCannotClearDeletedLibraryTombstone()
    {
        using var fixture = new Fixture();
        var previous = Plugin.Instance;
        var plugin = new Plugin(fixture.Paths, DispatchProxy.Create<IXmlSerializer, XmlProxy>());
        var libraryId = Guid.Parse("33333333-3333-3333-3333-333333333333");
        var rule = new RowBuilderRule
        {
            Id = "latest-anime", Name = "Anime", MediaType = "anime", SourceType = "latest", SourceValue = "anime",
            LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "anime" }
        };
        try
        {
            plugin.UpdateConfiguration(new PluginConfiguration { Rows = new RowBuilderSettings { Rules = [rule] } });
            var ledger = new PtvHomeTopologyLedger(Path.Combine(fixture.Paths.PluginConfigurationsPath, "PiggieTV"),
                "server-a", () => plugin.Configuration.HomeTopologyLedgerInitialized,
                () => { plugin.Configuration.HomeTopologyLedgerInitialized = true; plugin.SaveConfiguration(); });
            await ledger.ReadAsync();
            var begun = await ledger.BeginAsync(new PtvHomeTransitionIntent
            {
                OperationId = Guid.NewGuid(), Kind = "delete", ServerId = "server-a", AffectedRuleIds = [rule.Id],
                ExpectedLibrary = new PtvHomeLibraryDefinition
                {
                    LibraryId = libraryId.ToString("N"), CollectionType = "tvshows", Name = "Anime", Roots = ["/anime"],
                    Options = JsonSerializer.SerializeToElement(new { })
                }
            });
            await ledger.CompleteAsync(begun.Operation!.Intent.OperationId,
                new PtvVerifiedTransitionReadback(begun.Epoch, null, null, true, true, true));
            var settings = (PtvPluginSettingsService)Activator.CreateInstance(typeof(PtvPluginSettingsService),
                NullLogger<PtvPluginSettingsService>.Instance, ledger)!;
            settings.ResetSettings();
            settings.SaveSettings(new PtvPluginSettingsPatchDto { Rows = new RowBuilderSettings { Rules = [rule] } });
            var sameNameAndId = new VirtualFolderInfo
            {
                ItemId = libraryId.ToString("N"), Name = "Anime", CollectionType = CollectionTypeOptions.tvshows,
                Locations = ["/anime"]
            };

            Assert.True(settings.BindDefaultLibraries([sameNameAndId]));
            Assert.Null(settings.GetSettings().Rows.Rules.Single().LibraryScope?.VirtualFolderId);
            Assert.True((await ledger.ReadAsync()).Bindings[rule.Id].Tombstoned);
        }
        finally
        {
            typeof(Plugin).GetField("<Instance>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic)!.SetValue(null, previous);
        }
    }

    [Fact]
    public async Task FirstControlledBeginSeedsUnaffectedUnpinnedDefaultWithoutAutoPinOrGlobalProofLoss()
    {
        using var fixture = new Fixture();
        var previous = Plugin.Instance;
        var xml = DispatchProxy.Create<IXmlSerializer, XmlProxy>();
        var writes = (XmlProxy)(object)xml;
        var plugin = new Plugin(fixture.Paths, xml);
        var animeId = Guid.Parse("33333333-3333-3333-3333-333333333333").ToString("N");
        var rule = new RowBuilderRule { Id = "latest-anime", MediaType = "anime", SourceType = "latest", SourceValue = "anime",
            LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "anime" } };
        try
        {
            plugin.UpdateConfiguration(new PluginConfiguration { Rows = new RowBuilderSettings { Rules =
            [rule, new RowBuilderRule { Id = "global", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
                LibraryScope = new RowLibraryScope { Mode = "global" } }] } });
            var ledger = new PtvHomeTopologyLedger(Path.Combine(fixture.Paths.PluginConfigurationsPath, "PiggieTV"),
                "server-a", () => plugin.Configuration.HomeTopologyLedgerInitialized,
                () => { plugin.Configuration.HomeTopologyLedgerInitialized = true; plugin.SaveConfiguration(); });
            await ledger.ReadAsync();
            var authority = new PtvConfiguredRowAssociationService("server-a", () => plugin.Configuration, ledger);
            var store = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, authority);
            var raw = await store.WriteGeneratedAsync(Document(("global", "global")), authority.CaptureGeneration()!, CancellationToken.None);
            Assert.Single(authority.CaptureCurrentPresentationProof(UserId, true)!.Bindings!);
            var before = new PtvHomeLibraryDefinition { LibraryId = Guid.NewGuid().ToString("N"), Name = "Movies",
                CollectionType = "movies", Roots = ["/movies"], Options = JsonSerializer.SerializeToElement(new { }) };
            var intended = new PtvHomeLibraryDefinition { LibraryId = string.Empty, Name = "Films",
                CollectionType = "movies", Roots = ["/movies"], Options = before.Options };
            var intent = new PtvHomeTransitionIntent { OperationId = Guid.NewGuid(), ServerId = "server-a",
                Kind = "rename", ExpectedLibrary = before, IntendedLibrary = intended };
            var begun = await ledger.BeginAsync(intent, new Dictionary<string, string> { [rule.Id] = animeId },
                new Dictionary<string, string> { [rule.Id] = PtvHomeLibraryScopeResolver.ScopeFingerprint(rule) });
            authority.RetireLibraryPresentation();
            var verified = new PtvHomeLibraryDefinition { LibraryId = Guid.NewGuid().ToString("N"), Name = "Films",
                CollectionType = "movies", Roots = ["/movies"], Options = before.Options };
            await ledger.CompleteAsync(intent.OperationId,
                new PtvVerifiedTransitionReadback(begun.Epoch, verified, null, true, true, true));
            var beforeWrites = writes.Writes;
            var settings = new PtvPluginSettingsService(NullLogger<PtvPluginSettingsService>.Instance, ledger);
            var folders = new[] { new VirtualFolderInfo { ItemId = animeId, Name = "Anime",
                CollectionType = CollectionTypeOptions.tvshows, Locations = ["/anime"] } };

            Assert.True(settings.BindDefaultLibraries(folders));

            Assert.Equal(beforeWrites, writes.Writes);
            Assert.Null(plugin.Configuration.Rows.Rules.Single(candidate => candidate.Id == rule.Id).LibraryScope!.VirtualFolderId);
            Assert.Equal("resolved", PtvHomeLibraryScopeResolver.Resolve(rule, folders, await ledger.ReadAsync()).Status);
            Assert.NotNull(authority.CaptureCurrentPresentationProof(UserId, true));
            Assert.Single(authority.CaptureCurrentPresentationProof(UserId, true)!.Bindings!);
            Assert.Equal("global", Assert.Single(Sections(await store.ReadAsync(CancellationToken.None)))!["id"]!.GetValue<string>());
        }
        finally
        {
            typeof(Plugin).GetField("<Instance>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic)!.SetValue(null, previous);
        }
    }

    [Theory]
    [InlineData(4)]
    [InlineData(3)]
    [InlineData(1)]
    [InlineData(0)]
    public async Task AuthorizationSurvivorsAndSelectiveRedactionAreUnchanged(int survivors)
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var before = JsonSerializer.Serialize(raw);
        var baseline = fixture.Project(raw, survivors, associations: false);
        var response = fixture.Project(raw, survivors);
        var sections = Sections(response);
        Assert.Equal(Sections(baseline).Count, sections.Count);
        Assert.Equal(Payload(baseline)["sectionItems"]!.ToJsonString(), Payload(response)["sectionItems"]!.ToJsonString());
        if (survivors > 0)
        {
            var section = Assert.IsType<JsonObject>(Assert.Single(sections));
            var alias = Assert.IsType<JsonObject>(section["configuredRowAssociation"]);
            AssertToken(alias["scope"]);
            AssertToken(alias["rule"]);
            AssertToken(alias["section"]);
            var mapping = fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]!;
            Assert.Equal(mapping["scope"]!.GetValue<string>(), alias["scope"]!.GetValue<string>());
            Assert.Equal(mapping["rules"]![0]!["association"]!.GetValue<string>(), alias["rule"]!.GetValue<string>());
            Assert.Equal(mapping["sections"]![0]!["section"]!.GetValue<string>(), alias["section"]!.GetValue<string>());
            Assert.Equal(1, alias["version"]!.GetValue<int>());
            if (survivors < 4)
            {
                Assert.Null(section["sourceRuleId"]);
                Assert.DoesNotContain("PRIVATE_SELECTOR", section.ToJsonString());
            }
            else
            {
                Assert.Equal("rule-a", section["sourceRuleId"]!.GetValue<string>());
            }
            section.Remove("configuredRowAssociation");
        }
        Payload(response).Remove("currentPresentationAuthority");
        Assert.Equal(JsonSerializer.Serialize(baseline), JsonSerializer.Serialize(response));
        Assert.Equal(before, JsonSerializer.Serialize(raw));
    }

    [Fact]
    public async Task MultiSectionRulesHaveSharedRuleAndUniqueExactSectionPairs()
    {
        using var fixture = new Fixture();
        fixture.Configuration.Rows.Rules[0].RowCount = 3;
        fixture.Configuration.Rows.Rules[0].IncludeSubgenres = true;
        fixture.Configuration.Rows.Rules[0].SubgenreRowCount = 2;
        var raw = await fixture.Generate(Document(("genre-a", "rule-a"), ("genre-b", "rule-a"), ("genre-c", "rule-a")));
        var aliases = Sections(fixture.Project(raw, 1)).Select(s => s!["configuredRowAssociation"]!).ToArray();
        Assert.Single(aliases.Select(a => a["rule"]!.GetValue<string>()).Distinct());
        Assert.Equal(3, aliases.Select(a => a["section"]!.GetValue<string>()).Distinct().Count());
        var pairs = fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]!["sections"]!.AsArray();
        Assert.Equal(3, pairs.Count);
        Assert.All(aliases, alias => Assert.Single(pairs, p => p!["rule"]!.ToJsonString() == alias["rule"]!.ToJsonString() && p["section"]!.ToJsonString() == alias["section"]!.ToJsonString()));
    }

    [Fact]
    public async Task SectionTokenDependsOnPrivateInstanceNonceNotRawIdTitleOrOrdinal()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate(Document(("genre-0", "rule-a"), ("genre-1", "rule-a")));
        var projection = fixture.Authority.CaptureProjection(raw, UserId)!;
        var originalAlias = projection.ForSection("genre-0")!;
        var owner = projection.Binding.SectionOwners["genre-0"];
        // Isolate token derivation from the projector lookup: the same private instance moved
        // to a different internal lookup ID must produce the very same opaque instance token.
        var renamedBinding = projection.Binding with
        {
            SectionOwners = new Dictionary<string, PtvConfiguredRowAssociationService.SectionOwner> { ["not-a-genre-or-ordinal"] = owner }
        };
        var renamed = new PtvConfiguredRowAssociationService.Projection(fixture.Authority, renamedBinding, UserId);
        Assert.Equal(originalAlias.ToJsonString(), renamed.ForSection("not-a-genre-or-ordinal")!.ToJsonString());
        Assert.NotEqual(originalAlias["section"]!.ToJsonString(), projection.ForSection("genre-1")!["section"]!.ToJsonString());
        Assert.DoesNotContain(owner.InstanceNonce, originalAlias.ToJsonString());
    }

    [Fact]
    public async Task InstanceTokensSurviveReadbackReloadButRotateOnNewTrustedGeneration()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var first = fixture.Authority.CaptureProjection(raw, UserId)!.ForSection("section-a")!;
        for (var read = 0; read < 3; read++)
        {
            var reloaded = await fixture.Store.ReadAsync(CancellationToken.None);
            Assert.Equal(first.ToJsonString(), fixture.Authority.CaptureProjection(reloaded, UserId)!.ForSection("section-a")!.ToJsonString());
        }
        var next = await fixture.Generate();
        var nextAlias = fixture.Authority.CaptureProjection(next, UserId)!.ForSection("section-a")!;
        Assert.Equal(first["rule"]!.ToJsonString(), nextAlias["rule"]!.ToJsonString());
        Assert.NotEqual(first["section"]!.ToJsonString(), nextAlias["section"]!.ToJsonString());
    }

    [Fact]
    public async Task SameTitlesAndMediaTypesDoNotMergeRules()
    {
        using var fixture = new Fixture();
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "rule-b", Name = "Same", SourceType = "latest", SourceValue = "movies", MediaType = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } });
        var raw = await fixture.Generate(Document(("first", "rule-a"), ("second", "rule-b")));
        var aliases = Sections(fixture.Project(raw, 1)).Select(s => s!["configuredRowAssociation"]!["rule"]!.GetValue<string>()).ToArray();
        Assert.Equal(2, aliases.Distinct().Count());
    }

    [Fact]
    public async Task GenericOrphanAndUnknownRulesCannotImpersonateConfiguredRows()
    {
        using var fixture = new Fixture();
        var document = Document(("generic", "rule-a"), ("unknown", "absent"));
        Sections(document)[0]!["rowType"] = "generic";
        var raw = await fixture.Generate(document);
        Assert.All(Sections(fixture.Project(raw, 1)), s => Assert.Null(s!["configuredRowAssociation"]));
    }

    [Theory]
    [InlineData("disabled")]
    [InlineData("deleted")]
    [InlineData("reordered")]
    [InlineData("changed")]
    [InlineData("aba")]
    public async Task ConfigurationMutationsRetireOldGeneration(string mutation)
    {
        using var fixture = new Fixture();
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "rule-b", SourceType = "latest", SourceValue = "movies" });
        var raw = await fixture.Generate();
        using (PtvConfiguredRowAssociationService.BeginConfigurationMutation())
        {
            if (mutation == "disabled") fixture.Configuration.Rows.Rules[0].Enabled = false;
            if (mutation == "deleted") fixture.Configuration.Rows.Rules.RemoveAt(0);
            if (mutation == "reordered") fixture.Configuration.Rows.Rules.Reverse();
            if (mutation is "changed" or "aba") fixture.Configuration.Rows.Rules[0].Name = "Changed";
        }
        if (mutation == "aba")
        {
            using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Same";
        }
        Assert.All(Sections(fixture.Project(raw, 1)), s => Assert.Null(s!["configuredRowAssociation"]));
        Assert.Null(fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]);
    }

    [Fact]
    public async Task UnobservedConfigurationChangeIsStillDetectedByPrivateDigest()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        fixture.Configuration.Rows.Rules[0].SourceValue = "other";
        Assert.Null(Sections(fixture.Project(raw, 1))[0]!["configuredRowAssociation"]);
    }

    [Fact]
    public async Task UsersServersAndRestartNeverShareAliases()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var first = Sections(fixture.Project(raw, 1))[0]!["configuredRowAssociation"]!;
        var other = Sections(fixture.Project(raw, 1, userId: OtherUserId))[0]!["configuredRowAssociation"]!;
        Assert.NotEqual(first["scope"]!.ToJsonString(), other["scope"]!.ToJsonString());
        Assert.NotEqual(first["rule"]!.ToJsonString(), other["rule"]!.ToJsonString());
        var restarted = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration, fixture.Ledger);
        Assert.Null(restarted.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]);
        var otherServer = new PtvConfiguredRowAssociationService("server-b", () => fixture.Configuration);
        Assert.Null(otherServer.CaptureProjection(raw, UserId));
        var freshStore = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, restarted);
        var fresh = await freshStore.WriteGeneratedAsync(Document(), restarted.CaptureGeneration()!, CancellationToken.None);
        var newProjection = restarted.CaptureProjection(fresh, UserId)!;
        Assert.NotEqual(first["scope"]!.GetValue<string>(), newProjection.ForSection("section-a")!["scope"]!.GetValue<string>());
    }

    [Fact]
    public async Task RawPutEvenIdenticalAndClearRetireTrustedBinding()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var projected = fixture.Project(raw, 1);
        await fixture.Store.WriteAsync(raw, CancellationToken.None);
        fixture.Authority.FinalizeResponse(projected);
        Assert.Null(Sections(projected)[0]!["configuredRowAssociation"]);
        Assert.Null(Sections(fixture.Project(raw, 1))[0]!["configuredRowAssociation"]);
        raw = await fixture.Generate();
        await fixture.Store.ClearAsync(CancellationToken.None);
        Assert.Null(Sections(fixture.Project(raw, 1))[0]!["configuredRowAssociation"]);
    }

    [Fact]
    public async Task OldOrSpoofedRawCacheCannotBeRetrospectivelyAttested()
    {
        using var fixture = new Fixture();
        var document = Document();
        Sections(document)[0]!["configuredRowAssociation"] = new JsonObject { ["version"] = 1, ["scope"] = new string('a', 64), ["rule"] = new string('b', 64), ["section"] = new string('c', 64) };
        var raw = await fixture.Store.WriteAsync(document, CancellationToken.None);
        Assert.Null(Sections(fixture.Project(raw, 1))[0]!["configuredRowAssociation"]);
        Assert.Null(fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]);
    }

    [Theory]
    [InlineData("duplicate-section")]
    [InlineData("ambiguous-source-rule")]
    [InlineData("contradictory-rule")]
    [InlineData("malformed-rule")]
    public async Task AmbiguousSourceMetadataDoesNotReceiveAliases(string malformed)
    {
        using var fixture = new Fixture();
        var document = Document();
        var section = Sections(document)[0]!;
        if (malformed == "duplicate-section") Sections(document).Add(section.DeepClone());
        if (malformed == "ambiguous-source-rule") section["SourceRuleId"] = "rule-a";
        if (malformed == "contradictory-rule") section["ruleId"] = "rule-b";
        if (malformed == "malformed-rule") section["sourceRuleId"] = new JsonObject();
        if (malformed == "duplicate-section")
        {
            await Assert.ThrowsAsync<PtvFeaturedContentValidationException>(() => fixture.Generate(document));
            return;
        }
        var raw = await fixture.Generate(document);
        Assert.All(Sections(fixture.Project(raw, 1)), s => Assert.Null(s!["configuredRowAssociation"]));
    }

    [Fact]
    public async Task InflightGenerationAndProjectedResponseRetireOnMutation()
    {
        using var fixture = new Fixture();
        var generation = fixture.Authority.CaptureGeneration()!;
        var immutable = generation.CreateConfiguration();
        using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].SourceValue = "changed";
        Assert.Equal("movies", immutable.Rows.Rules[0].SourceValue);
        var stale = await fixture.Store.WriteGeneratedAsync(Document(), generation, CancellationToken.None);
        Assert.Null(Sections(fixture.Project(stale, 1))[0]!["configuredRowAssociation"]);
        var current = await fixture.Generate();
        var response = fixture.Project(current, 1);
        using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) { }
        fixture.Authority.FinalizeResponse(response);
        Assert.Null(Sections(response)[0]!["configuredRowAssociation"]);
    }

    [Fact]
    public async Task StoredDigestAndCurrentStoreIdentityRejectReplay()
    {
        using var fixture = new Fixture();
        var first = await fixture.Generate();
        var projected = fixture.Project(first, 1);
        var next = await fixture.Generate(Document(("new-section", "rule-a")));
        fixture.Authority.FinalizeResponse(projected);
        Assert.Null(Sections(projected)[0]!["configuredRowAssociation"]);
        Assert.Null(fixture.Authority.CaptureProjection(first, UserId));
        Sections(next)[0]!["sourceRuleId"] = "edited";
        Assert.Null(fixture.Authority.CaptureProjection(next, UserId));
    }

    [Fact]
    public async Task FailedStoreReplacementCallbackRetainsPriorBindingAndDoesNotBindAttemptedDocument()
    {
        using var fixture = new Fixture();
        var retained = await fixture.Generate();
        var priorProof = fixture.Authority.CaptureCurrentPresentationProof(UserId, true)!;
        var priorAuthority = priorProof.Authority.ToJsonString();
        var priorBindings = priorProof.Bindings!.ToJsonString();
        var attempted = Document(("replacement", "rule-a"));
        var generation = fixture.Authority.CaptureGeneration()!;

        Assert.Throws<IOException>(() => fixture.Authority.CommitStoreReplacement(
            () => throw new IOException("Replacement callback failed before publication."), generation, attempted));

        Assert.NotNull(fixture.Authority.CaptureProjection(retained, UserId));
        Assert.Null(fixture.Authority.CaptureProjection(attempted, UserId));
        var after = fixture.Authority.CaptureCurrentPresentationProof(UserId, true)!;
        Assert.Equal(priorAuthority, after.Authority.ToJsonString());
        Assert.Equal(priorBindings, after.Bindings!.ToJsonString());
        Assert.Equal(retained.FeaturedContent!.ToJsonString(),
            (await fixture.Store.ReadAsync(CancellationToken.None)).FeaturedContent!.ToJsonString());
    }

    [Fact]
    public async Task DisabledDeletedAndNormalizationCollidingRulesAreNotIssued()
    {
        using var fixture = new Fixture();
        fixture.Configuration.Rows.Rules[0].Enabled = false;
        var raw = await fixture.Generate();
        Assert.Null(Sections(fixture.Project(raw, 1))[0]!["configuredRowAssociation"]);
        Assert.Empty(fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]!["rules"]!.AsArray());
        fixture.Configuration.Rows.Rules.Clear();
        raw = await fixture.Generate();
        Assert.Empty(Sections(fixture.Project(raw, 1)));
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "rule-a" });
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "rule a" });
        raw = await fixture.Generate();
        Assert.Null(fixture.Authority.CaptureProjection(raw, UserId));
        Assert.Null(fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]);
    }

    [Fact]
    public async Task UnknownServerOrRequestIdentityNeverPublishesMapping()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        Assert.Null(fixture.Authority.CaptureProjection(raw, Guid.Empty));
        Assert.Null(fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, Guid.Empty)["configuredRowAssociations"]);
        var missing = new PtvConfiguredRowAssociationService(string.Empty, () => fixture.Configuration);
        Assert.Null(missing.CaptureGeneration());
        Assert.Null(missing.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ConditionalRefreshRecoversNewProcessFromPersistedCacheExactlyOnce(bool expired)
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var original = await processA.RefreshAsync(CancellationToken.None);
        Assert.Null(processA.GetRefreshStatus().LastRefreshError);
        var oldProof = fixture.Authority.CaptureCurrentPresentationProof(UserId, true)!.Authority.ToJsonString();
        Assert.True(original.FeaturedCacheFresh);
        AssertLatestMappings(fixture.Authority, original.Document);
        if (expired)
        {
            original.Document.UpdatedAt = DateTimeOffset.UtcNow.AddDays(-2).ToUnixTimeMilliseconds();
            original.Document.FeaturedContent!["createdAt"] = original.Document.UpdatedAt;
            original.Document.FeaturedContent!["expiresAt"] = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeMilliseconds();
            await fixture.Store.WriteGeneratedAsync(original.Document, fixture.Authority.CaptureGeneration()!, CancellationToken.None);
        }

        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration, fixture.Ledger);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        var persisted = await storeB.GetStatusAsync(CancellationToken.None);
        Assert.Equal(!expired, persisted.FeaturedCacheFresh);
        Assert.Null(issuerB.CaptureProjection(persisted.Document, UserId));
        Assert.Null(issuerB.CaptureCurrentPresentationProof(UserId, true));
        var enrichment = CompletedEnrichment();
        using var processB = CreateRefresh(storeB, issuerB, libraries, enrichment);

        var recovered = await processB.RefreshIfNeededAsync(CancellationToken.None);

        Assert.NotNull(issuerB.CaptureProjection(recovered.Document, UserId));
        AssertLatestMappings(issuerB, recovered.Document);
        Assert.NotEqual(oldProof, issuerB.CaptureCurrentPresentationProof(UserId, true)!.Authority.ToJsonString());
        var recoveredJson = recovered.Document.FeaturedContent!.ToJsonString();
        for (var read = 0; read < 5; read++)
        {
            var later = await processB.RefreshIfNeededAsync(CancellationToken.None);
            Assert.Equal(recoveredJson, later.Document.FeaturedContent!.ToJsonString());
        }
        Assert.Equal(1, enrichment.Calls);
    }

    [Fact]
    public async Task EmptyConfiguredSourceRecoversWithoutInventingSectionOrRetrying()
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        var library = (LibraryProxy)(object)libraries;
        library.Root!.Children = library.Root.Children.Where(item => item is not MusicAlbum).ToArray();
        var musicId = Guid.Parse("cccccccc-cccc-cccc-cccc-000000000003");
        library.ScopedItems[musicId] = [];
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        await processA.RefreshAsync(CancellationToken.None);
        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration, fixture.Ledger);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        Assert.Null(issuerB.CaptureProjection((await storeB.GetStatusAsync(CancellationToken.None)).Document, UserId));
        var enrichment = CompletedEnrichment();
        using var processB = CreateRefresh(storeB, issuerB, libraries, enrichment);

        var recovered = await processB.RefreshIfNeededAsync(CancellationToken.None);

        Assert.Null(processB.GetRefreshStatus().LastRefreshError);
        Assert.NotNull(issuerB.CaptureProjection(recovered.Document, UserId));
        Assert.Equal(new[] { "Latest movies", "Latest shows" }, Sections(recovered.Document).Select(section => section!["title"]!.GetValue<string>()).Order());
        Assert.Equal(2, issuerB.CaptureCurrentPresentationProof(UserId, true)!.Bindings!.Count);
        for (var read = 0; read < 5; read++) await processB.RefreshIfNeededAsync(CancellationToken.None);
        Assert.Equal(1, enrichment.Calls);
    }

    [Fact]
    public async Task ConcurrentConditionalRecoveryWaitsForOneTrustedGeneration()
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        await processA.RefreshAsync(CancellationToken.None);
        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration, fixture.Ledger);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        var enrichment = new EnrichmentStub();
        using var processB = CreateRefresh(storeB, issuerB, libraries, enrichment);
        var pending = processB.RefreshIfNeededAsync(CancellationToken.None);
        await Task.WhenAny(enrichment.Started.Task, pending).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.True(enrichment.Started.Task.IsCompleted, "Fresh disk cache must start normal trusted recovery.");
        var concurrent = Enumerable.Range(0, 20).Select(_ => processB.RefreshIfNeededAsync(CancellationToken.None)).ToArray();
        Assert.Null(issuerB.CaptureProjection(await storeB.ReadAsync(CancellationToken.None), UserId));
        Assert.Null(issuerB.CaptureCurrentPresentationProof(UserId, true));
        enrichment.Complete.TrySetResult();
        var results = await Task.WhenAll(concurrent.Append(pending)).WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(1, enrichment.Calls);
        Assert.All(results, result => AssertLatestMappings(issuerB, result.Document));
        Assert.Single(results.Select(result => result.Document.FeaturedContent!.ToJsonString()).Distinct());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FailedRecoveryRetainsOldCacheAndUsesBoundedOwnerRetry(bool expired)
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var original = await processA.RefreshAsync(CancellationToken.None);
        if (expired)
        {
            original.Document.UpdatedAt = DateTimeOffset.UtcNow.AddDays(-2).ToUnixTimeMilliseconds();
            original.Document.FeaturedContent!["createdAt"] = original.Document.UpdatedAt;
            original.Document.FeaturedContent!["expiresAt"] = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeMilliseconds();
            await fixture.Store.WriteGeneratedAsync(original.Document, fixture.Authority.CaptureGeneration()!, CancellationToken.None);
        }
        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration, fixture.Ledger);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        var before = (await storeB.ReadAsync(CancellationToken.None)).FeaturedContent!.ToJsonString();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.FailEnumeration = true;
        var priorReads = proxy.Enumerations;
        using var processB = CreateRefresh(storeB, issuerB, libraries, CompletedEnrichment());
        await processB.RefreshIfNeededAsync(CancellationToken.None);
        Assert.NotNull(processB.GetRefreshStatus().LastRefreshError);
        var results = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => processB.RefreshIfNeededAsync(CancellationToken.None)));

        Assert.Equal(1, proxy.Enumerations - priorReads);
        Assert.All(results, result => Assert.Equal(before, result.Document.FeaturedContent!.ToJsonString()));
        Assert.Null(issuerB.CaptureCurrentPresentationProof(UserId, true));
        var remaining = processB.GetRefreshStatus().NextRefreshAt!.Value - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        Assert.InRange(remaining, 14 * 60_000, 15 * 60_000);
        var delay = ReadHostedDelay(processB, results[0]);
        Assert.InRange(delay.TotalMinutes, 14, 15);

        proxy.FailEnumeration = false;
        MakeRecoveryRetryDue(processB);
        var recovered = await processB.RefreshIfNeededAsync(CancellationToken.None);
        AssertLatestMappings(issuerB, recovered.Document);
        Assert.Null(processB.GetRefreshStatus().LastRefreshError);
        Assert.Equal(2, proxy.Enumerations - priorReads);
        Assert.Equal(recovered.FeaturedCacheExpiresAt, processB.GetRefreshStatus().NextRefreshAt);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RecoveryConfigurationRaceCannotIssueTrustAndDoesNotQueueAStorm(bool returnToOriginal)
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        await processA.RefreshAsync(CancellationToken.None);
        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration, fixture.Ledger);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        var enrichment = new EnrichmentStub();
        using var processB = CreateRefresh(storeB, issuerB, libraries, enrichment);
        var pending = processB.RefreshIfNeededAsync(CancellationToken.None);
        await enrichment.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Changed";
        if (returnToOriginal)
        {
            using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Latest movies";
        }
        var queued = Enumerable.Range(0, 20).Select(_ => processB.RefreshIfNeededAsync(CancellationToken.None)).ToArray();
        enrichment.Complete.TrySetResult();
        var first = await pending;
        Assert.Null(issuerB.CaptureProjection(first.Document, UserId));
        await Task.WhenAll(queued);
        Assert.Equal(1, enrichment.Calls);
        Assert.Null(issuerB.CaptureCurrentPresentationProof(UserId, true));
        Assert.InRange(ReadHostedDelay(processB, first).TotalMinutes, 14, 15);
        MakeRecoveryRetryDue(processB);
        var current = await processB.RefreshIfNeededAsync(CancellationToken.None);
        Assert.NotNull(issuerB.CaptureProjection(current.Document, UserId));
        Assert.Equal(2, enrichment.Calls);
        Assert.Contains(Sections(current.Document), section => section!["title"]!.GetValue<string>() == (returnToOriginal ? "Latest movies" : "Changed"));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ConcreteRefreshUsesCapturedConfigurationAndRegistersOnlyCurrentGeneration(bool mutateDuringEnrichment)
    {
        using var fixture = new Fixture();
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        ((LibraryProxy)(object)libraries).Root = new AggregateFolder
        {
            Children = Enumerable.Range(1, 16).Select(index => new Movie
            {
                Id = Guid.NewGuid(),
                Name = "Movie " + index,
                DateCreated = DateTime.UtcNow,
                ImageInfos = [new ItemImageInfo { Type = ImageType.Primary, DateModified = DateTime.UtcNow, Path = "test-image" }]
            }).ToArray()
        };
        var enrichment = new EnrichmentStub();
        var refresh = new PtvFeaturedContentRefreshService(fixture.Store, libraries, NullLogger<PtvFeaturedContentRefreshService>.Instance, enrichment, fixture.Authority);
        var pending = refresh.RefreshAsync(CancellationToken.None);
        await enrichment.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        if (mutateDuringEnrichment)
        {
            using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Later configuration";
        }
        enrichment.Complete.SetResult();
        var status = await pending;
        Assert.True(status.FeaturedCacheExists);
        Assert.Null(refresh.GetRefreshStatus().LastRefreshError);
        var rawSection = Assert.Single(Sections(status.Document));
        Assert.Equal("Same", rawSection!["title"]!.GetValue<string>());
        var projection = fixture.Authority.CaptureProjection(status.Document, UserId);
        Assert.Equal(!mutateDuringEnrichment, projection is not null);
        var reloaded = await fixture.Store.ReadAsync(CancellationToken.None);
        Assert.Equal(!mutateDuringEnrichment, fixture.Authority.CaptureProjection(reloaded, UserId) is not null);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(8)]
    [InlineData(16)]
    public async Task StartupRecoveryPreservesAuthorizedSurvivorsAndRestrictedRedaction(int allowedPerSection)
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var original = await processA.RefreshAsync(CancellationToken.None);
        var proxy = (LibraryProxy)(object)libraries;
        var allowed = Enumerable.Range(1, 48).Where(index => (index - 1) % 16 < allowedPerSection)
            .Select(index => Guid.Parse($"bbbbbbbb-bbbb-bbbb-bbbb-{index:D12}")).ToHashSet();
        proxy.Allowed = allowed.Concat(proxy.Folders.Select(folder => Guid.Parse(folder.ItemId))).ToHashSet();
        var baseline = new PtvFeaturedContentAuthorizationService(Users(UserId, OtherUserId), libraries, fixture.Authority)
            .AuthorizeForUser(original.Document, OtherUserId).Document!;
        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration, fixture.Ledger);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        using var processB = CreateRefresh(storeB, issuerB, libraries, CompletedEnrichment());
        var restored = await processB.RefreshIfNeededAsync(CancellationToken.None);
        var rawBefore = JsonSerializer.Serialize(restored.Document);
        var response = new PtvFeaturedContentAuthorizationService(Users(UserId, OtherUserId), libraries, issuerB)
            .AuthorizeForUser(restored.Document, OtherUserId).Document!;
        Assert.Equal(Payload(baseline)["sectionItems"]!.ToJsonString(), Payload(response)["sectionItems"]!.ToJsonString());
        var actual = Payload(response)["sectionItems"]!.AsObject().SelectMany(pair => pair.Value!.AsArray())
            .Select(item => Guid.Parse(item!["Id"]!.GetValue<string>())).ToHashSet();
        Assert.True(allowed.SetEquals(actual));
        Assert.Equal(allowedPerSection == 0 ? 0 : 3, Sections(response).Count);
        Assert.All(Sections(response), section =>
        {
            Assert.NotNull(section!["configuredRowAssociation"]);
            if (allowedPerSection < 16)
            {
                Assert.Null(section["sourceRuleId"]);
                Assert.Null(section["ruleId"]);
                Assert.Null(section["sourceValue"]);
            }
        });
        Assert.Null(issuerB.CaptureCurrentPresentationProof(OtherUserId, false)!.Bindings);
        Assert.Equal(rawBefore, JsonSerializer.Serialize(restored.Document));
    }

    [Fact]
    public async Task CancelledConditionalWaiterDoesNotCancelOrDuplicateSharedRecovery()
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        await fixture.Generate();
        var issuer = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration, fixture.Ledger);
        var store = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuer);
        var enrichment = new EnrichmentStub();
        using var refresh = CreateRefresh(store, issuer, libraries, enrichment);
        var active = refresh.RefreshIfNeededAsync(CancellationToken.None);
        await enrichment.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        using var cancellation = new CancellationTokenSource();
        var waiter = refresh.RefreshIfNeededAsync(cancellation.Token);
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiter);
        Assert.False(active.IsCompleted);
        enrichment.Complete.SetResult();
        AssertLatestMappings(issuer, (await active).Document);
        AssertLatestMappings(issuer, (await refresh.RefreshIfNeededAsync(CancellationToken.None)).Document);
        Assert.Equal(1, enrichment.Calls);
    }

    [Fact]
    public async Task ExplicitRefreshStillRegeneratesAfterConditionalOwnerCompletes()
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        await fixture.Generate();
        var issuer = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration, fixture.Ledger);
        var store = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuer);
        var enrichment = new EnrichmentStub();
        using var refresh = CreateRefresh(store, issuer, libraries, enrichment);
        var active = refresh.RefreshIfNeededAsync(CancellationToken.None);
        await enrichment.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var forced = refresh.RefreshAsync(CancellationToken.None);
        enrichment.Complete.SetResult();
        await active;
        AssertLatestMappings(issuer, (await forced).Document);
        Assert.Equal(2, enrichment.Calls);
        await refresh.RefreshIfNeededAsync(CancellationToken.None);
        Assert.Equal(2, enrichment.Calls);
    }

    [Fact]
    public async Task HostedStartupUsesConditionalRecoveryWithoutAnyClientReadTrigger()
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        await processA.RefreshAsync(CancellationToken.None);
        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration, fixture.Ledger);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        var enrichment = new EnrichmentStub();
        using var worker = CreateRefresh(storeB, issuerB, libraries, enrichment);
        await worker.StartAsync(CancellationToken.None);
        try
        {
            // Wait for the real hosted owner's existing startup delay, not an arbitrary test sleep.
            await enrichment.Started.Task.WaitAsync(TimeSpan.FromSeconds(30));
            Assert.Null(issuerB.CaptureCurrentPresentationProof(UserId, true));
            enrichment.Complete.SetResult();
            AssertLatestMappings(issuerB, (await worker.RefreshIfNeededAsync(CancellationToken.None)).Document);
            Assert.Equal(1, enrichment.Calls);
        }
        finally
        {
            await worker.StopAsync(CancellationToken.None);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ActiveHostedTtlWaitIsRescheduledWhenForcedRecoveryFails(bool retiredWrite)
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        await processA.RefreshAsync(CancellationToken.None);
        var clock = new ScheduleClock();
        var enrichment = CompletedEnrichment();
        using var worker = new PtvFeaturedContentRefreshService(fixture.Store, libraries,
            NullLogger<PtvFeaturedContentRefreshService>.Instance, enrichment, fixture.Authority, clock);
        await worker.StartAsync(CancellationToken.None);
        try
        {
            var startup = await clock.NextTimer();
            Assert.Equal(TimeSpan.FromSeconds(10), startup.Delay);
            clock.Fire(startup);
            var originalWait = await clock.NextTimer();
            Assert.True(originalWait.Delay > TimeSpan.FromHours(1));
            using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) { }
            var proxy = (LibraryProxy)(object)libraries;
            if (retiredWrite)
                enrichment.OnFacts = () => { using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) { } };
            else
                proxy.FailEnumeration = true;
            var failed = await worker.RefreshAsync(CancellationToken.None);
            Assert.Null(fixture.Authority.CaptureCurrentPresentationProof(UserId, true));
            Assert.InRange(worker.GetRefreshStatus().NextRefreshAt!.Value - clock.GetUtcNow().ToUnixTimeMilliseconds(), 14 * 60_000, 15 * 60_000);

            var retry = await clock.NextTimer();
            Assert.True(originalWait.IsDisposed, "The superseded long TTL timer must be retired.");
            Assert.InRange(retry.Delay.TotalMinutes, 14, 15);
            proxy.FailEnumeration = false;
            enrichment.OnFacts = null;
            clock.Fire(retry);
            var afterRecovery = await clock.NextTimer();
            Assert.True(afterRecovery.Delay > TimeSpan.FromHours(1));
            AssertLatestMappings(fixture.Authority, await fixture.Store.ReadAsync(CancellationToken.None));
            Assert.Null(worker.GetRefreshStatus().LastRefreshError);
        }
        finally
        {
            await worker.StopAsync(CancellationToken.None);
        }
        Assert.Equal(0, clock.ActiveTimers);
    }

    [Fact]
    public async Task TrustedExpiredRefreshFailureKeepsExistingSchedulingFloor()
    {
        using var fixture = new Fixture();
        var document = Document();
        document.UpdatedAt = DateTimeOffset.UtcNow.AddDays(-2).ToUnixTimeMilliseconds();
        document.FeaturedContent!["createdAt"] = document.UpdatedAt;
        document.FeaturedContent!["expiresAt"] = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeMilliseconds();
        await fixture.Generate(document);
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        ((LibraryProxy)(object)libraries).FailEnumeration = true;
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var result = await refresh.RefreshIfNeededAsync(CancellationToken.None);
        Assert.False(result.FeaturedCacheFresh);
        Assert.NotNull(fixture.Authority.CaptureProjection(result.Document, UserId));
        Assert.NotNull(refresh.GetRefreshStatus().LastRefreshError);
        Assert.Equal(TimeSpan.FromMinutes(1), ReadHostedDelay(refresh, result));
    }

    [Fact]
    public async Task MutationDuringItemProjectionRemovesAllAliasesWithoutChangingSurvivors()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Allowed = ItemIds.Take(1).ToHashSet();
        proxy.OnLookup = () =>
        {
            using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Mutated";
        };
        var response = new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, fixture.Authority).AuthorizeForUser(raw, UserId).Document!;
        var section = Assert.Single(Sections(response));
        Assert.Null(section!["configuredRowAssociation"]);
        Assert.Null(Payload(response)["currentPresentationAuthority"]);
        Assert.Single(Payload(response)["sectionItems"]![section["id"]!.GetValue<string>()]!.AsArray());
    }

    [Fact]
    public async Task ConcurrentIdenticalPutRetiresProjectionBeforePublication()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Allowed = ItemIds.Take(1).ToHashSet();
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var release = new ManualResetEventSlim();
        proxy.OnLookup = () =>
        {
            started.TrySetResult();
            Assert.True(release.Wait(TimeSpan.FromSeconds(5)));
        };
        var projecting = Task.Run(() => new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, fixture.Authority).AuthorizeForUser(raw, UserId).Document!);
        try
        {
            await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
            await fixture.Store.WriteAsync(raw, CancellationToken.None);
        }
        finally
        {
            release.Set();
        }
        var response = await projecting;
        var section = Assert.Single(Sections(response));
        Assert.Null(section!["configuredRowAssociation"]);
        Assert.Null(Payload(response)["currentPresentationAuthority"]);
        Assert.Single(Payload(response)["sectionItems"]![section["id"]!.GetValue<string>()]!.AsArray());
    }

    [Fact]
    public async Task StockUpdateAndPtvSaveRetireAliasesIncludingAbaAndIdenticalSave()
    {
        using var fixture = new Fixture();
        var oldInstance = Plugin.Instance;
        var xml = DispatchProxy.Create<IXmlSerializer, XmlProxy>();
        var plugin = new Plugin(fixture.Paths, xml);
        try
        {
            plugin.UpdateConfiguration(fixture.Configuration);
            var authority = new PtvConfiguredRowAssociationService("server-a");
            var store = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, authority);
            var raw = await store.WriteGeneratedAsync(Document(), authority.CaptureGeneration()!, CancellationToken.None);
            Assert.NotNull(authority.CaptureProjection(raw, UserId));
            var changed = new PluginConfiguration();
            plugin.UpdateConfiguration(changed);
            plugin.UpdateConfiguration(fixture.Configuration);
            Assert.Null(authority.CaptureProjection(raw, UserId));
            raw = await store.WriteGeneratedAsync(Document(), authority.CaptureGeneration()!, CancellationToken.None);
            new PtvPluginSettingsService(NullLogger<PtvPluginSettingsService>.Instance).SaveSettings(new PtvPluginSettingsPatchDto());
            Assert.Null(authority.CaptureProjection(raw, UserId));
            Assert.Equal(4, ((XmlProxy)(object)xml).Writes);
            Assert.Same(fixture.Configuration, plugin.Configuration);
        }
        finally
        {
            typeof(Plugin).GetField("<Instance>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic)!.SetValue(null, oldInstance);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task BothAdministratorEndpointsCloneResponsesAndKeepRestrictedPolicy(bool rowsFallback)
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        var settings = PtvPluginSettingsDto.FromConfiguration(fixture.Configuration);
        var before = JsonSerializer.Serialize(settings);
        var users = Users(UserId, OtherUserId);
        var services = new ServiceCollection()
            .AddSingleton(fixture.Authority)
            .AddSingleton(users)
            .AddSingleton<IAuthorizationService>(new AuthorizationStub())
            .AddSingleton<IPtvPluginSettingsService>(new SettingsStub(settings))
            .BuildServiceProvider();
        var controller = Controller(services, UserId);
        var result = rowsFallback ? (await controller.GetRows()).Result : (await controller.GetSettings()).Result;
        var value = Assert.IsType<OkObjectResult>(result).Value;
        var json = JsonSerializer.SerializeToNode(value)!;
        var rows = rowsFallback ? json : json["rows"]!;
        Assert.NotNull(rows["configuredRowAssociations"]);
        rows["rules"]![0]!["name"] = "client edited";
        Assert.Equal(before, JsonSerializer.Serialize(settings));
        Assert.DoesNotContain("configuredRowAssociations", JsonSerializer.Serialize(fixture.Configuration));
        controller = Controller(services, OtherUserId);
        result = rowsFallback ? (await controller.GetRows()).Result : (await controller.GetSettings()).Result;
        Assert.Equal(403, Assert.IsType<ObjectResult>(result).StatusCode);
    }

    [Theory]
    [InlineData(4)]
    [InlineData(3)]
    [InlineData(1)]
    [InlineData(0)]
    public async Task FreshnessInputsAgreeWithFinalAuthoritativeReadWithoutChangingSurvivors(int survivors)
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var rawBefore = JsonSerializer.Serialize(raw);
        var projected = fixture.Project(raw, survivors);
        var rows = fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId);
        var featuredAuthority = AssertAuthority(Payload(projected)["currentPresentationAuthority"]);
        var rowsAuthority = AssertAuthority(rows["currentPresentationAuthority"]);
        var status = await ReadStatus(fixture);
        var finalAuthority = AssertAuthority(status["currentPresentationAuthority"]);
        Assert.Equal(featuredAuthority.ToJsonString(), rowsAuthority.ToJsonString());
        Assert.Equal(featuredAuthority.ToJsonString(), finalAuthority.ToJsonString());
        Assert.Equal(rows["configuredRowAssociations"]!["scope"]!.ToJsonString(), finalAuthority["scope"]!.ToJsonString());
        Assert.Equal(rows["configuredRowAssociations"]!["sections"]!.ToJsonString(), status["configuredPresentationBindings"]!.ToJsonString());
        Assert.Equal(rawBefore, JsonSerializer.Serialize(raw));
        Assert.Equal(Payload(fixture.Project(raw, survivors, associations: false))["sectionItems"]!.ToJsonString(), Payload(projected)["sectionItems"]!.ToJsonString());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FreshnessStatusFastAndFullAreProtectedNoStoreAndPublishCoherentAdminPairs(bool full)
    {
        using var fixture = new Fixture();
        await fixture.Generate(Document(("first", "rule-a"), ("second", "rule-a")));
        using var services = StatusServices(fixture);
        var controller = Controller(services, UserId);
        var result = Assert.IsType<OkObjectResult>(await controller.GetStatus(full, CancellationToken.None));
        var status = JsonSerializer.SerializeToNode(result.Value)!;
        AssertAuthority(status["currentPresentationAuthority"]);
        Assert.Equal(2, status["configuredPresentationBindings"]!.AsArray().Count);
        Assert.Equal("private, no-store", controller.Response.Headers.CacheControl.ToString());
        Assert.Equal("no-cache", controller.Response.Headers.Pragma.ToString());
        Assert.Equal("0", controller.Response.Headers.Expires.ToString());
        Assert.NotEmpty(typeof(PtvStatusController).GetCustomAttributes<AuthorizeAttribute>());
        var cache = typeof(PtvStatusController).GetMethod(nameof(PtvStatusController.GetStatus))!.GetCustomAttribute<ResponseCacheAttribute>();
        Assert.True(cache?.NoStore);
        Assert.Equal(ResponseCacheLocation.None, cache!.Location);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FreshnessBothAdminSettingsPathsCloneAuthorityWithoutPersistence(bool rowsFallback)
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        var settings = PtvPluginSettingsDto.FromConfiguration(fixture.Configuration);
        var before = JsonSerializer.Serialize(settings);
        using var services = StatusServices(fixture);
        var controller = Controller(services, UserId);
        var result = rowsFallback ? (await controller.GetRows()).Result : (await controller.GetSettings()).Result;
        var json = JsonSerializer.SerializeToNode(Assert.IsType<OkObjectResult>(result).Value)!;
        var rows = rowsFallback ? json : json["rows"]!;
        var authority = AssertAuthority(rows["currentPresentationAuthority"]);
        var original = authority.ToJsonString();
        authority["generation"] = new string('0', 64);
        Assert.Equal(original, (await ReadStatus(fixture))["currentPresentationAuthority"]!.ToJsonString());
        Assert.Equal(before, JsonSerializer.Serialize(settings));
        Assert.DoesNotContain("currentPresentationAuthority", JsonSerializer.Serialize(fixture.Configuration));
        Assert.DoesNotContain("currentPresentationAuthority", JsonSerializer.Serialize(await fixture.Store.ReadAsync(CancellationToken.None)));
        var restricted = Controller(services, OtherUserId);
        var denied = rowsFallback ? (await restricted.GetRows()).Result : (await restricted.GetSettings()).Result;
        Assert.Equal(403, Assert.IsType<ObjectResult>(denied).StatusCode);
    }

    [Theory]
    [InlineData("change")]
    [InlineData("aba")]
    [InlineData("identical")]
    [InlineData("same-config-regeneration")]
    [InlineData("put")]
    [InlineData("clear")]
    public async Task FreshnessFinalReadCannotValidateMutuallyStaleInputs(string transition)
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var oldFeatured = AssertAuthority(Payload(fixture.Project(raw, 1))["currentPresentationAuthority"]).ToJsonString();
        var oldRows = AssertAuthority(fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["currentPresentationAuthority"]).ToJsonString();
        Assert.Equal(oldRows, oldFeatured);
        var oldStatus = await ReadStatus(fixture);
        Assert.Equal(oldFeatured, oldStatus["currentPresentationAuthority"]!.ToJsonString());
        if (transition is "change" or "aba" or "identical")
        {
            using (PtvConfiguredRowAssociationService.BeginConfigurationMutation())
                if (transition != "identical") fixture.Configuration.Rows.Rules[0].Name = "Changed";
            if (transition == "aba")
                using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Same";
            Assert.Null((await ReadStatus(fixture))["currentPresentationAuthority"]);
        }
        if (transition == "put") await fixture.Store.WriteAsync(raw, CancellationToken.None);
        else if (transition == "clear") await fixture.Store.ClearAsync(CancellationToken.None);
        else await fixture.Generate();
        var final = await ReadStatus(fixture);
        if (transition is "put" or "clear")
        {
            Assert.Null(final["currentPresentationAuthority"]);
            Assert.Null(final["configuredPresentationBindings"]);
        }
        else
        {
            var current = AssertAuthority(final["currentPresentationAuthority"]);
            Assert.NotEqual(oldFeatured, current.ToJsonString());
            Assert.NotEqual(oldStatus["configuredPresentationBindings"]!.ToJsonString(), final["configuredPresentationBindings"]!.ToJsonString());
            if (transition == "same-config-regeneration")
                Assert.Equal(oldStatus["currentPresentationAuthority"]!["scope"]!.ToJsonString(), current["scope"]!.ToJsonString());
        }
        // The earlier proof remains an immutable point-in-time observation, not live mutable state.
        Assert.Equal(oldFeatured, oldStatus["currentPresentationAuthority"]!.ToJsonString());
    }

    [Fact]
    public async Task FreshnessOldAndNewSettingsFeaturedInputsExposeDifferentAuthority()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var oldRows = fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId);
        var oldFeatured = fixture.Project(raw, 1);
        using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Next";
        raw = await fixture.Generate();
        var currentRows = fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId);
        var currentFeatured = fixture.Project(raw, 1);
        Assert.NotEqual(AssertAuthority(oldRows["currentPresentationAuthority"]).ToJsonString(), AssertAuthority(Payload(currentFeatured)["currentPresentationAuthority"]).ToJsonString());
        Assert.NotEqual(AssertAuthority(currentRows["currentPresentationAuthority"]).ToJsonString(), AssertAuthority(Payload(oldFeatured)["currentPresentationAuthority"]).ToJsonString());
        Assert.Equal(currentRows["currentPresentationAuthority"]!.ToJsonString(), (await ReadStatus(fixture))["currentPresentationAuthority"]!.ToJsonString());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FreshnessRestartAndServerSwitchRequireNewTrustedBinding(bool otherServer)
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var first = AssertAuthority((await ReadStatus(fixture))["currentPresentationAuthority"]).ToJsonString();
        var next = new PtvConfiguredRowAssociationService(otherServer ? "server-b" : "server-a", () => fixture.Configuration);
        Assert.Null((await ReadStatus(fixture, authority: next))["currentPresentationAuthority"]);
        Assert.Null(next.CaptureProjection(raw, UserId));
        var nextStore = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, next);
        await nextStore.WriteGeneratedAsync(Document(), next.CaptureGeneration()!, CancellationToken.None);
        Assert.NotEqual(first, AssertAuthority((await ReadStatus(fixture, authority: next))["currentPresentationAuthority"]).ToJsonString());
    }

    [Fact]
    public async Task FreshnessRestrictedStatusHasOwnOpaqueScopeButNeverAdminBindingsOrRawMetadata()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var admin = await ReadStatus(fixture);
        var restricted = await ReadStatus(fixture, userId: OtherUserId);
        var restrictedAuthority = AssertAuthority(restricted["currentPresentationAuthority"]);
        Assert.NotEqual(AssertAuthority(admin["currentPresentationAuthority"]).ToJsonString(), restrictedAuthority.ToJsonString());
        Assert.Null(restricted["configuredPresentationBindings"]);
        Assert.Equal(restrictedAuthority.ToJsonString(), AssertAuthority(Payload(fixture.Project(raw, 1, userId: OtherUserId))["currentPresentationAuthority"]).ToJsonString());
        var wire = restricted.ToJsonString();
        foreach (var privateValue in new[] { "rule-a", "PRIVATE_SELECTOR", "sourceRuleId", "configuredRowAssociations", "section-a" }.Concat(ItemIds.Select(id => id.ToString("N"))))
            Assert.DoesNotContain(privateValue, wire);
        var restrictedSection = Assert.Single(Sections(fixture.Project(raw, 1, userId: OtherUserId)));
        Assert.Null(restrictedSection!["ruleId"]);
        Assert.Null(restrictedSection["sourceRuleId"]);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("empty")]
    [InlineData("malformed")]
    [InlineData("contradictory")]
    [InlineData("unauthenticated")]
    [InlineData("unresolved-user")]
    [InlineData("no-user-manager")]
    public async Task FreshnessUnknownRequestIdentityDoesNotPublishProofOrBindings(string failure)
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        var requested = failure == "unresolved-user" ? Guid.NewGuid() : UserId;
        using var services = StatusServices(fixture, includeUsers: failure != "no-user-manager");
        var controller = Controller(services, requested);
        var identity = (ClaimsIdentity)controller.User.Identity!;
        if (failure == "missing") identity.RemoveClaim(identity.Claims.Single());
        if (failure is "empty" or "malformed")
        {
            identity.RemoveClaim(identity.Claims.Single());
            identity.AddClaim(new Claim("Jellyfin-UserId", failure == "empty" ? Guid.Empty.ToString() : "not-a-user"));
        }
        if (failure == "contradictory") identity.AddClaim(new Claim("Jellyfin-UserId", OtherUserId.ToString()));
        if (failure == "unauthenticated") controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(identity.Claims));
        var result = Assert.IsType<OkObjectResult>(await controller.GetStatus(false, CancellationToken.None));
        var status = JsonSerializer.SerializeToNode(result.Value)!;
        Assert.Null(status["currentPresentationAuthority"]);
        Assert.Null(status["configuredPresentationBindings"]);
        Assert.Equal("private, no-store", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public async Task FreshnessStatusDoesNotPromoteMissingServiceOrFailedAuthorityResolution()
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        using var noAuthority = new ServiceCollection().AddSingleton(Users(UserId)).BuildServiceProvider();
        var missing = JsonSerializer.SerializeToNode(Assert.IsType<OkObjectResult>(await Controller(noAuthority, UserId).GetStatus(false, CancellationToken.None)).Value)!;
        Assert.Null(missing["currentPresentationAuthority"]);
        var failResolution = false;
        var fail = new PtvConfiguredRowAssociationService("server-a", () => failResolution ? throw new InvalidOperationException("PRIVATE_FAILURE") : fixture.Configuration);
        var store = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, fail);
        await store.WriteGeneratedAsync(Document(), fail.CaptureGeneration()!, CancellationToken.None);
        failResolution = true;
        var status = await ReadStatus(fixture, authority: fail);
        Assert.Null(status["currentPresentationAuthority"]);
        Assert.Null(status["configuredPresentationBindings"]);
        Assert.DoesNotContain("PRIVATE_FAILURE", status.ToJsonString());
    }

    [Fact]
    public async Task FreshnessStatusReadsOnlyCurrentEligiblePairsAndReturnsDetachedObjects()
    {
        using var fixture = new Fixture();
        var document = Document(("first", "rule-a"), ("second", "rule-a"), ("generic", "rule-a"), ("unknown", "absent"));
        Sections(document)[2]!["rowType"] = "generic";
        var raw = await fixture.Generate(document);
        var first = await ReadStatus(fixture);
        var pairs = Assert.IsType<JsonArray>(first["configuredPresentationBindings"]);
        Assert.Equal(2, pairs.Count);
        Assert.Single(pairs.Select(pair => pair!["rule"]!.GetValue<string>()).Distinct());
        Assert.Equal(2, pairs.Select(pair => pair!["section"]!.GetValue<string>()).Distinct().Count());
        foreach (var pair in pairs)
        {
            Assert.Equal(new[] { "rule", "section" }, pair!.AsObject().Select(p => p.Key).OrderBy(k => k).ToArray());
            AssertToken(pair["rule"]);
            AssertToken(pair["section"]);
        }
        var before = first.ToJsonString();
        var binding = fixture.Authority.CaptureProjection(raw, UserId)!.Binding;
        Assert.DoesNotContain(binding.GenerationNonce, before);
        Assert.DoesNotContain(binding.Generation.Binding, before);
        Assert.DoesNotContain(binding.DocumentDigest, before);
        first["currentPresentationAuthority"]!["generation"] = new string('0', 64);
        pairs.Clear();
        Assert.Equal(before, (await ReadStatus(fixture)).ToJsonString());
        Assert.DoesNotContain("currentPresentationAuthority", JsonSerializer.Serialize(raw));
    }

    [Fact]
    public async Task FreshnessSpoofedOldCacheMetadataCannotEstablishAnyProof()
    {
        using var fixture = new Fixture();
        var trusted = await fixture.Generate();
        var valid = AssertAuthority(Payload(fixture.Project(trusted, 1))["currentPresentationAuthority"]).DeepClone();
        var spoofed = Document();
        Payload(spoofed)["currentPresentationAuthority"] = valid;
        Payload(spoofed)["configuredPresentationBindings"] = (await ReadStatus(fixture))["configuredPresentationBindings"]!.DeepClone();
        var raw = await fixture.Store.WriteAsync(spoofed, CancellationToken.None);
        var projected = fixture.Project(raw, 1);
        Assert.Null(Payload(projected)["currentPresentationAuthority"]);
        Assert.Null(Payload(projected)["configuredPresentationBindings"]);
        Assert.Null((await ReadStatus(fixture))["currentPresentationAuthority"]);
        Assert.Single(Payload(projected)["sectionItems"]![Sections(projected)[0]!["id"]!.GetValue<string>()]!.AsArray());
    }

    [Fact]
    public async Task FreshnessProjectedResponseCannotBorrowReplacementBinding()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var pending = fixture.Project(raw, 1);
        var first = AssertAuthority(Payload(pending)["currentPresentationAuthority"]).ToJsonString();
        await fixture.Generate();
        var next = AssertAuthority((await ReadStatus(fixture))["currentPresentationAuthority"]).ToJsonString();
        Assert.NotEqual(first, next);
        fixture.Authority.FinalizeResponse(pending);
        Assert.Null(Payload(pending)["currentPresentationAuthority"]);
        Assert.All(Sections(pending), section => Assert.Null(section!["configuredRowAssociation"]));
        Assert.Single(Payload(pending)["sectionItems"]![Sections(pending)[0]!["id"]!.GetValue<string>()]!.AsArray());
    }

    [Fact]
    public async Task FreshnessMutationObservedBeforeStatusSnapshotReturnsUnknown()
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        AssertAuthority((await ReadStatus(fixture))["currentPresentationAuthority"]);
        using (PtvConfiguredRowAssociationService.BeginConfigurationMutation())
        {
            // All service calls in this direct-controller seam complete synchronously. This also
            // proves a reentrant read during the mutation scope cannot certify its old binding.
            var pending = ReadStatus(fixture);
            Assert.True(pending.IsCompletedSuccessfully);
            var status = await pending;
            Assert.Null(status["currentPresentationAuthority"]);
            Assert.Null(status["configuredPresentationBindings"]);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FreshnessFeaturedControllerMatchesFinalProofWithoutPublishingAdministratorBindings(bool restricted)
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var users = Users(UserId, OtherUserId);
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        ((LibraryProxy)(object)libraries).Allowed = ItemIds.Take(2).ToHashSet();
        var projector = new PtvFeaturedContentAuthorizationService(users, libraries, fixture.Authority);
        var userId = restricted ? OtherUserId : UserId;
        var ledger = new PtvHomeUserAccessLedger(Path.Combine(fixture.Paths.PluginConfigurationsPath,
            $"featured-proof-{userId:N}"), "server-a");
        var currentAccess = PtvHomeUserAccessController.Access(((UserProxy)(object)users).Users[userId]);
        var epoch = fixture.Authority.ReadTopology()!.Epoch;
        var batch = await ledger.BeginVerificationBatchAsync([userId], epoch);
        await ledger.VerifyBatchCandidateAsync(batch.Id, userId, currentAccess, currentAccess, [], epoch);
        using var services = StatusServices(fixture, users: users, projector: projector, access: ledger, libraries: libraries);
        var controller = Controller(services, userId);
        var result = Assert.IsType<OkObjectResult>((await controller.GetFeaturedContent(CancellationToken.None)).Result);
        var document = Assert.IsType<PtvFeaturedContentDocument>(result.Value);
        var authority = AssertAuthority(Payload(document)["currentPresentationAuthority"]);
        Assert.Equal(authority.ToJsonString(), (await ReadStatus(fixture, userId))["currentPresentationAuthority"]!.ToJsonString());
        Assert.Null(Payload(document)["configuredPresentationBindings"]);
        Assert.Equal(2, Payload(document)["sectionItems"]![Sections(document)[0]!["id"]!.GetValue<string>()]!.AsArray().Count);
        Assert.DoesNotContain("currentPresentationAuthority", JsonSerializer.Serialize(raw));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    public async Task FeaturedBindsOwnedRowsToCurrentUserEpochWhileKeepingGlobal(int scenario)
    {
        using var fixture = new Fixture();
        var libraryId = Guid.Parse("99999999-9999-9999-9999-999999999999");
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule
        {
            Id = "owned", Name = "Owned", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = libraryId.ToString("N") }
        });
        var source = Document(("global", "rule-a"), ("owned", "owned"));
        var owned = Sections(source)[1]!.AsObject();
        owned["scopeType"] = "library";
        owned["libraryId"] = libraryId.ToString("N");
        owned["bindingKey"] = "";
        owned["topologyEpoch"] = fixture.Ledger.State.Epoch;
        owned["bindingGeneration"] = 0L;
        owned["resolvedScopeHash"] = PtvHomeLibraryScopeResolver.ComputeScopeHash(fixture.Configuration.Rows.Rules[1], "resolved");
        var raw = await fixture.Generate(source);
        Assert.Equal(2, Sections(raw).Count);
        var users = Users(UserId);
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        ((LibraryProxy)(object)libraries).Allowed = ItemIds.Append(libraryId).ToHashSet();
        ((LibraryProxy)(object)libraries).CurrentCollections.Add(libraryId);
        ((LibraryProxy)(object)libraries).Folders = [new VirtualFolderInfo { ItemId = libraryId.ToString("N"), Name = "Movies", CollectionType = CollectionTypeOptions.movies, Locations = ["/fake"] }];
        var projector = new PtvFeaturedContentAuthorizationService(users, libraries, fixture.Authority);
        var ledger = new PtvHomeUserAccessLedger(Path.Combine(fixture.Paths.PluginConfigurationsPath, "featured-access"), "server-a");
        IPtvHomeUserAccessLedger access = ledger;
        string? accessEpoch = null;
        if (scenario >= 1)
        {
            var current = PtvHomeUserAccessController.Access(((UserProxy)(object)users).Users[UserId]);
            var epoch = fixture.Authority.ReadTopology()!.Epoch;
            var batch = await ledger.BeginVerificationBatchAsync([UserId], epoch);
            accessEpoch = (await ledger.VerifyBatchCandidateAsync(batch.Id, UserId, current, current,
                [libraryId.ToString("N")], epoch)).AccessEpoch;
            if (scenario == 1) access = new BeginAfterFirstAccessRead(ledger, current, epoch);
        }
        using var services = StatusServices(fixture, users: users, projector: projector, access: access,
            libraries: libraries);

        var result = Assert.IsType<OkObjectResult>((await Controller(services, UserId).GetFeaturedContent(CancellationToken.None)).Result);
        var document = Assert.IsType<PtvFeaturedContentDocument>(result.Value);
        Assert.Equal(scenario == 2 ? ["global", "owned"] : [],
            Sections(document).Select(section => section!["id"]!.GetValue<string>()).ToArray());
        if (scenario == 2)
        {
            Assert.NotEmpty(Payload(document)["heroItems"]!.AsArray());
            Assert.Equal(accessEpoch, Payload(document)["heroAccessEpoch"]!.GetValue<string>());
            Assert.Equal(accessEpoch, Sections(document)[1]!["userAccessEpoch"]!.GetValue<string>());
            Assert.Null(Sections(document)[0]!["userAccessEpoch"]);
            Assert.DoesNotContain("userAccessEpoch", JsonSerializer.Serialize(raw));
            var statusResult = Assert.IsType<OkObjectResult>(await Controller(services, UserId).GetStatus(false, CancellationToken.None));
            var status = JsonSerializer.SerializeToNode(statusResult.Value)!;
            Assert.Equal(Sections(document)[1]!["userAccessEpoch"]!.GetValue<string>(),
                status["currentHomeUserAccess"]!["accessEpoch"]!.GetValue<string>());
        }
        else
        {
            Assert.Null(Payload(document)["sectionItems"]!["owned"]);
            Assert.Empty(Payload(document)["heroItems"]!.AsArray());
            Assert.Null(Payload(document)["heroAccessEpoch"]);
        }
        if (scenario == 2) Assert.NotNull(Payload(document)["sectionItems"]!["global"]);
        else Assert.Null(Payload(document)["sectionItems"]!["global"]);
        Assert.NotNull(Payload(document)["currentPresentationAuthority"]);
        if (access is BeginAfterFirstAccessRead racing) Assert.True(racing.Began);
    }

    [Fact]
    public async Task FreshnessFastProofDoesNotNeedStoreOrSettingsReads()
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        using var services = new ServiceCollection()
            .AddSingleton(fixture.Authority)
            .AddSingleton(Users(UserId))
            .AddSingleton<IAuthorizationService>(new AuthorizationStub())
            .BuildServiceProvider();
        var result = Assert.IsType<OkObjectResult>(await Controller(services, UserId).GetStatus(false, CancellationToken.None));
        var status = JsonSerializer.SerializeToNode(result.Value)!;
        AssertAuthority(status["currentPresentationAuthority"]);
        Assert.Single(status["configuredPresentationBindings"]!.AsArray());
    }

    [Fact]
    public async Task StatusReportsUnknownAuthenticatedUserAsHomeOwnershipUnproven()
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        var access = new PtvHomeUserAccessLedger(Path.Combine(fixture.Paths.PluginConfigurationsPath, "PiggieTV-user-access"), "server-a");
        using var services = new ServiceCollection()
            .AddSingleton(fixture.Authority)
            .AddSingleton<IPtvHomeUserAccessLedger>(access)
            .AddSingleton(Users(UserId))
            .AddSingleton<IAuthorizationService>(new AuthorizationStub())
            .BuildServiceProvider();

        var result = Assert.IsType<OkObjectResult>(await Controller(services, UserId).GetStatus(false, CancellationToken.None));
        var status = JsonSerializer.SerializeToNode(result.Value)!;
        var userAccess = Assert.IsType<JsonObject>(status["currentHomeUserAccess"]);
        Assert.Equal(UserId.ToString("N"), userAccess["userId"]!.GetValue<string>());
        Assert.True(userAccess["held"]!.GetValue<bool>());
        Assert.False(userAccess["policyProven"]!.GetValue<bool>());
        Assert.Null(userAccess["accessEpoch"]);
        Assert.Equal(["accessEpoch", "held", "policyProven", "userId", "version"],
            userAccess.Select(property => property.Key).Order(StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public async Task SafeStatusRejectsAccessProofHeldAfterItsFirstRead()
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        var users = Users(UserId);
        var user = ((UserProxy)(object)users).Users[UserId];
        var access = PtvHomeUserAccessController.Access(user);
        var ledger = new PtvHomeUserAccessLedger(Path.Combine(fixture.Paths.PluginConfigurationsPath, "access-race"), "server-a");
        var epoch = fixture.Authority.ReadTopology()!.Epoch;
        var batch = await ledger.BeginVerificationBatchAsync([UserId], epoch);
        await ledger.VerifyBatchCandidateAsync(batch.Id, UserId, access, access, [], epoch);
        var racing = new BeginAfterFirstAccessRead(ledger, access, epoch);
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        using var services = new ServiceCollection()
            .AddSingleton(fixture.Authority)
            .AddSingleton(users)
            .AddSingleton(libraries)
            .AddSingleton<IPtvHomeUserAccessLedger>(racing)
            .AddSingleton<IAuthorizationService>(new AuthorizationStub())
            .BuildServiceProvider();

        var response = Assert.IsType<OkObjectResult>(await Controller(services, UserId).GetStatus(false, CancellationToken.None));
        var status = JsonSerializer.SerializeToNode(response.Value)!.AsObject();
        var userAccess = status["currentHomeUserAccess"]!.AsObject();
        Assert.True(racing.Began);
        Assert.True(userAccess["held"]!.GetValue<bool>());
        Assert.False(userAccess["policyProven"]!.GetValue<bool>());
        Assert.Equal(["accessEpoch", "held", "policyProven", "userId", "version"],
            userAccess.Select(property => property.Key).Order(StringComparer.Ordinal).ToArray());
    }

    private sealed class BeginAfterFirstAccessRead(
        PtvHomeUserAccessLedger inner, PtvHomeAccessDefinition access, string topologyEpoch) : IPtvHomeUserAccessLedger
    {
        public bool Began { get; private set; }
        public async Task<PtvHomeUserAccessView> ReadAsync(Guid userId, PtvHomeAccessDefinition? currentAccess,
            string? epoch, CancellationToken token = default, IReadOnlyCollection<string>? currentAccessibleLibraryIds = null)
        {
            var view = await inner.ReadAsync(userId, currentAccess, epoch, token, currentAccessibleLibraryIds);
            if (!Began)
            {
                Began = true;
                await inner.BeginAsync(new PtvHomeUserAccessIntent
                {
                    OperationId = Guid.NewGuid(), UserId = userId.ToString("N"), Mode = "preserve",
                    ExpectedAccess = access, IntendedAccess = access
                }, access, topologyEpoch, token);
            }
            return view;
        }
        public Task<PtvHomeUserAccessView> BeginAsync(PtvHomeUserAccessIntent intent, PtvHomeAccessDefinition current,
            string epoch, CancellationToken token = default) => inner.BeginAsync(intent, current, epoch, token);
        public Task<PtvHomeUserAccessView> CompleteAsync(Guid operationId, PtvHomeAccessDefinition? current,
            string? epoch, CancellationToken token = default, IReadOnlyCollection<string>? currentAccessibleLibraryIds = null) =>
            inner.CompleteAsync(operationId, current, epoch, token, currentAccessibleLibraryIds);
        public Task<Guid?> GetOperationUserAsync(Guid operationId, CancellationToken token = default) => inner.GetOperationUserAsync(operationId, token);
        public Task<PtvHomeUserVerificationBatch> BeginVerificationBatchAsync(IReadOnlyCollection<Guid> ids,
            string epoch, CancellationToken token = default, bool replace = false) => inner.BeginVerificationBatchAsync(ids, epoch, token, replace);
        public Task<PtvHomeUserVerificationBatch?> ReadVerificationBatchAsync(CancellationToken token = default) => inner.ReadVerificationBatchAsync(token);
        public Task<PtvHomeUserAccessView> VerifyBatchCandidateAsync(Guid batchId, Guid userId,
            PtvHomeAccessDefinition current, PtvHomeAccessDefinition intended, IReadOnlyCollection<string> libraries, string epoch,
            CancellationToken token = default) => inner.VerifyBatchCandidateAsync(batchId, userId, current, intended, libraries, epoch, token);
        public Task RecoverCorruptAsync(CancellationToken token = default) => inner.RecoverCorruptAsync(token);
        public Task<bool> RequiresRecoveryAsync(CancellationToken token = default) => inner.RequiresRecoveryAsync(token);
        public Task<PtvHomeUserMigrationState?> ReadMigrationStateAsync(CancellationToken token = default) => inner.ReadMigrationStateAsync(token);
        public Task<bool> IsControlledCreatedAsync(Guid userId, CancellationToken token = default) => inner.IsControlledCreatedAsync(userId, token);
        public Task<bool> IsLateUnverifiedAsync(Guid userId, CancellationToken token = default) => inner.IsLateUnverifiedAsync(userId, token);
        public Task<PtvHomeUserCreationView> ReserveCreationAsync(Guid id, IReadOnlyCollection<Guid> baseline,
            CancellationToken token = default) => inner.ReserveCreationAsync(id, baseline, token);
        public Task<PtvHomeUserCreationView> BindCreationAsync(Guid id, Guid userId,
            CancellationToken token = default) => inner.BindCreationAsync(id, userId, token);
        public Task<PtvHomeUserCreationRecovery> RecoverCreationAsync(Guid id, IReadOnlyCollection<Guid> current,
            CancellationToken token = default) => inner.RecoverCreationAsync(id, current, token);
        public Task<PtvHomeUserCreationStatus> ReadCreationStatusAsync(Guid id,
            CancellationToken token = default) => inner.ReadCreationStatusAsync(id, token);
        public Task<IReadOnlyList<PtvHomeUserPendingCreation>> ReadPendingCreationsAsync(IReadOnlyCollection<Guid> current,
            CancellationToken token = default) => inner.ReadPendingCreationsAsync(current, token);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FreshnessStatusCapturesAuthorityAndPairsTogetherAfterConcurrentReplacement(bool changeConfiguration)
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        var initial = await ReadStatus(fixture);
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var release = new ManualResetEventSlim();
        var users = Users(UserId);
        ((UserProxy)(object)users).OnLookup = () =>
        {
            started.TrySetResult();
            Assert.True(release.Wait(TimeSpan.FromSeconds(5)));
        };
        using var services = StatusServices(fixture, users: users);
        var reading = Task.Run(async () => Assert.IsType<OkObjectResult>(await Controller(services, UserId).GetStatus(false, CancellationToken.None)));
        try
        {
            await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
            if (changeConfiguration)
                using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Next";
            await fixture.Generate(Document(("next-1", "rule-a"), ("next-2", "rule-a")));
        }
        finally
        {
            release.Set();
        }
        var actual = JsonSerializer.SerializeToNode((await reading).Value)!;
        var expected = await ReadStatus(fixture);
        Assert.NotEqual(initial["currentPresentationAuthority"]!.ToJsonString(), AssertAuthority(actual["currentPresentationAuthority"]).ToJsonString());
        Assert.Equal(expected["currentPresentationAuthority"]!.ToJsonString(), actual["currentPresentationAuthority"]!.ToJsonString());
        Assert.Equal(expected["configuredPresentationBindings"]!.ToJsonString(), actual["configuredPresentationBindings"]!.ToJsonString());
        Assert.Equal(2, actual["configuredPresentationBindings"]!.AsArray().Count);
    }

    private static JsonObject AssertAuthority(JsonNode? node)
    {
        var authority = Assert.IsType<JsonObject>(node);
        Assert.Equal(new[] { "generation", "scope", "version" }, authority.Select(p => p.Key).OrderBy(k => k).ToArray());
        Assert.Equal(1, authority["version"]!.GetValue<int>());
        AssertToken(authority["scope"]);
        AssertToken(authority["generation"]);
        return authority;
    }

    private static ServiceProvider StatusServices(Fixture fixture, PtvConfiguredRowAssociationService? authority = null, bool includeUsers = true, IUserManager? users = null, IPtvFeaturedContentAuthorizationService? projector = null, IPtvHomeUserAccessLedger? access = null, ILibraryManager? libraries = null)
    {
        var services = new ServiceCollection()
            .AddSingleton(authority ?? fixture.Authority)
            .AddSingleton<IAuthorizationService>(new AuthorizationStub())
            .AddSingleton<IPtvFeaturedContentStore>(fixture.Store)
            .AddSingleton<IPtvPluginSettingsService>(new SettingsStub(PtvPluginSettingsDto.FromConfiguration(fixture.Configuration)));
        if (includeUsers) services.AddSingleton(users ?? Users(UserId, OtherUserId));
        if (projector is not null) services.AddSingleton(projector);
        if (access is not null) services.AddSingleton(access);
        if (libraries is not null) services.AddSingleton(libraries);
        return services.BuildServiceProvider();
    }

    private static async Task<JsonObject> ReadStatus(Fixture fixture, Guid? userId = null, PtvConfiguredRowAssociationService? authority = null)
    {
        using var services = StatusServices(fixture, authority);
        var result = Assert.IsType<OkObjectResult>(await Controller(services, userId ?? UserId).GetStatus(false, CancellationToken.None));
        return JsonSerializer.SerializeToNode(result.Value)!.AsObject();
    }

    private static PtvStatusController Controller(IServiceProvider services, Guid userId) => new(NullLogger<PtvStatusController>.Instance, services)
    {
        ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("Jellyfin-UserId", userId.ToString("N"))], "test")) } }
    };

    private static void AssertToken(JsonNode? token) => Assert.Matches("^[0-9a-f]{64}$", token!.GetValue<string>());
    private static JsonObject Payload(PtvFeaturedContentDocument document) => document.FeaturedContent!["payload"]!.AsObject();
    private static JsonArray Sections(PtvFeaturedContentDocument document) => Payload(document)["sections"]!.AsArray();
    private static JsonObject Item(Guid id) => new() { ["Id"] = id.ToString("N"), ["Name"] = "Item", ["Type"] = "Movie" };
    private static PtvFeaturedContentDocument Document(params (string Section, string Rule)[] definitions)
    {
        if (definitions.Length == 0) definitions = [("section-a", "rule-a")];
        var sectionItems = new JsonObject();
        var sections = new JsonArray();
        foreach (var (section, rule) in definitions)
        {
            sectionItems[section] = new JsonArray(ItemIds.Select(id => (JsonNode)Item(id)).ToArray());
            sections.Add(new JsonObject { ["id"] = section, ["title"] = "Same", ["rowType"] = "configured-rule", ["sourceType"] = "latest", ["sourceRuleId"] = rule, ["ruleId"] = rule, ["sourceValue"] = "PRIVATE_SELECTOR", ["mediaType"] = "movies" });
        }
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return new PtvFeaturedContentDocument { Version = 1, UpdatedAt = now, FeaturedContent = new JsonObject { ["version"] = PtvFeaturedContentValidator.FeaturedCacheVersion, ["createdAt"] = now, ["expiresAt"] = now + 3_600_000, ["payload"] = new JsonObject { ["scopeSchemaVersion"] = 2, ["heroItems"] = new JsonArray(Item(ItemIds[0])), ["sections"] = sections, ["sectionItems"] = sectionItems, ["rowDiagnostics"] = new JsonArray() } } };
    }

    // Advance only the retained owner's retry eligibility; no wall-clock waits or product test hook.
    private static void MakeRecoveryRetryDue(PtvFeaturedContentRefreshService refresh)
        => typeof(PtvFeaturedContentRefreshService).GetField("_trustRecoveryRetryAt", BindingFlags.Instance | BindingFlags.NonPublic)!
            .SetValue(refresh, DateTimeOffset.UtcNow.AddSeconds(-1).ToUnixTimeMilliseconds());

    private static TimeSpan ReadHostedDelay(PtvFeaturedContentRefreshService refresh, PtvFeaturedContentStoreStatus status)
        => (TimeSpan)typeof(PtvFeaturedContentRefreshService).GetMethod("GetDelayUntilNextRefresh", BindingFlags.Instance | BindingFlags.Static | BindingFlags.NonPublic)!.Invoke(refresh, [status])!;

    private static ILibraryManager ConfigureLatestLibraries(Fixture fixture)
    {
        var kinds = new[] { "movies", "shows", "music" };
        var libraryIds = kinds.Select((kind, index) => (kind, id: Guid.Parse($"cccccccc-cccc-cccc-cccc-{index + 1:D12}")))
            .ToDictionary(pair => pair.kind, pair => pair.id);
        fixture.Configuration.Rows.Rules = new[] { "movies", "shows", "music" }.Select(kind => new RowBuilderRule
        {
            Id = "latest-" + kind,
            Name = "Latest " + kind,
            SourceType = "latest",
            SourceValue = kind,
            MediaType = kind,
            LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = kind, VirtualFolderId = libraryIds[kind].ToString("N") }
        }).ToList();
        var items = Enumerable.Range(1, 48).Select(index =>
        {
            BaseItem item = index <= 16 ? new Movie() : index <= 32 ? new Series() : new MusicAlbum();
            if (item is Folder folder) folder.Children = [];
            item.Id = Guid.Parse($"bbbbbbbb-bbbb-bbbb-bbbb-{index:D12}");
            item.Name = "Synthetic " + index;
            item.DateCreated = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMinutes(index);
            item.ImageInfos = [new ItemImageInfo { Type = ImageType.Primary, DateModified = item.DateCreated, Path = "synthetic-image" }];
            return item;
        }).ToArray();
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Root = new AggregateFolder { Children = items };
        proxy.Allowed = items.Select(item => item.Id).Concat(libraryIds.Values).ToHashSet();
        proxy.Folders = kinds.Select(kind => new VirtualFolderInfo
        {
            ItemId = libraryIds[kind].ToString("N"),
            Name = char.ToUpperInvariant(kind[0]) + kind[1..],
            CollectionType = kind switch
            {
                "movies" => CollectionTypeOptions.movies,
                "shows" => CollectionTypeOptions.tvshows,
                _ => CollectionTypeOptions.music
            },
            Locations = ["/fake"]
        }).ToArray();
        proxy.ScopedItems = libraryIds.ToDictionary(pair => pair.Value, pair => pair.Key switch
        {
            "movies" => items.Take(16).ToArray(),
            "shows" => items.Skip(16).Take(16).ToArray(),
            _ => items.Skip(32).Take(16).ToArray()
        });
        return libraries;
    }

    private static EnrichmentStub CompletedEnrichment()
    {
        var result = new EnrichmentStub();
        result.Complete.SetResult();
        return result;
    }

    private static PtvFeaturedContentRefreshService CreateRefresh(PtvFeaturedContentStore store, PtvConfiguredRowAssociationService issuer, ILibraryManager libraries, EnrichmentStub enrichment)
        => new(store, libraries, NullLogger<PtvFeaturedContentRefreshService>.Instance, enrichment, issuer);

    private static void AssertLatestMappings(PtvConfiguredRowAssociationService issuer, PtvFeaturedContentDocument document)
    {
        var projection = issuer.CaptureProjection(document, UserId);
        Assert.NotNull(projection);
        var rows = issuer.CaptureCurrentPresentationProof(UserId, true)!.Bindings!;
        Assert.Equal(3, rows.Count);
        Assert.Equal(new[] { "Latest movies", "Latest music", "Latest shows" }, Sections(document).Select(section => section!["title"]!.GetValue<string>()).Order());
        var expected = new[] { (kind: "movies", first: 1, type: "Movie"), (kind: "shows", first: 17, type: "Series"), (kind: "music", first: 33, type: "MusicAlbum") };
        foreach (var (kind, first, type) in expected)
        {
            var section = Assert.Single(Sections(document), section => section!["title"]!.GetValue<string>() == "Latest " + kind)!;
            var id = section["id"]!.GetValue<string>();
            var alias = projection.ForSection(id)!;
            Assert.Equal(projection.RuleToken("latest-" + kind), alias["rule"]!.GetValue<string>());
            Assert.Single(rows, pair => pair!["rule"]!.ToJsonString() == alias["rule"]!.ToJsonString() && pair["section"]!.ToJsonString() == alias["section"]!.ToJsonString());
            var items = Payload(document)["sectionItems"]![id]!.AsArray();
            Assert.Equal(Enumerable.Range(first, 16).Select(index => Guid.Parse($"bbbbbbbb-bbbb-bbbb-bbbb-{index:D12}")).Order(),
                items.Select(item => Guid.Parse(item!["Id"]!.GetValue<string>())).Order());
            Assert.All(items, item => Assert.Equal(type, item!["Type"]!.GetValue<string>()));
        }
    }

    private sealed class Fixture : IDisposable
    {
        public PluginConfiguration Configuration { get; } = new() { Rows = new RowBuilderSettings { Rules = [new RowBuilderRule { Id = "rule-a", Name = "Same", SourceType = "latest", SourceValue = "movies", MediaType = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } }] } };
        public TestPaths Paths { get; } = new();
        public TopologyStub Ledger { get; } = new();
        public PtvConfiguredRowAssociationService Authority { get; }
        public PtvFeaturedContentStore Store { get; }
        public Fixture()
        {
            PtvPluginSettingsNormalizer.Normalize(Configuration);
            Authority = new PtvConfiguredRowAssociationService("server-a", () => Configuration, Ledger);
            Store = new PtvFeaturedContentStore(Paths, NullLogger<PtvFeaturedContentStore>.Instance, Authority);
        }
        public Task<PtvFeaturedContentDocument> Generate(PtvFeaturedContentDocument? document = null) => Store.WriteGeneratedAsync(document ?? Document(), Authority.CaptureGeneration()!, CancellationToken.None);
        public PtvFeaturedContentDocument Project(PtvFeaturedContentDocument document, int survivors, bool associations = true, Guid? userId = null)
        {
            var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
            ((LibraryProxy)(object)libraries).Allowed = ItemIds.Take(survivors).ToHashSet();
            return new PtvFeaturedContentAuthorizationService(Users(UserId, OtherUserId), libraries, associations ? Authority : null).AuthorizeForUser(document, userId ?? UserId).Document!;
        }
        public void Dispose() => Paths.Dispose();
    }

    private static IUserManager Users(params Guid[] ids)
    {
        var proxy = DispatchProxy.Create<IUserManager, UserProxy>();
        ((UserProxy)(object)proxy).Users = ids.ToDictionary(id => id, id =>
        {
            var user = new User("test", "auth", "reset") { Id = id };
            if (id == UserId) user.Permissions.Add(new Permission(PermissionKind.IsAdministrator, true));
            return user;
        });
        return proxy;
    }
    public class UserProxy : DispatchProxy
    {
        public Dictionary<Guid, User> Users { get; set; } = [];
        public Action? OnLookup { get; set; }
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name == "GetUserById" && args?[0] is Guid id)
            {
                OnLookup?.Invoke();
                return Users.GetValueOrDefault(id);
            }
            throw new NotSupportedException(targetMethod?.Name);
        }
    }
    public class LibraryProxy : DispatchProxy
    {
        public VirtualFolderInfo[] Folders { get; set; } = [];
        public Dictionary<Guid, BaseItem[]> ScopedItems { get; set; } = [];
        public int ScopedQueryCalls { get; private set; }
        public bool FailScopedQuery { get; set; }
        public bool FailEnumeration { get; set; }
        public int Enumerations { get; private set; }
        public HashSet<Guid> Allowed { get; set; } = [];
        public HashSet<Guid> CurrentCollections { get; set; } = [];
        public AggregateFolder? Root { get; set; }
        public Action? OnRoot { get; set; }
        public Action? OnLookup { get; set; }
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name == "get_RootFolder")
            {
                Enumerations++;
                OnRoot?.Invoke();
                if (FailEnumeration) throw new InvalidOperationException("Synthetic enumeration failure.");
                return Root;
            }
            if (targetMethod?.Name == "GetVirtualFolders") return Folders.ToList();
            if (targetMethod?.Name == "QueryItems" && args?[0] is InternalItemsQuery query)
            {
                if (FailScopedQuery) throw new IOException("Synthetic scoped query failure.");
                ScopedQueryCalls++;
                var libraryId = Assert.Single(query.AncestorIds);
                var items = ScopedItems.GetValueOrDefault(libraryId) ?? [];
                return new QueryResult<BaseItem>
                {
                    Items = items.Skip(query.StartIndex ?? 0).Take(query.Limit ?? items.Length).ToArray(),
                    TotalRecordCount = items.Length
                };
            }
            if (targetMethod?.Name == "GetItemById" && args?[0] is Guid id)
            {
                OnLookup?.Invoke();
                if (CurrentCollections.Contains(id)) return new CollectionFolder { Id = id };
                return Allowed.Contains(id) ? new Movie { Id = id } : null;
            }
            throw new NotSupportedException(targetMethod?.Name);
        }
    }
    public class XmlProxy : DispatchProxy
    {
        public int Writes { get; private set; }
        public bool FailWrites { get; set; }
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name == "SerializeToFile")
            {
                if (FailWrites) throw new IOException("Synthetic persistence failure.");
                Writes++;
                return null;
            }
            throw new NotSupportedException(targetMethod?.Name);
        }
    }
    private sealed class EnrichmentStub : IPtvTmdbMetadataService
    {
        public int Calls { get; private set; }
        public Action? OnFacts { get; set; }
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Complete { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool IsConfigured => true;
        public PtvTmdbMetadataStatus GetStatus() => new() { Enabled = true, Configured = true };
        public Task<PtvTmdbMetadataStatus> ValidateCredentialsAsync(CancellationToken cancellationToken) => Task.FromResult(GetStatus());
        public async Task<IReadOnlyDictionary<Guid, PtvTmdbItemFacts>> GetFactsAsync(IEnumerable<BaseItem> items, CancellationToken cancellationToken)
        {
            Calls++;
            OnFacts?.Invoke();
            Started.TrySetResult();
            await Complete.Task.WaitAsync(cancellationToken);
            return new Dictionary<Guid, PtvTmdbItemFacts>();
        }
    }

    private sealed class ScheduleClock : TimeProvider
    {
        private DateTimeOffset _now = DateTimeOffset.UtcNow;
        private readonly List<ScheduleTimer> _timers = [];
        private readonly global::System.Threading.Channels.Channel<ScheduleTimer> _created = global::System.Threading.Channels.Channel.CreateUnbounded<ScheduleTimer>();
        public override DateTimeOffset GetUtcNow() { lock (_timers) return _now; }
        public int ActiveTimers { get { lock (_timers) return _timers.Count(timer => !timer.IsDisposed); } }
        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            Assert.Equal(Timeout.InfiniteTimeSpan, period);
            var timer = new ScheduleTimer(callback, state, dueTime);
            lock (_timers) _timers.Add(timer);
            _created.Writer.TryWrite(timer);
            return timer;
        }
        public async Task<ScheduleTimer> NextTimer()
        {
            try { return await _created.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5)); }
            catch (TimeoutException) { Assert.Fail("The hosted owner did not publish its next scheduled wait."); throw; }
        }
        public void Fire(ScheduleTimer timer)
        {
            lock (_timers) _now += timer.Delay;
            timer.Fire();
        }
    }

    private sealed class ScheduleTimer(TimerCallback callback, object? state, TimeSpan delay) : ITimer
    {
        private int _disposed;
        public TimeSpan Delay { get; } = delay;
        public bool IsDisposed => Volatile.Read(ref _disposed) != 0;
        public void Fire() { Assert.False(IsDisposed); callback(state); }
        public bool Change(TimeSpan dueTime, TimeSpan period) => throw new NotSupportedException();
        public void Dispose() => Interlocked.Exchange(ref _disposed, 1);
        public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
    }
    private sealed class SettingsStub(PtvPluginSettingsDto settings) : IPtvPluginSettingsService
    {
        public PtvPluginSettingsDto GetSettings() => settings;
        public PtvPluginSettingsDto SaveSettings(PtvPluginSettingsPatchDto settings) => throw new NotSupportedException();
        public PtvPluginSettingsDto ResetSettings() => throw new NotSupportedException();
        public PtvReadingSeriesOverridesResponse GetReadingSeriesOverrides(string routeKind) => throw new NotSupportedException();
        public PtvReadingSeriesOverridesResponse SaveReadingSeriesOverrides(string routeKind, PtvReadingSeriesOverridesUpdate update) => throw new NotSupportedException();
    }
    private sealed class ScopeLogger : ILogger<PtvFeaturedContentAuthorizationService>
    {
        public List<string> Messages { get; } = [];
        public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) => Messages.Add(formatter(state, exception));
        private sealed class NullScope : IDisposable
        {
            public static NullScope Instance { get; } = new();
            public void Dispose() { }
        }
    }
    private sealed class AuthorizationStub : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource, IEnumerable<IAuthorizationRequirement> requirements) => AuthorizeAsync(user, resource, "test");
        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource, string policyName) => Task.FromResult(user.FindFirst("Jellyfin-UserId")?.Value == UserId.ToString("N") ? AuthorizationResult.Success() : AuthorizationResult.Failed());
    }
    private sealed class TestPaths : IApplicationPaths, IDisposable
    {
        private readonly string _root = Path.Combine(Path.GetTempPath(), "ptv-association-test-" + Guid.NewGuid().ToString("N"));
        public string ProgramDataPath => _root;
        public string WebPath => Path.Combine(_root, "web");
        public string ProgramSystemPath => Path.Combine(_root, "system");
        public string DataPath => Path.Combine(_root, "data");
        public string ImageCachePath => Path.Combine(_root, "images");
        public string PluginsPath => Path.Combine(_root, "plugins");
        public string PluginConfigurationsPath => Path.Combine(_root, "config");
        public string LogDirectoryPath => Path.Combine(_root, "logs");
        public string ConfigurationDirectoryPath => Path.Combine(_root, "config");
        public string SystemConfigurationFilePath => Path.Combine(_root, "system.xml");
        public string CachePath => Path.Combine(_root, "cache");
        public string TempDirectory => Path.Combine(_root, "temp");
        public string VirtualDataPath => "%AppDataPath%";
        public string TrickplayPath => Path.Combine(_root, "trickplay");
        public string BackupPath => Path.Combine(_root, "backup");
        public void MakeSanityCheckOrThrow() => Directory.CreateDirectory(_root);
        public void CreateAndCheckMarker(string path, string marker, bool isDirectory) => throw new NotSupportedException();
        public void Dispose() { if (Directory.Exists(_root)) Directory.Delete(_root, true); }
    }
}

[CollectionDefinition("Configured row association serial", DisableParallelization = true)]
public sealed class ConfiguredRowAssociationSerialCollection;
