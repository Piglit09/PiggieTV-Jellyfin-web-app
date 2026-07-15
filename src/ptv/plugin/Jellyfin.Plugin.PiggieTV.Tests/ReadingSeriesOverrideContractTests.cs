using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
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
}
