using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Optional OS file identity and full-resolution modification time, never serialized to Web.</summary>
internal static class PtvReadingArchiveFileIdentity
{
    // Windows FileIdInfo includes a volume serial and 128-bit file ID (including ReFS).
    // Linux statx has a fixed, versioned 256-byte ABI; request inode and nanosecond mtime.
    internal static string? Read(string path)
    {
        try
        {
            if (OperatingSystem.IsWindows())
            {
                using var handle = File.OpenHandle(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                if (GetFileInformationByHandleEx(handle, 18, out var id, 24))
                    return FormattableString.Invariant($"win:{id.Volume:X16}:{id.Low:X16}:{id.High:X16}");
            }
            else if (OperatingSystem.IsLinux())
            {
                const uint requested = 0x100 | 0x40; // STATX_INO | STATX_MTIME
                // Match archive opening: follow the target, not the symlink inode.
                // AT_NO_AUTOMOUNT does not change symlink target resolution.
                const int flags = 0x800; // AT_NO_AUTOMOUNT
                if (Statx(-100, path, flags, requested, out var stat) == 0 && (stat.Mask & requested) == requested)
                    return FormattableString.Invariant($"linux:{stat.DeviceMajor}:{stat.DeviceMinor}:{stat.Inode}:{stat.ModifiedSeconds}:{stat.ModifiedNanoseconds}");
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException
            or NotSupportedException or DllNotFoundException or EntryPointNotFoundException) { }
        return null;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileIdInfo { public ulong Volume; public ulong Low; public ulong High; }

    [StructLayout(LayoutKind.Explicit, Size = 256)]
    private struct StatxInfo
    {
        [FieldOffset(0)] public uint Mask;
        [FieldOffset(32)] public ulong Inode;
        [FieldOffset(112)] public long ModifiedSeconds;
        [FieldOffset(120)] public uint ModifiedNanoseconds;
        [FieldOffset(136)] public uint DeviceMajor;
        [FieldOffset(140)] public uint DeviceMinor;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int informationClass, out FileIdInfo info, uint size);

    [DllImport("libc", EntryPoint = "statx", SetLastError = true)]
    private static extern int Statx(int directory, [MarshalAs(UnmanagedType.LPUTF8Str)] string path, int flags, uint mask, out StatxInfo info);
}
