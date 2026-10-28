using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvHomeUserAccessControllerTests : IDisposable
{
    private static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly string FolderId = Guid.Parse("22222222-2222-2222-2222-222222222222").ToString("N");
    private static readonly string TopologyEpoch = new('A', 64);
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "ptv-user-access-controller-" + Guid.NewGuid().ToString("N"));
    private readonly User _user = new("test-user", "test-auth", "test-reset") { Id = UserId };

    [Fact]
    public async Task ExistingUserBeginPrecedesPolicyWriteAndCompleteUsesJellyfinReadback()
    {
        var users = DispatchProxy.Create<IUserManager, UserProxy>();
        ((UserProxy)(object)users).User = _user;
        _user.SetPermission(PermissionKind.EnableAllFolders, true);
        var ledger = new PtvHomeUserAccessLedger(_directory, "server-a");
        var controller = new PtvHomeUserAccessController(ledger, new Topology(TopologyEpoch), users,
            DispatchProxy.Create<ILibraryManager, LibraryProxy>(), new Authorization());
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "admin")], "Test"))
        } };
        var intent = new PtvHomeUserAccessIntent
        {
            OperationId = Guid.NewGuid(), UserId = UserId.ToString("N"), Mode = "existing",
            ExpectedAccess = Access(true), IntendedAccess = Access(false, [FolderId])
        };

        var begun = Assert.IsType<PtvHomeUserAccessView>(Assert.IsType<OkObjectResult>(
            await controller.Begin(intent, CancellationToken.None)).Value);
        Assert.True(begun.Held);
        Assert.True(begun.WriteAllowed);
        var premature = Assert.IsType<PtvHomeUserAccessView>(Assert.IsType<OkObjectResult>(
            await controller.Complete(intent.OperationId, CancellationToken.None)).Value);
        Assert.False(premature.PolicyProven);
        var recovery = Assert.IsType<PtvHomeUserAccessAdminView>(Assert.IsType<OkObjectResult>(
            await controller.Current(UserId.ToString("N"), CancellationToken.None)).Value);
        Assert.Equal(intent.OperationId, recovery.OperationId);
        Assert.True(recovery.Held);
        Assert.Equal(intent.ExpectedAccess!.EnabledFolders, recovery.ExpectedAccess!.EnabledFolders);
        Assert.Equal(intent.IntendedAccess!.EnabledFolders, recovery.IntendedAccess!.EnabledFolders);
        Assert.True(recovery.CurrentAccess!.EnableAllFolders);
        Assert.False(recovery.ControlledCreated);

        _user.SetPermission(PermissionKind.EnableAllFolders, false);
        _user.SetPreference(PreferenceKind.EnabledFolders, [FolderId]);
        var completed = Assert.IsType<PtvHomeUserAccessView>(Assert.IsType<OkObjectResult>(
            await controller.Complete(intent.OperationId, CancellationToken.None)).Value);
        Assert.True(completed.PolicyProven);
        Assert.False(completed.Held);
    }

    [Fact]
    public async Task AdministratorVerificationBatchFreezesIdsAndReportsProgress()
    {
        var users = DispatchProxy.Create<IUserManager, UserProxy>();
        var proxy = (UserProxy)(object)users;
        proxy.User = _user;
        _user.SetPermission(PermissionKind.EnableAllFolders, true);
        var controller = new PtvHomeUserAccessController(new PtvHomeUserAccessLedger(_directory, "server-a"),
            new Topology(TopologyEpoch), users, DispatchProxy.Create<ILibraryManager, LibraryProxy>(), new Authorization());
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "admin")], "Test"))
        } };

        var started = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.BeginVerificationBatch(CancellationToken.None)).Value);
        Assert.Equal([UserId.ToString("N")], started.CandidateUserIds);
        Assert.Equal(0, started.VerifiedCount);
        Assert.Equal(1, started.NeedsVerificationCount);
        proxy.LaterUser = new User("late", "test-auth", "test-reset")
        {
            Id = Guid.Parse("33333333-3333-3333-3333-333333333333")
        };
        Assert.IsType<ConflictObjectResult>(await controller.VerifyBatchCandidate(started.Id,
            proxy.LaterUser.Id, Confirm(Access(true, userId: proxy.LaterUser.Id)), CancellationToken.None));
        Assert.IsType<OkObjectResult>(await controller.VerifyBatchCandidate(started.Id, UserId,
            Confirm(Access(true)), CancellationToken.None));
        var current = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.CurrentVerificationBatch(CancellationToken.None)).Value);
        Assert.Equal([UserId.ToString("N")], current.CandidateUserIds);
        Assert.Equal(1, current.VerifiedCount);
        Assert.Equal(0, current.NeedsVerificationCount);
        var allCurrentUsers = Assert.IsType<PtvHomeUserVerificationSummary>(Assert.IsType<OkObjectResult>(
            await controller.VerificationSummary(CancellationToken.None)).Value);
        Assert.Equal(2, allCurrentUsers.TotalCount);
        Assert.Equal(1, allCurrentUsers.VerifiedCount);
        Assert.Equal(1, allCurrentUsers.NeedsVerificationCount);
        Assert.True(allCurrentUsers.LegacyCohortStarted);
    }

    [Fact]
    public async Task AdminCurrentReportsPersistedProofBatchRatherThanReplacementBatch()
    {
        var users = DispatchProxy.Create<IUserManager, UserProxy>();
        ((UserProxy)(object)users).User = _user;
        _user.SetPermission(PermissionKind.EnableAllFolders, true);
        var controller = Controller(users);
        var firstBatch = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.BeginVerificationBatch(CancellationToken.None)).Value);
        var publicProof = Assert.IsType<PtvHomeUserAccessView>(Assert.IsType<OkObjectResult>(
            await controller.VerifyBatchCandidate(firstBatch.Id, UserId,
                Confirm(Access(true)), CancellationToken.None)).Value);
        using (var publicJson = JsonDocument.Parse(JsonSerializer.Serialize(publicProof)))
            Assert.False(publicJson.RootElement.TryGetProperty("verificationBatchId", out _));

        var replacement = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.NewVerificationBatch(CancellationToken.None)).Value);
        Assert.NotEqual(firstBatch.Id, replacement.Id);
        var oldProof = Assert.IsType<PtvHomeUserAccessAdminView>(Assert.IsType<OkObjectResult>(
            await controller.Current(UserId.ToString("N"), CancellationToken.None)).Value);
        using (var oldJson = JsonDocument.Parse(JsonSerializer.Serialize(oldProof)))
            Assert.Equal(firstBatch.Id, oldJson.RootElement.GetProperty("verificationBatchId").GetGuid());

        Assert.IsType<OkObjectResult>(await controller.VerifyBatchCandidate(replacement.Id, UserId,
            Confirm(Access(true)), CancellationToken.None));
        var newProof = Assert.IsType<PtvHomeUserAccessAdminView>(Assert.IsType<OkObjectResult>(
            await controller.Current(UserId.ToString("N"), CancellationToken.None)).Value);
        using var newJson = JsonDocument.Parse(JsonSerializer.Serialize(newProof));
        Assert.Equal(replacement.Id, newJson.RootElement.GetProperty("verificationBatchId").GetGuid());
    }

    [Fact]
    public async Task ReplacementBatchProgressExcludesPriorBatchProof()
    {
        var users = DispatchProxy.Create<IUserManager, UserProxy>();
        ((UserProxy)(object)users).User = _user;
        _user.SetPermission(PermissionKind.EnableAllFolders, true);
        var controller = Controller(users);
        var firstBatch = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.BeginVerificationBatch(CancellationToken.None)).Value);
        Assert.IsType<OkObjectResult>(await controller.VerifyBatchCandidate(firstBatch.Id, UserId,
            Confirm(Access(true)), CancellationToken.None));

        var replacement = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.NewVerificationBatch(CancellationToken.None)).Value);
        Assert.Equal(0, replacement.VerifiedCount);
        Assert.Equal(1, replacement.NeedsVerificationCount);
        var global = Assert.IsType<PtvHomeUserVerificationSummary>(Assert.IsType<OkObjectResult>(
            await controller.VerificationSummary(CancellationToken.None)).Value);
        Assert.Equal(1, global.VerifiedCount);

        Assert.IsType<OkObjectResult>(await controller.VerifyBatchCandidate(replacement.Id, UserId,
            Confirm(Access(true)), CancellationToken.None));
        var current = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.CurrentVerificationBatch(CancellationToken.None)).Value);
        Assert.Equal(1, current.VerifiedCount);
        Assert.Equal(0, current.NeedsVerificationCount);
    }

    [Fact]
    public async Task AdminCurrentMarksOnlyUnknownIdsOutsideFrozenLegacyCohortAsLateUnverified()
    {
        var users = DispatchProxy.Create<IUserManager, UserProxy>();
        var proxy = (UserProxy)(object)users;
        proxy.User = _user;
        var controller = Controller(users);
        Assert.IsType<OkObjectResult>(await controller.BeginVerificationBatch(CancellationToken.None));
        proxy.LaterUser = new User("late", "test-auth", "test-reset") { Id = Guid.NewGuid() };

        var late = Assert.IsType<PtvHomeUserAccessAdminView>(Assert.IsType<OkObjectResult>(
            await controller.Current(proxy.LaterUser.Id.ToString("N"), CancellationToken.None)).Value);
        var legacy = Assert.IsType<PtvHomeUserAccessAdminView>(Assert.IsType<OkObjectResult>(
            await controller.Current(UserId.ToString("N"), CancellationToken.None)).Value);
        Assert.True(late.LateUnverified);
        Assert.False(late.ControlledCreated);
        Assert.False(late.PolicyProven);
        Assert.False(legacy.LateUnverified);
    }

    [Fact]
    public async Task CandidateVerificationCapturesBoundedUserAwareTopLibraryAccess()
    {
        var users = DispatchProxy.Create<IUserManager, UserProxy>();
        ((UserProxy)(object)users).User = _user;
        _user.SetPermission(PermissionKind.EnableAllFolders, true);
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Folders = [new VirtualFolderInfo { ItemId = FolderId, Name = "Movies" }];
        proxy.Visible = true;
        var ledger = new PtvHomeUserAccessLedger(_directory, "server-a");
        var controller = new PtvHomeUserAccessController(ledger, new Topology(TopologyEpoch), users,
            libraries, new Authorization());
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "admin")], "Test"))
        } };

        var batch = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.BeginVerificationBatch(CancellationToken.None)).Value);
        var view = Assert.IsType<PtvHomeUserAccessView>(Assert.IsType<OkObjectResult>(
            await controller.VerifyBatchCandidate(batch.Id, UserId, Confirm(Access(true)), CancellationToken.None)).Value);
        Assert.Equal([FolderId], view.AccessibleLibraryIds);
        // Batch status and candidate verification independently read user-aware membership.
        Assert.Equal(2, proxy.UserAwareCalls);

        proxy.Folders = Enumerable.Range(1, 129).Select(index => new VirtualFolderInfo
        {
            ItemId = Guid.Parse($"aaaaaaaa-aaaa-aaaa-aaaa-{index:D12}").ToString("N"), Name = "Folder"
        }).ToArray();
        Assert.IsType<ConflictObjectResult>(await controller.VerifyBatchCandidate(batch.Id, UserId,
            Confirm(Access(true)), CancellationToken.None));
        Assert.Equal(2, proxy.UserAwareCalls);
    }

    [Fact]
    public async Task AdminControlledCreateReservationExcludesReturnedIdFromFirstLegacyBatch()
    {
        var users = DispatchProxy.Create<IUserManager, UserProxy>();
        var proxy = (UserProxy)(object)users;
        proxy.User = _user;
        var controller = Controller(users);
        var operationId = Guid.NewGuid();
        var reserved = Assert.IsType<PtvHomeUserCreationView>(Assert.IsType<OkObjectResult>(
            await controller.ReserveCreation(new PtvHomeUserCreationReservationRequest
            { CreationOperationId = operationId }, CancellationToken.None)).Value);
        Assert.Equal("reserved", reserved.State);
        Assert.True(reserved.MigrationVerificationHeld);
        proxy.LaterUser = new User("new", "test-auth", "test-reset") { Id = Guid.NewGuid() };
        Assert.IsType<ConflictObjectResult>(await controller.BeginVerificationBatch(CancellationToken.None));

        var bound = Assert.IsType<PtvHomeUserCreationView>(Assert.IsType<OkObjectResult>(
            await controller.BindCreation(operationId, new PtvHomeUserCreationBindRequest
            { UserId = proxy.LaterUser.Id.ToString("N") }, CancellationToken.None)).Value);
        Assert.Equal(proxy.LaterUser.Id.ToString("N"), bound.UserId);
        Assert.True(bound.BootstrapRequired);
        var batch = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.BeginVerificationBatch(CancellationToken.None)).Value);
        Assert.Equal([UserId.ToString("N")], batch.CandidateUserIds);
    }

    [Fact]
    public async Task UncertainCreationRecoveryListsAndMarksAllNewCurrentIds()
    {
        var users = DispatchProxy.Create<IUserManager, UserProxy>();
        var proxy = (UserProxy)(object)users;
        proxy.User = _user;
        var controller = Controller(users);
        var operationId = Guid.NewGuid();
        Assert.IsType<OkObjectResult>(await controller.ReserveCreation(new PtvHomeUserCreationReservationRequest
        { CreationOperationId = operationId }, CancellationToken.None));
        proxy.LaterUser = new User("uncertain", "test-auth", "test-reset") { Id = Guid.NewGuid() };
        var pending = Assert.IsType<PtvHomeUserPendingCreations>(Assert.IsType<OkObjectResult>(
            await controller.CurrentCreations(CancellationToken.None)).Value);
        Assert.Equal(1, pending.PendingCount);
        Assert.Equal([proxy.LaterUser.Id.ToString("N")], Assert.Single(pending.Pending).CandidateNewUserIds);
        var recovered = Assert.IsType<PtvHomeUserCreationRecovery>(Assert.IsType<OkObjectResult>(
            await controller.RecoverCreation(operationId, new PtvHomeUserCreationRecoveryRequest
            { ConfirmCreationRequestSettled = true }, CancellationToken.None)).Value);
        Assert.Equal([proxy.LaterUser.Id.ToString("N")], recovered.MarkedUserIds);
        var detail = Assert.IsType<PtvHomeUserAccessAdminView>(Assert.IsType<OkObjectResult>(
            await controller.Current(proxy.LaterUser.Id.ToString("N"), CancellationToken.None)).Value);
        Assert.True(detail.ControlledCreated);
        Assert.False(detail.PolicyProven);
        var batch = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.BeginVerificationBatch(CancellationToken.None)).Value);
        Assert.Equal([UserId.ToString("N")], batch.CandidateUserIds);
    }

    [Fact]
    public async Task CandidateVerificationRequiresExplicitExactAdministratorPolicyIntent()
    {
        var users = DispatchProxy.Create<IUserManager, UserProxy>();
        ((UserProxy)(object)users).User = _user;
        _user.SetPermission(PermissionKind.EnableAllFolders, true);
        var controller = Controller(users);
        var batch = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.BeginVerificationBatch(CancellationToken.None)).Value);
        Assert.IsType<BadRequestObjectResult>(await controller.VerifyBatchCandidate(batch.Id, UserId,
            new PtvHomeUserVerificationIntent { IntendedAccess = Access(true) }, CancellationToken.None));
        Assert.IsType<ConflictObjectResult>(await controller.VerifyBatchCandidate(batch.Id, UserId,
            Confirm(Access(false)), CancellationToken.None));
        Assert.IsType<OkObjectResult>(await controller.VerifyBatchCandidate(batch.Id, UserId,
            Confirm(Access(true)), CancellationToken.None));
    }

    private PtvHomeUserAccessController Controller(IUserManager users)
    {
        var controller = new PtvHomeUserAccessController(new PtvHomeUserAccessLedger(_directory, "server-a"),
            new Topology(TopologyEpoch), users, DispatchProxy.Create<ILibraryManager, LibraryProxy>(), new Authorization());
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "admin")], "Test"))
        } };
        return controller;
    }

    [Fact]
    public async Task CreationStatusRouteIsAdministratorOnlyAndUsesStableJsonContract()
    {
        var route = typeof(PtvHomeUserAccessController).GetMethod(nameof(PtvHomeUserAccessController.CreationStatus))!
            .GetCustomAttribute<HttpGetAttribute>();
        Assert.Equal("creations/{creationOperationId:guid}/status", route?.Template);
        var users = DispatchProxy.Create<IUserManager, UserProxy>();
        ((UserProxy)(object)users).User = _user;
        var operationId = Guid.NewGuid();
        var ledger = new PtvHomeUserAccessLedger(_directory, "server-a");
        await ledger.ReserveCreationAsync(operationId, [UserId]);
        var controller = Controller(users);

        var response = Assert.IsType<PtvHomeUserCreationStatus>(Assert.IsType<OkObjectResult>(
            await controller.CreationStatus(operationId, CancellationToken.None)).Value);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(response));
        Assert.Equal(1, json.RootElement.GetProperty("version").GetInt32());
        Assert.Equal(operationId, json.RootElement.GetProperty("creationOperationId").GetGuid());
        Assert.Equal("reserved", json.RootElement.GetProperty("state").GetString());
        Assert.Equal(JsonValueKind.Null, json.RootElement.GetProperty("userId").ValueKind);
        Assert.Empty(json.RootElement.GetProperty("markedUserIds").EnumerateArray());
        Assert.Equal("private, no-store", controller.Response.Headers.CacheControl.ToString());

        var denied = new PtvHomeUserAccessController(ledger, new Topology(TopologyEpoch), users,
            DispatchProxy.Create<ILibraryManager, LibraryProxy>(), new DeniedAuthorization());
        denied.ControllerContext = new() { HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "member")], "Test"))
        } };
        Assert.IsType<ForbidResult>(await denied.CreationStatus(operationId, CancellationToken.None));
    }

    [Fact]
    public async Task CreationStatusNeverReportsAbsentForCorruptLedger()
    {
        Directory.CreateDirectory(_directory);
        await File.WriteAllTextAsync(Path.Combine(_directory, "home-user-access.json"), "{invalid json");
        var users = DispatchProxy.Create<IUserManager, UserProxy>();
        ((UserProxy)(object)users).User = _user;
        var response = await Controller(users).CreationStatus(Guid.NewGuid(), CancellationToken.None);

        Assert.Equal(503, Assert.IsType<ObjectResult>(response).StatusCode);
    }

    [Fact]
    public async Task VerificationSummaryCountsUnprovenUsersBeforeAnyBatchAndNewBatchIsExplicit()
    {
        var users = DispatchProxy.Create<IUserManager, UserProxy>();
        var proxy = (UserProxy)(object)users;
        proxy.User = _user;
        _user.SetPermission(PermissionKind.EnableAllFolders, true);
        var controller = new PtvHomeUserAccessController(new PtvHomeUserAccessLedger(_directory, "server-a"),
            new Topology(TopologyEpoch), users, DispatchProxy.Create<ILibraryManager, LibraryProxy>(), new Authorization());
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "admin")], "Test"))
        } };

        var before = Assert.IsType<PtvHomeUserVerificationSummary>(Assert.IsType<OkObjectResult>(
            await controller.VerificationSummary(CancellationToken.None)).Value);
        Assert.Equal(0, before.VerifiedCount);
        Assert.Equal(1, before.NeedsVerificationCount);
        Assert.Null(before.CurrentBatchId);

        var old = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.BeginVerificationBatch(CancellationToken.None)).Value);
        proxy.LaterUser = new User("late", "test-auth", "test-reset") { Id = Guid.NewGuid() };
        var resumed = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.BeginVerificationBatch(CancellationToken.None)).Value);
        Assert.Equal(old.Id, resumed.Id);
        var fresh = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.NewVerificationBatch(CancellationToken.None)).Value);
        Assert.NotEqual(old.Id, fresh.Id);
        Assert.Equal([UserId.ToString("N")], fresh.CandidateUserIds);
    }

    [Fact]
    public async Task CorruptLedgerNeedsExplicitAdministratorRecoveryBeforeNewVerification()
    {
        Directory.CreateDirectory(_directory);
        await File.WriteAllTextAsync(Path.Combine(_directory, "home-user-access.json"), "{invalid json");
        var users = DispatchProxy.Create<IUserManager, UserProxy>();
        ((UserProxy)(object)users).User = _user;
        var controller = new PtvHomeUserAccessController(new PtvHomeUserAccessLedger(_directory, "server-a"),
            new Topology(TopologyEpoch), users, DispatchProxy.Create<ILibraryManager, LibraryProxy>(), new Authorization());
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "admin")], "Test"))
        } };

        Assert.IsType<ConflictObjectResult>(await controller.BeginVerificationBatch(CancellationToken.None));
        var broken = Assert.IsType<PtvHomeUserVerificationSummary>(Assert.IsType<OkObjectResult>(
            await controller.VerificationSummary(CancellationToken.None)).Value);
        Assert.True(broken.RecoveryRequired);
        Assert.Equal(1, broken.NeedsVerificationCount);
        Assert.IsType<OkObjectResult>(await controller.RecoverCorruptLedger(CancellationToken.None));
        var recovered = Assert.IsType<PtvHomeUserVerificationSummary>(Assert.IsType<OkObjectResult>(
            await controller.VerificationSummary(CancellationToken.None)).Value);
        Assert.False(recovered.RecoveryRequired);
        Assert.True(recovered.MigrationRecoveryRestricted);
        Assert.True(recovered.LegacyCohortStarted);
        Assert.Equal(1, recovered.TotalCount);
        Assert.Equal(0, recovered.VerifiedCount);
        Assert.Equal(1, recovered.NeedsVerificationCount);
        var detail = Assert.IsType<PtvHomeUserAccessAdminView>(Assert.IsType<OkObjectResult>(
            await controller.Current(UserId.ToString("N"), CancellationToken.None)).Value);
        Assert.True(detail.MigrationRecoveryRestricted);
        var batch = Assert.IsType<PtvHomeUserVerificationBatchStatus>(Assert.IsType<OkObjectResult>(
            await controller.BeginVerificationBatch(CancellationToken.None)).Value);
        Assert.Empty(batch.CandidateUserIds);
    }

    private static PtvHomeAccessDefinition Access(bool all, string[]? folders = null, Guid? userId = null) => new()
    {
        UserId = (userId ?? UserId).ToString("N"), EnableAllFolders = all, EnabledFolders = folders ?? []
    };

    private static PtvHomeUserVerificationIntent Confirm(PtvHomeAccessDefinition intended) => new()
    { IntendedAccess = intended, ConfirmCurrentPolicy = true };

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
    }

    private sealed class Topology(string epoch) : IPtvHomeTopologyLedger
    {
        public Task<PtvHomeTopologySnapshot> ReadAsync(CancellationToken token = default) => Task.FromResult(new PtvHomeTopologySnapshot
        {
            SchemaVersion = 1, ServerId = "server-a", Sequence = 1, Epoch = epoch, RequiresFreshGeneration = false
        });
        public Task<PtvHomeTopologySnapshot> BeginAsync(PtvHomeTransitionIntent intent, CancellationToken token = default) => throw new NotSupportedException();
        public Task<PtvHomeTopologySnapshot> BeginAsync(PtvHomeTransitionIntent intent, IReadOnlyDictionary<string, string> observed, CancellationToken token = default) => throw new NotSupportedException();
        public Task<PtvHomeTopologySnapshot> CompleteAsync(Guid id, PtvVerifiedTransitionReadback readback, CancellationToken token = default) => throw new NotSupportedException();
        public Task<PtvHomeTopologySnapshot> RebindAsync(Guid id, IReadOnlyDictionary<string, string> verified, CancellationToken token = default) => throw new NotSupportedException();
    }

    public class UserProxy : DispatchProxy
    {
        public User? User;
        public User? LaterUser;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.Name switch
        {
            nameof(IUserManager.GetUserById) => User?.Id == (Guid)args![0]! ? User :
                LaterUser?.Id == (Guid)args[0]! ? LaterUser : null,
            nameof(IUserManager.GetUsersIds) => new[] { User?.Id, LaterUser?.Id }.OfType<Guid>(),
            _ => throw new InvalidOperationException("Unexpected user operation: " + method?.Name)
        };
    }

    public class LibraryProxy : DispatchProxy
    {
        public VirtualFolderInfo[] Folders = [];
        public bool Visible;
        public int UserAwareCalls;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.Name switch
        {
            nameof(ILibraryManager.GetVirtualFolders) => Folders.ToList(),
            nameof(ILibraryManager.GetItemById) => ReadFolder(method, args),
            _ => throw new InvalidOperationException("Unexpected library operation: " + method?.Name)
        };

        private object? ReadFolder(MethodInfo method, object?[]? args)
        {
            if (args is null || args.Length == 0 || args[0] is not Guid id
                || Folders.All(folder => folder.ItemId != id.ToString("N"))) return null;
            if (args.Length > 1)
            {
                UserAwareCalls++;
                if (!Visible || args[1] is not User user || user.Id != UserId) return null;
            }
            return new CollectionFolder { Id = id };
        }
    }

    private sealed class Authorization : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource,
            IEnumerable<IAuthorizationRequirement> requirements) => Task.FromResult(AuthorizationResult.Success());
        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource,
            string policyName) => Task.FromResult(AuthorizationResult.Success());
    }

    private sealed class DeniedAuthorization : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource,
            IEnumerable<IAuthorizationRequirement> requirements) => Task.FromResult(AuthorizationResult.Failed());
        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource,
            string policyName) => Task.FromResult(AuthorizationResult.Failed());
    }
}
