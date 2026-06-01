using System.Globalization;
using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Users;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Native PiggieTV signup service backed by Jellyfin local users.
/// </summary>
public sealed class PtvSignupService : IPtvSignupService
{
    private const string ExpiredVerificationMessage = "This verification link has expired. Please sign up again.";
    private const string ResetSuccessMessage = "If that email belongs to a PiggieTV account, a reset code has been sent.";
    private const string TooManyAttemptsMessage = "Too many attempts. Please wait a few minutes and try again.";
    private static readonly Regex UsernameRegex = new("^[A-Za-z0-9._-]{3,32}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex EmailRegex = new("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ILogger<PtvSignupService> _logger;
    private readonly IDataProtector _passwordProtector;
    private readonly IUserManager _userManager;

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvSignupService"/> class.
    /// </summary>
    /// <param name="logger">Logger.</param>
    /// <param name="userManager">Jellyfin user manager.</param>
    /// <param name="dataProtectionProvider">Data protection provider.</param>
    public PtvSignupService(
        ILogger<PtvSignupService> logger,
        IUserManager userManager,
        IDataProtectionProvider dataProtectionProvider)
    {
        _logger = logger;
        _passwordProtector = dataProtectionProvider.CreateProtector("PiggieTV.Signup.PendingPassword.v1");
        _userManager = userManager;
    }

    /// <inheritdoc />
    public async Task<PtvSignupInviteValidationResponse> ValidateInviteAsync(
        string? inviteCode,
        string remoteAddress,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            var configuration = GetConfiguration();

            if (string.IsNullOrWhiteSpace(inviteCode))
            {
                return new PtvSignupInviteValidationResponse
                {
                    EmailRequired = true,
                    Message = configuration.SignupSettings.Enabled
                        ? "Invite codes are no longer required. Email is required for signup."
                        : "PiggieTV signup is not enabled.",
                    Ok = configuration.SignupSettings.Enabled,
                    PolicyPresetName = FindPreset(configuration.SignupSettings, configuration.SignupSettings.DefaultPolicyPresetId).Name,
                    Valid = configuration.SignupSettings.Enabled
                };
            }

            var invite = FindInvite(configuration.SignupSettings, inviteCode);
            var validation = ValidateInvite(configuration.SignupSettings, invite);

            if (!validation.Valid)
            {
                RegisterFailedAttempt(configuration, invite, remoteAddress);
                SaveConfiguration(configuration);
                return validation;
            }

            invite!.FailedAttempts = 0;
            invite.LockedUntilUtc = null;
            SaveConfiguration(configuration);

            return validation;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<PtvSignupResponse> CreateUserAsync(
        PtvSignupCreateUserRequest request,
        string remoteAddress,
        CancellationToken cancellationToken)
    {
        SignupEmailSettings emailSettings;
        SignupPendingVerification pending;
        string verificationToken;
        string verificationLink;

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            var configuration = GetConfiguration();
            var signup = configuration.SignupSettings;
            CleanupSignupState(signup);

            if (!signup.Enabled)
            {
                return Fail("PiggieTV signup is not enabled.");
            }

            if (!IsEmailConfigured(signup.EmailSettings))
            {
                return Fail("Email verification is not configured yet.");
            }

            var username = CleanUsername(request.Username);
            var email = CleanEmail(request.Email);
            var passwordError = ValidatePassword(request.Password, request.ConfirmPassword);
            var verificationBaseUrl = CleanVerificationBaseUrl(request.VerificationBaseUrl);

            if (IsRateLimited(signup, "signup-create", remoteAddress, email ?? username, 8, 15, 15))
            {
                SaveConfiguration(configuration);
                return Fail(TooManyAttemptsMessage);
            }

            if (username is null)
            {
                return Fail("Use 3-32 letters, numbers, dots, dashes, or underscores for the username.");
            }

            if (email is null)
            {
                return Fail("A valid email address is required.");
            }

            if (passwordError is not null)
            {
                return Fail(passwordError);
            }

            if (_userManager.GetUserByName(username) is not null)
            {
                return Fail("That username is already taken.");
            }

            if (EmailExists(signup, email))
            {
                return Fail("That email is already registered.");
            }

            if (PendingSignupExists(signup, username, email))
            {
                signup.PendingVerifications.RemoveAll(candidate =>
                    string.Equals(candidate.Username, username, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(candidate.Email, email, StringComparison.OrdinalIgnoreCase));
            }

            var preset = FindPreset(signup, signup.DefaultPolicyPresetId);
            verificationToken = CreateVerificationToken();
            pending = new SignupPendingVerification
            {
                CreatedAtUtc = DateTimeOffset.UtcNow,
                Email = email,
                EnabledFolderIds = signup.DefaultEnabledFolderIds.ToList(),
                ExpiresAtUtc = DateTimeOffset.UtcNow.AddMinutes(signup.EmailSettings.VerificationLinkMinutes),
                Id = Guid.NewGuid().ToString("N"),
                ProtectedPassword = _passwordProtector.Protect(request.Password!),
                PolicyPresetId = preset.Id,
                RemoteAddress = remoteAddress,
                TokenHash = HashVerificationToken(verificationToken),
                Username = username
            };
            signup.PendingVerifications.Add(pending);

            emailSettings = CloneEmailSettings(signup.EmailSettings);
            SaveConfiguration(configuration);
            verificationLink = BuildVerificationLink(verificationBaseUrl, verificationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV signup failed. Remote={RemoteAddress}.", remoteAddress);
            return Fail("Signup failed. Please check the details and try again.");
        }
        finally
        {
            _gate.Release();
        }

        try
        {
            await SendVerificationEmailAsync(emailSettings, pending, verificationLink, cancellationToken).ConfigureAwait(false);

            _logger.LogInformation(
                "PiggieTV signup pending email verification. Username={Username}; Email={Email}; PendingId={PendingId}; Remote={RemoteAddress}.",
                pending.Username,
                RedactEmail(pending.Email),
                pending.Id,
                remoteAddress);

            return new PtvSignupResponse
            {
                Ok = true,
                Message = "Check your email to verify your address and finish creating your PiggieTV account.",
                Username = pending.Username
            };
        }
        catch (Exception ex)
        {
            await RemovePendingVerificationAsync(pending.Id, cancellationToken).ConfigureAwait(false);
            _logger.LogError(ex, "PiggieTV signup verification email failed. Email={Email}.", RedactEmail(pending.Email));
            return Fail("Verification email could not be sent. Please try again later.");
        }
    }

    /// <inheritdoc />
    public async Task<PtvSignupResponse> VerifyEmailAsync(
        PtvSignupEmailVerificationRequest request,
        string remoteAddress,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            var token = CleanVerificationToken(request.Token);

            if (token is null)
            {
                return Fail("Verification link is invalid.");
            }

            var configuration = GetConfiguration();
            var signup = configuration.SignupSettings;
            CleanupPendingVerifications(signup);

            var tokenHash = HashVerificationToken(token);
            if (IsRateLimited(signup, "verify-email", remoteAddress, tokenHash, 20, 15, 15))
            {
                SaveConfiguration(configuration);
                return Fail(TooManyAttemptsMessage);
            }

            var pending = signup.PendingVerifications.FirstOrDefault(candidate =>
                string.Equals(candidate.TokenHash, tokenHash, StringComparison.OrdinalIgnoreCase));

            if (pending is null)
            {
                SaveConfiguration(configuration);
                return Fail(ExpiredVerificationMessage);
            }

            if (_userManager.GetUserByName(pending.Username) is not null)
            {
                signup.PendingVerifications.Remove(pending);
                SaveConfiguration(configuration);
                return Fail("That username is already taken.");
            }

            if (EmailExists(signup, pending.Email))
            {
                signup.PendingVerifications.Remove(pending);
                SaveConfiguration(configuration);
                return Fail("That email is already registered.");
            }

            string password;

            try
            {
                password = _passwordProtector.Unprotect(pending.ProtectedPassword);
            }
            catch (Exception ex)
            {
                signup.PendingVerifications.Remove(pending);
                SaveConfiguration(configuration);
                _logger.LogError(ex, "PiggieTV pending signup password could not be unprotected. PendingId={PendingId}.", pending.Id);
                return Fail("Verification could not be completed. Please sign up again.");
            }

            var preset = FindPreset(signup, pending.PolicyPresetId);
            var createdUser = await _userManager.CreateUserAsync(pending.Username).ConfigureAwait(false);

            try
            {
                await _userManager.ChangePassword(createdUser, password).ConfigureAwait(false);
                await ApplyPolicyAsync(createdUser.Id, new UserPolicy(), preset, pending.EnabledFolderIds, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch
            {
                await _userManager.DeleteUserAsync(createdUser.Id).ConfigureAwait(false);
                throw;
            }

            signup.PendingVerifications.Remove(pending);
            signup.Users.Add(new SignupUserRecord
            {
                CreatedAtUtc = DateTimeOffset.UtcNow,
                Email = pending.Email,
                PolicyPresetId = preset.Id,
                RemoteAddress = remoteAddress,
                UserId = createdUser.Id.ToString("N"),
                Username = pending.Username
            });

            SaveConfiguration(configuration);

            _logger.LogInformation(
                "PiggieTV email verified and Jellyfin user created. Username={Username}; Email={Email}; PendingId={PendingId}; Remote={RemoteAddress}.",
                pending.Username,
                RedactEmail(pending.Email),
                pending.Id,
                remoteAddress);

            return new PtvSignupResponse
            {
                Ok = true,
                Message = "Email verified. Your PiggieTV account is ready and you can sign in now.",
                UserId = createdUser.Id.ToString("N"),
                Username = pending.Username
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV email verification failed. Remote={RemoteAddress}.", remoteAddress);
            return Fail("Email verification failed. Please try the link again or sign up again.");
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<PtvSignupResponse> RequestPasswordResetAsync(
        PtvSignupPasswordResetRequest request,
        string remoteAddress,
        CancellationToken cancellationToken)
    {
        SignupEmailSettings emailSettings;
        SignupUserRecord? userRecord;
        string resetCode;

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            var configuration = GetConfiguration();
            var signup = configuration.SignupSettings;
            var email = CleanEmail(request.Email);
            CleanupSignupState(signup);

            if (email is null)
            {
                return Fail("Enter a valid email address.");
            }

            if (IsRateLimited(signup, "password-reset-request", remoteAddress, email, 6, 15, 30))
            {
                SaveConfiguration(configuration);
                return new PtvSignupResponse { Ok = true, Message = ResetSuccessMessage };
            }

            if (!IsEmailConfigured(signup.EmailSettings))
            {
                return Fail("Password reset email is not configured yet.");
            }

            userRecord = FindUserByEmail(signup, email);

            if (userRecord is null)
            {
                _logger.LogWarning("PiggieTV password reset requested for unknown email. Email={Email}; Remote={RemoteAddress}.", RedactEmail(email), remoteAddress);
                SaveConfiguration(configuration);
                return new PtvSignupResponse { Ok = true, Message = ResetSuccessMessage };
            }

            resetCode = CreateResetCode();
            signup.PasswordResetCodes.Add(new SignupPasswordResetCode
            {
                CodeHash = HashResetCode(email, resetCode),
                CreatedAtUtc = DateTimeOffset.UtcNow,
                Email = email,
                ExpiresAtUtc = DateTimeOffset.UtcNow.AddMinutes(signup.EmailSettings.ResetCodeMinutes),
                RemoteAddress = remoteAddress,
                Username = userRecord.Username
            });

            emailSettings = CloneEmailSettings(signup.EmailSettings);
            SaveConfiguration(configuration);
        }
        finally
        {
            _gate.Release();
        }

        try
        {
            await SendResetEmailAsync(emailSettings, userRecord!, resetCode, cancellationToken).ConfigureAwait(false);
            return new PtvSignupResponse { Ok = true, Message = ResetSuccessMessage };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV password reset email failed. Email={Email}.", RedactEmail(userRecord!.Email));
            return Fail("Password reset email could not be sent. Please try again later.");
        }
    }

    /// <inheritdoc />
    public async Task<PtvSignupResponse> ConfirmPasswordResetAsync(
        PtvSignupPasswordResetConfirmRequest request,
        string remoteAddress,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            var configuration = GetConfiguration();
            var signup = configuration.SignupSettings;
            var email = CleanEmail(request.Email);
            var code = CleanResetCode(request.Code);
            var passwordError = ValidatePassword(request.Password, request.ConfirmPassword);
            CleanupSignupState(signup);

            if (email is null)
            {
                return Fail("Enter a valid email address.");
            }

            if (code is null)
            {
                return Fail("Enter the reset code from your email.");
            }

            if (passwordError is not null)
            {
                return Fail(passwordError);
            }

            if (IsRateLimited(signup, "password-reset-confirm", remoteAddress, email, 10, 15, 30))
            {
                SaveConfiguration(configuration);
                return Fail(TooManyAttemptsMessage);
            }

            var codeHash = HashResetCode(email, code);
            var reset = signup.PasswordResetCodes
                .Where(candidate => candidate.UsedAtUtc is null)
                .OrderByDescending(candidate => candidate.CreatedAtUtc)
                .FirstOrDefault(candidate =>
                    string.Equals(candidate.Email, email, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(candidate.CodeHash, codeHash, StringComparison.OrdinalIgnoreCase));

            if (reset is null || reset.ExpiresAtUtc <= DateTimeOffset.UtcNow)
            {
                RegisterResetFailure(signup, email, remoteAddress);
                SaveConfiguration(configuration);
                return Fail("Reset code is invalid or expired.");
            }

            if (reset.FailedAttempts >= signup.FailedAttemptLimit)
            {
                return Fail("Too many reset attempts. Request a new reset code.");
            }

            var userRecord = FindUserByEmail(signup, email);
            var user = userRecord is null ? _userManager.GetUserByName(reset.Username) : FindJellyfinUser(userRecord);

            if (user is null)
            {
                reset.FailedAttempts++;
                SaveConfiguration(configuration);
                return Fail("The account for this reset code was not found.");
            }

            await _userManager.ChangePassword(user, request.Password!).ConfigureAwait(false);
            signup.PasswordResetCodes.Remove(reset);
            SaveConfiguration(configuration);

            _logger.LogInformation(
                "PiggieTV password reset completed. Username={Username}; Email={Email}; Remote={RemoteAddress}.",
                reset.Username,
                RedactEmail(email),
                remoteAddress);

            return new PtvSignupResponse { Ok = true, Message = "Password reset. You can sign in with the new password." };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV password reset confirmation failed. Remote={RemoteAddress}.", remoteAddress);
            return Fail("Password reset failed. Please request a new code and try again.");
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public PtvSignupAdminSettingsResponse GetAdminSettings()
    {
        _gate.Wait();

        try
        {
            var configuration = GetConfiguration();
            if (CleanupSignupState(configuration.SignupSettings) > 0)
            {
                SaveConfiguration(configuration);
            }

            return CreateAdminSettingsResponse(configuration.SignupSettings);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public PtvSignupAdminSettingsResponse SaveAdminSettings(PtvSignupAdminSettingsPatch request)
    {
        _gate.Wait();

        try
        {
            var configuration = GetConfiguration();
            var signup = configuration.SignupSettings;
            CleanupSignupState(signup);

            if (request.Enabled is not null)
            {
                signup.Enabled = request.Enabled.Value;
            }

            if (!string.IsNullOrWhiteSpace(request.DefaultPolicyPresetId))
            {
                signup.DefaultPolicyPresetId = CleanIdentifier(request.DefaultPolicyPresetId, "standard");
            }

            if (request.DefaultEnabledFolderIds is not null)
            {
                signup.DefaultEnabledFolderIds = CleanStringList(request.DefaultEnabledFolderIds, 120);
            }

            if (request.EmailSettings is not null)
            {
                ApplyEmailSettingsPatch(signup.EmailSettings, request.EmailSettings);
            }

            if (request.Users is not null)
            {
                ApplyUserEmailMappings(signup, request.Users);
            }

            SaveConfiguration(configuration);

            return CreateAdminSettingsResponse(configuration.SignupSettings);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<PtvSignupResponse> SendTestEmailAsync(PtvSignupTestEmailRequest request, CancellationToken cancellationToken)
    {
        SignupEmailSettings settings;
        string recipient;

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            var signup = GetConfiguration().SignupSettings;

            if (!IsEmailConfigured(signup.EmailSettings))
            {
                return Fail("Email is not configured yet.");
            }

            if (!string.IsNullOrWhiteSpace(request.Recipient) && CleanEmail(request.Recipient) is null)
            {
                return Fail("Enter a valid test recipient email address.");
            }

            recipient = CleanEmail(request.Recipient) ?? signup.EmailSettings.FromAddress;
            settings = CloneEmailSettings(signup.EmailSettings);
        }
        finally
        {
            _gate.Release();
        }

        try
        {
            await SendEmailAsync(
                settings,
                recipient,
                "PiggieTV test email",
                "PiggieTV email delivery is configured and working.",
                cancellationToken).ConfigureAwait(false);

            return new PtvSignupResponse { Ok = true, Message = "Test email sent." };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV test email failed. Recipient={Recipient}.", RedactEmail(recipient));
            return Fail($"SMTP test failed: {ex.Message}");
        }
    }

    /// <inheritdoc />
    public PtvSignupInviteListResponse GetAdminInvites()
    {
        var configuration = GetConfiguration();
        var signup = configuration.SignupSettings;

        return new PtvSignupInviteListResponse
        {
            Enabled = signup.Enabled,
            Invites = signup.Invites
                .OrderByDescending(invite => invite.CreatedAtUtc)
                .Select(invite => PtvSignupInviteDto.FromInvite(invite))
                .ToList(),
            PolicyPresets = signup.PolicyPresets
                .Select(PtvSignupPolicyPresetDto.FromPreset)
                .ToList()
        };
    }

    /// <inheritdoc />
    public PtvSignupInviteDto CreateInvite(PtvSignupCreateInviteRequest request, string createdBy)
    {
        _gate.Wait();

        try
        {
            var configuration = GetConfiguration();
            var signup = configuration.SignupSettings;
            var code = CreateInviteCode();
            var label = CleanText(request.Label, "PiggieTV Invite", 80);
            var presetId = CleanIdentifier(request.PolicyPresetId, "standard");

            if (FindPreset(signup, presetId) is null)
            {
                presetId = "standard";
            }

            var invite = new SignupInvite
            {
                CodeHash = HashInviteCode(code),
                CodePreview = code.Length <= 6 ? code : code[^6..],
                CreatedAtUtc = DateTimeOffset.UtcNow,
                EmailRequired = request.EmailRequired ?? true,
                EnabledFolderIds = CleanStringList(request.EnabledFolderIds, 120),
                ExpiresAtUtc = request.ExpiresAtUtc,
                Id = CleanIdentifier($"{label}-{Guid.NewGuid():N}", "invite"),
                Label = label,
                MaxUses = Math.Max(0, request.MaxUses ?? 1),
                PolicyPresetId = presetId
            };

            signup.Invites.Add(invite);
            SaveConfiguration(configuration);

            _logger.LogInformation(
                "PiggieTV signup invite created. InviteId={InviteId}; Label={Label}; CreatedBy={CreatedBy}; Preset={PresetId}.",
                invite.Id,
                invite.Label,
                createdBy,
                invite.PolicyPresetId);

            return PtvSignupInviteDto.FromInvite(invite, code);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public PtvSignupInviteDto DisableInvite(string inviteId)
    {
        _gate.Wait();

        try
        {
            var configuration = GetConfiguration();
            var invite = GetInviteById(configuration.SignupSettings, inviteId);

            invite.Disabled = true;
            SaveConfiguration(configuration);

            return PtvSignupInviteDto.FromInvite(invite);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public void DeleteInvite(string inviteId)
    {
        _gate.Wait();

        try
        {
            var configuration = GetConfiguration();
            var invite = GetInviteById(configuration.SignupSettings, inviteId);

            configuration.SignupSettings.Invites.Remove(invite);
            SaveConfiguration(configuration);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task ApplyPolicyAsync(
        Guid userId,
        UserPolicy policy,
        SignupPolicyPreset preset,
        IReadOnlyCollection<string> folderOverride,
        CancellationToken cancellationToken)
    {
        policy.IsAdministrator = false;
        policy.IsDisabled = false;
        policy.IsHidden = false;
        policy.EnableCollectionManagement = false;
        policy.EnableSubtitleManagement = false;
        policy.EnableLyricManagement = false;
        policy.EnableUserPreferenceAccess = true;
        policy.EnableRemoteControlOfOtherUsers = preset.AllowRemoteControl;
        policy.EnableSharedDeviceControl = preset.AllowRemoteControl;
        policy.EnableLiveTvManagement = false;
        policy.EnableLiveTvAccess = preset.AllowLiveTv;
        policy.EnableMediaPlayback = true;
        policy.EnableContentDeletion = false;
        policy.EnableContentDeletionFromFolders = [];
        policy.EnableContentDownloading = preset.AllowDownloads;
        policy.EnableMediaConversion = false;
        policy.EnablePublicSharing = false;
        policy.EnableSyncTranscoding = preset.AllowTranscoding;
        policy.EnableAudioPlaybackTranscoding = preset.AllowTranscoding;
        policy.EnableVideoPlaybackTranscoding = preset.AllowTranscoding;
        policy.EnablePlaybackRemuxing = preset.AllowTranscoding;
        policy.ForceRemoteSourceTranscoding = false;
        policy.EnableAllDevices = true;
        policy.EnabledDevices = [];
        policy.EnableAllChannels = true;
        policy.EnabledChannels = [];
        policy.BlockedChannels = null;
        policy.BlockedMediaFolders = null;
        policy.RemoteClientBitrateLimit = preset.RemoteClientBitrateLimit;
        policy.MaxActiveSessions = preset.MaxActiveSessions;
        policy.MaxParentalRating = preset.MaxParentalRating;

        var effectiveFolderOverride = folderOverride.Count > 0 ? folderOverride : preset.EnabledFolderIds;
        var enabledFolderIds = CleanGuidArray(effectiveFolderOverride);

        policy.EnableAllFolders = preset.EnableAllFolders && effectiveFolderOverride.Count == 0;
        policy.EnabledFolders = policy.EnableAllFolders ? [] : enabledFolderIds;

        await _userManager.UpdatePolicyAsync(userId, policy).WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    private PtvSignupInviteValidationResponse ValidateInvite(SignupSettings signup, SignupInvite? invite)
    {
        if (!signup.Enabled)
        {
            return Invalid("PiggieTV signup is not enabled.");
        }

        if (invite is null)
        {
            return Invalid("Invite code was not found.");
        }

        var now = DateTimeOffset.UtcNow;

        if (invite.Disabled)
        {
            return Invalid("This invite has been disabled.");
        }

        if (invite.LockedUntilUtc is not null && invite.LockedUntilUtc > now)
        {
            return Invalid("This invite is temporarily locked. Try again later.");
        }

        if (invite.ExpiresAtUtc is not null && invite.ExpiresAtUtc <= now)
        {
            return Invalid("This invite has expired.");
        }

        if (invite.MaxUses > 0 && invite.UsageRecords.Count >= invite.MaxUses)
        {
            return Invalid("This invite has already been used.");
        }

        var preset = FindPreset(signup, invite.PolicyPresetId);

        return new PtvSignupInviteValidationResponse
        {
            EmailRequired = true,
            Label = invite.Label,
            Message = "Invite code accepted.",
            Ok = true,
            PolicyPresetName = preset.Name,
            Valid = true
        };
    }

    private PtvSignupAdminSettingsResponse CreateAdminSettingsResponse(SignupSettings signup)
    {
        var mappedUsers = signup.Users
            .Where(user => !string.IsNullOrWhiteSpace(user.UserId) || !string.IsNullOrWhiteSpace(user.Username))
            .GroupBy(user => !string.IsNullOrWhiteSpace(user.UserId) ? $"id:{user.UserId}" : $"name:{user.Username}", StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.OrderByDescending(user => user.CreatedAtUtc).First(), StringComparer.OrdinalIgnoreCase);
        var jellyfinUsers = _userManager.Users
            .OrderBy(user => user.Username, StringComparer.OrdinalIgnoreCase)
            .Take(1000)
            .Select(user =>
            {
                var userId = user.Id.ToString("N");
                mappedUsers.TryGetValue($"id:{userId}", out var mappedUser);
                mappedUser ??= mappedUsers.TryGetValue($"name:{user.Username}", out var nameMappedUser) ? nameMappedUser : null;

                return new PtvSignupUserDto
                {
                    CreatedAtUtc = mappedUser?.CreatedAtUtc ?? DateTimeOffset.MinValue,
                    Email = mappedUser?.Email ?? string.Empty,
                    EmailConfigured = !string.IsNullOrWhiteSpace(mappedUser?.Email),
                    PolicyPresetId = mappedUser?.PolicyPresetId ?? signup.DefaultPolicyPresetId,
                    Source = mappedUser is null ? "jellyfin" : "ptv",
                    UserId = userId,
                    Username = user.Username
                };
            })
            .ToList();

        return new PtvSignupAdminSettingsResponse
        {
            DefaultEnabledFolderIds = signup.DefaultEnabledFolderIds.ToList(),
            DefaultPolicyPresetId = signup.DefaultPolicyPresetId,
            EmailSettings = PtvSignupEmailSettingsDto.FromSettings(signup.EmailSettings),
            Enabled = signup.Enabled,
            PendingVerificationCount = signup.PendingVerifications.Count(pending => pending.ExpiresAtUtc > DateTimeOffset.UtcNow),
            PendingResetCount = signup.PasswordResetCodes.Count(code => code.UsedAtUtc is null && code.ExpiresAtUtc > DateTimeOffset.UtcNow),
            PolicyPresets = signup.PolicyPresets.Select(PtvSignupPolicyPresetDto.FromPreset).ToList(),
            Users = jellyfinUsers
        };
    }

    private void ApplyUserEmailMappings(SignupSettings signup, IReadOnlyCollection<PtvSignupUserEmailPatch> userMappings)
    {
        var seenEmails = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var jellyfinUsersById = _userManager.Users
            .ToDictionary(user => user.Id.ToString("N"), StringComparer.OrdinalIgnoreCase);

        foreach (var mapping in userMappings.Where(mapping => mapping is not null))
        {
            var userId = CleanText(mapping.UserId, string.Empty, 64);
            if (string.IsNullOrWhiteSpace(userId) || !jellyfinUsersById.TryGetValue(userId, out var jellyfinUser))
            {
                continue;
            }

            var requestedEmail = mapping.Email?.Trim();
            var email = CleanEmail(requestedEmail);
            var existing = signup.Users.FirstOrDefault(user =>
                string.Equals(user.UserId, userId, StringComparison.OrdinalIgnoreCase)
                || string.Equals(user.Username, jellyfinUser.Username, StringComparison.OrdinalIgnoreCase));

            if (string.IsNullOrWhiteSpace(requestedEmail))
            {
                if (existing is not null)
                {
                    signup.Users.Remove(existing);
                }

                continue;
            }

            if (email is null)
            {
                continue;
            }

            if (!seenEmails.Add(email))
            {
                continue;
            }

            var duplicate = signup.Users.FirstOrDefault(user =>
                !ReferenceEquals(user, existing) &&
                !string.Equals(user.UserId, userId, StringComparison.OrdinalIgnoreCase)
                && string.Equals(user.Email, email, StringComparison.OrdinalIgnoreCase));

            if (duplicate is not null)
            {
                continue;
            }

            if (existing is null)
            {
                signup.Users.Add(new SignupUserRecord
                {
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                    Email = email,
                    PolicyPresetId = signup.DefaultPolicyPresetId,
                    RemoteAddress = "admin-mapped",
                    UserId = userId,
                    Username = jellyfinUser.Username
                });
                continue;
            }

            existing.Email = email;
            existing.UserId = userId;
            existing.Username = jellyfinUser.Username;
        }
    }

    private void RegisterFailedAttempt(PluginConfiguration configuration, SignupInvite? invite, string remoteAddress)
    {
        if (invite is null)
        {
            _logger.LogWarning("PiggieTV signup failed with unknown invite. Remote={RemoteAddress}.", remoteAddress);
            return;
        }

        invite.FailedAttempts++;

        if (invite.FailedAttempts >= configuration.SignupSettings.FailedAttemptLimit)
        {
            invite.LockedUntilUtc = DateTimeOffset.UtcNow.AddMinutes(configuration.SignupSettings.LockoutMinutes);
        }

        _logger.LogWarning(
            "PiggieTV signup invite validation failed. InviteId={InviteId}; FailedAttempts={FailedAttempts}; Remote={RemoteAddress}.",
            invite.Id,
            invite.FailedAttempts,
            remoteAddress);
    }

    private void RegisterResetFailure(SignupSettings signup, string email, string remoteAddress)
    {
        foreach (var reset in signup.PasswordResetCodes.Where(reset =>
            reset.UsedAtUtc is null && string.Equals(reset.Email, email, StringComparison.OrdinalIgnoreCase)))
        {
            reset.FailedAttempts++;
        }

        _logger.LogWarning(
            "PiggieTV password reset confirmation failed. Email={Email}; Remote={RemoteAddress}.",
            RedactEmail(email),
            remoteAddress);
    }

    private static bool IsRateLimited(
        SignupSettings signup,
        string action,
        string remoteAddress,
        string? secondaryKey,
        int maxAttempts,
        int windowMinutes,
        int lockoutMinutes)
    {
        var limitedByIp = RegisterRateLimitAttempt(
            signup,
            action,
            $"ip:{remoteAddress}",
            maxAttempts,
            windowMinutes,
            lockoutMinutes);

        if (string.IsNullOrWhiteSpace(secondaryKey))
        {
            return limitedByIp;
        }

        var limitedBySecondary = RegisterRateLimitAttempt(
            signup,
            action,
            $"value:{secondaryKey.Trim().ToLowerInvariant()}",
            maxAttempts,
            windowMinutes,
            lockoutMinutes);

        return limitedByIp || limitedBySecondary;
    }

    private static bool RegisterRateLimitAttempt(
        SignupSettings signup,
        string action,
        string key,
        int maxAttempts,
        int windowMinutes,
        int lockoutMinutes)
    {
        var now = DateTimeOffset.UtcNow;
        var actionId = CleanIdentifier(action, "signup");
        var keyHash = HashRateLimitKey($"{actionId}|{key}");
        var record = signup.RateLimits.FirstOrDefault(candidate =>
            string.Equals(candidate.Action, actionId, StringComparison.OrdinalIgnoreCase)
            && string.Equals(candidate.KeyHash, keyHash, StringComparison.OrdinalIgnoreCase));

        if (record is null)
        {
            signup.RateLimits.Add(new SignupRateLimitRecord
            {
                Action = actionId,
                Count = 1,
                KeyHash = keyHash,
                WindowStartedAtUtc = now
            });

            return false;
        }

        if (record.LockedUntilUtc is not null && record.LockedUntilUtc > now)
        {
            return true;
        }

        if (record.WindowStartedAtUtc.AddMinutes(windowMinutes) <= now)
        {
            record.Count = 1;
            record.LockedUntilUtc = null;
            record.WindowStartedAtUtc = now;
            return false;
        }

        record.Count++;

        if (record.Count <= maxAttempts)
        {
            return false;
        }

        record.LockedUntilUtc = now.AddMinutes(lockoutMinutes);
        return true;
    }

    private SignupInvite? FindInvite(SignupSettings signup, string? inviteCode)
    {
        if (string.IsNullOrWhiteSpace(inviteCode))
        {
            return null;
        }

        var hash = HashInviteCode(inviteCode);

        return signup.Invites.FirstOrDefault(invite =>
            string.Equals(invite.CodeHash, hash, StringComparison.OrdinalIgnoreCase));
    }

    private static SignupInvite GetInviteById(SignupSettings signup, string inviteId)
    {
        var invite = signup.Invites.FirstOrDefault(candidate =>
            string.Equals(candidate.Id, inviteId, StringComparison.OrdinalIgnoreCase));

        return invite ?? throw new InvalidOperationException("Signup invite was not found.");
    }

    private static SignupPolicyPreset FindPreset(SignupSettings signup, string? presetId)
    {
        return signup.PolicyPresets.FirstOrDefault(preset =>
                string.Equals(preset.Id, presetId, StringComparison.OrdinalIgnoreCase))
            ?? signup.PolicyPresets.FirstOrDefault(preset => preset.Id == "standard")
            ?? SignupSettings.CreateDefaultPolicyPresets()[0];
    }

    private static SignupUserRecord? FindUserByEmail(SignupSettings signup, string email)
    {
        return signup.Users.FirstOrDefault(record =>
            string.Equals(record.Email, email, StringComparison.OrdinalIgnoreCase));
    }

    private User? FindJellyfinUser(SignupUserRecord record)
    {
        if (Guid.TryParse(record.UserId, out var userId))
        {
            var user = _userManager.GetUserById(userId);

            if (user is not null)
            {
                return user;
            }
        }

        return _userManager.GetUserByName(record.Username);
    }

    private static bool EmailExists(SignupSettings signup, string email)
    {
        return signup.Users.Any(record => string.Equals(record.Email, email, StringComparison.OrdinalIgnoreCase))
            || signup.Invites
                .SelectMany(invite => invite.UsageRecords)
                .Any(record => string.Equals(record.Email, email, StringComparison.OrdinalIgnoreCase));
    }

    private static bool PendingSignupExists(SignupSettings signup, string username, string email)
    {
        return signup.PendingVerifications.Any(record =>
            string.Equals(record.Username, username, StringComparison.OrdinalIgnoreCase)
            || string.Equals(record.Email, email, StringComparison.OrdinalIgnoreCase));
    }

    private static PluginConfiguration GetConfiguration()
    {
        var configuration = Plugin.Instance?.Configuration ?? new PluginConfiguration();

        PtvPluginSettingsNormalizer.Normalize(configuration);

        return configuration;
    }

    private static void SaveConfiguration(PluginConfiguration configuration)
    {
        if (Plugin.Instance is null)
        {
            throw new InvalidOperationException("PiggieTV plugin instance is unavailable.");
        }

        PtvPluginSettingsNormalizer.Normalize(configuration);
        Plugin.Instance.UpdateConfiguration(configuration);
    }

    private static void ApplyEmailSettingsPatch(SignupEmailSettings settings, PtvSignupEmailSettingsDto patch)
    {
        settings.Enabled = patch.Enabled;
        settings.FromAddress = CleanEmail(patch.FromAddress) ?? string.Empty;
        settings.FromName = CleanText(patch.FromName, "PiggieTV", 80);
        settings.LogoUrl = CleanEmailLogoUrl(patch.LogoUrl);
        settings.ResetCodeMinutes = Math.Clamp(patch.ResetCodeMinutes, 5, 120);
        settings.ResetSubject = CleanText(patch.ResetSubject, "Your PiggieTV password reset code", 120);
        settings.SmtpHost = CleanText(patch.SmtpHost, string.Empty, 160);
        settings.SmtpPort = Math.Clamp(patch.SmtpPort, 1, 65535);
        settings.UseSsl = patch.UseSsl;
        settings.VerificationLinkMinutes = Math.Clamp(patch.VerificationLinkMinutes, 10, 1440);
        settings.VerificationSubject = CleanText(patch.VerificationSubject, "Verify your PiggieTV email", 120);
        settings.Username = string.IsNullOrWhiteSpace(patch.Username) ? null : patch.Username.Trim();

        if (!string.IsNullOrWhiteSpace(patch.Password))
        {
            settings.Password = patch.Password.Trim();
        }
    }

    private static bool IsEmailConfigured(SignupEmailSettings settings)
    {
        return settings.Enabled
            && !string.IsNullOrWhiteSpace(settings.SmtpHost)
            && settings.SmtpPort > 0
            && !string.IsNullOrWhiteSpace(settings.FromAddress);
    }

    private static SignupEmailSettings CloneEmailSettings(SignupEmailSettings source) => new()
    {
        Enabled = source.Enabled,
        FromAddress = source.FromAddress,
        FromName = source.FromName,
        LogoUrl = source.LogoUrl,
        Password = source.Password,
        ResetCodeMinutes = source.ResetCodeMinutes,
        ResetSubject = source.ResetSubject,
        SmtpHost = source.SmtpHost,
        SmtpPort = source.SmtpPort,
        UseSsl = source.UseSsl,
        Username = source.Username,
        VerificationLinkMinutes = source.VerificationLinkMinutes,
        VerificationSubject = source.VerificationSubject
    };

    private static async Task SendVerificationEmailAsync(
        SignupEmailSettings settings,
        SignupPendingVerification pending,
        string verificationLink,
        CancellationToken cancellationToken)
    {
        var plainText = new StringBuilder()
            .AppendLine($"Hi {pending.Username},")
            .AppendLine()
            .AppendLine("Welcome to PiggieTV. Please verify your email to finish creating your account.")
            .AppendLine()
            .AppendLine(verificationLink)
            .AppendLine()
            .AppendLine($"This verification link expires after {settings.VerificationLinkMinutes} minutes.")
            .AppendLine("If you did not request this account, you can ignore this email.")
            .ToString();
        var html = BuildVerificationEmailHtml(settings, pending, verificationLink);

        await SendEmailAsync(settings, pending.Email, settings.VerificationSubject, plainText, cancellationToken, html).ConfigureAwait(false);
    }

    private static async Task SendResetEmailAsync(
        SignupEmailSettings settings,
        SignupUserRecord userRecord,
        string resetCode,
        CancellationToken cancellationToken)
    {
        var body = new StringBuilder()
            .AppendLine($"Hi {userRecord.Username},")
            .AppendLine()
            .AppendLine("Use this PiggieTV password reset code:")
            .AppendLine()
            .AppendLine(resetCode)
            .AppendLine()
            .AppendLine($"This code expires in {settings.ResetCodeMinutes} minutes.")
            .AppendLine("If you did not request this, you can ignore this email.")
            .ToString();

        await SendEmailAsync(settings, userRecord.Email, settings.ResetSubject, body, cancellationToken).ConfigureAwait(false);
    }

    private static string BuildVerificationEmailHtml(
        SignupEmailSettings settings,
        SignupPendingVerification pending,
        string verificationLink)
    {
        var logoUrl = ResolveEmailLogoUrl(settings.LogoUrl, verificationLink);
        var safeLogoUrl = WebUtility.HtmlEncode(logoUrl);
        var safeLink = WebUtility.HtmlEncode(verificationLink);
        var safeUsername = WebUtility.HtmlEncode(pending.Username);
        var expiryText = $"This verification link expires after {settings.VerificationLinkMinutes} minutes.";

        return $$"""
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Verify your PiggieTV email</title>
</head>
<body style="margin:0;background:#08050f;color:#f7f4ff;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#08050f;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:linear-gradient(145deg,#151126,#231036);border:1px solid #3a2a66;border-radius:22px;box-shadow:0 20px 70px rgba(36,16,76,.45);overflow:hidden;">
          <tr>
            <td align="center" style="padding:34px 28px 10px;">
              <img src="{{safeLogoUrl}}" alt="PiggieTV" width="220" style="display:block;max-width:220px;width:70%;height:auto;border:0;">
            </td>
          </tr>
          <tr>
            <td style="padding:16px 34px 4px;text-align:center;">
              <h1 style="margin:0 0 12px;font-size:30px;line-height:1.2;color:#ffffff;">Welcome, {{safeUsername}}</h1>
              <p style="margin:0;color:#ddd7f2;font-size:16px;line-height:1.6;">Welcome to PiggieTV. Please verify your email to finish creating your account.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:30px 34px 34px;">
              <a href="{{safeLink}}" style="display:inline-block;background:#20aee5;color:#05040a;text-decoration:none;font-weight:700;font-size:16px;line-height:1;padding:16px 30px;border-radius:999px;box-shadow:0 0 28px rgba(32,174,229,.42);">Verify Email</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 34px 30px;text-align:center;">
              <p style="margin:0;color:#bcb4d7;font-size:13px;line-height:1.5;">{{WebUtility.HtmlEncode(expiryText)}}</p>
              <p style="margin:12px 0 0;color:#827996;font-size:12px;line-height:1.5;">If you did not request this account, you can safely ignore this email.</p>
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

    private static async Task SendEmailAsync(
        SignupEmailSettings settings,
        string recipient,
        string subject,
        string body,
        CancellationToken cancellationToken,
        string? htmlBody = null)
    {
        using var message = new MailMessage
        {
            From = new MailAddress(settings.FromAddress, settings.FromName),
            Subject = subject,
            Body = body,
            IsBodyHtml = false
        };
        message.To.Add(recipient);

        if (!string.IsNullOrWhiteSpace(htmlBody))
        {
            message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(body, Encoding.UTF8, MediaTypeNames.Text.Plain));
            message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(htmlBody, Encoding.UTF8, MediaTypeNames.Text.Html));
        }

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

    /// <inheritdoc />
    public int CleanupExpiredRecords()
    {
        _gate.Wait();

        try
        {
            var configuration = GetConfiguration();
            var removed = CleanupSignupState(configuration.SignupSettings);

            if (removed > 0)
            {
                SaveConfiguration(configuration);
            }

            return removed;
        }
        finally
        {
            _gate.Release();
        }
    }

    private static int CleanupSignupState(SignupSettings signup)
    {
        var before = signup.PendingVerifications.Count + signup.PasswordResetCodes.Count + signup.RateLimits.Count;
        CleanupPendingVerifications(signup);
        CleanupResetCodes(signup);
        CleanupRateLimits(signup);

        return before - (signup.PendingVerifications.Count + signup.PasswordResetCodes.Count + signup.RateLimits.Count);
    }

    private static void CleanupResetCodes(SignupSettings signup)
    {
        var now = DateTimeOffset.UtcNow;
        signup.PasswordResetCodes = signup.PasswordResetCodes
            .Where(code => code.UsedAtUtc is null && code.ExpiresAtUtc > now)
            .TakeLast(250)
            .ToList();
    }

    private static void CleanupPendingVerifications(SignupSettings signup)
    {
        var now = DateTimeOffset.UtcNow;
        signup.PendingVerifications = signup.PendingVerifications
            .Where(pending => pending.ExpiresAtUtc > now)
            .TakeLast(500)
            .ToList();
    }

    private static void CleanupRateLimits(SignupSettings signup)
    {
        var now = DateTimeOffset.UtcNow;
        var cutoff = now.AddHours(-6);

        signup.RateLimits = signup.RateLimits
            .Where(record => (record.LockedUntilUtc is not null && record.LockedUntilUtc > now)
                || record.WindowStartedAtUtc > cutoff)
            .TakeLast(1000)
            .ToList();
    }

    private async Task RemovePendingVerificationAsync(string pendingId, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            var configuration = GetConfiguration();
            configuration.SignupSettings.PendingVerifications.RemoveAll(pending =>
                string.Equals(pending.Id, pendingId, StringComparison.OrdinalIgnoreCase));
            SaveConfiguration(configuration);
        }
        finally
        {
            _gate.Release();
        }
    }

    private static string CreateInviteCode()
    {
        Span<byte> bytes = stackalloc byte[18];
        RandomNumberGenerator.Fill(bytes);

        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace("+", "-", StringComparison.Ordinal)
            .Replace("/", "_", StringComparison.Ordinal);
    }

    private static string CreateResetCode()
    {
        return RandomNumberGenerator.GetInt32(100000, 1000000).ToString(CultureInfo.InvariantCulture);
    }

    private static string CreateVerificationToken()
    {
        Span<byte> bytes = stackalloc byte[32];
        RandomNumberGenerator.Fill(bytes);

        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace("+", "-", StringComparison.Ordinal)
            .Replace("/", "_", StringComparison.Ordinal);
    }

    private static string HashInviteCode(string inviteCode)
    {
        var normalized = inviteCode.Trim();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalized));

        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string HashResetCode(string email, string code)
    {
        var normalized = $"{email.Trim().ToLowerInvariant()}|{code.Trim()}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalized));

        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string HashVerificationToken(string token)
    {
        var normalized = token.Trim();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalized));

        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string HashRateLimitKey(string key)
    {
        var normalized = key.Trim().ToLowerInvariant();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalized));

        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string BuildVerificationLink(string baseUrl, string token)
    {
        var separator = baseUrl.Contains('?', StringComparison.Ordinal) ? '&' : '?';

        return $"{baseUrl}{separator}verify={Uri.EscapeDataString(token)}";
    }

    private static string ResolveEmailLogoUrl(string? logoUrl, string verificationLink)
    {
        var cleanedLogo = CleanEmailLogoUrl(logoUrl);

        if (Uri.TryCreate(cleanedLogo, UriKind.Absolute, out var absoluteLogo)
            && (absoluteLogo.Scheme == Uri.UriSchemeHttps || absoluteLogo.Scheme == Uri.UriSchemeHttp))
        {
            return absoluteLogo.ToString();
        }

        if (Uri.TryCreate(verificationLink, UriKind.Absolute, out var verificationUri))
        {
            return new Uri(verificationUri, cleanedLogo).ToString();
        }

        return cleanedLogo;
    }

    private static string? CleanUsername(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var cleaned = value.Trim();

        return UsernameRegex.IsMatch(cleaned) ? cleaned : null;
    }

    private static string? CleanEmail(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var cleaned = value.Trim();

        return EmailRegex.IsMatch(cleaned) ? cleaned.ToLowerInvariant() : null;
    }

    private static string? CleanResetCode(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var cleaned = new string(value.Trim().Where(char.IsLetterOrDigit).ToArray());

        return cleaned.Length is >= 6 and <= 16 ? cleaned : null;
    }

    private static string? CleanVerificationToken(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var cleaned = value.Trim();

        return cleaned.Length is >= 24 and <= 256 ? cleaned : null;
    }

    private static string CleanVerificationBaseUrl(string? value)
    {
        if (!string.IsNullOrWhiteSpace(value)
            && Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
        {
            var cleaned = uri.ToString();
            return cleaned.Length > 320 ? cleaned[..320] : cleaned.TrimEnd('&', '?');
        }

        return "/web/#/signup";
    }

    private static string CleanEmailLogoUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return SignupEmailSettings.DefaultLogoUrl;
        }

        var cleaned = value.Trim();

        if (cleaned.Contains('\0', StringComparison.Ordinal)
            || ContainsPathTraversal(cleaned)
            || cleaned.Length > 320)
        {
            return SignupEmailSettings.DefaultLogoUrl;
        }

        if (Uri.TryCreate(cleaned, UriKind.Absolute, out var absolute)
            && (absolute.Scheme == Uri.UriSchemeHttp || absolute.Scheme == Uri.UriSchemeHttps))
        {
            return absolute.ToString();
        }

        if (cleaned.StartsWith('/'))
        {
            return cleaned;
        }

        return SignupEmailSettings.DefaultLogoUrl;
    }

    private static bool ContainsPathTraversal(string value)
    {
        var current = value;

        for (var index = 0; index < 3; index++)
        {
            if (current.Contains("..", StringComparison.Ordinal)
                || current.Contains('\\', StringComparison.Ordinal)
                || current.Contains('\0', StringComparison.Ordinal)
                || current.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            var decoded = Uri.UnescapeDataString(current);
            if (string.Equals(decoded, current, StringComparison.Ordinal))
            {
                return false;
            }

            current = decoded;
        }

        return current.Contains("..", StringComparison.Ordinal);
    }

    private static string? ValidatePassword(string? password, string? confirmPassword)
    {
        if (string.IsNullOrEmpty(password))
        {
            return "Enter a password.";
        }

        if (!string.Equals(password, confirmPassword, StringComparison.Ordinal))
        {
            return "Passwords do not match.";
        }

        if (password.Length < 8)
        {
            return "Use at least 8 characters for the password.";
        }

        if (!password.Any(char.IsLetter) || !password.Any(char.IsDigit))
        {
            return "Use at least one letter and one number in the password.";
        }

        return null;
    }

    private static PtvSignupResponse Fail(string message) => new()
    {
        Message = message,
        Ok = false
    };

    private static PtvSignupInviteValidationResponse Invalid(string message) => new()
    {
        Message = message,
        Ok = false,
        Valid = false
    };

    private static string RedactEmail(string email)
    {
        var parts = email.Split('@', 2);

        if (parts.Length != 2 || parts[0].Length <= 2)
        {
            return "***";
        }

        return $"{parts[0][0]}***{parts[0][^1]}@{parts[1]}";
    }

    private static string CleanText(string? value, string fallback, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return fallback;
        }

        var cleaned = value.Trim();

        return cleaned.Length > maxLength ? cleaned[..maxLength] : cleaned;
    }

    private static string CleanIdentifier(string? value, string fallback)
    {
        var source = string.IsNullOrWhiteSpace(value) ? fallback : value;
        var cleaned = new string(source
            .Trim()
            .ToLowerInvariant()
            .Select(character => char.IsLetterOrDigit(character) ? character : '-')
            .ToArray());

        while (cleaned.Contains("--", StringComparison.Ordinal))
        {
            cleaned = cleaned.Replace("--", "-", StringComparison.Ordinal);
        }

        cleaned = cleaned.Trim('-');

        return string.IsNullOrWhiteSpace(cleaned) ? fallback : cleaned[..Math.Min(cleaned.Length, 96)];
    }

    private static List<string> CleanStringList(IEnumerable<string>? values, int maxItems)
    {
        return values?
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Where(value => value.Length <= 96)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(maxItems)
            .ToList() ?? [];
    }

    private static Guid[] CleanGuidArray(IEnumerable<string> values)
    {
        return values
            .Select(value => Guid.TryParse(value, out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
    }
}
