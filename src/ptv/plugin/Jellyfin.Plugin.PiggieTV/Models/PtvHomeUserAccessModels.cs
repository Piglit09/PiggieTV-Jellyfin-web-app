using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>Administrator intent for one existing-user policy write or post-creation bootstrap.</summary>
public sealed class PtvHomeUserAccessIntent
{
    public Guid OperationId { get; set; }
    public Guid? SupersedesOperationId { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string Mode { get; set; } = string.Empty;
    public PtvHomeAccessDefinition? ExpectedAccess { get; set; }
    public PtvHomeAccessDefinition? IntendedAccess { get; set; }
}

/// <summary>Per-user authority. Policy proof permits fresh membership verification, not row adoption.</summary>
public sealed record PtvHomeUserAccessView
{
    [JsonPropertyName("version")] public int Version { get; init; } = 1;
    [JsonPropertyName("userId")] public string UserId { get; init; } = string.Empty;
    [JsonPropertyName("accessEpoch")] public string? AccessEpoch { get; init; }
    [JsonPropertyName("held")] public bool Held { get; init; } = true;
    [JsonPropertyName("policyProven")] public bool PolicyProven { get; init; }
    [JsonPropertyName("state")] public string State { get; init; } = "unproven";
    [JsonPropertyName("operationId")] public Guid? OperationId { get; init; }
    [JsonPropertyName("writeAllowed")] public bool WriteAllowed { get; init; }
    [JsonIgnore] public Guid? VerificationBatchId { get; init; }
    [JsonIgnore] public Guid? SupersededOperationId { get; init; }
    [JsonIgnore] public PtvHomeAccessDefinition? ExpectedAccess { get; init; }
    [JsonIgnore] public PtvHomeAccessDefinition? IntendedAccess { get; init; }
    [JsonIgnore] public PtvHomeAccessDefinition? AttestedAccess { get; init; }
    [JsonIgnore] public string[] AccessibleLibraryIds { get; init; } = [];
}

/// <summary>Administrator recovery detail, including exact current and intended policy.</summary>
public sealed record PtvHomeUserAccessAdminView
{
    [JsonPropertyName("version")] public int Version { get; init; } = 1;
    [JsonPropertyName("userId")] public string UserId { get; init; } = string.Empty;
    [JsonPropertyName("accessEpoch")] public string? AccessEpoch { get; init; }
    [JsonPropertyName("held")] public bool Held { get; init; }
    [JsonPropertyName("policyProven")] public bool PolicyProven { get; init; }
    [JsonPropertyName("state")] public string State { get; init; } = "unproven";
    [JsonPropertyName("operationId")] public Guid? OperationId { get; init; }
    [JsonPropertyName("writeAllowed")] public bool WriteAllowed { get; init; }
    [JsonPropertyName("verificationBatchId")] public Guid? VerificationBatchId { get; init; }
    [JsonPropertyName("supersededOperationId")] public Guid? SupersededOperationId { get; init; }
    [JsonPropertyName("currentAccess")] public PtvHomeAccessDefinition? CurrentAccess { get; init; }
    [JsonPropertyName("expectedAccess")] public PtvHomeAccessDefinition? ExpectedAccess { get; init; }
    [JsonPropertyName("intendedAccess")] public PtvHomeAccessDefinition? IntendedAccess { get; init; }
    [JsonPropertyName("controlledCreated")] public bool ControlledCreated { get; init; }
    [JsonPropertyName("migrationRecoveryRestricted")] public bool MigrationRecoveryRestricted { get; init; }
    [JsonPropertyName("lateUnverified")] public bool LateUnverified { get; init; }

    public static PtvHomeUserAccessAdminView From(PtvHomeUserAccessView view, PtvHomeAccessDefinition current,
        bool controlledCreated, bool migrationRecoveryRestricted, bool lateUnverified) => new()
    {
        UserId = view.UserId,
        AccessEpoch = view.AccessEpoch,
        Held = view.Held,
        PolicyProven = view.PolicyProven,
        State = view.State,
        OperationId = view.OperationId,
        WriteAllowed = view.WriteAllowed,
        VerificationBatchId = view.VerificationBatchId,
        SupersededOperationId = view.SupersededOperationId,
        CurrentAccess = current,
        ExpectedAccess = view.ExpectedAccess,
        IntendedAccess = view.IntendedAccess,
        ControlledCreated = controlledCreated,
        MigrationRecoveryRestricted = migrationRecoveryRestricted,
        LateUnverified = lateUnverified
    };
}

/// <summary>An explicit administrator verification cohort fixed at operation start.</summary>
public sealed record PtvHomeUserVerificationBatch
{
    public Guid Id { get; init; }
    public string TopologyEpoch { get; init; } = string.Empty;
    public string[] CandidateUserIds { get; init; } = [];
}

/// <summary>Administrator-only bounded cohort and current verification counts.</summary>
public sealed record PtvHomeUserVerificationBatchStatus
{
    [JsonPropertyName("id")] public Guid Id { get; init; }
    [JsonPropertyName("topologyEpoch")] public string TopologyEpoch { get; init; } = string.Empty;
    [JsonPropertyName("candidateUserIds")] public string[] CandidateUserIds { get; init; } = [];
    [JsonPropertyName("verifiedCount")] public int VerifiedCount { get; init; }
    [JsonPropertyName("needsVerificationCount")] public int NeedsVerificationCount { get; init; }
    [JsonPropertyName("stale")] public bool Stale { get; init; }
}

/// <summary>Read-only first-install progress; this does not enroll any user.</summary>
public sealed record PtvHomeUserVerificationSummary
{
    [JsonPropertyName("verifiedCount")] public int VerifiedCount { get; init; }
    [JsonPropertyName("needsVerificationCount")] public int NeedsVerificationCount { get; init; }
    [JsonPropertyName("totalCount")] public int TotalCount { get; init; }
    [JsonPropertyName("currentBatchId")] public Guid? CurrentBatchId { get; init; }
    [JsonPropertyName("topologyEpoch")] public string? TopologyEpoch { get; init; }
    [JsonPropertyName("held")] public bool Held { get; init; }
    [JsonPropertyName("recoveryRequired")] public bool RecoveryRequired { get; init; }
    [JsonPropertyName("pendingCreationReservations")] public int PendingCreationReservations { get; init; }
    [JsonPropertyName("legacyCohortStarted")] public bool LegacyCohortStarted { get; init; }
    [JsonPropertyName("migrationRecoveryRestricted")] public bool MigrationRecoveryRestricted { get; init; }
}

/// <summary>Durable migration eligibility, including restricted corrupt-ledger recovery.</summary>
public sealed record PtvHomeUserMigrationState
{
    public bool Started { get; init; }
    public bool RecoveryRestricted { get; init; }
    public string[] EligibleUserIds { get; init; } = [];
}

/// <summary>Explicit administrator confirmation of the exact intended current policy.</summary>
public sealed class PtvHomeUserVerificationIntent
{
    public PtvHomeAccessDefinition? IntendedAccess { get; set; }
    public bool ConfirmCurrentPolicy { get; set; }
}

/// <summary>Migration exclusion for a controlled create; this is not a user prewrite hold.</summary>
public sealed record PtvHomeUserCreationView
{
    [JsonPropertyName("version")] public int Version { get; init; } = 1;
    [JsonPropertyName("creationOperationId")] public Guid CreationOperationId { get; init; }
    [JsonPropertyName("state")] public string State { get; init; } = "reserved";
    [JsonPropertyName("migrationVerificationHeld")] public bool MigrationVerificationHeld { get; init; }
    [JsonPropertyName("userId")] public string? UserId { get; init; }
    [JsonPropertyName("bootstrapRequired")] public bool BootstrapRequired { get; init; }
}

/// <summary>Read-only durable state of one administrator-controlled creation operation.</summary>
public sealed record PtvHomeUserCreationStatus
{
    [JsonPropertyName("version")] public int Version { get; init; } = 1;
    [JsonPropertyName("creationOperationId")] public Guid CreationOperationId { get; init; }
    [JsonPropertyName("state")] public string State { get; init; } = "absent";
    [JsonPropertyName("userId")] public string? UserId { get; init; }
    [JsonPropertyName("markedUserIds")] public string[] MarkedUserIds { get; init; } = [];
}

/// <summary>Conservative administrator recovery of an uncertain create.</summary>
public sealed record PtvHomeUserCreationRecovery
{
    [JsonPropertyName("creationOperationId")] public Guid CreationOperationId { get; init; }
    [JsonPropertyName("state")] public string State { get; init; } = "recovered";
    [JsonPropertyName("markedUserIds")] public string[] MarkedUserIds { get; init; } = [];
}

/// <summary>Administrator-only unresolved create and bounded candidate IDs.</summary>
public sealed record PtvHomeUserPendingCreation
{
    [JsonPropertyName("creationOperationId")] public Guid CreationOperationId { get; init; }
    [JsonPropertyName("candidateNewUserIds")] public string[] CandidateNewUserIds { get; init; } = [];
}

/// <summary>Administrator request to reserve migration exclusion before stock user creation.</summary>
public sealed class PtvHomeUserCreationReservationRequest
{
    public Guid CreationOperationId { get; set; }
}

/// <summary>Administrator request to bind the ID returned by stock user creation.</summary>
public sealed class PtvHomeUserCreationBindRequest
{
    public string UserId { get; set; } = string.Empty;
}

/// <summary>Administrator view of unresolved controlled creates.</summary>
public sealed record PtvHomeUserPendingCreations
{
    [JsonPropertyName("pendingCount")] public int PendingCount { get; init; }
    [JsonPropertyName("pending")] public IReadOnlyList<PtvHomeUserPendingCreation> Pending { get; init; } = [];
}

/// <summary>Explicit administrator recovery only after an uncertain create request has settled.</summary>
public sealed class PtvHomeUserCreationRecoveryRequest
{
    public bool ConfirmCreationRequestSettled { get; set; }
}
