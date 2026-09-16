using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Atomic, checksummed, retained account backups and safe restore tooling.</summary>
public sealed class PtvAccountBackupService : IPtvAccountBackupService
{
    private const int BackupFormatVersion = 1;
    private const int DefaultRetentionCount = 30;
    private static readonly Regex BackupIdPattern = new("^[0-9]{8}T[0-9]{6}Z-[a-z_]{3,32}-[a-f0-9]{8}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };
    private readonly SemaphoreSlim _operationGate = new(1, 1);
    private readonly ILogger<PtvAccountBackupService> _logger;
    private readonly IPtvAccountRepository _repository;
    private readonly string _root;
    private readonly string _statusPath;
    private readonly int _retentionCount;
    private readonly bool _strictPathValidation;

    /// <summary>Initializes production backups under Jellyfin's persistent backup root.</summary>
    public PtvAccountBackupService(
        IApplicationPaths applicationPaths,
        IPtvAccountRepository repository,
        ILogger<PtvAccountBackupService> logger)
        : this(
            ResolveBackupRoot(applicationPaths),
            repository,
            ParseRetention(Environment.GetEnvironmentVariable("PTV_ACCOUNT_BACKUP_RETENTION")),
            logger,
            strictPathValidation: true)
    {
    }

    /// <summary>Initializes an explicit backup root for safe tests/tooling.</summary>
    internal PtvAccountBackupService(
        string root,
        IPtvAccountRepository repository,
        int retentionCount,
        ILogger<PtvAccountBackupService> logger,
        bool strictPathValidation = false)
    {
        _root = Path.GetFullPath(root);
        _repository = repository;
        _retentionCount = Math.Clamp(retentionCount, 2, 365);
        _strictPathValidation = strictPathValidation;
        _logger = logger;
        _statusPath = Path.Combine(Path.GetDirectoryName(repository.FilePath)!, "account-backup-status.json");
    }

    /// <inheritdoc />
    public async Task<PtvAccountBackupOperationResponse> CreateBackupAsync(
        string reason,
        CancellationToken cancellationToken = default)
    {
        if (!await _operationGate.WaitAsync(0, cancellationToken).ConfigureAwait(false))
        {
            return Failure("BACKUP_ALREADY_RUNNING", "An account backup or restore is already running.");
        }

        try
        {
            return await CreateBackupCoreAsync(CleanReason(reason), pruneAfterSuccess: true, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _operationGate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<PtvAccountBackupOperationResponse> VerifyBackupAsync(
        string backupId,
        CancellationToken cancellationToken = default)
    {
        if (!await _operationGate.WaitAsync(0, cancellationToken).ConfigureAwait(false))
        {
            return Failure("BACKUP_ALREADY_RUNNING", "An account backup or restore is already running.");
        }

        try
        {
            var validated = await ValidateBackupAsync(ResolveBackupDirectory(backupId), cancellationToken).ConfigureAwait(false);
            return new PtvAccountBackupOperationResponse
            {
                BackupId = backupId,
                Code = "OK",
                Message = "Backup checksum, schema, and record counts are valid.",
                Ok = true,
                Verified = true
            };
        }
        catch (PtvAccountBackupException ex)
        {
            _logger.LogWarning(ex, "PiggieTV account backup validation failed. BackupId={BackupId}; Code={Code}.", SafeBackupId(backupId), ex.Code);
            return Failure(ex.Code, "The account backup failed integrity validation.", backupId);
        }
        finally
        {
            _operationGate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<PtvAccountBackupOperationResponse> RestoreBackupAsync(
        string backupId,
        bool dryRun,
        CancellationToken cancellationToken = default)
    {
        if (!await _operationGate.WaitAsync(0, cancellationToken).ConfigureAwait(false))
        {
            return Failure("RESTORE_BUSY", "An account backup or restore is already running.", backupId);
        }

        try
        {
            _logger.LogInformation("PiggieTV account restore started. BackupId={BackupId}; DryRun={DryRun}.", SafeBackupId(backupId), dryRun);
            var validated = await ValidateBackupAsync(ResolveBackupDirectory(backupId), cancellationToken).ConfigureAwait(false);
            if (dryRun)
            {
                return new PtvAccountBackupOperationResponse
                {
                    BackupId = backupId,
                    Code = "OK",
                    DryRun = true,
                    Message = "Backup restore dry run passed. Production account data was not changed.",
                    Ok = true,
                    Verified = true
                };
            }

            PtvAccountBackupOperationResponse? preRestore = null;
            await _repository.ReplaceWithMaintenanceLockAsync(
                validated.Document,
                async (activeDocument, lockedCancellationToken) =>
                {
                    preRestore = await CreateBackupCoreAsync(
                        "pre_restore",
                        pruneAfterSuccess: false,
                        lockedCancellationToken,
                        activeDocument).ConfigureAwait(false);
                    if (!preRestore.Ok || !preRestore.Verified)
                    {
                        throw new PtvAccountBackupException(
                            "RESTORE_PRE_BACKUP_FAILED",
                            "Restore stopped because the pre-restore backup failed.");
                    }
                },
                cancellationToken).ConfigureAwait(false);
            var restored = await _repository.ReadAsync(cancellationToken).ConfigureAwait(false);
            _repository.Validate(restored);
            await PruneSuccessfulBackupsAsync(cancellationToken).ConfigureAwait(false);
            _logger.LogInformation("PiggieTV account restore completed. BackupId={BackupId}; PreRestoreBackupId={PreRestoreBackupId}.", backupId, preRestore?.BackupId);
            return new PtvAccountBackupOperationResponse
            {
                BackupId = backupId,
                Code = "OK",
                Message = "Account data was restored and validated successfully.",
                Ok = true,
                Verified = true
            };
        }
        catch (PtvAccountBackupException ex)
        {
            _logger.LogError(ex, "PiggieTV account restore validation failed. BackupId={BackupId}; Code={Code}.", SafeBackupId(backupId), ex.Code);
            return Failure(ex.Code == "BACKUP_VALIDATION_FAILED" ? "RESTORE_FAILED" : ex.Code, "Account restore failed without replacing production data.", backupId);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "PiggieTV account restore failed. BackupId={BackupId}.", SafeBackupId(backupId));
            return Failure("RESTORE_FAILED", "Account restore failed. The pre-restore backup remains available.", backupId);
        }
        finally
        {
            _operationGate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<PtvAccountBackupStatus> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        var status = await ReadStatusAsync(cancellationToken).ConfigureAwait(false);
        status.BackupPath = _root;
        status.Overdue = status.LastSuccessAtUtc is null
            || DateTimeOffset.UtcNow - status.LastSuccessAtUtc > TimeSpan.FromHours(48);
        return status;
    }

    private async Task<PtvAccountBackupOperationResponse> CreateBackupCoreAsync(
        string reason,
        bool pruneAfterSuccess,
        CancellationToken cancellationToken,
        PtvAccountDocument? suppliedDocument = null)
    {
        var stopwatch = Stopwatch.StartNew();
        _logger.LogInformation("PiggieTV account backup started. Reason={Reason}.", reason);
        var previousStatus = await ReadStatusAsync(cancellationToken).ConfigureAwait(false);
        var running = CopyStatus(previousStatus);
        running.LastRunAtUtc = DateTimeOffset.UtcNow;
        running.Result = "running";
        running.Message = "Account backup is running.";
        running.BackupPath = _root;
        await WriteStatusAsync(running, cancellationToken).ConfigureAwait(false);

        var stagingDirectory = string.Empty;
        try
        {
            EnsureBackupRootIsSafe();
            Directory.CreateDirectory(_root);
            var document = suppliedDocument ?? await _repository.ReadAsync(cancellationToken).ConfigureAwait(false);
            _repository.Validate(document);
            var now = DateTimeOffset.UtcNow;
            var backupId = $"{now:yyyyMMdd'T'HHmmss'Z'}-{reason}-{Guid.NewGuid():N}";
            backupId = backupId[..^24];
            var finalDirectory = Path.Combine(_root, backupId);
            stagingDirectory = Path.Combine(_root, $".{backupId}.{Guid.NewGuid():N}.tmp");
            Directory.CreateDirectory(stagingDirectory);

            var dataPath = Path.Combine(stagingDirectory, "account-data.json");
            var dataBytes = JsonSerializer.SerializeToUtf8Bytes(document, JsonOptions);
            await WriteThroughAsync(dataPath, dataBytes, cancellationToken).ConfigureAwait(false);
            var checksum = Convert.ToHexString(SHA256.HashData(dataBytes)).ToLowerInvariant();
            var activePending = document.EmailVerifications.Count(item =>
                item.ConsumedAtUtc is null
                && item.CancelledAtUtc is null
                && item.SupersededAtUtc is null
                && item.ExpiresAtUtc > now
                && item.DeliveryStatus != "reverification_required");
            var manifest = new PtvAccountBackupManifest
            {
                AccountDataSha256 = checksum,
                ApplicationVersion = typeof(PtvAccountBackupService).Assembly.GetName().Version?.ToString() ?? "unknown",
                BackupReason = reason,
                CreatedAtUtc = now,
                FormatVersion = BackupFormatVersion,
                PendingVerifications = activePending,
                Profiles = document.Profiles.Count,
                SchemaVersion = document.SchemaVersion,
                VerifiedEmails = document.Profiles.Count(profile => profile.EmailVerified)
            };
            await WriteThroughAsync(
                Path.Combine(stagingDirectory, "manifest.json"),
                JsonSerializer.SerializeToUtf8Bytes(manifest, JsonOptions),
                cancellationToken).ConfigureAwait(false);
            await WriteThroughAsync(
                Path.Combine(stagingDirectory, "checksum.sha256"),
                Encoding.UTF8.GetBytes($"{checksum}  account-data.json{Environment.NewLine}"),
                cancellationToken).ConfigureAwait(false);

            await ValidateBackupAsync(stagingDirectory, cancellationToken).ConfigureAwait(false);
            Directory.Move(stagingDirectory, finalDirectory);
            stagingDirectory = string.Empty;
            if (pruneAfterSuccess) await PruneSuccessfulBackupsAsync(cancellationToken).ConfigureAwait(false);

            stopwatch.Stop();
            var size = Directory.EnumerateFiles(finalDirectory).Sum(path => new FileInfo(path).Length);
            var success = new PtvAccountBackupStatus
            {
                BackupId = backupId,
                BackupPath = _root,
                BackupSizeBytes = size,
                DurationMilliseconds = stopwatch.ElapsedMilliseconds,
                LastRunAtUtc = now,
                LastSuccessAtUtc = now,
                Message = "SUCCESS - checksum and account schema verified.",
                PendingVerificationsBackedUp = activePending,
                ProfilesBackedUp = manifest.Profiles,
                Result = "success",
                VerificationStatus = "checksum_verified",
                VerifiedEmailsBackedUp = manifest.VerifiedEmails
            };
            await WriteStatusAsync(success, cancellationToken).ConfigureAwait(false);
            _logger.LogInformation(
                "PiggieTV account backup completed. BackupId={BackupId}; Profiles={Profiles}; VerifiedEmails={VerifiedEmails}; Pending={Pending}; Bytes={Bytes}.",
                backupId,
                manifest.Profiles,
                manifest.VerifiedEmails,
                activePending,
                size);
            return new PtvAccountBackupOperationResponse
            {
                BackupId = backupId,
                Code = "OK",
                Message = "Account backup completed and passed integrity validation.",
                Ok = true,
                Verified = true
            };
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            TryDeleteDirectory(stagingDirectory);
            var failed = CopyStatus(previousStatus);
            failed.BackupPath = _root;
            failed.DurationMilliseconds = stopwatch.ElapsedMilliseconds;
            failed.LastRunAtUtc = DateTimeOffset.UtcNow;
            failed.Message = "FAILED - backup was not committed.";
            failed.Result = "failed";
            failed.VerificationStatus = "failed";
            await WriteStatusAsync(failed, cancellationToken).ConfigureAwait(false);
            _logger.LogError(ex, "PiggieTV account backup failed. Reason={Reason}.", reason);
            return Failure("BACKUP_FAILED", "Account backup failed and was not committed.");
        }
    }

    private async Task<ValidatedBackup> ValidateBackupAsync(string directory, CancellationToken cancellationToken)
    {
        try
        {
            var fullDirectory = Path.GetFullPath(directory);
            EnsureBeneathRoot(fullDirectory);
            var manifestPath = Path.Combine(fullDirectory, "manifest.json");
            var dataPath = Path.Combine(fullDirectory, "account-data.json");
            var checksumPath = Path.Combine(fullDirectory, "checksum.sha256");
            if (!File.Exists(manifestPath) || !File.Exists(dataPath) || !File.Exists(checksumPath))
            {
                throw new PtvAccountBackupException("BACKUP_VALIDATION_FAILED", "Required backup artifacts are missing.");
            }

            var manifest = JsonSerializer.Deserialize<PtvAccountBackupManifest>(
                await File.ReadAllBytesAsync(manifestPath, cancellationToken).ConfigureAwait(false),
                JsonOptions) ?? throw new PtvAccountBackupException("BACKUP_VALIDATION_FAILED", "Backup manifest is empty.");
            if (manifest.FormatVersion != BackupFormatVersion
                || manifest.SchemaVersion != PtvAccountDocument.CurrentSchemaVersion
                || manifest.AccountDataFile != "account-data.json")
            {
                throw new PtvAccountBackupException("BACKUP_FORMAT_UNSUPPORTED", "Backup format or schema is unsupported.");
            }

            var dataBytes = await File.ReadAllBytesAsync(dataPath, cancellationToken).ConfigureAwait(false);
            var checksum = Convert.ToHexString(SHA256.HashData(dataBytes)).ToLowerInvariant();
            var manifestChecksum = manifest.AccountDataSha256?.Trim().ToLowerInvariant() ?? string.Empty;
            if (manifestChecksum.Length != 64 || !manifestChecksum.All(char.IsAsciiHexDigit))
            {
                throw new PtvAccountBackupException("BACKUP_VALIDATION_FAILED", "Backup manifest checksum is invalid.");
            }
            var checksumFile = (await File.ReadAllTextAsync(checksumPath, cancellationToken).ConfigureAwait(false)).Trim();
            if (!CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(checksum),
                    Encoding.ASCII.GetBytes(manifestChecksum))
                || !checksumFile.StartsWith($"{checksum}  account-data.json", StringComparison.Ordinal))
            {
                throw new PtvAccountBackupException("BACKUP_VALIDATION_FAILED", "Account backup checksum does not match.");
            }

            var document = JsonSerializer.Deserialize<PtvAccountDocument>(dataBytes, JsonOptions)
                ?? throw new PtvAccountBackupException("BACKUP_VALIDATION_FAILED", "Account data artifact is empty.");
            _repository.Validate(document);
            var activePending = document.EmailVerifications.Count(item =>
                item.ConsumedAtUtc is null
                && item.CancelledAtUtc is null
                && item.SupersededAtUtc is null
                && item.ExpiresAtUtc > manifest.CreatedAtUtc
                && item.DeliveryStatus != "reverification_required");
            if (manifest.Profiles != document.Profiles.Count
                || manifest.VerifiedEmails != document.Profiles.Count(profile => profile.EmailVerified)
                || manifest.PendingVerifications != activePending)
            {
                throw new PtvAccountBackupException("BACKUP_VALIDATION_FAILED", "Account backup record counts do not match its manifest.");
            }

            return new ValidatedBackup(document, manifest);
        }
        catch (PtvAccountBackupException)
        {
            throw;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new PtvAccountBackupException("BACKUP_VALIDATION_FAILED", "Account backup validation failed.", ex);
        }
    }

    private async Task PruneSuccessfulBackupsAsync(CancellationToken cancellationToken)
    {
        if (!Directory.Exists(_root)) return;
        var candidates = new List<(DirectoryInfo Directory, DateTimeOffset CreatedAt)>();
        foreach (var directory in Directory.EnumerateDirectories(_root).Select(path => new DirectoryInfo(path)))
        {
            if (directory.Name.StartsWith('.')) continue;
            try
            {
                var validated = await ValidateBackupAsync(directory.FullName, cancellationToken).ConfigureAwait(false);
                candidates.Add((directory, validated.Manifest.CreatedAtUtc));
            }
            catch (PtvAccountBackupException)
            {
                _logger.LogWarning("PiggieTV account backup validation failed during retention scan. BackupId={BackupId}.", directory.Name);
                // Invalid artifacts are never treated as retention candidates.
            }
        }

        var ordered = candidates.OrderByDescending(item => item.CreatedAt).ToList();
        foreach (var candidate in ordered.Skip(_retentionCount))
        {
            cancellationToken.ThrowIfCancellationRequested();
            candidate.Directory.Delete(true);
            _logger.LogInformation("PiggieTV pruned a validated account backup. BackupId={BackupId}.", candidate.Directory.Name);
        }
    }

    private string ResolveBackupDirectory(string backupId)
    {
        var safeBackupId = backupId ?? string.Empty;
        if (!BackupIdPattern.IsMatch(safeBackupId))
        {
            throw new PtvAccountBackupException("BACKUP_ID_INVALID", "Backup ID is invalid.");
        }

        var directory = Path.GetFullPath(Path.Combine(_root, safeBackupId));
        EnsureBeneathRoot(directory);
        if (!Directory.Exists(directory)) throw new PtvAccountBackupException("BACKUP_NOT_FOUND", "Backup was not found.");
        return directory;
    }

    private void EnsureBackupRootIsSafe()
    {
        var root = Path.GetPathRoot(_root);
        if (string.Equals(_root.TrimEnd(Path.DirectorySeparatorChar), root?.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
        {
            throw new PtvAccountBackupException("BACKUP_PATH_INVALID", "The account backup path cannot be a filesystem root.");
        }

        if (!_strictPathValidation) return;
        var temporaryRoot = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var deploymentRoot = Path.GetFullPath(AppContext.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var normalized = _root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (normalized.StartsWith(temporaryRoot, StringComparison.OrdinalIgnoreCase)
            || normalized.StartsWith(deploymentRoot, StringComparison.OrdinalIgnoreCase)
            || normalized.Contains($"{Path.DirectorySeparatorChar}node_modules{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains($"{Path.DirectorySeparatorChar}dist{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains($"{Path.DirectorySeparatorChar}build{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase))
        {
            throw new PtvAccountBackupException("BACKUP_PATH_INVALID", "The account backup path must use persistent server storage outside temporary or deployment assets.");
        }
    }

    private void EnsureBeneathRoot(string path)
    {
        var prefix = _root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new PtvAccountBackupException("BACKUP_PATH_INVALID", "Backup path escapes the configured account backup root.");
        }
    }

    private async Task<PtvAccountBackupStatus> ReadStatusAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_statusPath)) return new PtvAccountBackupStatus { BackupPath = _root };
        try
        {
            return JsonSerializer.Deserialize<PtvAccountBackupStatus>(
                await File.ReadAllBytesAsync(_statusPath, cancellationToken).ConfigureAwait(false),
                JsonOptions) ?? new PtvAccountBackupStatus { BackupPath = _root };
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            _logger.LogWarning(ex, "PiggieTV account backup status could not be read.");
            return new PtvAccountBackupStatus { BackupPath = _root, Message = "Backup status is unavailable." };
        }
    }

    private async Task WriteStatusAsync(PtvAccountBackupStatus status, CancellationToken cancellationToken)
    {
        var directory = Path.GetDirectoryName(_statusPath)!;
        Directory.CreateDirectory(directory);
        var temporaryPath = Path.Combine(directory, $".account-backup-status-{Guid.NewGuid():N}.tmp");
        try
        {
            await WriteThroughAsync(temporaryPath, JsonSerializer.SerializeToUtf8Bytes(status, JsonOptions), cancellationToken).ConfigureAwait(false);
            if (File.Exists(_statusPath)) File.Move(temporaryPath, _statusPath, true);
            else File.Move(temporaryPath, _statusPath);
        }
        finally
        {
            try { if (File.Exists(temporaryPath)) File.Delete(temporaryPath); } catch { }
        }
    }

    private static async Task WriteThroughAsync(string path, byte[] bytes, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, FileOptions.Asynchronous | FileOptions.WriteThrough);
        await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    private static string ResolveBackupRoot(IApplicationPaths applicationPaths)
    {
        var configured = Environment.GetEnvironmentVariable("PTV_ACCOUNT_BACKUP_PATH")?.Trim();
        return string.IsNullOrWhiteSpace(configured)
            ? Path.Combine(applicationPaths.BackupPath, "PiggieTV", "accounts")
            : configured;
    }

    private static int ParseRetention(string? value) =>
        int.TryParse(value, out var retention) ? Math.Clamp(retention, 2, 365) : DefaultRetentionCount;

    private static string CleanReason(string? reason)
    {
        var normalized = reason?.Trim().ToLowerInvariant() ?? "manual";
        return normalized is "scheduled" or "manual" or "pre_migration" or "pre_restore" or "pre_bulk_import"
            ? normalized
            : "manual";
    }

    private static string SafeBackupId(string? value) => BackupIdPattern.IsMatch(value ?? string.Empty) ? value! : "[invalid]";

    private static void TryDeleteDirectory(string path)
    {
        try { if (!string.IsNullOrWhiteSpace(path) && Directory.Exists(path)) Directory.Delete(path, true); }
        catch { }
    }

    private static PtvAccountBackupStatus CopyStatus(PtvAccountBackupStatus source) => new()
    {
        BackupId = source.BackupId,
        BackupPath = source.BackupPath,
        BackupSizeBytes = source.BackupSizeBytes,
        DurationMilliseconds = source.DurationMilliseconds,
        LastRunAtUtc = source.LastRunAtUtc,
        LastSuccessAtUtc = source.LastSuccessAtUtc,
        Message = source.Message,
        Overdue = source.Overdue,
        PendingVerificationsBackedUp = source.PendingVerificationsBackedUp,
        ProfilesBackedUp = source.ProfilesBackedUp,
        Result = source.Result,
        VerificationStatus = source.VerificationStatus,
        VerifiedEmailsBackedUp = source.VerifiedEmailsBackedUp
    };

    private static PtvAccountBackupOperationResponse Failure(string code, string message, string backupId = "") => new()
    {
        BackupId = SafeBackupId(backupId) == "[invalid]" ? string.Empty : backupId,
        Code = code,
        Message = message,
        Ok = false,
        Verified = false
    };

    private sealed record ValidatedBackup(PtvAccountDocument Document, PtvAccountBackupManifest Manifest);
}

/// <summary>Explicit backup validation or restore failure.</summary>
public sealed class PtvAccountBackupException : Exception
{
    /// <summary>Initializes a backup exception.</summary>
    public PtvAccountBackupException(string code, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }

    /// <summary>Gets stable internal code.</summary>
    public string Code { get; }
}
