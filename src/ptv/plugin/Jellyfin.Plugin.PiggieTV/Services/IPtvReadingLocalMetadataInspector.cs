using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Reads bounded local Reading metadata without modifying media or sidecar files.</summary>
public interface IPtvReadingLocalMetadataInspector
{
    /// <summary>
    /// Inspects a server-authoritative source path. The path is input-only and is never included in
    /// the returned result, logs, warnings, or API models.
    /// </summary>
    /// <param name="sourcePath">Absolute server-authoritative media path.</param>
    /// <param name="context">Existing safe Jellyfin item context.</param>
    /// <param name="query">Current parsed Reading query.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Bounded local metadata evidence.</returns>
    Task<PtvReadingLocalMetadataInspectionResult> InspectAsync(
        string sourcePath,
        PtvMetadataSearchContext context,
        PtvStructuredMetadataQuery query,
        CancellationToken cancellationToken);

    /// <summary>Reassesses archive evidence through the isolated host using current source bytes.</summary>
    Task<PtvReadingLocalMetadataInspectionResult> InspectForApplyAsync(
        string sourcePath,
        PtvMetadataSearchContext context,
        PtvStructuredMetadataQuery query,
        CancellationToken cancellationToken);
}
