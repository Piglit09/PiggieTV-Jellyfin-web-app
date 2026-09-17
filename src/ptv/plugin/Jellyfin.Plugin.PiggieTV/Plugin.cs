using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;
using MediaBrowser.Model.Plugins;
using System.Diagnostics;

namespace Jellyfin.Plugin.PiggieTV;

/// <summary>
/// PiggieTV server-side companion plugin.
/// </summary>
public sealed class Plugin : BasePlugin<PluginConfiguration>
{
    /// <summary>
    /// Gets the build timestamp stamped into this diagnostic plugin build.
    /// </summary>
    public const string BuildTimestampUtc = "2026-08-09T11:33:43Z";

    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Jellyfin application paths.</param>
    /// <param name="xmlSerializer">Jellyfin XML serializer.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        var message = $"PiggieTV plugin constructed. BuildTimestampUtc={BuildTimestampUtc}. ConfigurationPath={applicationPaths.PluginConfigurationsPath}.";

        Console.WriteLine(message);
        Trace.TraceInformation(message);
    }

    /// <inheritdoc />
    public override string Name => "PiggieTV";

    /// <inheritdoc />
    public override string Description => "Server-side cache and integration endpoints for the PiggieTV web client.";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("27c90ee7-7d56-4591-98f8-b0ebcda8c5fd");

    /// <summary>
    /// Gets the current plugin instance.
    /// </summary>
    public static Plugin? Instance { get; private set; }

    /// <inheritdoc />
    public override void UpdateConfiguration(BasePluginConfiguration configuration)
    {
        using var mutation = PtvConfiguredRowAssociationService.BeginConfigurationMutation();
        base.UpdateConfiguration(configuration);
    }
}
