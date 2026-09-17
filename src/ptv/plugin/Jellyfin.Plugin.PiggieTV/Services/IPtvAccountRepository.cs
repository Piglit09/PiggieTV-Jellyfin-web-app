using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Serialized durable PTV account persistence boundary.</summary>
public interface IPtvAccountRepository
{
    /// <summary>Gets the server-only account data path.</summary>
    string FilePath { get; }

    /// <summary>Reads an immutable snapshot of current account state.</summary>
    Task<PtvAccountDocument> ReadAsync(CancellationToken cancellationToken = default);

    /// <summary>Executes one serialized mutation and atomically commits the resulting document.</summary>
    Task<TResult> ExecuteTransactionAsync<TResult>(
        Func<PtvAccountDocument, TResult> mutation,
        CancellationToken cancellationToken = default);

    /// <summary>Atomically replaces the account document after validation.</summary>
    Task ReplaceAsync(PtvAccountDocument document, CancellationToken cancellationToken = default);

    /// <summary>Locks profile writes, snapshots active data for a required pre-operation action, then atomically replaces it.</summary>
    Task ReplaceWithMaintenanceLockAsync(
        PtvAccountDocument replacement,
        Func<PtvAccountDocument, CancellationToken, Task> beforeReplace,
        CancellationToken cancellationToken = default);

    /// <summary>Validates schema and account invariants without writing.</summary>
    PtvAccountDocument Validate(PtvAccountDocument document);
}
