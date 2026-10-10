using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Ptv.ComicInfo.Helper;

/// <summary>Independent of the parent, async cancellation, and thread-pool availability.</summary>
internal static class HelperLifetime
{
    internal static void Arm()
    {
        var started = Stopwatch.GetTimestamp();
        var watchdog = new Thread(() =>
        {
            while (true)
            {
                var remaining = TimeSpan.FromSeconds(5) - Stopwatch.GetElapsedTime(started);
                if (remaining <= TimeSpan.Zero) break;
                Thread.Sleep(remaining);
            }
            // No managed shutdown hooks, exception message, path, or core dump.
            // Ordinary OS scheduling applies: this is not a frozen-process guarantee.
            if (OperatingSystem.IsWindows()) TerminateProcess(GetCurrentProcess(), 124);
            else ImmediateExit(124);
        }) { IsBackground = true, Name = "ComicInfo lifetime" };
        watchdog.Start();
    }

    [DllImport("libc", EntryPoint = "_exit")]
    private static extern void ImmediateExit(int status);
    [DllImport("kernel32.dll")]
    private static extern nint GetCurrentProcess();
    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(nint process, uint exitCode);
}
