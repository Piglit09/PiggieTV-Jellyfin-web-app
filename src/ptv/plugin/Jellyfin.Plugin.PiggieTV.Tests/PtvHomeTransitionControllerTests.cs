using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvHomeTransitionControllerTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "ptv-transition-" + Guid.NewGuid());
    private bool _marker;
    private readonly string _id = Guid.NewGuid().ToString("N");
    private PluginConfiguration? _configuration = new();
    private readonly Authorization _authorization = new();
    private readonly ILibraryManager _manager = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
    private LibraryProxy Library => (LibraryProxy)(object)_manager;
    private IPtvHomeTopologyLedger Ledger() => (IPtvHomeTopologyLedger)Activator.CreateInstance(
        typeof(PtvHomeTopologyLedger), BindingFlags.Instance | BindingFlags.NonPublic, null,
        new object[] { _directory, "server-a", (Func<bool>)(() => _marker), (Action)(() => _marker = true) }, null)!;
    private static JsonOptions StockJsonOptions()
    {
        var options = new JsonOptions(); options.JsonSerializerOptions.PropertyNamingPolicy = null; return options;
    }
    private object Controller(IPtvHomeTopologyLedger? ledger = null, IPtvFeaturedContentRefreshService? refresh = null,
        PtvConfiguredRowAssociationService? authority = null)
    {
        var type = typeof(Plugin).Assembly.GetType("Jellyfin.Plugin.PiggieTV.Api.PtvHomeTransitionsController");
        Assert.NotNull(type);
        ledger ??= Ledger();
        var args = new List<object> { ledger, _manager, _authorization,
            authority ?? new PtvConfiguredRowAssociationService("server-a", () => _configuration, ledger),
            Options.Create(StockJsonOptions()) };
        if (refresh is not null) args.Add(refresh);
        var controller = (ControllerBase)Activator.CreateInstance(type!, args.ToArray())!;
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "admin")], "Test")) } };
        return controller;
    }
    private static async Task<IActionResult> Call(object controller, string method, params object?[] args)
    {
        var task = (Task<IActionResult>)controller.GetType().GetMethod(method)!.Invoke(controller, args)!;
        return await task;
    }
    private VirtualFolderInfo Folder() => new() { ItemId = _id, Name = "Movies", CollectionType = CollectionTypeOptions.movies, Locations = ["/movies"], LibraryOptions = new() };
    private CollectionFolder ActiveChild(string name, Guid? id = null) => new()
    {
        Id = id ?? Guid.Parse(_id), Name = name, CollectionType = Jellyfin.Data.Enums.CollectionType.movies,
        Path = Path.Combine(Library.Root.Path!, name)
    };
    private PtvHomeLibraryDefinition Definition(VirtualFolderInfo folder) => new() { LibraryId = folder.ItemId ?? "", Name = folder.Name, CollectionType = folder.CollectionType?.ToString() ?? "mixed", Roots = folder.Locations, Options = JsonSerializer.SerializeToElement(folder.LibraryOptions) };
    private PtvHomeTransitionIntent Intent()
    {
        var folder = Folder(); Library.Folders = [folder]; Library.Item = new CollectionFolder { Id = Guid.Parse(_id) };
        var intended = Definition(folder); intended.Name = "Films"; intended.LibraryId = "";
        return new() { OperationId = Guid.NewGuid(), Kind = "rename", ServerId = "server-a", ExpectedLibrary = Definition(folder), IntendedLibrary = intended };
    }
    private static JsonElement Body(IActionResult action) => JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(action).Value);
    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task RenameWithOriginalCollectionFolderIdRemainsHeldEvenWithExplicitSelection(bool selectOriginalId)
    {
        var intent = Intent();
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "owned", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        var begun = Body(await Call(controller, "Begin", intent, CancellationToken.None));
        Assert.True(begun.GetProperty("held").GetBoolean());
        Assert.True((await ledger.ReadAsync()).Bindings["owned"].Tombstoned);

        // Jellyfin may change the display name while retaining the old incarnation.
        var renamed = Folder(); renamed.Name = "Films"; Library.Folders = [renamed];
        var selection = selectOriginalId ? new PtvHomeTransitionCompleteRequest { Bindings =
            [new PtvHomeTransitionBindingRequest { RuleId = "owned", LibraryId = _id }] } : null;
        await Call(controller, "Complete", intent.OperationId, selection, CancellationToken.None);

        var persisted = await ledger.ReadAsync();
        Assert.True(persisted.BroadHold);
        Assert.NotEqual("complete", persisted.Operation!.State);
        Assert.True(persisted.Bindings["owned"].Tombstoned);
        Assert.Empty(refresh.Calls);
    }

    [Fact] public async Task CreatingDifferentLibraryDoesNotTombstoneUnpinnedExistingDefault()
    {
        Intent(); // Existing Movies library is authoritative before Anime is created.
        var anime = new VirtualFolderInfo { ItemId = Guid.NewGuid().ToString("N"), Name = "Anime",
            CollectionType = CollectionTypeOptions.tvshows, Locations = ["/anime"], LibraryOptions = new() };
        var intended = Definition(anime); intended.LibraryId = string.Empty;
        var create = new PtvHomeTransitionIntent { OperationId = Guid.NewGuid(), Kind = "create",
            ServerId = "server-a", ExpectedLibraryAbsent = true, IntendedLibrary = intended };
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "latest-movies", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "movies" }
        }] };
        var ledger = Ledger(); var controller = Controller(ledger, new TransitionRefresh(ledger));

        var begun = Body(await Call(controller, "Begin", create, CancellationToken.None));
        var held = await ledger.ReadAsync();
        Assert.True(begun.GetProperty("held").GetBoolean());
        Assert.Empty(held.Operation!.Intent.AffectedRuleIds);
        Assert.Equal(_id, held.Bindings["latest-movies"].CollectionFolderId);
        Assert.False(held.Bindings["latest-movies"].Tombstoned);

        Library.Folders.Add(anime);
        await Call(controller, "Complete", create.OperationId, null, CancellationToken.None);
        var completed = await ledger.ReadAsync();
        Assert.False(completed.BroadHold);
        Assert.False(completed.Bindings["latest-movies"].Tombstoned);
        Assert.Equal(_id, completed.Bindings["latest-movies"].CollectionFolderId);
    }
    [Fact] public async Task AllEndpointsRejectNonAdministratorBeforeReadOrWrite()
    {
        var intent = Intent(); _authorization.Allow = false; var controller = Controller();
        Assert.IsType<ForbidResult>(await Call(controller, "Begin", intent, CancellationToken.None));
        Assert.IsType<ForbidResult>(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));
        Assert.IsType<ForbidResult>(await Call(controller, "Current", CancellationToken.None));
        Assert.Empty(Library.Calls); Assert.Equal(3, _authorization.Policies.Count); Assert.All(_authorization.Policies, p => Assert.Equal(Policies.RequiresElevation, p));
    }
    [Theory]
    [InlineData("rename", false)] [InlineData("delete", false)]
    [InlineData("rename", true)] [InlineData("delete", true)]
    public async Task BeginTombstonesResolvedDefaultBeforeRenameOrDeleteWithoutBindingIt(string kind, bool pinned)
    {
        var intent = Intent(); intent.Kind = kind;
        if (kind == "delete") intent.IntendedLibrary = null;
        var unrelatedId = Guid.NewGuid().ToString("N");
        Library.Folders.Add(new VirtualFolderInfo { ItemId = unrelatedId, Name = "Music", CollectionType = CollectionTypeOptions.music, Locations = ["/music"], LibraryOptions = new() });
        Library.Items[Guid.Parse(unrelatedId)] = new UserView { Id = Guid.Parse(unrelatedId) };
        var affected = new RowBuilderRule { Id = "latest-movies", Name = "Movies", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "movies", VirtualFolderId = pinned ? _id : null } };
        var unrelated = new RowBuilderRule { Id = "latest-music", Name = "Music", MediaType = "music", SourceType = "latest", SourceValue = "music", LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "music" } };
        var global = new RowBuilderRule { Id = "global", Name = "Global", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } };
        _configuration!.Rows = new RowBuilderSettings { Rules = [affected, unrelated, global] };
        var resolved = PtvHomeLibraryScopeResolver.Resolve(affected, Library.Folders);
        Assert.Equal(Guid.Parse(_id), resolved.LibraryId); Assert.Equal(!pinned, resolved.NeedsBinding);
        var controller = Controller();
        var begun = Body(await Call(controller, "Begin", intent, CancellationToken.None));
        var persisted = await Ledger().ReadAsync();
        Assert.Equal(new[] { "latest-movies" }, persisted.Operation!.Intent.AffectedRuleIds);
        Assert.True(persisted.Bindings["latest-movies"].Tombstoned);
        Assert.False(persisted.Bindings.ContainsKey("latest-music")); Assert.False(persisted.Bindings.ContainsKey("global"));
        Assert.Equal(pinned ? _id : null, affected.LibraryScope.VirtualFolderId);
        Assert.True(begun.GetProperty("held").GetBoolean()); Assert.Equal("server-a", persisted.ServerId);
        Library.Folders.RemoveAt(0);
        var replay = Body(await Call(controller, "Begin", intent, CancellationToken.None));
        Assert.Equal(begun.GetProperty("epoch").GetString(), replay.GetProperty("epoch").GetString());
        Assert.False(replay.GetProperty("writeAllowed").GetBoolean());
        await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None);
        var after = await Ledger().ReadAsync(); Assert.True(after.BroadHold); Assert.True(after.Bindings["latest-movies"].Tombstoned);
    }

    [Theory] [InlineData("rename")] [InlineData("delete")]
    public async Task BeginConservativelyTombstonesAmbiguousUnpinnedDefault(string kind)
    {
        var intent = Intent(); intent.Kind = kind;
        if (kind == "delete") intent.IntendedLibrary = null;
        var duplicate = Folder(); duplicate.ItemId = Guid.NewGuid().ToString("N"); Library.Folders.Add(duplicate);
        var rule = new RowBuilderRule { Id = "latest-movies", Name = "Movies", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "movies" } };
        _configuration!.Rows = new RowBuilderSettings { Rules = [rule] };
        Assert.Equal("ambiguous", PtvHomeLibraryScopeResolver.Resolve(rule, Library.Folders).Status);
        Assert.True(Body(await Call(Controller(), "Begin", intent, CancellationToken.None)).GetProperty("held").GetBoolean());
        Assert.True((await Ledger().ReadAsync()).Bindings["latest-movies"].Tombstoned);
        Assert.Null(rule.LibraryScope.VirtualFolderId);
    }

    [Theory]
    [InlineData("Begin", true)] [InlineData("Complete", true)] [InlineData("Current", true)]
    [InlineData("Begin", false)] [InlineData("Complete", false)] [InlineData("Current", false)]
    public async Task RejectedAdministratorActionsSetNoStoreBeforeForbid(string action, bool authenticated)
    {
        var intent = Intent(); _authorization.Allow = false; var controller = (ControllerBase)Controller();
        if (!authenticated) controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity());
        var result = action switch
        {
            "Begin" => await Call(controller, action, intent, CancellationToken.None),
            "Complete" => await Call(controller, action, intent.OperationId, null, CancellationToken.None),
            _ => await Call(controller, action, CancellationToken.None)
        };
        Assert.IsType<ForbidResult>(result);
        Assert.Equal("no-store", controller.Response.Headers.CacheControl.ToString());
        Assert.Empty(Library.Calls);
    }

    [Fact] public async Task BeginSeedsUnaffectedOwnedRuleWithItsExactCurrentCollectionFolder()
    {
        var intent = Intent();
        var musicId = Guid.NewGuid();
        Library.Folders.Add(new VirtualFolderInfo
        {
            ItemId = musicId.ToString("N"), Name = "Music", CollectionType = CollectionTypeOptions.music,
            Locations = ["/music"], LibraryOptions = new()
        });
        _configuration!.Rows = new RowBuilderSettings { Rules =
        [
            new RowBuilderRule { Id = "movies", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
                LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id } },
            new RowBuilderRule { Id = "music", MediaType = "music", SourceType = "latest", SourceValue = "music",
                LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = musicId.ToString("N") } }
        ] };
        Library.Items[musicId] = new CollectionFolder { Id = musicId };

        var response = Body(await Call(Controller(), "Begin", intent, CancellationToken.None));
        var durable = await Ledger().ReadAsync();

        Assert.True(response.GetProperty("held").GetBoolean());
        Assert.True(durable.Bindings["movies"].Tombstoned);
        Assert.Equal(musicId.ToString("N"), durable.Bindings["music"].CollectionFolderId);
        Assert.False(durable.Bindings["music"].Tombstoned);
    }

    [Theory] [InlineData("name")] [InlineData("roots")] [InlineData("options")] [InlineData("server")]
    public async Task ExactExpectedStateConflictDoesNotBegin(string field)
    {
        var intent = Intent();
        if (field == "name") intent.ExpectedLibrary!.Name = "Stale";
        if (field == "roots") intent.ExpectedLibrary!.Roots = ["/different"];
        if (field == "options") intent.ExpectedLibrary!.Options = JsonSerializer.SerializeToElement(new { Enabled = false });
        if (field == "server") intent.ServerId = "other";
        Assert.IsType<ConflictObjectResult>(await Call(Controller(), "Begin", intent, CancellationToken.None));
        Assert.Null((await Ledger().ReadAsync()).Operation);
    }
    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task PluginAdapterCorrelatesStockMixedAndZeroRootDefinitions(bool emptyRoots)
    {
        var intent = Intent(); var folder = Folder(); folder.CollectionType = null;
        if (emptyRoots) folder.Locations = [];
        Library.Folders = [folder]; intent.ExpectedLibrary = Definition(folder);
        intent.IntendedLibrary = Definition(folder); intent.IntendedLibrary.Name = "Films"; intent.IntendedLibrary.LibraryId = "";
        var controller = Controller();
        Assert.True(Body(await Call(controller, "Begin", intent, CancellationToken.None)).GetProperty("writeAllowed").GetBoolean());
        folder.Name = "Films";
        var result = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));
        Assert.Equal("unresolved", result.GetProperty("authority").GetString()); Assert.True(result.GetProperty("held").GetBoolean());
    }
    [Fact] public async Task BeginDurablyTombstonesAffectedRulesAndRetiresOnlyLibraryPresentationBeforeReply()
    {
        var intent = Intent();
        _configuration!.Rows = new RowBuilderSettings { Rules = [
            new RowBuilderRule { Id = "owned", Name = "Movies", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id } },
            new RowBuilderRule { Id = "global", Name = "Global", MediaType = "movies", SourceType = "latest", SourceValue = "movies", LibraryScope = new RowLibraryScope { Mode = "global" } }
        ] };
        var ledger = Ledger(); var authority = new PtvConfiguredRowAssociationService("server-a", () => _configuration, ledger);
        var document = new PtvFeaturedContentDocument { FeaturedContent = JsonNode.Parse("""
            {"version":9,"payload":{"sections":[{"id":"owned-section","rowType":"configured-rule","sourceRuleId":"owned","ruleId":"owned"},{"id":"global-section","rowType":"configured-rule","sourceRuleId":"global","ruleId":"global"}]}}
            """)!.AsObject() };
        authority.RegisterGeneratedWrite(authority.CaptureGeneration()!, document);
        var user = Guid.NewGuid(); var before = authority.CaptureCurrentPresentationProof(user, true)!;
        Assert.Equal(2, before.Bindings!.Count);
        var controller = (ControllerBase)Activator.CreateInstance(typeof(Plugin).Assembly.GetType("Jellyfin.Plugin.PiggieTV.Api.PtvHomeTransitionsController")!, ledger, _manager, _authorization, authority, Options.Create(StockJsonOptions()))!;
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext() };
        var response = Body(await Call(controller, "Begin", intent, CancellationToken.None));
        Assert.True(response.GetProperty("held").GetBoolean());
        var persisted = await Ledger().ReadAsync(); Assert.True(persisted.Bindings["owned"].Tombstoned); Assert.False(persisted.Bindings.ContainsKey("global"));
        var after = authority.CaptureCurrentPresentationProof(user, true)!;
        Assert.Single(after.Bindings!); Assert.Equal(before.Authority.ToJsonString(), after.Authority.ToJsonString());
        Assert.Equal(before.Bindings![1]!.ToJsonString(), after.Bindings![0]!.ToJsonString());
    }

    [Fact] public async Task MissingRuleAuthorityCannotBeginWithoutKnowingAffectedBindings()
    {
        var intent = Intent(); _configuration = null;
        Assert.IsType<ConflictObjectResult>(await Call(Controller(), "Begin", intent, CancellationToken.None));
        Assert.Null((await Ledger().ReadAsync()).Operation);
    }
    [Fact] public async Task BeginRetryAfterStockWriteIsIdempotentButNeverAuthorizesAnotherWrite()
    {
        var intent = Intent(); var controller = Controller();
        var first = Body(await Call(controller, "Begin", intent, CancellationToken.None));
        Library.Folders = [];
        var retry = Body(await Call(controller, "Begin", intent, CancellationToken.None));
        Assert.True(first.GetProperty("held").GetBoolean()); Assert.True(first.GetProperty("writeAllowed").GetBoolean());
        Assert.False(retry.GetProperty("writeAllowed").GetBoolean()); Assert.Equal(first.GetProperty("epoch").GetString(), retry.GetProperty("epoch").GetString());
        var current = Body(await Call(Controller(), "Current", CancellationToken.None));
        Assert.Equal(intent.OperationId, current.GetProperty("operationId").GetGuid()); Assert.Equal("pending", current.GetProperty("state").GetString());
    }
    [Fact] public async Task ConcurrentOperationConflictsAndPersistenceFailureCannotAcknowledge()
    {
        var intent = Intent(); await Call(Controller(), "Begin", intent, CancellationToken.None);
        var next = Intent(); Assert.IsType<ConflictObjectResult>(await Call(Controller(), "Begin", next, CancellationToken.None));
        Directory.Move(_directory, _directory + "-saved"); File.WriteAllText(_directory, "obstacle");
        try { Assert.Equal(503, Assert.IsType<ObjectResult>(await Call(Controller(), "Begin", next, CancellationToken.None)).StatusCode); }
        finally { File.Delete(_directory); Directory.Move(_directory + "-saved", _directory); }
    }
    [Theory] [InlineData("null")] [InlineData("ambiguous")] [InlineData("old-view")] [InlineData("unique")]
    public async Task CompleteUsesPluginReadbackAndNeverReleasesWithoutFreshGeneration(string outcome)
    {
        var intent = Intent(); var controller = Controller(); await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films";
        if (outcome == "unique") renamed.ItemId = Guid.NewGuid().ToString("N");
        if (outcome == "null") renamed.ItemId = null;
        Library.Folders = outcome == "ambiguous" ? [renamed, renamed] : [renamed];
        if (outcome == "old-view") Library.Item = new UserView { Id = Guid.Parse(_id) };
        var response = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));
        Assert.True(response.GetProperty("held").GetBoolean()); Assert.Equal("pending", response.GetProperty("state").GetString());
        Assert.Equal(outcome == "unique" ? "binding-required" : "unresolved", response.GetProperty("authority").GetString());
        Assert.True((await Ledger().ReadAsync()).BroadHold);
        Assert.DoesNotContain(Library.Calls, n => n.Contains("Validate", StringComparison.Ordinal) || n.Contains("Refresh", StringComparison.Ordinal));
    }
    [Fact] public async Task CurrentAfterReloadReportsOnlyVerifiedCurrentRebindCandidate()
    {
        var intent = Intent();
        await Call(Controller(), "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = Guid.NewGuid().ToString("N");
        Library.Folders = [renamed];
        var current = Body(await Call(Controller(), "Current", CancellationToken.None));

        Assert.True(current.GetProperty("held").GetBoolean());
        Assert.Equal("binding-required", current.GetProperty("authority").GetString());
        Assert.Equal(renamed.ItemId, current.GetProperty("library").GetProperty("ItemId").GetString());
        Assert.True((await Ledger().ReadAsync()).BroadHold);
    }

    [Fact] public async Task CompleteStagesBeforeDurableReleaseAndRefreshesOnlyAfterRelease()
    {
        var intent = Intent();
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "owned", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var ledger = Ledger();
        var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = Guid.NewGuid().ToString("N"); Library.Folders = [renamed];

        var response = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));

        Assert.Equal(["stage-held", "refresh-released"], refresh.Calls);
        Assert.False((await Ledger().ReadAsync()).BroadHold);
        Assert.True((await Ledger().ReadAsync()).Bindings["owned"].Tombstoned);
        Assert.False(response.GetProperty("held").GetBoolean());
        Assert.Equal("complete", response.GetProperty("state").GetString());
        Assert.Equal("binding-required", response.GetProperty("authority").GetString());
    }

    [Fact] public async Task CompleteWaitsForBoundedUserRootConvergenceAndRetriesTheSameHeldOperation()
    {
        var intent = Intent(); var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = Guid.NewGuid().ToString("N"); Library.Folders = [renamed];
        Library.TopChildrenOverride = [ActiveChild("Movies")];

        var first = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));
        Assert.True(first.GetProperty("held").GetBoolean());
        Assert.Empty(refresh.Calls);
        Assert.InRange(Library.TopReadCount, 1, 3);
        Assert.Contains(false, Library.VirtualFolderRequests);
        Assert.NotNull(Library.LastTopQuery);
        Assert.Equal(Library.Root.Id, Library.LastTopQuery.ParentId);
        Assert.False(Library.LastTopQuery.Recursive);
        Assert.Null(Library.LastTopQuery.User);
        Assert.False(Library.LastTopQuery.GroupByPresentationUniqueKey);
        Assert.False(Library.LastTopQuery.EnableTotalRecordCount);
        Assert.Equal(129, Library.LastTopQuery.Limit);

        Library.TopChildrenOverride = [ActiveChild("Films", Guid.Parse(renamed.ItemId!))];
        var second = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));
        Assert.False(second.GetProperty("held").GetBoolean());
        Assert.Equal("complete", second.GetProperty("state").GetString());
        Assert.Equal(["stage-held", "refresh-released"], refresh.Calls);
        Assert.DoesNotContain(Library.Calls, call => call.Contains("Validate", StringComparison.Ordinal)
            || call.Contains("Refresh", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("stale-child")]
    [InlineData("duplicate-id")]
    [InlineData("duplicate-name")]
    [InlineData("null-id")]
    [InlineData("empty-child-id")]
    [InlineData("invalid-path")]
    [InlineData("top-cap")]
    [InlineData("virtual-cap")]
    public async Task CompleteKeepsHoldForAmbiguousOrUnboundedTopFolderEvidence(string problem)
    {
        var intent = Intent(); var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; Library.Folders = [renamed];
        var top = ActiveChild("Films");
        Library.TopChildrenOverride = [top];
        switch (problem)
        {
            case "stale-child": Library.TopChildrenOverride.Add(new CollectionFolder { Id = Guid.NewGuid(), Name = "Movies" }); break;
            case "duplicate-id": Library.TopChildrenOverride.Add(new CollectionFolder { Id = top.Id, Name = "Other" }); break;
            case "duplicate-name": Library.TopChildrenOverride.Add(new CollectionFolder { Id = Guid.NewGuid(), Name = "Films" }); break;
            case "null-id": Library.Folders.Add(new VirtualFolderInfo { ItemId = null, Name = "Other", Locations = ["/other"], LibraryOptions = new() }); break;
            case "empty-child-id": Library.TopChildrenOverride.Add(new CollectionFolder { Id = Guid.Empty, Name = "Other" }); break;
            case "invalid-path": top.Path = Path.Combine(Library.Root.Path!, "Wrong"); break;
            case "top-cap": Library.TopChildrenOverride.AddRange(Enumerable.Range(0, 129).Select(i => new CollectionFolder { Id = Guid.NewGuid(), Name = "Extra" + i })); break;
            case "virtual-cap": Library.Folders.AddRange(Enumerable.Range(0, 129).Select(i => new VirtualFolderInfo { ItemId = Guid.NewGuid().ToString("N"), Name = "Extra" + i, Locations = ["/extra" + i], LibraryOptions = new() })); break;
        }

        var response = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));
        Assert.True(response.GetProperty("held").GetBoolean());
        Assert.Empty(refresh.Calls);
        Assert.True((await ledger.ReadAsync()).BroadHold);
        Assert.DoesNotContain(Library.Calls, call => call.Contains("Validate", StringComparison.Ordinal)
            || call.Contains("Refresh", StringComparison.Ordinal));
    }

    [Fact] public async Task CompletePreservesHoldWhenTopReadThrowsOrAdministratorCancels()
    {
        var intent = Intent(); var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; Library.Folders = [renamed];
        Library.ThrowOnTopRead = true;
        var failed = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));
        Assert.True(failed.GetProperty("held").GetBoolean());
        Assert.True((await ledger.ReadAsync()).BroadHold);
        Assert.Empty(refresh.Calls);

        Library.ThrowOnTopRead = false;
        using var aborted = new CancellationTokenSource(); aborted.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            await Call(controller, "Complete", intent.OperationId, null, aborted.Token));
        Assert.True((await ledger.ReadAsync()).BroadHold);
        Assert.Empty(refresh.Calls);
    }

    [Fact] public async Task CompleteRejectsIdentityFlipBetweenPrivateStageAndFinalReadback()
    {
        var intent = Intent(); var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = Guid.NewGuid().ToString("N"); Library.Folders = [renamed];
        refresh.OnStage = () =>
        {
            Library.TopChildrenOverride = [ActiveChild("Films", Guid.NewGuid())];
        };

        var response = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));
        Assert.True(response.GetProperty("held").GetBoolean());
        Assert.Equal(["stage-held"], refresh.Calls);
        Assert.True((await ledger.ReadAsync()).BroadHold);
    }

    [Fact] public async Task CompleteTreatsMultiRootOrderAsEquivalentWhenDefinitionsOtherwiseAgree()
    {
        var intent = Intent(); var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        intent.ExpectedLibrary!.Roots = ["/movies", "/archive"];
        intent.IntendedLibrary!.Roots = ["/movies", "/archive"];
        var old = Folder(); old.Locations = ["/archive", "/movies"]; Library.Folders = [old];
        var controller = Controller(ledger, refresh);
        Assert.IsType<OkObjectResult>(await Call(controller, "Begin", intent, CancellationToken.None));
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = Guid.NewGuid().ToString("N"); renamed.Locations = ["/archive", "/movies"];
        Library.Folders = [renamed];

        var response = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));
        Assert.False(response.GetProperty("held").GetBoolean());
        Assert.Equal("complete", response.GetProperty("state").GetString());
    }

    [Fact] public async Task CompleteRejectsTopChildPathEscapingTheUserRoot()
    {
        var intent = Intent(); intent.IntendedLibrary!.Name = "..";
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var escaped = Folder(); escaped.Name = ".."; Library.Folders = [escaped];

        var response = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));
        Assert.True(response.GetProperty("held").GetBoolean());
        Assert.Empty(refresh.Calls);
    }

    [Fact] public async Task MixedVirtualFolderDoesNotAssumeUnknownActiveCollectionTypeIsEquivalent()
    {
        var intent = Intent();
        var before = Folder(); before.CollectionType = null;
        intent.ExpectedLibrary = Definition(before);
        intent.IntendedLibrary!.CollectionType = "mixed";
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        Library.Folders = [before];
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.CollectionType = null;
        Library.Folders = [renamed];
        Library.TopChildrenOverride = [new CollectionFolder
        {
            Id = Guid.Parse(_id), Name = "Films", Path = Path.Combine(Library.Root.Path!, "Films"),
            CollectionType = Jellyfin.Data.Enums.CollectionType.unknown
        }];

        var response = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));
        Assert.True(response.GetProperty("held").GetBoolean());
        Assert.Empty(refresh.Calls);
    }

    [Fact] public async Task LedgerCommitsSelectedRebindAndBroadHoldReleaseAtomically()
    {
        var intent = Intent(); intent.AffectedRuleIds = ["owned"];
        var ledger = Ledger();
        var begun = await ledger.BeginAsync(intent);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = Guid.NewGuid().ToString("N");
        var verified = new PtvVerifiedTransitionReadback(begun.Epoch, Definition(renamed), null, true, true, true);
        var bindings = new Dictionary<string, string>(StringComparer.Ordinal) { ["owned"] = renamed.ItemId! };

        var released = await ledger.CompleteAndRebindAsync(intent.OperationId, verified, bindings,
            new Dictionary<string, string>(StringComparer.Ordinal));

        Assert.False(released.BroadHold);
        Assert.Equal("complete", released.Operation!.State);
        Assert.False(released.Bindings["owned"].Tombstoned);
        Assert.Equal(renamed.ItemId, released.Bindings["owned"].CollectionFolderId);
        Assert.Equal(1, released.RebindCount);
        Assert.Equal(3, released.Sequence);
        var durable = await Ledger().ReadAsync();
        Assert.False(durable.RecoveryRequired);
        Assert.False(durable.BroadHold);
        Assert.False(durable.Bindings["owned"].Tombstoned);
    }

    [Theory] [InlineData("null")] [InlineData("ambiguous")] [InlineData("roots")] [InlineData("options")]
    public async Task CompleteRetainsHoldWhenCurrentDefinitionIsNotUniqueAndExact(string outcome)
    {
        var intent = Intent(); var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films";
        if (outcome == "null") renamed.ItemId = null;
        if (outcome == "roots") renamed.Locations = ["/other"];
        if (outcome == "options") renamed.LibraryOptions = new() { EnablePhotos = false };
        Library.Folders = outcome == "ambiguous" ? [renamed, renamed] : [renamed];

        var response = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));

        Assert.True(response.GetProperty("held").GetBoolean());
        Assert.True((await Ledger().ReadAsync()).BroadHold);
        Assert.Empty(refresh.Calls);
    }

    [Fact] public async Task RebindChoicesIncludeFreshAndTombstonedRulesOnlyForVerifiedCurrentFolder()
    {
        var intent = Intent();
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "old", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = Guid.NewGuid().ToString("N"); Library.Folders = [renamed];
        await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None);
        _configuration.Rows.Rules.Add(new RowBuilderRule
        {
            Id = "fresh", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = renamed.ItemId }
        });

        var current = Body(await Call(Controller(ledger, refresh), "Current", CancellationToken.None));
        Assert.Equal("binding-required", current.GetProperty("authority").GetString());
        Assert.Equal(["old", "fresh"], current.GetProperty("affectedRuleIds").EnumerateArray().Select(v => v.GetString()));
        Assert.False(current.GetProperty("held").GetBoolean());
        var selected = new PtvHomeTransitionCompleteRequest { Bindings =
        [
            new PtvHomeTransitionBindingRequest { RuleId = "old", LibraryId = renamed.ItemId! },
            new PtvHomeTransitionBindingRequest { RuleId = "fresh", LibraryId = renamed.ItemId! }
        ] };
        await Call(controller, "Complete", intent.OperationId, selected, CancellationToken.None);
        var rebound = await ledger.ReadAsync();
        Assert.Equal(PtvHomeLibraryScopeResolver.ScopeFingerprint(_configuration.Rows.Rules.Single(rule => rule.Id == "fresh")),
            rebound.Bindings["fresh"].OriginalScopeFingerprint);
    }

    [Fact] public async Task FailedWriteAfterReleaseCanRetryWithoutBindingChoices()
    {
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "global", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "global" }
        }] };
        var intent = Intent(); var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = Guid.NewGuid().ToString("N"); Library.Folders = [renamed];

        var first = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));
        var retry = Body(await Call(controller, "Complete", intent.OperationId, new PtvHomeTransitionCompleteRequest(), CancellationToken.None));

        Assert.Equal("generation-pending", first.GetProperty("authority").GetString());
        Assert.Equal("generation-pending", retry.GetProperty("authority").GetString());
        Assert.False(retry.GetProperty("held").GetBoolean());
        Assert.Equal(first.GetProperty("epoch").GetString(), retry.GetProperty("epoch").GetString());
        Assert.Equal(["stage-held", "refresh-released", "stage-released", "refresh-released"], refresh.Calls);
    }

    [Fact] public async Task ExplicitCurrentRuleSelectionRotatesEpochAndBindingGeneration()
    {
        var intent = Intent();
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "owned", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = Guid.NewGuid().ToString("N"); Library.Folders = [renamed];
        var before = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));

        var selected = new PtvHomeTransitionCompleteRequest { Bindings =
            [new PtvHomeTransitionBindingRequest { RuleId = "owned", LibraryId = renamed.ItemId! }] };
        var after = Body(await Call(controller, "Complete", intent.OperationId, selected, CancellationToken.None));
        var durable = await Ledger().ReadAsync();

        Assert.NotEqual(before.GetProperty("epoch").GetString(), after.GetProperty("epoch").GetString());
        Assert.Equal("complete", after.GetProperty("state").GetString());
        Assert.False(after.GetProperty("held").GetBoolean());
        Assert.Equal("binding-required", after.GetProperty("authority").GetString()); // no fake store proof
        Assert.Equal(1, durable.RebindCount);
        Assert.Equal(renamed.ItemId, durable.Bindings["owned"].CollectionFolderId);
        Assert.False(durable.Bindings["owned"].Tombstoned);
        Assert.Equal(intent.OperationId, durable.Bindings["owned"].ReboundOperationId);
        Assert.Equal(["stage-held", "refresh-released", "stage-released", "refresh-released"], refresh.Calls);
    }

    [Fact] public async Task DeleteThenSameNameRootsAndIdRecreateDoesNotAdoptOldOrFreshRule()
    {
        var delete = Intent(); delete.Kind = "delete"; delete.IntendedLibrary = null;
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "old", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", delete, CancellationToken.None);
        Library.Folders = [];
        await Call(controller, "Complete", delete.OperationId, null, CancellationToken.None);
        Assert.True((await Ledger().ReadAsync()).Bindings["old"].Tombstoned);

        var create = new PtvHomeTransitionIntent
        {
            OperationId = Guid.NewGuid(), Kind = "create", ServerId = "server-a", ExpectedLibraryAbsent = true,
            IntendedLibrary = Definition(Folder())
        };
        create.IntendedLibrary.LibraryId = "";
        await Call(controller, "Begin", create, CancellationToken.None);
        Library.Folders = [Folder()];
        await Call(controller, "Complete", create.OperationId, null, CancellationToken.None);
        _configuration.Rows.Rules.Add(new RowBuilderRule
        {
            Id = "fresh", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        });

        var diagnostic = Body(await Call(controller, "Current", CancellationToken.None));
        Assert.Equal("binding-required", diagnostic.GetProperty("authority").GetString());
        Assert.Equal(["old", "fresh"], diagnostic.GetProperty("affectedRuleIds").EnumerateArray().Select(v => v.GetString()));
        var before = await Ledger().ReadAsync();
        Assert.True(before.Bindings["old"].Tombstoned);
        Assert.False(before.Bindings.ContainsKey("fresh"));
        var selected = new PtvHomeTransitionCompleteRequest { Bindings =
        [
            new PtvHomeTransitionBindingRequest { RuleId = "old", LibraryId = _id },
            new PtvHomeTransitionBindingRequest { RuleId = "fresh", LibraryId = _id }
        ] };
        await Call(controller, "Complete", create.OperationId, selected, CancellationToken.None);
        var after = await Ledger().ReadAsync();
        Assert.NotEqual(before.Epoch, after.Epoch);
        Assert.False(after.Bindings["old"].Tombstoned);
        Assert.Equal(_id, after.Bindings["fresh"].CollectionFolderId);
    }

    [Theory] [InlineData("roots")] [InlineData("definition")]
    public async Task SameIdRootsAndOptionsChangeRequiresExplicitSelection(string kind)
    {
        var intent = Intent(); intent.Kind = kind;
        var afterFolder = Folder();
        if (kind == "roots") afterFolder.Locations = ["/movies", "F:/archive"];
        else afterFolder.LibraryOptions = new() { EnablePhotos = false };
        intent.IntendedLibrary = Definition(afterFolder);
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "owned", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        Library.Folders = [afterFolder];

        var response = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));

        Assert.Equal("binding-required", response.GetProperty("authority").GetString());
        Assert.Equal(["owned"], response.GetProperty("affectedRuleIds").EnumerateArray().Select(v => v.GetString()));
        Assert.True((await Ledger().ReadAsync()).Bindings["owned"].Tombstoned);
    }

    [Fact] public async Task RenameNewIdOffersExplicitSelectionWithoutOrdinaryRepoint()
    {
        var intent = Intent();
        var newId = Guid.NewGuid().ToString("N");
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "owned", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = newId;
        Library.Folders = [renamed]; Library.Item = new CollectionFolder { Id = Guid.Parse(newId) };
        var released = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));
        Assert.Equal("binding-required", released.GetProperty("authority").GetString());
        Assert.True((await Ledger().ReadAsync()).Bindings["owned"].Tombstoned);

        var current = Body(await Call(controller, "Current", CancellationToken.None));
        Assert.Equal("binding-required", current.GetProperty("authority").GetString());
        Assert.Equal(newId, current.GetProperty("library").GetProperty("ItemId").GetString());
        var selected = new PtvHomeTransitionCompleteRequest { Bindings =
            [new PtvHomeTransitionBindingRequest { RuleId = "owned", LibraryId = newId }] };
        await Call(controller, "Complete", intent.OperationId, selected, CancellationToken.None);
        Assert.Equal(newId, (await Ledger().ReadAsync()).Bindings["owned"].CollectionFolderId);
        Assert.Equal(_id, _configuration.Rows.Rules[0].LibraryScope!.VirtualFolderId);
    }

    [Fact] public async Task WrongOrPartialRebindSelectionKeepsTombstones()
    {
        var intent = Intent();
        _configuration!.Rows = new RowBuilderSettings { Rules = new[] { "one", "two" }.Select(id => new RowBuilderRule
        {
            Id = id, MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }).ToList() };
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = Guid.NewGuid().ToString("N"); Library.Folders = [renamed];
        await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None);
        var wrong = new PtvHomeTransitionCompleteRequest { Bindings =
            [new PtvHomeTransitionBindingRequest { RuleId = "one", LibraryId = Guid.NewGuid().ToString("N") }] };
        var partial = new PtvHomeTransitionCompleteRequest { Bindings =
            [new PtvHomeTransitionBindingRequest { RuleId = "one", LibraryId = renamed.ItemId! }] };
        Assert.IsType<ConflictObjectResult>(await Call(controller, "Complete", intent.OperationId, wrong, CancellationToken.None));
        Assert.IsType<ConflictObjectResult>(await Call(controller, "Complete", intent.OperationId, partial, CancellationToken.None));
        var state = await Ledger().ReadAsync();
        Assert.True(state.Bindings["one"].Tombstoned);
        Assert.True(state.Bindings["two"].Tombstoned);
        Assert.Equal(0, state.RebindCount);
    }

    [Theory] [InlineData("rename")] [InlineData("delete")]
    public async Task OldLibraryNameCaseVariantStillBlocksReadback(string kind)
    {
        var intent = Intent(); intent.Kind = kind;
        if (kind == "delete") intent.IntendedLibrary = null;
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var old = Folder(); old.ItemId = Guid.NewGuid().ToString("N"); old.Name = "MOVIES";
        if (kind == "rename")
        {
            var renamed = Folder(); renamed.Name = "Films";
            Library.Folders = [old, renamed];
        }
        else Library.Folders = [old];

        var response = Body(await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None));

        Assert.True(response.GetProperty("held").GetBoolean());
        Assert.True((await Ledger().ReadAsync()).BroadHold);
        Assert.Empty(refresh.Calls);
    }

    [Fact] public async Task UnpinnedDefaultExplicitLedgerBindingCanReportBoundAfterTrustedWrite()
    {
        var intent = Intent(); intent.Kind = "roots";
        var changed = Folder(); changed.Locations = ["/movies", "F:/archive"];
        intent.IntendedLibrary = Definition(changed);
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "latest-movies", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "movies" }
        }] };
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var authority = new PtvConfiguredRowAssociationService("server-a", () => _configuration, ledger);
        var controller = Controller(ledger, refresh, authority);
        await Call(controller, "Begin", intent, CancellationToken.None);
        Library.Folders = [changed];
        await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None);
        var selected = new PtvHomeTransitionCompleteRequest { Bindings =
            [new PtvHomeTransitionBindingRequest { RuleId = "latest-movies", LibraryId = _id }] };
        await Call(controller, "Complete", intent.OperationId, selected, CancellationToken.None);
        authority.RegisterGeneratedWrite(authority.CaptureGeneration()!, new PtvFeaturedContentDocument());

        var current = Body(await Call(controller, "Current", CancellationToken.None));

        Assert.Null(_configuration.Rows.Rules[0].LibraryScope?.VirtualFolderId);
        Assert.True(PtvHomeLibraryScopeResolver.Resolve(_configuration.Rows.Rules[0], Library.Folders).NeedsBinding);
        var normalized = authority.CaptureGeneration()!.CreateConfiguration().Rows.Rules[0];
        Assert.True(PtvHomeLibraryScopeResolver.Resolve(normalized, Library.Folders).NeedsBinding, JsonSerializer.Serialize(normalized));
        Assert.Equal("bound", current.GetProperty("authority").GetString());
        Assert.Empty(current.GetProperty("affectedRuleIds").EnumerateArray());
    }

    [Fact] public async Task LostSuccessfulRebindReplyCanReplayWithoutRotatingEpochAgain()
    {
        var intent = Intent();
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "owned", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var authority = new PtvConfiguredRowAssociationService("server-a", () => _configuration, ledger);
        var controller = Controller(ledger, refresh, authority);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = Guid.NewGuid().ToString("N"); Library.Folders = [renamed];
        await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None);
        var selected = new PtvHomeTransitionCompleteRequest { Bindings =
            [new PtvHomeTransitionBindingRequest { RuleId = "owned", LibraryId = renamed.ItemId! }] };
        await Call(controller, "Complete", intent.OperationId, selected, CancellationToken.None);
        authority.RegisterGeneratedWrite(authority.CaptureGeneration()!, new PtvFeaturedContentDocument());
        var before = await Ledger().ReadAsync();

        var replay = Body(await Call(controller, "Complete", intent.OperationId, selected, CancellationToken.None));

        Assert.Equal("bound", replay.GetProperty("authority").GetString());
        Assert.Equal(before.Epoch, replay.GetProperty("epoch").GetString());
        Assert.Equal(1, (await Ledger().ReadAsync()).RebindCount);
        Assert.Equal(4, refresh.Calls.Count);
    }

    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task NewIdRenameOffersAffectedRuleBeforeOrdinarySettingsRepoint(bool unpinnedDefault)
    {
        var intent = Intent();
        var ruleId = unpinnedDefault ? "latest-movies" : "owned";
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = ruleId, MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = unpinnedDefault
                ? new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "movies" }
                : new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var newId = Guid.NewGuid();
        var ledger = Ledger(); var controller = Controller(ledger, new TransitionRefresh(ledger));
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = newId.ToString("N");
        Library.Folders = [renamed]; Library.Item = new CollectionFolder { Id = newId };

        var diagnostic = Body(await Call(controller, "Current", CancellationToken.None));

        Assert.Equal("binding-required", diagnostic.GetProperty("authority").GetString());
        Assert.Equal([ruleId], diagnostic.GetProperty("affectedRuleIds").EnumerateArray().Select(v => v.GetString()));
        Assert.True((await Ledger().ReadAsync()).Bindings[ruleId].Tombstoned);
        Assert.Null(unpinnedDefault ? _configuration.Rows.Rules[0].LibraryScope?.VirtualFolderId : null);
    }

    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task CompleteNewIdRenameRebindsLedgerWithoutChangingSavedRows(bool unpinnedDefault)
    {
        var intent = Intent();
        var ruleId = unpinnedDefault ? "latest-movies" : "owned";
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = ruleId, MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = unpinnedDefault
                ? new RowLibraryScope { Mode = "defaultLibrary", DefaultKey = "movies" }
                : new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var newId = Guid.NewGuid();
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = newId.ToString("N");
        Library.Folders = [renamed]; Library.Item = new CollectionFolder { Id = newId };
        var selection = new PtvHomeTransitionCompleteRequest { Bindings =
            [new PtvHomeTransitionBindingRequest { RuleId = ruleId, LibraryId = newId.ToString("N") }] };

        await Call(controller, "Complete", intent.OperationId, selection, CancellationToken.None);

        var durable = await Ledger().ReadAsync();
        Assert.Equal(unpinnedDefault ? null : _id, _configuration.Rows.Rules[0].LibraryScope?.VirtualFolderId);
        Assert.False(durable.Bindings[ruleId].Tombstoned);
        Assert.Equal(newId.ToString("N"), durable.Bindings[ruleId].CollectionFolderId);
        Assert.Equal(newId, PtvHomeLibraryScopeResolver.Resolve(_configuration.Rows.Rules[0], Library.Folders, durable).LibraryId);
        _configuration.Rows.Rules[0].LibraryScope!.VirtualFolderId = newId.ToString("N");
        Assert.Null(PtvHomeLibraryScopeResolver.Resolve(_configuration.Rows.Rules[0], Library.Folders, durable).LibraryId);
        Assert.Equal(["stage-held", "refresh-released"], refresh.Calls);
    }

    [Fact] public async Task NewIdRebindAfterFailedWriteCanReplayExactSelectionWithoutAnotherRotation()
    {
        var intent = Intent();
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "owned", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var newId = Guid.NewGuid();
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger);
        var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = newId.ToString("N");
        Library.Folders = [renamed]; Library.Item = new CollectionFolder { Id = newId };
        var selected = new PtvHomeTransitionCompleteRequest { Bindings =
            [new PtvHomeTransitionBindingRequest { RuleId = "owned", LibraryId = newId.ToString("N") }] };
        await Call(controller, "Complete", intent.OperationId, selected, CancellationToken.None);
        var before = await ledger.ReadAsync();
        Assert.Equal("binding-required", Body(await Call(controller, "Current", CancellationToken.None)).GetProperty("authority").GetString());

        var replay = await Call(Controller(Ledger(), new TransitionRefresh(Ledger())), "Complete",
            intent.OperationId, selected, CancellationToken.None);
        var after = await Ledger().ReadAsync();
        Assert.IsType<OkObjectResult>(replay);
        Assert.Equal(before.Epoch, after.Epoch);
        Assert.Equal(1, after.RebindCount);
        Assert.Equal(_id, _configuration.Rows.Rules[0].LibraryScope?.VirtualFolderId);
    }

    [Fact] public async Task OrdinarySettingsRepointAfterBeginCannotTurnTombstoneIntoBoundStatus()
    {
        var intent = Intent();
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "owned", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var newId = Guid.NewGuid();
        var ledger = Ledger(); var controller = Controller(ledger, new TransitionRefresh(ledger));
        await Call(controller, "Begin", intent, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = newId.ToString("N");
        Library.Folders = [renamed]; Library.Item = new CollectionFolder { Id = newId };
        _configuration.Rows.Rules[0].LibraryScope!.VirtualFolderId = newId.ToString("N");
        await Call(controller, "Complete", intent.OperationId, null, CancellationToken.None);
        var selected = new PtvHomeTransitionCompleteRequest { Bindings =
            [new PtvHomeTransitionBindingRequest { RuleId = "owned", LibraryId = newId.ToString("N") }] };

        var diagnostic = Body(await Call(controller, "Current", CancellationToken.None));

        Assert.Equal("binding-required", diagnostic.GetProperty("authority").GetString());
        Assert.Empty(diagnostic.GetProperty("affectedRuleIds").EnumerateArray());
        Assert.IsType<ConflictObjectResult>(await Call(controller, "Complete", intent.OperationId, selected, CancellationToken.None));
        Assert.True((await ledger.ReadAsync()).Bindings["owned"].Tombstoned);
    }

    [Fact] public async Task LaterMutationOfLedgerOnlyReboundLibraryTombstonesRuleBeforeWrite()
    {
        var rename = Intent();
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "owned", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var newId = Guid.NewGuid();
        var ledger = Ledger(); var controller = Controller(ledger, new TransitionRefresh(ledger));
        await Call(controller, "Begin", rename, CancellationToken.None);
        var renamed = Folder(); renamed.Name = "Films"; renamed.ItemId = newId.ToString("N");
        Library.Folders = [renamed]; Library.Item = new CollectionFolder { Id = newId };
        var selected = new PtvHomeTransitionCompleteRequest { Bindings =
            [new PtvHomeTransitionBindingRequest { RuleId = "owned", LibraryId = newId.ToString("N") }] };
        await Call(controller, "Complete", rename.OperationId, selected, CancellationToken.None);
        var roots = new PtvHomeTransitionIntent
        {
            OperationId = Guid.NewGuid(), Kind = "roots", ServerId = "server-a",
            ExpectedLibrary = Definition(renamed), IntendedLibrary = Definition(renamed)
        };
        roots.IntendedLibrary.Roots = ["/movies", "/archive"];

        var begun = Body(await Call(controller, "Begin", roots, CancellationToken.None));

        Assert.True(begun.GetProperty("held").GetBoolean());
        Assert.Equal(["owned"], (await Ledger().ReadAsync()).Operation!.Intent.AffectedRuleIds);
        Assert.True((await Ledger().ReadAsync()).Bindings["owned"].Tombstoned);
        Assert.Equal(_id, _configuration.Rows.Rules[0].LibraryScope?.VirtualFolderId);
    }

    [Fact] public async Task DeleteThenSameNameRootsAndReusedIdCreateRequiresExplicitFreshSelection()
    {
        var deletion = Intent(); deletion.Kind = "delete"; deletion.IntendedLibrary = null;
        _configuration!.Rows = new RowBuilderSettings { Rules = [new RowBuilderRule
        {
            Id = "owned", MediaType = "movies", SourceType = "latest", SourceValue = "movies",
            LibraryScope = new RowLibraryScope { Mode = "virtualFolder", VirtualFolderId = _id }
        }] };
        var ledger = Ledger(); var refresh = new TransitionRefresh(ledger); var controller = Controller(ledger, refresh);
        await Call(controller, "Begin", deletion, CancellationToken.None);
        Library.Folders = [];
        await Call(controller, "Complete", deletion.OperationId, null, CancellationToken.None);
        Assert.True((await ledger.ReadAsync()).Bindings["owned"].Tombstoned);
        var created = Definition(Folder()); created.LibraryId = string.Empty;
        var creation = new PtvHomeTransitionIntent { OperationId = Guid.NewGuid(), Kind = "create", ServerId = "server-a",
            ExpectedLibraryAbsent = true, IntendedLibrary = created };
        await Call(controller, "Begin", creation, CancellationToken.None);
        Library.Folders = [Folder()]; Library.Item = new CollectionFolder { Id = Guid.Parse(_id) };
        var pending = Body(await Call(controller, "Current", CancellationToken.None));
        Assert.Equal(["owned"], pending.GetProperty("affectedRuleIds").EnumerateArray().Select(item => item.GetString()));
        Assert.True((await ledger.ReadAsync()).Bindings["owned"].Tombstoned);
        var selected = new PtvHomeTransitionCompleteRequest { Bindings =
            [new PtvHomeTransitionBindingRequest { RuleId = "owned", LibraryId = _id }] };

        await Call(controller, "Complete", creation.OperationId, selected, CancellationToken.None);

        Assert.False((await ledger.ReadAsync()).Bindings["owned"].Tombstoned);
        Assert.Equal(_id, (await ledger.ReadAsync()).Bindings["owned"].CollectionFolderId);
        Assert.Equal("stage-held", refresh.Calls[^2]);
    }

    private sealed class TransitionRefresh(IPtvHomeTopologyLedger ledger) : IPtvFeaturedContentRefreshService
    {
        public List<string> Calls { get; } = [];
        public Action? OnStage { get; set; }
        public Task<bool> StageTransitionCandidatesAsync(string epoch, IReadOnlyDictionary<string, string> selected, CancellationToken token)
        {
            var state = ledger.ReadAsync(token).GetAwaiter().GetResult();
            Calls.Add(state.BroadHold ? "stage-held" : "stage-released");
            OnStage?.Invoke();
            return Task.FromResult(state.Epoch == epoch);
        }
        public Task<PtvFeaturedContentStoreStatus> RefreshAsync(CancellationToken token)
        {
            Calls.Add(ledger.ReadAsync(token).GetAwaiter().GetResult().BroadHold ? "refresh-held" : "refresh-released");
            return Task.FromResult(new PtvFeaturedContentStoreStatus());
        }
        public Task<PtvFeaturedContentStoreStatus> RefreshIfNeededAsync(CancellationToken token) => RefreshAsync(token);
        public Task<PtvRowPreviewResponse> PreviewRowsAsync(RowBuilderSettings? settings, CancellationToken token) => throw new NotSupportedException();
        public PtvFeaturedContentRefreshStatus GetRefreshStatus(PtvFeaturedContentStoreStatus? status = null) => new();
    }
    public void Dispose() { if (Directory.Exists(_directory)) Directory.Delete(_directory, true); }
    public class LibraryProxy : DispatchProxy
    {
        public List<VirtualFolderInfo> Folders = []; public BaseItem? Item; public Dictionary<Guid, BaseItem> Items = []; public List<string> Calls = [];
        public Folder Root = new() { Id = Guid.NewGuid(), Path = Path.Combine(Path.GetTempPath(), "ptv-views") };
        public List<BaseItem>? TopChildrenOverride;
        public int TopReadCount;
        public InternalItemsQuery? LastTopQuery;
        public List<bool?> VirtualFolderRequests = [];
        public bool ThrowOnTopRead;
        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            Calls.Add(method!.Name);
            if (method.Name == "GetVirtualFolders")
            {
                VirtualFolderRequests.Add(args is { Length: > 0 } && args[0] is bool refresh ? refresh : null);
                return Folders;
            }
            if (method.Name == "GetUserRootFolder") return Root;
            if (method.Name == "GetItemList")
            {
                if (ThrowOnTopRead) throw new IOException("user-root repository unavailable");
                TopReadCount++;
                LastTopQuery = Assert.IsType<InternalItemsQuery>(args![0]);
                return (IReadOnlyList<BaseItem>)(TopChildrenOverride ?? DerivedChildren());
            }
            if (method.Name == "GetItemById")
            {
                var id = args is { Length: > 0 } && args[0] is Guid value ? value : Guid.Empty;
                if (Items.TryGetValue(id, out var found)) return found;
                if (Item is not CollectionFolder) return Item;
                return (TopChildrenOverride ?? DerivedChildren()).FirstOrDefault(child => child.Id == id);
            }
            throw new InvalidOperationException("Unexpected library operation: " + method.Name);
        }
        private List<BaseItem> DerivedChildren() => Folders
            .Where(folder => Guid.TryParseExact(folder.ItemId, "N", out _))
            .Select(folder => (BaseItem)new CollectionFolder
            {
                Id = Guid.Parse(folder.ItemId!), Name = folder.Name,
                Path = Path.Combine(Root.Path!, folder.Name),
                CollectionType = Enum.TryParse<Jellyfin.Data.Enums.CollectionType>(folder.CollectionType?.ToString(), out var type)
                    ? type : null
            }).ToList();
    }
    private sealed class Authorization : IAuthorizationService
    {
        public bool Allow = true; public List<string> Policies = [];
        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource, IEnumerable<IAuthorizationRequirement> requirements) => Task.FromResult(Allow ? AuthorizationResult.Success() : AuthorizationResult.Failed());
        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource, string policyName) { Policies.Add(policyName); return Task.FromResult(Allow ? AuthorizationResult.Success() : AuthorizationResult.Failed()); }
    }
}
