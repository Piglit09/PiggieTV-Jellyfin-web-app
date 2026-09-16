namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Centralized PiggieTV transactional email delivery boundary.</summary>
public interface IPtvMailService
{
    /// <summary>Gets whether saved SMTP settings are complete.</summary>
    bool IsConfigured { get; }

    /// <summary>Gets the configured trusted public PiggieTV base URL.</summary>
    string PublicBaseUrl { get; }

    /// <summary>Gets configured verification expiry in minutes.</summary>
    int VerificationExpiryMinutes { get; }

    /// <summary>Resolves the configured public logo against a trusted reference URL.</summary>
    string ResolveLogoUrl(string referenceUrl);

    /// <summary>Sends a text/HTML transactional message.</summary>
    Task SendAsync(
        string recipient,
        string subject,
        PtvMailContent content,
        CancellationToken cancellationToken = default);
}
