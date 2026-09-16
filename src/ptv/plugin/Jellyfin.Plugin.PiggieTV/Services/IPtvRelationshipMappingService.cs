using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Owns authoritative PiggieTV cross-library relationship mappings.
/// </summary>
public interface IPtvRelationshipMappingService
{
    /// <summary>Gets enabled mappings whose endpoints are visible to one authenticated user.</summary>
    /// <param name="sourceItemId">Requested source Jellyfin item identity.</param>
    /// <param name="userId">Authenticated Jellyfin user identity.</param>
    /// <returns>A response, or <see langword="null"/> when the source is not visible.</returns>
    PtvRelationshipMappingsResponse? GetForSource(Guid sourceItemId, Guid userId);

    /// <summary>Creates and persists one validated mapping.</summary>
    /// <param name="request">Administrator create request.</param>
    /// <returns>The created mapping relative to its source.</returns>
    PtvRelationshipMappingDto Create(PtvRelationshipMappingCreateRequest request);

    /// <summary>Updates mutable fields on one mapping.</summary>
    /// <param name="mappingId">Mapping identity.</param>
    /// <param name="request">Administrator update request.</param>
    /// <returns>The updated mapping relative to its source.</returns>
    PtvRelationshipMappingDto Update(Guid mappingId, PtvRelationshipMappingUpdateRequest request);

    /// <summary>Deletes one mapping from persisted plugin configuration.</summary>
    /// <param name="mappingId">Mapping identity.</param>
    void Delete(Guid mappingId);
}

/// <summary>
/// Safe validation failure surfaced by the relationship API.
/// </summary>
public sealed class PtvRelationshipMappingException : Exception
{
    /// <summary>Initializes a new instance of the exception.</summary>
    /// <param name="statusCode">HTTP status appropriate for the failure.</param>
    /// <param name="code">Stable non-sensitive error code.</param>
    /// <param name="message">Non-sensitive error message.</param>
    public PtvRelationshipMappingException(int statusCode, string code, string message)
        : base(message)
    {
        StatusCode = statusCode;
        Code = code;
    }

    /// <summary>Gets the stable non-sensitive error code.</summary>
    public string Code { get; }

    /// <summary>Gets the HTTP status appropriate for the failure.</summary>
    public int StatusCode { get; }
}
