using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

[CollectionDefinition("Archive host", DisableParallelization = true)]
public sealed class ArchiveHostCollection;

[Collection("Archive host")]
public sealed class PtvArchiveInspectionHostTests
{
    [Fact]
    public async Task LaunchBudgetPrecedesInput()
    {
        var runner = new ControlledRunner { HoldBudget = true };
        var host = new PtvArchiveInspectionHost(runner);
        var pending = host.ReadComicInfoAsync("private/archive.cbz", CancellationToken.None);
        await runner.Started.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.False(runner.InputReceived.Task.IsCompleted);
        runner.BudgetConfirmed.SetResult();
        var result = await pending;
        Assert.Equal("absent", result.State);
        Assert.Equal("private/archive.cbz", await runner.InputReceived.Task);
        Assert.Equal(0, runner.Active);
    }

    [Fact]
    public async Task TimeoutKillsAndReaps()
    {
        var runner = new ControlledRunner { Hang = true };
        var watch = Stopwatch.StartNew();
        var result = await new PtvArchiveInspectionHost(runner).ReadComicInfoAsync("archive.cbr", CancellationToken.None);
        Assert.Equal("unverified", result.State);
        Assert.Equal("HELPER_TIMEOUT", result.ReasonCode);
        Assert.InRange(watch.Elapsed.TotalSeconds, 3.5, 5);
        Assert.Equal(0, runner.Active);
        Assert.Equal(1, runner.Reaped);
    }

    [Fact]
    public async Task CancelledRunKillsAndReaps()
    {
        var runner = new ControlledRunner { Hang = true };
        using var cancelled = new CancellationTokenSource();
        var pending = new PtvArchiveInspectionHost(runner).ReadComicInfoAsync("archive.cbr", cancelled.Token);
        await runner.InputReceived.Task.WaitAsync(TimeSpan.FromSeconds(2));
        cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pending);
        Assert.Equal(0, runner.Active);
        Assert.Equal(1, runner.Reaped);
    }

    [Fact]
    public async Task NoDelegationReturnsUnverified()
    {
        var runner = new ControlledRunner { Unavailable = true };
        var result = await new PtvArchiveInspectionHost(runner).ReadComicInfoAsync("private/archive.cbr", CancellationToken.None);
        Assert.Equal("unverified", result.State);
        Assert.Equal("HELPER_LIMIT_UNAVAILABLE", result.ReasonCode);
        Assert.Empty(result.Bytes);
        Assert.False(runner.InputReceived.Task.IsCompleted);
        Assert.Equal(0, runner.Active);
    }

    [Fact]
    public async Task TooManyHelpersWait()
    {
        var runner = new ControlledRunner { Hang = true };
        using var cancelled = new CancellationTokenSource();
        // Different hosts must share the server process limit.
        var tasks = Enumerable.Range(0, 4).Select(_ => new PtvArchiveInspectionHost(runner)
            .ReadComicInfoAsync("archive.cbr", cancelled.Token)).ToArray();
        await runner.TwoStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));
        await Task.Delay(100);
        Assert.Equal(2, runner.Active);
        Assert.Equal(2, runner.StartCount);
        cancelled.Cancel();
        foreach (var task in tasks) await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
        Assert.Equal(0, runner.Active);
        Assert.Equal(2, runner.Reaped);
    }

    [Fact]
    public async Task UnconfirmedBudgetNeverReceivesInput()
    {
        var runner = new ControlledRunner { Limit = 0 };
        var result = await new PtvArchiveInspectionHost(runner).ReadComicInfoAsync("private/archive.cbr", CancellationToken.None);
        Assert.Equal("HELPER_LIMIT_UNAVAILABLE", result.ReasonCode);
        Assert.False(runner.InputReceived.Task.IsCompleted);
        Assert.Equal(0, runner.Active);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(1048577)]
    public async Task RejectsInvalidOutputFrameWithoutAllocatingIt(int size)
    {
        var runner = new ControlledRunner { OutputSize = size };
        var result = await new PtvArchiveInspectionHost(runner).ReadComicInfoAsync("archive.cbz", CancellationToken.None);
        Assert.Equal("HELPER_PROTOCOL_INVALID", result.ReasonCode);
        Assert.Empty(result.Bytes);
        Assert.Equal(0, runner.Active);
    }

    [Theory]
    [InlineData("unknown", "COMICINFO_ABSENT", 0)]
    [InlineData("absent", "private/archive.cbr", 0)]
    [InlineData("absent", "COMICINFO_ABSENT", 1)]
    [InlineData("inspected", "COMICINFO_FOUND", 524289)]
    public async Task RejectsInvalidResultContract(string state, string code, int bytes)
    {
        var runner = new ControlledRunner
        {
            Output = System.Text.Json.JsonSerializer.Serialize(new { State = state, ReasonCode = code, Bytes = new byte[bytes] })
        };
        var result = await new PtvArchiveInspectionHost(runner).ReadComicInfoAsync("archive.cbz", CancellationToken.None);
        Assert.Equal("HELPER_PROTOCOL_INVALID", result.ReasonCode);
        Assert.Empty(result.Bytes);
        Assert.Equal(0, runner.Active);
    }

    [Fact]
    public void ResultCannotCarryOverBudgetBytes()
    {
        Assert.Throws<System.Text.Json.JsonException>(() => new PtvComicInfoBytesResult("inspected", "COMICINFO_FOUND", new byte[524289]));
    }

    [Fact]
    public async Task CrashAfterResponseIsUnverified()
    {
        var runner = new ControlledRunner { ResultExitCode = 2 };
        var result = await new PtvArchiveInspectionHost(runner).ReadComicInfoAsync("archive.cbz", CancellationToken.None);
        Assert.Equal("unverified", result.State);
        Assert.Equal("HELPER_EXIT_FAILED", result.ReasonCode);
        Assert.Equal(0, runner.Active);
    }

    [Fact]
    public async Task MaximumComicInfoBytesRoundTripExactly()
    {
        var expected = Enumerable.Repeat((byte)65, 524288).ToArray();
        var runner = new ControlledRunner
        {
            Output = System.Text.Json.JsonSerializer.Serialize(new { State = "inspected", ReasonCode = "COMICINFO_FOUND", Bytes = expected })
        };
        var result = await new PtvArchiveInspectionHost(runner).ReadComicInfoAsync("archive.cbz", CancellationToken.None);
        Assert.Equal("inspected", result.State);
        Assert.Equal(expected, result.Bytes);
    }

    [Fact]
    public async Task QueueWaitUsesTheWholeOperationDeadline()
    {
        var busy = new ControlledRunner { Hang = true };
        using var releaseBusy = new CancellationTokenSource();
        var first = new PtvArchiveInspectionHost(busy).ReadComicInfoAsync("first.cbz", releaseBusy.Token);
        var second = new PtvArchiveInspectionHost(busy).ReadComicInfoAsync("second.cbz", releaseBusy.Token);
        await busy.TwoStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));
        var queuedRunner = new ControlledRunner { Hang = true };
        var watch = Stopwatch.StartNew();
        var queued = new PtvArchiveInspectionHost(queuedRunner).ReadComicInfoAsync("third.cbz", CancellationToken.None);
        await Task.Delay(1800);
        Assert.Equal(0, queuedRunner.StartCount);
        releaseBusy.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => second);
        Assert.Equal("HELPER_TIMEOUT", (await queued).ReasonCode);
        Assert.InRange(watch.Elapsed.TotalSeconds, 3.5, 5);
        Assert.Equal(0, queuedRunner.Active);
    }

    [Fact]
    public async Task CleanupDeadlineStopsUnresponsiveReap()
    {
        // Model an OS reap operation that never completes, even when cancelled.
        // The outer wait makes a missing production deadline fail the test safely.
        var stuck = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var watch = Stopwatch.StartNew();
        CancellationToken cleanupToken = default;
        var cleanup = PtvArchiveProcessCleanup.RunAsync(token =>
        {
            cleanupToken = token;
            return stuck.Task;
        });
        try
        {
            await Assert.ThrowsAsync<PtvArchiveReapException>(() => cleanup.WaitAsync(TimeSpan.FromSeconds(3)));
            Assert.InRange(watch.Elapsed.TotalSeconds, 0.8, 2);
            Assert.True(cleanupToken.IsCancellationRequested);
        }
        finally { stuck.TrySetResult(); }
    }

    [Fact]
    public async Task TerminationFailureRaisesInfrastructureError()
    {
        var error = await Assert.ThrowsAsync<PtvArchiveReapException>(() =>
            PtvArchiveProcessCleanup.RunAsync(_ => Task.FromException(new IOException("synthetic OS termination failure"))));
        Assert.Equal("HELPER_REAP_FAILED", error.Message);
        Assert.Null(error.InnerException);
    }

    // The substitute models the external process/OS boundary; the real host owns
    // input ordering, deadline, shared concurrency, framing and reap decisions.
    private sealed class ControlledRunner : IPtvArchiveProcessRunner
    {
        public bool HoldBudget, Hang, Unavailable;
        public long Limit = 536870912;
        public int? OutputSize;
        public string? Output;
        public int ResultExitCode;
        public int Active, Reaped, StartCount;
        public TaskCompletionSource Started = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource TwoStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource BudgetConfirmed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<string> InputReceived = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task<IPtvArchiveProcess?> StartAsync(string pipeName, CancellationToken token)
        {
            if (Unavailable) return null;
            var session = new ControlledProcess(this, pipeName);
            Interlocked.Increment(ref Active);
            if (Interlocked.Increment(ref StartCount) == 2) TwoStarted.TrySetResult();
            Started.TrySetResult();
            try
            {
                if (HoldBudget) await BudgetConfirmed.Task.WaitAsync(token);
                return session;
            }
            catch { await session.DisposeAsync(); throw; }
        }

        private sealed class ControlledProcess : IPtvArchiveProcess
        {
            private readonly ControlledRunner owner;
            private readonly CancellationTokenSource stop = new();
            private readonly Task worker;
            private int disposed;
            public long MemoryLimitBytes => owner.Limit;
            public int ExitCode => owner.ResultExitCode;
            public ControlledProcess(ControlledRunner owner, string pipeName)
            {
                this.owner = owner;
                worker = RunAsync(pipeName);
            }
            private async Task RunAsync(string name)
            {
                using var client = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.Asynchronous);
                try
                {
                    await client.ConnectAsync(stop.Token);
                    var header = new byte[4];
                    await client.ReadExactlyAsync(header, stop.Token);
                    var input = new byte[System.Buffers.Binary.BinaryPrimitives.ReadInt32LittleEndian(header)];
                    await client.ReadExactlyAsync(input, stop.Token);
                    owner.InputReceived.TrySetResult(Encoding.UTF8.GetString(input));
                    if (owner.Hang) await Task.Delay(Timeout.Infinite, stop.Token);
                    var output = Encoding.UTF8.GetBytes(owner.Output ?? "{\"State\":\"absent\",\"ReasonCode\":\"COMICINFO_ABSENT\",\"Bytes\":\"\"}");
                    System.Buffers.Binary.BinaryPrimitives.WriteInt32LittleEndian(header, owner.OutputSize ?? output.Length);
                    await client.WriteAsync(header, stop.Token);
                    if (owner.OutputSize is null) await client.WriteAsync(output, stop.Token);
                }
                catch (OperationCanceledException) { }
                catch (IOException) { }
            }
            public Task WaitForExitAsync(CancellationToken token) => worker.WaitAsync(token);
            public async ValueTask DisposeAsync()
            {
                if (Interlocked.Exchange(ref disposed, 1) != 0) return;
                stop.Cancel();
                await worker;
                stop.Dispose();
                Interlocked.Decrement(ref owner.Active);
                Interlocked.Increment(ref owner.Reaped);
            }
        }
    }
}
