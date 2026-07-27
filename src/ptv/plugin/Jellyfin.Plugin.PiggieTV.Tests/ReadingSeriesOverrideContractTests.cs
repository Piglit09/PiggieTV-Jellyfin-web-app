using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using System.Collections;
using System.Reflection;
using System.Security.Claims;
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

    [Fact]
    public void StatusAdvertisesPhysicalLayoutSnapshot()
    {
        var status = new PtvStatusResponse();

        Assert.Contains("physicalLayoutSnapshot", status.Features);
        Assert.True(status.FeatureFlags["physicalLayoutSnapshot"]);
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
        configuration.ReadingSeriesOverrides.SetRoute("manga", new Dictionary<string, ReadingSeriesOverrideDefinition>(StringComparer.OrdinalIgnoreCase)
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
        });

        var serializer = new XmlSerializer(typeof(PluginConfiguration));
        using var writer = new StringWriter();
        serializer.Serialize(writer, configuration);
        var xml = writer.ToString();

        using var reader = new StringReader(xml);
        var restored = Assert.IsType<PluginConfiguration>(serializer.Deserialize(reader));
        var restoredOverride = restored.ReadingSeriesOverrides.GetRoute("MANGA")["ITEM-2"];

        Assert.Contains("<Routes>", xml, StringComparison.Ordinal);
        Assert.Equal("cover-2", restoredOverride.CoverItemId);
        Assert.Equal("manga", restoredOverride.MediaKind);
        Assert.Equal("series-key", restoredOverride.SeriesKey);
        Assert.Equal("Series Title", restoredOverride.SeriesTitle);
        Assert.Equal(2024, restoredOverride.SeriesYear);
        Assert.Equal(2, restoredOverride.VolumeNumber);
    }

    [Fact]
    public void PluginConfigurationGraphExposesNoDictionaryProperties()
    {
        var configurationTypes = typeof(PluginConfiguration).Assembly
            .GetTypes()
            .Where(type => type.IsPublic && type.Namespace == typeof(PluginConfiguration).Namespace);

        var dictionaryProperties = configurationTypes
            .SelectMany(type => type.GetProperties(BindingFlags.Instance | BindingFlags.Public))
            .Where(property => typeof(IDictionary).IsAssignableFrom(property.PropertyType)
                || property.PropertyType.GetInterfaces().Any(IsGenericDictionary))
            .Select(property => $"{property.DeclaringType?.FullName}.{property.Name}")
            .ToArray();

        Assert.Empty(dictionaryProperties);
    }

    [Fact]
    public void ReadingSeriesOverridesSerializeDeterministicallyAndSupportRemoval()
    {
        var settings = new ReadingSeriesOverrideSettings();
        settings.SetRoute("manga", new Dictionary<string, ReadingSeriesOverrideDefinition>
        {
            ["item-z"] = new() { SeriesTitle = "Zed" },
            ["item-a"] = new() { SeriesTitle = "Alpha" }
        });
        settings.SetRoute("books", new Dictionary<string, ReadingSeriesOverrideDefinition>
        {
            ["item-b"] = new() { SeriesTitle = "Book" }
        });

        Assert.Equal(["books", "manga"], settings.Routes.Select(route => route.RouteKind));
        Assert.Equal(["item-a", "item-z"], settings.Routes[1].Overrides.Select(item => item.ItemId));
        Assert.True(settings.RemoveRoute("MANGA"));
        Assert.Empty(settings.GetRoute("manga"));
    }

    [Fact]
    public async Task StatusSettingsAndFeaturedPathsAcceptPopulatedReadingOverrides()
    {
        var configuration = new PluginConfiguration();
        configuration.ReadingSeriesOverrides.SetRoute("comics", new Dictionary<string, ReadingSeriesOverrideDefinition>
        {
            ["comic-1"] = new() { SeriesKey = "series-1", SeriesTitle = "Series One" }
        });

        var services = new ServiceCollection()
            .AddSingleton<IAuthorizationService>(new AllowAuthorizationService())
            .AddSingleton<IPtvPluginSettingsService>(new TestPluginSettingsService(configuration))
            .AddSingleton<IPtvFeaturedContentStore>(new TestFeaturedContentStore())
            .BuildServiceProvider();
        var controller = new PtvStatusController(NullLogger<PtvStatusController>.Instance, services)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity())
                }
            }
        };

        Assert.IsType<OkObjectResult>(await controller.GetStatus(full: true, CancellationToken.None));
        Assert.IsType<OkObjectResult>((await controller.GetSettings()).Result);
        Assert.IsType<OkObjectResult>((await controller.GetFeaturedContent(CancellationToken.None)).Result);
    }

    private static bool IsGenericDictionary(Type type)
    {
        return type.IsGenericType && type.GetGenericTypeDefinition() == typeof(IDictionary<,>);
    }

    private sealed class AllowAuthorizationService : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            IEnumerable<IAuthorizationRequirement> requirements) => Task.FromResult(AuthorizationResult.Success());

        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            string policyName) => Task.FromResult(AuthorizationResult.Success());
    }

    private sealed class TestPluginSettingsService(PluginConfiguration configuration) : IPtvPluginSettingsService
    {
        public PtvPluginSettingsDto GetSettings() => PtvPluginSettingsDto.FromConfiguration(configuration);

        public PtvReadingSeriesOverridesResponse GetReadingSeriesOverrides(string routeKind) => new();

        public PtvPluginSettingsDto ResetSettings() => GetSettings();

        public PtvReadingSeriesOverridesResponse SaveReadingSeriesOverrides(
            string routeKind,
            PtvReadingSeriesOverridesUpdate update) => new();

        public PtvPluginSettingsDto SaveSettings(PtvPluginSettingsPatchDto settings) => GetSettings();
    }

    private sealed class TestFeaturedContentStore : IPtvFeaturedContentStore
    {
        private readonly PtvFeaturedContentDocument _document = PtvFeaturedContentValidator.CreateEmptyDocument();

        public Task ClearAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task<PtvFeaturedContentStoreStatus> GetStatusAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new PtvFeaturedContentStoreStatus { Document = _document });

        public Task<PtvFeaturedContentDocument> ReadAsync(CancellationToken cancellationToken) => Task.FromResult(_document);

        public PtvFeaturedContentDocument ValidateDocument(PtvFeaturedContentDocument? document) =>
            document ?? _document;

        public Task<PtvFeaturedContentDocument> WriteAsync(
            PtvFeaturedContentDocument document,
            CancellationToken cancellationToken) => Task.FromResult(document);
    }
}
