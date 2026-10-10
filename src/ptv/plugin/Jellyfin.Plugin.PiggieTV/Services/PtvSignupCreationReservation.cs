namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Excludes a controlled create from legacy migration before Jellyfin knows its ID.
/// This reservation is not a per-user prewrite Home hold; unknown IDs remain denied.
/// </summary>
internal static class PtvSignupCreationReservation
{
    internal static async Task<TUser> CreateAndBindAsync<TUser>(
        IPtvHomeUserAccessLedger ledger,
        Guid creationOperationId,
        IReadOnlyCollection<Guid> baselineUserIds,
        Func<CancellationToken, Task<TUser>> createUser,
        Func<TUser, Guid> getUserId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(ledger);
        ArgumentNullException.ThrowIfNull(baselineUserIds);
        ArgumentNullException.ThrowIfNull(createUser);
        ArgumentNullException.ThrowIfNull(getUserId);

        var reserved = await ledger.ReserveCreationAsync(creationOperationId, baselineUserIds,
            cancellationToken).ConfigureAwait(false);
        if (reserved.Version != 1 || reserved.CreationOperationId != creationOperationId
            || reserved.State != "reserved" || !reserved.MigrationVerificationHeld
            || reserved.UserId is not null || reserved.BootstrapRequired)
            throw new InvalidOperationException("Signup migration exclusion could not be verified.");

        // An uncertain Jellyfin response leaves the durable reservation for admin recovery.
        var created = await createUser(cancellationToken).ConfigureAwait(false);
        var userId = getUserId(created);
        if (userId == Guid.Empty) throw new InvalidOperationException("Jellyfin did not return a usable user ID.");
        var bound = await ledger.BindCreationAsync(creationOperationId, userId, cancellationToken).ConfigureAwait(false);
        if (bound.Version != 1 || bound.CreationOperationId != creationOperationId
            || bound.State != "bound" || bound.MigrationVerificationHeld
            || bound.UserId != userId.ToString("N") || !bound.BootstrapRequired)
            throw new InvalidOperationException("Signup created ID could not be bound to migration exclusion.");
        return created;
    }
}
