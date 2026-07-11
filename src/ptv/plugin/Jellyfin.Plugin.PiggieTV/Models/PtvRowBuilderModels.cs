using System.Text.Json.Serialization;
using Jellyfin.Plugin.PiggieTV.Configuration;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Row-builder validation result.
/// </summary>
public sealed class PtvRowValidationResult
{
    /// <summary>Gets or sets a value indicating whether the row settings are valid.</summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; } = true;

    /// <summary>Gets or sets validation errors.</summary>
    [JsonPropertyName("errors")]
    public List<string> Errors { get; set; } = [];

    /// <summary>Gets or sets validation warnings.</summary>
    [JsonPropertyName("warnings")]
    public List<string> Warnings { get; set; } = [];
}

/// <summary>
/// Row-builder preview response.
/// </summary>
public sealed class PtvRowPreviewResponse
{
    /// <summary>Gets or sets a value indicating whether preview generation completed.</summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; } = true;

    /// <summary>Gets or sets normalized row settings used for preview.</summary>
    [JsonPropertyName("settings")]
    public RowBuilderSettings Settings { get; set; } = RowBuilderSettings.CreateDefault();

    /// <summary>Gets or sets validation output.</summary>
    [JsonPropertyName("validation")]
    public PtvRowValidationResult Validation { get; set; } = new();

    /// <summary>Gets or sets preview rows.</summary>
    [JsonPropertyName("rows")]
    public List<PtvRowPreviewItem> Rows { get; set; } = [];

    /// <summary>Gets or sets row generation diagnostics.</summary>
    [JsonPropertyName("diagnostics")]
    public List<PtvRowGenerationDiagnostic> Diagnostics { get; set; } = [];

    /// <summary>Gets or sets provider health/status summary.</summary>
    [JsonPropertyName("providerStatus")]
    public Dictionary<string, object?> ProviderStatus { get; set; } = [];
}

/// <summary>
/// Row preview item.
/// </summary>
public sealed class PtvRowPreviewItem
{
    /// <summary>Gets or sets the row id.</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets the row title.</summary>
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    /// <summary>Gets or sets the category id that produced this row.</summary>
    [JsonPropertyName("categoryId")]
    public string CategoryId { get; set; } = string.Empty;

    /// <summary>Gets or sets the rule id that produced this row.</summary>
    [JsonPropertyName("ruleId")]
    public string RuleId { get; set; } = string.Empty;

    /// <summary>Gets or sets the rule name that produced this row.</summary>
    [JsonPropertyName("ruleName")]
    public string RuleName { get; set; } = string.Empty;

    /// <summary>Gets or sets media type.</summary>
    [JsonPropertyName("mediaType")]
    public string MediaType { get; set; } = string.Empty;

    /// <summary>Gets or sets source type.</summary>
    [JsonPropertyName("sourceType")]
    public string SourceType { get; set; } = string.Empty;

    /// <summary>Gets or sets rule type for compact debug displays.</summary>
    [JsonPropertyName("ruleType")]
    public string RuleType { get; set; } = string.Empty;

    /// <summary>Gets or sets generation mode.</summary>
    [JsonPropertyName("generationMode")]
    public string GenerationMode { get; set; } = string.Empty;

    /// <summary>Gets or sets the source value used for the row.</summary>
    [JsonPropertyName("source")]
    public string Source { get; set; } = string.Empty;

    /// <summary>Gets or sets provider used for enrichment.</summary>
    [JsonPropertyName("providerUsed")]
    public string ProviderUsed { get; set; } = "jellyfin";

    /// <summary>Gets or sets row item count.</summary>
    [JsonPropertyName("itemCount")]
    public int ItemCount { get; set; }

    /// <summary>Gets or sets a value indicating whether the row is empty.</summary>
    [JsonPropertyName("empty")]
    public bool Empty { get; set; }

    /// <summary>Gets or sets a value indicating whether the row is weak.</summary>
    [JsonPropertyName("weak")]
    public bool Weak { get; set; }

    /// <summary>Gets or sets row warnings.</summary>
    [JsonPropertyName("warnings")]
    public List<string> Warnings { get; set; } = [];
}

/// <summary>
/// Row generation diagnostic.
/// </summary>
public sealed class PtvRowGenerationDiagnostic
{
    /// <summary>Gets or sets category id.</summary>
    [JsonPropertyName("categoryId")]
    public string CategoryId { get; set; } = string.Empty;

    /// <summary>Gets or sets rule id.</summary>
    [JsonPropertyName("ruleId")]
    public string RuleId { get; set; } = string.Empty;

    /// <summary>Gets or sets rule name.</summary>
    [JsonPropertyName("ruleName")]
    public string RuleName { get; set; } = string.Empty;

    /// <summary>Gets or sets source type.</summary>
    [JsonPropertyName("sourceType")]
    public string SourceType { get; set; } = string.Empty;

    /// <summary>Gets or sets rule type for compact debug displays.</summary>
    [JsonPropertyName("ruleType")]
    public string RuleType { get; set; } = string.Empty;

    /// <summary>Gets or sets media type.</summary>
    [JsonPropertyName("mediaType")]
    public string MediaType { get; set; } = string.Empty;

    /// <summary>Gets or sets generation mode.</summary>
    [JsonPropertyName("generationMode")]
    public string GenerationMode { get; set; } = string.Empty;

    /// <summary>Gets or sets search/tag used.</summary>
    [JsonPropertyName("searchTerm")]
    public string SearchTerm { get; set; } = string.Empty;

    /// <summary>Gets or sets source value used by the rule.</summary>
    [JsonPropertyName("sourceValue")]
    public string SourceValue { get; set; } = string.Empty;

    /// <summary>Gets or sets provider used.</summary>
    [JsonPropertyName("providerUsed")]
    public string ProviderUsed { get; set; } = "jellyfin";

    /// <summary>Gets or sets provider error, if any.</summary>
    [JsonPropertyName("providerError")]
    public string? ProviderError { get; set; }

    /// <summary>Gets or sets the generated row id.</summary>
    [JsonPropertyName("rowId")]
    public string RowId { get; set; } = string.Empty;

    /// <summary>Gets or sets the generated row title.</summary>
    [JsonPropertyName("rowTitle")]
    public string RowTitle { get; set; } = string.Empty;

    /// <summary>Gets or sets the planned row count for the rule.</summary>
    [JsonPropertyName("plannedRowCount")]
    public int PlannedRowCount { get; set; }

    /// <summary>Gets or sets how many sources the rule generated before rendering.</summary>
    [JsonPropertyName("generatedSourceCount")]
    public int GeneratedSourceCount { get; set; }

    /// <summary>Gets or sets how many planned sources did not produce a rendered row.</summary>
    [JsonPropertyName("droppedSourceCount")]
    public int DroppedSourceCount { get; set; }

    /// <summary>Gets or sets the reason a planned source was dropped, when known.</summary>
    [JsonPropertyName("dropReason")]
    public string? DropReason { get; set; }

    /// <summary>Gets or sets item count.</summary>
    [JsonPropertyName("itemCount")]
    public int ItemCount { get; set; }

    /// <summary>Gets or sets candidate count before source filtering.</summary>
    [JsonPropertyName("candidateCount")]
    public int CandidateCount { get; set; }

    /// <summary>Gets or sets matched count before item selection/deduplication.</summary>
    [JsonPropertyName("matchedCount")]
    public int MatchedCount { get; set; }

    /// <summary>Gets or sets a value indicating whether fallback content was used.</summary>
    [JsonPropertyName("fallbackUsed")]
    public bool FallbackUsed { get; set; }

    /// <summary>Gets or sets the backend query/filter summary used to generate this row.</summary>
    [JsonPropertyName("queryUsed")]
    public string QueryUsed { get; set; } = string.Empty;

    /// <summary>Gets or sets the studio filter used for studio rows.</summary>
    [JsonPropertyName("studioFilter")]
    public string? StudioFilter { get; set; }

    /// <summary>Gets or sets normalized Jellyfin metadata fields used for matching.</summary>
    [JsonPropertyName("metadataSourceFieldsUsed")]
    public List<string> MetadataSourceFieldsUsed { get; set; } = [];

    /// <summary>Gets or sets the first generated item names for quick debugging.</summary>
    [JsonPropertyName("first10ItemNames")]
    public List<string> First10ItemNames { get; set; } = [];

    /// <summary>Gets or sets the first matched item names before final selection/dedupe.</summary>
    [JsonPropertyName("first10MatchedItemNames")]
    public List<string> First10MatchedItemNames { get; set; } = [];

    /// <summary>Gets or sets filtered duplicate count.</summary>
    [JsonPropertyName("filteredDuplicateCount")]
    public int FilteredDuplicateCount { get; set; }

    /// <summary>Gets or sets empty result reason.</summary>
    [JsonPropertyName("emptyResultReason")]
    public string? EmptyResultReason { get; set; }

    /// <summary>Gets or sets generation time in milliseconds.</summary>
    [JsonPropertyName("generationTimeMs")]
    public long GenerationTimeMs { get; set; }
}
