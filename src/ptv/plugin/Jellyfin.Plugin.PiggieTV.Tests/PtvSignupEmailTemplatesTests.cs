using Jellyfin.Plugin.PiggieTV.Services;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvSignupEmailTemplatesTests
{
    [Fact]
    public void VerificationEmailUsesPremiumSharedShellAndEncodesUserContent()
    {
        const string username = "Alex <Admin> & Co";
        const string verificationLink = "https://watch.example/web/#/signup?verify=a&next=\"home\"";
        const string logoUrl = "https://watch.example/web/assets/logo/banner-light.png?v=1&mode=mail";

        var email = PtvSignupEmailTemplates.BuildVerification(
            username,
            verificationLink,
            logoUrl,
            30);

        Assert.Contains("Welcome to PiggieTV", email.PlainText, StringComparison.Ordinal);
        Assert.Contains(username, email.PlainText, StringComparison.Ordinal);
        Assert.Contains(verificationLink, email.PlainText, StringComparison.Ordinal);
        Assert.Contains("Welcome to PiggieTV", email.Html, StringComparison.Ordinal);
        Assert.Contains("Alex &lt;Admin&gt; &amp; Co", email.Html, StringComparison.Ordinal);
        Assert.DoesNotContain(username, email.Html, StringComparison.Ordinal);
        Assert.Contains("verify=a&amp;next=&quot;home&quot;", email.Html, StringComparison.Ordinal);
        Assert.Contains("banner-light.png?v=1&amp;mode=mail", email.Html, StringComparison.Ordinal);
        Assert.Contains("Verify email address", email.Html, StringComparison.Ordinal);
        Assert.Contains("Button not working?", email.Html, StringComparison.Ordinal);
        Assert.Contains("This link expires in 30 minutes.", email.Html, StringComparison.Ordinal);
        AssertSharedBrandShell(email.Html);
    }

    [Fact]
    public void PasswordResetEmailKeepsCodeReadableAndEncodesDynamicValues()
    {
        const string resetPageUrl = "https://watch.example/web/#/signup?mode=reset&return=account";

        var email = PtvSignupEmailTemplates.BuildPasswordReset(
            "Alex & Sam",
            "A1B2C3<",
            resetPageUrl,
            "https://watch.example/web/assets/logo/banner-light.png",
            15);

        Assert.Contains("Reset your password", email.PlainText, StringComparison.Ordinal);
        Assert.Contains("A1B2C3<", email.PlainText, StringComparison.Ordinal);
        Assert.Contains("Alex &amp; Sam", email.Html, StringComparison.Ordinal);
        Assert.Contains("A1B2C3&lt;", email.Html, StringComparison.Ordinal);
        Assert.DoesNotContain("A1B2C3<", email.Html, StringComparison.Ordinal);
        Assert.Contains("mode=reset&amp;return=account", email.Html, StringComparison.Ordinal);
        Assert.Contains("Open password reset", email.Html, StringComparison.Ordinal);
        Assert.Contains("word-break:break-all", email.Html, StringComparison.Ordinal);
        Assert.Contains("This code expires in 15 minutes.", email.Html, StringComparison.Ordinal);
        AssertSharedBrandShell(email.Html);
    }

    [Fact]
    public void DeliveryTestPreviewsTheSameBrandedEmailSystem()
    {
        var email = PtvSignupEmailTemplates.BuildDeliveryTest(
            "https://watch.example/web/assets/logo/banner-light.png");

        Assert.Contains("Email delivery is live", email.PlainText, StringComparison.Ordinal);
        Assert.Contains("Email delivery is live", email.Html, StringComparison.Ordinal);
        Assert.Contains("SMTP delivery confirmed", email.Html, StringComparison.Ordinal);
        Assert.Contains("Signup verification and password reset emails", email.Html, StringComparison.Ordinal);
        AssertSharedBrandShell(email.Html);
    }

    [Fact]
    public void ProfileVerificationExplainsPendingAndPreservedEmailSemantics()
    {
        var email = PtvSignupEmailTemplates.BuildProfileVerification(
            "Alex <Owner>",
            "https://watch.example/web/#/settings/profile?verify=safe-token",
            "https://watch.example/web/assets/logo/banner-light.png",
            1440,
            true);

        Assert.Contains("current verified email stays active", email.PlainText, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("1 day", email.PlainText, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Alex &lt;Owner&gt;", email.Html, StringComparison.Ordinal);
        Assert.Contains("safe-token", email.Html, StringComparison.Ordinal);
        AssertSharedBrandShell(email.Html);
    }

    [Fact]
    public void ProfileChangedNoticeContainsNoNewAddressOrToken()
    {
        var email = PtvSignupEmailTemplates.BuildProfileEmailChanged(
            "Owner & Admin",
            "https://watch.example/web/assets/logo/banner-light.png");

        Assert.Contains("email address was changed", email.PlainText, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Owner &amp; Admin", email.Html, StringComparison.Ordinal);
        Assert.DoesNotContain("@", email.PlainText, StringComparison.Ordinal);
        AssertSharedBrandShell(email.Html);
    }

    private static void AssertSharedBrandShell(string html)
    {
        Assert.StartsWith("<!doctype html>", html, StringComparison.Ordinal);
        Assert.Contains("display:none;max-height:0", html, StringComparison.Ordinal);
        Assert.Contains("bgcolor=\"#05050c\"", html, StringComparison.Ordinal);
        Assert.Contains("bgcolor=\"#7dd6ff\"", html, StringComparison.Ordinal);
        Assert.Contains("bgcolor=\"#a78bfa\"", html, StringComparison.Ordinal);
        Assert.Contains("bgcolor=\"#ff8dc3\"", html, StringComparison.Ordinal);
        Assert.Contains("@media only screen and (max-width:620px)", html, StringComparison.Ordinal);
        Assert.Contains("alt=\"PiggieTV\"", html, StringComparison.Ordinal);
        Assert.Contains("Powered by Jellyfin", html, StringComparison.Ordinal);
        Assert.DoesNotContain("var(--", html, StringComparison.Ordinal);
        Assert.DoesNotContain("linear-gradient", html, StringComparison.Ordinal);
    }
}
