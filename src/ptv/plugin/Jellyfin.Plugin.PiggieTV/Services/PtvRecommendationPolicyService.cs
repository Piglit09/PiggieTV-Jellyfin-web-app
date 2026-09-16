using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Deterministic, bounded, cross-client recommendation sequencer.</summary>
public sealed class PtvRecommendationPolicyService : IPtvRecommendationPolicyService
{
    internal const string CurrentContractVersion = "2.0";
    internal const string CurrentPolicyVersion = "music-premium-v2";
    internal const string AlgorithmId = "ptv-diversified-sequence-v2";

    private const int MaximumCandidates = 1000;
    private const int MaximumLimit = 200;
    private const int MaximumSignalValues = 32;

    /// <inheritdoc />
    public PtvRecommendationPolicyResponse Rank(PtvRecommendationPolicyRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ValidateRequest(request);
        var stopwatch = Stopwatch.StartNew();
        var constraints = GetConstraints(request.Surface);
        var limit = request.Limit;
        var seed = NormalizeSeed(request.Seed);
        var requestId = string.IsNullOrWhiteSpace(request.RequestId)
            ? DeriveRequestId(request, seed)
            : request.RequestId.Trim();
        var prepared = PrepareCandidates(request.Candidates, seed, requestId);
        var seedAffinityRequired = request.Surface == PtvRecommendationSurface.Radio
            && prepared.All(candidate => candidate.Reasons.Count == 0);
        var selected = seedAffinityRequired
            ? []
            : Sequence(prepared, constraints, request.Surface, limit);
        stopwatch.Stop();

        return new PtvRecommendationPolicyResponse
        {
            AlgorithmId = AlgorithmId,
            Cohort = string.IsNullOrWhiteSpace(request.Cohort) ? "default" : request.Cohort.Trim(),
            Constraints = constraints,
            FallbackReason = seedAffinityRequired
                ? "seed-affinity-required"
                : selected.Count < Math.Min(limit, prepared.Count)
                ? "insufficient-diverse-candidates"
                : selected.Count < limit
                ? "insufficient-candidates"
                : null,
            GeneratedAt = DateTimeOffset.UtcNow,
            GenerationLatencyMs = stopwatch.Elapsed.TotalMilliseconds,
            Items = selected.Select((candidate, index) => new PtvRankedRecommendationPolicyItem
            {
                Classification = candidate.Candidate.Classification,
                Id = candidate.Candidate.Id,
                MediaType = candidate.Candidate.MediaType,
                Rank = index + 1,
                Reasons = candidate.Reasons,
                Score = candidate.Score + candidate.TransitionScore,
                Source = candidate.Candidate.Source,
                Title = candidate.Candidate.Title,
                TransitionScore = candidate.TransitionScore
            }).ToList(),
            PolicyVersion = CurrentPolicyVersion,
            RequestId = requestId,
            Surface = request.Surface
        };
    }

    private static void ValidateRequest(PtvRecommendationPolicyRequest request)
    {
        if (!string.Equals(request.ContractVersion, CurrentContractVersion, StringComparison.Ordinal))
        {
            throw Invalid(
                "PTV_RECOMMENDATION_CONTRACT_MISMATCH",
                $"Recommendation contract version must be {CurrentContractVersion}.");
        }

        if (!string.Equals(request.PolicyVersion, CurrentPolicyVersion, StringComparison.Ordinal))
        {
            throw Invalid(
                "PTV_RECOMMENDATION_POLICY_UNSUPPORTED",
                $"Recommendation policy version must be {CurrentPolicyVersion}.");
        }

        if (!Enum.IsDefined(typeof(PtvRecommendationSurface), request.Surface))
        {
            throw Invalid(
                "PTV_RECOMMENDATION_SURFACE_UNSUPPORTED",
                "The requested recommendation surface is not supported.");
        }

        ValidateRequiredText(request.ServerId, 256, "PTV_RECOMMENDATION_SERVER_SCOPE_INVALID", "serverId");
        ValidateRequiredText(request.UserId, 64, "PTV_RECOMMENDATION_USER_SCOPE_INVALID", "userId");
        ValidateOptionalText(request.AlgorithmId, 96, "PTV_RECOMMENDATION_ALGORITHM_INVALID", "algorithmId");
        ValidateOptionalText(request.RequestId, 128, "PTV_RECOMMENDATION_REQUEST_ID_INVALID", "requestId");
        ValidateOptionalText(request.Cohort, 64, "PTV_RECOMMENDATION_COHORT_INVALID", "cohort");

        if (request.Limit is < 1 or > MaximumLimit)
        {
            throw Invalid(
                "PTV_RECOMMENDATION_LIMIT_INVALID",
                $"Recommendation limit must be between 1 and {MaximumLimit}.");
        }

        if (request.Candidates is null || request.Candidates.Count is < 1 or > MaximumCandidates)
        {
            throw Invalid(
                "PTV_RECOMMENDATION_CANDIDATES_INVALID",
                $"Between 1 and {MaximumCandidates} recommendation candidates are required.");
        }

        ValidateSeed(request.Seed, request.Surface == PtvRecommendationSurface.Radio);
        for (var index = 0; index < request.Candidates.Count; index++)
        {
            ValidateCandidate(request.Candidates[index], index);
        }
    }

    private static void ValidateSeed(PtvRecommendationPolicySeed? seed, bool affinityRequired)
    {
        if (seed is null)
        {
            if (affinityRequired)
            {
                throw Invalid(
                    "PTV_RECOMMENDATION_RADIO_SEED_INVALID",
                    "Radio recommendations require seed artist, album, or genre affinity.");
            }

            return;
        }

        ValidateRequiredText(seed.Id, 128, "PTV_RECOMMENDATION_SEED_INVALID", "seed.id");
        ValidateSignalValues(seed.ArtistIds, "seed.artistIds");
        ValidateSignalValues(seed.Genres, "seed.genres");
        ValidateOptionalText(seed.AlbumId, 128, "PTV_RECOMMENDATION_SEED_INVALID", "seed.albumId");

        if (affinityRequired && !HasSeedAffinity(seed))
        {
            throw Invalid(
                "PTV_RECOMMENDATION_RADIO_SEED_INVALID",
                "Radio recommendations require seed artist, album, or genre affinity.");
        }
    }

    private static void ValidateCandidate(PtvRecommendationPolicyCandidate? candidate, int index)
    {
        if (candidate is null)
        {
            throw Invalid(
                "PTV_RECOMMENDATION_CANDIDATE_INVALID",
                $"Recommendation candidate at index {index} is required.");
        }

        ValidateRequiredText(candidate.Id, 128, "PTV_RECOMMENDATION_CANDIDATE_INVALID", $"candidates[{index}].id");
        ValidateRequiredText(candidate.Title, 512, "PTV_RECOMMENDATION_CANDIDATE_INVALID", $"candidates[{index}].title");
        ValidateRequiredText(candidate.MediaType, 64, "PTV_RECOMMENDATION_CANDIDATE_INVALID", $"candidates[{index}].mediaType");
        ValidateRequiredText(candidate.Source, 128, "PTV_RECOMMENDATION_CANDIDATE_INVALID", $"candidates[{index}].source");
        ValidateSignalValues(candidate.ArtistIds, $"candidates[{index}].artistIds");
        ValidateSignalValues(candidate.Genres, $"candidates[{index}].genres");
        ValidateOptionalText(candidate.AlbumId, 128, "PTV_RECOMMENDATION_CANDIDATE_INVALID", $"candidates[{index}].albumId");

        var classification = candidate.Classification?.Trim().ToLowerInvariant();
        if (classification is not ("affinity" or "discovery" or "mixed"))
        {
            throw Invalid(
                "PTV_RECOMMENDATION_CANDIDATE_INVALID",
                $"candidates[{index}].classification must be affinity, discovery, or mixed.");
        }

        if (!double.IsFinite(candidate.BaseScore) || Math.Abs(candidate.BaseScore) > 1_000_000)
        {
            throw Invalid(
                "PTV_RECOMMENDATION_CANDIDATE_INVALID",
                $"candidates[{index}].baseScore must be a finite, bounded number.");
        }
    }

    private static void ValidateSignalValues(List<string>? values, string field)
    {
        if (values is null || values.Count > MaximumSignalValues)
        {
            throw Invalid(
                "PTV_RECOMMENDATION_SIGNAL_INVALID",
                $"{field} must contain at most {MaximumSignalValues} values.");
        }

        foreach (var value in values)
        {
            ValidateRequiredText(value, 128, "PTV_RECOMMENDATION_SIGNAL_INVALID", field);
        }
    }

    private static void ValidateRequiredText(string? value, int maximumLength, string code, string field)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Trim().Length > maximumLength)
        {
            throw Invalid(code, $"{field} must contain between 1 and {maximumLength} characters.");
        }
    }

    private static void ValidateOptionalText(string? value, int maximumLength, string code, string field)
    {
        if (value is not null && value.Trim().Length > maximumLength)
        {
            throw Invalid(code, $"{field} must not exceed {maximumLength} characters.");
        }
    }

    private static PtvRecommendationPolicyValidationException Invalid(string code, string message) => new(code, message);

    internal static PtvRecommendationPolicyConstraints GetConstraints(PtvRecommendationSurface surface) => surface switch
    {
        PtvRecommendationSurface.Discovery => CreateConstraints(0.8, 0.2, 2, 1, 1, 1),
        PtvRecommendationSurface.Related => CreateConstraints(0.4, 0.6, 3, 2, 2, 2),
        PtvRecommendationSurface.Radio => CreateConstraints(0.75, 0.25, 3, 2, 2, 2),
        PtvRecommendationSurface.MadeForYou => CreateConstraints(0.3, 0.7, 3, 2, 2, 2),
        _ => CreateConstraints(0.3, 0.7, 3, 2, 2, 2)
    };

    private static PtvRecommendationPolicyConstraints CreateConstraints(
        double discoveryTarget,
        double familiarTarget,
        int maxItemsPerArtist,
        int maxItemsPerAlbum,
        int maxConsecutiveArtist,
        int maxConsecutiveAlbum) => new()
        {
            DiscoveryTarget = discoveryTarget,
            FamiliarTarget = familiarTarget,
            MaxConsecutiveAlbum = maxConsecutiveAlbum,
            MaxConsecutiveArtist = maxConsecutiveArtist,
            MaxItemsPerAlbum = maxItemsPerAlbum,
            MaxItemsPerArtist = maxItemsPerArtist
        };

    private static List<PreparedCandidate> PrepareCandidates(
        IEnumerable<PtvRecommendationPolicyCandidate> candidates,
        PtvRecommendationPolicySeed? seed,
        string requestId)
    {
        var bestById = new Dictionary<string, PreparedCandidate>(StringComparer.OrdinalIgnoreCase);

        foreach (var suppliedCandidate in candidates)
        {
            var candidate = NormalizeCandidate(suppliedCandidate);

            var reasons = new List<string>();
            var affinity = SeedAffinity(seed, candidate, reasons);
            var classificationScore = candidate.Classification switch
            {
                "affinity" => 8,
                "discovery" => 4,
                _ => 6
            };
            var canonicalKey = CanonicalCandidate(candidate);
            var prepared = new PreparedCandidate(
                candidate,
                candidate.BaseScore + affinity + classificationScore,
                StableHash($"{requestId}|{canonicalKey}"),
                canonicalKey,
                reasons);

            if (!bestById.TryGetValue(candidate.Id, out var existing)
                || prepared.Score > existing.Score
                || (prepared.Score.Equals(existing.Score)
                    && string.CompareOrdinal(prepared.CanonicalKey, existing.CanonicalKey) < 0))
            {
                bestById[candidate.Id] = prepared;
            }
        }

        return bestById.Values
            .OrderByDescending(candidate => candidate.Score)
            .ThenBy(candidate => candidate.TieBreaker)
            .ThenBy(candidate => candidate.CanonicalKey, StringComparer.Ordinal)
            .ToList();
    }

    private static List<PreparedCandidate> Sequence(
        List<PreparedCandidate> candidates,
        PtvRecommendationPolicyConstraints constraints,
        PtvRecommendationSurface surface,
        int limit)
    {
        var remaining = new List<PreparedCandidate>(candidates);
        var selected = new List<PreparedCandidate>();
        var artistCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var albumCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var discoveryCount = 0;

        while (selected.Count < limit && remaining.Count > 0)
        {
            var desiredDiscoveryByPosition = (int)Math.Round(
                (selected.Count + 1) * constraints.DiscoveryTarget,
                MidpointRounding.AwayFromZero);
            var preferDiscovery = discoveryCount < desiredDiscoveryByPosition;
            var next = FindNext(
                remaining,
                selected,
                artistCounts,
                albumCounts,
                constraints,
                preferDiscovery,
                surface)
                ?? FindNext(
                    remaining,
                    selected,
                    artistCounts,
                    albumCounts,
                    constraints,
                    !preferDiscovery,
                    surface);
            if (next is null) break;

            remaining.Remove(next);
            next.TransitionScore = TransitionScore(selected.LastOrDefault()?.Candidate, next.Candidate, next.Reasons);
            selected.Add(next);
            IncrementCounts(next.Candidate, artistCounts, albumCounts);
            if (IsDiscovery(next.Candidate)) discoveryCount++;
        }

        return selected;
    }

    private static PreparedCandidate? FindNext(
        IEnumerable<PreparedCandidate> candidates,
        IReadOnlyList<PreparedCandidate> selected,
        IReadOnlyDictionary<string, int> artistCounts,
        IReadOnlyDictionary<string, int> albumCounts,
        PtvRecommendationPolicyConstraints constraints,
        bool preferDiscovery,
        PtvRecommendationSurface surface)
    {
        return candidates
            .Where(candidate => IsDiscovery(candidate.Candidate) == preferDiscovery)
            .Where(candidate => RespectsCaps(candidate.Candidate, artistCounts, albumCounts, constraints))
            .Where(candidate => !CreatesRun(candidate.Candidate, selected, constraints))
            .OrderByDescending(candidate => candidate.Score + PreviewTransitionScore(selected.LastOrDefault()?.Candidate, candidate.Candidate))
            .ThenBy(candidate => candidate.TieBreaker)
            .FirstOrDefault(candidate => surface != PtvRecommendationSurface.Radio || candidate.Reasons.Count > 0);
    }

    private static bool RespectsCaps(
        PtvRecommendationPolicyCandidate candidate,
        IReadOnlyDictionary<string, int> artistCounts,
        IReadOnlyDictionary<string, int> albumCounts,
        PtvRecommendationPolicyConstraints constraints)
    {
        if (candidate.ArtistIds.Any(artist => artistCounts.GetValueOrDefault(artist) >= constraints.MaxItemsPerArtist))
        {
            return false;
        }

        return string.IsNullOrWhiteSpace(candidate.AlbumId)
            || albumCounts.GetValueOrDefault(candidate.AlbumId) < constraints.MaxItemsPerAlbum;
    }

    private static bool CreatesRun(
        PtvRecommendationPolicyCandidate candidate,
        IReadOnlyList<PreparedCandidate> selected,
        PtvRecommendationPolicyConstraints constraints)
    {
        var artistRun = selected.TakeLast(constraints.MaxConsecutiveArtist).ToArray();
        if (artistRun.Length == constraints.MaxConsecutiveArtist
            && candidate.ArtistIds.Count > 0
            && artistRun.All(previous => SharesValue(candidate.ArtistIds, previous.Candidate.ArtistIds)))
        {
            return true;
        }

        var albumRun = selected.TakeLast(constraints.MaxConsecutiveAlbum).ToArray();
        return albumRun.Length == constraints.MaxConsecutiveAlbum
            && !string.IsNullOrWhiteSpace(candidate.AlbumId)
            && albumRun.All(previous => string.Equals(
                candidate.AlbumId,
                previous.Candidate.AlbumId,
                StringComparison.OrdinalIgnoreCase));
    }

    private static double SeedAffinity(
        PtvRecommendationPolicySeed? seed,
        PtvRecommendationPolicyCandidate candidate,
        ICollection<string> reasons)
    {
        if (seed is null) return 0;
        var affinity = 0d;
        if (SharesValue(seed.ArtistIds, candidate.ArtistIds))
        {
            affinity += 48;
            reasons.Add("shared-artist");
        }

        if (!string.IsNullOrWhiteSpace(seed.AlbumId)
            && string.Equals(seed.AlbumId, candidate.AlbumId, StringComparison.OrdinalIgnoreCase))
        {
            affinity += 38;
            reasons.Add("shared-album");
        }

        if (SharesValue(seed.Genres, candidate.Genres))
        {
            affinity += 24;
            reasons.Add("shared-genre");
        }

        return affinity;
    }

    private static double TransitionScore(
        PtvRecommendationPolicyCandidate? previous,
        PtvRecommendationPolicyCandidate candidate,
        ICollection<string> reasons)
    {
        var score = PreviewTransitionScore(previous, candidate);
        if (previous is null) return score;
        if (SharesValue(previous.Genres, candidate.Genres)) reasons.Add("smooth-genre-transition");
        if (!SharesValue(previous.ArtistIds, candidate.ArtistIds)) reasons.Add("artist-diversity");
        return score;
    }

    private static double PreviewTransitionScore(
        PtvRecommendationPolicyCandidate? previous,
        PtvRecommendationPolicyCandidate candidate)
    {
        if (previous is null) return 0;
        var score = SharesValue(previous.Genres, candidate.Genres) ? 10 : -4;
        if (SharesValue(previous.ArtistIds, candidate.ArtistIds)) score -= 18;
        if (!string.IsNullOrWhiteSpace(previous.AlbumId)
            && string.Equals(previous.AlbumId, candidate.AlbumId, StringComparison.OrdinalIgnoreCase))
        {
            score -= 24;
        }

        return score;
    }

    private static void IncrementCounts(
        PtvRecommendationPolicyCandidate candidate,
        IDictionary<string, int> artistCounts,
        IDictionary<string, int> albumCounts)
    {
        foreach (var artist in candidate.ArtistIds)
        {
            artistCounts.TryGetValue(artist, out var artistCount);
            artistCounts[artist] = artistCount + 1;
        }

        if (!string.IsNullOrWhiteSpace(candidate.AlbumId))
        {
            albumCounts.TryGetValue(candidate.AlbumId, out var albumCount);
            albumCounts[candidate.AlbumId] = albumCount + 1;
        }
    }

    internal static bool IsDiscovery(PtvRecommendationPolicyCandidate candidate) =>
        candidate.Classification.Equals("discovery", StringComparison.OrdinalIgnoreCase);

    private static bool HasSeedAffinity(PtvRecommendationPolicySeed? seed) => seed is not null
        && (
            !string.IsNullOrWhiteSpace(seed.AlbumId)
            || seed.ArtistIds.Any(value => !string.IsNullOrWhiteSpace(value))
            || seed.Genres.Any(value => !string.IsNullOrWhiteSpace(value))
        );

    private static bool SharesValue(IEnumerable<string> left, IEnumerable<string> right)
    {
        var values = new HashSet<string>(left, StringComparer.OrdinalIgnoreCase);
        return values.Count > 0 && right.Any(values.Contains);
    }

    private static PtvRecommendationPolicySeed? NormalizeSeed(PtvRecommendationPolicySeed? seed) => seed is null
        ? null
        : new PtvRecommendationPolicySeed
        {
            AlbumId = NormalizeOptional(seed.AlbumId),
            ArtistIds = NormalizeValues(seed.ArtistIds),
            Genres = NormalizeValues(seed.Genres),
            Id = seed.Id.Trim()
        };

    private static PtvRecommendationPolicyCandidate NormalizeCandidate(PtvRecommendationPolicyCandidate candidate) => new()
    {
        AlbumId = NormalizeOptional(candidate.AlbumId),
        ArtistIds = NormalizeValues(candidate.ArtistIds),
        BaseScore = candidate.BaseScore,
        Classification = NormalizeClassification(candidate.Classification),
        Familiar = candidate.Familiar,
        Genres = NormalizeValues(candidate.Genres),
        Id = candidate.Id.Trim(),
        MediaType = candidate.MediaType.Trim(),
        Source = candidate.Source.Trim(),
        Title = candidate.Title.Trim()
    };

    private static List<string> NormalizeValues(IEnumerable<string>? values) => (values ?? [])
        .Select(value => value?.Trim())
        .Where(value => !string.IsNullOrWhiteSpace(value))
        .Select(value => value!)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
        .ThenBy(value => value, StringComparer.Ordinal)
        .ToList();

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string NormalizeClassification(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "affinity" => "affinity",
        "discovery" => "discovery",
        _ => "mixed"
    };

    private static string DeriveRequestId(
        PtvRecommendationPolicyRequest request,
        PtvRecommendationPolicySeed? seed)
    {
        var canonical = new StringBuilder();
        AppendToken(canonical, CurrentContractVersion);
        AppendToken(canonical, CurrentPolicyVersion);
        AppendToken(canonical, request.AlgorithmId?.Trim());
        AppendToken(canonical, request.Cohort?.Trim());
        AppendToken(canonical, request.Surface.ToString());
        AppendToken(canonical, request.ServerId.Trim());
        AppendToken(canonical, request.UserId.Trim());
        AppendToken(canonical, request.Limit.ToString(CultureInfo.InvariantCulture));
        AppendToken(canonical, CanonicalSeed(seed));

        foreach (var candidate in request.Candidates
                     .Select(NormalizeCandidate)
                     .Select(CanonicalCandidate)
                     .OrderBy(value => value, StringComparer.Ordinal))
        {
            AppendToken(canonical, candidate);
        }

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(canonical.ToString()));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string CanonicalSeed(PtvRecommendationPolicySeed? seed)
    {
        if (seed is null) return string.Empty;
        var canonical = new StringBuilder();
        AppendToken(canonical, seed.Id);
        AppendToken(canonical, seed.AlbumId);
        AppendValues(canonical, seed.ArtistIds);
        AppendValues(canonical, seed.Genres);
        return canonical.ToString();
    }

    private static string CanonicalCandidate(PtvRecommendationPolicyCandidate candidate)
    {
        var canonical = new StringBuilder();
        AppendToken(canonical, candidate.Id);
        AppendToken(canonical, candidate.Title);
        AppendToken(canonical, candidate.MediaType);
        AppendToken(canonical, candidate.Source);
        AppendToken(canonical, candidate.Classification);
        AppendToken(canonical, candidate.BaseScore.ToString("R", CultureInfo.InvariantCulture));
        AppendToken(canonical, candidate.AlbumId);
        AppendToken(canonical, candidate.Familiar ? "1" : "0");
        AppendValues(canonical, candidate.ArtistIds);
        AppendValues(canonical, candidate.Genres);
        return canonical.ToString();
    }

    private static void AppendValues(StringBuilder canonical, IEnumerable<string> values)
    {
        foreach (var value in values)
        {
            AppendToken(canonical, value);
        }

        AppendToken(canonical, null);
    }

    private static void AppendToken(StringBuilder canonical, string? value)
    {
        if (value is null)
        {
            canonical.Append("-1:|");
            return;
        }

        canonical
            .Append(value.Length.ToString(CultureInfo.InvariantCulture))
            .Append(':')
            .Append(value)
            .Append('|');
    }

    private static uint StableHash(string value)
    {
        var hash = 2166136261u;
        foreach (var character in value)
        {
            hash ^= character;
            hash *= 16777619u;
        }

        return hash;
    }

    private sealed class PreparedCandidate(
        PtvRecommendationPolicyCandidate candidate,
        double score,
        uint tieBreaker,
        string canonicalKey,
        List<string> reasons)
    {
        public PtvRecommendationPolicyCandidate Candidate { get; } = candidate;

        public string CanonicalKey { get; } = canonicalKey;

        public List<string> Reasons { get; } = reasons;

        public double Score { get; } = score;

        public uint TieBreaker { get; } = tieBreaker;

        public double TransitionScore { get; set; }
    }
}
