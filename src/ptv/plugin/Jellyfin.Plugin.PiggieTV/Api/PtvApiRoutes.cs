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
    /// Versioned featured-content route.
    /// </summary>
    public const string V1FeaturedContent = $"{V1}/FeaturedContent";

    /// <summary>
    /// Versioned featured-content refresh route.
    /// </summary>
    public const string V1FeaturedContentRefresh = $"{V1}/FeaturedContent/Refresh";

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
