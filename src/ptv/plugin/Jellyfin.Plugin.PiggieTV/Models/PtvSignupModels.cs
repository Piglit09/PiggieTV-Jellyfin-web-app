using System.Text.Json.Serialization;
using Jellyfin.Plugin.PiggieTV.Configuration;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Public native signup invite DTO.
/// </summary>
public sealed class PtvSignupInviteDto
{
    /// <summary>Gets or sets invite id.</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets optional one-time clear code returned only after creation.</summary>
    [JsonPropertyName("code")]
    public string? Code { get; set; }

    /// <summary>Gets or sets invite code preview.</summary>
    [JsonPropertyName("codePreview")]
    public string CodePreview { get; set; } = string.Empty;

    /// <summary>Gets or sets label.</summary>
    [JsonPropertyName("label")]
    public string Label { get; set; } = string.Empty;

    /// <summary>Gets or sets created timestamp.</summary>
    [JsonPropertyName("createdAtUtc")]
    public DateTimeOffset CreatedAtUtc { get; set; }

    /// <summary>Gets or sets expiration timestamp.</summary>
    [JsonPropertyName("expiresAtUtc")]
    public DateTimeOffset? ExpiresAtUtc { get; set; }

    /// <summary>Gets or sets max uses.</summary>
    [JsonPropertyName("maxUses")]
    public int MaxUses { get; set; }

    /// <summary>Gets or sets used count.</summary>
    [JsonPropertyName("usedCount")]
    public int UsedCount { get; set; }

    /// <summary>Gets or sets whether disabled.</summary>
    [JsonPropertyName("disabled")]
    public bool Disabled { get; set; }

    /// <summary>Gets or sets whether email is required.</summary>
    [JsonPropertyName("emailRequired")]
    public bool EmailRequired { get; set; }

    /// <summary>Gets or sets selected policy preset id.</summary>
    [JsonPropertyName("policyPresetId")]
    public string PolicyPresetId { get; set; } = "standard";

    /// <summary>Gets or sets explicit enabled library folder ids.</summary>
    [JsonPropertyName("enabledFolderIds")]
    public List<string> EnabledFolderIds { get; set; } = [];

    /// <summary>Gets or sets whether invite is currently usable.</summary>
    [JsonPropertyName("usable")]
    public bool Usable { get; set; }

    /// <summary>Gets or sets temporary lockout timestamp.</summary>
    [JsonPropertyName("lockedUntilUtc")]
    public DateTimeOffset? LockedUntilUtc { get; set; }

    /// <summary>Gets or sets usage records.</summary>
    [JsonPropertyName("usageRecords")]
    public List<SignupInviteUsageRecord> UsageRecords { get; set; } = [];

    /// <summary>
    /// Creates a public invite DTO.
    /// </summary>
    /// <param name="invite">Stored invite.</param>
    /// <param name="clearCode">Optional clear code.</param>
    /// <returns>Public invite DTO.</returns>
    public static PtvSignupInviteDto FromInvite(SignupInvite invite, string? clearCode = null)
    {
        var now = DateTimeOffset.UtcNow;
        var usedCount = invite.UsageRecords?.Count ?? 0;
        var expired = invite.ExpiresAtUtc is not null && invite.ExpiresAtUtc <= now;
        var overUsed = invite.MaxUses > 0 && usedCount >= invite.MaxUses;

        return new PtvSignupInviteDto
        {
            Code = clearCode,
            CodePreview = invite.CodePreview,
            CreatedAtUtc = invite.CreatedAtUtc,
            Disabled = invite.Disabled,
            EmailRequired = invite.EmailRequired,
            EnabledFolderIds = invite.EnabledFolderIds,
            ExpiresAtUtc = invite.ExpiresAtUtc,
            Id = invite.Id,
            Label = invite.Label,
            LockedUntilUtc = invite.LockedUntilUtc,
            MaxUses = invite.MaxUses,
            PolicyPresetId = invite.PolicyPresetId,
            Usable = !invite.Disabled && !expired && !overUsed && (invite.LockedUntilUtc is null || invite.LockedUntilUtc <= now),
            UsageRecords = invite.UsageRecords?.ToList() ?? [],
            UsedCount = usedCount
        };
    }
}

/// <summary>
/// Signup policy preset DTO.
/// </summary>
public sealed class PtvSignupPolicyPresetDto
{
    /// <summary>Gets or sets preset id.</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = "standard";

    /// <summary>Gets or sets preset name.</summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = "Standard User";

    /// <summary>Gets or sets whether all folders are enabled.</summary>
    [JsonPropertyName("enableAllFolders")]
    public bool EnableAllFolders { get; set; }

    /// <summary>Gets or sets enabled folder ids.</summary>
    [JsonPropertyName("enabledFolderIds")]
    public List<string> EnabledFolderIds { get; set; } = [];

    /// <summary>Gets or sets whether downloads are enabled.</summary>
    [JsonPropertyName("allowDownloads")]
    public bool AllowDownloads { get; set; }

    /// <summary>Gets or sets whether Live TV is enabled.</summary>
    [JsonPropertyName("allowLiveTv")]
    public bool AllowLiveTv { get; set; }

    /// <summary>Gets or sets whether remote control is enabled.</summary>
    [JsonPropertyName("allowRemoteControl")]
    public bool AllowRemoteControl { get; set; }

    /// <summary>Gets or sets whether transcoding is enabled.</summary>
    [JsonPropertyName("allowTranscoding")]
    public bool AllowTranscoding { get; set; }

    /// <summary>
    /// Creates a preset DTO.
    /// </summary>
    /// <param name="preset">Preset.</param>
    /// <returns>DTO.</returns>
    public static PtvSignupPolicyPresetDto FromPreset(SignupPolicyPreset preset) => new()
    {
        AllowDownloads = preset.AllowDownloads,
        AllowLiveTv = preset.AllowLiveTv,
        AllowRemoteControl = preset.AllowRemoteControl,
        AllowTranscoding = preset.AllowTranscoding,
        EnabledFolderIds = preset.EnabledFolderIds,
        EnableAllFolders = preset.EnableAllFolders,
        Id = preset.Id,
        Name = preset.Name
    };
}

/// <summary>
/// Public signup email settings DTO. SMTP password is write-only.
/// </summary>
public sealed class PtvSignupEmailSettingsDto
{
    /// <summary>Gets or sets the trusted public PiggieTV origin used in verification links.</summary>
    [JsonPropertyName("publicBaseUrl")]
    public string PublicBaseUrl { get; set; } = string.Empty;

    /// <summary>Gets or sets whether email delivery is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    /// <summary>Gets or sets SMTP host.</summary>
    [JsonPropertyName("smtpHost")]
    public string SmtpHost { get; set; } = string.Empty;

    /// <summary>Gets or sets SMTP port.</summary>
    [JsonPropertyName("smtpPort")]
    public int SmtpPort { get; set; } = 587;

    /// <summary>Gets or sets whether SSL/TLS is enabled.</summary>
    [JsonPropertyName("useSsl")]
    public bool UseSsl { get; set; } = true;

    /// <summary>Gets or sets SMTP username.</summary>
    [JsonPropertyName("username")]
    public string? Username { get; set; }

    /// <summary>Gets or sets SMTP password when saving settings. Never returned by the backend.</summary>
    [JsonPropertyName("password")]
    public string? Password { get; set; }

    /// <summary>Gets or sets whether a password is configured.</summary>
    [JsonPropertyName("passwordConfigured")]
    public bool PasswordConfigured { get; set; }

    /// <summary>Gets or sets sender email address.</summary>
    [JsonPropertyName("fromAddress")]
    public string FromAddress { get; set; } = string.Empty;

    /// <summary>Gets or sets sender display name.</summary>
    [JsonPropertyName("fromName")]
    public string FromName { get; set; } = "PiggieTV";

    /// <summary>Gets or sets public logo URL used in branded verification emails.</summary>
    [JsonPropertyName("logoUrl")]
    public string LogoUrl { get; set; } = SignupEmailSettings.DefaultLogoUrl;

    /// <summary>Gets or sets password reset subject.</summary>
    [JsonPropertyName("resetSubject")]
    public string ResetSubject { get; set; } = "Your PiggieTV password reset code";

    /// <summary>Gets or sets reset code lifetime in minutes.</summary>
    [JsonPropertyName("resetCodeMinutes")]
    public int ResetCodeMinutes { get; set; } = 15;

    /// <summary>Gets or sets email verification subject.</summary>
    [JsonPropertyName("verificationSubject")]
    public string VerificationSubject { get; set; } = "Verify your PiggieTV email";

    /// <summary>Gets or sets email verification link lifetime in minutes.</summary>
    [JsonPropertyName("verificationLinkMinutes")]
    public int VerificationLinkMinutes { get; set; } = 1440;

    /// <summary>
    /// Creates a redacted DTO from stored settings.
    /// </summary>
    /// <param name="settings">Stored settings.</param>
    /// <returns>Redacted DTO.</returns>
    public static PtvSignupEmailSettingsDto FromSettings(SignupEmailSettings settings) => new()
    {
        Enabled = settings.Enabled,
        FromAddress = settings.FromAddress,
        FromName = settings.FromName,
        LogoUrl = settings.LogoUrl,
        PasswordConfigured = !string.IsNullOrWhiteSpace(settings.Password),
        PublicBaseUrl = settings.PublicBaseUrl,
        ResetCodeMinutes = settings.ResetCodeMinutes,
        ResetSubject = settings.ResetSubject,
        SmtpHost = settings.SmtpHost,
        SmtpPort = settings.SmtpPort,
        UseSsl = settings.UseSsl,
        Username = settings.Username,
        VerificationLinkMinutes = settings.VerificationLinkMinutes,
        VerificationSubject = settings.VerificationSubject
    };
}

/// <summary>
/// Native signup user DTO.
/// </summary>
public sealed class PtvSignupUserDto
{
    /// <summary>Gets or sets user id.</summary>
    [JsonPropertyName("userId")]
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets username.</summary>
    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;

    /// <summary>Gets or sets email.</summary>
    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether PiggieTV has an email saved for this Jellyfin user.</summary>
    [JsonPropertyName("emailConfigured")]
    public bool EmailConfigured { get; set; }

    /// <summary>Gets or sets policy preset id.</summary>
    [JsonPropertyName("policyPresetId")]
    public string PolicyPresetId { get; set; } = "standard";

    /// <summary>Gets or sets where the mapping came from.</summary>
    [JsonPropertyName("source")]
    public string Source { get; set; } = "jellyfin";

    /// <summary>Gets or sets created timestamp.</summary>
    [JsonPropertyName("createdAtUtc")]
    public DateTimeOffset CreatedAtUtc { get; set; }

    /// <summary>
    /// Creates a user DTO.
    /// </summary>
    /// <param name="record">Stored user record.</param>
    /// <returns>DTO.</returns>
    public static PtvSignupUserDto FromRecord(SignupUserRecord record) => new()
    {
        CreatedAtUtc = record.CreatedAtUtc,
        Email = record.Email,
        EmailConfigured = !string.IsNullOrWhiteSpace(record.Email),
        PolicyPresetId = record.PolicyPresetId,
        Source = "ptv",
        UserId = record.UserId,
        Username = record.Username
    };
}

/// <summary>
/// Admin patch for a Jellyfin user's PiggieTV email mapping.
/// </summary>
public sealed class PtvSignupUserEmailPatch
{
    /// <summary>Gets or sets Jellyfin user id.</summary>
    [JsonPropertyName("userId")]
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets a legacy recovery email. Blank input is ignored and never deletes account state.</summary>
    [JsonPropertyName("email")]
    public string? Email { get; set; }
}

/// <summary>
/// Validate invite request.
/// </summary>
public sealed class PtvSignupValidateInviteRequest
{
    /// <summary>Gets or sets invite code.</summary>
    [JsonPropertyName("inviteCode")]
    public string? InviteCode { get; set; }
}

/// <summary>
/// Create user request.
/// </summary>
public sealed class PtvSignupCreateUserRequest
{
    /// <summary>Gets or sets invite code.</summary>
    [JsonPropertyName("inviteCode")]
    public string? InviteCode { get; set; }

    /// <summary>Gets or sets username.</summary>
    [JsonPropertyName("username")]
    public string? Username { get; set; }

    /// <summary>Gets or sets password.</summary>
    [JsonPropertyName("password")]
    public string? Password { get; set; }

    /// <summary>Gets or sets confirm password.</summary>
    [JsonPropertyName("confirmPassword")]
    public string? ConfirmPassword { get; set; }

    /// <summary>Gets or sets required email.</summary>
    [JsonPropertyName("email")]
    public string? Email { get; set; }

    /// <summary>Gets or sets a legacy client hint. The server ignores it and uses trusted PublicBaseUrl configuration.</summary>
    [JsonPropertyName("verificationBaseUrl")]
    public string? VerificationBaseUrl { get; set; }
}

/// <summary>
/// Email verification request.
/// </summary>
public sealed class PtvSignupEmailVerificationRequest
{
    /// <summary>Gets or sets email verification token.</summary>
    [JsonPropertyName("token")]
    public string? Token { get; set; }
}

/// <summary>
/// Password reset request.
/// </summary>
public sealed class PtvSignupPasswordResetRequest
{
    /// <summary>Gets or sets account email.</summary>
    [JsonPropertyName("email")]
    public string? Email { get; set; }
}

/// <summary>
/// Password reset confirmation request.
/// </summary>
public sealed class PtvSignupPasswordResetConfirmRequest
{
    /// <summary>Gets or sets account email.</summary>
    [JsonPropertyName("email")]
    public string? Email { get; set; }

    /// <summary>Gets or sets reset code.</summary>
    [JsonPropertyName("code")]
    public string? Code { get; set; }

    /// <summary>Gets or sets new password.</summary>
    [JsonPropertyName("password")]
    public string? Password { get; set; }

    /// <summary>Gets or sets confirmed new password.</summary>
    [JsonPropertyName("confirmPassword")]
    public string? ConfirmPassword { get; set; }
}

/// <summary>
/// Create invite request.
/// </summary>
public sealed class PtvSignupCreateInviteRequest
{
    /// <summary>Gets or sets label.</summary>
    [JsonPropertyName("label")]
    public string? Label { get; set; }

    /// <summary>Gets or sets expiration timestamp.</summary>
    [JsonPropertyName("expiresAtUtc")]
    public DateTimeOffset? ExpiresAtUtc { get; set; }

    /// <summary>Gets or sets max uses.</summary>
    [JsonPropertyName("maxUses")]
    public int? MaxUses { get; set; }

    /// <summary>Gets or sets policy preset id.</summary>
    [JsonPropertyName("policyPresetId")]
    public string? PolicyPresetId { get; set; }

    /// <summary>Gets or sets whether email is required.</summary>
    [JsonPropertyName("emailRequired")]
    public bool? EmailRequired { get; set; }

    /// <summary>Gets or sets explicit enabled folder ids.</summary>
    [JsonPropertyName("enabledFolderIds")]
    public List<string>? EnabledFolderIds { get; set; }
}

/// <summary>
/// Generic signup response.
/// </summary>
public class PtvSignupResponse
{
    /// <summary>Gets or sets whether request succeeded.</summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    /// <summary>Gets or sets friendly message.</summary>
    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;

    /// <summary>Gets or sets optional user id.</summary>
    [JsonPropertyName("userId")]
    public string? UserId { get; set; }

    /// <summary>Gets or sets optional username.</summary>
    [JsonPropertyName("username")]
    public string? Username { get; set; }
}

/// <summary>
/// Invite validation response.
/// </summary>
public sealed class PtvSignupInviteValidationResponse : PtvSignupResponse
{
    /// <summary>Gets or sets whether invite is valid.</summary>
    [JsonPropertyName("valid")]
    public bool Valid { get; set; }

    /// <summary>Gets or sets whether email is required.</summary>
    [JsonPropertyName("emailRequired")]
    public bool EmailRequired { get; set; }

    /// <summary>Gets or sets invite label.</summary>
    [JsonPropertyName("label")]
    public string? Label { get; set; }

    /// <summary>Gets or sets policy preset name.</summary>
    [JsonPropertyName("policyPresetName")]
    public string? PolicyPresetName { get; set; }
}

/// <summary>
/// Invite list response.
/// </summary>
public sealed class PtvSignupInviteListResponse
{
    /// <summary>Gets or sets whether request succeeded.</summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; } = true;

    /// <summary>Gets or sets whether native signup is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets invites.</summary>
    [JsonPropertyName("invites")]
    public List<PtvSignupInviteDto> Invites { get; set; } = [];

    /// <summary>Gets or sets policy presets.</summary>
    [JsonPropertyName("policyPresets")]
    public List<PtvSignupPolicyPresetDto> PolicyPresets { get; set; } = [];
}

/// <summary>
/// Native signup admin settings response.
/// </summary>
public sealed class PtvSignupAdminSettingsResponse
{
    /// <summary>Gets or sets whether request succeeded.</summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; } = true;

    /// <summary>Gets or sets whether native signup is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets default policy preset id.</summary>
    [JsonPropertyName("defaultPolicyPresetId")]
    public string DefaultPolicyPresetId { get; set; } = "standard";

    /// <summary>Gets or sets default enabled folder ids.</summary>
    [JsonPropertyName("defaultEnabledFolderIds")]
    public List<string> DefaultEnabledFolderIds { get; set; } = [];

    /// <summary>Gets or sets policy presets.</summary>
    [JsonPropertyName("policyPresets")]
    public List<PtvSignupPolicyPresetDto> PolicyPresets { get; set; } = [];

    /// <summary>Gets or sets email settings.</summary>
    [JsonPropertyName("emailSettings")]
    public PtvSignupEmailSettingsDto EmailSettings { get; set; } = new();

    /// <summary>Gets or sets native signup users.</summary>
    [JsonPropertyName("users")]
    public List<PtvSignupUserDto> Users { get; set; } = [];

    /// <summary>Gets or sets pending reset code count.</summary>
    [JsonPropertyName("pendingResetCount")]
    public int PendingResetCount { get; set; }

    /// <summary>Gets or sets pending email verification count.</summary>
    [JsonPropertyName("pendingVerificationCount")]
    public int PendingVerificationCount { get; set; }
}

/// <summary>
/// Native signup admin settings patch.
/// </summary>
public sealed class PtvSignupAdminSettingsPatch
{
    /// <summary>Gets or sets whether native signup is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool? Enabled { get; set; }

    /// <summary>Gets or sets default policy preset id.</summary>
    [JsonPropertyName("defaultPolicyPresetId")]
    public string? DefaultPolicyPresetId { get; set; }

    /// <summary>Gets or sets default enabled folder ids.</summary>
    [JsonPropertyName("defaultEnabledFolderIds")]
    public List<string>? DefaultEnabledFolderIds { get; set; }

    /// <summary>Gets or sets email settings.</summary>
    [JsonPropertyName("emailSettings")]
    public PtvSignupEmailSettingsDto? EmailSettings { get; set; }

    /// <summary>Gets or sets optional Jellyfin user email mappings for password reset.</summary>
    [JsonPropertyName("users")]
    public List<PtvSignupUserEmailPatch>? Users { get; set; }
}

/// <summary>
/// Test signup email request.
/// </summary>
public sealed class PtvSignupTestEmailRequest
{
    /// <summary>Gets or sets recipient email address.</summary>
    [JsonPropertyName("recipient")]
    public string? Recipient { get; set; }

    /// <summary>Gets or sets the public web URL used to resolve root-relative email assets.</summary>
    [JsonPropertyName("referenceUrl")]
    public string? ReferenceUrl { get; set; }
}
