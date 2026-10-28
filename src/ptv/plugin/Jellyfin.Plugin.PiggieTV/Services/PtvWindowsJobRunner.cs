using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Jellyfin.Plugin.PiggieTV.Services;

internal sealed class PtvWindowsJobRunner(string executablePath) : IPtvArchiveProcessRunner
{
    public async Task<IPtvArchiveProcess?> StartAsync(string pipeName, CancellationToken token)
    {
        if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64
            || !Path.IsPathFullyQualified(executablePath) || !File.Exists(executablePath)) return null;
        token.ThrowIfCancellationRequested();
        nint job = 0;
        Native.ProcessInformation child = default;
        WindowsProcess? session = null;
        try
        {
            job = Native.CreateJobObjectW(0, null);
            if (job == 0) throw new Win32Exception();
            var limits = new Native.ExtendedLimits
            {
                Basic = new Native.BasicLimits { Flags = 0x100 | 0x200 | 0x2000 },
                ProcessMemory = (nuint)PtvArchiveInspectionHost.MemoryBudget,
                JobMemory = (nuint)PtvArchiveInspectionHost.MemoryBudget
            };
            if (!Native.SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<Native.ExtendedLimits>()))
                throw new Win32Exception();
            var startup = new Native.StartupInfo { Size = (uint)Marshal.SizeOf<Native.StartupInfo>() };
            // No inherited handles, shell, archive path, breakaway flag, or visible console.
            var command = new StringBuilder(Quote(executablePath) + " --pipe " + Quote(pipeName));
            if (!Native.CreateProcessW(executablePath, command, 0, 0, false, 0x4 | 0x08000000,
                0, Path.GetDirectoryName(executablePath), ref startup, out child)) throw new Win32Exception();
            session = new WindowsProcess(job, child.Process);
            job = 0;
            if (!Native.AssignProcessToJobObject(session.Job, child.Process)
                || !Native.IsProcessInJob(child.Process, session.Job, out var assigned) || !assigned
                || !Native.QueryInformationJobObject(session.Job, 9, out Native.ExtendedLimits actual,
                    (uint)Marshal.SizeOf<Native.ExtendedLimits>(), 0)
                || actual.ProcessMemory != (nuint)PtvArchiveInspectionHost.MemoryBudget
                || actual.JobMemory != (nuint)PtvArchiveInspectionHost.MemoryBudget
                || (actual.Basic.Flags & (0x100 | 0x200 | 0x2000)) != (0x100 | 0x200 | 0x2000))
                throw new Win32Exception();
            token.ThrowIfCancellationRequested();
            if (Native.ResumeThread(child.Thread) == uint.MaxValue) throw new Win32Exception();
            session.LimitConfirmed = true;
            return session;
        }
        catch (Win32Exception)
        {
            if (session is not null) await session.DisposeAsync().ConfigureAwait(false);
            return null;
        }
        catch
        {
            if (session is not null) await session.DisposeAsync().ConfigureAwait(false);
            throw;
        }
        finally
        {
            if (child.Thread != 0) Native.CloseHandle(child.Thread);
            if (job != 0) Native.CloseHandle(job);
        }
    }

    // Both arguments are either an existing Windows filename (quotes prohibited
    // by the filesystem) or our generated pipe name; neither has a trailing slash.
    private static string Quote(string value) => "\"" + value + "\"";

    internal sealed class WindowsProcess(nint job, nint process) : IPtvArchiveProcess
    {
        internal nint Job => job;
        internal bool LimitConfirmed;
        private int disposed;
        public long MemoryLimitBytes => LimitConfirmed ? PtvArchiveInspectionHost.MemoryBudget : 0;
        public int ExitCode => Native.GetExitCodeProcess(process, out var code)
            ? unchecked((int)code) : throw new IOException("HELPER_WAIT_FAILED");
        public async Task WaitForExitAsync(CancellationToken token)
        {
            while (true)
            {
                token.ThrowIfCancellationRequested();
                var status = Native.WaitForSingleObject(process, 0);
                if (status == 0) return;
                if (status != 258) throw new IOException("HELPER_WAIT_FAILED");
                await Task.Delay(10, token).ConfigureAwait(false);
            }
        }
        public async ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref disposed, 1) != 0) return;
            try
            {
                await PtvArchiveProcessCleanup.RunAsync(async token =>
                {
                    // Attempt both: direct termination also covers assignment failure
                    // while suspended. An already exited process may reject terminate.
                    var jobTerminated = Native.TerminateJobObject(job, 1);
                    var processTerminated = Native.TerminateProcess(process, 1);
                    // Job termination can already be in progress when direct
                    // termination fails. Either accepted request still requires
                    // bounded exit AND empty-Job verification below.
                    if (!jobTerminated && !processTerminated && Native.WaitForSingleObject(process, 0) != 0)
                        throw new IOException("HELPER_REAP_FAILED");
                    await WaitForExitAsync(token).ConfigureAwait(false);
                    while (true)
                    {
                        token.ThrowIfCancellationRequested();
                        if (!Native.QueryAccounting(job, 1, out var accounting,
                            (uint)Marshal.SizeOf<Native.BasicAccounting>(), 0)) throw new IOException("HELPER_REAP_FAILED");
                        if (accounting.ActiveProcesses == 0) break;
                        await Task.Delay(10, token).ConfigureAwait(false);
                    }
                }).ConfigureAwait(false);
            }
            finally
            {
                Native.CloseHandle(process);
                Native.CloseHandle(job); // kill-on-close remains a final fail-safe.
            }
        }
    }

    internal static class Native
    {
        [StructLayout(LayoutKind.Sequential)] internal struct BasicLimits
        {
            internal long ProcessTime, JobTime;
            internal uint Flags;
            internal nuint MinWorkingSet, MaxWorkingSet;
            internal uint ActiveProcessLimit;
            internal nuint Affinity;
            internal uint Priority, Scheduling;
        }
        [StructLayout(LayoutKind.Sequential)] internal struct ExtendedLimits
        {
            internal BasicLimits Basic;
            internal ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
            internal nuint ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
        }
        [StructLayout(LayoutKind.Sequential)] internal struct BasicAccounting
        {
            internal long UserTime, KernelTime, ThisUserTime, ThisKernelTime;
            internal uint Faults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
        }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct StartupInfo
        {
            internal uint Size;
            internal nint Reserved, Desktop, Title;
            internal uint X, Y, XSize, YSize, XCount, YCount, Fill, Flags;
            internal ushort ShowWindow, ReservedSize;
            internal nint ReservedBytes, Input, Output, Error;
        }
        [StructLayout(LayoutKind.Sequential)] internal struct ProcessInformation
        {
            internal nint Process, Thread;
            internal uint ProcessId, ThreadId;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern nint CreateJobObjectW(nint attributes, string? name);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool SetInformationJobObject(nint job, int type, ref ExtendedLimits info, uint size);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool QueryInformationJobObject(nint job, int type, out ExtendedLimits info, uint size, nint returned);
        [DllImport("kernel32.dll", EntryPoint = "QueryInformationJobObject", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool QueryAccounting(nint job, int type, out BasicAccounting info, uint size, nint returned);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool AssignProcessToJobObject(nint job, nint process);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool IsProcessInJob(nint process, nint job, [MarshalAs(UnmanagedType.Bool)] out bool result);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CreateProcessW(string application, StringBuilder command, nint processAttributes,
            nint threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags, nint environment, string? directory, ref StartupInfo startup, out ProcessInformation info);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(nint thread);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(nint handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetExitCodeProcess(nint process, out uint code);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool TerminateJobObject(nint job, uint code);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool TerminateProcess(nint process, uint code);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CloseHandle(nint handle);
    }
}
