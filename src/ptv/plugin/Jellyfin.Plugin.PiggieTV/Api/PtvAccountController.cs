using System.Security.Claims;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.PiggieTV.Api;

/// <summary>Owner-scoped PiggieTV profiles and elevated account administration.</summary>
[ApiController]
[Authorize]
[Route("Ptv/v1/account")]
public sealed class PtvAccountController : BaseJellyfinApiController
{
    private readonly IPtvAccountBackupService _backupService;
    private readonly IPtvAccountService _accountService;
    private readonly IAuthorizationService _authorizationService;
    private readonly IUserManager _userManager;

    /// <summary>Initializes account endpoints.</summary>
    public PtvAccountController(
        IPtvAccountService accountService,
        IPtvAccountBackupService backupService,
        IAuthorizationService authorizationService,
        IUserManager userManager)
    {
        _accountService = accountService;
        _backupService = backupService;
        _authorizationService = authorizationService;
        _userManager = userManager;
    }

    /// <summary>Gets the authenticated Jellyfin user's PiggieTV profile.</summary>
    [HttpGet("profile")]
    [ProducesResponseType(typeof(PtvAccountProfileResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<PtvAccountProfileResponse>> GetProfile(CancellationToken cancellationToken)
    {
        if (!TryGetOwner(out var userId, out var username)) return Unauthorized();
        var isAdministrator = await IsAdministratorAsync().ConfigureAwait(false);
        return Ok(await _accountService.GetProfileAsync(userId, username, isAdministrator, cancellationToken).ConfigureAwait(false));
    }

    /// <summary>Starts add/change-email verification for the authenticated owner.</summary>
    [HttpPost("email/verification")]
    public async Task<ActionResult<PtvAccountOperationResponse>> StartVerification(
        [FromBody] PtvAccountEmailRequest? request,
        CancellationToken cancellationToken)
    {
        if (!TryGetOwner(out var userId, out var username)) return Unauthorized();
        var isAdministrator = await IsAdministratorAsync().ConfigureAwait(false);
        if (request is null) return BadRequest(new PtvErrorResponse("PTV_ACCOUNT_EMPTY_PAYLOAD", "Email is required."));
        return Ok(await _accountService.StartEmailVerificationAsync(userId, username, isAdministrator, request.Email, cancellationToken).ConfigureAwait(false));
    }

    /// <summary>Resends the authenticated owner's latest pending verification.</summary>
    [HttpPost("email/verification/resend")]
    public async Task<ActionResult<PtvAccountOperationResponse>> ResendVerification(CancellationToken cancellationToken)
    {
        if (!TryGetOwner(out var userId, out var username)) return Unauthorized();
        var isAdministrator = await IsAdministratorAsync().ConfigureAwait(false);
        return Ok(await _accountService.ResendEmailVerificationAsync(userId, username, isAdministrator, cancellationToken).ConfigureAwait(false));
    }

    /// <summary>Cancels the authenticated owner's latest pending verification.</summary>
    [HttpPost("email/verification/cancel")]
    public async Task<ActionResult<PtvAccountOperationResponse>> CancelVerification(CancellationToken cancellationToken)
    {
        if (!TryGetOwner(out var userId, out var username)) return Unauthorized();
        var isAdministrator = await IsAdministratorAsync().ConfigureAwait(false);
        return Ok(await _accountService.CancelEmailVerificationAsync(userId, username, isAdministrator, cancellationToken).ConfigureAwait(false));
    }

    /// <summary>Consumes a one-time profile email token. Raw tokens are accepted only in the body.</summary>
    [AllowAnonymous]
    [HttpPost("email/verify")]
    public async Task<ActionResult<PtvAccountOperationResponse>> VerifyEmail(
        [FromBody] PtvAccountEmailTokenRequest? request,
        CancellationToken cancellationToken)
    {
        if (request is null) return BadRequest(new PtvErrorResponse("PTV_ACCOUNT_EMPTY_TOKEN", "Verification token is required."));
        var remoteAddress = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return Ok(await _accountService.VerifyEmailAsync(request.Token, remoteAddress, cancellationToken).ConfigureAwait(false));
    }

    /// <summary>Gets count-only migration, profile, verification, and backup health.</summary>
    [HttpGet("admin/health")]
    public async Task<ActionResult<PtvAccountAdminHealthResponse>> GetAdminHealth(CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        var backup = await _backupService.GetStatusAsync(cancellationToken).ConfigureAwait(false);
        return Ok(await _accountService.GetAdminHealthAsync(backup, cancellationToken).ConfigureAwait(false));
    }

    /// <summary>Gets read-only PiggieTV profile summaries for current Jellyfin users.</summary>
    [HttpGet("admin/users")]
    [ProducesResponseType(typeof(PtvAccountAdminUsersResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvAccountAdminUsersResponse>> GetAdminUsers(CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        return Ok(await _accountService.GetAdminUsersAsync(cancellationToken).ConfigureAwait(false));
    }

    /// <summary>Cancels a user's latest pending verification.</summary>
    [HttpPost("admin/users/{jellyfinUserId:guid}/verification/cancel")]
    public async Task<ActionResult<PtvAccountOperationResponse>> AdminCancelVerification(
        Guid jellyfinUserId,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        return Ok(await _accountService.AdminCancelEmailVerificationAsync(jellyfinUserId, cancellationToken).ConfigureAwait(false));
    }

    /// <summary>Creates a manually triggered validated backup using the scheduled backup path.</summary>
    [HttpPost("admin/backups")]
    public async Task<ActionResult<PtvAccountBackupOperationResponse>> CreateBackup(CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        return Ok(await _backupService.CreateBackupAsync("manual", cancellationToken).ConfigureAwait(false));
    }

    /// <summary>Gets persisted count-only account backup health.</summary>
    [HttpGet("admin/backups/status")]
    public async Task<ActionResult<PtvAccountBackupStatus>> GetBackupStatus(CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        return Ok(await _backupService.GetStatusAsync(cancellationToken).ConfigureAwait(false));
    }

    /// <summary>Validates a backup's manifest, checksum, schema, and counts.</summary>
    [HttpPost("admin/backups/verify")]
    public async Task<ActionResult<PtvAccountBackupOperationResponse>> VerifyBackup(
        [FromBody] PtvAccountBackupVerifyRequest? request,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        if (string.IsNullOrWhiteSpace(request?.BackupId)) return BadRequest(new PtvErrorResponse("PTV_BACKUP_ID_REQUIRED", "Backup ID is required."));
        return Ok(await _backupService.VerifyBackupAsync(request.BackupId, cancellationToken).ConfigureAwait(false));
    }

    /// <summary>Dry-runs or restores a validated backup after explicit confirmation.</summary>
    [HttpPost("admin/backups/restore")]
    public async Task<ActionResult<PtvAccountBackupOperationResponse>> RestoreBackup(
        [FromBody] PtvAccountBackupRestoreRequest? request,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        if (string.IsNullOrWhiteSpace(request?.BackupId)) return BadRequest(new PtvErrorResponse("PTV_BACKUP_ID_REQUIRED", "Backup ID is required."));
        if (!request.DryRun && !request.Confirm)
        {
            return BadRequest(new PtvErrorResponse("PTV_RESTORE_CONFIRMATION_REQUIRED", "Confirm is required for a live restore."));
        }

        return Ok(await _backupService.RestoreBackupAsync(request.BackupId, request.DryRun, cancellationToken).ConfigureAwait(false));
    }

    private bool TryGetOwner(out Guid userId, out string username)
    {
        var claim = User.FindFirstValue("Jellyfin-UserId")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");
        if (!Guid.TryParse(claim?.Trim(), out userId) || userId == Guid.Empty)
        {
            username = string.Empty;
            return false;
        }

        var user = _userManager.GetUserById(userId);
        if (user is null)
        {
            username = string.Empty;
            return false;
        }

        username = user.Username;
        return true;
    }

    private async Task<bool> IsAdministratorAsync()
    {
        var result = await _authorizationService
            .AuthorizeAsync(User, resource: null, Policies.RequiresElevation)
            .ConfigureAwait(false);
        return result.Succeeded;
    }
}
