using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Jellyfin.Plugin.PiggieTV.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Common.Api;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Nodes;

namespace Jellyfin.Plugin.PiggieTV.Api;

/// <summary>
/// Minimal PiggieTV plugin API.
/// </summary>
[ApiController]
[Authorize]
[Route("Ptv/v1")]
public sealed class PtvStatusController : BaseJellyfinApiController
{
    private static readonly JsonSerializerOptions SettingsPatchJsonOptions = new(JsonSerializerDefaults.Web)
    {
        AllowTrailingCommas = true,
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip
    };

    private readonly ILogger<PtvStatusController> _logger;
    private readonly IServiceProvider _serviceProvider;

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvStatusController"/> class.
    /// </summary>
    /// <param name="logger">Logger.</param>
    /// <param name="serviceProvider">Application service provider.</param>
    public PtvStatusController(
        ILogger<PtvStatusController> logger,
        IServiceProvider serviceProvider)
    {
        _logger = logger;
        _serviceProvider = serviceProvider;

        _logger.LogInformation(
            "PtvStatusController loaded. Routes: GET /Ptv/v1/status, GET/POST /Ptv/v1/rows, GET /Ptv/v1/settings, GET /Ptv/v1/featured, POST /Ptv/v1/featured/refresh, GET /Ptv/v1/diagnostics/images/{{itemId}}, GET /Ptv/v1/music/metadata/search, GET /Ptv/v1/reading/metadata/googlebooks/search, GET/POST /Ptv/v1/tmdb/test, GET /Ptv/v1/integrations/status, GET /Ptv/v1/calendar, GET /Ptv/v1/integrations/arr/calendar, GET /Ptv/v1/tags, GET /Ptv/v1/random/movie.");
    }

    /// <summary>
    /// Gets PiggieTV plugin health and capability information.
    /// </summary>
    /// <param name="full">Whether to run full subsystem diagnostics.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Plugin status.</returns>
    [HttpGet("status")]
    [HttpGet("~/Ptv/Status")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult> GetStatus([FromQuery] bool full, CancellationToken cancellationToken)
    {
        _logger.LogInformation("PiggieTV status endpoint called. Full={FullDiagnostics}.", full);

        try
        {
            if (!full)
            {
                _logger.LogInformation("PiggieTV status safe-mode: skipping cache/config/settings/DTO hydration.");
                _logger.LogInformation("Advertising feature: status");
                _logger.LogInformation("Advertising feature: settings");
                _logger.LogInformation("Advertising feature: rows");
                _logger.LogInformation("Advertising feature: featuredContent");
                _logger.LogInformation("Advertising feature: featuredContentRefresh");
                _logger.LogInformation("Advertising feature: integrations");
                _logger.LogInformation("Advertising feature: tags");
                _logger.LogInformation("Advertising feature: random");

                var safeResponse = new
                {
                    apiPath = $"/{PtvApiRoutes.Root}/{PtvApiRoutes.V1}",
                    apiVersion = PtvApiRoutes.CurrentVersion,
                    buildTimestampUtc = Plugin.BuildTimestampUtc,
                    cacheBackend = "plugin-file",
                    canReadFeaturedContent = true,
                    featureFlags = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase)
                    {
                        ["status"] = true,
                        ["settings"] = true,
                        ["rows"] = true,
                        ["featuredContent"] = true,
                        ["featuredContentRefresh"] = true,
                        ["musicMetadata"] = true,
                        ["readingMetadata"] = true,
                        ["integrations"] = true,
                        ["signup"] = true,
                        ["tags"] = true,
                        ["random"] = true
                    },
                    features = new[]
                    {
                        "status",
                        "settings",
                        "rows",
                        "featuredContent",
                        "featuredContentRefresh",
                        "musicMetadata",
                        "readingMetadata",
                        "integrations",
                        "signup",
                        "tags",
                        "random"
                    },
                    ok = true,
                    integrations = PtvStatusIntegrations.Create(),
                    signup = PtvStatusSignup.Create(),
                    name = "PiggieTV",
                    pluginName = "PiggieTV",
                    pluginVersion = Plugin.Instance?.Version?.ToString() ?? "1.0.0.0",
                    settingsAvailable = true,
                    version = Plugin.Instance?.Version?.ToString() ?? "1.0.0.0"
                };

                _logger.LogInformation("PiggieTV status safe-mode response built. Returning minimal JSON.");

                return Ok(safeResponse);
            }

            _logger.LogInformation("PiggieTV status full diagnostics: loading cache.");
            var failures = new List<string>();
            var storeStatus = await GetStoreStatusOrFallbackAsync(PtvApiRoutes.V1StatusLower, failures, cancellationToken).ConfigureAwait(false)
                ?? CreateFallbackStoreStatus("Cache status returned null.");
            var statusFeatured = PtvFeaturedContentStatus.FromDocument(storeStatus.Document);

            _logger.LogInformation(
                "PiggieTV status full diagnostics: cache loaded. CacheFilePath={CacheFilePath}. CachePayloadBytes={CachePayloadBytes}. CachePathExists={CachePathExists}. FeaturedCacheExists={FeaturedCacheExists}. FeaturedCacheFresh={FeaturedCacheFresh}. CacheVersion={CacheVersion}. HasPayload={HasPayload}. HeroCount={HeroCount}. SectionCount={SectionCount}. ItemCount={ItemCount}. CacheWriteError={CacheWriteError}.",
                storeStatus.CacheFilePath,
                storeStatus.CachePayloadBytes,
                storeStatus.CachePathExists,
                storeStatus.FeaturedCacheExists,
                storeStatus.FeaturedCacheFresh,
                statusFeatured.CacheVersion,
                statusFeatured.HasPayload,
                statusFeatured.HeroCount,
                statusFeatured.SectionCount,
                statusFeatured.ItemCount,
                storeStatus.CacheWriteError);

            _logger.LogInformation("PiggieTV status full diagnostics: loading authorization/write capability.");
            var canWriteFeaturedContent = await CanWriteFeaturedContentSafeAsync(PtvApiRoutes.V1StatusLower, failures).ConfigureAwait(false);

            _logger.LogInformation("PiggieTV status full diagnostics: loading refresh status.");
            var refreshStatus = GetRefreshStatusOrFallback(PtvApiRoutes.V1StatusLower, storeStatus, failures) ?? new PtvFeaturedContentRefreshStatus();

            _logger.LogInformation("PiggieTV status full diagnostics: loading TMDb status.");
            var tmdbStatus = GetTmdbStatusOrFallback(PtvApiRoutes.V1StatusLower, failures) ?? new PtvTmdbMetadataStatus();

            _logger.LogInformation("PiggieTV status full diagnostics: loading config/settings.");
            var settingsAvailable = TryGetSettingsAvailable(PtvApiRoutes.V1StatusLower, failures);

            _logger.LogInformation("PiggieTV status full diagnostics: building DTO.");
            var response = PtvStatusResponse.FromStoreStatus(
                storeStatus,
                canWriteFeaturedContent,
                refreshStatus,
                tmdbStatus);

            response.SettingsAvailable = settingsAvailable;
            response.Integrations = GetStatusIntegrations(PtvApiRoutes.V1StatusLower);
            response.Signup = GetStatusSignup(PtvApiRoutes.V1StatusLower);
            ApplyDegradedStatus(response, failures);

            var serializedStatusBytes = JsonSerializer.SerializeToUtf8Bytes(response).Length;
            _logger.LogInformation(
                "PiggieTV status full diagnostics: DTO built. Ok={Ok}. Degraded={Degraded}. CacheHealthy={CacheHealthy}. SerializedResponseBytes={SerializedResponseBytes}. Preparing JSON serialization.",
                response.Ok,
                response.Degraded,
                response.CacheHealthy,
                serializedStatusBytes);
            _logger.LogInformation("PiggieTV status full diagnostics: response returned.");
            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "PiggieTV status endpoint crashed. Message={Message} Inner={Inner}",
                RedactSecrets(ex.Message),
                ex.InnerException is null ? null : RedactSecrets(ex.InnerException.Message));

            var fallbackResponse = CreateFallbackStatus(
                canWriteFeaturedContent: false,
                settingsAvailable: false,
                error: $"Full status diagnostics failed: {RedactSecrets(ex.Message)}");
            fallbackResponse.Integrations = PtvStatusIntegrations.Create();
            fallbackResponse.Signup = PtvStatusSignup.Create();

            return Ok(fallbackResponse);
        }
    }

    /// <summary>
    /// Diagnoses Jellyfin's stored image metadata and image endpoint health for one item.
    /// </summary>
    /// <param name="itemId">Jellyfin item id from the route.</param>
    /// <param name="queryItemId">Jellyfin item id from the query string.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Image storage diagnostics.</returns>
    [HttpGet("diagnostics/images/{itemId}")]
    [HttpGet("diagnostics/images")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PtvItemImageDiagnosticResponse>> GetItemImageDiagnostics(
        [FromRoute] string? itemId,
        [FromQuery(Name = "itemId")] string? queryItemId,
        CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync(PtvApiRoutes.V1ImageDiagnostics).ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_IMAGE_DIAGNOSTIC_FORBIDDEN", "Only Jellyfin administrators can inspect server image diagnostics."));
        }

        var requestedItemId = (itemId ?? queryItemId)?.Trim();

        if (string.IsNullOrWhiteSpace(requestedItemId))
        {
            return BadRequest(Error("PTV_IMAGE_DIAGNOSTIC_ITEM_REQUIRED", "An itemId is required."));
        }

        if (!TryParseItemId(requestedItemId, out var parsedItemId))
        {
            return BadRequest(Error("PTV_IMAGE_DIAGNOSTIC_BAD_ITEM_ID", "The itemId is not a valid Jellyfin item id."));
        }

        try
        {
            var libraryManager = GetRequiredService<ILibraryManager>(PtvApiRoutes.V1ImageDiagnostics);
            var item = libraryManager.GetItemById(parsedItemId);

            if (item is null)
            {
                return NotFound(Error("PTV_IMAGE_DIAGNOSTIC_ITEM_NOT_FOUND", "The requested Jellyfin item was not found."));
            }

            using var httpClient = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(8)
            };

            var primaryEntry = await BuildImageDiagnosticEntryAsync(
                httpClient,
                item,
                ImageType.Primary,
                0,
                cancellationToken).ConfigureAwait(false);

            var response = new PtvItemImageDiagnosticResponse
            {
                Ok = true,
                ItemId = item.Id.ToString("N"),
                ItemName = item.Name,
                ItemType = item.GetType().Name,
                MediaType = item.MediaType.ToString(),
                PrimaryImageTag = primaryEntry.ImageTag,
                PrimaryImagePath = primaryEntry.ImagePath,
                PrimaryImageFileExists = primaryEntry.FileExists,
                PrimaryImageEndpointStatus = primaryEntry.ImageTag is null
                    ? primaryEntry.UntaggedEndpointStatus
                    : primaryEntry.TaggedEndpointStatus
            };

            response.Images.Add(primaryEntry);
            response.Images.Add(await BuildImageDiagnosticEntryAsync(httpClient, item, ImageType.Thumb, 0, cancellationToken).ConfigureAwait(false));
            response.Images.Add(await BuildImageDiagnosticEntryAsync(httpClient, item, ImageType.Logo, 0, cancellationToken).ConfigureAwait(false));
            response.Images.Add(await BuildImageDiagnosticEntryAsync(httpClient, item, ImageType.Backdrop, 0, cancellationToken).ConfigureAwait(false));

            for (var backdropIndex = 1; backdropIndex < 3; backdropIndex++)
            {
                var backdrop = GetImageInfoSafe(item, ImageType.Backdrop, backdropIndex);

                if (backdrop is null)
                {
                    break;
                }

                response.Images.Add(await BuildImageDiagnosticEntryAsync(httpClient, item, ImageType.Backdrop, backdropIndex, cancellationToken).ConfigureAwait(false));
            }

            AddImageDiagnosticWarnings(response);

            return Ok(response);
        }
        catch (Exception ex)
        {
            LogEndpointFailure(PtvApiRoutes.V1ImageDiagnostics, ex);

            return StatusCode(
                StatusCodes.Status500InternalServerError,
                DiagnosticError("PTV_IMAGE_DIAGNOSTIC_FAILED", PtvApiRoutes.V1ImageDiagnostics, ex));
        }
    }

    /// <summary>
    /// Gets the shared PiggieTV featured-content cache document.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Featured-content cache document.</returns>
    [HttpGet("featured")]
    [HttpGet("FeaturedContent")]
    [HttpGet("~/Ptv/FeaturedContent")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult<PtvFeaturedContentDocument>> GetFeaturedContent(CancellationToken cancellationToken)
    {
        try
        {
            var featuredContentStore = GetRequiredService<IPtvFeaturedContentStore>(PtvApiRoutes.V1Featured);
            var storeStatus = await featuredContentStore.GetStatusAsync(cancellationToken).ConfigureAwait(false);
            var document = storeStatus.Document;
            var featuredStatus = PtvFeaturedContentStatus.FromDocument(document);
            var serializedBytes = JsonSerializer.SerializeToUtf8Bytes(document).Length;

            _logger.LogInformation(
                "PiggieTV featured endpoint read cache. StoreInstance={StoreInstance}. CacheFilePath={CacheFilePath}. CachePayloadBytes={CachePayloadBytes}. FeaturedCacheExists={FeaturedCacheExists}. FeaturedCacheFresh={FeaturedCacheFresh}. CacheVersion={CacheVersion}. HasPayload={HasPayload}. HeroCount={HeroCount}. SectionCount={SectionCount}. ItemCount={ItemCount}. SerializedResponseBytes={SerializedResponseBytes}.",
                RuntimeHelpers.GetHashCode(featuredContentStore),
                storeStatus.CacheFilePath,
                storeStatus.CachePayloadBytes,
                storeStatus.FeaturedCacheExists,
                storeStatus.FeaturedCacheFresh,
                featuredStatus.CacheVersion,
                featuredStatus.HasPayload,
                featuredStatus.HeroCount,
                featuredStatus.SectionCount,
                featuredStatus.ItemCount,
                serializedBytes);

            return Ok(document);
        }
        catch (Exception ex)
        {
            LogEndpointFailure(PtvApiRoutes.V1Featured, ex);

            return StatusCode(
                StatusCodes.Status500InternalServerError,
                DiagnosticError("PTV_FEATURED_READ_FAILED", PtvApiRoutes.V1Featured, ex));
        }
    }

    /// <summary>
    /// Replaces the shared PiggieTV featured-content cache document.
    /// </summary>
    /// <param name="document">Featured-content cache document.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The stored featured-content cache document.</returns>
    [HttpPut("featured")]
    [HttpPut("FeaturedContent")]
    [HttpPut("~/Ptv/FeaturedContent")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvFeaturedContentDocument>> PutFeaturedContent(
        [FromBody] PtvFeaturedContentDocument? document,
        CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync(PtvApiRoutes.V1FeaturedContent).ConfigureAwait(false))
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
            var featuredContentStore = GetRequiredService<IPtvFeaturedContentStore>(PtvApiRoutes.V1FeaturedContent);
            var storedDocument = await featuredContentStore.WriteAsync(document, cancellationToken).ConfigureAwait(false);

            return Ok(storedDocument);
        }
        catch (PtvFeaturedContentValidationException ex)
        {
            return BadRequest(Error(ex.Code, ex.Message));
        }
        catch (Exception ex)
        {
            LogEndpointFailure(PtvApiRoutes.V1FeaturedContent, ex);

            return StatusCode(
                StatusCodes.Status500InternalServerError,
                DiagnosticError("PTV_FEATURED_WRITE_FAILED", PtvApiRoutes.V1FeaturedContent, ex));
        }
    }

    /// <summary>
    /// Clears the shared PiggieTV featured-content cache document.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Empty featured-content cache document.</returns>
    [HttpDelete("featured")]
    [HttpDelete("FeaturedContent")]
    [HttpDelete("~/Ptv/FeaturedContent")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvFeaturedContentDocument>> DeleteFeaturedContent(CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync(PtvApiRoutes.V1FeaturedContent).ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_CACHE_CLEAR_FORBIDDEN", "Only Jellyfin administrators can clear the shared PiggieTV featured-content cache."));
        }

        try
        {
            var featuredContentStore = GetRequiredService<IPtvFeaturedContentStore>(PtvApiRoutes.V1FeaturedContent);
            await featuredContentStore.ClearAsync(cancellationToken).ConfigureAwait(false);

            return Ok(PtvFeaturedContentValidator.CreateEmptyDocument());
        }
        catch (Exception ex)
        {
            LogEndpointFailure(PtvApiRoutes.V1FeaturedContent, ex);

            return StatusCode(
                StatusCodes.Status500InternalServerError,
                DiagnosticError("PTV_FEATURED_CLEAR_FAILED", PtvApiRoutes.V1FeaturedContent, ex));
        }
    }

    /// <summary>
    /// Triggers a server-side refresh of the shared PiggieTV featured-content cache.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Plugin status after the refresh attempt.</returns>
    [HttpPost("featured/refresh")]
    [HttpPost("FeaturedContent/Refresh")]
    [HttpPost("~/Ptv/FeaturedContent/Refresh")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvStatusResponse>> RefreshFeaturedContent(CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync(PtvApiRoutes.V1FeaturedRefresh).ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_CACHE_REFRESH_FORBIDDEN", "Only Jellyfin administrators can refresh the shared PiggieTV featured-content cache."));
        }

        try
        {
            var featuredContentRefreshService = GetRequiredService<IPtvFeaturedContentRefreshService>(PtvApiRoutes.V1FeaturedRefresh);
            // Manual refresh should finish on the server even if the browser request times out or disconnects.
            var storeStatus = await featuredContentRefreshService.RefreshAsync(CancellationToken.None).ConfigureAwait(false);

            return Ok(PtvStatusResponse.FromStoreStatus(
                storeStatus,
                canWriteFeaturedContent: true,
                refreshStatus: GetRefreshStatusOrFallback(PtvApiRoutes.V1FeaturedRefresh, storeStatus, []),
                tmdbMetadata: GetTmdbStatusOrFallback(PtvApiRoutes.V1FeaturedRefresh, [])));
        }
        catch (Exception ex)
        {
            LogEndpointFailure(PtvApiRoutes.V1FeaturedRefresh, ex);

            var storeStatus = await GetStoreStatusOrFallbackAsync(PtvApiRoutes.V1FeaturedRefresh, [], CancellationToken.None).ConfigureAwait(false);
            var response = PtvStatusResponse.FromStoreStatus(
                storeStatus,
                canWriteFeaturedContent: true,
                refreshStatus: GetRefreshStatusOrFallback(PtvApiRoutes.V1FeaturedRefresh, storeStatus, []),
                tmdbMetadata: GetTmdbStatusOrFallback(PtvApiRoutes.V1FeaturedRefresh, []));

            response.Ok = false;
            response.Degraded = true;
            response.Error = $"Featured content refresh failed: {ex.Message}";
            response.LastRefreshError = response.LastRefreshError ?? response.Error;

            return Ok(response);
        }
    }

    /// <summary>
    /// Gets PiggieTV plugin settings for the dashboard.
    /// </summary>
    /// <returns>Public plugin settings.</returns>
    [HttpGet("settings")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvPluginSettingsDto>> GetSettings()
    {
        if (!await CanWriteFeaturedContentSafeAsync(PtvApiRoutes.V1Settings).ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_SETTINGS_READ_FORBIDDEN", "Only Jellyfin administrators can read PiggieTV plugin settings."));
        }

        try
        {
            var settingsService = GetOptionalService<IPtvPluginSettingsService>(PtvApiRoutes.V1Settings);

            return Ok(settingsService?.GetSettings() ?? PtvPluginSettingsDto.FromConfiguration(new Configuration.PluginConfiguration()));
        }
        catch (Exception ex)
        {
            LogEndpointFailure(PtvApiRoutes.V1Settings, ex);

            return Ok(PtvPluginSettingsDto.FromConfiguration(new Configuration.PluginConfiguration()));
        }
    }

    /// <summary>
    /// Searches MusicBrainz and Discogs for administrator song metadata repair.
    /// </summary>
    /// <param name="request">Lookup request from query string.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Music metadata candidates.</returns>
    [HttpGet("music/metadata/search")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvMusicMetadataLookupResponse>> SearchMusicMetadata(
        [FromQuery] PtvMusicMetadataLookupRequest request,
        CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync(PtvApiRoutes.V1MusicMetadataSearch).ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_MUSIC_METADATA_FORBIDDEN", "Only Jellyfin administrators can search server-side song metadata providers."));
        }

        if (request is null)
        {
            return BadRequest(Error("PTV_MUSIC_METADATA_NULL_QUERY", "A music metadata lookup query is required."));
        }

        try
        {
            var metadataLookupService = GetRequiredService<IPtvMusicMetadataLookupService>(PtvApiRoutes.V1MusicMetadataSearch);

            return Ok(await metadataLookupService.SearchAsync(request, cancellationToken).ConfigureAwait(false));
        }
        catch (Exception ex)
        {
            LogEndpointFailure(PtvApiRoutes.V1MusicMetadataSearch, ex);

            return StatusCode(
                StatusCodes.Status500InternalServerError,
                DiagnosticError("PTV_MUSIC_METADATA_LOOKUP_FAILED", PtvApiRoutes.V1MusicMetadataSearch, ex));
        }
    }

    /// <summary>
    /// Searches Google Books for administrator reading metadata repair.
    /// </summary>
    /// <param name="request">Lookup request from query string.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Google Books metadata candidates.</returns>
    [HttpGet("reading/metadata/googlebooks/search")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvGoogleBooksMetadataLookupResponse>> SearchGoogleBooksMetadata(
        [FromQuery] PtvGoogleBooksMetadataLookupRequest request,
        CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync(PtvApiRoutes.V1GoogleBooksMetadataSearch).ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_GOOGLE_BOOKS_METADATA_FORBIDDEN", "Only Jellyfin administrators can search server-side Google Books metadata."));
        }

        if (request is null)
        {
            return BadRequest(Error("PTV_GOOGLE_BOOKS_METADATA_NULL_QUERY", "A Google Books metadata lookup query is required."));
        }

        try
        {
            var metadataLookupService = GetRequiredService<IPtvGoogleBooksMetadataLookupService>(PtvApiRoutes.V1GoogleBooksMetadataSearch);

            return Ok(await metadataLookupService.SearchAsync(request, cancellationToken).ConfigureAwait(false));
        }
        catch (Exception ex)
        {
            LogEndpointFailure(PtvApiRoutes.V1GoogleBooksMetadataSearch, ex);

            return StatusCode(
                StatusCodes.Status500InternalServerError,
                DiagnosticError("PTV_GOOGLE_BOOKS_METADATA_LOOKUP_FAILED", PtvApiRoutes.V1GoogleBooksMetadataSearch, ex));
        }
    }

    /// <summary>
    /// Saves PiggieTV plugin settings from the dashboard.
    /// </summary>
    /// <param name="settingsPayload">Incoming plugin settings patch JSON.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Saved public plugin settings.</returns>
    [HttpPost("settings")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvPluginSettingsDto>> SaveSettings(
        [FromBody] JsonElement? settingsPayload,
        CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync(PtvApiRoutes.V1Settings).ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_SETTINGS_WRITE_FORBIDDEN", "Only Jellyfin administrators can save PiggieTV plugin settings."));
        }

        if (!settingsPayload.HasValue
            || settingsPayload.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return BadRequest(Error("PTV_SETTINGS_NULL_PAYLOAD", "PiggieTV plugin settings are required."));
        }

        var payloadBytes = GetJsonPayloadByteCount(settingsPayload.Value);
        var topLevelKeys = DescribeJsonTopLevelKeys(settingsPayload.Value);
        var recommendationPayloadSummary = DescribeRecommendationPayload(settingsPayload.Value);

        _logger.LogInformation(
            "PiggieTV settings save payload received. PayloadBytes={PayloadBytes}; TopLevelKeys={TopLevelKeys}; RecommendationRows={RecommendationRows}; RecommendationItemCounts={RecommendationItemCounts}.",
            payloadBytes,
            topLevelKeys,
            recommendationPayloadSummary.RowCount,
            recommendationPayloadSummary.ItemCounts);

        PtvPluginSettingsPatchDto? settings;

        try
        {
            settings = settingsPayload.Value.Deserialize<PtvPluginSettingsPatchDto>(SettingsPatchJsonOptions);
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(
                ex,
                "PiggieTV settings payload rejected during DTO binding. PayloadBytes={PayloadBytes}; TopLevelKeys={TopLevelKeys}; JsonPath={JsonPath}; BytePosition={BytePosition}.",
                payloadBytes,
                topLevelKeys,
                ex.Path,
                ex.BytePositionInLine);

            return BadRequest(new
            {
                code = "PTV_SETTINGS_INVALID_PAYLOAD",
                error = "PiggieTV plugin settings payload could not be deserialized.",
                jsonPath = ex.Path,
                message = RedactSecrets(ex.Message),
                payloadBytes,
                topLevelKeys
            });
        }

        if (settings is null)
        {
            return BadRequest(Error("PTV_SETTINGS_NULL_PAYLOAD", "PiggieTV plugin settings are required."));
        }

        var recommendationValidationErrors = ValidateRecommendationSettingsPatch(settings.Recommendations);
        if (recommendationValidationErrors.Count > 0)
        {
            _logger.LogWarning(
                "PiggieTV settings payload rejected by recommendation validation. PayloadBytes={PayloadBytes}; Errors={Errors}; RecommendationRows={RecommendationRows}; RecommendationItemCounts={RecommendationItemCounts}.",
                payloadBytes,
                string.Join(" | ", recommendationValidationErrors),
                recommendationPayloadSummary.RowCount,
                recommendationPayloadSummary.ItemCounts);

            return BadRequest(new
            {
                code = "PTV_SETTINGS_INVALID_RECOMMENDATIONS",
                error = "Recommendation settings payload failed validation.",
                errors = recommendationValidationErrors,
                payloadBytes,
                recommendationItemCounts = recommendationPayloadSummary.ItemCounts,
                recommendationRows = recommendationPayloadSummary.RowCount,
                topLevelKeys
            });
        }

        try
        {
            var settingsService = GetRequiredService<IPtvPluginSettingsService>(PtvApiRoutes.V1Settings);
            var saved = settingsService.SaveSettings(settings);
            var shouldRefreshFeaturedCache =
                settings.Rows is not null ||
                settings.RowSettings is not null ||
                settings.Recommendations is not null;

            if (settings.Rows is not null)
            {
                LogSavedRules("settings", saved.Rows);
            }

            if (shouldRefreshFeaturedCache)
            {
                await RefreshFeaturedCacheAfterRowsSaveAsync("settings", cancellationToken).ConfigureAwait(false);
            }

            _logger.LogInformation(
                "PiggieTV settings save completed. PayloadBytes={PayloadBytes}; RecommendationRows={RecommendationRows}; RecommendationItemCounts={RecommendationItemCounts}; FeaturedRefreshRequested={FeaturedRefreshRequested}.",
                payloadBytes,
                saved.Recommendations.Rows.Count,
                DescribeRecommendationItemCounts(saved.Recommendations),
                shouldRefreshFeaturedCache);

            return Ok(saved);
        }
        catch (Exception ex)
        {
            LogEndpointFailure(PtvApiRoutes.V1Settings, ex);

            return StatusCode(
                StatusCodes.Status500InternalServerError,
                DiagnosticError("PTV_SETTINGS_SAVE_FAILED", PtvApiRoutes.V1Settings, ex));
        }
    }

    /// <summary>
    /// Gets PiggieTV row-builder settings.
    /// </summary>
    /// <returns>Row-builder settings.</returns>
    [HttpGet("rows")]
    public async Task<ActionResult<RowBuilderSettings>> GetRows()
    {
        if (!await CanWriteFeaturedContentSafeAsync("rows").ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_ROWS_READ_FORBIDDEN", "Only Jellyfin administrators can read PiggieTV row settings."));
        }

        var settingsService = GetOptionalService<IPtvPluginSettingsService>("rows");

        return Ok(settingsService?.GetSettings().Rows ?? RowBuilderSettings.CreateDefault());
    }

    /// <summary>
    /// Saves PiggieTV row-builder settings.
    /// </summary>
    /// <param name="settings">Row-builder settings.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Saved row-builder settings.</returns>
    [HttpPost("rows")]
    public async Task<ActionResult<RowBuilderSettings>> SaveRows(
        [FromBody] RowBuilderSettings? settings,
        CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync("rows").ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_ROWS_WRITE_FORBIDDEN", "Only Jellyfin administrators can save PiggieTV row settings."));
        }

        if (settings is null)
        {
            return BadRequest(Error("PTV_ROWS_NULL_PAYLOAD", "PiggieTV row settings are required."));
        }

        var settingsService = GetRequiredService<IPtvPluginSettingsService>("rows");
        var saved = settingsService.SaveSettings(new PtvPluginSettingsPatchDto
        {
            Rows = settings
        });
        LogSavedRules("rows", saved.Rows);
        await RefreshFeaturedCacheAfterRowsSaveAsync("rows", cancellationToken).ConfigureAwait(false);

        return Ok(saved.Rows);
    }

    private void LogSavedRules(string route, RowBuilderSettings rows)
    {
        _logger.LogInformation(
            "PiggieTV Row Rules savedRules via {Route}: {SavedRules}",
            route,
            JsonSerializer.Serialize(rows.Rules.Select(rule => new
            {
                rule.Id,
                rule.Name,
                rule.Enabled,
                rule.MediaType,
                rule.SourceType,
                rule.SourceValue,
                rule.GenerationMode,
                rule.RowCount,
                rule.IncludeSubgenres,
                rule.SubgenreRowCount,
                rule.ItemLimit,
                rule.SortPriority,
                rule.GroupTitle
            })));
    }

    private async Task RefreshFeaturedCacheAfterRowsSaveAsync(string route, CancellationToken cancellationToken)
    {
        var refreshService = GetOptionalService<IPtvFeaturedContentRefreshService>(route);

        if (refreshService is null)
        {
            _logger.LogWarning("PiggieTV homepage row settings saved via {Route}, but featured cache refresh service is unavailable.", route);
            return;
        }

        _logger.LogInformation("PiggieTV homepage row settings saved via {Route}; rebuilding featured cache immediately.", route);
        await refreshService.RefreshAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Validates PiggieTV row-builder settings.
    /// </summary>
    /// <param name="settings">Row-builder settings.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Validation result.</returns>
    [HttpPost("rows/validate")]
    public async Task<ActionResult<PtvRowValidationResult>> ValidateRows(
        [FromBody] RowBuilderSettings? settings,
        CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync("rows/validate").ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_ROWS_VALIDATE_FORBIDDEN", "Only Jellyfin administrators can validate PiggieTV row settings."));
        }

        var previewService = GetRequiredService<IPtvFeaturedContentRefreshService>("rows/validate");
        var preview = await previewService.PreviewRowsAsync(settings, cancellationToken).ConfigureAwait(false);

        return Ok(preview.Validation);
    }

    /// <summary>
    /// Previews generated PiggieTV homepage rows without refreshing the cache.
    /// </summary>
    /// <param name="settings">Optional unsaved row-builder settings.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Generated row preview.</returns>
    [HttpPost("rows/preview")]
    public async Task<ActionResult<PtvRowPreviewResponse>> PreviewRows(
        [FromBody] RowBuilderSettings? settings,
        CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync("rows/preview").ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_ROWS_PREVIEW_FORBIDDEN", "Only Jellyfin administrators can preview PiggieTV rows."));
        }

        var previewService = GetRequiredService<IPtvFeaturedContentRefreshService>("rows/preview");

        return Ok(await previewService.PreviewRowsAsync(settings, cancellationToken).ConfigureAwait(false));
    }

    /// <summary>
    /// Validates the configured TMDb credential and returns redacted provider status.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>TMDb metadata status.</returns>
    [HttpGet("tmdb/test")]
    [HttpPost("tmdb/test")]
    public async Task<ActionResult<PtvTmdbMetadataStatus>> TestTmdbMetadata(CancellationToken cancellationToken)
    {
        const string route = "tmdb/test";

        if (!await CanWriteFeaturedContentSafeAsync(route).ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_TMDB_TEST_FORBIDDEN", "Only Jellyfin administrators can test TMDb credentials."));
        }

        try
        {
            var tmdbMetadataService = GetRequiredService<IPtvTmdbMetadataService>(route);

            return Ok(await tmdbMetadataService.ValidateCredentialsAsync(cancellationToken).ConfigureAwait(false));
        }
        catch (Exception ex)
        {
            LogEndpointFailure(route, ex);

            return StatusCode(
                StatusCodes.Status500InternalServerError,
                DiagnosticError("PTV_TMDB_TEST_FAILED", route, ex));
        }
    }

    /// <summary>
    /// Resets PiggieTV plugin settings to defaults.
    /// </summary>
    /// <returns>Default public plugin settings.</returns>
    [HttpPost("settings/reset")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvPluginSettingsDto>> ResetSettings()
    {
        if (!await CanWriteFeaturedContentSafeAsync(PtvApiRoutes.V1SettingsReset).ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_SETTINGS_RESET_FORBIDDEN", "Only Jellyfin administrators can reset PiggieTV plugin settings."));
        }

        try
        {
            var settingsService = GetRequiredService<IPtvPluginSettingsService>(PtvApiRoutes.V1SettingsReset);

            return Ok(settingsService.ResetSettings());
        }
        catch (Exception ex)
        {
            LogEndpointFailure(PtvApiRoutes.V1SettingsReset, ex);

            return StatusCode(
                StatusCodes.Status500InternalServerError,
                DiagnosticError("PTV_SETTINGS_RESET_FAILED", PtvApiRoutes.V1SettingsReset, ex));
        }
    }

    /// <summary>
    /// Gets redacted integration status for PiggieTV dashboard cards.
    /// </summary>
    /// <returns>Integration status.</returns>
    [HttpGet("integrations/status")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult GetIntegrationsStatus()
    {
        try
        {
            var configuration = GetNormalizedConfiguration();

            return Ok(new
            {
                ok = true,
                seerr = new
                {
                    configuration.SeerrSettings.Enabled,
                    configuration.SeerrSettings.DisplayName,
                    configuration.SeerrSettings.InternalUrl,
                    configuration.SeerrSettings.ExternalUrl,
                    apiKeyConfigured = !string.IsNullOrWhiteSpace(configuration.SeerrSettings.ApiKey),
                    configuration.SeerrSettings.EnableRequestsPage,
                    configuration.SeerrSettings.EnableSearchIntegration,
                    configuration.SeerrSettings.EnableAutoRequest,
                    configuration.SeerrSettings.OpenRequestsInPtv,
                    configuration.SeerrSettings.OpenExternalFallback
                },
                arr = PtvPublicArrSettings.FromConfiguration(configuration),
                downloads = PtvPublicDownloadSettings.FromConfiguration(configuration),
                endpoints = new
                {
                    arrCalendar = "/Ptv/v1/calendar",
                    arrCalendarAlias = "/Ptv/v1/integrations/arr/calendar",
                    signupCreateUser = "/Ptv/v1/signup/create-user",
                    signupVerifyEmail = "/Ptv/v1/signup/verify-email",
                    signupPasswordResetRequest = "/Ptv/v1/signup/password-reset/request",
                    signupPasswordResetConfirm = "/Ptv/v1/signup/password-reset/confirm",
                    signupAdminInvites = "/Ptv/v1/signup/admin/invites",
                    signupAdminSettings = "/Ptv/v1/signup/admin/settings",
                    signupAdminTestEmail = "/Ptv/v1/signup/admin/email/test"
                },
                signup = PtvStatusSignup.Create(configuration.SignupSettings),
                tags = configuration.TagSettings,
                random = configuration.RandomSettings
            });
        }
        catch (Exception ex)
        {
            LogEndpointFailure("integrations/status", ex);

            return Ok(new
            {
                ok = false,
                error = "PiggieTV integration status is degraded.",
                detail = RedactSecrets(ex.Message)
            });
        }
    }

    /// <summary>
    /// Tests Jellyseerr connectivity from the Jellyfin server.
    /// </summary>
    /// <param name="settingsOverride">Optional unsaved settings to test.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Redacted test result.</returns>
    [HttpPost("integrations/seerr/test")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult> TestSeerr(
        [FromBody] PtvSeerrSettingsPatch? settingsOverride,
        CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync("integrations/seerr/test").ConfigureAwait(false))
        {
            return StatusCode(StatusCodes.Status403Forbidden, Error("PTV_INTEGRATION_TEST_FORBIDDEN", "Only Jellyfin administrators can test PiggieTV integrations."));
        }

        var settings = BuildSeerrTestSettings(settingsOverride);

        return Ok(await TestJsonEndpointAsync(
            settings.Enabled,
            settings.InternalUrl,
            "/api/v1/status",
            settings.ApiKey,
            "Jellyseerr",
            cancellationToken).ConfigureAwait(false));
    }

    /// <summary>
    /// Searches Jellyseerr through the PiggieTV backend proxy.
    /// </summary>
    /// <param name="query">Search query.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr search response or a redacted error.</returns>
    [HttpGet("integrations/seerr/search")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult> SearchSeerr([FromQuery] string? query, CancellationToken cancellationToken)
    {
        var settings = GetNormalizedConfiguration().SeerrSettings;

        if (!settings.Enabled || !settings.EnableSearchIntegration || string.IsNullOrWhiteSpace(settings.InternalUrl) || string.IsNullOrWhiteSpace(settings.ApiKey))
        {
            return Ok(new
            {
                ok = false,
                error = "Jellyseerr search is not configured.",
                externalUrl = settings.ExternalUrl
            });
        }

        if (string.IsNullOrWhiteSpace(query))
        {
            return BadRequest(Error("PTV_SEERR_QUERY_REQUIRED", "A search query is required."));
        }

        return Ok(await ProxyGetJsonAsync(
            settings.InternalUrl,
            $"/api/v1/search?query={Uri.EscapeDataString(query.Trim())}",
            settings.ApiKey,
            "Jellyseerr search",
            cancellationToken).ConfigureAwait(false));
    }

    /// <summary>
    /// Proxies a Jellyseerr request action.
    /// </summary>
    /// <param name="body">Request payload.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Jellyseerr response or a redacted error.</returns>
    [HttpPost("integrations/seerr/request")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult> RequestSeerr([FromBody] JsonObject? body, CancellationToken cancellationToken)
    {
        var settings = GetNormalizedConfiguration().SeerrSettings;

        if (!settings.Enabled || string.IsNullOrWhiteSpace(settings.InternalUrl) || string.IsNullOrWhiteSpace(settings.ApiKey))
        {
            return Ok(new
            {
                ok = false,
                error = "Jellyseerr requests are not configured.",
                externalUrl = settings.ExternalUrl
            });
        }

        return Ok(await ProxyPostJsonAsync(
            settings.InternalUrl,
            "/api/v1/request",
            settings.ApiKey,
            body ?? new JsonObject(),
            "Jellyseerr request",
            cancellationToken).ConfigureAwait(false));
    }

    /// <summary>
    /// Gets local Jellyfin items requested by a Jellyfin user through Jellyseerr.
    /// </summary>
    /// <param name="userId">Jellyfin user id.</param>
    /// <param name="limit">Maximum local items to return.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Local Jellyfin items matching the user's Jellyseerr requests.</returns>
    [HttpGet("integrations/seerr/requests")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult> GetSeerrRequestedItems(
        [FromQuery] string? userId,
        [FromQuery] int? limit,
        CancellationToken cancellationToken)
    {
        var settings = GetNormalizedConfiguration().SeerrSettings;

        if (!settings.Enabled || !settings.EnableRequestsPage || string.IsNullOrWhiteSpace(settings.InternalUrl) || string.IsNullOrWhiteSpace(settings.ApiKey))
        {
            return Ok(new
            {
                ok = false,
                Items = Array.Empty<object>(),
                error = "Jellyseerr requests are not configured.",
                externalUrl = settings.ExternalUrl
            });
        }

        if (string.IsNullOrWhiteSpace(userId))
        {
            return Ok(new
            {
                ok = false,
                Items = Array.Empty<object>(),
                error = "A Jellyfin user id is required for the requested media row."
            });
        }

        var itemLimit = Math.Clamp(limit ?? 24, 1, 100);
        var seerrUser = await FetchProxyJsonNodeAsync(
            settings.InternalUrl,
            $"/api/v1/user/jellyfin/{Uri.EscapeDataString(userId.Trim())}",
            settings.ApiKey,
            "Jellyseerr user lookup",
            cancellationToken).ConfigureAwait(false);
        var seerrUserId = ReadJsonInt(seerrUser, "id");

        if (seerrUserId is null)
        {
            return Ok(new
            {
                ok = false,
                Items = Array.Empty<object>(),
                error = "No Jellyseerr user is linked to this Jellyfin user."
            });
        }

        var requestPayload = await FetchProxyJsonNodeAsync(
            settings.InternalUrl,
            $"/api/v1/user/{seerrUserId.Value.ToString(CultureInfo.InvariantCulture)}/requests?take={itemLimit * 2}&skip=0",
            settings.ApiKey,
            "Jellyseerr user requests",
            cancellationToken).ConfigureAwait(false);
        var requestedMedia = ExtractSeerrRequestedMedia(requestPayload).ToArray();

        if (requestedMedia.Length == 0)
        {
            requestPayload = await FetchProxyJsonNodeAsync(
                settings.InternalUrl,
                $"/api/v1/request?take={itemLimit * 2}&skip=0&filter=all&sort=added&requestedBy={seerrUserId.Value.ToString(CultureInfo.InvariantCulture)}",
                settings.ApiKey,
                "Jellyseerr request list",
                cancellationToken).ConfigureAwait(false);
            requestedMedia = ExtractSeerrRequestedMedia(requestPayload)
                .Where(media => MatchesSeerrRequester(media, seerrUserId.Value))
                .ToArray();
        }

        var items = GetRequestedLibraryItems(requestedMedia, itemLimit)
            .Select(ToSeerrRequestedItemDto)
            .ToArray();

        return Ok(new
        {
            ok = true,
            Items = items,
            totalRequests = requestedMedia.Length,
            matchedItems = items.Length
        });
    }

    /// <summary>Tests Sonarr connectivity.</summary>
    /// <param name="settingsOverride">Optional unsaved settings to test.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Redacted test result.</returns>
    [HttpPost("integrations/sonarr/test")]
    public Task<ActionResult> TestSonarr(
        [FromBody] PtvArrServiceSettingsPatch? settingsOverride,
        CancellationToken cancellationToken) => TestArrServiceAsync("sonarr", settingsOverride, cancellationToken);

    /// <summary>Tests Radarr connectivity.</summary>
    /// <param name="settingsOverride">Optional unsaved settings to test.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Redacted test result.</returns>
    [HttpPost("integrations/radarr/test")]
    public Task<ActionResult> TestRadarr(
        [FromBody] PtvArrServiceSettingsPatch? settingsOverride,
        CancellationToken cancellationToken) => TestArrServiceAsync("radarr", settingsOverride, cancellationToken);

    /// <summary>Tests Lidarr connectivity.</summary>
    /// <param name="settingsOverride">Optional unsaved settings to test.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Redacted test result.</returns>
    [HttpPost("integrations/lidarr/test")]
    public Task<ActionResult> TestLidarr(
        [FromBody] PtvArrServiceSettingsPatch? settingsOverride,
        CancellationToken cancellationToken) => TestArrServiceAsync("lidarr", settingsOverride, cancellationToken);

    /// <summary>Tests Prowlarr connectivity.</summary>
    /// <param name="settingsOverride">Optional unsaved settings to test.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Redacted test result.</returns>
    [HttpPost("integrations/prowlarr/test")]
    public Task<ActionResult> TestProwlarr(
        [FromBody] PtvArrServiceSettingsPatch? settingsOverride,
        CancellationToken cancellationToken) => TestArrServiceAsync("prowlarr", settingsOverride, cancellationToken);

    /// <summary>
    /// Gets an aggregated *Arr calendar through the PiggieTV backend.
    /// </summary>
    /// <param name="start">Optional start date.</param>
    /// <param name="end">Optional end date.</param>
    /// <param name="daysBefore">Days before today when start is omitted.</param>
    /// <param name="daysAfter">Days after today when end is omitted.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Calendar status.</returns>
    [HttpGet("calendar")]
    [HttpGet("integrations/arr/calendar")]
    public async Task<ActionResult> GetArrCalendar(
        [FromQuery] DateTimeOffset? start,
        [FromQuery] DateTimeOffset? end,
        [FromQuery] int daysBefore = 7,
        [FromQuery] int daysAfter = 30,
        CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow.UtcDateTime.Date;
        var startDate = (start?.UtcDateTime.Date ?? now.AddDays(-Math.Clamp(daysBefore, 0, 120)));
        var endDate = (end?.UtcDateTime.Date ?? now.AddDays(Math.Clamp(daysAfter, 1, 240)));

        if (endDate < startDate)
        {
            (startDate, endDate) = (endDate, startDate);
        }

        var serviceResults = new List<PtvArrCalendarServiceResultDto>();
        var items = new List<PtvArrCalendarItemDto>();
        var configuration = GetNormalizedConfiguration();

        await AppendArrCalendarAsync("sonarr", configuration.ArrSettings.Sonarr, startDate, endDate, items, serviceResults, cancellationToken).ConfigureAwait(false);
        await AppendArrCalendarAsync("radarr", configuration.ArrSettings.Radarr, startDate, endDate, items, serviceResults, cancellationToken).ConfigureAwait(false);
        await AppendArrCalendarAsync("lidarr", configuration.ArrSettings.Lidarr, startDate, endDate, items, serviceResults, cancellationToken).ConfigureAwait(false);

        serviceResults.Add(CreateArrCalendarServiceResult(
            "prowlarr",
            configuration.ArrSettings.Prowlarr,
            supported: false,
            itemCount: 0,
            error: "Prowlarr does not expose a media release calendar."));

        var sortedItems = items
            .OrderBy(item => item.SortDate ?? item.Date ?? string.Empty, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Title, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return Ok(new
        {
            ok = true,
            enabled = serviceResults.Any(service => service.Enabled && service.Configured && service.Supported),
            start = startDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            end = endDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            itemCount = sortedItems.Length,
            services = serviceResults,
            items = sortedItems,
            message = sortedItems.Length == 0
                ? "No upcoming *Arr calendar items were found for the selected range."
                : $"Loaded {sortedItems.Length} upcoming *Arr calendar items."
        });
    }

    /// <summary>
    /// Gets an aggregated downloads placeholder through the PiggieTV backend.
    /// </summary>
    /// <returns>Download status.</returns>
    [HttpGet("integrations/arr/downloads")]
    public ActionResult GetArrDownloads()
    {
        return Ok(new
        {
            ok = true,
            items = Array.Empty<object>(),
            message = "Downloads proxy endpoint is available. Configure download-provider adapters next."
        });
    }

    /// <summary>
    /// Gets known Jellyfin tags.
    /// </summary>
    /// <returns>Known tags.</returns>
    [HttpGet("tags")]
    public ActionResult GetTags()
    {
        try
        {
            var tags = GetLibraryItems()
                .SelectMany(item => item.Tags ?? Array.Empty<string>())
                .Where(tag => !string.IsNullOrWhiteSpace(tag))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(tag => tag, StringComparer.OrdinalIgnoreCase)
                .Take(500)
                .ToArray();

            return Ok(new
            {
                ok = true,
                tags
            });
        }
        catch (Exception ex)
        {
            LogEndpointFailure("tags", ex);

            return Ok(new
            {
                ok = false,
                tags = Array.Empty<string>(),
                error = RedactSecrets(ex.Message)
            });
        }
    }

    /// <summary>
    /// Gets configured PiggieTV tag row definitions.
    /// </summary>
    /// <returns>Tag row definitions.</returns>
    [HttpGet("tags/rows")]
    public ActionResult GetTagRows()
    {
        var configuration = GetNormalizedConfiguration();

        return Ok(new
        {
            ok = true,
            configuration.TagSettings.Enabled,
            configuration.TagSettings.EnableTagRows,
            configuration.TagSettings.EnableTagFilters,
            configuration.TagSettings.IncludeTags,
            configuration.TagSettings.ExcludeTags,
            configuration.TagSettings.RowDefinitions
        });
    }

    /// <summary>
    /// Saves PiggieTV tag row definitions.
    /// </summary>
    /// <param name="settings">Tag settings patch.</param>
    /// <returns>Saved public settings.</returns>
    [HttpPost("tags/rows")]
    public async Task<ActionResult> SaveTagRows([FromBody] PtvTagSettingsPatch? settings)
    {
        if (!await CanWriteFeaturedContentSafeAsync("tags/rows").ConfigureAwait(false))
        {
            return StatusCode(StatusCodes.Status403Forbidden, Error("PTV_TAG_ROWS_FORBIDDEN", "Only Jellyfin administrators can save PiggieTV tag rows."));
        }

        if (settings is null)
        {
            return BadRequest(Error("PTV_TAG_ROWS_NULL_PAYLOAD", "Tag row settings are required."));
        }

        var settingsService = GetRequiredService<IPtvPluginSettingsService>("tags/rows");

        return Ok(settingsService.SaveSettings(new PtvPluginSettingsPatchDto
        {
            TagSettings = settings
        }));
    }

    /// <summary>Gets a random movie.</summary>
    /// <returns>Random movie result.</returns>
    [HttpGet("random/movie")]
    public ActionResult GetRandomMovie() => GetRandomItem("movie", null);

    /// <summary>Gets a random episode.</summary>
    /// <returns>Random episode result.</returns>
    [HttpGet("random/episode")]
    public ActionResult GetRandomEpisode() => GetRandomItem("episode", null);

    /// <summary>Gets a random anime item.</summary>
    /// <returns>Random anime result.</returns>
    [HttpGet("random/anime")]
    public ActionResult GetRandomAnime() => GetRandomItem("anime", null);

    /// <summary>Gets a random item from a current library context.</summary>
    /// <param name="libraryId">Library id.</param>
    /// <returns>Random item result.</returns>
    [HttpGet("random/library/{libraryId}")]
    public ActionResult GetRandomLibraryItem(string libraryId) => GetRandomItem("library", libraryId);

    private static PluginConfiguration GetNormalizedConfiguration()
    {
        var configuration = Plugin.Instance?.Configuration ?? new PluginConfiguration();

        return PtvPluginSettingsNormalizer.Normalize(configuration);
    }

    private async Task<ActionResult> TestArrServiceAsync(
        string serviceName,
        PtvArrServiceSettingsPatch? settingsOverride,
        CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync($"integrations/{serviceName}/test").ConfigureAwait(false))
        {
            return StatusCode(StatusCodes.Status403Forbidden, Error("PTV_INTEGRATION_TEST_FORBIDDEN", "Only Jellyfin administrators can test PiggieTV integrations."));
        }

        var settings = BuildArrTestSettings(serviceName, settingsOverride);

        return Ok(await TestJsonEndpointAsync(
            settings.Enabled,
            settings.InternalUrl,
            GetArrSystemStatusPath(serviceName),
            settings.ApiKey,
            serviceName,
            cancellationToken).ConfigureAwait(false));
    }

    private static SeerrSettings BuildSeerrTestSettings(PtvSeerrSettingsPatch? settingsOverride)
    {
        var saved = GetNormalizedConfiguration().SeerrSettings;
        var settings = new SeerrSettings
        {
            ApiKey = saved.ApiKey,
            DisplayName = saved.DisplayName,
            Enabled = saved.Enabled,
            EnableAutoRequest = saved.EnableAutoRequest,
            EnableRequestsPage = saved.EnableRequestsPage,
            EnableSearchIntegration = saved.EnableSearchIntegration,
            ExternalUrl = saved.ExternalUrl,
            InternalUrl = saved.InternalUrl,
            OpenExternalFallback = saved.OpenExternalFallback,
            OpenRequestsInPtv = saved.OpenRequestsInPtv
        };

        if (settingsOverride is null)
        {
            return settings;
        }

        settings.Enabled = settingsOverride.Enabled ?? settings.Enabled;
        settings.InternalUrl = settingsOverride.InternalUrl ?? settings.InternalUrl;

        if (!string.IsNullOrWhiteSpace(settingsOverride.ApiKey))
        {
            settings.ApiKey = settingsOverride.ApiKey.Trim();
            settings.Enabled = true;
        }

        return settings;
    }

    private async Task AppendArrCalendarAsync(
        string serviceName,
        ArrServiceSettings settings,
        DateTime startDate,
        DateTime endDate,
        ICollection<PtvArrCalendarItemDto> items,
        ICollection<PtvArrCalendarServiceResultDto> serviceResults,
        CancellationToken cancellationToken)
    {
        var isSupported = IsArrCalendarSupported(serviceName);
        var isConfigured = IsArrServiceConfigured(settings);
        var isEnabled = IsArrServiceEffectivelyEnabled(settings);

        if (!isSupported || !isEnabled || !isConfigured)
        {
            serviceResults.Add(CreateArrCalendarServiceResult(
                serviceName,
                settings,
                isSupported,
                itemCount: 0,
                error: GetArrCalendarSkipReason(serviceName, settings, isSupported)));
            return;
        }

        var path = GetArrCalendarPath(serviceName, startDate, endDate);
        var result = await FetchArrCalendarPayloadAsync(
            settings.InternalUrl,
            path,
            settings.ApiKey,
            $"integrations/{serviceName}/calendar",
            cancellationToken).ConfigureAwait(false);

        if (result.Payload is null)
        {
            serviceResults.Add(CreateArrCalendarServiceResult(
                serviceName,
                settings,
                isSupported,
                itemCount: 0,
                error: result.Error ?? $"{serviceName} calendar returned no usable data.",
                statusCode: result.StatusCode));
            return;
        }

        var serviceItems = ExtractArrCalendarItems(serviceName, result.Payload, settings.ExternalUrl)
            .ToArray();

        foreach (var item in serviceItems)
        {
            items.Add(item);
        }

        serviceResults.Add(CreateArrCalendarServiceResult(
            serviceName,
            settings,
            isSupported,
            serviceItems.Length,
            error: null,
            statusCode: result.StatusCode));
    }

    private static PtvArrCalendarServiceResultDto CreateArrCalendarServiceResult(
        string serviceName,
        ArrServiceSettings settings,
        bool supported,
        int itemCount,
        string? error,
        int? statusCode = null)
    {
        return new PtvArrCalendarServiceResultDto
        {
            Configured = IsArrServiceConfigured(settings),
            Enabled = IsArrServiceEffectivelyEnabled(settings),
            Error = error,
            ItemCount = itemCount,
            Service = serviceName,
            StatusCode = statusCode,
            Supported = supported
        };
    }

    private static bool IsArrServiceConfigured(ArrServiceSettings settings)
    {
        return !string.IsNullOrWhiteSpace(settings.InternalUrl)
            && !string.IsNullOrWhiteSpace(settings.ApiKey);
    }

    private static bool IsArrServiceEffectivelyEnabled(ArrServiceSettings settings)
    {
        return settings.Enabled || !string.IsNullOrWhiteSpace(settings.ApiKey);
    }

    private static bool IsArrCalendarSupported(string serviceName)
    {
        return serviceName.Equals("sonarr", StringComparison.OrdinalIgnoreCase)
            || serviceName.Equals("radarr", StringComparison.OrdinalIgnoreCase)
            || serviceName.Equals("lidarr", StringComparison.OrdinalIgnoreCase);
    }

    private static string GetArrCalendarSkipReason(string serviceName, ArrServiceSettings settings, bool supported)
    {
        if (!supported) return $"{serviceName} does not expose a supported PiggieTV calendar adapter.";
        if (!IsArrServiceEffectivelyEnabled(settings)) return $"{serviceName} integration is disabled.";
        if (string.IsNullOrWhiteSpace(settings.InternalUrl)) return $"{serviceName} internal URL is not configured.";
        if (string.IsNullOrWhiteSpace(settings.ApiKey)) return $"{serviceName} API key is not configured.";

        return $"{serviceName} calendar is not configured.";
    }

    private static string GetArrSystemStatusPath(string serviceName)
    {
        return serviceName.Equals("sonarr", StringComparison.OrdinalIgnoreCase)
            || serviceName.Equals("radarr", StringComparison.OrdinalIgnoreCase)
            ? "/api/v3/system/status"
            : "/api/v1/system/status";
    }

    private static string GetArrCalendarPath(string serviceName, DateTime startDate, DateTime endDate)
    {
        var apiVersion = serviceName.Equals("lidarr", StringComparison.OrdinalIgnoreCase)
            ? "v1"
            : "v3";
        var start = startDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var end = endDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var includeParameters = serviceName.Equals("sonarr", StringComparison.OrdinalIgnoreCase)
            ? "&includeSeries=true&includeEpisodeFile=true"
            : string.Empty;

        return $"/api/{apiVersion}/calendar?start={start}&end={end}{includeParameters}";
    }

    private async Task<(JsonNode? Payload, int? StatusCode, string? Error)> FetchArrCalendarPayloadAsync(
        string baseUrl,
        string path,
        string? apiKey,
        string routeName,
        CancellationToken cancellationToken)
    {
        try
        {
            using var client = CreateProxyHttpClient(apiKey);
            using var response = await client.GetAsync(BuildProxyUri(baseUrl, path), cancellationToken).ConfigureAwait(false);
            var payload = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                return (null, (int)response.StatusCode, $"{routeName} returned HTTP {(int)response.StatusCode}.");
            }

            if (string.IsNullOrWhiteSpace(payload))
            {
                return (null, (int)response.StatusCode, $"{routeName} returned an empty response.");
            }

            return (JsonNode.Parse(payload), (int)response.StatusCode, null);
        }
        catch (Exception ex)
        {
            LogEndpointFailure(routeName, ex);

            return (null, null, RedactSecrets(ex.Message));
        }
    }

    private static IEnumerable<PtvArrCalendarItemDto> ExtractArrCalendarItems(
        string serviceName,
        JsonNode payload,
        string externalUrl)
    {
        if (payload is JsonArray rootArray)
        {
            return rootArray.OfType<JsonObject>().Select(item => ToArrCalendarItem(serviceName, item, externalUrl));
        }

        if (payload is JsonObject root)
        {
            foreach (var key in new[] { "records", "items", "results" })
            {
                if (root[key] is JsonArray nestedArray)
                {
                    return nestedArray.OfType<JsonObject>().Select(item => ToArrCalendarItem(serviceName, item, externalUrl));
                }
            }
        }

        return [];
    }

    private static PtvArrCalendarItemDto ToArrCalendarItem(
        string serviceName,
        JsonObject item,
        string externalUrl)
    {
        var date = GetArrCalendarDate(serviceName, item);
        var title = GetArrCalendarTitle(serviceName, item);
        var seriesTitle = ReadJsonString(item["series"], "title");
        var artistTitle = ReadJsonString(item["artist"], "artistName")
            ?? ReadJsonString(item["artist"], "name")
            ?? ReadJsonString(item, "artistName");
        var seasonNumber = ReadJsonInt(item, "seasonNumber");
        var episodeNumber = ReadJsonInt(item, "episodeNumber");
        var arrId = ReadJsonString(item, "id") ?? Guid.NewGuid().ToString("N");

        return new PtvArrCalendarItemDto
        {
            Date = date,
            EpisodeNumber = episodeNumber,
            EpisodeTitle = serviceName.Equals("sonarr", StringComparison.OrdinalIgnoreCase) ? ReadJsonString(item, "title") : null,
            ExternalUrl = string.IsNullOrWhiteSpace(externalUrl) ? null : externalUrl.TrimEnd('/'),
            HasFile = ReadJsonBool(item, "hasFile") ?? ReadJsonBool(item["movieFile"], "id") ?? ReadJsonBool(item["episodeFile"], "id"),
            Id = $"{serviceName}-{arrId}",
            Monitored = ReadJsonBool(item, "monitored"),
            Overview = Truncate(ReadJsonString(item, "overview"), 500),
            SeasonNumber = seasonNumber,
            SeriesTitle = seriesTitle ?? artistTitle,
            Service = serviceName,
            SortDate = NormalizeDateForSort(date),
            Status = ReadJsonString(item, "status"),
            Title = title
        };
    }

    private static string GetArrCalendarTitle(string serviceName, JsonObject item)
    {
        if (serviceName.Equals("sonarr", StringComparison.OrdinalIgnoreCase))
        {
            return ReadJsonString(item["series"], "title")
                ?? ReadJsonString(item, "seriesTitle")
                ?? ReadJsonString(item, "title")
                ?? "Upcoming episode";
        }

        if (serviceName.Equals("lidarr", StringComparison.OrdinalIgnoreCase))
        {
            return ReadJsonString(item, "title")
                ?? ReadJsonString(item, "albumTitle")
                ?? ReadJsonString(item["artist"], "artistName")
                ?? "Upcoming music release";
        }

        return ReadJsonString(item, "title")
            ?? ReadJsonString(item, "movieTitle")
            ?? "Upcoming movie";
    }

    private static string? GetArrCalendarDate(string serviceName, JsonObject item)
    {
        if (serviceName.Equals("sonarr", StringComparison.OrdinalIgnoreCase))
        {
            return ReadJsonString(item, "airDateUtc")
                ?? ReadJsonString(item, "airDate");
        }

        if (serviceName.Equals("lidarr", StringComparison.OrdinalIgnoreCase))
        {
            return ReadJsonString(item, "releaseDate")
                ?? ReadJsonString(item, "physicalRelease")
                ?? ReadJsonString(item, "digitalRelease");
        }

        return ReadJsonString(item, "inCinemas")
            ?? ReadJsonString(item, "digitalRelease")
            ?? ReadJsonString(item, "physicalRelease")
            ?? ReadJsonString(item, "releaseDate");
    }

    private static string? NormalizeDateForSort(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed)
            ? parsed.UtcDateTime.ToString("O", CultureInfo.InvariantCulture)
            : value;
    }

    private static ArrServiceSettings BuildArrTestSettings(string serviceName, PtvArrServiceSettingsPatch? settingsOverride)
    {
        var saved = GetArrServiceSettings(serviceName);
        var settings = new ArrServiceSettings
        {
            ApiKey = saved.ApiKey,
            Enabled = saved.Enabled,
            ExternalUrl = saved.ExternalUrl,
            InternalUrl = saved.InternalUrl
        };

        if (settingsOverride is null)
        {
            return settings;
        }

        settings.Enabled = settingsOverride.Enabled ?? settings.Enabled;
        settings.InternalUrl = settingsOverride.InternalUrl ?? settings.InternalUrl;
        settings.ExternalUrl = settingsOverride.ExternalUrl ?? settings.ExternalUrl;

        if (!string.IsNullOrWhiteSpace(settingsOverride.ApiKey))
        {
            settings.ApiKey = settingsOverride.ApiKey.Trim();
        }

        return settings;
    }

    private static ArrServiceSettings GetArrServiceSettings(string serviceName)
    {
        var arrSettings = GetNormalizedConfiguration().ArrSettings;

        return serviceName.ToLowerInvariant() switch
        {
            "sonarr" => arrSettings.Sonarr,
            "radarr" => arrSettings.Radarr,
            "lidarr" => arrSettings.Lidarr,
            "prowlarr" => arrSettings.Prowlarr,
            _ => new ArrServiceSettings()
        };
    }

    private async Task<object> TestJsonEndpointAsync(
        bool enabled,
        string baseUrl,
        string path,
        string? apiKey,
        string serviceName,
        CancellationToken cancellationToken,
        PtvProxyAuthMode authMode = PtvProxyAuthMode.ApiKey)
    {
        if (!enabled)
        {
            return new
            {
                ok = false,
                service = serviceName,
                error = $"{serviceName} integration is disabled."
            };
        }

        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            return new
            {
                ok = false,
                service = serviceName,
                error = $"{serviceName} internal URL is not configured."
            };
        }

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return new
            {
                ok = false,
                service = serviceName,
                error = $"{serviceName} API key is not configured."
            };
        }

        try
        {
            var result = await ProxyGetJsonAsync(baseUrl, path, apiKey, serviceName, cancellationToken, authMode).ConfigureAwait(false);

            return new
            {
                ok = true,
                service = serviceName,
                result
            };
        }
        catch (Exception ex)
        {
            LogEndpointFailure($"integrations/{serviceName}/test", ex);

            return new
            {
                ok = false,
                service = serviceName,
                error = RedactSecrets(ex.Message)
            };
        }
    }

    private async Task<object?> ProxyGetJsonAsync(
        string baseUrl,
        string path,
        string? apiKey,
        string routeName,
        CancellationToken cancellationToken,
        PtvProxyAuthMode authMode = PtvProxyAuthMode.ApiKey)
    {
        try
        {
            using var client = CreateProxyHttpClient(apiKey, authMode);
            using var response = await client.GetAsync(BuildProxyUri(baseUrl, path), cancellationToken).ConfigureAwait(false);
            var payload = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                return new
                {
                    ok = false,
                    statusCode = (int)response.StatusCode,
                    error = $"{routeName} returned HTTP {(int)response.StatusCode}."
                };
            }

            return string.IsNullOrWhiteSpace(payload)
                ? new { ok = true }
                : JsonNode.Parse(payload);
        }
        catch (Exception ex)
        {
            LogEndpointFailure(routeName, ex);

            return new
            {
                ok = false,
                error = RedactSecrets(ex.Message)
            };
        }
    }

    private async Task<object?> ProxyPostJsonAsync(
        string baseUrl,
        string path,
        string? apiKey,
        JsonNode body,
        string routeName,
        CancellationToken cancellationToken)
    {
        try
        {
            using var client = CreateProxyHttpClient(apiKey);
            using var content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
            using var response = await client.PostAsync(BuildProxyUri(baseUrl, path), content, cancellationToken).ConfigureAwait(false);
            var payload = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                return new
                {
                    ok = false,
                    statusCode = (int)response.StatusCode,
                    error = $"{routeName} returned HTTP {(int)response.StatusCode}."
                };
            }

            return string.IsNullOrWhiteSpace(payload)
                ? new { ok = true }
                : JsonNode.Parse(payload);
        }
        catch (Exception ex)
        {
            LogEndpointFailure(routeName, ex);

            return new
            {
                ok = false,
                error = RedactSecrets(ex.Message)
            };
        }
    }

    private async Task<JsonNode?> FetchProxyJsonNodeAsync(
        string baseUrl,
        string path,
        string? apiKey,
        string routeName,
        CancellationToken cancellationToken)
    {
        try
        {
            using var client = CreateProxyHttpClient(apiKey);
            using var response = await client.GetAsync(BuildProxyUri(baseUrl, path), cancellationToken).ConfigureAwait(false);
            var payload = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode || string.IsNullOrWhiteSpace(payload))
            {
                _logger.LogInformation(
                    "{RouteName} returned HTTP {StatusCode}.",
                    routeName,
                    (int)response.StatusCode);
                return null;
            }

            return JsonNode.Parse(payload);
        }
        catch (Exception ex)
        {
            LogEndpointFailure(routeName, ex);

            return null;
        }
    }

    private IReadOnlyList<BaseItem> GetRequestedLibraryItems(
        IReadOnlyList<PtvSeerrRequestedMedia> requestedMedia,
        int itemLimit)
    {
        var libraryItems = GetLibraryItems()
            .Where(HasVisibleName)
            .ToArray();
        var usedIds = new HashSet<Guid>();
        var matchedItems = new List<BaseItem>();

        foreach (var media in requestedMedia)
        {
            var item = libraryItems.FirstOrDefault(candidate =>
                !usedIds.Contains(candidate.Id) && MatchesRequestedMedia(candidate, media));

            if (item is null)
            {
                continue;
            }

            usedIds.Add(item.Id);
            matchedItems.Add(item);

            if (matchedItems.Count >= itemLimit)
            {
                break;
            }
        }

        return matchedItems;
    }

    private static IEnumerable<PtvSeerrRequestedMedia> ExtractSeerrRequestedMedia(JsonNode? payload)
    {
        foreach (var request in GetSeerrRequestObjects(payload))
        {
            var media = request["media"] as JsonObject ?? request;
            var tmdbId = ReadJsonString(media, "tmdbId") ?? ReadJsonString(request, "tmdbId");
            var tvdbId = ReadJsonString(media, "tvdbId") ?? ReadJsonString(request, "tvdbId");
            var imdbId = ReadJsonString(media, "imdbId") ?? ReadJsonString(request, "imdbId");

            if (string.IsNullOrWhiteSpace(tmdbId) && string.IsNullOrWhiteSpace(tvdbId) && string.IsNullOrWhiteSpace(imdbId))
            {
                continue;
            }

            yield return new PtvSeerrRequestedMedia(
                tmdbId,
                tvdbId,
                imdbId,
                ReadJsonString(media, "mediaType") ?? ReadJsonString(request, "type"),
                ReadJsonInt(request["requestedBy"], "id") ?? ReadJsonInt(request, "requestedBy"));
        }
    }

    private static IEnumerable<JsonObject> GetSeerrRequestObjects(JsonNode? payload)
    {
        if (payload is JsonArray array)
        {
            return array.OfType<JsonObject>();
        }

        if (payload is not JsonObject root)
        {
            return [];
        }

        foreach (var key in new[] { "results", "requests", "items" })
        {
            if (root[key] is JsonArray nestedArray)
            {
                return nestedArray.OfType<JsonObject>();
            }
        }

        return [];
    }

    private static bool MatchesSeerrRequester(PtvSeerrRequestedMedia media, int seerrUserId)
    {
        return media.RequestedByUserId is null || media.RequestedByUserId == seerrUserId;
    }

    private static bool MatchesRequestedMedia(BaseItem item, PtvSeerrRequestedMedia media)
    {
        if (media.MediaType?.Equals("movie", StringComparison.OrdinalIgnoreCase) == true
            && !GetItemType(item).Equals("Movie", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if ((media.MediaType?.Equals("tv", StringComparison.OrdinalIgnoreCase) == true
            || media.MediaType?.Equals("show", StringComparison.OrdinalIgnoreCase) == true)
            && !GetItemType(item).Equals("Series", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return HasProviderId(item, media.TmdbId, "Tmdb", "TMDb", "TheMovieDb")
            || HasProviderId(item, media.TvdbId, "Tvdb", "TVDb", "TheTvdb")
            || HasProviderId(item, media.ImdbId, "Imdb", "IMDb");
    }

    private static bool HasProviderId(BaseItem item, string? expectedValue, params string[] providerKeys)
    {
        if (string.IsNullOrWhiteSpace(expectedValue))
        {
            return false;
        }

        return item.ProviderIds.Any(provider =>
            providerKeys.Any(key => key.Equals(provider.Key, StringComparison.OrdinalIgnoreCase))
            && expectedValue.Equals(provider.Value, StringComparison.OrdinalIgnoreCase));
    }

    private static object ToSeerrRequestedItemDto(BaseItem item)
    {
        return new
        {
            Id = item.Id.ToString("N"),
            Name = item.Name,
            Type = GetItemType(item),
            ImageTags = new Dictionary<string, string?>
            {
                ["Primary"] = GetImageTag(item, ImageType.Primary),
                ["Thumb"] = GetImageTag(item, ImageType.Thumb),
                ["Logo"] = GetImageTag(item, ImageType.Logo)
            },
            BackdropImageTags = GetBackdropImageTags(item),
            Studios = item.Studios,
            Genres = item.Genres,
            ProviderIds = item.ProviderIds,
            item.CommunityRating,
            item.CriticRating,
            DateCreated = item.DateCreated,
            MediaType = item.MediaType.ToString(),
            item.OfficialRating,
            Overview = Truncate(item.Overview, 500),
            item.PremiereDate,
            PrimaryImageTag = GetImageTag(item, ImageType.Primary),
            item.ProductionYear,
            item.RunTimeTicks,
            PtvSource = "jellyseerr-request"
        };
    }

    private static string GetItemType(BaseItem item) => item.GetType().Name;

    private static string? GetImageTag(BaseItem item, ImageType imageType, int imageIndex = 0)
    {
        try
        {
            return item.GetImageInfo(imageType, imageIndex)?.DateModified.Ticks.ToString(CultureInfo.InvariantCulture);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    private async Task<PtvItemImageDiagnosticEntry> BuildImageDiagnosticEntryAsync(
        HttpClient httpClient,
        BaseItem item,
        ImageType imageType,
        int imageIndex,
        CancellationToken cancellationToken)
    {
        var imageInfo = GetImageInfoSafe(item, imageType, imageIndex);
        var imageTag = GetImageTag(imageInfo);
        var entry = new PtvItemImageDiagnosticEntry
        {
            ImageType = imageType.ToString(),
            ImageIndex = imageIndex,
            ImageTag = imageTag,
            ImagePath = imageInfo?.Path,
            FileExists = FileExistsSafe(imageInfo?.Path)
        };

        if (imageInfo is null)
        {
            return entry;
        }

        entry.UntaggedEndpoint = BuildImageEndpoint(item.Id, imageType, imageIndex, null);
        entry.TaggedEndpoint = imageTag is null
            ? null
            : BuildImageEndpoint(item.Id, imageType, imageIndex, imageTag);

        if (entry.TaggedEndpoint is not null)
        {
            entry.TaggedEndpointStatus = await ProbeImageEndpointStatusAsync(
                httpClient,
                entry.TaggedEndpoint,
                entry,
                cancellationToken).ConfigureAwait(false);
        }

        entry.UntaggedEndpointStatus = await ProbeImageEndpointStatusAsync(
            httpClient,
            entry.UntaggedEndpoint,
            entry,
            cancellationToken).ConfigureAwait(false);

        return entry;
    }

    private static ItemImageInfo? GetImageInfoSafe(BaseItem item, ImageType imageType, int imageIndex = 0)
    {
        try
        {
            return item.GetImageInfo(imageType, imageIndex);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    private static string? GetImageTag(ItemImageInfo? imageInfo)
    {
        return imageInfo?.DateModified.Ticks.ToString(CultureInfo.InvariantCulture);
    }

    private static bool FileExistsSafe(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return false;
        }

        try
        {
            return System.IO.File.Exists(path);
        }
        catch
        {
            return false;
        }
    }

    private static string BuildImageEndpoint(Guid itemId, ImageType imageType, int imageIndex, string? imageTag)
    {
        var imageSegment = imageType == ImageType.Backdrop
            ? $"{imageType}/{imageIndex}"
            : imageType.ToString();
        var endpoint = $"/Items/{itemId:N}/Images/{imageSegment}";

        return string.IsNullOrWhiteSpace(imageTag)
            ? endpoint
            : $"{endpoint}?tag={Uri.EscapeDataString(imageTag)}";
    }

    private async Task<int?> ProbeImageEndpointStatusAsync(
        HttpClient httpClient,
        string? relativeEndpoint,
        PtvItemImageDiagnosticEntry entry,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(relativeEndpoint))
        {
            return null;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, BuildCurrentServerUri(relativeEndpoint));
            CopyProbeAuthenticationHeaders(request);

            using var response = await httpClient
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
                .ConfigureAwait(false);

            return (int)response.StatusCode;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            entry.ProbeError = string.IsNullOrWhiteSpace(entry.ProbeError)
                ? RedactSecrets(ex.Message)
                : $"{entry.ProbeError} | {RedactSecrets(ex.Message)}";

            return null;
        }
    }

    private Uri BuildCurrentServerUri(string relativeEndpoint)
    {
        var normalizedEndpoint = relativeEndpoint.StartsWith("/", StringComparison.Ordinal)
            ? relativeEndpoint
            : $"/{relativeEndpoint}";
        var pathBase = Request.PathBase.HasValue ? Request.PathBase.Value : string.Empty;

        return new Uri(
            $"{Request.Scheme}://{Request.Host}{pathBase}{normalizedEndpoint}",
            UriKind.Absolute);
    }

    private void CopyProbeAuthenticationHeaders(HttpRequestMessage request)
    {
        foreach (var headerName in new[] { "Authorization", "X-Emby-Authorization", "X-Emby-Token", "Cookie" })
        {
            if (Request.Headers.TryGetValue(headerName, out var values))
            {
                request.Headers.TryAddWithoutValidation(headerName, values.ToArray());
            }
        }
    }

    private static bool TryParseItemId(string value, out Guid itemId)
    {
        var normalized = value.Trim();

        return Guid.TryParse(normalized, out itemId)
            || Guid.TryParseExact(normalized, "N", out itemId);
    }

    private static void AddImageDiagnosticWarnings(PtvItemImageDiagnosticResponse response)
    {
        var primary = response.Images.FirstOrDefault(image =>
            image.ImageType.Equals(ImageType.Primary.ToString(), StringComparison.OrdinalIgnoreCase)
            && image.ImageIndex == 0);

        if (primary is null || string.IsNullOrWhiteSpace(primary.ImagePath))
        {
            response.Warnings.Add("No Primary image metadata is recorded for this item.");
            return;
        }

        if (!primary.FileExists)
        {
            response.Warnings.Add("The Primary image path recorded by Jellyfin does not exist on disk. This often means the database was copied without the matching metadata/image cache folders, or the Jellyfin process cannot read the file.");
        }

        if (primary.StaleTagDetected)
        {
            response.Warnings.Add("The tagged Primary image endpoint returned 404, but the untagged endpoint worked. The image tag is stale and metadata/image cache should be refreshed.");
        }

        if (primary.TaggedEndpointStatus == StatusCodes.Status404NotFound && primary.UntaggedEndpointStatus == StatusCodes.Status404NotFound)
        {
            response.Warnings.Add("Both tagged and untagged Primary image endpoints returned 404. Restore the missing image files or refresh metadata with image replacement for this item.");
        }

        if (primary.FileExists && primary.TaggedEndpointStatus == StatusCodes.Status404NotFound && primary.UntaggedEndpointStatus == StatusCodes.Status404NotFound)
        {
            response.Warnings.Add("The Primary image file exists, but Jellyfin still returns 404. Check Jellyfin file permissions, image provider state, and metadata cache consistency.");
        }
    }

    private static string[] GetBackdropImageTags(BaseItem item)
    {
        var tags = new List<string>();

        for (var index = 0; index < 3; index++)
        {
            var tag = GetImageTag(item, ImageType.Backdrop, index);

            if (tag is null)
            {
                break;
            }

            tags.Add(tag);
        }

        return tags.ToArray();
    }

    private static int? ReadJsonInt(JsonNode? node, string propertyName)
    {
        var value = ReadJsonString(node, propertyName);

        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedValue)
            ? parsedValue
            : null;
    }

    private static bool? ReadJsonBool(JsonNode? node, string propertyName)
    {
        if (node is not JsonObject root || root[propertyName] is not { } value)
        {
            return null;
        }

        if (value is JsonValue jsonValue)
        {
            if (jsonValue.TryGetValue<bool>(out var boolValue))
            {
                return boolValue;
            }

            if (jsonValue.TryGetValue<int>(out var intValue))
            {
                return intValue > 0;
            }
        }

        return bool.TryParse(Convert.ToString(value.GetValue<object>(), CultureInfo.InvariantCulture), out var parsedValue)
            ? parsedValue
            : null;
    }

    private static string? ReadJsonString(JsonNode? node, string propertyName)
    {
        if (node is not JsonObject root || root[propertyName] is not { } value)
        {
            return null;
        }

        return Convert.ToString(value.GetValue<object>(), CultureInfo.InvariantCulture);
    }

    private static object? ParseProxyPayload(string payload)
    {
        if (string.IsNullOrWhiteSpace(payload))
        {
            return null;
        }

        try
        {
            return JsonNode.Parse(payload);
        }
        catch
        {
            return new
            {
                raw = RedactSecrets(payload.Length > 512 ? $"{payload[..512]}..." : payload)
            };
        }
    }

    private static bool LooksLikeTlsValidationFailure(Exception ex)
    {
        for (var current = ex; current is not null; current = current.InnerException!)
        {
            var message = current.Message;

            if (message.Contains("SSL", StringComparison.OrdinalIgnoreCase)
                || message.Contains("certificate", StringComparison.OrdinalIgnoreCase)
                || message.Contains("authentication", StringComparison.OrdinalIgnoreCase)
                || message.Contains("trust", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static HttpClient CreateProxyHttpClient(
        string? apiKey,
        PtvProxyAuthMode authMode = PtvProxyAuthMode.ApiKey,
        bool allowInvalidTlsCertificate = false)
    {
        var handler = new HttpClientHandler();

        if (allowInvalidTlsCertificate)
        {
            handler.ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;
        }

        var client = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(8)
        };

        client.DefaultRequestHeaders.Accept.ParseAdd("application/json");

        if (!string.IsNullOrWhiteSpace(apiKey))
        {
            if (authMode == PtvProxyAuthMode.Bearer)
            {
                client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", $"Bearer {apiKey.Trim()}");
            }
            else
            {
                client.DefaultRequestHeaders.TryAddWithoutValidation("X-Api-Key", apiKey.Trim());
            }
        }

        return client;
    }

    private enum PtvProxyAuthMode
    {
        ApiKey,
        Bearer
    }

    private sealed class PtvArrCalendarServiceResultDto
    {
        [JsonPropertyName("service")]
        public string Service { get; init; } = string.Empty;

        [JsonPropertyName("enabled")]
        public bool Enabled { get; init; }

        [JsonPropertyName("configured")]
        public bool Configured { get; init; }

        [JsonPropertyName("supported")]
        public bool Supported { get; init; }

        [JsonPropertyName("itemCount")]
        public int ItemCount { get; init; }

        [JsonPropertyName("statusCode")]
        public int? StatusCode { get; init; }

        [JsonPropertyName("error")]
        public string? Error { get; init; }
    }

    private sealed class PtvArrCalendarItemDto
    {
        [JsonPropertyName("id")]
        public string Id { get; init; } = string.Empty;

        [JsonPropertyName("service")]
        public string Service { get; init; } = string.Empty;

        [JsonPropertyName("title")]
        public string Title { get; init; } = string.Empty;

        [JsonPropertyName("seriesTitle")]
        public string? SeriesTitle { get; init; }

        [JsonPropertyName("episodeTitle")]
        public string? EpisodeTitle { get; init; }

        [JsonPropertyName("date")]
        public string? Date { get; init; }

        [JsonPropertyName("sortDate")]
        public string? SortDate { get; init; }

        [JsonPropertyName("seasonNumber")]
        public int? SeasonNumber { get; init; }

        [JsonPropertyName("episodeNumber")]
        public int? EpisodeNumber { get; init; }

        [JsonPropertyName("monitored")]
        public bool? Monitored { get; init; }

        [JsonPropertyName("hasFile")]
        public bool? HasFile { get; init; }

        [JsonPropertyName("status")]
        public string? Status { get; init; }

        [JsonPropertyName("overview")]
        public string? Overview { get; init; }

        [JsonPropertyName("externalUrl")]
        public string? ExternalUrl { get; init; }
    }

    private sealed record PtvSeerrRequestedMedia(
        string? TmdbId,
        string? TvdbId,
        string? ImdbId,
        string? MediaType,
        int? RequestedByUserId);

    private static Uri BuildProxyUri(string baseUrl, string path)
    {
        var normalizedBaseUrl = baseUrl.Trim().TrimEnd('/');
        var normalizedPath = path.StartsWith('/') ? path : $"/{path}";

        return new Uri($"{normalizedBaseUrl}{normalizedPath}", UriKind.Absolute);
    }

    private ActionResult GetRandomItem(string kind, string? libraryId)
    {
        try
        {
            var configuration = GetNormalizedConfiguration();

            if (!configuration.RandomSettings.Enabled)
            {
                return Ok(new
                {
                    ok = false,
                    error = "Random discovery is disabled."
                });
            }

            var items = GetLibraryItems()
                .Where(item => MatchesRandomKind(item, kind))
                .Where(item => HasVisibleName(item))
                .ToArray();

            if (items.Length == 0)
            {
                return Ok(new
                {
                    ok = false,
                    kind,
                    libraryId,
                    error = "No matching random item was found."
                });
            }

            var item = items[Random.Shared.Next(items.Length)];

            return Ok(new
            {
                ok = true,
                kind,
                libraryId,
                behavior = configuration.RandomSettings.Behavior,
                item = ToRandomItemDto(item)
            });
        }
        catch (Exception ex)
        {
            LogEndpointFailure($"random/{kind}", ex);

            return Ok(new
            {
                ok = false,
                kind,
                error = RedactSecrets(ex.Message)
            });
        }
    }

    private IReadOnlyList<BaseItem> GetLibraryItems()
    {
        var libraryManager = GetRequiredService<ILibraryManager>("library");

        return libraryManager.RootFolder.GetRecursiveChildren().ToArray();
    }

    private static bool MatchesRandomKind(BaseItem item, string kind)
    {
        var type = item.GetType().Name;

        return kind.ToLowerInvariant() switch
        {
            "movie" => string.Equals(type, "Movie", StringComparison.OrdinalIgnoreCase),
            "episode" => string.Equals(type, "Episode", StringComparison.OrdinalIgnoreCase),
            "anime" => IsAnimeItem(item),
            "library" => string.Equals(type, "Movie", StringComparison.OrdinalIgnoreCase)
                || string.Equals(type, "Episode", StringComparison.OrdinalIgnoreCase)
                || string.Equals(type, "Series", StringComparison.OrdinalIgnoreCase),
            _ => false
        };
    }

    private static bool IsAnimeItem(BaseItem item)
    {
        var text = NormalizeSearchText(string.Join(
            " ",
            item.Name,
            item.Overview,
            string.Join(" ", item.Genres),
            string.Join(" ", item.Studios),
            string.Join(" ", item.Tags ?? Array.Empty<string>())));

        return text.Contains("anime", StringComparison.Ordinal)
            || text.Contains("manga", StringComparison.Ordinal)
            || text.Contains("crunchyroll", StringComparison.Ordinal)
            || text.Contains("funimation", StringComparison.Ordinal)
            || text.Contains("toonami", StringComparison.Ordinal)
            || text.Contains("japanese animation", StringComparison.Ordinal);
    }

    private static bool HasVisibleName(BaseItem item)
    {
        return !string.IsNullOrWhiteSpace(item.Name);
    }

    private static object ToRandomItemDto(BaseItem item)
    {
        return new
        {
            id = item.Id.ToString("N"),
            name = item.Name,
            type = item.GetType().Name,
            mediaType = item.MediaType.ToString(),
            productionYear = item.ProductionYear,
            premiereDate = item.PremiereDate,
            overview = Truncate(item.Overview, 500),
            officialRating = item.OfficialRating
        };
    }

    private static string NormalizeSearchText(string value)
    {
        var normalized = value.ToLowerInvariant();

        foreach (var character in new[] { '\'', '’', ':', '-', '_', '.', ',', '&' })
        {
            normalized = normalized.Replace(character, ' ');
        }

        return string.Join(' ', normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    private static string? Truncate(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Length > maxLength ? value[..maxLength] : value;
    }

    private async Task<bool> CanWriteFeaturedContentAsync()
    {
        var authorizationService = GetRequiredService<IAuthorizationService>("authorization");
        var result = await authorizationService
            .AuthorizeAsync(User, Policies.RequiresElevation)
            .ConfigureAwait(false);

        return result.Succeeded;
    }

    private async Task<bool> CanWriteFeaturedContentSafeAsync(string routeName, ICollection<string>? failures = null)
    {
        try
        {
            return await CanWriteFeaturedContentAsync().ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            failures?.Add($"Authorization check failed: {ex.Message}");
            LogEndpointFailure(routeName, ex);

            return false;
        }
    }

    private async Task<PtvFeaturedContentStoreStatus> GetStoreStatusOrFallbackAsync(
        string routeName,
        ICollection<string> failures,
        CancellationToken cancellationToken)
    {
        try
        {
            var featuredContentStore = GetOptionalService<IPtvFeaturedContentStore>(routeName, failures);

            if (featuredContentStore is null)
            {
                return CreateFallbackStoreStatus("Featured cache store service is not registered.");
            }

            _logger.LogInformation(
                "PiggieTV cache store resolved. Route={RouteName}. StoreInstance={StoreInstance}. StoreType={StoreType}.",
                routeName,
                RuntimeHelpers.GetHashCode(featuredContentStore),
                featuredContentStore.GetType().FullName);

            var status = await featuredContentStore.GetStatusAsync(cancellationToken).ConfigureAwait(false);
            var featuredStatus = PtvFeaturedContentStatus.FromDocument(status.Document);

            _logger.LogInformation(
                "PiggieTV cache store status read. Route={RouteName}. StoreInstance={StoreInstance}. CacheFilePath={CacheFilePath}. FileLength={FileLength}. CacheVersion={CacheVersion}. HasPayload={HasPayload}. HeroCount={HeroCount}. SectionCount={SectionCount}. ItemCount={ItemCount}.",
                routeName,
                RuntimeHelpers.GetHashCode(featuredContentStore),
                status.CacheFilePath,
                status.CachePayloadBytes,
                featuredStatus.CacheVersion,
                featuredStatus.HasPayload,
                featuredStatus.HeroCount,
                featuredStatus.SectionCount,
                featuredStatus.ItemCount);

            return status;
        }
        catch (Exception ex)
        {
            failures.Add($"Featured cache status failed: {ex.Message}");
            LogEndpointFailure(routeName, ex);

            return CreateFallbackStoreStatus($"Featured cache status failed: {ex.Message}");
        }
    }

    private PtvFeaturedContentRefreshStatus GetRefreshStatusOrFallback(
        string routeName,
        PtvFeaturedContentStoreStatus storeStatus,
        ICollection<string> failures)
    {
        try
        {
            var featuredContentRefreshService = GetOptionalService<IPtvFeaturedContentRefreshService>(routeName, failures);

            if (featuredContentRefreshService is null)
            {
                return new PtvFeaturedContentRefreshStatus
                {
                    LastRefreshError = "Featured-content refresh service is not registered."
                };
            }

            return featuredContentRefreshService.GetRefreshStatus(storeStatus);
        }
        catch (Exception ex)
        {
            failures.Add($"Refresh status failed: {ex.Message}");
            LogEndpointFailure(routeName, ex);

            return new PtvFeaturedContentRefreshStatus
            {
                LastRefreshError = $"Refresh status failed: {ex.Message}"
            };
        }
    }

    private PtvTmdbMetadataStatus GetTmdbStatusOrFallback(string routeName, ICollection<string> failures)
    {
        try
        {
            var tmdbMetadataService = GetOptionalService<IPtvTmdbMetadataService>(routeName, failures);

            if (tmdbMetadataService is null)
            {
                return new PtvTmdbMetadataStatus
                {
                    LastError = "TMDb metadata service is not registered."
                };
            }

            return tmdbMetadataService.GetStatus();
        }
        catch (Exception ex)
        {
            failures.Add($"TMDb status failed: {ex.Message}");
            LogEndpointFailure(routeName, ex);

            return new PtvTmdbMetadataStatus
            {
                LastError = $"TMDb status failed: {ex.Message}"
            };
        }
    }

    private bool TryGetSettingsAvailable(string routeName, ICollection<string> failures)
    {
        try
        {
            var settingsService = GetOptionalService<IPtvPluginSettingsService>(routeName, failures);

            if (settingsService is null)
            {
                return false;
            }

            settingsService.GetSettings();
            return true;
        }
        catch (Exception ex)
        {
            failures.Add($"Settings unavailable: {ex.Message}");
            LogEndpointFailure(routeName, ex);

            return false;
        }
    }

    private PtvStatusIntegrations GetStatusIntegrations(string routeName)
    {
        try
        {
            GetNormalizedConfiguration();

            return PtvStatusIntegrations.Create();
        }
        catch (Exception ex)
        {
            LogEndpointFailure(routeName, ex);

            return PtvStatusIntegrations.Create();
        }
    }

    private PtvStatusSignup GetStatusSignup(string routeName)
    {
        try
        {
            var configuration = GetNormalizedConfiguration();

            return PtvStatusSignup.Create(configuration.SignupSettings);
        }
        catch (Exception ex)
        {
            LogEndpointFailure(routeName, ex);

            return PtvStatusSignup.Create();
        }
    }

    private static void ApplyDegradedStatus(PtvStatusResponse response, IReadOnlyCollection<string> failures)
    {
        if (failures.Count == 0)
        {
            response.Ok = true;
            response.Degraded = false;
            response.Error = null;
            return;
        }

        response.Ok = false;
        response.Degraded = true;
        response.Error = string.Join(" ", failures);
    }

    private static PtvStatusResponse CreateFallbackStatus(
        bool canWriteFeaturedContent,
        bool settingsAvailable,
        string error)
    {
        var now = DateTimeOffset.UtcNow;

        return new PtvStatusResponse
        {
            CanWriteFeaturedContent = canWriteFeaturedContent,
            CacheHealthy = false,
            Degraded = true,
            Error = error,
            FeaturedContent = new PtvFeaturedContentStatus(),
            Ok = false,
            ServerTime = now.ToUnixTimeMilliseconds(),
            ServerTimeUtc = now,
            SettingsAvailable = settingsAvailable
        };
    }

    private PtvFeaturedContentStoreStatus CreateFallbackStoreStatus(string error)
    {
        return new PtvFeaturedContentStoreStatus
        {
            CacheWriteError = error,
            Document = PtvFeaturedContentValidator.CreateEmptyDocument()
        };
    }

    private T? GetOptionalService<T>(string routeName, ICollection<string>? failures = null)
        where T : class
    {
        try
        {
            var service = _serviceProvider.GetService<T>();

            if (service is not null)
            {
                return service;
            }

            var message = $"PiggieTV service is not registered: {typeof(T).FullName}";
            failures?.Add(message);
            _logger.LogError(
                "PiggieTV API service resolution failed. Route: {RouteName}. Service: {ServiceType}.",
                routeName,
                typeof(T).FullName);

            return null;
        }
        catch (Exception ex)
        {
            failures?.Add($"Service resolution failed for {typeof(T).Name}: {ex.Message}");
            LogEndpointFailure(routeName, ex);

            return null;
        }
    }

    private T GetRequiredService<T>(string routeName)
        where T : class
    {
        return GetOptionalService<T>(routeName)
            ?? throw new InvalidOperationException($"Required PiggieTV service is not registered: {typeof(T).FullName}");
    }

    private void LogEndpointFailure(string routeName, Exception exception)
    {
        _logger.LogError(
            "PiggieTV API endpoint failed. Route: {RouteName}. ExceptionType: {ExceptionType}. Exception: {Exception}",
            routeName,
            exception.GetType().FullName,
            RedactSecrets(exception.ToString()));
    }

    private static int GetJsonPayloadByteCount(JsonElement payload)
    {
        try
        {
            return JsonSerializer.SerializeToUtf8Bytes(payload).Length;
        }
        catch
        {
            return 0;
        }
    }

    private static string DescribeJsonTopLevelKeys(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object)
        {
            return payload.ValueKind.ToString();
        }

        return string.Join(
            ",",
            payload.EnumerateObject()
                .Select(property => property.Name)
                .Take(40));
    }

    private static (int RowCount, string ItemCounts) DescribeRecommendationPayload(JsonElement payload)
    {
        if (!TryGetJsonProperty(payload, "recommendations", out var recommendations)
            || !TryGetJsonProperty(recommendations, "rows", out var rows)
            || rows.ValueKind != JsonValueKind.Array)
        {
            return (0, string.Empty);
        }

        var counts = new List<string>();
        var rowCount = 0;

        foreach (var row in rows.EnumerateArray())
        {
            rowCount++;
            var rowId = TryGetJsonProperty(row, "id", out var idProperty) && idProperty.ValueKind == JsonValueKind.String
                ? idProperty.GetString() ?? $"row-{rowCount}"
                : $"row-{rowCount}";
            var itemCount = TryGetJsonProperty(row, "items", out var items) && items.ValueKind == JsonValueKind.Array
                ? items.GetArrayLength()
                : 0;

            counts.Add($"{rowId}:{itemCount}");
        }

        return (rowCount, string.Join(",", counts));
    }

    private static bool TryGetJsonProperty(JsonElement element, string propertyName, out JsonElement property)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var currentProperty in element.EnumerateObject())
            {
                if (string.Equals(currentProperty.Name, propertyName, StringComparison.OrdinalIgnoreCase))
                {
                    property = currentProperty.Value;
                    return true;
                }
            }
        }

        property = default;
        return false;
    }

    private static List<string> ValidateRecommendationSettingsPatch(RecommendationRowSettings? settings)
    {
        var errors = new List<string>();

        if (settings is null)
        {
            return errors;
        }

        var rows = settings.Rows ?? [];

        if (rows.Count > 40)
        {
            errors.Add("recommendations.rows must contain 40 or fewer rows.");
        }

        var seenRowIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var rowIndex = 0; rowIndex < rows.Count; rowIndex++)
        {
            var row = rows[rowIndex];

            if (row is null)
            {
                errors.Add($"row[{rowIndex}] cannot be null.");
                continue;
            }

            var items = row.Items ?? [];
            var rowLabel = string.IsNullOrWhiteSpace(row.Id) ? $"row[{rowIndex}]" : row.Id;

            if (string.IsNullOrWhiteSpace(row.Id))
            {
                errors.Add($"{rowLabel}.id is required.");
            }
            else if (!seenRowIds.Add(row.Id))
            {
                errors.Add($"{rowLabel}.id is duplicated.");
            }

            if (string.IsNullOrWhiteSpace(row.Title))
            {
                errors.Add($"{rowLabel}.title is required.");
            }

            if (items.Count == 0)
            {
                errors.Add($"{rowLabel}.items must contain at least one item reference.");
            }

            if (items.Count > PtvPluginSettingsNormalizer.MaxRowMaxItems)
            {
                errors.Add($"{rowLabel}.items must contain {PtvPluginSettingsNormalizer.MaxRowMaxItems} or fewer item references.");
            }

            for (var itemIndex = 0; itemIndex < items.Count; itemIndex++)
            {
                if (items[itemIndex] is null || string.IsNullOrWhiteSpace(items[itemIndex].Id))
                {
                    errors.Add($"{rowLabel}.items[{itemIndex}].Id is required.");
                }
            }
        }

        return errors.Take(30).ToList();
    }

    private static string DescribeRecommendationItemCounts(RecommendationRowSettings settings)
    {
        return string.Join(
            ",",
            settings.Rows.Select(row => $"{row.Id}:{row.Items.Count}"));
    }

    private static string RedactSecrets(string value)
    {
        return value
            .Replace("tmdbApiToken", "tmdbApiToken[redacted]", StringComparison.OrdinalIgnoreCase)
            .Replace("authorization", "authorization[redacted]", StringComparison.OrdinalIgnoreCase)
            .Replace("bearer ", "bearer [redacted] ", StringComparison.OrdinalIgnoreCase);
    }

    private static PtvErrorResponse Error(string code, string message)
    {
        return new PtvErrorResponse(code, message);
    }

    private static object DiagnosticError(string code, string routeName, Exception exception)
    {
        return new
        {
            code,
            error = RedactSecrets(exception.Message),
            inner = exception.InnerException is null ? null : RedactSecrets(exception.InnerException.Message),
            route = routeName,
            stack = exception.StackTrace is null ? null : RedactSecrets(exception.StackTrace)
        };
    }
}
