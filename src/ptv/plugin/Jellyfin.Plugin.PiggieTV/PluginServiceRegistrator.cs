using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.PiggieTV;

/// <summary>
/// Registers PiggieTV plugin services with Jellyfin.
/// </summary>
public sealed class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<IPtvFeaturedContentStore, PtvFeaturedContentStore>();
        serviceCollection.AddSingleton<IPtvTmdbMetadataService, PtvTmdbMetadataService>();
        serviceCollection.AddSingleton<PtvFeaturedContentRefreshService>();
        serviceCollection.AddSingleton<IPtvFeaturedContentRefreshService>(
            serviceProvider => serviceProvider.GetRequiredService<PtvFeaturedContentRefreshService>());
        serviceCollection.AddHostedService(
            serviceProvider => serviceProvider.GetRequiredService<PtvFeaturedContentRefreshService>());
    }
}
