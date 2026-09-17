using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Minimal immutable-identity view of Jellyfin users used by account persistence.</summary>
public interface IPtvJellyfinUserProvider
{
    /// <summary>Gets all current local Jellyfin identities.</summary>
    IReadOnlyList<PtvJellyfinUser> GetUsers();

    /// <summary>Gets one current local Jellyfin identity.</summary>
    PtvJellyfinUser? GetById(Guid userId);
}

/// <summary>Immutable Jellyfin identity projection.</summary>
public sealed record PtvJellyfinUser(Guid Id, string Username);

/// <summary>Production adapter over Jellyfin's user manager.</summary>
public sealed class PtvJellyfinUserProvider : IPtvJellyfinUserProvider
{
    private readonly IUserManager _userManager;

    /// <summary>Initializes the Jellyfin identity adapter.</summary>
    public PtvJellyfinUserProvider(IUserManager userManager)
    {
        _userManager = userManager;
    }

    /// <inheritdoc />
    public IReadOnlyList<PtvJellyfinUser> GetUsers() => _userManager.GetUsers()
        .Select(user => new PtvJellyfinUser(user.Id, user.Username))
        .ToList();

    /// <inheritdoc />
    public PtvJellyfinUser? GetById(Guid userId)
    {
        var user = _userManager.GetUserById(userId);
        return user is null ? null : new PtvJellyfinUser(user.Id, user.Username);
    }
}
