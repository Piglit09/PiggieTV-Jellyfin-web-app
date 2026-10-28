using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;

namespace Jellyfin.Plugin.PiggieTV.Services;

internal sealed class PtvLinuxCgroupRunner(string executablePath, string? delegatedRoot) : IPtvArchiveProcessRunner
{
    public async Task<IPtvArchiveProcess?> StartAsync(string pipeName, CancellationToken token)
    {
        if (!OperatingSystem.IsLinux() || RuntimeInformation.ProcessArchitecture != Architecture.X64
            || delegatedRoot is null || !Path.IsPathFullyQualified(executablePath) || !File.Exists(executablePath)) return null;
        string? group = null;
        LinuxProcess? session = null;
        try
        {
            token.ThrowIfCancellationRequested();
            var root = Path.GetFullPath(delegatedRoot).TrimEnd('/');
            if (!root.StartsWith("/sys/fs/cgroup/", StringComparison.Ordinal) || !IsCgroup2(root)) return null;
            // Configuration is trusted, but a symlink cannot redirect the writes into
            // an ordinary directory or a different cgroup hierarchy.
            for (var part = new DirectoryInfo(root); part is not null; part = part.Parent)
                if (part.LinkTarget is not null) return null;
            var controllers = await File.ReadAllTextAsync(Path.Combine(root, "cgroup.subtree_control"), token).ConfigureAwait(false);
            if (!controllers.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Contains("memory")) return null;
            group = Path.Combine(root, "ptv-comic-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(group);
            await WriteAndConfirmAsync(group, "memory.max", "536870912", token).ConfigureAwait(false);
            await WriteAndConfirmAsync(group, "memory.swap.max", "0", token).ConfigureAwait(false);
            await WriteAndConfirmAsync(group, "memory.oom.group", "1", token).ConfigureAwait(false);
            // Opening the kill endpoint before launch proves that cleanup is permitted.
            using (File.Open(Path.Combine(group, "cgroup.kill"), FileMode.Open, FileAccess.Write, FileShare.ReadWrite)) { }
            token.ThrowIfCancellationRequested();
            var start = new ProcessStartInfo(executablePath)
            {
                UseShellExecute = false, CreateNoWindow = true,
                // Never forward helper/decoder diagnostics to server logs. If a
                // helper floods either bounded OS pipe, the operation times out.
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            start.ArgumentList.Add("--pipe");
            start.ArgumentList.Add(pipeName);
            var process = Process.Start(start) ?? throw new IOException("HELPER_START_FAILED");
            session = new LinuxProcess(process, group);
            // The trusted helper waits for framed input; it cannot decode an archive
            // while outside the cgroup because no path has been provided.
            await File.WriteAllTextAsync(Path.Combine(group, "cgroup.procs"), process.Id.ToString(CultureInfo.InvariantCulture), token).ConfigureAwait(false);
            var members = await File.ReadAllLinesAsync(Path.Combine(group, "cgroup.procs"), token).ConfigureAwait(false);
            var membership = await File.ReadAllLinesAsync($"/proc/{process.Id}/cgroup", token).ConfigureAwait(false);
            var expected = "0::" + group["/sys/fs/cgroup".Length..];
            if (!members.Contains(process.Id.ToString(CultureInfo.InvariantCulture)) || !membership.Contains(expected))
                throw new IOException("HELPER_LIMIT_UNAVAILABLE");
            if ((await File.ReadAllTextAsync(Path.Combine(group, "memory.max"), token).ConfigureAwait(false)).Trim() != "536870912")
                throw new IOException("HELPER_LIMIT_UNAVAILABLE");
            token.ThrowIfCancellationRequested();
            session.LimitConfirmed = true;
            return session;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            if (session is not null) await session.DisposeAsync().ConfigureAwait(false);
            else if (group is not null) Directory.Delete(group);
            return null;
        }
        catch
        {
            if (session is not null) await session.DisposeAsync().ConfigureAwait(false);
            else if (group is not null) Directory.Delete(group);
            throw;
        }
    }

    private static async Task WriteAndConfirmAsync(string group, string name, string value, CancellationToken token)
    {
        var path = Path.Combine(group, name);
        await File.WriteAllTextAsync(path, value, token).ConfigureAwait(false);
        if ((await File.ReadAllTextAsync(path, token).ConfigureAwait(false)).Trim() != value)
            throw new IOException("HELPER_LIMIT_UNAVAILABLE");
    }

    private static bool IsCgroup2(string path)
    {
        // Linux x64 statfs is smaller than this buffer; its first native long is f_type.
        var buffer = Marshal.AllocHGlobal(256);
        try { return StatFs(path, buffer) == 0 && Marshal.ReadInt64(buffer) == 0x63677270; }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    [DllImport("libc", EntryPoint = "statfs", SetLastError = true)]
    private static extern int StatFs(string path, nint result);

    internal sealed class LinuxProcess(Process process, string group) : IPtvArchiveProcess
    {
        internal bool LimitConfirmed;
        private int disposed;
        public long MemoryLimitBytes => LimitConfirmed ? PtvArchiveInspectionHost.MemoryBudget : 0;
        public int ExitCode => process.ExitCode;
        public Task WaitForExitAsync(CancellationToken token) => process.WaitForExitAsync(token);
        public async ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref disposed, 1) != 0) return;
            try
            {
                await PtvArchiveProcessCleanup.RunAsync(async token =>
                {
                    // cgroup.kill includes descendants even if the original helper exited.
                    await File.WriteAllTextAsync(Path.Combine(group, "cgroup.kill"), "1", token).ConfigureAwait(false);
                    if (!process.HasExited) process.Kill(entireProcessTree: true);
                    await process.WaitForExitAsync(token).ConfigureAwait(false);
                    while (true)
                    {
                        var events = await File.ReadAllLinesAsync(Path.Combine(group, "cgroup.events"), token).ConfigureAwait(false);
                        if (events.Contains("populated 0")) break;
                        await Task.Delay(10, token).ConfigureAwait(false);
                    }
                    token.ThrowIfCancellationRequested();
                    Directory.Delete(group);
                }).ConfigureAwait(false);
            }
            finally { process.Dispose(); }
        }
    }
}
