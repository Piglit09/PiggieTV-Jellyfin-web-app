using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using System.Xml.Serialization;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class ReadingSeriesOverrideContractTests
{
    [Fact]
    public void StatusAdvertisesReadingSeriesOverrides()
    {
        var status = new PtvStatusResponse();

        Assert.Contains("readingSeriesOverrides", status.Features);
        Assert.True(status.FeatureFlags["readingSeriesOverrides"]);
    }

    [Theory]
    [InlineData(nameof(PtvStatusController.GetReadingSeriesOverrides), "reading/series-overrides/{routeKind}", typeof(HttpGetAttribute))]
    [InlineData(nameof(PtvStatusController.SaveReadingSeriesOverrides), "reading/series-overrides/{routeKind}", typeof(HttpPutAttribute))]
    public void ControllerPublishesReadingSeriesOverrideRoutes(string methodName, string template, Type attributeType)
    {
        var method = typeof(PtvStatusController).GetMethod(methodName);
        var attribute = method?.GetCustomAttributes(attributeType, inherit: true)
            .Cast<HttpMethodAttribute>()
            .SingleOrDefault();

        Assert.NotNull(attribute);
        Assert.Equal(template, attribute.Template);
    }

    [Fact]
    public void PluginConfigurationRoundTripsReadingSeriesOverridesThroughXml()
    {
        var configuration = new PluginConfiguration();
        configuration.ReadingSeriesOverrides.Routes["manga"] = new(StringComparer.OrdinalIgnoreCase)
        {
            ["item-2"] = new ReadingSeriesOverrideDefinition
            {
                CoverItemId = "cover-2",
                MediaKind = "manga",
                SeriesKey = "series-key",
                SeriesTitle = "Series Title",
                SeriesYear = 2024,
                VolumeNumber = 2
            }
        };

        var serializer = new XmlSerializer(typeof(PluginConfiguration));
        using var writer = new StringWriter();
        serializer.Serialize(writer, configuration);
        var xml = writer.ToString();

        using var reader = new StringReader(xml);
        var restored = Assert.IsType<PluginConfiguration>(serializer.Deserialize(reader));
        var restoredOverride = restored.ReadingSeriesOverrides.Routes["MANGA"]["ITEM-2"];

        Assert.Contains("<Routes>", xml, StringComparison.Ordinal);
        Assert.Equal("cover-2", restoredOverride.CoverItemId);
        Assert.Equal("manga", restoredOverride.MediaKind);
        Assert.Equal("series-key", restoredOverride.SeriesKey);
        Assert.Equal("Series Title", restoredOverride.SeriesTitle);
        Assert.Equal(2024, restoredOverride.SeriesYear);
        Assert.Equal(2, restoredOverride.VolumeNumber);
    }
}
