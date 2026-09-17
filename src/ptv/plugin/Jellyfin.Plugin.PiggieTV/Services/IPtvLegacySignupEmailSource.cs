using Jellyfin.Plugin.PiggieTV.Configuration;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Provides a read-only snapshot of legacy signup email mappings for migration.</summary>
public interface IPtvLegacySignupEmailSource
{
    /// <summary>Gets the current legacy signup records without modifying plugin configuration.</summary>
    IReadOnlyList<SignupUserRecord> GetRecords();
}
