using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Plugin-configuration owner for authoritative cross-library relationships.
/// </summary>
public sealed class PtvRelationshipMappingService : IPtvRelationshipMappingService
{
    private const int MaximumMappings = 5000;
    private const int MaximumDisplayOrder = 10000;

    private static readonly HashSet<string> AllowedCategories = new(StringComparer.Ordinal)
    {
        "adaptation",
        "based-on",
        "companion-reading",
        "companion-video",
        "related-book",
        "related-comic",
        "related-game",
        "soundtrack",
        "spin-off"
    };

    private static readonly HashSet<string> AllowedDirections = new(StringComparer.Ordinal)
    {
        "bidirectional",
        "source-to-target"
    };

    private readonly Func<PluginConfiguration> _configurationProvider;
    private readonly Action<PluginConfiguration> _configurationSaver;
    private readonly Func<Guid, BaseItem?> _itemResolver;
    private readonly ILogger<PtvRelationshipMappingService> _logger;
    private readonly object _sync = new();
    private readonly Func<Guid, Guid, BaseItem?> _visibleItemResolver;

    /// <summary>Initializes a production relationship mapping service.</summary>
    /// <param name="libraryManager">Jellyfin library owner.</param>
    /// <param name="logger">Logger.</param>
    public PtvRelationshipMappingService(
        ILibraryManager libraryManager,
        ILogger<PtvRelationshipMappingService> logger)
        : this(
            logger,
            itemId => libraryManager.GetItemById(itemId),
            (itemId, userId) => libraryManager.GetItemById<BaseItem>(itemId, userId),
            () => Plugin.Instance?.Configuration
                ?? throw new PtvRelationshipMappingException(
                    StatusCodes.Status503ServiceUnavailable,
                    "PTV_RELATIONSHIPS_CONFIGURATION_UNAVAILABLE",
                    "PiggieTV relationship configuration is unavailable."),
            configuration =>
            {
                if (Plugin.Instance is null)
                {
                    throw new PtvRelationshipMappingException(
                        StatusCodes.Status503ServiceUnavailable,
                        "PTV_RELATIONSHIPS_CONFIGURATION_UNAVAILABLE",
                        "PiggieTV relationship configuration is unavailable.");
                }

                Plugin.Instance.UpdateConfiguration(configuration);
            })
    {
    }

    internal PtvRelationshipMappingService(
        ILogger<PtvRelationshipMappingService> logger,
        Func<Guid, BaseItem?> itemResolver,
        Func<Guid, Guid, BaseItem?> visibleItemResolver,
        Func<PluginConfiguration> configurationProvider,
        Action<PluginConfiguration> configurationSaver)
    {
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _itemResolver = itemResolver ?? throw new ArgumentNullException(nameof(itemResolver));
        _visibleItemResolver = visibleItemResolver ?? throw new ArgumentNullException(nameof(visibleItemResolver));
        _configurationProvider = configurationProvider ?? throw new ArgumentNullException(nameof(configurationProvider));
        _configurationSaver = configurationSaver ?? throw new ArgumentNullException(nameof(configurationSaver));
        _logger.LogInformation("PiggieTV authoritative relationship mapping service constructed.");
    }

    /// <inheritdoc />
    public PtvRelationshipMappingsResponse? GetForSource(Guid sourceItemId, Guid userId)
    {
        if (sourceItemId == Guid.Empty || userId == Guid.Empty)
        {
            return null;
        }

        var visibleSource = _visibleItemResolver(sourceItemId, userId);
        if (visibleSource is null)
        {
            return null;
        }

        var sourceFamily = GetMediaFamily(visibleSource);
        if (sourceFamily is null)
        {
            return new PtvRelationshipMappingsResponse();
        }

        IReadOnlyList<PtvRelationshipMappingDefinition> mappings;
        lock (_sync)
        {
            var configuration = _configurationProvider();
            mappings = (configuration.RelationshipMappings ?? new PtvRelationshipMappingSettings()).GetMappings();
        }

        var emittedMappingIds = new HashSet<Guid>();
        var relationships = new List<PtvRelationshipMappingDto>();

        foreach (var mapping in mappings)
        {
            if (!mapping.Enabled
                || mapping.SchemaVersion != 1
                || !TryParseIdentity(mapping.MappingId, out var mappingId)
                || !TryParseIdentity(mapping.SourceItemId, out var storedSourceId)
                || !TryParseIdentity(mapping.TargetItemId, out var storedTargetId)
                || !TryNormalizeCategory(mapping.Category, out var category)
                || !TryNormalizeDirection(mapping.Direction, out var direction)
                || !IsDisplayOrderValid(mapping.DisplayOrder)
                || !emittedMappingIds.Add(mappingId))
            {
                continue;
            }

            Guid targetItemId;
            var reverse = false;
            if (storedSourceId == sourceItemId)
            {
                targetItemId = storedTargetId;
            }
            else if (direction == "bidirectional" && storedTargetId == sourceItemId)
            {
                targetItemId = storedSourceId;
                reverse = true;
            }
            else
            {
                continue;
            }

            var visibleTarget = _visibleItemResolver(targetItemId, userId);
            var targetFamily = visibleTarget is null ? null : GetMediaFamily(visibleTarget);
            if (targetFamily is null
                || string.Equals(sourceFamily, targetFamily, StringComparison.Ordinal)
                || !CategorySupportsTarget(category, reverse ? sourceFamily : targetFamily))
            {
                continue;
            }

            relationships.Add(CreateDto(mapping, mappingId, targetItemId, category, direction));
        }

        return new PtvRelationshipMappingsResponse
        {
            Relationships = relationships
                .OrderBy(mapping => mapping.DisplayOrder)
                .ThenBy(mapping => mapping.Category, StringComparer.Ordinal)
                .ThenBy(mapping => mapping.TargetItemId, StringComparer.Ordinal)
                .ThenBy(mapping => mapping.MappingId, StringComparer.Ordinal)
                .ToArray()
        };
    }

    /// <inheritdoc />
    public PtvRelationshipMappingDto Create(PtvRelationshipMappingCreateRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var sourceItemId = ParseIdentity(request.SourceItemId, "PTV_RELATIONSHIPS_SOURCE_INVALID", "A valid source Jellyfin item identity is required.");
        var targetItemId = ParseIdentity(request.TargetItemId, "PTV_RELATIONSHIPS_TARGET_INVALID", "A valid target Jellyfin item identity is required.");
        if (sourceItemId == targetItemId)
        {
            throw Invalid("PTV_RELATIONSHIPS_SELF_LINK", "A relationship must connect two different Jellyfin items.");
        }

        var category = NormalizeCategory(request.Category);
        var direction = NormalizeDirection(request.Direction ?? "source-to-target");
        var displayOrder = NormalizeDisplayOrder(request.DisplayOrder ?? 0);
        var sourceItem = ResolveRequiredItem(sourceItemId, "PTV_RELATIONSHIPS_SOURCE_NOT_FOUND", "The source Jellyfin item could not be resolved.");
        var targetItem = ResolveRequiredItem(targetItemId, "PTV_RELATIONSHIPS_TARGET_NOT_FOUND", "The target Jellyfin item could not be resolved.");
        ValidateCrossFamily(sourceItem, targetItem, category);

        lock (_sync)
        {
            var configuration = _configurationProvider();
            configuration.RelationshipMappings ??= new PtvRelationshipMappingSettings();
            var mappings = configuration.RelationshipMappings.GetMappings().ToList();
            if (mappings.Count >= MaximumMappings)
            {
                throw Conflict("PTV_RELATIONSHIPS_CAPACITY", "The authoritative relationship mapping limit has been reached.");
            }

            EnsureNoDuplicate(mappings, sourceItemId, targetItemId, category, direction, excludedMappingId: null);

            var definition = new PtvRelationshipMappingDefinition
            {
                Category = category,
                Direction = direction,
                DisplayOrder = displayOrder,
                Enabled = request.Enabled ?? true,
                MappingId = Guid.NewGuid().ToString("N"),
                SchemaVersion = 1,
                SourceItemId = sourceItemId.ToString("N"),
                TargetItemId = targetItemId.ToString("N")
            };
            mappings.Add(definition);
            configuration.RelationshipMappings.SchemaVersion = 1;
            configuration.RelationshipMappings.SetMappings(mappings);
            _configurationSaver(configuration);

            _logger.LogInformation(
                "Created authoritative relationship mapping. Category={Category}; Direction={Direction}; Enabled={Enabled}; MappingCount={MappingCount}.",
                category,
                direction,
                definition.Enabled,
                mappings.Count);

            return CreateDto(definition, Guid.Parse(definition.MappingId), targetItemId, category, direction);
        }
    }

    /// <inheritdoc />
    public PtvRelationshipMappingDto Update(Guid mappingId, PtvRelationshipMappingUpdateRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (mappingId == Guid.Empty)
        {
            throw Invalid("PTV_RELATIONSHIPS_MAPPING_INVALID", "A valid relationship mapping identity is required.");
        }

        lock (_sync)
        {
            var configuration = _configurationProvider();
            configuration.RelationshipMappings ??= new PtvRelationshipMappingSettings();
            var mappings = configuration.RelationshipMappings.GetMappings().ToList();
            var index = mappings.FindIndex(mapping => TryParseIdentity(mapping.MappingId, out var candidateId) && candidateId == mappingId);
            if (index < 0)
            {
                throw NotFound("PTV_RELATIONSHIPS_MAPPING_NOT_FOUND", "The relationship mapping could not be found.");
            }

            var current = mappings[index];
            var sourceItemId = ParseStoredIdentity(current.SourceItemId);
            var targetItemId = ParseStoredIdentity(current.TargetItemId);
            var sourceItem = ResolveRequiredItem(sourceItemId, "PTV_RELATIONSHIPS_SOURCE_NOT_FOUND", "The source Jellyfin item could not be resolved.");
            var targetItem = ResolveRequiredItem(targetItemId, "PTV_RELATIONSHIPS_TARGET_NOT_FOUND", "The target Jellyfin item could not be resolved.");
            var category = request.Category is null ? NormalizeCategory(current.Category) : NormalizeCategory(request.Category);
            var direction = request.Direction is null ? NormalizeDirection(current.Direction) : NormalizeDirection(request.Direction);
            var displayOrder = request.DisplayOrder is null ? NormalizeDisplayOrder(current.DisplayOrder) : NormalizeDisplayOrder(request.DisplayOrder.Value);
            ValidateCrossFamily(sourceItem, targetItem, category);
            EnsureNoDuplicate(mappings, sourceItemId, targetItemId, category, direction, mappingId);

            var updated = new PtvRelationshipMappingDefinition
            {
                Category = category,
                Direction = direction,
                DisplayOrder = displayOrder,
                Enabled = request.Enabled ?? current.Enabled,
                MappingId = mappingId.ToString("N"),
                SchemaVersion = 1,
                SourceItemId = sourceItemId.ToString("N"),
                TargetItemId = targetItemId.ToString("N")
            };
            mappings[index] = updated;
            configuration.RelationshipMappings.SchemaVersion = 1;
            configuration.RelationshipMappings.SetMappings(mappings);
            _configurationSaver(configuration);

            _logger.LogInformation(
                "Updated authoritative relationship mapping. Category={Category}; Direction={Direction}; Enabled={Enabled}; MappingCount={MappingCount}.",
                category,
                direction,
                updated.Enabled,
                mappings.Count);

            return CreateDto(updated, mappingId, targetItemId, category, direction);
        }
    }

    /// <inheritdoc />
    public void Delete(Guid mappingId)
    {
        if (mappingId == Guid.Empty)
        {
            throw Invalid("PTV_RELATIONSHIPS_MAPPING_INVALID", "A valid relationship mapping identity is required.");
        }

        lock (_sync)
        {
            var configuration = _configurationProvider();
            configuration.RelationshipMappings ??= new PtvRelationshipMappingSettings();
            var mappings = configuration.RelationshipMappings.GetMappings().ToList();
            var removed = mappings.RemoveAll(mapping => TryParseIdentity(mapping.MappingId, out var candidateId) && candidateId == mappingId);
            if (removed == 0)
            {
                throw NotFound("PTV_RELATIONSHIPS_MAPPING_NOT_FOUND", "The relationship mapping could not be found.");
            }

            configuration.RelationshipMappings.SchemaVersion = 1;
            configuration.RelationshipMappings.SetMappings(mappings);
            _configurationSaver(configuration);
            _logger.LogInformation(
                "Deleted authoritative relationship mapping. RemovedCount={RemovedCount}; MappingCount={MappingCount}.",
                removed,
                mappings.Count);
        }
    }

    internal static string? ClassifyItemType(string? itemType)
    {
        return itemType?.Trim().ToLowerInvariant() switch
        {
            "audio" or "musicalbum" or "musicartist" or "musicgenre" => "music",
            "book" or "audiobook" or "comic" or "manga" => "reading",
            "game" or "gamesystem" => "game",
            "movie" or "series" or "season" or "episode" or "video" or "trailer" or "boxset" => "video",
            _ => null
        };
    }

    private static string? GetMediaFamily(BaseItem item) => ClassifyItemType(item.GetType().Name);

    private BaseItem ResolveRequiredItem(Guid itemId, string code, string message)
    {
        return _itemResolver(itemId) ?? throw NotFound(code, message);
    }

    private static void ValidateCrossFamily(BaseItem source, BaseItem target, string category)
    {
        var sourceFamily = GetMediaFamily(source);
        var targetFamily = GetMediaFamily(target);
        if (sourceFamily is null || targetFamily is null)
        {
            throw Invalid("PTV_RELATIONSHIPS_MEDIA_FAMILY_UNSUPPORTED", "Both relationship items must have supported media families.");
        }

        if (string.Equals(sourceFamily, targetFamily, StringComparison.Ordinal))
        {
            throw Invalid("PTV_RELATIONSHIPS_CROSS_FAMILY_REQUIRED", "Authoritative relationship mappings must cross media families.");
        }

        if (!CategorySupportsTarget(category, targetFamily))
        {
            throw Invalid("PTV_RELATIONSHIPS_CATEGORY_TARGET_MISMATCH", "The relationship category does not support the target media family.");
        }
    }

    private static bool CategorySupportsTarget(string category, string targetFamily) => category switch
    {
        "companion-reading" or "related-book" or "related-comic" => targetFamily == "reading",
        "companion-video" => targetFamily == "video",
        "related-game" => targetFamily == "game",
        "soundtrack" => targetFamily == "music",
        _ => true
    };

    private static void EnsureNoDuplicate(
        IEnumerable<PtvRelationshipMappingDefinition> mappings,
        Guid sourceItemId,
        Guid targetItemId,
        string category,
        string direction,
        Guid? excludedMappingId)
    {
        foreach (var mapping in mappings)
        {
            if (!TryParseIdentity(mapping.MappingId, out var candidateMappingId)
                || candidateMappingId == excludedMappingId
                || !TryParseIdentity(mapping.SourceItemId, out var candidateSourceId)
                || !TryParseIdentity(mapping.TargetItemId, out var candidateTargetId)
                || !TryNormalizeCategory(mapping.Category, out var candidateCategory)
                || !TryNormalizeDirection(mapping.Direction, out var candidateDirection)
                || !string.Equals(candidateCategory, category, StringComparison.Ordinal))
            {
                continue;
            }

            var sameOrientation = candidateSourceId == sourceItemId && candidateTargetId == targetItemId;
            var reverseOrientation = candidateSourceId == targetItemId && candidateTargetId == sourceItemId;
            if (sameOrientation || reverseOrientation && (candidateDirection == "bidirectional" || direction == "bidirectional"))
            {
                throw Conflict("PTV_RELATIONSHIPS_DUPLICATE", "An equivalent authoritative relationship mapping already exists.");
            }
        }
    }

    private static PtvRelationshipMappingDto CreateDto(
        PtvRelationshipMappingDefinition mapping,
        Guid mappingId,
        Guid targetItemId,
        string category,
        string direction) => new()
    {
        Category = category,
        Direction = direction,
        DisplayOrder = mapping.DisplayOrder,
        Enabled = mapping.Enabled,
        MappingId = mappingId.ToString("N"),
        SchemaVersion = 1,
        TargetItemId = targetItemId.ToString("N")
    };

    private static Guid ParseStoredIdentity(string? value)
    {
        if (!TryParseIdentity(value, out var identity))
        {
            throw Invalid("PTV_RELATIONSHIPS_MAPPING_INVALID", "The persisted relationship mapping is malformed.");
        }

        return identity;
    }

    private static Guid ParseIdentity(string? value, string code, string message)
    {
        if (!TryParseIdentity(value, out var identity))
        {
            throw Invalid(code, message);
        }

        return identity;
    }

    private static bool TryParseIdentity(string? value, out Guid identity)
    {
        return Guid.TryParse(value?.Trim(), out identity) && identity != Guid.Empty;
    }

    private static string NormalizeCategory(string? value)
    {
        if (!TryNormalizeCategory(value, out var category))
        {
            throw Invalid("PTV_RELATIONSHIPS_CATEGORY_INVALID", "The relationship category is not supported.");
        }

        return category;
    }

    private static bool TryNormalizeCategory(string? value, out string category)
    {
        category = value?.Trim().ToLowerInvariant() ?? string.Empty;
        return AllowedCategories.Contains(category);
    }

    private static string NormalizeDirection(string? value)
    {
        if (!TryNormalizeDirection(value, out var direction))
        {
            throw Invalid("PTV_RELATIONSHIPS_DIRECTION_INVALID", "The relationship direction is not supported.");
        }

        return direction;
    }

    private static bool TryNormalizeDirection(string? value, out string direction)
    {
        direction = value?.Trim().ToLowerInvariant() ?? string.Empty;
        return AllowedDirections.Contains(direction);
    }

    private static int NormalizeDisplayOrder(int value)
    {
        if (!IsDisplayOrderValid(value))
        {
            throw Invalid("PTV_RELATIONSHIPS_DISPLAY_ORDER_INVALID", $"Display order must be between 0 and {MaximumDisplayOrder}.");
        }

        return value;
    }

    private static bool IsDisplayOrderValid(int value) => value is >= 0 and <= MaximumDisplayOrder;

    private static PtvRelationshipMappingException Invalid(string code, string message) =>
        new(StatusCodes.Status400BadRequest, code, message);

    private static PtvRelationshipMappingException NotFound(string code, string message) =>
        new(StatusCodes.Status404NotFound, code, message);

    private static PtvRelationshipMappingException Conflict(string code, string message) =>
        new(StatusCodes.Status409Conflict, code, message);
}
