using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Api;

/// <summary>
/// Native PiggieTV signup and invite API.
/// </summary>
[ApiController]
[Authorize]
[Route("Ptv/v1/signup")]
public sealed class PtvSignupController : BaseJellyfinApiController
{
    private readonly IAuthorizationService _authorizationService;
    private readonly ILogger<PtvSignupController> _logger;
    private readonly IPtvSignupService _signupService;

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvSignupController"/> class.
    /// </summary>
    /// <param name="logger">Logger.</param>
    /// <param name="signupService">Signup service.</param>
    /// <param name="authorizationService">Authorization service.</param>
    public PtvSignupController(
        ILogger<PtvSignupController> logger,
        IPtvSignupService signupService,
        IAuthorizationService authorizationService)
    {
        _authorizationService = authorizationService;
        _logger = logger;
        _signupService = signupService;
    }

    /// <summary>
    /// Creates a Jellyfin local user from native PiggieTV signup.
    /// </summary>
    /// <param name="request">Create user request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Create user result.</returns>
    [AllowAnonymous]
    [HttpPost("create-user")]
    [HttpPost("~/ptv/signup/create-user")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<PtvSignupResponse>> CreateUser(
        [FromBody] PtvSignupCreateUserRequest? request,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new PtvErrorResponse("PTV_SIGNUP_EMPTY_PAYLOAD", "Signup details are required."));
        }

        return Ok(await _signupService
            .CreateUserAsync(request, GetRemoteAddress(), cancellationToken)
            .ConfigureAwait(false));
    }

    /// <summary>
    /// Verifies a pending signup email link and finalizes user creation.
    /// </summary>
    /// <param name="request">Verification request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Verification result.</returns>
    [AllowAnonymous]
    [HttpPost("verify-email")]
    [HttpPost("~/ptv/signup/verify-email")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<PtvSignupResponse>> VerifyEmail(
        [FromBody] PtvSignupEmailVerificationRequest? request,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new PtvErrorResponse("PTV_SIGNUP_VERIFY_EMPTY_PAYLOAD", "Email verification token is required."));
        }

        return Ok(await _signupService
            .VerifyEmailAsync(request, GetRemoteAddress(), cancellationToken)
            .ConfigureAwait(false));
    }

    /// <summary>
    /// Sends a password reset code by email.
    /// </summary>
    /// <param name="request">Password reset request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Reset request result.</returns>
    [AllowAnonymous]
    [HttpPost("password-reset/request")]
    [HttpPost("~/ptv/signup/password-reset/request")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<PtvSignupResponse>> RequestPasswordReset(
        [FromBody] PtvSignupPasswordResetRequest? request,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new PtvErrorResponse("PTV_SIGNUP_RESET_EMPTY_PAYLOAD", "Email is required."));
        }

        return Ok(await _signupService
            .RequestPasswordResetAsync(request, GetRemoteAddress(), GetPasswordResetPageUrl(), cancellationToken)
            .ConfigureAwait(false));
    }

    /// <summary>
    /// Confirms a password reset code and sets a new password.
    /// </summary>
    /// <param name="request">Password reset confirmation request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Reset confirmation result.</returns>
    [AllowAnonymous]
    [HttpPost("password-reset/confirm")]
    [HttpPost("~/ptv/signup/password-reset/confirm")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<PtvSignupResponse>> ConfirmPasswordReset(
        [FromBody] PtvSignupPasswordResetConfirmRequest? request,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new PtvErrorResponse("PTV_SIGNUP_RESET_CONFIRM_EMPTY_PAYLOAD", "Reset code and new password are required."));
        }

        return Ok(await _signupService
            .ConfirmPasswordResetAsync(request, GetRemoteAddress(), cancellationToken)
            .ConfigureAwait(false));
    }

    /// <summary>
    /// Gets native PiggieTV signup settings for admins.
    /// </summary>
    /// <returns>Signup settings.</returns>
    [HttpGet("admin/settings")]
    [HttpGet("~/ptv/signup/admin/settings")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvSignupAdminSettingsResponse>> GetSettings()
    {
        if (!await CanAdminAsync().ConfigureAwait(false))
        {
            return ForbidSignupAdmin();
        }

        return Ok(_signupService.GetAdminSettings());
    }

    /// <summary>
    /// Saves native PiggieTV signup settings for admins.
    /// </summary>
    /// <param name="request">Settings patch.</param>
    /// <returns>Saved settings.</returns>
    [HttpPost("admin/settings")]
    [HttpPost("~/ptv/signup/admin/settings")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvSignupAdminSettingsResponse>> SaveSettings([FromBody] PtvSignupAdminSettingsPatch? request)
    {
        if (!await CanAdminAsync().ConfigureAwait(false))
        {
            return ForbidSignupAdmin();
        }

        if (request is null)
        {
            return BadRequest(new PtvErrorResponse("PTV_SIGNUP_SETTINGS_EMPTY_PAYLOAD", "Signup settings are required."));
        }

        return Ok(_signupService.SaveAdminSettings(request));
    }

    /// <summary>
    /// Sends a signup engine test email for admins.
    /// </summary>
    /// <param name="request">Test email request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Test result.</returns>
    [HttpPost("admin/email/test")]
    [HttpPost("~/ptv/signup/admin/email/test")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvSignupResponse>> SendTestEmail(
        [FromBody] PtvSignupTestEmailRequest? request,
        CancellationToken cancellationToken)
    {
        if (!await CanAdminAsync().ConfigureAwait(false))
        {
            return ForbidSignupAdmin();
        }

        return Ok(await _signupService
            .SendTestEmailAsync(request ?? new PtvSignupTestEmailRequest(), cancellationToken)
            .ConfigureAwait(false));
    }

    /// <summary>
    /// Gets native PiggieTV signup invites for admins.
    /// </summary>
    /// <returns>Invite list.</returns>
    [HttpGet("admin/invites")]
    [HttpGet("~/ptv/signup/admin/invites")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvSignupInviteListResponse>> GetInvites()
    {
        if (!await CanAdminAsync().ConfigureAwait(false))
        {
            return ForbidSignupAdmin();
        }

        return Ok(_signupService.GetAdminInvites());
    }

    /// <summary>
    /// Creates a native PiggieTV signup invite.
    /// </summary>
    /// <param name="request">Create invite request.</param>
    /// <returns>Created invite and one-time clear invite code.</returns>
    [HttpPost("admin/invites")]
    [HttpPost("~/ptv/signup/admin/invites")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvSignupInviteDto>> CreateInvite([FromBody] PtvSignupCreateInviteRequest? request)
    {
        if (!await CanAdminAsync().ConfigureAwait(false))
        {
            return ForbidSignupAdmin();
        }

        if (request is null)
        {
            return BadRequest(new PtvErrorResponse("PTV_SIGNUP_INVITE_EMPTY_PAYLOAD", "Invite settings are required."));
        }

        return Ok(_signupService.CreateInvite(request, User?.Identity?.Name ?? "admin"));
    }

    /// <summary>
    /// Disables a native PiggieTV signup invite.
    /// </summary>
    /// <param name="id">Invite id.</param>
    /// <returns>Disabled invite.</returns>
    [HttpPost("admin/invites/{id}/disable")]
    [HttpPost("~/ptv/signup/admin/invites/{id}/disable")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvSignupInviteDto>> DisableInvite(string id)
    {
        if (!await CanAdminAsync().ConfigureAwait(false))
        {
            return ForbidSignupAdmin();
        }

        return Ok(_signupService.DisableInvite(id));
    }

    /// <summary>
    /// Deletes a native PiggieTV signup invite.
    /// </summary>
    /// <param name="id">Invite id.</param>
    /// <returns>No content.</returns>
    [HttpDelete("admin/invites/{id}")]
    [HttpDelete("~/ptv/signup/admin/invites/{id}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult> DeleteInvite(string id)
    {
        if (!await CanAdminAsync().ConfigureAwait(false))
        {
            return ForbidSignupAdmin();
        }

        _signupService.DeleteInvite(id);
        return NoContent();
    }

    private string GetRemoteAddress()
    {
        return HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }

    private string GetPasswordResetPageUrl()
    {
        if (!Request.Host.HasValue)
        {
            return "/web/#/signup?mode=reset";
        }

        var pathBase = Request.PathBase.HasValue ? Request.PathBase.Value : string.Empty;

        return $"{Request.Scheme}://{Request.Host}{pathBase}/web/#/signup?mode=reset";
    }

    private async Task<bool> CanAdminAsync()
    {
        try
        {
            var result = await _authorizationService
                .AuthorizeAsync(User, Policies.RequiresElevation)
                .ConfigureAwait(false);

            return result.Succeeded;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV signup admin authorization check failed.");
            return false;
        }
    }

    private ActionResult ForbidSignupAdmin()
    {
        return StatusCode(
            StatusCodes.Status403Forbidden,
            new PtvErrorResponse("PTV_SIGNUP_ADMIN_FORBIDDEN", "Only Jellyfin administrators can manage PiggieTV signup invites."));
    }
}
