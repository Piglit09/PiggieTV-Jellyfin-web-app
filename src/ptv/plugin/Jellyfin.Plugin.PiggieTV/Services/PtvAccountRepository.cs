using System.Text.Json;
using System.Net.Mail;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Atomic JSON-backed account repository in Jellyfin persistent plugin storage.</summary>
public sealed class PtvAccountRepository : IPtvAccountRepository
{
    private const int MaximumAuditEvents = 2000;
    private const int MaximumRateLimitEvents = 5000;
    private const int MaximumVerificationRecords = 5000;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _directory;
    private readonly ILogger<PtvAccountRepository> _logger;

    /// <summary>Initializes production account persistence below the plugin configuration root.</summary>
    public PtvAccountRepository(IApplicationPaths applicationPaths, ILogger<PtvAccountRepository> logger)
        : this(Path.Combine(applicationPaths.PluginConfigurationsPath, "PiggieTV", "accounts"), logger)
    {
    }

    /// <summary>Initializes account persistence in an explicit directory for safe tooling/tests.</summary>
    internal PtvAccountRepository(string directory, ILogger<PtvAccountRepository> logger)
    {
        _directory = Path.GetFullPath(directory);
        _logger = logger;
        FilePath = Path.Combine(_directory, "ptv-accounts.json");
    }

    /// <inheritdoc />
    public string FilePath { get; }

    /// <inheritdoc />
    public async Task<PtvAccountDocument> ReadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return Clone(await ReadNoLockAsync(cancellationToken).ConfigureAwait(false));
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<TResult> ExecuteTransactionAsync<TResult>(
        Func<PtvAccountDocument, TResult> mutation,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(mutation);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var document = await ReadNoLockAsync(cancellationToken).ConfigureAwait(false);
            var result = mutation(document);
            document.UpdatedAtUtc = DateTimeOffset.UtcNow;
            NormalizeBoundedCollections(document);
            Validate(document);
            await WriteNoLockAsync(document, cancellationToken).ConfigureAwait(false);
            return result;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task ReplaceAsync(PtvAccountDocument document, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var replacement = Clone(document);
            replacement.UpdatedAtUtc = DateTimeOffset.UtcNow;
            NormalizeBoundedCollections(replacement);
            Validate(replacement);
            await WriteNoLockAsync(replacement, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task ReplaceWithMaintenanceLockAsync(
        PtvAccountDocument replacement,
        Func<PtvAccountDocument, CancellationToken, Task> beforeReplace,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(replacement);
        ArgumentNullException.ThrowIfNull(beforeReplace);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = Clone(await ReadNoLockAsync(cancellationToken).ConfigureAwait(false));
            await beforeReplace(current, cancellationToken).ConfigureAwait(false);
            var validatedReplacement = Clone(replacement);
            validatedReplacement.UpdatedAtUtc = DateTimeOffset.UtcNow;
            NormalizeBoundedCollections(validatedReplacement);
            Validate(validatedReplacement);
            await WriteNoLockAsync(validatedReplacement, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public PtvAccountDocument Validate(PtvAccountDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);

        if (document.SchemaVersion != PtvAccountDocument.CurrentSchemaVersion)
        {
            throw new PtvAccountDataException(
                "ACCOUNT_SCHEMA_UNSUPPORTED",
                $"Unsupported account schema version {document.SchemaVersion}.");
        }

        document.Profiles ??= [];
        document.EmailVerifications ??= [];
        document.EmailRateLimits ??= [];
        document.AuditEvents ??= [];
        document.Migration ??= new PtvAccountMigrationState();

        var profileIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var verifiedEmails = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var profile in document.Profiles)
        {
            if (profile is null || !TryNormalizeUserId(profile.JellyfinUserId, out var userId))
            {
                throw new PtvAccountDataException("ACCOUNT_PROFILE_INVALID", "A profile has an invalid Jellyfin user ID.");
            }

            profile.JellyfinUserId = userId;
            profile.UsernameSnapshot = CleanText(profile.UsernameSnapshot, 80);
            if (!profileIds.Add(userId))
            {
                throw new PtvAccountDataException("ACCOUNT_PROFILE_DUPLICATE", "More than one profile exists for a Jellyfin user ID.");
            }

            if (profile.EmailVerified)
            {
                if (string.IsNullOrWhiteSpace(profile.Email)
                    || string.IsNullOrWhiteSpace(profile.EmailNormalized)
                    || profile.EmailVerifiedAtUtc is null
                    || !TryNormalizeEmail(profile.Email, out var verifiedNormalized)
                    || !string.Equals(profile.EmailNormalized, verifiedNormalized, StringComparison.OrdinalIgnoreCase))
                {
                    throw new PtvAccountDataException("ACCOUNT_VERIFIED_EMAIL_INVALID", "A verified profile is missing canonical email metadata.");
                }

                if (!verifiedEmails.Add(profile.EmailNormalized))
                {
                    throw new PtvAccountDataException("ACCOUNT_EMAIL_DUPLICATE", "A verified email is assigned to more than one profile.");
                }
            }
            else if (!string.IsNullOrWhiteSpace(profile.Email) || !string.IsNullOrWhiteSpace(profile.EmailNormalized))
            {
                throw new PtvAccountDataException("ACCOUNT_UNVERIFIED_CANONICAL_EMAIL", "An unverified email cannot be canonical profile data.");
            }

            if ((!string.IsNullOrWhiteSpace(profile.RecoveryEmail) || !string.IsNullOrWhiteSpace(profile.RecoveryEmailNormalized))
                && (!TryNormalizeEmail(profile.RecoveryEmail, out var recoveryNormalized)
                    || !string.Equals(profile.RecoveryEmailNormalized, recoveryNormalized, StringComparison.OrdinalIgnoreCase)))
            {
                throw new PtvAccountDataException("ACCOUNT_RECOVERY_EMAIL_INVALID", "A recovery email has invalid normalized metadata.");
            }
        }

        var verificationIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var verification in document.EmailVerifications)
        {
            if (verification is null
                || string.IsNullOrWhiteSpace(verification.Id)
                || !TryNormalizeUserId(verification.JellyfinUserId, out var userId)
                || string.IsNullOrWhiteSpace(verification.PendingEmail)
                || string.IsNullOrWhiteSpace(verification.PendingEmailNormalized)
                || !TryNormalizeEmail(verification.PendingEmail, out var pendingNormalized)
                || !string.Equals(verification.PendingEmailNormalized, pendingNormalized, StringComparison.OrdinalIgnoreCase))
            {
                throw new PtvAccountDataException("ACCOUNT_VERIFICATION_INVALID", "An email verification record is invalid.");
            }

            verification.JellyfinUserId = userId;
            if (!verificationIds.Add(verification.Id))
            {
                throw new PtvAccountDataException("ACCOUNT_VERIFICATION_DUPLICATE", "A duplicate verification ID exists.");
            }

            if (!IsSha256Hex(verification.TokenHash))
            {
                throw new PtvAccountDataException("ACCOUNT_TOKEN_HASH_INVALID", "A verification has an invalid token hash.");
            }
        }

        foreach (var rateLimit in document.EmailRateLimits)
        {
            var hasUser = TryNormalizeUserId(rateLimit.JellyfinUserId, out var rateUserId);
            var hasKey = IsSha256Hex(rateLimit.KeyHash);
            if (string.IsNullOrWhiteSpace(rateLimit.Action) || (!hasUser && !hasKey))
            {
                throw new PtvAccountDataException("ACCOUNT_RATE_LIMIT_INVALID", "An account rate-limit record is invalid.");
            }

            if (hasUser) rateLimit.JellyfinUserId = rateUserId;
        }

        return document;
    }

    private async Task<PtvAccountDocument> ReadNoLockAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(FilePath))
        {
            return new PtvAccountDocument();
        }

        try
        {
            await using var stream = new FileStream(
                FilePath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                81920,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            var document = await JsonSerializer.DeserializeAsync<PtvAccountDocument>(
                stream,
                JsonOptions,
                cancellationToken).ConfigureAwait(false);
            return Validate(document ?? throw new PtvAccountDataException("ACCOUNT_DATA_EMPTY", "Account data is empty."));
        }
        catch (PtvAccountDataException)
        {
            throw;
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            _logger.LogError(ex, "PiggieTV account data could not be opened. File={AccountFile}.", FilePath);
            throw new PtvAccountDataException("ACCOUNT_DATA_READ_FAILED", "PiggieTV account data could not be opened.", ex);
        }
    }

    private async Task WriteNoLockAsync(PtvAccountDocument document, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_directory);
        var temporaryPath = Path.Combine(_directory, $".ptv-accounts-{Guid.NewGuid():N}.tmp");
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(document, JsonOptions);
            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                81920,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            }

            await ValidateStoredFileAsync(temporaryPath, cancellationToken).ConfigureAwait(false);
            ReplaceTemporaryFile(temporaryPath, FilePath);
        }
        catch
        {
            TryDelete(temporaryPath);
            throw;
        }
    }

    private async Task ValidateStoredFileAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        var roundTrip = await JsonSerializer.DeserializeAsync<PtvAccountDocument>(
            stream,
            JsonOptions,
            cancellationToken).ConfigureAwait(false);
        Validate(roundTrip ?? throw new PtvAccountDataException("ACCOUNT_WRITE_VALIDATION_FAILED", "Written account data could not be reopened."));
    }

    private static PtvAccountDocument Clone(PtvAccountDocument document)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(document, JsonOptions);
        return JsonSerializer.Deserialize<PtvAccountDocument>(bytes, JsonOptions)
            ?? throw new PtvAccountDataException("ACCOUNT_CLONE_FAILED", "Account data could not be cloned safely.");
    }

    private static void NormalizeBoundedCollections(PtvAccountDocument document)
    {
        document.AuditEvents = (document.AuditEvents ?? [])
            .OrderBy(item => item.CreatedAtUtc)
            .TakeLast(MaximumAuditEvents)
            .ToList();
        document.EmailRateLimits = (document.EmailRateLimits ?? [])
            .Where(item => item.CreatedAtUtc > DateTimeOffset.UtcNow.AddDays(-2))
            .OrderBy(item => item.CreatedAtUtc)
            .TakeLast(MaximumRateLimitEvents)
            .ToList();
        document.EmailVerifications = (document.EmailVerifications ?? [])
            .OrderBy(item => item.CreatedAtUtc)
            .TakeLast(MaximumVerificationRecords)
            .ToList();
    }

    private static void ReplaceTemporaryFile(string temporaryPath, string filePath)
    {
        if (!File.Exists(filePath))
        {
            File.Move(temporaryPath, filePath);
            return;
        }

        try
        {
            File.Replace(temporaryPath, filePath, null, true);
        }
        catch (PlatformNotSupportedException)
        {
            File.Move(temporaryPath, filePath, true);
        }
        catch (IOException)
        {
            File.Move(temporaryPath, filePath, true);
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            // The original write failure is more useful than best-effort temp cleanup.
        }
    }

    private static bool TryNormalizeUserId(string? value, out string normalized)
    {
        normalized = string.Empty;
        if (!Guid.TryParse(value?.Trim(), out var userId) || userId == Guid.Empty) return false;
        normalized = userId.ToString("N");
        return true;
    }

    private static bool IsSha256Hex(string? value)
    {
        if (value?.Length != 64) return false;
        return value.All(character => char.IsAsciiHexDigit(character));
    }

    private static bool TryNormalizeEmail(string? value, out string normalized)
    {
        normalized = string.Empty;
        var display = value?.Trim() ?? string.Empty;
        if (display.Length is < 3 or > 254 || display.Any(character => char.IsWhiteSpace(character))) return false;
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
        if (at <= 0 || at >= display.Length - 1 || !display[(at + 1)..].Contains('.')) return false;
        normalized = display.ToLowerInvariant();
        return true;
    }

    private static string CleanText(string? value, int maximumLength)
    {
        var text = value?.Trim() ?? string.Empty;
        return text[..Math.Min(text.Length, maximumLength)];
    }
}

/// <summary>Explicit account persistence/validation failure.</summary>
public sealed class PtvAccountDataException : Exception
{
    /// <summary>Initializes an account persistence exception.</summary>
    public PtvAccountDataException(string code, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }

    /// <summary>Gets the stable internal error code.</summary>
    public string Code { get; }
}
