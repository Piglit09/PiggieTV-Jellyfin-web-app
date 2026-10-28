using System.Security.Claims;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.PiggieTV.Api;

/// <summary>Administrator-only provider-neutral Reading identification API.</summary>
[ApiController]
[Authorize]
[Route("Ptv/v1/reading/metadata")]
public sealed class PtvReadingMetadataController : BaseJellyfinApiController
{
    private readonly IAuthorizationService _authorizationService;
    private readonly IPtvReadingMetadataIdentificationService _service;

    public PtvReadingMetadataController(
        IPtvReadingMetadataIdentificationService service,
        IAuthorizationService authorizationService)
    {
        _service = service;
        _authorizationService = authorizationService;
    }

    [HttpGet("providers")]
    [ProducesResponseType(typeof(PtvReadingMetadataProvidersResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvReadingMetadataProvidersResponse>> GetProviders(CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        try { return Ok(await _service.GetProvidersAsync(cancellationToken).ConfigureAwait(false)); }
        catch (Exception ex) { return ToError(ex); }
    }

    [HttpPost("search")]
    [ProducesResponseType(typeof(PtvReadingMetadataSearchResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvReadingMetadataSearchResponse>> Search(
        [FromBody] PtvReadingMetadataSearchRequest? request,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        if (!TryGetAuthenticatedUserId(out var administratorId)) return Unauthorized();
        if (request is null)
        {
            return BadRequest(new PtvErrorResponse("PTV_READING_REQUEST_REQUIRED", "Reading search criteria are required."));
        }

        try { return Ok(await _service.SearchAsync(request, administratorId, cancellationToken).ConfigureAwait(false)); }
        catch (Exception ex) { return ToError(ex); }
    }

    [HttpPost("reassess")]
    [ProducesResponseType(typeof(PtvReadingIdentityAssessment), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<PtvReadingIdentityAssessment>> Reassess(
        [FromBody] PtvReadingIdentityReassessRequest? request, CancellationToken cancellationToken)
    {
        if (!TryGetAuthenticatedUserId(out var administratorId)) return Unauthorized();
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        if (request is null) return BadRequest(new PtvErrorResponse("PTV_READING_REQUEST_REQUIRED", "A candidate context is required."));
        try { return Ok(await _service.ReassessAsync(request, administratorId, cancellationToken).ConfigureAwait(false)); }
        catch (Exception ex) { return ToError(ex); }
    }

    private bool TryGetAuthenticatedUserId(out Guid userId)
    {
        userId = Guid.Empty;
        var authenticatedIdentities = User.Identities
            .Where(identity => identity.IsAuthenticated)
            .ToArray();
        if (authenticatedIdentities.Length == 0)
        {
            return false;
        }

        var jellyfinUserClaims = authenticatedIdentities
            .SelectMany(identity => identity.FindAll("Jellyfin-UserId"))
            .ToArray();
        if (jellyfinUserClaims.Length > 0)
        {
            return TryResolveUniqueUserId(jellyfinUserClaims, out userId);
        }

        var fallbackClaims = authenticatedIdentities
            .SelectMany(identity => identity.FindAll(ClaimTypes.NameIdentifier).Concat(identity.FindAll("sub")))
            .ToArray();
        return TryResolveUniqueUserId(fallbackClaims, out userId);
    }

    private static bool TryResolveUniqueUserId(IEnumerable<Claim> claims, out Guid userId)
    {
        userId = Guid.Empty;
        var resolvedUserIds = new HashSet<Guid>();
        foreach (var claim in claims)
        {
            if (!Guid.TryParse(claim.Value.Trim(), out var resolvedUserId)
                || resolvedUserId == Guid.Empty)
            {
                return false;
            }

            resolvedUserIds.Add(resolvedUserId);
            if (resolvedUserIds.Count > 1)
            {
                return false;
            }
        }

        if (resolvedUserIds.Count != 1)
        {
            return false;
        }

        userId = resolvedUserIds.Single();
        return true;
    }

    private async Task<bool> IsAdministratorAsync()
    {
        var result = await _authorizationService
            .AuthorizeAsync(User, resource: null, Policies.RequiresElevation)
            .ConfigureAwait(false);
        return result.Succeeded;
    }

    private ActionResult ToError(Exception exception)
    {
        if (exception is OperationCanceledException) throw exception;
        var (code, message) = exception is PtvReadingMetadataServiceException service
            ? (service.Code, service.Message)
            : ("PTV_READING_METADATA_UNAVAILABLE", "Reading metadata identification is temporarily unavailable.");
        var body = new PtvErrorResponse(code, message);
        if (code.EndsWith("_NOT_FOUND", StringComparison.Ordinal)) return NotFound(body);
        if (code.Contains("INVALID", StringComparison.Ordinal) || code.EndsWith("_REQUIRED", StringComparison.Ordinal)) return BadRequest(body);
        if (code.Contains("UNAVAILABLE", StringComparison.Ordinal)) return StatusCode(StatusCodes.Status503ServiceUnavailable, body);
        return StatusCode(StatusCodes.Status500InternalServerError, body);
    }
}
