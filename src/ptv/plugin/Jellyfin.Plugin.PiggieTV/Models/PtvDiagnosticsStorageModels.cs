namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>One persistent PiggieTV diagnostics event.</summary>
public sealed class PtvRollingDiagnosticEvent
{
    /// <summary>Gets or sets the event timestamp.</summary>
    public DateTimeOffset TimestampUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets the normalized severity.</summary>
    public string Level { get; set; } = "information";

    /// <summary>Gets or sets the subsystem category.</summary>
    public string Category { get; set; } = "plugin";

    /// <summary>Gets or sets the stable event name.</summary>
    public string EventName { get; set; } = "ptv-event";

    /// <summary>Gets or sets an optional opaque client identifier.</summary>
    public string? ClientId { get; set; }

    /// <summary>Gets or sets the event detail before sanitization.</summary>
    public object? Detail { get; set; }
}

/// <summary>Current bounded diagnostics storage state.</summary>
public sealed class PtvDiagnosticsStorageStatus
{
    /// <summary>Gets or sets the active JSONL path.</summary>
    public string ActiveLogPath { get; set; } = string.Empty;

    /// <summary>Gets or sets active file size.</summary>
    public long ActiveFileSizeBytes { get; set; }

    /// <summary>Gets or sets rotated file count.</summary>
    public int RotatedFileCount { get; set; }

    /// <summary>Gets or sets total retained bytes.</summary>
    public long TotalRetainedBytes { get; set; }

    /// <summary>Gets or sets the oldest retained timestamp.</summary>
    public DateTimeOffset? OldestRetainedAtUtc { get; set; }

    /// <summary>Gets or sets configured retention days.</summary>
    public int RetentionDays { get; set; }

    /// <summary>Gets or sets configured active file size limit.</summary>
    public int MaximumFileSizeMb { get; set; }

    /// <summary>Gets or sets configured rotation count.</summary>
    public int MaximumRotatedFiles { get; set; }

    /// <summary>Gets or sets events currently queued.</summary>
    public long EventsQueued { get; set; }

    /// <summary>Gets or sets events appended to JSONL.</summary>
    public long EventsWritten { get; set; }

    /// <summary>Gets or sets high-frequency events aggregated.</summary>
    public long EventsAggregated { get; set; }

    /// <summary>Gets or sets duplicate events suppressed.</summary>
    public long DuplicateEventsSuppressed { get; set; }

    /// <summary>Gets or sets events dropped by minimum level or queue pressure.</summary>
    public long EventsDropped { get; set; }

    /// <summary>Gets or sets persistent write failures.</summary>
    public long WriteFailures { get; set; }

    /// <summary>Gets or sets completed rotations.</summary>
    public long RotationsCompleted { get; set; }

    /// <summary>Gets or sets the last completed rotation.</summary>
    public DateTimeOffset? LastRotationUtc { get; set; }

    /// <summary>Gets or sets known safe legacy file count.</summary>
    public int LegacyFileCount { get; set; }

    /// <summary>Gets or sets estimated legacy disk usage.</summary>
    public long LegacyFileSizeBytes { get; set; }
}

/// <summary>Confirmation body used by destructive diagnostics storage actions.</summary>
public sealed class PtvDiagnosticsStorageActionRequest
{
    /// <summary>Gets or sets whether the administrator confirmed the action.</summary>
    public bool Confirm { get; set; }

    /// <summary>Gets or sets whether legacy files should be archived before removal.</summary>
    public bool CreateArchive { get; set; } = true;
}

/// <summary>Result of a diagnostics storage maintenance action.</summary>
public sealed class PtvDiagnosticsStorageActionResult
{
    /// <summary>Gets or sets a user-safe action message.</summary>
    public string Message { get; set; } = string.Empty;

    /// <summary>Gets or sets affected file count.</summary>
    public int FileCount { get; set; }

    /// <summary>Gets or sets reclaimed bytes.</summary>
    public long ReclaimedBytes { get; set; }

    /// <summary>Gets or sets the optional legacy archive file name.</summary>
    public string? ArchiveFileName { get; set; }
}
