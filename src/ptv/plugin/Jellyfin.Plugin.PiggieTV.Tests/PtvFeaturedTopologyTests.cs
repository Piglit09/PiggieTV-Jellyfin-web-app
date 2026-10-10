using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using System.Reflection;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed partial class PtvConfiguredRowAssociationTests
{
    [Fact]
    public void MissingFeaturedPayloadNeedsNoOwnedUserEpochBinding()
    {
        PtvFeaturedTopology.BindUserAccessEpoch(null, new string('A', 64));
    }

    [Fact]
    public void FreshRuleIdCannotBypassAControlledTombstoneAfterSameIdRecreate()
    {
        var state = new PtvHomeTopologySnapshot
        {
            SchemaVersion = 1,
            ServerId = "server-a",
            Epoch = new string('A', 64),
            Sequence = 2,
            BindingAuthorityRequired = true,
            RequiresFreshGeneration = false,
            Bindings = new Dictionary<string, PtvHomeBindingGeneration>
            {
                ["deleted-rule"] = new() { Generation = 1, Tombstoned = true }
            }
        };

        Assert.Null(PtvFeaturedTopology.Generation(state, "fresh-rule"));
        Assert.Null(PtvFeaturedTopology.Generation(state, "deleted-rule"));
    }

    [Fact]
    public void RepointedExistingRuleCannotPublishAgainstAnUnverifiedBinding()
    {
        var state = new PtvHomeTopologySnapshot
        {
            SchemaVersion = 1,
            ServerId = "server-a",
            Epoch = new string('A', 64),
            Sequence = 2,
            BindingAuthorityRequired = true,
            RequiresFreshGeneration = false,
            Bindings = new Dictionary<string, PtvHomeBindingGeneration>
            {
                ["unaffected-rule"] = new() { Generation = 1, Tombstoned = false }
            }
        };
        var repointed = new JsonObject
        {
            ["topologyEpoch"] = state.Epoch,
            ["bindingGeneration"] = 1L,
            ["libraryId"] = "22222222222222222222222222222222"
        };

        Assert.False(PtvFeaturedTopology.Matches(repointed, state, "unaffected-rule"));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task OrdinaryRowsSaveCannotQueryRecreatedFolderWithoutDurableRuleBinding(bool freshRuleId)
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        var proxy = (LibraryProxy)(object)libraries;
        var originalId = Guid.Parse("66666666-6666-6666-6666-666666666666");
        var recreatedId = Guid.Parse("77777777-7777-7777-7777-777777777777");
        fixture.Ledger.State.Sequence = 2;
        fixture.Ledger.State.BindingAuthorityRequired = true;
        fixture.Ledger.State.Bindings["rule-a"] = new()
        {
            Generation = 1, CollectionFolderId = originalId.ToString("N")
        };
        fixture.Configuration.Rows.Rules[0].LibraryScope!.VirtualFolderId = recreatedId.ToString("N");
        if (freshRuleId) fixture.Configuration.Rows.Rules[0].Id = "fresh-rule";
        proxy.Folders = [new VirtualFolderInfo
        {
            ItemId = recreatedId.ToString("N"), Name = "Movies", CollectionType = CollectionTypeOptions.movies,
            Locations = ["/fake"]
        }];
        proxy.ScopedItems[recreatedId] = [NewMovie("recreated", 3)];
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());

        var preview = await refresh.PreviewRowsAsync(fixture.Configuration.Rows, CancellationToken.None);

        Assert.Empty(preview.Rows);
        Assert.Equal(0, proxy.ScopedQueryCalls);
    }

    [Fact]
    public async Task ReleasedEpochDoesNotExposeOwnedPreviewBeforeCommittedCurrentGeneration()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        fixture.Ledger.State.Sequence = 2;
        fixture.Ledger.State.Epoch = new string('B', 64);
        fixture.Ledger.State.BindingAuthorityRequired = true;
        fixture.Ledger.State.Bindings["rule-a"] = new()
        {
            Generation = 1, CollectionFolderId = "66666666666666666666666666666666"
        };
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());

        var preview = await refresh.PreviewRowsAsync(fixture.Configuration.Rows, CancellationToken.None);

        Assert.Empty(preview.Rows);
        Assert.Equal(0, ((LibraryProxy)(object)libraries).ScopedQueryCalls);
    }

    [Fact]
    public async Task FailedCurrentEpochCacheWriteKeepsReleasedOwnedPreviewWithheld()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        await refresh.RefreshAsync(CancellationToken.None);
        fixture.Ledger.State.Sequence = 2;
        fixture.Ledger.State.Epoch = new string('B', 64);
        fixture.Ledger.State.BindingAuthorityRequired = true;
        fixture.Ledger.State.Bindings["rule-a"] = new()
        {
            Generation = 1, CollectionFolderId = "66666666666666666666666666666666"
        };
        var cachePath = Path.Combine(fixture.Paths.PluginConfigurationsPath, "PiggieTV", "featured-content-cache.json");
        using var lockedCache = new FileStream(cachePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        var failed = await refresh.RefreshAsync(CancellationToken.None);
        Assert.Equal("PTV_FEATURED_CACHE_WRITE_FAILED", failed.CacheWriteError);
        var callsBeforePreview = ((LibraryProxy)(object)libraries).ScopedQueryCalls;

        var preview = await refresh.PreviewRowsAsync(fixture.Configuration.Rows, CancellationToken.None);

        Assert.Empty(preview.Rows);
        Assert.Equal(callsBeforePreview, ((LibraryProxy)(object)libraries).ScopedQueryCalls);
    }

    [Fact]
    public async Task RestartWithoutCurrentCommittedGenerationWithholdsStoredOwnedRows()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        fixture.Ledger.State.Sequence = 2;
        fixture.Ledger.State.Epoch = new string('B', 64);
        fixture.Ledger.State.BindingAuthorityRequired = true;
        fixture.Ledger.State.Bindings["rule-a"] = new()
        {
            Generation = 1, CollectionFolderId = "66666666666666666666666666666666"
        };
        using (var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment()))
            Assert.Single(Sections((await refresh.RefreshAsync(CancellationToken.None)).Document));
        var restartedAuthority = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration, fixture.Ledger);
        var restartedStore = new PtvFeaturedContentStore(fixture.Paths,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<PtvFeaturedContentStore>.Instance, restartedAuthority);

        var stored = await restartedStore.ReadAsync(CancellationToken.None);

        Assert.Empty(Sections(stored));
        Assert.Empty(Payload(stored)["sectionItems"]!.AsObject());
    }

    [Fact]
    public async Task RestartedResponseCannotPublishCurrentEpochOwnedClaimWithoutProcessWriteProof()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        fixture.Ledger.State.Sequence = 2;
        fixture.Ledger.State.Epoch = new string('B', 64);
        fixture.Ledger.State.BindingAuthorityRequired = true;
        fixture.Ledger.State.Bindings["rule-a"] = new()
        {
            Generation = 1, CollectionFolderId = "66666666666666666666666666666666"
        };
        PtvFeaturedContentDocument raw;
        using (var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment()))
            raw = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        var restartedAuthority = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration, fixture.Ledger);

        var response = new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, restartedAuthority)
            .AuthorizeForUser(raw, UserId).Document!;

        Assert.Empty(Sections(response));
        Assert.Empty(Payload(response)["sectionItems"]!.AsObject());
    }

    [Fact]
    public async Task HeldPrivateStageChecksOneCollectionFolderAcrossLocalAndDasRootsWithoutPublishing()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Folders[0].Locations = ["C:/anime", "F:/anime"];
        fixture.Ledger.State.Sequence = 2;
        fixture.Ledger.State.Epoch = new string('B', 64);
        fixture.Ledger.State.BindingAuthorityRequired = true;
        fixture.Ledger.State.BroadHold = true;
        fixture.Ledger.State.Bindings["rule-a"] = new()
        {
            Generation = 1, CollectionFolderId = "66666666666666666666666666666666"
        };
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());

        var staged = await ((dynamic)refresh).StageTransitionCandidatesAsync(fixture.Ledger.State.Epoch,
            new Dictionary<string, string>(), CancellationToken.None);

        Assert.True((bool)staged);
        Assert.Equal(1, proxy.ScopedQueryCalls);
        Assert.Null((await fixture.Store.ReadAsync(CancellationToken.None)).FeaturedContent);
        Assert.Empty((await refresh.PreviewRowsAsync(fixture.Configuration.Rows, CancellationToken.None)).Rows);
    }

    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task HeldStageCanUseExplicitCurrentIdForAffectedOldPinOrUnpinnedDefault(bool unpinnedDefault)
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        var proxy = (LibraryProxy)(object)libraries;
        var oldId = Guid.Parse("66666666-6666-6666-6666-666666666666");
        var newId = Guid.Parse("77777777-7777-7777-7777-777777777777");
        var rule = fixture.Configuration.Rows.Rules[0];
        if (unpinnedDefault)
        {
            rule.Id = "latest-movies";
            rule.SourceType = "latest";
            rule.SourceValue = "movies";
            rule.LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "movies" };
        }
        proxy.Folders = [new VirtualFolderInfo
        {
            ItemId = newId.ToString("N"), Name = "Films", CollectionType = CollectionTypeOptions.movies,
            Locations = ["C:/movies", "F:/archive"]
        }];
        proxy.ScopedItems[newId] = [NewMovie("new", 2)];
        fixture.Ledger.State.Sequence = 2;
        fixture.Ledger.State.Epoch = new string('B', 64);
        fixture.Ledger.State.BindingAuthorityRequired = true;
        fixture.Ledger.State.BroadHold = true;
        fixture.Ledger.State.Bindings[rule.Id] = new()
        {
            Generation = 1, Tombstoned = true, CollectionFolderId = oldId.ToString("N"),
            OriginalScopeFingerprint = PtvHomeLibraryScopeResolver.ScopeFingerprint(rule)
        };
        fixture.Ledger.State.Operation = new PtvHomeTransitionOperation
        {
            Intent = new PtvHomeTransitionIntent { OperationId = Guid.NewGuid(), Kind = "rename",
                AffectedRuleIds = [rule.Id] }
        };
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());

        var staged = await refresh.StageTransitionCandidatesAsync(fixture.Ledger.State.Epoch,
            new Dictionary<string, string> { [rule.Id] = newId.ToString("N") }, CancellationToken.None);

        Assert.True(staged);
        Assert.Equal(1, proxy.ScopedQueryCalls);
        Assert.Null((await fixture.Store.ReadAsync(CancellationToken.None)).FeaturedContent);
    }

    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task LedgerOnlyRebindIssuesEffectiveIdFromCurrentTrustedStoreWithoutChangingRows(bool unpinnedDefault)
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        var proxy = (LibraryProxy)(object)libraries;
        var rule = fixture.Configuration.Rows.Rules[0];
        if (unpinnedDefault)
        {
            rule.Id = "latest-movies";
            rule.SourceType = "latest";
            rule.SourceValue = "movies";
            rule.LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "movies" };
        }
        var savedScope = rule.LibraryScope!.VirtualFolderId;
        var selected = Guid.Parse("77777777-7777-7777-7777-777777777777");
        var operationId = Guid.NewGuid();
        proxy.Folders = [new VirtualFolderInfo { ItemId = selected.ToString("N"), Name = "Films",
            CollectionType = CollectionTypeOptions.movies, Locations = ["/fake"] }];
        var newMovie = NewMovie("new", 2);
        proxy.ScopedItems[selected] = [newMovie];
        proxy.Allowed.Add(selected); proxy.Allowed.Add(newMovie.Id); proxy.CurrentCollections.Add(selected);
        fixture.Ledger.State.Sequence = 3;
        fixture.Ledger.State.Epoch = new string('B', 64);
        fixture.Ledger.State.BindingAuthorityRequired = true;
        fixture.Ledger.State.CompletedOperationIds.Add(operationId);
        fixture.Ledger.State.Bindings[rule.Id] = new()
        {
            Generation = 2, CollectionFolderId = selected.ToString("N"), ReboundOperationId = operationId,
            OriginalScopeFingerprint = PtvHomeLibraryScopeResolver.ScopeFingerprint(rule)
        };
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        Assert.Null(fixture.Authority.CaptureCurrentPresentationProof(UserId, true));

        var generated = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        Assert.True(generated.FeaturedContent is not null, refresh.GetRefreshStatus().LastRefreshError);
        var section = Assert.Single(Sections(generated))!;
        Assert.Equal(selected.ToString("N"), section["libraryId"]!.GetValue<string>());
        Assert.Equal(PtvHomeLibraryScopeResolver.ComputeScopeHash(rule, "resolved", selected.ToString("N")),
            section["resolvedScopeHash"]!.GetValue<string>());
        Assert.Equal(savedScope, rule.LibraryScope.VirtualFolderId);
        var binding = Assert.Single(fixture.Authority.CaptureCurrentPresentationProof(UserId, true)!.Bindings!)!;
        Assert.Equal(selected.ToString("N"), binding["libraryId"]!.GetValue<string>());
        Assert.Equal(fixture.Ledger.State.Epoch, binding["topologyEpoch"]!.GetValue<string>());
        Assert.Equal(2, binding["bindingGeneration"]!.GetValue<long>());
        Assert.True(binding["explicitRebind"]!.GetValue<bool>());
        var authorized = new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, fixture.Authority)
            .AuthorizeForUser(generated, UserId).Document!;
        Assert.Single(Sections(authorized));
        Assert.Single(Payload(authorized)["sectionItems"]!.AsObject());
        Assert.Null(fixture.Authority.CaptureCurrentPresentationProof(OtherUserId, false)!.Bindings);
        var restricted = new PtvFeaturedContentAuthorizationService(Users(OtherUserId), libraries, fixture.Authority)
            .AuthorizeForUser(generated, OtherUserId).Document!;
        Assert.Single(Sections(restricted));
        Assert.NotNull(Sections(restricted)[0]!["configuredRowAssociation"]);
        var poisoned = System.Text.Json.JsonSerializer.Deserialize<PtvFeaturedContentDocument>(
            System.Text.Json.JsonSerializer.Serialize(generated))!;
        Sections(poisoned)[0]!["libraryId"] = Guid.NewGuid().ToString("N");
        var rejected = new PtvFeaturedContentAuthorizationService(Users(OtherUserId), libraries, fixture.Authority)
            .AuthorizeForUser(poisoned, OtherUserId).Document!;
        Assert.Empty(Sections(rejected));

        fixture.Ledger.State.Bindings[rule.Id].Tombstoned = true;
        fixture.Ledger.State.Epoch = new string('C', 64);
        fixture.Ledger.State.Sequence = 4;
        Assert.False(PtvHomeLibraryScopeResolver.HasVerifiedOverride(rule, fixture.Ledger.State,
            fixture.Ledger.State.Bindings[rule.Id]));
        Assert.Empty(fixture.Authority.CaptureCurrentPresentationProof(UserId, true)!.Bindings!);
        fixture.Ledger.State.Bindings[rule.Id].Tombstoned = false;
        fixture.Ledger.State.Epoch = new string('B', 64);
        fixture.Ledger.State.Sequence = 3;

        rule.LibraryScope.VirtualFolderId = Guid.NewGuid().ToString("N");
        Assert.Null(PtvHomeLibraryScopeResolver.Resolve(rule, proxy.Folders, fixture.Ledger.State).LibraryId);
        Assert.Null(fixture.Authority.CaptureCurrentPresentationProof(UserId, true));
    }

    [Fact]
    public async Task NewIdLedgerRebindWithFailedCacheWritePreservesGlobalPresentationOnly()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        var proxy = (LibraryProxy)(object)libraries;
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "global", MediaType = "movies",
            SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } });
        var globalItem = NewMovie("global", 3);
        proxy.Root = new AggregateFolder { Children = [globalItem] };
        proxy.Allowed.Add(globalItem.Id);
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var initial = await refresh.RefreshAsync(CancellationToken.None);
        Assert.Equal(2, Sections(initial.Document).Count);
        var beforeProof = fixture.Authority.CaptureCurrentPresentationProof(UserId, true)!.Authority.ToJsonString();
        var rule = fixture.Configuration.Rows.Rules[0];
        var newId = Guid.Parse("77777777-7777-7777-7777-777777777777");
        var operation = Guid.NewGuid();
        fixture.Ledger.State.Sequence = 3;
        fixture.Ledger.State.Epoch = new string('B', 64);
        fixture.Ledger.State.BindingAuthorityRequired = true;
        fixture.Ledger.State.CompletedOperationIds.Add(operation);
        fixture.Ledger.State.Bindings[rule.Id] = new() { Generation = 2, CollectionFolderId = newId.ToString("N"),
            ReboundOperationId = operation, OriginalScopeFingerprint = PtvHomeLibraryScopeResolver.ScopeFingerprint(rule) };
        proxy.Folders = [new VirtualFolderInfo { ItemId = newId.ToString("N"), Name = "Films",
            CollectionType = CollectionTypeOptions.movies, Locations = ["/fake"] }];
        var newMovie = NewMovie("new", 4);
        proxy.ScopedItems[newId] = [newMovie];
        proxy.Allowed.Add(newId); proxy.Allowed.Add(newMovie.Id); proxy.CurrentCollections.Add(newId);
        fixture.Authority.RetireLibraryPresentation();
        var cachePath = Path.Combine(fixture.Paths.PluginConfigurationsPath, "PiggieTV", "featured-content-cache.json");
        using var lockedCache = new FileStream(cachePath, FileMode.Open, FileAccess.Read, FileShare.Read);

        var failed = await refresh.RefreshAsync(CancellationToken.None);

        Assert.Equal("PTV_FEATURED_CACHE_WRITE_FAILED", failed.CacheWriteError);
        Assert.Equal("global", Assert.Single(Sections(failed.Document))!["sourceRuleId"]!.GetValue<string>());
        var proof = fixture.Authority.CaptureCurrentPresentationProof(UserId, true)!;
        Assert.Equal(beforeProof, proof.Authority.ToJsonString());
        Assert.Single(proof.Bindings!);
        Assert.Null(proof.Bindings![0]!["libraryId"]);
        var authorized = new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, fixture.Authority)
            .AuthorizeForUser(failed.Document, UserId).Document!;
        Assert.Equal("global", Assert.Single(Sections(authorized))!["sourceRuleId"]!.GetValue<string>());
        Assert.NotNull(Payload(authorized)["currentPresentationAuthority"]);
    }

    [Fact]
    public async Task FirstBeginObservedUnpinnedDefaultUsesFalseRebindAttestationWithoutRowsWrite()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        var proxy = (LibraryProxy)(object)libraries;
        var rule = fixture.Configuration.Rows.Rules[0];
        rule.Id = "latest-movies"; rule.SourceType = "latest"; rule.SourceValue = "movies";
        rule.LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "movies" };
        var id = proxy.Folders[0].ItemId!;
        var folderId = Guid.ParseExact(id, "N");
        proxy.CurrentCollections.Add(folderId);
        fixture.Ledger.State.Sequence = 2;
        fixture.Ledger.State.BindingAuthorityRequired = true;
        fixture.Ledger.State.Bindings[rule.Id] = new() { Generation = 1, CollectionFolderId = id,
            OriginalScopeFingerprint = PtvHomeLibraryScopeResolver.ScopeFingerprint(rule) };
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());

        var generated = (await refresh.RefreshAsync(CancellationToken.None)).Document;

        Assert.Equal(id, Assert.Single(Sections(generated))!["libraryId"]!.GetValue<string>());
        var binding = Assert.Single(fixture.Authority.CaptureCurrentPresentationProof(UserId, true)!.Bindings!)!;
        Assert.Equal(id, binding["libraryId"]!.GetValue<string>());
        Assert.False(binding["explicitRebind"]!.GetValue<bool>());
        Assert.Null(rule.LibraryScope.VirtualFolderId);
        var authorized = new PtvFeaturedContentAuthorizationService(Users(OtherUserId), libraries, fixture.Authority)
            .AuthorizeForUser(generated, OtherUserId).Document!;
        Assert.Single(Sections(authorized));
    }

    private sealed class TopologyStub : IPtvHomeTopologyLedger
    {
        public PtvHomeTopologySnapshot State { get; } = new() { SchemaVersion = 1, ServerId = "server-a", Epoch = new string('A', 64), Sequence = 1, RequiresFreshGeneration = false };
        public Action? OnRead { get; set; }
        public Action? OnAfterRead { get; set; }
        public Task<PtvHomeTopologySnapshot> ReadAsync(CancellationToken cancellationToken = default)
        {
            OnRead?.Invoke();
            var snapshot = System.Text.Json.JsonSerializer.Deserialize<PtvHomeTopologySnapshot>(System.Text.Json.JsonSerializer.Serialize(State))!;
            OnAfterRead?.Invoke();
            return Task.FromResult(snapshot);
        }
        public Task<PtvHomeTopologySnapshot> BeginAsync(PtvHomeTransitionIntent intent, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<PtvHomeTopologySnapshot> BeginAsync(PtvHomeTransitionIntent intent, IReadOnlyDictionary<string, string> observedBindings, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<PtvHomeTopologySnapshot> CompleteAsync(Guid operationId, PtvVerifiedTransitionReadback readback, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<PtvHomeTopologySnapshot> RebindAsync(Guid operationId, IReadOnlyDictionary<string, string> verifiedBindings, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }

    private static ILibraryManager OwnedLibraries(Fixture fixture)
    {
        var libraryId = Guid.Parse("66666666-6666-6666-6666-666666666666");
        fixture.Configuration.Rows.Rules[0].LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = libraryId.ToString("N") };
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        var item = NewMovie("owned", 1);
        proxy.Root = new AggregateFolder { Children = [] };
        proxy.Folders = [new VirtualFolderInfo { ItemId = libraryId.ToString("N"), Name = "Movies", CollectionType = CollectionTypeOptions.movies, Locations = ["/fake"] }];
        proxy.ScopedItems[libraryId] = [item]; proxy.Allowed = [libraryId, item.Id];
        return libraries;
    }

    [Fact]
    public async Task TopologyGenerationStampsVersionNineScopeTwoAndOpaqueBinding()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var document = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        Assert.Equal(1, document.Version);
        Assert.Equal(9, document.FeaturedContent!["version"]!.GetValue<int>());
        Assert.Equal(2, Payload(document)["scopeSchemaVersion"]!.GetValue<int>());
        var section = Assert.Single(Sections(document))!;
        Assert.Equal(fixture.Ledger.State.Epoch, section["topologyEpoch"]?.GetValue<string>());
        Assert.Equal(0, section["bindingGeneration"]?.GetValue<long>());
    }

    [Theory]
    [InlineData("held")]
    [InlineData("epoch")]
    [InlineData("generation")]
    [InlineData("poisoned-epoch")]
    [InlineData("duplicate-generation")]
    public async Task TopologyResponseRejectsRetiredOwnedItems(string scenario)
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var document = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        var section = Assert.Single(Sections(document))!;
        if (scenario == "held") fixture.Ledger.State.BroadHold = true;
        if (scenario == "epoch") fixture.Ledger.State.Epoch = new string('B', 64);
        if (scenario == "generation") fixture.Ledger.State.Bindings["rule-a"] = new() { Generation = 1 };
        if (scenario == "poisoned-epoch") section["topologyEpoch"] = new JsonObject();
        if (scenario == "duplicate-generation") section["BindingGeneration"] = 0;
        var response = new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, fixture.Authority).AuthorizeForUser(document, UserId).Document!;
        Assert.Empty(Sections(response));
        Assert.Empty(Payload(response)["sectionItems"]!.AsObject());
    }

    [Fact]
    public async Task TopologyStoreReadWithholdsHeldOwnedItems()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        await refresh.RefreshAsync(CancellationToken.None);
        fixture.Ledger.State.BroadHold = true;
        var document = await fixture.Store.ReadAsync(CancellationToken.None);
        Assert.Empty(Sections(document));
        Assert.Empty(Payload(document)["sectionItems"]!.AsObject());
    }
    [Fact]
    public async Task TopologySafeStatusIsAvailableToRestrictedUsersWithoutDefinitions()
    {
        using var fixture = new Fixture();
        fixture.Ledger.State.BroadHold = true;
        var status = await ReadStatus(fixture, OtherUserId);
        var topology = status["currentHomeTopology"]?.AsObject();
        Assert.NotNull(topology);
        Assert.Equal(new[] { "epoch", "held", "version" }, topology.Select(p => p.Key).Order());
        Assert.Equal(fixture.Ledger.State.Epoch, topology["epoch"]!.GetValue<string>());
        Assert.True(topology["held"]!.GetValue<bool>());
    }

    [Fact]
    public async Task TopologySafeStatusRejectsBeginAfterOldSnapshot()
    {
        using var fixture = new Fixture();
        fixture.Ledger.OnAfterRead = () =>
        {
            fixture.Ledger.OnAfterRead = null;
            fixture.Ledger.State.Epoch = new string('B', 64);
            fixture.Ledger.State.Sequence++;
            fixture.Ledger.State.BroadHold = true;
        };
        var status = await ReadStatus(fixture, OtherUserId);
        var topology = status["currentHomeTopology"]!.AsObject();
        Assert.Equal(new string('B', 64), topology["epoch"]!.GetValue<string>());
        Assert.True(topology["held"]!.GetValue<bool>());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task TopologyHeldOrTombstonedPreviewNeverQueriesOwnedCandidates(bool tombstone)
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        fixture.Ledger.State.BroadHold = !tombstone;
        if (tombstone) fixture.Ledger.State.Bindings["rule-a"] = new() { Generation = 1, Tombstoned = true };
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var preview = await refresh.PreviewRowsAsync(fixture.Configuration.Rows, CancellationToken.None);
        Assert.Empty(preview.Rows);
        Assert.Equal(0, ((LibraryProxy)(object)libraries).ScopedQueryCalls);
    }

    [Fact]
    public async Task TopologyStoreRejectsOldGenerationAndPreservesSeparableGlobal()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var document = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        var generation = fixture.Authority.CaptureGeneration()!;
        Sections(document).Add(new JsonObject { ["id"] = "global", ["scopeType"] = "global" });
        Payload(document)["sectionItems"]!["global"] = new JsonArray(Item(ItemIds[0]));
        fixture.Ledger.State.Epoch = new string('B', 64);
        var saved = await fixture.Store.WriteGeneratedAsync(document, generation, CancellationToken.None);
        Assert.Equal("global", Assert.Single(Sections(saved))!["id"]!.GetValue<string>());
        Assert.Single(Payload(saved)["sectionItems"]!.AsObject());
    }

    [Fact]
    public async Task TopologyHoldDuringItemAuthorizationRemovesLateOwnedResponse()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var document = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        ((LibraryProxy)(object)libraries).OnLookup = () => fixture.Ledger.State.BroadHold = true;
        var response = new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, fixture.Authority).AuthorizeForUser(document, UserId).Document!;
        Assert.Empty(Sections(response));
        Assert.Empty(Payload(response)["sectionItems"]!.AsObject());
    }

    [Fact]
    public async Task TopologyStoreReadPreservesGlobalPresentationGenerationWhileWithholdingOwned()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "global", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } });
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var document = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        var global = Document(("global", "global"));
        Sections(document).Add(Sections(global)[0]!.DeepClone());
        Payload(document)["sectionItems"]!["global"] = Payload(global)["sectionItems"]!["global"]!.DeepClone();
        await fixture.Store.WriteGeneratedAsync(document, fixture.Authority.CaptureGeneration()!, CancellationToken.None);
        var before = fixture.Authority.CaptureCurrentPresentationProof(UserId, true)!.Authority.ToJsonString();
        fixture.Ledger.State.BroadHold = true;
        var filtered = await fixture.Store.ReadAsync(CancellationToken.None);
        var projection = fixture.Authority.CaptureProjection(filtered, UserId);
        Assert.NotNull(projection);
        Assert.Equal(before, projection.CreateAuthority().ToJsonString());
        Assert.True(fixture.Authority.HasCurrentStoreBinding(filtered));
        Assert.Equal("global", Assert.Single(Sections(filtered))!["id"]!.GetValue<string>());
    }

    [Fact]
    public async Task TopologyBindingReadAfterBeginKeepsOnlyGlobalAliasesEvenBeforeRetirementCallback()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "global", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } });
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var document = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        var global = Document(("global", "global"));
        Sections(document).Add(Sections(global)[0]!.DeepClone());
        Payload(document)["sectionItems"]!["global"] = Payload(global)["sectionItems"]!["global"]!.DeepClone();
        await fixture.Store.WriteGeneratedAsync(document, fixture.Authority.CaptureGeneration()!, CancellationToken.None);
        Assert.Equal(2, fixture.Authority.CaptureCurrentPresentationProof(UserId, true)!.Bindings!.Count);

        fixture.Ledger.State.Epoch = new string('B', 64);
        fixture.Ledger.State.Sequence++;
        fixture.Ledger.State.BroadHold = true;
        var bindings = fixture.Authority.CaptureCurrentPresentationProof(UserId, true)!.Bindings!;
        Assert.Single(bindings);
        var projection = fixture.Authority.CaptureProjection(document, UserId)!;
        Assert.Null(projection.ForSection(Sections(document)[0]!["id"]!.GetValue<string>()));
        Assert.NotNull(projection.ForSection("global"));
    }

    [Fact]
    public async Task TopologyFailedRefreshAfterDurableBeginKeepsRetainedGlobalPresentation()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "global", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } });
        var proxy = (LibraryProxy)(object)libraries;
        var globalItem = NewMovie("global", 2);
        proxy.Root = new AggregateFolder { Children = [globalItem] };
        proxy.Allowed.Add(globalItem.Id);
        var initialized = false;
        var ledger = new PtvHomeTopologyLedger(Path.Combine(fixture.Paths.PluginConfigurationsPath, "PiggieTV"), "server-a",
            () => initialized, () => initialized = true);
        var authority = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration, ledger);
        var store = new PtvFeaturedContentStore(fixture.Paths, Microsoft.Extensions.Logging.Abstractions.NullLogger<PtvFeaturedContentStore>.Instance, authority);
        using var refresh = CreateRefresh(store, authority, libraries, CompletedEnrichment());
        var initial = await refresh.RefreshAsync(CancellationToken.None);
        Assert.Equal(2, Sections(initial.Document).Count);
        Assert.Equal(2, authority.CaptureCurrentPresentationProof(UserId, true)!.Bindings!.Count);
        var before = await ledger.ReadAsync();
        var begun = await ledger.BeginAsync(new PtvHomeTransitionIntent
        {
            OperationId = Guid.NewGuid(), Kind = "delete", ServerId = "server-a", AffectedRuleIds = ["rule-a"],
            ExpectedLibrary = new PtvHomeLibraryDefinition
            {
                LibraryId = "66666666666666666666666666666666", CollectionType = "movies", Name = "Movies",
                Roots = ["/fake"], Options = System.Text.Json.JsonSerializer.SerializeToElement(new { })
            }
        });
        Assert.True(begun.BroadHold);
        Assert.NotEqual(before.Epoch, begun.Epoch);
        Assert.Equal(begun.Epoch, (await ledger.ReadAsync()).Epoch);
        authority.RetireLibraryPresentation();

        var cachePath = Path.Combine(fixture.Paths.PluginConfigurationsPath, "PiggieTV", "featured-content-cache.json");
        using var lockedCache = new FileStream(cachePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        var retained = await refresh.RefreshIfNeededAsync(CancellationToken.None);
        Assert.Equal("PTV_FEATURED_CACHE_WRITE_FAILED", retained.CacheWriteError);
        Assert.Equal("global", Assert.Single(Sections(retained.Document))!["sourceRuleId"]!.GetValue<string>());
        Assert.Single(Payload(retained.Document)["sectionItems"]!.AsObject());

        var proof = authority.CaptureCurrentPresentationProof(UserId, true);
        Assert.NotNull(proof);
        Assert.Single(proof.Bindings!);
        var response = new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, authority)
            .AuthorizeForUser(retained.Document, UserId).Document!;
        var globalSection = Assert.Single(Sections(response))!;
        Assert.Equal("global", globalSection["sourceRuleId"]!.GetValue<string>());
        Assert.NotNull(globalSection["configuredRowAssociation"]);
        Assert.NotNull(Payload(response)["currentPresentationAuthority"]);
    }

    [Fact]
    public void TopologyLegacyVersionEightKeepsExplicitGlobalContentWithoutRelabelling()
    {
        using var fixture = new Fixture();
        var document = Document();
        document.FeaturedContent!["version"] = 8;
        Payload(document)["scopeSchemaVersion"] = 1;
        Sections(document)[0]!["scopeType"] = "global";
        var response = fixture.Project(document, 4);
        Assert.Equal(8, response.FeaturedContent!["version"]!.GetValue<int>());
        Assert.Single(Sections(response));
        Assert.Single(Payload(response)["sectionItems"]!.AsObject());
    }

    [Fact]
    public async Task TopologyEpochChangesDoNotChangeRowConfigurationHash()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var before = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        fixture.Ledger.State.Epoch = new string('B', 64);
        var after = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        Assert.Equal(Payload(before)["rowConfigHash"]!.ToJsonString(), Payload(after)["rowConfigHash"]!.ToJsonString());
        Assert.NotEqual(Sections(before)[0]!["topologyEpoch"]!.ToJsonString(), Sections(after)[0]!["topologyEpoch"]!.ToJsonString());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task TopologyLateGenerationOrPreviewCannotPublishOldOwnedCandidates(bool preview)
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        ((LibraryProxy)(object)libraries).Root = new AggregateFolder { Children = [NewMovie("global", 2)] };
        var enrichment = new EnrichmentStub();
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, enrichment);
        if (preview)
        {
            var pending = refresh.PreviewRowsAsync(fixture.Configuration.Rows, CancellationToken.None);
            await enrichment.Started.Task;
            fixture.Ledger.State.Epoch = new string('B', 64);
            enrichment.Complete.SetResult();
            Assert.Empty((await pending).Rows);
        }
        else
        {
            var pending = refresh.RefreshAsync(CancellationToken.None);
            await enrichment.Started.Task;
            fixture.Ledger.State.Epoch = new string('B', 64);
            enrichment.Complete.SetResult();
            var document = (await pending).Document;
            Assert.Empty(Sections(document));
            Assert.Empty(Payload(document)["sectionItems"]!.AsObject());
            Assert.NotEmpty(Payload(document)["heroItems"]!.AsArray());
        }
    }

    [Fact]
    public async Task TopologyStoreRechecksLedgerDuringGeneratedWriteAndKeepsGlobal()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "global", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } });
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var document = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        var global = Document(("global", "global"));
        Sections(document).Add(Sections(global)[0]!.DeepClone());
        Payload(document)["sectionItems"]!["global"] = Payload(global)["sectionItems"]!["global"]!.DeepClone();
        var reads = 0;
        fixture.Ledger.OnRead = () => { if (++reads >= 2) fixture.Ledger.State.BroadHold = true; };
        await fixture.Store.WriteGeneratedAsync(document, fixture.Authority.CaptureGeneration()!, CancellationToken.None);
        var wire = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(fixture.Paths.PluginConfigurationsPath, "PiggieTV", "featured-content-cache.json")))!;
        Assert.Equal("global", Assert.Single(wire["featuredContent"]!["payload"]!["sections"]!.AsArray())!["id"]!.GetValue<string>());
        Assert.Equal("global", Assert.Single(wire["featuredContent"]!["payload"]!["sectionItems"]!.AsObject()).Key);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task TopologyStoreReadAndStatusRejectBeginAfterOldSnapshot(bool status)
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "global", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } });
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var document = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        var global = Document(("global", "global"));
        Sections(document).Add(Sections(global)[0]!.DeepClone());
        Payload(document)["sectionItems"]!["global"] = Payload(global)["sectionItems"]!["global"]!.DeepClone();
        await fixture.Store.WriteGeneratedAsync(document, fixture.Authority.CaptureGeneration()!, CancellationToken.None);

        fixture.Ledger.OnAfterRead = () =>
        {
            fixture.Ledger.OnAfterRead = null;
            fixture.Ledger.State.Epoch = new string('B', 64);
            fixture.Ledger.State.Sequence++;
            fixture.Ledger.State.BroadHold = true;
        };
        var late = status ? (await fixture.Store.GetStatusAsync(CancellationToken.None)).Document
            : await fixture.Store.ReadAsync(CancellationToken.None);
        Assert.Equal("global", Assert.Single(Sections(late))!["id"]!.GetValue<string>());
        Assert.Equal("global", Assert.Single(Payload(late)["sectionItems"]!.AsObject()).Key);
    }

    [Fact]
    public async Task TopologyEndpointRejectsBeginAfterAuthorizationSnapshot()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "global", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } });
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Allowed.UnionWith(ItemIds);
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var document = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        var global = Document(("global", "global"));
        Sections(document).Add(Sections(global)[0]!.DeepClone());
        Payload(document)["sectionItems"]!["global"] = Payload(global)["sectionItems"]!["global"]!.DeepClone();
        var reads = 0;
        fixture.Ledger.OnAfterRead = () =>
        {
            if (++reads != 2) return;
            fixture.Ledger.OnAfterRead = null;
            fixture.Ledger.State.Epoch = new string('B', 64);
            fixture.Ledger.State.Sequence++;
            fixture.Ledger.State.BroadHold = true;
        };
        var response = new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, fixture.Authority)
            .AuthorizeForUser(document, UserId).Document!;
        Assert.Equal("global", Assert.Single(Sections(response))!["id"]!.GetValue<string>());
        Assert.Equal("global", Assert.Single(Payload(response)["sectionItems"]!.AsObject()).Key);
    }

    [Fact]
    public async Task TopologyOldGenerationCannotTrustRestampedSameIdOwnedWork()
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "global", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } });
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var document = (await refresh.RefreshAsync(CancellationToken.None)).Document;
        var oldGeneration = fixture.Authority.CaptureGeneration()!;
        var global = Document(("global", "global"));
        Sections(document).Add(Sections(global)[0]!.DeepClone());
        Payload(document)["sectionItems"]!["global"] = Payload(global)["sectionItems"]!["global"]!.DeepClone();
        fixture.Ledger.State.Epoch = new string('B', 64);
        fixture.Ledger.State.Sequence++;
        Assert.False(fixture.Ledger.State.BroadHold);
        Sections(document)[0]!["topologyEpoch"] = fixture.Ledger.State.Epoch;

        var stored = await fixture.Store.WriteGeneratedAsync(document, oldGeneration, CancellationToken.None);
        Assert.Equal("global", Assert.Single(Sections(stored))!["id"]!.GetValue<string>());
        Assert.Equal("global", Assert.Single(Payload(stored)["sectionItems"]!.AsObject()).Key);
        Assert.False(fixture.Authority.HasCurrentStoreBinding(stored));
        Assert.Single(fixture.Authority.CaptureCurrentPresentationProof(UserId, true)!.Bindings!);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task TopologyRefreshAndPreviewStartedBeforeSameIdTransitionKeepOnlyGlobal(bool preview)
    {
        using var fixture = new Fixture();
        var libraries = OwnedLibraries(fixture);
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "global", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } });
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Root = new AggregateFolder { Children = [NewMovie("global", 2)] };
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var release = new ManualResetEventSlim();
        var reads = 0;
        proxy.OnRoot = () =>
        {
            if (Interlocked.Increment(ref reads) != 1) return;
            started.TrySetResult();
            Assert.True(release.Wait(TimeSpan.FromSeconds(5)));
        };
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        if (preview)
        {
            var pending = Task.Run(() => refresh.PreviewRowsAsync(fixture.Configuration.Rows, CancellationToken.None));
            try
            {
                await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
                fixture.Ledger.State.BroadHold = true;
                fixture.Ledger.State.Epoch = new string('B', 64);
                fixture.Ledger.State.Sequence++;
                fixture.Ledger.State.BroadHold = false;
            }
            finally { release.Set(); }
            var rows = (await pending).Rows;
            Assert.Equal("global", Assert.Single(rows).RuleId);
        }
        else
        {
            var pending = Task.Run(() => refresh.RefreshAsync(CancellationToken.None));
            try
            {
                await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
                fixture.Ledger.State.BroadHold = true;
                fixture.Ledger.State.Epoch = new string('B', 64);
                fixture.Ledger.State.Sequence++;
                fixture.Ledger.State.BroadHold = false;
            }
            finally { release.Set(); }
            var document = (await pending).Document;
            Assert.Equal("global", Assert.Single(Sections(document))!["sourceRuleId"]!.GetValue<string>());
            Assert.Single(Payload(document)["sectionItems"]!.AsObject());
        }
    }

    [Theory]
    [InlineData("topologyEpoch")]
    [InlineData("bindingGeneration")]
    public async Task TopologyClientCannotSmuggleClaimsOnGlobalSection(string field)
    {
        using var fixture = new Fixture();
        var document = Document();
        Sections(document)[0]!["scopeType"] = "global";
        Sections(document)[0]![field] = field == "topologyEpoch" ? JsonValue.Create(fixture.Ledger.State.Epoch) : JsonValue.Create(0L);
        await Assert.ThrowsAsync<PtvFeaturedContentValidationException>(() => fixture.Store.WriteAsync(document, CancellationToken.None));
    }

    [Theory]
    [InlineData("conflicting-id")]
    [InlineData("duplicate-id")]
    [InlineData("duplicate-id-case")]
    [InlineData("non-string-id")]
    [InlineData("duplicate-property-id")]
    [InlineData("non-object-section")]
    [InlineData("missing-sections")]
    public async Task TopologyPersistedPoisonedSectionIdsPruneOrphanItemMaps(string poison)
    {
        using var fixture = new Fixture();
        var document = Document(("owned", "rule-a"), ("global", "global"));
        var sections = Sections(document);
        sections[0]!["scopeType"] = "library";
        sections[1]!["scopeType"] = "global";
        switch (poison)
        {
            case "conflicting-id": sections[0]!["Id"] = "other"; break;
            case "duplicate-id": sections.Add(new JsonObject { ["id"] = "owned", ["scopeType"] = "global" }); break;
            case "duplicate-id-case": sections.Add(new JsonObject { ["id"] = "OWNED", ["scopeType"] = "global" }); break;
            case "non-string-id": sections[0]!["id"] = 7; break;
            case "duplicate-property-id": sections[0] = JsonNode.Parse("{\"id\":\"owned\",\"id\":\"other\",\"scopeType\":\"library\"}"); break;
            case "non-object-section": sections[0] = "malformed"; break;
            case "missing-sections": Payload(document).Remove("sections"); break;
        }
        var path = Path.Combine(fixture.Paths.PluginConfigurationsPath, "PiggieTV", "featured-content-cache.json");
        await File.WriteAllTextAsync(path, System.Text.Json.JsonSerializer.Serialize(document));

        var read = await fixture.Store.ReadAsync(CancellationToken.None);
        var items = Payload(read)["sectionItems"]!.AsObject();
        Assert.False(items.ContainsKey("owned"));
        var status = await fixture.Store.GetStatusAsync(CancellationToken.None);
        Assert.Equal(items.ToJsonString(), Payload(status.Document)["sectionItems"]!.ToJsonString());
        Assert.False(status.FeaturedCacheFresh);
        if (poison == "missing-sections")
        {
            Assert.Empty(items);
            Assert.Empty(Sections(read));
        }
        else
        {
            Assert.Equal("global", Assert.Single(items).Key);
            Assert.Equal("global", Assert.Single(Sections(read))!["id"]!.GetValue<string>());
        }
    }

    [Theory]
    [InlineData("conflicting-id")]
    [InlineData("duplicate-id-case")]
    [InlineData("ambiguous-item-map")]
    public void TopologyPublicationPoisonedIdsPreserveOnlySeparableGlobalMaps(string poison)
    {
        using var fixture = new Fixture();
        var document = Document(("owned", "rule-a"), ("global", "global"));
        var sections = Sections(document);
        sections[0]!["scopeType"] = "library";
        sections[1]!["scopeType"] = "global";
        if (poison == "conflicting-id") sections[0]!["Id"] = "other";
        if (poison == "duplicate-id-case") sections.Add(new JsonObject { ["id"] = "OWNED", ["scopeType"] = "global" });
        if (poison == "ambiguous-item-map")
        {
            sections[0]!["scopeType"] = "global";
            Payload(document)["sectionItems"]!["OWNED"] = new JsonArray(Item(ItemIds[0]));
        }
        PtvFeaturedTopology.FilterPublication(Payload(document), fixture.Ledger.State);
        Assert.Equal("global", Assert.Single(Payload(document)["sectionItems"]!.AsObject()).Key);
        Assert.Equal("global", Assert.Single(Sections(document))!["id"]!.GetValue<string>());
    }

    [Fact]
    public void UnprovenUserCannotReceivePluginGlobalItemsAuthorizedByTemporaryBroadPolicy()
    {
        var document = Document(("owned", "rule-a"), ("global", "global"));
        var payload = Payload(document);
        Sections(document)[0]!["scopeType"] = "library";
        Sections(document)[1]!["scopeType"] = "global";
        payload["heroItems"] = new JsonArray(Item(ItemIds[0]));

        PtvFeaturedTopology.WithholdUnprovenUserContent(payload);

        Assert.Empty(payload["sections"]!.AsArray());
        Assert.Empty(payload["sectionItems"]!.AsObject());
        Assert.Empty(payload["heroItems"]!.AsArray());
    }

}
