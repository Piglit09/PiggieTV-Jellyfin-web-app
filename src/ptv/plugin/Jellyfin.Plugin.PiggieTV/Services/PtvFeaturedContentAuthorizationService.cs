using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Applies Jellyfin's current per-user item visibility policy to a shared Featured cache document.
/// </summary>
public interface IPtvFeaturedContentAuthorizationService
{
    /// <summary>
    /// Projects a shared cache document into a response safe for one resolved Jellyfin user.
    /// </summary>
    /// <param name="document">Shared server cache document.</param>
    /// <param name="userId">Authenticated Jellyfin user identifier.</param>
    /// <returns>A fail-closed per-user authorization result.</returns>
    PtvFeaturedContentAuthorizationResult AuthorizeForUser(PtvFeaturedContentDocument document, Guid userId);
}

/// <summary>Count-only outcome of one Featured response authorization pass.</summary>
/// <param name="UserResolved">Whether Jellyfin resolved the authenticated user.</param>
/// <param name="Document">Authorized response document, or <see langword="null"/> when user resolution failed.</param>
/// <param name="CandidateCount">Number of distinct valid candidate item identifiers checked.</param>
/// <param name="AuthorizedCount">Number of distinct candidate identifiers Jellyfin authorized.</param>
public sealed record PtvFeaturedContentAuthorizationResult(
    bool UserResolved,
    PtvFeaturedContentDocument? Document,
    int CandidateCount,
    int AuthorizedCount);

/// <summary>
/// Stateless per-request Featured response projector backed by Jellyfin's authoritative user/item policy.
/// </summary>
public sealed class PtvFeaturedContentAuthorizationService : IPtvFeaturedContentAuthorizationService
{
    private static readonly HashSet<string> AllowedItemFields = new(StringComparer.OrdinalIgnoreCase)
    {
        "Album",
        "AlbumArtist",
        "AlbumId",
        "AlbumPrimaryImageItemId",
        "AlbumPrimaryImageTag",
        "Artists",
        "BackdropImageTag",
        "BackdropImageTags",
        "BackdropItemId",
        "ChildCount",
        "CollectionType",
        "CommunityRating",
        "Container",
        "CriticRating",
        "DateCreated",
        "EndDate",
        "Genres",
        "Height",
        "Id",
        "ImageBlurHashes",
        "ImageTags",
        "IndexNumber",
        "IsFolder",
        "LocationType",
        "MediaSourceCount",
        "MediaSources",
        "MediaStreams",
        "MediaType",
        "Name",
        "OfficialRating",
        "OriginalTitle",
        "Overview",
        "ParentBackdropImageTag",
        "ParentBackdropImageTags",
        "ParentBackdropItemId",
        "ParentId",
        "ParentIndexNumber",
        "ParentLogoImageTag",
        "ParentLogoItemId",
        "ParentPrimaryImageItemId",
        "ParentPrimaryImageTag",
        "ParentThumbImageTag",
        "ParentThumbItemId",
        "PremiereDate",
        "PrimaryImageAspectRatio",
        "PrimaryImageTag",
        "ProductionYear",
        "ProviderIds",
        "PtvHeroRecommendationLabel",
        "PtvHeroSource",
        "PtvQualityTags",
        "RecursiveItemCount",
        "RunTimeTicks",
        "SeasonId",
        "SeasonName",
        "Series",
        "SeriesId",
        "SeriesName",
        "SeriesPrimaryImageTag",
        "SeriesThumbImageTag",
        "ServerId",
        "SongCount",
        "Studios",
        "Tags",
        "Type",
        "VideoCodec",
        "VideoRange",
        "Width"
    };

    private static readonly HashSet<string> AllowedMediaSourceFields = new(StringComparer.OrdinalIgnoreCase)
    {
        "Container",
        "Height",
        "MediaSourceType",
        "MediaStreams",
        "Protocol",
        "Type",
        "VideoCodec",
        "VideoRange",
        "Width"
    };

    private static readonly HashSet<string> AllowedMediaStreamFields = new(StringComparer.OrdinalIgnoreCase)
    {
        "Channels",
        "Codec",
        "CodecTag",
        "DisplayTitle",
        "Height",
        "Profile",
        "Title",
        "Type",
        "Video3DFormat",
        "VideoDoViTitle",
        "VideoRange",
        "VideoRangeType",
        "Width"
    };

    private static readonly string[] AllowedPayloadScalarFields =
    [
        "emptyLibraryConfirmed",
        "generationState",
        "payloadClassification",
        "rowConfigApplied",
        "rowConfigHash",
        "rowConfigVersion"
    ];

    private static readonly string[] AllowedSectionFields =
    [
        "accepted",
        "cacheHash",
        "configHash",
        "editorialDescription",
        "emptyResultReason",
        "enabled",
        "fallbackUsed",
        "generatedAt",
        "generationMode",
        "groupTitle",
        "homeProfileMood",
        "homeProfileMoodConfidence",
        "id",
        "includeItemTypes",
        "mediaType",
        "parentRuleId",
        "persisted",
        "presentation",
        "recommendationConfigHash",
        "rowConfigHash",
        "rowKicker",
        "rowType",
        "ruleId",
        "ruleName",
        "shape",
        "showWhenEmpty",
        "source",
        "sourceGroupId",
        "sourceRecommendationId",
        "sourceRuleId",
        "sourceType",
        "sourceValue",
        "studioFilter",
        "tier",
        "title",
        "type"
    ];

    private static readonly HashSet<string> VirtualSourceTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "becauseYouWatched",
        "continueWatching",
        "requested"
    };

    private static readonly HashSet<string> AllowedHeroLabels = new(StringComparer.Ordinal)
    {
        "Recommended Movies",
        "Recommended Shows"
    };

    private readonly ILibraryManager _libraryManager;
    private readonly IUserManager _userManager;
    private readonly PtvConfiguredRowAssociationService? _associations;

    /// <summary>Initializes the Jellyfin-backed authorization projector.</summary>
    /// <param name="userManager">Jellyfin user manager.</param>
    /// <param name="libraryManager">Jellyfin library manager.</param>
    /// <param name="associations">Optional response-only configured-row issuer.</param>
    public PtvFeaturedContentAuthorizationService(IUserManager userManager, ILibraryManager libraryManager, PtvConfiguredRowAssociationService? associations = null)
    {
        _userManager = userManager;
        _libraryManager = libraryManager;
        _associations = associations;
    }

    /// <inheritdoc />
    public PtvFeaturedContentAuthorizationResult AuthorizeForUser(PtvFeaturedContentDocument document, Guid userId)
    {
        ArgumentNullException.ThrowIfNull(document);

        if (userId == Guid.Empty)
        {
            return new(false, null, 0, 0);
        }

        var user = _userManager.GetUserById(userId);
        if (user is null)
        {
            return new(false, null, 0, 0);
        }

        if (document.FeaturedContent is not JsonObject featuredContent
            || FindNode(featuredContent, "payload") is not JsonObject sourcePayload)
        {
            throw new InvalidOperationException("Featured content is missing its payload.");
        }

        var associationProjection = _associations?.CaptureProjection(document, userId);
        var accessByItemId = new Dictionary<Guid, bool>();

        bool IsAuthorized(Guid itemId)
        {
            if (accessByItemId.TryGetValue(itemId, out var authorized))
            {
                return authorized;
            }

            authorized = _libraryManager.GetItemById<BaseItem>(itemId, user) is not null;
            accessByItemId[itemId] = authorized;
            return authorized;
        }

        var sourceSections = FindNode(sourcePayload, "sections") as JsonArray;
        var sourceSectionItems = BuildSourceSectionItems(sourcePayload, sourceSections);
        var virtualSectionIds = GetVirtualSectionIds(sourceSections);
        var filteredSectionItems = new JsonObject();

        foreach (var section in sourceSectionItems)
        {
            if (section.Value is not JsonArray sourceItems)
            {
                continue;
            }

            var filteredItems = FilterItems(sourceItems, IsAuthorized);
            if (filteredItems.Count > 0 || virtualSectionIds.Contains(section.Key))
            {
                filteredSectionItems[section.Key] = filteredItems;
            }
        }

        var sectionProjection = SanitizeSections(sourceSections, sourceSectionItems, filteredSectionItems, associationProjection);
        var filteredPayload = new JsonObject
        {
            ["heroItems"] = FilterItems(FindNode(sourcePayload, "heroItems") as JsonArray, IsAuthorized),
            ["sectionItems"] = sectionProjection.SectionItems,
            ["sections"] = sectionProjection.Sections,
            ["rowDiagnostics"] = new JsonArray()
        };

        foreach (var field in AllowedPayloadScalarFields)
        {
            CopyKnownProperty(sourcePayload, filteredPayload, field);
        }

        var filteredFeaturedContent = new JsonObject
        {
            ["payload"] = filteredPayload
        };
        CopyKnownProperty(featuredContent, filteredFeaturedContent, "version");
        CopyKnownProperty(featuredContent, filteredFeaturedContent, "createdAt");
        CopyKnownProperty(featuredContent, filteredFeaturedContent, "expiresAt");

        var filteredDocument = new PtvFeaturedContentDocument
        {
            Version = document.Version,
            UpdatedAt = document.UpdatedAt,
            FeaturedContent = filteredFeaturedContent,
            FeaturedContentSettings = SanitizeSettings(document.FeaturedContentSettings),
            ConfiguredRowProjection = associationProjection
        };

        _associations?.FinalizeResponse(filteredDocument);

        return new(
            true,
            filteredDocument,
            accessByItemId.Count,
            accessByItemId.Count(entry => entry.Value));
    }

    private static JsonObject BuildSourceSectionItems(JsonObject payload, JsonArray? sections)
    {
        var sourceItems = new JsonObject();
        var ambiguousSectionIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (HasAmbiguousProperty(payload, "sectionItems"))
        {
            return sourceItems;
        }

        if (FindNode(payload, "sectionItems") is JsonObject sectionItems)
        {
            foreach (var sectionGroup in sectionItems.GroupBy(
                section => section.Key,
                StringComparer.OrdinalIgnoreCase))
            {
                var groupedSections = sectionGroup.ToArray();
                if (groupedSections.Length != 1)
                {
                    ambiguousSectionIds.Add(sectionGroup.Key);
                    continue;
                }

                var section = groupedSections[0];
                if (section.Value is JsonArray items)
                {
                    sourceItems[section.Key] = items.DeepClone();
                }
            }
        }

        if (sections is null)
        {
            return sourceItems;
        }

        foreach (var (section, sectionId) in GetUniqueSectionsById(sections))
        {
            if (ambiguousSectionIds.Contains(sectionId)
                || TryFindArray(sourceItems, sectionId, out _, out _))
            {
                continue;
            }

            if (FindNode(section, "items") is JsonArray embeddedItems)
            {
                sourceItems[sectionId] = embeddedItems.DeepClone();
            }
        }

        return sourceItems;
    }

    private static HashSet<string> GetVirtualSectionIds(JsonArray? sections)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (sections is null)
        {
            return result;
        }

        foreach (var (section, sectionId) in GetUniqueSectionsById(sections))
        {
            var sourceType = ReadString(section, "sourceType");
            if (VirtualSourceTypes.Contains(sourceType))
            {
                result.Add(sectionId);
            }
        }

        return result;
    }

    private static JsonArray FilterItems(JsonArray? source, Func<Guid, bool> isAuthorized)
    {
        var filtered = new JsonArray();
        if (source is null)
        {
            return filtered;
        }

        foreach (var candidate in source.OfType<JsonObject>())
        {
            if (!TryReadItemId(candidate, out var itemId) || !isAuthorized(itemId))
            {
                continue;
            }

            filtered.Add(SanitizeItem(candidate));
        }

        return filtered;
    }

    private static JsonObject SanitizeItem(JsonObject source)
    {
        var item = new JsonObject();

        foreach (var field in AllowedItemFields)
        {
            var value = FindNode(source, field);
            if (value is null)
            {
                continue;
            }

            if (field.Equals("MediaSources", StringComparison.OrdinalIgnoreCase))
            {
                item[field] = SanitizeObjectArray(value as JsonArray, AllowedMediaSourceFields, sanitizeStreams: true);
            }
            else if (field.Equals("MediaStreams", StringComparison.OrdinalIgnoreCase))
            {
                item[field] = SanitizeObjectArray(value as JsonArray, AllowedMediaStreamFields, sanitizeStreams: false);
            }
            else if (field.Equals("PtvHeroRecommendationLabel", StringComparison.OrdinalIgnoreCase))
            {
                var label = value is JsonValue labelValue
                    && labelValue.TryGetValue<string>(out var rawLabel)
                    ? rawLabel
                    : null;
                if (!string.IsNullOrWhiteSpace(label) && AllowedHeroLabels.Contains(label))
                {
                    item[field] = label;
                }
            }
            else
            {
                item[field] = value.DeepClone();
            }
        }

        return item;
    }

    private static JsonArray SanitizeObjectArray(JsonArray? source, HashSet<string> allowedFields, bool sanitizeStreams)
    {
        var result = new JsonArray();
        if (source is null)
        {
            return result;
        }

        foreach (var sourceObject in source.OfType<JsonObject>())
        {
            var target = new JsonObject();
            foreach (var field in allowedFields)
            {
                var value = FindNode(sourceObject, field);
                if (value is null)
                {
                    continue;
                }

                target[field] = sanitizeStreams
                    && field.Equals("MediaStreams", StringComparison.OrdinalIgnoreCase)
                    ? SanitizeObjectArray(value as JsonArray, AllowedMediaStreamFields, sanitizeStreams: false)
                    : value.DeepClone();
            }

            result.Add(target);
        }

        return result;
    }

    private static SanitizedSectionProjection SanitizeSections(
        JsonArray? source,
        JsonObject sourceSectionItems,
        JsonObject filteredSectionItems,
        PtvConfiguredRowAssociationService.Projection? associationProjection)
    {
        var sections = new JsonArray();
        var sectionItems = new JsonObject();
        var processedSourceKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var reservedSourceIds = filteredSectionItems
            .Select(property => property.Key)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var (sourceSection, sectionId) in GetUniqueSectionsById(source))
        {
            if (!TryFindArray(filteredSectionItems, sectionId, out var sourceItemsKey, out var authorizedItems)
                || !processedSourceKeys.Add(sourceItemsKey))
            {
                continue;
            }

            _ = TryFindArray(sourceSectionItems, sectionId, out _, out var unfilteredItems);
            var recommendationSection = ReadString(sourceSection, "sourceType").Equals("recommendation", StringComparison.OrdinalIgnoreCase)
                || ReadString(sourceSection, "type").Equals("recommendation", StringComparison.OrdinalIgnoreCase)
                || ReadString(sourceSection, "rowType").Contains("recommendation", StringComparison.OrdinalIgnoreCase);
            var fallbackSection = ReadBoolean(sourceSection, "fallbackUsed");
            var requiresMetadataRedaction = recommendationSection
                || fallbackSection
                || unfilteredItems is null
                || authorizedItems.Count < unfilteredItems.OfType<JsonObject>().Count();
            var section = new JsonObject();
            foreach (var field in AllowedSectionFields)
            {
                CopyKnownProperty(sourceSection, section, field);
            }

            var responseSectionId = sectionId;
            if (requiresMetadataRedaction)
            {
                responseSectionId = CreateSafeSectionId(
                    recommendationSection ? "recommendation" : fallbackSection ? "fallback" : "section",
                    sectionItems,
                    reservedSourceIds);
                NormalizeSensitiveSection(section, responseSectionId);
            }

            section["itemCount"] = authorizedItems.Count;
            section["finalRenderedCount"] = authorizedItems.Count;
            section["candidateCount"] = authorizedItems.Count;
            section["matchedCount"] = authorizedItems.Count;
            section["dedupeRemovals"] = 0;
            section["hydrationRemovals"] = 0;
            section["primaryCandidateCount"] = 0;
            section["secondaryFallbackCount"] = 0;
            section["discoveryFallbackCount"] = 0;
            // This is deliberately after authorization and sensitive-metadata sanitization.
            // Source/client aliases are not allowlisted and cannot reach this attachment path.
            if (associationProjection?.ForSection(sectionId) is { } association)
            {
                section["configuredRowAssociation"] = association;
            }
            sectionItems[responseSectionId] = authorizedItems.DeepClone();
            sections.Add(section);
        }

        foreach (var orphanedItems in filteredSectionItems.ToArray())
        {
            if (processedSourceKeys.Contains(orphanedItems.Key) || orphanedItems.Value is not JsonArray items)
            {
                continue;
            }

            var responseSectionId = CreateSafeSectionId("section", sectionItems, reservedSourceIds);
            sectionItems[responseSectionId] = items.DeepClone();
            sections.Add(CreateGenericSection(responseSectionId, items.Count));
        }

        return new(sectionItems, sections);
    }

    private static void NormalizeSensitiveSection(JsonObject target, string safeSectionId)
    {
        foreach (var field in new[]
        {
            "cacheHash",
            "configHash",
            "editorialDescription",
            "emptyResultReason",
            "groupTitle",
            "homeProfileMood",
            "homeProfileMoodConfidence",
            "parentRuleId",
            "recommendationConfigHash",
            "rowConfigHash",
            "rowKicker",
            "ruleId",
            "ruleName",
            "sourceGroupId",
            "sourceRecommendationId",
            "sourceRuleId",
            "sourceValue",
            "studioFilter"
        })
        {
            target.Remove(field);
        }

        target["id"] = safeSectionId;
        target["source"] = "authorized";
        target["title"] = "Featured";
    }

    private static string CreateSafeSectionId(
        string category,
        JsonObject sectionItems,
        IReadOnlySet<string> reservedSourceIds)
    {
        var safeId = category;
        var suffix = 2;
        while (reservedSourceIds.Contains(safeId)
            || sectionItems.Any(property => property.Key.Equals(safeId, StringComparison.OrdinalIgnoreCase)))
        {
            safeId = $"{category}-{suffix++}";
        }

        return safeId;
    }

    private static JsonObject CreateGenericSection(string sectionId, int itemCount) => new()
    {
        ["id"] = sectionId,
        ["source"] = "authorized",
        ["title"] = "Featured",
        ["itemCount"] = itemCount,
        ["finalRenderedCount"] = itemCount,
        ["candidateCount"] = itemCount,
        ["matchedCount"] = itemCount,
        ["dedupeRemovals"] = 0,
        ["hydrationRemovals"] = 0,
        ["primaryCandidateCount"] = 0,
        ["secondaryFallbackCount"] = 0,
        ["discoveryFallbackCount"] = 0
    };

    private static JsonNode? SanitizeSettings(JsonNode? source)
    {
        if (source is not JsonObject settings)
        {
            return source is null ? null : new JsonObject();
        }

        var sanitized = new JsonObject();
        CopyKnownProperty(settings, sanitized, "ttlMs");
        return sanitized;
    }

    private static bool TryFindArray(
        JsonObject source,
        string propertyName,
        out string actualPropertyName,
        out JsonArray array)
    {
        actualPropertyName = string.Empty;
        array = null!;
        var found = false;
        foreach (var property in source)
        {
            if (!property.Key.Equals(propertyName, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (found)
            {
                actualPropertyName = string.Empty;
                array = null!;
                return false;
            }

            found = true;
            actualPropertyName = property.Key;
            array = property.Value as JsonArray ?? null!;
        }

        return found && array is not null;
    }

    private static IEnumerable<(JsonObject Section, string Id)> GetUniqueSectionsById(JsonArray? sections)
    {
        if (sections is null)
        {
            yield break;
        }

        var candidates = sections
            .OfType<JsonObject>()
            .Where(section => !HasCaseInsensitiveDuplicateProperties(section))
            .Select(section => (Section: section, Id: ReadString(section, "id")))
            .Where(candidate => !string.IsNullOrWhiteSpace(candidate.Id))
            .ToArray();
        var idCounts = candidates
            .GroupBy(candidate => candidate.Id, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase);

        foreach (var candidate in candidates)
        {
            if (idCounts[candidate.Id] == 1)
            {
                yield return candidate;
            }
        }
    }

    private static bool TryReadItemId(JsonObject item, out Guid itemId)
    {
        itemId = Guid.Empty;
        var value = ReadString(item, "Id");
        return Guid.TryParse(value, out itemId) && itemId != Guid.Empty;
    }

    private static string ReadString(JsonObject source, string propertyName)
    {
        var node = FindNode(source, propertyName);
        return node is JsonValue value && value.TryGetValue<string>(out var result)
            ? result?.Trim() ?? string.Empty
            : string.Empty;
    }

    private static bool ReadBoolean(JsonObject source, string propertyName)
    {
        var node = FindNode(source, propertyName);
        return node is JsonValue value && value.TryGetValue<bool>(out var result) && result;
    }

    private static JsonNode? FindNode(JsonObject source, string propertyName)
    {
        JsonNode? result = null;
        var found = false;
        foreach (var property in source)
        {
            if (property.Key.Equals(propertyName, StringComparison.OrdinalIgnoreCase))
            {
                if (found)
                {
                    return null;
                }

                found = true;
                result = property.Value;
            }
        }

        return result;
    }

    private static bool HasAmbiguousProperty(JsonObject source, string propertyName) =>
        source.Count(property => property.Key.Equals(propertyName, StringComparison.OrdinalIgnoreCase)) > 1;

    private static bool HasCaseInsensitiveDuplicateProperties(JsonObject source) =>
        source
            .GroupBy(property => property.Key, StringComparer.OrdinalIgnoreCase)
            .Any(group => group.Count() > 1);

    private static void CopyKnownProperty(JsonObject source, JsonObject target, string propertyName)
    {
        var value = FindNode(source, propertyName);
        if (value is not null)
        {
            target[propertyName] = value.DeepClone();
        }
    }

    private sealed record SanitizedSectionProjection(JsonObject SectionItems, JsonArray Sections);
}
