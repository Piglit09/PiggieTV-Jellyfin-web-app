using System.Text.Json;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Minimal, privacy-safe client presence sent while PiggieTV is running.
/// </summary>
public sealed class PtvRemoteDiagnosticsPresence
{
    /// <summary>Gets or sets the diagnostics schema version.</summary>
    public int SchemaVersion { get; set; } = 1;

    /// <summary>Gets or sets the opaque, client-generated identifier.</summary>
    public string? ClientId { get; set; }

    /// <summary>Gets or sets the client timestamp in Unix milliseconds.</summary>
    public long SeenAt { get; set; }

    /// <summary>Gets or sets the normalized route category.</summary>
    public string? Route { get; set; }

    /// <summary>Gets or sets the detected client profile.</summary>
    public PtvRemoteDiagnosticsProfile? Profile { get; set; }

    /// <summary>Gets or sets the client's current local diagnostics state.</summary>
    public PtvRemoteDiagnosticsPresenceState? Diagnostics { get; set; }

    /// <summary>Gets or sets safe app/device metadata from the running PiggieTV client.</summary>
    public PtvRemoteDiagnosticsClientMetadata? Metadata { get; set; }

    /// <summary>Gets or sets explicit client diagnostics capabilities.</summary>
    public PtvRemoteDiagnosticsClientCapabilities? Capabilities { get; set; }

    /// <summary>Gets or sets the client-side boot/check-in marker.</summary>
    public PtvRemoteDiagnosticsBootMarker? Boot { get; set; }
}

/// <summary>
/// Safe client boot/check-in status marker for diagnosing stale or packaged app runtimes.
/// </summary>
public sealed class PtvRemoteDiagnosticsBootMarker
{
    /// <summary>Gets or sets the detected platform string.</summary>
    public string? PlatformDetected { get; set; }

    /// <summary>Gets or sets a value indicating whether the PTV runtime loaded.</summary>
    public bool PtvRuntimeLoaded { get; set; }

    /// <summary>Gets or sets a value indicating whether the diagnostics module loaded.</summary>
    public bool DiagnosticsModuleLoaded { get; set; }

    /// <summary>Gets or sets a value indicating whether a check-in was attempted.</summary>
    public bool CheckInAttempted { get; set; }

    /// <summary>Gets or sets the last check-in HTTP status, if known.</summary>
    public int? CheckInStatus { get; set; }

    /// <summary>Gets or sets the coarse failure code, if any.</summary>
    public string? FailureCode { get; set; }

    /// <summary>Gets or sets the frontend build identifier compiled into the loaded client.</summary>
    public string? FrontendBuildId { get; set; }

    /// <summary>Gets or sets the loaded client build identifier.</summary>
    public string? LoadedClientBuildId { get; set; }

    /// <summary>Gets or sets the remote diagnostics runtime registration count.</summary>
    public int RemoteDiagnosticsRegistrationCount { get; set; }
}

/// <summary>
/// Minimal subset of the client profile used for server-side filtering.
/// Additional browser-side profile fields are intentionally ignored by the server.
/// </summary>
public sealed class PtvRemoteDiagnosticsProfile
{
    /// <summary>Gets or sets the coarse client kind.</summary>
    public string? Kind { get; set; }

    /// <summary>Gets or sets the detected TV platform, if any.</summary>
    public string? TvPlatform { get; set; }
}

/// <summary>
/// Privacy-safe device/app labels sent by a running PiggieTV web client.
/// </summary>
public sealed class PtvRemoteDiagnosticsClientMetadata
{
    /// <summary>Gets or sets the application/client name.</summary>
    public string? ApplicationName { get; set; }

    /// <summary>Gets or sets the application/client version.</summary>
    public string? ApplicationVersion { get; set; }

    /// <summary>Gets or sets the preferred safe device display name.</summary>
    public string? DeviceDisplayName { get; set; }

    /// <summary>Gets or sets the safe Jellyfin/apphost device name.</summary>
    public string? DeviceName { get; set; }

    /// <summary>Gets or sets the coarse device type/platform label.</summary>
    public string? DeviceType { get; set; }

    /// <summary>Gets or sets the coarse platform label.</summary>
    public string? Platform { get; set; }

    /// <summary>Gets or sets a value indicating whether the client reports a native wrapper/runtime.</summary>
    public bool NativeRuntime { get; set; }
}

/// <summary>
/// Explicit support matrix for remote diagnostics actions.
/// </summary>
public sealed class PtvRemoteDiagnosticsClientCapabilities
{
    /// <summary>Gets or sets a value indicating whether periodic check-ins are supported.</summary>
    public bool Heartbeat { get; set; }

    /// <summary>Gets or sets a value indicating whether memory samples can be collected.</summary>
    public bool MemoryMetrics { get; set; }

    /// <summary>Gets or sets a value indicating whether navigation timing can be collected.</summary>
    public bool NavigationTiming { get; set; }

    /// <summary>Gets or sets a value indicating whether network timing/failure samples can be collected.</summary>
    public bool NetworkTiming { get; set; }

    /// <summary>Gets or sets a value indicating whether render/performance samples can be collected.</summary>
    public bool PerformanceMetrics { get; set; }

    /// <summary>Gets or sets a value indicating whether bounded physical layout snapshots can be collected.</summary>
    public bool PhysicalLayoutSnapshot { get; set; }

    /// <summary>Gets or sets a value indicating whether playback transitions can be collected.</summary>
    public bool PlaybackTelemetry { get; set; }

    /// <summary>Gets or sets a value indicating whether remote start/stop/snapshot commands are supported.</summary>
    public bool RemoteCommands { get; set; }

    /// <summary>Gets or sets a value indicating whether reports can be viewed/exported.</summary>
    public bool ReportExport { get; set; }
}

/// <summary>
/// Client-reported diagnostics state included with presence.
/// </summary>
public sealed class PtvRemoteDiagnosticsPresenceState
{
    /// <summary>Gets or sets a value indicating whether collection is active.</summary>
    public bool Active { get; set; }

    /// <summary>Gets or sets the local lease expiry in Unix milliseconds.</summary>
    public long? ExpiresAt { get; set; }

    /// <summary>Gets or sets the current session identifier.</summary>
    public string? SessionId { get; set; }

    /// <summary>Gets or sets the last coarse lease rejection reason, if any.</summary>
    public string? LastLeaseRejection { get; set; }
}

/// <summary>
/// Server command returned to a client presence check-in.
/// </summary>
public sealed class PtvRemoteDiagnosticsCommand
{
    /// <summary>Gets or sets a value indicating whether the client must revoke local collection.</summary>
    public bool Disable { get; set; }

    /// <summary>Gets or sets the current collection lease, if any.</summary>
    public PtvRemoteDiagnosticsLease? Lease { get; set; }

    /// <summary>Gets or sets a value indicating whether a one-time snapshot is requested.</summary>
    public bool RequestSnapshot { get; set; }
}

/// <summary>
/// Temporary remote diagnostics collection lease.
/// </summary>
public sealed class PtvRemoteDiagnosticsLease
{
    /// <summary>Gets or sets the remaining lease duration for clock-skew-safe clients.</summary>
    public long DurationMs { get; set; }

    /// <summary>Gets or sets a value indicating whether the lease is enabled.</summary>
    public bool Enabled { get; set; }

    /// <summary>Gets or sets the lease expiry in Unix milliseconds.</summary>
    public long ExpiresAt { get; set; }

    /// <summary>Gets or sets the server issue timestamp in Unix milliseconds.</summary>
    public long IssuedAt { get; set; }

    /// <summary>Gets or sets the opaque session identifier.</summary>
    public string SessionId { get; set; } = string.Empty;

    /// <summary>Gets or sets the client profiles allowed to activate this lease.</summary>
    public IReadOnlyList<string> Profiles { get; set; } = Array.Empty<string>();
}

/// <summary>
/// Admin request to start temporary collection on one client.
/// </summary>
public sealed class PtvRemoteDiagnosticsStartRequest
{
    /// <summary>Gets or sets the requested duration. Supported values are five and ten minutes.</summary>
    public int DurationMinutes { get; set; } = 5;
}

/// <summary>
/// Admin-facing summary of a recently seen PiggieTV client.
/// </summary>
public sealed class PtvRemoteDiagnosticsClientSummary
{
    /// <summary>Gets or sets the opaque client identifier.</summary>
    public string ClientId { get; set; } = string.Empty;

    /// <summary>Gets or sets the detected client profile.</summary>
    public string Profile { get; set; } = "unknown";

    /// <summary>Gets or sets the first time the client was observed.</summary>
    public DateTimeOffset FirstSeenUtc { get; set; }

    /// <summary>Gets or sets the primary friendly display name.</summary>
    public string DisplayName { get; set; } = "PiggieTV client";

    /// <summary>Gets or sets the sanitized device name.</summary>
    public string DeviceName { get; set; } = string.Empty;

    /// <summary>Gets or sets the application/client name.</summary>
    public string ApplicationName { get; set; } = "PiggieTV";

    /// <summary>Gets or sets the application/client version.</summary>
    public string ApplicationVersion { get; set; } = string.Empty;

    /// <summary>Gets or sets the coarse platform label.</summary>
    public string Platform { get; set; } = "unknown";

    /// <summary>Gets or sets a value indicating whether the client reports a native wrapper/runtime.</summary>
    public bool NativeRuntime { get; set; }

    /// <summary>Gets or sets explicit client diagnostics capabilities.</summary>
    public PtvRemoteDiagnosticsClientCapabilities Capabilities { get; set; } = new();

    /// <summary>Gets or sets the client-side boot/check-in marker.</summary>
    public PtvRemoteDiagnosticsBootMarker Boot { get; set; } = new();

    /// <summary>Gets or sets the normalized route category.</summary>
    public string Route { get; set; } = "unknown";

    /// <summary>Gets or sets the last presence timestamp.</summary>
    public DateTimeOffset LastSeenUtc { get; set; }

    /// <summary>Gets or sets a value indicating whether the client was seen recently.</summary>
    public bool Online { get; set; }

    /// <summary>Gets or sets a value indicating whether temporary collection is active.</summary>
    public bool DiagnosticsActive { get; set; }

    /// <summary>Gets or sets a value indicating whether the server lease awaits client acknowledgement.</summary>
    public bool LeasePending { get; set; }

    /// <summary>Gets or sets the active session identifier.</summary>
    public string? SessionId { get; set; }

    /// <summary>Gets or sets the active session expiry.</summary>
    public DateTimeOffset? ExpiresAtUtc { get; set; }

    /// <summary>Gets or sets a value indicating whether a report is available.</summary>
    public bool HasReport { get; set; }

    /// <summary>Gets or sets the latest report timestamp.</summary>
    public DateTimeOffset? ReportedAtUtc { get; set; }

    /// <summary>Gets or sets a value indicating whether a snapshot request is pending.</summary>
    public bool SnapshotPending { get; set; }

    /// <summary>Gets or sets the last coarse client lease rejection reason.</summary>
    public string? LastLeaseRejection { get; set; }
}

/// <summary>
/// Stored, sanitized diagnostics report.
/// </summary>
public sealed class PtvRemoteDiagnosticsStoredReport
{
    /// <summary>Gets or sets the client identifier.</summary>
    public string ClientId { get; set; } = string.Empty;

    /// <summary>Gets or sets the receipt timestamp.</summary>
    public DateTimeOffset ReceivedAtUtc { get; set; }

    /// <summary>Gets or sets the sanitized report document.</summary>
    public JsonElement Report { get; set; }
}
