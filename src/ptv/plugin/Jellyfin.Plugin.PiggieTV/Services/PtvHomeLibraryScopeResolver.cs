using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Model.Entities;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Result of resolving a row's configured Jellyfin library identity.</summary>
/// <param name="Status">A bounded, non-sensitive reason code.</param>
/// <param name="LibraryId">The verified CollectionFolder ID, if already pinned.</param>
/// <param name="NeedsBinding">Whether a unique bootstrap candidate must be persisted first.</param>
public sealed record PtvHomeLibraryScopeResolution(string Status, Guid? LibraryId, bool NeedsBinding = false);

/// <summary>Resolves exact library identity; names are used only for first-time default bootstrap.</summary>
public static class PtvHomeLibraryScopeResolver
{
    /// <summary>Exact normalized saved-scope identity captured before a controlled write.</summary>
    public static string ScopeFingerprint(RowBuilderRule rule) => Convert.ToHexString(SHA256.HashData(
        JsonSerializer.SerializeToUtf8Bytes(new[] { rule.MediaType, rule.LibraryScope?.Mode,
            rule.LibraryScope?.DefaultKey, rule.LibraryScope?.VirtualFolderId })));

    /// <summary>Only an explicitly rebound rule with unchanged saved scope can override its old ID.</summary>
    public static bool HasVerifiedOverride(RowBuilderRule rule, PtvHomeTopologySnapshot topology,
        PtvHomeBindingGeneration binding) => !binding.Tombstoned && binding.ReboundOperationId is { } operationId
        && topology.CompletedOperationIds.Contains(operationId)
        && binding.OriginalScopeFingerprint is { } original && original == ScopeFingerprint(rule)
        && Guid.TryParseExact(binding.CollectionFolderId, "N", out var id) && id != Guid.Empty;

    /// <summary>First Begin can seed an unaffected unpinned default without changing Rows.</summary>
    public static bool HasVerifiedObservedSeed(RowBuilderRule rule, PtvHomeTopologySnapshot topology,
        PtvHomeBindingGeneration binding) => topology.BindingAuthorityRequired && !binding.Tombstoned
        && binding.ReboundOperationId is null && binding.Generation == 1
        && rule.LibraryScope is { Mode: "defaultLibrary", VirtualFolderId: null }
        && binding.OriginalScopeFingerprint is { } original && original == ScopeFingerprint(rule)
        && Guid.TryParseExact(binding.CollectionFolderId, "N", out var id) && id != Guid.Empty;

    /// <summary>Current durable effective ID for a rebound rule or unaffected observed default.</summary>
    public static bool HasVerifiedEffectiveBinding(RowBuilderRule rule, PtvHomeTopologySnapshot topology,
        PtvHomeBindingGeneration binding) => HasVerifiedOverride(rule, topology, binding)
        || HasVerifiedObservedSeed(rule, topology, binding);

    /// <summary>Only a current-operation affected tombstone can stage an old-scope selection.</summary>
    public static bool CanRebindAffectedOldScope(RowBuilderRule rule, PtvHomeTopologySnapshot topology)
    {
        if (topology.Operation?.Intent.AffectedRuleIds.Contains(rule.Id, StringComparer.Ordinal) != true
            || !topology.Bindings.TryGetValue(rule.Id, out var binding) || !binding.Tombstoned) return false;
        return binding.OriginalScopeFingerprint is { } original && original == ScopeFingerprint(rule);
    }

    /// <summary>Checks an explicit selected ID against the rule's type without changing saved settings.</summary>
    public static PtvHomeLibraryScopeResolution ResolveSelectedCurrent(RowBuilderRule rule,
        IReadOnlyList<VirtualFolderInfo> folders, Guid selectedId)
    {
        var scope = rule.LibraryScope;
        if (scope?.Mode is not ("defaultLibrary" or "virtualFolder") || selectedId == Guid.Empty)
            return new("invalid", null);
        var staged = new RowBuilderRule
        {
            Id = rule.Id,
            MediaType = rule.MediaType,
            SourceType = rule.SourceType,
            LibraryScope = new RowLibraryScope
            {
                Mode = scope.Mode,
                DefaultKey = scope.DefaultKey,
                VirtualFolderId = selectedId.ToString("N")
            }
        };
        return Resolve(staged, folders);
    }

    /// <summary>Requires the durable rule-to-CollectionFolder authority after a controlled transition.</summary>
    public static PtvHomeLibraryScopeResolution Resolve(RowBuilderRule rule,
        IReadOnlyList<VirtualFolderInfo> folders, PtvHomeTopologySnapshot? topology)
    {
        var resolved = Resolve(rule, folders);
        if (rule.LibraryScope?.Mode is not ("defaultLibrary" or "virtualFolder")) return resolved;
        if (topology is null || topology.RecoveryRequired || topology.BroadHold) return new("held", null);
        if (!topology.BindingAuthorityRequired && topology.Sequence <= 1) return resolved;
        if (!topology.Bindings.TryGetValue(rule.Id, out var binding) || binding.Tombstoned
            || !Guid.TryParseExact(binding.CollectionFolderId, "N", out var durableId) || durableId == Guid.Empty)
            return new("bindingRequired", null);
        if (binding.OriginalScopeFingerprint is { } fingerprint && fingerprint != ScopeFingerprint(rule))
            return new("bindingMismatch", null);
        if (resolved.LibraryId == durableId)
            return resolved.NeedsBinding && HasVerifiedEffectiveBinding(rule, topology, binding)
                ? new("resolved", durableId) : resolved;
        if (!HasVerifiedOverride(rule, topology, binding)) return new("bindingMismatch", null);
        var selected = ResolveSelectedCurrent(rule, folders, durableId);
        return selected.LibraryId == durableId && selected.Status is "resolved" or "bindingRequired"
            ? new("resolved", durableId) : new("bindingMismatch", null);
    }

    /// <summary>Deterministic schema-1 binding hash; independent of the display name and config hash.</summary>
    public static string ComputeScopeHash(RowBuilderRule rule, string status, string? effectiveLibraryId = null)
    {
        var scope = rule.LibraryScope;
        var canonical = string.Join('|',
            "1",
            rule.Id.Trim().ToLowerInvariant(),
            scope?.Mode ?? "invalid",
            scope?.DefaultKey ?? string.Empty,
            effectiveLibraryId ?? scope?.VirtualFolderId ?? string.Empty,
            status);
        long hash = 5381;
        foreach (var character in canonical)
        {
            hash = ((hash * 33) + character) % int.MaxValue;
        }

        return hash.ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>Resolves a row against the current Jellyfin virtual folders.</summary>
    public static PtvHomeLibraryScopeResolution Resolve(RowBuilderRule rule, IReadOnlyList<VirtualFolderInfo> folders)
    {
        var scope = rule.LibraryScope;
        if (scope is null || scope.Mode == "invalid") return new("invalid", null);
        if (scope.Mode == "global")
        {
            return rule.SourceType == "library" || !string.IsNullOrEmpty(scope.DefaultKey) || !string.IsNullOrEmpty(scope.VirtualFolderId)
                ? new("invalid", null)
                : new("global", null);
        }

        var expected = ExpectedCollectionType(rule.MediaType);
        if (expected is null) return new("typeConflict", null);
        if (scope.Mode == "defaultLibrary")
        {
            if (scope.DefaultKey != rule.MediaType || !IsDefaultKey(scope.DefaultKey)) return new("typeConflict", null);
        }
        else if (scope.Mode != "virtualFolder" || !string.IsNullOrEmpty(scope.DefaultKey))
        {
            return new("invalid", null);
        }

        if (string.IsNullOrEmpty(scope.VirtualFolderId))
        {
            if (scope.Mode != "defaultLibrary") return new("invalid", null);
            var name = DefaultName(scope.DefaultKey!);
            var matches = folders.Where(folder =>
                string.Equals(folder.Name, name, StringComparison.OrdinalIgnoreCase)
                && folder.CollectionType == expected
                && Guid.TryParseExact(folder.ItemId, "N", out var id)
                && id != Guid.Empty).ToList();
            if (matches.Count == 0) return new("missing", null);
            if (matches.Count != 1) return new("ambiguous", null);
            return new("bindingRequired", Guid.Parse(matches[0].ItemId), true);
        }

        if (!Guid.TryParseExact(scope.VirtualFolderId, "N", out var pinned) || pinned == Guid.Empty)
        {
            return new("invalid", null);
        }

        var identified = folders.Where(folder => Guid.TryParseExact(folder.ItemId, "N", out var id) && id == pinned).ToList();
        if (identified.Count == 0) return new("deleted", null);
        if (identified.Count != 1) return new("ambiguous", null);
        return identified[0].CollectionType == expected
            ? new("resolved", pinned)
            : new("typeConflict", null);
    }

    private static bool IsDefaultKey(string? key) => key is "movies" or "shows" or "cartoons" or "anime" or "music";

    private static string DefaultName(string key) => key switch
    {
        "movies" => "Movies",
        "shows" => "Shows",
        "cartoons" => "Cartoons",
        "anime" => "Anime",
        "music" => "Music",
        _ => string.Empty
    };

    private static CollectionTypeOptions? ExpectedCollectionType(string? mediaType) => mediaType switch
    {
        "movies" => CollectionTypeOptions.movies,
        "shows" or "cartoons" or "anime" => CollectionTypeOptions.tvshows,
        "music" => CollectionTypeOptions.music,
        _ => null
    };
}
