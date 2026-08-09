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
        var startMessage = $"Registering PiggieTV API controllers and services. BuildTimestampUtc={Plugin.BuildTimestampUtc}. ExpectedRoutes=GET /Ptv/v1/status; GET /Ptv/v1/settings; GET /Ptv/v1/featured; POST /Ptv/v1/featured/refresh; GET /Ptv/v1/recommendations; POST /Ptv/v2/recommendations/rank; GET /Ptv/v1/relationships/{{sourceItemId}}; POST /Ptv/v1/relationships; PUT/DELETE /Ptv/v1/relationships/{{mappingId}}; GET /Ptv/v1/music/metadata/search; GET /Ptv/v1/reading/metadata/googlebooks/search; GET /Ptv/v1/integrations/status; GET /Ptv/v1/calendar; GET /Ptv/v1/integrations/arr/calendar; GET /Ptv/v1/tags; GET /Ptv/v1/random/movie; POST /Ptv/v1/diagnostics/clients/check-in.";

        Console.WriteLine(startMessage);
        Trace.TraceInformation(startMessage);
        serviceCollection.AddSingleton<IPtvFeaturedContentStore, PtvFeaturedContentStore>();
        serviceCollection.AddSingleton<IPtvRemoteDiagnosticsStore, PtvRemoteDiagnosticsStore>();
        serviceCollection.AddSingleton<PtvRollingDiagnosticsWriter>();
        serviceCollection.AddSingleton<IPtvRollingDiagnosticsWriter>(serviceProvider => serviceProvider.GetRequiredService<PtvRollingDiagnosticsWriter>());
        serviceCollection.AddHostedService(serviceProvider => serviceProvider.GetRequiredService<PtvRollingDiagnosticsWriter>());
        serviceCollection.AddSingleton<IPtvPluginSettingsService, PtvPluginSettingsService>();
        serviceCollection.AddSingleton<IPtvRelationshipMappingService, PtvRelationshipMappingService>();
        serviceCollection.AddSingleton<IPtvRecommendationPolicyService, PtvRecommendationPolicyService>();
        serviceCollection.AddSingleton<IPtvSignupService, PtvSignupService>();
        serviceCollection.AddHostedService<PtvSignupCleanupService>();
        serviceCollection.AddSingleton<IPtvTmdbMetadataService, PtvTmdbMetadataService>();
        serviceCollection.AddSingleton<IPtvMusicMetadataLookupService, PtvMusicMetadataLookupService>();
        serviceCollection.AddSingleton<IPtvGoogleBooksMetadataLookupService, PtvGoogleBooksMetadataLookupService>();
        serviceCollection.AddSingleton<PtvFeaturedContentRefreshService>();
        serviceCollection.AddSingleton<IPtvFeaturedContentRefreshService>(
            serviceProvider => serviceProvider.GetRequiredService<PtvFeaturedContentRefreshService>());
        serviceCollection.AddHostedService(
            serviceProvider => serviceProvider.GetRequiredService<PtvFeaturedContentRefreshService>());

        Console.WriteLine("PiggieTV plugin service registration finished.");
        Trace.TraceInformation("PiggieTV plugin service registration finished.");
    }
}
