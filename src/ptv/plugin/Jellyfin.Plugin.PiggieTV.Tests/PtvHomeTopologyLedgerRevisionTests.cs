using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

[Collection("Configured row association serial")]
public sealed class PtvHomeTopologyLedgerRevisionTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "ptv-ledger-revision-" + Guid.NewGuid());
    private bool _marker;
    private PtvHomeTopologyLedger Ledger() => new(_directory, "server-a", () => _marker, () => _marker = true);
    private string FilePath => Path.Combine(_directory, "home-topology.json");
    private static PtvHomeLibraryDefinition Library(string name = "Anime", string id = "folder-a", string root = "/anime", bool enabled = true) => new()
    {
        LibraryId = id, Name = name, CollectionType = "tvshows", Roots = [root], Options = JsonSerializer.SerializeToElement(new { Enabled = enabled })
    };
    private static PtvHomeAccessDefinition Access(bool all) => new() { UserId = "user-a", EnableAllFolders = all, EnabledFolders = all ? [] : ["folder-a"] };
    private static PtvHomeTransitionIntent Intent(string kind, PtvHomeLibraryDefinition? before, PtvHomeLibraryDefinition? after) =>
        JsonSerializer.Deserialize<PtvHomeTransitionIntent>(JsonSerializer.Serialize(new
        {
            OperationId = Guid.NewGuid(), Kind = kind, ServerId = "server-a", AffectedRuleIds = new[] { "anime" },
            ExpectedLibrary = before, IntendedLibrary = after, ExpectedLibraryAbsent = kind == "create",
            ExpectedAccess = kind == "userAccess" ? Access(true) : null, IntendedAccess = kind == "userAccess" ? Access(false) : null
        }))!;
    private static PtvVerifiedTransitionReadback Evidence(PtvHomeTopologySnapshot pending, PtvHomeLibraryDefinition? library, PtvHomeAccessDefinition? access = null,
        bool unique = true, bool absent = true) => new(pending.Epoch, library, access, unique, absent, true);

    [Fact] public async Task BeginPersistsUnaffectedExactBindingWithAffectedTombstoneAtomically()
    {
        var intended = Intent("rename", Library(), Library("Renamed", ""));
        var unaffectedId = Guid.NewGuid().ToString("N");
        var observed = new Dictionary<string, string> { ["anime"] = Guid.NewGuid().ToString("N"), ["music"] = unaffectedId };
        dynamic ledger = Ledger();
        dynamic begun = await ledger.BeginAsync(intended, observed, CancellationToken.None);
        Assert.True((bool)begun.BroadHold);
        Assert.True((bool)begun.Bindings["anime"].Tombstoned);
        Assert.Equal(unaffectedId, (string)begun.Bindings["music"].CollectionFolderId);
        Assert.False((bool)begun.Bindings["music"].Tombstoned);
        var restarted = await Ledger().ReadAsync();
        Assert.Equal(unaffectedId, restarted.Bindings["music"].GetType().GetProperty("CollectionFolderId")?.GetValue(restarted.Bindings["music"]));
        Assert.True(restarted.Bindings["anime"].Tombstoned);
    }

    [Fact] public async Task ExplicitNewIdRebindRotatesEpochAndGenerationAfterTombstonedCompletion()
    {
        var libraryId = Guid.NewGuid().ToString("N");
        var before = Library(id: libraryId);
        var intended = Library("Renamed", "");
        var ledger = Ledger();
        var begun = await ledger.BeginAsync(Intent("rename", before, intended));
        Assert.True(begun.Bindings["anime"].Tombstoned);
        var newId = Guid.NewGuid().ToString("N");
        var verified = Library("Renamed", newId);
        var complete = await ledger.CompleteAsync(begun.Operation!.Intent.OperationId, Evidence(begun, verified));
        Assert.True(complete.Bindings["anime"].Tombstoned);
        var oldEpoch = complete.Epoch;
        var oldGeneration = complete.Bindings["anime"].Generation;
        dynamic rebound = await ((dynamic)ledger).RebindAsync(begun.Operation.Intent.OperationId,
            new Dictionary<string, string> { ["anime"] = newId }, CancellationToken.None);
        Assert.NotEqual(oldEpoch, (string)rebound.Epoch);
        Assert.True((long)rebound.Bindings["anime"].Generation > oldGeneration);
        Assert.False((bool)rebound.Bindings["anime"].Tombstoned);
        Assert.Equal(newId, (string)rebound.Bindings["anime"].CollectionFolderId);
        var restarted = await Ledger().ReadAsync();
        Assert.False(restarted.RecoveryRequired);
        Assert.Equal(newId, restarted.Bindings["anime"].GetType().GetProperty("CollectionFolderId")?.GetValue(restarted.Bindings["anime"]));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task InitializedMarkerSurvivesSettingsResetAndReplacementBeforeMissingLedgerRestart(bool resetSettings)
    {
        var previous = Plugin.Instance;
        Directory.CreateDirectory(_directory);
        var paths = DispatchProxy.Create<IApplicationPaths, InfrastructureProxy>();
        ((InfrastructureProxy)(object)paths).Directory = _directory;
        var xml = DispatchProxy.Create<IXmlSerializer, InfrastructureProxy>();
        try
        {
            var plugin = new Plugin(paths, xml);
            var ledger = new PtvHomeTopologyLedger(_directory, "server-a", () => plugin.Configuration.HomeTopologyLedgerInitialized,
                () => { plugin.Configuration.HomeTopologyLedgerInitialized = true; plugin.SaveConfiguration(); });
            await ledger.ReadAsync();
            if (resetSettings) new PtvPluginSettingsService(NullLogger<PtvPluginSettingsService>.Instance).ResetSettings();
            else plugin.UpdateConfiguration(new PluginConfiguration());
            File.Delete(FilePath);
            var restarted = new Plugin(paths, xml);
            var reloaded = new PtvHomeTopologyLedger(_directory, "server-a", () => restarted.Configuration.HomeTopologyLedgerInitialized,
                () => { restarted.Configuration.HomeTopologyLedgerInitialized = true; restarted.SaveConfiguration(); });
            var state = await reloaded.ReadAsync();
            Assert.True(state.RecoveryRequired); Assert.True(state.BroadHold); Assert.True(state.GlobalRowsEligible);
        }
        finally { typeof(Plugin).GetField("<Instance>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic)!.SetValue(null, previous); }
    }

    [Theory]
    [InlineData("Bindings")]
    [InlineData("CompletedOperationIds")]
    public async Task OmittedDurableCollectionsFailClosed(string field)
    {
        await Ledger().BeginAsync(Intent("delete", Library(), null));
        var document = JsonNode.Parse(File.ReadAllText(FilePath))!.AsObject();
        document.Remove(field); File.WriteAllText(FilePath, document.ToJsonString());
        var state = await Ledger().ReadAsync();
        Assert.True(state.RecoveryRequired); Assert.True(state.BroadHold);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task AffectedBindingMissingOrNotTombstonedFailsClosed(bool remove)
    {
        await Ledger().BeginAsync(Intent("delete", Library(), null));
        var document = JsonNode.Parse(File.ReadAllText(FilePath))!.AsObject();
        if (remove) document["Bindings"]!.AsObject().Remove("anime");
        else document["Bindings"]!["anime"]!["Tombstoned"] = false;
        File.WriteAllText(FilePath, document.ToJsonString());
        var state = await Ledger().ReadAsync(); Assert.True(state.RecoveryRequired); Assert.True(state.BroadHold);
    }

    [Fact] public async Task TruncatedCompletedHistoryFailsClosed()
    {
        var beforeId = Guid.NewGuid().ToString("N");
        var ledger = Ledger(); var pending = await ledger.BeginAsync(Intent("rename", Library(id: beforeId), Library(id: "")));
        var completed = await ledger.CompleteAsync(pending.Operation!.Intent.OperationId,
            Evidence(pending, Library(id: Guid.NewGuid().ToString("N"))));
        Assert.False(completed.BroadHold);
        var document = JsonNode.Parse(File.ReadAllText(FilePath))!.AsObject();
        document["CompletedOperationIds"] = new JsonArray();
        File.WriteAllText(FilePath, document.ToJsonString());
        var state = await Ledger().ReadAsync(); Assert.True(state.RecoveryRequired); Assert.True(state.BroadHold);
    }

    [Fact] public async Task CreateFromAbsenceAcceptsUniqueServerAssignedIdWithoutRebinding()
    {
        var ledger = Ledger();
        var pending = await ledger.BeginAsync(Intent("create", null, Library(id: "")));
        var completed = await ledger.CompleteAsync(pending.Operation!.Intent.OperationId, Evidence(pending, Library(id: "new-folder")));
        Assert.False(completed.BroadHold); Assert.True(completed.Bindings["anime"].Tombstoned);
    }
    [Theory]
    [InlineData("roots")]
    [InlineData("rename")]
    [InlineData("definition")]
    [InlineData("delete")]
    public async Task ZeroRootPreStatePersistsExactExistingDefinition(string kind)
    {
        var before = Library(); before.Roots = [];
        var pending = await Ledger().BeginAsync(Intent(kind, before, kind == "delete" ? null : Library()));
        var reloaded = await Ledger().ReadAsync();
        Assert.False(reloaded.RecoveryRequired); Assert.True(reloaded.BroadHold);
        Assert.Equal(pending.Epoch, reloaded.Epoch);
        Assert.Empty(reloaded.Operation!.Intent.ExpectedLibrary!.Roots);
        Assert.True(reloaded.Bindings["anime"].Tombstoned);
    }
    [Fact] public async Task LastRootRemovalPersistsZeroRootIntendedPostState()
    {
        var after = Library(); after.Roots = [];
        await Ledger().BeginAsync(Intent("roots", Library(), after));
        var reloaded = await Ledger().ReadAsync();
        Assert.False(reloaded.RecoveryRequired); Assert.True(reloaded.BroadHold);
        Assert.Empty(reloaded.Operation!.Intent.IntendedLibrary!.Roots);
    }
    [Fact] public async Task ZeroRootAuthoritativeCompletionReadbackReleasesOnlyBroadHold()
    {
        var ledger = Ledger(); var after = Library(); after.Roots = [];
        var pending = await ledger.BeginAsync(Intent("roots", Library(), after));
        var actual = Library(); actual.Roots = [];
        var completed = await ledger.CompleteAsync(pending.Operation!.Intent.OperationId, Evidence(pending, actual));
        Assert.False(completed.BroadHold); Assert.Equal("complete", completed.Operation!.State);
        Assert.True(completed.Bindings["anime"].Tombstoned);
        Assert.False((await Ledger().ReadAsync()).BroadHold);
    }
    [Fact] public async Task CreateStillRejectsZeroRoots()
    {
        var after = Library(id: ""); after.Roots = [];
        await Assert.ThrowsAsync<InvalidOperationException>(() => Ledger().BeginAsync(Intent("create", null, after)));
        Assert.False(File.Exists(FilePath));
    }
    [Theory]
    [InlineData("null-roots")]
    [InlineData("blank-root")]
    [InlineData("blank-type")]
    [InlineData("blank-name")]
    [InlineData("blank-id")]
    [InlineData("invalid-options")]
    public async Task ExistingDefinitionStillRejectsInvalidFields(string fault)
    {
        var before = Library();
        if (fault == "null-roots") before.Roots = null!;
        if (fault == "blank-root") before.Roots = [" "];
        if (fault == "blank-type") before.CollectionType = " ";
        if (fault == "blank-name") before.Name = " ";
        if (fault == "blank-id") before.LibraryId = " ";
        if (fault == "invalid-options") before.Options = JsonSerializer.SerializeToElement(new[] { "invalid" });
        await Assert.ThrowsAsync<InvalidOperationException>(() => Ledger().BeginAsync(Intent("delete", before, null)));
    }
    [Theory]
    [InlineData("rename")]
    [InlineData("roots")]
    [InlineData("definition")]
    public async Task ChangedLibraryCompletesAgainstIntendedPostState(string kind)
    {
        var ledger = Ledger();
        var after = kind == "rename" ? Library("Renamed", "") : kind == "roots" ? Library(root: "/new-root") : Library(enabled: false);
        var pending = await ledger.BeginAsync(Intent(kind, Library(), after));
        if (kind == "rename") after.LibraryId = "new-folder";
        var completed = await ledger.CompleteAsync(pending.Operation!.Intent.OperationId, Evidence(pending, after));
        Assert.False(completed.BroadHold); Assert.True(completed.Bindings["anime"].Tombstoned);
    }
    [Fact] public async Task DeleteCompletesOnlyWithVerifiedAbsence()
    {
        var ledger = Ledger(); var pending = await ledger.BeginAsync(Intent("delete", Library(), null));
        var completed = await ledger.CompleteAsync(pending.Operation!.Intent.OperationId, Evidence(pending, null));
        Assert.False(completed.BroadHold); Assert.True(completed.Bindings["anime"].Tombstoned);
    }
    [Fact] public async Task UserAccessCompletesAgainstIntendedPolicy()
    {
        var ledger = Ledger(); var pending = await ledger.BeginAsync(Intent("userAccess", null, null));
        var completed = await ledger.CompleteAsync(pending.Operation!.Intent.OperationId, Evidence(pending, null, Access(false)));
        Assert.False(completed.BroadHold);
    }
    [Theory]
    [InlineData("old-state")]
    [InlineData("empty-id")]
    [InlineData("wrong-name")]
    [InlineData("wrong-type")]
    [InlineData("wrong-roots")]
    [InlineData("wrong-options")]
    [InlineData("ambiguous")]
    [InlineData("old-present")]
    public async Task RenameRejectsIncompleteOrUnexpectedPostWriteEvidence(string fault)
    {
        var ledger = Ledger(); var pending = await ledger.BeginAsync(Intent("rename", Library(), Library("Renamed", "")));
        var actual = Library("Renamed", "new-folder");
        if (fault == "old-state") actual = Library();
        if (fault == "empty-id") actual.LibraryId = "";
        if (fault == "wrong-name") actual.Name = "Other";
        if (fault == "wrong-type") actual.CollectionType = "movies";
        if (fault == "wrong-roots") actual.Roots = ["/other"];
        if (fault == "wrong-options") actual.Options = JsonSerializer.SerializeToElement(new { Enabled = false });
        var failed = await ledger.CompleteAsync(pending.Operation!.Intent.OperationId,
            Evidence(pending, actual, unique: fault != "ambiguous", absent: fault != "old-present"));
        Assert.True(failed.BroadHold); Assert.Equal("failed", failed.Operation!.State); Assert.True(failed.Bindings["anime"].Tombstoned);
        Assert.True((await Ledger().ReadAsync()).BroadHold);
    }
    [Fact] public async Task DeleteRejectsOldDefinitionStillPresent()
    {
        var ledger = Ledger(); var pending = await ledger.BeginAsync(Intent("delete", Library(), null));
        var failed = await ledger.CompleteAsync(pending.Operation!.Intent.OperationId, Evidence(pending, Library(), absent: false));
        Assert.True(failed.BroadHold);
    }
    [Fact] public async Task UserAccessRejectsOldPolicy()
    {
        var ledger = Ledger(); var pending = await ledger.BeginAsync(Intent("userAccess", null, null));
        var failed = await ledger.CompleteAsync(pending.Operation!.Intent.OperationId, Evidence(pending, null, Access(true)));
        Assert.True(failed.BroadHold);
    }
    [Fact] public async Task IdempotencyIncludesIntendedPostState()
    {
        var ledger = Ledger(); var intent = Intent("rename", Library(), Library("Renamed", ""));
        await ledger.BeginAsync(intent);
        intent.IntendedLibrary!.Name = "Another";
        await Assert.ThrowsAsync<InvalidOperationException>(() => ledger.BeginAsync(intent));
    }
    public void Dispose() { if (Directory.Exists(_directory)) Directory.Delete(_directory, true); }

    public class InfrastructureProxy : DispatchProxy
    {
        public string Directory { get; set; } = string.Empty;
        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method?.Name == "SerializeToFile") { File.WriteAllText((string)args![1]!, JsonSerializer.Serialize((PluginConfiguration)args[0]!)); return null; }
            if (method?.Name == "DeserializeFromFile") return JsonSerializer.Deserialize<PluginConfiguration>(File.ReadAllText((string)args![1]!));
            if (method?.Name.StartsWith("get_", StringComparison.Ordinal) == true && method.ReturnType == typeof(string)) return Directory;
            throw new NotSupportedException(method?.Name);
        }
    }
}
