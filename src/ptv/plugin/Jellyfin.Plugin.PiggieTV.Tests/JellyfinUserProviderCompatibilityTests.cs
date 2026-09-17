using MediaBrowser.Controller.Library;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class JellyfinUserProviderCompatibilityTests
{
    [Fact]
    public void TargetUserManagerUsesGetUsersMethod()
    {
        var getUsers = typeof(IUserManager).GetMethod(nameof(IUserManager.GetUsers), Type.EmptyTypes);

        Assert.NotNull(getUsers);
        Assert.Null(typeof(IUserManager).GetProperty("Users"));
    }
}
