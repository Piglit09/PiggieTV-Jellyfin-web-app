namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Error thrown when a featured-content cache document is not safe to persist.
/// </summary>
public sealed class PtvFeaturedContentValidationException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="PtvFeaturedContentValidationException"/> class.
    /// </summary>
    /// <param name="code">Stable error code.</param>
    /// <param name="message">Validation error message.</param>
    public PtvFeaturedContentValidationException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    /// <summary>
    /// Gets the stable error code.
    /// </summary>
    public string Code { get; }
}
