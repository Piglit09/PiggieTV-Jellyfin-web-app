using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Api;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvReadingIdentityPreflightTests
{
    private static readonly Guid Admin = Guid.NewGuid();
    private static readonly Guid ItemId = Guid.NewGuid();
    private static readonly DateTimeOffset Now = DateTimeOffset.UtcNow;
    private static PtvNormalizedMetadataCandidate Candidate() => new()
    {
        Provider = "gcd", ProviderId = "123", Title = "Orbit", SeriesTitle = "Orbit", IssueNumber = "9",
        SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.Provider,
        IssueNumberEvidence = PtvReadingIdentityEvidenceSource.Provider,
        IdentityProviderIds = [new() { Namespace = "GCD", Value = "123", Scope = PtvReadingProviderIdScope.Issue }]
    };

    [Fact]
    public void ContextExpiresAfter15Minutes()
    {
        var codec = new PtvReadingCandidateContextCodec();
        var token = codec.Issue(Admin, ItemId, "generation", Candidate(), Now);
        Assert.Equal("generation", codec.Validate(token, Admin, ItemId, Now.AddMinutes(14)).SearchGeneration);
        Assert.Throws<PtvReadingMetadataServiceException>(() => codec.Validate(token, Admin, ItemId, Now.AddMinutes(15)));
    }

    [Fact]
    public void CrossUserOrItemContextRejected()
    {
        var codec = new PtvReadingCandidateContextCodec();
        var token = codec.Issue(Admin, ItemId, "generation", Candidate(), Now);
        Assert.Throws<PtvReadingMetadataServiceException>(() => codec.Validate(token, Guid.NewGuid(), ItemId, Now));
        Assert.Throws<PtvReadingMetadataServiceException>(() => codec.Validate(token, Admin, Guid.NewGuid(), Now));
    }

    [Fact]
    public void PluginRestartInvalidatesContext()
    {
        var token = new PtvReadingCandidateContextCodec().Issue(Admin, ItemId, "generation", Candidate(), Now);
        Assert.Throws<PtvReadingMetadataServiceException>(() => new PtvReadingCandidateContextCodec().Validate(token, Admin, ItemId, Now));
    }

    [Fact]
    public void TamperedOversizedAndUnstableContextsRejected()
    {
        var codec = new PtvReadingCandidateContextCodec();
        var token = codec.Issue(Admin, ItemId, "generation", Candidate(), Now);
        Assert.InRange(Encoding.UTF8.GetByteCount(token), 1, 16384);
        Assert.Throws<PtvReadingMetadataServiceException>(() => codec.Validate("x" + token[1..], Admin, ItemId, Now));
        Assert.Throws<PtvReadingMetadataServiceException>(() => codec.Validate(new string('x', 16385), Admin, ItemId, Now));
        Assert.Throws<PtvReadingMetadataServiceException>(() => codec.Issue(Admin, ItemId, new string('x', 65), Candidate(), Now));
        var candidate = Candidate(); candidate.ProviderId = "";
        Assert.Throws<PtvReadingMetadataServiceException>(() => codec.Issue(Admin, ItemId, "generation", candidate, Now));
    }

    [Fact]
    public void NoPathOrXmlInResponse()
    {
        var codec = new PtvReadingCandidateContextCodec();
        var candidate = Candidate();
        candidate.SeriesTitle = "https://private.invalid/?token=secret";
        candidate.Description = "<ComicInfo>private raw XML</ComicInfo>";
        candidate.SourceUrl = "https://private.invalid/?token=secret";
        candidate.CoverUrl = "C:\\private\\archive.cbr";
        var token = codec.Issue(Admin, ItemId, "generation", candidate, Now);
        var signed = codec.Validate(token, Admin, ItemId, Now);
        var json = JsonSerializer.Serialize(signed);
        Assert.DoesNotContain("secret", json);
        Assert.DoesNotContain("private", json);
        Assert.True(signed.Candidate.HasRedactedIdentity);
        var assessment = new PtvReadingIdentityAssessor().Assess(new(), signed.Candidate);
        Assert.Contains(assessment.Findings, f => f.Code == "IDENTITY_TEXT_REDACTED");
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    public async Task AnonymousAndRestrictedDenied(bool authenticated, bool elevated)
    {
        using var fixture = new Fixture();
        var controller = Controller(fixture.Service, authenticated, elevated);
        var result = await controller.Reassess(new() { ItemId = ItemId.ToString(), CandidateContext = "invalid" }, default);
        Assert.True(result.Result is UnauthorizedResult or ForbidResult);
        Assert.Equal(0, fixture.Inspector.ApplyCalls);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-guid")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public async Task ElevatedButMalformedIdentityBlocks(string claim)
    {
        using var fixture = new Fixture();
        var controller = Controller(fixture.Service, true, true);
        controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("Jellyfin-UserId", claim)], "Test"));
        Assert.IsType<UnauthorizedResult>((await controller.Reassess(new(), default)).Result);
    }

    [Fact]
    public async Task ContradictoryAuthenticatedIdentitiesBlock()
    {
        using var fixture = new Fixture();
        var controller = Controller(fixture.Service, true, true);
        controller.HttpContext.User.AddIdentity(new ClaimsIdentity([new Claim("Jellyfin-UserId", Guid.NewGuid().ToString())], "Test"));
        Assert.IsType<UnauthorizedResult>((await controller.Reassess(new(), default)).Result);
    }

    [Fact]
    public async Task OldWebSearchWithoutGenerationStillWorks()
    {
        using var fixture = new Fixture();
        var search = await fixture.Service.SearchAsync(new() { ItemId = ItemId.ToString(), Provider = "gcd" }, Admin, default);
        Assert.False(string.IsNullOrWhiteSpace(search.SearchGeneration));
        var candidate = Assert.Single(search.Candidates);
        Assert.False(string.IsNullOrWhiteSpace(candidate.AssessmentContext));
        Assert.False(string.IsNullOrWhiteSpace(candidate.ArchiveRevision));
        Assert.Equal(candidate.IdentityAssessment!.AssessmentDigest, candidate.AssessmentDigest);
        Assert.Equal(search.SearchGeneration, fixture.Codec.Validate(candidate.AssessmentContext!, Admin, ItemId, DateTimeOffset.UtcNow).SearchGeneration);
        foreach (var bound in search.Candidates.Concat(search.ProviderResults.SelectMany(result => result.Candidates)))
        {
            var assessment = Assert.IsType<PtvReadingIdentityAssessment>(bound.IdentityAssessment);
            Assert.Equal(ItemId.ToString("N"), assessment.ItemId);
            Assert.Equal(bound.Provider, assessment.Provider);
            Assert.Equal(bound.ProviderId, assessment.ProviderId);
            Assert.Equal(search.SearchGeneration, assessment.SearchGeneration);
            Assert.Equal(bound.ArchiveRevision, assessment.ArchiveRevision);
            Assert.Equal(bound.AssessmentDigest, assessment.AssessmentDigest);
        }
        var fresh = await fixture.Service.ReassessAsync(new() { ItemId = ItemId.ToString(),
            CandidateContext = candidate.AssessmentContext!, DisplayedRevision = candidate.ArchiveRevision }, Admin, default);
        Assert.False(fresh.RevisionChanged);
        Assert.Equal(JsonSerializer.Serialize(candidate.IdentityAssessment), JsonSerializer.Serialize(fresh));
    }

    [Fact]
    public async Task SerializedSearchFixtureMatchesCurrentProducerAndFreshReassessment()
    {
        using var fixture = new Fixture();
        var originalPath = fixture.Item.Path;
        var directory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString(), "Orbit (2018)");
        Directory.CreateDirectory(directory);
        fixture.Item.Path = Path.Combine(directory, "Orbit #9 (2019).cbz");
        File.WriteAllText(fixture.Item.Path, "synthetic");
        try
        {
            var search = await fixture.Service.SearchAsync(new() { ItemId = ItemId.ToString(), Provider = "gcd", SearchGeneration = "fixture-generation" }, Admin, default);
            var candidate = Assert.Single(search.Candidates);
            var reassessment = await fixture.Service.ReassessAsync(new() { ItemId = ItemId.ToString(), CandidateContext = candidate.AssessmentContext!, DisplayedRevision = candidate.ArchiveRevision }, Admin, default);
            var json = JsonSerializer.SerializeToNode(new { Search = search, Reassessment = reassessment })!;
            // Only random authority envelopes are replaced; all produced evidence and missing fields stay intact.
            void Scrub(JsonNode? node)
            {
                if (node is JsonObject obj)
                    foreach (var (key, value) in obj.ToArray())
                    {
                        if (key is "ItemId" or "ArchiveRevision" or "AssessmentContext" && value is JsonValue scalar
                            && scalar.TryGetValue<string>(out var text) && !string.IsNullOrEmpty(text))
                            obj[key] = key == "ItemId" ? "11111111111111111111111111111111" : "fixture-" + key;
                        else Scrub(value);
                    }
                else if (node is JsonArray array) foreach (var value in array) Scrub(value);
            }
            Scrub(json);
            var root = new DirectoryInfo(AppContext.BaseDirectory);
            while (root is not null && !File.Exists(Path.Combine(root.FullName, "ptv-version.json"))) root = root.Parent;
            Assert.NotNull(root);
            var path = Path.Combine(root.FullName, "src/ptv/modules/settings/admin/metadataManager/fixtures/plugin-reading-search.json");
            if (Environment.GetEnvironmentVariable("PTV_UPDATE_READING_FIXTURE") == "1")
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.WriteAllText(path, json.ToJsonString(new() { WriteIndented = true }) + "\n");
            }
            Assert.True(JsonNode.DeepEquals(JsonNode.Parse(File.ReadAllText(path)), json), "Serialized Plugin fixture must match the current producer.");
            Assert.Equal(JsonSerializer.Serialize(candidate.IdentityAssessment), JsonSerializer.Serialize(reassessment));
        }
        finally
        {
            File.Delete(fixture.Item.Path);
            Directory.Delete(directory);
            Directory.Delete(Path.GetDirectoryName(directory)!);
            fixture.Item.Path = originalPath;
        }
    }

    [Fact]
    public async Task ChangedArchiveReturnsNewAssessment()
    {
        using var fixture = new Fixture();
        var first = await fixture.Reassess();
        File.AppendAllText(fixture.Item.Path, "changed");
        fixture.Inspector.Issue = "10";
        var second = await fixture.Reassess(first.ArchiveRevision);
        Assert.NotEqual(first.ArchiveRevision, second.ArchiveRevision);
        Assert.NotEqual(first.AssessmentDigest, second.AssessmentDigest);
        Assert.True(second.RequiresConflictAcknowledgment);
        Assert.True(second.RevisionChanged);
    }

    [Fact]
    public async Task ReassessmentBypassesCachedSearch()
    {
        using var fixture = new Fixture();
        await fixture.Service.SearchAsync(new() { ItemId = ItemId.ToString(), Provider = "gcd" }, Admin, default);
        await fixture.Reassess(); await fixture.Reassess();
        Assert.Equal(1, fixture.Provider.Calls);
        Assert.Equal(2, fixture.Inspector.ApplyCalls);
    }

    [Fact]
    public async Task UnreadableArchiveReturnsTypedUnverified()
    {
        using var fixture = new Fixture();
        File.Delete(fixture.Item.Path);
        var response = await Controller(fixture.Service, true, true).Reassess(fixture.Request(), default);
        var assessment = Assert.IsType<PtvReadingIdentityAssessment>(Assert.IsType<OkObjectResult>(response.Result).Value);
        Assert.Equal(PtvComicInfoArchiveInspectionState.Unverified, assessment.Sources.ArchiveState);
        Assert.True(assessment.RequiresUnverifiedAcknowledgment);
    }

    [Fact]
    public async Task InfrastructureFailureBlocks()
    {
        using var fixture = new Fixture(); fixture.Inspector.Failure = new InvalidOperationException("private path");
        var response = await Controller(fixture.Service, true, true).Reassess(fixture.Request(), default);
        var error = Assert.IsType<ObjectResult>(response.Result);
        Assert.Equal(503, error.StatusCode);
        Assert.DoesNotContain("private", JsonSerializer.Serialize(error.Value));
    }

    [Fact]
    public async Task ChangeDuringInspectionIsUnverifiedAndMissingItemBlocks()
    {
        using var fixture = new Fixture();
        fixture.Inspector.DuringApply = () => File.AppendAllText(fixture.Item.Path, "change");
        var result = await fixture.Reassess();
        Assert.Equal(PtvComicInfoArchiveInspectionState.Unverified, result.Sources.ArchiveState);
        Assert.Equal("ARCHIVE_CHANGED_DURING_INSPECTION", result.Sources.ArchiveReasonCode);
        fixture.Library.Item = null;
        var response = await Controller(fixture.Service, true, true).Reassess(fixture.Request(), default);
        Assert.IsType<NotFoundObjectResult>(response.Result);
    }

    [Fact]
    public async Task ReplacementWithSameSizeAndTimestampsChangesRevisionWhenFileIdentityAvailable()
    {
        using var fixture = new Fixture();
        var first = await fixture.Reassess();
        var modified = File.GetLastWriteTimeUtc(fixture.Item.Path);
        var created = File.GetCreationTimeUtc(fixture.Item.Path);
        var replacement = fixture.Item.Path + ".replacement";
        File.WriteAllText(replacement, "synthetic");
        File.Move(replacement, fixture.Item.Path, overwrite: true);
        File.SetCreationTimeUtc(fixture.Item.Path, created);
        File.SetLastWriteTimeUtc(fixture.Item.Path, modified);
        var second = await fixture.Reassess(first.ArchiveRevision);
        Assert.NotEqual(first.ArchiveRevision, second.ArchiveRevision);
    }

    [Fact]
    public async Task MissingHelperIsTypedAndMissingPathIsNotAttempted()
    {
        using var fixture = new Fixture();
        var manager = DispatchProxy.Create<ILibraryManager, PtvReadingMetadataIdentificationServiceTests.LibraryManagerProxy>();
        ((PtvReadingMetadataIdentificationServiceTests.LibraryManagerProxy)(object)manager).Item = fixture.Item;
        var service = new PtvReadingMetadataIdentificationService(manager, [], new PtvReadingLocalMetadataInspector(new PtvUnavailableArchiveInspectionHost()),
            new(), new(), NullLogger<PtvReadingMetadataIdentificationService>.Instance, fixture.Codec);
        var result = await service.ReassessAsync(fixture.Request(), Admin, default);
        Assert.Equal("HELPER_UNAVAILABLE", result.Sources.ArchiveReasonCode);
        Assert.True(result.RequiresUnverifiedAcknowledgment);
        var path = fixture.Item.Path;
        fixture.Item.Path = null!;
        try { Assert.Equal(PtvComicInfoArchiveInspectionState.NotAttempted, (await service.ReassessAsync(fixture.Request(), Admin, default)).Sources.ArchiveState); }
        finally { fixture.Item.Path = path; }
    }

    [Fact]
    public async Task RawComicInfoDigestDetectsChangeWithIdenticalIdentityAndFileStats()
    {
        using var fixture = new Fixture();
        var host = new BytesHost();
        var manager = DispatchProxy.Create<ILibraryManager, PtvReadingMetadataIdentificationServiceTests.LibraryManagerProxy>();
        ((PtvReadingMetadataIdentificationServiceTests.LibraryManagerProxy)(object)manager).Item = fixture.Item;
        var service = new PtvReadingMetadataIdentificationService(manager, [], new PtvReadingLocalMetadataInspector(host),
            new(), new(), NullLogger<PtvReadingMetadataIdentificationService>.Instance, fixture.Codec);
        var first = await service.ReassessAsync(fixture.Request(), Admin, default);
        host.Comment = "second-private-comment";
        var second = await service.ReassessAsync(fixture.Request(), Admin, default);
        Assert.NotEqual(first.ArchiveRevision, second.ArchiveRevision);
        Assert.Equal(first.AssessmentDigest, second.AssessmentDigest);
        Assert.DoesNotContain("private", JsonSerializer.Serialize(second));
        Assert.DoesNotContain(fixture.Item.Path, JsonSerializer.Serialize(second));
    }

    private sealed class BytesHost : IPtvArchiveInspectionHost
    {
        public string Comment = "first-private-comment";
        public Task<PtvComicInfoBytesResult> ReadComicInfoAsync(string path, CancellationToken token) => Task.FromResult(new PtvComicInfoBytesResult("inspected", "COMICINFO_FOUND",
            Encoding.UTF8.GetBytes($"<ComicInfo><Series>Orbit</Series><Number>9</Number><!--{Comment}--></ComicInfo>")));
    }

    private static PtvReadingMetadataController Controller(IPtvReadingMetadataIdentificationService service, bool authenticated, bool elevated) => new(service, new Authorization(elevated))
    {
        ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(
            authenticated ? [new Claim("Jellyfin-UserId", Admin.ToString())] : [], authenticated ? "Test" : null)) } }
    };

    private sealed class Authorization(bool elevated) : IAuthorizationService
    {
        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource, IEnumerable<IAuthorizationRequirement> requirements) => Task.FromResult(elevated ? AuthorizationResult.Success() : AuthorizationResult.Failed());
        public Task<AuthorizationResult> AuthorizeAsync(ClaimsPrincipal user, object? resource, string policyName) => Task.FromResult(elevated ? AuthorizationResult.Success() : AuthorizationResult.Failed());
    }

    private sealed class Fixture : IDisposable
    {
        public Book Item { get; } = new() { Id = ItemId, Name = "Orbit", SeriesName = "Orbit", Path = Path.Combine(Path.GetTempPath(), "ptv-preflight-" + Guid.NewGuid() + ".cbz") };
        public Inspector Inspector { get; } = new();
        public Provider Provider { get; } = new();
        public PtvReadingCandidateContextCodec Codec { get; } = new();
        public PtvReadingMetadataIdentificationService Service { get; }
        public PtvReadingMetadataIdentificationServiceTests.LibraryManagerProxy Library { get; }
        public Fixture()
        {
            File.WriteAllText(Item.Path, "synthetic");
            var manager = DispatchProxy.Create<ILibraryManager, PtvReadingMetadataIdentificationServiceTests.LibraryManagerProxy>();
            Library = (PtvReadingMetadataIdentificationServiceTests.LibraryManagerProxy)(object)manager; Library.Item = Item;
            Service = new(manager, [Provider], Inspector, new(), new(), NullLogger<PtvReadingMetadataIdentificationService>.Instance, Codec);
        }
        public PtvReadingIdentityReassessRequest Request(string? revision = null) => new() { ItemId = ItemId.ToString(), CandidateContext = Codec.Issue(Admin, ItemId, "generation", Candidate(), DateTimeOffset.UtcNow), DisplayedRevision = revision };
        public Task<PtvReadingIdentityAssessment> Reassess(string? revision = null) => Service.ReassessAsync(Request(revision), Admin, default);
        public void Dispose() => File.Delete(Item.Path);
    }
    private sealed class Inspector : IPtvReadingLocalMetadataInspector
    {
        public int ApplyCalls; public string Issue = "9"; public Exception? Failure; public Action? DuringApply;
        public Task<PtvReadingLocalMetadataInspectionResult> InspectAsync(string path, PtvMetadataSearchContext context, PtvStructuredMetadataQuery query, CancellationToken token) => Task.FromResult(Result());
        public Task<PtvReadingLocalMetadataInspectionResult> InspectForApplyAsync(string path, PtvMetadataSearchContext context, PtvStructuredMetadataQuery query, CancellationToken token)
        { ApplyCalls++; if (Failure is not null) throw Failure; DuringApply?.Invoke(); return Task.FromResult(Result()); }
        private PtvReadingLocalMetadataInspectionResult Result() => new() { ComicInfo = new() { State = PtvComicInfoArchiveInspectionState.Inspected, Metadata = new() { SeriesTitle = "Orbit", IssueNumber = Issue } } };
    }
    private sealed class Provider : IPtvReadingMetadataProvider
    {
        public int Calls; public string Id => "gcd"; public string DisplayName => "GCD";
        public bool Supports(PtvMetadataSearchContext context) => true;
        public Task<PtvReadingProviderSearchResult> SearchAsync(PtvStructuredMetadataQuery query, CancellationToken token)
        { Calls++; return Task.FromResult(new PtvReadingProviderSearchResult { Provider = Id, Candidates = [Candidate()], CacheHit = true }); }
        public Task<PtvNormalizedMetadataCandidate?> GetByIdAsync(string id, CancellationToken token) => throw new InvalidOperationException("Unexpected provider refetch");
        public Task<PtvReadingProviderStatus> GetStatusAsync(CancellationToken token) => Task.FromResult(new PtvReadingProviderStatus { Provider = Id });
    }
}
