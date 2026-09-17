using System.Net;
using System.Text;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Plain-text and HTML content for PiggieTV transactional signup emails.
/// </summary>
public sealed record PtvMailContent(string PlainText, string Html);

/// <summary>
/// Builds email-client-safe PiggieTV transactional messages.
/// </summary>
internal static class PtvSignupEmailTemplates
{
    private const string BrandBackground = "#05050c";
    private const string BrandPanel = "#100b1e";
    private const string BrandPanelInset = "#0b0814";
    private const string BrandBorder = "#302348";
    private const string BrandText = "#f8f6ff";
    private const string BrandMuted = "#c5bed8";
    private const string BrandCyan = "#7dd6ff";
    private const string BrandViolet = "#a78bfa";
    private const string BrandPink = "#ff8dc3";

    /// <summary>
    /// Builds the signup verification email.
    /// </summary>
    public static PtvMailContent BuildVerification(
        string username,
        string verificationLink,
        string logoUrl,
        int expiryMinutes)
    {
        var safeUsername = Encode(username);
        var actionButton = BuildActionButton("Verify email address", verificationLink);
        var fallbackLink = BuildFallbackLink(verificationLink);
        var expiryText = $"This link expires in {FormatDuration(expiryMinutes)}.";
        var plainText = new StringBuilder()
            .AppendLine("PiggieTV")
            .AppendLine("Welcome to PiggieTV")
            .AppendLine()
            .AppendLine($"Hi {username},")
            .AppendLine()
            .AppendLine("Verify your email address to finish creating your account.")
            .AppendLine()
            .AppendLine("Verify email address:")
            .AppendLine(verificationLink)
            .AppendLine()
            .AppendLine(expiryText)
            .AppendLine("If you did not create this account, you can safely ignore this email.")
            .AppendLine("PiggieTV will never ask for your password by email.")
            .ToString();
        var bodyHtml = $$"""
          <tr>
            <td class="ptv-content" align="center" style="padding:30px 42px 40px;text-align:center;">
              <h1 style="margin:0 0 14px;color:{{BrandText}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:34px;line-height:1.18;font-weight:800;letter-spacing:-0.6px;">Welcome to PiggieTV</h1>
              <p style="margin:0;color:{{BrandMuted}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;">Hi <strong style="color:{{BrandText}};font-weight:700;">{{safeUsername}}</strong> &mdash; verify your email address to finish creating your account.</p>
              {{actionButton}}
              <p style="margin:0 0 28px;color:{{BrandMuted}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;">{{Encode(expiryText)}}</p>
              {{fallbackLink}}
            </td>
          </tr>
""";

        return new PtvMailContent(
            plainText,
            BuildShell(
                "Verify your PiggieTV email",
                $"Welcome, {username}. Verify your email address to finish creating your PiggieTV account.",
                logoUrl,
                bodyHtml,
                "PiggieTV will never ask for your password by email."));
    }

    /// <summary>
    /// Builds the password reset email.
    /// </summary>
    public static PtvMailContent BuildPasswordReset(
        string username,
        string resetCode,
        string resetPageUrl,
        string logoUrl,
        int expiryMinutes)
    {
        var safeUsername = Encode(username);
        var safeResetCode = Encode(resetCode);
        var actionButton = BuildActionButton("Open password reset", resetPageUrl);
        var fallbackLink = BuildFallbackLink(resetPageUrl);
        var expiryText = $"This code expires in {FormatDuration(expiryMinutes)}.";
        var plainText = new StringBuilder()
            .AppendLine("PiggieTV")
            .AppendLine("Reset your password")
            .AppendLine()
            .AppendLine($"Hi {username},")
            .AppendLine()
            .AppendLine("Use this one-time code to reset your PiggieTV password:")
            .AppendLine()
            .AppendLine(resetCode)
            .AppendLine()
            .AppendLine("Open password reset:")
            .AppendLine(resetPageUrl)
            .AppendLine()
            .AppendLine(expiryText)
            .AppendLine("If you did not request this, you can safely ignore this email.")
            .AppendLine("PiggieTV will never ask for your password by email.")
            .ToString();
        var bodyHtml = $$"""
          <tr>
            <td class="ptv-content" align="center" style="padding:30px 42px 40px;text-align:center;">
              <h1 style="margin:0 0 14px;color:{{BrandText}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:34px;line-height:1.18;font-weight:800;letter-spacing:-0.6px;">Reset your password</h1>
              <p style="margin:0;color:{{BrandMuted}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;">Hi <strong style="color:{{BrandText}};font-weight:700;">{{safeUsername}}</strong> &mdash; use this one-time code to reset your PiggieTV password.</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:26px 0 18px;border-collapse:separate;">
                <tr>
                  <td class="ptv-code" align="center" bgcolor="{{BrandPanelInset}}" style="padding:18px 14px;background-color:{{BrandPanelInset}};border:1px solid #49396e;border-radius:14px;color:#d8caff;font-family:'Courier New',Courier,monospace;font-size:34px;line-height:1.2;font-weight:800;letter-spacing:7px;overflow-wrap:anywhere;word-break:break-all;">{{safeResetCode}}</td>
                </tr>
              </table>
              {{actionButton}}
              <p style="margin:0 0 28px;color:{{BrandMuted}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;">{{Encode(expiryText)}}</p>
              {{fallbackLink}}
            </td>
          </tr>
""";

        return new PtvMailContent(
            plainText,
            BuildShell(
                "Reset your PiggieTV password",
                "Use your one-time code to reset your PiggieTV password.",
                logoUrl,
                bodyHtml,
                "If you did not request this, you can safely ignore this email."));
    }

    /// <summary>
    /// Builds the SMTP delivery test email.
    /// </summary>
    public static PtvMailContent BuildDeliveryTest(string logoUrl)
    {
        const string plainText = """
PiggieTV
Email delivery is live

Your PiggieTV email settings are configured and working.

PiggieTV successfully sent this test through your configured email service. Signup verification and password reset emails will use this same branded design.

This is an automated test message from your PiggieTV server.
""";
        var bodyHtml = $$"""
          <tr>
            <td class="ptv-content" align="center" style="padding:30px 42px 40px;text-align:center;">
              <h1 style="margin:0 0 14px;color:{{BrandText}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:34px;line-height:1.18;font-weight:800;letter-spacing:-0.6px;">Email delivery is live</h1>
              <p style="margin:0;color:{{BrandMuted}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;">Your PiggieTV email settings are configured and working.</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:26px 0 24px;border-collapse:separate;">
                <tr>
                  <td align="center" bgcolor="{{BrandPanelInset}}" style="padding:18px 20px;background-color:{{BrandPanelInset}};border:1px solid #49396e;border-radius:14px;color:{{BrandText}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;font-weight:700;"><span style="color:{{BrandCyan}};font-size:18px;line-height:1;">&#9679;</span>&nbsp;&nbsp; SMTP delivery confirmed</td>
                </tr>
              </table>
              <p style="margin:0;color:{{BrandMuted}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;">Signup verification and password reset emails will use this same branded design.</p>
            </td>
          </tr>
""";

        return new PtvMailContent(
            plainText,
            BuildShell(
                "PiggieTV email delivery test",
                "PiggieTV email delivery is configured and working.",
                logoUrl,
                bodyHtml,
                "This is an automated test message from your PiggieTV server."));
    }

    /// <summary>Builds verification for an authenticated profile add/change request.</summary>
    public static PtvMailContent BuildProfileVerification(
        string username,
        string verificationLink,
        string logoUrl,
        int expiryMinutes,
        bool keepsExistingEmail)
    {
        var safeUsername = Encode(username);
        var actionButton = BuildActionButton("Verify email", verificationLink);
        var fallbackLink = BuildFallbackLink(verificationLink);
        var expiryText = $"This link expires in {FormatDuration(expiryMinutes)}.";
        var unchangedText = keepsExistingEmail
            ? "Your current verified email stays active until this new address is verified."
            : "Your email will not be added to your profile until verification succeeds.";
        var plainText = new StringBuilder()
            .AppendLine("PiggieTV")
            .AppendLine("Verify your PiggieTV email")
            .AppendLine()
            .AppendLine($"Hi {username},")
            .AppendLine()
            .AppendLine("Someone signed into your PiggieTV account and requested this email address for the profile.")
            .AppendLine(unchangedText)
            .AppendLine()
            .AppendLine("Verify email:")
            .AppendLine(verificationLink)
            .AppendLine()
            .AppendLine(expiryText)
            .AppendLine("If you did not request this, ignore this message. Your profile will not be changed.")
            .ToString();
        var bodyHtml = $$"""
          <tr>
            <td class="ptv-content" align="center" style="padding:30px 42px 40px;text-align:center;">
              <h1 style="margin:0 0 14px;color:{{BrandText}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:34px;line-height:1.18;font-weight:800;letter-spacing:-0.6px;">Verify your PiggieTV email</h1>
              <p style="margin:0;color:{{BrandMuted}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;">Hi <strong style="color:{{BrandText}};font-weight:700;">{{safeUsername}}</strong> &mdash; someone signed into your PiggieTV account and requested this address for the profile.</p>
              <p style="margin:18px 0 0;color:{{BrandMuted}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;">{{Encode(unchangedText)}}</p>
              {{actionButton}}
              <p style="margin:0 0 28px;color:{{BrandMuted}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;">{{Encode(expiryText)}}</p>
              {{fallbackLink}}
            </td>
          </tr>
""";

        return new PtvMailContent(
            plainText,
            BuildShell(
                "Verify your PiggieTV email",
                "Verify this address before it is added to your PiggieTV profile.",
                logoUrl,
                bodyHtml,
                "If you did not request this, ignore this message. Your profile will not be changed."));
    }

    /// <summary>Builds the optional old-address notification after an email change commits.</summary>
    public static PtvMailContent BuildProfileEmailChanged(string username, string logoUrl)
    {
        var safeUsername = Encode(username);
        var plainText = new StringBuilder()
            .AppendLine("PiggieTV")
            .AppendLine("Your PiggieTV email address was changed")
            .AppendLine()
            .AppendLine($"Hi {username},")
            .AppendLine()
            .AppendLine("A newly verified email address replaced this address on your PiggieTV profile.")
            .AppendLine("If you did not make this change, contact your PiggieTV administrator.")
            .ToString();
        var bodyHtml = $$"""
          <tr>
            <td class="ptv-content" align="center" style="padding:30px 42px 40px;text-align:center;">
              <h1 style="margin:0 0 14px;color:{{BrandText}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:32px;line-height:1.18;font-weight:800;">Your PiggieTV email was changed</h1>
              <p style="margin:0;color:{{BrandMuted}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;">Hi <strong style="color:{{BrandText}};font-weight:700;">{{safeUsername}}</strong> &mdash; a newly verified address replaced this address on your PiggieTV profile.</p>
              <p style="margin:18px 0 0;color:{{BrandMuted}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;">If you did not make this change, contact your PiggieTV administrator.</p>
            </td>
          </tr>
""";

        return new PtvMailContent(
            plainText,
            BuildShell(
                "Your PiggieTV email was changed",
                "A newly verified address replaced this address on your PiggieTV profile.",
                logoUrl,
                bodyHtml,
                "PiggieTV will never ask for your password by email."));
    }

    private static string BuildActionButton(string label, string href)
    {
        var safeLabel = Encode(label);
        var safeHref = Encode(href);

        return $$"""
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px auto 14px;border-collapse:separate;">
                <tr>
                  <td align="center" bgcolor="{{BrandCyan}}" style="background-color:{{BrandCyan}};border-radius:12px;">
                    <a href="{{safeHref}}" style="display:block;padding:16px 30px;border:1px solid {{BrandCyan}};border-radius:12px;color:{{BrandBackground}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:16px;line-height:1.1;font-weight:800;text-decoration:none;">{{safeLabel}}</a>
                  </td>
                </tr>
              </table>
""";
    }

    private static string FormatDuration(int minutes)
    {
        if (minutes >= 1440 && minutes % 1440 == 0)
        {
            var days = minutes / 1440;
            return $"{days} {(days == 1 ? "day" : "days")}";
        }

        if (minutes >= 60 && minutes % 60 == 0)
        {
            var hours = minutes / 60;
            return $"{hours} {(hours == 1 ? "hour" : "hours")}";
        }

        return $"{minutes} minutes";
    }

    private static string BuildFallbackLink(string href)
    {
        var safeHref = Encode(href);

        return $$"""
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;">
                <tr>
                  <td align="left" bgcolor="{{BrandPanelInset}}" style="padding:18px 20px;background-color:{{BrandPanelInset}};border:1px solid {{BrandBorder}};border-radius:14px;text-align:left;">
                    <p style="margin:0 0 7px;color:{{BrandText}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;font-weight:800;">Button not working?</p>
                    <p style="margin:0 0 7px;color:{{BrandMuted}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;">Copy and paste this link into your browser:</p>
                    <a href="{{safeHref}}" style="color:{{BrandCyan}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;text-decoration:underline;overflow-wrap:anywhere;word-break:break-all;">{{safeHref}}</a>
                  </td>
                </tr>
              </table>
""";
    }

    private static string BuildShell(
        string documentTitle,
        string preheader,
        string logoUrl,
        string bodyHtml,
        string securityText)
    {
        var safeDocumentTitle = Encode(documentTitle);
        var safePreheader = Encode(preheader);
        var safeLogoUrl = Encode(logoUrl);
        var safeSecurityText = Encode(securityText);

        return $$"""
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>{{safeDocumentTitle}}</title>
  <style type="text/css">
    @media only screen and (max-width:620px) {
      .ptv-outer { padding:16px 10px !important; }
      .ptv-card { width:100% !important; }
      .ptv-header { padding:24px 22px 16px !important; }
      .ptv-content { padding:26px 22px 32px !important; }
      .ptv-content h1 { font-size:28px !important; }
      .ptv-code { font-size:27px !important; letter-spacing:4px !important; }
      .ptv-security { padding:20px 22px !important; }
      .ptv-footer { padding:20px 22px 24px !important; }
      .ptv-footer-cell { display:block !important; width:100% !important; padding:3px 0 !important; text-align:center !important; }
    }
  </style>
</head>
<body bgcolor="{{BrandBackground}}" style="margin:0;padding:0;background-color:{{BrandBackground}};color:{{BrandText}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">{{safePreheader}}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="{{BrandBackground}}" style="width:100%;background-color:{{BrandBackground}};border-collapse:collapse;">
    <tr>
      <td class="ptv-outer" align="center" style="padding:32px 12px;">
        <table role="presentation" class="ptv-card" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="{{BrandPanel}}" style="width:100%;max-width:600px;background-color:{{BrandPanel}};border:1px solid {{BrandBorder}};border-radius:22px;border-collapse:separate;overflow:hidden;">
          <tr>
            <td style="padding:0;line-height:0;font-size:0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                <tr>
                  <td width="34%" height="4" bgcolor="{{BrandCyan}}" style="width:34%;height:4px;background-color:{{BrandCyan}};font-size:0;line-height:0;">&nbsp;</td>
                  <td width="33%" height="4" bgcolor="{{BrandViolet}}" style="width:33%;height:4px;background-color:{{BrandViolet}};font-size:0;line-height:0;">&nbsp;</td>
                  <td width="33%" height="4" bgcolor="{{BrandPink}}" style="width:33%;height:4px;background-color:{{BrandPink}};font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="ptv-header" align="center" style="padding:28px 32px 20px;text-align:center;">
              <img src="{{safeLogoUrl}}" alt="PiggieTV" width="210" style="display:block;width:210px;max-width:72%;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;color:{{BrandText}};font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:24px;font-weight:800;">
            </td>
          </tr>
          <tr>
            <td style="padding:0 42px;">
              <div style="height:1px;background-color:{{BrandBorder}};font-size:0;line-height:0;">&nbsp;</div>
            </td>
          </tr>
{{bodyHtml}}
          <tr>
            <td class="ptv-security" align="center" style="padding:21px 34px;border-top:1px solid {{BrandBorder}};border-bottom:1px solid {{BrandBorder}};text-align:center;">
              <p style="margin:0;color:#aaa2c2;font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;">{{safeSecurityText}}</p>
            </td>
          </tr>
          <tr>
            <td class="ptv-footer" style="padding:20px 34px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                <tr>
                  <td class="ptv-footer-cell" align="left" style="color:#8d86a2;font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;text-align:left;">&copy; PiggieTV</td>
                  <td class="ptv-footer-cell" align="right" style="color:#8d86a2;font-family:Inter,'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;text-align:right;">Powered by Jellyfin</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
""";
    }

    private static string Encode(string value) => WebUtility.HtmlEncode(value) ?? string.Empty;
}
