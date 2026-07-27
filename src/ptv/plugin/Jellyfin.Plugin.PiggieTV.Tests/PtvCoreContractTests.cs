using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvCoreContractTests
{
    [Fact]
    public void StatusExposesAdditivePtvCoreCompatibilityMetadata()
    {
        var status = new PtvStatusResponse();

        Assert.Equal("1.0", status.ContractVersion);
        Assert.Equal(PtvFeaturedContentValidator.FeaturedCacheVersion, status.CacheVersion);
        Assert.Equal(1, status.RecommendationSchemaVersion);
        Assert.Equal(1, status.DiagnosticsSchemaVersion);
        Assert.True(status.DiagnosticsCapable);
        Assert.True(status.ServerCapabilities["pluginApi"]);
        Assert.True(status.ServerCapabilities["recommendations"]);
        Assert.Contains("remoteDiagnostics", status.SupportedFeatureFlags);
        Assert.Empty(status.ClientCompatibilityWarnings);
    }

    [Fact]
    public void StatusSerializationRetainsExistingFieldsAndAddsCamelCaseCoreFields()
    {
        var json = JsonSerializer.SerializeToElement(new PtvStatusResponse());

        Assert.True(json.GetProperty("ok").GetBoolean());
        Assert.Equal("PiggieTV", json.GetProperty("name").GetString());
        Assert.Equal(1, json.GetProperty("apiVersion").GetInt32());
        Assert.Equal("1.0", json.GetProperty("contractVersion").GetString());
        Assert.Equal(
            PtvFeaturedContentValidator.FeaturedCacheVersion,
            json.GetProperty("cacheVersion").GetInt32());
        Assert.True(json.GetProperty("diagnosticsCapable").GetBoolean());
        Assert.True(json.GetProperty("serverCapabilities").GetProperty("pluginApi").GetBoolean());
    }
}
