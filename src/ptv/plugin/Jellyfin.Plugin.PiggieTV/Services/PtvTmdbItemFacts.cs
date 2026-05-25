namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Normalized TMDb facts used for PiggieTV row matching.
/// </summary>
public sealed class PtvTmdbItemFacts
{
    /// <summary>
    /// Gets an empty fact set.
    /// </summary>
    public static PtvTmdbItemFacts Empty { get; } = new();

    /// <summary>
    /// Gets or sets normalized TMDb genres.
    /// </summary>
    public IReadOnlyList<string> Genres { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Gets or sets normalized TMDb keywords.
    /// </summary>
    public IReadOnlyList<string> Keywords { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Gets or sets normalized TMDb production companies.
    /// </summary>
    public IReadOnlyList<string> ProductionCompanies { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Gets or sets normalized TMDb TV networks.
    /// </summary>
    public IReadOnlyList<string> Networks { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Gets or sets normalized TMDb origin countries.
    /// </summary>
    public IReadOnlyList<string> OriginCountries { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Gets or sets the TMDb original language.
    /// </summary>
    public string? OriginalLanguage { get; init; }

    /// <summary>
    /// Gets a value indicating whether this fact set contains any useful metadata.
    /// </summary>
    public bool HasFacts =>
        Genres.Count > 0
        || Keywords.Count > 0
        || ProductionCompanies.Count > 0
        || Networks.Count > 0
        || OriginCountries.Count > 0
        || !string.IsNullOrWhiteSpace(OriginalLanguage);

    /// <summary>
    /// Gets the normalized text used by PiggieTV row matchers.
    /// </summary>
    public string SearchText => string.Join(
        " ",
        Genres,
        Keywords,
        ProductionCompanies,
        Networks,
        OriginCountries,
        string.IsNullOrWhiteSpace(OriginalLanguage) ? string.Empty : OriginalLanguage);
}
