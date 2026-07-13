namespace Jellyfin.Plugin.PiggieTV.Api;

/// <summary>
/// PiggieTV plugin API route constants.
/// </summary>
public static class PtvApiRoutes
{
    /// <summary>
    /// Root plugin API route.
    /// </summary>
    public const string Root = "Ptv";

    /// <summary>
    /// Current public API version.
    /// </summary>
    public const int CurrentVersion = 1;

    /// <summary>
    /// Version 1 route prefix.
    /// </summary>
    public const string V1 = "v1";

    /// <summary>
    /// Versioned status route.
    /// </summary>
    public const string V1Status = $"{V1}/Status";

    /// <summary>
    /// Lowercase versioned status route.
    /// </summary>
    public const string V1StatusLower = $"{V1}/status";

    /// <summary>
    /// Versioned featured-content route.
    /// </summary>
    public const string V1FeaturedContent = $"{V1}/FeaturedContent";

    /// <summary>
    /// Lowercase versioned featured-content route.
    /// </summary>
    public const string V1Featured = $"{V1}/featured";

    /// <summary>
    /// Versioned featured-content refresh route.
    /// </summary>
    public const string V1FeaturedContentRefresh = $"{V1}/FeaturedContent/Refresh";

    /// <summary>
    /// Lowercase versioned featured-content refresh route.
    /// </summary>
    public const string V1FeaturedRefresh = $"{V1}/featured/refresh";

    /// <summary>
    /// Versioned plugin settings route.
    /// </summary>
    public const string V1Settings = $"{V1}/settings";

    /// <summary>
    /// Versioned plugin settings reset route.
    /// </summary>
    public const string V1SettingsReset = $"{V1}/settings/reset";

    /// <summary>
    /// Versioned item image diagnostics route.
    /// </summary>
    public const string V1ImageDiagnostics = $"{V1}/diagnostics/images";

    /// <summary>
    /// Versioned music metadata lookup route.
    /// </summary>
    public const string V1MusicMetadataSearch = $"{V1}/music/metadata/search";

    /// <summary>
    /// Versioned Google Books metadata lookup route.
    /// </summary>
    public const string V1GoogleBooksMetadataSearch = $"{V1}/reading/metadata/googlebooks/search";

    /// <summary>
    /// Legacy unversioned status route.
    /// </summary>
    public const string LegacyStatus = "Status";

    /// <summary>
    /// Legacy unversioned featured-content route.
    /// </summary>
    public const string LegacyFeaturedContent = "FeaturedContent";

    /// <summary>
    /// Legacy unversioned featured-content refresh route.
    /// </summary>
    public const string LegacyFeaturedContentRefresh = "FeaturedContent/Refresh";
}
