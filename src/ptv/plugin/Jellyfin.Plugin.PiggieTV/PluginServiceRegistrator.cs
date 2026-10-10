using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Model.Tasks;
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
        var startMessage = $"Registering PiggieTV API controllers and services. BuildTimestampUtc={Plugin.BuildTimestampUtc}. ExpectedRoutes=GET /Ptv/v1/status; GET /Ptv/v1/settings; GET /Ptv/v1/featured; POST /Ptv/v1/featured/refresh; GET /Ptv/v1/recommendations; POST /Ptv/v2/recommendations/rank; GET /Ptv/v1/relationships/{{sourceItemId}}; POST /Ptv/v1/relationships; PUT/DELETE /Ptv/v1/relationships/{{mappingId}}; GET /Ptv/v1/music/metadata/search; GET /Ptv/v1/reading/metadata/googlebooks/search; GET /Ptv/v1/reading/metadata/providers; POST /Ptv/v1/reading/metadata/search; POST /Ptv/v1/reading/metadata/reassess; GET /Ptv/v1/integrations/status; GET /Ptv/v1/integrations/calendar-availability; GET /Ptv/v1/calendar; GET /Ptv/v1/integrations/arr/calendar; GET /Ptv/v1/tags; GET /Ptv/v1/random/movie; POST /Ptv/v1/diagnostics/clients/check-in; POST /Ptv/v1/reports/media.";

        Console.WriteLine(startMessage);
        Trace.TraceInformation(startMessage);
        serviceCollection.AddSingleton(provider => new PtvConfiguredRowAssociationService(applicationHost.SystemId, topology: provider.GetRequiredService<IPtvHomeTopologyLedger>()));
        serviceCollection.AddSingleton<IPtvFeaturedContentStore, PtvFeaturedContentStore>();
        serviceCollection.AddSingleton<IPtvHomeTopologyLedger>(provider =>
        {
            var paths = provider.GetRequiredService<MediaBrowser.Common.Configuration.IApplicationPaths>();
            return new PtvHomeTopologyLedger(Path.Combine(paths.PluginConfigurationsPath, "PiggieTV"), applicationHost.SystemId,
                () => Plugin.Instance?.Configuration.HomeTopologyLedgerInitialized ?? throw new InvalidOperationException("Plugin configuration unavailable."),
                () =>
                {
                    var plugin = Plugin.Instance ?? throw new InvalidOperationException("Plugin configuration unavailable.");
                    plugin.Configuration.HomeTopologyLedgerInitialized = true;
                    try { plugin.SaveConfiguration(); }
                    catch { plugin.Configuration.HomeTopologyLedgerInitialized = false; throw; }
                });
        });
        serviceCollection.AddSingleton<IPtvHomeUserAccessLedger>(provider =>
        {
            var paths = provider.GetRequiredService<MediaBrowser.Common.Configuration.IApplicationPaths>();
            return new PtvHomeUserAccessLedger(Path.Combine(paths.PluginConfigurationsPath, "PiggieTV"), applicationHost.SystemId);
        });
        serviceCollection.AddSingleton<IPtvFeaturedContentAuthorizationService, PtvFeaturedContentAuthorizationService>();
        serviceCollection.AddSingleton<IPtvRemoteDiagnosticsStore, PtvRemoteDiagnosticsStore>();
        serviceCollection.AddSingleton<IPtvMediaReportStore, PtvMediaReportStore>();
        serviceCollection.AddSingleton<PtvRollingDiagnosticsWriter>();
        serviceCollection.AddSingleton<IPtvRollingDiagnosticsWriter>(serviceProvider => serviceProvider.GetRequiredService<PtvRollingDiagnosticsWriter>());
        serviceCollection.AddHostedService(serviceProvider => serviceProvider.GetRequiredService<PtvRollingDiagnosticsWriter>());
        serviceCollection.AddSingleton<IPtvPluginSettingsService, PtvPluginSettingsService>();
        serviceCollection.AddSingleton<IPtvRelationshipMappingService, PtvRelationshipMappingService>();
        serviceCollection.AddSingleton<IPtvRecommendationPolicyService, PtvRecommendationPolicyService>();
        serviceCollection.AddSingleton<IPtvAccountRepository, PtvAccountRepository>();
        serviceCollection.AddSingleton<IPtvMailService, PtvMailService>();
        serviceCollection.AddSingleton<IPtvJellyfinUserProvider, PtvJellyfinUserProvider>();
        serviceCollection.AddSingleton<IPtvLegacySignupEmailSource, PtvLegacySignupEmailSource>();
        serviceCollection.AddSingleton<IPtvAccountService, PtvAccountService>();
        serviceCollection.AddSingleton<IPtvAccountBackupService, PtvAccountBackupService>();
        serviceCollection.AddSingleton<IScheduledTask, PtvAccountBackupTask>();
        serviceCollection.AddHostedService<PtvAccountInitializationService>();
        serviceCollection.AddSingleton<IPtvSignupService, PtvSignupService>();
        serviceCollection.AddHostedService<PtvSignupCleanupService>();
        serviceCollection.AddSingleton<IPtvTmdbMetadataService, PtvTmdbMetadataService>();
        serviceCollection.AddSingleton<IPtvMusicMetadataLookupService, PtvMusicMetadataLookupService>();
        serviceCollection.AddSingleton<IPtvGoogleBooksMetadataLookupService, PtvGoogleBooksMetadataLookupService>();
        serviceCollection.AddSingleton<PtvReadingCandidateContextCodec>();
        serviceCollection.AddSingleton<IPtvArchiveInspectionHost>(_ => PtvPackagedArchiveInspection.Create());
        serviceCollection.AddSingleton<PtvReadingMetadataParser>();
        serviceCollection.AddSingleton<PtvReadingMetadataScorer>();
        serviceCollection.AddSingleton<IPtvReadingLocalMetadataInspector, PtvReadingLocalMetadataInspector>();
        serviceCollection.AddSingleton<IPtvReadingMetadataRequestCoordinator, PtvReadingMetadataRequestCoordinator>();
        serviceCollection.AddSingleton<IPtvReadingMetadataProvider, PtvComicVineReadingMetadataProvider>();
        serviceCollection.AddSingleton<IPtvReadingMetadataProvider, PtvAniListReadingMetadataProvider>();
        serviceCollection.AddSingleton<IPtvReadingMetadataProvider, PtvMangaDexReadingMetadataProvider>();
        serviceCollection.AddSingleton<IPtvReadingMetadataProvider, PtvGoogleBooksReadingMetadataProvider>();
        serviceCollection.AddSingleton<IPtvReadingMetadataProvider, PtvGcdReadingMetadataProvider>();
        serviceCollection.AddSingleton<IPtvReadingMetadataIdentificationService, PtvReadingMetadataIdentificationService>();
        serviceCollection.AddSingleton<PtvMetadataQualityStore>();
        serviceCollection.AddSingleton<IPtvMetadataQualityStore>(
            serviceProvider => serviceProvider.GetRequiredService<PtvMetadataQualityStore>());
        serviceCollection.AddSingleton<IPtvMetadataQualityIndexedStore, PtvMetadataQualityIndexedStore>();
        serviceCollection.AddSingleton<PtvMetadataQualityRuleEngine>();
        serviceCollection.AddSingleton<IPtvMetadataQualityProviderVerifier, PtvMetadataQualityProviderVerifier>();
        serviceCollection.AddSingleton<IPtvMetadataAiAnalyzer, PtvOpenAiMetadataAiAnalyzer>();
        serviceCollection.AddSingleton<IPtvMetadataQualityService, PtvMetadataQualityService>();
        serviceCollection.AddSingleton<IScheduledTask, PtvMetadataQualityTask>();
        serviceCollection.AddSingleton<PtvFeaturedContentRefreshService>();
        serviceCollection.AddSingleton<IPtvFeaturedContentRefreshService>(
            serviceProvider => serviceProvider.GetRequiredService<PtvFeaturedContentRefreshService>());
        serviceCollection.AddHostedService(
            serviceProvider => serviceProvider.GetRequiredService<PtvFeaturedContentRefreshService>());

        Console.WriteLine("PiggieTV plugin service registration finished.");
        Trace.TraceInformation("PiggieTV plugin service registration finished.");
    }
}
