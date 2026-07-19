using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// In-memory remote diagnostics coordination. Nothing is written to disk or sent off-server.
/// </summary>
public sealed class PtvRemoteDiagnosticsStore : IPtvRemoteDiagnosticsStore
{
    private static readonly TimeSpan ClientRetention = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan OnlineWindow = TimeSpan.FromSeconds(45);
    private static readonly TimeSpan ReportRetention = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan FinalReportGrace = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan SnapshotLeaseDuration = TimeSpan.FromMinutes(1);
    private const int MaximumClients = 64;

    private readonly Dictionary<string, ClientState> _clients = new(StringComparer.Ordinal);
    private readonly Func<DateTimeOffset> _utcNow;
    private readonly object _sync = new();

    /// <summary>Initializes a store using the system clock.</summary>
    public PtvRemoteDiagnosticsStore()
        : this(() => DateTimeOffset.UtcNow)
    {
    }

    /// <summary>Initializes a store with a clock, primarily for deterministic tests.</summary>
    /// <param name="utcNow">UTC clock callback.</param>
    public PtvRemoteDiagnosticsStore(Func<DateTimeOffset> utcNow)
    {
        _utcNow = utcNow ?? throw new ArgumentNullException(nameof(utcNow));
    }

    /// <inheritdoc />
    public PtvRemoteDiagnosticsCommand CheckIn(string ownerKey, PtvRemoteDiagnosticsPresence presence)
    {
        ArgumentNullException.ThrowIfNull(presence);
        var clientId = NormalizeIdentifier(presence.ClientId);
        if (clientId is null || string.IsNullOrWhiteSpace(ownerKey))
        {
            return new PtvRemoteDiagnosticsCommand { Disable = true };
        }

        lock (_sync)
        {
            var now = _utcNow();
            Prune(now);
            if (!_clients.TryGetValue(clientId, out var state))
            {
                EnsureCapacity();
                state = new ClientState(clientId, ownerKey);
                _clients[clientId] = state;
            }
            else if (!string.Equals(state.OwnerKey, ownerKey, StringComparison.Ordinal))
            {
                // Never expose another authenticated user's lease/session merely
                // because a caller learned the opaque browser client ID.
                return new PtvRemoteDiagnosticsCommand { Disable = true };
            }

            state.LastSeenUtc = now;
            state.Profile = NormalizeLabel(presence.Profile?.Kind, "unknown", 32);
            state.Route = NormalizeRoute(presence.Route);
            ExpireSession(state, now);
            state.ClientDiagnosticsActive = state.SessionExpiresUtc > now
                && state.SessionId is not null
                && presence.Diagnostics?.Active == true
                && string.Equals(presence.Diagnostics.SessionId, state.SessionId, StringComparison.Ordinal);
            state.LastLeaseRejection = NormalizeLeaseRejection(presence.Diagnostics?.LastLeaseRejection);
            return CreateCommand(state, now);
        }
    }

    /// <inheritdoc />
    public IReadOnlyList<PtvRemoteDiagnosticsClientSummary> GetClients(string? profile)
    {
        lock (_sync)
        {
            var now = _utcNow();
            Prune(now);
            var normalizedProfile = string.IsNullOrWhiteSpace(profile)
                ? null
                : NormalizeLabel(profile, "unknown", 32);

            return _clients.Values
                .Where(state => normalizedProfile is null || string.Equals(state.Profile, normalizedProfile, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(state => state.LastSeenUtc)
                .Select(state => ToSummary(state, now))
                .ToArray();
        }
    }

    /// <inheritdoc />
    public PtvRemoteDiagnosticsCommand? StartSession(string clientId, int durationMinutes)
    {
        lock (_sync)
        {
            var now = _utcNow();
            Prune(now);
            var normalizedId = NormalizeIdentifier(clientId);
            if (normalizedId is null || !_clients.TryGetValue(normalizedId, out var state))
            {
                return null;
            }

            var safeMinutes = durationMinutes <= 5 ? 5 : 10;
            state.SessionId = Guid.NewGuid().ToString("N");
            state.SessionStartedUtc = now;
            state.SessionExpiresUtc = now.AddMinutes(safeMinutes);
            state.SnapshotPending = false;
            state.ClientDiagnosticsActive = false;
            state.LastLeaseRejection = null;
            state.Report = null;
            state.ReportedAtUtc = null;
            state.ReportGeneratedAt = null;
            state.FinalReportSessionId = null;
            state.FinalReportAcceptUntilUtc = null;
            return CreateCommand(state, now);
        }
    }

    /// <inheritdoc />
    public bool StopSession(string clientId)
    {
        lock (_sync)
        {
            var normalizedId = NormalizeIdentifier(clientId);
            if (normalizedId is null || !_clients.TryGetValue(normalizedId, out var state))
            {
                return false;
            }

            ClearSession(state, clearFinalReportGrace: true);
            return true;
        }
    }

    /// <inheritdoc />
    public PtvRemoteDiagnosticsCommand? RequestSnapshot(string clientId)
    {
        lock (_sync)
        {
            var now = _utcNow();
            Prune(now);
            var normalizedId = NormalizeIdentifier(clientId);
            if (normalizedId is null || !_clients.TryGetValue(normalizedId, out var state))
            {
                return null;
            }

            ExpireSession(state, now);
            if (state.SessionExpiresUtc is null)
            {
                state.SessionId = Guid.NewGuid().ToString("N");
                state.SessionStartedUtc = now;
                state.SessionExpiresUtc = now.Add(SnapshotLeaseDuration);
                state.ClientDiagnosticsActive = false;
                state.LastLeaseRejection = null;
                state.FinalReportSessionId = null;
                state.FinalReportAcceptUntilUtc = null;
            }

            state.SnapshotPending = true;
            state.Report = null;
            state.ReportedAtUtc = null;
            state.ReportGeneratedAt = null;
            return CreateCommand(state, now);
        }
    }

    /// <inheritdoc />
    public bool PublishReport(string ownerKey, string clientId, JsonElement report)
    {
        lock (_sync)
        {
            var now = _utcNow();
            Prune(now);
            var normalizedId = NormalizeIdentifier(clientId);
            if (normalizedId is null
                || !_clients.TryGetValue(normalizedId, out var state)
                || !string.Equals(state.OwnerKey, ownerKey, StringComparison.Ordinal))
            {
                return false;
            }

            ExpireSession(state, now);
            if (!TryGetReportMetadata(report, out var reportSessionId, out var generatedAt)
                || !(state.SessionExpiresUtc > now && string.Equals(reportSessionId, state.SessionId, StringComparison.Ordinal))
                    && !(state.FinalReportAcceptUntilUtc > now
                        && string.Equals(reportSessionId, state.FinalReportSessionId, StringComparison.Ordinal)))
            {
                return false;
            }

            // Requests can complete out of order. Treat an older matching report
            // as accepted, but never let it overwrite a newer expiration snapshot.
            if (state.ReportGeneratedAt is not null && generatedAt <= state.ReportGeneratedAt.Value)
            {
                return true;
            }

            state.Report = report.Clone();
            state.ReportGeneratedAt = generatedAt;
            state.ReportedAtUtc = now;
            state.SnapshotPending = false;
            return true;
        }
    }

    /// <inheritdoc />
    public PtvRemoteDiagnosticsStoredReport? GetReport(string clientId)
    {
        lock (_sync)
        {
            var now = _utcNow();
            Prune(now);
            var normalizedId = NormalizeIdentifier(clientId);
            if (normalizedId is null
                || !_clients.TryGetValue(normalizedId, out var state)
                || state.Report is null
                || state.ReportedAtUtc is null
                || now - state.ReportedAtUtc.Value > ReportRetention)
            {
                return null;
            }

            return new PtvRemoteDiagnosticsStoredReport
            {
                ClientId = state.ClientId,
                ReceivedAtUtc = state.ReportedAtUtc.Value,
                Report = state.Report.Value.Clone()
            };
        }
    }

    private static PtvRemoteDiagnosticsCommand CreateCommand(ClientState state, DateTimeOffset now)
    {
        var active = state.SessionExpiresUtc is not null && state.SessionExpiresUtc > now && state.SessionId is not null;
        return new PtvRemoteDiagnosticsCommand
        {
            // This explicit signal survives serializers that omit null Lease
            // properties and makes an administrator stop an unambiguous revoke.
            Disable = !active,
            Lease = active
                ? new PtvRemoteDiagnosticsLease
                {
                    DurationMs = Math.Max(1, (long)(state.SessionExpiresUtc!.Value - now).TotalMilliseconds),
                    Enabled = true,
                    ExpiresAt = state.SessionExpiresUtc!.Value.ToUnixTimeMilliseconds(),
                    IssuedAt = now.ToUnixTimeMilliseconds(),
                    SessionId = state.SessionId!,
                    Profiles = new[] { state.Profile }
                }
                : null,
            RequestSnapshot = active && state.SnapshotPending
        };
    }

    private static void ClearSession(ClientState state, bool clearFinalReportGrace)
    {
        state.SessionId = null;
        state.SessionStartedUtc = null;
        state.SessionExpiresUtc = null;
        state.SnapshotPending = false;
        state.ClientDiagnosticsActive = false;
        if (clearFinalReportGrace)
        {
            state.FinalReportSessionId = null;
            state.FinalReportAcceptUntilUtc = null;
        }
    }

    private static void ExpireSession(ClientState state, DateTimeOffset now)
    {
        if (state.SessionExpiresUtc is not null && state.SessionExpiresUtc <= now)
        {
            state.FinalReportSessionId = state.SessionId;
            state.FinalReportAcceptUntilUtc = state.SessionExpiresUtc.Value.Add(FinalReportGrace);
            ClearSession(state, clearFinalReportGrace: false);
        }
    }

    private void EnsureCapacity()
    {
        if (_clients.Count < MaximumClients)
        {
            return;
        }

        var oldest = _clients.Values
            .Where(state => state.SessionExpiresUtc is null)
            .OrderBy(state => state.LastSeenUtc)
            .FirstOrDefault() ?? _clients.Values.OrderBy(state => state.LastSeenUtc).First();
        _clients.Remove(oldest.ClientId);
    }

    private void Prune(DateTimeOffset now)
    {
        foreach (var state in _clients.Values)
        {
            ExpireSession(state, now);
            if (state.ReportedAtUtc is not null && now - state.ReportedAtUtc.Value > ReportRetention)
            {
                state.Report = null;
                state.ReportedAtUtc = null;
                state.ReportGeneratedAt = null;
            }

            if (state.FinalReportAcceptUntilUtc is not null && state.FinalReportAcceptUntilUtc <= now)
            {
                state.FinalReportSessionId = null;
                state.FinalReportAcceptUntilUtc = null;
            }
        }

        var expiredIds = _clients.Values
            .Where(state => state.SessionExpiresUtc is null && now - state.LastSeenUtc > ClientRetention)
            .Select(state => state.ClientId)
            .ToArray();
        foreach (var expiredId in expiredIds)
        {
            _clients.Remove(expiredId);
        }
    }

    private static PtvRemoteDiagnosticsClientSummary ToSummary(ClientState state, DateTimeOffset now)
    {
        var active = state.SessionExpiresUtc is not null && state.SessionExpiresUtc > now;
        return new PtvRemoteDiagnosticsClientSummary
        {
            ClientId = state.ClientId,
            Profile = state.Profile,
            Route = state.Route,
            LastSeenUtc = state.LastSeenUtc,
            Online = now - state.LastSeenUtc <= OnlineWindow,
            DiagnosticsActive = active && state.ClientDiagnosticsActive,
            LeasePending = active && !state.ClientDiagnosticsActive,
            SessionId = active ? state.SessionId : null,
            ExpiresAtUtc = active ? state.SessionExpiresUtc : null,
            HasReport = state.Report is not null,
            ReportedAtUtc = state.ReportedAtUtc,
            SnapshotPending = active && state.SnapshotPending,
            LastLeaseRejection = state.LastLeaseRejection
        };
    }

    private static string? NormalizeIdentifier(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = value.Trim();
        if (normalized.Length is < 8 or > 96 || normalized.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not '-' and not '_'))
        {
            return null;
        }

        return normalized;
    }

    private static string NormalizeLabel(string? value, string fallback, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return fallback;
        }

        var normalized = new string(value.Trim()
            .Where(character => !char.IsControl(character))
            .Take(maximumLength)
            .ToArray());
        return normalized.Length == 0 ? fallback : normalized;
    }

    private static string NormalizeRoute(string? route)
    {
        var normalized = NormalizeLabel(route, "unknown", 96);
        var queryIndex = normalized.IndexOfAny(['?', '#']);
        if (queryIndex >= 0)
        {
            normalized = normalized[..queryIndex];
        }

        return normalized.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || normalized.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
                ? "external"
                : normalized;
    }

    private static string? NormalizeLeaseRejection(string? value)
    {
        var normalized = NormalizeLabel(value, string.Empty, 32);
        return normalized.Length == 0 ? null : normalized;
    }

    private static bool TryGetReportMetadata(JsonElement report, out string sessionId, out long generatedAt)
    {
        sessionId = string.Empty;
        generatedAt = 0;
        if (report.ValueKind != JsonValueKind.Object
            || !report.TryGetProperty("generatedAt", out var generatedAtElement)
            || generatedAtElement.ValueKind != JsonValueKind.Number
            || !generatedAtElement.TryGetInt64(out generatedAt)
            || generatedAt <= 0
            || !report.TryGetProperty("session", out var session)
            || session.ValueKind != JsonValueKind.Object
            || !session.TryGetProperty("sessionId", out var sessionIdElement)
            || sessionIdElement.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        sessionId = sessionIdElement.GetString() ?? string.Empty;
        return sessionId.Length > 0;
    }

    private sealed class ClientState(string clientId, string ownerKey)
    {
        public string ClientId { get; } = clientId;

        public string OwnerKey { get; } = ownerKey;

        public string Profile { get; set; } = "unknown";

        public string Route { get; set; } = "unknown";

        public DateTimeOffset LastSeenUtc { get; set; }

        public string? SessionId { get; set; }

        public DateTimeOffset? SessionStartedUtc { get; set; }

        public DateTimeOffset? SessionExpiresUtc { get; set; }

        public bool SnapshotPending { get; set; }

        public bool ClientDiagnosticsActive { get; set; }

        public string? LastLeaseRejection { get; set; }

        public string? FinalReportSessionId { get; set; }

        public DateTimeOffset? FinalReportAcceptUntilUtc { get; set; }

        public JsonElement? Report { get; set; }

        public long? ReportGeneratedAt { get; set; }

        public DateTimeOffset? ReportedAtUtc { get; set; }
    }
}
