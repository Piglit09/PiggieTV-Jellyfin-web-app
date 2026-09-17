using System.Diagnostics;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Atomic JSON Metadata Quality store with fail-closed corrupt-file quarantine.</summary>
public sealed class PtvMetadataQualityStore : IPtvMetadataQualityStore, IPtvMetadataQualityDiagnosticStore
{
    private const string ResultsFileName = "metadata-quality.json";
    private const string SettingsFileName = "settings.json";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _directory;
    private readonly string _resultsPath;
    private readonly string _settingsPath;
    private readonly ILogger<PtvMetadataQualityStore> _logger;
    private string? _errorCode;

    public PtvMetadataQualityStore(IApplicationPaths applicationPaths, ILogger<PtvMetadataQualityStore> logger)
        : this(Path.Combine(applicationPaths.PluginConfigurationsPath, "PiggieTV", "metadata-quality"), logger)
    {
    }

    internal PtvMetadataQualityStore(string directory, ILogger<PtvMetadataQualityStore> logger)
    {
        _logger = logger;
        _directory = Path.GetFullPath(directory);
        Directory.CreateDirectory(_directory);
        _resultsPath = Path.Combine(_directory, ResultsFileName);
        _settingsPath = Path.Combine(_directory, SettingsFileName);
    }

    internal string ResultsPath => _resultsPath;

    internal string SettingsPath => _settingsPath;

    public async Task<PtvMetadataQualityDocument> ReadAsync(CancellationToken cancellationToken = default)
        => (await ReadWithDiagnosticsCoreAsync(cancellationToken).ConfigureAwait(false)).Document;

    Task<PtvMetadataQualityStoreReadResult> IPtvMetadataQualityDiagnosticStore.ReadWithDiagnosticsAsync(
        CancellationToken cancellationToken) => ReadWithDiagnosticsCoreAsync(cancellationToken);

    private async Task<PtvMetadataQualityStoreReadResult> ReadWithDiagnosticsCoreAsync(CancellationToken cancellationToken)
    {
        var totalStarted = Stopwatch.GetTimestamp();
        var gateStarted = Stopwatch.GetTimestamp();
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        var gateWaitMs = ElapsedMilliseconds(gateStarted);
        try
        {
            ThrowIfQuarantined(_resultsPath, "PTV_METADATA_QUALITY_STORE_CORRUPT");
            var read = await ReadDocumentWithDiagnosticsNoLockAsync(cancellationToken).ConfigureAwait(false);
            return new PtvMetadataQualityStoreReadResult(
                read.Document,
                new PtvMetadataQualityStoreReadDiagnostics
                {
                    FileBytes = read.FileBytes,
                    PersistedResults = read.Document.ItemResults.Count,
                    TotalMs = ElapsedMilliseconds(totalStarted),
                    Stages = new Dictionary<string, double>(StringComparer.Ordinal)
                    {
                        ["storeGateWait"] = gateWaitMs,
                        ["fileOpen"] = read.FileOpenMs,
                        ["jsonDeserialize"] = read.DeserializeMs,
                        ["documentNormalize"] = read.NormalizeMs,
                        ["isolationCloneSerialize"] = 0,
                        ["isolationCloneDeserialize"] = 0
                    },
                    Operations = new Dictionary<string, long>(StringComparer.Ordinal)
                    {
                        ["storeFileReads"] = read.FileBytes > 0 ? 1 : 0,
                        ["jsonDeserializations"] = read.FileBytes > 0 ? 1 : 0,
                        ["jsonSerializations"] = 0,
                        ["jellyfinQueries"] = 0,
                        ["providerRequests"] = 0,
                        ["archiveReads"] = 0,
                        ["sidecarReads"] = 0,
                        ["metadataWrites"] = 0
                    }
                });
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PtvMetadataQualityDocument> WriteAsync(
        PtvMetadataQualityDocument document,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(document);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfQuarantined(_resultsPath, "PTV_METADATA_QUALITY_STORE_CORRUPT");
            var normalized = NormalizeDocument(Clone(document));
            await WriteAtomicNoLockAsync(_resultsPath, normalized, ValidateDocument, cancellationToken).ConfigureAwait(false);
            _errorCode = null;
            return Clone(normalized);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PtvMetadataQualityDocument> UpdateAsync(
        Func<PtvMetadataQualityDocument, PtvMetadataQualityDocument> update,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(update);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfQuarantined(_resultsPath, "PTV_METADATA_QUALITY_STORE_CORRUPT");
            var current = await ReadDocumentNoLockAsync(cancellationToken).ConfigureAwait(false);
            var next = NormalizeDocument(Clone(update(Clone(current))));
            await WriteAtomicNoLockAsync(_resultsPath, next, ValidateDocument, cancellationToken).ConfigureAwait(false);
            _errorCode = null;
            return Clone(next);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PtvMetadataQualitySettings> ReadSettingsAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfQuarantined(_settingsPath, "PTV_METADATA_QUALITY_SETTINGS_CORRUPT");
            return Clone(await ReadSettingsNoLockAsync(cancellationToken).ConfigureAwait(false));
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PtvMetadataQualitySettings> WriteSettingsAsync(
        PtvMetadataQualitySettings settings,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfQuarantined(_settingsPath, "PTV_METADATA_QUALITY_SETTINGS_CORRUPT");
            var current = await ReadSettingsNoLockAsync(cancellationToken).ConfigureAwait(false);
            var normalized = NormalizeSettings(Clone(settings));
            normalized.Revision = checked(Math.Max(0, current.Revision) + 1);
            await WriteAtomicNoLockAsync(_settingsPath, normalized, ValidateSettings, cancellationToken).ConfigureAwait(false);
            _errorCode = null;
            return Clone(normalized);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PtvMetadataQualitySettings> UpdateSettingsAsync(
        long expectedRevision,
        Func<PtvMetadataQualitySettings, PtvMetadataQualitySettings> update,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(update);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfQuarantined(_settingsPath, "PTV_METADATA_QUALITY_SETTINGS_CORRUPT");
            var current = await ReadSettingsNoLockAsync(cancellationToken).ConfigureAwait(false);
            if (expectedRevision != current.Revision)
            {
                throw new PtvMetadataQualityStoreException(
                    "PTV_METADATA_QUALITY_SETTINGS_CONFLICT",
                    "Metadata Quality settings changed after this page was loaded. Refresh and try again.");
            }

            var next = NormalizeSettings(Clone(update(Clone(current))));
            next.Revision = checked(current.Revision + 1);
            await WriteAtomicNoLockAsync(_settingsPath, next, ValidateSettings, cancellationToken).ConfigureAwait(false);
            _errorCode = null;
            return Clone(next);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<string?> GetErrorCodeAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (IsQuarantined(_resultsPath)) return "PTV_METADATA_QUALITY_STORE_CORRUPT";
            if (IsQuarantined(_settingsPath)) return "PTV_METADATA_QUALITY_SETTINGS_CORRUPT";
            return _errorCode;
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<PtvMetadataQualityDocument> ReadDocumentNoLockAsync(CancellationToken cancellationToken)
        => (await ReadDocumentWithDiagnosticsNoLockAsync(cancellationToken).ConfigureAwait(false)).Document;

    private async Task<DocumentReadMeasurement> ReadDocumentWithDiagnosticsNoLockAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_resultsPath))
        {
            return new DocumentReadMeasurement(new PtvMetadataQualityDocument(), 0, 0, 0, 0);
        }

        try
        {
            var openStarted = Stopwatch.GetTimestamp();
            await using var stream = File.OpenRead(_resultsPath);
            var fileOpenMs = ElapsedMilliseconds(openStarted);
            var fileBytes = stream.Length;
            var deserializeStarted = Stopwatch.GetTimestamp();
            var document = await JsonSerializer.DeserializeAsync<PtvMetadataQualityDocument>(stream, JsonOptions, cancellationToken).ConfigureAwait(false);
            var deserializeMs = ElapsedMilliseconds(deserializeStarted);
            var normalizeStarted = Stopwatch.GetTimestamp();
            var normalized = NormalizeDocument(document ?? throw new JsonException("Metadata Quality state is empty."));
            return new DocumentReadMeasurement(normalized, fileBytes, fileOpenMs, deserializeMs, ElapsedMilliseconds(normalizeStarted));
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException or PtvMetadataQualityStoreException)
        {
            Quarantine(_resultsPath, "PTV_METADATA_QUALITY_STORE_CORRUPT", ex);
            throw new PtvMetadataQualityStoreException("PTV_METADATA_QUALITY_STORE_CORRUPT", "Metadata Quality results could not be loaded safely.", ex);
        }
    }

    private async Task<PtvMetadataQualitySettings> ReadSettingsNoLockAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_settingsPath)) return new PtvMetadataQualitySettings();
        try
        {
            await using var stream = File.OpenRead(_settingsPath);
            var settings = await JsonSerializer.DeserializeAsync<PtvMetadataQualitySettings>(stream, JsonOptions, cancellationToken).ConfigureAwait(false);
            return NormalizeSettings(settings ?? throw new JsonException("Metadata Quality settings are empty."));
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException or PtvMetadataQualityStoreException)
        {
            Quarantine(_settingsPath, "PTV_METADATA_QUALITY_SETTINGS_CORRUPT", ex);
            throw new PtvMetadataQualityStoreException("PTV_METADATA_QUALITY_SETTINGS_CORRUPT", "Metadata Quality settings could not be loaded safely.", ex);
        }
    }

    private async Task WriteAtomicNoLockAsync<T>(
        string destination,
        T value,
        Action<T> validate,
        CancellationToken cancellationToken)
    {
        validate(value);
        Directory.CreateDirectory(_directory);
        var temporaryPath = Path.Combine(_directory, $".{Path.GetFileName(destination)}.{Guid.NewGuid():N}.tmp");
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);
            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                81920,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            }

            await using (var verification = File.OpenRead(temporaryPath))
            {
                var roundTrip = await JsonSerializer.DeserializeAsync<T>(verification, JsonOptions, cancellationToken).ConfigureAwait(false)
                    ?? throw new JsonException("Atomic Metadata Quality write did not round-trip.");
                validate(roundTrip);
            }

            Replace(temporaryPath, destination);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            _errorCode = "PTV_METADATA_QUALITY_STORE_WRITE_FAILED";
            _logger.LogError(ex, "PiggieTV Metadata Quality atomic store write failed. File={FileName}.", Path.GetFileName(destination));
            throw new PtvMetadataQualityStoreException(_errorCode, "Metadata Quality data could not be saved.", ex);
        }
        finally
        {
            TryDelete(temporaryPath);
        }
    }

    private static PtvMetadataQualityDocument NormalizeDocument(PtvMetadataQualityDocument document)
    {
        if (document.SchemaVersion <= 0) document.SchemaVersion = PtvMetadataQualityConstants.SchemaVersion;
        ValidateDocument(document);
        document.ScannerVersion = string.IsNullOrWhiteSpace(document.ScannerVersion) ? PtvMetadataQualityConstants.ScannerVersion : document.ScannerVersion.Trim();
        document.RuleVersion = string.IsNullOrWhiteSpace(document.RuleVersion) ? PtvMetadataQualityConstants.RuleVersion : document.RuleVersion.Trim();
        document.UpdatedAt = DateTimeOffset.UtcNow;
        document.ItemResults = (document.ItemResults ?? new Dictionary<string, PtvMetadataQualityResult>())
            .Where(pair => pair.Value is not null && pair.Value.ItemId != Guid.Empty)
            .GroupBy(pair => pair.Value.ItemId.ToString("N"), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Last().Value, StringComparer.OrdinalIgnoreCase);
        document.ScanRuns = (document.ScanRuns ?? [])
            .Where(run => run is not null && run.RunId != Guid.Empty)
            .OrderBy(run => run.StartedAt)
            .TakeLast(PtvMetadataQualityConstants.MaximumRunHistory)
            .ToList();
        return document;
    }

    private static PtvMetadataQualitySettings NormalizeSettings(PtvMetadataQualitySettings settings)
    {
        if (settings.SchemaVersion <= 0) settings.SchemaVersion = PtvMetadataQualityConstants.SchemaVersion;
        ValidateSettings(settings);
        settings.Revision = Math.Max(0, settings.Revision);
        settings.ReviewThreshold = Math.Clamp(settings.ReviewThreshold, 1, 100);
        settings.LikelyWrongThreshold = Math.Clamp(settings.LikelyWrongThreshold, 0, settings.ReviewThreshold);
        settings.ProviderVerificationThreshold = Math.Clamp(settings.ProviderVerificationThreshold, 0, 100);
        settings.ProviderMaximumRequestsPerRun = Math.Clamp(settings.ProviderMaximumRequestsPerRun, 0, 5000);
        settings.AiThreshold = Math.Clamp(settings.AiThreshold, 0, 100);
        settings.AiMinimumConfidence = Math.Clamp(settings.AiMinimumConfidence, 0, settings.AiThreshold);
        settings.AiMaxItemsPerRun = Math.Clamp(settings.AiMaxItemsPerRun, 0, 100);
        settings.AiModel = NormalizeModel(
            settings.AiModel,
            Environment.GetEnvironmentVariable(PtvOpenAiSecretSafety.ApiKeyEnvironmentVariable));
        settings.SelectedLibraryIds = (settings.SelectedLibraryIds ?? []).Where(id => id != Guid.Empty).Distinct().ToList();
        NormalizeExtensionData(settings);
        return settings;
    }

    private static void NormalizeExtensionData(PtvMetadataQualitySettings settings)
    {
        if (settings.ExtensionData is null) return;
        foreach (var key in settings.ExtensionData.Keys.ToArray())
        {
            if (key.Equals("aiConfigured", StringComparison.OrdinalIgnoreCase))
            {
                settings.ExtensionData.Remove(key);
                continue;
            }

            if (IsSensitiveUnknownSettingName(key))
            {
                throw new PtvMetadataQualityStoreException(
                    "PTV_METADATA_QUALITY_SETTINGS_SECRET_INVALID",
                    "Metadata Quality settings cannot contain credential or secret fields.");
            }
        }
    }

    private static bool IsSensitiveUnknownSettingName(string key)
    {
        var normalized = new string(key.Where(char.IsLetterOrDigit).ToArray());
        return normalized.Equals("key", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("apikey", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("openaikey", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("accesskey", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("privatekey", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("authorization", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("bearer", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("credential", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("password", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("secret", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("token", StringComparison.OrdinalIgnoreCase);
    }

    internal static string NormalizeModel(string? model, string? activeCredential = null)
    {
        var normalized = model?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_AI_MODEL_INVALID",
                $"The OpenAI model ID must be non-empty, contain no control characters, and be at most {PtvMetadataQualityConstants.MaximumOpenAiModelLength} characters.");
        }

        if (normalized.Length > PtvMetadataQualityConstants.MaximumOpenAiModelLength
            || normalized.Any(char.IsControl)
            || PtvOpenAiSecretSafety.MatchesCredential(normalized, activeCredential))
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_AI_MODEL_INVALID",
                $"The OpenAI model ID must be non-empty, contain no control characters, and be at most {PtvMetadataQualityConstants.MaximumOpenAiModelLength} characters.");
        }

        return normalized;
    }

    private static void ValidateDocument(PtvMetadataQualityDocument document)
    {
        if (document.SchemaVersion != PtvMetadataQualityConstants.SchemaVersion)
        {
            throw new PtvMetadataQualityStoreException("PTV_METADATA_QUALITY_SCHEMA_UNSUPPORTED", "The Metadata Quality results schema is not supported.");
        }
    }

    private static void ValidateSettings(PtvMetadataQualitySettings settings)
    {
        if (settings.SchemaVersion != PtvMetadataQualityConstants.SchemaVersion)
        {
            throw new PtvMetadataQualityStoreException("PTV_METADATA_QUALITY_SETTINGS_SCHEMA_UNSUPPORTED", "The Metadata Quality settings schema is not supported.");
        }
    }

    private void ThrowIfQuarantined(string path, string code)
    {
        if (!IsQuarantined(path)) return;
        _errorCode = code;
        throw new PtvMetadataQualityStoreException(code, "Metadata Quality storage requires administrator attention before it can be replaced.");
    }

    private static bool IsQuarantined(string path) => !File.Exists(path)
        && Directory.Exists(Path.GetDirectoryName(path))
        && Directory.EnumerateFiles(Path.GetDirectoryName(path)!, $"{Path.GetFileName(path)}.corrupt.*").Any();

    private void Quarantine(string path, string code, Exception source)
    {
        _errorCode = code;
        try
        {
            if (!File.Exists(path)) return;
            var quarantine = $"{path}.corrupt.{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            File.Move(path, quarantine, true);
            _logger.LogError(source, "PiggieTV Metadata Quality quarantined an invalid store file. File={FileName}.", Path.GetFileName(path));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV Metadata Quality could not quarantine an invalid store file. File={FileName}.", Path.GetFileName(path));
        }
    }

    private static void Replace(string temporaryPath, string destination)
    {
        if (!File.Exists(destination))
        {
            File.Move(temporaryPath, destination);
            return;
        }

        try
        {
            File.Replace(temporaryPath, destination, null, true);
        }
        catch (PlatformNotSupportedException)
        {
            File.Move(temporaryPath, destination, true);
        }
        catch (IOException)
        {
            File.Move(temporaryPath, destination, true);
        }
    }

    private static T Clone<T>(T value)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);
        return JsonSerializer.Deserialize<T>(bytes, JsonOptions)
            ?? throw new PtvMetadataQualityStoreException("PTV_METADATA_QUALITY_CLONE_FAILED", "Metadata Quality data could not be normalized safely.");
    }

    private static double ElapsedMilliseconds(long started) => Stopwatch.GetElapsedTime(started).TotalMilliseconds;

    private sealed record DocumentReadMeasurement(
        PtvMetadataQualityDocument Document,
        long FileBytes,
        double FileOpenMs,
        double DeserializeMs,
        double NormalizeMs);

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            // Best effort; preserve the primary store exception.
        }
    }
}
