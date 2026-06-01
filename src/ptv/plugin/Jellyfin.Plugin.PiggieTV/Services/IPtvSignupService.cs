using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Native PiggieTV signup service.
/// </summary>
public interface IPtvSignupService
{
    /// <summary>Validates an invite code.</summary>
    Task<PtvSignupInviteValidationResponse> ValidateInviteAsync(string? inviteCode, string remoteAddress, CancellationToken cancellationToken);

    /// <summary>Creates a Jellyfin user from a valid invite.</summary>
    Task<PtvSignupResponse> CreateUserAsync(PtvSignupCreateUserRequest request, string remoteAddress, CancellationToken cancellationToken);

    /// <summary>Verifies a pending signup email and finalizes Jellyfin user creation.</summary>
    Task<PtvSignupResponse> VerifyEmailAsync(PtvSignupEmailVerificationRequest request, string remoteAddress, CancellationToken cancellationToken);

    /// <summary>Requests a password reset email.</summary>
    Task<PtvSignupResponse> RequestPasswordResetAsync(PtvSignupPasswordResetRequest request, string remoteAddress, CancellationToken cancellationToken);

    /// <summary>Confirms a password reset code and changes the password.</summary>
    Task<PtvSignupResponse> ConfirmPasswordResetAsync(PtvSignupPasswordResetConfirmRequest request, string remoteAddress, CancellationToken cancellationToken);

    /// <summary>Gets admin signup and email settings.</summary>
    PtvSignupAdminSettingsResponse GetAdminSettings();

    /// <summary>Saves admin signup and email settings.</summary>
    PtvSignupAdminSettingsResponse SaveAdminSettings(PtvSignupAdminSettingsPatch request);

    /// <summary>Sends a test email using saved settings.</summary>
    Task<PtvSignupResponse> SendTestEmailAsync(PtvSignupTestEmailRequest request, CancellationToken cancellationToken);

    /// <summary>Cleans expired pending verification/reset/rate-limit records.</summary>
    int CleanupExpiredRecords();

    /// <summary>Gets admin invite state.</summary>
    PtvSignupInviteListResponse GetAdminInvites();

    /// <summary>Creates an invite.</summary>
    PtvSignupInviteDto CreateInvite(PtvSignupCreateInviteRequest request, string createdBy);

    /// <summary>Disables an invite.</summary>
    PtvSignupInviteDto DisableInvite(string inviteId);

    /// <summary>Deletes an invite.</summary>
    void DeleteInvite(string inviteId);
}
