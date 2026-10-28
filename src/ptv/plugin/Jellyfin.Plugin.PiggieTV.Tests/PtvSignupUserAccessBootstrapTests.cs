using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvSignupUserAccessBootstrapTests
{
    private static readonly string Epoch = new('A', 64);

    [Fact]
    public async Task New_user_is_denied_before_begin_and_held_before_any_policy_write()
    {
        using var fixture = new Fixture();
        var current = Access(fixture.UserId, enableAll: true);
        var intended = Access(fixture.UserId, enableAll: false);
        var writes = 0;
        var before = await fixture.Ledger.ReadAsync(fixture.UserId, current, Epoch);
        Assert.True(before.Held);
        Assert.False(before.PolicyProven);

        var result = await PtvSignupUserAccessBootstrap.ExecuteAsync(fixture.UserId, intended, fixture.Ledger,
            _ => Task.FromResult<PtvHomeAccessDefinition?>(current),
            _ => Task.FromResult<string?>(Epoch),
            async _ =>
            {
                var held = await fixture.Ledger.ReadAsync(fixture.UserId, current, Epoch);
                Assert.True(held.Held);
                Assert.False(held.PolicyProven);
                writes++;
                current = intended;
            }, CancellationToken.None,
            readAccessibleLibraries: _ => Task.FromResult<IReadOnlyCollection<string>?>([]));

        Assert.Equal(1, writes);
        Assert.False(result.Held);
        Assert.True(result.PolicyProven);
        Assert.True((await fixture.Ledger.ReadAsync(fixture.UserId, current, Epoch,
            currentAccessibleLibraryIds: [])).PolicyProven);
    }

    [Fact]
    public async Task Equal_default_policy_still_requires_a_write_before_bootstrap_completion()
    {
        using var fixture = new Fixture();
        var current = Access(fixture.UserId, enableAll: true);
        var writes = 0;
        var result = await PtvSignupUserAccessBootstrap.ExecuteAsync(fixture.UserId, current, fixture.Ledger,
            _ => Task.FromResult<PtvHomeAccessDefinition?>(current),
            _ => Task.FromResult<string?>(Epoch),
            _ => { writes++; return Task.CompletedTask; }, CancellationToken.None,
            readAccessibleLibraries: _ => Task.FromResult<IReadOnlyCollection<string>?>([]));

        Assert.Equal(1, writes);
        Assert.True(result.PolicyProven);
    }

    [Fact]
    public async Task Missing_user_aware_membership_readback_keeps_signup_Home_unproven()
    {
        using var fixture = new Fixture();
        var current = Access(fixture.UserId, enableAll: true);
        var intended = Access(fixture.UserId, enableAll: false);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            PtvSignupUserAccessBootstrap.ExecuteAsync(fixture.UserId, intended, fixture.Ledger,
                _ => Task.FromResult<PtvHomeAccessDefinition?>(current),
                _ => Task.FromResult<string?>(Epoch),
                _ => { current = intended; return Task.CompletedTask; }, CancellationToken.None));

        Assert.False((await fixture.Ledger.ReadAsync(fixture.UserId, current, Epoch)).PolicyProven);
    }

    [Fact]
    public async Task Signup_attests_only_after_fresh_user_aware_membership_readback()
    {
        using var fixture = new Fixture();
        var current = Access(fixture.UserId, enableAll: true);
        var intended = Access(fixture.UserId, enableAll: false);
        var readbacks = 0;

        var result = await PtvSignupUserAccessBootstrap.ExecuteAsync(fixture.UserId, intended, fixture.Ledger,
            _ => Task.FromResult<PtvHomeAccessDefinition?>(current),
            _ => Task.FromResult<string?>(Epoch),
            _ => { current = intended; return Task.CompletedTask; }, CancellationToken.None,
            readAccessibleLibraries: _ =>
            {
                readbacks++;
                return Task.FromResult<IReadOnlyCollection<string>?>([]);
            });

        Assert.True(result.PolicyProven);
        Assert.True(readbacks > 0);
        Assert.True((await fixture.Ledger.ReadAsync(fixture.UserId, current, Epoch,
            currentAccessibleLibraryIds: [])).PolicyProven);
    }

    [Fact]
    public async Task Profile_or_signup_record_failure_before_completion_keeps_the_new_user_held()
    {
        using var fixture = new Fixture();
        var current = Access(fixture.UserId, enableAll: true);
        var intended = Access(fixture.UserId, enableAll: false);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            PtvSignupUserAccessBootstrap.ExecuteAsync(fixture.UserId, intended, fixture.Ledger,
                _ => Task.FromResult<PtvHomeAccessDefinition?>(current),
                _ => Task.FromResult<string?>(Epoch),
                _ => { current = intended; return Task.CompletedTask; }, CancellationToken.None,
                finishProvisioning: _ => throw new InvalidOperationException("profile unavailable")));

        var view = await fixture.Ledger.ReadAsync(fixture.UserId, current, Epoch);
        Assert.True(view.Held);
        Assert.False(view.PolicyProven);
    }

    [Theory]
    [InlineData("policy-changed")]
    [InlineData("topology-changed")]
    public async Task Bootstrap_rechecks_authority_after_provisioning_before_completion(string change)
    {
        using var fixture = new Fixture();
        var current = Access(fixture.UserId, enableAll: true);
        var intended = Access(fixture.UserId, enableAll: false);
        var epoch = Epoch;
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            PtvSignupUserAccessBootstrap.ExecuteAsync(fixture.UserId, intended, fixture.Ledger,
                _ => Task.FromResult<PtvHomeAccessDefinition?>(current),
                _ => Task.FromResult<string?>(epoch),
                _ => { current = intended; return Task.CompletedTask; }, CancellationToken.None,
                finishProvisioning: _ =>
                {
                    if (change == "policy-changed") current = Access(fixture.UserId, enableAll: true);
                    else epoch = new string('B', 64);
                    return Task.CompletedTask;
                }));

        var view = await fixture.Ledger.ReadAsync(fixture.UserId, current, epoch);
        Assert.True(view.Held);
        Assert.False(view.PolicyProven);
    }

    [Fact]
    public async Task Native_signup_reserves_migration_before_create_and_binds_returned_ID_before_bootstrap()
    {
        using var fixture = new Fixture(markCreated: false);
        var creationId = Guid.NewGuid();
        var created = await PtvSignupCreationReservation.CreateAndBindAsync(fixture.Ledger, creationId,
            [], async _ =>
            {
                Assert.Single(await fixture.Ledger.ReadPendingCreationsAsync([], CancellationToken.None));
                return fixture.UserId;
            }, id => id, CancellationToken.None);

        Assert.Equal(fixture.UserId, created);
        Assert.Empty(await fixture.Ledger.ReadPendingCreationsAsync([fixture.UserId], CancellationToken.None));
        var view = await fixture.Ledger.ReadAsync(fixture.UserId, Access(fixture.UserId, enableAll: true), Epoch);
        Assert.True(view.Held);
        Assert.False(view.PolicyProven);
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([fixture.UserId], Epoch);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.VerifyBatchCandidateAsync(
            batch.Id, fixture.UserId, Access(fixture.UserId, true), Access(fixture.UserId, true), [], Epoch));
    }

    [Fact]
    public async Task Uncertain_native_create_failure_keeps_the_migration_reservation_active()
    {
        using var fixture = new Fixture(markCreated: false);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            PtvSignupCreationReservation.CreateAndBindAsync(fixture.Ledger, Guid.NewGuid(), [],
                _ => throw new InvalidOperationException("Jellyfin creation outcome unknown"),
                (Guid id) => id, CancellationToken.None));
        Assert.Single(await fixture.Ledger.ReadPendingCreationsAsync([], CancellationToken.None));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            fixture.Ledger.BeginVerificationBatchAsync([], Epoch));
    }

    [Theory]
    [InlineData("write-failed")]
    [InlineData("readback-mismatch")]
    [InlineData("epoch-changed")]
    public async Task Failed_bootstrap_leaves_owned_Home_unproven(string failure)
    {
        using var fixture = new Fixture();
        var current = Access(fixture.UserId, enableAll: true);
        var intended = Access(fixture.UserId, enableAll: false);
        var epoch = Epoch;
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            PtvSignupUserAccessBootstrap.ExecuteAsync(fixture.UserId, intended, fixture.Ledger,
                _ => Task.FromResult<PtvHomeAccessDefinition?>(current),
                _ => Task.FromResult<string?>(epoch),
                _ =>
                {
                    if (failure == "write-failed") throw new InvalidOperationException("write failed");
                    if (failure != "readback-mismatch") current = intended;
                    if (failure == "epoch-changed") epoch = new string('B', 64);
                    return Task.CompletedTask;
                }, CancellationToken.None));

        var view = await fixture.Ledger.ReadAsync(fixture.UserId, current, epoch);
        Assert.True(view.Held);
        Assert.False(view.PolicyProven);
    }

    private static PtvHomeAccessDefinition Access(Guid userId, bool enableAll) => new()
    {
        UserId = userId.ToString("N"),
        EnableAllFolders = enableAll,
        EnabledFolders = [],
        IsAdministrator = false,
        IsDisabled = false
    };

    private sealed class Fixture : IDisposable
    {
        private readonly string _directory = Path.Combine(Path.GetTempPath(), $"ptv-signup-bootstrap-{Guid.NewGuid():N}");
        internal Guid UserId { get; } = Guid.NewGuid();
        internal PtvHomeUserAccessLedger Ledger { get; }

        internal Fixture(bool markCreated = true)
        {
            Ledger = new PtvHomeUserAccessLedger(_directory, "signup-test-server");
            if (!markCreated) return;
            var operationId = Guid.NewGuid();
            Ledger.ReserveCreationAsync(operationId, []).GetAwaiter().GetResult();
            Ledger.BindCreationAsync(operationId, UserId).GetAwaiter().GetResult();
        }

        public void Dispose()
        {
            if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
        }
    }
}
