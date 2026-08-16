using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Durable PTV profile and verification implementation.</summary>
public sealed class PtvAccountService : IPtvAccountService
{
    private const int CurrentMigrationVersion = 1;
    private const int HourlySendLimit = 5;
    private const int DailySendLimit = 10;
    private const int ResendCooldownSeconds = 60;
    private const string AddEmailPurpose = "add_email";
    private const string ChangeEmailPurpose = "change_email";
    private static readonly Regex EmailRegex = new("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private readonly SemaphoreSlim _initializationGate = new(1, 1);
    private readonly IPtvAccountBackupService _backupService;
    private readonly ILogger<PtvAccountService> _logger;
    private readonly IPtvLegacySignupEmailSource _legacySignupEmailSource;
    private readonly IPtvMailService _mailService;
    private readonly IPtvAccountRepository _repository;
    private readonly IPtvJellyfinUserProvider _userProvider;
    private bool _initialized;

    /// <summary>Initializes account services.</summary>
    public PtvAccountService(
        IPtvAccountRepository repository,
        IPtvAccountBackupService backupService,
        IPtvMailService mailService,
        IPtvJellyfinUserProvider userProvider,
        IPtvLegacySignupEmailSource legacySignupEmailSource,
        ILogger<PtvAccountService> logger)
    {
        _repository = repository;
        _backupService = backupService;
        _mailService = mailService;
        _userProvider = userProvider;
        _legacySignupEmailSource = legacySignupEmailSource;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<PtvAccountMigrationState> InitializeAsync(CancellationToken cancellationToken = default)
    {
        await _initializationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_initialized)
            {
                return (await _repository.ReadAsync(cancellationToken).ConfigureAwait(false)).Migration;
            }

            var current = await _repository.ReadAsync(cancellationToken).ConfigureAwait(false);
            if (current.Migration.Version < CurrentMigrationVersion)
            {
                var backup = await _backupService.CreateBackupAsync("pre_migration", cancellationToken).ConfigureAwait(false);
                if (!backup.Ok || !backup.Verified)
                {
                    throw new PtvAccountBackupException(
                        "PRE_MIGRATION_BACKUP_FAILED",
                        "Account migration stopped because its pre-migration backup failed.");
                }
            }

            var jellyfinUsers = GetJellyfinUsers();
            var legacySignupRecords = _legacySignupEmailSource.GetRecords();
            var migration = await _repository.ExecuteTransactionAsync(document =>
            {
                MigrateLegacySignupRecords(document, jellyfinUsers, legacySignupRecords);
                SynchronizeProfiles(document, jellyfinUsers);
                return CopyMigration(document.Migration);
            }, cancellationToken).ConfigureAwait(false);
            _initialized = true;
            return migration;
        }
        finally
        {
            _initializationGate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<PtvAccountProfileResponse> GetProfileAsync(
        Guid jellyfinUserId,
        string username,
        bool isAdministrator,
        CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);
        return await _repository.ExecuteTransactionAsync(document =>
        {
            var profile = EnsureProfile(document, jellyfinUserId, username);
            return ToProfileResponse(document, profile, isAdministrator);
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<PtvAccountOperationResponse> StartEmailVerificationAsync(
        Guid jellyfinUserId,
        string username,
        bool isAdministrator,
        string? email,
        CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);
        if (!TryNormalizeEmail(email, out var displayEmail, out var normalizedEmail))
        {
            return Failure("INVALID_EMAIL", "Enter a valid email address.");
        }

        var configurationError = GetDeliveryConfigurationError();
        if (configurationError is not null) return configurationError;

        var token = CreateVerificationToken();
        var tokenHash = HashToken(token);
        var now = DateTimeOffset.UtcNow;
        PendingDispatch? dispatch = null;
        PtvAccountOperationResponse? rejected = null;

        await _repository.ExecuteTransactionAsync(document =>
        {
            var profile = EnsureProfile(document, jellyfinUserId, username);
            if (EmailBelongsToAnotherProfile(document, normalizedEmail, profile.JellyfinUserId))
            {
                rejected = Failure("EMAIL_ALREADY_IN_USE", "This email address cannot be used for this account.", ToProfileResponse(document, profile, isAdministrator));
                return false;
            }

            if (IsSendRateLimited(document, profile.JellyfinUserId, now, out var rateMessage))
            {
                rejected = Failure("VERIFICATION_RATE_LIMITED", rateMessage, ToProfileResponse(document, profile, isAdministrator));
                return false;
            }

            foreach (var active in document.EmailVerifications.Where(item => IsActive(item, now)
                         && string.Equals(item.JellyfinUserId, profile.JellyfinUserId, StringComparison.OrdinalIgnoreCase)))
            {
                active.SupersededAtUtc = now;
                active.DeliveryStatus = "superseded";
            }

            var purpose = profile.EmailVerified ? ChangeEmailPurpose : AddEmailPurpose;
            var verification = new PtvEmailVerificationRecord
            {
                CreatedAtUtc = now,
                DeliveryStatus = "pending",
                ExpiresAtUtc = now.AddMinutes(_mailService.VerificationExpiryMinutes),
                Id = Guid.NewGuid().ToString("N"),
                JellyfinUserId = profile.JellyfinUserId,
                PendingEmail = displayEmail,
                PendingEmailNormalized = normalizedEmail,
                Purpose = purpose,
                SendCount = 1,
                TokenHash = tokenHash
            };
            document.EmailVerifications.Add(verification);
            document.EmailRateLimits.Add(new PtvEmailRateLimitRecord
            {
                Action = "verification-send",
                CreatedAtUtc = now,
                JellyfinUserId = profile.JellyfinUserId
            });
            Audit(document, "email_verification_requested", profile.JellyfinUserId, "pending");
            dispatch = new PendingDispatch(
                verification.Id,
                profile.JellyfinUserId,
                profile.UsernameSnapshot,
                displayEmail,
                token,
                profile.EmailVerified);
            return true;
        }, cancellationToken).ConfigureAwait(false);

        if (rejected is not null) return rejected;
        return await DeliverVerificationAsync(dispatch!, isAdministrator, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<PtvAccountOperationResponse> ResendEmailVerificationAsync(
        Guid jellyfinUserId,
        string username,
        bool isAdministrator,
        CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);
        var configurationError = GetDeliveryConfigurationError();
        if (configurationError is not null) return configurationError;

        var token = CreateVerificationToken();
        var tokenHash = HashToken(token);
        var now = DateTimeOffset.UtcNow;
        PendingDispatch? dispatch = null;
        PtvAccountOperationResponse? rejected = null;

        await _repository.ExecuteTransactionAsync(document =>
        {
            var profile = EnsureProfile(document, jellyfinUserId, username);
            var pending = GetLatestPending(document, profile.JellyfinUserId, includeExpired: true);
            if (pending is null)
            {
                rejected = Failure("VERIFICATION_INVALID", "There is no email verification to resend.", ToProfileResponse(document, profile, isAdministrator));
                return false;
            }

            if (IsSendRateLimited(document, profile.JellyfinUserId, now, out var rateMessage))
            {
                rejected = Failure("VERIFICATION_RATE_LIMITED", rateMessage, ToProfileResponse(document, profile, isAdministrator));
                return false;
            }

            if (EmailBelongsToAnotherProfile(document, pending.PendingEmailNormalized, profile.JellyfinUserId))
            {
                pending.CancelledAtUtc = now;
                pending.DeliveryStatus = "cancelled";
                rejected = Failure("EMAIL_ALREADY_IN_USE", "This email address cannot be used for this account.", ToProfileResponse(document, profile, isAdministrator));
                return false;
            }

            pending.CreatedAtUtc = now;
            pending.ExpiresAtUtc = now.AddMinutes(_mailService.VerificationExpiryMinutes);
            pending.TokenHash = tokenHash;
            pending.SentAtUtc = null;
            pending.ResendCount += 1;
            pending.SendCount += 1;
            pending.DeliveryStatus = "pending";
            pending.CancelledAtUtc = null;
            pending.ConsumedAtUtc = null;
            pending.SupersededAtUtc = null;
            document.EmailRateLimits.Add(new PtvEmailRateLimitRecord
            {
                Action = "verification-send",
                CreatedAtUtc = now,
                JellyfinUserId = profile.JellyfinUserId
            });
            Audit(document, "email_verification_resent", profile.JellyfinUserId, "pending");
            dispatch = new PendingDispatch(
                pending.Id,
                profile.JellyfinUserId,
                profile.UsernameSnapshot,
                pending.PendingEmail,
                token,
                profile.EmailVerified);
            return true;
        }, cancellationToken).ConfigureAwait(false);

        if (rejected is not null) return rejected;
        return await DeliverVerificationAsync(dispatch!, isAdministrator, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<PtvAccountOperationResponse> CancelEmailVerificationAsync(
        Guid jellyfinUserId,
        string username,
        bool isAdministrator,
        CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);
        return await _repository.ExecuteTransactionAsync(document =>
        {
            var profile = EnsureProfile(document, jellyfinUserId, username);
            var pending = GetLatestPending(document, profile.JellyfinUserId, includeExpired: true);
            if (pending is null)
            {
                return Failure("VERIFICATION_INVALID", "There is no pending email verification.", ToProfileResponse(document, profile, isAdministrator));
            }

            pending.CancelledAtUtc = DateTimeOffset.UtcNow;
            pending.DeliveryStatus = "cancelled";
            Audit(document, "email_verification_cancelled", profile.JellyfinUserId, "cancelled");
            return Success("Verification request cancelled.", ToProfileResponse(document, profile, isAdministrator));
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<PtvAccountOperationResponse> AdminCancelEmailVerificationAsync(
        Guid jellyfinUserId,
        CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);
        return await _repository.ExecuteTransactionAsync(document =>
        {
            var userId = jellyfinUserId.ToString("N");
            var pending = GetLatestPending(document, userId, includeExpired: true);
            if (pending is null) return Failure("VERIFICATION_INVALID", "There is no pending email verification.");
            pending.CancelledAtUtc = DateTimeOffset.UtcNow;
            pending.DeliveryStatus = "cancelled";
            Audit(document, "email_verification_cancelled", userId, "admin");
            return Success("Verification request cancelled.");
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<PtvAccountOperationResponse> VerifyEmailAsync(
        string? rawToken,
        string remoteAddress = "unknown",
        CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);
        var now = DateTimeOffset.UtcNow;
        var sourceHash = HashRateLimitKey(remoteAddress);
        var rateLimited = await _repository.ExecuteTransactionAsync(document =>
        {
            var recentAttempts = document.EmailRateLimits.Count(item => item.Action == "verification-consume"
                && item.KeyHash == sourceHash
                && item.CreatedAtUtc > now.AddMinutes(-15));
            document.EmailRateLimits.Add(new PtvEmailRateLimitRecord
            {
                Action = "verification-consume",
                CreatedAtUtc = now,
                KeyHash = sourceHash
            });
            return recentAttempts >= 30;
        }, cancellationToken).ConfigureAwait(false);
        if (rateLimited)
        {
            return Failure("VERIFICATION_RATE_LIMITED", "Too many verification attempts. Please try again later.");
        }

        if (!TryCleanToken(rawToken, out var token))
        {
            return Failure("VERIFICATION_INVALID", "This verification link is invalid or has expired.");
        }

        string? previousEmail = null;
        string? changedUsername = null;
        VerificationCommitResult? commit = null;
        var tokenBytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));

        await _repository.ExecuteTransactionAsync(document =>
        {
            var verification = document.EmailVerifications.FirstOrDefault(candidate => TokenMatches(candidate.TokenHash, tokenBytes));
            if (verification is null)
            {
                commit = new VerificationCommitResult(Failure("VERIFICATION_INVALID", "This verification link is invalid or has expired."), null);
                return false;
            }

            verification.AttemptCount += 1;
            if (verification.ConsumedAtUtc is not null)
            {
                commit = new VerificationCommitResult(Failure("VERIFICATION_ALREADY_USED", "This verification link has already been used."), null);
                return false;
            }

            if (verification.CancelledAtUtc is not null || verification.SupersededAtUtc is not null)
            {
                commit = new VerificationCommitResult(Failure("VERIFICATION_INVALID", "This verification link is invalid or has expired."), null);
                return false;
            }

            if (verification.ExpiresAtUtc <= now)
            {
                verification.DeliveryStatus = "expired";
                Audit(document, "email_verification_expired", verification.JellyfinUserId, "expired");
                commit = new VerificationCommitResult(Failure("VERIFICATION_EXPIRED", "This verification link is invalid or has expired."), null);
                return false;
            }

            if (!Guid.TryParse(verification.JellyfinUserId, out var targetId) || _userProvider.GetById(targetId) is not { } targetUser)
            {
                commit = new VerificationCommitResult(Failure("PROFILE_NOT_FOUND", "This verification link is invalid or has expired."), null);
                return false;
            }

            var profile = document.Profiles.FirstOrDefault(item => string.Equals(item.JellyfinUserId, verification.JellyfinUserId, StringComparison.OrdinalIgnoreCase));
            if (profile is null)
            {
                commit = new VerificationCommitResult(Failure("PROFILE_NOT_FOUND", "This verification link is invalid or has expired."), null);
                return false;
            }

            if (EmailBelongsToAnotherProfile(document, verification.PendingEmailNormalized, profile.JellyfinUserId))
            {
                commit = new VerificationCommitResult(Failure("EMAIL_ALREADY_IN_USE", "This email address cannot be used for this account."), null);
                return false;
            }

            previousEmail = profile.EmailVerified ? profile.Email : null;
            changedUsername = targetUser.Username;
            profile.UsernameSnapshot = targetUser.Username;
            profile.Email = verification.PendingEmail;
            profile.EmailNormalized = verification.PendingEmailNormalized;
            profile.EmailVerified = true;
            profile.EmailVerifiedAtUtc = now;
            profile.RecoveryEmail = null;
            profile.RecoveryEmailNormalized = null;
            profile.EmailSource = verification.Purpose == ChangeEmailPurpose ? "verified_change" : "verified_profile";
            profile.UpdatedAtUtc = now;
            profile.LastJellyfinSyncAtUtc = now;
            verification.VerifiedAtUtc = now;
            verification.ConsumedAtUtc = now;
            verification.DeliveryStatus = "consumed";
            foreach (var other in document.EmailVerifications.Where(item =>
                         !ReferenceEquals(item, verification)
                         && IsActive(item, now)
                         && string.Equals(item.JellyfinUserId, profile.JellyfinUserId, StringComparison.OrdinalIgnoreCase)))
            {
                other.SupersededAtUtc = now;
                other.DeliveryStatus = "superseded";
            }

            Audit(document, previousEmail is null ? "email_verified" : "email_changed", profile.JellyfinUserId, "success");
            commit = new VerificationCommitResult(
                Success("Email verified. Your email has been added to your PiggieTV profile.", ToProfileResponse(document, profile, false)),
                profile.JellyfinUserId);
            return true;
        }, cancellationToken).ConfigureAwait(false);

        var result = commit?.Response ?? Failure("VERIFICATION_INVALID", "This verification link is invalid or has expired.");
        if (result.Ok && !string.IsNullOrWhiteSpace(previousEmail) && !string.IsNullOrWhiteSpace(changedUsername))
        {
            try
            {
                var content = PtvSignupEmailTemplates.BuildProfileEmailChanged(
                    changedUsername,
                    _mailService.ResolveLogoUrl(_mailService.PublicBaseUrl));
                await _mailService.SendAsync(
                    previousEmail,
                    "Your PiggieTV email address was changed",
                    content,
                    cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "PiggieTV could not send the old-address email-change notice. UserId={UserId}.", commit?.JellyfinUserId);
            }
        }

        return result;
    }

    /// <inheritdoc />
    public async Task ImportVerifiedSignupEmailAsync(
        Guid jellyfinUserId,
        string username,
        string email,
        CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);
        if (!TryNormalizeEmail(email, out var displayEmail, out var normalizedEmail))
        {
            throw new PtvAccountDataException("INVALID_EMAIL", "A verified signup email is invalid.");
        }

        await _repository.ExecuteTransactionAsync(document =>
        {
            var profile = EnsureProfile(document, jellyfinUserId, username);
            if (EmailBelongsToAnotherProfile(document, normalizedEmail, profile.JellyfinUserId))
            {
                throw new PtvAccountDataException("EMAIL_ALREADY_IN_USE", "A verified email is already assigned to another profile.");
            }

            var now = DateTimeOffset.UtcNow;
            profile.Email = displayEmail;
            profile.EmailNormalized = normalizedEmail;
            profile.EmailVerified = true;
            profile.EmailVerifiedAtUtc = now;
            profile.EmailSource = "native_signup_verified";
            profile.RecoveryEmail = null;
            profile.RecoveryEmailNormalized = null;
            profile.UpdatedAtUtc = now;
            Audit(document, "email_verified", profile.JellyfinUserId, "native_signup");
            return true;
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task RemoveProvisioningProfileAsync(
        Guid jellyfinUserId,
        CancellationToken cancellationToken = default)
    {
        var userId = jellyfinUserId.ToString("N");
        await _repository.ExecuteTransactionAsync(document =>
        {
            document.Profiles.RemoveAll(profile => string.Equals(profile.JellyfinUserId, userId, StringComparison.OrdinalIgnoreCase)
                && string.Equals(profile.EmailSource, "native_signup_verified", StringComparison.Ordinal));
            document.EmailVerifications.RemoveAll(item => string.Equals(item.JellyfinUserId, userId, StringComparison.OrdinalIgnoreCase));
            document.EmailRateLimits.RemoveAll(item => string.Equals(item.JellyfinUserId, userId, StringComparison.OrdinalIgnoreCase));
            Audit(document, "signup_profile_rolled_back", userId, "success");
            return true;
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<PtvProfileRecord?> FindVerifiedProfileByEmailAsync(
        string email,
        CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);
        if (!TryNormalizeEmail(email, out _, out var normalized)) return null;
        var document = await _repository.ReadAsync(cancellationToken).ConfigureAwait(false);
        return document.Profiles.FirstOrDefault(profile => profile.EmailVerified
            && string.Equals(profile.EmailNormalized, normalized, StringComparison.OrdinalIgnoreCase));
    }

    /// <inheritdoc />
    public async Task<PtvAccountAdminHealthResponse> GetAdminHealthAsync(
        PtvAccountBackupStatus backupStatus,
        CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken).ConfigureAwait(false);
        var jellyfinUsers = GetJellyfinUsers();
        var userIds = jellyfinUsers.Select(user => user.Id.ToString("N")).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return await _repository.ExecuteTransactionAsync(document =>
        {
            SynchronizeProfiles(document, jellyfinUsers);
            var now = DateTimeOffset.UtcNow;
            var rows = jellyfinUsers.OrderBy(user => user.Username, StringComparer.OrdinalIgnoreCase).Select(user =>
            {
                var userId = user.Id.ToString("N");
                var profile = document.Profiles.FirstOrDefault(item => string.Equals(item.JellyfinUserId, userId, StringComparison.OrdinalIgnoreCase));
                var latest = profile is null ? null : GetLatestPending(document, profile.JellyfinUserId, includeExpired: true);
                return CreateAdminUser(user, profile, latest, now);
            }).ToList();
            var active = document.EmailVerifications.Where(item => IsActive(item, now)).ToList();
            var expired = document.EmailVerifications.Count(item => IsUnconsumed(item) && item.ExpiresAtUtc <= now);
            var orphaned = document.Profiles.Count(profile => !userIds.Contains(profile.JellyfinUserId));

            return new PtvAccountAdminHealthResponse
            {
                Backup = backupStatus,
                ExpiredVerifications = expired,
                FailedVerifications = active.Count(item => item.DeliveryStatus == "failed"),
                Migration = CopyMigration(document.Migration),
                MissingEmails = rows.Count(item => item.EmailStatus is "missing" or "reverification_required"),
                OrphanedProfiles = orphaned,
                PendingVerifications = active.Count,
                ProfileCountMismatch = document.Profiles.Count != jellyfinUsers.Count,
                TotalJellyfinUsers = jellyfinUsers.Count,
                TotalProfiles = document.Profiles.Count,
                Users = rows,
                VerifiedEmails = document.Profiles.Count(profile => profile.EmailVerified)
            };
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<PtvAccountAdminUsersResponse> GetAdminUsersAsync(
        CancellationToken cancellationToken = default)
    {
        // This endpoint is deliberately observational. In particular, do not
        // initialize or synchronize profiles here: opening Users must not
        // create profile records or update their synchronization timestamps.
        var document = await _repository.ReadAsync(cancellationToken).ConfigureAwait(false);
        var profilesByUserId = document.Profiles.ToDictionary(
            profile => profile.JellyfinUserId,
            StringComparer.OrdinalIgnoreCase);
        var pendingByUserId = document.EmailVerifications
            .Where(IsUnconsumed)
            .GroupBy(item => item.JellyfinUserId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                group => group.OrderByDescending(item => item.CreatedAtUtc).First(),
                StringComparer.OrdinalIgnoreCase);
        var now = DateTimeOffset.UtcNow;
        var users = GetJellyfinUsers()
            .OrderBy(user => user.Username, StringComparer.OrdinalIgnoreCase)
            .Select(user =>
            {
                var userId = user.Id.ToString("N");
                profilesByUserId.TryGetValue(userId, out var profile);
                pendingByUserId.TryGetValue(userId, out var pending);
                return CreateAdminProfileSummary(userId, profile, pending, now);
            })
            .ToList();

        return new PtvAccountAdminUsersResponse { Users = users };
    }

    private async Task<PtvAccountOperationResponse> DeliverVerificationAsync(
        PendingDispatch dispatch,
        bool isAdministrator,
        CancellationToken cancellationToken)
    {
        var verificationUrl = BuildVerificationUrl(_mailService.PublicBaseUrl, dispatch.RawToken);
        var content = PtvSignupEmailTemplates.BuildProfileVerification(
            dispatch.Username,
            verificationUrl,
            _mailService.ResolveLogoUrl(verificationUrl),
            _mailService.VerificationExpiryMinutes,
            dispatch.KeepsExistingEmail);
        try
        {
            await _mailService.SendAsync(
                dispatch.Email,
                "Verify your PiggieTV email",
                content,
                cancellationToken).ConfigureAwait(false);
            return await _repository.ExecuteTransactionAsync(document =>
            {
                var verification = document.EmailVerifications.FirstOrDefault(item => item.Id == dispatch.VerificationId);
                var profile = document.Profiles.First(item => item.JellyfinUserId == dispatch.JellyfinUserId);
                if (verification is not null)
                {
                    verification.SentAtUtc = DateTimeOffset.UtcNow;
                    verification.DeliveryStatus = "sent";
                }

                return Success(
                    "Verification email sent. Your email will be added after you verify it.",
                    ToProfileResponse(document, profile, isAdministrator));
            }, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PiggieTV profile verification delivery failed. UserId={UserId}; VerificationId={VerificationId}.", dispatch.JellyfinUserId, dispatch.VerificationId);
            return await _repository.ExecuteTransactionAsync(document =>
            {
                var verification = document.EmailVerifications.FirstOrDefault(item => item.Id == dispatch.VerificationId);
                var profile = document.Profiles.First(item => item.JellyfinUserId == dispatch.JellyfinUserId);
                if (verification is not null) verification.DeliveryStatus = "failed";
                Audit(document, "email_verification_requested", dispatch.JellyfinUserId, "smtp_failed");
                return Failure(
                    "SMTP_FAILURE",
                    "We couldn't send the verification email. Please try again.",
                    ToProfileResponse(document, profile, isAdministrator));
            }, cancellationToken).ConfigureAwait(false);
        }
    }

    private PtvAccountOperationResponse? GetDeliveryConfigurationError()
    {
        if (!_mailService.IsConfigured)
        {
            return Failure("SMTP_FAILURE", "Email verification is not configured yet.");
        }

        if (string.IsNullOrWhiteSpace(_mailService.PublicBaseUrl))
        {
            return Failure("SMTP_FAILURE", "The public PiggieTV URL is not configured yet.");
        }

        return null;
    }

    private static PtvProfileRecord EnsureProfile(PtvAccountDocument document, Guid userId, string username)
    {
        var id = userId.ToString("N");
        var now = DateTimeOffset.UtcNow;
        var cleanUsername = CleanUsername(username);
        var profile = document.Profiles.FirstOrDefault(item => string.Equals(item.JellyfinUserId, id, StringComparison.OrdinalIgnoreCase));
        if (profile is null)
        {
            profile = new PtvProfileRecord
            {
                CreatedAtUtc = now,
                JellyfinUserId = id,
                LastJellyfinSyncAtUtc = now,
                UpdatedAtUtc = now,
                UsernameSnapshot = cleanUsername
            };
            document.Profiles.Add(profile);
            Audit(document, "profile_created", id, "success");
        }
        else
        {
            profile.UsernameSnapshot = cleanUsername;
            profile.LastJellyfinSyncAtUtc = now;
            profile.OrphanedAtUtc = null;
            profile.UpdatedAtUtc = now;
        }

        return profile;
    }

    private static void SynchronizeProfiles(PtvAccountDocument document, IReadOnlyList<PtvJellyfinUser> jellyfinUsers)
    {
        var now = DateTimeOffset.UtcNow;
        var liveIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var user in jellyfinUsers)
        {
            var profile = EnsureProfile(document, user.Id, user.Username);
            liveIds.Add(profile.JellyfinUserId);
        }

        foreach (var profile in document.Profiles.Where(item => !liveIds.Contains(item.JellyfinUserId)))
        {
            profile.OrphanedAtUtc ??= now;
        }
    }

    private static void MigrateLegacySignupRecords(
        PtvAccountDocument document,
        IReadOnlyList<PtvJellyfinUser> jellyfinUsers,
        IReadOnlyList<SignupUserRecord> legacy)
    {
        if (document.Migration.Version >= CurrentMigrationVersion) return;
        var now = DateTimeOffset.UtcNow;
        var liveUsers = jellyfinUsers.ToDictionary(user => user.Id.ToString("N"), StringComparer.OrdinalIgnoreCase);
        var valid = legacy.Where(record => Guid.TryParse(record.UserId, out var parsed)
                && parsed != Guid.Empty
                && liveUsers.ContainsKey(parsed.ToString("N"))
                && TryNormalizeEmail(record.Email, out _, out _))
            .ToList();
        var ambiguousIds = valid.GroupBy(record => Guid.Parse(record.UserId).ToString("N"), StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Select(record => NormalizeEmailOrEmpty(record.Email)).Distinct(StringComparer.OrdinalIgnoreCase).Count() > 1)
            .Select(group => group.Key)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var ambiguousEmails = valid.GroupBy(record => NormalizeEmailOrEmpty(record.Email), StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Select(record => Guid.Parse(record.UserId).ToString("N")).Distinct(StringComparer.OrdinalIgnoreCase).Count() > 1)
            .Select(group => group.Key)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var verifiedRecovered = 0;
        var unverifiedRecovered = 0;
        var skipped = legacy.Count - valid.Count;

        foreach (var user in jellyfinUsers) EnsureProfile(document, user.Id, user.Username);
        foreach (var record in valid)
        {
            var id = Guid.Parse(record.UserId).ToString("N");
            TryNormalizeEmail(record.Email, out var display, out var normalized);
            if (ambiguousIds.Contains(id) || ambiguousEmails.Contains(normalized))
            {
                skipped += 1;
                continue;
            }

            var profile = document.Profiles.First(item => item.JellyfinUserId == id);
            if (profile.EmailVerified || !string.IsNullOrWhiteSpace(profile.RecoveryEmail)) continue;
            if (string.Equals(record.RemoteAddress, "admin-mapped", StringComparison.OrdinalIgnoreCase))
            {
                profile.RecoveryEmail = display;
                profile.RecoveryEmailNormalized = normalized;
                profile.EmailSource = "legacy_admin_mapping_reverification_required";
                unverifiedRecovered += 1;
            }
            else
            {
                profile.Email = display;
                profile.EmailNormalized = normalized;
                profile.EmailVerified = true;
                profile.EmailVerifiedAtUtc = record.CreatedAtUtc == default ? now : record.CreatedAtUtc;
                profile.EmailSource = "legacy_native_signup_verified";
                verifiedRecovered += 1;
            }

            profile.UpdatedAtUtc = now;
            Audit(document, "profile_recovered", id, profile.EmailVerified ? "verified" : "reverification_required");
        }

        var orphanedLegacy = legacy.Count(record => !Guid.TryParse(record.UserId, out var parsed)
            || parsed == Guid.Empty
            || !liveUsers.ContainsKey(parsed.ToString("N")));
        document.Migration = new PtvAccountMigrationState
        {
            AmbiguousRecordsSkipped = skipped,
            CompletedAtUtc = now,
            ExistingProfiles = document.Profiles.Count,
            JellyfinUsersDiscovered = jellyfinUsers.Count,
            OrphanedRecordsFound = orphanedLegacy,
            UnverifiedEmailsRecovered = unverifiedRecovered,
            UsersStillMissingEmail = document.Profiles.Count(profile => !profile.EmailVerified && string.IsNullOrWhiteSpace(profile.RecoveryEmail)),
            VerifiedEmailsRecovered = verifiedRecovered,
            Version = CurrentMigrationVersion
        };
        Audit(document, "profile_migration_completed", null, "success");
    }

    private static PtvAccountProfileResponse ToProfileResponse(PtvAccountDocument document, PtvProfileRecord profile, bool isAdministrator)
    {
        var now = DateTimeOffset.UtcNow;
        var pending = GetLatestPending(document, profile.JellyfinUserId, includeExpired: true);
        var activePending = pending is not null && IsActive(pending, now);
        var pendingStatus = pending?.DeliveryStatus;
        if (pending is not null && pending.ExpiresAtUtc <= now && IsUnconsumed(pending)) pendingStatus = "expired";

        return new PtvAccountProfileResponse
        {
            Email = profile.EmailVerified ? profile.Email : null,
            EmailVerified = profile.EmailVerified,
            EmailVerifiedAtUtc = profile.EmailVerifiedAtUtc,
            EnrollmentPromptEligible = !isAdministrator && !profile.EmailVerified && !activePending,
            JellyfinUserId = profile.JellyfinUserId,
            PendingEmail = pending is not null && IsUnconsumed(pending) ? pending.PendingEmail : null,
            PendingEmailExpiresAtUtc = pending is not null && IsUnconsumed(pending) ? pending.ExpiresAtUtc : null,
            PendingEmailStatus = pending is not null && IsUnconsumed(pending) ? pendingStatus : null,
            RecoveryEmail = !profile.EmailVerified ? profile.RecoveryEmail : null,
            Username = profile.UsernameSnapshot
        };
    }

    private static PtvAccountAdminUserResponse CreateAdminUser(PtvJellyfinUser user, PtvProfileRecord? profile, PtvEmailVerificationRecord? pending, DateTimeOffset now)
    {
        var (status, maskedEmail) = GetAdminEmailState(profile, pending, now);

        return new PtvAccountAdminUserResponse
        {
            EmailStatus = status,
            JellyfinUserId = user.Id.ToString("N"),
            LastProfileSyncAtUtc = profile?.LastJellyfinSyncAtUtc,
            MaskedEmail = maskedEmail,
            ProfileStatus = profile is null ? "missing" : "present",
            Username = user.Username
        };
    }

    private static PtvAccountAdminProfileSummary CreateAdminProfileSummary(
        string userId,
        PtvProfileRecord? profile,
        PtvEmailVerificationRecord? pending,
        DateTimeOffset now)
    {
        var (status, maskedEmail) = GetAdminEmailState(profile, pending, now);
        return new PtvAccountAdminProfileSummary
        {
            Email = profile?.EmailVerified == true ? profile.Email : null,
            EmailStatus = status,
            EmailVerified = profile?.EmailVerified == true,
            EmailVerifiedAtUtc = profile?.EmailVerified == true ? profile.EmailVerifiedAtUtc : null,
            JellyfinUserId = userId,
            MaskedEmail = status == "verified" ? null : maskedEmail,
            ProfileStatus = profile is null ? "missing" : "present"
        };
    }

    private static (string Status, string? MaskedEmail) GetAdminEmailState(
        PtvProfileRecord? profile,
        PtvEmailVerificationRecord? pending,
        DateTimeOffset now)
    {
        if (pending is not null && IsUnconsumed(pending))
        {
            var status = pending.ExpiresAtUtc <= now ? "expired" : pending.DeliveryStatus == "failed" ? "failed" : "pending";
            return (status, MaskEmail(pending.PendingEmail));
        }

        if (profile?.EmailVerified == true) return ("verified", MaskEmail(profile.Email));
        if (!string.IsNullOrWhiteSpace(profile?.RecoveryEmail)) return ("reverification_required", MaskEmail(profile.RecoveryEmail));
        return ("missing", null);
    }

    private bool IsSendRateLimited(PtvAccountDocument document, string userId, DateTimeOffset now, out string message)
    {
        var latest = document.EmailRateLimits
            .Where(item => item.Action == "verification-send" && item.JellyfinUserId == userId)
            .OrderByDescending(item => item.CreatedAtUtc)
            .FirstOrDefault();
        if (latest is not null && now - latest.CreatedAtUtc < TimeSpan.FromSeconds(ResendCooldownSeconds))
        {
            message = "Wait a minute before sending another verification email.";
            return true;
        }

        var recent = document.EmailRateLimits.Where(item => item.Action == "verification-send" && item.JellyfinUserId == userId).ToList();
        if (recent.Count(item => item.CreatedAtUtc > now.AddHours(-1)) >= HourlySendLimit
            || recent.Count(item => item.CreatedAtUtc > now.AddDays(-1)) >= DailySendLimit)
        {
            message = "Too many verification emails have been requested. Please try again later.";
            return true;
        }

        message = string.Empty;
        return false;
    }

    private IReadOnlyList<PtvJellyfinUser> GetJellyfinUsers() => _userProvider.GetUsers();

    private static bool EmailBelongsToAnotherProfile(PtvAccountDocument document, string normalizedEmail, string userId) =>
        document.Profiles.Any(profile => profile.EmailVerified
            && !string.Equals(profile.JellyfinUserId, userId, StringComparison.OrdinalIgnoreCase)
            && string.Equals(profile.EmailNormalized, normalizedEmail, StringComparison.OrdinalIgnoreCase));

    private static PtvEmailVerificationRecord? GetLatestPending(PtvAccountDocument document, string userId, bool includeExpired)
    {
        var now = DateTimeOffset.UtcNow;
        return document.EmailVerifications
            .Where(item => string.Equals(item.JellyfinUserId, userId, StringComparison.OrdinalIgnoreCase)
                && IsUnconsumed(item)
                && (includeExpired || item.ExpiresAtUtc > now))
            .OrderByDescending(item => item.CreatedAtUtc)
            .FirstOrDefault();
    }

    private static bool IsUnconsumed(PtvEmailVerificationRecord record) =>
        record.ConsumedAtUtc is null && record.CancelledAtUtc is null && record.SupersededAtUtc is null;

    private static bool IsActive(PtvEmailVerificationRecord record, DateTimeOffset now) =>
        IsUnconsumed(record) && record.ExpiresAtUtc > now && !string.Equals(record.DeliveryStatus, "reverification_required", StringComparison.Ordinal);

    private static void Audit(PtvAccountDocument document, string eventName, string? userId, string result)
    {
        document.AuditEvents.Add(new PtvAccountAuditEvent
        {
            CreatedAtUtc = DateTimeOffset.UtcNow,
            Event = eventName,
            JellyfinUserId = userId,
            Result = result
        });
    }

    private static bool TryNormalizeEmail(string? value, out string display, out string normalized)
    {
        display = value?.Trim() ?? string.Empty;
        normalized = string.Empty;
        if (display.Length is < 3 or > 254 || !EmailRegex.IsMatch(display)) return false;
        try
        {
            var address = new MailAddress(display);
            if (!string.Equals(address.Address, display, StringComparison.OrdinalIgnoreCase)) return false;
        }
        catch (FormatException)
        {
            return false;
        }

        var at = display.LastIndexOf('@');
        if (at <= 0 || at >= display.Length - 1) return false;
        var local = display[..at];
        var domain = display[(at + 1)..].ToLowerInvariant();
        normalized = $"{local.ToLowerInvariant()}@{domain}";
        return true;
    }

    private static string NormalizeEmailOrEmpty(string? email) =>
        TryNormalizeEmail(email, out _, out var normalized) ? normalized : string.Empty;

    private static string CreateVerificationToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    private static string HashRateLimitKey(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"profile-verify:{value.Trim().ToLowerInvariant()}"))).ToLowerInvariant();

    private static bool TokenMatches(string hash, byte[] candidateBytes)
    {
        if (hash.Length != 64) return false;
        try
        {
            return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(hash), candidateBytes);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static bool TryCleanToken(string? value, out string token)
    {
        token = value?.Trim() ?? string.Empty;
        return token.Length is >= 40 and <= 200 && token.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_');
    }

    private static string BuildVerificationUrl(string publicBaseUrl, string token) =>
        $"{publicBaseUrl.TrimEnd('/')}/web/#/settings/profile?verify={Uri.EscapeDataString(token)}";

    private static string CleanUsername(string? value)
    {
        var clean = value?.Trim() ?? string.Empty;
        return clean[..Math.Min(clean.Length, 80)];
    }

    private static string? MaskEmail(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var at = value.LastIndexOf('@');
        if (at <= 0) return "[redacted]";
        return $"{value[0]}***{value[at..]}";
    }

    private static PtvAccountMigrationState CopyMigration(PtvAccountMigrationState source) => new()
    {
        AmbiguousRecordsSkipped = source.AmbiguousRecordsSkipped,
        CompletedAtUtc = source.CompletedAtUtc,
        ExistingProfiles = source.ExistingProfiles,
        JellyfinUsersDiscovered = source.JellyfinUsersDiscovered,
        OrphanedRecordsFound = source.OrphanedRecordsFound,
        UnverifiedEmailsRecovered = source.UnverifiedEmailsRecovered,
        UsersStillMissingEmail = source.UsersStillMissingEmail,
        VerifiedEmailsRecovered = source.VerifiedEmailsRecovered,
        Version = source.Version
    };

    private static PtvAccountOperationResponse Success(string message, PtvAccountProfileResponse? profile = null) => new()
    {
        Code = "OK",
        Message = message,
        Ok = true,
        Profile = profile
    };

    private static PtvAccountOperationResponse Failure(string code, string message, PtvAccountProfileResponse? profile = null) => new()
    {
        Code = code,
        Message = message,
        Ok = false,
        Profile = profile
    };

    private sealed record PendingDispatch(
        string VerificationId,
        string JellyfinUserId,
        string Username,
        string Email,
        string RawToken,
        bool KeepsExistingEmail);

    private sealed record VerificationCommitResult(PtvAccountOperationResponse Response, string? JellyfinUserId);
}
