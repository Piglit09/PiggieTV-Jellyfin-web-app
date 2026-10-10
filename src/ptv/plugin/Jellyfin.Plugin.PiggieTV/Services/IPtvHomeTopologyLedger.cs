using Jellyfin.Plugin.PiggieTV.Models;
namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Durable, server-scoped library topology authority.</summary>
public interface IPtvHomeTopologyLedger
{
    Task<PtvHomeTopologySnapshot> ReadAsync(CancellationToken cancellationToken = default);
    Task<PtvHomeTopologySnapshot> BeginAsync(PtvHomeTransitionIntent intent, CancellationToken cancellationToken = default);
    Task<PtvHomeTopologySnapshot> BeginAsync(PtvHomeTransitionIntent intent,
        IReadOnlyDictionary<string, string> observedBindings, CancellationToken cancellationToken = default);
    Task<PtvHomeTopologySnapshot> BeginAsync(PtvHomeTransitionIntent intent,
        IReadOnlyDictionary<string, string> observedBindings, IReadOnlyDictionary<string, string> observedScopeFingerprints,
        CancellationToken cancellationToken = default) => BeginAsync(intent, observedBindings, cancellationToken);
    Task<PtvHomeTopologySnapshot> CompleteAsync(Guid operationId, PtvVerifiedTransitionReadback readback, CancellationToken cancellationToken = default);
    Task<PtvHomeTopologySnapshot> CompleteAndRebindAsync(Guid operationId, PtvVerifiedTransitionReadback readback,
        IReadOnlyDictionary<string, string> verifiedBindings, IReadOnlyDictionary<string, string> observedScopeFingerprints,
        CancellationToken cancellationToken = default) => throw new NotSupportedException("Atomic transition rebinding is unavailable.");
    Task<PtvHomeTopologySnapshot> RebindAsync(Guid operationId,
        IReadOnlyDictionary<string, string> verifiedBindings, CancellationToken cancellationToken = default);
    Task<PtvHomeTopologySnapshot> RebindAsync(Guid operationId,
        IReadOnlyDictionary<string, string> verifiedBindings, IReadOnlyDictionary<string, string> observedScopeFingerprints,
        CancellationToken cancellationToken = default) => RebindAsync(operationId, verifiedBindings, cancellationToken);
}
