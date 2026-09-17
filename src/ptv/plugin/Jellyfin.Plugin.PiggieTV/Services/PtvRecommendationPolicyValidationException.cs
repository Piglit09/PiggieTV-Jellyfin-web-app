namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Represents a rejected recommendation policy request.</summary>
public sealed class PtvRecommendationPolicyValidationException : ArgumentException
{
    /// <summary>Initializes a new instance of the <see cref="PtvRecommendationPolicyValidationException"/> class.</summary>
    /// <param name="code">Stable client-facing validation code.</param>
    /// <param name="message">Human-readable validation message.</param>
    public PtvRecommendationPolicyValidationException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    /// <summary>Gets the stable validation code.</summary>
    public string Code { get; }
}
