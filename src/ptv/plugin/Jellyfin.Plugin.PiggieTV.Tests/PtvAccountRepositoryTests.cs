using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvAccountRepositoryTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ptv-account-repository-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task PersistsProfileByImmutableUserIdAndRetainsEmailAcrossRename()
    {
        var repository = CreateRepository();
        var userId = Guid.NewGuid().ToString("N");
        await repository.ExecuteTransactionAsync(document =>
        {
            document.Profiles.Add(VerifiedProfile(userId, "before", "person@example.com"));
            return true;
        });

        await repository.ExecuteTransactionAsync(document =>
        {
            document.Profiles.Single().UsernameSnapshot = "after";
            return true;
        });

        var stored = await repository.ReadAsync();
        Assert.Equal(userId, stored.Profiles.Single().JellyfinUserId);
        Assert.Equal("after", stored.Profiles.Single().UsernameSnapshot);
        Assert.Equal("person@example.com", stored.Profiles.Single().Email);
        Assert.True(stored.Profiles.Single().EmailVerified);
    }

    [Fact]
    public async Task RejectsDuplicateCanonicalEmailWithoutReplacingLastGoodData()
    {
        var repository = CreateRepository();
        await repository.ExecuteTransactionAsync(document =>
        {
            document.Profiles.Add(VerifiedProfile(Guid.NewGuid().ToString("N"), "one", "same@example.com"));
            return true;
        });

        await Assert.ThrowsAsync<PtvAccountDataException>(() => repository.ExecuteTransactionAsync(document =>
        {
            document.Profiles.Add(VerifiedProfile(Guid.NewGuid().ToString("N"), "two", "same@example.com"));
            return true;
        }));

        var stored = await repository.ReadAsync();
        Assert.Single(stored.Profiles);
        Assert.Equal("one", stored.Profiles.Single().UsernameSnapshot);
    }

    [Fact]
    public async Task RejectsRawOrMalformedActiveTokenMaterial()
    {
        var repository = CreateRepository();
        await Assert.ThrowsAsync<PtvAccountDataException>(() => repository.ExecuteTransactionAsync(document =>
        {
            var userId = Guid.NewGuid().ToString("N");
            document.Profiles.Add(new PtvProfileRecord { JellyfinUserId = userId, UsernameSnapshot = "owner" });
            document.EmailVerifications.Add(new PtvEmailVerificationRecord
            {
                Id = Guid.NewGuid().ToString("N"),
                JellyfinUserId = userId,
                PendingEmail = "owner@example.com",
                PendingEmailNormalized = "owner@example.com",
                TokenHash = "this-is-a-raw-token"
            });
            return true;
        }));
        Assert.False(File.Exists(repository.FilePath));
    }

    [Fact]
    public async Task SerializesConcurrentTransactionsWithoutLostProfiles()
    {
        var repository = CreateRepository();
        var tasks = Enumerable.Range(0, 24).Select(index => repository.ExecuteTransactionAsync(document =>
        {
            document.Profiles.Add(new PtvProfileRecord
            {
                JellyfinUserId = Guid.NewGuid().ToString("N"),
                UsernameSnapshot = $"user-{index}"
            });
            return true;
        }));

        await Task.WhenAll(tasks);
        var stored = await repository.ReadAsync();
        Assert.Equal(24, stored.Profiles.Count);
        Assert.Equal(24, stored.Profiles.Select(profile => profile.JellyfinUserId).Distinct().Count());
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private PtvAccountRepository CreateRepository() => new(_root, NullLogger<PtvAccountRepository>.Instance);

    internal static PtvProfileRecord VerifiedProfile(string userId, string username, string email) => new()
    {
        CreatedAtUtc = DateTimeOffset.UtcNow,
        Email = email,
        EmailNormalized = email.ToLowerInvariant(),
        EmailSource = "test",
        EmailVerified = true,
        EmailVerifiedAtUtc = DateTimeOffset.UtcNow,
        JellyfinUserId = userId,
        LastJellyfinSyncAtUtc = DateTimeOffset.UtcNow,
        UpdatedAtUtc = DateTimeOffset.UtcNow,
        UsernameSnapshot = username
    };
}
