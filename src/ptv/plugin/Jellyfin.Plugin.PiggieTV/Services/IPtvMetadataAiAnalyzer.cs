using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Optionally reasons over bounded metadata evidence without modifying Jellyfin state.
/// </summary>
public interface IPtvMetadataAiAnalyzer
{
    /// <summary>
    /// Gets a value indicating whether a server-side OpenAI credential is available.
    /// </summary>
    bool IsConfigured { get; }

    /// <summary>Returns a safe runtime projection without accessing the credential value.</summary>
    PtvMetadataAiStatusResponse GetStatus(bool enabled, string? configuredModel);

    /// <summary>
    /// Analyzes a suspicious item using only minimal, path-reduced evidence.
    /// </summary>
    /// <param name="input">Untrusted metadata evidence and verified candidates.</param>
    /// <param name="configuredModel">Optional validated model override.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A schema-validated optional AI assessment.</returns>
    Task<PtvMetadataAiAnalysisResult> AnalyzeAsync(
        PtvMetadataAiAnalysisInput input,
        string? configuredModel,
        CancellationToken cancellationToken);

    /// <summary>Runs one tiny synthetic Responses API request without changing settings or starting a scan.</summary>
    Task<PtvMetadataAiConnectionTestResponse> TestConnectionAsync(
        string? configuredModel,
        CancellationToken cancellationToken);
}
