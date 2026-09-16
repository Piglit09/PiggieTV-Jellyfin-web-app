using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>PTV-owned profile, verification, synchronization, and recovery boundary.</summary>
public interface IPtvAccountService
{
    /// <summary>Runs idempotent legacy recovery and synchronizes all current Jellyfin profiles.</summary>
    Task<PtvAccountMigrationState> InitializeAsync(CancellationToken cancellationToken = default);

    /// <summary>Gets or creates the authenticated user's profile.</summary>
    Task<PtvAccountProfileResponse> GetProfileAsync(
        Guid jellyfinUserId,
        string username,
        bool isAdministrator,
        CancellationToken cancellationToken = default);

    /// <summary>Starts a verification-gated add/change operation for the authenticated user.</summary>
    Task<PtvAccountOperationResponse> StartEmailVerificationAsync(
        Guid jellyfinUserId,
        string username,
        bool isAdministrator,
        string? email,
        CancellationToken cancellationToken = default);

    /// <summary>Replaces the authenticated user's active token and resends verification.</summary>
    Task<PtvAccountOperationResponse> ResendEmailVerificationAsync(
        Guid jellyfinUserId,
        string username,
        bool isAdministrator,
        CancellationToken cancellationToken = default);

    /// <summary>Cancels only the authenticated user's pending verification.</summary>
    Task<PtvAccountOperationResponse> CancelEmailVerificationAsync(
        Guid jellyfinUserId,
        string username,
        bool isAdministrator,
        CancellationToken cancellationToken = default);

    /// <summary>Consumes a valid single-use token and atomically commits canonical email.</summary>
    Task<PtvAccountOperationResponse> VerifyEmailAsync(
        string? rawToken,
        string remoteAddress = "unknown",
        CancellationToken cancellationToken = default);

    /// <summary>Imports a verified native-signup email using exact immutable user identity.</summary>
    Task ImportVerifiedSignupEmailAsync(
        Guid jellyfinUserId,
        string username,
        string email,
        CancellationToken cancellationToken = default);

    /// <summary>Rolls back a just-provisioned native-signup profile when Jellyfin user creation fails.</summary>
    Task RemoveProvisioningProfileAsync(
        Guid jellyfinUserId,
        CancellationToken cancellationToken = default);

    /// <summary>Finds a canonical profile for password-reset lookup.</summary>
    Task<PtvProfileRecord?> FindVerifiedProfileByEmailAsync(
        string email,
        CancellationToken cancellationToken = default);

    /// <summary>Gets synchronized administrator account-health state.</summary>
    Task<PtvAccountAdminHealthResponse> GetAdminHealthAsync(
        PtvAccountBackupStatus backupStatus,
        CancellationToken cancellationToken = default);

    /// <summary>Gets a read-only PTV profile summary for every current Jellyfin user.</summary>
    Task<PtvAccountAdminUsersResponse> GetAdminUsersAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Administrator cancellation scoped to one known user ID.</summary>
    Task<PtvAccountOperationResponse> AdminCancelEmailVerificationAsync(
        Guid jellyfinUserId,
        CancellationToken cancellationToken = default);
}
