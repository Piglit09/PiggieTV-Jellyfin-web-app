using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Issues response-only configured-row presentation correlations. These never authorize item access.
/// Only the current, server-generated store write can establish provenance; persisted/client JSON cannot.
/// </summary>
public sealed class PtvConfiguredRowAssociationService
{
    internal static readonly object ConfigurationGate = new();
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static long _configurationEpoch;
    private readonly byte[] _secret = RandomNumberGenerator.GetBytes(32);
    private readonly string _serverId;
    private readonly Func<PluginConfiguration?> _configuration;
    private StoreBinding? _binding;

    /// <summary>Creates the process-local issuer for Jellyfin's exact immutable system identity.</summary>
    /// <param name="serverId">Jellyfin application host system ID.</param>
    /// <param name="configuration">Configuration authority; optional isolated test seam.</param>
    public PtvConfiguredRowAssociationService(string serverId, Func<PluginConfiguration?>? configuration = null)
    {
        _serverId = serverId;
        _configuration = configuration ?? (() => Plugin.Instance?.Configuration);
    }

    // The scope must begin BEFORE in-place configuration mutation. It is synchronous/reentrant;
    // the existing stock save still runs unchanged. No asynchronous work or item authorization
    // runs under this scope, and no correlation state is added to the persisted configuration.
    internal static IDisposable BeginConfigurationMutation()
    {
        Monitor.Enter(ConfigurationGate);
        _configurationEpoch++;
        return new MutationScope();
    }

    internal Generation? CaptureGeneration()
    {
        lock (ConfigurationGate)
        {
            if (string.IsNullOrWhiteSpace(_serverId) || _configuration() is not { } current) return null;
            PluginConfiguration snapshot;
            try
            {
                snapshot = CloneGenerationConfiguration(current);
            }
            catch (Exception ex) when (ex is InvalidOperationException or JsonException or ArgumentException)
            {
                // An independently normalizing reader may overlap this snapshot. Correlation is
                // optional: an incoherent read must not change the existing generation/query path.
                return null;
            }
            // Validate the original list BEFORE the existing normalizer collapses duplicate IDs.
            var originalRules = snapshot.Rows?.Rules ?? [];
            var ids = originalRules.Select(rule => rule is null || string.IsNullOrWhiteSpace(rule.Id)
                ? string.Empty
                : PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(new RowBuilderSettings { Rules = [rule] }).Rules.Single().Id).ToArray();
            var ambiguous = ids.Any(string.IsNullOrWhiteSpace) || ids.Distinct(StringComparer.OrdinalIgnoreCase).Count() != ids.Length;
            PtvPluginSettingsNormalizer.Normalize(snapshot);
            var serialized = JsonSerializer.Serialize(snapshot, JsonOptions);
            return new Generation(this, _configurationEpoch, serialized, Digest(snapshot), ambiguous);
        }
    }

    internal bool IsCurrent(Generation generation)
    {
        lock (ConfigurationGate)
        {
            if (!ReferenceEquals(generation.Owner, this) || generation.AmbiguousRules || generation.Epoch != _configurationEpoch) return false;
            var current = CaptureGeneration();
            return current is not null && !current.AmbiguousRules && current.Binding == generation.Binding;
        }
    }

    // Called only under the existing store gate. There is exactly one bounded binding, not a history.
    internal void RetireStoreBinding()
    {
        lock (ConfigurationGate) _binding = null;
    }

    internal void RegisterGeneratedWrite(Generation generation, PtvFeaturedContentDocument normalizedDocument)
    {
        lock (ConfigurationGate)
        {
            _binding = IsCurrent(generation)
                ? new StoreBinding(generation, Digest(normalizedDocument), GetSectionOwners(normalizedDocument, generation))
                : null;
        }
    }

    // A readiness observation only: it never registers a persisted document or issues a proof.
    internal bool HasCurrentStoreBinding(PtvFeaturedContentDocument document)
    {
        lock (ConfigurationGate)
        {
            return _binding is { } binding && IsCurrent(binding.Generation) && Digest(document) == binding.DocumentDigest;
        }
    }

    internal Projection? CaptureProjection(PtvFeaturedContentDocument document, Guid userId)
    {
        lock (ConfigurationGate)
        {
            var binding = _binding;
            if (userId == Guid.Empty || binding is null || !IsCurrent(binding.Generation) || Digest(document) != binding.DocumentDigest) return null;
            return new Projection(this, binding, userId);
        }
    }

    // One point-in-time proof, not a lease or item-access grant. The controller resolves the
    // real request user and administrator policy before requesting the optional opaque pairs.
    internal PresentationProof? CaptureCurrentPresentationProof(Guid userId, bool includeBindings)
    {
        lock (ConfigurationGate)
        {
            var binding = _binding;
            if (userId == Guid.Empty || binding is null || !IsCurrent(binding.Generation)) return null;
            var projection = new Projection(this, binding, userId);
            return new PresentationProof(projection.CreateAuthority(), includeBindings ? projection.CreateBindings() : null);
        }
    }

    internal void FinalizeResponse(PtvFeaturedContentDocument document)
    {
        lock (ConfigurationGate)
        {
            var payload = document.FeaturedContent?["payload"] as JsonObject;
            var projection = document.ConfiguredRowProjection;
            if (projection is not null && IsCurrent(projection))
            {
                // Only the detached, already authorized/sanitized response receives authority.
                if (payload is not null) payload["currentPresentationAuthority"] = projection.CreateAuthority();
                return;
            }
            payload?.Remove("currentPresentationAuthority");
            if (projection is null) return;
            if (payload?["sections"] is JsonArray sections)
            {
                foreach (var section in sections.OfType<JsonObject>()) section.Remove("configuredRowAssociation");
            }
            document.ConfiguredRowProjection = null;
        }
    }

    internal JsonObject CreateSettingsResponse(PtvPluginSettingsDto settings, Guid userId)
    {
        lock (ConfigurationGate)
        {
            var response = JsonSerializer.SerializeToNode(settings, JsonOptions)!.AsObject();
            response["rows"] = CreateRowsResponse(settings.Rows, userId);
            return response;
        }
    }

    internal JsonObject CreateRowsResponse(RowBuilderSettings rows, Guid userId)
    {
        lock (ConfigurationGate)
        {
            var response = JsonSerializer.SerializeToNode(rows, JsonOptions)!.AsObject();
            var binding = _binding;
            if (userId == Guid.Empty || binding is null || !IsCurrent(binding.Generation)) return response;
            var snapshot = binding.Generation.CreateConfiguration();
            // Never decorate a DTO from another generation, even if its owner returned a shared object.
            var normalizedRows = JsonSerializer.Deserialize<RowBuilderSettings>(JsonSerializer.Serialize(rows, JsonOptions), JsonOptions)!;
            PtvPluginSettingsNormalizer.NormalizeRowBuilderSettings(normalizedRows);
            if (Digest(normalizedRows) != Digest(snapshot.Rows)) return response;
            var projection = new Projection(this, binding, userId);
            var ruleMap = new JsonArray();
            foreach (var rule in EligibleRules(snapshot).Values)
            {
                ruleMap.Add(new JsonObject { ["ruleId"] = rule.Id, ["association"] = projection.RuleToken(rule.Id) });
            }
            if (IsCurrent(projection))
            {
                response["currentPresentationAuthority"] = projection.CreateAuthority();
                response["configuredRowAssociations"] = new JsonObject
                {
                    ["version"] = 1,
                    ["scope"] = projection.Scope,
                    ["rules"] = ruleMap,
                    ["sections"] = projection.CreateBindings()
                };
            }
            return response;
        }
    }

    private bool IsCurrent(Projection projection)
    {
        lock (ConfigurationGate) return ReferenceEquals(_binding, projection.Binding) && IsCurrent(projection.Binding.Generation);
    }

    private static Dictionary<string, RowBuilderRule> EligibleRules(PluginConfiguration configuration)
    {
        if (!configuration.Rows.Enabled || configuration.Rows.SchemaVersion < 2) return new(StringComparer.OrdinalIgnoreCase);
        return configuration.Rows.Rules.Where(rule => rule.Enabled)
            .GroupBy(rule => rule.Id, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() == 1)
            .ToDictionary(group => group.Key, group => group.Single(), StringComparer.OrdinalIgnoreCase);
    }

    private static IReadOnlyDictionary<string, SectionOwner> GetSectionOwners(PtvFeaturedContentDocument document, Generation generation)
    {
        var owners = new Dictionary<string, SectionOwner>(StringComparer.OrdinalIgnoreCase);
        var rules = EligibleRules(generation.CreateConfiguration());
        if (document.FeaturedContent?["payload"]?["sections"] is not JsonArray sections) return owners;
        foreach (var group in sections.OfType<JsonObject>().GroupBy(section => ReadString(section, "id"), StringComparer.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(group.Key) || group.Count() != 1) continue;
            var section = group.Single();
            var sourceRuleId = ReadString(section, "sourceRuleId");
            if (ReadString(section, "rowType") != "configured-rule" || string.IsNullOrWhiteSpace(sourceRuleId)
                || !rules.TryGetValue(sourceRuleId, out var rule) || ReadString(section, "ruleId") != rule.Id) continue;
            // The raw generated ID is only the exact lookup used by the authorization projector.
            // In particular genre/random IDs can contain an ordinal. Neither that ID nor any
            // title/source/ordinal determines the public section instance: a private nonce does.
            owners.Add(group.Key, new SectionOwner(rule.Id, Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32))));
        }
        return owners;
    }

    private static string ReadString(JsonObject source, string name)
    {
        var properties = source.Where(property => property.Key.Equals(name, StringComparison.OrdinalIgnoreCase)).ToArray();
        return properties.Length == 1 && properties[0].Value is JsonValue value && value.TryGetValue<string>(out var text)
            ? text.Trim() : string.Empty;
    }

    private string Token(params string[] components) => Convert.ToHexStringLower(HMACSHA256.HashData(_secret, JsonSerializer.SerializeToUtf8Bytes(components)));
    private static PluginConfiguration CloneGenerationConfiguration(PluginConfiguration configuration)
    {
        // Exact configuration dependencies of RefreshAsync/BuildFeaturedPayloadAsync, its legacy
        // tag path, payload trimming, and TMDb enrichment. Unrelated signup/relationship state is
        // intentionally not enumerated. Any stock configuration commit still retires the epoch.
        var generationInputs = new PluginConfiguration
        {
            HeroSettings = configuration.HeroSettings,
            RowSettings = configuration.RowSettings,
            Rows = configuration.Rows,
            Recommendations = configuration.Recommendations,
            CacheSettings = configuration.CacheSettings,
            PerformanceSettings = configuration.PerformanceSettings,
            TagSettings = configuration.TagSettings,
            TmdbSettings = configuration.TmdbSettings,
            EnableTmdbMetadata = configuration.EnableTmdbMetadata,
            TmdbReadAccessToken = configuration.TmdbReadAccessToken,
            TmdbApiKey = configuration.TmdbApiKey,
            TmdbMaxEnrichmentItems = configuration.TmdbMaxEnrichmentItems
        };
        return JsonSerializer.Deserialize<PluginConfiguration>(JsonSerializer.Serialize(generationInputs, JsonOptions), JsonOptions)!;
    }
    // Parse case-sensitively: case-variant source properties must remain visible as ambiguity,
    // not throw or collapse while constructing the private digest.
    private static string Digest<T>(T value) => Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(Canonical(JsonNode.Parse(JsonSerializer.Serialize(value, JsonOptions))))));
    private static JsonNode? Canonical(JsonNode? node) => node switch
    {
        JsonObject obj => new JsonObject(obj.OrderBy(property => property.Key, StringComparer.Ordinal).Select(property => KeyValuePair.Create(property.Key, Canonical(property.Value)))),
        JsonArray array => new JsonArray(array.Select(Canonical).ToArray()),
        _ => node?.DeepClone()
    };

    private sealed class MutationScope : IDisposable
    {
        public void Dispose() => Monitor.Exit(ConfigurationGate);
    }

    internal sealed class Generation(PtvConfiguredRowAssociationService owner, long epoch, string serialized, string binding, bool ambiguousRules)
    {
        internal PtvConfiguredRowAssociationService Owner { get; } = owner;
        internal long Epoch { get; } = epoch;
        internal string Binding { get; } = binding;
        internal bool AmbiguousRules { get; } = ambiguousRules;
        internal PluginConfiguration CreateConfiguration() => JsonSerializer.Deserialize<PluginConfiguration>(serialized, JsonOptions)!;
    }

    internal sealed record SectionOwner(string RuleId, string InstanceNonce);
    internal sealed record StoreBinding(Generation Generation, string DocumentDigest, IReadOnlyDictionary<string, SectionOwner> SectionOwners)
    {
        // Configuration scope alone cannot distinguish same-config regeneration or PUT/Clear.
        // This private instance identity is created only for a trusted generated store binding.
        internal string GenerationNonce { get; } = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
    }

    internal sealed record PresentationProof(JsonObject Authority, JsonArray? Bindings);

    internal sealed class Projection
    {
        private readonly PtvConfiguredRowAssociationService _owner;
        internal StoreBinding Binding { get; }
        internal string Scope { get; }
        internal Projection(PtvConfiguredRowAssociationService owner, StoreBinding binding, Guid userId)
        {
            _owner = owner;
            Binding = binding;
            Scope = owner.Token("ptv-configured-row-v1", "scope", owner._serverId, userId.ToString("N"), binding.Generation.Epoch.ToString(CultureInfo.InvariantCulture), binding.Generation.Binding);
        }
        internal JsonObject CreateAuthority() => new()
        {
            ["version"] = 1,
            ["scope"] = Scope,
            ["generation"] = _owner.Token("ptv-configured-presentation-v1", "generation", Scope, Binding.GenerationNonce)
        };
        internal JsonArray CreateBindings()
        {
            var pairs = new JsonArray();
            foreach (var sourceSectionId in Binding.SectionOwners.Keys)
            {
                var alias = ForSection(sourceSectionId)!;
                pairs.Add(new JsonObject { ["rule"] = alias["rule"]!.DeepClone(), ["section"] = alias["section"]!.DeepClone() });
            }
            return pairs;
        }
        internal string RuleToken(string ruleId) => _owner.Token("ptv-configured-row-v1", "rule", Scope, ruleId);
        internal JsonObject? ForSection(string sourceSectionId) => Binding.SectionOwners.TryGetValue(sourceSectionId, out var sectionOwner)
            ? new JsonObject
            {
                ["version"] = 1,
                ["scope"] = Scope,
                ["rule"] = RuleToken(sectionOwner.RuleId),
                ["section"] = _owner.Token("ptv-configured-row-v1", "section", Scope, sectionOwner.RuleId, sectionOwner.InstanceNonce)
            }
            : null;
    }
}
