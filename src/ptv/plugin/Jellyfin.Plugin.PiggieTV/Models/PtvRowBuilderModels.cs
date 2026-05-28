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

    /// <summary>Gets or sets item count.</summary>
    [JsonPropertyName("itemCount")]
    public int ItemCount { get; set; }

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
