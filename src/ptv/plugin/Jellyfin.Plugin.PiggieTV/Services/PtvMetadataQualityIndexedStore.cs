using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Common.Configuration;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// SQLite-backed immutable Metadata Quality generations. A generation is built
/// and validated while readers continue using the prior ACTIVE generation. The
/// matching JSON snapshot is finalized before one transactional pointer switch.
/// </summary>
public sealed class PtvMetadataQualityIndexedStore : IPtvMetadataQualityIndexedStore
{
    internal const int IndexedSchemaVersion = 1;
    private const string DatabaseFileName = "metadata-quality-index-v2.db";
    private const string GenerationBuilding = "BUILDING";
    private const string GenerationValidating = "VALIDATING";
    private const string GenerationActive = "ACTIVE";
    private const string GenerationRetired = "RETIRED";
    private const string GenerationFailed = "FAILED";
    private const int BusyTimeoutMilliseconds = 5000;
    private const int ImportBatchSize = 500;
    private const long MinimumFreeSpaceReserveBytes = 256L * 1024 * 1024;
    private static readonly TimeSpan InitializationInactivityTimeout = TimeSpan.FromMinutes(10);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    private readonly SemaphoreSlim _writeGate = new(1, 1);
    private readonly object _initializationGate = new();
    private readonly PtvMetadataQualityStore _legacyStore;
    private readonly ILogger<PtvMetadataQualityIndexedStore> _logger;
    private readonly string _directory;
    private readonly string _databasePath;
    private Task? _initializationTask;
    private string? _errorCode;

    public PtvMetadataQualityIndexedStore(
        IApplicationPaths applicationPaths,
        PtvMetadataQualityStore legacyStore,
        ILogger<PtvMetadataQualityIndexedStore> logger)
        : this(Path.Combine(applicationPaths.PluginConfigurationsPath, "PiggieTV", "metadata-quality"), legacyStore, logger)
    {
    }

    internal PtvMetadataQualityIndexedStore(
        string directory,
        PtvMetadataQualityStore legacyStore,
        ILogger<PtvMetadataQualityIndexedStore> logger)
    {
        _directory = Path.GetFullPath(directory);
        Directory.CreateDirectory(_directory);
        _databasePath = Path.Combine(_directory, DatabaseFileName);
        _legacyStore = legacyStore;
        _logger = logger;
    }

    internal string DatabasePath => _databasePath;

    /// <inheritdoc />
    public async Task RebuildFromLegacyAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_legacyStore.ResultsPath))
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_MIGRATION_SOURCE_MISSING",
                "The retained Metadata Quality migration source is unavailable.");
        }

        Task? priorInitialization;
        lock (_initializationGate)
        {
            priorInitialization = _initializationTask;
        }

        if (priorInitialization is not null)
        {
            try
            {
                await priorInitialization.WaitAsync(cancellationToken).ConfigureAwait(false);
            }
            catch
            {
                // A failed current index is an expected reason to invoke this repair path.
            }
        }

        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        var stagingDirectory = Path.Combine(_directory, $".index-rebuild-{Guid.NewGuid():N}");
        var quarantinePath = $"{_databasePath}.replaced-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid():N}.bak";
        try
        {
            var sourceLength = new FileInfo(_legacyStore.ResultsPath).Length;
            EnsureDiskHeadroom(checked(Math.Max(MinimumFreeSpaceReserveBytes, sourceLength * 3)));
            Directory.CreateDirectory(stagingDirectory);
            var stagingStore = new PtvMetadataQualityIndexedStore(stagingDirectory, _legacyStore, _logger);
            await stagingStore.EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
            await stagingStore.ReadSummaryAsync(cancellationToken).ConfigureAwait(false);

            var stagingDatabase = stagingStore.DatabasePath;
            if (!File.Exists(stagingDatabase))
            {
                throw new PtvMetadataQualityStoreException(
                    "PTV_METADATA_QUALITY_INDEX_REBUILD_FAILED",
                    "Metadata Quality could not create a validated replacement index.");
            }

            if (File.Exists(_databasePath))
            {
                try
                {
                    File.Replace(stagingDatabase, _databasePath, quarantinePath, ignoreMetadataErrors: true);
                }
                catch (PlatformNotSupportedException)
                {
                    File.Move(_databasePath, quarantinePath);
                    try
                    {
                        File.Move(stagingDatabase, _databasePath);
                    }
                    catch
                    {
                        File.Move(quarantinePath, _databasePath);
                        throw;
                    }
                }
            }
            else
            {
                File.Move(stagingDatabase, _databasePath);
            }

            lock (_initializationGate)
            {
                _initializationTask = null;
            }

            _errorCode = null;
            PruneRebuildBackups(maximumBackups: 2);
        }
        catch (PtvMetadataQualityStoreException)
        {
            throw;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or SqliteException)
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_INDEX_REBUILD_FAILED",
                "Metadata Quality could not replace its indexed store safely.",
                ex);
        }
        finally
        {
            try
            {
                if (Directory.Exists(stagingDirectory)) Directory.Delete(stagingDirectory, recursive: true);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "PiggieTV Metadata Quality deferred rebuild-staging cleanup.");
            }

            _writeGate.Release();
        }

        await EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task EnsureReadyAsync(CancellationToken cancellationToken = default)
    {
        Task operation;
        lock (_initializationGate)
        {
            operation = _initializationTask ??= InitializeOwnedAsync();
        }

        await operation.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task InitializeOwnedAsync()
    {
        using var timeout = new InitializationInactivityDeadline(InitializationInactivityTimeout);
        try
        {
            await InitializeCoreAsync(timeout.Token, timeout.ReportProgress).ConfigureAwait(false);
            _errorCode = null;
        }
        catch (Exception ex)
        {
            _errorCode = ex is PtvMetadataQualityStoreException storeException
                ? storeException.Code
                : "PTV_METADATA_QUALITY_INDEX_UNAVAILABLE";
            _logger.LogError(ex, "PiggieTV Metadata Quality indexed-store initialization failed. Code={Code}.", _errorCode);
            lock (_initializationGate)
            {
                _initializationTask = null;
            }

            throw ex is PtvMetadataQualityStoreException
                ? ex
                : new PtvMetadataQualityStoreException(
                    _errorCode,
                    "Metadata Quality indexed storage could not be initialized safely.",
                    ex);
        }
    }

    private async Task InitializeCoreAsync(
        CancellationToken cancellationToken,
        Action reportProgress)
    {
        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            reportProgress();
            Directory.CreateDirectory(_directory);
            await using var connection = await OpenWriteConnectionAsync(cancellationToken).ConfigureAwait(false);
            await CreateSchemaAsync(connection, cancellationToken).ConfigureAwait(false);
            await RecoverInterruptedBuildsAsync(connection, cancellationToken).ConfigureAwait(false);
            reportProgress();

            var active = await ReadActiveGenerationAsync(connection, cancellationToken).ConfigureAwait(false);
            var hasValidatingGeneration = await HasGenerationInStateAsync(
                connection,
                GenerationValidating,
                cancellationToken).ConfigureAwait(false);
            var hasPendingSnapshot = await HasPendingSnapshotAsync(connection, cancellationToken).ConfigureAwait(false);

            // Once an indexed generation is active it is the authority. Avoid hashing the
            // retained 226 MB rollback JSON or running a full database scan on every process
            // restart. A VALIDATING generation is the only normal state that requires the
            // JSON hash to decide whether activation crossed the file/transaction boundary.
            if (active is not null && !hasValidatingGeneration && !hasPendingSnapshot)
            {
                return;
            }

            var legacyHash = File.Exists(_legacyStore.ResultsPath)
                ? await ComputeFileHashAsync(_legacyStore.ResultsPath, cancellationToken).ConfigureAwait(false)
                : null;
            reportProgress();
            legacyHash = await RecoverPendingSnapshotsAsync(
                connection,
                legacyHash,
                cancellationToken).ConfigureAwait(false);
            legacyHash = await RecoverDirtyActiveSnapshotAsync(
                connection,
                legacyHash,
                cancellationToken).ConfigureAwait(false);
            reportProgress();
            active = await ReadActiveGenerationAsync(connection, cancellationToken).ConfigureAwait(false);

            if (legacyHash is not null)
            {
                var recoverable = await FindGenerationBySourceHashAsync(
                    connection,
                    legacyHash,
                    GenerationValidating,
                    cancellationToken).ConfigureAwait(false);
                if (recoverable.HasValue)
                {
                    await ActivateGenerationAsync(connection, recoverable.Value, cancellationToken).ConfigureAwait(false);
                    return;
                }
            }

            if (active is not null)
            {
                if (legacyHash is null)
                {
                    _logger.LogWarning(
                        "PiggieTV Metadata Quality retained its active indexed generation because the legacy rollback snapshot is missing.");
                }
                else if (!string.Equals(active.SourceHash, legacyHash, StringComparison.Ordinal))
                {
                    _logger.LogWarning(
                        "PiggieTV Metadata Quality retained its active indexed generation because the legacy rollback snapshot does not match it.");
                }

                await FailUnmatchedValidatingGenerationsAsync(
                    connection,
                    active.GenerationId,
                    cancellationToken).ConfigureAwait(false);
                return;
            }

            await FailUnmatchedValidatingGenerationsAsync(
                connection,
                Guid.Empty,
                cancellationToken).ConfigureAwait(false);

            Guid generationId;
            if (File.Exists(_legacyStore.ResultsPath))
            {
                if (string.IsNullOrWhiteSpace(legacyHash))
                {
                    throw new PtvMetadataQualityStoreException(
                        "PTV_METADATA_QUALITY_MIGRATION_SOURCE_INVALID",
                        "The retained Metadata Quality migration source could not be verified.");
                }

                await using var source = new FileStream(
                    _legacyStore.ResultsPath,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read,
                    131072,
                    FileOptions.Asynchronous | FileOptions.SequentialScan);
                EnsureDiskHeadroom(checked(Math.Max(MinimumFreeSpaceReserveBytes, source.Length * 3)));
                try
                {
                    generationId = await ImportJsonStreamAsync(
                        connection,
                        source,
                        legacyHash,
                        source.Length,
                        cancellationToken,
                        reportProgress).ConfigureAwait(false);
                }
                catch
                {
                    await DiscardBuildingGenerationsAsync(connection, CancellationToken.None).ConfigureAwait(false);
                    throw;
                }
            }
            else
            {
                try
                {
                    generationId = await ImportDocumentAsync(
                        connection,
                        new PtvMetadataQualityDocument(),
                        null,
                        0,
                        cancellationToken).ConfigureAwait(false);
                }
                catch
                {
                    await DiscardBuildingGenerationsAsync(connection, CancellationToken.None).ConfigureAwait(false);
                    throw;
                }
            }

            reportProgress();
            await ActivateGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
            reportProgress();
        }
        catch (SqliteException ex)
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_INDEX_CORRUPT",
                "Metadata Quality indexed storage could not be read safely.",
                ex);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    private async Task<SqliteConnection> OpenWriteConnectionAsync(CancellationToken cancellationToken)
    {
        var connection = CreateConnection(SqliteOpenMode.ReadWriteCreate);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ExecuteNonQueryAsync(
            connection,
            $"PRAGMA foreign_keys=ON; PRAGMA busy_timeout={BusyTimeoutMilliseconds}; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;",
            cancellationToken).ConfigureAwait(false);
        return connection;
    }

    private async Task<SqliteConnection> OpenReadConnectionAsync(CancellationToken cancellationToken)
    {
        var connection = CreateConnection(SqliteOpenMode.ReadOnly);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await ExecuteNonQueryAsync(
            connection,
            $"PRAGMA foreign_keys=ON; PRAGMA busy_timeout={BusyTimeoutMilliseconds};",
            cancellationToken).ConfigureAwait(false);
        return connection;
    }

    private SqliteConnection CreateConnection(SqliteOpenMode mode)
    {
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = _databasePath,
            Mode = mode,
            Cache = SqliteCacheMode.Private,
            Pooling = false
        };
        var connection = new SqliteConnection(builder.ToString());
        connection.CreateCollation(
            "PTV_ORDINAL_NOCASE",
            static (left, right) => StringComparer.OrdinalIgnoreCase.Compare(left, right));
        connection.CreateFunction<string?, string?, long>(
            "ptv_ordinal_contains",
            static (haystack, needle) => haystack?.Contains(needle ?? string.Empty, StringComparison.OrdinalIgnoreCase) == true ? 1L : 0L,
            isDeterministic: true);
        return connection;
    }

    private static async Task CreateSchemaAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        const string sql = """
            CREATE TABLE IF NOT EXISTS mq_store_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                schema_version INTEGER NOT NULL,
                active_generation_id TEXT NULL
            );
            INSERT INTO mq_store_state(id, schema_version, active_generation_id)
                VALUES (1, 1, NULL)
                ON CONFLICT(id) DO NOTHING;

            CREATE TABLE IF NOT EXISTS mq_generation (
                generation_id TEXT PRIMARY KEY,
                state TEXT NOT NULL,
                created_at_ticks INTEGER NOT NULL,
                completed_at_ticks INTEGER NULL,
                activated_at_ticks INTEGER NULL,
                source_hash TEXT NULL,
                source_length INTEGER NOT NULL DEFAULT 0,
                pending_source_hash TEXT NULL,
                pending_source_length INTEGER NULL,
                snapshot_dirty INTEGER NOT NULL DEFAULT 0,
                source_schema_version INTEGER NOT NULL,
                scanner_version TEXT NOT NULL,
                rule_version TEXT NOT NULL,
                updated_at_ticks INTEGER NOT NULL,
                last_full_scan_ticks INTEGER NULL,
                last_incremental_scan_ticks INTEGER NULL,
                result_count INTEGER NOT NULL DEFAULT 0,
                healthy_count INTEGER NOT NULL DEFAULT 0,
                review_count INTEGER NOT NULL DEFAULT 0,
                likely_wrong_count INTEGER NOT NULL DEFAULT 0,
                incomplete_count INTEGER NOT NULL DEFAULT 0,
                unavailable_count INTEGER NOT NULL DEFAULT 0,
                dismissed_count INTEGER NOT NULL DEFAULT 0,
                resolved_count INTEGER NOT NULL DEFAULT 0,
                next_ordinal INTEGER NOT NULL DEFAULT 0,
                compatibility_fingerprint TEXT NULL
            );

            CREATE TABLE IF NOT EXISTS mq_result (
                generation_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                source_ordinal INTEGER NOT NULL,
                library_id TEXT NULL,
                library_name TEXT NULL,
                item_type TEXT NOT NULL,
                title TEXT NULL,
                file_name TEXT NULL,
                folder_name TEXT NULL,
                scanned_at_ticks INTEGER NOT NULL,
                scan_fingerprint TEXT NOT NULL,
                scanner_version TEXT NOT NULL,
                rule_version TEXT NOT NULL,
                raw_status TEXT NOT NULL,
                match_confidence INTEGER NOT NULL,
                completeness_score INTEGER NOT NULL,
                ai_reviewed INTEGER NOT NULL,
                provider_verified INTEGER NOT NULL,
                current_provider_name TEXT NULL,
                suggested_provider_name TEXT NULL,
                dismissed INTEGER NOT NULL,
                dismissed_at_ticks INTEGER NULL,
                dismissed_fingerprint TEXT NULL,
                dismissed_reason_signature TEXT NULL,
                resolution_state TEXT NULL,
                resolution_json TEXT NULL,
                detail_json TEXT NOT NULL,
                seen INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY(generation_id, item_id),
                UNIQUE(generation_id, source_ordinal),
                FOREIGN KEY(generation_id) REFERENCES mq_generation(generation_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS mq_reason (
                generation_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                code TEXT NOT NULL,
                PRIMARY KEY(generation_id, item_id, ordinal),
                FOREIGN KEY(generation_id, item_id) REFERENCES mq_result(generation_id, item_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS mq_provider_id (
                generation_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                match_slot INTEGER NOT NULL,
                ordinal INTEGER NOT NULL,
                provider_key TEXT NOT NULL,
                provider_value TEXT NOT NULL,
                PRIMARY KEY(generation_id, item_id, match_slot, ordinal),
                FOREIGN KEY(generation_id, item_id) REFERENCES mq_result(generation_id, item_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS mq_review_state (
                item_id TEXT PRIMARY KEY,
                scan_fingerprint TEXT NOT NULL,
                dismissed INTEGER NOT NULL,
                dismissed_at_ticks INTEGER NULL,
                dismissed_fingerprint TEXT NULL,
                dismissed_reason_signature TEXT NULL,
                resolution_state TEXT NULL,
                resolution_json TEXT NULL,
                updated_at_ticks INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS mq_scan_run (
                run_id TEXT PRIMARY KEY,
                started_at_ticks INTEGER NOT NULL,
                state TEXT NOT NULL,
                run_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS ix_mq_generation_state ON mq_generation(state, activated_at_ticks DESC);
            CREATE INDEX IF NOT EXISTS ix_mq_result_priority ON mq_result(generation_id, raw_status, match_confidence, scanned_at_ticks DESC, source_ordinal);
            CREATE INDEX IF NOT EXISTS ix_mq_result_status_priority_v2 ON mq_result(
                generation_id,
                raw_status COLLATE PTV_ORDINAL_NOCASE,
                match_confidence,
                scanned_at_ticks DESC,
                source_ordinal);
            CREATE INDEX IF NOT EXISTS ix_mq_result_confidence ON mq_result(generation_id, match_confidence, title COLLATE PTV_ORDINAL_NOCASE, source_ordinal);
            CREATE INDEX IF NOT EXISTS ix_mq_result_library_sort ON mq_result(generation_id, library_name COLLATE PTV_ORDINAL_NOCASE, title COLLATE PTV_ORDINAL_NOCASE, source_ordinal);
            CREATE INDEX IF NOT EXISTS ix_mq_result_recent ON mq_result(generation_id, scanned_at_ticks DESC, source_ordinal);
            CREATE INDEX IF NOT EXISTS ix_mq_result_title ON mq_result(generation_id, title COLLATE PTV_ORDINAL_NOCASE, source_ordinal);
            CREATE INDEX IF NOT EXISTS ix_mq_result_library ON mq_result(generation_id, library_id, source_ordinal);
            CREATE INDEX IF NOT EXISTS ix_mq_result_type ON mq_result(generation_id, item_type COLLATE PTV_ORDINAL_NOCASE, source_ordinal);
            CREATE INDEX IF NOT EXISTS ix_mq_result_ai ON mq_result(generation_id, ai_reviewed, source_ordinal);
            CREATE INDEX IF NOT EXISTS ix_mq_reason_code ON mq_reason(generation_id, code COLLATE PTV_ORDINAL_NOCASE, item_id);
            CREATE INDEX IF NOT EXISTS ix_mq_provider_key ON mq_provider_id(generation_id, provider_key COLLATE PTV_ORDINAL_NOCASE, item_id);
            CREATE INDEX IF NOT EXISTS ix_mq_provider_value ON mq_provider_id(generation_id, provider_value, item_id);
            """;
        await ExecuteNonQueryAsync(connection, sql, cancellationToken).ConfigureAwait(false);
        await EnsureColumnAsync(
            connection,
            "mq_generation",
            "pending_source_hash",
            "TEXT NULL",
            cancellationToken).ConfigureAwait(false);
        await EnsureColumnAsync(
            connection,
            "mq_generation",
            "pending_source_length",
            "INTEGER NULL",
            cancellationToken).ConfigureAwait(false);
        await EnsureColumnAsync(
            connection,
            "mq_generation",
            "snapshot_dirty",
            "INTEGER NOT NULL DEFAULT 0",
            cancellationToken).ConfigureAwait(false);

        await using var schemaCommand = connection.CreateCommand();
        schemaCommand.CommandText = "SELECT schema_version FROM mq_store_state WHERE id = 1;";
        var schema = Convert.ToInt32(await schemaCommand.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false), CultureInfo.InvariantCulture);
        if (schema != IndexedSchemaVersion)
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_INDEX_SCHEMA_UNSUPPORTED",
                "The Metadata Quality indexed-store schema is not supported.");
        }
    }

    private static async Task EnsureColumnAsync(
        SqliteConnection connection,
        string table,
        string column,
        string definition,
        CancellationToken cancellationToken)
    {
        await using (var inspect = connection.CreateCommand())
        {
            inspect.CommandText = $"PRAGMA table_info({table});";
            await using var reader = await inspect.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                if (string.Equals(reader.GetString(1), column, StringComparison.Ordinal)) return;
            }
        }

        await ExecuteNonQueryAsync(
            connection,
            $"ALTER TABLE {table} ADD COLUMN {column} {definition};",
            cancellationToken).ConfigureAwait(false);
    }

    private static async Task RecoverInterruptedBuildsAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        var now = ToTicks(DateTimeOffset.UtcNow);
        using var transaction = connection.BeginTransaction();
        await using (var runCommand = connection.CreateCommand())
        {
            runCommand.Transaction = transaction;
            runCommand.CommandText = "SELECT run_id, run_json FROM mq_scan_run WHERE state = @running;";
            runCommand.Parameters.AddWithValue("@running", PtvMetadataQualityScanStates.Running);
            var interrupted = new List<PtvMetadataQualityScanRun>();
            await using var reader = await runCommand.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var run = JsonSerializer.Deserialize<PtvMetadataQualityScanRun>(reader.GetString(1), JsonOptions);
                if (run is null) continue;
                run.State = PtvMetadataQualityScanStates.Interrupted;
                run.CompletedAt = FromTicks(now);
                run.ErrorCode ??= "PTV_METADATA_QUALITY_SCAN_INTERRUPTED";
                interrupted.Add(run);
            }

            await reader.DisposeAsync().ConfigureAwait(false);
            foreach (var run in interrupted)
            {
                await UpsertRunAsync(connection, transaction, run, cancellationToken).ConfigureAwait(false);
            }
        }

        await using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                DELETE FROM mq_result
                WHERE generation_id IN (
                    SELECT generation_id FROM mq_generation WHERE state = @building);
                UPDATE mq_generation
                SET state = @failed,
                    completed_at_ticks = COALESCE(completed_at_ticks, @now)
                WHERE state = @building;
                DELETE FROM mq_generation
                WHERE state = @failed
                  AND generation_id NOT IN (
                      SELECT generation_id FROM mq_generation
                      WHERE state = @failed
                      ORDER BY completed_at_ticks DESC, created_at_ticks DESC
                      LIMIT 5);
                """;
            command.Parameters.AddWithValue("@failed", GenerationFailed);
            command.Parameters.AddWithValue("@building", GenerationBuilding);
            command.Parameters.AddWithValue("@now", now);
            await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task FailUnmatchedValidatingGenerationsAsync(
        SqliteConnection connection,
        Guid activeGenerationId,
        CancellationToken cancellationToken)
    {
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE mq_generation
            SET state = @failed,
                completed_at_ticks = COALESCE(completed_at_ticks, @now)
            WHERE state = @validating AND generation_id <> @active;

            DELETE FROM mq_result
            WHERE generation_id IN (
                SELECT generation_id FROM mq_generation WHERE state = @failed);
            """;
        command.Parameters.AddWithValue("@failed", GenerationFailed);
        command.Parameters.AddWithValue("@validating", GenerationValidating);
        command.Parameters.AddWithValue("@now", ToTicks(DateTimeOffset.UtcNow));
        command.Parameters.AddWithValue("@active", ToKey(activeGenerationId));
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task DiscardBuildingGenerationsAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            DELETE FROM mq_result
            WHERE generation_id IN (
                SELECT generation_id FROM mq_generation WHERE state = @building);
            UPDATE mq_generation
            SET state = @failed,
                completed_at_ticks = COALESCE(completed_at_ticks, @now)
            WHERE state = @building;
            DELETE FROM mq_generation
            WHERE state = @failed
              AND generation_id NOT IN (
                  SELECT generation_id FROM mq_generation
                  WHERE state = @failed
                  ORDER BY completed_at_ticks DESC, created_at_ticks DESC
                  LIMIT 5);
            """;
        command.Parameters.AddWithValue("@building", GenerationBuilding);
        command.Parameters.AddWithValue("@failed", GenerationFailed);
        command.Parameters.AddWithValue("@now", ToTicks(DateTimeOffset.UtcNow));
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task<Guid> ImportDocumentAsync(
        SqliteConnection connection,
        PtvMetadataQualityDocument document,
        string? sourceHash,
        long sourceLength,
        CancellationToken cancellationToken)
    {
        var generationId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        using (var transaction = connection.BeginTransaction())
        {
            await InsertGenerationAsync(
                connection,
                transaction,
                generationId,
                GenerationBuilding,
                document.SchemaVersion,
                document.ScannerVersion,
                document.RuleVersion,
                document.UpdatedAt,
                document.LastFullScan,
            document.LastIncrementalScan,
            cancellationToken).ConfigureAwait(false);
            foreach (var run in document.ScanRuns)
            {
                await UpsertRunAsync(
                    connection,
                    transaction,
                    NormalizeInterruptedImportedRun(run, now),
                    cancellationToken).ConfigureAwait(false);
            }

            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        }

        long ordinal = 0;
        var batch = new List<PtvMetadataQualityResult>(ImportBatchSize);
        foreach (var pair in document.ItemResults)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (pair.Value is null || pair.Value.ItemId == Guid.Empty) continue;
            batch.Add(pair.Value);
            if (batch.Count < ImportBatchSize) continue;
            await InsertResultBatchAsync(connection, generationId, batch, ordinal, cancellationToken).ConfigureAwait(false);
            ordinal += batch.Count;
            batch.Clear();
        }

        if (batch.Count > 0)
        {
            await InsertResultBatchAsync(connection, generationId, batch, ordinal, cancellationToken).ConfigureAwait(false);
            ordinal += batch.Count;
        }

        await ValidateGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
        var fingerprint = await ComputeGenerationFingerprintAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
        using (var transaction = connection.BeginTransaction())
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                UPDATE mq_generation
                SET state = @state,
                    completed_at_ticks = @completed,
                    source_hash = @sourceHash,
                    source_length = @sourceLength,
                    result_count = @resultCount,
                    next_ordinal = @nextOrdinal,
                    compatibility_fingerprint = @fingerprint
                WHERE generation_id = @generation;
                """;
            command.Parameters.AddWithValue(
                "@state",
                sourceHash is null ? GenerationBuilding : GenerationValidating);
            command.Parameters.AddWithValue("@completed", ToTicks(now));
            command.Parameters.AddWithValue("@sourceHash", (object?)sourceHash ?? DBNull.Value);
            command.Parameters.AddWithValue("@sourceLength", sourceLength);
            command.Parameters.AddWithValue("@resultCount", ordinal);
            command.Parameters.AddWithValue("@nextOrdinal", ordinal);
            command.Parameters.AddWithValue("@fingerprint", fingerprint);
            command.Parameters.AddWithValue("@generation", ToKey(generationId));
            await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            await UpdateGenerationCountsAsync(connection, transaction, generationId, cancellationToken).ConfigureAwait(false);
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        }

        if (sourceHash is null)
        {
            await ExportAndMarkGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
        }

        return generationId;
    }

    private async Task<Guid> ImportJsonStreamAsync(
        SqliteConnection connection,
        Stream source,
        string sourceHash,
        long sourceLength,
        CancellationToken cancellationToken,
        Action reportProgress)
    {
        var generationId = Guid.NewGuid();
        using (var transaction = connection.BeginTransaction())
        {
            await InsertGenerationAsync(
                connection,
                transaction,
                generationId,
                GenerationBuilding,
                PtvMetadataQualityConstants.SchemaVersion,
                PtvMetadataQualityConstants.ScannerVersion,
                PtvMetadataQualityConstants.RuleVersion,
                DateTimeOffset.UtcNow,
                null,
                null,
                cancellationToken).ConfigureAwait(false);
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        }

        var batch = new List<ImportResult>(ImportBatchSize);
        var header = await PtvMetadataQualityJsonStreamReader.ReadAsync(
            source,
            async (_, result, sourceOrdinal, callbackCancellation) =>
            {
                if (result.ItemId == Guid.Empty) return;
                batch.Add(new ImportResult(result, sourceOrdinal));
                if (batch.Count < ImportBatchSize) return;
                await InsertImportResultBatchAsync(
                    connection,
                    generationId,
                    batch,
                    callbackCancellation).ConfigureAwait(false);
                batch.Clear();
                reportProgress();
            },
            cancellationToken).ConfigureAwait(false);

        if (batch.Count > 0)
        {
            await InsertImportResultBatchAsync(
                connection,
                generationId,
                batch,
                cancellationToken).ConfigureAwait(false);
            batch.Clear();
            reportProgress();
        }

        var schemaVersion = header.SchemaVersion <= 0
            ? PtvMetadataQualityConstants.SchemaVersion
            : header.SchemaVersion;
        if (schemaVersion != PtvMetadataQualityConstants.SchemaVersion)
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_SCHEMA_UNSUPPORTED",
                "The Metadata Quality results schema is not supported.");
        }

        var scannerVersion = string.IsNullOrWhiteSpace(header.ScannerVersion)
            ? PtvMetadataQualityConstants.ScannerVersion
            : header.ScannerVersion.Trim();
        var ruleVersion = string.IsNullOrWhiteSpace(header.RuleVersion)
            ? PtvMetadataQualityConstants.RuleVersion
            : header.RuleVersion.Trim();
        var interruptionTime = DateTimeOffset.UtcNow;
        var normalizedRuns = header.ScanRuns
            .Where(run => run.RunId != Guid.Empty)
            .OrderBy(run => run.StartedAt)
            .TakeLast(PtvMetadataQualityConstants.MaximumRunHistory)
            .Select(run => NormalizeInterruptedImportedRun(run, interruptionTime))
            .ToArray();

        using (var transaction = connection.BeginTransaction())
        {
            foreach (var run in normalizedRuns)
            {
                await UpsertRunAsync(connection, transaction, run, cancellationToken).ConfigureAwait(false);
            }

            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                UPDATE mq_generation
                SET source_schema_version = @schema,
                    scanner_version = @scanner,
                    rule_version = @rule,
                    updated_at_ticks = @updated,
                    last_full_scan_ticks = @lastFull,
                    last_incremental_scan_ticks = @lastIncremental,
                    next_ordinal = (SELECT COALESCE(MAX(source_ordinal) + 1, 0) FROM mq_result WHERE generation_id = @generation)
                WHERE generation_id = @generation AND state = @building;
                """;
            command.Parameters.AddWithValue("@schema", schemaVersion);
            command.Parameters.AddWithValue("@scanner", scannerVersion);
            command.Parameters.AddWithValue("@rule", ruleVersion);
            command.Parameters.AddWithValue("@updated", ToTicks(header.UpdatedAt));
            command.Parameters.AddWithValue("@lastFull", ToDb(header.LastFullScan));
            command.Parameters.AddWithValue("@lastIncremental", ToDb(header.LastIncrementalScan));
            command.Parameters.AddWithValue("@generation", ToKey(generationId));
            command.Parameters.AddWithValue("@building", GenerationBuilding);
            if (await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false) != 1)
            {
                throw new PtvMetadataQualityStoreException(
                    "PTV_METADATA_QUALITY_GENERATION_NOT_BUILDING",
                    "The Metadata Quality import generation is no longer writable.");
            }

            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        }

        reportProgress();
        await ValidateGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
        reportProgress();
        var fingerprint = await ComputeGenerationFingerprintAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
        reportProgress();
        using (var transaction = connection.BeginTransaction())
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                UPDATE mq_generation
                SET state = @state,
                    completed_at_ticks = @completed,
                    source_hash = @sourceHash,
                    source_length = @sourceLength,
                    compatibility_fingerprint = @fingerprint
                WHERE generation_id = @generation AND state = @building;
                """;
            command.Parameters.AddWithValue("@state", GenerationValidating);
            command.Parameters.AddWithValue("@completed", ToTicks(DateTimeOffset.UtcNow));
            command.Parameters.AddWithValue("@sourceHash", sourceHash);
            command.Parameters.AddWithValue("@sourceLength", sourceLength);
            command.Parameters.AddWithValue("@fingerprint", fingerprint);
            command.Parameters.AddWithValue("@generation", ToKey(generationId));
            command.Parameters.AddWithValue("@building", GenerationBuilding);
            if (await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false) != 1)
            {
                throw new PtvMetadataQualityStoreException(
                    "PTV_METADATA_QUALITY_GENERATION_NOT_BUILDING",
                    "The Metadata Quality import generation could not be finalized.");
            }

            await UpdateGenerationCountsAsync(connection, transaction, generationId, cancellationToken).ConfigureAwait(false);
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        }

        return generationId;
    }

    /// <summary>
    /// Cancels initialization only after a complete interval without reported progress.
    /// Long, productive first imports can therefore outlive one interval, while a stalled
    /// filesystem or database operation remains bounded.
    /// </summary>
    internal sealed class InitializationInactivityDeadline : IDisposable
    {
        private readonly CancellationTokenSource _source = new();
        private readonly TimeSpan _inactivityTimeout;

        public InitializationInactivityDeadline(TimeSpan inactivityTimeout)
        {
            if (inactivityTimeout <= TimeSpan.Zero)
            {
                throw new ArgumentOutOfRangeException(nameof(inactivityTimeout));
            }

            _inactivityTimeout = inactivityTimeout;
            ReportProgress();
        }

        public CancellationToken Token => _source.Token;

        public void ReportProgress()
        {
            if (!_source.IsCancellationRequested)
            {
                _source.CancelAfter(_inactivityTimeout);
            }
        }

        public void Dispose() => _source.Dispose();
    }

    private static async Task InsertImportResultBatchAsync(
        SqliteConnection connection,
        Guid generationId,
        IReadOnlyList<ImportResult> results,
        CancellationToken cancellationToken)
    {
        using var transaction = connection.BeginTransaction();
        foreach (var entry in results)
        {
            await UpsertResultAsync(
                connection,
                transaction,
                generationId,
                entry.Result,
                entry.SourceOrdinal,
                cancellationToken).ConfigureAwait(false);
        }

        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task InsertGenerationAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        Guid generationId,
        string state,
        int sourceSchemaVersion,
        string scannerVersion,
        string ruleVersion,
        DateTimeOffset updatedAt,
        DateTimeOffset? lastFullScan,
        DateTimeOffset? lastIncrementalScan,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO mq_generation(
                generation_id, state, created_at_ticks, source_schema_version,
                scanner_version, rule_version, updated_at_ticks,
                last_full_scan_ticks, last_incremental_scan_ticks)
            VALUES(
                @generation, @state, @created, @schema,
                @scanner, @rule, @updated, @lastFull, @lastIncremental);
            """;
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        command.Parameters.AddWithValue("@state", state);
        command.Parameters.AddWithValue("@created", ToTicks(DateTimeOffset.UtcNow));
        command.Parameters.AddWithValue("@schema", sourceSchemaVersion);
        command.Parameters.AddWithValue("@scanner", scannerVersion);
        command.Parameters.AddWithValue("@rule", ruleVersion);
        command.Parameters.AddWithValue("@updated", ToTicks(updatedAt));
        command.Parameters.AddWithValue("@lastFull", ToDb(lastFullScan));
        command.Parameters.AddWithValue("@lastIncremental", ToDb(lastIncrementalScan));
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task InsertResultBatchAsync(
        SqliteConnection connection,
        Guid generationId,
        IReadOnlyList<PtvMetadataQualityResult> results,
        long firstOrdinal,
        CancellationToken cancellationToken)
    {
        using var transaction = connection.BeginTransaction();
        for (var index = 0; index < results.Count; index++)
        {
            await UpsertResultAsync(
                connection,
                transaction,
                generationId,
                results[index],
                firstOrdinal + index,
                cancellationToken).ConfigureAwait(false);
        }

        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task UpsertResultAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        Guid generationId,
        PtvMetadataQualityResult result,
        long sourceOrdinal,
        CancellationToken cancellationToken)
    {
        var generation = ToKey(generationId);
        var item = ToKey(result.ItemId);
        var resolutionJson = result.Resolution is null ? null : JsonSerializer.Serialize(result.Resolution, JsonOptions);
        var detailJson = JsonSerializer.Serialize(result, JsonOptions);
        await using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO mq_result(
                    generation_id, item_id, source_ordinal, library_id, library_name,
                    item_type, title, file_name, folder_name, scanned_at_ticks,
                    scan_fingerprint, scanner_version, rule_version, raw_status,
                    match_confidence, completeness_score, ai_reviewed, provider_verified,
                    current_provider_name, suggested_provider_name,
                    dismissed, dismissed_at_ticks, dismissed_fingerprint,
                    dismissed_reason_signature, resolution_state, resolution_json,
                    detail_json, seen)
                VALUES(
                    @generation, @item, @ordinal, @libraryId, @libraryName,
                    @itemType, @title, @fileName, @folderName, @scannedAt,
                    @fingerprint, @scanner, @rule, @status,
                    @confidence, @completeness, @aiReviewed, @providerVerified,
                    @currentProviderName, @suggestedProviderName,
                    @dismissed, @dismissedAt, @dismissedFingerprint,
                    @dismissedReasonSignature, @resolutionState, @resolutionJson,
                    @detailJson, 1)
                ON CONFLICT(generation_id, item_id) DO UPDATE SET
                    library_id = excluded.library_id,
                    library_name = excluded.library_name,
                    item_type = excluded.item_type,
                    title = excluded.title,
                    file_name = excluded.file_name,
                    folder_name = excluded.folder_name,
                    scanned_at_ticks = excluded.scanned_at_ticks,
                    scan_fingerprint = excluded.scan_fingerprint,
                    scanner_version = excluded.scanner_version,
                    rule_version = excluded.rule_version,
                    raw_status = excluded.raw_status,
                    match_confidence = excluded.match_confidence,
                    completeness_score = excluded.completeness_score,
                    ai_reviewed = excluded.ai_reviewed,
                    provider_verified = excluded.provider_verified,
                    current_provider_name = excluded.current_provider_name,
                    suggested_provider_name = excluded.suggested_provider_name,
                    dismissed = excluded.dismissed,
                    dismissed_at_ticks = excluded.dismissed_at_ticks,
                    dismissed_fingerprint = excluded.dismissed_fingerprint,
                    dismissed_reason_signature = excluded.dismissed_reason_signature,
                    resolution_state = excluded.resolution_state,
                    resolution_json = excluded.resolution_json,
                    detail_json = excluded.detail_json,
                    seen = 1;
                """;
            command.Parameters.AddWithValue("@generation", generation);
            command.Parameters.AddWithValue("@item", item);
            command.Parameters.AddWithValue("@ordinal", sourceOrdinal);
            command.Parameters.AddWithValue("@libraryId", result.LibraryId.HasValue ? ToKey(result.LibraryId.Value) : DBNull.Value);
            command.Parameters.AddWithValue("@libraryName", (object?)result.LibraryName ?? DBNull.Value);
            command.Parameters.AddWithValue("@itemType", result.ItemType ?? string.Empty);
            command.Parameters.AddWithValue("@title", (object?)result.Title ?? DBNull.Value);
            command.Parameters.AddWithValue("@fileName", (object?)result.FileName ?? DBNull.Value);
            command.Parameters.AddWithValue("@folderName", (object?)result.FolderName ?? DBNull.Value);
            command.Parameters.AddWithValue("@scannedAt", ToTicks(result.ScannedAt));
            command.Parameters.AddWithValue("@fingerprint", result.ScanFingerprint ?? string.Empty);
            command.Parameters.AddWithValue("@scanner", result.ScannerVersion ?? string.Empty);
            command.Parameters.AddWithValue("@rule", result.RuleVersion ?? string.Empty);
            command.Parameters.AddWithValue("@status", result.Status ?? string.Empty);
            command.Parameters.AddWithValue("@confidence", result.MatchConfidence);
            command.Parameters.AddWithValue("@completeness", result.CompletenessScore);
            command.Parameters.AddWithValue("@aiReviewed", result.AiReviewed ? 1 : 0);
            command.Parameters.AddWithValue("@providerVerified", result.ProviderVerified ? 1 : 0);
            command.Parameters.AddWithValue("@currentProviderName", (object?)result.CurrentMatch?.ProviderName ?? DBNull.Value);
            command.Parameters.AddWithValue("@suggestedProviderName", (object?)result.SuggestedMatch?.ProviderName ?? DBNull.Value);
            command.Parameters.AddWithValue("@dismissed", result.Dismissed ? 1 : 0);
            command.Parameters.AddWithValue("@dismissedAt", ToDb(result.DismissedAt));
            command.Parameters.AddWithValue("@dismissedFingerprint", (object?)result.DismissedFingerprint ?? DBNull.Value);
            command.Parameters.AddWithValue("@dismissedReasonSignature", (object?)result.DismissedReasonSignature ?? DBNull.Value);
            command.Parameters.AddWithValue("@resolutionState", (object?)result.Resolution?.State ?? DBNull.Value);
            command.Parameters.AddWithValue("@resolutionJson", (object?)resolutionJson ?? DBNull.Value);
            command.Parameters.AddWithValue("@detailJson", detailJson);
            await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using (var deleteChildren = connection.CreateCommand())
        {
            deleteChildren.Transaction = transaction;
            deleteChildren.CommandText = "DELETE FROM mq_reason WHERE generation_id = @generation AND item_id = @item; DELETE FROM mq_provider_id WHERE generation_id = @generation AND item_id = @item;";
            deleteChildren.Parameters.AddWithValue("@generation", generation);
            deleteChildren.Parameters.AddWithValue("@item", item);
            await deleteChildren.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        for (var index = 0; index < result.Reasons.Count; index++)
        {
            await using var reason = connection.CreateCommand();
            reason.Transaction = transaction;
            reason.CommandText = "INSERT INTO mq_reason(generation_id, item_id, ordinal, code) VALUES(@generation, @item, @ordinal, @code);";
            reason.Parameters.AddWithValue("@generation", generation);
            reason.Parameters.AddWithValue("@item", item);
            reason.Parameters.AddWithValue("@ordinal", index);
            reason.Parameters.AddWithValue("@code", result.Reasons[index].Code ?? string.Empty);
            await reason.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await InsertProviderIdsAsync(connection, transaction, generation, item, 0, result.CurrentMatch, cancellationToken).ConfigureAwait(false);
        await InsertProviderIdsAsync(connection, transaction, generation, item, 1, result.SuggestedMatch, cancellationToken).ConfigureAwait(false);
    }

    private static async Task InsertProviderIdsAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string generation,
        string item,
        int slot,
        PtvMetadataMatchSummary? match,
        CancellationToken cancellationToken)
    {
        if (match is null) return;
        var ordinal = 0;
        foreach (var pair in match.ProviderIds)
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO mq_provider_id(
                    generation_id, item_id, match_slot, ordinal, provider_key, provider_value)
                VALUES(@generation, @item, @slot, @ordinal, @key, @value);
                """;
            command.Parameters.AddWithValue("@generation", generation);
            command.Parameters.AddWithValue("@item", item);
            command.Parameters.AddWithValue("@slot", slot);
            command.Parameters.AddWithValue("@ordinal", ordinal++);
            command.Parameters.AddWithValue("@key", pair.Key ?? string.Empty);
            command.Parameters.AddWithValue("@value", pair.Value ?? string.Empty);
            await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    public async Task<PtvMetadataQualityIndexedSummary> ReadSummaryAsync(CancellationToken cancellationToken = default)
    {
        var started = Stopwatch.GetTimestamp();
        await EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
        await using var connection = await OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
        using var transaction = connection.BeginTransaction();
        var active = await ReadActiveGenerationAsync(connection, cancellationToken, transaction).ConfigureAwait(false)
            ?? throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_INDEX_UNAVAILABLE",
                "Metadata Quality has no active indexed generation.");

        PtvMetadataQualityCounts counts;
        await using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                SELECT result_count, healthy_count, review_count, likely_wrong_count,
                       incomplete_count, unavailable_count, dismissed_count, resolved_count
                FROM mq_generation
                WHERE generation_id = @generation AND state = @active;
                """;
            command.Parameters.AddWithValue("@generation", ToKey(active.GenerationId));
            command.Parameters.AddWithValue("@active", GenerationActive);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                throw new PtvMetadataQualityStoreException(
                    "PTV_METADATA_QUALITY_INDEX_UNAVAILABLE",
                    "Metadata Quality has no active indexed summary.");
            }

            counts = new PtvMetadataQualityCounts
            {
                TotalScanned = checked((int)reader.GetInt64(0)),
                Healthy = checked((int)reader.GetInt64(1)),
                NeedsReview = checked((int)reader.GetInt64(2)),
                LikelyIncorrect = checked((int)reader.GetInt64(3)),
                Incomplete = checked((int)reader.GetInt64(4)),
                Unavailable = checked((int)reader.GetInt64(5)),
                Dismissed = checked((int)reader.GetInt64(6)),
                Resolved = checked((int)reader.GetInt64(7))
            };
        }

        var latestRun = await ReadLatestRunAsync(connection, cancellationToken, transaction).ConfigureAwait(false);
        var diagnostics = CreateIndexedDiagnostics("indexed-summary", started, counts.TotalScanned, 0, databaseQueries: 3);
        return new PtvMetadataQualityIndexedSummary
        {
            GenerationId = active.GenerationId,
            Counts = counts,
            LastScanAt = Max(active.LastFullScan, active.LastIncrementalScan),
            RuleVersion = active.RuleVersion,
            ScannerVersion = active.ScannerVersion,
            LatestRun = latestRun,
            CompatibilityFingerprint = active.CompatibilityFingerprint,
            Diagnostics = diagnostics
        };
    }

    public async Task<PtvMetadataQualityIndexedPage> QueryResultsAsync(
        PtvMetadataQualityResultQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        var started = Stopwatch.GetTimestamp();
        await EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
        await using var connection = await OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
        using var transaction = connection.BeginTransaction();
        var generationId = await ReadActiveGenerationIdAsync(connection, cancellationToken, transaction).ConfigureAwait(false);
        var startIndex = Math.Max(0, query.StartIndex);
        var limit = Math.Clamp(query.Limit, 1, PtvMetadataQualityConstants.MaximumPageSize);
        var where = BuildWhere(query, out var parameters);

        int total;
        await using (var countCommand = connection.CreateCommand())
        {
            countCommand.Transaction = transaction;
            countCommand.CommandText = $"""
                SELECT COUNT(*)
                FROM mq_result r
                LEFT JOIN mq_review_state o
                    ON o.item_id = r.item_id AND o.scan_fingerprint = r.scan_fingerprint
                WHERE r.generation_id = @generation {where};
                """;
            countCommand.Parameters.AddWithValue("@generation", ToKey(generationId));
            AddParameters(countCommand, parameters);
            total = checked(Convert.ToInt32(
                await countCommand.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false),
                CultureInfo.InvariantCulture));
        }

        var items = new List<PtvMetadataQualityResultSummary>(Math.Min(limit, total));
        await using (var pageCommand = connection.CreateCommand())
        {
            pageCommand.Transaction = transaction;
            pageCommand.CommandText = $"""
                SELECT r.detail_json,
                       o.dismissed, o.dismissed_at_ticks, o.dismissed_fingerprint,
                       o.dismissed_reason_signature, o.resolution_json
                FROM mq_result r
                LEFT JOIN mq_review_state o
                    ON o.item_id = r.item_id AND o.scan_fingerprint = r.scan_fingerprint
                WHERE r.generation_id = @generation {where}
                ORDER BY {BuildOrderBy(query.Sort, !string.IsNullOrWhiteSpace(query.Status))}
                LIMIT @limit OFFSET @offset;
                """;
            pageCommand.Parameters.AddWithValue("@generation", ToKey(generationId));
            pageCommand.Parameters.AddWithValue("@limit", limit);
            pageCommand.Parameters.AddWithValue("@offset", startIndex);
            AddParameters(pageCommand, parameters);
            await using var reader = await pageCommand.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var result = DeserializeResult(reader.GetString(0));
                ApplyReviewOverlay(result, reader, 1);
                items.Add(PtvMetadataQualityProjection.ToResultSummary(result));
            }
        }

        return new PtvMetadataQualityIndexedPage
        {
            TotalRecordCount = total,
            StartIndex = startIndex,
            Limit = limit,
            Items = items,
            Diagnostics = CreateIndexedDiagnostics("indexed-results", started, total, items.Count, databaseQueries: 3)
        };
    }

    public async Task<PtvMetadataQualityResult?> ReadResultAsync(Guid itemId, CancellationToken cancellationToken = default)
    {
        if (itemId == Guid.Empty) return null;
        await EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
        await using var connection = await OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
        using var transaction = connection.BeginTransaction();
        var generationId = await ReadActiveGenerationIdAsync(connection, cancellationToken, transaction).ConfigureAwait(false);
        return await ReadResultCoreAsync(connection, generationId, itemId, cancellationToken, transaction).ConfigureAwait(false);
    }

    private static async Task<PtvMetadataQualityResult?> ReadResultCoreAsync(
        SqliteConnection connection,
        Guid generationId,
        Guid itemId,
        CancellationToken cancellationToken,
        SqliteTransaction? transaction = null)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT r.detail_json,
                   o.dismissed, o.dismissed_at_ticks, o.dismissed_fingerprint,
                   o.dismissed_reason_signature, o.resolution_json
            FROM mq_result r
            LEFT JOIN mq_review_state o
                ON o.item_id = r.item_id AND o.scan_fingerprint = r.scan_fingerprint
            WHERE r.generation_id = @generation AND r.item_id = @item;
            """;
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        command.Parameters.AddWithValue("@item", ToKey(itemId));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false)) return null;
        var result = DeserializeResult(reader.GetString(0));
        ApplyReviewOverlay(result, reader, 1);
        return result;
    }

    private static string BuildWhere(
        PtvMetadataQualityResultQuery query,
        out List<KeyValuePair<string, object>> parameters)
    {
        var clauses = new List<string>();
        parameters = [];
        if (!string.IsNullOrWhiteSpace(query.Status))
        {
            var status = query.Status.Trim();
            if (IsAnalysisStatus(status))
            {
                clauses.Add("""
                    AND r.raw_status COLLATE PTV_ORDINAL_NOCASE = @status COLLATE PTV_ORDINAL_NOCASE
                    AND NOT (
                        o.item_id IS NOT NULL
                        AND (o.dismissed = 1 OR o.resolution_state IN ('kept_current', 'corrected')))
                    """);
            }
            else
            {
                clauses.Add($"AND ({DisplayStatusSql}) COLLATE PTV_ORDINAL_NOCASE = @status COLLATE PTV_ORDINAL_NOCASE");
            }

            parameters.Add(new("@status", status));
        }

        if (query.LibraryId.HasValue)
        {
            clauses.Add("AND r.library_id = @libraryId");
            parameters.Add(new("@libraryId", ToKey(query.LibraryId.Value)));
        }

        if (!string.IsNullOrWhiteSpace(query.ItemType))
        {
            clauses.Add("AND r.item_type COLLATE PTV_ORDINAL_NOCASE = @itemType COLLATE PTV_ORDINAL_NOCASE");
            parameters.Add(new("@itemType", query.ItemType.Trim()));
        }

        if (query.MinConfidence.HasValue)
        {
            clauses.Add("AND r.match_confidence >= @minConfidence");
            parameters.Add(new("@minConfidence", query.MinConfidence.Value));
        }

        if (query.MaxConfidence.HasValue)
        {
            clauses.Add("AND r.match_confidence <= @maxConfidence");
            parameters.Add(new("@maxConfidence", query.MaxConfidence.Value));
        }

        if (query.AiReviewed.HasValue)
        {
            clauses.Add("AND r.ai_reviewed = @aiReviewed");
            parameters.Add(new("@aiReviewed", query.AiReviewed.Value ? 1 : 0));
        }

        if (!string.IsNullOrWhiteSpace(query.Reason))
        {
            clauses.Add("""
                AND EXISTS(
                    SELECT 1 FROM mq_reason reason
                    WHERE reason.generation_id = r.generation_id
                      AND reason.item_id = r.item_id
                      AND reason.code COLLATE PTV_ORDINAL_NOCASE = @reason COLLATE PTV_ORDINAL_NOCASE)
                """);
            parameters.Add(new("@reason", query.Reason.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.Provider))
        {
            clauses.Add("""
                AND (
                    r.current_provider_name COLLATE PTV_ORDINAL_NOCASE = @provider COLLATE PTV_ORDINAL_NOCASE
                    OR r.suggested_provider_name COLLATE PTV_ORDINAL_NOCASE = @provider COLLATE PTV_ORDINAL_NOCASE
                    OR EXISTS(
                        SELECT 1 FROM mq_provider_id provider
                        WHERE provider.generation_id = r.generation_id
                          AND provider.item_id = r.item_id
                          AND provider.provider_key COLLATE PTV_ORDINAL_NOCASE = @provider COLLATE PTV_ORDINAL_NOCASE))
                """);
            parameters.Add(new("@provider", query.Provider.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            clauses.Add("""
                AND (
                    ptv_ordinal_contains(r.title, @search) = 1
                    OR ptv_ordinal_contains(r.file_name, @search) = 1
                    OR EXISTS(
                        SELECT 1 FROM mq_provider_id provider
                        WHERE provider.generation_id = r.generation_id
                          AND provider.item_id = r.item_id
                          AND ptv_ordinal_contains(provider.provider_value, @search) = 1))
                """);
            parameters.Add(new("@search", query.Search.Trim()));
        }

        return string.Join(' ', clauses);
    }

    private static bool IsAnalysisStatus(string status) => status.Equals(PtvMetadataQualityStatuses.Healthy, StringComparison.OrdinalIgnoreCase)
        || status.Equals(PtvMetadataQualityStatuses.Review, StringComparison.OrdinalIgnoreCase)
        || status.Equals(PtvMetadataQualityStatuses.LikelyWrong, StringComparison.OrdinalIgnoreCase)
        || status.Equals(PtvMetadataQualityStatuses.Incomplete, StringComparison.OrdinalIgnoreCase)
        || status.Equals(PtvMetadataQualityStatuses.Unavailable, StringComparison.OrdinalIgnoreCase);

    private static string BuildOrderBy(string? sort, bool statusFiltered) => sort?.Trim().ToLowerInvariant() switch
    {
        "confidence" => "r.match_confidence ASC, r.title COLLATE PTV_ORDINAL_NOCASE ASC, r.source_ordinal ASC",
        "library" => "r.library_name COLLATE PTV_ORDINAL_NOCASE ASC, r.title COLLATE PTV_ORDINAL_NOCASE ASC, r.source_ordinal ASC",
        "recent" => "r.scanned_at_ticks DESC, r.source_ordinal ASC",
        "title" => "r.title COLLATE PTV_ORDINAL_NOCASE ASC, r.source_ordinal ASC",
        _ when statusFiltered => "r.match_confidence ASC, r.scanned_at_ticks DESC, r.source_ordinal ASC",
        _ => $"{StatusPrioritySql} ASC, r.match_confidence ASC, r.scanned_at_ticks DESC, r.source_ordinal ASC"
    };

    private static void AddParameters(SqliteCommand command, IEnumerable<KeyValuePair<string, object>> parameters)
    {
        foreach (var pair in parameters) command.Parameters.AddWithValue(pair.Key, pair.Value);
    }

    private const string DisplayStatusSql = """
        CASE
            WHEN o.item_id IS NOT NULL AND o.dismissed = 1 THEN 'dismissed'
            WHEN o.item_id IS NOT NULL AND o.resolution_state IN ('kept_current', 'corrected') THEN 'resolved'
            WHEN o.item_id IS NULL AND r.dismissed = 1 THEN 'dismissed'
            WHEN o.item_id IS NULL AND r.resolution_state IN ('kept_current', 'corrected') THEN 'resolved'
            ELSE r.raw_status
        END
        """;

    private const string StatusPrioritySql = $"""
        CASE ({DisplayStatusSql})
            WHEN 'likely_wrong' THEN 0
            WHEN 'review' THEN 1
            WHEN 'incomplete' THEN 2
            WHEN 'unavailable' THEN 3
            WHEN 'dismissed' THEN 4
            WHEN 'resolved' THEN 5
            ELSE 6
        END
        """;

    public async Task<PtvMetadataQualityGenerationHandle> BeginGenerationAsync(
        PtvMetadataQualityScanRun run,
        bool resetAllResults,
        IReadOnlyCollection<Guid> resetLibraryIds,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(run);
        await EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await using var connection = await OpenWriteConnectionAsync(cancellationToken).ConfigureAwait(false);
            var active = await ReadActiveGenerationAsync(connection, cancellationToken).ConfigureAwait(false)
                ?? throw new PtvMetadataQualityStoreException(
                    "PTV_METADATA_QUALITY_INDEX_UNAVAILABLE",
                    "Metadata Quality has no active generation to scan.");
            if (await HasGenerationInStateAsync(
                    connection,
                    GenerationValidating,
                    cancellationToken).ConfigureAwait(false))
            {
                throw new PtvMetadataQualityStoreException(
                    "PTV_METADATA_QUALITY_ACTIVATION_PENDING",
                    "A validated Metadata Quality generation is awaiting safe activation.");
            }

            var databaseLength = File.Exists(_databasePath) ? new FileInfo(_databasePath).Length : 0;
            var rollbackLength = File.Exists(_legacyStore.ResultsPath) ? new FileInfo(_legacyStore.ResultsPath).Length : 0;
            EnsureDiskHeadroom(checked(Math.Max(
                MinimumFreeSpaceReserveBytes,
                databaseLength + (rollbackLength * 2))));
            var generationId = Guid.NewGuid();
            using var transaction = connection.BeginTransaction();
            await InsertGenerationAsync(
                connection,
                transaction,
                generationId,
                GenerationBuilding,
                active.SourceSchemaVersion,
                PtvMetadataQualityConstants.ScannerVersion,
                PtvMetadataQualityConstants.RuleVersion,
                DateTimeOffset.UtcNow,
                active.LastFullScan,
                active.LastIncrementalScan,
                cancellationToken).ConfigureAwait(false);

            await using (var copyResults = connection.CreateCommand())
            {
                copyResults.Transaction = transaction;
                copyResults.CommandText = """
                    INSERT INTO mq_result(
                        generation_id, item_id, source_ordinal, library_id, library_name,
                        item_type, title, file_name, folder_name, scanned_at_ticks,
                        scan_fingerprint, scanner_version, rule_version, raw_status,
                        match_confidence, completeness_score, ai_reviewed, provider_verified,
                        current_provider_name, suggested_provider_name,
                        dismissed, dismissed_at_ticks, dismissed_fingerprint,
                        dismissed_reason_signature, resolution_state, resolution_json,
                        detail_json, seen)
                    SELECT @target, item_id, source_ordinal, library_id, library_name,
                        item_type, title, file_name, folder_name, scanned_at_ticks,
                        scan_fingerprint, scanner_version, rule_version, raw_status,
                        match_confidence, completeness_score, ai_reviewed, provider_verified,
                        current_provider_name, suggested_provider_name,
                        dismissed, dismissed_at_ticks, dismissed_fingerprint,
                        dismissed_reason_signature, resolution_state, resolution_json,
                        detail_json, 1
                    FROM mq_result WHERE generation_id = @source;

                    INSERT INTO mq_reason(generation_id, item_id, ordinal, code)
                    SELECT @target, item_id, ordinal, code
                    FROM mq_reason WHERE generation_id = @source;

                    INSERT INTO mq_provider_id(
                        generation_id, item_id, match_slot, ordinal, provider_key, provider_value)
                    SELECT @target, item_id, match_slot, ordinal, provider_key, provider_value
                    FROM mq_provider_id WHERE generation_id = @source;
                    """;
                copyResults.Parameters.AddWithValue("@target", ToKey(generationId));
                copyResults.Parameters.AddWithValue("@source", ToKey(active.GenerationId));
                await copyResults.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await using (var initialize = connection.CreateCommand())
            {
                initialize.Transaction = transaction;
                if (resetAllResults)
                {
                    initialize.CommandText = "UPDATE mq_result SET seen = 0 WHERE generation_id = @generation;";
                    initialize.Parameters.AddWithValue("@generation", ToKey(generationId));
                    await initialize.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
                }
                else if (resetLibraryIds.Count > 0)
                {
                    var names = AddGuidList(initialize, "@resetLibrary", resetLibraryIds);
                    initialize.CommandText = $"UPDATE mq_result SET seen = 0 WHERE generation_id = @generation AND library_id IN ({names});";
                    initialize.Parameters.AddWithValue("@generation", ToKey(generationId));
                    await initialize.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
                }
            }

            await using (var updateGeneration = connection.CreateCommand())
            {
                updateGeneration.Transaction = transaction;
                updateGeneration.CommandText = """
                    UPDATE mq_generation
                    SET next_ordinal = (SELECT COALESCE(MAX(source_ordinal) + 1, 0) FROM mq_result WHERE generation_id = @generation),
                        result_count = (SELECT COUNT(*) FROM mq_result WHERE generation_id = @generation)
                    WHERE generation_id = @generation;
                    """;
                updateGeneration.Parameters.AddWithValue("@generation", ToKey(generationId));
                await updateGeneration.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await UpsertRunAsync(connection, transaction, run, cancellationToken).ConfigureAwait(false);
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new PtvMetadataQualityGenerationHandle(generationId);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    public async Task<IReadOnlyDictionary<Guid, PtvMetadataQualityScanBaseline>> ReadScanBaselinesAsync(
        Guid generationId,
        IReadOnlyCollection<Guid> itemIds,
        CancellationToken cancellationToken = default)
    {
        if (generationId == Guid.Empty || itemIds.Count == 0)
        {
            return new Dictionary<Guid, PtvMetadataQualityScanBaseline>();
        }

        await EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
        await using var connection = await OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        var itemParameters = AddGuidList(command, "@item", itemIds);
        command.CommandText = $"""
            SELECT r.item_id, r.scan_fingerprint, r.scanner_version, r.rule_version, r.raw_status,
                   CASE WHEN o.item_id IS NULL THEN r.dismissed ELSE o.dismissed END,
                   CASE WHEN o.item_id IS NULL THEN r.dismissed_at_ticks ELSE o.dismissed_at_ticks END,
                   CASE WHEN o.item_id IS NULL THEN r.dismissed_fingerprint ELSE o.dismissed_fingerprint END,
                   CASE WHEN o.item_id IS NULL THEN r.dismissed_reason_signature ELSE o.dismissed_reason_signature END,
                   CASE WHEN o.item_id IS NULL THEN r.resolution_json ELSE o.resolution_json END
            FROM mq_result r
            LEFT JOIN mq_review_state o
                ON o.item_id = r.item_id AND o.scan_fingerprint = r.scan_fingerprint
            WHERE r.generation_id = @generation AND r.item_id IN ({itemParameters});
            """;
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        var results = new Dictionary<Guid, PtvMetadataQualityScanBaseline>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var itemId = Guid.ParseExact(reader.GetString(0), "N");
            results[itemId] = new PtvMetadataQualityScanBaseline
            {
                ItemId = itemId,
                ScanFingerprint = reader.GetString(1),
                ScannerVersion = reader.GetString(2),
                RuleVersion = reader.GetString(3),
                Status = reader.GetString(4),
                Dismissed = reader.GetInt64(5) != 0,
                DismissedAt = ReadNullableDate(reader, 6),
                DismissedFingerprint = ReadNullableString(reader, 7),
                DismissedReasonSignature = ReadNullableString(reader, 8),
                Resolution = DeserializeNullable<PtvMetadataQualityResolution>(ReadNullableString(reader, 9))
            };
        }

        return results;
    }

    public async Task<Dictionary<string, Guid>> ReadCurrentProviderIdentityMapAsync(
        Guid generationId,
        CancellationToken cancellationToken = default)
    {
        await EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
        await using var connection = await OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT p.item_id, p.provider_key, p.provider_value
            FROM mq_provider_id p
            INNER JOIN mq_result r
                ON r.generation_id = p.generation_id AND r.item_id = p.item_id
            WHERE p.generation_id = @generation AND p.match_slot = 0
            ORDER BY r.source_ordinal, p.ordinal;
            """;
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        var map = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var providerKey = reader.GetString(1);
            var providerValue = reader.GetString(2);
            if (string.IsNullOrWhiteSpace(providerKey) || string.IsNullOrWhiteSpace(providerValue)) continue;
            map.TryAdd(
                $"{providerKey.Trim().ToUpperInvariant()}:{providerValue.Trim()}",
                Guid.ParseExact(reader.GetString(0), "N"));
        }

        return map;
    }

    public async Task<bool> HasResultsInLibrariesAsync(
        Guid generationId,
        IReadOnlyCollection<Guid> libraryIds,
        CancellationToken cancellationToken = default)
    {
        if (libraryIds.Count == 0) return false;
        await EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
        await using var connection = await OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        var libraryParameters = AddGuidList(command, "@library", libraryIds);
        command.CommandText = $"SELECT EXISTS(SELECT 1 FROM mq_result WHERE generation_id = @generation AND library_id IN ({libraryParameters}) LIMIT 1);";
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        return Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false), CultureInfo.InvariantCulture) != 0;
    }

    public async Task WriteGenerationBatchAsync(
        Guid generationId,
        PtvMetadataQualityScanRun run,
        IReadOnlyDictionary<string, PtvMetadataQualityResult> changedResults,
        IReadOnlyCollection<Guid> seenItemIds,
        CancellationToken cancellationToken = default)
    {
        await EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await using var connection = await OpenWriteConnectionAsync(cancellationToken).ConfigureAwait(false);
            using var transaction = connection.BeginTransaction();
            var nextOrdinal = await ReadNextOrdinalAsync(connection, transaction, generationId, cancellationToken).ConfigureAwait(false);
            foreach (var result in changedResults.Values)
            {
                var existingOrdinal = await ReadSourceOrdinalAsync(
                    connection,
                    transaction,
                    generationId,
                    result.ItemId,
                    cancellationToken).ConfigureAwait(false);
                var ordinal = existingOrdinal ?? nextOrdinal++;
                await UpsertResultAsync(connection, transaction, generationId, result, ordinal, cancellationToken).ConfigureAwait(false);
            }

            if (seenItemIds.Count > 0)
            {
                await using var seen = connection.CreateCommand();
                seen.Transaction = transaction;
                var itemParameters = AddGuidList(seen, "@seen", seenItemIds);
                seen.CommandText = $"UPDATE mq_result SET seen = 1 WHERE generation_id = @generation AND item_id IN ({itemParameters});";
                seen.Parameters.AddWithValue("@generation", ToKey(generationId));
                await seen.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await using (var generation = connection.CreateCommand())
            {
                generation.Transaction = transaction;
                generation.CommandText = "UPDATE mq_generation SET next_ordinal = @next, updated_at_ticks = @updated WHERE generation_id = @generation AND state = @state;";
                generation.Parameters.AddWithValue("@next", nextOrdinal);
                generation.Parameters.AddWithValue("@updated", ToTicks(DateTimeOffset.UtcNow));
                generation.Parameters.AddWithValue("@generation", ToKey(generationId));
                generation.Parameters.AddWithValue("@state", GenerationBuilding);
                if (await generation.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false) != 1)
                {
                    throw new PtvMetadataQualityStoreException(
                        "PTV_METADATA_QUALITY_GENERATION_NOT_BUILDING",
                        "The Metadata Quality scan generation is no longer writable.");
                }
            }

            await UpsertRunAsync(connection, transaction, run, cancellationToken).ConfigureAwait(false);
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    public async Task CompleteGenerationAsync(
        Guid generationId,
        PtvMetadataQualityScanRun run,
        CancellationToken cancellationToken = default)
    {
        await EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await using var connection = await OpenWriteConnectionAsync(cancellationToken).ConfigureAwait(false);
            using (var transaction = connection.BeginTransaction())
            {
                await using (var delete = connection.CreateCommand())
                {
                    delete.Transaction = transaction;
                    delete.CommandText = "DELETE FROM mq_result WHERE generation_id = @generation AND seen = 0;";
                    delete.Parameters.AddWithValue("@generation", ToKey(generationId));
                    await delete.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
                }

                await using (var generation = connection.CreateCommand())
                {
                    generation.Transaction = transaction;
                    generation.CommandText = """
                        UPDATE mq_generation
                        SET completed_at_ticks = @completed,
                            updated_at_ticks = @completed,
                            scanner_version = @scanner,
                            rule_version = @rule,
                            last_full_scan_ticks = CASE WHEN @mode = 'full' THEN @completed ELSE last_full_scan_ticks END,
                            last_incremental_scan_ticks = CASE WHEN @mode = 'full' THEN last_incremental_scan_ticks ELSE @completed END
                        WHERE generation_id = @generation AND state = @state;
                        """;
                    generation.Parameters.AddWithValue("@completed", ToTicks(run.CompletedAt ?? DateTimeOffset.UtcNow));
                    generation.Parameters.AddWithValue("@scanner", PtvMetadataQualityConstants.ScannerVersion);
                    generation.Parameters.AddWithValue("@rule", PtvMetadataQualityConstants.RuleVersion);
                    generation.Parameters.AddWithValue("@mode", run.Mode);
                    generation.Parameters.AddWithValue("@generation", ToKey(generationId));
                    generation.Parameters.AddWithValue("@state", GenerationBuilding);
                    if (await generation.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false) != 1)
                    {
                        throw new PtvMetadataQualityStoreException(
                            "PTV_METADATA_QUALITY_GENERATION_NOT_BUILDING",
                            "The Metadata Quality scan generation could not be completed.");
                    }
                }

                await UpsertRunAsync(connection, transaction, run, cancellationToken).ConfigureAwait(false);
                await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
            }

            await ApplyReviewOverlaysToGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
            await ValidateGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
            await ExportAndMarkGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
            await ActivateGenerationAsync(connection, generationId, CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    public async Task FailGenerationAsync(
        Guid generationId,
        PtvMetadataQualityScanRun run,
        CancellationToken cancellationToken = default)
    {
        await EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await using var connection = await OpenWriteConnectionAsync(cancellationToken).ConfigureAwait(false);
            var candidate = await ReadGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
            if (candidate is null || candidate.State is GenerationActive or GenerationRetired or GenerationFailed)
            {
                return;
            }

            var recoverableHash = candidate.PendingSourceHash ?? candidate.SourceHash;
            var recoverableLength = candidate.PendingSourceLength ?? candidate.SourceLength;
            if (candidate.State == GenerationValidating
                && !string.IsNullOrWhiteSpace(recoverableHash)
                && File.Exists(_legacyStore.ResultsPath))
            {
                var sourceInfo = new FileInfo(_legacyStore.ResultsPath);
                if (sourceInfo.Length == recoverableLength)
                {
                    var installedHash = await ComputeFileHashAsync(
                        _legacyStore.ResultsPath,
                        cancellationToken).ConfigureAwait(false);
                    if (string.Equals(installedHash, recoverableHash, StringComparison.Ordinal))
                    {
                        _logger.LogWarning(
                            "PiggieTV Metadata Quality retained validated generation {GenerationId} for crash-safe activation recovery.",
                            generationId.ToString("N"));
                        return;
                    }
                }
            }

            using var transaction = connection.BeginTransaction();
            var transitionedToFailed = false;
            await using (var generation = connection.CreateCommand())
            {
                generation.Transaction = transaction;
                generation.CommandText = """
                    UPDATE mq_generation
                    SET state = @failed, completed_at_ticks = @completed
                    WHERE generation_id = @generation
                      AND state IN (@building, @validating);
                    """;
                generation.Parameters.AddWithValue("@failed", GenerationFailed);
                generation.Parameters.AddWithValue("@completed", ToTicks(run.CompletedAt ?? DateTimeOffset.UtcNow));
                generation.Parameters.AddWithValue("@generation", ToKey(generationId));
                generation.Parameters.AddWithValue("@building", GenerationBuilding);
                generation.Parameters.AddWithValue("@validating", GenerationValidating);
                transitionedToFailed = await generation.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false) == 1;
            }

            if (!transitionedToFailed)
            {
                await transaction.RollbackAsync(cancellationToken).ConfigureAwait(false);
                return;
            }

            await using (var discard = connection.CreateCommand())
            {
                discard.Transaction = transaction;
                discard.CommandText = "DELETE FROM mq_result WHERE generation_id = @generation;";
                discard.Parameters.AddWithValue("@generation", ToKey(generationId));
                await discard.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await UpsertRunAsync(connection, transaction, run, cancellationToken).ConfigureAwait(false);
            await using (var trim = connection.CreateCommand())
            {
                trim.Transaction = transaction;
                trim.CommandText = """
                    DELETE FROM mq_generation
                    WHERE state = @failed
                      AND generation_id NOT IN (
                          SELECT generation_id FROM mq_generation
                          WHERE state = @failed
                          ORDER BY completed_at_ticks DESC, created_at_ticks DESC
                          LIMIT 5);
                    """;
                trim.Parameters.AddWithValue("@failed", GenerationFailed);
                await trim.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    public async Task<PtvMetadataQualityResult?> ResolveAsync(
        Guid itemId,
        string action,
        CancellationToken cancellationToken = default)
    {
        if (itemId == Guid.Empty) return null;
        var normalizedAction = action?.Trim().ToLowerInvariant();
        if (normalizedAction is not ("keep_current" or "dismiss"))
        {
            throw new PtvMetadataQualityServiceException(
                "PTV_METADATA_QUALITY_ACTION_INVALID",
                "The requested review action is not supported.");
        }

        await EnsureReadyAsync(cancellationToken).ConfigureAwait(false);
        await _writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await using var connection = await OpenWriteConnectionAsync(cancellationToken).ConfigureAwait(false);
            var active = await ReadActiveGenerationAsync(connection, cancellationToken).ConfigureAwait(false)
                ?? throw new PtvMetadataQualityStoreException(
                    "PTV_METADATA_QUALITY_INDEX_UNAVAILABLE",
                    "Metadata Quality has no active generation.");
            var rollbackLength = File.Exists(_legacyStore.ResultsPath)
                ? new FileInfo(_legacyStore.ResultsPath).Length
                : active.SourceLength;
            EnsureDiskHeadroom(checked(MinimumFreeSpaceReserveBytes + Math.Max(active.SourceLength, rollbackLength)));
            var current = await ReadResultCoreAsync(connection, active.GenerationId, itemId, cancellationToken).ConfigureAwait(false);
            if (current is null) return null;
            var previous = PtvMetadataQualityProjection.CloneResult(current);
            var hadOverlay = await HasReviewOverlayAsync(
                connection,
                itemId,
                current.ScanFingerprint,
                cancellationToken).ConfigureAwait(false);

            var now = DateTimeOffset.UtcNow;
            current.Dismissed = normalizedAction == "dismiss";
            current.DismissedAt = current.Dismissed ? now : null;
            current.DismissedFingerprint = current.Dismissed ? current.ScanFingerprint : null;
            current.DismissedReasonSignature = current.Dismissed
                ? CreateReasonSignature(current.Reasons)
                : null;
            current.Resolution = new PtvMetadataQualityResolution
            {
                State = current.Dismissed ? "dismissed" : "kept_current",
                ResolvedAt = now,
                Fingerprint = current.ScanFingerprint,
                PreviousStatus = current.Status
            };

            var previousDisplayStatus = PtvMetadataQualityProjection.GetDisplayStatus(previous);
            var currentDisplayStatus = PtvMetadataQualityProjection.GetDisplayStatus(current);
            await WriteReviewOverlayAsync(
                connection,
                active.GenerationId,
                current,
                previousDisplayStatus,
                currentDisplayStatus,
                cancellationToken).ConfigureAwait(false);
            var snapshotReplaced = false;
            var snapshotStaged = false;
            try
            {
                var export = await ExportGenerationAsync(
                    connection,
                    active.GenerationId,
                    cancellationToken).ConfigureAwait(false);
                try
                {
                    await SetPendingSnapshotAsync(
                        connection,
                        active.GenerationId,
                        GenerationActive,
                        GenerationActive,
                        export,
                        cancellationToken).ConfigureAwait(false);
                    snapshotStaged = true;
                    cancellationToken.ThrowIfCancellationRequested();
                    ReplaceFile(export.TemporaryPath, _legacyStore.ResultsPath);
                    snapshotReplaced = true;
                    try
                    {
                        await PromotePendingSnapshotAsync(
                            connection,
                            active.GenerationId,
                            export.Hash,
                            CancellationToken.None).ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        // The indexed overlay and atomically replaced rollback snapshot are
                        // already durable. Do not report the explicit review action as failed;
                        // a later generation refresh will repair this advisory fingerprint.
                        _logger.LogWarning(
                            ex,
                            "PiggieTV Metadata Quality applied review state, but deferred rollback-snapshot fingerprint repair.");
                    }
                }
                finally
                {
                    TryDelete(export.TemporaryPath);
                }
            }
            catch
            {
                if (!snapshotReplaced)
                {
                    try
                    {
                        if (snapshotStaged)
                        {
                            await ClearPendingSnapshotAsync(
                                connection,
                                active.GenerationId,
                                CancellationToken.None).ConfigureAwait(false);
                        }

                        if (hadOverlay)
                        {
                            await WriteReviewOverlayAsync(
                                connection,
                                active.GenerationId,
                                previous,
                                currentDisplayStatus,
                                previousDisplayStatus,
                                CancellationToken.None).ConfigureAwait(false);
                        }
                        else
                        {
                            await DeleteReviewOverlayAsync(
                                connection,
                                active.GenerationId,
                                itemId,
                                current.ScanFingerprint,
                                currentDisplayStatus,
                                previousDisplayStatus,
                                CancellationToken.None).ConfigureAwait(false);
                        }
                    }
                    catch (Exception rollbackError)
                    {
                        _logger.LogError(
                            rollbackError,
                            "PiggieTV Metadata Quality could not restore review state after a rollback-snapshot failure.");
                    }
                }

                throw;
            }

            return PtvMetadataQualityProjection.CloneResult(current);
        }
        finally
        {
            _writeGate.Release();
        }
    }

    private static async Task ApplyReviewOverlaysToGenerationAsync(
        SqliteConnection connection,
        Guid generationId,
        CancellationToken cancellationToken)
    {
        long lastOrdinal = -1;
        while (true)
        {
            var overlays = new List<(PtvMetadataQualityResult Result, long Ordinal)>(ImportBatchSize);
            await using (var command = connection.CreateCommand())
            {
                command.CommandText = """
                    SELECT r.detail_json, r.source_ordinal,
                           o.dismissed, o.dismissed_at_ticks, o.dismissed_fingerprint,
                           o.dismissed_reason_signature, o.resolution_json
                    FROM mq_result r
                    INNER JOIN mq_review_state o
                        ON o.item_id = r.item_id AND o.scan_fingerprint = r.scan_fingerprint
                    WHERE r.generation_id = @generation AND r.source_ordinal > @lastOrdinal
                    ORDER BY r.source_ordinal
                    LIMIT @limit;
                    """;
                command.Parameters.AddWithValue("@generation", ToKey(generationId));
                command.Parameters.AddWithValue("@lastOrdinal", lastOrdinal);
                command.Parameters.AddWithValue("@limit", ImportBatchSize);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
                while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                {
                    var result = DeserializeResult(reader.GetString(0));
                    ApplyReviewOverlay(result, reader, 2);
                    overlays.Add((result, reader.GetInt64(1)));
                }
            }

            if (overlays.Count == 0) break;
            using var transaction = connection.BeginTransaction();
            foreach (var pair in overlays)
            {
                await UpsertResultAsync(
                    connection,
                    transaction,
                    generationId,
                    pair.Result,
                    pair.Ordinal,
                    cancellationToken).ConfigureAwait(false);
            }

            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
            lastOrdinal = overlays[^1].Ordinal;
        }
    }

    private static async Task<bool> HasReviewOverlayAsync(
        SqliteConnection connection,
        Guid itemId,
        string scanFingerprint,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT EXISTS(SELECT 1 FROM mq_review_state WHERE item_id = @item AND scan_fingerprint = @fingerprint);";
        command.Parameters.AddWithValue("@item", ToKey(itemId));
        command.Parameters.AddWithValue("@fingerprint", scanFingerprint ?? string.Empty);
        return Convert.ToInt64(
            await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false),
            CultureInfo.InvariantCulture) != 0;
    }

    private static async Task WriteReviewOverlayAsync(
        SqliteConnection connection,
        Guid generationId,
        PtvMetadataQualityResult result,
        string previousDisplayStatus,
        string currentDisplayStatus,
        CancellationToken cancellationToken)
    {
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO mq_review_state(
                item_id, scan_fingerprint, dismissed, dismissed_at_ticks,
                dismissed_fingerprint, dismissed_reason_signature,
                resolution_state, resolution_json, updated_at_ticks)
            VALUES(
                @item, @fingerprint, @dismissed, @dismissedAt,
                @dismissedFingerprint, @dismissedReasonSignature,
                @resolutionState, @resolutionJson, @updated)
            ON CONFLICT(item_id) DO UPDATE SET
                scan_fingerprint = excluded.scan_fingerprint,
                dismissed = excluded.dismissed,
                dismissed_at_ticks = excluded.dismissed_at_ticks,
                dismissed_fingerprint = excluded.dismissed_fingerprint,
                dismissed_reason_signature = excluded.dismissed_reason_signature,
                resolution_state = excluded.resolution_state,
                resolution_json = excluded.resolution_json,
                updated_at_ticks = excluded.updated_at_ticks;
            """;
        command.Parameters.AddWithValue("@item", ToKey(result.ItemId));
        command.Parameters.AddWithValue("@fingerprint", result.ScanFingerprint ?? string.Empty);
        command.Parameters.AddWithValue("@dismissed", result.Dismissed ? 1 : 0);
        command.Parameters.AddWithValue("@dismissedAt", ToDb(result.DismissedAt));
        command.Parameters.AddWithValue("@dismissedFingerprint", (object?)result.DismissedFingerprint ?? DBNull.Value);
        command.Parameters.AddWithValue("@dismissedReasonSignature", (object?)result.DismissedReasonSignature ?? DBNull.Value);
        command.Parameters.AddWithValue("@resolutionState", (object?)result.Resolution?.State ?? DBNull.Value);
        command.Parameters.AddWithValue(
            "@resolutionJson",
            result.Resolution is null
                ? DBNull.Value
                : JsonSerializer.Serialize(result.Resolution, JsonOptions));
        command.Parameters.AddWithValue("@updated", ToTicks(DateTimeOffset.UtcNow));
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        await UpdateGenerationCountTransitionAsync(
            connection,
            transaction,
            generationId,
            previousDisplayStatus,
            currentDisplayStatus,
            cancellationToken).ConfigureAwait(false);
        await MarkSnapshotDirtyAsync(connection, transaction, generationId, cancellationToken).ConfigureAwait(false);
        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task DeleteReviewOverlayAsync(
        SqliteConnection connection,
        Guid generationId,
        Guid itemId,
        string scanFingerprint,
        string previousDisplayStatus,
        string currentDisplayStatus,
        CancellationToken cancellationToken)
    {
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "DELETE FROM mq_review_state WHERE item_id = @item AND scan_fingerprint = @fingerprint;";
        command.Parameters.AddWithValue("@item", ToKey(itemId));
        command.Parameters.AddWithValue("@fingerprint", scanFingerprint ?? string.Empty);
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        await UpdateGenerationCountTransitionAsync(
            connection,
            transaction,
            generationId,
            previousDisplayStatus,
            currentDisplayStatus,
            cancellationToken).ConfigureAwait(false);
        await MarkSnapshotDirtyAsync(connection, transaction, generationId, cancellationToken).ConfigureAwait(false);
        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task MarkSnapshotDirtyAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        Guid generationId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "UPDATE mq_generation SET snapshot_dirty = 1 WHERE generation_id = @generation AND state = @active;";
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        command.Parameters.AddWithValue("@active", GenerationActive);
        if (await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false) != 1)
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_GENERATION_INVALID",
                "The Metadata Quality rollback snapshot could not be marked for synchronization.");
        }
    }

    private static async Task UpdateGenerationCountTransitionAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        Guid generationId,
        string previousDisplayStatus,
        string currentDisplayStatus,
        CancellationToken cancellationToken)
    {
        if (string.Equals(previousDisplayStatus, currentDisplayStatus, StringComparison.Ordinal)) return;

        var previousColumn = GetGenerationCountColumn(previousDisplayStatus);
        var currentColumn = GetGenerationCountColumn(currentDisplayStatus);
        if (previousColumn is null && currentColumn is null) return;

        var updates = new List<string>(2);
        if (previousColumn is not null) updates.Add($"{previousColumn} = {previousColumn} - 1");
        if (currentColumn is not null) updates.Add($"{currentColumn} = {currentColumn} + 1");

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"""
            UPDATE mq_generation
            SET {string.Join(", ", updates)}
            WHERE generation_id = @generation
              AND state = @active
              {(previousColumn is null ? string.Empty : $"AND {previousColumn} > 0")};
            """;
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        command.Parameters.AddWithValue("@active", GenerationActive);
        if (await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false) != 1)
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_GENERATION_INVALID",
                "The Metadata Quality review summary could not be updated safely.");
        }
    }

    private static string? GetGenerationCountColumn(string status) => status switch
    {
        PtvMetadataQualityStatuses.Healthy => "healthy_count",
        PtvMetadataQualityStatuses.Review => "review_count",
        PtvMetadataQualityStatuses.LikelyWrong => "likely_wrong_count",
        PtvMetadataQualityStatuses.Incomplete => "incomplete_count",
        PtvMetadataQualityStatuses.Unavailable => "unavailable_count",
        "dismissed" => "dismissed_count",
        "resolved" => "resolved_count",
        _ => null
    };

    private static async Task ValidateGenerationAsync(
        SqliteConnection connection,
        Guid generationId,
        CancellationToken cancellationToken)
    {
        await ValidateDatabaseAsync(connection, cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT
                (SELECT COUNT(*) FROM mq_result WHERE generation_id = @generation),
                (SELECT COUNT(DISTINCT item_id) FROM mq_result WHERE generation_id = @generation),
                (SELECT COUNT(DISTINCT source_ordinal) FROM mq_result WHERE generation_id = @generation),
                (SELECT source_schema_version FROM mq_generation WHERE generation_id = @generation),
                (SELECT COUNT(*) FROM pragma_foreign_key_check),
                (SELECT COUNT(*) FROM mq_result WHERE generation_id = @generation AND seen = 0),
                (SELECT COUNT(*) FROM mq_result WHERE generation_id = @generation AND json_valid(detail_json) <> 1),
                (SELECT COUNT(*) FROM mq_result
                    WHERE generation_id = @generation
                      AND CASE
                          WHEN json_valid(detail_json) <> 1 THEN 1
                          WHEN lower(replace(CAST(json_extract(detail_json, '$.itemId') AS TEXT), '-', '')) <> item_id THEN 1
                          WHEN COALESCE(CAST(json_extract(detail_json, '$.scanFingerprint') AS TEXT), '') <> scan_fingerprint THEN 1
                          WHEN COALESCE(CAST(json_extract(detail_json, '$.status') AS TEXT), '') <> raw_status THEN 1
                          ELSE 0
                      END = 1),
                (SELECT state FROM mq_generation WHERE generation_id = @generation),
                (SELECT result_count FROM mq_generation WHERE generation_id = @generation);
            """;
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_GENERATION_INVALID",
                "The Metadata Quality generation could not be validated.");
        }

        var count = reader.GetInt64(0);
        var itemCount = reader.GetInt64(1);
        var ordinalCount = reader.GetInt64(2);
        var sourceSchema = reader.GetInt32(3);
        var foreignKeyFailures = reader.GetInt64(4);
        var unseen = reader.GetInt64(5);
        var invalidJson = reader.GetInt64(6);
        var semanticMismatches = reader.GetInt64(7);
        var state = reader.GetString(8);
        var storedCount = reader.GetInt64(9);
        if (count != itemCount
            || count != ordinalCount
            || foreignKeyFailures != 0
            || unseen != 0
            || invalidJson != 0
            || semanticMismatches != 0
            || sourceSchema != PtvMetadataQualityConstants.SchemaVersion
            || state is not (GenerationBuilding or GenerationValidating)
            || (state == GenerationValidating && count != storedCount))
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_GENERATION_INVALID",
                "The Metadata Quality generation failed consistency validation.");
        }
    }

    private static async Task ValidateDatabaseAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA quick_check;";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false)
            || !string.Equals(reader.GetString(0), "ok", StringComparison.OrdinalIgnoreCase)
            || await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_INDEX_CORRUPT",
                "Metadata Quality indexed storage failed its integrity check.");
        }
    }

    private async Task ExportAndMarkGenerationAsync(
        SqliteConnection connection,
        Guid generationId,
        CancellationToken cancellationToken)
    {
        var fingerprint = await ComputeGenerationFingerprintAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
        using (var transaction = connection.BeginTransaction())
        {
            await UpdateGenerationCountsAsync(connection, transaction, generationId, cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                UPDATE mq_generation
                SET result_count = (SELECT COUNT(*) FROM mq_result WHERE generation_id = @generation),
                    next_ordinal = (SELECT COALESCE(MAX(source_ordinal) + 1, 0) FROM mq_result WHERE generation_id = @generation),
                    compatibility_fingerprint = @fingerprint,
                    completed_at_ticks = COALESCE(completed_at_ticks, @completed)
                WHERE generation_id = @generation AND state = @building;
                """;
            command.Parameters.AddWithValue("@generation", ToKey(generationId));
            command.Parameters.AddWithValue("@fingerprint", fingerprint);
            command.Parameters.AddWithValue("@completed", ToTicks(DateTimeOffset.UtcNow));
            command.Parameters.AddWithValue("@building", GenerationBuilding);
            if (await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false) != 1)
            {
                throw new PtvMetadataQualityStoreException(
                    "PTV_METADATA_QUALITY_GENERATION_INVALID",
                    "The Metadata Quality generation is not ready for activation.");
            }

            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        }

        var export = await ExportGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
        try
        {
            await SetPendingSnapshotAsync(
                connection,
                generationId,
                GenerationBuilding,
                GenerationValidating,
                export,
                cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            ReplaceFile(export.TemporaryPath, _legacyStore.ResultsPath);
            await PromotePendingSnapshotAsync(
                connection,
                generationId,
                export.Hash,
                CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            TryDelete(export.TemporaryPath);
        }
    }

    private async Task ActivateGenerationAsync(
        SqliteConnection connection,
        Guid generationId,
        CancellationToken cancellationToken)
    {
        await ValidateGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
        using var transaction = connection.BeginTransaction();
        await using (var verify = connection.CreateCommand())
        {
            verify.Transaction = transaction;
            verify.CommandText = "SELECT state, source_hash FROM mq_generation WHERE generation_id = @generation;";
            verify.Parameters.AddWithValue("@generation", ToKey(generationId));
            await using var reader = await verify.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false)
                || reader.GetString(0) != GenerationValidating
                || reader.IsDBNull(1))
            {
                throw new PtvMetadataQualityStoreException(
                    "PTV_METADATA_QUALITY_GENERATION_INVALID",
                    "The Metadata Quality generation is not valid for activation.");
            }
        }

        await using (var retire = connection.CreateCommand())
        {
            retire.Transaction = transaction;
            retire.CommandText = "UPDATE mq_generation SET state = @retired WHERE state = @active;";
            retire.Parameters.AddWithValue("@retired", GenerationRetired);
            retire.Parameters.AddWithValue("@active", GenerationActive);
            await retire.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using (var activate = connection.CreateCommand())
        {
            activate.Transaction = transaction;
            activate.CommandText = "UPDATE mq_generation SET state = @active, activated_at_ticks = @activated WHERE generation_id = @generation; UPDATE mq_store_state SET active_generation_id = @generation WHERE id = 1;";
            activate.Parameters.AddWithValue("@active", GenerationActive);
            activate.Parameters.AddWithValue("@activated", ToTicks(DateTimeOffset.UtcNow));
            activate.Parameters.AddWithValue("@generation", ToKey(generationId));
            await activate.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using (var overlay = connection.CreateCommand())
        {
            overlay.Transaction = transaction;
            overlay.CommandText = """
                DELETE FROM mq_review_state;
                INSERT INTO mq_review_state(
                    item_id, scan_fingerprint, dismissed, dismissed_at_ticks,
                    dismissed_fingerprint, dismissed_reason_signature,
                    resolution_state, resolution_json, updated_at_ticks)
                SELECT item_id, scan_fingerprint, dismissed, dismissed_at_ticks,
                    dismissed_fingerprint, dismissed_reason_signature,
                    resolution_state, resolution_json, @updated
                FROM mq_result
                WHERE generation_id = @generation
                  AND (dismissed = 1 OR resolution_state IS NOT NULL);
                """;
            overlay.Parameters.AddWithValue("@updated", ToTicks(DateTimeOffset.UtcNow));
            overlay.Parameters.AddWithValue("@generation", ToKey(generationId));
            await overlay.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await CleanupOldGenerationsAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "PiggieTV Metadata Quality activated generation {GenerationId}, but deferred old-generation cleanup.",
                generationId.ToString("N"));
        }
    }

    private async Task<GenerationExport> ExportGenerationAsync(
        SqliteConnection connection,
        Guid generationId,
        CancellationToken cancellationToken)
    {
        var generation = await ReadGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false)
            ?? throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_GENERATION_INVALID",
                "The Metadata Quality generation could not be exported.");
        var runs = await ReadRunsAsync(connection, cancellationToken).ConfigureAwait(false);
        var temporaryPath = Path.Combine(_directory, $".metadata-quality.{generationId:N}.tmp");
        try
        {
            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.Create,
                FileAccess.Write,
                FileShare.None,
                131072,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            await using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = false }))
            {
                writer.WriteStartObject();
                writer.WriteNumber("schemaVersion", generation.SourceSchemaVersion);
                writer.WriteString("scannerVersion", generation.ScannerVersion);
                writer.WriteString("ruleVersion", generation.RuleVersion);
                writer.WriteString("updatedAt", generation.UpdatedAt);
                if (generation.LastFullScan.HasValue) writer.WriteString("lastFullScan", generation.LastFullScan.Value);
                else writer.WriteNull("lastFullScan");
                if (generation.LastIncrementalScan.HasValue) writer.WriteString("lastIncrementalScan", generation.LastIncrementalScan.Value);
                else writer.WriteNull("lastIncrementalScan");
                writer.WritePropertyName("itemResults");
                writer.WriteStartObject();

                await using (var command = connection.CreateCommand())
                {
                    command.CommandText = """
                        SELECT r.item_id, r.detail_json,
                               o.dismissed, o.dismissed_at_ticks, o.dismissed_fingerprint,
                               o.dismissed_reason_signature, o.resolution_json
                        FROM mq_result r
                        LEFT JOIN mq_review_state o
                            ON o.item_id = r.item_id AND o.scan_fingerprint = r.scan_fingerprint
                        WHERE r.generation_id = @generation
                        ORDER BY r.source_ordinal;
                        """;
                    command.Parameters.AddWithValue("@generation", ToKey(generationId));
                    await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
                    while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        writer.WritePropertyName(reader.GetString(0));
                        if (reader.IsDBNull(2))
                        {
                            writer.WriteRawValue(reader.GetString(1), skipInputValidation: false);
                        }
                        else
                        {
                            var result = DeserializeResult(reader.GetString(1));
                            ApplyReviewOverlay(result, reader, 2);
                            JsonSerializer.Serialize(writer, result, JsonOptions);
                        }
                    }
                }

                writer.WriteEndObject();
                writer.WritePropertyName("scanRuns");
                JsonSerializer.Serialize(writer, runs, JsonOptions);
                writer.WriteEndObject();
                await writer.FlushAsync(cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                stream.Flush(flushToDisk: true);
            }

            var length = new FileInfo(temporaryPath).Length;
            var hash = await ComputeFileHashAsync(temporaryPath, cancellationToken).ConfigureAwait(false);
            return new GenerationExport(temporaryPath, hash, length);
        }
        catch
        {
            TryDelete(temporaryPath);
            throw;
        }
    }

    private static async Task<string> ComputeGenerationFingerprintAsync(
        SqliteConnection connection,
        Guid generationId,
        CancellationToken cancellationToken)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT item_id, detail_json FROM mq_result WHERE generation_id = @generation ORDER BY source_ordinal;";
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            cancellationToken.ThrowIfCancellationRequested();
            hash.AppendData(System.Text.Encoding.UTF8.GetBytes(reader.GetString(0)));
            hash.AppendData([0]);
            hash.AppendData(System.Text.Encoding.UTF8.GetBytes(reader.GetString(1)));
            hash.AppendData([0xff]);
        }

        return Convert.ToHexString(hash.GetHashAndReset());
    }

    private static async Task UpdateGenerationCountsAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        Guid generationId,
        CancellationToken cancellationToken)
    {
        var counts = new Dictionary<string, long>(StringComparer.Ordinal);
        await using (var count = connection.CreateCommand())
        {
            count.Transaction = transaction;
            count.CommandText = $"""
                SELECT {DisplayStatusSql} AS display_status, COUNT(*)
                FROM mq_result r
                LEFT JOIN mq_review_state o
                    ON o.item_id = r.item_id AND o.scan_fingerprint = r.scan_fingerprint
                WHERE r.generation_id = @generation
                GROUP BY display_status;
                """;
            count.Parameters.AddWithValue("@generation", ToKey(generationId));
            await using var reader = await count.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                counts[reader.IsDBNull(0) ? string.Empty : reader.GetString(0)] = reader.GetInt64(1);
            }
        }

        await using var update = connection.CreateCommand();
        update.Transaction = transaction;
        update.CommandText = """
            UPDATE mq_generation SET
                result_count = (SELECT COUNT(*) FROM mq_result WHERE generation_id = @generation),
                healthy_count = @healthy,
                review_count = @review,
                likely_wrong_count = @likelyWrong,
                incomplete_count = @incomplete,
                unavailable_count = @unavailable,
                dismissed_count = @dismissed,
                resolved_count = @resolved
            WHERE generation_id = @generation;
            """;
        update.Parameters.AddWithValue("@generation", ToKey(generationId));
        update.Parameters.AddWithValue("@healthy", counts.GetValueOrDefault(PtvMetadataQualityStatuses.Healthy));
        update.Parameters.AddWithValue("@review", counts.GetValueOrDefault(PtvMetadataQualityStatuses.Review));
        update.Parameters.AddWithValue("@likelyWrong", counts.GetValueOrDefault(PtvMetadataQualityStatuses.LikelyWrong));
        update.Parameters.AddWithValue("@incomplete", counts.GetValueOrDefault(PtvMetadataQualityStatuses.Incomplete));
        update.Parameters.AddWithValue("@unavailable", counts.GetValueOrDefault(PtvMetadataQualityStatuses.Unavailable));
        update.Parameters.AddWithValue("@dismissed", counts.GetValueOrDefault("dismissed"));
        update.Parameters.AddWithValue("@resolved", counts.GetValueOrDefault("resolved"));
        await update.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task UpsertRunAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        PtvMetadataQualityScanRun run,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO mq_scan_run(run_id, started_at_ticks, state, run_json)
            VALUES(@run, @started, @state, @json)
            ON CONFLICT(run_id) DO UPDATE SET
                started_at_ticks = excluded.started_at_ticks,
                state = excluded.state,
                run_json = excluded.run_json;

            DELETE FROM mq_scan_run
            WHERE run_id IN (
                SELECT run_id FROM mq_scan_run
                ORDER BY started_at_ticks DESC, rowid DESC
                LIMIT -1 OFFSET @maximumRuns);
            """;
        command.Parameters.AddWithValue("@run", ToKey(run.RunId));
        command.Parameters.AddWithValue("@started", ToTicks(run.StartedAt));
        command.Parameters.AddWithValue("@state", run.State);
        command.Parameters.AddWithValue("@json", JsonSerializer.Serialize(run, JsonOptions));
        command.Parameters.AddWithValue("@maximumRuns", PtvMetadataQualityConstants.MaximumRunHistory);
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static PtvMetadataQualityScanRun NormalizeInterruptedImportedRun(
        PtvMetadataQualityScanRun run,
        DateTimeOffset interruptionTime)
    {
        if (run.State != PtvMetadataQualityScanStates.Running)
        {
            return run;
        }

        run.State = PtvMetadataQualityScanStates.Interrupted;
        run.CompletedAt = interruptionTime;
        run.ErrorCode ??= "PTV_METADATA_QUALITY_SCAN_INTERRUPTED";
        return run;
    }

    private static async Task<List<PtvMetadataQualityScanRun>> ReadRunsAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        var runs = new List<PtvMetadataQualityScanRun>();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT run_json FROM mq_scan_run ORDER BY started_at_ticks ASC, rowid ASC;";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var run = JsonSerializer.Deserialize<PtvMetadataQualityScanRun>(reader.GetString(0), JsonOptions);
            if (run is not null) runs.Add(run);
        }

        return runs.TakeLast(PtvMetadataQualityConstants.MaximumRunHistory).ToList();
    }

    private static async Task<PtvMetadataQualityScanRun?> ReadLatestRunAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken,
        SqliteTransaction? transaction = null)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT run_json FROM mq_scan_run ORDER BY started_at_ticks DESC, rowid ASC LIMIT 1;";
        var json = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) as string;
        return string.IsNullOrWhiteSpace(json)
            ? null
            : JsonSerializer.Deserialize<PtvMetadataQualityScanRun>(json, JsonOptions);
    }

    private static async Task<GenerationRecord?> ReadActiveGenerationAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken,
        SqliteTransaction? transaction = null)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT g.generation_id, g.state, g.source_hash, g.source_length,
                   g.pending_source_hash, g.pending_source_length,
                   g.source_schema_version, g.scanner_version, g.rule_version,
                   g.updated_at_ticks, g.last_full_scan_ticks,
                   g.last_incremental_scan_ticks, g.compatibility_fingerprint
            FROM mq_store_state s
            JOIN mq_generation g ON g.generation_id = s.active_generation_id
            WHERE s.id = 1 AND g.state = @active;
            """;
        command.Parameters.AddWithValue("@active", GenerationActive);
        return await ReadGenerationRecordAsync(command, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<GenerationRecord?> ReadGenerationAsync(
        SqliteConnection connection,
        Guid generationId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT generation_id, state, source_hash, source_length,
                   pending_source_hash, pending_source_length,
                   source_schema_version, scanner_version, rule_version,
                   updated_at_ticks, last_full_scan_ticks,
                   last_incremental_scan_ticks, compatibility_fingerprint
            FROM mq_generation WHERE generation_id = @generation;
            """;
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        return await ReadGenerationRecordAsync(command, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<GenerationRecord?> ReadGenerationRecordAsync(
        SqliteCommand command,
        CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false)) return null;
        return new GenerationRecord(
            Guid.ParseExact(reader.GetString(0), "N"),
            reader.GetString(1),
            ReadNullableString(reader, 2),
            reader.GetInt64(3),
            ReadNullableString(reader, 4),
            reader.IsDBNull(5) ? null : reader.GetInt64(5),
            reader.GetInt32(6),
            reader.GetString(7),
            reader.GetString(8),
            FromTicks(reader.GetInt64(9)),
            ReadNullableDate(reader, 10),
            ReadNullableDate(reader, 11),
            ReadNullableString(reader, 12));
    }

    private static async Task<Guid> ReadActiveGenerationIdAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken,
        SqliteTransaction? transaction = null)
    {
        var active = await ReadActiveGenerationAsync(connection, cancellationToken, transaction).ConfigureAwait(false);
        return active?.GenerationId
            ?? throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_INDEX_UNAVAILABLE",
                "Metadata Quality has no active indexed generation.");
    }

    private static async Task<Guid?> FindGenerationBySourceHashAsync(
        SqliteConnection connection,
        string sourceHash,
        string state,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT generation_id FROM mq_generation WHERE source_hash = @hash AND state = @state ORDER BY created_at_ticks DESC LIMIT 1;";
        command.Parameters.AddWithValue("@hash", sourceHash);
        command.Parameters.AddWithValue("@state", state);
        var value = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) as string;
        return Guid.TryParseExact(value, "N", out var generationId) ? generationId : null;
    }

    private static async Task<bool> HasGenerationInStateAsync(
        SqliteConnection connection,
        string state,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT EXISTS(SELECT 1 FROM mq_generation WHERE state = @state);";
        command.Parameters.AddWithValue("@state", state);
        return Convert.ToInt64(
            await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false),
            CultureInfo.InvariantCulture) != 0;
    }

    private static async Task<bool> HasPendingSnapshotAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT EXISTS(SELECT 1 FROM mq_generation WHERE pending_source_hash IS NOT NULL OR (state = @active AND snapshot_dirty = 1));";
        command.Parameters.AddWithValue("@active", GenerationActive);
        return Convert.ToInt64(
            await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false),
            CultureInfo.InvariantCulture) != 0;
    }

    private async Task<string?> RecoverPendingSnapshotsAsync(
        SqliteConnection connection,
        string? installedLegacyHash,
        CancellationToken cancellationToken)
    {
        var pendingGenerationIds = new List<Guid>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT generation_id FROM mq_generation WHERE pending_source_hash IS NOT NULL ORDER BY created_at_ticks;";
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                pendingGenerationIds.Add(Guid.ParseExact(reader.GetString(0), "N"));
            }
        }

        foreach (var generationId in pendingGenerationIds)
        {
            var generation = await ReadGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
            if (generation?.PendingSourceHash is null) continue;

            if (generation.State == GenerationActive)
            {
                var estimatedLength = Math.Max(
                    generation.SourceLength,
                    generation.PendingSourceLength ?? generation.SourceLength);
                EnsureDiskHeadroom(checked(MinimumFreeSpaceReserveBytes + estimatedLength));
                var export = await ExportGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
                try
                {
                    if (!string.Equals(export.Hash, generation.PendingSourceHash, StringComparison.Ordinal))
                    {
                        await SetPendingSnapshotAsync(
                            connection,
                            generationId,
                            GenerationActive,
                            GenerationActive,
                            export,
                            cancellationToken).ConfigureAwait(false);
                    }

                    if (!string.Equals(installedLegacyHash, export.Hash, StringComparison.Ordinal))
                    {
                        ReplaceFile(export.TemporaryPath, _legacyStore.ResultsPath);
                    }

                    installedLegacyHash = export.Hash;
                    await PromotePendingSnapshotAsync(
                        connection,
                        generationId,
                        export.Hash,
                        cancellationToken).ConfigureAwait(false);
                }
                finally
                {
                    TryDelete(export.TemporaryPath);
                }

                continue;
            }

            if (string.Equals(installedLegacyHash, generation.PendingSourceHash, StringComparison.Ordinal))
            {
                await PromotePendingSnapshotAsync(
                    connection,
                    generationId,
                    generation.PendingSourceHash,
                    cancellationToken).ConfigureAwait(false);
                continue;
            }

            await ClearPendingSnapshotAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
        }

        return installedLegacyHash;
    }

    private async Task<string?> RecoverDirtyActiveSnapshotAsync(
        SqliteConnection connection,
        string? installedLegacyHash,
        CancellationToken cancellationToken)
    {
        Guid generationId;
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT generation_id FROM mq_generation WHERE state = @active AND snapshot_dirty = 1 LIMIT 1;";
            command.Parameters.AddWithValue("@active", GenerationActive);
            var value = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) as string;
            if (!Guid.TryParseExact(value, "N", out generationId))
            {
                return installedLegacyHash;
            }
        }

        var generation = await ReadGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false)
            ?? throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_INDEX_CORRUPT",
                "Metadata Quality could not recover its review-state rollback snapshot.");
        EnsureDiskHeadroom(checked(MinimumFreeSpaceReserveBytes + generation.SourceLength));
        var export = await ExportGenerationAsync(connection, generationId, cancellationToken).ConfigureAwait(false);
        try
        {
            await SetPendingSnapshotAsync(
                connection,
                generationId,
                GenerationActive,
                GenerationActive,
                export,
                cancellationToken).ConfigureAwait(false);
            ReplaceFile(export.TemporaryPath, _legacyStore.ResultsPath);
            await PromotePendingSnapshotAsync(
                connection,
                generationId,
                export.Hash,
                CancellationToken.None).ConfigureAwait(false);
            return export.Hash;
        }
        finally
        {
            TryDelete(export.TemporaryPath);
        }
    }

    private static async Task SetPendingSnapshotAsync(
        SqliteConnection connection,
        Guid generationId,
        string expectedState,
        string nextState,
        GenerationExport export,
        CancellationToken cancellationToken)
    {
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE mq_generation
            SET state = @nextState,
                pending_source_hash = @hash,
                pending_source_length = @length
            WHERE generation_id = @generation AND state = @state;
            """;
        command.Parameters.AddWithValue("@hash", export.Hash);
        command.Parameters.AddWithValue("@length", export.Length);
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        command.Parameters.AddWithValue("@state", expectedState);
        command.Parameters.AddWithValue("@nextState", nextState);
        if (await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false) != 1)
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_GENERATION_INVALID",
                "The Metadata Quality rollback snapshot could not be staged safely.");
        }

        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task PromotePendingSnapshotAsync(
        SqliteConnection connection,
        Guid generationId,
        string expectedHash,
        CancellationToken cancellationToken)
    {
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE mq_generation
            SET source_hash = pending_source_hash,
                source_length = pending_source_length,
                pending_source_hash = NULL,
                pending_source_length = NULL,
                snapshot_dirty = 0
            WHERE generation_id = @generation
              AND pending_source_hash = @hash;
            """;
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        command.Parameters.AddWithValue("@hash", expectedHash);
        if (await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false) != 1)
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_GENERATION_INVALID",
                "The Metadata Quality rollback snapshot could not be committed safely.");
        }

        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task ClearPendingSnapshotAsync(
        SqliteConnection connection,
        Guid generationId,
        CancellationToken cancellationToken)
    {
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE mq_generation
            SET pending_source_hash = NULL,
                pending_source_length = NULL
            WHERE generation_id = @generation;
            """;
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task<long> ReadNextOrdinalAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        Guid generationId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT next_ordinal FROM mq_generation WHERE generation_id = @generation AND state = @state;";
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        command.Parameters.AddWithValue("@state", GenerationBuilding);
        var value = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        if (value is null)
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_GENERATION_NOT_BUILDING",
                "The Metadata Quality scan generation is no longer writable.");
        }

        return Convert.ToInt64(value, CultureInfo.InvariantCulture);
    }

    private static async Task<long?> ReadSourceOrdinalAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        Guid generationId,
        Guid itemId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT source_ordinal FROM mq_result WHERE generation_id = @generation AND item_id = @item;";
        command.Parameters.AddWithValue("@generation", ToKey(generationId));
        command.Parameters.AddWithValue("@item", ToKey(itemId));
        var value = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return value is null ? null : Convert.ToInt64(value, CultureInfo.InvariantCulture);
    }

    private static async Task CleanupOldGenerationsAsync(
        SqliteConnection connection,
        Guid activeGenerationId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
            DELETE FROM mq_generation
            WHERE state = @retired
              AND generation_id NOT IN (
                  SELECT generation_id FROM mq_generation
                  WHERE state = @retired
                  ORDER BY activated_at_ticks DESC
                  LIMIT 1);

            DELETE FROM mq_result
            WHERE generation_id IN (SELECT generation_id FROM mq_generation WHERE state = @failed);
            DELETE FROM mq_reason
            WHERE generation_id IN (SELECT generation_id FROM mq_generation WHERE state = @failed);
            DELETE FROM mq_provider_id
            WHERE generation_id IN (SELECT generation_id FROM mq_generation WHERE state = @failed);
            """;
        command.Parameters.AddWithValue("@retired", GenerationRetired);
        command.Parameters.AddWithValue("@failed", GenerationFailed);
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<string?> GetErrorCodeAsync(CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        return _errorCode;
    }

    private static void ApplyReviewOverlay(PtvMetadataQualityResult result, SqliteDataReader reader, int firstColumn)
    {
        if (reader.IsDBNull(firstColumn)) return;
        result.Dismissed = reader.GetInt64(firstColumn) != 0;
        result.DismissedAt = ReadNullableDate(reader, firstColumn + 1);
        result.DismissedFingerprint = ReadNullableString(reader, firstColumn + 2);
        result.DismissedReasonSignature = ReadNullableString(reader, firstColumn + 3);
        result.Resolution = DeserializeNullable<PtvMetadataQualityResolution>(ReadNullableString(reader, firstColumn + 4));
    }

    private static PtvMetadataQualityResult DeserializeResult(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<PtvMetadataQualityResult>(json, JsonOptions)
                ?? throw new PtvMetadataQualityStoreException(
                    "PTV_METADATA_QUALITY_INDEX_CORRUPT",
                    "A Metadata Quality indexed result could not be read safely.");
        }
        catch (JsonException ex)
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_INDEX_CORRUPT",
                "A Metadata Quality indexed result could not be read safely.",
                ex);
        }
    }

    private static T? DeserializeNullable<T>(string? json) where T : class
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            return JsonSerializer.Deserialize<T>(json, JsonOptions);
        }
        catch (JsonException ex)
        {
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_INDEX_CORRUPT",
                "Metadata Quality review state could not be read safely.",
                ex);
        }
    }

    private static PtvMetadataQualityRequestDiagnostics CreateIndexedDiagnostics(
        string cacheState,
        long started,
        int evaluated,
        int rows,
        long databaseQueries) => new()
    {
        CacheState = cacheState,
        TotalMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds,
        PersistedResultsLoaded = 0,
        ItemsEvaluated = evaluated,
        RowsReturned = rows,
        Stages = new Dictionary<string, double>(StringComparer.Ordinal)
        {
            ["indexedQuery"] = Stopwatch.GetElapsedTime(started).TotalMilliseconds
        },
        Operations = new Dictionary<string, long>(StringComparer.Ordinal)
        {
            ["databaseQueries"] = databaseQueries,
            ["storeFileReads"] = 0,
            ["jsonDeserializations"] = rows,
            ["metadataWrites"] = 0,
            ["providerRequests"] = 0,
            ["archiveReads"] = 0
        }
    };

    private static string AddGuidList(SqliteCommand command, string prefix, IEnumerable<Guid> ids)
    {
        var names = new List<string>();
        var index = 0;
        foreach (var id in ids.Where(id => id != Guid.Empty).Distinct())
        {
            var name = $"{prefix}{index++}";
            command.Parameters.AddWithValue(name, ToKey(id));
            names.Add(name);
        }

        return names.Count == 0 ? "NULL" : string.Join(',', names);
    }

    private static async Task ExecuteNonQueryAsync(
        SqliteConnection connection,
        string sql,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task<string> ComputeFileHashAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 131072, FileOptions.Asynchronous | FileOptions.SequentialScan);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false));
    }

    private void EnsureDiskHeadroom(long estimatedAdditionalBytes)
    {
        try
        {
            var root = Path.GetPathRoot(_directory);
            if (string.IsNullOrWhiteSpace(root)) return;
            var available = new DriveInfo(root).AvailableFreeSpace;
            if (available >= estimatedAdditionalBytes) return;
            throw new PtvMetadataQualityStoreException(
                "PTV_METADATA_QUALITY_STORAGE_SPACE_LOW",
                "Metadata Quality does not have enough free storage to build a recoverable indexed generation.");
        }
        catch (PtvMetadataQualityStoreException)
        {
            throw;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            _logger.LogWarning(
                ex,
                "PiggieTV Metadata Quality could not verify free-space headroom before an indexed-store write.");
        }
    }

    private void PruneRebuildBackups(int maximumBackups)
    {
        try
        {
            var backups = Directory
                .EnumerateFiles(_directory, $"{DatabaseFileName}.replaced-*.bak", SearchOption.TopDirectoryOnly)
                .Select(path => new FileInfo(path))
                .OrderByDescending(file => file.LastWriteTimeUtc)
                .ThenByDescending(file => file.Name, StringComparer.Ordinal)
                .Skip(Math.Max(0, maximumBackups))
                .ToArray();

            foreach (var backup in backups)
            {
                backup.Delete();
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.LogWarning(ex, "PiggieTV Metadata Quality deferred old index-backup cleanup.");
        }
    }

    private static string CreateReasonSignature(IEnumerable<PtvMetadataQualityReason> reasons) => string.Join(
        '|',
        reasons.Select(reason => reason.Code)
            .Where(code => !string.IsNullOrWhiteSpace(code))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal));

    private static void ReplaceFile(string temporaryPath, string destination)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
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
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            // Best effort cleanup; preserve the primary operation outcome.
        }
    }

    private static object ToDb(DateTimeOffset? value) => value.HasValue ? ToTicks(value.Value) : DBNull.Value;

    private static long ToTicks(DateTimeOffset value) => value.UtcDateTime.Ticks;

    private static DateTimeOffset FromTicks(long value) => new(new DateTime(value, DateTimeKind.Utc));

    private static DateTimeOffset? ReadNullableDate(SqliteDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : FromTicks(reader.GetInt64(ordinal));

    private static string? ReadNullableString(SqliteDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    private static string ToKey(Guid value) => value.ToString("N");

    private static DateTimeOffset? Max(DateTimeOffset? left, DateTimeOffset? right) =>
        left.HasValue && right.HasValue
            ? (left.Value >= right.Value ? left : right)
            : left ?? right;

    private sealed record GenerationRecord(
        Guid GenerationId,
        string State,
        string? SourceHash,
        long SourceLength,
        string? PendingSourceHash,
        long? PendingSourceLength,
        int SourceSchemaVersion,
        string ScannerVersion,
        string RuleVersion,
        DateTimeOffset UpdatedAt,
        DateTimeOffset? LastFullScan,
        DateTimeOffset? LastIncrementalScan,
        string? CompatibilityFingerprint);

    private sealed record GenerationExport(string TemporaryPath, string Hash, long Length);

    private sealed record ImportResult(PtvMetadataQualityResult Result, long SourceOrdinal);
}
