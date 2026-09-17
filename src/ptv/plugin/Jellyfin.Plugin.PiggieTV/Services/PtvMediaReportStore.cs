using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Bounded server-local storage for authenticated media issue reports.</summary>
public interface IPtvMediaReportStore
{
    /// <summary>Durably accepts one normalized report or returns a bounded failure.</summary>
    Task<PtvMediaReportSubmissionResult> SubmitAsync(
        string ownerKey,
        PtvMediaReportRecord report,
        CancellationToken cancellationToken = default);

    /// <summary>Reads the newest retained reports after applying automatic retention cleanup.</summary>
    Task<IReadOnlyList<PtvMediaReportRecord>> GetReportsAsync(
        int limit,
        CancellationToken cancellationToken = default);

    /// <summary>Deletes one retained report by its opaque server identifier.</summary>
    Task<bool> DeleteAsync(string reportId, CancellationToken cancellationToken = default);
}

/// <summary>Atomic JSON media-report repository with bounded count, age, and submit rate.</summary>
public sealed class PtvMediaReportStore : IPtvMediaReportStore
{
    internal const int DefaultMaximumReports = 500;
    internal const int MaximumStorageBytes = 4 * 1024 * 1024;
    internal const int MaximumReadLimit = 500;
    internal static readonly TimeSpan DefaultRetention = TimeSpan.FromDays(30);
    internal static readonly TimeSpan DefaultRateWindow = TimeSpan.FromMinutes(10);
    internal const int DefaultSubmissionsPerWindow = 5;

    private const int MaximumRateBuckets = 1024;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    private readonly string _filePath;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ILogger<PtvMediaReportStore> _logger;
    private readonly int _maximumReports;
    private readonly Dictionary<string, List<DateTimeOffset>> _rateBuckets = new(StringComparer.Ordinal);
    private readonly TimeSpan _rateWindow;
    private readonly TimeSpan _retention;
    private readonly int _submissionsPerWindow;
    private readonly Func<DateTimeOffset> _utcNow;
    private List<PtvMediaReportRecord> _reports;
    private bool _requiresRewrite;
    private bool _storageAvailable = true;

    /// <summary>Initializes production storage below Jellyfin's PluginConfigurations path.</summary>
    public PtvMediaReportStore(IApplicationPaths applicationPaths, ILogger<PtvMediaReportStore> logger)
        : this(
            Path.Combine(applicationPaths.PluginConfigurationsPath, "PiggieTV", "media-reports.json"),
            logger,
            () => DateTimeOffset.UtcNow)
    {
    }

    /// <summary>Initializes deterministic storage for tests.</summary>
    internal PtvMediaReportStore(
        string filePath,
        ILogger<PtvMediaReportStore> logger,
        Func<DateTimeOffset> utcNow,
        int maximumReports = DefaultMaximumReports,
        TimeSpan? retention = null,
        int submissionsPerWindow = DefaultSubmissionsPerWindow,
        TimeSpan? rateWindow = null)
    {
        _filePath = filePath ?? throw new ArgumentNullException(nameof(filePath));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _utcNow = utcNow ?? throw new ArgumentNullException(nameof(utcNow));
        _maximumReports = Math.Clamp(maximumReports, 1, DefaultMaximumReports);
        _retention = retention ?? DefaultRetention;
        _submissionsPerWindow = Math.Clamp(submissionsPerWindow, 1, 100);
        _rateWindow = rateWindow ?? DefaultRateWindow;
        _reports = Load();
    }

    /// <inheritdoc />
    public async Task<PtvMediaReportSubmissionResult> SubmitAsync(
        string ownerKey,
        PtvMediaReportRecord report,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(ownerKey);
        ArgumentNullException.ThrowIfNull(report);

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (!_storageAvailable)
            {
                return new PtvMediaReportSubmissionResult { Status = PtvMediaReportSubmissionStatus.Unavailable };
            }

            var now = _utcNow();
            var retained = RetainCurrent(_reports, now);
            var retryAfter = GetRetryAfterSeconds(ownerKey, now);
            if (retryAfter > 0)
            {
                if (_requiresRewrite || retained.Count != _reports.Count)
                {
                    await PersistAsync(retained, cancellationToken).ConfigureAwait(false);
                    _reports = retained;
                    _requiresRewrite = false;
                }

                return new PtvMediaReportSubmissionResult
                {
                    RetryAfterSeconds = retryAfter,
                    Status = PtvMediaReportSubmissionStatus.RateLimited
                };
            }

            var accepted = Clone(report);
            accepted.ReportId = Guid.NewGuid().ToString("N");
            accepted.ReceivedAtUtc = now;
            accepted.SchemaVersion = 1;

            retained.Add(accepted);
            retained = retained
                .OrderBy(candidate => candidate.ReceivedAtUtc)
                .ThenBy(candidate => candidate.ReportId, StringComparer.Ordinal)
                .TakeLast(_maximumReports)
                .ToList();

            try
            {
                await PersistAsync(retained, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
            {
                _logger.LogWarning(ex, "PiggieTV media-report persistence failed; the report was not accepted.");
                return new PtvMediaReportSubmissionResult { Status = PtvMediaReportSubmissionStatus.Unavailable };
            }

            _reports = retained;
            _requiresRewrite = false;
            RecordAcceptedSubmission(ownerKey, now);
            return new PtvMediaReportSubmissionResult
            {
                Record = Clone(accepted),
                Status = PtvMediaReportSubmissionStatus.Accepted
            };
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<PtvMediaReportRecord>> GetReportsAsync(
        int limit,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            EnsureStorageAvailable();
            var retained = RetainCurrent(_reports, _utcNow());
            if (_requiresRewrite || retained.Count != _reports.Count)
            {
                await PersistAsync(retained, cancellationToken).ConfigureAwait(false);
                _reports = retained;
                _requiresRewrite = false;
            }

            return retained
                .OrderByDescending(report => report.ReceivedAtUtc)
                .ThenBy(report => report.ReportId, StringComparer.Ordinal)
                .Take(Math.Clamp(limit, 1, MaximumReadLimit))
                .Select(Clone)
                .ToArray();
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<bool> DeleteAsync(string reportId, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            EnsureStorageAvailable();
            var now = _utcNow();
            var retained = RetainCurrent(_reports, now);
            var removed = retained.RemoveAll(report => string.Equals(report.ReportId, reportId, StringComparison.Ordinal)) > 0;
            if (_requiresRewrite || removed || retained.Count != _reports.Count)
            {
                await PersistAsync(retained, cancellationToken).ConfigureAwait(false);
                _reports = retained;
                _requiresRewrite = false;
            }

            return removed;
        }
        finally
        {
            _gate.Release();
        }
    }

    private List<PtvMediaReportRecord> Load()
    {
        try
        {
            var temporaryPath = _filePath + ".tmp";
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }

            if (!File.Exists(_filePath))
            {
                return [];
            }

            if (new FileInfo(_filePath).Length > MaximumStorageBytes)
            {
                throw new JsonException("Media-report storage exceeds the supported size bound.");
            }

            var document = JsonSerializer.Deserialize<PtvMediaReportDocument>(File.ReadAllText(_filePath), JsonOptions);
            if (document?.SchemaVersion != 1 || document.Reports is null)
            {
                throw new JsonException("Unsupported media-report storage document.");
            }

            if (document.Reports.Any(report => report is null || !IsStoredRecordValid(report)))
            {
                throw new JsonException("Media-report storage contains an invalid record.");
            }

            var retained = RetainCurrent(document.Reports, _utcNow());
            _requiresRewrite = retained.Count != document.Reports.Count;
            return retained;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            _storageAvailable = false;
            _logger.LogWarning(ex, "PiggieTV media-report storage could not be loaded. Existing data was left untouched.");
            return [];
        }
    }

    private async Task PersistAsync(List<PtvMediaReportRecord> reports, CancellationToken cancellationToken)
    {
        var directory = Path.GetDirectoryName(_filePath)
            ?? throw new IOException("Media-report storage path has no parent directory.");
        Directory.CreateDirectory(directory);
        var temporaryPath = _filePath + ".tmp";
        var payload = JsonSerializer.Serialize(new PtvMediaReportDocument { Reports = reports }, JsonOptions);
        try
        {
            await File.WriteAllTextAsync(temporaryPath, payload, new UTF8Encoding(false), cancellationToken).ConfigureAwait(false);
            File.Move(temporaryPath, _filePath, true);
        }
        catch
        {
            try
            {
                if (File.Exists(temporaryPath))
                {
                    File.Delete(temporaryPath);
                }
            }
            catch (Exception cleanupError) when (cleanupError is IOException or UnauthorizedAccessException)
            {
                _logger.LogDebug(cleanupError, "PiggieTV media-report temporary-file cleanup failed.");
            }

            throw;
        }
    }

    private List<PtvMediaReportRecord> RetainCurrent(IEnumerable<PtvMediaReportRecord> reports, DateTimeOffset now)
    {
        var cutoff = now - _retention;
        return reports
            .Where(report => report.ReceivedAtUtc >= cutoff && report.ReceivedAtUtc <= now.AddMinutes(5))
            .Where(IsStoredRecordValid)
            .OrderBy(report => report.ReceivedAtUtc)
            .ThenBy(report => report.ReportId, StringComparer.Ordinal)
            .TakeLast(_maximumReports)
            .Select(Clone)
            .ToList();
    }

    private int GetRetryAfterSeconds(string ownerKey, DateTimeOffset now)
    {
        PruneRateBuckets(now);
        if (!_rateBuckets.TryGetValue(ownerKey, out var submissions) || submissions.Count < _submissionsPerWindow)
        {
            return 0;
        }

        var availableAt = submissions[0] + _rateWindow;
        return Math.Max(1, (int)Math.Ceiling((availableAt - now).TotalSeconds));
    }

    private void RecordAcceptedSubmission(string ownerKey, DateTimeOffset now)
    {
        if (!_rateBuckets.TryGetValue(ownerKey, out var submissions))
        {
            if (_rateBuckets.Count >= MaximumRateBuckets)
            {
                var oldestKey = _rateBuckets
                    .OrderBy(pair => pair.Value.LastOrDefault())
                    .Select(pair => pair.Key)
                    .FirstOrDefault();
                if (oldestKey is not null)
                {
                    _rateBuckets.Remove(oldestKey);
                }
            }

            submissions = [];
            _rateBuckets[ownerKey] = submissions;
        }

        submissions.Add(now);
    }

    private void PruneRateBuckets(DateTimeOffset now)
    {
        var cutoff = now - _rateWindow;
        foreach (var pair in _rateBuckets)
        {
            pair.Value.RemoveAll(timestamp => timestamp <= cutoff);
        }

        foreach (var emptyKey in _rateBuckets.Where(pair => pair.Value.Count == 0).Select(pair => pair.Key).ToArray())
        {
            _rateBuckets.Remove(emptyKey);
        }
    }

    private void EnsureStorageAvailable()
    {
        if (!_storageAvailable)
        {
            throw new IOException("PiggieTV media-report storage is unavailable.");
        }
    }

    private static bool IsStoredRecordValid(PtvMediaReportRecord report) =>
        report.SchemaVersion == 1
        && Guid.TryParseExact(report.ReportId, "N", out _)
        && Guid.TryParseExact(report.ItemId, "N", out _)
        && report.ReceivedAtUtc > DateTimeOffset.MinValue
        && PtvMediaReportValidator.IsNormalizedRecord(report);

    private static PtvMediaReportRecord Clone(PtvMediaReportRecord source) => new()
    {
        Details = source.Details,
        ItemId = source.ItemId,
        ItemType = source.ItemType,
        MediaSourceId = source.MediaSourceId,
        PlaybackPositionMs = source.PlaybackPositionMs,
        PlayMethod = source.PlayMethod,
        Reason = source.Reason,
        ReceivedAtUtc = source.ReceivedAtUtc,
        ReportId = source.ReportId,
        SchemaVersion = source.SchemaVersion,
        Source = source.Source
    };

    private sealed class PtvMediaReportDocument
    {
        [JsonPropertyName("schemaVersion")]
        public int SchemaVersion { get; set; } = 1;

        [JsonPropertyName("reports")]
        public List<PtvMediaReportRecord> Reports { get; set; } = [];
    }
}
