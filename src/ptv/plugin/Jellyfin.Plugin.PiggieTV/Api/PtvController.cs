using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.PiggieTV.Api;

/// <summary>
/// Minimal PiggieTV plugin API.
/// </summary>
[ApiController]
[Authorize]
[Route(PtvApiRoutes.Root)]
public sealed class PtvController : ControllerBase
{
    private readonly IAuthorizationService _authorizationService;
    private readonly IPtvFeaturedContentRefreshService _featuredContentRefreshService;
    private readonly IPtvFeaturedContentStore _featuredContentStore;

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvController"/> class.
    /// </summary>
    /// <param name="authorizationService">Authorization service.</param>
    /// <param name="featuredContentRefreshService">Featured-content refresh service.</param>
    /// <param name="featuredContentStore">Featured-content cache store.</param>
    public PtvController(
        IAuthorizationService authorizationService,
        IPtvFeaturedContentRefreshService featuredContentRefreshService,
        IPtvFeaturedContentStore featuredContentStore)
    {
        _authorizationService = authorizationService;
        _featuredContentRefreshService = featuredContentRefreshService;
        _featuredContentStore = featuredContentStore;
    }

    /// <summary>
    /// Gets PiggieTV plugin health and capability information.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Plugin status.</returns>
    [HttpGet(PtvApiRoutes.V1Status)]
    [HttpGet(PtvApiRoutes.LegacyStatus)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<PtvStatusResponse>> GetStatus(CancellationToken cancellationToken)
    {
        var storeStatus = await _featuredContentStore.GetStatusAsync(cancellationToken).ConfigureAwait(false);
        var canWriteFeaturedContent = await CanWriteFeaturedContentAsync().ConfigureAwait(false);

        return Ok(PtvStatusResponse.FromStoreStatus(
            storeStatus,
            canWriteFeaturedContent,
            _featuredContentRefreshService.GetRefreshStatus(storeStatus)));
    }

    /// <summary>
    /// Gets the shared PiggieTV featured-content cache document.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Featured-content cache document.</returns>
    [HttpGet(PtvApiRoutes.V1FeaturedContent)]
    [HttpGet(PtvApiRoutes.LegacyFeaturedContent)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<PtvFeaturedContentDocument>> GetFeaturedContent(CancellationToken cancellationToken)
    {
        var document = await _featuredContentStore.ReadAsync(cancellationToken).ConfigureAwait(false);

        return Ok(document);
    }

    /// <summary>
    /// Replaces the shared PiggieTV featured-content cache document.
    /// </summary>
    /// <param name="document">Featured-content cache document.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The stored featured-content cache document.</returns>
    [HttpPut(PtvApiRoutes.V1FeaturedContent)]
    [HttpPut(PtvApiRoutes.LegacyFeaturedContent)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvFeaturedContentDocument>> PutFeaturedContent(
        [FromBody] PtvFeaturedContentDocument? document,
        CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentAsync().ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_CACHE_WRITE_FORBIDDEN", "Only Jellyfin administrators can write the shared PiggieTV featured-content cache."));
        }

        if (document is null)
        {
            return BadRequest(Error("PTV_CACHE_NULL_DOCUMENT", "A featured-content cache document is required."));
        }

        try
        {
            var storedDocument = await _featuredContentStore.WriteAsync(document, cancellationToken).ConfigureAwait(false);

            return Ok(storedDocument);
        }
        catch (PtvFeaturedContentValidationException ex)
        {
            return BadRequest(Error(ex.Code, ex.Message));
        }
    }

    /// <summary>
    /// Clears the shared PiggieTV featured-content cache document.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Empty featured-content cache document.</returns>
    [HttpDelete(PtvApiRoutes.V1FeaturedContent)]
    [HttpDelete(PtvApiRoutes.LegacyFeaturedContent)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvFeaturedContentDocument>> DeleteFeaturedContent(CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentAsync().ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_CACHE_CLEAR_FORBIDDEN", "Only Jellyfin administrators can clear the shared PiggieTV featured-content cache."));
        }

        await _featuredContentStore.ClearAsync(cancellationToken).ConfigureAwait(false);

        return Ok(PtvFeaturedContentValidator.CreateEmptyDocument());
    }

    /// <summary>
    /// Triggers a server-side refresh of the shared PiggieTV featured-content cache.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Plugin status after the refresh attempt.</returns>
    [HttpPost(PtvApiRoutes.V1FeaturedContentRefresh)]
    [HttpPost(PtvApiRoutes.LegacyFeaturedContentRefresh)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvStatusResponse>> RefreshFeaturedContent(CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentAsync().ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_CACHE_REFRESH_FORBIDDEN", "Only Jellyfin administrators can refresh the shared PiggieTV featured-content cache."));
        }

        var storeStatus = await _featuredContentRefreshService.RefreshAsync(cancellationToken).ConfigureAwait(false);

        return Ok(PtvStatusResponse.FromStoreStatus(
            storeStatus,
            canWriteFeaturedContent: true,
            refreshStatus: _featuredContentRefreshService.GetRefreshStatus(storeStatus)));
    }

    private async Task<bool> CanWriteFeaturedContentAsync()
    {
        var result = await _authorizationService
            .AuthorizeAsync(User, Policies.RequiresElevation)
            .ConfigureAwait(false);

        return result.Succeeded;
    }

    private static PtvErrorResponse Error(string code, string message)
    {
        return new PtvErrorResponse(code, message);
    }
}
