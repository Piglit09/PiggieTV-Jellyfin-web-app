using System.Buffers.Binary;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Owns the isolated archive inspection operation.</summary>
public sealed class PtvArchiveInspectionHost : IPtvArchiveInspectionHost
{
    internal const long MemoryBudget = 536870912;
    // Shared by every host in this Plugin process, including independently created hosts.
    private static readonly SemaphoreSlim Slots = new(2, 2);
    private readonly IPtvArchiveProcessRunner runner;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    /// <summary>Uses a trusted installed apphost and optional administrator-provisioned cgroup root.</summary>
    public PtvArchiveInspectionHost(string helperExecutablePath, string? delegatedCgroupRoot = null)
        : this(OperatingSystem.IsWindows() && RuntimeInformation.ProcessArchitecture == Architecture.X64
            ? new PtvWindowsJobRunner(helperExecutablePath)
            : new PtvLinuxCgroupRunner(helperExecutablePath, delegatedCgroupRoot)) { }

    internal PtvArchiveInspectionHost(IPtvArchiveProcessRunner runner) => this.runner = runner;

    /// <inheritdoc />
    public async Task<PtvComicInfoBytesResult> ReadComicInfoAsync(string authoritativePath, CancellationToken cancellationToken)
    {
        // Reserve cleanup inside the five-second whole-operation budget. Queue,
        // launch, IPC and archive work must stop after the first four seconds.
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(5) - PtvArchiveProcessCleanup.Budget);
        var token = deadline.Token;
        IPtvArchiveProcess? process = null;
        var acquired = false;
        var cleanupFailed = false;
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(authoritativePath) || authoritativePath.Contains('\0')
                || StrictUtf8.GetByteCount(authoritativePath) > 32768)
                return Unverified("HELPER_INPUT_INVALID");
            await Slots.WaitAsync(token).ConfigureAwait(false);
            acquired = true;
            // A waiter can receive a released slot just as cancellation wins.
            // Do not launch a helper for an operation that has already retired.
            token.ThrowIfCancellationRequested();
            var pipeName = "ptv-comic-" + Guid.NewGuid().ToString("N");
            await using var pipe = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1,
                PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            process = await runner.StartAsync(pipeName, token).ConfigureAwait(false);
            if (process is null || process.MemoryLimitBytes != MemoryBudget)
                return Unverified("HELPER_LIMIT_UNAVAILABLE");

            await pipe.WaitForConnectionAsync(token).ConfigureAwait(false);
            var input = StrictUtf8.GetBytes(authoritativePath);
            var header = new byte[4];
            BinaryPrimitives.WriteInt32LittleEndian(header, input.Length);
            await pipe.WriteAsync(header, token).ConfigureAwait(false);
            await pipe.WriteAsync(input, token).ConfigureAwait(false);
            await pipe.FlushAsync(token).ConfigureAwait(false);
            await pipe.ReadExactlyAsync(header, token).ConfigureAwait(false);
            var size = BinaryPrimitives.ReadInt32LittleEndian(header);
            if (size <= 0 || size > 1048576) return Unverified("HELPER_PROTOCOL_INVALID");
            var output = new byte[size];
            await pipe.ReadExactlyAsync(output, token).ConfigureAwait(false);
            var result = JsonSerializer.Deserialize<PtvComicInfoBytesResult>(output);
            // A second frame/trailing output is invalid; this read also shares the deadline.
            if (await pipe.ReadAsync(header.AsMemory(0, 1), token).ConfigureAwait(false) != 0)
                return Unverified("HELPER_PROTOCOL_INVALID");
            await process.WaitForExitAsync(token).ConfigureAwait(false);
            if (process.ExitCode != 0) return Unverified("HELPER_EXIT_FAILED");
            if (result is null || result.Bytes is null || result.Bytes.Length > 524288
                || result.State is not ("inspected" or "absent" or "unverified")
                || (result.State != "inspected" && result.Bytes.Length != 0)
                || string.IsNullOrEmpty(result.ReasonCode) || result.ReasonCode.Length > 80
                || result.ReasonCode.Any(c => c is not (>= 'A' and <= 'Z') and not '_' and not (>= '0' and <= '9')))
                return Unverified("HELPER_PROTOCOL_INVALID");
            return result;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        { return Unverified("HELPER_TIMEOUT"); }
        catch (PtvArchiveReapException) { cleanupFailed = true; throw; }
        catch (JsonException) { return Unverified("HELPER_PROTOCOL_INVALID"); }
        catch (DecoderFallbackException) { return Unverified("HELPER_PROTOCOL_INVALID"); }
        catch (IOException) { return Unverified("HELPER_IO_FAILURE"); }
        catch (UnauthorizedAccessException) { return Unverified("HELPER_UNAVAILABLE"); }
        finally
        {
            // Never release capacity while a child is still running. Runners use
            // the one second reserved above; it is not added to the five seconds.
            if (process is not null) await process.DisposeAsync().ConfigureAwait(false);
            // A failed reap deliberately consumes the slot until Plugin restart;
            // admitting another helper would violate the two-process boundary.
            if (acquired && !cleanupFailed) Slots.Release();
        }
    }

    private static PtvComicInfoBytesResult Unverified(string code) => new("unverified", code, []);
}
