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
using System.Text;
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
            "PtvStatusController loaded. Routes: GET /Ptv/v1/status, GET /Ptv/v1/settings, GET /Ptv/v1/featured, POST /Ptv/v1/featured/refresh, GET /Ptv/v1/integrations/status, GET/POST /Ptv/v1/integrations/jfa-go/test, GET/POST /Ptv/v1/integrations/jfago/test, GET /Ptv/v1/tags, GET /Ptv/v1/random/movie.");
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
                        ["featuredContent"] = true,
                        ["featuredContentRefresh"] = true,
                        ["integrations"] = true,
                        ["tags"] = true,
                        ["random"] = true
                    },
                    features = new[]
                    {
                        "status",
                        "settings",
                        "featuredContent",
                        "featuredContentRefresh",
                        "integrations",
                        "tags",
                        "random"
                    },
                    ok = true,
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

            _logger.LogInformation(
                "PiggieTV status full diagnostics: cache loaded. CachePathExists={CachePathExists}. FeaturedCacheExists={FeaturedCacheExists}. CacheWriteError={CacheWriteError}.",
                storeStatus.CachePathExists,
                storeStatus.FeaturedCacheExists,
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
            ApplyDegradedStatus(response, failures);

            _logger.LogInformation(
                "PiggieTV status full diagnostics: DTO built. Ok={Ok}. Degraded={Degraded}. CacheHealthy={CacheHealthy}. Preparing JSON serialization.",
                response.Ok,
                response.Degraded,
                response.CacheHealthy);
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

            return StatusCode(
                StatusCodes.Status500InternalServerError,
                DiagnosticError("PTV_STATUS_CRASHED", PtvApiRoutes.V1StatusLower, ex));
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
            var document = await featuredContentStore.ReadAsync(cancellationToken).ConfigureAwait(false);

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
    /// Saves PiggieTV plugin settings from the dashboard.
    /// </summary>
    /// <param name="settings">Incoming plugin settings patch.</param>
    /// <returns>Saved public plugin settings.</returns>
    [HttpPost("settings")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PtvPluginSettingsDto>> SaveSettings([FromBody] PtvPluginSettingsPatchDto? settings)
    {
        if (!await CanWriteFeaturedContentSafeAsync(PtvApiRoutes.V1Settings).ConfigureAwait(false))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error("PTV_SETTINGS_WRITE_FORBIDDEN", "Only Jellyfin administrators can save PiggieTV plugin settings."));
        }

        if (settings is null)
        {
            return BadRequest(Error("PTV_SETTINGS_NULL_PAYLOAD", "PiggieTV plugin settings are required."));
        }

        try
        {
            var settingsService = GetRequiredService<IPtvPluginSettingsService>(PtvApiRoutes.V1Settings);

            return Ok(settingsService.SaveSettings(settings));
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
    /// <returns>Saved row-builder settings.</returns>
    [HttpPost("rows")]
    public async Task<ActionResult<RowBuilderSettings>> SaveRows([FromBody] RowBuilderSettings? settings)
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

        return Ok(saved.Rows);
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
                jfaGo = PtvPublicJfaGoSettings.FromConfiguration(configuration),
                arr = PtvPublicArrSettings.FromConfiguration(configuration),
                downloads = PtvPublicDownloadSettings.FromConfiguration(configuration),
                endpoints = new
                {
                    jfaGoTest = "/Ptv/v1/integrations/jfa-go/test",
                    jfaGoTestAlias = "/Ptv/v1/integrations/jfago/test",
                    jfaGoTestMethods = new[] { "GET", "POST" }
                },
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
    /// Tests saved jfa-go connectivity from the Jellyfin server.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Redacted test result.</returns>
    [HttpGet("integrations/jfa-go/test")]
    [HttpGet("integrations/jfago/test")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult> TestSavedJfaGo(CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync("integrations/jfa-go/test").ConfigureAwait(false))
        {
            return StatusCode(StatusCodes.Status403Forbidden, Error("PTV_INTEGRATION_TEST_FORBIDDEN", "Only Jellyfin administrators can test PiggieTV integrations."));
        }

        var settings = BuildJfaGoTestSettings(null);

        return Ok(await TestJfaGoEndpointAsync(settings, cancellationToken).ConfigureAwait(false));
    }

    /// <summary>
    /// Tests jfa-go connectivity from the Jellyfin server with optional unsaved settings.
    /// </summary>
    /// <param name="settingsOverride">Optional unsaved settings to test.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Redacted test result.</returns>
    [HttpPost("integrations/jfa-go/test")]
    [HttpPost("integrations/jfago/test")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<ActionResult> TestJfaGo(
        [FromBody] PtvJfaGoSettingsPatch? settingsOverride,
        CancellationToken cancellationToken)
    {
        if (!await CanWriteFeaturedContentSafeAsync("integrations/jfa-go/test").ConfigureAwait(false))
        {
            return StatusCode(StatusCodes.Status403Forbidden, Error("PTV_INTEGRATION_TEST_FORBIDDEN", "Only Jellyfin administrators can test PiggieTV integrations."));
        }

        var settings = BuildJfaGoTestSettings(settingsOverride);

        return Ok(await TestJfaGoEndpointAsync(settings, cancellationToken).ConfigureAwait(false));
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
    /// Gets an aggregated *Arr calendar placeholder through the PiggieTV backend.
    /// </summary>
    /// <returns>Calendar status.</returns>
    [HttpGet("integrations/arr/calendar")]
    public ActionResult GetArrCalendar()
    {
        return Ok(new
        {
            ok = true,
            items = Array.Empty<object>(),
            message = "Calendar proxy endpoint is available. Configure service-specific calendar adapters next."
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
            "/api/v3/system/status",
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
        }

        return settings;
    }

    private static JfaGoSettings BuildJfaGoTestSettings(PtvJfaGoSettingsPatch? settingsOverride)
    {
        var saved = GetNormalizedConfiguration().JfaGoSettings;
        var settings = new JfaGoSettings
        {
            AllowSelfSignedTls = saved.AllowSelfSignedTls,
            ApiKey = saved.ApiKey,
            DisplayName = saved.DisplayName,
            Enabled = saved.Enabled,
            ExternalUrl = saved.ExternalUrl,
            InternalUrl = saved.InternalUrl
        };

        if (settingsOverride is null)
        {
            return settings;
        }

        settings.Enabled = settingsOverride.Enabled ?? settings.Enabled;
        settings.DisplayName = settingsOverride.DisplayName ?? settings.DisplayName;
        settings.InternalUrl = settingsOverride.InternalUrl ?? settings.InternalUrl;
        settings.ExternalUrl = settingsOverride.ExternalUrl ?? settings.ExternalUrl;
        settings.AllowSelfSignedTls = settingsOverride.AllowSelfSignedTls ?? settingsOverride.InsecureTls ?? settings.AllowSelfSignedTls;

        if (!string.IsNullOrWhiteSpace(settingsOverride.ApiKey))
        {
            settings.ApiKey = settingsOverride.ApiKey.Trim();
        }

        return settings;
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

    private async Task<object> TestJfaGoEndpointAsync(
        JfaGoSettings settings,
        CancellationToken cancellationToken)
    {
        const string serviceName = "jfa-go";
        const string endpointPath = "/config";

        if (!settings.Enabled)
        {
            return new
            {
                ok = false,
                service = serviceName,
                endpoint = string.Empty,
                statusCode = (int?)null,
                message = "jfa-go integration is disabled."
            };
        }

        if (string.IsNullOrWhiteSpace(settings.InternalUrl))
        {
            return new
            {
                ok = false,
                service = serviceName,
                endpoint = string.Empty,
                statusCode = (int?)null,
                message = "jfa-go internal URL is not configured."
            };
        }

        Uri endpoint;

        try
        {
            endpoint = BuildProxyUri(settings.InternalUrl, endpointPath);
        }
        catch (Exception ex)
        {
            return new
            {
                ok = false,
                service = serviceName,
                endpoint = RedactSecrets(settings.InternalUrl),
                statusCode = (int?)null,
                message = "jfa-go internal URL is invalid.",
                details = new
                {
                    error = RedactSecrets(ex.Message)
                }
            };
        }

        if (string.IsNullOrWhiteSpace(settings.ApiKey))
        {
            return new
            {
                ok = false,
                service = serviceName,
                endpoint = RedactSecrets(endpoint.ToString()),
                statusCode = (int?)null,
                message = "jfa-go API token is not configured."
            };
        }

        try
        {
            using var client = CreateProxyHttpClient(settings.ApiKey, PtvProxyAuthMode.Bearer, settings.AllowSelfSignedTls);
            using var response = await client.GetAsync(endpoint, cancellationToken).ConfigureAwait(false);
            var payload = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            var details = ParseProxyPayload(payload);

            if (!response.IsSuccessStatusCode)
            {
                return new
                {
                    ok = false,
                    service = serviceName,
                    endpoint = RedactSecrets(endpoint.ToString()),
                    statusCode = (int)response.StatusCode,
                    message = $"jfa-go returned HTTP {(int)response.StatusCode}.",
                    details
                };
            }

            return new
            {
                ok = true,
                service = serviceName,
                endpoint = RedactSecrets(endpoint.ToString()),
                statusCode = (int)response.StatusCode,
                message = "jfa-go connection succeeded.",
                details
            };
        }
        catch (HttpRequestException ex) when (LooksLikeTlsValidationFailure(ex))
        {
            LogEndpointFailure("integrations/jfa-go/test", ex);

            return new
            {
                ok = false,
                service = serviceName,
                endpoint = RedactSecrets(endpoint.ToString()),
                statusCode = (int?)null,
                message = "jfa-go TLS validation failed. Enable self-signed TLS only for trusted LAN/internal jfa-go endpoints.",
                details = new
                {
                    allowSelfSignedTls = settings.AllowSelfSignedTls,
                    error = RedactSecrets(ex.Message)
                }
            };
        }
        catch (Exception ex)
        {
            LogEndpointFailure("integrations/jfa-go/test", ex);

            return new
            {
                ok = false,
                service = serviceName,
                endpoint = RedactSecrets(endpoint.ToString()),
                statusCode = (int?)null,
                message = RedactSecrets(ex.Message),
                details = new
                {
                    allowSelfSignedTls = settings.AllowSelfSignedTls
                }
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

            return await featuredContentStore.GetStatusAsync(cancellationToken).ConfigureAwait(false);
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
