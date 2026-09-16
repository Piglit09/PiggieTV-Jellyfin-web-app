using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Api;

/// <summary>
/// Local, ephemeral coordination for opt-in PiggieTV client diagnostics.
/// </summary>
[ApiController]
[Authorize]
[Route("Ptv/v1/diagnostics/clients")]
public sealed class PtvRemoteDiagnosticsController : BaseJellyfinApiController
{
    private const int MaximumReportBytes = 192 * 1024;
    private const int MaximumPresenceBytes = 8 * 1024;
    private const int MaximumJsonDepth = 10;
    private const int MaximumJsonNodes = 4000;
    private const int MaximumArrayItems = 500;
    private const int MaximumObjectProperties = 96;
    private const int MaximumStringLength = 1024;

    private static readonly string[] SensitivePropertyFragments =
    [
        "authorization",
        "cookie",
        "credential",
        "password",
        "secret",
        "token",
        "apikey",
        "api-key",
        "accesskey"
    ];
    private static readonly Regex SensitiveStringContentPattern = new(
        @"(?:https?://|file://|[a-z]:\\|\\\\|(?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|credential|password|secret|token)\s*[:=]|sk-(?:proj-)?[a-z0-9_-]{20,}|[^\s]+\.(?:3gp|aac|avi|cb7|cbr|cbt|cbz|epub|flac|flv|gif|jpe?g|m2ts|m4a|m4v|mkv|mov|mp3|mp4|ogg|opus|pdf|png|ts|wav|webm|webp|wmv)\b)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase,
        TimeSpan.FromMilliseconds(50));
    private static readonly Regex QueryValuePattern = new(
        @"[?&][a-z0-9_.~-]{1,64}=[^&#\s)""']*",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase,
        TimeSpan.FromMilliseconds(50));

    private readonly IAuthorizationService _authorizationService;
    private readonly ILogger<PtvRemoteDiagnosticsController> _logger;
    private readonly IPtvRollingDiagnosticsWriter? _rollingDiagnosticsWriter;
    private readonly IPtvRemoteDiagnosticsStore _store;

    /// <summary>Initializes a new instance of the controller.</summary>
    public PtvRemoteDiagnosticsController(
        ILogger<PtvRemoteDiagnosticsController> logger,
        IPtvRemoteDiagnosticsStore store,
        IAuthorizationService authorizationService,
        IPtvRollingDiagnosticsWriter? rollingDiagnosticsWriter = null)
    {
        _logger = logger;
        _store = store;
        _authorizationService = authorizationService;
        _rollingDiagnosticsWriter = rollingDiagnosticsWriter;
    }

    /// <summary>
    /// Records minimal client presence and returns a temporary diagnostics command.
    /// </summary>
    [HttpPost("check-in")]
    [RequestSizeLimit(MaximumPresenceBytes)]
    [ProducesResponseType(typeof(PtvRemoteDiagnosticsCommand), StatusCodes.Status200OK)]
    public ActionResult<PtvRemoteDiagnosticsCommand> CheckIn([FromBody] PtvRemoteDiagnosticsPresence? presence)
    {
        if (presence is null || presence.SchemaVersion != 1 || string.IsNullOrWhiteSpace(presence.ClientId))
        {
            return BadRequest(new PtvErrorResponse("diagnostics-registration-failed", "A schema-v1 client presence payload is required."));
        }

        var ownerKey = GetAuthenticatedOwnerKey();
        if (ownerKey is null)
        {
            return Unauthorized(new PtvErrorResponse("diagnostics-registration-auth-required", "An authenticated Jellyfin user identity is required."));
        }

        var command = _store.CheckIn(ownerKey, presence);
        _rollingDiagnosticsWriter?.Enqueue(new PtvRollingDiagnosticEvent
        {
            Category = "remote",
            ClientId = presence.ClientId,
            Detail = new { profile = presence.Profile?.Kind, route = presence.Route },
            EventName = "client-check-in",
            Level = "information"
        });
        return Ok(command);
    }

    /// <summary>
    /// Publishes a bounded report for the client's active temporary session.
    /// </summary>
    [HttpPost("report")]
    [RequestSizeLimit(MaximumReportBytes)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public ActionResult PublishReport([FromBody] JsonElement report)
    {
        var rawReport = report.GetRawText();
        if (Encoding.UTF8.GetByteCount(rawReport) > MaximumReportBytes)
        {
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new PtvErrorResponse(
                "PTV_DIAGNOSTICS_REPORT_TOO_LARGE",
                $"Diagnostics reports are limited to {MaximumReportBytes} bytes."));
        }

        if (!TryGetReportClientId(report, out var clientId))
        {
            return BadRequest(new PtvErrorResponse("PTV_DIAGNOSTICS_INVALID_REPORT", "The report must contain client.clientId."));
        }

        var ownerKey = GetAuthenticatedOwnerKey();
        if (ownerKey is null)
        {
            return Unauthorized(new PtvErrorResponse("PTV_DIAGNOSTICS_IDENTITY_REQUIRED", "An authenticated Jellyfin user identity is required."));
        }

        var sanitized = PtvDiagnosticsSanitizer.Sanitize(report);
        if (!_store.PublishReport(ownerKey, clientId, sanitized))
        {
            return Conflict(new PtvErrorResponse(
                "PTV_DIAGNOSTICS_SESSION_INACTIVE",
                "The diagnostics lease is missing or expired. Start a new temporary session and retry."));
        }

        _rollingDiagnosticsWriter?.Enqueue(new PtvRollingDiagnosticEvent
        {
            Category = "remote",
            ClientId = clientId,
            Detail = sanitized,
            EventName = "client-report",
            Level = "information"
        });

        return NoContent();
    }

    /// <summary>Lists recently seen PiggieTV clients for an administrator.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<PtvRemoteDiagnosticsClientSummary>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PtvRemoteDiagnosticsClientSummary>>> GetClients(
        [FromQuery] string? profile,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false))
        {
            return Forbid();
        }

        return Ok(_store.GetClients(profile));
    }

    /// <summary>Starts a five- or ten-minute collection lease for one client.</summary>
    [HttpPost("{clientId}/sessions")]
    [ProducesResponseType(typeof(PtvRemoteDiagnosticsCommand), StatusCodes.Status200OK)]
    public async Task<ActionResult<PtvRemoteDiagnosticsCommand>> StartSession(
        string clientId,
        [FromBody] PtvRemoteDiagnosticsStartRequest? request,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false))
        {
            return Forbid();
        }

        if (request is null || request.DurationMinutes is not (5 or 10))
        {
            return BadRequest(new PtvErrorResponse(
                "PTV_DIAGNOSTICS_INVALID_DURATION",
                "Remote diagnostics can be enabled for five or ten minutes."));
        }

        var command = _store.StartSession(clientId, request.DurationMinutes);
        return command is null
            ? NotFound(new PtvErrorResponse("PTV_DIAGNOSTICS_CLIENT_NOT_FOUND", "The selected client is no longer available."))
            : Ok(command);
    }

    /// <summary>Stops collection on one client.</summary>
    [HttpDelete("{clientId}/sessions")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult> StopSession(string clientId, CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false))
        {
            return Forbid();
        }

        return _store.StopSession(clientId)
            ? NoContent()
            : NotFound(new PtvErrorResponse("PTV_DIAGNOSTICS_CLIENT_NOT_FOUND", "The selected client is no longer available."));
    }

    /// <summary>Requests one immediate bounded snapshot from a client.</summary>
    [HttpPost("{clientId}/snapshot")]
    [ProducesResponseType(typeof(PtvRemoteDiagnosticsCommand), StatusCodes.Status200OK)]
    public async Task<ActionResult<PtvRemoteDiagnosticsCommand>> RequestSnapshot(
        string clientId,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false))
        {
            return Forbid();
        }

        var command = _store.RequestSnapshot(clientId);
        return command is null
            ? NotFound(new PtvErrorResponse("PTV_DIAGNOSTICS_CLIENT_NOT_FOUND", "The selected client is no longer available."))
            : Ok(command);
    }

    /// <summary>Views the latest unexpired report for one client.</summary>
    [HttpGet("{clientId}/report")]
    [ProducesResponseType(typeof(PtvRemoteDiagnosticsStoredReport), StatusCodes.Status200OK)]
    public async Task<ActionResult<PtvRemoteDiagnosticsStoredReport>> GetReport(
        string clientId,
        CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false))
        {
            return Forbid();
        }

        var report = _store.GetReport(clientId);
        return report is null
            ? NotFound(new PtvErrorResponse("PTV_DIAGNOSTICS_REPORT_NOT_FOUND", "No unexpired report is available for this client."))
            : Ok(report);
    }

    /// <summary>Downloads the latest unexpired report for one client.</summary>
    [HttpGet("{clientId}/report/download")]
    [Produces("application/json")]
    public async Task<ActionResult> DownloadReport(string clientId, CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false))
        {
            return Forbid();
        }

        var report = _store.GetReport(clientId);
        if (report is null)
        {
            return NotFound(new PtvErrorResponse("PTV_DIAGNOSTICS_REPORT_NOT_FOUND", "No unexpired report is available for this client."));
        }

        var fileName = $"piggie-tv-diagnostics-{report.ReceivedAtUtc:yyyyMMdd-HHmmss}.json";
        return File(Encoding.UTF8.GetBytes(report.Report.GetRawText()), "application/json", fileName);
    }

    /// <summary>Returns bounded rolling diagnostics storage status.</summary>
    [HttpGet("~/Ptv/v1/diagnostics/storage")]
    [ProducesResponseType(typeof(PtvDiagnosticsStorageStatus), StatusCodes.Status200OK)]
    public async Task<ActionResult<PtvDiagnosticsStorageStatus>> GetStorage(CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false)) return Forbid();
        return Ok(_rollingDiagnosticsWriter?.GetStatus() ?? new PtvDiagnosticsStorageStatus());
    }

    /// <summary>Downloads the active rolling JSONL log.</summary>
    [HttpGet("~/Ptv/v1/diagnostics/storage/download")]
    public async Task<ActionResult> DownloadStorageLog(CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false)) return Forbid();
        var payload = _rollingDiagnosticsWriter is null ? [] : await _rollingDiagnosticsWriter.ReadActiveLogAsync(cancellationToken).ConfigureAwait(false);
        return File(payload, "application/x-ndjson", "ptv-diagnostics.log");
    }

    /// <summary>Downloads a temporary in-memory ZIP of retained rolling diagnostics.</summary>
    [HttpGet("~/Ptv/v1/diagnostics/storage/bundle")]
    public async Task<ActionResult> DownloadStorageBundle(CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false)) return Forbid();
        var payload = _rollingDiagnosticsWriter is null ? [] : await _rollingDiagnosticsWriter.CreateBundleAsync(cancellationToken).ConfigureAwait(false);
        return File(payload, "application/zip", "ptv-diagnostics-bundle.zip");
    }

    /// <summary>Forces a safe rolling-log rotation.</summary>
    [HttpPost("~/Ptv/v1/diagnostics/storage/rotate")]
    public async Task<ActionResult<PtvDiagnosticsStorageActionResult>> RotateStorage(CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false)) return Forbid();
        if (_rollingDiagnosticsWriter is not null) await _rollingDiagnosticsWriter.RotateAsync(cancellationToken).ConfigureAwait(false);
        return Ok(new PtvDiagnosticsStorageActionResult { Message = "Diagnostics log rotated." });
    }

    /// <summary>Deletes only recognized rolling diagnostics logs after explicit confirmation.</summary>
    [HttpPost("~/Ptv/v1/diagnostics/storage/clear")]
    public async Task<ActionResult<PtvDiagnosticsStorageActionResult>> ClearStorage([FromBody] PtvDiagnosticsStorageActionRequest? request, CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false)) return Forbid();
        if (request?.Confirm != true) return BadRequest(new PtvErrorResponse("PTV_DIAGNOSTICS_CONFIRM_REQUIRED", "Clear diagnostics logs requires explicit confirmation."));
        return Ok(_rollingDiagnosticsWriter is null ? new PtvDiagnosticsStorageActionResult { Message = "Diagnostics storage is unavailable." } : await _rollingDiagnosticsWriter.ClearAsync(cancellationToken).ConfigureAwait(false));
    }

    /// <summary>Archives and removes only verified legacy PTV diagnostics files after confirmation.</summary>
    [HttpPost("~/Ptv/v1/diagnostics/storage/consolidate")]
    public async Task<ActionResult<PtvDiagnosticsStorageActionResult>> ConsolidateLegacyStorage([FromBody] PtvDiagnosticsStorageActionRequest? request, CancellationToken cancellationToken)
    {
        if (!await IsAdministratorAsync(cancellationToken).ConfigureAwait(false)) return Forbid();
        if (request?.Confirm != true) return BadRequest(new PtvErrorResponse("PTV_DIAGNOSTICS_CONFIRM_REQUIRED", "Consolidating legacy diagnostics requires explicit confirmation."));
        return Ok(_rollingDiagnosticsWriter is null ? new PtvDiagnosticsStorageActionResult { Message = "Diagnostics storage is unavailable." } : await _rollingDiagnosticsWriter.ConsolidateLegacyAsync(request.CreateArchive, cancellationToken).ConfigureAwait(false));
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
            _logger.LogWarning(ex, "PiggieTV remote diagnostics authorization check failed.");
            cancellationToken.ThrowIfCancellationRequested();
            return false;
        }
    }

    private string? GetAuthenticatedOwnerKey()
    {
        var identity = User.FindFirstValue("Jellyfin-UserId")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? User.Identity?.Name;

        if (string.IsNullOrWhiteSpace(identity))
        {
            return null;
        }

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)));
    }

    private static bool TryGetReportClientId(JsonElement report, out string clientId)
    {
        clientId = string.Empty;
        if (report.ValueKind != JsonValueKind.Object
            || !report.TryGetProperty("schemaVersion", out var schemaVersion)
            || schemaVersion.ValueKind != JsonValueKind.Number
            || !schemaVersion.TryGetInt32(out var version)
            || version != 1
            || !report.TryGetProperty("client", out var client)
            || client.ValueKind != JsonValueKind.Object
            || !client.TryGetProperty("clientId", out var clientIdElement)
            || clientIdElement.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        clientId = clientIdElement.GetString() ?? string.Empty;
        return clientId.Length > 0;
    }

    private static JsonElement SanitizeReport(JsonElement report)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            var remainingNodes = MaximumJsonNodes;
            WriteSanitizedElement(writer, report, null, 0, ref remainingNodes);
        }

        using var sanitizedDocument = JsonDocument.Parse(buffer.ToArray());
        return sanitizedDocument.RootElement.Clone();
    }

    private static void WriteSanitizedElement(
        Utf8JsonWriter writer,
        JsonElement element,
        string? propertyName,
        int depth,
        ref int remainingNodes)
    {
        if (remainingNodes-- <= 0 || depth > MaximumJsonDepth)
        {
            writer.WriteStringValue("[truncated]");
            return;
        }

        if (IsSensitiveProperty(propertyName))
        {
            writer.WriteStringValue("[redacted]");
            return;
        }

        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in element.EnumerateObject().Take(MaximumObjectProperties))
                {
                    var safeName = Truncate(property.Name, 64);
                    writer.WritePropertyName(safeName);
                    WriteSanitizedElement(writer, property.Value, safeName, depth + 1, ref remainingNodes);
                }

                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in element.EnumerateArray().Take(MaximumArrayItems))
                {
                    WriteSanitizedElement(writer, item, propertyName, depth + 1, ref remainingNodes);
                }

                writer.WriteEndArray();
                break;
            case JsonValueKind.String:
                writer.WriteStringValue(SanitizeString(element.GetString()));
                break;
            case JsonValueKind.Number:
                element.WriteTo(writer);
                break;
            case JsonValueKind.True:
                writer.WriteBooleanValue(true);
                break;
            case JsonValueKind.False:
                writer.WriteBooleanValue(false);
                break;
            default:
                writer.WriteNullValue();
                break;
        }
    }

    private static bool IsSensitiveProperty(string? propertyName)
    {
        if (string.IsNullOrWhiteSpace(propertyName))
        {
            return false;
        }

        var normalized = propertyName.Replace("_", string.Empty, StringComparison.Ordinal)
            .Replace("-", string.Empty, StringComparison.Ordinal);
        return SensitivePropertyFragments.Any(fragment => normalized.Contains(
            fragment.Replace("-", string.Empty, StringComparison.Ordinal),
            StringComparison.OrdinalIgnoreCase));
    }

    private static string SanitizeString(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        var normalized = value.ReplaceLineEndings("\n");
        if (normalized.Contains("Bearer ", StringComparison.OrdinalIgnoreCase)
            || SensitiveStringContentPattern.IsMatch(normalized))
        {
            return "[redacted]";
        }

        return Truncate(QueryValuePattern.Replace(normalized, "[query-omitted]"), MaximumStringLength);
    }

    private static string Truncate(string value, int maximumLength) =>
        value.Length <= maximumLength ? value : value[..maximumLength];
}
