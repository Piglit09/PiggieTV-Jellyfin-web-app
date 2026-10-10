using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Jellyfin.Plugin.PiggieTV.Api;

/// <summary>Durable administrator intent around stock Jellyfin library writes.</summary>
[ApiController]
[Authorize]
[Route(PtvApiRoutes.HomeTransitions)]
public sealed class PtvHomeTransitionsController(
    IPtvHomeTopologyLedger ledger,
    ILibraryManager libraries,
    IAuthorizationService authorization,
    PtvConfiguredRowAssociationService associations,
    IOptions<JsonOptions> jsonOptions,
    IPtvFeaturedContentRefreshService? refresh) : BaseJellyfinApiController
{
    // All controller instances serialize read/check/Begin, including duplicate operation IDs.
    private static readonly SemaphoreSlim BeginGate = new(1, 1);
    public PtvHomeTransitionsController(IPtvHomeTopologyLedger ledger, ILibraryManager libraries,
        IAuthorizationService authorization, PtvConfiguredRowAssociationService associations,
        IOptions<JsonOptions> jsonOptions)
        : this(ledger, libraries, authorization, associations, jsonOptions, null) { }
    private async Task<bool> IsAdministrator() => (await authorization.AuthorizeAsync(User, null, Policies.RequiresElevation).ConfigureAwait(false)).Succeeded;

    [HttpGet("current")]
    public async Task<IActionResult> Current(CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        var current = await ledger.ReadAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var (unique, library) = ReadCurrentLibrary(current);
            return Ok(CurrentResponse(current, unique, library));
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            return Ok(ResponseFor(current));
        }
    }

    [HttpPost("begin")]
    public async Task<IActionResult> Begin([FromBody] PtvHomeTransitionIntent intent, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        await BeginGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = await ledger.ReadAsync(cancellationToken).ConfigureAwait(false);
            if (current.RecoveryRequired) return StatusCode(503, new { error = "Transition authority requires recovery." });
            if (intent.ServerId != current.ServerId || intent.Kind == "userAccess") return Conflict(new { error = "Library transition scope changed." });
            // A lost Begin reply must never authorize a second stock write or revalidate stale pre-state.
            var replay = current.Operation?.Intent.OperationId == intent.OperationId;
            var observedBindings = new Dictionary<string, string>(StringComparer.Ordinal);
            var observedScopes = new Dictionary<string, string>(StringComparer.Ordinal);
            if (replay) intent.AffectedRuleIds = current.Operation!.Intent.AffectedRuleIds;
            else
            {
                if (current.BroadHold) return Conflict(new { error = "Another library transition is pending." });
                var folders = libraries.GetVirtualFolders();
                if (intent.Kind == "create")
                {
                    if (intent.IntendedLibrary is null || folders.Any(f => string.Equals(f.Name, intent.IntendedLibrary.Name, StringComparison.OrdinalIgnoreCase)))
                        return Conflict(new { error = "Expected library absence changed." });
                }
                else
                {
                    var expected = intent.ExpectedLibrary;
                    var matches = folders.Where(f => f.ItemId == expected?.LibraryId).ToArray();
                    if (expected is null || matches.Length != 1 || !Matches(expected, matches[0], true) || !HasCollectionFolder(matches[0]))
                        return Conflict(new { error = "Expected library definition changed." });
                }
                // The Plugin owns affected bindings; client rule IDs never decide which tombstones persist.
                var generation = associations.CaptureGeneration();
                if (generation is null || generation.AmbiguousRules) return Conflict(new { error = "Current rule bindings are unavailable." });
                var rules = generation.CreateConfiguration().Rows?.Rules ?? [];
                foreach (var rule in rules.Where(rule => rule.LibraryScope?.Mode is "defaultLibrary" or "virtualFolder"))
                    observedScopes[rule.Id] = PtvHomeLibraryScopeResolver.ScopeFingerprint(rule);
                intent.AffectedRuleIds = rules
                    .Where(rule =>
                    {
                        var scope = rule.LibraryScope;
                        if (scope?.Mode == "global") return false;
                        var expectedLibraryId = intent.ExpectedLibrary?.LibraryId;
                        if (expectedLibraryId is not null
                            && (scope?.VirtualFolderId == expectedLibraryId
                                || current.Bindings.TryGetValue(rule.Id, out var durable)
                                    && durable.CollectionFolderId == expectedLibraryId)) return true;
                        if (scope?.Mode != "defaultLibrary" || !string.IsNullOrEmpty(scope.VirtualFolderId)
                            || intent.ExpectedLibrary is null) return false;
                        // Resolve only to determine protective affectedness. Never persist a pin
                        // or grant incarnation authority from the bootstrap name/type match.
                        var resolution = PtvHomeLibraryScopeResolver.Resolve(rule, folders, current);
                        // Uncertain unpinned defaults are conservatively tombstoned; a uniquely
                        // resolved unrelated default remains outside the affected binding set.
                        return resolution.LibraryId is null || (Guid.TryParseExact(intent.ExpectedLibrary.LibraryId, "N", out var target)
                            && resolution.LibraryId == target);
                    })
                    .Select(r => r.Id).Distinct(StringComparer.Ordinal).ToArray() ?? [];
                foreach (var rule in rules.Where(rule => rule.LibraryScope?.Mode is "defaultLibrary" or "virtualFolder"))
                {
                    var resolved = PtvHomeLibraryScopeResolver.Resolve(rule, folders, current);
                    if (resolved.LibraryId is not { } id || id == Guid.Empty) continue;
                    var currentFolder = folders.Where(folder => folder.ItemId == id.ToString("N")).ToArray();
                    if (currentFolder.Length == 1 && HasCollectionFolder(currentFolder[0]))
                        observedBindings[rule.Id] = id.ToString("N");
                }
                if (!associations.IsCurrent(generation)) return Conflict(new { error = "Rule bindings changed before the hold." });
            }
            var begun = await ledger.BeginAsync(intent, observedBindings, observedScopes, cancellationToken).ConfigureAwait(false);
            associations.RetireLibraryPresentation();
            return Ok(ResponseFor(begun, writeAllowed: !replay));
        }
        catch (InvalidOperationException error) { return Conflict(new { error = error.Message }); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException) { return StatusCode(503, new { error = "The transition hold could not be persisted." }); }
        finally { BeginGate.Release(); }
    }

    [HttpPost("{operationId:guid}/complete")]
    public async Task<IActionResult> Complete(Guid operationId, [FromBody] PtvHomeTransitionCompleteRequest? request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();
        await BeginGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var current = await ledger.ReadAsync(cancellationToken).ConfigureAwait(false);
            if (operationId == Guid.Empty || current.RecoveryRequired || current.Operation?.Intent.OperationId != operationId)
                return Conflict(new { error = "This is not the current transition." });
            TransitionEvidence evidence = new(false, null, null, null);
            for (var attempt = 0; attempt < 3; attempt++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                evidence = ReadCurrentEvidence(current);
                if (evidence.Unique) break;
            }
            var (unique, readback) = (evidence.Unique, evidence.Library);
            if (!unique || refresh is null) return Ok(CurrentResponse(current, unique, readback));
            var generation = associations.CaptureGeneration();
            if (generation is null || generation.AmbiguousRules) return Ok(CurrentResponse(current, unique, readback));
            var choices = PendingRuleIds(current, readback, generation);
            var selected = request?.Bindings ?? [];
            if (selected.Length > 0)
            {
                var previous = current.Bindings.Where(pair => pair.Value.ReboundOperationId == operationId
                    && !pair.Value.Tombstoned && pair.Value.CollectionFolderId == readback?.ItemId)
                    .Select(pair => pair.Key).ToArray();
                if (current.Operation?.State == "complete" && associations.HasCurrentOwnedPublicationReady()
                    && selected.Length == previous.Length
                    && selected.Select(binding => binding.RuleId).Distinct(StringComparer.Ordinal).Count() == selected.Length
                    && selected.All(binding => binding.LibraryId == readback?.ItemId
                        && previous.Contains(binding.RuleId, StringComparer.Ordinal)))
                    return Ok(CurrentResponse(current, true, readback));
                if (current.Operation?.Intent.Kind is "delete" or "userAccess" || readback?.ItemId is not { } currentId
                    || selected.Length != choices.Length || selected.Select(binding => binding.RuleId).Distinct(StringComparer.Ordinal).Count() != selected.Length
                    || selected.Any(binding => binding.LibraryId != currentId || !choices.Contains(binding.RuleId, StringComparer.Ordinal)))
                    return Conflict(new { error = "Selected rules must match the Plugin-verified current library." });
            }
            else if (current.Operation?.State == "complete" && associations.HasCurrentOwnedPublicationReady())
                return Ok(CurrentResponse(current, unique, readback));

            var bindings = selected.ToDictionary(binding => binding.RuleId, binding => binding.LibraryId, StringComparer.Ordinal);
            var selectedScopes = generation.CreateConfiguration().Rows.Rules
                .Where(rule => bindings.ContainsKey(rule.Id))
                .ToDictionary(rule => rule.Id, PtvHomeLibraryScopeResolver.ScopeFingerprint, StringComparer.Ordinal);
            if (selectedScopes.Count != bindings.Count) return Ok(CurrentResponse(current, true, readback));
            if (!await refresh.StageTransitionCandidatesAsync(current.Epoch, bindings, cancellationToken).ConfigureAwait(false)
                || !associations.IsCurrent(generation)) return Ok(CurrentResponse(current, unique, readback));
            // Do not let a staged candidate authorize a different active UserRoot snapshot.
            var finalEvidence = ReadCurrentEvidence(current);
            if (!finalEvidence.Unique || finalEvidence.Signature != evidence.Signature
                || !associations.IsCurrent(generation)) return Ok(CurrentResponse(current, false, null));
            if (current.BroadHold)
            {
                var verified = new PtvVerifiedTransitionReadback(current.Epoch,
                    finalEvidence.Definition, null,
                    true, true, true);
                current = selected.Length > 0
                    ? await ledger.CompleteAndRebindAsync(operationId, verified, bindings, selectedScopes, cancellationToken).ConfigureAwait(false)
                    : await ledger.CompleteAsync(operationId, verified, cancellationToken).ConfigureAwait(false);
            }
            else if (selected.Length > 0)
            {
                current = await ledger.RebindAsync(operationId, bindings, selectedScopes, cancellationToken).ConfigureAwait(false);
            }
            // The held stage stayed private. Only after durable release/rebind may the trusted
            // current-epoch store replacement establish process-local owned publication readiness.
            await refresh.RefreshAsync(cancellationToken).ConfigureAwait(false);
            return Ok(CurrentResponse(current, true, finalEvidence.Library));
        }
        catch (InvalidOperationException error) { return Conflict(new { error = error.Message }); }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            var current = await ledger.ReadAsync(CancellationToken.None).ConfigureAwait(false);
            return Ok(CurrentResponse(current, false, null));
        }
        finally { BeginGate.Release(); }
    }

    private PtvHomeTransitionResponse CurrentResponse(PtvHomeTopologySnapshot current, bool unique, VirtualFolderInfo? library)
    {
        if (!unique) return ResponseFor(current, authority: "unresolved");
        var generation = associations.CaptureGeneration();
        var pending = generation is { AmbiguousRules: false } ? PendingRuleIds(current, library, generation) : [];
        var unresolved = generation is { AmbiguousRules: false } && HasUnresolvedOwnedRules(current, generation);
        var ready = associations.HasCurrentOwnedPublicationReady();
        var authority = pending.Length > 0 || unresolved ? "binding-required"
            : current.Operation?.State == "complete" && ready ? "bound"
            : current.Operation?.State == "complete" ? "generation-pending"
            : "binding-required";
        return ResponseFor(current, authority: authority, library: library, pendingRuleIds: pending);
    }

    private string[] PendingRuleIds(PtvHomeTopologySnapshot current, VirtualFolderInfo? library,
        PtvConfiguredRowAssociationService.Generation generation)
    {
        if (library?.ItemId is not { } currentId || current.Operation?.Intent.Kind is "delete" or "userAccess") return [];
        var folders = libraries.GetVirtualFolders().ToArray();
        var ready = associations.HasCurrentOwnedPublicationReady();
        return (generation.CreateConfiguration().Rows?.Rules ?? [])
            .Where(rule => rule.LibraryScope?.Mode is "defaultLibrary" or "virtualFolder")
            .Where(rule =>
            {
                current.Bindings.TryGetValue(rule.Id, out var binding);
                if (binding?.Tombstoned == true
                    && current.Operation!.Intent.AffectedRuleIds.Contains(rule.Id, StringComparer.Ordinal)
                    && !PtvHomeLibraryScopeResolver.CanRebindAffectedOldScope(rule, current)) return false;
                var resolved = binding is { Tombstoned: false }
                    ? PtvHomeLibraryScopeResolver.Resolve(rule, folders, current)
                    : PtvHomeLibraryScopeResolver.Resolve(rule, folders);
                var affected = binding?.Tombstoned == true && current.Operation!.Intent.AffectedRuleIds.Contains(rule.Id, StringComparer.Ordinal);
                if (resolved.LibraryId?.ToString("N") != currentId && affected
                    && PtvHomeLibraryScopeResolver.CanRebindAffectedOldScope(rule, current)
                    && Guid.TryParseExact(currentId, "N", out var selectedId))
                    resolved = PtvHomeLibraryScopeResolver.ResolveSelectedCurrent(rule, folders, selectedId);
                if (resolved.LibraryId?.ToString("N") != currentId) return false;
                return resolved.NeedsBinding || binding is null || binding.Tombstoned || binding.CollectionFolderId != currentId
                    || (!ready && binding.ReboundOperationId == current.Operation!.Intent.OperationId);
            })
            .Select(rule => rule.Id).Distinct(StringComparer.Ordinal).ToArray();
    }

    private bool HasUnresolvedOwnedRules(PtvHomeTopologySnapshot current,
        PtvConfiguredRowAssociationService.Generation generation)
    {
        var folders = libraries.GetVirtualFolders().ToArray();
        return (generation.CreateConfiguration().Rows?.Rules ?? [])
            .Where(rule => rule.Enabled && rule.LibraryScope?.Mode is ("defaultLibrary" or "virtualFolder"))
            .Any(rule => PtvHomeLibraryScopeResolver.Resolve(rule, folders, current).Status != "resolved");
    }

    private PtvHomeLibraryDefinition Definition(VirtualFolderInfo folder) => new()
    {
        LibraryId = folder.ItemId ?? string.Empty,
        Name = folder.Name,
        CollectionType = folder.CollectionType?.ToString() ?? "mixed",
        Roots = folder.Locations ?? [],
        Options = JsonSerializer.SerializeToElement(folder.LibraryOptions, jsonOptions.Value.JsonSerializerOptions)
    };

    private const int MaximumTopFolders = 128;
    private sealed record TransitionEvidence(bool Unique, VirtualFolderInfo? Library,
        PtvHomeLibraryDefinition? Definition, string? Signature);

    private (bool Unique, VirtualFolderInfo? Library) ReadCurrentLibrary(PtvHomeTopologySnapshot current)
    {
        var evidence = ReadCurrentEvidence(current);
        return (evidence.Unique, evidence.Library);
    }

    private TransitionEvidence ReadCurrentEvidence(PtvHomeTopologySnapshot current)
    {
        var unavailable = new TransitionEvidence(false, null, null, null);
        if (current.RecoveryRequired || current.Operation is not { } operation
            || operation.Intent.Kind == "userAccess") return unavailable;
        var intent = operation.Intent;
        var folders = libraries.GetVirtualFolders(false)?.ToArray();
        if (folders is null || folders.Length > MaximumTopFolders || folders.Any(folder => folder is null)) return unavailable;
        var root = libraries.GetUserRootFolder();
        if (root is null || root.Id == Guid.Empty || string.IsNullOrWhiteSpace(root.Path)
            || !Path.IsPathFullyQualified(root.Path)) return unavailable;
        var children = libraries.GetItemList(new InternalItemsQuery
        {
            ParentId = root.Id, Recursive = false, User = null,
            GroupByPresentationUniqueKey = false, EnableTotalRecordCount = false,
            Limit = MaximumTopFolders + 1
        });
        if (children is null || children.Count > MaximumTopFolders || children.Any(child => child is not CollectionFolder))
            return unavailable;
        var folderIds = new HashSet<Guid>();
        var folderNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var childIds = new HashSet<Guid>();
        var childNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var activeChildren = new Dictionary<Guid, CollectionFolder>();
        foreach (var item in children)
        {
            var child = (CollectionFolder)item;
            if (child.Id == Guid.Empty || string.IsNullOrWhiteSpace(child.Name)
                || !childIds.Add(child.Id) || !childNames.Add(child.Name)) return unavailable;
            activeChildren.Add(child.Id, child);
        }
        var definitions = new List<PtvHomeLibraryDefinition>(folders.Length);
        foreach (var folder in folders)
        {
            if (!Guid.TryParseExact(folder.ItemId, "N", out var id) || id == Guid.Empty
                || string.IsNullOrWhiteSpace(folder.Name) || !folderIds.Add(id) || !folderNames.Add(folder.Name)
                || !ValidRoots(folder.Locations) || folder.LibraryOptions is null
                || !activeChildren.TryGetValue(id, out var child)
                || !string.Equals(child.Name, folder.Name, StringComparison.Ordinal)
                || !string.Equals(child.CollectionType?.ToString() ?? "mixed",
                    folder.CollectionType?.ToString() ?? "mixed", StringComparison.OrdinalIgnoreCase)) return unavailable;
            // Jellyfin's configured virtual-folder directory is the UserRoot child path,
            // distinct from the media Locations roots in the library definition.
            var configuredChildPath = Path.GetFullPath(Path.Combine(root.Path, folder.Name));
            var canonicalRootPath = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root.Path));
            if (Path.GetFileName(folder.Name) != folder.Name
                || !string.Equals(Path.GetDirectoryName(configuredChildPath), canonicalRootPath, StringComparison.OrdinalIgnoreCase)
                || !SameFullPath(child.Path, configuredChildPath))
                return unavailable;
            if (libraries.GetItemById(id) is not CollectionFolder exact || exact.Id != id
                || !string.Equals(exact.Name, child.Name, StringComparison.Ordinal)
                || !SameFullPath(exact.Path, configuredChildPath)
                || !string.Equals(exact.CollectionType?.ToString() ?? "mixed",
                    child.CollectionType?.ToString() ?? "mixed", StringComparison.OrdinalIgnoreCase)) return unavailable;
            definitions.Add(Definition(folder));
        }
        if (folderIds.Count != childIds.Count) return unavailable;
        var signature = JsonSerializer.Serialize(new
        {
            RootId = root.Id,
            Folders = definitions.OrderBy(definition => definition.LibraryId, StringComparer.Ordinal)
                .Select(definition => new
                {
                    definition.LibraryId, definition.Name, definition.CollectionType,
                    Roots = definition.Roots.OrderBy(path => path, StringComparer.Ordinal).ToArray(),
                    definition.Options
                }).ToArray(),
            Children = activeChildren.Values.OrderBy(child => child.Id)
                .Select(child => new { child.Id, child.Name, child.Path,
                    CollectionType = child.CollectionType?.ToString() ?? "mixed" }).ToArray()
        });
        if (intent.Kind == "delete")
        {
            var old = intent.ExpectedLibrary;
            if (old is null || !Guid.TryParseExact(old.LibraryId, "N", out var oldId)
                || folders.Any(folder => folder.ItemId == old.LibraryId
                    || string.Equals(folder.Name, old.Name, StringComparison.OrdinalIgnoreCase))
                || activeChildren.Values.Any(child => child.Id == oldId
                    || string.Equals(child.Name, old.Name, StringComparison.OrdinalIgnoreCase))
                || libraries.GetItemById(oldId) is not null) return unavailable;
            return new TransitionEvidence(true, null, null, signature);
        }
        if (intent.IntendedLibrary is not { } intended) return unavailable;
        var matches = folders.Where(folder => Matches(intended, folder,
            !string.IsNullOrEmpty(intended.LibraryId))).ToArray();
        if (matches.Length != 1) return unavailable;
        var matched = matches[0];
        if (intent.Kind == "rename" && intent.ExpectedLibrary is { } oldRename)
        {
            if (folders.Any(folder => string.Equals(folder.Name, oldRename.Name, StringComparison.OrdinalIgnoreCase))
                || activeChildren.Values.Any(child => string.Equals(child.Name, oldRename.Name, StringComparison.OrdinalIgnoreCase)))
                return unavailable;
            // A renamed definition on the old CollectionFolder ID does not prove a new
            // incarnation. Keep the pre-write hold until a distinct current ID exists
            // and the previous one is no longer addressable.
            if (matched.ItemId == oldRename.LibraryId
                || !Guid.TryParseExact(oldRename.LibraryId, "N", out var previousId)
                || libraries.GetItemById(previousId) is not null) return unavailable;
        }
        else if (intent.Kind is "roots" or "definition" && intent.ExpectedLibrary is { } oldDefinition
            && folders.Any(folder => Matches(oldDefinition, folder, true))) return unavailable;
        return new TransitionEvidence(true, matched, definitions.Single(definition => definition.LibraryId == matched.ItemId), signature);
    }

    private static bool ValidRoots(string[]? roots) => roots is not null
        && !roots.Any(string.IsNullOrWhiteSpace)
        && roots.Distinct(StringComparer.Ordinal).Count() == roots.Length;

    private static bool SameFullPath(string? actual, string expected) => !string.IsNullOrWhiteSpace(actual)
        && Path.IsPathFullyQualified(actual)
        && string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(actual)),
            Path.TrimEndingDirectorySeparator(expected), StringComparison.OrdinalIgnoreCase);

    private bool HasCollectionFolder(VirtualFolderInfo folder) => Guid.TryParseExact(folder.ItemId, "N", out var id)
        && id != Guid.Empty && libraries.GetItemById(id) is CollectionFolder current && current.Id == id;

    private bool Matches(PtvHomeLibraryDefinition expected, VirtualFolderInfo actual, bool compareId)
    {
        if (actual.LibraryOptions is null || expected.Options.ValueKind != JsonValueKind.Object) return false;
        var options = JsonSerializer.SerializeToElement(actual.LibraryOptions, jsonOptions.Value.JsonSerializerOptions);
        return (!compareId || expected.LibraryId == actual.ItemId)
            && expected.Name == actual.Name && expected.CollectionType == (actual.CollectionType?.ToString() ?? "mixed")
            && ValidRoots(expected.Roots) && ValidRoots(actual.Locations)
            && expected.Roots.OrderBy(path => path, StringComparer.Ordinal)
                .SequenceEqual(actual.Locations.OrderBy(path => path, StringComparer.Ordinal), StringComparer.Ordinal)
            && JsonNode.DeepEquals(JsonNode.Parse(expected.Options.GetRawText()), JsonNode.Parse(options.GetRawText()));
    }

    private static PtvHomeTransitionResponse ResponseFor(PtvHomeTopologySnapshot current, bool writeAllowed = false, string authority = "unresolved", VirtualFolderInfo? library = null, string[]? pendingRuleIds = null) => new()
    {
        OperationId = current.Operation?.Intent.OperationId,
        Epoch = current.Epoch, Held = current.BroadHold || current.RequiresFreshGeneration || current.RecoveryRequired,
        State = current.RecoveryRequired ? "recovery-required" : current.Operation?.State ?? "idle",
        AffectedRuleIds = pendingRuleIds ?? current.Operation?.Intent.AffectedRuleIds ?? [],
        WriteAllowed = writeAllowed, Authority = authority, Library = library
    };
}
