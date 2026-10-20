using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

[Collection("Configured row association serial")]
public sealed class PtvSignupPasswordResetTests
{
    [Fact]
    public async Task Successful_reset_retires_every_outstanding_code_for_the_same_account()
    {
        using var fixture = new Fixture();
        fixture.AddCode("member@example.test", "member", "111222");
        fixture.AddCode("MEMBER@example.test", "member", "333444");
        fixture.AddCode("other@example.test", "other", "555666");

        var first = await fixture.Service.ConfirmPasswordResetAsync(
            Request("member@example.test", "111222", "firstPassword1"), "test", CancellationToken.None);

        Assert.True(first.Ok);
        Assert.DoesNotContain(fixture.Configuration.SignupSettings.PasswordResetCodes,
            code => string.Equals(code.Email, "member@example.test", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(fixture.Serializer.SavedCodes,
            email => string.Equals(email, "member@example.test", StringComparison.OrdinalIgnoreCase));
        Assert.Single(fixture.Configuration.SignupSettings.PasswordResetCodes);

        var replay = await fixture.Service.ConfirmPasswordResetAsync(
            Request("member@example.test", "333444", "secondPassword2"), "test", CancellationToken.None);

        Assert.False(replay.Ok);
        Assert.Equal(1, fixture.UserManager.PasswordChanges);
        Assert.Single(fixture.Configuration.SignupSettings.PasswordResetCodes);
    }

    [Fact]
    public async Task Password_is_not_changed_when_reset_code_retirement_cannot_be_saved()
    {
        using var fixture = new Fixture();
        fixture.AddCode("member@example.test", "member", "111222");
        fixture.AddCode("member@example.test", "member", "333444");
        fixture.Serializer.FailWrites = true;

        var result = await fixture.Service.ConfirmPasswordResetAsync(
            Request("member@example.test", "111222", "firstPassword1"), "test", CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal(0, fixture.UserManager.PasswordChanges);
    }

    [Fact]
    public async Task Concurrent_redemption_allows_only_one_password_change()
    {
        using var fixture = new Fixture();
        fixture.AddCode("member@example.test", "member", "111222");
        fixture.AddCode("member@example.test", "member", "333444");

        var results = await Task.WhenAll(
            fixture.Service.ConfirmPasswordResetAsync(
                Request("member@example.test", "111222", "firstPassword1"), "test", CancellationToken.None),
            fixture.Service.ConfirmPasswordResetAsync(
                Request("member@example.test", "333444", "secondPassword2"), "test", CancellationToken.None));

        Assert.Single(results, result => result.Ok);
        Assert.Equal(1, fixture.UserManager.PasswordChanges);
        Assert.Empty(fixture.Configuration.SignupSettings.PasswordResetCodes);
        Assert.Empty(fixture.Serializer.SavedCodes);
    }

    [Fact]
    public async Task Expired_reset_code_cannot_change_password()
    {
        using var fixture = new Fixture();
        fixture.AddCode("member@example.test", "member", "111222");
        fixture.Configuration.SignupSettings.PasswordResetCodes[0].ExpiresAtUtc = DateTimeOffset.UtcNow.AddMinutes(-1);

        var result = await fixture.Service.ConfirmPasswordResetAsync(
            Request("member@example.test", "111222", "firstPassword1"), "test", CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal(0, fixture.UserManager.PasswordChanges);
    }

    [Fact]
    public async Task Failed_password_change_leaves_codes_retired_for_recoverable_retry()
    {
        using var fixture = new Fixture();
        fixture.AddCode("member@example.test", "member", "111222");
        fixture.AddCode("member@example.test", "member", "333444");
        fixture.UserManager.FailPasswordChanges = true;

        var result = await fixture.Service.ConfirmPasswordResetAsync(
            Request("member@example.test", "111222", "firstPassword1"), "test", CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal(1, fixture.UserManager.PasswordChanges);
        Assert.Empty(fixture.Configuration.SignupSettings.PasswordResetCodes);
        Assert.Empty(fixture.Serializer.SavedCodes);
    }

    private static PtvSignupPasswordResetConfirmRequest Request(string email, string code, string password) => new()
    {
        Email = email,
        Code = code,
        Password = password,
        ConfirmPassword = password
    };

    private sealed class Fixture : IDisposable
    {
        private readonly Plugin? _previousPlugin = Plugin.Instance;
        private readonly string _directory = Path.Combine(Path.GetTempPath(), "ptv-reset-tests-" + Guid.NewGuid().ToString("N"));
        private readonly Guid _userId = Guid.NewGuid();

        public PluginConfiguration Configuration { get; } = new();
        public XmlProxy Serializer { get; }
        public UserManagerProxy UserManager { get; }
        public PtvSignupService Service { get; }

        public Fixture()
        {
            var paths = DispatchProxy.Create<IApplicationPaths, PathsProxy>();
            ((PathsProxy)(object)paths).Directory = _directory;
            var xml = DispatchProxy.Create<IXmlSerializer, XmlProxy>();
            Serializer = (XmlProxy)(object)xml;
            var plugin = new Plugin(paths, xml);
            plugin.UpdateConfiguration(Configuration);

            var users = DispatchProxy.Create<IUserManager, UserManagerProxy>();
            UserManager = (UserManagerProxy)(object)users;
            UserManager.User = new User("member", "test", "reset") { Id = _userId };
            var account = DispatchProxy.Create<IPtvAccountService, AccountProxy>();
            ((AccountProxy)(object)account).Profile = new PtvProfileRecord
            {
                JellyfinUserId = _userId.ToString("N"),
                UsernameSnapshot = "member",
                Email = "member@example.test",
                EmailNormalized = "member@example.test",
                EmailVerified = true
            };
            Service = new PtvSignupService(
                NullLogger<PtvSignupService>.Instance,
                users,
                DispatchProxy.Create<ILibraryManager, LibraryProxy>(),
                DispatchProxy.Create<IDataProtectionProvider, ProtectionProxy>(),
                account,
                DispatchProxy.Create<IPtvMailService, MailProxy>(),
                DispatchProxy.Create<IPtvHomeUserAccessLedger, HomeAccessProxy>(),
                DispatchProxy.Create<IPtvHomeTopologyLedger, HomeTopologyProxy>());
        }

        public void AddCode(string email, string username, string code)
        {
            var input = email.Trim().ToLowerInvariant() + "|" + code;
            Configuration.SignupSettings.PasswordResetCodes.Add(new SignupPasswordResetCode
            {
                Email = email,
                Username = username,
                CodeHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(input))).ToLowerInvariant(),
                ExpiresAtUtc = DateTimeOffset.UtcNow.AddMinutes(15)
            });
        }

        public void Dispose()
        {
            typeof(Plugin).GetField("<Instance>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic)!
                .SetValue(null, _previousPlugin);
            if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
        }
    }

    public class UserManagerProxy : DispatchProxy
    {
        public User? User { get; set; }
        public int PasswordChanges { get; private set; }
        public bool FailPasswordChanges { get; set; }

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method?.Name == nameof(IUserManager.GetUserById)) return User;
            if (method?.Name == "ChangePassword")
            {
                PasswordChanges++;
                if (FailPasswordChanges) return Task.FromException(new IOException("Synthetic password change failure."));
                return Task.CompletedTask;
            }
            throw new NotSupportedException(method?.Name);
        }
    }

    public class AccountProxy : DispatchProxy
    {
        public PtvProfileRecord? Profile { get; set; }

        protected override object? Invoke(MethodInfo? method, object?[]? args) =>
            method?.Name == nameof(IPtvAccountService.FindVerifiedProfileByEmailAsync)
                ? Task.FromResult(Profile)
                : throw new NotSupportedException(method?.Name);
    }

    public class PathsProxy : DispatchProxy
    {
        public string Directory { get; set; } = string.Empty;

        protected override object? Invoke(MethodInfo? method, object?[]? args) =>
            method?.Name.StartsWith("get_", StringComparison.Ordinal) == true && method.ReturnType == typeof(string)
                ? Directory
                : throw new NotSupportedException(method?.Name);
    }

    public class XmlProxy : DispatchProxy
    {
        public IReadOnlyList<string> SavedCodes { get; private set; } = [];
        public bool FailWrites { get; set; }

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method?.Name == "SerializeToFile")
            {
                if (FailWrites) throw new IOException("Synthetic configuration persistence failure.");
                SavedCodes = ((PluginConfiguration)args![0]!).SignupSettings.PasswordResetCodes
                    .Select(code => code.Email).ToArray();
                return null;
            }
            throw new NotSupportedException(method?.Name);
        }
    }

    public class ProtectionProxy : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? method, object?[]? args) =>
            method?.Name == "CreateProtector"
                ? DispatchProxy.Create<IDataProtector, ProtectorProxy>()
                : throw new NotSupportedException(method?.Name);
    }

    public class ProtectorProxy : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? method, object?[]? args) => throw new NotSupportedException(method?.Name);
    }

    public class LibraryProxy : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? method, object?[]? args) => throw new NotSupportedException(method?.Name);
    }

    public class MailProxy : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? method, object?[]? args) => throw new NotSupportedException(method?.Name);
    }

    public class HomeAccessProxy : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? method, object?[]? args) => throw new NotSupportedException(method?.Name);
    }

    public class HomeTopologyProxy : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? method, object?[]? args) => throw new NotSupportedException(method?.Name);
    }
}
