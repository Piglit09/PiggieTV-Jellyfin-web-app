using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>One server-issued, identity-only candidate, bound to the administrator and item.</summary>
public sealed record PtvSignedReadingCandidate(Guid AdministratorId, Guid ItemId, string SearchGeneration,
    PtvNormalizedMetadataCandidate Candidate, DateTimeOffset ExpiresAt);

/// <summary>Singleton signing authority. Its random key is never persisted or returned.</summary>
public sealed class PtvReadingCandidateContextCodec
{
    private const int MaximumTokenLength = 16 * 1024;
    private readonly byte[] _key = RandomNumberGenerator.GetBytes(32);
    private sealed record Payload(Guid AdministratorId, Guid ItemId, string SearchGeneration,
        string Provider, string ProviderId, PtvReadingMediaClass MediaClass, PtvReadingIdentityRecord Identity,
        PtvReadingIdentityEvidenceSource SeriesEvidence, PtvReadingIdentityEvidenceSource IssueEvidence,
        DateTimeOffset IssuedAt, DateTimeOffset ExpiresAt);

    /// <summary>Issues a bounded context with only safe identity fields and source provenance.</summary>
    public string Issue(Guid administratorId, Guid itemId, string searchGeneration,
        PtvNormalizedMetadataCandidate candidate, DateTimeOffset now)
    {
        if (administratorId == Guid.Empty || itemId == Guid.Empty || !ValidGeneration(searchGeneration)
            || !ValidProvider(candidate.Provider) || !ValidId(candidate.ProviderId)) throw Invalid();
        var identity = new PtvReadingIdentityAssessor().Assess(new(), candidate.ToBoundedTransportModel()).Candidate;
        var payload = new Payload(administratorId, itemId, searchGeneration, candidate.Provider, candidate.ProviderId,
            candidate.MediaClass, identity, candidate.SeriesTitleEvidence, candidate.IssueNumberEvidence, now, now.AddMinutes(15));
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload);
        if (bytes.Length > 12_000) throw Invalid();
        var token = Convert.ToBase64String(bytes) + "." + Convert.ToBase64String(Sign("candidate", bytes));
        if (token.Length > MaximumTokenLength) throw Invalid();
        return token;
    }

    /// <summary>Validates before exposing candidate data; rejects malformed, expired and cross-scope contexts.</summary>
    public PtvSignedReadingCandidate Validate(string token, Guid administratorId, Guid itemId, DateTimeOffset now)
    {
        if (string.IsNullOrEmpty(token) || token.Length > MaximumTokenLength
            || administratorId == Guid.Empty || itemId == Guid.Empty) throw Invalid();
        try
        {
            var parts = token.Split('.');
            if (parts.Length != 2 || parts[1].Length != 44) throw Invalid();
            var bytes = Convert.FromBase64String(parts[0]);
            var signature = Convert.FromBase64String(parts[1]);
            if (!CryptographicOperations.FixedTimeEquals(Sign("candidate", bytes), signature)) throw Invalid();
            var payload = JsonSerializer.Deserialize<Payload>(bytes);
            if (payload is null || payload.AdministratorId != administratorId || payload.ItemId != itemId
                || payload.IssuedAt > now || now >= payload.ExpiresAt
                || payload.ExpiresAt - payload.IssuedAt > TimeSpan.FromMinutes(15)
                || !ValidGeneration(payload.SearchGeneration)) throw Invalid();
            var identity = payload.Identity;
            var candidate = new PtvNormalizedMetadataCandidate
            {
                Provider = payload.Provider, ProviderId = payload.ProviderId, MediaClass = payload.MediaClass,
                HasRedactedIdentity = identity.HasRedactedIdentity,
                SeriesTitle = identity.SeriesTitle, Title = identity.SeriesTitle ?? string.Empty,
                SeriesTitleEvidence = payload.SeriesEvidence,
                IssueNumber = identity.IssueNumber, IssueNumberEvidence = payload.IssueEvidence,
                VolumeNumber = identity.RunEvidenceKind == PtvReadingRunEvidenceKind.ExplicitRun ? null : identity.VolumeOrRunLabel,
                StartYear = identity.RunEvidenceKind == PtvReadingRunEvidenceKind.ExplicitRun && int.TryParse(identity.VolumeOrRunLabel, out var year) ? year : null,
                RunEvidenceKind = identity.RunEvidenceKind,
                IssuePublicationYear = identity.IssuePublicationYear, IssuePublicationDate = identity.IssuePublicationDate,
                IssuePublicationEvidence = PtvReadingIdentityEvidenceSource.Provider,
                IdentityProviderIds = identity.ProviderIds
            };
            return new(administratorId, itemId, payload.SearchGeneration, candidate, payload.ExpiresAt);
        }
        catch (Exception ex) when (ex is FormatException or JsonException or ArgumentException)
        { throw Invalid(); }
    }

    internal string Revision(object value) => Convert.ToHexString(Sign("archive-revision", JsonSerializer.SerializeToUtf8Bytes(value)));
    internal static bool ValidGeneration(string? value) => value is { Length: > 0 and <= 64 } && !value.Any(char.IsControl);
    private static bool ValidProvider(string? value) => value is { Length: > 0 and <= 128 }
        && value.All(c => char.IsAsciiLetterOrDigit(c) || c is ' ' or '+' or '-' or '_');
    private static bool ValidId(string? value) => value is { Length: > 0 and <= 256 }
        && value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    private byte[] Sign(string domain, byte[] bytes) => HMACSHA256.HashData(_key, Encoding.UTF8.GetBytes(domain + "\0").Concat(bytes).ToArray());
    private static PtvReadingMetadataServiceException Invalid() => new("PTV_READING_CONTEXT_INVALID", "The candidate context is invalid or expired. Search again.");
}
