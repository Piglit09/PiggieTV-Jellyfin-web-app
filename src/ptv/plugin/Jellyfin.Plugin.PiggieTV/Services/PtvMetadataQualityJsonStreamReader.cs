using System.Buffers;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Root metadata read from a Metadata Quality document without materializing its item-results dictionary.
/// </summary>
internal sealed record PtvMetadataQualityJsonHeader(
    int SchemaVersion,
    string? ScannerVersion,
    string? RuleVersion,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? LastFullScan,
    DateTimeOffset? LastIncrementalScan,
    IReadOnlyList<PtvMetadataQualityScanRun> ScanRuns,
    long ItemResultCount);

/// <summary>
/// Incrementally reads the authoritative Metadata Quality JSON document while bounding retained JSON bytes.
/// </summary>
internal static class PtvMetadataQualityJsonStreamReader
{
    internal const int DefaultInitialBufferSize = 16 * 1024;
    internal const int DefaultMaximumBufferSize = 4 * 1024 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Reads root metadata and invokes <paramref name="onItemResult"/> once for every non-null item result,
    /// in JSON source order. Source ordinals are zero-based dictionary-entry positions.
    /// </summary>
    internal static Task<PtvMetadataQualityJsonHeader> ReadAsync(
        Stream source,
        Func<string, PtvMetadataQualityResult, long, CancellationToken, ValueTask> onItemResult,
        CancellationToken cancellationToken = default)
        => ReadAsync(
            source,
            onItemResult,
            DefaultInitialBufferSize,
            DefaultMaximumBufferSize,
            cancellationToken);

    /// <summary>
    /// Testable overload that controls the retained JSON-byte bounds.
    /// </summary>
    internal static async Task<PtvMetadataQualityJsonHeader> ReadAsync(
        Stream source,
        Func<string, PtvMetadataQualityResult, long, CancellationToken, ValueTask> onItemResult,
        int initialBufferSize,
        int maximumBufferSize,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(onItemResult);
        if (!source.CanRead) throw new ArgumentException("The Metadata Quality JSON source must be readable.", nameof(source));
        if (initialBufferSize <= 0) throw new ArgumentOutOfRangeException(nameof(initialBufferSize));
        if (maximumBufferSize < initialBufferSize) throw new ArgumentOutOfRangeException(nameof(maximumBufferSize));

        var logicalCapacity = initialBufferSize;
        var buffer = ArrayPool<byte>.Shared.Rent(logicalCapacity);
        var bufferedOffset = 0;
        var bufferedLength = 0;
        var isFinalBlock = false;
        var jsonState = new JsonReaderState();
        var parser = new ParserState();

        try
        {
            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();

                if (bufferedLength == 0 && !isFinalBlock)
                {
                    bufferedOffset = 0;
                    var read = await source.ReadAsync(
                        buffer.AsMemory(0, logicalCapacity),
                        cancellationToken).ConfigureAwait(false);
                    isFinalBlock = read == 0;
                    bufferedLength = read;
                }

                var outcome = ParseAvailable(
                    buffer.AsSpan(bufferedOffset, bufferedLength),
                    isFinalBlock,
                    jsonState,
                    parser);
                jsonState = outcome.ReaderState;
                bufferedOffset += outcome.BytesConsumed;
                bufferedLength -= outcome.BytesConsumed;

                if (outcome.Item is not null)
                {
                    await onItemResult(
                        outcome.Item.Key,
                        outcome.Item.Result,
                        outcome.Item.SourceOrdinal,
                        cancellationToken).ConfigureAwait(false);
                    continue;
                }

                if (!outcome.NeedsMoreData)
                {
                    continue;
                }

                if (isFinalBlock)
                {
                    parser.ValidateComplete();
                    return parser.CreateHeader();
                }

                if (bufferedOffset > 0)
                {
                    if (bufferedLength > 0)
                    {
                        buffer.AsSpan(bufferedOffset, bufferedLength).CopyTo(buffer);
                    }

                    bufferedOffset = 0;
                }

                if (bufferedLength == logicalCapacity)
                {
                    if (logicalCapacity >= maximumBufferSize)
                    {
                        throw new JsonException(
                            $"A Metadata Quality JSON token or item exceeded the {maximumBufferSize}-byte streaming limit.");
                    }

                    var nextCapacity = Math.Min(
                        maximumBufferSize,
                        Math.Max(checked(logicalCapacity * 2), bufferedLength + 1));
                    var replacement = ArrayPool<byte>.Shared.Rent(nextCapacity);
                    buffer.AsSpan(0, bufferedLength).CopyTo(replacement);
                    ArrayPool<byte>.Shared.Return(buffer);
                    buffer = replacement;
                    logicalCapacity = nextCapacity;
                }

                var bytesRead = await source.ReadAsync(
                    buffer.AsMemory(bufferedLength, logicalCapacity - bufferedLength),
                    cancellationToken).ConfigureAwait(false);
                isFinalBlock = bytesRead == 0;
                bufferedLength += bytesRead;
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static ParseOutcome ParseAvailable(
        ReadOnlySpan<byte> utf8Json,
        bool isFinalBlock,
        JsonReaderState readerState,
        ParserState parser)
    {
        var reader = new Utf8JsonReader(utf8Json, isFinalBlock, readerState);

        while (true)
        {
            if (parser.Section == JsonSection.ItemResults && parser.PendingItemKey is not null)
            {
                var probe = reader;
                if (!probe.Read()) return NeedMore(reader);

                var sourceOrdinal = parser.NextItemOrdinal;
                parser.NextItemOrdinal = checked(sourceOrdinal + 1);
                var key = parser.PendingItemKey;
                parser.PendingItemKey = null;

                if (probe.TokenType == JsonTokenType.Null)
                {
                    reader = probe;
                    continue;
                }

                if (probe.TokenType != JsonTokenType.StartObject)
                {
                    throw new JsonException("Metadata Quality item-results entries must contain JSON objects or null.");
                }

                var completed = probe;
                if (!completed.TrySkip())
                {
                    parser.PendingItemKey = key;
                    parser.NextItemOrdinal = sourceOrdinal;
                    return NeedMore(reader);
                }

                var result = DeserializeValue<PtvMetadataQualityResult>(utf8Json, probe, completed)
                    ?? throw new JsonException("A Metadata Quality item result was null.");
                reader = completed;
                parser.ItemResultCount++;
                return new ParseOutcome(
                    checked((int)reader.BytesConsumed),
                    reader.CurrentState,
                    false,
                    new PendingItem(key, result, sourceOrdinal));
            }

            if (parser.Section == JsonSection.ScanRuns)
            {
                var probe = reader;
                if (!probe.Read()) return NeedMore(reader);
                if (probe.TokenType == JsonTokenType.EndArray)
                {
                    reader = probe;
                    parser.Section = JsonSection.Root;
                    continue;
                }

                if (probe.TokenType == JsonTokenType.Null)
                {
                    reader = probe;
                    continue;
                }

                if (probe.TokenType != JsonTokenType.StartObject)
                {
                    throw new JsonException("Metadata Quality scan-runs entries must contain JSON objects or null.");
                }

                var completed = probe;
                if (!completed.TrySkip()) return NeedMore(reader);
                var run = DeserializeValue<PtvMetadataQualityScanRun>(utf8Json, probe, completed)
                    ?? throw new JsonException("A Metadata Quality scan run was null.");
                parser.AddScanRun(run);
                reader = completed;
                continue;
            }

            if (!reader.Read()) return NeedMore(reader);

            if (parser.RootEnded)
            {
                throw new JsonException("Metadata Quality JSON contains data after the root object.");
            }

            if (parser.SkipDepth > 0)
            {
                if (reader.TokenType is JsonTokenType.StartObject or JsonTokenType.StartArray) parser.SkipDepth++;
                else if (reader.TokenType is JsonTokenType.EndObject or JsonTokenType.EndArray) parser.SkipDepth--;
                continue;
            }

            if (!parser.RootStarted)
            {
                if (reader.TokenType != JsonTokenType.StartObject)
                {
                    throw new JsonException("Metadata Quality JSON must contain one root object.");
                }

                parser.RootStarted = true;
                continue;
            }

            if (parser.Section == JsonSection.ItemResults)
            {
                if (reader.TokenType == JsonTokenType.EndObject)
                {
                    parser.Section = JsonSection.Root;
                    continue;
                }

                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    throw new JsonException("Metadata Quality itemResults must be a JSON object.");
                }

                parser.PendingItemKey = reader.GetString()
                    ?? throw new JsonException("Metadata Quality itemResults contains an invalid key.");
                continue;
            }

            if (parser.PendingRootProperty != RootProperty.None)
            {
                ConsumeRootValue(ref reader, parser);
                continue;
            }

            if (reader.TokenType == JsonTokenType.EndObject)
            {
                parser.RootEnded = true;
                continue;
            }

            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                throw new JsonException("Metadata Quality root properties are malformed.");
            }

            parser.PendingRootProperty = ClassifyRootProperty(reader.GetString());
        }
    }

    private static void ConsumeRootValue(ref Utf8JsonReader reader, ParserState parser)
    {
        var property = parser.PendingRootProperty;
        parser.PendingRootProperty = RootProperty.None;

        switch (property)
        {
            case RootProperty.SchemaVersion:
                parser.SchemaVersion = ReadInt32(reader, "schemaVersion");
                return;
            case RootProperty.ScannerVersion:
                parser.ScannerVersion = ReadNullableString(reader, "scannerVersion");
                return;
            case RootProperty.RuleVersion:
                parser.RuleVersion = ReadNullableString(reader, "ruleVersion");
                return;
            case RootProperty.UpdatedAt:
                parser.UpdatedAt = ReadDateTimeOffset(reader, "updatedAt");
                return;
            case RootProperty.LastFullScan:
                parser.LastFullScan = ReadNullableDateTimeOffset(reader, "lastFullScan");
                return;
            case RootProperty.LastIncrementalScan:
                parser.LastIncrementalScan = ReadNullableDateTimeOffset(reader, "lastIncrementalScan");
                return;
            case RootProperty.ItemResults:
                if (parser.SawItemResults)
                {
                    throw new JsonException("Metadata Quality JSON contains duplicate itemResults properties.");
                }

                parser.SawItemResults = true;
                if (reader.TokenType == JsonTokenType.Null) return;
                if (reader.TokenType != JsonTokenType.StartObject)
                {
                    throw new JsonException("Metadata Quality itemResults must be a JSON object or null.");
                }

                parser.Section = JsonSection.ItemResults;
                return;
            case RootProperty.ScanRuns:
                parser.ResetScanRuns();
                if (reader.TokenType == JsonTokenType.Null) return;
                if (reader.TokenType != JsonTokenType.StartArray)
                {
                    throw new JsonException("Metadata Quality scanRuns must be a JSON array or null.");
                }

                parser.Section = JsonSection.ScanRuns;
                return;
            case RootProperty.Unknown:
                if (reader.TokenType is JsonTokenType.StartObject or JsonTokenType.StartArray) parser.SkipDepth = 1;
                return;
            default:
                throw new JsonException("Metadata Quality root parser entered an invalid state.");
        }
    }

    private static T? DeserializeValue<T>(
        ReadOnlySpan<byte> source,
        Utf8JsonReader firstToken,
        Utf8JsonReader completed)
    {
        var start = checked((int)firstToken.TokenStartIndex);
        var end = checked((int)completed.BytesConsumed);
        return JsonSerializer.Deserialize<T>(source.Slice(start, end - start), JsonOptions);
    }

    private static int ReadInt32(Utf8JsonReader reader, string propertyName)
    {
        if (reader.TokenType == JsonTokenType.Number && reader.TryGetInt32(out var value)) return value;
        throw new JsonException($"Metadata Quality {propertyName} must be a 32-bit integer.");
    }

    private static string? ReadNullableString(Utf8JsonReader reader, string propertyName)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        if (reader.TokenType == JsonTokenType.String) return reader.GetString();
        throw new JsonException($"Metadata Quality {propertyName} must be a string or null.");
    }

    private static DateTimeOffset ReadDateTimeOffset(Utf8JsonReader reader, string propertyName)
    {
        if (reader.TokenType == JsonTokenType.String && reader.TryGetDateTimeOffset(out var value)) return value;
        throw new JsonException($"Metadata Quality {propertyName} must be an ISO-8601 timestamp.");
    }

    private static DateTimeOffset? ReadNullableDateTimeOffset(Utf8JsonReader reader, string propertyName)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        return ReadDateTimeOffset(reader, propertyName);
    }

    private static RootProperty ClassifyRootProperty(string? propertyName)
    {
        if (propertyName is null) return RootProperty.Unknown;
        if (propertyName.Equals("schemaVersion", StringComparison.OrdinalIgnoreCase)) return RootProperty.SchemaVersion;
        if (propertyName.Equals("scannerVersion", StringComparison.OrdinalIgnoreCase)) return RootProperty.ScannerVersion;
        if (propertyName.Equals("ruleVersion", StringComparison.OrdinalIgnoreCase)) return RootProperty.RuleVersion;
        if (propertyName.Equals("updatedAt", StringComparison.OrdinalIgnoreCase)) return RootProperty.UpdatedAt;
        if (propertyName.Equals("lastFullScan", StringComparison.OrdinalIgnoreCase)) return RootProperty.LastFullScan;
        if (propertyName.Equals("lastIncrementalScan", StringComparison.OrdinalIgnoreCase)) return RootProperty.LastIncrementalScan;
        if (propertyName.Equals("itemResults", StringComparison.OrdinalIgnoreCase)) return RootProperty.ItemResults;
        if (propertyName.Equals("scanRuns", StringComparison.OrdinalIgnoreCase)) return RootProperty.ScanRuns;
        return RootProperty.Unknown;
    }

    private static ParseOutcome NeedMore(Utf8JsonReader reader)
        => new(checked((int)reader.BytesConsumed), reader.CurrentState, true, null);

    private enum JsonSection
    {
        Root,
        ItemResults,
        ScanRuns
    }

    private enum RootProperty
    {
        None,
        Unknown,
        SchemaVersion,
        ScannerVersion,
        RuleVersion,
        UpdatedAt,
        LastFullScan,
        LastIncrementalScan,
        ItemResults,
        ScanRuns
    }

    private sealed class ParserState
    {
        private readonly List<OrderedScanRun> _scanRuns = [];
        private long _nextScanRunOrdinal;

        internal ParserState()
        {
            var defaults = new PtvMetadataQualityDocument();
            SchemaVersion = defaults.SchemaVersion;
            ScannerVersion = defaults.ScannerVersion;
            RuleVersion = defaults.RuleVersion;
            UpdatedAt = defaults.UpdatedAt;
        }

        internal bool RootStarted { get; set; }

        internal bool RootEnded { get; set; }

        internal bool SawItemResults { get; set; }

        internal int SkipDepth { get; set; }

        internal JsonSection Section { get; set; }

        internal RootProperty PendingRootProperty { get; set; }

        internal string? PendingItemKey { get; set; }

        internal long NextItemOrdinal { get; set; }

        internal long ItemResultCount { get; set; }

        internal int SchemaVersion { get; set; }

        internal string? ScannerVersion { get; set; }

        internal string? RuleVersion { get; set; }

        internal DateTimeOffset UpdatedAt { get; set; }

        internal DateTimeOffset? LastFullScan { get; set; }

        internal DateTimeOffset? LastIncrementalScan { get; set; }

        internal void ResetScanRuns()
        {
            _scanRuns.Clear();
            _nextScanRunOrdinal = 0;
        }

        internal void AddScanRun(PtvMetadataQualityScanRun run)
        {
            _scanRuns.Add(new OrderedScanRun(run, _nextScanRunOrdinal++));
            if (_scanRuns.Count <= PtvMetadataQualityConstants.MaximumRunHistory) return;

            var oldest = _scanRuns
                .Select((candidate, index) => (candidate, index))
                .MinBy(pair => (pair.candidate.Run.StartedAt, pair.candidate.SourceOrdinal));
            _scanRuns.RemoveAt(oldest.index);
        }

        internal void ValidateComplete()
        {
            if (!RootStarted
                || !RootEnded
                || Section != JsonSection.Root
                || PendingRootProperty != RootProperty.None
                || PendingItemKey is not null
                || SkipDepth != 0)
            {
                throw new JsonException("Metadata Quality JSON ended before the root document was complete.");
            }
        }

        internal PtvMetadataQualityJsonHeader CreateHeader()
        {
            var runs = _scanRuns
                .OrderBy(entry => entry.Run.StartedAt)
                .ThenBy(entry => entry.SourceOrdinal)
                .Select(entry => entry.Run)
                .ToArray();
            return new PtvMetadataQualityJsonHeader(
                SchemaVersion,
                ScannerVersion,
                RuleVersion,
                UpdatedAt,
                LastFullScan,
                LastIncrementalScan,
                runs,
                ItemResultCount);
        }
    }

    private sealed record PendingItem(
        string Key,
        PtvMetadataQualityResult Result,
        long SourceOrdinal);

    private sealed record OrderedScanRun(
        PtvMetadataQualityScanRun Run,
        long SourceOrdinal);

    private readonly record struct ParseOutcome(
        int BytesConsumed,
        JsonReaderState ReaderState,
        bool NeedsMoreData,
        PendingItem? Item);
}
