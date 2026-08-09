using System.Security.Claims;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Controller;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.PiggieTV.Api;

/// <summary>Versioned PiggieTV recommendation policy endpoints.</summary>
[ApiController]
[Authorize]
[Route("Ptv/v2/recommendations")]
public sealed class PtvRecommendationController : BaseJellyfinApiController
{
    private readonly IPtvRecommendationPolicyService _policyService;
    private readonly Func<string?> _serverSystemId;

    /// <summary>Initializes a new instance of the controller.</summary>
    /// <param name="policyService">Shared recommendation policy.</param>
    /// <param name="applicationHost">Current Jellyfin server identity.</param>
    public PtvRecommendationController(
        IPtvRecommendationPolicyService policyService,
        IServerApplicationHost applicationHost)
        : this(policyService, () => applicationHost.SystemId)
    {
    }

    internal PtvRecommendationController(
        IPtvRecommendationPolicyService policyService,
        Func<string?> serverSystemId)
    {
        _policyService = policyService ?? throw new ArgumentNullException(nameof(policyService));
        _serverSystemId = serverSystemId ?? throw new ArgumentNullException(nameof(serverSystemId));
    }

    /// <summary>Ranks client-supplied candidates with the shared premium policy.</summary>
    /// <param name="request">Versioned candidate request.</param>
    /// <returns>Ordered ids and policy evidence.</returns>
    [HttpPost("rank")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult<PtvRecommendationPolicyResponse> Rank([FromBody] PtvRecommendationPolicyRequest? request)
    {
        if (request is null)
        {
            return BadRequest(Error("PTV_RECOMMENDATION_REQUEST_REQUIRED", "A recommendation policy request is required."));
        }

        if (!TryGetAuthenticatedUserId(out var authenticatedUserId))
        {
            return Unauthorized(Error(
                "PTV_RECOMMENDATION_AUTH_REQUIRED",
                "An authenticated Jellyfin user identity is required."));
        }

        if (string.IsNullOrWhiteSpace(request.UserId))
        {
            return BadRequest(Error("PTV_RECOMMENDATION_USER_SCOPE_INVALID", "userId is required."));
        }

        if (!MatchesAuthenticatedUser(request.UserId, authenticatedUserId))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error(
                    "PTV_RECOMMENDATION_USER_SCOPE_MISMATCH",
                    "The requested user scope does not match the authenticated Jellyfin user."));
        }

        if (!TryResolveServerScope(request.ServerId, out var serverId))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error(
                    "PTV_RECOMMENDATION_SERVER_SCOPE_MISMATCH",
                    "The requested server scope does not match the current Jellyfin server."));
        }

        request.UserId = authenticatedUserId.ToString("N");
        request.ServerId = serverId;

        try
        {
            return Ok(_policyService.Rank(request));
        }
        catch (PtvRecommendationPolicyValidationException ex)
        {
            return BadRequest(Error(ex.Code, ex.Message));
        }
    }

    /// <summary>Exposes persisted v1 recommendation rows for existing clients.</summary>
    /// <param name="serverId">Server scope.</param>
    /// <param name="userId">User scope.</param>
    /// <returns>v1 compatibility response.</returns>
    [HttpGet("~/Ptv/v1/recommendations")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult GetPersistedRecommendations(
        [FromQuery] string? serverId,
        [FromQuery] string? userId)
    {
        if (!TryGetAuthenticatedUserId(out var authenticatedUserId))
        {
            return Unauthorized(Error(
                "PTV_RECOMMENDATION_AUTH_REQUIRED",
                "An authenticated Jellyfin user identity is required."));
        }

        if (!string.IsNullOrWhiteSpace(userId) && !MatchesAuthenticatedUser(userId, authenticatedUserId))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error(
                    "PTV_RECOMMENDATION_USER_SCOPE_MISMATCH",
                    "The requested user scope does not match the authenticated Jellyfin user."));
        }

        if (!TryResolveServerScope(
                string.IsNullOrWhiteSpace(serverId) ? "current-server" : serverId,
                out var resolvedServerId))
        {
            return StatusCode(
                StatusCodes.Status403Forbidden,
                Error(
                    "PTV_RECOMMENDATION_SERVER_SCOPE_MISMATCH",
                    "The requested server scope does not match the current Jellyfin server."));
        }

        var settings = Plugin.Instance?.Configuration.Recommendations
            ?? Configuration.RecommendationRowSettings.CreateDefault();
        var rows = settings.Rows
            .Where(row => row.Enabled && (!row.Draft || row.Accepted))
            .Select(row => new
            {
                id = row.Id,
                title = row.Title,
                explanation = row.Explanation,
                mediaType = string.IsNullOrWhiteSpace(row.MediaType) ? "mixed" : row.MediaType,
                source = "persisted-plugin-row",
                items = row.Items.Select((item, index) => new
                {
                    id = item.Id,
                    title = item.Name,
                    mediaType = NormalizeMediaType(item.Type, item.MediaType),
                    score = Math.Max(0, 100 - index),
                    source = row.Id,
                    classification = "mixed",
                    reasons = new[]
                    {
                        new
                        {
                            code = "persisted-row",
                            text = string.IsNullOrWhiteSpace(row.Explanation)
                                ? $"Selected for {row.Title}."
                                : row.Explanation
                        }
                    }
                })
            });

        return Ok(new
        {
            contractVersion = "1.0",
            cacheVersion = Math.Max(1, settings.SchemaVersion),
            generatedAt = DateTimeOffset.FromUnixTimeMilliseconds(settings.GeneratedAt ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),
            serverId = resolvedServerId,
            userId = authenticatedUserId.ToString("N"),
            rows
        });
    }

    private bool TryGetAuthenticatedUserId(out Guid userId)
    {
        var value = User.FindFirstValue("Jellyfin-UserId")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");
        return Guid.TryParse(value?.Trim(), out userId) && userId != Guid.Empty;
    }

    private static bool MatchesAuthenticatedUser(string requestedUserId, Guid authenticatedUserId)
    {
        var requested = requestedUserId.Trim();
        return requested.Equals("current-user", StringComparison.OrdinalIgnoreCase)
            || (Guid.TryParse(requested, out var parsed)
                && parsed != Guid.Empty
                && parsed == authenticatedUserId);
    }

    private bool TryResolveServerScope(string? requestedServerId, out string serverId)
    {
        var currentServerId = _serverSystemId()?.Trim();
        if (string.IsNullOrWhiteSpace(currentServerId) || currentServerId.Length > 256)
        {
            currentServerId = "current-server";
        }

        var requested = requestedServerId?.Trim();
        if (string.IsNullOrWhiteSpace(requested) || requested.Length > 256)
        {
            serverId = string.Empty;
            return false;
        }

        if (requested.Equals("current-server", StringComparison.OrdinalIgnoreCase)
            || requested.Equals(currentServerId, StringComparison.OrdinalIgnoreCase)
            || (Guid.TryParse(requested, out var requestedIdentity)
                && Guid.TryParse(currentServerId, out var currentIdentity)
                && requestedIdentity == currentIdentity))
        {
            serverId = currentServerId;
            return true;
        }

        serverId = string.Empty;
        return false;
    }

    private static PtvErrorResponse Error(string code, string message) => new(code, message);

    private static string NormalizeMediaType(string type, string? mediaType)
    {
        if (!string.IsNullOrWhiteSpace(mediaType) && mediaType.Equals("Audio", StringComparison.OrdinalIgnoreCase)) return "music";
        return type.Trim().ToLowerInvariant() switch
        {
            "audio" => "music",
            "musicalbum" => "album",
            "musicartist" => "artist",
            "series" => "show",
            "episode" => "episode",
            "movie" => "movie",
            "book" => "book",
            _ => "unknown"
        };
    }
}
