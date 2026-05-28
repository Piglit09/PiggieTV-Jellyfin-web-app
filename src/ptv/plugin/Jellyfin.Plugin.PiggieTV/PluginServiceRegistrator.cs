using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;
using System.Diagnostics;

namespace Jellyfin.Plugin.PiggieTV;

/// <summary>
/// Registers PiggieTV plugin services with Jellyfin.
/// </summary>
public sealed class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        var startMessage = $"Registering PiggieTV API controllers and services. BuildTimestampUtc={Plugin.BuildTimestampUtc}. ExpectedRoutes=GET /Ptv/v1/status; GET /Ptv/v1/settings; GET /Ptv/v1/featured; POST /Ptv/v1/featured/refresh; GET /Ptv/v1/integrations/status; GET/POST /Ptv/v1/integrations/jfa-go/test; GET/POST /Ptv/v1/integrations/jfago/test; GET /Ptv/v1/tags; GET /Ptv/v1/random/movie.";

        Console.WriteLine(startMessage);
        Trace.TraceInformation(startMessage);
        serviceCollection.AddSingleton<IPtvFeaturedContentStore, PtvFeaturedContentStore>();
        serviceCollection.AddSingleton<IPtvPluginSettingsService, PtvPluginSettingsService>();
        serviceCollection.AddSingleton<IPtvTmdbMetadataService, PtvTmdbMetadataService>();
        serviceCollection.AddSingleton<PtvFeaturedContentRefreshService>();
        serviceCollection.AddSingleton<IPtvFeaturedContentRefreshService>(
            serviceProvider => serviceProvider.GetRequiredService<PtvFeaturedContentRefreshService>());
        serviceCollection.AddHostedService(
            serviceProvider => serviceProvider.GetRequiredService<PtvFeaturedContentRefreshService>());

        Console.WriteLine("PiggieTV plugin service registration finished.");
        Trace.TraceInformation("PiggieTV plugin service registration finished.");
    }
}
