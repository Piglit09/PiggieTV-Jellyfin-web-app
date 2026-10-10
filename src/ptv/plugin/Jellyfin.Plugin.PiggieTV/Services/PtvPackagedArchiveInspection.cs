using System.Runtime.InteropServices;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Resolves only the helper shipped beside this Plugin; OS runners prove limits before input.</summary>
internal static class PtvPackagedArchiveInspection
{
    internal static IPtvArchiveInspectionHost Create()
    {
        if (RuntimeInformation.ProcessArchitecture != Architecture.X64)
            return new PtvUnavailableArchiveInspectionHost();
        var windows = OperatingSystem.IsWindows();
        if (!windows && !OperatingSystem.IsLinux()) return new PtvUnavailableArchiveInspectionHost();
        var root = Path.GetDirectoryName(typeof(Plugin).Assembly.Location);
        if (string.IsNullOrEmpty(root)) return new PtvUnavailableArchiveInspectionHost();
        var directory = Path.Combine(root, "helpers", windows ? "win-x64" : "linux-x64");
        var executable = "Ptv.ComicInfo.Helper" + (windows ? ".exe" : "");
        var required = new[] { executable, "Ptv.ComicInfo.Helper.dll", "Ptv.ComicInfo.Helper.deps.json", "Ptv.ComicInfo.Helper.runtimeconfig.json", "SharpCompress.dll", "System.Private.CoreLib.dll",
            windows ? "coreclr.dll" : "libcoreclr.so", windows ? "hostfxr.dll" : "libhostfxr.so", windows ? "hostpolicy.dll" : "libhostpolicy.so" };
        try
        {
            if (required.Any(name => !File.Exists(Path.Combine(directory, name)))) return new PtvUnavailableArchiveInspectionHost();
            // This environment belongs to the server service administrator, never a request or Web setting.
            var delegatedRoot = windows ? null : Environment.GetEnvironmentVariable("PTV_COMICINFO_CGROUP_ROOT");
            if (!windows && (string.IsNullOrWhiteSpace(delegatedRoot) || !Path.IsPathFullyQualified(delegatedRoot)
                || !Directory.Exists(delegatedRoot))) return new PtvUnavailableArchiveInspectionHost();
            if (!windows && (File.GetUnixFileMode(Path.Combine(directory, executable)) & (UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute)) == 0)
                return new PtvUnavailableArchiveInspectionHost();
            return new PtvArchiveInspectionHost(Path.Combine(directory, executable), delegatedRoot);
        }
        catch (IOException) { return new PtvUnavailableArchiveInspectionHost(); }
        catch (UnauthorizedAccessException) { return new PtvUnavailableArchiveInspectionHost(); }
    }
}
