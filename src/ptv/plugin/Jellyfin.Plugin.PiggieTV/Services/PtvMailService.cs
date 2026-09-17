using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Text;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Single SMTP implementation shared by signup, reset, and profile email.</summary>
public sealed class PtvMailService : IPtvMailService
{
    private readonly ILogger<PtvMailService> _logger;

    /// <summary>Initializes the centralized mail service.</summary>
    public PtvMailService(ILogger<PtvMailService> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public bool IsConfigured
    {
        get
        {
            var settings = GetSettings();
            return settings.Enabled
                && !string.IsNullOrWhiteSpace(settings.SmtpHost)
                && settings.SmtpPort > 0
                && !string.IsNullOrWhiteSpace(settings.FromAddress);
        }
    }

    /// <inheritdoc />
    public string PublicBaseUrl => CleanPublicBaseUrl(GetSettings().PublicBaseUrl);

    /// <inheritdoc />
    public int VerificationExpiryMinutes => Math.Clamp(GetSettings().VerificationLinkMinutes, 10, 1440);

    /// <inheritdoc />
    public string ResolveLogoUrl(string referenceUrl)
    {
        var logoUrl = GetSettings().LogoUrl?.Trim() ?? string.Empty;
        if (Uri.TryCreate(logoUrl, UriKind.Absolute, out var absoluteLogo)
            && (absoluteLogo.Scheme == Uri.UriSchemeHttps || absoluteLogo.Scheme == Uri.UriSchemeHttp))
        {
            return absoluteLogo.ToString();
        }

        if (Uri.TryCreate(referenceUrl, UriKind.Absolute, out var reference)
            && (reference.Scheme == Uri.UriSchemeHttps || reference.Scheme == Uri.UriSchemeHttp))
        {
            var relative = string.IsNullOrWhiteSpace(logoUrl) ? SignupEmailSettings.DefaultLogoUrl : logoUrl;
            return new Uri(reference, relative.StartsWith('/') ? relative : $"/{relative}").ToString();
        }

        return SignupEmailSettings.DefaultLogoUrl;
    }

    /// <inheritdoc />
    public async Task SendAsync(
        string recipient,
        string subject,
        PtvMailContent content,
        CancellationToken cancellationToken = default)
    {
        if (!IsConfigured)
        {
            throw new PtvMailDeliveryException("SMTP_FAILURE", "PiggieTV email delivery is not configured.");
        }

        var settings = CloneSettings(GetSettings());
        try
        {
            using var message = new MailMessage
            {
                From = new MailAddress(settings.FromAddress, settings.FromName),
                Subject = subject,
                Body = content.PlainText,
                BodyEncoding = Encoding.UTF8,
                SubjectEncoding = Encoding.UTF8,
                IsBodyHtml = false
            };
            message.To.Add(recipient);
            message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(content.PlainText, Encoding.UTF8, MediaTypeNames.Text.Plain));
            message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(content.Html, Encoding.UTF8, MediaTypeNames.Text.Html));

            using var smtp = new SmtpClient(settings.SmtpHost, settings.SmtpPort)
            {
                EnableSsl = settings.UseSsl
            };
            if (!string.IsNullOrWhiteSpace(settings.Username) || !string.IsNullOrWhiteSpace(settings.Password))
            {
                smtp.Credentials = new NetworkCredential(settings.Username ?? string.Empty, settings.Password ?? string.Empty);
            }

            await smtp.SendMailAsync(message).WaitAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PiggieTV transactional email delivery failed. Recipient={Recipient}.", MaskEmail(recipient));
            throw new PtvMailDeliveryException("SMTP_FAILURE", "PiggieTV could not send the email.", ex);
        }
    }

    private static SignupEmailSettings GetSettings() =>
        Plugin.Instance?.Configuration.SignupSettings?.EmailSettings ?? new SignupEmailSettings();

    private static SignupEmailSettings CloneSettings(SignupEmailSettings source) => new()
    {
        Enabled = source.Enabled,
        FromAddress = source.FromAddress,
        FromName = source.FromName,
        LogoUrl = source.LogoUrl,
        Password = source.Password,
        PublicBaseUrl = source.PublicBaseUrl,
        ResetCodeMinutes = source.ResetCodeMinutes,
        ResetSubject = source.ResetSubject,
        SmtpHost = source.SmtpHost,
        SmtpPort = source.SmtpPort,
        UseSsl = source.UseSsl,
        Username = source.Username,
        VerificationLinkMinutes = source.VerificationLinkMinutes,
        VerificationSubject = source.VerificationSubject
    };

    private static string CleanPublicBaseUrl(string? value)
    {
        if (!Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
        {
            return string.Empty;
        }

        return uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
    }

    private static string MaskEmail(string value)
    {
        var at = value.LastIndexOf('@');
        if (at <= 0) return "[redacted]";
        return $"{value[0]}***{value[at..]}";
    }
}

/// <summary>Sanitized centralized mail delivery failure.</summary>
public sealed class PtvMailDeliveryException : Exception
{
    /// <summary>Initializes a mail delivery exception.</summary>
    public PtvMailDeliveryException(string code, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }

    /// <summary>Gets stable safe error code.</summary>
    public string Code { get; }
}
