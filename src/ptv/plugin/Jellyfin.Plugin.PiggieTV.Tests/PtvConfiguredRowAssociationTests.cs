using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

// Component/controller calls, not hosted HTTP or Jellyfin middleware integration tests.
[Collection("Configured row association serial")]
public sealed class PtvConfiguredRowAssociationTests
{
    private static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OtherUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid[] ItemIds = Enumerable.Range(1, 4).Select(i => Guid.Parse($"aaaaaaaa-aaaa-aaaa-aaaa-{i:D12}")).ToArray();

    [Theory]
    [InlineData(4)]
    [InlineData(3)]
    [InlineData(1)]
    [InlineData(0)]
    public async Task AuthorizationSurvivorsAndSelectiveRedactionAreUnchanged(int survivors)
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var before = JsonSerializer.Serialize(raw);
        var baseline = fixture.Project(raw, survivors, associations: false);
        var response = fixture.Project(raw, survivors);
        var sections = Sections(response);
        Assert.Equal(Sections(baseline).Count, sections.Count);
        Assert.Equal(Payload(baseline)["sectionItems"]!.ToJsonString(), Payload(response)["sectionItems"]!.ToJsonString());
        if (survivors > 0)
        {
            var section = Assert.IsType<JsonObject>(Assert.Single(sections));
            var alias = Assert.IsType<JsonObject>(section["configuredRowAssociation"]);
            AssertToken(alias["scope"]);
            AssertToken(alias["rule"]);
            AssertToken(alias["section"]);
            var mapping = fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]!;
            Assert.Equal(mapping["scope"]!.GetValue<string>(), alias["scope"]!.GetValue<string>());
            Assert.Equal(mapping["rules"]![0]!["association"]!.GetValue<string>(), alias["rule"]!.GetValue<string>());
            Assert.Equal(mapping["sections"]![0]!["section"]!.GetValue<string>(), alias["section"]!.GetValue<string>());
            Assert.Equal(1, alias["version"]!.GetValue<int>());
            if (survivors < 4)
            {
                Assert.Null(section["sourceRuleId"]);
                Assert.DoesNotContain("PRIVATE_SELECTOR", section.ToJsonString());
            }
            else
            {
                Assert.Equal("rule-a", section["sourceRuleId"]!.GetValue<string>());
            }
            section.Remove("configuredRowAssociation");
        }
        Payload(response).Remove("currentPresentationAuthority");
        Assert.Equal(JsonSerializer.Serialize(baseline), JsonSerializer.Serialize(response));
        Assert.Equal(before, JsonSerializer.Serialize(raw));
    }

    [Fact]
    public async Task MultiSectionRulesHaveSharedRuleAndUniqueExactSectionPairs()
    {
        using var fixture = new Fixture();
        fixture.Configuration.Rows.Rules[0].RowCount = 3;
        fixture.Configuration.Rows.Rules[0].IncludeSubgenres = true;
        fixture.Configuration.Rows.Rules[0].SubgenreRowCount = 2;
        var raw = await fixture.Generate(Document(("genre-a", "rule-a"), ("genre-b", "rule-a"), ("genre-c", "rule-a")));
        var aliases = Sections(fixture.Project(raw, 1)).Select(s => s!["configuredRowAssociation"]!).ToArray();
        Assert.Single(aliases.Select(a => a["rule"]!.GetValue<string>()).Distinct());
        Assert.Equal(3, aliases.Select(a => a["section"]!.GetValue<string>()).Distinct().Count());
        var pairs = fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]!["sections"]!.AsArray();
        Assert.Equal(3, pairs.Count);
        Assert.All(aliases, alias => Assert.Single(pairs, p => p!["rule"]!.ToJsonString() == alias["rule"]!.ToJsonString() && p["section"]!.ToJsonString() == alias["section"]!.ToJsonString()));
    }

    [Fact]
    public async Task SectionTokenDependsOnPrivateInstanceNonceNotRawIdTitleOrOrdinal()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate(Document(("genre-0", "rule-a"), ("genre-1", "rule-a")));
        var projection = fixture.Authority.CaptureProjection(raw, UserId)!;
        var originalAlias = projection.ForSection("genre-0")!;
        var owner = projection.Binding.SectionOwners["genre-0"];
        // Isolate token derivation from the projector lookup: the same private instance moved
        // to a different internal lookup ID must produce the very same opaque instance token.
        var renamedBinding = projection.Binding with
        {
            SectionOwners = new Dictionary<string, PtvConfiguredRowAssociationService.SectionOwner> { ["not-a-genre-or-ordinal"] = owner }
        };
        var renamed = new PtvConfiguredRowAssociationService.Projection(fixture.Authority, renamedBinding, UserId);
        Assert.Equal(originalAlias.ToJsonString(), renamed.ForSection("not-a-genre-or-ordinal")!.ToJsonString());
        Assert.NotEqual(originalAlias["section"]!.ToJsonString(), projection.ForSection("genre-1")!["section"]!.ToJsonString());
        Assert.DoesNotContain(owner.InstanceNonce, originalAlias.ToJsonString());
    }

    [Fact]
    public async Task InstanceTokensSurviveReadbackReloadButRotateOnNewTrustedGeneration()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var first = fixture.Authority.CaptureProjection(raw, UserId)!.ForSection("section-a")!;
        for (var read = 0; read < 3; read++)
        {
            var reloaded = await fixture.Store.ReadAsync(CancellationToken.None);
            Assert.Equal(first.ToJsonString(), fixture.Authority.CaptureProjection(reloaded, UserId)!.ForSection("section-a")!.ToJsonString());
        }
        var next = await fixture.Generate();
        var nextAlias = fixture.Authority.CaptureProjection(next, UserId)!.ForSection("section-a")!;
        Assert.Equal(first["rule"]!.ToJsonString(), nextAlias["rule"]!.ToJsonString());
        Assert.NotEqual(first["section"]!.ToJsonString(), nextAlias["section"]!.ToJsonString());
    }

    [Fact]
    public async Task SameTitlesAndMediaTypesDoNotMergeRules()
    {
        using var fixture = new Fixture();
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "rule-b", Name = "Same", SourceType = "latest", SourceValue = "movies", MediaType = "movies" });
        var raw = await fixture.Generate(Document(("first", "rule-a"), ("second", "rule-b")));
        var aliases = Sections(fixture.Project(raw, 1)).Select(s => s!["configuredRowAssociation"]!["rule"]!.GetValue<string>()).ToArray();
        Assert.Equal(2, aliases.Distinct().Count());
    }

    [Fact]
    public async Task GenericOrphanAndUnknownRulesCannotImpersonateConfiguredRows()
    {
        using var fixture = new Fixture();
        var document = Document(("generic", "rule-a"), ("unknown", "absent"));
        Sections(document)[0]!["rowType"] = "generic";
        Payload(document)["sectionItems"]!["orphan"] = new JsonArray(Item(ItemIds[0]));
        var raw = await fixture.Generate(document);
        Assert.All(Sections(fixture.Project(raw, 1)), s => Assert.Null(s!["configuredRowAssociation"]));
    }

    [Theory]
    [InlineData("disabled")]
    [InlineData("deleted")]
    [InlineData("reordered")]
    [InlineData("changed")]
    [InlineData("aba")]
    public async Task ConfigurationMutationsRetireOldGeneration(string mutation)
    {
        using var fixture = new Fixture();
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "rule-b", SourceType = "latest", SourceValue = "movies" });
        var raw = await fixture.Generate();
        using (PtvConfiguredRowAssociationService.BeginConfigurationMutation())
        {
            if (mutation == "disabled") fixture.Configuration.Rows.Rules[0].Enabled = false;
            if (mutation == "deleted") fixture.Configuration.Rows.Rules.RemoveAt(0);
            if (mutation == "reordered") fixture.Configuration.Rows.Rules.Reverse();
            if (mutation is "changed" or "aba") fixture.Configuration.Rows.Rules[0].Name = "Changed";
        }
        if (mutation == "aba")
        {
            using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Same";
        }
        Assert.All(Sections(fixture.Project(raw, 1)), s => Assert.Null(s!["configuredRowAssociation"]));
        Assert.Null(fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]);
    }

    [Fact]
    public async Task UnobservedConfigurationChangeIsStillDetectedByPrivateDigest()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        fixture.Configuration.Rows.Rules[0].SourceValue = "other";
        Assert.Null(Sections(fixture.Project(raw, 1))[0]!["configuredRowAssociation"]);
    }

    [Fact]
    public async Task UsersServersAndRestartNeverShareAliases()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var first = Sections(fixture.Project(raw, 1))[0]!["configuredRowAssociation"]!;
        var other = Sections(fixture.Project(raw, 1, userId: OtherUserId))[0]!["configuredRowAssociation"]!;
        Assert.NotEqual(first["scope"]!.ToJsonString(), other["scope"]!.ToJsonString());
        Assert.NotEqual(first["rule"]!.ToJsonString(), other["rule"]!.ToJsonString());
        var restarted = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration);
        Assert.Null(restarted.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]);
        var otherServer = new PtvConfiguredRowAssociationService("server-b", () => fixture.Configuration);
        Assert.Null(otherServer.CaptureProjection(raw, UserId));
        var freshStore = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, restarted);
        var fresh = await freshStore.WriteGeneratedAsync(Document(), restarted.CaptureGeneration()!, CancellationToken.None);
        var newProjection = restarted.CaptureProjection(fresh, UserId)!;
        Assert.NotEqual(first["scope"]!.GetValue<string>(), newProjection.ForSection("section-a")!["scope"]!.GetValue<string>());
    }

    [Fact]
    public async Task RawPutEvenIdenticalAndClearRetireTrustedBinding()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var projected = fixture.Project(raw, 1);
        await fixture.Store.WriteAsync(raw, CancellationToken.None);
        fixture.Authority.FinalizeResponse(projected);
        Assert.Null(Sections(projected)[0]!["configuredRowAssociation"]);
        Assert.Null(Sections(fixture.Project(raw, 1))[0]!["configuredRowAssociation"]);
        raw = await fixture.Generate();
        await fixture.Store.ClearAsync(CancellationToken.None);
        Assert.Null(Sections(fixture.Project(raw, 1))[0]!["configuredRowAssociation"]);
    }

    [Fact]
    public async Task OldOrSpoofedRawCacheCannotBeRetrospectivelyAttested()
    {
        using var fixture = new Fixture();
        var document = Document();
        Sections(document)[0]!["configuredRowAssociation"] = new JsonObject { ["version"] = 1, ["scope"] = new string('a', 64), ["rule"] = new string('b', 64), ["section"] = new string('c', 64) };
        var raw = await fixture.Store.WriteAsync(document, CancellationToken.None);
        Assert.Null(Sections(fixture.Project(raw, 1))[0]!["configuredRowAssociation"]);
        Assert.Null(fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]);
    }

    [Theory]
    [InlineData("duplicate-section")]
    [InlineData("ambiguous-source-rule")]
    [InlineData("contradictory-rule")]
    [InlineData("malformed-rule")]
    public async Task AmbiguousSourceMetadataDoesNotReceiveAliases(string malformed)
    {
        using var fixture = new Fixture();
        var document = Document();
        var section = Sections(document)[0]!;
        if (malformed == "duplicate-section") Sections(document).Add(section.DeepClone());
        if (malformed == "ambiguous-source-rule") section["SourceRuleId"] = "rule-a";
        if (malformed == "contradictory-rule") section["ruleId"] = "rule-b";
        if (malformed == "malformed-rule") section["sourceRuleId"] = new JsonObject();
        var raw = await fixture.Generate(document);
        Assert.All(Sections(fixture.Project(raw, 1)), s => Assert.Null(s!["configuredRowAssociation"]));
    }

    [Fact]
    public async Task InflightGenerationAndProjectedResponseRetireOnMutation()
    {
        using var fixture = new Fixture();
        var generation = fixture.Authority.CaptureGeneration()!;
        var immutable = generation.CreateConfiguration();
        using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].SourceValue = "changed";
        Assert.Equal("movies", immutable.Rows.Rules[0].SourceValue);
        var stale = await fixture.Store.WriteGeneratedAsync(Document(), generation, CancellationToken.None);
        Assert.Null(Sections(fixture.Project(stale, 1))[0]!["configuredRowAssociation"]);
        var current = await fixture.Generate();
        var response = fixture.Project(current, 1);
        using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) { }
        fixture.Authority.FinalizeResponse(response);
        Assert.Null(Sections(response)[0]!["configuredRowAssociation"]);
    }

    [Fact]
    public async Task StoredDigestAndCurrentStoreIdentityRejectReplay()
    {
        using var fixture = new Fixture();
        var first = await fixture.Generate();
        var projected = fixture.Project(first, 1);
        var next = await fixture.Generate(Document(("new-section", "rule-a")));
        fixture.Authority.FinalizeResponse(projected);
        Assert.Null(Sections(projected)[0]!["configuredRowAssociation"]);
        Assert.Null(fixture.Authority.CaptureProjection(first, UserId));
        Sections(next)[0]!["sourceRuleId"] = "edited";
        Assert.Null(fixture.Authority.CaptureProjection(next, UserId));
    }

    [Fact]
    public async Task DisabledDeletedAndNormalizationCollidingRulesAreNotIssued()
    {
        using var fixture = new Fixture();
        fixture.Configuration.Rows.Rules[0].Enabled = false;
        var raw = await fixture.Generate();
        Assert.Null(Sections(fixture.Project(raw, 1))[0]!["configuredRowAssociation"]);
        Assert.Empty(fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]!["rules"]!.AsArray());
        fixture.Configuration.Rows.Rules.Clear();
        raw = await fixture.Generate();
        Assert.Null(Sections(fixture.Project(raw, 1))[0]!["configuredRowAssociation"]);
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "rule-a" });
        fixture.Configuration.Rows.Rules.Add(new RowBuilderRule { Id = "rule a" });
        raw = await fixture.Generate();
        Assert.Null(fixture.Authority.CaptureProjection(raw, UserId));
        Assert.Null(fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]);
    }

    [Fact]
    public async Task UnknownServerOrRequestIdentityNeverPublishesMapping()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        Assert.Null(fixture.Authority.CaptureProjection(raw, Guid.Empty));
        Assert.Null(fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, Guid.Empty)["configuredRowAssociations"]);
        var missing = new PtvConfiguredRowAssociationService(string.Empty, () => fixture.Configuration);
        Assert.Null(missing.CaptureGeneration());
        Assert.Null(missing.CreateRowsResponse(fixture.Configuration.Rows, UserId)["configuredRowAssociations"]);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ConditionalRefreshRecoversNewProcessFromPersistedCacheExactlyOnce(bool expired)
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var original = await processA.RefreshAsync(CancellationToken.None);
        Assert.Null(processA.GetRefreshStatus().LastRefreshError);
        var oldProof = fixture.Authority.CaptureCurrentPresentationProof(UserId, true)!.Authority.ToJsonString();
        Assert.True(original.FeaturedCacheFresh);
        AssertLatestMappings(fixture.Authority, original.Document);
        if (expired)
        {
            original.Document.UpdatedAt = DateTimeOffset.UtcNow.AddDays(-2).ToUnixTimeMilliseconds();
            original.Document.FeaturedContent!["createdAt"] = original.Document.UpdatedAt;
            original.Document.FeaturedContent!["expiresAt"] = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeMilliseconds();
            await fixture.Store.WriteAsync(original.Document, CancellationToken.None);
        }

        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        var persisted = await storeB.GetStatusAsync(CancellationToken.None);
        Assert.Equal(!expired, persisted.FeaturedCacheFresh);
        Assert.Null(issuerB.CaptureProjection(persisted.Document, UserId));
        Assert.Null(issuerB.CaptureCurrentPresentationProof(UserId, true));
        var enrichment = CompletedEnrichment();
        using var processB = CreateRefresh(storeB, issuerB, libraries, enrichment);

        var recovered = await processB.RefreshIfNeededAsync(CancellationToken.None);

        Assert.NotNull(issuerB.CaptureProjection(recovered.Document, UserId));
        AssertLatestMappings(issuerB, recovered.Document);
        Assert.NotEqual(oldProof, issuerB.CaptureCurrentPresentationProof(UserId, true)!.Authority.ToJsonString());
        var recoveredJson = recovered.Document.FeaturedContent!.ToJsonString();
        for (var read = 0; read < 5; read++)
        {
            var later = await processB.RefreshIfNeededAsync(CancellationToken.None);
            Assert.Equal(recoveredJson, later.Document.FeaturedContent!.ToJsonString());
        }
        Assert.Equal(1, enrichment.Calls);
    }

    [Fact]
    public async Task EmptyConfiguredSourceRecoversWithoutInventingSectionOrRetrying()
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        var library = (LibraryProxy)(object)libraries;
        library.Root!.Children = library.Root.Children.Where(item => item is not MusicAlbum).ToArray();
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        await processA.RefreshAsync(CancellationToken.None);
        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        Assert.Null(issuerB.CaptureProjection((await storeB.GetStatusAsync(CancellationToken.None)).Document, UserId));
        var enrichment = CompletedEnrichment();
        using var processB = CreateRefresh(storeB, issuerB, libraries, enrichment);

        var recovered = await processB.RefreshIfNeededAsync(CancellationToken.None);

        Assert.Null(processB.GetRefreshStatus().LastRefreshError);
        Assert.NotNull(issuerB.CaptureProjection(recovered.Document, UserId));
        Assert.Equal(new[] { "Latest movies", "Latest shows" }, Sections(recovered.Document).Select(section => section!["title"]!.GetValue<string>()).Order());
        Assert.Equal(2, issuerB.CaptureCurrentPresentationProof(UserId, true)!.Bindings!.Count);
        for (var read = 0; read < 5; read++) await processB.RefreshIfNeededAsync(CancellationToken.None);
        Assert.Equal(1, enrichment.Calls);
    }

    [Fact]
    public async Task ConcurrentConditionalRecoveryWaitsForOneTrustedGeneration()
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        await processA.RefreshAsync(CancellationToken.None);
        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        var enrichment = new EnrichmentStub();
        using var processB = CreateRefresh(storeB, issuerB, libraries, enrichment);
        var pending = processB.RefreshIfNeededAsync(CancellationToken.None);
        await Task.WhenAny(enrichment.Started.Task, pending).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.True(enrichment.Started.Task.IsCompleted, "Fresh disk cache must start normal trusted recovery.");
        var concurrent = Enumerable.Range(0, 20).Select(_ => processB.RefreshIfNeededAsync(CancellationToken.None)).ToArray();
        Assert.Null(issuerB.CaptureProjection(await storeB.ReadAsync(CancellationToken.None), UserId));
        Assert.Null(issuerB.CaptureCurrentPresentationProof(UserId, true));
        enrichment.Complete.TrySetResult();
        var results = await Task.WhenAll(concurrent.Append(pending)).WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(1, enrichment.Calls);
        Assert.All(results, result => AssertLatestMappings(issuerB, result.Document));
        Assert.Single(results.Select(result => result.Document.FeaturedContent!.ToJsonString()).Distinct());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FailedRecoveryRetainsOldCacheAndUsesBoundedOwnerRetry(bool expired)
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var original = await processA.RefreshAsync(CancellationToken.None);
        if (expired)
        {
            original.Document.UpdatedAt = DateTimeOffset.UtcNow.AddDays(-2).ToUnixTimeMilliseconds();
            original.Document.FeaturedContent!["createdAt"] = original.Document.UpdatedAt;
            original.Document.FeaturedContent!["expiresAt"] = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeMilliseconds();
            await fixture.Store.WriteAsync(original.Document, CancellationToken.None);
        }
        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        var before = (await storeB.ReadAsync(CancellationToken.None)).FeaturedContent!.ToJsonString();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.FailEnumeration = true;
        var priorReads = proxy.Enumerations;
        using var processB = CreateRefresh(storeB, issuerB, libraries, CompletedEnrichment());
        await processB.RefreshIfNeededAsync(CancellationToken.None);
        Assert.NotNull(processB.GetRefreshStatus().LastRefreshError);
        var results = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => processB.RefreshIfNeededAsync(CancellationToken.None)));

        Assert.Equal(1, proxy.Enumerations - priorReads);
        Assert.All(results, result => Assert.Equal(before, result.Document.FeaturedContent!.ToJsonString()));
        Assert.Null(issuerB.CaptureCurrentPresentationProof(UserId, true));
        var remaining = processB.GetRefreshStatus().NextRefreshAt!.Value - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        Assert.InRange(remaining, 14 * 60_000, 15 * 60_000);
        var delay = ReadHostedDelay(processB, results[0]);
        Assert.InRange(delay.TotalMinutes, 14, 15);

        proxy.FailEnumeration = false;
        MakeRecoveryRetryDue(processB);
        var recovered = await processB.RefreshIfNeededAsync(CancellationToken.None);
        AssertLatestMappings(issuerB, recovered.Document);
        Assert.Null(processB.GetRefreshStatus().LastRefreshError);
        Assert.Equal(2, proxy.Enumerations - priorReads);
        Assert.Equal(recovered.FeaturedCacheExpiresAt, processB.GetRefreshStatus().NextRefreshAt);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RecoveryConfigurationRaceCannotIssueTrustAndDoesNotQueueAStorm(bool returnToOriginal)
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        await processA.RefreshAsync(CancellationToken.None);
        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        var enrichment = new EnrichmentStub();
        using var processB = CreateRefresh(storeB, issuerB, libraries, enrichment);
        var pending = processB.RefreshIfNeededAsync(CancellationToken.None);
        await enrichment.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Changed";
        if (returnToOriginal)
        {
            using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Latest movies";
        }
        var queued = Enumerable.Range(0, 20).Select(_ => processB.RefreshIfNeededAsync(CancellationToken.None)).ToArray();
        enrichment.Complete.TrySetResult();
        var first = await pending;
        Assert.Null(issuerB.CaptureProjection(first.Document, UserId));
        await Task.WhenAll(queued);
        Assert.Equal(1, enrichment.Calls);
        Assert.Null(issuerB.CaptureCurrentPresentationProof(UserId, true));
        Assert.InRange(ReadHostedDelay(processB, first).TotalMinutes, 14, 15);
        MakeRecoveryRetryDue(processB);
        var current = await processB.RefreshIfNeededAsync(CancellationToken.None);
        Assert.NotNull(issuerB.CaptureProjection(current.Document, UserId));
        Assert.Equal(2, enrichment.Calls);
        Assert.Contains(Sections(current.Document), section => section!["title"]!.GetValue<string>() == (returnToOriginal ? "Latest movies" : "Changed"));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ConcreteRefreshUsesCapturedConfigurationAndRegistersOnlyCurrentGeneration(bool mutateDuringEnrichment)
    {
        using var fixture = new Fixture();
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        ((LibraryProxy)(object)libraries).Root = new AggregateFolder
        {
            Children = Enumerable.Range(1, 16).Select(index => new Movie
            {
                Id = Guid.NewGuid(),
                Name = "Movie " + index,
                DateCreated = DateTime.UtcNow,
                ImageInfos = [new ItemImageInfo { Type = ImageType.Primary, DateModified = DateTime.UtcNow, Path = "test-image" }]
            }).ToArray()
        };
        var enrichment = new EnrichmentStub();
        var refresh = new PtvFeaturedContentRefreshService(fixture.Store, libraries, NullLogger<PtvFeaturedContentRefreshService>.Instance, enrichment, fixture.Authority);
        var pending = refresh.RefreshAsync(CancellationToken.None);
        await enrichment.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        if (mutateDuringEnrichment)
        {
            using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Later configuration";
        }
        enrichment.Complete.SetResult();
        var status = await pending;
        Assert.True(status.FeaturedCacheExists);
        Assert.Null(refresh.GetRefreshStatus().LastRefreshError);
        var rawSection = Assert.Single(Sections(status.Document));
        Assert.Equal("Same", rawSection!["title"]!.GetValue<string>());
        var projection = fixture.Authority.CaptureProjection(status.Document, UserId);
        Assert.Equal(!mutateDuringEnrichment, projection is not null);
        var reloaded = await fixture.Store.ReadAsync(CancellationToken.None);
        Assert.Equal(!mutateDuringEnrichment, fixture.Authority.CaptureProjection(reloaded, UserId) is not null);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(8)]
    [InlineData(16)]
    public async Task StartupRecoveryPreservesAuthorizedSurvivorsAndRestrictedRedaction(int allowedPerSection)
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var original = await processA.RefreshAsync(CancellationToken.None);
        var proxy = (LibraryProxy)(object)libraries;
        var allowed = Enumerable.Range(1, 48).Where(index => (index - 1) % 16 < allowedPerSection)
            .Select(index => Guid.Parse($"bbbbbbbb-bbbb-bbbb-bbbb-{index:D12}")).ToHashSet();
        proxy.Allowed = allowed;
        var baseline = new PtvFeaturedContentAuthorizationService(Users(UserId, OtherUserId), libraries, fixture.Authority)
            .AuthorizeForUser(original.Document, OtherUserId).Document!;
        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        using var processB = CreateRefresh(storeB, issuerB, libraries, CompletedEnrichment());
        var restored = await processB.RefreshIfNeededAsync(CancellationToken.None);
        var rawBefore = JsonSerializer.Serialize(restored.Document);
        var response = new PtvFeaturedContentAuthorizationService(Users(UserId, OtherUserId), libraries, issuerB)
            .AuthorizeForUser(restored.Document, OtherUserId).Document!;
        Assert.Equal(Payload(baseline)["sectionItems"]!.ToJsonString(), Payload(response)["sectionItems"]!.ToJsonString());
        var actual = Payload(response)["sectionItems"]!.AsObject().SelectMany(pair => pair.Value!.AsArray())
            .Select(item => Guid.Parse(item!["Id"]!.GetValue<string>())).ToHashSet();
        Assert.True(allowed.SetEquals(actual));
        Assert.Equal(allowedPerSection == 0 ? 0 : 3, Sections(response).Count);
        Assert.All(Sections(response), section =>
        {
            Assert.NotNull(section!["configuredRowAssociation"]);
            if (allowedPerSection < 16)
            {
                Assert.Null(section["sourceRuleId"]);
                Assert.Null(section["ruleId"]);
                Assert.Null(section["sourceValue"]);
            }
        });
        Assert.Null(issuerB.CaptureCurrentPresentationProof(OtherUserId, false)!.Bindings);
        Assert.Equal(rawBefore, JsonSerializer.Serialize(restored.Document));
    }

    [Fact]
    public async Task CancelledConditionalWaiterDoesNotCancelOrDuplicateSharedRecovery()
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        await fixture.Generate();
        var issuer = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration);
        var store = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuer);
        var enrichment = new EnrichmentStub();
        using var refresh = CreateRefresh(store, issuer, libraries, enrichment);
        var active = refresh.RefreshIfNeededAsync(CancellationToken.None);
        await enrichment.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        using var cancellation = new CancellationTokenSource();
        var waiter = refresh.RefreshIfNeededAsync(cancellation.Token);
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiter);
        Assert.False(active.IsCompleted);
        enrichment.Complete.SetResult();
        AssertLatestMappings(issuer, (await active).Document);
        AssertLatestMappings(issuer, (await refresh.RefreshIfNeededAsync(CancellationToken.None)).Document);
        Assert.Equal(1, enrichment.Calls);
    }

    [Fact]
    public async Task ExplicitRefreshStillRegeneratesAfterConditionalOwnerCompletes()
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        await fixture.Generate();
        var issuer = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration);
        var store = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuer);
        var enrichment = new EnrichmentStub();
        using var refresh = CreateRefresh(store, issuer, libraries, enrichment);
        var active = refresh.RefreshIfNeededAsync(CancellationToken.None);
        await enrichment.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var forced = refresh.RefreshAsync(CancellationToken.None);
        enrichment.Complete.SetResult();
        await active;
        AssertLatestMappings(issuer, (await forced).Document);
        Assert.Equal(2, enrichment.Calls);
        await refresh.RefreshIfNeededAsync(CancellationToken.None);
        Assert.Equal(2, enrichment.Calls);
    }

    [Fact]
    public async Task HostedStartupUsesConditionalRecoveryWithoutAnyClientReadTrigger()
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        await processA.RefreshAsync(CancellationToken.None);
        var issuerB = new PtvConfiguredRowAssociationService("server-a", () => fixture.Configuration);
        var storeB = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, issuerB);
        var enrichment = new EnrichmentStub();
        using var worker = CreateRefresh(storeB, issuerB, libraries, enrichment);
        await worker.StartAsync(CancellationToken.None);
        try
        {
            // Wait for the real hosted owner's existing startup delay, not an arbitrary test sleep.
            await enrichment.Started.Task.WaitAsync(TimeSpan.FromSeconds(30));
            Assert.Null(issuerB.CaptureCurrentPresentationProof(UserId, true));
            enrichment.Complete.SetResult();
            AssertLatestMappings(issuerB, (await worker.RefreshIfNeededAsync(CancellationToken.None)).Document);
            Assert.Equal(1, enrichment.Calls);
        }
        finally
        {
            await worker.StopAsync(CancellationToken.None);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ActiveHostedTtlWaitIsRescheduledWhenForcedRecoveryFails(bool retiredWrite)
    {
        using var fixture = new Fixture();
        var libraries = ConfigureLatestLibraries(fixture);
        using var processA = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        await processA.RefreshAsync(CancellationToken.None);
        var clock = new ScheduleClock();
        var enrichment = CompletedEnrichment();
        using var worker = new PtvFeaturedContentRefreshService(fixture.Store, libraries,
            NullLogger<PtvFeaturedContentRefreshService>.Instance, enrichment, fixture.Authority, clock);
        await worker.StartAsync(CancellationToken.None);
        try
        {
            var startup = await clock.NextTimer();
            Assert.Equal(TimeSpan.FromSeconds(10), startup.Delay);
            clock.Fire(startup);
            var originalWait = await clock.NextTimer();
            Assert.True(originalWait.Delay > TimeSpan.FromHours(1));
            using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) { }
            var proxy = (LibraryProxy)(object)libraries;
            if (retiredWrite)
                enrichment.OnFacts = () => { using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) { } };
            else
                proxy.FailEnumeration = true;
            var failed = await worker.RefreshAsync(CancellationToken.None);
            Assert.Null(fixture.Authority.CaptureCurrentPresentationProof(UserId, true));
            Assert.InRange(worker.GetRefreshStatus().NextRefreshAt!.Value - clock.GetUtcNow().ToUnixTimeMilliseconds(), 14 * 60_000, 15 * 60_000);

            var retry = await clock.NextTimer();
            Assert.True(originalWait.IsDisposed, "The superseded long TTL timer must be retired.");
            Assert.InRange(retry.Delay.TotalMinutes, 14, 15);
            proxy.FailEnumeration = false;
            enrichment.OnFacts = null;
            clock.Fire(retry);
            var afterRecovery = await clock.NextTimer();
            Assert.True(afterRecovery.Delay > TimeSpan.FromHours(1));
            AssertLatestMappings(fixture.Authority, await fixture.Store.ReadAsync(CancellationToken.None));
            Assert.Null(worker.GetRefreshStatus().LastRefreshError);
        }
        finally
        {
            await worker.StopAsync(CancellationToken.None);
        }
        Assert.Equal(0, clock.ActiveTimers);
    }

    [Fact]
    public async Task TrustedExpiredRefreshFailureKeepsExistingSchedulingFloor()
    {
        using var fixture = new Fixture();
        var document = Document();
        document.UpdatedAt = DateTimeOffset.UtcNow.AddDays(-2).ToUnixTimeMilliseconds();
        document.FeaturedContent!["createdAt"] = document.UpdatedAt;
        document.FeaturedContent!["expiresAt"] = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeMilliseconds();
        await fixture.Generate(document);
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        ((LibraryProxy)(object)libraries).FailEnumeration = true;
        using var refresh = CreateRefresh(fixture.Store, fixture.Authority, libraries, CompletedEnrichment());
        var result = await refresh.RefreshIfNeededAsync(CancellationToken.None);
        Assert.False(result.FeaturedCacheFresh);
        Assert.NotNull(fixture.Authority.CaptureProjection(result.Document, UserId));
        Assert.NotNull(refresh.GetRefreshStatus().LastRefreshError);
        Assert.Equal(TimeSpan.FromMinutes(1), ReadHostedDelay(refresh, result));
    }

    [Fact]
    public async Task MutationDuringItemProjectionRemovesAllAliasesWithoutChangingSurvivors()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Allowed = ItemIds.Take(1).ToHashSet();
        proxy.OnLookup = () =>
        {
            using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Mutated";
        };
        var response = new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, fixture.Authority).AuthorizeForUser(raw, UserId).Document!;
        var section = Assert.Single(Sections(response));
        Assert.Null(section!["configuredRowAssociation"]);
        Assert.Null(Payload(response)["currentPresentationAuthority"]);
        Assert.Single(Payload(response)["sectionItems"]![section["id"]!.GetValue<string>()]!.AsArray());
    }

    [Fact]
    public async Task ConcurrentIdenticalPutRetiresProjectionBeforePublication()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Allowed = ItemIds.Take(1).ToHashSet();
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var release = new ManualResetEventSlim();
        proxy.OnLookup = () =>
        {
            started.TrySetResult();
            Assert.True(release.Wait(TimeSpan.FromSeconds(5)));
        };
        var projecting = Task.Run(() => new PtvFeaturedContentAuthorizationService(Users(UserId), libraries, fixture.Authority).AuthorizeForUser(raw, UserId).Document!);
        try
        {
            await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
            await fixture.Store.WriteAsync(raw, CancellationToken.None);
        }
        finally
        {
            release.Set();
        }
        var response = await projecting;
        var section = Assert.Single(Sections(response));
        Assert.Null(section!["configuredRowAssociation"]);
        Assert.Null(Payload(response)["currentPresentationAuthority"]);
        Assert.Single(Payload(response)["sectionItems"]![section["id"]!.GetValue<string>()]!.AsArray());
    }

    [Fact]
    public async Task StockUpdateAndPtvSaveRetireAliasesIncludingAbaAndIdenticalSave()
    {
        using var fixture = new Fixture();
        var oldInstance = Plugin.Instance;
        var xml = DispatchProxy.Create<IXmlSerializer, XmlProxy>();
        var plugin = new Plugin(fixture.Paths, xml);
        try
        {
            plugin.UpdateConfiguration(fixture.Configuration);
            var authority = new PtvConfiguredRowAssociationService("server-a");
            var store = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, authority);
            var raw = await store.WriteGeneratedAsync(Document(), authority.CaptureGeneration()!, CancellationToken.None);
            Assert.NotNull(authority.CaptureProjection(raw, UserId));
            var changed = new PluginConfiguration();
            plugin.UpdateConfiguration(changed);
            plugin.UpdateConfiguration(fixture.Configuration);
            Assert.Null(authority.CaptureProjection(raw, UserId));
            raw = await store.WriteGeneratedAsync(Document(), authority.CaptureGeneration()!, CancellationToken.None);
            new PtvPluginSettingsService(NullLogger<PtvPluginSettingsService>.Instance).SaveSettings(new PtvPluginSettingsPatchDto());
            Assert.Null(authority.CaptureProjection(raw, UserId));
            Assert.Equal(4, ((XmlProxy)(object)xml).Writes);
            Assert.Same(fixture.Configuration, plugin.Configuration);
        }
        finally
        {
            typeof(Plugin).GetField("<Instance>k__BackingField", BindingFlags.Static | BindingFlags.NonPublic)!.SetValue(null, oldInstance);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task BothAdministratorEndpointsCloneResponsesAndKeepRestrictedPolicy(bool rowsFallback)
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        var settings = PtvPluginSettingsDto.FromConfiguration(fixture.Configuration);
        var before = JsonSerializer.Serialize(settings);
        var users = Users(UserId, OtherUserId);
        var services = new ServiceCollection()
            .AddSingleton(fixture.Authority)
            .AddSingleton(users)
            .AddSingleton<IAuthorizationService>(new AuthorizationStub())
            .AddSingleton<IPtvPluginSettingsService>(new SettingsStub(settings))
            .BuildServiceProvider();
        var controller = Controller(services, UserId);
        var result = rowsFallback ? (await controller.GetRows()).Result : (await controller.GetSettings()).Result;
        var value = Assert.IsType<OkObjectResult>(result).Value;
        var json = JsonSerializer.SerializeToNode(value)!;
        var rows = rowsFallback ? json : json["rows"]!;
        Assert.NotNull(rows["configuredRowAssociations"]);
        rows["rules"]![0]!["name"] = "client edited";
        Assert.Equal(before, JsonSerializer.Serialize(settings));
        Assert.DoesNotContain("configuredRowAssociations", JsonSerializer.Serialize(fixture.Configuration));
        controller = Controller(services, OtherUserId);
        result = rowsFallback ? (await controller.GetRows()).Result : (await controller.GetSettings()).Result;
        Assert.Equal(403, Assert.IsType<ObjectResult>(result).StatusCode);
    }

    [Theory]
    [InlineData(4)]
    [InlineData(3)]
    [InlineData(1)]
    [InlineData(0)]
    public async Task FreshnessInputsAgreeWithFinalAuthoritativeReadWithoutChangingSurvivors(int survivors)
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var rawBefore = JsonSerializer.Serialize(raw);
        var projected = fixture.Project(raw, survivors);
        var rows = fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId);
        var featuredAuthority = AssertAuthority(Payload(projected)["currentPresentationAuthority"]);
        var rowsAuthority = AssertAuthority(rows["currentPresentationAuthority"]);
        var status = await ReadStatus(fixture);
        var finalAuthority = AssertAuthority(status["currentPresentationAuthority"]);
        Assert.Equal(featuredAuthority.ToJsonString(), rowsAuthority.ToJsonString());
        Assert.Equal(featuredAuthority.ToJsonString(), finalAuthority.ToJsonString());
        Assert.Equal(rows["configuredRowAssociations"]!["scope"]!.ToJsonString(), finalAuthority["scope"]!.ToJsonString());
        Assert.Equal(rows["configuredRowAssociations"]!["sections"]!.ToJsonString(), status["configuredPresentationBindings"]!.ToJsonString());
        Assert.Equal(rawBefore, JsonSerializer.Serialize(raw));
        Assert.Equal(Payload(fixture.Project(raw, survivors, associations: false))["sectionItems"]!.ToJsonString(), Payload(projected)["sectionItems"]!.ToJsonString());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FreshnessStatusFastAndFullAreProtectedNoStoreAndPublishCoherentAdminPairs(bool full)
    {
        using var fixture = new Fixture();
        await fixture.Generate(Document(("first", "rule-a"), ("second", "rule-a")));
        using var services = StatusServices(fixture);
        var controller = Controller(services, UserId);
        var result = Assert.IsType<OkObjectResult>(await controller.GetStatus(full, CancellationToken.None));
        var status = JsonSerializer.SerializeToNode(result.Value)!;
        AssertAuthority(status["currentPresentationAuthority"]);
        Assert.Equal(2, status["configuredPresentationBindings"]!.AsArray().Count);
        Assert.Equal("private, no-store", controller.Response.Headers.CacheControl.ToString());
        Assert.Equal("no-cache", controller.Response.Headers.Pragma.ToString());
        Assert.Equal("0", controller.Response.Headers.Expires.ToString());
        Assert.NotEmpty(typeof(PtvStatusController).GetCustomAttributes<AuthorizeAttribute>());
        var cache = typeof(PtvStatusController).GetMethod(nameof(PtvStatusController.GetStatus))!.GetCustomAttribute<ResponseCacheAttribute>();
        Assert.True(cache?.NoStore);
        Assert.Equal(ResponseCacheLocation.None, cache!.Location);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FreshnessBothAdminSettingsPathsCloneAuthorityWithoutPersistence(bool rowsFallback)
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        var settings = PtvPluginSettingsDto.FromConfiguration(fixture.Configuration);
        var before = JsonSerializer.Serialize(settings);
        using var services = StatusServices(fixture);
        var controller = Controller(services, UserId);
        var result = rowsFallback ? (await controller.GetRows()).Result : (await controller.GetSettings()).Result;
        var json = JsonSerializer.SerializeToNode(Assert.IsType<OkObjectResult>(result).Value)!;
        var rows = rowsFallback ? json : json["rows"]!;
        var authority = AssertAuthority(rows["currentPresentationAuthority"]);
        var original = authority.ToJsonString();
        authority["generation"] = new string('0', 64);
        Assert.Equal(original, (await ReadStatus(fixture))["currentPresentationAuthority"]!.ToJsonString());
        Assert.Equal(before, JsonSerializer.Serialize(settings));
        Assert.DoesNotContain("currentPresentationAuthority", JsonSerializer.Serialize(fixture.Configuration));
        Assert.DoesNotContain("currentPresentationAuthority", JsonSerializer.Serialize(await fixture.Store.ReadAsync(CancellationToken.None)));
        var restricted = Controller(services, OtherUserId);
        var denied = rowsFallback ? (await restricted.GetRows()).Result : (await restricted.GetSettings()).Result;
        Assert.Equal(403, Assert.IsType<ObjectResult>(denied).StatusCode);
    }

    [Theory]
    [InlineData("change")]
    [InlineData("aba")]
    [InlineData("identical")]
    [InlineData("same-config-regeneration")]
    [InlineData("put")]
    [InlineData("clear")]
    public async Task FreshnessFinalReadCannotValidateMutuallyStaleInputs(string transition)
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var oldFeatured = AssertAuthority(Payload(fixture.Project(raw, 1))["currentPresentationAuthority"]).ToJsonString();
        var oldRows = AssertAuthority(fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId)["currentPresentationAuthority"]).ToJsonString();
        Assert.Equal(oldRows, oldFeatured);
        var oldStatus = await ReadStatus(fixture);
        Assert.Equal(oldFeatured, oldStatus["currentPresentationAuthority"]!.ToJsonString());
        if (transition is "change" or "aba" or "identical")
        {
            using (PtvConfiguredRowAssociationService.BeginConfigurationMutation())
                if (transition != "identical") fixture.Configuration.Rows.Rules[0].Name = "Changed";
            if (transition == "aba")
                using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Same";
            Assert.Null((await ReadStatus(fixture))["currentPresentationAuthority"]);
        }
        if (transition == "put") await fixture.Store.WriteAsync(raw, CancellationToken.None);
        else if (transition == "clear") await fixture.Store.ClearAsync(CancellationToken.None);
        else await fixture.Generate();
        var final = await ReadStatus(fixture);
        if (transition is "put" or "clear")
        {
            Assert.Null(final["currentPresentationAuthority"]);
            Assert.Null(final["configuredPresentationBindings"]);
        }
        else
        {
            var current = AssertAuthority(final["currentPresentationAuthority"]);
            Assert.NotEqual(oldFeatured, current.ToJsonString());
            Assert.NotEqual(oldStatus["configuredPresentationBindings"]!.ToJsonString(), final["configuredPresentationBindings"]!.ToJsonString());
            if (transition == "same-config-regeneration")
                Assert.Equal(oldStatus["currentPresentationAuthority"]!["scope"]!.ToJsonString(), current["scope"]!.ToJsonString());
        }
        // The earlier proof remains an immutable point-in-time observation, not live mutable state.
        Assert.Equal(oldFeatured, oldStatus["currentPresentationAuthority"]!.ToJsonString());
    }

    [Fact]
    public async Task FreshnessOldAndNewSettingsFeaturedInputsExposeDifferentAuthority()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var oldRows = fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId);
        var oldFeatured = fixture.Project(raw, 1);
        using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Next";
        raw = await fixture.Generate();
        var currentRows = fixture.Authority.CreateRowsResponse(fixture.Configuration.Rows, UserId);
        var currentFeatured = fixture.Project(raw, 1);
        Assert.NotEqual(AssertAuthority(oldRows["currentPresentationAuthority"]).ToJsonString(), AssertAuthority(Payload(currentFeatured)["currentPresentationAuthority"]).ToJsonString());
        Assert.NotEqual(AssertAuthority(currentRows["currentPresentationAuthority"]).ToJsonString(), AssertAuthority(Payload(oldFeatured)["currentPresentationAuthority"]).ToJsonString());
        Assert.Equal(currentRows["currentPresentationAuthority"]!.ToJsonString(), (await ReadStatus(fixture))["currentPresentationAuthority"]!.ToJsonString());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FreshnessRestartAndServerSwitchRequireNewTrustedBinding(bool otherServer)
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var first = AssertAuthority((await ReadStatus(fixture))["currentPresentationAuthority"]).ToJsonString();
        var next = new PtvConfiguredRowAssociationService(otherServer ? "server-b" : "server-a", () => fixture.Configuration);
        Assert.Null((await ReadStatus(fixture, authority: next))["currentPresentationAuthority"]);
        Assert.Null(next.CaptureProjection(raw, UserId));
        var nextStore = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, next);
        await nextStore.WriteGeneratedAsync(Document(), next.CaptureGeneration()!, CancellationToken.None);
        Assert.NotEqual(first, AssertAuthority((await ReadStatus(fixture, authority: next))["currentPresentationAuthority"]).ToJsonString());
    }

    [Fact]
    public async Task FreshnessRestrictedStatusHasOwnOpaqueScopeButNeverAdminBindingsOrRawMetadata()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var admin = await ReadStatus(fixture);
        var restricted = await ReadStatus(fixture, userId: OtherUserId);
        var restrictedAuthority = AssertAuthority(restricted["currentPresentationAuthority"]);
        Assert.NotEqual(AssertAuthority(admin["currentPresentationAuthority"]).ToJsonString(), restrictedAuthority.ToJsonString());
        Assert.Null(restricted["configuredPresentationBindings"]);
        Assert.Equal(restrictedAuthority.ToJsonString(), AssertAuthority(Payload(fixture.Project(raw, 1, userId: OtherUserId))["currentPresentationAuthority"]).ToJsonString());
        var wire = restricted.ToJsonString();
        foreach (var privateValue in new[] { "rule-a", "PRIVATE_SELECTOR", "sourceRuleId", "configuredRowAssociations", "section-a" }.Concat(ItemIds.Select(id => id.ToString("N"))))
            Assert.DoesNotContain(privateValue, wire);
        var restrictedSection = Assert.Single(Sections(fixture.Project(raw, 1, userId: OtherUserId)));
        Assert.Null(restrictedSection!["ruleId"]);
        Assert.Null(restrictedSection["sourceRuleId"]);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("empty")]
    [InlineData("malformed")]
    [InlineData("contradictory")]
    [InlineData("unauthenticated")]
    [InlineData("unresolved-user")]
    [InlineData("no-user-manager")]
    public async Task FreshnessUnknownRequestIdentityDoesNotPublishProofOrBindings(string failure)
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        var requested = failure == "unresolved-user" ? Guid.NewGuid() : UserId;
        using var services = StatusServices(fixture, includeUsers: failure != "no-user-manager");
        var controller = Controller(services, requested);
        var identity = (ClaimsIdentity)controller.User.Identity!;
        if (failure == "missing") identity.RemoveClaim(identity.Claims.Single());
        if (failure is "empty" or "malformed")
        {
            identity.RemoveClaim(identity.Claims.Single());
            identity.AddClaim(new Claim("Jellyfin-UserId", failure == "empty" ? Guid.Empty.ToString() : "not-a-user"));
        }
        if (failure == "contradictory") identity.AddClaim(new Claim("Jellyfin-UserId", OtherUserId.ToString()));
        if (failure == "unauthenticated") controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(identity.Claims));
        var result = Assert.IsType<OkObjectResult>(await controller.GetStatus(false, CancellationToken.None));
        var status = JsonSerializer.SerializeToNode(result.Value)!;
        Assert.Null(status["currentPresentationAuthority"]);
        Assert.Null(status["configuredPresentationBindings"]);
        Assert.Equal("private, no-store", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public async Task FreshnessStatusDoesNotPromoteMissingServiceOrFailedAuthorityResolution()
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        using var noAuthority = new ServiceCollection().AddSingleton(Users(UserId)).BuildServiceProvider();
        var missing = JsonSerializer.SerializeToNode(Assert.IsType<OkObjectResult>(await Controller(noAuthority, UserId).GetStatus(false, CancellationToken.None)).Value)!;
        Assert.Null(missing["currentPresentationAuthority"]);
        var failResolution = false;
        var fail = new PtvConfiguredRowAssociationService("server-a", () => failResolution ? throw new InvalidOperationException("PRIVATE_FAILURE") : fixture.Configuration);
        var store = new PtvFeaturedContentStore(fixture.Paths, NullLogger<PtvFeaturedContentStore>.Instance, fail);
        await store.WriteGeneratedAsync(Document(), fail.CaptureGeneration()!, CancellationToken.None);
        failResolution = true;
        var status = await ReadStatus(fixture, authority: fail);
        Assert.Null(status["currentPresentationAuthority"]);
        Assert.Null(status["configuredPresentationBindings"]);
        Assert.DoesNotContain("PRIVATE_FAILURE", status.ToJsonString());
    }

    [Fact]
    public async Task FreshnessStatusReadsOnlyCurrentEligiblePairsAndReturnsDetachedObjects()
    {
        using var fixture = new Fixture();
        var document = Document(("first", "rule-a"), ("second", "rule-a"), ("generic", "rule-a"), ("unknown", "absent"), ("duplicate", "rule-a"), ("duplicate", "rule-a"));
        Sections(document)[2]!["rowType"] = "generic";
        var raw = await fixture.Generate(document);
        var first = await ReadStatus(fixture);
        var pairs = Assert.IsType<JsonArray>(first["configuredPresentationBindings"]);
        Assert.Equal(2, pairs.Count);
        Assert.Single(pairs.Select(pair => pair!["rule"]!.GetValue<string>()).Distinct());
        Assert.Equal(2, pairs.Select(pair => pair!["section"]!.GetValue<string>()).Distinct().Count());
        foreach (var pair in pairs)
        {
            Assert.Equal(new[] { "rule", "section" }, pair!.AsObject().Select(p => p.Key).OrderBy(k => k).ToArray());
            AssertToken(pair["rule"]);
            AssertToken(pair["section"]);
        }
        var before = first.ToJsonString();
        var binding = fixture.Authority.CaptureProjection(raw, UserId)!.Binding;
        Assert.DoesNotContain(binding.GenerationNonce, before);
        Assert.DoesNotContain(binding.Generation.Binding, before);
        Assert.DoesNotContain(binding.DocumentDigest, before);
        first["currentPresentationAuthority"]!["generation"] = new string('0', 64);
        pairs.Clear();
        Assert.Equal(before, (await ReadStatus(fixture)).ToJsonString());
        Assert.DoesNotContain("currentPresentationAuthority", JsonSerializer.Serialize(raw));
    }

    [Fact]
    public async Task FreshnessSpoofedOldCacheMetadataCannotEstablishAnyProof()
    {
        using var fixture = new Fixture();
        var trusted = await fixture.Generate();
        var valid = AssertAuthority(Payload(fixture.Project(trusted, 1))["currentPresentationAuthority"]).DeepClone();
        var spoofed = Document();
        Payload(spoofed)["currentPresentationAuthority"] = valid;
        Payload(spoofed)["configuredPresentationBindings"] = (await ReadStatus(fixture))["configuredPresentationBindings"]!.DeepClone();
        var raw = await fixture.Store.WriteAsync(spoofed, CancellationToken.None);
        var projected = fixture.Project(raw, 1);
        Assert.Null(Payload(projected)["currentPresentationAuthority"]);
        Assert.Null(Payload(projected)["configuredPresentationBindings"]);
        Assert.Null((await ReadStatus(fixture))["currentPresentationAuthority"]);
        Assert.Single(Payload(projected)["sectionItems"]![Sections(projected)[0]!["id"]!.GetValue<string>()]!.AsArray());
    }

    [Fact]
    public async Task FreshnessProjectedResponseCannotBorrowReplacementBinding()
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var pending = fixture.Project(raw, 1);
        var first = AssertAuthority(Payload(pending)["currentPresentationAuthority"]).ToJsonString();
        await fixture.Generate();
        var next = AssertAuthority((await ReadStatus(fixture))["currentPresentationAuthority"]).ToJsonString();
        Assert.NotEqual(first, next);
        fixture.Authority.FinalizeResponse(pending);
        Assert.Null(Payload(pending)["currentPresentationAuthority"]);
        Assert.All(Sections(pending), section => Assert.Null(section!["configuredRowAssociation"]));
        Assert.Single(Payload(pending)["sectionItems"]![Sections(pending)[0]!["id"]!.GetValue<string>()]!.AsArray());
    }

    [Fact]
    public async Task FreshnessMutationObservedBeforeStatusSnapshotReturnsUnknown()
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        AssertAuthority((await ReadStatus(fixture))["currentPresentationAuthority"]);
        using (PtvConfiguredRowAssociationService.BeginConfigurationMutation())
        {
            // All service calls in this direct-controller seam complete synchronously. This also
            // proves a reentrant read during the mutation scope cannot certify its old binding.
            var pending = ReadStatus(fixture);
            Assert.True(pending.IsCompletedSuccessfully);
            var status = await pending;
            Assert.Null(status["currentPresentationAuthority"]);
            Assert.Null(status["configuredPresentationBindings"]);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FreshnessFeaturedControllerMatchesFinalProofWithoutPublishingAdministratorBindings(bool restricted)
    {
        using var fixture = new Fixture();
        var raw = await fixture.Generate();
        var users = Users(UserId, OtherUserId);
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        ((LibraryProxy)(object)libraries).Allowed = ItemIds.Take(2).ToHashSet();
        var projector = new PtvFeaturedContentAuthorizationService(users, libraries, fixture.Authority);
        using var services = StatusServices(fixture, projector: projector);
        var userId = restricted ? OtherUserId : UserId;
        var controller = Controller(services, userId);
        var result = Assert.IsType<OkObjectResult>((await controller.GetFeaturedContent(CancellationToken.None)).Result);
        var document = Assert.IsType<PtvFeaturedContentDocument>(result.Value);
        var authority = AssertAuthority(Payload(document)["currentPresentationAuthority"]);
        Assert.Equal(authority.ToJsonString(), (await ReadStatus(fixture, userId))["currentPresentationAuthority"]!.ToJsonString());
        Assert.Null(Payload(document)["configuredPresentationBindings"]);
        Assert.Equal(2, Payload(document)["sectionItems"]![Sections(document)[0]!["id"]!.GetValue<string>()]!.AsArray().Count);
        Assert.DoesNotContain("currentPresentationAuthority", JsonSerializer.Serialize(raw));
    }

    [Fact]
    public async Task FreshnessFastProofDoesNotNeedStoreOrSettingsReads()
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        using var services = new ServiceCollection()
            .AddSingleton(fixture.Authority)
            .AddSingleton(Users(UserId))
            .AddSingleton<IAuthorizationService>(new AuthorizationStub())
            .BuildServiceProvider();
        var result = Assert.IsType<OkObjectResult>(await Controller(services, UserId).GetStatus(false, CancellationToken.None));
        var status = JsonSerializer.SerializeToNode(result.Value)!;
        AssertAuthority(status["currentPresentationAuthority"]);
        Assert.Single(status["configuredPresentationBindings"]!.AsArray());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FreshnessStatusCapturesAuthorityAndPairsTogetherAfterConcurrentReplacement(bool changeConfiguration)
    {
        using var fixture = new Fixture();
        await fixture.Generate();
        var initial = await ReadStatus(fixture);
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var release = new ManualResetEventSlim();
        var users = Users(UserId);
        ((UserProxy)(object)users).OnLookup = () =>
        {
            started.TrySetResult();
            Assert.True(release.Wait(TimeSpan.FromSeconds(5)));
        };
        using var services = StatusServices(fixture, users: users);
        var reading = Task.Run(async () => Assert.IsType<OkObjectResult>(await Controller(services, UserId).GetStatus(false, CancellationToken.None)));
        try
        {
            await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
            if (changeConfiguration)
                using (PtvConfiguredRowAssociationService.BeginConfigurationMutation()) fixture.Configuration.Rows.Rules[0].Name = "Next";
            await fixture.Generate(Document(("next-1", "rule-a"), ("next-2", "rule-a")));
        }
        finally
        {
            release.Set();
        }
        var actual = JsonSerializer.SerializeToNode((await reading).Value)!;
        var expected = await ReadStatus(fixture);
        Assert.NotEqual(initial["currentPresentationAuthority"]!.ToJsonString(), AssertAuthority(actual["currentPresentationAuthority"]).ToJsonString());
        Assert.Equal(expected["currentPresentationAuthority"]!.ToJsonString(), actual["currentPresentationAuthority"]!.ToJsonString());
        Assert.Equal(expected["configuredPresentationBindings"]!.ToJsonString(), actual["configuredPresentationBindings"]!.ToJsonString());
        Assert.Equal(2, actual["configuredPresentationBindings"]!.AsArray().Count);
    }

    private static JsonObject AssertAuthority(JsonNode? node)
    {
        var authority = Assert.IsType<JsonObject>(node);
        Assert.Equal(new[] { "generation", "scope", "version" }, authority.Select(p => p.Key).OrderBy(k => k).ToArray());
        Assert.Equal(1, authority["version"]!.GetValue<int>());
        AssertToken(authority["scope"]);
        AssertToken(authority["generation"]);
        return authority;
    }

    private static ServiceProvider StatusServices(Fixture fixture, PtvConfiguredRowAssociationService? authority = null, bool includeUsers = true, IUserManager? users = null, IPtvFeaturedContentAuthorizationService? projector = null)
    {
        var services = new ServiceCollection()
            .AddSingleton(authority ?? fixture.Authority)
            .AddSingleton<IAuthorizationService>(new AuthorizationStub())
            .AddSingleton<IPtvFeaturedContentStore>(fixture.Store)
            .AddSingleton<IPtvPluginSettingsService>(new SettingsStub(PtvPluginSettingsDto.FromConfiguration(fixture.Configuration)));
        if (includeUsers) services.AddSingleton(users ?? Users(UserId, OtherUserId));
        if (projector is not null) services.AddSingleton(projector);
        return services.BuildServiceProvider();
    }

    private static async Task<JsonObject> ReadStatus(Fixture fixture, Guid? userId = null, PtvConfiguredRowAssociationService? authority = null)
    {
        using var services = StatusServices(fixture, authority);
        var result = Assert.IsType<OkObjectResult>(await Controller(services, userId ?? UserId).GetStatus(false, CancellationToken.None));
        return JsonSerializer.SerializeToNode(result.Value)!.AsObject();
    }

    private static PtvStatusController Controller(IServiceProvider services, Guid userId) => new(NullLogger<PtvStatusController>.Instance, services)
    {
        ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("Jellyfin-UserId", userId.ToString("N"))], "test")) } }
    };

    private static void AssertToken(JsonNode? token) => Assert.Matches("^[0-9a-f]{64}$", token!.GetValue<string>());
    private static JsonObject Payload(PtvFeaturedContentDocument document) => document.FeaturedContent!["payload"]!.AsObject();
    private static JsonArray Sections(PtvFeaturedContentDocument document) => Payload(document)["sections"]!.AsArray();
    private static JsonObject Item(Guid id) => new() { ["Id"] = id.ToString("N"), ["Name"] = "Item", ["Type"] = "Movie" };
    private static PtvFeaturedContentDocument Document(params (string Section, string Rule)[] definitions)
    {
        if (definitions.Length == 0) definitions = [("section-a", "rule-a")];
        var sectionItems = new JsonObject();
        var sections = new JsonArray();
        foreach (var (section, rule) in definitions)
        {
            sectionItems[section] = new JsonArray(ItemIds.Select(id => (JsonNode)Item(id)).ToArray());
            sections.Add(new JsonObject { ["id"] = section, ["title"] = "Same", ["rowType"] = "configured-rule", ["sourceType"] = "latest", ["sourceRuleId"] = rule, ["ruleId"] = rule, ["sourceValue"] = "PRIVATE_SELECTOR", ["mediaType"] = "movies" });
        }
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return new PtvFeaturedContentDocument { Version = 1, UpdatedAt = now, FeaturedContent = new JsonObject { ["version"] = 7, ["createdAt"] = now, ["expiresAt"] = now + 3_600_000, ["payload"] = new JsonObject { ["heroItems"] = new JsonArray(Item(ItemIds[0])), ["sections"] = sections, ["sectionItems"] = sectionItems, ["rowDiagnostics"] = new JsonArray() } } };
    }

    // Advance only the retained owner's retry eligibility; no wall-clock waits or product test hook.
    private static void MakeRecoveryRetryDue(PtvFeaturedContentRefreshService refresh)
        => typeof(PtvFeaturedContentRefreshService).GetField("_trustRecoveryRetryAt", BindingFlags.Instance | BindingFlags.NonPublic)!
            .SetValue(refresh, DateTimeOffset.UtcNow.AddSeconds(-1).ToUnixTimeMilliseconds());

    private static TimeSpan ReadHostedDelay(PtvFeaturedContentRefreshService refresh, PtvFeaturedContentStoreStatus status)
        => (TimeSpan)typeof(PtvFeaturedContentRefreshService).GetMethod("GetDelayUntilNextRefresh", BindingFlags.Instance | BindingFlags.Static | BindingFlags.NonPublic)!.Invoke(refresh, [status])!;

    private static ILibraryManager ConfigureLatestLibraries(Fixture fixture)
    {
        fixture.Configuration.Rows.Rules = new[] { "movies", "shows", "music" }.Select(kind => new RowBuilderRule
        {
            Id = "latest-" + kind,
            Name = "Latest " + kind,
            SourceType = "latest",
            SourceValue = kind,
            MediaType = kind
        }).ToList();
        var items = Enumerable.Range(1, 48).Select(index =>
        {
            BaseItem item = index <= 16 ? new Movie() : index <= 32 ? new Series() : new MusicAlbum();
            if (item is Folder folder) folder.Children = [];
            item.Id = Guid.Parse($"bbbbbbbb-bbbb-bbbb-bbbb-{index:D12}");
            item.Name = "Synthetic " + index;
            item.DateCreated = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMinutes(index);
            item.ImageInfos = [new ItemImageInfo { Type = ImageType.Primary, DateModified = item.DateCreated, Path = "synthetic-image" }];
            return item;
        }).ToArray();
        var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
        var proxy = (LibraryProxy)(object)libraries;
        proxy.Root = new AggregateFolder { Children = items };
        proxy.Allowed = items.Select(item => item.Id).ToHashSet();
        return libraries;
    }

    private static EnrichmentStub CompletedEnrichment()
    {
        var result = new EnrichmentStub();
        result.Complete.SetResult();
        return result;
    }

    private static PtvFeaturedContentRefreshService CreateRefresh(PtvFeaturedContentStore store, PtvConfiguredRowAssociationService issuer, ILibraryManager libraries, EnrichmentStub enrichment)
        => new(store, libraries, NullLogger<PtvFeaturedContentRefreshService>.Instance, enrichment, issuer);

    private static void AssertLatestMappings(PtvConfiguredRowAssociationService issuer, PtvFeaturedContentDocument document)
    {
        var projection = issuer.CaptureProjection(document, UserId);
        Assert.NotNull(projection);
        var rows = issuer.CaptureCurrentPresentationProof(UserId, true)!.Bindings!;
        Assert.Equal(3, rows.Count);
        Assert.Equal(new[] { "Latest movies", "Latest music", "Latest shows" }, Sections(document).Select(section => section!["title"]!.GetValue<string>()).Order());
        var expected = new[] { (kind: "movies", first: 1, type: "Movie"), (kind: "shows", first: 17, type: "Series"), (kind: "music", first: 33, type: "MusicAlbum") };
        foreach (var (kind, first, type) in expected)
        {
            var section = Assert.Single(Sections(document), section => section!["title"]!.GetValue<string>() == "Latest " + kind)!;
            var id = section["id"]!.GetValue<string>();
            var alias = projection.ForSection(id)!;
            Assert.Equal(projection.RuleToken("latest-" + kind), alias["rule"]!.GetValue<string>());
            Assert.Single(rows, pair => pair!["rule"]!.ToJsonString() == alias["rule"]!.ToJsonString() && pair["section"]!.ToJsonString() == alias["section"]!.ToJsonString());
            var items = Payload(document)["sectionItems"]![id]!.AsArray();
            Assert.Equal(Enumerable.Range(first, 16).Select(index => Guid.Parse($"bbbbbbbb-bbbb-bbbb-bbbb-{index:D12}")).Order(),
                items.Select(item => Guid.Parse(item!["Id"]!.GetValue<string>())).Order());
            Assert.All(items, item => Assert.Equal(type, item!["Type"]!.GetValue<string>()));
        }
    }

    private sealed class Fixture : IDisposable
    {
        public PluginConfiguration Configuration { get; } = new() { Rows = new RowBuilderSettings { Rules = [new RowBuilderRule { Id = "rule-a", Name = "Same", SourceType = "latest", SourceValue = "movies", MediaType = "movies" }] } };
        public TestPaths Paths { get; } = new();
        public PtvConfiguredRowAssociationService Authority { get; }
        public PtvFeaturedContentStore Store { get; }
        public Fixture()
        {
            PtvPluginSettingsNormalizer.Normalize(Configuration);
            Authority = new PtvConfiguredRowAssociationService("server-a", () => Configuration);
            Store = new PtvFeaturedContentStore(Paths, NullLogger<PtvFeaturedContentStore>.Instance, Authority);
        }
        public Task<PtvFeaturedContentDocument> Generate(PtvFeaturedContentDocument? document = null) => Store.WriteGeneratedAsync(document ?? Document(), Authority.CaptureGeneration()!, CancellationToken.None);
        public PtvFeaturedContentDocument Project(PtvFeaturedContentDocument document, int survivors, bool associations = true, Guid? userId = null)
        {
            var libraries = DispatchProxy.Create<ILibraryManager, LibraryProxy>();
            ((LibraryProxy)(object)libraries).Allowed = ItemIds.Take(survivors).ToHashSet();
            return new PtvFeaturedContentAuthorizationService(Users(UserId, OtherUserId), libraries, associations ? Authority : null).AuthorizeForUser(document, userId ?? UserId).Document!;
        }
        public void Dispose() => Paths.Dispose();
    }

    private static IUserManager Users(params Guid[] ids)
    {
        var proxy = DispatchProxy.Create<IUserManager, UserProxy>();
        ((UserProxy)(object)proxy).Users = ids.ToDictionary(id => id, id =>
        {
            var user = new User("test", "auth", "reset") { Id = id };
            if (id == UserId) user.Permissions.Add(new Permission(PermissionKind.IsAdministrator, true));
            return user;
        });
        return proxy;
    }
    public class UserProxy : DispatchProxy
    {
        public Dictionary<Guid, User> Users { get; set; } = [];
        public Action? OnLookup { get; set; }
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name == "GetUserById" && args?[0] is Guid id)
            {
                OnLookup?.Invoke();
                return Users.GetValueOrDefault(id);
            }
            throw new NotSupportedException(targetMethod?.Name);
        }
    }
    public class LibraryProxy : DispatchProxy
    {
        public bool FailEnumeration { get; set; }
        public int Enumerations { get; private set; }
        public HashSet<Guid> Allowed { get; set; } = [];
        public AggregateFolder? Root { get; set; }
        public Action? OnLookup { get; set; }
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name == "get_RootFolder")
            {
                Enumerations++;
                if (FailEnumeration) throw new InvalidOperationException("Synthetic enumeration failure.");
                return Root;
            }
            if (targetMethod?.Name == "GetItemById" && args?[0] is Guid id)
            {
                OnLookup?.Invoke();
                return Allowed.Contains(id) ? new Movie { Id = id } : null;
            }
            throw new NotSupportedException(targetMethod?.Name);
        }
    }
    public class XmlProxy : DispatchProxy
    {
        public int Writes { get; private set; }
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name == "SerializeToFile") { Writes++; return null; }
            throw new NotSupportedException(targetMethod?.Name);
        }
    }
    private sealed class EnrichmentStub : IPtvTmdbMetadataService
    {
        public int Calls { get; private set; }
        public Action? OnFacts { get; set; }
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Complete { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool IsConfigured => true;
        public PtvTmdbMetadataStatus GetStatus() => new() { Enabled = true, Configured = true };
        public Task<PtvTmdbMetadataStatus> ValidateCredentialsAsync(CancellationToken cancellationToken) => Task.FromResult(GetStatus());
        public async Task<IReadOnlyDictionary<Guid, PtvTmdbItemFacts>> GetFactsAsync(IEnumerable<BaseItem> items, CancellationToken cancellationToken)
        {
            Calls++;
            OnFacts?.Invoke();
            Started.TrySetResult();
            await Complete.Task.WaitAsync(cancellationToken);
            return new Dictionary<Guid, PtvTmdbItemFacts>();
        }
    }

    private sealed class ScheduleClock : TimeProvider
    {
        private DateTimeOffset _now = DateTimeOffset.UtcNow;
        private readonly List<ScheduleTimer> _timers = [];
        private readonly global::System.Threading.Channels.Channel<ScheduleTimer> _created = global::System.Threading.Channels.Channel.CreateUnbounded<ScheduleTimer>();
        public override DateTimeOffset GetUtcNow() { lock (_timers) return _now; }
        public int ActiveTimers { get { lock (_timers) return _timers.Count(timer => !timer.IsDisposed); } }
        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            Assert.Equal(Timeout.InfiniteTimeSpan, period);
            var timer = new ScheduleTimer(callback, state, dueTime);
            lock (_timers) _timers.Add(timer);
            _created.Writer.TryWrite(timer);
            return timer;
        }
        public async Task<ScheduleTimer> NextTimer()
        {
            try { return await _created.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5)); }
            catch (TimeoutException) { Assert.Fail("The hosted owner did not publish its next scheduled wait."); throw; }
        }
        public void Fire(ScheduleTimer timer)
        {
            lock (_timers) _now += timer.Delay;
            timer.Fire();
        }
    }

    private sealed class ScheduleTimer(TimerCallback callback, object? state, TimeSpan delay) : ITimer
    {
        private int _disposed;
        public TimeSpan Delay { get; } = delay;
        public bool IsDisposed => Volatile.Read(ref _disposed) != 0;
        public void Fire() { Assert.False(IsDisposed); callback(state); }
        public bool Change(TimeSpan dueTime, TimeSpan period) => throw new NotSupportedException();
        public void Dispose() => Interlocked.Exchange(ref _disposed, 1);
        public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
    }
    private sealed class SettingsStub(PtvPluginSettingsDto settings) : IPtvPluginSettingsService
    {
        public PtvPluginSettingsDto GetSettings() => settings;
        public PtvPluginSettingsDto SaveSettings(PtvPluginSettingsPatchDto settings) => throw new NotSupportedException();
        public PtvPluginSettingsDto ResetSettings() => throw new NotSupportedException();
        public PtvReadingSeriesOverridesResponse GetReadingSeriesOverrides(string routeKind) => throw new NotSupportedException();
        public PtvReadingSeriesOverridesResponse SaveReadingSeriesOverrides(string routeKind, PtvReadingSeriesOverridesUpdate update) => throw new NotSupportedException();
    }
    private sealed class AuthorizationStub : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource, IEnumerable<IAuthorizationRequirement> requirements) => AuthorizeAsync(user, resource, "test");
        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource, string policyName) => Task.FromResult(user.FindFirst("Jellyfin-UserId")?.Value == UserId.ToString("N") ? AuthorizationResult.Success() : AuthorizationResult.Failed());
    }
    private sealed class TestPaths : IApplicationPaths, IDisposable
    {
        private readonly string _root = Path.Combine(Path.GetTempPath(), "ptv-association-test-" + Guid.NewGuid().ToString("N"));
        public string ProgramDataPath => _root;
        public string WebPath => Path.Combine(_root, "web");
        public string ProgramSystemPath => Path.Combine(_root, "system");
        public string DataPath => Path.Combine(_root, "data");
        public string ImageCachePath => Path.Combine(_root, "images");
        public string PluginsPath => Path.Combine(_root, "plugins");
        public string PluginConfigurationsPath => Path.Combine(_root, "config");
        public string LogDirectoryPath => Path.Combine(_root, "logs");
        public string ConfigurationDirectoryPath => Path.Combine(_root, "config");
        public string SystemConfigurationFilePath => Path.Combine(_root, "system.xml");
        public string CachePath => Path.Combine(_root, "cache");
        public string TempDirectory => Path.Combine(_root, "temp");
        public string VirtualDataPath => "%AppDataPath%";
        public string TrickplayPath => Path.Combine(_root, "trickplay");
        public string BackupPath => Path.Combine(_root, "backup");
        public void MakeSanityCheckOrThrow() => Directory.CreateDirectory(_root);
        public void CreateAndCheckMarker(string path, string marker, bool isDirectory) => throw new NotSupportedException();
        public void Dispose() { if (Directory.Exists(_root)) Directory.Delete(_root, true); }
    }
}

[CollectionDefinition("Configured row association serial", DisableParallelization = true)]
public sealed class ConfiguredRowAssociationSerialCollection;
