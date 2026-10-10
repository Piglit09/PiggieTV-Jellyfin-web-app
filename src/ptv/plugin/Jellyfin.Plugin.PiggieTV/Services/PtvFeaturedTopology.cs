using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Library-only Featured provenance checks; never grants Jellyfin item access.</summary>
internal static class PtvFeaturedTopology
{
    internal static bool Available(PtvHomeTopologySnapshot? state) => state is { BroadHold: false, RecoveryRequired: false }
        && state.Epoch.Length == 64 && state.Epoch.All(char.IsAsciiHexDigit);

    internal static long? Generation(PtvHomeTopologySnapshot? state, string ruleId)
    {
        if (!Available(state) || string.IsNullOrWhiteSpace(ruleId)) return null;
        if (!state!.Bindings.TryGetValue(ruleId, out var binding)) return state.BindingAuthorityRequired || state.Sequence > 1 ? null : 0;
        return binding.Tombstoned || (state.BindingAuthorityRequired
            && (!Guid.TryParseExact(binding.CollectionFolderId, "N", out var id) || id == Guid.Empty))
            ? null : binding.Generation;
    }

    internal static string? Text(JsonObject source, string name)
    {
        var fields = source.Where(p => p.Key.Equals(name, StringComparison.OrdinalIgnoreCase)).ToArray();
        return fields.Length == 1 && fields[0].Key == name && fields[0].Value is JsonValue value
            && value.TryGetValue<string>(out var text) ? text : null;
    }

    internal static bool Matches(JsonObject section, PtvHomeTopologySnapshot? state, string ruleId)
    {
        var generation = Generation(state, ruleId);
        var fields = section.Where(p => p.Key.Equals("bindingGeneration", StringComparison.OrdinalIgnoreCase)).ToArray();
        return generation is not null && Text(section, "topologyEpoch") == state!.Epoch
            && fields.Length == 1 && fields[0].Key == "bindingGeneration" && fields[0].Value is JsonValue value
            && value.TryGetValue<long>(out var claimed) && claimed == generation
            && (!state.BindingAuthorityRequired || (state.Bindings.TryGetValue(ruleId, out var binding)
                && Text(section, "libraryId") == binding.CollectionFolderId));
    }

    internal static bool Owned(JsonObject section, RowBuilderSettings? rows)
    {
        var rule = Text(section, "sourceRuleId");
        return section.Any(p => p.Key.Equals("scopeType", StringComparison.OrdinalIgnoreCase)
            && (p.Value is not JsonValue value || !value.TryGetValue<string>(out var scope) || scope.Trim().Equals("library", StringComparison.OrdinalIgnoreCase)))
            || section.Any(p => new[] { "topologyEpoch", "bindingGeneration", "libraryId", "userAccessEpoch" }.Contains(p.Key, StringComparer.OrdinalIgnoreCase) && p.Value is not null)
            || rows?.Rules.Any(r => r.Id == rule && r.LibraryScope?.Mode is "defaultLibrary" or "virtualFolder") == true;
    }

    internal static void Filter(JsonObject payload, PtvHomeTopologySnapshot? state, RowBuilderSettings? rows, bool currentSchema = true)
    {
        FilterSectionsAndItems(payload, section => !Owned(section, rows)
            || (currentSchema && Matches(section, state, Text(section, "sourceRuleId") ?? string.Empty)));
    }

    internal static void FilterPublication(JsonObject? payload, PtvHomeTopologySnapshot? state)
    {
        if (payload is null) return;
        // Full binding checks ran before sanitization. Every rebind must rotate the
        // topology epoch, so this final check also retires a concurrent rebind.
        FilterSectionsAndItems(payload, section => !Owned(section, null)
            || (Available(state) && Text(section, "topologyEpoch") == state!.Epoch));
    }

    internal static void BindUserAccessEpoch(JsonObject? payload, string epoch)
    {
        if (payload is null) return;
        if (payload["sections"] is not JsonArray sections || epoch.Length != 64
            || !epoch.All(char.IsAsciiHexDigit))
            throw new InvalidOperationException("Current user access epoch required for owned publication.");
        foreach (var section in sections.OfType<JsonObject>())
        {
            if (Owned(section, null)) section["userAccessEpoch"] = epoch;
        }
        RemoveHeroAccessEpoch(payload);
        payload["heroAccessEpoch"] = epoch;
    }

    internal static void WithholdUnprovenUserContent(JsonObject? payload)
    {
        if (payload is null) return;
        // Even a global Plugin row may contain items authorized only by a new
        // account's temporary broad/default Jellyfin policy. Until that user's
        // intended policy is attested, no Plugin Featured item is independently safe.
        FilterSectionsAndItems(payload, _ => false);
        payload["heroItems"] = new JsonArray();
        RemoveHeroAccessEpoch(payload);
    }

    private static void RemoveHeroAccessEpoch(JsonObject payload)
    {
        foreach (var name in payload.Select(pair => pair.Key)
            .Where(name => name.Equals("heroAccessEpoch", StringComparison.OrdinalIgnoreCase)).ToArray())
            payload.Remove(name);
    }

    private static void FilterSectionsAndItems(JsonObject payload, Func<JsonObject, bool> eligible)
    {
        // Read raw properties before materializing JsonObject dictionaries: stored
        // Web-default JsonNodes may otherwise throw on case-conflicting keys.
        using var rawSections = JsonDocument.Parse(payload["sections"]?.ToJsonString() ?? "null");
        using var rawItems = JsonDocument.Parse(payload["sectionItems"]?.ToJsonString() ?? "null");
        var definitions = rawSections.RootElement.ValueKind == JsonValueKind.Array
            ? rawSections.RootElement.EnumerateArray().ToArray() : [];
        var itemProperties = rawItems.RootElement.ValueKind == JsonValueKind.Object
            ? rawItems.RootElement.EnumerateObject().ToArray() : [];
        var idCounts = definitions.Where(section => section.ValueKind == JsonValueKind.Object)
            .SelectMany(section => section.EnumerateObject())
            .Where(field => field.Name.Equals("id", StringComparison.OrdinalIgnoreCase) && field.Value.ValueKind == JsonValueKind.String)
            .Select(field => field.Value.GetString()!)
            .GroupBy(id => id, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase);
        var itemKeyCounts = itemProperties.GroupBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase);
        var sections = new JsonArray();
        var items = new JsonObject();
        var acceptedIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var nodeOptions = new JsonNodeOptions { PropertyNameCaseInsensitive = false };
        foreach (var definition in definitions)
        {
            if (definition.ValueKind != JsonValueKind.Object) continue;
            var properties = definition.EnumerateObject().ToArray();
            if (properties.Select(field => field.Name).Distinct(StringComparer.Ordinal).Count() != properties.Length) continue;
            var section = JsonNode.Parse(definition.GetRawText(), nodeOptions)!.AsObject();
            var id = Text(section, "id");
            if (string.IsNullOrWhiteSpace(id) || idCounts.GetValueOrDefault(id) != 1
                || itemKeyCounts.GetValueOrDefault(id) > 1 || !eligible(section)) continue;
            sections.Add(section);
            acceptedIds.Add(id);
        }

        // Derive item eligibility from surviving unique definitions, never from
        // the (possibly ambiguous or absent) ID of a rejected definition.
        foreach (var item in itemProperties)
        {
            if (acceptedIds.Contains(item.Name) && item.Value.ValueKind == JsonValueKind.Array)
                items[item.Name] = JsonNode.Parse(item.Value.GetRawText(), nodeOptions);
        }
        payload["sections"] = sections;
        payload["sectionItems"] = items;
    }
}
