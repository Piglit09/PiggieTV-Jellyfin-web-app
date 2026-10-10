using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Reads bounded ComicInfo bytes from a trusted server-resolved path.</summary>
public interface IPtvArchiveInspectionHost
{
    /// <summary>Inspects an archive without exposing its path in the result.</summary>
    Task<PtvComicInfoBytesResult> ReadComicInfoAsync(string authoritativePath, CancellationToken cancellationToken);
}

internal interface IPtvArchiveProcessRunner
{
    Task<IPtvArchiveProcess?> StartAsync(string pipeName, CancellationToken token);
}

internal interface IPtvArchiveProcess : IAsyncDisposable
{
    long MemoryLimitBytes { get; }
    int ExitCode { get; }
    Task WaitForExitAsync(CancellationToken token);
}

// Unlike archive unreadability, lost process cleanup is infrastructure failure.
internal sealed class PtvArchiveReapException : Exception
{
    internal PtvArchiveReapException() : base("HELPER_REAP_FAILED") { }
}

internal static class PtvArchiveProcessCleanup
{
    internal static readonly TimeSpan Budget = TimeSpan.FromSeconds(1);

    internal static async Task RunAsync(Func<CancellationToken, Task> cleanup)
    {
        // Cleanup must outlive request cancellation, but cannot wait forever for
        // an unreapable child. Failure leaves the host's permit consumed.
        using var deadline = new CancellationTokenSource(Budget);
        try
        {
            await cleanup(deadline.Token).WaitAsync(deadline.Token).ConfigureAwait(false);
        }
        catch { throw new PtvArchiveReapException(); }
    }
}
