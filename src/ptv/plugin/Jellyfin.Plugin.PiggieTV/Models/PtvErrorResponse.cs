using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Structured PiggieTV API error response.
/// </summary>
public sealed class PtvErrorResponse
{
    /// <summary>
    /// Initializes a new instance of the <see cref="PtvErrorResponse"/> class.
    /// </summary>
    /// <param name="code">Stable error code.</param>
    /// <param name="error">Human-readable message.</param>
    public PtvErrorResponse(string code, string error)
    {
        Code = code;
        Error = error;
    }

    /// <summary>
    /// Gets the stable error code.
    /// </summary>
    [JsonPropertyName("code")]
    public string Code { get; }

    /// <summary>
    /// Gets the human-readable error message.
    /// </summary>
    [JsonPropertyName("error")]
    public string Error { get; }
}
