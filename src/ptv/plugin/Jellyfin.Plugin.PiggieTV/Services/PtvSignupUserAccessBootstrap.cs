using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Establishes post-creation per-user Home authority for native signup.
/// A user ID absent from the ledger is denied before this method starts.
/// </summary>
internal static class PtvSignupUserAccessBootstrap
{
    internal static async Task<PtvHomeUserAccessView> ExecuteAsync(
        Guid userId,
        PtvHomeAccessDefinition intendedAccess,
        IPtvHomeUserAccessLedger ledger,
        Func<CancellationToken, Task<PtvHomeAccessDefinition?>> readCurrentAccess,
        Func<CancellationToken, Task<string?>> readCurrentEpoch,
        Func<CancellationToken, Task> writePolicy,
        CancellationToken cancellationToken,
        Func<CancellationToken, Task>? finishProvisioning = null,
        Func<CancellationToken, Task<IReadOnlyCollection<string>?>>? readAccessibleLibraries = null)
    {
        ArgumentNullException.ThrowIfNull(intendedAccess);
        ArgumentNullException.ThrowIfNull(ledger);
        ArgumentNullException.ThrowIfNull(readCurrentAccess);
        ArgumentNullException.ThrowIfNull(readCurrentEpoch);
        ArgumentNullException.ThrowIfNull(writePolicy);
        if (userId == Guid.Empty || intendedAccess.UserId != userId.ToString("N"))
            throw new InvalidOperationException("Signup user identity is unavailable.");

        var before = await readCurrentAccess(cancellationToken).ConfigureAwait(false);
        var epoch = await readCurrentEpoch(cancellationToken).ConfigureAwait(false);
        if (before is null || !ValidEpoch(epoch) || before.UserId != intendedAccess.UserId)
            throw new InvalidOperationException("Signup user or topology is unavailable.");

        var operationId = Guid.NewGuid();
        var intent = new PtvHomeUserAccessIntent
        {
            OperationId = operationId,
            UserId = intendedAccess.UserId,
            Mode = "bootstrap",
            IntendedAccess = intendedAccess
        };
        var begun = await ledger.BeginAsync(intent, before, epoch!, cancellationToken).ConfigureAwait(false);
        if (begun.OperationId != operationId || begun.UserId != intendedAccess.UserId
            || !ValidEpoch(begun.AccessEpoch) || !begun.Held || begun.PolicyProven
            || begun.State != "pending" || !begun.WriteAllowed)
            throw new InvalidOperationException("Signup Home hold could not be verified.");

        // A write is required even if Jellyfin's temporary default equals the intent.
        await writePolicy(cancellationToken).ConfigureAwait(false);
        var after = await readCurrentAccess(cancellationToken).ConfigureAwait(false);
        var afterEpoch = await readCurrentEpoch(cancellationToken).ConfigureAwait(false);
        if (after is null || !Same(after, intendedAccess) || afterEpoch != epoch)
            throw new InvalidOperationException("Signup policy readback did not prove the intended access.");

        if (finishProvisioning is not null)
            await finishProvisioning(cancellationToken).ConfigureAwait(false);

        // Provisioning may take time; its earlier readback cannot attest completion.
        var finalAccess = await readCurrentAccess(cancellationToken).ConfigureAwait(false);
        var finalEpoch = await readCurrentEpoch(cancellationToken).ConfigureAwait(false);
        if (finalAccess is null || !Same(finalAccess, intendedAccess) || finalEpoch != epoch)
            throw new InvalidOperationException("Signup policy or topology changed during provisioning.");

        var finalLibraries = readAccessibleLibraries is null ? null :
            await readAccessibleLibraries(cancellationToken).ConfigureAwait(false);
        if (finalLibraries is null)
            throw new InvalidOperationException("Signup accessible-library readback is unavailable.");
        finalAccess = await readCurrentAccess(cancellationToken).ConfigureAwait(false);
        finalEpoch = await readCurrentEpoch(cancellationToken).ConfigureAwait(false);
        if (finalAccess is null || !Same(finalAccess, intendedAccess) || finalEpoch != epoch)
            throw new InvalidOperationException("Signup policy or topology changed during membership verification.");

        var completed = await ledger.CompleteAsync(operationId, finalAccess, finalEpoch, cancellationToken,
            finalLibraries).ConfigureAwait(false);
        if (completed.OperationId != operationId || completed.UserId != intendedAccess.UserId
            || completed.AccessEpoch != begun.AccessEpoch || completed.Held || !completed.PolicyProven
            || completed.State != "policy-attested" || completed.WriteAllowed)
            throw new InvalidOperationException("Signup Home authority remains unverified.");
        return completed;
    }

    private static bool Same(PtvHomeAccessDefinition left, PtvHomeAccessDefinition right) =>
        left.UserId == right.UserId && left.EnableAllFolders == right.EnableAllFolders
        && left.IsAdministrator == right.IsAdministrator && left.IsDisabled == right.IsDisabled
        && left.EnabledFolders.Order(StringComparer.Ordinal).SequenceEqual(
            right.EnabledFolders.Order(StringComparer.Ordinal), StringComparer.Ordinal);

    private static bool ValidEpoch(string? epoch) =>
        epoch is { Length: 64 } && epoch.All(char.IsAsciiHexDigit);
}
