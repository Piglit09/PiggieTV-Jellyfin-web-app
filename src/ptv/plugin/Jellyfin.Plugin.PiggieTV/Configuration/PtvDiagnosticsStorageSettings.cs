namespace Jellyfin.Plugin.PiggieTV.Configuration;

/// <summary>Bounded persistent diagnostics storage policy.</summary>
public sealed class PtvDiagnosticsStorageSettings
{
    /// <summary>Gets or sets whether JSONL diagnostic persistence is enabled.</summary>
    public bool FileLoggingEnabled { get; set; } = true;

    /// <summary>Gets or sets the active log size limit in megabytes.</summary>
    public int MaximumFileSizeMb { get; set; } = 25;

    /// <summary>Gets or sets the number of rotated log files retained.</summary>
    public int MaximumRotatedFiles { get; set; } = 5;

    /// <summary>Gets or sets the retention period in days.</summary>
    public int RetentionDays { get; set; } = 14;

    /// <summary>Gets or sets the minimum level persisted to disk.</summary>
    public string MinimumPersistentLogLevel { get; set; } = "information";

    /// <summary>Gets or sets whether high-frequency performance samples are persisted.</summary>
    public bool IncludePerformanceSamples { get; set; }

    /// <summary>Gets or sets whether client check-ins are summarized to disk.</summary>
    public bool IncludeClientCheckIns { get; set; } = true;

    /// <summary>Gets or sets whether filesystem paths are retained in disk diagnostics.</summary>
    public bool IncludeFilesystemPaths { get; set; }

    /// <summary>Gets or sets whether request URLs are retained in disk diagnostics.</summary>
    public bool IncludeRequestUrls { get; set; }

    /// <summary>Gets or sets whether content and account identifiers are retained in disk diagnostics.</summary>
    public bool IncludeItemIds { get; set; }
}
