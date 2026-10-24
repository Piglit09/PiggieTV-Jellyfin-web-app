using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvHomeUserAccessTests
{
    private static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly string LibraryId = Guid.Parse("22222222-2222-2222-2222-222222222222").ToString("N");
    private static readonly string TopologyEpoch = new('A', 64);

    [Fact]
    public void PluginRegistersDurableUserAccessAuthority()
    {
        var services = new ServiceCollection();
        new PluginServiceRegistrator().RegisterServices(services, null!);
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IPtvHomeUserAccessLedger)
            && descriptor.Lifetime == ServiceLifetime.Singleton);
    }

    [Fact]
    public async Task UnknownNewUserStaysUnprovenDespiteBroadJellyfinDefaultPolicy()
    {
        using var fixture = new Fixture();
        var current = await fixture.Ledger.ReadAsync(UserId, Access(all: true), TopologyEpoch);

        Assert.True(current.Held);
        Assert.False(current.PolicyProven);
        Assert.Null(current.AccessEpoch);
    }

    [Fact]
    public async Task UnverifiedFirstInstallIdCannotBypassLegacyCohortUsingBootstrap()
    {
        using var fixture = new Fixture();
        var broad = Access(all: true);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = UserId.ToString("N"), Mode = "bootstrap",
            IntendedAccess = broad
        }, broad, TopologyEpoch));
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        Assert.Equal([UserId.ToString("N")], batch.CandidateUserIds);
        Assert.False((await fixture.Ledger.ReadAsync(UserId, broad, TopologyEpoch)).PolicyProven);
    }

    [Fact]
    public async Task BoundControlledCreateCanBootstrapButReplayOrHeldNewBootstrapCannotRewrite()
    {
        using var fixture = new Fixture();
        var broad = Access(all: true);
        var restrictive = Access(all: false, folders: [LibraryId]);
        var creationId = Guid.NewGuid();
        await fixture.Ledger.ReserveCreationAsync(creationId, []);
        await fixture.Ledger.BindCreationAsync(creationId, UserId);
        var operationId = Guid.NewGuid();
        var intent = new PtvHomeUserAccessIntent
        {
            OperationId = operationId, UserId = UserId.ToString("N"), Mode = "bootstrap",
            IntendedAccess = restrictive
        };
        var begun = await fixture.Ledger.BeginAsync(intent, broad, TopologyEpoch);
        Assert.True(begun.Held);
        Assert.True(begun.WriteAllowed);
        var replay = await fixture.Ledger.BeginAsync(intent, broad, TopologyEpoch);
        Assert.False(replay.WriteAllowed);
        Assert.Equal(begun.AccessEpoch, replay.AccessEpoch);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = UserId.ToString("N"), Mode = "bootstrap",
            IntendedAccess = restrictive
        }, broad, TopologyEpoch));
        Assert.False((await fixture.Ledger.CompleteAsync(operationId, broad, TopologyEpoch, currentAccessibleLibraryIds: [])).PolicyProven);
        var recoveryId = Guid.NewGuid();
        var recovery = await fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = recoveryId, SupersedesOperationId = operationId,
            UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = broad, IntendedAccess = restrictive
        }, broad, TopologyEpoch);
        Assert.True(recovery.WriteAllowed);
        Assert.True((await fixture.Ledger.CompleteAsync(recoveryId, restrictive, TopologyEpoch, currentAccessibleLibraryIds: [])).PolicyProven);
    }

    [Fact]
    public async Task ExistingAccessBeginHoldsBeforePolicyWriteAndCompleteRequiresExactReadback()
    {
        using var fixture = new Fixture();
        var original = Access(all: true);
        var intended = Access(all: false, folders: [LibraryId]);
        var operationId = Guid.NewGuid();
        var intent = new PtvHomeUserAccessIntent
        {
            OperationId = operationId,
            UserId = UserId.ToString("N"),
            Mode = "existing",
            ExpectedAccess = original,
            IntendedAccess = intended
        };

        var begun = await fixture.Ledger.BeginAsync(intent, original, TopologyEpoch);
        Assert.True(begun.Held);
        Assert.True(begun.WriteAllowed);
        Assert.False((await fixture.Ledger.ReadAsync(UserId, original, TopologyEpoch)).PolicyProven);

        var failed = await fixture.Ledger.CompleteAsync(operationId, original, TopologyEpoch, currentAccessibleLibraryIds: []);
        Assert.True(failed.Held);
        Assert.False(failed.PolicyProven);

        var completed = await fixture.Ledger.CompleteAsync(operationId, intended, TopologyEpoch, currentAccessibleLibraryIds: []);
        Assert.False(completed.Held);
        Assert.True(completed.PolicyProven);
        Assert.Equal(intended.EnabledFolders, (await fixture.Ledger.ReadAsync(UserId, intended, TopologyEpoch,
            currentAccessibleLibraryIds: [])).AttestedAccess!.EnabledFolders);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DifferentOperationCannotEraseHeldUserRecoveryIntent(bool failed)
    {
        using var fixture = new Fixture();
        var original = Access(all: true);
        var firstId = Guid.NewGuid();
        await fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = firstId, UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = original, IntendedAccess = Access(all: false, folders: [LibraryId])
        }, original, TopologyEpoch);
        if (failed) await fixture.Ledger.CompleteAsync(firstId, original, TopologyEpoch, currentAccessibleLibraryIds: []);

        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = original, IntendedAccess = Access(all: true)
        }, original, TopologyEpoch));

        var current = await fixture.Ledger.ReadAsync(UserId, original, TopologyEpoch);
        Assert.True(current.Held);
        Assert.Equal(firstId, current.OperationId);
    }

    [Fact]
    public async Task ExplicitSupersedeUsesExactCurrentPolicyAndRetainsUncertainIntent()
    {
        using var fixture = new Fixture();
        var original = Access(all: true);
        var firstId = Guid.NewGuid();
        await fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = firstId, UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = original, IntendedAccess = Access(all: false, folders: [LibraryId])
        }, original, TopologyEpoch);
        await fixture.Ledger.CompleteAsync(firstId, original, TopologyEpoch, currentAccessibleLibraryIds: []);
        var changed = Access(all: false, folders: [LibraryId]);
        var replacementId = Guid.NewGuid();
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = replacementId, UserId = UserId.ToString("N"), Mode = "existing",
            SupersedesOperationId = firstId, ExpectedAccess = changed, IntendedAccess = original
        }, original, TopologyEpoch));

        var replacement = await fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = replacementId, UserId = UserId.ToString("N"), Mode = "existing",
            SupersedesOperationId = firstId, ExpectedAccess = original, IntendedAccess = changed
        }, original, TopologyEpoch);
        Assert.True(replacement.Held);
        Assert.True(replacement.WriteAllowed);
        Assert.Equal(replacementId, replacement.OperationId);
        Assert.Equal(firstId, replacement.SupersededOperationId);
        Assert.Equal(changed.EnabledFolders, replacement.IntendedAccess!.EnabledFolders);
        var restarted = new PtvHomeUserAccessLedger(fixture.DirectoryPath, "server-a");
        var persisted = await restarted.ReadAsync(UserId, original, TopologyEpoch);
        Assert.Equal(firstId, persisted.SupersededOperationId);
        Assert.True(persisted.Held);
    }

    [Fact]
    public async Task SameAccessExistingSupersedeRecoversSucceededWriteAfterStaleTopologyCompletion()
    {
        using var fixture = new Fixture();
        var original = Access(all: true);
        var intended = Access(all: false, folders: [LibraryId]);
        var firstId = Guid.NewGuid();
        await fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = firstId, UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = original, IntendedAccess = intended
        }, original, TopologyEpoch);
        var currentEpoch = new string('B', 64);
        var failed = await fixture.Ledger.CompleteAsync(firstId, intended, currentEpoch, currentAccessibleLibraryIds: []);
        Assert.True(failed.Held);
        Assert.False(failed.PolicyProven);
        Assert.Equal("failed", failed.State);

        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = intended, IntendedAccess = intended
        }, intended, currentEpoch));
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), SupersedesOperationId = firstId,
            UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = original, IntendedAccess = original
        }, original, currentEpoch));

        var secondId = Guid.NewGuid();
        var begun = await fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = secondId, SupersedesOperationId = firstId,
            UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = intended, IntendedAccess = intended
        }, intended, currentEpoch);
        Assert.True(begun.Held);
        Assert.True(begun.WriteAllowed);
        Assert.NotEqual(failed.AccessEpoch, begun.AccessEpoch);
        Assert.Equal(firstId, begun.SupersededOperationId);
        Assert.True((await fixture.Ledger.CompleteAsync(secondId, intended, currentEpoch, currentAccessibleLibraryIds: [])).PolicyProven);
    }

    [Fact]
    public async Task PersistedNoOpExistingWithoutSupersededIntentFailsClosed()
    {
        using var fixture = new Fixture();
        var broad = Access(all: true);
        await fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = broad, IntendedAccess = Access(all: false, folders: [LibraryId])
        }, broad, TopologyEpoch);
        var path = Path.Combine(fixture.DirectoryPath, "home-user-access.json");
        var root = System.Text.Json.Nodes.JsonNode.Parse(await File.ReadAllTextAsync(path))!;
        root["Records"]![UserId.ToString("N")]!["IntendedAccess"] = System.Text.Json.JsonSerializer.SerializeToNode(broad);
        await File.WriteAllTextAsync(path, root.ToJsonString());

        var restarted = new PtvHomeUserAccessLedger(fixture.DirectoryPath, "server-a");
        var view = await restarted.ReadAsync(UserId, broad, TopologyEpoch);
        Assert.Equal("recovery-required", view.State);
        Assert.True(view.Held);
    }

    [Fact]
    public async Task PendingExistingUserHoldSurvivesRestartForSameOperationReadback()
    {
        using var fixture = new Fixture();
        var original = Access(all: true);
        var intended = Access(all: false, folders: [LibraryId]);
        var operationId = Guid.NewGuid();
        var begun = await fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = operationId, UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = original, IntendedAccess = intended
        }, original, TopologyEpoch);
        var restarted = new PtvHomeUserAccessLedger(fixture.DirectoryPath, "server-a");
        var pending = await restarted.ReadAsync(UserId, intended, TopologyEpoch);
        Assert.True(pending.Held);
        Assert.Equal(operationId, pending.OperationId);
        Assert.Equal(begun.AccessEpoch, pending.AccessEpoch);
        var completed = await restarted.CompleteAsync(operationId, intended, TopologyEpoch, currentAccessibleLibraryIds: []);
        Assert.True(completed.PolicyProven);
        Assert.Equal(begun.AccessEpoch, completed.AccessEpoch);
    }

    [Fact]
    public async Task PreserveModeRequiresPreviouslyAttestedExactPolicyAndRotatesHeldEpoch()
    {
        using var fixture = new Fixture();
        var policy = Access(all: true);
        var preserve = new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = UserId.ToString("N"), Mode = "preserve",
            ExpectedAccess = policy, IntendedAccess = policy
        };
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(
            preserve, policy, TopologyEpoch));
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = policy, IntendedAccess = policy
        }, policy, TopologyEpoch));

        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        var previous = await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId,
            policy, policy, [LibraryId], TopologyEpoch);
        var begun = await fixture.Ledger.BeginAsync(preserve, policy, TopologyEpoch);
        Assert.True(begun.Held);
        Assert.True(begun.WriteAllowed);
        Assert.NotEqual(previous.AccessEpoch, begun.AccessEpoch);
        Assert.False((await fixture.Ledger.ReadAsync(UserId, policy, TopologyEpoch)).PolicyProven);
        var complete = await fixture.Ledger.CompleteAsync(preserve.OperationId, policy, TopologyEpoch, currentAccessibleLibraryIds: []);
        Assert.True(complete.PolicyProven);
        Assert.False(complete.Held);
    }

    [Fact]
    public async Task PreserveModeRejectsAccessChangeButAllowsCurrentPolicyReproofAtNewTopology()
    {
        using var fixture = new Fixture();
        var policy = Access(all: true);
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId,
            policy, policy, [LibraryId], TopologyEpoch);
        var preserve = new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = UserId.ToString("N"), Mode = "preserve",
            ExpectedAccess = policy, IntendedAccess = policy
        };
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(
            preserve, Access(all: false), TopologyEpoch));
        var newTopologyEpoch = new string('B', 64);
        var begun = await fixture.Ledger.BeginAsync(preserve, policy, newTopologyEpoch);
        Assert.True(begun.Held);
        Assert.True(begun.WriteAllowed);
        Assert.False(begun.PolicyProven);
        var complete = await fixture.Ledger.CompleteAsync(preserve.OperationId, policy, newTopologyEpoch, currentAccessibleLibraryIds: []);
        Assert.True(complete.PolicyProven);
    }

    [Fact]
    public async Task PriorAttestedExactPolicyCanBeReprovedAtCurrentTopologyEpoch()
    {
        using var fixture = new Fixture();
        var broad = Access(all: true);
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        var previous = await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId,
            broad, broad, [LibraryId], TopologyEpoch);
        var currentEpoch = new string('B', 64);
        Assert.False((await fixture.Ledger.ReadAsync(UserId, broad, currentEpoch)).PolicyProven);
        var intent = new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = UserId.ToString("N"), Mode = "preserve",
            ExpectedAccess = broad, IntendedAccess = broad
        };
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(
            intent, Access(all: false, folders: [LibraryId]), currentEpoch));
        var begun = await fixture.Ledger.BeginAsync(intent, broad, currentEpoch);
        Assert.True(begun.Held);
        Assert.True(begun.WriteAllowed);
        Assert.NotEqual(previous.AccessEpoch, begun.AccessEpoch);
        Assert.True((await fixture.Ledger.CompleteAsync(intent.OperationId, broad, currentEpoch, currentAccessibleLibraryIds: [])).PolicyProven);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PriorAttestedUserCanExplicitlyConfirmChangedCurrentBroadOrAdminPolicy(bool administrator)
    {
        using var fixture = new Fixture();
        var previouslyAttested = Access(all: false, folders: [LibraryId]);
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId,
            previouslyAttested, previouslyAttested, [LibraryId], TopologyEpoch);
        var changedCurrent = new PtvHomeAccessDefinition
        {
            UserId = UserId.ToString("N"), EnableAllFolders = !administrator,
            EnabledFolders = administrator ? [LibraryId] : [], IsAdministrator = administrator
        };
        var currentEpoch = new string('B', 64);
        var drifted = await fixture.Ledger.ReadAsync(UserId, changedCurrent, currentEpoch);
        Assert.Equal("policy-attested", drifted.State);
        Assert.True(drifted.Held);
        Assert.False(drifted.PolicyProven);
        var operationId = Guid.NewGuid();
        var begun = await fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = operationId, UserId = UserId.ToString("N"), Mode = "reproof",
            ExpectedAccess = changedCurrent, IntendedAccess = changedCurrent
        }, changedCurrent, currentEpoch);
        Assert.True(begun.Held);
        Assert.True(begun.WriteAllowed);
        var restarted = new PtvHomeUserAccessLedger(fixture.DirectoryPath, "server-a");
        Assert.Equal("pending", (await restarted.ReadAsync(UserId, changedCurrent, currentEpoch)).State);
        Assert.True((await restarted.CompleteAsync(operationId, changedCurrent, currentEpoch, currentAccessibleLibraryIds: [])).PolicyProven);
    }

    [Fact]
    public async Task LateUnknownIdCanOnlyUseExplicitRestrictiveReproofOutsideFrozenLegacyCohort()
    {
        using var fixture = new Fixture();
        var laterId = Guid.NewGuid();
        var restrictive = new PtvHomeAccessDefinition
        {
            UserId = laterId.ToString("N"), EnableAllFolders = false, EnabledFolders = [LibraryId],
            IsAdministrator = false
        };
        var operationId = Guid.NewGuid();
        var intent = new PtvHomeUserAccessIntent
        {
            OperationId = operationId, UserId = laterId.ToString("N"), Mode = "reproof",
            ExpectedAccess = restrictive, IntendedAccess = restrictive
        };
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(
            intent, restrictive, TopologyEpoch));
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        Assert.DoesNotContain(laterId.ToString("N"), batch.CandidateUserIds);
        var broad = new PtvHomeAccessDefinition
        {
            UserId = laterId.ToString("N"), EnableAllFolders = true, EnabledFolders = []
        };
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = laterId.ToString("N"), Mode = "reproof",
            ExpectedAccess = broad, IntendedAccess = broad
        }, broad, TopologyEpoch));
        var begun = await fixture.Ledger.BeginAsync(intent, restrictive, TopologyEpoch);
        Assert.True(begun.Held);
        Assert.True(begun.WriteAllowed);
        Assert.True((await fixture.Ledger.CompleteAsync(operationId, restrictive, TopologyEpoch, currentAccessibleLibraryIds: [])).PolicyProven);
        Assert.DoesNotContain(laterId.ToString("N"), (await fixture.Ledger.ReadVerificationBatchAsync())!.CandidateUserIds);
    }

    [Fact]
    public async Task ExplicitReproofAfterCorruptRecoveryCanAttestUnchangedExistingPolicy()
    {
        using var fixture = new Fixture();
        var path = Path.Combine(fixture.DirectoryPath, "home-user-access.json");
        Directory.CreateDirectory(fixture.DirectoryPath);
        await File.WriteAllTextAsync(path, "{invalid json");
        await fixture.Ledger.RecoverCorruptAsync();
        var broad = Access(all: true);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = UserId.ToString("N"), Mode = "reproof",
            ExpectedAccess = broad, IntendedAccess = broad
        }, broad, TopologyEpoch));
        var restrictive = Access(all: false, folders: [LibraryId]);
        var operationId = Guid.NewGuid();
        var begun = await fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = operationId, UserId = UserId.ToString("N"), Mode = "reproof",
            ExpectedAccess = restrictive, IntendedAccess = restrictive
        }, restrictive, TopologyEpoch);
        Assert.True(begun.Held);
        Assert.True(begun.WriteAllowed);
        Assert.False((await fixture.Ledger.ReadAsync(UserId, restrictive, TopologyEpoch)).PolicyProven);
        var restarted = new PtvHomeUserAccessLedger(fixture.DirectoryPath, "server-a");
        var proven = await restarted.CompleteAsync(operationId, restrictive, TopologyEpoch, currentAccessibleLibraryIds: []);
        Assert.True(proven.PolicyProven);
    }

    [Fact]
    public async Task ReproofRequiresRecoveryProvenanceAndCannotAdoptNewBroadDefault()
    {
        using var fixture = new Fixture();
        var broad = Access(all: true);
        var broadReproof = new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = UserId.ToString("N"), Mode = "reproof",
            ExpectedAccess = broad, IntendedAccess = broad
        };
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(
            broadReproof, broad, TopologyEpoch));
        var administrative = new PtvHomeAccessDefinition
        {
            UserId = UserId.ToString("N"), EnableAllFolders = false, EnabledFolders = [LibraryId],
            IsAdministrator = true
        };
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = UserId.ToString("N"), Mode = "reproof",
            ExpectedAccess = administrative, IntendedAccess = administrative
        }, administrative, TopologyEpoch));
        var creationId = Guid.NewGuid();
        await fixture.Ledger.ReserveCreationAsync(creationId, []);
        await fixture.Ledger.BindCreationAsync(creationId, UserId);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginAsync(
            broadReproof, broad, TopologyEpoch));

        var restrictive = Access(all: false, folders: [LibraryId]);
        var operationId = Guid.NewGuid();
        var begun = await fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = operationId, UserId = UserId.ToString("N"), Mode = "reproof",
            ExpectedAccess = restrictive, IntendedAccess = restrictive
        }, restrictive, TopologyEpoch);
        Assert.True(begun.Held);
        Assert.True((await fixture.Ledger.CompleteAsync(operationId, restrictive, TopologyEpoch, currentAccessibleLibraryIds: [])).PolicyProven);
    }

    [Fact]
    public async Task VerificationBatchSnapshotsExactCandidatesAndExcludesLaterCreatedUser()
    {
        using var fixture = new Fixture();
        var laterUser = Guid.Parse("33333333-3333-3333-3333-333333333333");
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);

        Assert.Equal([UserId.ToString("N")], batch.CandidateUserIds);
        Assert.False((await fixture.Ledger.ReadAsync(UserId, Access(all: true), TopologyEpoch)).PolicyProven);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.VerifyBatchCandidateAsync(
            batch.Id, laterUser, new PtvHomeAccessDefinition
            {
                UserId = laterUser.ToString("N"), EnableAllFolders = true
            }, Access(laterUser, all: true), [LibraryId], TopologyEpoch));
        Assert.False((await fixture.Ledger.ReadAsync(laterUser, new PtvHomeAccessDefinition
        {
            UserId = laterUser.ToString("N"), EnableAllFolders = true
        }, TopologyEpoch)).PolicyProven);

        var verified = await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId,
            Access(all: true), Access(all: true), [LibraryId], TopologyEpoch);
        Assert.True(verified.PolicyProven);
        Assert.False(verified.Held);
        Assert.Equal([LibraryId], verified.AccessibleLibraryIds);
    }

    [Fact]
    public async Task RepeatedExactBatchVerificationKeepsTheOriginalDurableProof()
    {
        using var fixture = new Fixture();
        var policy = Access(all: true, folders: [LibraryId]);
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        var first = await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId,
            policy, policy, [LibraryId], TopologyEpoch);
        var ledgerPath = Path.Combine(fixture.DirectoryPath, "home-user-access.json");
        var firstDocument = await File.ReadAllTextAsync(ledgerPath);

        var restarted = new PtvHomeUserAccessLedger(fixture.DirectoryPath, "server-a");
        var repeated = await restarted.VerifyBatchCandidateAsync(batch.Id, UserId,
            policy, policy, [LibraryId], TopologyEpoch);

        Assert.True(repeated.PolicyProven);
        Assert.Equal(first.AccessEpoch, repeated.AccessEpoch);
        Assert.Equal(first.OperationId, repeated.OperationId);
        Assert.Equal(firstDocument, await File.ReadAllTextAsync(ledgerPath));
    }

    [Fact]
    public async Task ReplacementBatchAtSameTopologyIssuesFreshVerificationProof()
    {
        using var fixture = new Fixture();
        var policy = Access(all: true, folders: [LibraryId]);
        var firstBatch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        var first = await fixture.Ledger.VerifyBatchCandidateAsync(firstBatch.Id, UserId,
            policy, policy, [LibraryId], TopologyEpoch);
        var replacement = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch, replace: true);

        var repeated = await fixture.Ledger.VerifyBatchCandidateAsync(replacement.Id, UserId,
            policy, policy, [LibraryId], TopologyEpoch);

        Assert.NotEqual(firstBatch.Id, replacement.Id);
        Assert.NotEqual(first.AccessEpoch, repeated.AccessEpoch);
        Assert.NotEqual(first.OperationId, repeated.OperationId);
    }

    [Fact]
    public async Task LegacyVerificationProofWithoutBatchIdentityGetsFreshProof()
    {
        using var fixture = new Fixture();
        var policy = Access(all: true, folders: [LibraryId]);
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        var first = await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId,
            policy, policy, [LibraryId], TopologyEpoch);
        var path = Path.Combine(fixture.DirectoryPath, "home-user-access.json");
        var document = JsonNode.Parse(await File.ReadAllTextAsync(path))!.AsObject();
        document["Records"]![UserId.ToString("N")]!.AsObject().Remove("VerificationBatchId");
        await File.WriteAllTextAsync(path, document.ToJsonString());

        var restarted = new PtvHomeUserAccessLedger(fixture.DirectoryPath, "server-a");
        var repeated = await restarted.VerifyBatchCandidateAsync(batch.Id, UserId,
            policy, policy, [LibraryId], TopologyEpoch);

        Assert.NotEqual(first.AccessEpoch, repeated.AccessEpoch);
        Assert.NotEqual(first.OperationId, repeated.OperationId);
    }

    [Fact]
    public async Task RepeatedBatchVerificationWithChangedMembershipRequiresFreshProof()
    {
        using var fixture = new Fixture();
        var policy = Access(all: false, folders: [LibraryId]);
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        var first = await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId,
            policy, policy, [LibraryId], TopologyEpoch);

        var changed = await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId,
            policy, policy, [], TopologyEpoch);

        Assert.NotEqual(first.AccessEpoch, changed.AccessEpoch);
        Assert.Empty(changed.AccessibleLibraryIds);
        Assert.False((await fixture.Ledger.ReadAsync(UserId, policy, TopologyEpoch,
            currentAccessibleLibraryIds: [LibraryId])).PolicyProven);
        Assert.True((await fixture.Ledger.ReadAsync(UserId, policy, TopologyEpoch,
            currentAccessibleLibraryIds: [])).PolicyProven);
    }

    [Fact]
    public async Task PendingCreationStillBlocksAnOtherwiseExactVerificationRetry()
    {
        using var fixture = new Fixture();
        var policy = Access(all: true);
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId,
            policy, policy, [LibraryId], TopologyEpoch);
        await fixture.Ledger.ReserveCreationAsync(Guid.NewGuid(), [UserId]);
        var ledgerPath = Path.Combine(fixture.DirectoryPath, "home-user-access.json");
        var reservedDocument = await File.ReadAllTextAsync(ledgerPath);

        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.VerifyBatchCandidateAsync(
            batch.Id, UserId, policy, policy, [LibraryId], TopologyEpoch));
        Assert.Equal(reservedDocument, await File.ReadAllTextAsync(ledgerPath));
    }

    [Fact]
    public async Task StoredAccessibleLibrariesDoNotProveCurrentMembershipWithoutFreshReadback()
    {
        using var fixture = new Fixture();
        var policy = Access(all: false, folders: [LibraryId]);
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId, policy, policy, [LibraryId], TopologyEpoch);

        var withoutReadback = await fixture.Ledger.ReadAsync(UserId, policy, TopologyEpoch);

        Assert.True(withoutReadback.Held);
        Assert.False(withoutReadback.PolicyProven);
    }

    [Fact]
    public async Task DurableUserProofRejectsChangedAndInvalidCurrentLibrarySets()
    {
        using var fixture = new Fixture();
        var policy = Access(all: false, folders: [LibraryId]);
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId, policy, policy, [LibraryId], TopologyEpoch);

        Assert.True((await fixture.Ledger.ReadAsync(UserId, policy, TopologyEpoch,
            currentAccessibleLibraryIds: [LibraryId])).PolicyProven);
        Assert.False((await fixture.Ledger.ReadAsync(UserId, policy, TopologyEpoch,
            currentAccessibleLibraryIds: [])).PolicyProven);
        Assert.False((await fixture.Ledger.ReadAsync(UserId, policy, TopologyEpoch,
            currentAccessibleLibraryIds: [LibraryId, LibraryId])).PolicyProven);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task MigrationVerificationCannotEraseAnUncertainControlledWrite(bool failed)
    {
        using var fixture = new Fixture();
        var operationId = Guid.NewGuid();
        var original = Access(all: true);
        await fixture.Ledger.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = operationId, UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = original, IntendedAccess = Access(all: false, folders: [LibraryId])
        }, original, TopologyEpoch);
        if (failed) await fixture.Ledger.CompleteAsync(operationId, original, TopologyEpoch, currentAccessibleLibraryIds: []);
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);

        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.VerifyBatchCandidateAsync(
            batch.Id, UserId, original, original, [LibraryId], TopologyEpoch));
        var current = await fixture.Ledger.ReadAsync(UserId, original, TopologyEpoch);
        Assert.True(current.Held);
        Assert.Equal(operationId, current.OperationId);
    }

    [Fact]
    public async Task FirstLegacyCohortPermanentlyExcludesLaterIdsEvenOnExplicitRefresh()
    {
        using var fixture = new Fixture();
        var laterUser = Guid.Parse("33333333-3333-3333-3333-333333333333");
        var first = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        var resumed = await fixture.Ledger.BeginVerificationBatchAsync([UserId, laterUser], TopologyEpoch);
        Assert.Equal(first.Id, resumed.Id);
        Assert.Equal([UserId.ToString("N")], resumed.CandidateUserIds);

        var replacement = await fixture.Ledger.BeginVerificationBatchAsync([UserId, laterUser], TopologyEpoch, replace: true);
        Assert.NotEqual(first.Id, replacement.Id);
        Assert.Equal([UserId.ToString("N")], replacement.CandidateUserIds);
    }

    [Fact]
    public async Task BatchBeforeControlledCreateCannotVerifyDuringReservationOrAfterBind()
    {
        using var fixture = new Fixture();
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        var operationId = Guid.NewGuid();
        await fixture.Ledger.ReserveCreationAsync(operationId, [UserId]);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.VerifyBatchCandidateAsync(
            batch.Id, UserId, Access(all: true), Access(all: true), [LibraryId], TopologyEpoch));
        var createdId = Guid.NewGuid();
        var bound = await fixture.Ledger.BindCreationAsync(operationId, createdId);
        Assert.Equal(createdId.ToString("N"), bound.UserId);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.VerifyBatchCandidateAsync(
            batch.Id, createdId, Access(createdId, all: true), Access(createdId, all: true), [LibraryId], TopologyEpoch));
    }

    [Fact]
    public async Task ControlledCreateBeforeFirstBatchIsExcludedFromLegacyCohort()
    {
        using var fixture = new Fixture();
        var createdId = Guid.NewGuid();
        var operationId = Guid.NewGuid();
        await fixture.Ledger.ReserveCreationAsync(operationId, [UserId]);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.BeginVerificationBatchAsync(
            [UserId, createdId], TopologyEpoch));
        await fixture.Ledger.BindCreationAsync(operationId, createdId);
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId, createdId], TopologyEpoch);
        Assert.Equal([UserId.ToString("N")], batch.CandidateUserIds);
    }

    [Fact]
    public async Task UncertainCreateReservationSurvivesRestartAndRecoveryMarksEveryNewId()
    {
        using var fixture = new Fixture();
        var operationId = Guid.NewGuid();
        await fixture.Ledger.ReserveCreationAsync(operationId, [UserId]);
        var restarted = new PtvHomeUserAccessLedger(fixture.DirectoryPath, "server-a");
        await Assert.ThrowsAsync<InvalidOperationException>(() => restarted.BeginVerificationBatchAsync(
            [UserId], TopologyEpoch));
        var createdId = Guid.NewGuid();
        var possiblyOutOfBand = Guid.NewGuid();
        var recovery = await restarted.RecoverCreationAsync(operationId, [UserId, createdId, possiblyOutOfBand]);
        Assert.Equal(new[] { createdId.ToString("N"), possiblyOutOfBand.ToString("N") }.Order(StringComparer.Ordinal),
            recovery.MarkedUserIds.Order(StringComparer.Ordinal));
        var batch = await restarted.BeginVerificationBatchAsync([UserId, createdId, possiblyOutOfBand], TopologyEpoch);
        Assert.Equal([UserId.ToString("N")], batch.CandidateUserIds);
    }

    [Fact]
    public async Task ConfirmedNoNewIdRecoveryReleasesReservationWithoutAuthority()
    {
        using var fixture = new Fixture();
        var operationId = Guid.NewGuid();
        await fixture.Ledger.ReserveCreationAsync(operationId, [UserId]);
        var recovery = await fixture.Ledger.RecoverCreationAsync(operationId, [UserId]);
        Assert.Empty(recovery.MarkedUserIds);
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        Assert.Equal([UserId.ToString("N")], batch.CandidateUserIds);
        Assert.False((await fixture.Ledger.ReadAsync(UserId, Access(all: true), TopologyEpoch)).PolicyProven);
    }

    [Fact]
    public async Task CreationOperationStatusDistinguishesDurableStatesWithoutWriting()
    {
        using var fixture = new Fixture();
        var absentId = Guid.NewGuid();
        var reservedId = Guid.NewGuid();
        var boundId = Guid.NewGuid();
        var recoveredId = Guid.NewGuid();
        var boundUser = Guid.NewGuid();
        var markedUser = Guid.NewGuid();
        await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        await fixture.Ledger.ReserveCreationAsync(reservedId, [UserId]);
        await fixture.Ledger.ReserveCreationAsync(boundId, [UserId]);
        await fixture.Ledger.BindCreationAsync(boundId, boundUser);
        await fixture.Ledger.ReserveCreationAsync(recoveredId, [UserId]);
        await fixture.Ledger.RecoverCreationAsync(recoveredId, [UserId, markedUser]);
        var path = Path.Combine(fixture.DirectoryPath, "home-user-access.json");
        var before = await File.ReadAllTextAsync(path);
        var restarted = new PtvHomeUserAccessLedger(fixture.DirectoryPath, "server-a");

        var absent = await restarted.ReadCreationStatusAsync(absentId);
        var reserved = await restarted.ReadCreationStatusAsync(reservedId);
        var bound = await restarted.ReadCreationStatusAsync(boundId);
        var recovered = await restarted.ReadCreationStatusAsync(recoveredId);

        Assert.Equal((1, absentId, "absent", null),
            (absent.Version, absent.CreationOperationId, absent.State, absent.UserId));
        Assert.Empty(absent.MarkedUserIds);
        Assert.Equal((reservedId, "reserved", null),
            (reserved.CreationOperationId, reserved.State, reserved.UserId));
        Assert.Empty(reserved.MarkedUserIds);
        Assert.Equal((boundId, "bound", boundUser.ToString("N")),
            (bound.CreationOperationId, bound.State, bound.UserId));
        Assert.Empty(bound.MarkedUserIds);
        Assert.Equal((recoveredId, "recovered", null),
            (recovered.CreationOperationId, recovered.State, recovered.UserId));
        Assert.Equal([markedUser.ToString("N")], recovered.MarkedUserIds);
        Assert.Equal(before, await File.ReadAllTextAsync(path));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CreationStatusFailsClosedWhenDurableLedgerIsMissingOrCorrupt(bool corrupt)
    {
        using var fixture = new Fixture();
        if (corrupt)
        {
            Directory.CreateDirectory(fixture.DirectoryPath);
            await File.WriteAllTextAsync(Path.Combine(fixture.DirectoryPath, "home-user-access.json"), "{invalid json");
        }

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            fixture.Ledger.ReadCreationStatusAsync(Guid.NewGuid()));
    }

    [Fact]
    public async Task CreationStatusCannotProveAbsenceAfterCorruptLedgerRecovery()
    {
        using var fixture = new Fixture();
        Directory.CreateDirectory(fixture.DirectoryPath);
        await File.WriteAllTextAsync(Path.Combine(fixture.DirectoryPath, "home-user-access.json"), "{invalid json");
        await fixture.Ledger.RecoverCorruptAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            fixture.Ledger.ReadCreationStatusAsync(Guid.NewGuid()));
    }

    [Fact]
    public async Task MigrationMayReverifyItsOwnPriorProofButCannotOverwriteBootstrapLineage()
    {
        using var fixture = new Fixture();
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        var broad = Access(all: true);
        var restrictive = Access(all: false, folders: [LibraryId]);
        await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId, broad, broad, [LibraryId], TopologyEpoch);
        var reverified = await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId,
            restrictive, restrictive, [LibraryId], TopologyEpoch);
        Assert.True(reverified.PolicyProven);

        var createdId = Guid.NewGuid();
        var creationId = Guid.NewGuid();
        await fixture.Ledger.ReserveCreationAsync(creationId, [UserId]);
        await fixture.Ledger.BindCreationAsync(creationId, createdId);
        var createdAccess = Access(createdId, all: false);
        var bootstrapId = Guid.NewGuid();
        var bootstrap = new PtvHomeUserAccessIntent
        {
            OperationId = bootstrapId, UserId = createdId.ToString("N"), Mode = "bootstrap", IntendedAccess = createdAccess
        };
        await fixture.Ledger.BeginAsync(bootstrap, createdAccess, TopologyEpoch);
        await fixture.Ledger.CompleteAsync(bootstrapId, createdAccess, TopologyEpoch, currentAccessibleLibraryIds: []);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.VerifyBatchCandidateAsync(
            batch.Id, createdId, Access(createdId, all: true), Access(createdId, all: true),
            [LibraryId], TopologyEpoch));
    }

    [Fact]
    public async Task MigrationRequiresExactAdministratorIntendedPolicy()
    {
        using var fixture = new Fixture();
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        await Assert.ThrowsAsync<InvalidOperationException>(() => fixture.Ledger.VerifyBatchCandidateAsync(
            batch.Id, UserId, Access(all: true), Access(all: false), [LibraryId], TopologyEpoch));
        Assert.False((await fixture.Ledger.ReadAsync(UserId, Access(all: true), TopologyEpoch)).PolicyProven);
    }

    [Fact]
    public async Task VerifiedPolicyBecomesUnprovenAfterTopologyOrPolicyChangesAndRestart()
    {
        using var fixture = new Fixture();
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId,
            Access(all: false, folders: [LibraryId]), Access(all: false, folders: [LibraryId]), [LibraryId], TopologyEpoch);
        var restarted = new PtvHomeUserAccessLedger(fixture.DirectoryPath, "server-a");

        Assert.True((await restarted.ReadAsync(UserId, Access(all: false, folders: [LibraryId]), TopologyEpoch,
            currentAccessibleLibraryIds: [LibraryId])).PolicyProven);
        Assert.False((await restarted.ReadAsync(UserId, Access(all: true), TopologyEpoch)).PolicyProven);
        Assert.False((await restarted.ReadAsync(UserId, Access(all: false, folders: [LibraryId]), new string('B', 64))).PolicyProven);
    }

    [Theory]
    [InlineData("attested-policy")]
    [InlineData("attested-user")]
    [InlineData("intended-user")]
    [InlineData("duplicate-libraries")]
    [InlineData("malformed-library")]
    [InlineData("null-record")]
    [InlineData("null-cohort")]
    public async Task CorruptPersistedProofFailsClosedOnRestart(string corruption)
    {
        using var fixture = new Fixture();
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId, Access(all: false, folders: [LibraryId]),
            Access(all: false, folders: [LibraryId]), [LibraryId], TopologyEpoch);
        var path = Path.Combine(fixture.DirectoryPath, "home-user-access.json");
        var root = JsonNode.Parse(await File.ReadAllTextAsync(path))!.AsObject();
        var record = root["Records"]![UserId.ToString("N")]!.AsObject();
        switch (corruption)
        {
            case "attested-policy": record["AttestedAccess"]!["EnableAllFolders"] = true; break;
            case "attested-user": record["AttestedAccess"]!["UserId"] = Guid.NewGuid().ToString("N"); break;
            case "intended-user": record["IntendedAccess"]!["UserId"] = Guid.NewGuid().ToString("N"); break;
            case "duplicate-libraries": record["AccessibleLibraryIds"] = new JsonArray(LibraryId, LibraryId); break;
            case "malformed-library": record["AccessibleLibraryIds"] = new JsonArray("not-a-guid"); break;
            case "null-record": root["Records"]![UserId.ToString("N")] = null; break;
            case "null-cohort": root["Batch"]!["CandidateUserIds"] = null; break;
        }
        await File.WriteAllTextAsync(path, root.ToJsonString());

        var restarted = new PtvHomeUserAccessLedger(fixture.DirectoryPath, "server-a");
        var view = await restarted.ReadAsync(UserId, Access(all: false, folders: [LibraryId]), TopologyEpoch);
        Assert.True(view.Held);
        Assert.False(view.PolicyProven);
        Assert.Equal("recovery-required", view.State);
    }

    [Fact]
    public async Task ExplicitAdministratorRecoveryQuarantinesCorruptionWithoutSeedingAuthority()
    {
        using var fixture = new Fixture();
        var batch = await fixture.Ledger.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        await fixture.Ledger.VerifyBatchCandidateAsync(batch.Id, UserId, Access(all: true), Access(all: true), [LibraryId], TopologyEpoch);
        var path = Path.Combine(fixture.DirectoryPath, "home-user-access.json");
        await File.WriteAllTextAsync(path, "{invalid json");
        var restarted = new PtvHomeUserAccessLedger(fixture.DirectoryPath, "server-a");
        Assert.False((await restarted.ReadAsync(UserId, Access(all: true), TopologyEpoch)).PolicyProven);

        await restarted.RecoverCorruptAsync();
        Assert.Null(await restarted.ReadVerificationBatchAsync());
        Assert.False((await restarted.ReadAsync(UserId, Access(all: true), TopologyEpoch)).PolicyProven);
        Assert.NotEmpty(Directory.GetFiles(fixture.DirectoryPath, "home-user-access.corrupt-*.json"));

        var fresh = await restarted.BeginVerificationBatchAsync([UserId], TopologyEpoch);
        Assert.Empty(fresh.CandidateUserIds);
        await Assert.ThrowsAsync<InvalidOperationException>(() => restarted.VerifyBatchCandidateAsync(fresh.Id, UserId,
            Access(all: true), Access(all: true), [LibraryId], TopologyEpoch));
        var restrictive = Access(all: false, folders: [LibraryId]);
        var operationId = Guid.NewGuid();
        await restarted.BeginAsync(new PtvHomeUserAccessIntent
        {
            OperationId = operationId, UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = Access(all: true), IntendedAccess = restrictive
        }, Access(all: true), TopologyEpoch);
        var proven = await restarted.CompleteAsync(operationId, restrictive, TopologyEpoch, currentAccessibleLibraryIds: []);
        Assert.True(proven.PolicyProven);
    }

    private static PtvHomeAccessDefinition Access(bool all, string[]? folders = null) => new()
    {
        UserId = UserId.ToString("N"),
        EnableAllFolders = all,
        EnabledFolders = folders ?? [],
        IsAdministrator = false,
        IsDisabled = false
    };

    private static PtvHomeAccessDefinition Access(Guid userId, bool all) => new()
    {
        UserId = userId.ToString("N"), EnableAllFolders = all,
        EnabledFolders = [], IsAdministrator = false, IsDisabled = false
    };

    private sealed class Fixture : IDisposable
    {
        private readonly string _directory = Path.Combine(Path.GetTempPath(), "ptv-home-user-access-tests", Guid.NewGuid().ToString("N"));
        internal PtvHomeUserAccessLedger Ledger { get; }
        internal string DirectoryPath => _directory;

        internal Fixture() => Ledger = new PtvHomeUserAccessLedger(_directory, "server-a");

        public void Dispose()
        {
            if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
        }
    }
}
