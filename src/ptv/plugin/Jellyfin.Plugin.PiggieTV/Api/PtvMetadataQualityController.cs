using System.Diagnostics;
using System.Globalization;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.PiggieTV.Api;

/// <summary>Administrator-only observational Metadata Quality API.</summary>
[ApiController]
[Authorize]
[Route("Ptv/v1/metadata-quality")]
public sealed class PtvMetadataQualityController : BaseJellyfinApiController
{
    private readonly IPtvMetadataQualityService _service;
    private readonly IAuthorizationService _authorizationService;

    public PtvMetadataQualityController(
        IPtvMetadataQualityService service,
        IAuthorizationService authorizationService)
    {
        _service = service;
        _authorizationService = authorizationService;
    }

    [HttpGet("status")]
    [ProducesResponseType(typeof(PtvMetadataQualityStatusResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvMetadataQualityStatusResponse>> GetStatus(CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        try { return Ok(await _service.GetStatusAsync(cancellationToken).ConfigureAwait(false)); }
        catch (Exception ex) { return ToError(ex); }
    }

    [HttpGet("summary")]
    [ProducesResponseType(typeof(PtvMetadataQualitySummaryResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvMetadataQualitySummaryResponse>> GetSummary(CancellationToken cancellationToken)
    {
        var authorizationStarted = Stopwatch.GetTimestamp();
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        var authorizationMs = Stopwatch.GetElapsedTime(authorizationStarted).TotalMilliseconds;
        try
        {
            var response = await _service.GetSummaryAsync(cancellationToken).ConfigureAwait(false);
            ApplyControllerDiagnostics(response.Diagnostics, authorizationMs);
            return Ok(response);
        }
        catch (Exception ex) { return ToError(ex); }
    }

    [HttpGet("results")]
    [ProducesResponseType(typeof(PtvMetadataQualityResultsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvMetadataQualityResultsResponse>> GetResults(
        [FromQuery] PtvMetadataQualityResultQuery query,
        CancellationToken cancellationToken)
    {
        var authorizationStarted = Stopwatch.GetTimestamp();
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        var authorizationMs = Stopwatch.GetElapsedTime(authorizationStarted).TotalMilliseconds;
        try
        {
            var response = await _service.GetResultsAsync(query, cancellationToken).ConfigureAwait(false);
            ApplyControllerDiagnostics(response.Diagnostics, authorizationMs);
            return Ok(response);
        }
        catch (Exception ex) { return ToError(ex); }
    }

    private void ApplyControllerDiagnostics(PtvMetadataQualityRequestDiagnostics diagnostics, double authorizationMs)
    {
        var applicationMs = diagnostics.TotalMs;
        var totalMs = authorizationMs + applicationMs;
        diagnostics.Stages["authorization"] = authorizationMs;
        diagnostics.TotalMs = totalMs;
        Response.Headers["Server-Timing"] = string.Create(
            CultureInfo.InvariantCulture,
            $"authorization;dur={authorizationMs:F2}, application;dur={applicationMs:F2}, total;dur={totalMs:F2}");
    }

    [HttpGet("results/{itemId:guid}")]
    [ProducesResponseType(typeof(PtvMetadataQualityResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvMetadataQualityResult>> GetResult(Guid itemId, CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        try
        {
            var result = await _service.GetResultAsync(itemId, cancellationToken).ConfigureAwait(false);
            return result is null
                ? NotFound(new PtvErrorResponse("PTV_METADATA_QUALITY_RESULT_NOT_FOUND", "This Metadata Quality result is no longer available."))
                : Ok(result);
        }
        catch (Exception ex) { return ToError(ex); }
    }

    [HttpPost("scan")]
    [ProducesResponseType(typeof(PtvMetadataQualitySummaryResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvMetadataQualitySummaryResponse>> StartScan(
        [FromBody] PtvMetadataQualityScanRequest? request,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        if (request is null) return BadRequest(new PtvErrorResponse("PTV_METADATA_QUALITY_REQUEST_REQUIRED", "Scan options are required."));
        try { return Ok(await _service.StartScanAsync(request, cancellationToken).ConfigureAwait(false)); }
        catch (Exception ex) { return ToError(ex); }
    }

    [HttpPost("scan/cancel")]
    [ProducesResponseType(typeof(PtvMetadataQualitySummaryResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvMetadataQualitySummaryResponse>> CancelScan(CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        try { return Ok(await _service.CancelScanAsync(cancellationToken).ConfigureAwait(false)); }
        catch (Exception ex) { return ToError(ex); }
    }

    [HttpPost("results/{itemId:guid}/resolve")]
    [ProducesResponseType(typeof(PtvMetadataQualityResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvMetadataQualityResult>> Resolve(
        Guid itemId,
        [FromBody] PtvMetadataQualityResolveRequest? request,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        if (request is null) return BadRequest(new PtvErrorResponse("PTV_METADATA_QUALITY_REQUEST_REQUIRED", "A review action is required."));
        try
        {
            var result = await _service.ResolveAsync(itemId, request.Action, cancellationToken).ConfigureAwait(false);
            return result is null
                ? NotFound(new PtvErrorResponse("PTV_METADATA_QUALITY_RESULT_NOT_FOUND", "This Metadata Quality result is no longer available."))
                : Ok(result);
        }
        catch (Exception ex) { return ToError(ex); }
    }

    /// <summary>Rebuilds the derived indexed store from the retained JSON migration source.</summary>
    [HttpPost("index/rebuild")]
    [ProducesResponseType(typeof(PtvMetadataQualitySummaryResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvMetadataQualitySummaryResponse>> RebuildIndex(
        [FromBody] PtvMetadataQualityIndexRebuildRequest? request,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        if (request?.Confirm != true)
        {
            return BadRequest(new PtvErrorResponse(
                "PTV_METADATA_QUALITY_REBUILD_CONFIRMATION_REQUIRED",
                "Explicit confirmation is required to rebuild the Metadata Quality index."));
        }

        try { return Ok(await _service.RebuildIndexAsync(cancellationToken).ConfigureAwait(false)); }
        catch (Exception ex) { return ToError(ex); }
    }

    [HttpGet("settings")]
    [ProducesResponseType(typeof(PtvMetadataQualitySettings), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvMetadataQualitySettings>> GetSettings(CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        try { return Ok(await _service.GetSettingsAsync(cancellationToken).ConfigureAwait(false)); }
        catch (Exception ex) { return ToError(ex); }
    }

    [HttpPost("ai/test")]
    [ProducesResponseType(typeof(PtvMetadataAiConnectionTestResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvMetadataAiConnectionTestResponse>> TestAiConnection(
        [FromBody] PtvMetadataAiConnectionTestRequest? request,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        try
        {
            return Ok(await _service
                .TestAiConnectionAsync(request ?? new PtvMetadataAiConnectionTestRequest(), cancellationToken)
                .ConfigureAwait(false));
        }
        catch (Exception ex) { return ToError(ex); }
    }

    [HttpPost("settings")]
    [ProducesResponseType(typeof(PtvMetadataQualitySettings), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvMetadataQualitySettings>> SaveSettings(
        [FromBody] PtvMetadataQualitySettings? settings,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();
        if (settings is null) return BadRequest(new PtvErrorResponse("PTV_METADATA_QUALITY_REQUEST_REQUIRED", "Metadata Quality settings are required."));
        try { return Ok(await _service.SaveSettingsAsync(settings, cancellationToken).ConfigureAwait(false)); }
        catch (Exception ex) { return ToError(ex); }
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
        var (code, message) = exception switch
        {
            PtvMetadataQualityServiceException service => (service.Code, service.Message),
            PtvMetadataQualityStoreException store => (store.Code, store.Message),
            _ => ("PTV_METADATA_QUALITY_UNAVAILABLE", "The Metadata Quality service is temporarily unavailable.")
        };

        var body = new PtvErrorResponse(code, message);
        if (code.EndsWith("_NOT_FOUND", StringComparison.Ordinal)) return NotFound(body);
        if (code.Contains("INVALID", StringComparison.Ordinal) || code.EndsWith("_REQUIRED", StringComparison.Ordinal)) return BadRequest(body);
        if (code.EndsWith("_RUNNING", StringComparison.Ordinal) || code.EndsWith("_CONFLICT", StringComparison.Ordinal)) return Conflict(body);
        if (code.Contains("CORRUPT", StringComparison.Ordinal) || code.Contains("UNAVAILABLE", StringComparison.Ordinal)) return StatusCode(StatusCodes.Status503ServiceUnavailable, body);
        return StatusCode(StatusCodes.Status500InternalServerError, body);
    }
}
