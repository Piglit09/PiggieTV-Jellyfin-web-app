using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>Outcome of a bounded, read-only local Reading metadata inspection.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PtvReadingLocalInspectionState>))]
public enum PtvReadingLocalInspectionState
{
    /// <summary>No supported local metadata document was present.</summary>
    [JsonStringEnumMemberName("not-found")]
    NotFound,

    /// <summary>At least one supported local metadata document was inspected.</summary>
    [JsonStringEnumMemberName("inspected")]
    Inspected,

    /// <summary>The source container is intentionally unsupported.</summary>
    [JsonStringEnumMemberName("unsupported")]
    Unsupported,

    /// <summary>The source or metadata document did not satisfy safety bounds.</summary>
    [JsonStringEnumMemberName("rejected")]
    Rejected,

    /// <summary>The local source could not be inspected safely.</summary>
    [JsonStringEnumMemberName("unavailable")]
    Unavailable
}

/// <summary>Bounded local evidence extracted from ComicInfo.xml or an adjacent OPF document.</summary>
public sealed class PtvReadingLocalMetadataEvidence
{
    public string? Title { get; set; }

    public List<string> AlternateTitles { get; set; } = [];

    public string? SeriesTitle { get; set; }

    public string? IssueNumber { get; set; }

    public string? VolumeNumber { get; set; }

    public string? ChapterNumber { get; set; }

    public int? Year { get; set; }

    public int? Month { get; set; }

    public int? Day { get; set; }

    public string? Description { get; set; }

    public List<PtvReadingPersonCredit> Credits { get; set; } = [];

    public string? Publisher { get; set; }

    public List<string> Genres { get; set; } = [];

    public List<string> Tags { get; set; } = [];

    public string? SourceUrl { get; set; }

    public string? Language { get; set; }

    /// <summary>ComicInfo's Manga value retained as evidence for the classifier.</summary>
    public string? Manga { get; set; }

    public string? Isbn10 { get; set; }

    public string? Isbn13 { get; set; }

    public Dictionary<string, string> ExternalIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>
/// Safe result of local inspection. It deliberately contains only a base file name and immediate
/// folder name; the authoritative server path never crosses this boundary.
/// </summary>
public sealed class PtvReadingLocalMetadataInspectionResult
{
    public PtvReadingLocalInspectionState State { get; set; } = PtvReadingLocalInspectionState.NotFound;

    public string? FileName { get; set; }

    public string? FolderName { get; set; }

    public List<string> Sources { get; set; } = [];

    /// <summary>Stable, non-sensitive diagnostic codes suitable for an admin response.</summary>
    public List<string> Warnings { get; set; } = [];

    public PtvReadingLocalMetadataEvidence Metadata { get; set; } = new();
}
