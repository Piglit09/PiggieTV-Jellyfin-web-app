using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Atomic transition ledger under the persistent Plugin configuration root.</summary>
public sealed class PtvHomeTopologyLedger : IPtvHomeTopologyLedger
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _directory;
    private readonly string _serverId;
    private readonly Func<bool> _initialized;
    private readonly Action _persistMarker;
    private bool _failed;
    private string FilePath => Path.Combine(_directory, "home-topology.json");

    internal PtvHomeTopologyLedger(string directory, string serverId, Func<bool> initialized, Action persistMarker)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(serverId);
        _directory = Path.GetFullPath(directory); _serverId = serverId;
        _initialized = initialized; _persistMarker = persistMarker;
    }

    public async Task<PtvHomeTopologySnapshot> ReadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try { return await LoadAsync(cancellationToken).ConfigureAwait(false); }
        finally { _gate.Release(); }
    }

    public Task<PtvHomeTopologySnapshot> BeginAsync(PtvHomeTransitionIntent intent, CancellationToken cancellationToken = default)
        => BeginAsync(intent, new Dictionary<string, string>(StringComparer.Ordinal), cancellationToken);

    /// <summary>Begins with Plugin-observed pre-write rule bindings, never HTTP-supplied bindings.</summary>
    public Task<PtvHomeTopologySnapshot> BeginAsync(PtvHomeTransitionIntent intent,
        IReadOnlyDictionary<string, string> observedBindings, CancellationToken cancellationToken = default)
        => BeginAsync(intent, observedBindings, new Dictionary<string, string>(StringComparer.Ordinal), cancellationToken);

    /// <summary>Persists observed saved scopes in the same hold transaction.</summary>
    public async Task<PtvHomeTopologySnapshot> BeginAsync(PtvHomeTransitionIntent intent,
        IReadOnlyDictionary<string, string> observedBindings, IReadOnlyDictionary<string, string> observedScopeFingerprints,
        CancellationToken cancellationToken = default)
    {
        // Snapshot caller-owned objects before awaiting the persistence gate.
        intent = JsonSerializer.Deserialize<PtvHomeTransitionIntent>(JsonSerializer.Serialize(intent))!;
        ValidateIntent(intent);
        ArgumentNullException.ThrowIfNull(observedBindings);
        ArgumentNullException.ThrowIfNull(observedScopeFingerprints);
        var observed = new Dictionary<string, string>(observedBindings, StringComparer.Ordinal);
        var scopes = new Dictionary<string, string>(observedScopeFingerprints, StringComparer.Ordinal);
        if (observed.Any(pair => string.IsNullOrWhiteSpace(pair.Key)
            || !Guid.TryParseExact(pair.Value, "N", out var id) || id == Guid.Empty))
            throw new InvalidOperationException("Invalid Plugin-observed library bindings.");
        if (scopes.Any(pair => string.IsNullOrWhiteSpace(pair.Key) || pair.Value.Length != 64
            || !pair.Value.All(char.IsAsciiHexDigit)))
            throw new InvalidOperationException("Invalid Plugin-observed saved scopes.");
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var state = await LoadAsync(cancellationToken).ConfigureAwait(false);
            if (state.RecoveryRequired) throw new InvalidOperationException("Topology ledger requires administrator recovery.");
            var fingerprint = Fingerprint(intent);
            if (state.Operation?.Intent.OperationId == intent.OperationId)
            {
                if (state.Operation.Fingerprint != fingerprint) throw new InvalidOperationException("Operation ID has different intent.");
                return state;
            }
            if (state.BroadHold || state.CompletedOperationIds.Contains(intent.OperationId))
                throw new InvalidOperationException("Another operation is held or this operation ID is retired.");
            state.Sequence = checked(state.Sequence + 1);
            state.Epoch = NewEpoch(state.Sequence);
            state.BroadHold = true; state.RequiresFreshGeneration = true;
            state.Operation = new() { Intent = intent, Fingerprint = fingerprint };
            if (!state.BindingAuthorityRequired)
            {
                // Seed only the first verified pre-write snapshot. Future settings writes
                // cannot create durable authority for a fresh or repointed rule ID.
                foreach (var (ruleId, libraryId) in observed)
                {
                    if (!intent.AffectedRuleIds.Contains(ruleId, StringComparer.Ordinal))
                        state.Bindings.Add(ruleId, new() { Generation = 1, CollectionFolderId = libraryId,
                            OriginalScopeFingerprint = scopes.GetValueOrDefault(ruleId) });
                }
            }
            state.BindingAuthorityRequired = true;
            foreach (var ruleId in intent.AffectedRuleIds)
            {
                if (!state.Bindings.TryGetValue(ruleId, out var binding)) state.Bindings[ruleId] = binding = new();
                binding.Generation = checked(binding.Generation + 1);
                binding.OriginalScopeFingerprint = scopes.GetValueOrDefault(ruleId);
                // Every affected binding requires explicit administrator rebinding in the later binding owner.
                binding.Tombstoned = true;
            }
            await PersistAsync(state, cancellationToken).ConfigureAwait(false);
            return state;
        }
        finally { _gate.Release(); }
    }

    public async Task<PtvHomeTopologySnapshot> CompleteAsync(Guid operationId, PtvVerifiedTransitionReadback readback, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(readback);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var state = await LoadAsync(cancellationToken).ConfigureAwait(false);
            if (state.RecoveryRequired || (state.Operation?.Intent.OperationId ?? Guid.Empty) != operationId)
                throw new InvalidOperationException("Operation is not the current topology authority.");
            var valid = ValidReadback(state, readback);
            if (state.Operation is { } operation)
            {
                // A delayed failed completion must not downgrade a previously completed operation.
                if (operation.State == "complete") return state;
                operation.State = valid ? "complete" : "failed";
                if (valid) operation.VerifiedLibraryId = readback.Library?.LibraryId ?? string.Empty;
                if (valid) state.CompletedOperationIds.Add(operationId);
            }
            state.BroadHold = !valid; state.RequiresFreshGeneration = !valid;
            await PersistAsync(state, cancellationToken).ConfigureAwait(false);
            return state;
        }
        finally { _gate.Release(); }
    }

    /// <summary>Completes the held transition and selected rebinding in one durable state replacement.</summary>
    public async Task<PtvHomeTopologySnapshot> CompleteAndRebindAsync(Guid operationId,
        PtvVerifiedTransitionReadback readback, IReadOnlyDictionary<string, string> verifiedBindings,
        IReadOnlyDictionary<string, string> observedScopeFingerprints, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(readback);
        ArgumentNullException.ThrowIfNull(verifiedBindings);
        ArgumentNullException.ThrowIfNull(observedScopeFingerprints);
        var selected = new Dictionary<string, string>(verifiedBindings, StringComparer.Ordinal);
        var scopes = new Dictionary<string, string>(observedScopeFingerprints, StringComparer.Ordinal);
        if (selected.Count == 0 || selected.Count != verifiedBindings.Count
            || selected.Any(pair => string.IsNullOrWhiteSpace(pair.Key)
                || !Guid.TryParseExact(pair.Value, "N", out var id) || id == Guid.Empty)
            || scopes.Any(pair => !selected.ContainsKey(pair.Key) || pair.Value.Length != 64
                || !pair.Value.All(char.IsAsciiHexDigit)))
            throw new InvalidOperationException("Explicit verified current bindings required.");
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var state = await LoadAsync(cancellationToken).ConfigureAwait(false);
            var operation = state.Operation;
            if (state.RecoveryRequired || !state.BroadHold || !state.RequiresFreshGeneration
                || operation?.Intent.OperationId != operationId || operation.State == "complete"
                || operation.Intent.Kind is "delete" or "userAccess"
                || !ValidReadback(state, readback)
                || readback.Library?.LibraryId is not { } verifiedId
                || !Guid.TryParseExact(verifiedId, "N", out var currentId) || currentId == Guid.Empty
                || selected.Values.Any(id => id != verifiedId))
                throw new InvalidOperationException("The held operation lacks exact current rebinding proof.");
            operation.State = "complete";
            operation.VerifiedLibraryId = verifiedId;
            state.CompletedOperationIds.Add(operationId);
            state.BroadHold = false;
            state.RequiresFreshGeneration = false;
            state.Sequence = checked(state.Sequence + 1);
            state.RebindCount = checked(state.RebindCount + 1);
            state.Epoch = NewEpoch(state.Sequence);
            foreach (var (ruleId, libraryId) in selected)
            {
                if (!state.Bindings.TryGetValue(ruleId, out var binding)) state.Bindings[ruleId] = binding = new();
                binding.Generation = checked(binding.Generation + 1);
                binding.Tombstoned = false;
                binding.CollectionFolderId = libraryId;
                binding.ReboundOperationId = operationId;
                binding.OriginalScopeFingerprint = scopes.GetValueOrDefault(ruleId) ?? binding.OriginalScopeFingerprint;
            }
            await PersistAsync(state, cancellationToken).ConfigureAwait(false);
            return state;
        }
        finally { _gate.Release(); }
    }

    private static bool ValidReadback(PtvHomeTopologySnapshot state, PtvVerifiedTransitionReadback readback)
    {
        if (!readback.UniqueCurrentEvidence || !readback.TrustedScopeGeneration
            || readback.FreshGenerationEpoch != state.Epoch) return false;
        // The initial generation has no operation yet; preserve its independent
        // trusted-refresh completion path without granting a transition binding.
        if (state.Operation is not { } operation) return true;
        return operation.Intent.Kind switch
        {
            "userAccess" => readback.Library is null && readback.Access is not null
                && Canonical(readback.Access) == Canonical(operation.Intent.IntendedAccess),
            "delete" => readback.Access is null && readback.Library is null && readback.OldDefinitionAbsent,
            "rename" => readback.Access is null && readback.OldDefinitionAbsent
                && readback.Library is { } renamed
                && operation.Intent.ExpectedLibrary is { } previous
                && HasDifferentLibraryId(previous.LibraryId, renamed.LibraryId)
                && MatchesIntendedLibrary(operation.Intent.IntendedLibrary!, renamed),
            _ => readback.Access is null && readback.OldDefinitionAbsent
                && MatchesIntendedLibrary(operation.Intent.IntendedLibrary!, readback.Library)
        };
    }

    private static bool HasDifferentLibraryId(string previousId, string currentId)
    {
        if (string.IsNullOrWhiteSpace(previousId) || string.IsNullOrWhiteSpace(currentId)) return false;
        // Compare the CollectionFolder identity as a value: casing or GUID formatting
        // cannot turn the previous folder into evidence of a new incarnation.
        if (Guid.TryParse(previousId, out var previous) && Guid.TryParse(currentId, out var current))
            return previous != current;
        return !string.Equals(previousId, currentId, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Persists an administrator-selected, Plugin-verified current binding.</summary>
    public Task<PtvHomeTopologySnapshot> RebindAsync(Guid operationId,
        IReadOnlyDictionary<string, string> verifiedBindings, CancellationToken cancellationToken = default)
        => RebindAsync(operationId, verifiedBindings, new Dictionary<string, string>(StringComparer.Ordinal), cancellationToken);

    /// <summary>Also persists the selected rule's current saved scope for later repoint rejection.</summary>
    public async Task<PtvHomeTopologySnapshot> RebindAsync(Guid operationId,
        IReadOnlyDictionary<string, string> verifiedBindings, IReadOnlyDictionary<string, string> observedScopeFingerprints,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(verifiedBindings);
        ArgumentNullException.ThrowIfNull(observedScopeFingerprints);
        if (verifiedBindings.Count == 0 || verifiedBindings.Any(pair => string.IsNullOrWhiteSpace(pair.Key)
            || !Guid.TryParseExact(pair.Value, "N", out var id) || id == Guid.Empty))
            throw new InvalidOperationException("Explicit current library binding required.");
        var selected = new Dictionary<string, string>(verifiedBindings, StringComparer.Ordinal);
        var scopes = new Dictionary<string, string>(observedScopeFingerprints, StringComparer.Ordinal);
        if (selected.Count != verifiedBindings.Count) throw new InvalidOperationException("Duplicate rule selection.");
        if (scopes.Any(pair => !selected.ContainsKey(pair.Key) || pair.Value.Length != 64
            || !pair.Value.All(char.IsAsciiHexDigit)))
            throw new InvalidOperationException("Invalid Plugin-observed selected scopes.");
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var state = await LoadAsync(cancellationToken).ConfigureAwait(false);
            var operation = state.Operation;
            if (state.RecoveryRequired || state.BroadHold || state.RequiresFreshGeneration || operation?.State != "complete"
                || operation.Intent.OperationId != operationId || operation.Intent.Kind is "delete" or "userAccess"
                || string.IsNullOrEmpty(operation.VerifiedLibraryId)
                || selected.Values.Any(id => id != operation.VerifiedLibraryId))
                throw new InvalidOperationException("This operation has no verified current library binding.");
            if (selected.All(pair => state.Bindings.TryGetValue(pair.Key, out var existing)
                && !existing.Tombstoned && existing.CollectionFolderId == pair.Value
                && existing.ReboundOperationId == operationId)) return state;
            if (selected.Any(pair => state.Bindings.TryGetValue(pair.Key, out var existing)
                && existing.ReboundOperationId == operationId))
                throw new InvalidOperationException("Partial rebind replay is not allowed.");
            state.Sequence = checked(state.Sequence + 1);
            state.RebindCount = checked(state.RebindCount + 1);
            state.Epoch = NewEpoch(state.Sequence);
            foreach (var (ruleId, libraryId) in selected)
            {
                if (!state.Bindings.TryGetValue(ruleId, out var binding)) state.Bindings[ruleId] = binding = new();
                binding.Generation = checked(binding.Generation + 1);
                binding.Tombstoned = false;
                binding.CollectionFolderId = libraryId;
                binding.ReboundOperationId = operationId;
                binding.OriginalScopeFingerprint = scopes.GetValueOrDefault(ruleId) ?? binding.OriginalScopeFingerprint;
            }
            await PersistAsync(state, cancellationToken).ConfigureAwait(false);
            return state;
        }
        finally { _gate.Release(); }
    }

    private async Task<PtvHomeTopologySnapshot> LoadAsync(CancellationToken token)
    {
        if (_failed) return Recovery();
        try
        {
            PtvHomeTopologySnapshot state;
            if (File.Exists(FilePath))
            {
                state = JsonSerializer.Deserialize<PtvHomeTopologySnapshot>(await File.ReadAllTextAsync(FilePath, token).ConfigureAwait(false))!;
                Validate(state);
            }
            else
            {
                if (_initialized()) return Recovery();
                state = new() { SchemaVersion = 1, ServerId = _serverId, Sequence = 1, Epoch = NewEpoch(1) };
                await PersistAsync(state, token).ConfigureAwait(false);
            }
            if (!_initialized()) _persistMarker();
            if (!_initialized()) throw new IOException("Initialization marker was not persisted.");
            return state;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or ArgumentException)
        { _failed = true; return Recovery(); }
    }

    private PtvHomeTopologySnapshot Recovery() => new() { ServerId = _serverId, BroadHold = true, RecoveryRequired = true };
    private string NewEpoch(long sequence) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{_serverId}\n{sequence}\n{Guid.NewGuid():N}")));
    private static string Fingerprint(PtvHomeTransitionIntent intent) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Canonical(intent))));
    private static string Canonical(object? value)
    {
        var element = JsonSerializer.SerializeToElement(value);
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream)) WriteCanonical(writer, element);
        return Encoding.UTF8.GetString(stream.ToArray());
    }
    private static void WriteCanonical(Utf8JsonWriter writer, JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            writer.WriteStartObject();
            foreach (var property in value.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
            { writer.WritePropertyName(property.Name); WriteCanonical(writer, property.Value); }
            writer.WriteEndObject();
        }
        else if (value.ValueKind == JsonValueKind.Array)
        { writer.WriteStartArray(); foreach (var item in value.EnumerateArray()) WriteCanonical(writer, item); writer.WriteEndArray(); }
        else value.WriteTo(writer);
    }
    private void ValidateIntent(PtvHomeTransitionIntent intent)
    {
        if (intent is null || intent.OperationId == Guid.Empty || intent.ServerId != _serverId
            || intent.Kind is not ("create" or "rename" or "delete" or "roots" or "definition" or "userAccess")
            || intent.AffectedRuleIds is null || intent.AffectedRuleIds.Any(string.IsNullOrWhiteSpace)
            || intent.AffectedRuleIds.Distinct(StringComparer.Ordinal).Count() != intent.AffectedRuleIds.Length)
            throw new InvalidOperationException("Invalid topology intent.");
        if (intent.Kind == "userAccess")
        {
            if (intent.ExpectedLibrary is not null || intent.IntendedLibrary is not null || intent.ExpectedLibraryAbsent
                || !ValidAccess(intent.ExpectedAccess) || !ValidAccess(intent.IntendedAccess)
                || intent.ExpectedAccess!.UserId != intent.IntendedAccess!.UserId)
                throw new InvalidOperationException("Exact pre-write and intended policy for the same user required.");
            return;
        }
        if (intent.ExpectedAccess is not null || intent.IntendedAccess is not null)
            throw new InvalidOperationException("Library operations cannot carry access policy.");
        if (intent.Kind == "create")
        {
            if (!intent.ExpectedLibraryAbsent || intent.ExpectedLibrary is not null
                || !ValidLibrary(intent.IntendedLibrary, allowUnassignedId: true)
                || intent.IntendedLibrary!.Roots.Length == 0
                || !string.IsNullOrEmpty(intent.IntendedLibrary!.LibraryId))
                throw new InvalidOperationException("Create requires expected absence and a definition awaiting a server-assigned ID.");
            return;
        }
        if (intent.ExpectedLibraryAbsent || !ValidLibrary(intent.ExpectedLibrary))
            throw new InvalidOperationException("Exact pre-write library definition required.");
        if (intent.Kind == "delete")
        {
            if (intent.IntendedLibrary is not null) throw new InvalidOperationException("Delete requires intended absence.");
            return;
        }
        if (!ValidLibrary(intent.IntendedLibrary, allowUnassignedId: intent.Kind == "rename"))
            throw new InvalidOperationException("Exact intended post-write library definition required.");
    }
    private static bool ValidAccess(PtvHomeAccessDefinition? access) => access is not null
        && !string.IsNullOrWhiteSpace(access.UserId) && access.EnabledFolders is not null
        && !access.EnabledFolders.Any(string.IsNullOrWhiteSpace);

    private static bool ValidLibrary(PtvHomeLibraryDefinition? library, bool allowUnassignedId = false) => library is not null
        && (!string.IsNullOrWhiteSpace(library.LibraryId) || (allowUnassignedId && string.IsNullOrEmpty(library.LibraryId)))
        && !string.IsNullOrWhiteSpace(library.CollectionType) && !string.IsNullOrWhiteSpace(library.Name)
        && library.Roots is not null && !library.Roots.Any(string.IsNullOrWhiteSpace)
        && library.Roots.Distinct(StringComparer.Ordinal).Count() == library.Roots.Length
        && library.Options.ValueKind == JsonValueKind.Object;

    private static bool MatchesIntendedLibrary(PtvHomeLibraryDefinition intended, PtvHomeLibraryDefinition? actual)
    {
        // A unique server readback may supply a previously unknown create/rename ID. This
        // correlation releases only the broad hold; it never adopts that ID as a rule binding.
        if (!ValidLibrary(actual)) return false;
        if (!string.IsNullOrEmpty(intended.LibraryId) && intended.LibraryId != actual!.LibraryId) return false;
        return intended.CollectionType == actual!.CollectionType && intended.Name == actual.Name
            && intended.Roots.OrderBy(root => root, StringComparer.Ordinal)
                .SequenceEqual(actual.Roots.OrderBy(root => root, StringComparer.Ordinal), StringComparer.Ordinal)
            && Canonical(intended.Options) == Canonical(actual.Options);
    }
    private void Validate(PtvHomeTopologySnapshot state)
    {
        if (state is null || state.SchemaVersion != 1 || state.ServerId != _serverId || state.Sequence < 1
            || state.Epoch?.Length != 64 || !state.Epoch.All(char.IsAsciiHexDigit) || state.RecoveryRequired
            || state.Bindings is null || state.CompletedOperationIds is null
            || state.RebindCount < 0 || (state.Sequence > 1 && !state.BindingAuthorityRequired)
            || state.Bindings.Any(p => string.IsNullOrWhiteSpace(p.Key) || p.Value is null || p.Value.Generation < 1
                || p.Value.Generation >= state.Sequence || p.Value.CollectionFolderId is null
                || (p.Value.OriginalScopeFingerprint is { } fingerprint
                    && (fingerprint.Length != 64 || !fingerprint.All(char.IsAsciiHexDigit)))
                || (!p.Value.Tombstoned && state.BindingAuthorityRequired
                    && (!Guid.TryParseExact(p.Value.CollectionFolderId, "N", out var id) || id == Guid.Empty)))
            || state.CompletedOperationIds.Any(id => id == Guid.Empty)
            || state.CompletedOperationIds.Distinct().Count() != state.CompletedOperationIds.Count
            || (state.BroadHold && !state.RequiresFreshGeneration)) throw new InvalidOperationException("Invalid topology ledger.");
        if (state.Operation is { } op)
        {
            ValidateIntent(op.Intent);
            if (op.Fingerprint != Fingerprint(op.Intent) || op.State is not ("pending" or "failed" or "complete")
                || (op.State != "complete" && !state.BroadHold) || (op.State == "complete" && (state.BroadHold || state.RequiresFreshGeneration))
                || op.Intent.AffectedRuleIds.Any(rule => !state.Bindings.TryGetValue(rule, out var binding)
                    || (!binding.Tombstoned && binding.ReboundOperationId != op.Intent.OperationId))
                || (op.State == "complete" && op.Intent.Kind is not ("delete" or "userAccess") && string.IsNullOrWhiteSpace(op.VerifiedLibraryId))
                || state.CompletedOperationIds.Contains(op.Intent.OperationId) != (op.State == "complete")
                || state.CompletedOperationIds.Count + state.RebindCount != state.Sequence - (op.State == "complete" ? 1 : 2))
                throw new InvalidOperationException("Inconsistent topology operation.");
        }
        else if (state.Sequence != 1 || state.Bindings.Count != 0 || state.CompletedOperationIds.Count != 0 || state.RebindCount != 0)
            throw new InvalidOperationException("Missing topology operation history.");
    }
    private async Task PersistAsync(PtvHomeTopologySnapshot state, CancellationToken token)
    {
        var temporary = Path.Combine(_directory, $".home-topology-{Guid.NewGuid():N}.tmp");
        try
        {
            Validate(state); Directory.CreateDirectory(_directory);
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, state, cancellationToken: token).ConfigureAwait(false);
                await stream.FlushAsync(token).ConfigureAwait(false);
            }
            Validate(JsonSerializer.Deserialize<PtvHomeTopologySnapshot>(await File.ReadAllTextAsync(temporary, token).ConfigureAwait(false))!);
            if (!File.Exists(FilePath)) File.Move(temporary, FilePath);
            else
            {
                try { File.Replace(temporary, FilePath, null, true); }
                catch (PlatformNotSupportedException) { File.Move(temporary, FilePath, true); }
                catch (IOException) { File.Move(temporary, FilePath, true); }
            }
        }
        catch
        {
            _failed = true;
            try { if (File.Exists(temporary)) File.Delete(temporary); } catch { /* Preserve original failure. */ }
            throw;
        }
    }
}
