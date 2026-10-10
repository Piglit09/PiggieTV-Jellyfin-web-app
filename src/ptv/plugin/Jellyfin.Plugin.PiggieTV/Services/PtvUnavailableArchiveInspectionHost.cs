using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Fail-closed host until packaging supplies a proved, memory-limited helper configuration.</summary>
internal sealed class PtvUnavailableArchiveInspectionHost : IPtvArchiveInspectionHost
{
    public Task<PtvComicInfoBytesResult> ReadComicInfoAsync(string authoritativePath, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new PtvComicInfoBytesResult("unverified", "HELPER_UNAVAILABLE", []));
    }
}
