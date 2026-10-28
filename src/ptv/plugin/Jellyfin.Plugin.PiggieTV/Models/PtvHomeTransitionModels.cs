using System.Text.Json;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>Exact intended library definition, correlated against Plugin readback.</summary>
public sealed class PtvHomeLibraryDefinition
{
    public string LibraryId { get; set; } = string.Empty;
    public string CollectionType { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string[] Roots { get; set; } = [];
    public JsonElement Options { get; set; }
}

/// <summary>Exact intended user library policy.</summary>
public sealed class PtvHomeAccessDefinition
{
    public string UserId { get; set; } = string.Empty;
    public bool EnableAllFolders { get; set; }
    public string[] EnabledFolders { get; set; } = [];
    public bool IsAdministrator { get; set; }
    public bool IsDisabled { get; set; }
}

/// <summary>Administrator intent; fingerprints are computed by the Plugin.</summary>
public sealed class PtvHomeTransitionIntent
{
    public Guid OperationId { get; set; }
    public string Kind { get; set; } = string.Empty;
    public string ServerId { get; set; } = string.Empty;
    public string[] AffectedRuleIds { get; set; } = [];
    public PtvHomeLibraryDefinition? ExpectedLibrary { get; set; }
    public PtvHomeAccessDefinition? ExpectedAccess { get; set; }
    /// <summary>Create requires authoritative absence before the write, verified by the Plugin mutation owner.</summary>
    public bool ExpectedLibraryAbsent { get; set; }
    /// <summary>Exact intended post-write definition. Create/rename may leave LibraryId empty for server assignment.</summary>
    public PtvHomeLibraryDefinition? IntendedLibrary { get; set; }
    /// <summary>Exact intended post-write policy for the same user as ExpectedAccess.</summary>
    public PtvHomeAccessDefinition? IntendedAccess { get; set; }
}

/// <summary>Durable operation including its authoritative intent fingerprint.</summary>
public sealed class PtvHomeTransitionOperation
{
    [JsonRequired]
    public PtvHomeTransitionIntent Intent { get; set; } = new();
    [JsonRequired]
    public string Fingerprint { get; set; } = string.Empty;
    [JsonRequired]
    public string State { get; set; } = "pending";
    [JsonRequired]
    public string VerifiedLibraryId { get; set; } = string.Empty;
}

/// <summary>A rule incarnation; topology writes never implicitly clear tombstones.</summary>
public sealed class PtvHomeBindingGeneration
{
    [JsonRequired]
    public long Generation { get; set; }
    [JsonRequired]
    public bool Tombstoned { get; set; }
    [JsonRequired]
    public string CollectionFolderId { get; set; } = string.Empty;
    [JsonRequired]
    public Guid? ReboundOperationId { get; set; }
    /// <summary>Pre-write saved scope; an ordinary settings repoint cannot use this binding.</summary>
    public string? OriginalScopeFingerprint { get; set; }
}

/// <summary>Library-only authority; global provenance remains separately authorized.</summary>
public sealed class PtvHomeTopologySnapshot
{
    [JsonRequired]
    public int SchemaVersion { get; set; }
    [JsonRequired]
    public string ServerId { get; set; } = string.Empty;
    [JsonRequired]
    public long Sequence { get; set; }
    public bool BindingAuthorityRequired { get; set; }
    public long RebindCount { get; set; }
    [JsonRequired]
    public string Epoch { get; set; } = string.Empty;
    [JsonRequired]
    public bool BroadHold { get; set; }
    [JsonRequired]
    public bool RequiresFreshGeneration { get; set; } = true;
    [JsonRequired]
    public bool RecoveryRequired { get; set; }
    [JsonRequired]
    public PtvHomeTransitionOperation? Operation { get; set; }
    [JsonRequired]
    public Dictionary<string, PtvHomeBindingGeneration> Bindings { get; set; } = new(StringComparer.Ordinal);
    [JsonRequired]
    public List<Guid> CompletedOperationIds { get; set; } = [];
    [JsonIgnore] public bool GlobalRowsEligible => true;
}

/// <summary>Plugin-only evidence. Never bind this type from an HTTP request.</summary>
public sealed class PtvVerifiedTransitionReadback
{
    internal PtvVerifiedTransitionReadback(string freshGenerationEpoch, PtvHomeLibraryDefinition? library,
        PtvHomeAccessDefinition? access, bool uniqueCurrentEvidence, bool oldDefinitionAbsent, bool trustedScopeGeneration)
    {
        FreshGenerationEpoch = freshGenerationEpoch;
        Library = library; Access = access; UniqueCurrentEvidence = uniqueCurrentEvidence;
        OldDefinitionAbsent = oldDefinitionAbsent; TrustedScopeGeneration = trustedScopeGeneration;
    }
    internal string FreshGenerationEpoch { get; }
    internal PtvHomeLibraryDefinition? Library { get; }
    internal PtvHomeAccessDefinition? Access { get; }
    internal bool UniqueCurrentEvidence { get; }
    internal bool OldDefinitionAbsent { get; }
    internal bool TrustedScopeGeneration { get; }
}


/// <summary>Administrator request only; never a verified readback.</summary>
public sealed class PtvHomeTransitionCompleteRequest
{
    public PtvHomeTransitionBindingRequest[]? Bindings { get; set; }
}
public sealed class PtvHomeTransitionBindingRequest
{
    public string RuleId { get; set; } = string.Empty;
    public string LibraryId { get; set; } = string.Empty;
}
/// <summary>Pending operation and Plugin-owned diagnostic readback.</summary>
public sealed class PtvHomeTransitionResponse
{
    [JsonPropertyName("operationId")] public Guid? OperationId { get; set; }
    [JsonPropertyName("epoch")] public string Epoch { get; set; } = string.Empty;
    [JsonPropertyName("held")] public bool Held { get; set; }
    [JsonPropertyName("state")] public string State { get; set; } = "pending";
    [JsonPropertyName("affectedRuleIds")] public string[] AffectedRuleIds { get; set; } = [];
    [JsonPropertyName("writeAllowed")] public bool WriteAllowed { get; set; }
    [JsonPropertyName("authority")] public string Authority { get; set; } = "unresolved";
    [JsonPropertyName("library")] public MediaBrowser.Model.Entities.VirtualFolderInfo? Library { get; set; }
}
