namespace Jellyfin.Plugin.PiggieTV.Configuration;

/// <summary>
/// PiggieTV native signup settings.
/// </summary>
public sealed class SignupSettings
{
    /// <summary>Gets or sets whether native PiggieTV signup is enabled.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets invite lockout threshold.</summary>
    public int FailedAttemptLimit { get; set; } = 8;

    /// <summary>Gets or sets invite lockout duration in minutes.</summary>
    public int LockoutMinutes { get; set; } = 15;

    /// <summary>Gets or sets the default signup policy preset id.</summary>
    public string DefaultPolicyPresetId { get; set; } = "standard";

    /// <summary>Gets or sets explicit default folder ids for new signups.</summary>
    public List<string> DefaultEnabledFolderIds { get; set; } = [];

    /// <summary>Gets or sets email delivery settings for signup and password reset.</summary>
    public SignupEmailSettings EmailSettings { get; set; } = new();

    /// <summary>Gets or sets configured user policy presets.</summary>
    public List<SignupPolicyPreset> PolicyPresets { get; set; } = CreateDefaultPolicyPresets();

    /// <summary>Gets or sets native PiggieTV signup invites.</summary>
    public List<SignupInvite> Invites { get; set; } = [];

    /// <summary>Gets or sets users created by native PiggieTV signup.</summary>
    public List<SignupUserRecord> Users { get; set; } = [];

    /// <summary>Gets or sets pending email verifications for native signup.</summary>
    public List<SignupPendingVerification> PendingVerifications { get; set; } = [];

    /// <summary>Gets or sets pending password reset codes.</summary>
    public List<SignupPasswordResetCode> PasswordResetCodes { get; set; } = [];

    /// <summary>Gets or sets public signup/reset API rate-limit counters.</summary>
    public List<SignupRateLimitRecord> RateLimits { get; set; } = [];

    /// <summary>
    /// Creates default policy presets.
    /// </summary>
    /// <returns>Default signup policy presets.</returns>
    public static List<SignupPolicyPreset> CreateDefaultPolicyPresets() =>
    [
        new()
        {
            Id = "standard",
            Name = "Standard User",
            AllowDownloads = false,
            AllowLiveTv = false,
            AllowRemoteControl = false,
            AllowTranscoding = true,
            EnableAllFolders = true
        },
        new()
        {
            Id = "kids",
            Name = "Kids",
            AllowDownloads = false,
            AllowLiveTv = false,
            AllowRemoteControl = false,
            AllowTranscoding = true,
            EnableAllFolders = false,
            MaxParentalRating = 8
        },
        new()
        {
            Id = "anime-only",
            Name = "Anime Only",
            AllowDownloads = false,
            AllowLiveTv = false,
            AllowRemoteControl = false,
            AllowTranscoding = true,
            EnableAllFolders = false
        },
        new()
        {
            Id = "movies-shows",
            Name = "Movies + Shows",
            AllowDownloads = false,
            AllowLiveTv = false,
            AllowRemoteControl = false,
            AllowTranscoding = true,
            EnableAllFolders = false
        },
        new()
        {
            Id = "full-access",
            Name = "Full Access",
            AllowDownloads = true,
            AllowLiveTv = true,
            AllowRemoteControl = false,
            AllowTranscoding = true,
            EnableAllFolders = true
        }
    ];
}

/// <summary>
/// PiggieTV signup SMTP/email settings.
/// </summary>
public sealed class SignupEmailSettings
{
    /// <summary>Gets or sets default public logo URL used in branded email templates.</summary>
    public const string DefaultLogoUrl = "/web/assets/logo/banner-light.png";

    /// <summary>Gets or sets the trusted public PiggieTV origin used in verification links.</summary>
    public string PublicBaseUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether email delivery is enabled.</summary>
    public bool Enabled { get; set; }

    /// <summary>Gets or sets SMTP host.</summary>
    public string SmtpHost { get; set; } = string.Empty;

    /// <summary>Gets or sets SMTP port.</summary>
    public int SmtpPort { get; set; } = 587;

    /// <summary>Gets or sets whether SMTP SSL/TLS is enabled.</summary>
    public bool UseSsl { get; set; } = true;

    /// <summary>Gets or sets SMTP username.</summary>
    public string? Username { get; set; }

    /// <summary>Gets or sets SMTP password. This is write-only in public DTOs.</summary>
    public string? Password { get; set; }

    /// <summary>Gets or sets sender email address.</summary>
    public string FromAddress { get; set; } = string.Empty;

    /// <summary>Gets or sets sender display name.</summary>
    public string FromName { get; set; } = "PiggieTV";

    /// <summary>Gets or sets the public logo URL used in branded email templates.</summary>
    public string LogoUrl { get; set; } = DefaultLogoUrl;

    /// <summary>Gets or sets password reset email subject.</summary>
    public string ResetSubject { get; set; } = "Your PiggieTV password reset code";

    /// <summary>Gets or sets reset code lifetime in minutes.</summary>
    public int ResetCodeMinutes { get; set; } = 15;

    /// <summary>Gets or sets email verification subject.</summary>
    public string VerificationSubject { get; set; } = "Verify your PiggieTV email";

    /// <summary>Gets or sets email verification link lifetime in minutes.</summary>
    public int VerificationLinkMinutes { get; set; } = 1440;
}

/// <summary>
/// PiggieTV signup user policy preset.
/// </summary>
public sealed class SignupPolicyPreset
{
    /// <summary>Gets or sets the preset id.</summary>
    public string Id { get; set; } = "standard";

    /// <summary>Gets or sets the display name.</summary>
    public string Name { get; set; } = "Standard User";

    /// <summary>Gets or sets whether all folders are enabled.</summary>
    public bool EnableAllFolders { get; set; } = true;

    /// <summary>Gets or sets enabled library folder ids when all folders are disabled.</summary>
    public List<string> EnabledFolderIds { get; set; } = [];

    /// <summary>Gets or sets whether downloads are enabled.</summary>
    public bool AllowDownloads { get; set; }

    /// <summary>Gets or sets whether remote control permissions are enabled.</summary>
    public bool AllowRemoteControl { get; set; }

    /// <summary>Gets or sets whether Live TV access is enabled.</summary>
    public bool AllowLiveTv { get; set; }

    /// <summary>Gets or sets whether transcoding is enabled.</summary>
    public bool AllowTranscoding { get; set; } = true;

    /// <summary>Gets or sets optional max remote bitrate.</summary>
    public int RemoteClientBitrateLimit { get; set; }

    /// <summary>Gets or sets optional max active sessions.</summary>
    public int MaxActiveSessions { get; set; }

    /// <summary>Gets or sets optional max parental rating.</summary>
    public int? MaxParentalRating { get; set; }
}

/// <summary>
/// PiggieTV native signup invite.
/// </summary>
public sealed class SignupInvite
{
    /// <summary>Gets or sets invite id.</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets hashed invite code.</summary>
    public string CodeHash { get; set; } = string.Empty;

    /// <summary>Gets or sets short non-secret code preview.</summary>
    public string CodePreview { get; set; } = string.Empty;

    /// <summary>Gets or sets invite label or group name.</summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>Gets or sets created timestamp.</summary>
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets expiration timestamp.</summary>
    public DateTimeOffset? ExpiresAtUtc { get; set; }

    /// <summary>Gets or sets maximum uses. Zero means unlimited.</summary>
    public int MaxUses { get; set; } = 1;

    /// <summary>Gets or sets whether the invite is disabled.</summary>
    public bool Disabled { get; set; }

    /// <summary>Gets or sets whether email is required during signup.</summary>
    public bool EmailRequired { get; set; }

    /// <summary>Gets or sets policy preset id.</summary>
    public string PolicyPresetId { get; set; } = "standard";

    /// <summary>Gets or sets explicit library folder override ids.</summary>
    public List<string> EnabledFolderIds { get; set; } = [];

    /// <summary>Gets or sets failed validation attempt count.</summary>
    public int FailedAttempts { get; set; }

    /// <summary>Gets or sets temporary lockout timestamp.</summary>
    public DateTimeOffset? LockedUntilUtc { get; set; }

    /// <summary>Gets or sets created user usage records.</summary>
    public List<SignupInviteUsageRecord> UsageRecords { get; set; } = [];
}

/// <summary>
/// PiggieTV invite usage record.
/// </summary>
public sealed class SignupInviteUsageRecord
{
    /// <summary>Gets or sets created Jellyfin user id.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets created username.</summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>Gets or sets optional signup email.</summary>
    public string? Email { get; set; }

    /// <summary>Gets or sets usage timestamp.</summary>
    public DateTimeOffset UsedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets remote address.</summary>
    public string RemoteAddress { get; set; } = string.Empty;
}

/// <summary>
/// PiggieTV native signup user record.
/// </summary>
public sealed class SignupUserRecord
{
    /// <summary>Gets or sets created Jellyfin user id.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets created username.</summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>Gets or sets required signup email.</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>Gets or sets policy preset id used for this signup.</summary>
    public string PolicyPresetId { get; set; } = "standard";

    /// <summary>Gets or sets created timestamp.</summary>
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets remote address.</summary>
    public string RemoteAddress { get; set; } = string.Empty;
}

/// <summary>
/// PiggieTV pending signup email verification record.
/// </summary>
public sealed class SignupPendingVerification
{
    /// <summary>Gets or sets verification id.</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets requested username.</summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>Gets or sets required signup email.</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>Gets or sets protected pending password.</summary>
    public string ProtectedPassword { get; set; } = string.Empty;

    /// <summary>Gets or sets hashed verification token.</summary>
    public string TokenHash { get; set; } = string.Empty;

    /// <summary>Gets or sets policy preset id used for this signup.</summary>
    public string PolicyPresetId { get; set; } = "standard";

    /// <summary>Gets or sets explicit enabled folders for this pending signup.</summary>
    public List<string> EnabledFolderIds { get; set; } = [];

    /// <summary>Gets or sets created timestamp.</summary>
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets expiration timestamp.</summary>
    public DateTimeOffset ExpiresAtUtc { get; set; } = DateTimeOffset.UtcNow.AddMinutes(30);

    /// <summary>Gets or sets remote address.</summary>
    public string RemoteAddress { get; set; } = string.Empty;
}

/// <summary>
/// PiggieTV password reset code record.
/// </summary>
public sealed class SignupPasswordResetCode
{
    /// <summary>Gets or sets normalized email.</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>Gets or sets username for the reset target.</summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>Gets or sets hashed reset code.</summary>
    public string CodeHash { get; set; } = string.Empty;

    /// <summary>Gets or sets created timestamp.</summary>
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets expiration timestamp.</summary>
    public DateTimeOffset ExpiresAtUtc { get; set; } = DateTimeOffset.UtcNow.AddMinutes(15);

    /// <summary>Gets or sets used timestamp.</summary>
    public DateTimeOffset? UsedAtUtc { get; set; }

    /// <summary>Gets or sets failed confirmation attempts.</summary>
    public int FailedAttempts { get; set; }

    /// <summary>Gets or sets remote address.</summary>
    public string RemoteAddress { get; set; } = string.Empty;
}

/// <summary>
/// PiggieTV public signup/reset rate-limit record. Keys are hashes, not raw IPs or emails.
/// </summary>
public sealed class SignupRateLimitRecord
{
    /// <summary>Gets or sets the protected action name.</summary>
    public string Action { get; set; } = string.Empty;

    /// <summary>Gets or sets the hashed rate-limit key.</summary>
    public string KeyHash { get; set; } = string.Empty;

    /// <summary>Gets or sets attempt count inside the current window.</summary>
    public int Count { get; set; }

    /// <summary>Gets or sets current rate-limit window start.</summary>
    public DateTimeOffset WindowStartedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets temporary lockout timestamp.</summary>
    public DateTimeOffset? LockedUntilUtc { get; set; }
}
