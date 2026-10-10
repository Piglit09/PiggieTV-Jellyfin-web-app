using System.Buffers.Binary;
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using Jellyfin.Plugin.PiggieTV.Services;

if (args is ["--descendant"])
{
    await Task.Delay(Timeout.Infinite);
    return 0;
}
if (args is ["--pipe", var endpoint]) return await RunChild(endpoint);
if (args is ["--deadline-only"])
{
    try { await VerifyWholeDeadlineAndRetainedCapacity(); Console.WriteLine("PASS"); return 0; }
    catch (Exception error) { Console.Error.WriteLine("FAIL: " + error.Message); return 1; }
}
if (args is ["--orphan-parent", var delegation])
{
    // Non-shipping local proof: do not dispose the runner after SIGKILL; the
    // child's production watchdog must end a synchronous blocked operation.
    var name = "ptv-comic-" + Guid.NewGuid().ToString("N");
    using var pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
    var orphanRunner = new PtvLinuxCgroupRunner(Environment.ProcessPath!, delegation);
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
    var child = await orphanRunner.StartAsync(name, timeout.Token) ?? throw new Exception("limited launch unavailable");
    await pipe.WaitForConnectionAsync(timeout.Token);
    await SendFrame(pipe, "orphan-block", timeout.Token);
    Require(await ReadFrame(pipe, timeout.Token) == "ARMED", "orphan watchdog armed");
    Console.WriteLine("ORPHAN_ARMED"); Console.Out.Flush();
    await Task.Delay(Timeout.Infinite);
    GC.KeepAlive(child);
    return 0;
}
if (args.Length > 1) return 2;

var root = args.FirstOrDefault();
var executable = Environment.ProcessPath!;
IPtvArchiveProcessRunner runner = OperatingSystem.IsWindows()
    ? new PtvWindowsJobRunner(executable) : new PtvLinuxCgroupRunner(executable, root);
var baseline = Children();
try
{
    var unavailable = await new PtvArchiveInspectionHost(new PtvLinuxCgroupRunner(executable, null))
        .ReadComicInfoAsync("absent", CancellationToken.None);
    Require(unavailable.State == "unverified" && unavailable.ReasonCode == "HELPER_LIMIT_UNAVAILABLE", "missing delegation");

    var host = new PtvArchiveInspectionHost(runner);
    var absent = await host.ReadComicInfoAsync("absent", CancellationToken.None);
    Require(absent.State == "absent", "normal helper round trip: " + absent.ReasonCode);
    RequireNoChildren();

    var watch = Stopwatch.StartNew();
    var timeout = await host.ReadComicInfoAsync("spawn-and-hang", CancellationToken.None);
    Require(timeout.ReasonCode == "HELPER_TIMEOUT" && watch.Elapsed.TotalSeconds is >= 3.5 and < 5, "whole-operation timeout");
    RequireNoChildren();
    Console.WriteLine($"timeout_seconds={watch.Elapsed.TotalSeconds:F3}; lingering_children=0");

    using (var cancel = new CancellationTokenSource(500))
    {
        try { await host.ReadComicInfoAsync("hang", cancel.Token); throw new Exception("cancellation swallowed"); }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested) { }
    }
    RequireNoChildren();
    Console.WriteLine("cancellation_reaped=true; lingering_children=0");

    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    var name = "ptv-comic-" + Guid.NewGuid().ToString("N");
    await using (var pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
        PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly))
    {
        var process = await runner.StartAsync(name, deadline.Token);
        Require(process is not null, "OS limit setup");
        await using (process!)
        {
            Require(process!.MemoryLimitBytes == 536870912, "limit before input");
            await pipe.WaitForConnectionAsync(deadline.Token);
            await SendFrame(pipe, "allocate", deadline.Token);
            if (OperatingSystem.IsWindows())
            {
                var response = await ReadFrame(pipe, deadline.Token);
                Require(response == "ALLOCATION_REJECTED", "Windows 600 MiB committed allocation must fail");
                var windows = (PtvWindowsJobRunner.WindowsProcess)process;
                Require(PtvWindowsJobRunner.Native.QueryInformationJobObject(windows.Job, 9, out var actual,
                    (uint)Marshal.SizeOf<PtvWindowsJobRunner.Native.ExtendedLimits>(), 0), "query measured Job limit");
                Console.WriteLine($"memory_limit_bytes={actual.ProcessMemory}; job_limit_bytes={actual.JobMemory}; peak_commit_bytes={actual.PeakJobMemory}; over_budget_allocation_rejected=true");
            }
            else
            {
                var group = Directory.GetDirectories(root!, "ptv-comic-*").Single();
                await process.WaitForExitAsync(deadline.Token);
                var events = await File.ReadAllLinesAsync(Path.Combine(group, "memory.events"));
                var kills = long.Parse(events.Single(line => line.StartsWith("oom_kill ", StringComparison.Ordinal)).Split(' ')[1]);
                Require(kills > 0, "Linux kernel OOM kill");
                var max = (await File.ReadAllTextAsync(Path.Combine(group, "memory.max"))).Trim();
                var peak = (await File.ReadAllTextAsync(Path.Combine(group, "memory.peak"))).Trim();
                Require(max == "536870912", "Linux memory.max readback");
                Console.WriteLine($"memory_limit_bytes={max}; memory_peak_bytes={peak}; oom_kill={kills}");
            }
            await process.WaitForExitAsync(deadline.Token);
        }
    }
    RequireNoChildren();
    if (root is not null) Require(Directory.GetDirectories(root, "ptv-comic-*").Length == 0, "cgroup cleanup");
    // A startup that cannot prove reaping must consume its permit permanently.
    // Run this last in an isolated process because the correct host fails closed
    // until restart; there are no actual children in this injected failure case.
    await VerifyWholeDeadlineAndRetainedCapacity();
    Console.WriteLine("PASS; lingering_children=0");
    return 0;
}
catch (Exception error)
{
    Console.Error.WriteLine("FAIL: " + error.Message);
    return 1;
}

HashSet<int> Children() => Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executable))
    .Select(process => { using (process) return process.Id; }).Where(id => id != Environment.ProcessId).ToHashSet();
void RequireNoChildren() => Require(!Children().Except(baseline).Any(), "no lingering children");
static void Require(bool value, string label) { if (!value) throw new Exception(label); }

static async Task VerifyWholeDeadlineAndRetainedCapacity()
{
    var watch = Stopwatch.StartNew();
    try
    {
        await new PtvArchiveInspectionHost(new StalledLaunchAndReapRunner()).ReadComicInfoAsync("absent", CancellationToken.None);
        throw new Exception("unreapable cleanup swallowed");
    }
    catch (PtvArchiveReapException) { }
    Console.WriteLine($"unreapable_total_seconds={watch.Elapsed.TotalSeconds:F3}");
    // Timer dispatch is not a real-time OS guarantee; allow 350 ms scheduling
    // tolerance while rejecting an additional one-second cleanup extension.
    Require(watch.Elapsed.TotalSeconds is >= 4.8 and < 5.35, "five-second total must include worst-case cleanup");

    var failedRunner = new FailedReapRunner();
    var failedHost = new PtvArchiveInspectionHost(failedRunner);
    try { await failedHost.ReadComicInfoAsync("absent", CancellationToken.None); throw new Exception("failed reap swallowed"); }
    catch (PtvArchiveReapException) { }
    var denied = await failedHost.ReadComicInfoAsync("absent", CancellationToken.None);
    Require(denied.ReasonCode == "HELPER_TIMEOUT" && failedRunner.Starts == 1, "failed reap must not release capacity");
    Console.WriteLine("failed_reap_blocks_new_launches=true");
}

static async Task<int> RunChild(string name)
{
    await using var pipe = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.Asynchronous);
    await pipe.ConnectAsync();
    var mode = await ReadFrame(pipe, CancellationToken.None);
    if (mode == "orphan-block")
    {
        Ptv.ComicInfo.Helper.HelperLifetime.Arm();
        await SendFrame(pipe, "ARMED", CancellationToken.None);
        Thread.Sleep(Timeout.Infinite); // Deliberately synchronous, no cancellation.
    }
    if (mode == "spawn-and-hang")
    {
        var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add("--descendant");
        Process.Start(start)?.Dispose();
    }
    if (mode is "hang" or "spawn-and-hang") await Task.Delay(Timeout.Infinite);
    if (mode == "allocate")
    {
        const int bytes = 600 * 1024 * 1024;
        if (OperatingSystem.IsWindows())
        {
            var memory = Native.VirtualAlloc(0, bytes, 0x1000 | 0x2000, 4);
            await SendFrame(pipe, memory == 0 ? "ALLOCATION_REJECTED" : "ALLOCATION_ACCEPTED", CancellationToken.None);
            if (memory != 0) Native.VirtualFree(memory, 0, 0x8000);
        }
        else
        {
            var memory = Marshal.AllocHGlobal(bytes);
            for (var offset = 0; offset < bytes; offset += 4096) Marshal.WriteByte(memory, offset, 1);
            await SendFrame(pipe, "ALLOCATION_ACCEPTED", CancellationToken.None);
            Marshal.FreeHGlobal(memory);
        }
        return 0;
    }
    await SendFrame(pipe, "{\"State\":\"absent\",\"ReasonCode\":\"COMICINFO_ABSENT\",\"Bytes\":\"\"}", CancellationToken.None);
    return 0;
}

static async Task SendFrame(Stream stream, string value, CancellationToken token)
{
    var bytes = Encoding.UTF8.GetBytes(value);
    var header = new byte[4];
    BinaryPrimitives.WriteInt32LittleEndian(header, bytes.Length);
    await stream.WriteAsync(header, token);
    await stream.WriteAsync(bytes, token);
    await stream.FlushAsync(token);
}
static async Task<string> ReadFrame(Stream stream, CancellationToken token)
{
    var header = new byte[4];
    await stream.ReadExactlyAsync(header, token);
    var length = BinaryPrimitives.ReadInt32LittleEndian(header);
    if (length is <= 0 or > 32768) throw new IOException("probe frame invalid");
    var bytes = new byte[length];
    await stream.ReadExactlyAsync(bytes, token);
    return Encoding.UTF8.GetString(bytes);
}
internal static class Native
{
    [DllImport("kernel32.dll")] internal static extern nint VirtualAlloc(nint address, nuint size, uint type, uint protection);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool VirtualFree(nint address, nuint size, uint type);
}
internal sealed class FailedReapRunner : IPtvArchiveProcessRunner
{
    internal int Starts;
    public Task<IPtvArchiveProcess?> StartAsync(string pipeName, CancellationToken token)
    {
        Starts++;
        throw new PtvArchiveReapException();
    }
}
internal sealed class StalledLaunchAndReapRunner : IPtvArchiveProcessRunner
{
    public async Task<IPtvArchiveProcess?> StartAsync(string pipeName, CancellationToken token)
    {
        // External OS boundary substitute: spend the entire work budget, then
        // never acknowledge reaping. No actual child is left running by the test.
        try { await Task.Delay(Timeout.Infinite, token); return null; }
        finally
        {
            var neverReaped = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            try { await PtvArchiveProcessCleanup.RunAsync(_ => neverReaped.Task); }
            finally { neverReaped.TrySetResult(); }
        }
    }
}
