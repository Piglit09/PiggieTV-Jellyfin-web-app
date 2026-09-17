using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Api;

/// <summary>Authenticated, privacy-minimized media issue intake and admin review.</summary>
[ApiController]
[Authorize]
[Route("Ptv/v1/reports/media")]
public sealed class PtvMediaReportsController : BaseJellyfinApiController
{
    private readonly IAuthorizationService _authorizationService;
    private readonly Func<Guid, Guid, bool> _canAccessItem;
    private readonly ILogger<PtvMediaReportsController> _logger;
    private readonly IPtvMediaReportStore _store;

    /// <summary>Initializes the production media-report controller.</summary>
    public PtvMediaReportsController(
        ILogger<PtvMediaReportsController> logger,
        IPtvMediaReportStore store,
        IAuthorizationService authorizationService,
        ILibraryManager libraryManager)
        : this(
            logger,
            store,
            authorizationService,
            (itemId, userId) => libraryManager.GetItemById<BaseItem>(itemId, userId) is not null)
    {
    }

    /// <summary>Initializes a controller with a deterministic visibility resolver for tests.</summary>
    internal PtvMediaReportsController(
        ILogger<PtvMediaReportsController> logger,
        IPtvMediaReportStore store,
        IAuthorizationService authorizationService,
        Func<Guid, Guid, bool> canAccessItem)
    {
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _authorizationService = authorizationService ?? throw new ArgumentNullException(nameof(authorizationService));
        _canAccessItem = canAccessItem ?? throw new ArgumentNullException(nameof(canAccessItem));
    }

    /// <summary>Accepts one explicit, user-initiated media issue.</summary>
    [HttpPost]
    [RequestSizeLimit(PtvMediaReportValidator.MaximumRequestBytes)]
    [ProducesResponseType(typeof(PtvMediaReportAcceptedResponse), StatusCodes.Status202Accepted)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status413PayloadTooLarge)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status429TooManyRequests)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<PtvMediaReportAcceptedResponse>> Submit(
        [FromBody] PtvMediaReportRequest? request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAuthenticatedUser(out var userId, out var ownerKey))
        {
            return Unauthorized(new PtvErrorResponse(
                "PTV_MEDIA_REPORT_AUTH_REQUIRED",
                "An authenticated Jellyfin user identity is required."));
        }

        if (!PtvMediaReportValidator.TryNormalize(
                request,
                out var itemId,
                out var normalized,
                out var errorCode,
                out var errorMessage))
        {
            return BadRequest(new PtvErrorResponse(errorCode, errorMessage));
        }

        if (!_canAccessItem(itemId, userId))
        {
            return NotFound(new PtvErrorResponse(
                "PTV_MEDIA_REPORT_ITEM_NOT_FOUND",
                "The requested Jellyfin item was not found."));
        }

        PtvMediaReportSubmissionResult result;
        try
        {
            result = await _store.SubmitAsync(ownerKey, normalized, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.LogWarning(ex, "PiggieTV media-report submission storage failed.");
            result = new PtvMediaReportSubmissionResult { Status = PtvMediaReportSubmissionStatus.Unavailable };
        }

        if (result.Status == PtvMediaReportSubmissionStatus.RateLimited)
        {
            Response.Headers.RetryAfter = Math.Max(1, result.RetryAfterSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture);
            return StatusCode(StatusCodes.Status429TooManyRequests, new PtvErrorResponse(
                "PTV_MEDIA_REPORT_RATE_LIMITED",
                "Too many media reports were submitted. Retry after the indicated delay."));
        }

        if (result.Status != PtvMediaReportSubmissionStatus.Accepted || result.Record is null)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new PtvErrorResponse(
                "PTV_MEDIA_REPORT_STORAGE_UNAVAILABLE",
                "Media reporting is temporarily unavailable."));
        }

        return Accepted(new PtvMediaReportAcceptedResponse
        {
            ReceivedAtUtc = result.Record.ReceivedAtUtc,
            ReportId = result.Record.ReportId
        });
    }

    /// <summary>Lists newest retained reports for an administrator.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<PtvMediaReportRecord>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PtvMediaReportRecord>>> GetReports(
        [FromQuery] int limit = 100,
        CancellationToken cancellationToken = default)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false))
        {
            return Forbid();
        }

        if (limit is < 1 or > PtvMediaReportStore.MaximumReadLimit)
        {
            return BadRequest(new PtvErrorResponse(
                "PTV_MEDIA_REPORT_LIMIT_INVALID",
                $"limit must be between 1 and {PtvMediaReportStore.MaximumReadLimit}."));
        }

        try
        {
            return Ok(await _store.GetReportsAsync(limit, cancellationToken).ConfigureAwait(false));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.LogWarning(ex, "PiggieTV media-report storage read failed.");
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new PtvErrorResponse(
                "PTV_MEDIA_REPORT_STORAGE_UNAVAILABLE",
                "Media-report storage is temporarily unavailable."));
        }
    }

    /// <summary>Deletes one retained report after administrator review.</summary>
    [HttpDelete("{reportId}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> Delete(string reportId, CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false))
        {
            return Forbid();
        }

        if (!Guid.TryParseExact(reportId, "N", out _))
        {
            return BadRequest(new PtvErrorResponse(
                "PTV_MEDIA_REPORT_ID_INVALID",
                "reportId must be a valid PiggieTV report identifier."));
        }

        try
        {
            return await _store.DeleteAsync(reportId, cancellationToken).ConfigureAwait(false)
                ? NoContent()
                : NotFound(new PtvErrorResponse(
                    "PTV_MEDIA_REPORT_NOT_FOUND",
                    "The requested media report was not found."));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.LogWarning(ex, "PiggieTV media-report deletion failed.");
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new PtvErrorResponse(
                "PTV_MEDIA_REPORT_STORAGE_UNAVAILABLE",
                "Media-report storage is temporarily unavailable."));
        }
    }

    private async Task<bool> IsAdministratorAsync()
    {
        try
        {
            return (await _authorizationService
                .AuthorizeAsync(User, resource: null, Policies.RequiresElevation)
                .ConfigureAwait(false)).Succeeded;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PiggieTV media-report administrator authorization failed.");
            return false;
        }
    }

    private bool TryGetAuthenticatedUser(out Guid userId, out string ownerKey)
    {
        userId = Guid.Empty;
        ownerKey = string.Empty;
        var identity = User.FindFirstValue("Jellyfin-UserId")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");
        if (!Guid.TryParse(identity, out userId) || userId == Guid.Empty)
        {
            return false;
        }

        ownerKey = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(userId.ToString("N"))));
        return true;
    }
}
