using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>Identity labels are text, never URLs, paths or private query payloads.</summary>
internal static class PtvReadingIdentityText
{
    public static bool IsUnsafe(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        if (value.Length > 16_384) return true;
        var text = new string(value.Trim().Where(c => !char.IsControl(c)).ToArray());
        // A query may be an opaque token without '=' or '&'. Only a terminal question
        // mark is unambiguously title punctuation. Keep ordinary whitespace-separated
        // numeric issue markers, but withhold attached or nonnumeric fragment payloads.
        var query = text.IndexOf('?');
        var fragment = text.IndexOf('#');
        return text.Contains("://", StringComparison.Ordinal) || text.Contains("\\", StringComparison.Ordinal)
            || text.StartsWith('/') || (text.Length > 2 && char.IsAsciiLetter(text[0]) && text[1] == ':')
            || (query >= 0 && query < text.Length - 1)
            || (fragment >= 0 && fragment < text.Length - 1
                && ((fragment > 0 && !char.IsWhiteSpace(text[fragment - 1])) || !char.IsAsciiDigit(text[fragment + 1])))
            || text.Contains("%3f", StringComparison.OrdinalIgnoreCase)
            || text.Contains("%3a", StringComparison.OrdinalIgnoreCase)
            || text.Contains("%23", StringComparison.OrdinalIgnoreCase)
            || text.Contains("%25", StringComparison.OrdinalIgnoreCase);
    }

    public static string? Bound(string? value, int limit)
    {
        if (string.IsNullOrWhiteSpace(value) || IsUnsafe(value)) return null;
        var text = new string(value.Trim().Where(c => !char.IsControl(c)).Take(limit).ToArray());
        return text.Length == 0 ? null : text;
    }
}

/// <summary>Exact provenance; ComicInfo is never merged with adjacent OPF.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PtvReadingIdentitySource>))]
public enum PtvReadingIdentitySource { FileName, ImmediateFolder, ComicInfo, CurrentItem, Provider }

/// <summary>Semantics established by the source adapter, never by a generic year.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PtvReadingRunEvidenceKind>))]
public enum PtvReadingRunEvidenceKind { Unknown, ExplicitRun, ExplicitVolume }

/// <summary>A provider namespace alone cannot establish issue or series identity.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<PtvReadingProviderIdScope>))]
public enum PtvReadingProviderIdScope { Unknown, Issue, Series }

/// <summary>One typed provider ID. Only the assessor's explicit allowlist can prove agreement.</summary>
public sealed class PtvReadingScopedProviderId
{
    public string Namespace { get; set; } = string.Empty;
    public PtvReadingProviderIdScope Scope { get; set; }
    public string Value { get; set; } = string.Empty;

    /// <summary>Opaque IDs are validated, never truncated into a different identity.</summary>
    public PtvReadingScopedProviderId ToBoundedTransportModel() => new()
    {
        Namespace = Namespace.Length is > 0 and <= 64 && Namespace.All(c => char.IsAsciiLetterOrDigit(c) || c is ' ' or '-' or '_') ? Namespace : string.Empty,
        Scope = Enum.IsDefined(Scope) ? Scope : PtvReadingProviderIdScope.Unknown,
        Value = Value.Length is > 0 and <= 256 && Value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_') ? Value : string.Empty
    };
}

/// <summary>Source-specific identity fields, without paths, URLs, free-form notes or archive bytes.</summary>
public sealed class PtvReadingIdentityRecord
{
    /// <summary>Unsafe identity text was withheld; remains material uncertainty after projection.</summary>
    public bool HasRedactedIdentity { get; set; }
    public string? SeriesTitle { get; set; }
    public string? IssueNumber { get; set; }
    public string? VolumeOrRunLabel { get; set; }
    public int? IssuePublicationYear { get; set; }
    public DateTimeOffset? IssuePublicationDate { get; set; }
    public PtvReadingRunEvidenceKind RunEvidenceKind { get; set; }
    public PtvReadingIdentitySource Source { get; set; }
    public List<PtvReadingScopedProviderId> ProviderIds { get; set; } = [];
}

/// <summary>Independent inputs for search display and fresh Apply reassessment.</summary>
public sealed class PtvReadingIdentitySources
{
    public PtvComicInfoArchiveInspectionState ArchiveState { get; set; }
    public string? ArchiveReasonCode { get; set; }
    public PtvReadingIdentityRecord FileName { get; set; } = new();
    public PtvReadingIdentityRecord ImmediateFolder { get; set; } = new();
    public PtvReadingIdentityRecord ComicInfo { get; set; } = new();
    public PtvReadingIdentityRecord CurrentItem { get; set; } = new();
}

/// <summary>Stable, bounded identity comparison with both source values.</summary>
public sealed class PtvReadingIdentityFinding
{
    public string Code { get; set; } = string.Empty;
    public string Field { get; set; } = string.Empty;
    public PtvReadingIdentitySource LeftSource { get; set; }
    public string? LeftValue { get; set; }
    public PtvReadingIdentitySource RightSource { get; set; }
    public string? RightValue { get; set; }
    public bool IsConflict { get; set; }
    public bool IsMaterialUncertainty { get; set; }
}

/// <summary>Score-independent review evidence; the digest binds every displayed value and both flags.</summary>
public sealed class PtvReadingIdentityAssessment
{
    public string ItemId { get; set; } = string.Empty;
    public string Provider { get; set; } = string.Empty;
    public string ProviderId { get; set; } = string.Empty;
    public string SearchGeneration { get; set; } = string.Empty;
    public string ArchiveRevision { get; set; } = string.Empty;
    public bool RevisionChanged { get; set; }

    public PtvReadingIdentitySources Sources { get; set; } = new();
    public PtvReadingIdentityRecord Candidate { get; set; } = new();
    public List<PtvReadingIdentityFinding> Findings { get; set; } = [];
    public bool RequiresConflictAcknowledgment { get; set; }
    public bool RequiresUnverifiedAcknowledgment { get; set; }
    public string AssessmentDigest { get; set; } = string.Empty;
}
