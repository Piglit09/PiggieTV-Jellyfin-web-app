using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Ephemeral, server-local coordination for client diagnostics.
/// </summary>
public interface IPtvRemoteDiagnosticsStore
{
    /// <summary>Records minimal presence and returns any active command.</summary>
    PtvRemoteDiagnosticsCommand CheckIn(string ownerKey, PtvRemoteDiagnosticsPresence presence);

    /// <summary>Lists recently seen clients, optionally filtered by profile.</summary>
    IReadOnlyList<PtvRemoteDiagnosticsClientSummary> GetClients(string? profile);

    /// <summary>Starts a temporary collection lease.</summary>
    PtvRemoteDiagnosticsCommand? StartSession(string clientId, int durationMinutes);

    /// <summary>Stops collection and revokes the current lease.</summary>
    bool StopSession(string clientId);

    /// <summary>Requests a one-time snapshot from a client.</summary>
    PtvRemoteDiagnosticsCommand? RequestSnapshot(string clientId);

    /// <summary>Stores a sanitized report for an active client session.</summary>
    bool PublishReport(string ownerKey, string clientId, JsonElement report);

    /// <summary>Gets the latest unexpired report.</summary>
    PtvRemoteDiagnosticsStoredReport? GetReport(string clientId);
}
