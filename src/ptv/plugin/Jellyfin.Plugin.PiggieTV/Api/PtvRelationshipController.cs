using System.Security.Claims;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Api;

/// <summary>
/// Authenticated reads and administrator writes for authoritative cross-library relationships.
/// </summary>
[ApiController]
[Authorize]
[Route("Ptv/v1/relationships")]
public sealed class PtvRelationshipController : BaseJellyfinApiController
{
    private const int MaximumMutationBytes = 16 * 1024;

    private readonly IAuthorizationService _authorizationService;
    private readonly ILogger<PtvRelationshipController> _logger;
    private readonly IPtvRelationshipMappingService _relationshipService;

    /// <summary>Initializes a new instance of the relationship controller.</summary>
    /// <param name="relationshipService">Authoritative relationship owner.</param>
    /// <param name="authorizationService">Jellyfin authorization service.</param>
    /// <param name="logger">Logger.</param>
    public PtvRelationshipController(
        IPtvRelationshipMappingService relationshipService,
        IAuthorizationService authorizationService,
        ILogger<PtvRelationshipController> logger)
    {
        _relationshipService = relationshipService;
        _authorizationService = authorizationService;
        _logger = logger;
    }

    /// <summary>Gets enabled authoritative relationships visible to the current user.</summary>
    /// <param name="sourceItemId">Source Jellyfin item identity.</param>
    /// <returns>Visible relationships.</returns>
    [HttpGet("{sourceItemId}")]
    [ProducesResponseType(typeof(PtvRelationshipMappingsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status404NotFound)]
    public ActionResult<PtvRelationshipMappingsResponse> GetRelationships([FromRoute] string sourceItemId)
    {
        if (!TryParseIdentity(sourceItemId, out var sourceIdentity))
        {
            return BadRequest(Error("PTV_RELATIONSHIPS_SOURCE_INVALID", "A valid source Jellyfin item identity is required."));
        }

        if (!TryGetAuthenticatedUserId(out var userId))
        {
            return Unauthorized(Error("PTV_RELATIONSHIPS_AUTH_REQUIRED", "An authenticated Jellyfin user identity is required."));
        }

        try
        {
            var response = _relationshipService.GetForSource(sourceIdentity, userId);
            return response is null
                ? NotFound(Error("PTV_RELATIONSHIPS_SOURCE_UNAVAILABLE", "The relationship source is unavailable to the current user."))
                : Ok(response);
        }
        catch (PtvRelationshipMappingException ex)
        {
            return StatusCode(ex.StatusCode, Error(ex.Code, ex.Message));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV authoritative relationship read failed.");
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                Error("PTV_RELATIONSHIPS_READ_FAILED", "The authoritative relationship read failed."));
        }
    }

    /// <summary>Creates one administrator-defined authoritative relationship.</summary>
    /// <param name="request">Create request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Created relationship.</returns>
    [HttpPost]
    [RequestSizeLimit(MaximumMutationBytes)]
    [ProducesResponseType(typeof(PtvRelationshipMappingDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<PtvRelationshipMappingDto>> CreateRelationship(
        [FromBody] PtvRelationshipMappingCreateRequest? request,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_RELATIONSHIPS_FORBIDDEN", "Only Jellyfin administrators can create authoritative relationships."));
        }

        if (request is null)
        {
            return BadRequest(Error("PTV_RELATIONSHIPS_PAYLOAD_REQUIRED", "A relationship mapping document is required."));
        }

        return ExecuteMutation(
            () => _relationshipService.Create(request),
            StatusCodes.Status201Created,
            "PTV_RELATIONSHIPS_CREATE_FAILED",
            "The authoritative relationship could not be created.");
    }

    /// <summary>Updates mutable properties of one authoritative relationship.</summary>
    /// <param name="mappingId">Mapping identity.</param>
    /// <param name="request">Update request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Updated relationship.</returns>
    [HttpPut("{mappingId}")]
    [RequestSizeLimit(MaximumMutationBytes)]
    [ProducesResponseType(typeof(PtvRelationshipMappingDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<PtvRelationshipMappingDto>> UpdateRelationship(
        [FromRoute] string mappingId,
        [FromBody] PtvRelationshipMappingUpdateRequest? request,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_RELATIONSHIPS_FORBIDDEN", "Only Jellyfin administrators can update authoritative relationships."));
        }

        if (!TryParseIdentity(mappingId, out var mappingIdentity))
        {
            return BadRequest(Error("PTV_RELATIONSHIPS_MAPPING_INVALID", "A valid relationship mapping identity is required."));
        }

        if (request is null)
        {
            return BadRequest(Error("PTV_RELATIONSHIPS_PAYLOAD_REQUIRED", "A relationship mapping update is required."));
        }

        return ExecuteMutation(
            () => _relationshipService.Update(mappingIdentity, request),
            StatusCodes.Status200OK,
            "PTV_RELATIONSHIPS_UPDATE_FAILED",
            "The authoritative relationship could not be updated.");
    }

    /// <summary>Deletes one authoritative relationship.</summary>
    /// <param name="mappingId">Mapping identity.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>No content after deletion.</returns>
    [HttpDelete("{mappingId}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(PtvErrorResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteRelationship(
        [FromRoute] string mappingId,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_RELATIONSHIPS_FORBIDDEN", "Only Jellyfin administrators can delete authoritative relationships."));
        }

        if (!TryParseIdentity(mappingId, out var mappingIdentity))
        {
            return BadRequest(Error("PTV_RELATIONSHIPS_MAPPING_INVALID", "A valid relationship mapping identity is required."));
        }

        try
        {
            _relationshipService.Delete(mappingIdentity);
            return NoContent();
        }
        catch (PtvRelationshipMappingException ex)
        {
            return StatusCode(ex.StatusCode, Error(ex.Code, ex.Message));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV authoritative relationship deletion failed.");
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                Error("PTV_RELATIONSHIPS_DELETE_FAILED", "The authoritative relationship could not be deleted."));
        }
    }

    private ActionResult<PtvRelationshipMappingDto> ExecuteMutation(
        Func<PtvRelationshipMappingDto> mutation,
        int successStatus,
        string failureCode,
        string failureMessage)
    {
        try
        {
            return StatusCode(successStatus, mutation());
        }
        catch (PtvRelationshipMappingException ex)
        {
            return StatusCode(ex.StatusCode, Error(ex.Code, ex.Message));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV authoritative relationship mutation failed.");
            return StatusCode(StatusCodes.Status500InternalServerError, Error(failureCode, failureMessage));
        }
    }

    private async Task<bool> IsAdministratorAsync(CancellationToken cancellationToken)
    {
        try
        {
            var result = await _authorizationService
                .AuthorizeAsync(User, resource: null, Policies.RequiresElevation)
                .ConfigureAwait(false);
            return result.Succeeded;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PiggieTV authoritative relationship authorization check failed.");
            cancellationToken.ThrowIfCancellationRequested();
            return false;
        }
    }

    private bool TryGetAuthenticatedUserId(out Guid userId)
    {
        var value = User.FindFirstValue("Jellyfin-UserId")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");
        return TryParseIdentity(value, out userId);
    }

    private static bool TryParseIdentity(string? value, out Guid identity) =>
        Guid.TryParse(value?.Trim(), out identity) && identity != Guid.Empty;

    private static PtvErrorResponse Error(string code, string message) => new(code, message);
}
