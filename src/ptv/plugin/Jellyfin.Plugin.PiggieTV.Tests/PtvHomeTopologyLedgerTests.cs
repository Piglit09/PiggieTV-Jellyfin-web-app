using System.Reflection;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvHomeTopologyLedgerTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "ptv-ledger-" + Guid.NewGuid());
    private bool _marker;
    private bool _markerFails;
    private dynamic Ledger(string server = "server-a")
    {
        var type = typeof(Plugin).Assembly.GetType("Jellyfin.Plugin.PiggieTV.Services.PtvHomeTopologyLedger");
        Assert.NotNull(type);
        return Activator.CreateInstance(type!, BindingFlags.Instance | BindingFlags.NonPublic, null,
            new object[] { _directory, server, (Func<bool>)(() => _marker), (Action)(() => { if (_markerFails) throw new IOException("marker failed"); _marker = true; }) }, null)!;
    }
    private static dynamic Intent(Guid? id = null, string kind = "rename", string libraryId = "folder-a") => JsonSerializer.Deserialize(
        JsonSerializer.Serialize(new { OperationId = id ?? Guid.NewGuid(), Kind = kind, ServerId = "server-a", AffectedRuleIds = new[] { "anime" }, ExpectedLibraryAbsent = kind == "create", ExpectedLibrary = kind == "create" ? null : new { LibraryId = libraryId, CollectionType = "tvshows", Name = "Anime", Roots = new[] { "/anime", "/das/anime" }, Options = new { Enabled = true } }, IntendedLibrary = kind == "delete" ? null : new { LibraryId = kind == "create" ? "" : libraryId, CollectionType = "tvshows", Name = "Anime", Roots = new[] { "/anime", "/das/anime" }, Options = new { Enabled = true } } }),
        typeof(Plugin).Assembly.GetType("Jellyfin.Plugin.PiggieTV.Models.PtvHomeTransitionIntent")!)!;
    private static dynamic Evidence(dynamic snapshot, bool valid = true, object? library = null) => Activator.CreateInstance(
        typeof(Plugin).Assembly.GetType("Jellyfin.Plugin.PiggieTV.Models.PtvVerifiedTransitionReadback")!, BindingFlags.Instance | BindingFlags.NonPublic, null,
        new object?[] { snapshot.Epoch, valid ? library ?? snapshot.Operation.Intent.IntendedLibrary : null, null, valid, true, true }, null)!;

    [Theory]
    [InlineData("aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb", "AAAAAAAAAAAAAAAABBBBBBBBBBBBBBBB")]
    [InlineData("AaAaAaAaAaAaAaAaBbBbBbBbBbBbBbBb", "aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb")]
    [InlineData("AAAAAAAAAAAAAAAABBBBBBBBBBBBBBBB", "AaAaAaAaAaAaAaAaBbBbBbBbBbBbBbBb")]
    public async Task MixedCaseSameGuidRenameReadbackCannotCompleteOrRebind(string oldId, string readbackId)
    {
        Assert.True(Guid.TryParseExact(oldId, "N", out var oldGuid));
        Assert.Equal(oldGuid, Guid.ParseExact(readbackId, "N"));
        dynamic intent = Intent(libraryId: oldId);
        intent.IntendedLibrary.LibraryId = string.Empty;
        dynamic ledger = Ledger(); dynamic pending = await ledger.BeginAsync(intent, default(CancellationToken));
        var actual = new PtvHomeLibraryDefinition { LibraryId = readbackId, CollectionType = "tvshows", Name = "Anime",
            Roots = ["/anime", "/das/anime"], Options = JsonSerializer.SerializeToElement(new { Enabled = true }) };
        dynamic readback = Evidence(pending, library: actual);
        var selection = new Dictionary<string, string>(StringComparer.Ordinal) { ["anime"] = readbackId };

        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
            await ledger.CompleteAndRebindAsync(intent.OperationId, readback, selection,
                new Dictionary<string, string>(StringComparer.Ordinal), default(CancellationToken)));
        dynamic completed = await ledger.CompleteAsync(intent.OperationId, readback, default(CancellationToken));
        Assert.True((bool)completed.BroadHold);
        Assert.NotEqual("complete", (string)completed.Operation.State);
        Assert.True((bool)completed.Bindings["anime"].Tombstoned);
    }

    [Fact] public async Task ForgedSameIdRenameReadbackCannotReleaseHold()
    {
        var id = Guid.NewGuid().ToString("N");
        dynamic ledger = Ledger(); dynamic pending = await ledger.BeginAsync(Intent(libraryId: id), default(CancellationToken));
        dynamic result = await ledger.CompleteAsync(pending.Operation.Intent.OperationId,
            Evidence(pending), default(CancellationToken));

        Assert.True((bool)result.BroadHold);
        Assert.NotEqual("complete", (string)result.Operation.State);
        Assert.True((bool)(await Ledger().ReadAsync(default(CancellationToken))).Bindings["anime"].Tombstoned);
    }

    [Fact] public async Task ForgedSameIdRenameReadbackCannotCompleteAndRebind()
    {
        var id = Guid.NewGuid().ToString("N");
        dynamic ledger = Ledger(); dynamic pending = await ledger.BeginAsync(Intent(libraryId: id), default(CancellationToken));
        var selection = new Dictionary<string, string>(StringComparer.Ordinal) { ["anime"] = id };

        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
            await ledger.CompleteAndRebindAsync(pending.Operation.Intent.OperationId, Evidence(pending),
                selection, new Dictionary<string, string>(StringComparer.Ordinal), default(CancellationToken)));
        dynamic persisted = await Ledger().ReadAsync(default(CancellationToken));
        Assert.True((bool)persisted.BroadHold);
        Assert.True((bool)persisted.Bindings["anime"].Tombstoned);
    }

    [Fact] public async Task InitialScopedStartupNeedsFreshGeneration()
    {
        dynamic s = await Ledger().ReadAsync(default(CancellationToken));
        Assert.Equal(1L, (long)s.Sequence); Assert.Null((object?)s.Operation);
        Assert.True((bool)s.RequiresFreshGeneration); Assert.True((bool)s.GlobalRowsEligible); Assert.True(_marker);
        _marker = false; _markerFails = true;
        dynamic failed = await Ledger().ReadAsync(default(CancellationToken));
        Assert.True((bool)failed.BroadHold); Assert.True((bool)failed.RecoveryRequired);
    }
    [Fact] public async Task BeginIdempotentAndSingleFlight()
    {
        dynamic ledger = Ledger(); dynamic intent = Intent();
        dynamic first = await ledger.BeginAsync(intent, default(CancellationToken));
        dynamic again = await ledger.BeginAsync(intent, default(CancellationToken));
        Assert.Equal((string)first.Epoch, (string)again.Epoch);
        await Assert.ThrowsAsync<InvalidOperationException>(async () => { await ledger.BeginAsync(Intent(), default(CancellationToken)); });
        intent.ExpectedLibrary.Name = "Changed";
        await Assert.ThrowsAsync<InvalidOperationException>(async () => { await ledger.BeginAsync(intent, default(CancellationToken)); });
    }
    [Fact] public async Task BeginPersistenceFailureBlocksWrite()
    {
        Directory.CreateDirectory(_directory); File.WriteAllText(Path.Combine(_directory, "obstacle"), "x");
        dynamic ledger = Ledger(); await ledger.ReadAsync(default(CancellationToken));
        Directory.Move(_directory, _directory + "-saved"); File.WriteAllText(_directory, "obstacle");
        var wrote = false;
        await Assert.ThrowsAnyAsync<Exception>(async () => { await ledger.BeginAsync(Intent(), default(CancellationToken)); wrote = true; });
        Assert.False(wrote); File.Delete(_directory); Directory.Move(_directory + "-saved", _directory);
    }
    [Fact] public async Task DeleteBeginTombstonesBeforeWrite()
    {
        dynamic s = await Ledger().BeginAsync(Intent(kind: "delete"), default(CancellationToken));
        Assert.True((bool)s.BroadHold); Assert.True((bool)s.Bindings["anime"].Tombstoned); Assert.Equal(1L, (long)s.Bindings["anime"].Generation); Assert.True((bool)s.GlobalRowsEligible);
    }
    [Fact] public async Task PendingAndFailedHoldSurviveReload()
    {
        dynamic ledger = Ledger(); dynamic s = await ledger.BeginAsync(Intent(), default(CancellationToken));
        Assert.True((bool)(await Ledger().ReadAsync(default(CancellationToken))).BroadHold);
        dynamic failed = await ledger.CompleteAsync(s.Operation.Intent.OperationId, Evidence(s, false), default(CancellationToken));
        Assert.Equal("failed", (string)failed.Operation.State);
        dynamic loaded = await Ledger().ReadAsync(default(CancellationToken)); Assert.True((bool)loaded.BroadHold); Assert.True((bool)loaded.GlobalRowsEligible);
    }
    [Fact] public async Task CorruptOrMissingPriorLedgerFailsClosed()
    {
        await Ledger().ReadAsync(default(CancellationToken)); File.Delete(Path.Combine(_directory, "home-topology.json"));
        dynamic absent = await Ledger().ReadAsync(default(CancellationToken)); Assert.True((bool)absent.RecoveryRequired); Assert.True((bool)absent.BroadHold);
        File.WriteAllText(Path.Combine(_directory, "home-topology.json"), "{}");
        dynamic corrupt = await Ledger().ReadAsync(default(CancellationToken)); Assert.True((bool)corrupt.RecoveryRequired); Assert.True((bool)corrupt.GlobalRowsEligible);
    }
    [Fact] public async Task EpochMonotonicAndServerBound()
    {
        dynamic ledger = Ledger(); dynamic initial = await ledger.ReadAsync(default(CancellationToken)); dynamic begun = await ledger.BeginAsync(Intent(kind: "delete"), default(CancellationToken));
        Assert.True((long)begun.Sequence > (long)initial.Sequence); Assert.NotEqual((string)initial.Epoch, (string)begun.Epoch);
        dynamic completed = await ledger.CompleteAsync(begun.Operation.Intent.OperationId, Evidence(begun), default(CancellationToken));
        Assert.False((bool)completed.BroadHold); Assert.False((bool)completed.RequiresFreshGeneration);
        dynamic next = await ledger.BeginAsync(Intent(), default(CancellationToken)); Assert.True((long)next.Sequence > (long)begun.Sequence);
        Assert.True((bool)(await Ledger("server-b").ReadAsync(default(CancellationToken))).RecoveryRequired);
    }
    [Fact] public async Task TombstoneSurvivesRestart()
    {
        dynamic ledger = Ledger(); dynamic s = await ledger.BeginAsync(Intent(kind: "delete"), default(CancellationToken));
        await ledger.CompleteAsync(s.Operation.Intent.OperationId, Evidence(s), default(CancellationToken));
        dynamic next = await Ledger().BeginAsync(Intent(kind: "create"), default(CancellationToken));
        Assert.True((bool)next.Bindings["anime"].Tombstoned); Assert.Equal(2L, (long)next.Bindings["anime"].Generation);
    }
    [Fact] public async Task InitialGenerationCannotReleaseActiveOperationOrTombstone()
    {
        dynamic ledger = Ledger(); dynamic initial = await ledger.ReadAsync(default(CancellationToken));
        dynamic fresh = Activator.CreateInstance(typeof(Plugin).Assembly.GetType("Jellyfin.Plugin.PiggieTV.Models.PtvVerifiedTransitionReadback")!,
            BindingFlags.Instance | BindingFlags.NonPublic, null, new object?[] { initial.Epoch, null, null, true, true, true }, null)!;
        dynamic initialized = await ledger.CompleteAsync(Guid.Empty, fresh, default(CancellationToken));
        Assert.False((bool)initialized.RequiresFreshGeneration);
        dynamic pending = await ledger.BeginAsync(Intent(kind: "delete"), default(CancellationToken));
        await Assert.ThrowsAsync<InvalidOperationException>(async () => { await ledger.CompleteAsync(Guid.Empty, fresh, default(CancellationToken)); });
        dynamic failed = await ledger.CompleteAsync(pending.Operation.Intent.OperationId, Evidence(pending, false), default(CancellationToken));
        await Assert.ThrowsAsync<InvalidOperationException>(async () => { await ledger.CompleteAsync(Guid.Empty, fresh, default(CancellationToken)); });
        dynamic final = await Ledger().ReadAsync(default(CancellationToken));
        Assert.True((bool)final.BroadHold); Assert.True((bool)final.Bindings["anime"].Tombstoned);
    }
    [Fact] public async Task MismatchedDefinitionAndStaleGenerationRemainHeld()
    {
        dynamic ledger = Ledger(); dynamic pending = await ledger.BeginAsync(Intent(), default(CancellationToken));
        pending.Operation.Intent.IntendedLibrary.Name = "Unexpected";
        dynamic failed = await ledger.CompleteAsync(pending.Operation.Intent.OperationId, Evidence(pending), default(CancellationToken));
        Assert.True((bool)failed.BroadHold);
        failed.Epoch = "old-generation";
        dynamic stale = await ledger.CompleteAsync(failed.Operation.Intent.OperationId, Evidence(failed), default(CancellationToken));
        Assert.True((bool)stale.BroadHold);
    }
    public void Dispose() { if (Directory.Exists(_directory)) Directory.Delete(_directory, true); }
}
