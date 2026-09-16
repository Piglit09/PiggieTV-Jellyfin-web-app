using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>Durable PiggieTV account document stored independently of signup configuration.</summary>
public sealed class PtvAccountDocument
{
    /// <summary>Current account document schema version.</summary>
    public const int CurrentSchemaVersion = 1;

    /// <summary>Gets or sets the document schema version.</summary>
    public int SchemaVersion { get; set; } = CurrentSchemaVersion;

    /// <summary>Gets or sets the last successful write timestamp.</summary>
    public DateTimeOffset UpdatedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets durable profiles.</summary>
    public List<PtvProfileRecord> Profiles { get; set; } = [];

    /// <summary>Gets or sets pending and historical verification requests.</summary>
    public List<PtvEmailVerificationRecord> EmailVerifications { get; set; } = [];

    /// <summary>Gets or sets bounded server-side email rate-limit events.</summary>
    public List<PtvEmailRateLimitRecord> EmailRateLimits { get; set; } = [];

    /// <summary>Gets or sets bounded account audit events.</summary>
    public List<PtvAccountAuditEvent> AuditEvents { get; set; } = [];

    /// <summary>Gets or sets migration metadata.</summary>
    public PtvAccountMigrationState Migration { get; set; } = new();
}

/// <summary>PTV-owned profile keyed by immutable Jellyfin user ID.</summary>
public sealed class PtvProfileRecord
{
    /// <summary>Gets or sets the immutable Jellyfin user ID.</summary>
    public string JellyfinUserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the latest Jellyfin username snapshot.</summary>
    public string UsernameSnapshot { get; set; } = string.Empty;

    /// <summary>Gets or sets the canonical verified email for display.</summary>
    public string? Email { get; set; }

    /// <summary>Gets or sets the normalized canonical verified email.</summary>
    public string? EmailNormalized { get; set; }

    /// <summary>Gets or sets whether the canonical email is verified.</summary>
    public bool EmailVerified { get; set; }

    /// <summary>Gets or sets when the canonical email was verified.</summary>
    public DateTimeOffset? EmailVerifiedAtUtc { get; set; }

    /// <summary>Gets or sets a reliably mapped legacy email that still requires verification.</summary>
    public string? RecoveryEmail { get; set; }

    /// <summary>Gets or sets the normalized recovery email.</summary>
    public string? RecoveryEmailNormalized { get; set; }

    /// <summary>Gets or sets the profile creation timestamp.</summary>
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets the profile update timestamp.</summary>
    public DateTimeOffset UpdatedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets the last successful Jellyfin synchronization timestamp.</summary>
    public DateTimeOffset LastJellyfinSyncAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets when the profile was first observed without a Jellyfin user.</summary>
    public DateTimeOffset? OrphanedAtUtc { get; set; }

    /// <summary>Gets or sets the trusted source of the canonical or recovery email.</summary>
    public string EmailSource { get; set; } = string.Empty;
}

/// <summary>Pending or historical profile email verification.</summary>
public sealed class PtvEmailVerificationRecord
{
    /// <summary>Gets or sets the verification ID.</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets the immutable Jellyfin user ID.</summary>
    public string JellyfinUserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the requested email for display to its owner.</summary>
    public string PendingEmail { get; set; } = string.Empty;

    /// <summary>Gets or sets the normalized requested email.</summary>
    public string PendingEmailNormalized { get; set; } = string.Empty;

    /// <summary>Gets or sets the SHA-256 hash of the single-use raw token.</summary>
    public string TokenHash { get; set; } = string.Empty;

    /// <summary>Gets or sets add_email, change_email, or a future purpose.</summary>
    public string Purpose { get; set; } = "add_email";

    /// <summary>Gets or sets creation time.</summary>
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets expiry time.</summary>
    public DateTimeOffset ExpiresAtUtc { get; set; } = DateTimeOffset.UtcNow.AddHours(24);

    /// <summary>Gets or sets most recent successful delivery time.</summary>
    public DateTimeOffset? SentAtUtc { get; set; }

    /// <summary>Gets or sets verification time.</summary>
    public DateTimeOffset? VerifiedAtUtc { get; set; }

    /// <summary>Gets or sets consumption time.</summary>
    public DateTimeOffset? ConsumedAtUtc { get; set; }

    /// <summary>Gets or sets cancellation time.</summary>
    public DateTimeOffset? CancelledAtUtc { get; set; }

    /// <summary>Gets or sets supersession time.</summary>
    public DateTimeOffset? SupersededAtUtc { get; set; }

    /// <summary>Gets or sets verification attempt count.</summary>
    public int AttemptCount { get; set; }

    /// <summary>Gets or sets resend count.</summary>
    public int ResendCount { get; set; }

    /// <summary>Gets or sets total delivery attempt count.</summary>
    public int SendCount { get; set; }

    /// <summary>Gets or sets pending, sent, failed, expired, cancelled, superseded, or consumed.</summary>
    public string DeliveryStatus { get; set; } = "pending";
}

/// <summary>One persisted server-side rate-limit event.</summary>
public sealed class PtvEmailRateLimitRecord
{
    /// <summary>Gets or sets the Jellyfin user ID.</summary>
    public string JellyfinUserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the protected action.</summary>
    public string Action { get; set; } = string.Empty;

    /// <summary>Gets or sets a one-way request-source hash for anonymous verification controls.</summary>
    public string KeyHash { get; set; } = string.Empty;

    /// <summary>Gets or sets event time.</summary>
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Sanitized account audit event. It never contains emails or raw tokens.</summary>
public sealed class PtvAccountAuditEvent
{
    /// <summary>Gets or sets event time.</summary>
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets event name.</summary>
    public string Event { get; set; } = string.Empty;

    /// <summary>Gets or sets related Jellyfin user ID when applicable.</summary>
    public string? JellyfinUserId { get; set; }

    /// <summary>Gets or sets a non-sensitive result category.</summary>
    public string Result { get; set; } = string.Empty;
}

/// <summary>Idempotent account migration state and count-only recovery results.</summary>
public sealed class PtvAccountMigrationState
{
    /// <summary>Gets or sets the completed migration version.</summary>
    public int Version { get; set; }

    /// <summary>Gets or sets completion time.</summary>
    public DateTimeOffset? CompletedAtUtc { get; set; }

    /// <summary>Gets or sets current Jellyfin user count seen during migration.</summary>
    public int JellyfinUsersDiscovered { get; set; }

    /// <summary>Gets or sets the number of profiles present after migration.</summary>
    public int ExistingProfiles { get; set; }

    /// <summary>Gets or sets verified emails recovered by exact user-ID match.</summary>
    public int VerifiedEmailsRecovered { get; set; }

    /// <summary>Gets or sets reverification-required emails recovered by exact user-ID match.</summary>
    public int UnverifiedEmailsRecovered { get; set; }

    /// <summary>Gets or sets users still missing an email.</summary>
    public int UsersStillMissingEmail { get; set; }

    /// <summary>Gets or sets ambiguous legacy records skipped.</summary>
    public int AmbiguousRecordsSkipped { get; set; }

    /// <summary>Gets or sets orphaned profile/legacy records found.</summary>
    public int OrphanedRecordsFound { get; set; }
}

/// <summary>Authenticated owner's profile response.</summary>
public sealed class PtvAccountProfileResponse
{
    /// <summary>Gets or sets operation status.</summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; } = true;

    /// <summary>Gets or sets immutable Jellyfin user ID.</summary>
    [JsonPropertyName("jellyfinUserId")]
    public string JellyfinUserId { get; set; } = string.Empty;

    /// <summary>Gets or sets current username snapshot.</summary>
    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;

    /// <summary>Gets or sets canonical verified email.</summary>
    [JsonPropertyName("email")]
    public string? Email { get; set; }

    /// <summary>Gets or sets whether canonical email is verified.</summary>
    [JsonPropertyName("emailVerified")]
    public bool EmailVerified { get; set; }

    /// <summary>Gets or sets canonical verification time.</summary>
    [JsonPropertyName("emailVerifiedAt")]
    public DateTimeOffset? EmailVerifiedAtUtc { get; set; }

    /// <summary>Gets or sets current pending email for its authenticated owner.</summary>
    [JsonPropertyName("pendingEmail")]
    public string? PendingEmail { get; set; }

    /// <summary>Gets or sets pending expiry.</summary>
    [JsonPropertyName("pendingEmailExpiresAt")]
    public DateTimeOffset? PendingEmailExpiresAtUtc { get; set; }

    /// <summary>Gets or sets pending delivery status.</summary>
    [JsonPropertyName("pendingEmailStatus")]
    public string? PendingEmailStatus { get; set; }

    /// <summary>Gets or sets a mapped legacy email requiring reverification.</summary>
    [JsonPropertyName("recoveryEmail")]
    public string? RecoveryEmail { get; set; }

    /// <summary>Gets or sets whether the optional prompt should be shown for this account.</summary>
    [JsonPropertyName("enrollmentPromptEligible")]
    public bool EnrollmentPromptEligible { get; set; }
}

/// <summary>Email enrollment/change request.</summary>
public sealed class PtvAccountEmailRequest
{
    /// <summary>Gets or sets requested email. Browser-supplied user IDs are intentionally unsupported.</summary>
    [JsonPropertyName("email")]
    public string? Email { get; set; }
}

/// <summary>Raw verification token request. The token is never persisted in this form.</summary>
public sealed class PtvAccountEmailTokenRequest
{
    /// <summary>Gets or sets the raw token.</summary>
    [JsonPropertyName("token")]
    public string? Token { get; set; }
}

/// <summary>Safe account operation response.</summary>
public sealed class PtvAccountOperationResponse
{
    /// <summary>Gets or sets success.</summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    /// <summary>Gets or sets stable safe error category.</summary>
    [JsonPropertyName("code")]
    public string Code { get; set; } = string.Empty;

    /// <summary>Gets or sets safe user-facing message.</summary>
    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;

    /// <summary>Gets or sets refreshed owner profile when authenticated.</summary>
    [JsonPropertyName("profile")]
    public PtvAccountProfileResponse? Profile { get; set; }
}

/// <summary>Count-only administrator account health response.</summary>
public sealed class PtvAccountAdminHealthResponse
{
    /// <summary>Gets or sets Jellyfin user count.</summary>
    [JsonPropertyName("totalJellyfinUsers")]
    public int TotalJellyfinUsers { get; set; }

    /// <summary>Gets or sets PTV profile count.</summary>
    [JsonPropertyName("totalProfiles")]
    public int TotalProfiles { get; set; }

    /// <summary>Gets or sets verified-email count.</summary>
    [JsonPropertyName("verifiedEmails")]
    public int VerifiedEmails { get; set; }

    /// <summary>Gets or sets missing-email count.</summary>
    [JsonPropertyName("missingEmails")]
    public int MissingEmails { get; set; }

    /// <summary>Gets or sets active pending count.</summary>
    [JsonPropertyName("pendingVerifications")]
    public int PendingVerifications { get; set; }

    /// <summary>Gets or sets expired verification count.</summary>
    [JsonPropertyName("expiredVerifications")]
    public int ExpiredVerifications { get; set; }

    /// <summary>Gets or sets failed-delivery count.</summary>
    [JsonPropertyName("failedVerifications")]
    public int FailedVerifications { get; set; }

    /// <summary>Gets or sets orphan profile count.</summary>
    [JsonPropertyName("orphanedProfiles")]
    public int OrphanedProfiles { get; set; }

    /// <summary>Gets or sets whether profile/Jellyfin counts diverge.</summary>
    [JsonPropertyName("profileCountMismatch")]
    public bool ProfileCountMismatch { get; set; }

    /// <summary>Gets or sets count-only migration results.</summary>
    [JsonPropertyName("migration")]
    public PtvAccountMigrationState Migration { get; set; } = new();

    /// <summary>Gets or sets user account status rows.</summary>
    [JsonPropertyName("users")]
    public List<PtvAccountAdminUserResponse> Users { get; set; } = [];

    /// <summary>Gets or sets latest backup status.</summary>
    [JsonPropertyName("backup")]
    public PtvAccountBackupStatus Backup { get; set; } = new();
}

/// <summary>Administrator-visible account status row with masked email only.</summary>
public sealed class PtvAccountAdminUserResponse
{
    /// <summary>Gets or sets immutable Jellyfin user ID.</summary>
    [JsonPropertyName("jellyfinUserId")]
    public string JellyfinUserId { get; set; } = string.Empty;

    /// <summary>Gets or sets current username.</summary>
    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;

    /// <summary>Gets or sets masked canonical/pending email.</summary>
    [JsonPropertyName("maskedEmail")]
    public string? MaskedEmail { get; set; }

    /// <summary>Gets or sets verified, missing, pending, expired, failed, or reverification_required.</summary>
    [JsonPropertyName("emailStatus")]
    public string EmailStatus { get; set; } = "missing";

    /// <summary>Gets or sets present or missing profile status.</summary>
    [JsonPropertyName("profileStatus")]
    public string ProfileStatus { get; set; } = "present";

    /// <summary>Gets or sets latest sync.</summary>
    [JsonPropertyName("lastProfileSync")]
    public DateTimeOffset? LastProfileSyncAtUtc { get; set; }
}

/// <summary>Read-only administrator profile summaries for current Jellyfin users.</summary>
public sealed class PtvAccountAdminUsersResponse
{
    /// <summary>Gets or sets operation status.</summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; } = true;

    /// <summary>Gets or sets PTV profile summaries keyed by immutable Jellyfin user ID.</summary>
    [JsonPropertyName("users")]
    public List<PtvAccountAdminProfileSummary> Users { get; set; } = [];
}

/// <summary>
/// Administrator-visible PTV profile state. Canonical email is returned only
/// after verification; pending and recovery addresses remain masked.
/// </summary>
public sealed class PtvAccountAdminProfileSummary
{
    /// <summary>Gets or sets immutable Jellyfin user ID.</summary>
    [JsonPropertyName("jellyfinUserId")]
    public string JellyfinUserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the canonical verified email, when available.</summary>
    [JsonPropertyName("email")]
    public string? Email { get; set; }

    /// <summary>Gets or sets whether a canonical verified email exists.</summary>
    [JsonPropertyName("emailVerified")]
    public bool EmailVerified { get; set; }

    /// <summary>Gets or sets when the canonical email was verified.</summary>
    [JsonPropertyName("emailVerifiedAt")]
    public DateTimeOffset? EmailVerifiedAtUtc { get; set; }

    /// <summary>Gets or sets verified, missing, pending, expired, failed, or reverification_required.</summary>
    [JsonPropertyName("emailStatus")]
    public string EmailStatus { get; set; } = "missing";

    /// <summary>Gets or sets a masked pending or recovery address.</summary>
    [JsonPropertyName("maskedEmail")]
    public string? MaskedEmail { get; set; }

    /// <summary>Gets or sets present or missing profile status.</summary>
    [JsonPropertyName("profileStatus")]
    public string ProfileStatus { get; set; } = "missing";
}

/// <summary>Persisted and API-safe account backup task status.</summary>
public sealed class PtvAccountBackupStatus
{
    /// <summary>Gets or sets latest run time.</summary>
    public DateTimeOffset? LastRunAtUtc { get; set; }

    /// <summary>Gets or sets latest success time.</summary>
    public DateTimeOffset? LastSuccessAtUtc { get; set; }

    /// <summary>Gets or sets duration in milliseconds.</summary>
    public long DurationMilliseconds { get; set; }

    /// <summary>Gets or sets success, failed, running, or never.</summary>
    public string Result { get; set; } = "never";

    /// <summary>Gets or sets sanitized result detail.</summary>
    public string Message { get; set; } = "No account backup has run yet.";

    /// <summary>Gets or sets final artifact size.</summary>
    public long BackupSizeBytes { get; set; }

    /// <summary>Gets or sets profile count.</summary>
    public int ProfilesBackedUp { get; set; }

    /// <summary>Gets or sets verified-email count.</summary>
    public int VerifiedEmailsBackedUp { get; set; }

    /// <summary>Gets or sets pending count.</summary>
    public int PendingVerificationsBackedUp { get; set; }

    /// <summary>Gets or sets final backup ID, never a client-supplied path.</summary>
    public string BackupId { get; set; } = string.Empty;

    /// <summary>Gets or sets configured server-only backup root for admins.</summary>
    public string BackupPath { get; set; } = string.Empty;

    /// <summary>Gets or sets checksum verification state.</summary>
    public string VerificationStatus { get; set; } = "not_run";

    /// <summary>Gets or sets whether last success is older than the warning threshold.</summary>
    public bool Overdue { get; set; }
}

/// <summary>Non-sensitive account backup manifest.</summary>
public sealed class PtvAccountBackupManifest
{
    /// <summary>Gets or sets backup format version.</summary>
    public int FormatVersion { get; set; } = 1;

    /// <summary>Gets or sets creation time.</summary>
    public DateTimeOffset CreatedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets PiggieTV plugin version.</summary>
    public string ApplicationVersion { get; set; } = string.Empty;

    /// <summary>Gets or sets account schema version.</summary>
    public int SchemaVersion { get; set; }

    /// <summary>Gets or sets persistence type.</summary>
    public string DatabaseType { get; set; } = "atomic-json";

    /// <summary>Gets or sets scheduled, manual, pre_migration, pre_restore, or pre_bulk_import.</summary>
    public string BackupReason { get; set; } = "manual";

    /// <summary>Gets or sets profile count.</summary>
    public int Profiles { get; set; }

    /// <summary>Gets or sets verified-email count.</summary>
    public int VerifiedEmails { get; set; }

    /// <summary>Gets or sets pending count.</summary>
    public int PendingVerifications { get; set; }

    /// <summary>Gets or sets account data SHA-256.</summary>
    public string AccountDataSha256 { get; set; } = string.Empty;

    /// <summary>Gets or sets account artifact filename.</summary>
    public string AccountDataFile { get; set; } = "account-data.json";
}

/// <summary>Backup verification/restore response.</summary>
public sealed class PtvAccountBackupOperationResponse
{
    /// <summary>Gets or sets success.</summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    /// <summary>Gets or sets safe result code.</summary>
    [JsonPropertyName("code")]
    public string Code { get; set; } = string.Empty;

    /// <summary>Gets or sets safe result message.</summary>
    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;

    /// <summary>Gets or sets backup ID.</summary>
    [JsonPropertyName("backupId")]
    public string BackupId { get; set; } = string.Empty;

    /// <summary>Gets or sets whether checksum/schema/count validation passed.</summary>
    [JsonPropertyName("verified")]
    public bool Verified { get; set; }

    /// <summary>Gets or sets whether a restore was a non-mutating dry run.</summary>
    [JsonPropertyName("dryRun")]
    public bool DryRun { get; set; }
}

/// <summary>Administrative restore request with an explicit destructive-operation confirmation.</summary>
public sealed class PtvAccountBackupRestoreRequest
{
    /// <summary>Gets or sets the server-generated backup ID. Paths are not accepted.</summary>
    [JsonPropertyName("backupId")]
    public string? BackupId { get; set; }

    /// <summary>Gets or sets whether to validate without changing active account data.</summary>
    [JsonPropertyName("dryRun")]
    public bool DryRun { get; set; } = true;

    /// <summary>Gets or sets explicit confirmation required for a non-dry-run restore.</summary>
    [JsonPropertyName("confirm")]
    public bool Confirm { get; set; }
}

/// <summary>Administrative backup verification request.</summary>
public sealed class PtvAccountBackupVerifyRequest
{
    /// <summary>Gets or sets the server-generated backup ID. Paths are not accepted.</summary>
    [JsonPropertyName("backupId")]
    public string? BackupId { get; set; }
}
