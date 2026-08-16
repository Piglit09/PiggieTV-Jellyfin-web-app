using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PluginReleaseVersionContractTests
{
    private const string ExpectedPluginVersion = "0.5.11.0";

    [Fact]
    public void AssemblyAndStatusReportCurrentPluginVersion()
    {
        var assemblyVersion = typeof(Plugin).Assembly.GetName().Version?.ToString();
        var status = new PtvStatusResponse();

        Assert.Equal(ExpectedPluginVersion, assemblyVersion);
        Assert.Equal(ExpectedPluginVersion, PtvStatusResponse.CurrentPluginVersion);
        Assert.Equal(ExpectedPluginVersion, status.Version);
        Assert.Equal(ExpectedPluginVersion, status.PluginVersion);
    }

    [Fact]
    public void PublishedManifestMatchesAssemblyVersion()
    {
        var manifestPath = Path.Combine(AppContext.BaseDirectory, "meta.json");
        using var manifest = JsonDocument.Parse(File.ReadAllText(manifestPath));

        Assert.Equal(ExpectedPluginVersion, manifest.RootElement.GetProperty("version").GetString());
        Assert.Equal("10.11.11.0", manifest.RootElement.GetProperty("targetAbi").GetString());
    }
}
