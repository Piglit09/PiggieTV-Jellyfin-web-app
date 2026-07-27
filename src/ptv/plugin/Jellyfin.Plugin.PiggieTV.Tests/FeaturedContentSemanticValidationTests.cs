using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class FeaturedContentSemanticValidationTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [Fact]
    public void ValidateForSaveRejectsConfigurationOnlySectionShells()
    {
        var payload = CreatePayload();
        payload["sections"] = new JsonArray(Enumerable.Range(0, 6).Select(index => (JsonNode)new JsonObject { ["id"] = $"row-{index}" }).ToArray());
        payload["sectionItems"] = new JsonObject(Enumerable.Range(0, 6).Select(index => KeyValuePair.Create<string, JsonNode?>($"row-{index}", new JsonArray())));

        var exception = Assert.Throws<PtvFeaturedContentValidationException>(() =>
            PtvFeaturedContentValidator.ValidateForSave(CreateDocument(payload), JsonOptions));

        Assert.Equal("PTV_CACHE_INCOMPLETE_PAYLOAD", exception.Code);
    }

    [Fact]
    public void ValidateForSaveAcceptsPopulatedJellyfinContent()
    {
        var payload = CreatePayload();
        payload["sectionItems"] = new JsonObject { ["recent"] = new JsonArray(new JsonObject { ["Id"] = "synthetic-item" }) };

        var document = PtvFeaturedContentValidator.ValidateForSave(CreateDocument(payload), JsonOptions);

        Assert.Equal("complete", PtvFeaturedContentValidator.GetSemanticStatus(payload).Classification);
        Assert.NotNull(document.FeaturedContent);
    }

    [Fact]
    public void ValidateForSaveAcceptsExplicitEmptyLibraryState()
    {
        var payload = CreatePayload();
        payload["emptyLibraryConfirmed"] = true;

        var document = PtvFeaturedContentValidator.ValidateForSave(CreateDocument(payload), JsonOptions);

        Assert.Equal("intentional-empty", PtvFeaturedContentValidator.GetSemanticStatus(payload).Classification);
        Assert.NotNull(document.FeaturedContent);
    }

    private static JsonObject CreatePayload() => new()
    {
        ["heroItems"] = new JsonArray(),
        ["sectionItems"] = new JsonObject(),
        ["sections"] = new JsonArray()
    };

    private static PtvFeaturedContentDocument CreateDocument(JsonObject payload)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return new PtvFeaturedContentDocument
        {
            Version = PtvFeaturedContentValidator.DocumentVersion,
            FeaturedContent = new JsonObject
            {
                ["version"] = PtvFeaturedContentValidator.FeaturedCacheVersion,
                ["createdAt"] = now,
                ["expiresAt"] = now + (2 * 60 * 60 * 1000),
                ["payload"] = payload
            }
        };
    }
}
