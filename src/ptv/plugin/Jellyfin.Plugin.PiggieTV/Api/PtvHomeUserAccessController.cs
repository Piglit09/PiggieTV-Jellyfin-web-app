using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.PiggieTV.Api;

/// <summary>Administrator coordination for existing policy writes and post-create bootstrap.</summary>
[ApiController]
[Authorize]
[Route(PtvApiRoutes.HomeUserAccess)]
public sealed class PtvHomeUserAccessController(
    IPtvHomeUserAccessLedger ledger,
    IPtvHomeTopologyLedger topology,
    IUserManager users,
    ILibraryManager libraries,
    IAuthorizationService authorization) : BaseJellyfinApiController
{
    private async Task<bool> IsAdministrator() => (await authorization.AuthorizeAsync(User, null,
        Policies.RequiresElevation).ConfigureAwait(false)).Succeeded;

    [HttpGet("current")]
    public async Task<IActionResult> Current([FromQuery] string userId, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        if (!Guid.TryParseExact(userId, "N", out var id) || id == Guid.Empty) return BadRequest();
        try
        {
            var actual = ReadAccess(id);
            if (actual is null) return NotFound();
            var current = await topology.ReadAsync(cancellationToken).ConfigureAwait(false);
            var membership = ReadAccessibleLibraries(id);
            var view = await ledger.ReadAsync(id, actual, UsableEpoch(current), cancellationToken,
                membership).ConfigureAwait(false);
            var controlledCreated = await ledger.IsControlledCreatedAsync(id, cancellationToken).ConfigureAwait(false);
            var migration = await ledger.ReadMigrationStateAsync(cancellationToken).ConfigureAwait(false);
            var lateUnverified = await ledger.IsLateUnverifiedAsync(id, cancellationToken).ConfigureAwait(false);
            return Ok(PtvHomeUserAccessAdminView.From(view, actual, controlledCreated,
                migration?.RecoveryRestricted == true, lateUnverified));
        }
        catch (Exception error) when (error is not OperationCanceledException)
        { return StatusCode(503, new { error = "User access authority unavailable." }); }
    }

    [HttpPost("begin")]
    public async Task<IActionResult> Begin([FromBody] PtvHomeUserAccessIntent intent, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        if (intent is null || !Guid.TryParseExact(intent.UserId, "N", out var id) || id == Guid.Empty)
            return BadRequest();
        try
        {
            var current = await topology.ReadAsync(cancellationToken).ConfigureAwait(false);
            var epoch = UsableEpoch(current);
            var actual = ReadAccess(id);
            if (epoch is null || actual is null) return Conflict(new { error = "Current user policy or topology unavailable." });
            return Ok(await ledger.BeginAsync(intent, actual, epoch, cancellationToken).ConfigureAwait(false));
        }
        catch (InvalidOperationException error) { return Conflict(new { error = error.Message }); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
        { return StatusCode(503, new { error = "The user-access hold could not be persisted." }); }
    }

    [HttpPost("{operationId:guid}/complete")]
    public async Task<IActionResult> Complete(Guid operationId, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        try
        {
            var userId = await ledger.GetOperationUserAsync(operationId, cancellationToken).ConfigureAwait(false);
            if (userId is null) return Conflict(new { error = "User-access operation is no longer current." });
            // This fresh Plugin-owned readback, not HTTP success or caller policy, releases the hold.
            var membership = ReadAccessibleLibraries(userId.Value);
            var actual = ReadAccess(userId.Value);
            var current = await topology.ReadAsync(cancellationToken).ConfigureAwait(false);
            return Ok(await ledger.CompleteAsync(operationId, actual, UsableEpoch(current), cancellationToken,
                membership).ConfigureAwait(false));
        }
        catch (InvalidOperationException error) { return Conflict(new { error = error.Message }); }
        catch (Exception error) when (error is not OperationCanceledException)
        { return StatusCode(503, new { error = "User policy readback could not be verified." }); }
    }

    [HttpPost("verification-batches")]
    public Task<IActionResult> BeginVerificationBatch(CancellationToken cancellationToken) =>
        StartVerificationBatch(cancellationToken, replace: false);

    [HttpPost("verification-batches/new")]
    public Task<IActionResult> NewVerificationBatch(CancellationToken cancellationToken) =>
        StartVerificationBatch(cancellationToken, replace: true);

    private async Task<IActionResult> StartVerificationBatch(CancellationToken cancellationToken, bool replace)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        try
        {
            var current = await topology.ReadAsync(cancellationToken).ConfigureAwait(false);
            var epoch = UsableEpoch(current);
            if (epoch is null) return Conflict(new { error = "Current topology is held or unavailable." });
            var candidates = users.GetUsersIds().Take(1001).ToArray();
            var batch = await ledger.BeginVerificationBatchAsync(candidates, epoch, cancellationToken, replace).ConfigureAwait(false);
            return Ok(await BatchStatus(batch, cancellationToken).ConfigureAwait(false));
        }
        catch (InvalidOperationException error) { return Conflict(new { error = error.Message }); }
        catch (Exception error) when (error is not OperationCanceledException)
        { return StatusCode(503, new { error = "Verification cohort could not be persisted." }); }
    }

    [HttpPost("creations/reserve")]
    public async Task<IActionResult> ReserveCreation([FromBody] PtvHomeUserCreationReservationRequest request,
        CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        if (request is null || request.CreationOperationId == Guid.Empty) return BadRequest();
        try
        {
            var baseline = users.GetUsersIds().Take(1001).ToArray();
            return Ok(await ledger.ReserveCreationAsync(request.CreationOperationId, baseline,
                cancellationToken).ConfigureAwait(false));
        }
        catch (InvalidOperationException error) { return Conflict(new { error = error.Message }); }
        catch (Exception error) when (error is not OperationCanceledException)
        { return StatusCode(503, new { error = "Controlled creation exclusion could not be persisted." }); }
    }

    [HttpPost("creations/{creationOperationId:guid}/bind")]
    public async Task<IActionResult> BindCreation(Guid creationOperationId,
        [FromBody] PtvHomeUserCreationBindRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        if (request is null || !Guid.TryParseExact(request.UserId, "N", out var userId)
            || userId == Guid.Empty) return BadRequest();
        try
        {
            if (users.GetUserById(userId) is null) return Conflict(new { error = "Jellyfin has not returned this user ID." });
            return Ok(await ledger.BindCreationAsync(creationOperationId, userId, cancellationToken).ConfigureAwait(false));
        }
        catch (InvalidOperationException error) { return Conflict(new { error = error.Message }); }
        catch (Exception error) when (error is not OperationCanceledException)
        { return StatusCode(503, new { error = "Created user identity could not be bound." }); }
    }

    [HttpGet("creations/current")]
    public async Task<IActionResult> CurrentCreations(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        try
        {
            var currentIds = users.GetUsersIds().Take(1001).ToArray();
            var pending = await ledger.ReadPendingCreationsAsync(currentIds, cancellationToken).ConfigureAwait(false);
            return Ok(new PtvHomeUserPendingCreations { PendingCount = pending.Count, Pending = pending });
        }
        catch (InvalidOperationException error) { return Conflict(new { error = error.Message }); }
        catch (Exception error) when (error is not OperationCanceledException)
        { return StatusCode(503, new { error = "Controlled creation recovery state unavailable." }); }
    }

    [HttpGet("creations/{creationOperationId:guid}/status")]
    public async Task<IActionResult> CreationStatus(Guid creationOperationId, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        if (creationOperationId == Guid.Empty) return BadRequest();
        try
        {
            return Ok(await ledger.ReadCreationStatusAsync(creationOperationId, cancellationToken).ConfigureAwait(false));
        }
        catch (Exception error) when (error is not OperationCanceledException)
        { return StatusCode(503, new { error = "Controlled creation status unavailable." }); }
    }

    [HttpPost("creations/{creationOperationId:guid}/recover")]
    public async Task<IActionResult> RecoverCreation(Guid creationOperationId,
        [FromBody] PtvHomeUserCreationRecoveryRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        if (request is not { ConfirmCreationRequestSettled: true })
            return BadRequest(new { error = "Administrator must confirm the stock create request has settled." });
        try
        {
            var currentIds = users.GetUsersIds().Take(1001).ToArray();
            return Ok(await ledger.RecoverCreationAsync(creationOperationId, currentIds,
                cancellationToken).ConfigureAwait(false));
        }
        catch (InvalidOperationException error) { return Conflict(new { error = error.Message }); }
        catch (Exception error) when (error is not OperationCanceledException)
        { return StatusCode(503, new { error = "Controlled creation recovery could not be persisted." }); }
    }

    [HttpGet("verification-summary")]
    public async Task<IActionResult> VerificationSummary(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        try
        {
            var candidates = users.GetUsersIds().Take(1001).ToArray();
            if (candidates.Length > 1000 || candidates.Distinct().Count() != candidates.Length)
                return Conflict(new { error = "Bounded current user snapshot is unavailable." });
            var epoch = UsableEpoch(await topology.ReadAsync(cancellationToken).ConfigureAwait(false));
            var recoveryRequired = await ledger.RequiresRecoveryAsync(cancellationToken).ConfigureAwait(false);
            var migration = recoveryRequired ? null : await ledger.ReadMigrationStateAsync(cancellationToken).ConfigureAwait(false);
            var batch = await ledger.ReadVerificationBatchAsync(cancellationToken).ConfigureAwait(false);
            var verified = 0;
            foreach (var id in candidates)
            {
                var membership = ReadAccessibleLibraries(id);
                var view = await ledger.ReadAsync(id, ReadAccess(id), epoch, cancellationToken,
                    membership).ConfigureAwait(false);
                if (view.PolicyProven) verified++;
            }
            var pending = recoveryRequired ? [] : await ledger.ReadPendingCreationsAsync(candidates, cancellationToken).ConfigureAwait(false);
            return Ok(new PtvHomeUserVerificationSummary
            {
                VerifiedCount = verified,
                NeedsVerificationCount = candidates.Length - verified,
                TotalCount = candidates.Length,
                CurrentBatchId = batch?.Id,
                TopologyEpoch = epoch,
                Held = epoch is null,
                RecoveryRequired = recoveryRequired,
                PendingCreationReservations = pending.Count,
                LegacyCohortStarted = migration?.Started == true,
                MigrationRecoveryRestricted = migration?.RecoveryRestricted == true
            });
        }
        catch (Exception error) when (error is not OperationCanceledException)
        { return StatusCode(503, new { error = "Current user verification summary unavailable." }); }
    }

    [HttpPost("recover-corrupt")]
    public async Task<IActionResult> RecoverCorruptLedger(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        try
        {
            await ledger.RecoverCorruptAsync(cancellationToken).ConfigureAwait(false);
            return Ok(new { recovered = true, requiresVerification = true });
        }
        catch (InvalidOperationException error) { return Conflict(new { error = error.Message }); }
        catch (Exception error) when (error is not OperationCanceledException)
        { return StatusCode(503, new { error = "User-access ledger recovery could not be persisted." }); }
    }

    [HttpGet("verification-batches/current")]
    public async Task<IActionResult> CurrentVerificationBatch(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        try
        {
            var batch = await ledger.ReadVerificationBatchAsync(cancellationToken).ConfigureAwait(false);
            return batch is null ? NotFound() : Ok(await BatchStatus(batch, cancellationToken).ConfigureAwait(false));
        }
        catch (Exception error) when (error is not OperationCanceledException)
        { return StatusCode(503, new { error = "Verification cohort unavailable." }); }
    }

    [HttpPost("verification-batches/{batchId:guid}/users/{userId:guid}/verify")]
    public async Task<IActionResult> VerifyBatchCandidate(Guid batchId, Guid userId,
        [FromBody] PtvHomeUserVerificationIntent intent, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        if (intent is not { ConfirmCurrentPolicy: true, IntendedAccess: not null })
            return BadRequest(new { error = "Explicit intended current user policy confirmation is required." });
        try
        {
            var batch = await ledger.ReadVerificationBatchAsync(cancellationToken).ConfigureAwait(false);
            if (batch?.Id != batchId || !batch.CandidateUserIds.Contains(userId.ToString("N"), StringComparer.Ordinal))
                return Conflict(new { error = "User is outside the fixed verification cohort." });
            var current = await topology.ReadAsync(cancellationToken).ConfigureAwait(false);
            var epoch = UsableEpoch(current);
            var user = users.GetUserById(userId);
            if (epoch is null || epoch != batch.TopologyEpoch || user is null)
                return Conflict(new { error = "Current user or topology differs from the verification cohort." });
            var observed = Access(user);
            if (!AccessMatches(observed, intent.IntendedAccess))
                return Conflict(new { error = "Administrator intended policy differs from current Jellyfin policy." });
            var accessible = ReadAccessibleLibraries(libraries, user);
            // Reacquire both authorities after bounded library checks, immediately before
            // the durable write. Later out-of-band changes are rejected on every public read.
            var finalPolicy = ReadAccess(userId);
            var finalEpoch = UsableEpoch(await topology.ReadAsync(cancellationToken).ConfigureAwait(false));
            if (finalPolicy is null || finalEpoch != epoch || !AccessMatches(observed, finalPolicy)
                || !AccessMatches(finalPolicy, intent.IntendedAccess))
                return Conflict(new { error = "User policy or topology changed during verification." });
            return Ok(await ledger.VerifyBatchCandidateAsync(batchId, userId, finalPolicy, intent.IntendedAccess,
                accessible, epoch, cancellationToken).ConfigureAwait(false));
        }
        catch (InvalidOperationException error) { return Conflict(new { error = error.Message }); }
        catch (Exception error) when (error is not OperationCanceledException)
        { return StatusCode(503, new { error = "Current user access could not be verified." }); }
    }

    private async Task<PtvHomeUserVerificationBatchStatus> BatchStatus(
        PtvHomeUserVerificationBatch batch, CancellationToken cancellationToken)
    {
        var current = await topology.ReadAsync(cancellationToken).ConfigureAwait(false);
        var epoch = UsableEpoch(current);
        var verified = 0;
        foreach (var candidate in batch.CandidateUserIds)
        {
            var userId = Guid.ParseExact(candidate, "N");
            var membership = ReadAccessibleLibraries(userId);
            var view = await ledger.ReadAsync(userId, ReadAccess(userId), epoch, cancellationToken,
                membership).ConfigureAwait(false);
            if (view.PolicyProven && view.VerificationBatchId == batch.Id) verified++;
        }
        return new PtvHomeUserVerificationBatchStatus
        {
            Id = batch.Id,
            TopologyEpoch = batch.TopologyEpoch,
            CandidateUserIds = batch.CandidateUserIds,
            VerifiedCount = verified,
            NeedsVerificationCount = batch.CandidateUserIds.Length - verified,
            Stale = epoch != batch.TopologyEpoch
        };
    }

    private string[]? ReadAccessibleLibraries(Guid userId)
    {
        var user = users.GetUserById(userId);
        return user is null ? null : ReadAccessibleLibraries(libraries, user);
    }

    internal static string[] ReadAccessibleLibraries(ILibraryManager libraries, User user)
    {
        var folders = libraries.GetVirtualFolders().ToArray();
        if (folders.Length > 128) throw new InvalidOperationException("Top-level library readback exceeds its bound.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var accessible = new List<string>();
        foreach (var folder in folders)
        {
            if (!Guid.TryParseExact(folder.ItemId, "N", out var id) || id == Guid.Empty
                || !ids.Add(id.ToString("N")))
                throw new InvalidOperationException("Top-level library readback is ambiguous.");
            if (libraries.GetItemById(id) is not CollectionFolder current || current.Id != id)
                throw new InvalidOperationException("Top-level CollectionFolder is not current.");
            if (libraries.GetItemById<CollectionFolder>(id, user) is { Id: var visible } && visible == id)
                accessible.Add(id.ToString("N"));
        }
        accessible.Sort(StringComparer.Ordinal);
        return accessible.ToArray();
    }

    private static bool AccessMatches(PtvHomeAccessDefinition left, PtvHomeAccessDefinition right) =>
        left.UserId == right.UserId && left.EnableAllFolders == right.EnableAllFolders
        && left.IsAdministrator == right.IsAdministrator && left.IsDisabled == right.IsDisabled
        && left.EnabledFolders.SequenceEqual(right.EnabledFolders, StringComparer.Ordinal);

    private PtvHomeAccessDefinition? ReadAccess(Guid userId)
    {
        var user = users.GetUserById(userId);
        return user is null ? null : Access(user);
    }

    internal static PtvHomeAccessDefinition Access(User user) => new()
    {
        UserId = user.Id.ToString("N"),
        EnableAllFolders = user.HasPermission(PermissionKind.EnableAllFolders),
        EnabledFolders = user.GetPreferenceValues<Guid>(PreferenceKind.EnabledFolders)
            .Select(id => id.ToString("N")).Order(StringComparer.Ordinal).ToArray(),
        IsAdministrator = user.HasPermission(PermissionKind.IsAdministrator),
        IsDisabled = user.HasPermission(PermissionKind.IsDisabled)
    };

    internal static string? UsableEpoch(PtvHomeTopologySnapshot? current) =>
        current is { BroadHold: false, RecoveryRequired: false } && current.Epoch.Length == 64
            && current.Epoch.All(char.IsAsciiHexDigit) ? current.Epoch : null;
}
