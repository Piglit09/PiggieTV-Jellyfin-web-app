using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.PiggieTV.Configuration;

/// <summary>
/// PiggieTV plugin configuration.
/// </summary>
public sealed class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets a value indicating whether PiggieTV may use TMDb metadata during server-side cache refreshes.
    /// </summary>
    public bool EnableTmdbMetadata { get; set; } = true;

    /// <summary>
    /// Gets or sets the optional TMDb API read access token. Prefer the PTV_TMDB_READ_ACCESS_TOKEN environment variable.
    /// </summary>
    public string? TmdbReadAccessToken { get; set; }

    /// <summary>
    /// Gets or sets the optional TMDb v3 API key fallback. Prefer the PTV_TMDB_API_KEY environment variable.
    /// </summary>
    public string? TmdbApiKey { get; set; }

    /// <summary>
    /// Gets or sets the maximum number of Jellyfin items enriched from TMDb during a single refresh.
    /// </summary>
    public int TmdbMaxEnrichmentItems { get; set; } = 280;
}
