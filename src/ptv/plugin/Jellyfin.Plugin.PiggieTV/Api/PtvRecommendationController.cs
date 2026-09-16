using System.Security.Claims;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
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
    private readonly IUserManager _userManager;
    private readonly ILibraryManager _libraryManager;

    /// <summary>Initializes a new instance of the controller.</summary>
    /// <param name="policyService">Shared recommendation policy.</param>
    /// <param name="applicationHost">Current Jellyfin server identity.</param>
    /// <param name="userManager">Jellyfin request-user authority.</param>
    /// <param name="libraryManager">Jellyfin user-aware item visibility authority.</param>
    public PtvRecommendationController(
        IPtvRecommendationPolicyService policyService,
        IServerApplicationHost applicationHost,
        IUserManager userManager,
        ILibraryManager libraryManager)
        : this(policyService, () => applicationHost.SystemId, userManager, libraryManager)
    {
    }

    internal PtvRecommendationController(
        IPtvRecommendationPolicyService policyService,
        Func<string?> serverSystemId,
        IUserManager userManager,
        ILibraryManager libraryManager)
    {
        _policyService = policyService ?? throw new ArgumentNullException(nameof(policyService));
        _serverSystemId = serverSystemId ?? throw new ArgumentNullException(nameof(serverSystemId));
        _userManager = userManager ?? throw new ArgumentNullException(nameof(userManager));
        _libraryManager = libraryManager ?? throw new ArgumentNullException(nameof(libraryManager));
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
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public ActionResult GetPersistedRecommendations(
        [FromQuery] string? serverId,
        [FromQuery] string? userId)
    {
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.Pragma = "no-cache";
        Response.Headers.Expires = "0";

        var authenticatedUser = ResolvePersistedRecommendationUser();
        if (authenticatedUser is null)
        {
            return Unauthorized(Error(
                "PTV_RECOMMENDATION_AUTH_REQUIRED",
                "An authenticated Jellyfin user identity is required."));
        }

        var authenticatedUserId = authenticatedUser.Id;
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

        int cacheVersion;
        DateTimeOffset generatedAt;
        string?[][] candidateRows;
        try
        {
            // Read only detached candidate IDs/header values under the existing settings
            // gate. Never normalize settings or hold this lock while consulting Jellyfin.
            lock (PtvConfiguredRowAssociationService.ConfigurationGate)
            {
                var settings = Plugin.Instance?.Configuration.Recommendations
                    ?? Configuration.RecommendationRowSettings.CreateDefault();
                cacheVersion = Math.Max(1, settings.SchemaVersion);
                generatedAt = DateTimeOffset.FromUnixTimeMilliseconds(
                    settings.GeneratedAt ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                candidateRows = settings.Rows
                    .Where(row => row is not null && row.Enabled && (!row.Draft || row.Accepted))
                    .Select(row => row.Items.Select(item => item?.Id).ToArray())
                    .ToArray();
            }
        }
        catch (Exception)
        {
            // A global snapshot failure must not fall back to serializing raw settings.
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                Error("PTV_RECOMMENDATION_UNAVAILABLE", "Recommendations are temporarily unavailable."));
        }

        var rows = new List<object>();
        foreach (var candidateIds in candidateRows)
        {
            var rowId = $"recommendation-{rows.Count + 1}";
            var items = new List<object>();
            foreach (var candidateId in candidateIds)
            {
                if (!Guid.TryParse(candidateId, out var itemId) || itemId == Guid.Empty)
                {
                    continue;
                }

                try
                {
                    // A non-null resolved User is essential: the Guid/null-user overloads
                    // can be global lookups. Reapply this authority on every request.
                    var item = _libraryManager.GetItemById<BaseItem>(itemId, authenticatedUser);
                    if (item is null || item.Id != itemId)
                    {
                        continue;
                    }

                    items.Add(new
                    {
                        id = item.Id.ToString("N"),
                        title = item.Name,
                        mediaType = NormalizeMediaType(item.GetType().Name, item.MediaType.ToString()),
                        score = Math.Max(0, 100 - items.Count),
                        source = rowId,
                        classification = "mixed",
                        reasons = new[]
                        {
                            new { code = "persisted-row", text = "Recommended for you." }
                        }
                    });
                }
                catch (Exception)
                {
                    // Missing/denied/unavailable items are indistinguishable to callers;
                    // one failure must not discard other authorized survivors.
                }
            }

            if (items.Count == 0)
            {
                continue;
            }

            // Persisted headings/IDs/reasons may name a hidden subject absent from Items.
            // Only response-local row identity and neutral metadata can be projected.
            rows.Add(new
            {
                id = rowId,
                title = "Recommended",
                explanation = "Recommended for you.",
                mediaType = "mixed",
                source = "persisted-plugin-row",
                items
            });
        }

        return Ok(new
        {
            contractVersion = "1.0",
            cacheVersion,
            generatedAt,
            serverId = resolvedServerId,
            userId = authenticatedUserId.ToString("N"),
            rows
        });
    }

    private Jellyfin.Database.Implementations.Entities.User? ResolvePersistedRecommendationUser()
    {
        var userId = Guid.Empty;
        foreach (var identity in User.Identities)
        {
            foreach (var claim in identity.Claims.Where(claim =>
                claim.Type is "Jellyfin-UserId" or ClaimTypes.NameIdentifier or "sub"))
            {
                if (!identity.IsAuthenticated
                    || !Guid.TryParse(claim.Value.Trim(), out var claimedId)
                    || claimedId == Guid.Empty
                    || (userId != Guid.Empty && userId != claimedId))
                {
                    return null;
                }

                userId = claimedId;
            }
        }

        if (userId == Guid.Empty)
        {
            return null;
        }

        try
        {
            var user = _userManager.GetUserById(userId);
            return user?.Id == userId ? user : null;
        }
        catch (Exception)
        {
            return null;
        }
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
