using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvAccountServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ptv-account-service-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task VerificationKeepsEmailPendingUntilSingleUseTokenCommits()
    {
        var fixture = CreateFixture("owner");
        var requested = await fixture.Service.StartEmailVerificationAsync(fixture.UserId, "owner", false, "Owner@Example.com");
        Assert.True(requested.Ok);
        Assert.Null(requested.Profile?.Email);
        Assert.Equal("Owner@Example.com", requested.Profile?.PendingEmail);

        var token = fixture.Mail.LastToken();
        var atRest = await fixture.Repository.ReadAsync();
        Assert.DoesNotContain(token, await File.ReadAllTextAsync(fixture.Repository.FilePath), StringComparison.Ordinal);
        Assert.Equal(64, atRest.EmailVerifications.Single().TokenHash.Length);
        Assert.Null(atRest.Profiles.Single().Email);

        var verified = await fixture.Service.VerifyEmailAsync(token);
        Assert.True(verified.Ok);
        Assert.Equal("Owner@Example.com", verified.Profile?.Email);
        Assert.True(verified.Profile?.EmailVerified);

        var replayed = await fixture.Service.VerifyEmailAsync(token);
        Assert.False(replayed.Ok);
        Assert.Equal("VERIFICATION_ALREADY_USED", replayed.Code);
    }

    [Fact]
    public async Task ResendRotatesTokenAndInvalidatesEarlierLink()
    {
        var fixture = CreateFixture("owner");
        Assert.True((await fixture.Service.StartEmailVerificationAsync(fixture.UserId, "owner", false, "owner@example.com")).Ok);
        var originalToken = fixture.Mail.LastToken();
        await fixture.Repository.ExecuteTransactionAsync(document =>
        {
            document.EmailRateLimits.Clear();
            return true;
        });

        var resent = await fixture.Service.ResendEmailVerificationAsync(fixture.UserId, "owner", false);
        Assert.True(resent.Ok);
        var replacementToken = fixture.Mail.LastToken();
        Assert.NotEqual(originalToken, replacementToken);
        Assert.Equal("VERIFICATION_INVALID", (await fixture.Service.VerifyEmailAsync(originalToken)).Code);
        Assert.True((await fixture.Service.VerifyEmailAsync(replacementToken)).Ok);
    }

    [Fact]
    public async Task ExpiredTokenCannotCommitAndRapidResendIsRateLimited()
    {
        var fixture = CreateFixture("owner");
        Assert.True((await fixture.Service.StartEmailVerificationAsync(fixture.UserId, "owner", false, "owner@example.com")).Ok);
        var token = fixture.Mail.LastToken();
        var rateLimited = await fixture.Service.ResendEmailVerificationAsync(fixture.UserId, "owner", false);
        Assert.False(rateLimited.Ok);
        Assert.Equal("VERIFICATION_RATE_LIMITED", rateLimited.Code);

        await fixture.Repository.ExecuteTransactionAsync(document =>
        {
            document.EmailVerifications.Single().ExpiresAtUtc = DateTimeOffset.UtcNow.AddMinutes(-1);
            return true;
        });
        var expired = await fixture.Service.VerifyEmailAsync(token);
        Assert.False(expired.Ok);
        Assert.Equal("VERIFICATION_EXPIRED", expired.Code);
        Assert.Null((await fixture.Repository.ReadAsync()).Profiles.Single().Email);
    }

    [Fact]
    public async Task InvalidTokenCannotCommitAnEmail()
    {
        var fixture = CreateFixture("owner");

        var invalid = await fixture.Service.VerifyEmailAsync("not-a-real-verification-token");

        Assert.False(invalid.Ok);
        Assert.Equal("VERIFICATION_INVALID", invalid.Code);
        Assert.Null((await fixture.Repository.ReadAsync()).Profiles.Single().Email);
    }

    [Fact]
    public async Task ChangeAndSmtpFailureNeverOverwriteExistingCanonicalEmail()
    {
        var fixture = CreateFixture("owner");
        await fixture.Service.ImportVerifiedSignupEmailAsync(fixture.UserId, "owner", "old@example.com");
        fixture.Mail.FailDelivery = true;

        var change = await fixture.Service.StartEmailVerificationAsync(fixture.UserId, "owner", false, "new@example.com");
        Assert.False(change.Ok);
        Assert.Equal("SMTP_FAILURE", change.Code);
        Assert.Equal("old@example.com", change.Profile?.Email);
        Assert.Equal("new@example.com", change.Profile?.PendingEmail);

        var stored = (await fixture.Repository.ReadAsync()).Profiles.Single();
        Assert.Equal("old@example.com", stored.Email);
        Assert.True(stored.EmailVerified);
    }

    [Fact]
    public async Task DuplicateVerifiedEmailIsRejectedAcrossImmutableUserIds()
    {
        var firstId = Guid.NewGuid();
        var secondId = Guid.NewGuid();
        var users = new FakeUserProvider(
            new PtvJellyfinUser(firstId, "first"),
            new PtvJellyfinUser(secondId, "second"));
        var repository = new PtvAccountRepository(_root, NullLogger<PtvAccountRepository>.Instance);
        var backups = new FakeBackupService();
        var mail = new FakeMailService();
        var service = new PtvAccountService(repository, backups, mail, users, new FakeLegacySignupEmailSource(), NullLogger<PtvAccountService>.Instance);
        await service.ImportVerifiedSignupEmailAsync(firstId, "first", "shared@example.com");

        var rejected = await service.StartEmailVerificationAsync(secondId, "second", false, "shared@example.com");
        Assert.False(rejected.Ok);
        Assert.Equal("EMAIL_ALREADY_IN_USE", rejected.Code);
        Assert.Empty(mail.Deliveries);
    }

    [Fact]
    public async Task UsernameSynchronizationDoesNotDeleteVerifiedEmail()
    {
        var fixture = CreateFixture("before");
        await fixture.Service.ImportVerifiedSignupEmailAsync(fixture.UserId, "before", "owner@example.com");
        fixture.Users.Replace(new PtvJellyfinUser(fixture.UserId, "after"));

        var profile = await fixture.Service.GetProfileAsync(fixture.UserId, "after", false);
        Assert.Equal("after", profile.Username);
        Assert.Equal("owner@example.com", profile.Email);
        Assert.True(profile.EmailVerified);
    }

    [Fact]
    public async Task MigrationFailsClosedWhenPreMigrationBackupCannotBeValidated()
    {
        var fixture = CreateFixture("owner");
        fixture.Backups.FailCreation = true;

        var error = await Assert.ThrowsAsync<PtvAccountBackupException>(() => fixture.Service.InitializeAsync());

        Assert.Equal("PRE_MIGRATION_BACKUP_FAILED", error.Code);
        var document = await fixture.Repository.ReadAsync();
        Assert.Equal(0, document.Migration.Version);
        Assert.Empty(document.Profiles);
    }

    [Fact]
    public async Task MigrationRecoversOnlyExactUnambiguousMappingsAndIsRerunSafe()
    {
        var verifiedId = Guid.NewGuid();
        var reverificationId = Guid.NewGuid();
        var ambiguousFirstId = Guid.NewGuid();
        var ambiguousSecondId = Guid.NewGuid();
        var users = new FakeUserProvider(
            new PtvJellyfinUser(verifiedId, "verified"),
            new PtvJellyfinUser(reverificationId, "reverification"),
            new PtvJellyfinUser(ambiguousFirstId, "ambiguous-first"),
            new PtvJellyfinUser(ambiguousSecondId, "ambiguous-second"));
        var repository = new PtvAccountRepository(_root, NullLogger<PtvAccountRepository>.Instance);
        var backups = new FakeBackupService();
        var legacy = new FakeLegacySignupEmailSource(
            LegacyRecord(verifiedId, "verified@example.com", "native-signup"),
            LegacyRecord(reverificationId, "review@example.com", "admin-mapped"),
            LegacyRecord(ambiguousFirstId, "shared@example.com", "native-signup"),
            LegacyRecord(ambiguousSecondId, "shared@example.com", "native-signup"),
            LegacyRecord(Guid.NewGuid(), "orphan@example.com", "native-signup"));
        var service = new PtvAccountService(
            repository,
            backups,
            new FakeMailService(),
            users,
            legacy,
            NullLogger<PtvAccountService>.Instance);

        var migration = await service.InitializeAsync();
        var rerun = await service.InitializeAsync();
        var document = await repository.ReadAsync();

        Assert.Equal(4, migration.JellyfinUsersDiscovered);
        Assert.Equal(1, migration.VerifiedEmailsRecovered);
        Assert.Equal(1, migration.UnverifiedEmailsRecovered);
        Assert.Equal(3, migration.AmbiguousRecordsSkipped);
        Assert.Equal(1, migration.OrphanedRecordsFound);
        Assert.Equal(2, migration.UsersStillMissingEmail);
        Assert.Equal(migration.CompletedAtUtc, rerun.CompletedAtUtc);
        Assert.Equal(["pre_migration"], backups.Reasons);
        Assert.Equal("verified@example.com", document.Profiles.Single(profile => profile.JellyfinUserId == verifiedId.ToString("N")).Email);
        Assert.Equal("review@example.com", document.Profiles.Single(profile => profile.JellyfinUserId == reverificationId.ToString("N")).RecoveryEmail);
        Assert.All(document.Profiles.Where(profile => profile.JellyfinUserId == ambiguousFirstId.ToString("N")
                || profile.JellyfinUserId == ambiguousSecondId.ToString("N")),
            profile => Assert.Null(profile.Email));
    }

    [Fact]
    public async Task AdminUsersReturnsSafeBatchWithoutSynchronizingOrWritingProfiles()
    {
        var verifiedId = Guid.NewGuid();
        var recoveryId = Guid.NewGuid();
        var missingId = Guid.NewGuid();
        var orphanId = Guid.NewGuid();
        var users = new FakeUserProvider(
            new PtvJellyfinUser(missingId, "alpha-missing"),
            new PtvJellyfinUser(recoveryId, "beta-recovery"),
            new PtvJellyfinUser(verifiedId, "gamma-verified"));
        var repository = new PtvAccountRepository(_root, NullLogger<PtvAccountRepository>.Instance);
        var backups = new FakeBackupService();
        var service = new PtvAccountService(
            repository,
            backups,
            new FakeMailService(),
            users,
            new FakeLegacySignupEmailSource(),
            NullLogger<PtvAccountService>.Instance);
        var now = DateTimeOffset.UtcNow;
        var tokenHash = new string('a', 64);

        await repository.ReplaceAsync(new PtvAccountDocument
        {
            Profiles =
            [
                new PtvProfileRecord
                {
                    Email = "owner@example.com",
                    EmailNormalized = "owner@example.com",
                    EmailVerified = true,
                    EmailVerifiedAtUtc = now.AddDays(-2),
                    JellyfinUserId = verifiedId.ToString("N"),
                    UsernameSnapshot = "old-verified-name"
                },
                new PtvProfileRecord
                {
                    JellyfinUserId = recoveryId.ToString("N"),
                    RecoveryEmail = "recover@example.com",
                    RecoveryEmailNormalized = "recover@example.com",
                    UsernameSnapshot = "beta-recovery"
                },
                new PtvProfileRecord
                {
                    Email = "orphan@example.com",
                    EmailNormalized = "orphan@example.com",
                    EmailVerified = true,
                    EmailVerifiedAtUtc = now.AddDays(-3),
                    JellyfinUserId = orphanId.ToString("N"),
                    UsernameSnapshot = "orphan"
                }
            ],
            EmailVerifications =
            [
                new PtvEmailVerificationRecord
                {
                    CreatedAtUtc = now.AddMinutes(-5),
                    DeliveryStatus = "sent",
                    ExpiresAtUtc = now.AddHours(1),
                    Id = "pending-change",
                    JellyfinUserId = verifiedId.ToString("N"),
                    PendingEmail = "new-address@example.com",
                    PendingEmailNormalized = "new-address@example.com",
                    TokenHash = tokenHash
                }
            ]
        });
        var before = await File.ReadAllBytesAsync(repository.FilePath);

        var response = await service.GetAdminUsersAsync();

        var after = await File.ReadAllBytesAsync(repository.FilePath);
        Assert.True(before.SequenceEqual(after));
        Assert.Empty(backups.Reasons);
        Assert.True(response.Ok);
        Assert.Equal(3, response.Users.Count);
        Assert.DoesNotContain(response.Users, user => user.JellyfinUserId == orphanId.ToString("N"));

        var verified = Assert.Single(response.Users, user => user.JellyfinUserId == verifiedId.ToString("N"));
        Assert.Equal("owner@example.com", verified.Email);
        Assert.True(verified.EmailVerified);
        Assert.Equal("pending", verified.EmailStatus);
        Assert.Equal("n***@example.com", verified.MaskedEmail);
        Assert.Equal("present", verified.ProfileStatus);

        var recovery = Assert.Single(response.Users, user => user.JellyfinUserId == recoveryId.ToString("N"));
        Assert.Null(recovery.Email);
        Assert.False(recovery.EmailVerified);
        Assert.Equal("reverification_required", recovery.EmailStatus);
        Assert.Equal("r***@example.com", recovery.MaskedEmail);

        var missing = Assert.Single(response.Users, user => user.JellyfinUserId == missingId.ToString("N"));
        Assert.Null(missing.Email);
        Assert.Equal("missing", missing.EmailStatus);
        Assert.Equal("missing", missing.ProfileStatus);

        var serialized = System.Text.Json.JsonSerializer.Serialize(response);
        Assert.DoesNotContain("new-address@example.com", serialized, StringComparison.Ordinal);
        Assert.DoesNotContain("recover@example.com", serialized, StringComparison.Ordinal);
        Assert.DoesNotContain(tokenHash, serialized, StringComparison.Ordinal);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private Fixture CreateFixture(string username)
    {
        var userId = Guid.NewGuid();
        var users = new FakeUserProvider(new PtvJellyfinUser(userId, username));
        var repository = new PtvAccountRepository(_root, NullLogger<PtvAccountRepository>.Instance);
        var backups = new FakeBackupService();
        var mail = new FakeMailService();
        var legacy = new FakeLegacySignupEmailSource();
        var service = new PtvAccountService(repository, backups, mail, users, legacy, NullLogger<PtvAccountService>.Instance);
        return new Fixture(userId, repository, backups, mail, users, service);
    }

    private static SignupUserRecord LegacyRecord(Guid userId, string email, string remoteAddress) => new()
    {
        CreatedAtUtc = DateTimeOffset.UtcNow.AddDays(-1),
        Email = email,
        RemoteAddress = remoteAddress,
        UserId = userId.ToString(),
        Username = "legacy"
    };

    private sealed record Fixture(
        Guid UserId,
        PtvAccountRepository Repository,
        FakeBackupService Backups,
        FakeMailService Mail,
        FakeUserProvider Users,
        PtvAccountService Service);

    private sealed class FakeBackupService : IPtvAccountBackupService
    {
        public bool FailCreation { get; set; }

        public List<string> Reasons { get; } = [];

        public Task<PtvAccountBackupOperationResponse> CreateBackupAsync(string reason, CancellationToken cancellationToken = default)
        {
            Reasons.Add(reason);
            return Task.FromResult(FailCreation
                ? new PtvAccountBackupOperationResponse { Code = "BACKUP_FAILED", Message = "failed", Ok = false }
                : new PtvAccountBackupOperationResponse { Code = "OK", Message = "ok", Ok = true, Verified = true });
        }

        public Task<PtvAccountBackupStatus> GetStatusAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(new PtvAccountBackupStatus());

        public Task<PtvAccountBackupOperationResponse> RestoreBackupAsync(string backupId, bool dryRun, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<PtvAccountBackupOperationResponse> VerifyBackupAsync(string backupId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class FakeLegacySignupEmailSource(params SignupUserRecord[] records) : IPtvLegacySignupEmailSource
    {
        public IReadOnlyList<SignupUserRecord> GetRecords() => records;
    }

    private sealed class FakeUserProvider(params PtvJellyfinUser[] users) : IPtvJellyfinUserProvider
    {
        private readonly List<PtvJellyfinUser> _users = [.. users];

        public PtvJellyfinUser? GetById(Guid userId) => _users.FirstOrDefault(user => user.Id == userId);

        public IReadOnlyList<PtvJellyfinUser> GetUsers() => _users.ToList();

        public void Replace(PtvJellyfinUser user)
        {
            _users.RemoveAll(candidate => candidate.Id == user.Id);
            _users.Add(user);
        }
    }

    private sealed class FakeMailService : IPtvMailService
    {
        public List<(string Recipient, string Subject, PtvMailContent Content)> Deliveries { get; } = [];

        public bool FailDelivery { get; set; }

        public bool IsConfigured => true;

        public string PublicBaseUrl => "https://watch.example";

        public int VerificationExpiryMinutes => 1440;

        public string ResolveLogoUrl(string referenceUrl) => "https://watch.example/web/assets/logo/banner-light.png";

        public Task SendAsync(string recipient, string subject, PtvMailContent content, CancellationToken cancellationToken = default)
        {
            if (FailDelivery) throw new PtvMailDeliveryException("SMTP_FAILURE", "test failure");
            Deliveries.Add((recipient, subject, content));
            return Task.CompletedTask;
        }

        public string LastToken()
        {
            var text = Deliveries.Last().Content.PlainText;
            const string marker = "#/settings/profile?verify=";
            var start = text.IndexOf(marker, StringComparison.Ordinal);
            Assert.True(start >= 0);
            start += marker.Length;
            var end = text.IndexOfAny(['\r', '\n'], start);
            return (end < 0 ? text[start..] : text[start..end]).Trim();
        }
    }
}
