using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvAccountBackupServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ptv-account-backup-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task CreatesValidatesAndRestoresWithoutUsingClientPaths()
    {
        var (repository, backups, _) = await CreateFixtureAsync();
        var created = await backups.CreateBackupAsync("manual");
        Assert.True(created.Ok);
        Assert.True(created.Verified);

        var verified = await backups.VerifyBackupAsync(created.BackupId);
        Assert.True(verified.Ok);

        await repository.ExecuteTransactionAsync(document =>
        {
            document.Profiles.Single().UsernameSnapshot = "changed";
            return true;
        });
        var dryRun = await backups.RestoreBackupAsync(created.BackupId, true);
        Assert.True(dryRun.Ok);
        Assert.True(dryRun.DryRun);
        Assert.Equal("changed", (await repository.ReadAsync()).Profiles.Single().UsernameSnapshot);

        var restored = await backups.RestoreBackupAsync(created.BackupId, false);
        Assert.True(restored.Ok);
        Assert.Equal("before", (await repository.ReadAsync()).Profiles.Single().UsernameSnapshot);
        Assert.Contains(Directory.EnumerateDirectories(Path.Combine(_root, "backups")), path => Path.GetFileName(path).Contains("pre_restore", StringComparison.Ordinal));
    }

    [Fact]
    public async Task BackupArtifactsExcludeOpenAiCredentialAndConfigurationFields()
    {
        var (_, backups, backupRoot) = await CreateFixtureAsync();
        var created = await backups.CreateBackupAsync("manual");
        Assert.True(created.Ok);

        var artifactDirectory = Path.Combine(backupRoot, created.BackupId);
        var artifactText = string.Join(
            '\n',
            await Task.WhenAll(Directory.EnumerateFiles(artifactDirectory).Select(path => File.ReadAllTextAsync(path))));

        Assert.DoesNotContain("OPENAI_API_KEY", artifactText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("openAi", artifactText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("apiKey", artifactText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("credentialSource", artifactText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("effectiveModel", artifactText, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CorruptBackupFailsClosedAndDoesNotReplaceActiveData()
    {
        var (repository, backups, backupRoot) = await CreateFixtureAsync();
        var created = await backups.CreateBackupAsync("manual");
        await repository.ExecuteTransactionAsync(document =>
        {
            document.Profiles.Single().UsernameSnapshot = "active-safe-copy";
            return true;
        });
        await File.AppendAllTextAsync(Path.Combine(backupRoot, created.BackupId, "account-data.json"), "corrupt");

        var verify = await backups.VerifyBackupAsync(created.BackupId);
        var restore = await backups.RestoreBackupAsync(created.BackupId, false);
        Assert.False(verify.Ok);
        Assert.False(restore.Ok);
        Assert.Equal("active-safe-copy", (await repository.ReadAsync()).Profiles.Single().UsernameSnapshot);
    }

    [Fact]
    public async Task UnsupportedBackupFormatFailsBeforeReplacingActiveData()
    {
        var (repository, backups, backupRoot) = await CreateFixtureAsync();
        var created = await backups.CreateBackupAsync("manual");
        await repository.ExecuteTransactionAsync(document =>
        {
            document.Profiles.Single().UsernameSnapshot = "active-safe-copy";
            return true;
        });

        var manifestPath = Path.Combine(backupRoot, created.BackupId, "manifest.json");
        var manifest = await File.ReadAllTextAsync(manifestPath);
        await File.WriteAllTextAsync(manifestPath, manifest.Replace("\"formatVersion\": 1", "\"formatVersion\": 999", StringComparison.Ordinal));

        var verify = await backups.VerifyBackupAsync(created.BackupId);
        var restore = await backups.RestoreBackupAsync(created.BackupId, false);
        Assert.False(verify.Ok);
        Assert.Equal("BACKUP_FORMAT_UNSUPPORTED", verify.Code);
        Assert.False(restore.Ok);
        Assert.Equal("BACKUP_FORMAT_UNSUPPORTED", restore.Code);
        Assert.Equal("active-safe-copy", (await repository.ReadAsync()).Profiles.Single().UsernameSnapshot);
    }

    [Fact]
    public async Task PrunesOnlyOldValidatedBackupsToConfiguredRetention()
    {
        var (_, backups, backupRoot) = await CreateFixtureAsync(retention: 2);
        for (var index = 0; index < 5; index++)
        {
            Assert.True((await backups.CreateBackupAsync("manual")).Ok);
        }

        var committed = Directory.EnumerateDirectories(backupRoot)
            .Where(path => !Path.GetFileName(path).StartsWith('.'))
            .ToList();
        Assert.Equal(2, committed.Count);
        Assert.All(committed, path => Assert.True(File.Exists(Path.Combine(path, "manifest.json"))));
    }

    [Fact]
    public async Task RejectsTraversalAndUnrecognizedBackupIds()
    {
        var (_, backups, _) = await CreateFixtureAsync();
        var response = await backups.VerifyBackupAsync("..\\outside");
        Assert.False(response.Ok);
        Assert.Equal("BACKUP_ID_INVALID", response.Code);
        Assert.Empty(response.BackupId);
    }

    [Fact]
    public async Task ConcurrentJobsAreRejectedInsteadOfWritingCollidingArtifacts()
    {
        var (_, backups, _) = await CreateFixtureAsync();
        var first = backups.CreateBackupAsync("manual");
        var second = backups.CreateBackupAsync("manual");
        var results = await Task.WhenAll(first, second);

        Assert.Single(results, result => result.Ok);
        Assert.Single(results, result => result.Code == "BACKUP_ALREADY_RUNNING");
    }

    [Fact]
    public async Task FailedCurrentBackupPreservesLastKnownGoodArtifactAndSuccessTimestamp()
    {
        var (repository, backups, backupRoot) = await CreateFixtureAsync();
        var good = await backups.CreateBackupAsync("manual");
        var priorStatus = await backups.GetStatusAsync();
        await File.AppendAllTextAsync(repository.FilePath, "corrupt-active-data");

        var failed = await backups.CreateBackupAsync("manual");
        var status = await backups.GetStatusAsync();
        Assert.False(failed.Ok);
        Assert.True(Directory.Exists(Path.Combine(backupRoot, good.BackupId)));
        Assert.Equal("failed", status.Result);
        Assert.Equal(priorStatus.LastSuccessAtUtc, status.LastSuccessAtUtc);
        Assert.Equal(good.BackupId, status.BackupId);
    }

    [Fact]
    public async Task ScheduledTaskInvokesTheSharedBackupService()
    {
        var fake = new RecordingBackupService();
        var task = new PtvAccountBackupTask(fake);
        await task.ExecuteAsync(new Progress<double>(), CancellationToken.None);

        Assert.Equal(["scheduled"], fake.Reasons);
        Assert.Equal("PTV Account Data Backup", task.Name);
        Assert.Single(task.GetDefaultTriggers());
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private async Task<(PtvAccountRepository Repository, PtvAccountBackupService Backups, string BackupRoot)> CreateFixtureAsync(int retention = 30)
    {
        var repository = new PtvAccountRepository(Path.Combine(_root, "accounts"), NullLogger<PtvAccountRepository>.Instance);
        await repository.ExecuteTransactionAsync(document =>
        {
            document.Profiles.Add(PtvAccountRepositoryTests.VerifiedProfile(Guid.NewGuid().ToString("N"), "before", "owner@example.com"));
            return true;
        });
        var backupRoot = Path.Combine(_root, "backups");
        var service = new PtvAccountBackupService(backupRoot, repository, retention, NullLogger<PtvAccountBackupService>.Instance);
        return (repository, service, backupRoot);
    }

    private sealed class RecordingBackupService : IPtvAccountBackupService
    {
        public List<string> Reasons { get; } = [];

        public Task<PtvAccountBackupOperationResponse> CreateBackupAsync(string reason, CancellationToken cancellationToken = default)
        {
            Reasons.Add(reason);
            return Task.FromResult(new PtvAccountBackupOperationResponse { Code = "OK", Message = "ok", Ok = true, Verified = true });
        }

        public Task<PtvAccountBackupStatus> GetStatusAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(new PtvAccountBackupStatus());

        public Task<PtvAccountBackupOperationResponse> RestoreBackupAsync(string backupId, bool dryRun, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<PtvAccountBackupOperationResponse> VerifyBackupAsync(string backupId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
