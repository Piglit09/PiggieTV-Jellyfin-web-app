using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvAccountControllerContractTests
{
    [Fact]
    public void ControllerRequiresAuthenticationAndOnlyTokenConsumeIsAnonymous()
    {
        Assert.NotNull(typeof(PtvAccountController).GetCustomAttributes(typeof(AuthorizeAttribute), true).SingleOrDefault());

        var verify = typeof(PtvAccountController).GetMethod(nameof(PtvAccountController.VerifyEmail))!;
        Assert.NotNull(verify.GetCustomAttributes(typeof(AllowAnonymousAttribute), true).SingleOrDefault());

        foreach (var methodName in new[]
                 {
                     nameof(PtvAccountController.GetProfile),
                     nameof(PtvAccountController.StartVerification),
                     nameof(PtvAccountController.ResendVerification),
                     nameof(PtvAccountController.CancelVerification),
                     nameof(PtvAccountController.GetAdminHealth),
                     nameof(PtvAccountController.GetAdminUsers),
                     nameof(PtvAccountController.CreateBackup),
                     nameof(PtvAccountController.RestoreBackup)
                 })
        {
            Assert.Empty(typeof(PtvAccountController).GetMethod(methodName)!.GetCustomAttributes(typeof(AllowAnonymousAttribute), true));
        }
    }

    [Fact]
    public void AdminUsersIsAnAuthenticatedGetAtTheExpectedRoute()
    {
        var method = typeof(PtvAccountController).GetMethod(nameof(PtvAccountController.GetAdminUsers))!;
        var route = Assert.Single(method.GetCustomAttributes(typeof(HttpGetAttribute), true).Cast<HttpGetAttribute>());

        Assert.Equal("admin/users", route.Template);
        Assert.Empty(method.GetCustomAttributes(typeof(AllowAnonymousAttribute), true));
    }

    [Fact]
    public void SelfServiceEmailPayloadCannotSelectAnotherUser()
    {
        var properties = typeof(PtvAccountEmailRequest).GetProperties().Select(property => property.Name).ToArray();
        Assert.Equal([nameof(PtvAccountEmailRequest.Email)], properties);
    }

    [Fact]
    public void RestoreIsPostOnlyAndRequiresExplicitConfirmationModel()
    {
        var method = typeof(PtvAccountController).GetMethod(nameof(PtvAccountController.RestoreBackup))!;
        var route = Assert.Single(method.GetCustomAttributes(typeof(HttpPostAttribute), true).Cast<HttpPostAttribute>());
        Assert.Equal("admin/backups/restore", route.Template);

        var request = new PtvAccountBackupRestoreRequest();
        Assert.True(request.DryRun);
        Assert.False(request.Confirm);
    }
}
