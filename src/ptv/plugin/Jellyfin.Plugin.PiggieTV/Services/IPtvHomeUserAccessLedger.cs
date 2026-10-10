using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Durable per-user PTV Home policy proof; unknown users fail closed.</summary>
public interface IPtvHomeUserAccessLedger
{
    Task<PtvHomeUserAccessView> ReadAsync(Guid userId, PtvHomeAccessDefinition? currentAccess,
        string? topologyEpoch, CancellationToken cancellationToken = default,
        IReadOnlyCollection<string>? currentAccessibleLibraryIds = null);
    Task<PtvHomeUserAccessView> BeginAsync(PtvHomeUserAccessIntent intent, PtvHomeAccessDefinition currentAccess,
        string topologyEpoch, CancellationToken cancellationToken = default);
    Task<PtvHomeUserAccessView> CompleteAsync(Guid operationId, PtvHomeAccessDefinition? currentAccess,
        string? topologyEpoch, CancellationToken cancellationToken = default,
        IReadOnlyCollection<string>? currentAccessibleLibraryIds = null);
    Task<Guid?> GetOperationUserAsync(Guid operationId, CancellationToken cancellationToken = default);
    Task<PtvHomeUserVerificationBatch> BeginVerificationBatchAsync(IReadOnlyCollection<Guid> candidateIds,
        string topologyEpoch, CancellationToken cancellationToken = default, bool replace = false);
    Task<PtvHomeUserVerificationBatch?> ReadVerificationBatchAsync(CancellationToken cancellationToken = default);
    Task<PtvHomeUserAccessView> VerifyBatchCandidateAsync(Guid batchId, Guid userId,
        PtvHomeAccessDefinition currentAccess, PtvHomeAccessDefinition intendedAccess,
        IReadOnlyCollection<string> accessibleLibraryIds,
        string topologyEpoch, CancellationToken cancellationToken = default);
    Task RecoverCorruptAsync(CancellationToken cancellationToken = default);
    Task<bool> RequiresRecoveryAsync(CancellationToken cancellationToken = default);
    Task<PtvHomeUserMigrationState?> ReadMigrationStateAsync(CancellationToken cancellationToken = default);
    Task<bool> IsControlledCreatedAsync(Guid userId, CancellationToken cancellationToken = default);
    Task<bool> IsLateUnverifiedAsync(Guid userId, CancellationToken cancellationToken = default);
    Task<PtvHomeUserCreationView> ReserveCreationAsync(Guid creationOperationId,
        IReadOnlyCollection<Guid> baselineUserIds, CancellationToken cancellationToken = default);
    Task<PtvHomeUserCreationView> BindCreationAsync(Guid creationOperationId, Guid userId,
        CancellationToken cancellationToken = default);
    Task<PtvHomeUserCreationRecovery> RecoverCreationAsync(Guid creationOperationId,
        IReadOnlyCollection<Guid> currentUserIds, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PtvHomeUserPendingCreation>> ReadPendingCreationsAsync(
        IReadOnlyCollection<Guid> currentUserIds, CancellationToken cancellationToken = default);
}
