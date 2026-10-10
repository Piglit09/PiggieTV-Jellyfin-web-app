using System.Buffers.Binary;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using Ptv.ComicInfo.Helper;

HelperLifetime.Arm();

// No archive path in argv, stdout, stderr or exception text. The host grants
// input only after confirming the OS memory limit. Synchronous decoding begins only after bounded IPC input.
if (args.Length != 2 || args[0] != "--pipe" || !args[1].StartsWith("ptv-comic-", StringComparison.Ordinal))
    return 2;
try
{
    using var lifetime = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    var token = lifetime.Token;
    await using var pipe = new NamedPipeClientStream(".", args[1], PipeDirection.InOut, PipeOptions.Asynchronous);
    await pipe.ConnectAsync(token);
    var header = new byte[4];
    await pipe.ReadExactlyAsync(header, token);
    var size = BinaryPrimitives.ReadInt32LittleEndian(header);
    if (size <= 0 || size > 32768) return 2;
    var input = new byte[size];
    await pipe.ReadExactlyAsync(input, token);
    var authoritativePath = new UTF8Encoding(false, true).GetString(input);
    if (string.IsNullOrWhiteSpace(authoritativePath) || authoritativePath.Contains('\0')) return 2;
    var output = JsonSerializer.SerializeToUtf8Bytes(ComicInfoArchiveReader.Read(authoritativePath));
    if (output.Length > 1048576) return 2;
    BinaryPrimitives.WriteInt32LittleEndian(header, output.Length);
    await pipe.WriteAsync(header, token);
    await pipe.WriteAsync(output, token);
    await pipe.FlushAsync(token);
    return 0;
}
catch { return 2; }
