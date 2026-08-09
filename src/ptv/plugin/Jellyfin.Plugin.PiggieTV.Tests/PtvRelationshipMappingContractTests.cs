using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Xml.Serialization;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvRelationshipMappingContractTests
{
    [Fact]
    public void StatusAdvertisesAuthoritativeDetailsRelationships()
    {
        var status = new PtvStatusResponse();

        Assert.Contains("detailsRelationships", status.Features);
        Assert.Contains("detailsRelationships", status.SupportedFeatureFlags);
        Assert.True(status.FeatureFlags["detailsRelationships"]);
        Assert.True(status.ServerCapabilities["detailsRelationships"]);
        Assert.Equal("v1/relationships", PtvApiRoutes.V1Relationships);
    }

    [Theory]
    [InlineData(nameof(PtvRelationshipController.GetRelationships), "{sourceItemId}", typeof(HttpGetAttribute))]
    [InlineData(nameof(PtvRelationshipController.CreateRelationship), null, typeof(HttpPostAttribute))]
    [InlineData(nameof(PtvRelationshipController.UpdateRelationship), "{mappingId}", typeof(HttpPutAttribute))]
    [InlineData(nameof(PtvRelationshipController.DeleteRelationship), "{mappingId}", typeof(HttpDeleteAttribute))]
    public void ControllerPublishesAdditiveApiV1Routes(string methodName, string? template, Type attributeType)
    {
        var route = typeof(PtvRelationshipController).GetCustomAttribute<RouteAttribute>();
        var authorize = typeof(PtvRelationshipController).GetCustomAttribute<AuthorizeAttribute>();
        var method = typeof(PtvRelationshipController).GetMethod(methodName);
        var methodRoute = method?.GetCustomAttributes(attributeType, inherit: true)
            .Cast<HttpMethodAttribute>()
            .SingleOrDefault();

        Assert.Equal("Ptv/v1/relationships", route?.Template);
        Assert.NotNull(authorize);
        Assert.NotNull(methodRoute);
        Assert.Equal(template, methodRoute.Template);
        Assert.Equal(1, PtvApiRoutes.CurrentVersion);
    }

    [Fact]
    public void ConfigurationRoundTripsDeterministicallyThroughXml()
    {
        var firstMappingId = Guid.NewGuid();
        var secondMappingId = Guid.NewGuid();
        var firstSourceId = Guid.NewGuid();
        var secondSourceId = Guid.NewGuid();
        var configuration = new PluginConfiguration();
        configuration.RelationshipMappings.SetMappings(
        [
            Mapping(secondMappingId, secondSourceId, Guid.NewGuid(), "adaptation", 20),
            Mapping(firstMappingId, firstSourceId, Guid.NewGuid(), "soundtrack", 10)
        ]);

        var serializer = new XmlSerializer(typeof(PluginConfiguration));
        using var writer = new StringWriter();
        serializer.Serialize(writer, configuration);
        var xml = writer.ToString();
        using var reader = new StringReader(xml);
        var restored = Assert.IsType<PluginConfiguration>(serializer.Deserialize(reader));
        var mappings = restored.RelationshipMappings.GetMappings();

        Assert.Contains("<RelationshipMappings>", xml, StringComparison.Ordinal);
        Assert.Contains("<Mappings>", xml, StringComparison.Ordinal);
        Assert.Equal(2, mappings.Count);
        Assert.Equal(
            new[] { firstSourceId, secondSourceId }.OrderBy(id => id.ToString("N"), StringComparer.OrdinalIgnoreCase),
            mappings.Select(mapping => Guid.Parse(mapping.SourceItemId)));
        Assert.All(mappings, mapping => Assert.Equal(1, mapping.SchemaVersion));
    }

    [Fact]
    public void ServiceCreatesOrdersAndVisibilityFiltersRelationships()
    {
        var fixture = new ServiceFixture();
        var movieId = fixture.Add(new Movie());
        var albumId = fixture.Add(new MusicAlbum());
        var bookId = fixture.Add(new Book());
        var userId = Guid.NewGuid();
        var service = fixture.CreateService();

        var soundtrack = service.Create(new PtvRelationshipMappingCreateRequest
        {
            Category = "soundtrack",
            Direction = "bidirectional",
            DisplayOrder = 20,
            SourceItemId = movieId.ToString("N"),
            TargetItemId = albumId.ToString("N")
        });
        service.Create(new PtvRelationshipMappingCreateRequest
        {
            Category = "companion-reading",
            DisplayOrder = 10,
            SourceItemId = movieId.ToString("N"),
            TargetItemId = bookId.ToString("N")
        });

        var movieResponse = Assert.IsType<PtvRelationshipMappingsResponse>(service.GetForSource(movieId, userId));
        var albumResponse = Assert.IsType<PtvRelationshipMappingsResponse>(service.GetForSource(albumId, userId));

        Assert.Equal([bookId.ToString("N"), albumId.ToString("N")], movieResponse.Relationships.Select(mapping => mapping.TargetItemId));
        Assert.Single(albumResponse.Relationships);
        Assert.Equal(movieId.ToString("N"), albumResponse.Relationships[0].TargetItemId);
        Assert.Equal(soundtrack.MappingId, albumResponse.Relationships[0].MappingId);

        fixture.VisibleIds.Remove(bookId);
        movieResponse = Assert.IsType<PtvRelationshipMappingsResponse>(service.GetForSource(movieId, userId));
        Assert.Single(movieResponse.Relationships);

        fixture.VisibleIds.Remove(movieId);
        Assert.Null(service.GetForSource(movieId, userId));
    }

    [Fact]
    public void ServiceRejectsInvalidMissingSameFamilyAndDuplicateMappings()
    {
        var fixture = new ServiceFixture();
        var movieId = fixture.Add(new Movie());
        var secondMovieId = fixture.Add(new Movie());
        var albumId = fixture.Add(new MusicAlbum());
        var bookId = fixture.Add(new Book());
        var service = fixture.CreateService();

        AssertCode(
            "PTV_RELATIONSHIPS_SELF_LINK",
            () => service.Create(Request(movieId, movieId, "adaptation")));
        AssertCode(
            "PTV_RELATIONSHIPS_TARGET_NOT_FOUND",
            () => service.Create(Request(movieId, Guid.NewGuid(), "adaptation")));
        AssertCode(
            "PTV_RELATIONSHIPS_CROSS_FAMILY_REQUIRED",
            () => service.Create(Request(movieId, secondMovieId, "adaptation")));
        AssertCode(
            "PTV_RELATIONSHIPS_CATEGORY_INVALID",
            () => service.Create(Request(movieId, albumId, "same-title")));
        AssertCode(
            "PTV_RELATIONSHIPS_CATEGORY_TARGET_MISMATCH",
            () => service.Create(Request(movieId, bookId, "soundtrack")));

        service.Create(Request(movieId, albumId, "soundtrack"));
        AssertCode(
            "PTV_RELATIONSHIPS_DUPLICATE",
            () => service.Create(Request(movieId, albumId, "soundtrack")));
    }

    [Fact]
    public void ServiceUpdatesDeletesAndImmediatelyInvalidatesReads()
    {
        var fixture = new ServiceFixture();
        var movieId = fixture.Add(new Movie());
        var bookId = fixture.Add(new Book());
        var userId = Guid.NewGuid();
        var service = fixture.CreateService();
        var created = service.Create(Request(movieId, bookId, "companion-reading"));
        var mappingId = Guid.Parse(created.MappingId);

        var disabled = service.Update(mappingId, new PtvRelationshipMappingUpdateRequest
        {
            DisplayOrder = 44,
            Enabled = false
        });

        Assert.False(disabled.Enabled);
        Assert.Empty(Assert.IsType<PtvRelationshipMappingsResponse>(service.GetForSource(movieId, userId)).Relationships);

        var enabled = service.Update(mappingId, new PtvRelationshipMappingUpdateRequest { Enabled = true });
        Assert.True(enabled.Enabled);
        Assert.Single(Assert.IsType<PtvRelationshipMappingsResponse>(service.GetForSource(movieId, userId)).Relationships);

        service.Delete(mappingId);
        Assert.Empty(fixture.Configuration.RelationshipMappings.GetMappings());
        Assert.Empty(Assert.IsType<PtvRelationshipMappingsResponse>(service.GetForSource(movieId, userId)).Relationships);
        Assert.Equal(4, fixture.SaveCount);
    }

    [Fact]
    public void ServiceOmitsMalformedMissingAndUnsupportedPersistedTargets()
    {
        var fixture = new ServiceFixture();
        var movieId = fixture.Add(new Movie());
        var albumId = fixture.Add(new MusicAlbum());
        var userId = Guid.NewGuid();
        fixture.Configuration.RelationshipMappings.SetMappings(
        [
            Mapping(Guid.NewGuid(), movieId, albumId, "soundtrack", 0),
            Mapping(Guid.NewGuid(), movieId, Guid.NewGuid(), "adaptation", 1),
            new PtvRelationshipMappingDefinition
            {
                Category = "soundtrack",
                MappingId = "malformed",
                SourceItemId = movieId.ToString("N"),
                TargetItemId = albumId.ToString("N")
            },
            Mapping(Guid.NewGuid(), movieId, albumId, "unsupported", 2)
        ]);

        var response = Assert.IsType<PtvRelationshipMappingsResponse>(fixture.CreateService().GetForSource(movieId, userId));

        Assert.Single(response.Relationships);
        Assert.Equal(albumId.ToString("N"), response.Relationships[0].TargetItemId);
    }

    [Fact]
    public void ServiceLogsContainCategoriesAndCountsButNoIdentities()
    {
        var logger = new ListLogger<PtvRelationshipMappingService>();
        var fixture = new ServiceFixture();
        var movieId = fixture.Add(new Movie());
        var albumId = fixture.Add(new MusicAlbum());
        var service = fixture.CreateService(logger);
        var created = service.Create(Request(movieId, albumId, "soundtrack"));
        service.Delete(Guid.Parse(created.MappingId));
        var combined = string.Join("\n", logger.Messages);

        Assert.Contains("soundtrack", combined, StringComparison.Ordinal);
        Assert.DoesNotContain(movieId.ToString("N"), combined, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(albumId.ToString("N"), combined, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(created.MappingId, combined, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ResponseContractContainsOnlyExpectedRelationshipFields()
    {
        var response = new PtvRelationshipMappingsResponse
        {
            Relationships =
            [
                new PtvRelationshipMappingDto
                {
                    MappingId = Guid.NewGuid().ToString("N"),
                    TargetItemId = Guid.NewGuid().ToString("N"),
                    Category = "adaptation"
                }
            ]
        };
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(response));
        var relationship = json.RootElement.GetProperty("relationships")[0];

        Assert.Equal(1, json.RootElement.GetProperty("schemaVersion").GetInt32());
        Assert.Equal(
            ["category", "direction", "displayOrder", "enabled", "mappingId", "schemaVersion", "targetItemId"],
            relationship.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task ControllerUsesAuthenticatedUserForReadsAndElevationForWrites()
    {
        var sourceId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var fakeService = new FakeRelationshipService();
        var controller = CreateController(fakeService, new DenyAuthorizationService(), userId);

        var read = controller.GetRelationships(sourceId.ToString("N"));
        var readResult = Assert.IsType<OkObjectResult>(read.Result);
        Assert.IsType<PtvRelationshipMappingsResponse>(readResult.Value);
        Assert.Equal(userId, fakeService.LastUserId);

        var denied = await controller.CreateRelationship(
            new PtvRelationshipMappingCreateRequest(),
            CancellationToken.None);
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(denied.Result).StatusCode);
        Assert.Equal(0, fakeService.CreateCalls);

        controller = CreateController(fakeService, new AllowAuthorizationService(), userId);
        var created = await controller.CreateRelationship(
            new PtvRelationshipMappingCreateRequest(),
            CancellationToken.None);
        Assert.Equal(StatusCodes.Status201Created, Assert.IsType<ObjectResult>(created.Result).StatusCode);
        Assert.Equal(1, fakeService.CreateCalls);
    }

    [Theory]
    [InlineData("Movie", "video")]
    [InlineData("MusicAlbum", "music")]
    [InlineData("Book", "reading")]
    [InlineData("Game", "game")]
    [InlineData("Playlist", null)]
    public void MediaFamilyClassificationIsExplicit(string itemType, string? expectedFamily)
    {
        Assert.Equal(expectedFamily, PtvRelationshipMappingService.ClassifyItemType(itemType));
    }

    private static PtvRelationshipController CreateController(
        IPtvRelationshipMappingService service,
        IAuthorizationService authorizationService,
        Guid userId)
    {
        return new PtvRelationshipController(
            service,
            authorizationService,
            NullLogger<PtvRelationshipController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        [new Claim("Jellyfin-UserId", userId.ToString("N"))],
                        "Test"))
                }
            }
        };
    }

    private static PtvRelationshipMappingCreateRequest Request(Guid sourceId, Guid targetId, string category) => new()
    {
        Category = category,
        SourceItemId = sourceId.ToString("N"),
        TargetItemId = targetId.ToString("N")
    };

    private static PtvRelationshipMappingDefinition Mapping(
        Guid mappingId,
        Guid sourceId,
        Guid targetId,
        string category,
        int displayOrder) => new()
    {
        Category = category,
        Direction = "source-to-target",
        DisplayOrder = displayOrder,
        Enabled = true,
        MappingId = mappingId.ToString("N"),
        SchemaVersion = 1,
        SourceItemId = sourceId.ToString("N"),
        TargetItemId = targetId.ToString("N")
    };

    private static void AssertCode(string expectedCode, Action action)
    {
        var exception = Assert.Throws<PtvRelationshipMappingException>(action);
        Assert.Equal(expectedCode, exception.Code);
    }

    private sealed class ServiceFixture
    {
        public PluginConfiguration Configuration { get; private set; } = new();

        public Dictionary<Guid, BaseItem> Items { get; } = [];

        public HashSet<Guid> VisibleIds { get; } = [];

        public int SaveCount { get; private set; }

        public Guid Add(BaseItem item)
        {
            var id = Guid.NewGuid();
            Items[id] = item;
            VisibleIds.Add(id);
            return id;
        }

        public PtvRelationshipMappingService CreateService(ILogger<PtvRelationshipMappingService>? logger = null)
        {
            return new PtvRelationshipMappingService(
                logger ?? NullLogger<PtvRelationshipMappingService>.Instance,
                itemId => Items.GetValueOrDefault(itemId),
                (itemId, _) => VisibleIds.Contains(itemId) ? Items.GetValueOrDefault(itemId) : null,
                () => Configuration,
                savedConfiguration =>
                {
                    Configuration = savedConfiguration;
                    SaveCount++;
                });
        }
    }

    private sealed class FakeRelationshipService : IPtvRelationshipMappingService
    {
        public int CreateCalls { get; private set; }

        public Guid LastUserId { get; private set; }

        public PtvRelationshipMappingDto Create(PtvRelationshipMappingCreateRequest request)
        {
            CreateCalls++;
            return new PtvRelationshipMappingDto();
        }

        public void Delete(Guid mappingId)
        {
        }

        public PtvRelationshipMappingsResponse? GetForSource(Guid sourceItemId, Guid userId)
        {
            LastUserId = userId;
            return new PtvRelationshipMappingsResponse();
        }

        public PtvRelationshipMappingDto Update(Guid mappingId, PtvRelationshipMappingUpdateRequest request) => new();
    }

    private sealed class AllowAuthorizationService : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            IEnumerable<IAuthorizationRequirement> requirements) => Task.FromResult(AuthorizationResult.Success());

        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            string policyName) => Task.FromResult(AuthorizationResult.Success());
    }

    private sealed class DenyAuthorizationService : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            IEnumerable<IAuthorizationRequirement> requirements) => Task.FromResult(AuthorizationResult.Failed());

        public Task<AuthorizationResult> AuthorizeAsync(
            ClaimsPrincipal user,
            object? resource,
            string policyName) => Task.FromResult(AuthorizationResult.Failed());
    }

    private sealed class ListLogger<T> : ILogger<T>
    {
        public List<string> Messages { get; } = [];

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter) => Messages.Add(formatter(state, exception));
    }
}
