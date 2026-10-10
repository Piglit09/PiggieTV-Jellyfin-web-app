using System.Security.Cryptography;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Atomic per-user policy authority. An absent record never authorizes owned Home.</summary>
public sealed class PtvHomeUserAccessLedger : IPtvHomeUserAccessLedger
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _directory;
    private readonly string _serverId;
    private bool _failed;
    private string FilePath => Path.Combine(_directory, "home-user-access.json");

    internal PtvHomeUserAccessLedger(string directory, string serverId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(serverId);
        _directory = Path.GetFullPath(directory);
        _serverId = serverId;
    }

    public async Task<PtvHomeUserAccessView> ReadAsync(Guid userId, PtvHomeAccessDefinition? currentAccess,
        string? topologyEpoch, CancellationToken cancellationToken = default,
        IReadOnlyCollection<string>? currentAccessibleLibraryIds = null)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await LoadAsync(cancellationToken).ConfigureAwait(false);
            return View(userId, document?.Records.GetValueOrDefault(userId.ToString("N")), currentAccess,
                topologyEpoch, document is null, TryNormalizeLibraries(currentAccessibleLibraryIds));
        }
        finally { _gate.Release(); }
    }

    public async Task<PtvHomeUserAccessView> BeginAsync(PtvHomeUserAccessIntent intent,
        PtvHomeAccessDefinition currentAccess, string topologyEpoch, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(intent);
        if (intent.OperationId == Guid.Empty || !Guid.TryParseExact(intent.UserId, "N", out var userId)
            || userId == Guid.Empty || !ValidEpoch(topologyEpoch)
            || intent.Mode is not ("existing" or "bootstrap" or "preserve" or "reproof"))
            throw new InvalidOperationException("Invalid user-access intent.");
        var actual = Normalize(currentAccess);
        var expected = intent.ExpectedAccess is null ? null : Normalize(intent.ExpectedAccess);
        var intended = Normalize(intent.IntendedAccess);
        if (actual.UserId != userId.ToString("N") || intended.UserId != actual.UserId
            || (expected is null) != (intent.Mode == "bootstrap")
            || (expected is not null && (expected.UserId != actual.UserId || !Same(expected, actual))))
            throw new InvalidOperationException("Expected current user policy changed.");
        if (intent.Mode == "preserve" && !Same(expected, intended))
            throw new InvalidOperationException("Preserve mode cannot change user access.");
        if (intent.Mode == "reproof" && !Same(expected, intended))
            throw new InvalidOperationException("Explicit reproof requires the exact current user policy.");

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await LoadAsync(cancellationToken).ConfigureAwait(false)
                ?? throw new InvalidOperationException("User access authority requires administrator recovery.");
            var key = userId.ToString("N");
            if (document.Records.Values.Any(record => record.OperationId == intent.OperationId && record.UserId != key))
                throw new InvalidOperationException("Operation ID already belongs to another user.");
            if (document.Records.TryGetValue(key, out var prior) && prior.OperationId == intent.OperationId)
            {
                if (prior.Mode != intent.Mode || !Same(prior.ExpectedAccess, expected)
                    || !Same(prior.IntendedAccess, intended)
                    || prior.SupersededOperationId != intent.SupersedesOperationId)
                    throw new InvalidOperationException("Operation replay changed its intent.");
                return View(userId, prior, actual, topologyEpoch) with { WriteAllowed = false };
            }
            if (intent.Mode == "bootstrap" && (!document.ControlledCreatedUserIds.Contains(key) || prior is not null))
                throw new InvalidOperationException("Bootstrap requires a newly controlled-created user with no prior access operation.");
            if (intent.Mode == "preserve" && (prior is not { State: "policy-attested", AttestedAccess: not null }
                || !Same(actual, prior.AttestedAccess)))
                throw new InvalidOperationException("A prior exact attested user policy is required to preserve access.");
            var attestedPrior = prior is { State: "policy-attested", AttestedAccess: not null };
            var lateUnknown = prior is null && document.LegacyEligibleUserIds is { } cohort
                && !cohort.Contains(key, StringComparer.Ordinal) && !document.MigrationRecoveryRestricted;
            if (intent.Mode == "reproof" && (!attestedPrior
                && !document.MigrationRecoveryRestricted
                && !document.ControlledCreatedUserIds.Contains(key) && !lateUnknown
                || (actual.EnableAllFolders || actual.IsAdministrator) && !attestedPrior))
                throw new InvalidOperationException("Explicit reproof requires prior attestation or restrictive recovery provenance.");
            var heldPrior = prior is { State: "pending" or "failed" };
            // An already-applied stock write may have failed Complete solely because
            // topology changed. Its same-access recovery is allowed only when it
            // supersedes the exact held intent; unknown IDs cannot self-attest.
            if (intent.Mode == "existing" && Same(expected, intended)
                && (!heldPrior || intent.SupersedesOperationId != prior!.OperationId
                    || !Same(intended, prior.IntendedAccess)))
                throw new InvalidOperationException("No-access-change policy writes require proven preserve mode or exact held recovery.");
            if (heldPrior && (intent.SupersedesOperationId != prior!.OperationId
                || intent.Mode is not ("existing" or "reproof") || expected is null))
                throw new InvalidOperationException("A held user-access operation requires administrator recovery.");
            if (!heldPrior && intent.SupersedesOperationId is not null)
                throw new InvalidOperationException("There is no held operation to supersede.");
            if (heldPrior && prior!.RecoveryHistory.Length >= 1000)
                throw new InvalidOperationException("User-access recovery history requires administrator review.");
            // Unknown IDs have no implicit authority. Persisting this state is the first
            // post-create bootstrap step; existing-user writes must wait for this return.
            var record = new PtvHomeUserAccessRecord
            {
                UserId = key,
                AccessEpoch = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)),
                TopologyEpoch = topologyEpoch,
                State = "pending",
                Mode = intent.Mode,
                OperationId = intent.OperationId,
                SupersededOperationId = heldPrior ? prior!.OperationId : null,
                RecoveryHistory = heldPrior ? [.. prior!.RecoveryHistory,
                    new PtvHomeUserAccessRecoveryEntry
                    {
                        OperationId = prior.OperationId, State = prior.State, Mode = prior.Mode,
                        ExpectedAccess = prior.ExpectedAccess, IntendedAccess = prior.IntendedAccess
                    }] : [],
                ExpectedAccess = expected,
                IntendedAccess = intended,
                AttestedPredecessor = intent.Mode == "reproof" && attestedPrior ? new PtvHomeUserAttestedPredecessor
                {
                    OperationId = prior!.OperationId,
                    AccessEpoch = prior.AccessEpoch,
                    TopologyEpoch = prior.TopologyEpoch,
                    AttestedAccess = prior.AttestedAccess!,
                    IntendedAccess = prior.IntendedAccess!
                } : null
            };
            document.Records[key] = record;
            await PersistAsync(document, cancellationToken).ConfigureAwait(false);
            return View(userId, record, actual, topologyEpoch) with { WriteAllowed = true };
        }
        finally { _gate.Release(); }
    }

    public async Task<PtvHomeUserAccessView> CompleteAsync(Guid operationId,
        PtvHomeAccessDefinition? currentAccess, string? topologyEpoch, CancellationToken cancellationToken = default,
        IReadOnlyCollection<string>? currentAccessibleLibraryIds = null)
    {
        if (operationId == Guid.Empty) throw new InvalidOperationException("Operation ID required.");
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await LoadAsync(cancellationToken).ConfigureAwait(false)
                ?? throw new InvalidOperationException("User access authority requires administrator recovery.");
            var matches = document.Records.Values.Where(record => record.OperationId == operationId).ToArray();
            if (matches.Length != 1) throw new InvalidOperationException("No current user-access operation matches this ID.");
            var record = matches[0];
            if (!Guid.TryParseExact(record.UserId, "N", out var userId))
                throw new InvalidOperationException("Invalid persisted user ID.");
            var actual = currentAccess is null ? null : Normalize(currentAccess);
            var libraries = TryNormalizeLibraries(currentAccessibleLibraryIds);
            var valid = actual is not null && Same(actual, record.IntendedAccess)
                && topologyEpoch == record.TopologyEpoch && ValidEpoch(topologyEpoch)
                && libraries is not null;
            if (record.State == "policy-attested") return View(userId, record, actual, topologyEpoch,
                currentLibraries: libraries);
            record.State = valid ? "policy-attested" : "failed";
            record.AttestedAccess = valid ? actual : null;
            record.AccessibleLibraryIds = valid ? libraries! : [];
            await PersistAsync(document, cancellationToken).ConfigureAwait(false);
            return View(userId, record, actual, topologyEpoch, currentLibraries: libraries);
        }
        finally { _gate.Release(); }
    }

    public async Task<Guid?> GetOperationUserAsync(Guid operationId,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await LoadAsync(cancellationToken).ConfigureAwait(false);
            var record = document?.Records.Values.SingleOrDefault(candidate => candidate.OperationId == operationId);
            return record is not null && Guid.TryParseExact(record.UserId, "N", out var id) ? id : null;
        }
        finally { _gate.Release(); }
    }

    public async Task<PtvHomeUserVerificationBatch> BeginVerificationBatchAsync(
        IReadOnlyCollection<Guid> candidateIds, string topologyEpoch, CancellationToken cancellationToken = default,
        bool replace = false)
    {
        ArgumentNullException.ThrowIfNull(candidateIds);
        if (!ValidEpoch(topologyEpoch)) throw new InvalidOperationException("Current topology epoch required.");
        var snapshot = NormalizeUserIds(candidateIds);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await LoadAsync(cancellationToken).ConfigureAwait(false)
                ?? throw new InvalidOperationException("User access authority requires administrator recovery.");
            if (document.CreationReservations.Count != 0)
                throw new InvalidOperationException("Controlled account creation is unresolved; migration verification is held.");
            if (document.LegacyEligibleUserIds is null)
                document.LegacyEligibleUserIds = snapshot
                    .Where(id => !document.ControlledCreatedUserIds.Contains(id)).ToArray();
            if (!replace && document.Batch is { } current && current.TopologyEpoch == topologyEpoch)
                return current;
            var batch = new PtvHomeUserVerificationBatch
            {
                Id = Guid.NewGuid(), TopologyEpoch = topologyEpoch,
                CandidateUserIds = document.LegacyEligibleUserIds
            };
            document.Batch = batch;
            await PersistAsync(document, cancellationToken).ConfigureAwait(false);
            return batch;
        }
        finally { _gate.Release(); }
    }

    public async Task<PtvHomeUserVerificationBatch?> ReadVerificationBatchAsync(
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try { return (await LoadAsync(cancellationToken).ConfigureAwait(false))?.Batch; }
        finally { _gate.Release(); }
    }

    public async Task<PtvHomeUserAccessView> VerifyBatchCandidateAsync(Guid batchId, Guid userId,
        PtvHomeAccessDefinition currentAccess, PtvHomeAccessDefinition intendedAccess,
        IReadOnlyCollection<string> accessibleLibraryIds,
        string topologyEpoch, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(accessibleLibraryIds);
        var actual = Normalize(currentAccess);
        var intended = Normalize(intendedAccess);
        var libraries = NormalizeLibraries(accessibleLibraryIds);
        if (batchId == Guid.Empty || userId == Guid.Empty || actual.UserId != userId.ToString("N")
            || !ValidEpoch(topologyEpoch) || !Same(actual, intended))
            throw new InvalidOperationException("Current user verification evidence is incomplete.");
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await LoadAsync(cancellationToken).ConfigureAwait(false)
                ?? throw new InvalidOperationException("User access authority requires administrator recovery.");
            var batch = document.Batch;
            if (document.CreationReservations.Count != 0)
                throw new InvalidOperationException("Controlled account creation is unresolved; migration verification is held.");
            if (batch?.Id != batchId || batch.TopologyEpoch != topologyEpoch
                || !batch.CandidateUserIds.Contains(actual.UserId, StringComparer.Ordinal)
                || document.ControlledCreatedUserIds.Contains(actual.UserId))
                throw new InvalidOperationException("User was not in the administrator's fixed verification cohort.");
            if (document.Records.TryGetValue(actual.UserId, out var prior)
                && (prior.State is "pending" or "failed" || prior.Mode != "verification"))
                throw new InvalidOperationException("Controlled user authority cannot be replaced by migration verification.");
            var record = new PtvHomeUserAccessRecord
            {
                UserId = actual.UserId,
                AccessEpoch = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)),
                TopologyEpoch = topologyEpoch,
                State = "policy-attested",
                Mode = "verification",
                OperationId = Guid.NewGuid(),
                IntendedAccess = intended,
                AttestedAccess = actual,
                AccessibleLibraryIds = libraries
            };
            document.Records[actual.UserId] = record;
            await PersistAsync(document, cancellationToken).ConfigureAwait(false);
            return View(userId, record, actual, topologyEpoch, currentLibraries: libraries);
        }
        finally { _gate.Release(); }
    }

    public async Task<PtvHomeUserCreationView> ReserveCreationAsync(Guid creationOperationId,
        IReadOnlyCollection<Guid> baselineUserIds, CancellationToken cancellationToken = default)
    {
        if (creationOperationId == Guid.Empty) throw new InvalidOperationException("Creation operation ID required.");
        var baseline = NormalizeUserIds(baselineUserIds);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await LoadAsync(cancellationToken).ConfigureAwait(false)
                ?? throw new InvalidOperationException("User access authority requires administrator recovery.");
            if (document.CreationBindings.TryGetValue(creationOperationId, out var bound))
                return BoundCreation(creationOperationId, bound);
            if (document.CreationRecoveries.ContainsKey(creationOperationId))
                throw new InvalidOperationException("Creation operation was already recovered.");
            if (!document.CreationReservations.ContainsKey(creationOperationId))
            {
                if (document.CreationReservations.Count >= 128)
                    throw new InvalidOperationException("Controlled creation reservation bound exceeded.");
                document.CreationReservations[creationOperationId] = new PtvHomeUserCreationReservation
                {
                    OperationId = creationOperationId, BaselineUserIds = baseline
                };
                await PersistAsync(document, cancellationToken).ConfigureAwait(false);
            }
            return ReservedCreation(creationOperationId);
        }
        finally { _gate.Release(); }
    }

    public async Task<PtvHomeUserCreationView> BindCreationAsync(Guid creationOperationId, Guid userId,
        CancellationToken cancellationToken = default)
    {
        if (creationOperationId == Guid.Empty || userId == Guid.Empty)
            throw new InvalidOperationException("Created user identity required.");
        var userKey = userId.ToString("N");
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await LoadAsync(cancellationToken).ConfigureAwait(false)
                ?? throw new InvalidOperationException("User access authority requires administrator recovery.");
            if (document.CreationBindings.TryGetValue(creationOperationId, out var bound))
            {
                if (bound != userKey) throw new InvalidOperationException("Creation replay changed its user ID.");
                return BoundCreation(creationOperationId, userKey);
            }
            if (!document.CreationReservations.TryGetValue(creationOperationId, out var reservation)
                || reservation.BaselineUserIds.Contains(userKey, StringComparer.Ordinal)
                || document.ControlledCreatedUserIds.Contains(userKey))
                throw new InvalidOperationException("Created user cannot be bound to this reservation.");
            document.ControlledCreatedUserIds.Add(userKey);
            document.CreationBindings[creationOperationId] = userKey;
            document.CreationReservations.Remove(creationOperationId);
            await PersistAsync(document, cancellationToken).ConfigureAwait(false);
            return BoundCreation(creationOperationId, userKey);
        }
        finally { _gate.Release(); }
    }

    public async Task<PtvHomeUserCreationRecovery> RecoverCreationAsync(Guid creationOperationId,
        IReadOnlyCollection<Guid> currentUserIds, CancellationToken cancellationToken = default)
    {
        if (creationOperationId == Guid.Empty) throw new InvalidOperationException("Creation operation ID required.");
        var current = NormalizeUserIds(currentUserIds);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await LoadAsync(cancellationToken).ConfigureAwait(false)
                ?? throw new InvalidOperationException("User access authority requires administrator recovery.");
            if (document.CreationRecoveries.TryGetValue(creationOperationId, out var replay))
                return new PtvHomeUserCreationRecovery { CreationOperationId = creationOperationId, MarkedUserIds = replay };
            if (!document.CreationReservations.TryGetValue(creationOperationId, out var reservation))
                throw new InvalidOperationException("No unresolved controlled creation matches this ID.");
            var newIds = current.Except(reservation.BaselineUserIds, StringComparer.Ordinal)
                .Order(StringComparer.Ordinal).ToArray();
            foreach (var id in newIds) document.ControlledCreatedUserIds.Add(id);
            document.CreationRecoveries[creationOperationId] = newIds;
            document.CreationReservations.Remove(creationOperationId);
            await PersistAsync(document, cancellationToken).ConfigureAwait(false);
            return new PtvHomeUserCreationRecovery { CreationOperationId = creationOperationId, MarkedUserIds = newIds };
        }
        finally { _gate.Release(); }
    }

    public async Task<IReadOnlyList<PtvHomeUserPendingCreation>> ReadPendingCreationsAsync(
        IReadOnlyCollection<Guid> currentUserIds, CancellationToken cancellationToken = default)
    {
        var current = NormalizeUserIds(currentUserIds);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await LoadAsync(cancellationToken).ConfigureAwait(false)
                ?? throw new InvalidOperationException("User access authority requires administrator recovery.");
            return document.CreationReservations.Values
                .OrderBy(reservation => reservation.OperationId)
                .Select(reservation => new PtvHomeUserPendingCreation
                {
                    CreationOperationId = reservation.OperationId,
                    CandidateNewUserIds = current.Except(reservation.BaselineUserIds, StringComparer.Ordinal)
                        .Order(StringComparer.Ordinal).ToArray()
                }).ToArray();
        }
        finally { _gate.Release(); }
    }

    private static PtvHomeUserCreationView ReservedCreation(Guid id) => new()
    { CreationOperationId = id, State = "reserved", MigrationVerificationHeld = true };

    private static PtvHomeUserCreationView BoundCreation(Guid id, string userId) => new()
    { CreationOperationId = id, State = "bound", UserId = userId, BootstrapRequired = true };

    public async Task RecoverCorruptAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (!_failed && await LoadAsync(cancellationToken).ConfigureAwait(false) is not null)
                throw new InvalidOperationException("The current user-access ledger is valid; recovery is not needed.");
            // Lost provenance cannot be reconstructed from Jellyfin's current user list.
            // Freeze legacy enrollment empty and require explicit controlled reproof.
            var empty = new PtvHomeUserAccessDocument
            {
                ServerId = _serverId,
                LegacyEligibleUserIds = [],
                MigrationRecoveryRestricted = true
            };
            var temporary = Path.Combine(_directory, $".home-user-access-recovery-{Guid.NewGuid():N}.tmp");
            Directory.CreateDirectory(_directory);
            try
            {
                await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write,
                    FileShare.None, 81920, FileOptions.Asynchronous | FileOptions.WriteThrough))
                {
                    await JsonSerializer.SerializeAsync(stream, empty, cancellationToken: cancellationToken).ConfigureAwait(false);
                    await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                }
                if (File.Exists(FilePath))
                {
                    var quarantine = Path.Combine(_directory, $"home-user-access.corrupt-{Guid.NewGuid():N}.json");
                    File.Move(FilePath, quarantine);
                }
                File.Move(temporary, FilePath);
                _failed = false;
            }
            finally
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
        }
        finally { _gate.Release(); }
    }

    public async Task<bool> RequiresRecoveryAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try { return await LoadAsync(cancellationToken).ConfigureAwait(false) is null; }
        finally { _gate.Release(); }
    }

    public async Task<PtvHomeUserMigrationState?> ReadMigrationStateAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await LoadAsync(cancellationToken).ConfigureAwait(false);
            return document is null ? null : new PtvHomeUserMigrationState
            {
                Started = document.LegacyEligibleUserIds is not null,
                RecoveryRestricted = document.MigrationRecoveryRestricted,
                EligibleUserIds = document.LegacyEligibleUserIds?.ToArray() ?? []
            };
        }
        finally { _gate.Release(); }
    }

    public async Task<bool> IsControlledCreatedAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        if (userId == Guid.Empty) return false;
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await LoadAsync(cancellationToken).ConfigureAwait(false);
            return document?.ControlledCreatedUserIds.Contains(userId.ToString("N")) == true;
        }
        finally { _gate.Release(); }
    }

    public async Task<bool> IsLateUnverifiedAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        if (userId == Guid.Empty) return false;
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await LoadAsync(cancellationToken).ConfigureAwait(false);
            var key = userId.ToString("N");
            return document is { MigrationRecoveryRestricted: false, LegacyEligibleUserIds: not null }
                && !document.LegacyEligibleUserIds.Contains(key, StringComparer.Ordinal)
                && !document.ControlledCreatedUserIds.Contains(key)
                && !document.Records.ContainsKey(key);
        }
        finally { _gate.Release(); }
    }

    private PtvHomeUserAccessView View(Guid userId, PtvHomeUserAccessRecord? record,
        PtvHomeAccessDefinition? current, string? topologyEpoch, bool recovery = false,
        string[]? currentLibraries = null)
    {
        var actual = TryNormalize(current);
        var proven = !recovery && record is { State: "policy-attested", AttestedAccess: not null }
            && topologyEpoch == record.TopologyEpoch && ValidEpoch(topologyEpoch)
            && actual is not null && Same(actual, record.AttestedAccess)
            && currentLibraries is not null
            && record.AccessibleLibraryIds.SequenceEqual(currentLibraries, StringComparer.Ordinal);
        return new PtvHomeUserAccessView
        {
            UserId = userId.ToString("N"),
            AccessEpoch = record?.AccessEpoch,
            Held = !proven,
            PolicyProven = proven,
            State = recovery ? "recovery-required" : record?.State ?? "unproven",
            OperationId = record?.OperationId,
            SupersededOperationId = record?.SupersededOperationId,
            ExpectedAccess = record?.ExpectedAccess,
            IntendedAccess = record?.IntendedAccess,
            AttestedAccess = proven ? record!.AttestedAccess : null,
            AccessibleLibraryIds = proven ? record!.AccessibleLibraryIds : []
        };
    }

    private static PtvHomeAccessDefinition? TryNormalize(PtvHomeAccessDefinition? access)
    {
        try { return access is null ? null : Normalize(access); }
        catch (InvalidOperationException) { return null; }
    }

    private static PtvHomeAccessDefinition Normalize(PtvHomeAccessDefinition? access)
    {
        if (access is null || !Guid.TryParseExact(access.UserId, "N", out var userId)
            || userId == Guid.Empty || access.EnabledFolders is null)
            throw new InvalidOperationException("Exact user policy required.");
        var ids = new List<string>();
        foreach (var folder in access.EnabledFolders)
        {
            if (!Guid.TryParseExact(folder, "N", out var id) || id == Guid.Empty)
                throw new InvalidOperationException("Invalid user library selection.");
            ids.Add(id.ToString("N"));
        }
        if (ids.Distinct(StringComparer.Ordinal).Count() != ids.Count)
            throw new InvalidOperationException("Duplicate user library selection.");
        ids.Sort(StringComparer.Ordinal);
        return new PtvHomeAccessDefinition
        {
            UserId = userId.ToString("N"),
            EnableAllFolders = access.EnableAllFolders,
            EnabledFolders = ids.ToArray(),
            IsAdministrator = access.IsAdministrator,
            IsDisabled = access.IsDisabled
        };
    }

    private static bool Same(PtvHomeAccessDefinition? left, PtvHomeAccessDefinition? right) =>
        left is null ? right is null : right is not null
            && left.UserId == right.UserId && left.EnableAllFolders == right.EnableAllFolders
            && left.IsAdministrator == right.IsAdministrator && left.IsDisabled == right.IsDisabled
            && left.EnabledFolders.SequenceEqual(right.EnabledFolders, StringComparer.Ordinal);

    private static bool ValidEpoch(string? epoch) => epoch is { Length: 64 } && epoch.All(char.IsAsciiHexDigit);

    private static string[] NormalizeLibraries(IReadOnlyCollection<string> ids)
    {
        if (ids.Count > 128) throw new InvalidOperationException("Accessible library readback exceeds its bound.");
        var normalized = new List<string>();
        foreach (var raw in ids)
        {
            if (!Guid.TryParseExact(raw, "N", out var id) || id == Guid.Empty)
                throw new InvalidOperationException("Invalid accessible library readback.");
            normalized.Add(id.ToString("N"));
        }
        if (normalized.Distinct(StringComparer.Ordinal).Count() != normalized.Count)
            throw new InvalidOperationException("Ambiguous accessible library readback.");
        normalized.Sort(StringComparer.Ordinal);
        return normalized.ToArray();
    }

    private static string[]? TryNormalizeLibraries(IReadOnlyCollection<string>? ids)
    {
        try { return ids is null ? null : NormalizeLibraries(ids); }
        catch (InvalidOperationException) { return null; }
    }

    private static string[] NormalizeUserIds(IReadOnlyCollection<Guid> ids)
    {
        ArgumentNullException.ThrowIfNull(ids);
        if (ids.Count > 1000 || ids.Any(id => id == Guid.Empty)
            || ids.Distinct().Count() != ids.Count)
            throw new InvalidOperationException("A bounded exact user snapshot is required.");
        return ids.Select(id => id.ToString("N")).Order(StringComparer.Ordinal).ToArray();
    }

    private async Task<PtvHomeUserAccessDocument?> LoadAsync(CancellationToken cancellationToken)
    {
        if (_failed) return null;
        if (!File.Exists(FilePath)) return new PtvHomeUserAccessDocument { ServerId = _serverId };
        try
        {
            var document = JsonSerializer.Deserialize<PtvHomeUserAccessDocument>(
                await File.ReadAllTextAsync(FilePath, cancellationToken).ConfigureAwait(false));
            Validate(document);
            return document;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException)
        {
            _failed = true;
            return null;
        }
    }

    private void Validate(PtvHomeUserAccessDocument? document)
    {
        if (document is null || document.SchemaVersion != 1 || document.ServerId != _serverId
            || document.Records is null || document.ControlledCreatedUserIds is null
            || document.CreationReservations is null || document.CreationBindings is null
            || document.CreationRecoveries is null
            || document.ControlledCreatedUserIds.Any(id => !Guid.TryParseExact(id, "N", out var created) || created == Guid.Empty)
            || document.CreationReservations.Count > 128
            || document.CreationReservations.Any(pair => pair.Key == Guid.Empty || pair.Value is null
                || pair.Value.OperationId != pair.Key || pair.Value.BaselineUserIds is null
                || pair.Value.BaselineUserIds.Length > 1000
                || pair.Value.BaselineUserIds.Distinct(StringComparer.Ordinal).Count() != pair.Value.BaselineUserIds.Length
                || pair.Value.BaselineUserIds.Any(id => !Guid.TryParseExact(id, "N", out var parsed) || parsed == Guid.Empty))
            || document.CreationBindings.Any(pair => pair.Key == Guid.Empty
                || !Guid.TryParseExact(pair.Value, "N", out var bound) || bound == Guid.Empty
                || !document.ControlledCreatedUserIds.Contains(pair.Value))
            || document.CreationRecoveries.Any(pair => pair.Key == Guid.Empty || pair.Value is null
                || pair.Value.Any(id => !Guid.TryParseExact(id, "N", out var recovered) || recovered == Guid.Empty
                    || !document.ControlledCreatedUserIds.Contains(id)))
            || (document.LegacyEligibleUserIds is not null
                && (document.LegacyEligibleUserIds.Length > 1000
                    || document.LegacyEligibleUserIds.Distinct(StringComparer.Ordinal).Count() != document.LegacyEligibleUserIds.Length
                    || document.LegacyEligibleUserIds.Any(id => !Guid.TryParseExact(id, "N", out var eligible) || eligible == Guid.Empty)))
            || (document.MigrationRecoveryRestricted && document.LegacyEligibleUserIds is not { Length: 0 })
            || document.Records.Any(pair =>
                pair.Value is null || !Guid.TryParseExact(pair.Key, "N", out var id) || id == Guid.Empty
                || pair.Key != pair.Value.UserId || !ValidEpoch(pair.Value.AccessEpoch)
                || !ValidEpoch(pair.Value.TopologyEpoch) || pair.Value.OperationId == Guid.Empty
                || pair.Value.State is not ("pending" or "failed" or "policy-attested")
                || pair.Value.Mode is not ("existing" or "bootstrap" or "verification" or "preserve" or "reproof")
                || (pair.Value.SupersededOperationId is not null && pair.Value.SupersededOperationId == pair.Value.OperationId)
                || pair.Value.RecoveryHistory is null || pair.Value.RecoveryHistory.Length > 1000
                || pair.Value.RecoveryHistory.Any(entry => entry.OperationId == Guid.Empty
                    || entry.State is not ("pending" or "failed")
                    || entry.Mode is not ("existing" or "bootstrap" or "preserve" or "reproof")
                    || TryNormalize(entry.IntendedAccess)?.UserId != pair.Key)
                || TryNormalize(pair.Value.IntendedAccess)?.UserId != pair.Key
                || (pair.Value.ExpectedAccess is null) != (pair.Value.Mode is "bootstrap" or "verification")
                || (pair.Value.ExpectedAccess is not null && TryNormalize(pair.Value.ExpectedAccess)?.UserId != pair.Key)
                || (pair.Value.Mode == "reproof" && (!Same(TryNormalize(pair.Value.ExpectedAccess), TryNormalize(pair.Value.IntendedAccess))
                    || (pair.Value.IntendedAccess?.EnableAllFolders == true || pair.Value.IntendedAccess?.IsAdministrator == true)
                        && pair.Value.AttestedPredecessor is null))
                || (pair.Value.AttestedPredecessor is { } predecessor
                    && (pair.Value.Mode != "reproof" || predecessor.OperationId == Guid.Empty
                        || predecessor.OperationId == pair.Value.OperationId
                        || !ValidEpoch(predecessor.AccessEpoch) || !ValidEpoch(predecessor.TopologyEpoch)
                        || TryNormalize(predecessor.AttestedAccess)?.UserId != pair.Key
                        || !Same(TryNormalize(predecessor.AttestedAccess), TryNormalize(predecessor.IntendedAccess))))
                || (pair.Value.State == "policy-attested") != (pair.Value.AttestedAccess is not null)
                || (pair.Value.AttestedAccess is not null
                    && (TryNormalize(pair.Value.AttestedAccess)?.UserId != pair.Key
                        || !Same(TryNormalize(pair.Value.AttestedAccess), TryNormalize(pair.Value.IntendedAccess))))
                || !ValidLibraries(pair.Value.AccessibleLibraryIds)))
            throw new InvalidOperationException("Invalid user access ledger.");
        if (document.Batch is { } batch && (batch.Id == Guid.Empty || !ValidEpoch(batch.TopologyEpoch)
            || batch.CandidateUserIds is null || batch.CandidateUserIds.Length > 1000 || batch.CandidateUserIds.Distinct(StringComparer.Ordinal).Count() != batch.CandidateUserIds.Length
            || batch.CandidateUserIds.Any(id => !Guid.TryParseExact(id, "N", out var parsed) || parsed == Guid.Empty)
            || document.LegacyEligibleUserIds is null
            || !batch.CandidateUserIds.SequenceEqual(document.LegacyEligibleUserIds, StringComparer.Ordinal)))
            throw new InvalidOperationException("Invalid verification cohort.");
        if (document.Records.Values.Any(record => record.Mode == "existing"
            && Same(TryNormalize(record.ExpectedAccess), TryNormalize(record.IntendedAccess))
            && (record.SupersededOperationId is null || record.RecoveryHistory is not { Length: > 0 }
                || record.RecoveryHistory[^1].OperationId != record.SupersededOperationId
                || !Same(TryNormalize(record.RecoveryHistory[^1].IntendedAccess),
                    TryNormalize(record.IntendedAccess)))))
            throw new InvalidOperationException("No-op existing access requires exact held recovery history.");
    }

    private static bool ValidLibraries(string[]? ids)
    {
        if (ids is null) return false;
        try { return NormalizeLibraries(ids).SequenceEqual(ids, StringComparer.Ordinal); }
        catch (InvalidOperationException) { return false; }
    }

    private async Task PersistAsync(PtvHomeUserAccessDocument document, CancellationToken cancellationToken)
    {
        var temporary = Path.Combine(_directory, $".home-user-access-{Guid.NewGuid():N}.tmp");
        try
        {
            Validate(document);
            Directory.CreateDirectory(_directory);
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write,
                FileShare.None, 81920, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, document, cancellationToken: cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            }
            Validate(JsonSerializer.Deserialize<PtvHomeUserAccessDocument>(
                await File.ReadAllTextAsync(temporary, cancellationToken).ConfigureAwait(false)));
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
            try { if (File.Exists(temporary)) File.Delete(temporary); } catch { /* Keep first failure. */ }
            throw;
        }
    }

    private sealed class PtvHomeUserAccessDocument
    {
        public int SchemaVersion { get; set; } = 1;
        public string ServerId { get; set; } = string.Empty;
        public Dictionary<string, PtvHomeUserAccessRecord> Records { get; set; } = new(StringComparer.Ordinal);
        public PtvHomeUserVerificationBatch? Batch { get; set; }
        public string[]? LegacyEligibleUserIds { get; set; }
        public bool MigrationRecoveryRestricted { get; set; }
        public HashSet<string> ControlledCreatedUserIds { get; set; } = new(StringComparer.Ordinal);
        public Dictionary<Guid, PtvHomeUserCreationReservation> CreationReservations { get; set; } = [];
        public Dictionary<Guid, string> CreationBindings { get; set; } = [];
        public Dictionary<Guid, string[]> CreationRecoveries { get; set; } = [];
    }

    private sealed class PtvHomeUserCreationReservation
    {
        public Guid OperationId { get; set; }
        public string[] BaselineUserIds { get; set; } = [];
    }

    private sealed class PtvHomeUserAccessRecord
    {
        public string UserId { get; set; } = string.Empty;
        public string AccessEpoch { get; set; } = string.Empty;
        public string TopologyEpoch { get; set; } = string.Empty;
        public string State { get; set; } = "pending";
        public string Mode { get; set; } = string.Empty;
        public Guid OperationId { get; set; }
        public Guid? SupersededOperationId { get; set; }
        public PtvHomeUserAccessRecoveryEntry[] RecoveryHistory { get; set; } = [];
        public PtvHomeAccessDefinition? ExpectedAccess { get; set; }
        public PtvHomeAccessDefinition? IntendedAccess { get; set; }
        public PtvHomeAccessDefinition? AttestedAccess { get; set; }
        public PtvHomeUserAttestedPredecessor? AttestedPredecessor { get; set; }
        public string[] AccessibleLibraryIds { get; set; } = [];
    }

    private sealed class PtvHomeUserAttestedPredecessor
    {
        public Guid OperationId { get; set; }
        public string AccessEpoch { get; set; } = string.Empty;
        public string TopologyEpoch { get; set; } = string.Empty;
        public PtvHomeAccessDefinition? AttestedAccess { get; set; }
        public PtvHomeAccessDefinition? IntendedAccess { get; set; }
    }

    private sealed class PtvHomeUserAccessRecoveryEntry
    {
        public Guid OperationId { get; set; }
        public string State { get; set; } = string.Empty;
        public string Mode { get; set; } = string.Empty;
        public PtvHomeAccessDefinition? ExpectedAccess { get; set; }
        public PtvHomeAccessDefinition? IntendedAccess { get; set; }
    }
}
