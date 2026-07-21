using System.Collections.Concurrent;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Single-consumer, bounded JSONL diagnostics writer with rolling retention.</summary>
public sealed class PtvRollingDiagnosticsWriter : IPtvRollingDiagnosticsWriter, IHostedService, IAsyncDisposable
{
    private const string ActiveFileName = "ptv-diagnostics.log";
    private const int DefaultQueueCapacity = 2048;
    private const int PriorityOverflowCapacity = 128;
    private static readonly TimeSpan DuplicateWindow = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan CheckInSummaryWindow = TimeSpan.FromMinutes(5);
    private static readonly Regex RotatedFilePattern = new("^ptv-diagnostics\\.(?<index>[1-9][0-9]*)\\.log$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex LegacyFilePattern = new("^(?:piggie-tv-diagnostics-[a-z0-9_-]{1,96}-[0-9]{8}-[0-9]{6}|ptv-diagnostics-(?:event|request|session)-[a-f0-9-]{8,96})\\.(?:json|log)$", RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private readonly Channel<PtvRollingDiagnosticEvent> _channel;
    private readonly CancellationTokenSource _shutdown = new();
    private readonly object _aggregationGate = new();
    private readonly Dictionary<string, Aggregation> _aggregations = new(StringComparer.Ordinal);
    private readonly Dictionary<string, DateTimeOffset> _duplicateSignatures = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _fileGate = new(1, 1);
    private readonly ILogger<PtvRollingDiagnosticsWriter> _logger;
    private readonly ConcurrentQueue<PtvRollingDiagnosticEvent> _priorityOverflow = new();
    private readonly object _priorityGate = new();
    private readonly Func<PtvDiagnosticsStorageSettings> _settingsProvider;
    private readonly string _directory;
    private readonly string _activePath;
    private Task? _consumerTask;
    private FileStream? _stream;
    private StreamWriter? _writer;
    private int _priorityOverflowCount;
    private int _pendingFlushCount;
    private long _duplicatesSuppressed;
    private long _eventsAggregated;
    private long _eventsDropped;
    private long _eventsQueued;
    private long _eventsReceived;
    private long _eventsWritten;
    private DateTimeOffset? _lastRotationUtc;
    private long _rotationsCompleted;
    private long _writeFailures;

    /// <summary>Initializes the production writer in the plugin configuration directory.</summary>
    public PtvRollingDiagnosticsWriter(IApplicationPaths applicationPaths, ILogger<PtvRollingDiagnosticsWriter> logger)
        : this(
            Path.Combine(applicationPaths.PluginConfigurationsPath, "PiggieTV", "diagnostics"),
            () => NormalizeSettings(Plugin.Instance?.Configuration.DiagnosticsStorageSettings),
            logger)
    {
    }

    /// <summary>Initializes a writer for a supplied directory and settings provider.</summary>
    public PtvRollingDiagnosticsWriter(
        string directory,
        Func<PtvDiagnosticsStorageSettings> settingsProvider,
        ILogger<PtvRollingDiagnosticsWriter> logger,
        int queueCapacity = DefaultQueueCapacity)
    {
        _directory = directory ?? throw new ArgumentNullException(nameof(directory));
        _activePath = Path.Combine(_directory, ActiveFileName);
        _settingsProvider = settingsProvider ?? throw new ArgumentNullException(nameof(settingsProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _channel = Channel.CreateBounded<PtvRollingDiagnosticEvent>(new BoundedChannelOptions(Math.Max(1, queueCapacity))
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = false
        });

        try
        {
            Directory.CreateDirectory(_directory);
            CleanupFiles(NormalizeSettings(_settingsProvider()));
        }
        catch (Exception ex)
        {
            Interlocked.Increment(ref _writeFailures);
            _logger.LogWarning(ex, "PiggieTV diagnostics storage startup cleanup failed. Persistent writes will retry later.");
        }
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        EnsureConsumer();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _channel.Writer.TryComplete();
        if (_consumerTask is not null) await _consumerTask.WaitAsync(cancellationToken).ConfigureAwait(false);
        await FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public void Enqueue(PtvRollingDiagnosticEvent diagnosticEvent)
    {
        ArgumentNullException.ThrowIfNull(diagnosticEvent);
        Interlocked.Increment(ref _eventsReceived);
        var settings = NormalizeSettings(_settingsProvider());
        if (!settings.FileLoggingEnabled || IsBelowMinimumLevel(diagnosticEvent.Level, settings.MinimumPersistentLogLevel))
        {
            Interlocked.Increment(ref _eventsDropped);
            return;
        }

        if (ShouldAggregate(diagnosticEvent, settings))
        {
            Aggregate(diagnosticEvent);
            return;
        }

        if (IsDuplicate(diagnosticEvent))
        {
            Interlocked.Increment(ref _duplicatesSuppressed);
            return;
        }

        EnsureConsumer();
        if (_channel.Writer.TryWrite(diagnosticEvent))
        {
            Interlocked.Increment(ref _eventsQueued);
            return;
        }

        if (IsWarningOrHigher(diagnosticEvent.Level) && TryQueuePriorityOverflow(diagnosticEvent)) return;
        Interlocked.Increment(ref _eventsDropped);
    }

    /// <inheritdoc />
    public PtvDiagnosticsStorageStatus GetStatus()
    {
        var settings = NormalizeSettings(_settingsProvider());
        var retainedFiles = GetRetainedFiles(settings).ToArray();
        var legacyFiles = GetLegacyFiles().ToArray();

        return new PtvDiagnosticsStorageStatus
        {
            ActiveFileSizeBytes = TryGetFileSize(_activePath),
            ActiveLogPath = _activePath,
            DuplicateEventsSuppressed = Interlocked.Read(ref _duplicatesSuppressed),
            EventsAggregated = Interlocked.Read(ref _eventsAggregated),
            EventsDropped = Interlocked.Read(ref _eventsDropped),
            EventsQueued = Interlocked.Read(ref _eventsQueued),
            EventsWritten = Interlocked.Read(ref _eventsWritten),
            LastRotationUtc = _lastRotationUtc,
            LegacyFileCount = legacyFiles.Length,
            LegacyFileSizeBytes = legacyFiles.Sum(file => file.Length),
            MaximumFileSizeMb = settings.MaximumFileSizeMb,
            MaximumRotatedFiles = settings.MaximumRotatedFiles,
            OldestRetainedAtUtc = retainedFiles.Select(file => (DateTimeOffset?)file.LastWriteTimeUtc).OrderBy(value => value).FirstOrDefault(),
            RetentionDays = settings.RetentionDays,
            RotatedFileCount = retainedFiles.Count(file => !string.Equals(file.Name, ActiveFileName, StringComparison.OrdinalIgnoreCase)),
            RotationsCompleted = Interlocked.Read(ref _rotationsCompleted),
            TotalRetainedBytes = retainedFiles.Sum(file => file.Length),
            WriteFailures = Interlocked.Read(ref _writeFailures)
        };
    }

    /// <inheritdoc />
    public async Task FlushAsync(CancellationToken cancellationToken = default)
    {
        EnsureConsumer();
        while (Interlocked.Read(ref _eventsQueued) > 0 || Volatile.Read(ref _priorityOverflowCount) > 0)
        {
            await Task.Delay(10, cancellationToken).ConfigureAwait(false);
        }
        await FlushAggregationsAsync(cancellationToken).ConfigureAwait(false);
        await _fileGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_writer is not null)
            {
                await _writer.FlushAsync(cancellationToken).ConfigureAwait(false);
                _pendingFlushCount = 0;
            }
        }
        finally
        {
            _fileGate.Release();
        }
    }

    /// <inheritdoc />
    public async Task RotateAsync(CancellationToken cancellationToken = default)
    {
        await FlushAsync(cancellationToken).ConfigureAwait(false);
        await _fileGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await RotateLockedAsync(NormalizeSettings(_settingsProvider()), cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _fileGate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<PtvDiagnosticsStorageActionResult> ClearAsync(CancellationToken cancellationToken = default)
    {
        await FlushAsync(cancellationToken).ConfigureAwait(false);
        await _fileGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var files = GetRetainedFiles(NormalizeSettings(_settingsProvider())).ToArray();
            var bytes = files.Sum(file => file.Length);
            await CloseWriterLockedAsync().ConfigureAwait(false);
            foreach (var file in files) file.Delete();
            return new PtvDiagnosticsStorageActionResult { FileCount = files.Length, Message = "Rolling diagnostics logs cleared.", ReclaimedBytes = bytes };
        }
        finally
        {
            _fileGate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<PtvDiagnosticsStorageActionResult> ConsolidateLegacyAsync(bool createArchive, CancellationToken cancellationToken = default)
    {
        await _fileGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var files = GetLegacyFiles().ToArray();
            var bytes = files.Sum(file => file.Length);
            string? archiveName = null;
            if (files.Length > 0 && createArchive)
            {
                var temporaryPath = Path.Combine(_directory, ".ptv-diagnostics-legacy.tmp");
                var archivePath = Path.Combine(_directory, "ptv-diagnostics-legacy.zip");
                if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
                using (var archive = ZipFile.Open(temporaryPath, ZipArchiveMode.Create))
                {
                    foreach (var file in files) archive.CreateEntryFromFile(file.FullName, file.Name, CompressionLevel.Optimal);
                }
                File.Move(temporaryPath, archivePath, true);
                archiveName = Path.GetFileName(archivePath);
            }

            foreach (var file in files) file.Delete();
            return new PtvDiagnosticsStorageActionResult
            {
                ArchiveFileName = archiveName,
                FileCount = files.Length,
                Message = files.Length == 0 ? "No recognized legacy diagnostics files were found." : "Recognized legacy diagnostics files were consolidated safely.",
                ReclaimedBytes = bytes
            };
        }
        finally
        {
            _fileGate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<byte[]> ReadActiveLogAsync(CancellationToken cancellationToken = default)
    {
        await FlushAsync(cancellationToken).ConfigureAwait(false);
        await _fileGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            // Windows does not reliably permit an independently opened read handle while
            // StreamWriter owns the active log. The single consumer reopens it on the
            // next persisted batch, so normal events still remain batched.
            await CloseWriterLockedAsync().ConfigureAwait(false);
            return File.Exists(_activePath) ? await File.ReadAllBytesAsync(_activePath, cancellationToken).ConfigureAwait(false) : [];
        }
        finally
        {
            _fileGate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<byte[]> CreateBundleAsync(CancellationToken cancellationToken = default)
    {
        await FlushAsync(cancellationToken).ConfigureAwait(false);
        await _fileGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            // See ReadActiveLogAsync: bundles must be available while diagnostics are live.
            await CloseWriterLockedAsync().ConfigureAwait(false);
            await using var output = new MemoryStream();
            using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
            {
                foreach (var file in GetRetainedFiles(NormalizeSettings(_settingsProvider())))
                {
                    var entry = archive.CreateEntry(file.Name, CompressionLevel.Optimal);
                    await using var destination = entry.Open();
                    await using var source = file.OpenRead();
                    await source.CopyToAsync(destination, cancellationToken).ConfigureAwait(false);
                }

                var manifest = archive.CreateEntry("manifest.json", CompressionLevel.Optimal);
                await using var manifestStream = manifest.Open();
                await JsonSerializer.SerializeAsync(manifestStream, new
                {
                    createdAtUtc = DateTimeOffset.UtcNow,
                    diagnostics = GetStatus(),
                    pluginVersion = typeof(PtvRollingDiagnosticsWriter).Assembly.GetName().Version?.ToString() ?? "unknown",
                    schemaVersion = 1
                }, cancellationToken: cancellationToken).ConfigureAwait(false);
            }

            return output.ToArray();
        }
        finally
        {
            _fileGate.Release();
        }
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        _channel.Writer.TryComplete();
        if (_consumerTask is not null) await _consumerTask.ConfigureAwait(false);
        await _fileGate.WaitAsync().ConfigureAwait(false);
        try { await CloseWriterLockedAsync().ConfigureAwait(false); }
        finally { _fileGate.Release(); _shutdown.Cancel(); _shutdown.Dispose(); _fileGate.Dispose(); }
    }

    private void EnsureConsumer()
    {
        _consumerTask ??= Task.Run(ConsumeAsync);
    }

    private async Task ConsumeAsync()
    {
        try
        {
            while (!_shutdown.IsCancellationRequested)
            {
                while (_priorityOverflow.TryDequeue(out var priority))
                {
                    Interlocked.Decrement(ref _priorityOverflowCount);
                    await PersistAsync(priority, _shutdown.Token).ConfigureAwait(false);
                }
                while (_channel.Reader.TryRead(out var next))
                {
                    Interlocked.Decrement(ref _eventsQueued);
                    await PersistAsync(next, _shutdown.Token).ConfigureAwait(false);
                }
                await FlushDueAsync(_shutdown.Token).ConfigureAwait(false);
                if (_channel.Reader.Completion.IsCompleted && _priorityOverflow.IsEmpty) break;
                await Task.Delay(TimeSpan.FromMilliseconds(250), _shutdown.Token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
            // Plugin shutdown owns the final best-effort flush.
        }
        catch (Exception ex)
        {
            Interlocked.Increment(ref _writeFailures);
            _logger.LogWarning(ex, "PiggieTV diagnostics background writer stopped unexpectedly.");
        }
    }

    private async Task PersistAsync(PtvRollingDiagnosticEvent diagnosticEvent, CancellationToken cancellationToken)
    {
        try
        {
            var settings = NormalizeSettings(_settingsProvider());
            if (!settings.FileLoggingEnabled) return;
            var rawDetail = JsonSerializer.SerializeToElement(diagnosticEvent.Detail ?? new { });
            var safeDetail = PtvDiagnosticsSanitizer.Sanitize(rawDetail, settings);
            var record = JsonSerializer.Serialize(new
            {
                timestamp = diagnosticEvent.TimestampUtc.UtcDateTime.ToString("O"),
                level = NormalizeLevel(diagnosticEvent.Level),
                category = Trim(diagnosticEvent.Category, 64, "plugin"),
                @event = Trim(diagnosticEvent.EventName, 120, "ptv-event"),
                clientId = settings.IncludeItemIds ? Trim(diagnosticEvent.ClientId, 96, string.Empty) : "[redacted]",
                detail = safeDetail
            }) + Environment.NewLine;
            var bytes = Encoding.UTF8.GetByteCount(record);

            await _fileGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (TryGetFileSize(_activePath) + bytes > settings.MaximumFileSizeMb * 1024L * 1024L) await RotateLockedAsync(settings, cancellationToken).ConfigureAwait(false);
                await EnsureWriterLockedAsync(cancellationToken).ConfigureAwait(false);
                await _writer!.WriteAsync(record.AsMemory(), cancellationToken).ConfigureAwait(false);
                _pendingFlushCount += 1;
                Interlocked.Increment(ref _eventsWritten);
            }
            finally
            {
                _fileGate.Release();
            }
        }
        catch (Exception ex)
        {
            Interlocked.Increment(ref _writeFailures);
            _logger.LogWarning(ex, "PiggieTV diagnostics persistent write failed; continuing with bounded in-memory diagnostics.");
        }
    }

    private async Task EnsureWriterLockedAsync(CancellationToken cancellationToken)
    {
        if (_writer is not null) return;
        Directory.CreateDirectory(_directory);
        _stream = new FileStream(_activePath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite, 81920, FileOptions.Asynchronous);
        _writer = new StreamWriter(_stream, new UTF8Encoding(false), 81920, leaveOpen: true);
        await Task.CompletedTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
    }

    private async Task RotateLockedAsync(PtvDiagnosticsStorageSettings settings, CancellationToken cancellationToken)
    {
        await CloseWriterLockedAsync().ConfigureAwait(false);
        Directory.CreateDirectory(_directory);
        if (!File.Exists(_activePath))
        {
            CleanupFiles(settings);
            return;
        }
        for (var index = settings.MaximumRotatedFiles; index >= 1; index -= 1)
        {
            var source = index == 1 ? _activePath : Path.Combine(_directory, $"ptv-diagnostics.{index - 1}.log");
            var destination = Path.Combine(_directory, $"ptv-diagnostics.{index}.log");
            if (!File.Exists(source)) continue;
            if (File.Exists(destination)) File.Delete(destination);
            File.Move(source, destination);
        }
        CleanupFiles(settings);
        _lastRotationUtc = DateTimeOffset.UtcNow;
        Interlocked.Increment(ref _rotationsCompleted);
        cancellationToken.ThrowIfCancellationRequested();
    }

    private async Task CloseWriterLockedAsync()
    {
        if (_writer is not null) await _writer.FlushAsync().ConfigureAwait(false);
        if (_writer is not null) await _writer.DisposeAsync().ConfigureAwait(false);
        if (_stream is not null) await _stream.DisposeAsync().ConfigureAwait(false);
        _writer = null;
        _stream = null;
        _pendingFlushCount = 0;
    }

    private async Task FlushDueAsync(CancellationToken cancellationToken)
    {
        await FlushMatureAggregationsAsync(cancellationToken).ConfigureAwait(false);
        if (_pendingFlushCount < 32) return;
        await _fileGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_writer is not null) await _writer.FlushAsync(cancellationToken).ConfigureAwait(false);
            _pendingFlushCount = 0;
        }
        finally { _fileGate.Release(); }
    }

    private bool TryQueuePriorityOverflow(PtvRollingDiagnosticEvent diagnosticEvent)
    {
        lock (_priorityGate)
        {
            if (_priorityOverflowCount >= PriorityOverflowCapacity) return false;
            _priorityOverflow.Enqueue(diagnosticEvent);
            _priorityOverflowCount += 1;
            return true;
        }
    }

    private bool IsDuplicate(PtvRollingDiagnosticEvent diagnosticEvent)
    {
        var now = DateTimeOffset.UtcNow;
        var signature = $"{NormalizeLevel(diagnosticEvent.Level)}|{diagnosticEvent.Category}|{diagnosticEvent.EventName}|{diagnosticEvent.ClientId}";
        lock (_aggregationGate)
        {
            var isDuplicate = _duplicateSignatures.TryGetValue(signature, out var previous) && now - previous < DuplicateWindow;
            _duplicateSignatures[signature] = now;
            if (_duplicateSignatures.Count > 512) foreach (var stale in _duplicateSignatures.Where(pair => now - pair.Value > DuplicateWindow).Select(pair => pair.Key).ToArray()) _duplicateSignatures.Remove(stale);
            return isDuplicate;
        }
    }

    private static bool ShouldAggregate(PtvRollingDiagnosticEvent diagnosticEvent, PtvDiagnosticsStorageSettings settings)
    {
        if (diagnosticEvent.EventName.Contains("check-in", StringComparison.OrdinalIgnoreCase)) return settings.IncludeClientCheckIns;
        var noisy = diagnosticEvent.EventName.Contains("image", StringComparison.OrdinalIgnoreCase)
            || diagnosticEvent.EventName.Contains("render", StringComparison.OrdinalIgnoreCase)
            || diagnosticEvent.EventName.Contains("performance", StringComparison.OrdinalIgnoreCase)
            || diagnosticEvent.EventName.Contains("playback-progress", StringComparison.OrdinalIgnoreCase)
            || diagnosticEvent.EventName.Contains("cache-poll", StringComparison.OrdinalIgnoreCase);
        return noisy && !settings.IncludePerformanceSamples && !IsWarningOrHigher(diagnosticEvent.Level);
    }

    private void Aggregate(PtvRollingDiagnosticEvent diagnosticEvent)
    {
        var key = $"{diagnosticEvent.Category}|{diagnosticEvent.EventName}|{diagnosticEvent.ClientId}";
        lock (_aggregationGate)
        {
            if (!_aggregations.TryGetValue(key, out var aggregate))
            {
                aggregate = new Aggregation(diagnosticEvent, DateTimeOffset.UtcNow);
                _aggregations[key] = aggregate;
            }
            aggregate.Count += 1;
            aggregate.LastSeenUtc = DateTimeOffset.UtcNow;
        }
        Interlocked.Increment(ref _eventsAggregated);
    }

    private async Task FlushAggregationsAsync(CancellationToken cancellationToken)
    {
        List<PtvRollingDiagnosticEvent> summaries;
        lock (_aggregationGate)
        {
            var now = DateTimeOffset.UtcNow;
            summaries = _aggregations.Values.Where(item => now - item.StartedAtUtc >= CheckInSummaryWindow || item.Count > 0).Select(item => item.ToSummary()).ToList();
            _aggregations.Clear();
        }
        foreach (var summary in summaries) await PersistAsync(summary, cancellationToken).ConfigureAwait(false);
    }

    private async Task FlushMatureAggregationsAsync(CancellationToken cancellationToken)
    {
        List<PtvRollingDiagnosticEvent> summaries;
        lock (_aggregationGate)
        {
            var now = DateTimeOffset.UtcNow;
            summaries = _aggregations.Where(pair => now - pair.Value.StartedAtUtc >= CheckInSummaryWindow).Select(pair => pair.Value.ToSummary()).ToList();
            foreach (var key in _aggregations.Where(pair => now - pair.Value.StartedAtUtc >= CheckInSummaryWindow).Select(pair => pair.Key).ToArray()) _aggregations.Remove(key);
        }
        foreach (var summary in summaries) await PersistAsync(summary, cancellationToken).ConfigureAwait(false);
    }

    private IEnumerable<FileInfo> GetRetainedFiles(PtvDiagnosticsStorageSettings settings)
    {
        if (!Directory.Exists(_directory)) return [];
        return Directory.EnumerateFiles(_directory, "ptv-diagnostics*.log", SearchOption.TopDirectoryOnly)
            .Select(path => new FileInfo(path))
            .Where(file => string.Equals(file.Name, ActiveFileName, StringComparison.OrdinalIgnoreCase)
                || (RotatedFilePattern.Match(file.Name) is { Success: true } match && int.Parse(match.Groups["index"].Value) <= settings.MaximumRotatedFiles));
    }

    private IEnumerable<FileInfo> GetLegacyFiles()
    {
        if (!Directory.Exists(_directory)) return [];
        return Directory.EnumerateFiles(_directory, "*", SearchOption.TopDirectoryOnly)
            .Select(path => new FileInfo(path))
            .Where(file => LegacyFilePattern.IsMatch(file.Name));
    }

    private void CleanupFiles(PtvDiagnosticsStorageSettings settings)
    {
        if (!Directory.Exists(_directory)) return;
        var expiry = DateTimeOffset.UtcNow.AddDays(-settings.RetentionDays);
        foreach (var temporary in Directory.EnumerateFiles(_directory, ".ptv-diagnostics*.tmp", SearchOption.TopDirectoryOnly)) File.Delete(temporary);
        foreach (var file in Directory.EnumerateFiles(_directory, "ptv-diagnostics*.log", SearchOption.TopDirectoryOnly).Select(path => new FileInfo(path)))
        {
            var rotation = RotatedFilePattern.Match(file.Name);
            if ((rotation.Success && int.Parse(rotation.Groups["index"].Value) > settings.MaximumRotatedFiles) || file.LastWriteTimeUtc < expiry.UtcDateTime) file.Delete();
        }
        var maximumBytes = settings.MaximumFileSizeMb * 1024L * 1024L * (settings.MaximumRotatedFiles + 1L);
        var retained = GetRetainedFiles(settings).OrderBy(file => string.Equals(file.Name, ActiveFileName, StringComparison.OrdinalIgnoreCase)).ThenBy(file => file.LastWriteTimeUtc).ToList();
        var total = retained.Sum(file => file.Length);
        foreach (var file in retained.Where(file => !string.Equals(file.Name, ActiveFileName, StringComparison.OrdinalIgnoreCase)))
        {
            if (total <= maximumBytes) break;
            total -= file.Length;
            file.Delete();
        }
    }

    private static PtvDiagnosticsStorageSettings NormalizeSettings(PtvDiagnosticsStorageSettings? source)
    {
        var settings = source ?? new PtvDiagnosticsStorageSettings();
        settings.MaximumFileSizeMb = Math.Clamp(settings.MaximumFileSizeMb, 1, 50);
        settings.MaximumRotatedFiles = Math.Clamp(settings.MaximumRotatedFiles, 1, 5);
        settings.RetentionDays = Math.Clamp(settings.RetentionDays, 1, 30);
        settings.MinimumPersistentLogLevel = NormalizeLevel(settings.MinimumPersistentLogLevel);
        return settings;
    }

    private static bool IsBelowMinimumLevel(string level, string minimum) => GetLevelRank(level) < GetLevelRank(minimum);
    private static bool IsWarningOrHigher(string level) => GetLevelRank(level) >= GetLevelRank("warning");
    private static int GetLevelRank(string level) => NormalizeLevel(level) switch { "trace" => 0, "debug" => 1, "information" => 2, "warning" => 3, "error" => 4, "critical" => 5, _ => 2 };
    private static string NormalizeLevel(string? level) => level?.Trim().ToLowerInvariant() switch { "trace" => "trace", "debug" => "debug", "warn" or "warning" => "warning", "error" => "error", "critical" or "fatal" => "critical", _ => "information" };
    private static string Trim(string? value, int maximum, string fallback) => string.IsNullOrWhiteSpace(value) ? fallback : value.Trim()[..Math.Min(value.Trim().Length, maximum)];
    private static long TryGetFileSize(string path) { try { return File.Exists(path) ? new FileInfo(path).Length : 0; } catch { return 0; } }

    private sealed class Aggregation
    {
        public Aggregation(PtvRollingDiagnosticEvent source, DateTimeOffset startedAtUtc) { Source = source; StartedAtUtc = startedAtUtc; LastSeenUtc = startedAtUtc; }
        public int Count { get; set; }
        public DateTimeOffset LastSeenUtc { get; set; }
        public PtvRollingDiagnosticEvent Source { get; }
        public DateTimeOffset StartedAtUtc { get; }
        public PtvRollingDiagnosticEvent ToSummary() => new()
        {
            Category = Source.Category,
            ClientId = Source.ClientId,
            EventName = Source.EventName.Contains("check-in", StringComparison.OrdinalIgnoreCase) ? "client-checkin-summary" : $"{Source.EventName}-summary",
            Level = "information",
            TimestampUtc = LastSeenUtc,
            Detail = new { count = Count, lastSeen = LastSeenUtc, windowSeconds = Math.Max(1, (int)(LastSeenUtc - StartedAtUtc).TotalSeconds) }
        };
    }
}
