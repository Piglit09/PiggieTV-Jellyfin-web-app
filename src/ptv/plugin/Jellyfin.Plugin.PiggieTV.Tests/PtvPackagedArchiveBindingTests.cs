using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

[Collection("Archive host")]
public sealed class PtvPackagedArchiveBindingTests
{
    [Fact]
    public async Task InstalledWindowsPayloadSelectsBoundedHostAndMissingPayloadFailsClosed()
    {
        if (!OperatingSystem.IsWindows() || System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture != System.Runtime.InteropServices.Architecture.X64) return;
        var directory = Path.Combine(Path.GetDirectoryName(typeof(Plugin).Assembly.Location)!, "helpers", "win-x64");
        Assert.False(Directory.Exists(directory));
        Directory.CreateDirectory(directory);
        try
        {
            foreach (var name in new[] { "Ptv.ComicInfo.Helper.exe", "Ptv.ComicInfo.Helper.dll", "Ptv.ComicInfo.Helper.deps.json", "Ptv.ComicInfo.Helper.runtimeconfig.json", "SharpCompress.dll", "coreclr.dll", "hostfxr.dll", "hostpolicy.dll", "System.Private.CoreLib.dll" })
                File.WriteAllText(Path.Combine(directory, name), "synthetic installation boundary");
            var services = new ServiceCollection();
            new PluginServiceRegistrator().RegisterServices(services, null!);
            using var provider = services.BuildServiceProvider();
            Assert.IsType<PtvArchiveInspectionHost>(provider.GetRequiredService<IPtvArchiveInspectionHost>());
        }
        finally { Directory.Delete(directory, recursive: true); }
        var missingServices = new ServiceCollection();
        new PluginServiceRegistrator().RegisterServices(missingServices, null!);
        using var missingProvider = missingServices.BuildServiceProvider();
        var result = await missingProvider.GetRequiredService<IPtvArchiveInspectionHost>().ReadComicInfoAsync("private/archive.cbr", CancellationToken.None);
        Assert.Equal("unverified", result.State);
        Assert.Equal("HELPER_UNAVAILABLE", result.ReasonCode);
        Assert.Empty(result.Bytes);
    }
}
