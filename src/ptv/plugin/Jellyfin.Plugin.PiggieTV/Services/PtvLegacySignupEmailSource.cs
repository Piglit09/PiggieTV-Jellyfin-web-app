using Jellyfin.Plugin.PiggieTV.Configuration;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Reads legacy signup mappings from the established plugin configuration.</summary>
public sealed class PtvLegacySignupEmailSource : IPtvLegacySignupEmailSource
{
    /// <inheritdoc />
    public IReadOnlyList<SignupUserRecord> GetRecords() =>
        (Plugin.Instance?.Configuration.SignupSettings?.Users ?? [])
            .Select(record => new SignupUserRecord
            {
                CreatedAtUtc = record.CreatedAtUtc,
                Email = record.Email,
                PolicyPresetId = record.PolicyPresetId,
                RemoteAddress = record.RemoteAddress,
                UserId = record.UserId,
                Username = record.Username
            })
            .ToList();
}
