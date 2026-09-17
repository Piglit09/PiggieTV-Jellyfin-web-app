using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Deterministically ranks normalized Reading candidates instead of trusting provider order.</summary>
public sealed class PtvReadingMetadataScorer
{
    /// <summary>Scores one normalized candidate against a local structured query.</summary>
    public PtvReadingCandidateScore Score(
        PtvStructuredMetadataQuery query,
        PtvNormalizedMetadataCandidate candidate)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(candidate);

        candidate = candidate.ToBoundedTransportModel();

        var reasons = new List<PtvReadingMatchScoreReason>();
        var score = 0;
        var hardConflict = false;
        var identityRejected = false;
        var exactProviderId = ApplyProviderIdEvidence(query, candidate, reasons, ref score, ref hardConflict);

        ApplyTitleEvidence(query, candidate, reasons, ref score);
        ApplyLocalIdentityEvidence(query, reasons, ref score, ref hardConflict);
        ApplyEditionEvidence(query, candidate, reasons, ref score, ref hardConflict, ref identityRejected);
        var providerIssueNumber = query.MediaClass == PtvReadingMediaClass.Comic
            && candidate.IssueNumberEvidence == PtvReadingIdentityEvidenceSource.Unknown
                ? null
                : candidate.IssueNumber;
        ApplyNumberEvidence(
            query.IssueNumber,
            providerIssueNumber,
            "issue",
            PtvReadingMatchReasonCodes.IssueMatch,
            PtvReadingMatchReasonCodes.IssueMismatch,
            PtvReadingMatchReasonCodes.IssueMissing,
            matchImpact: 45,
            mismatchImpact: -70,
            missingImpact: -12,
            reasons,
            ref score,
            ref hardConflict,
            ref identityRejected,
            rejectOnMismatch: true);
        ApplyNumberEvidence(
            query.VolumeNumber,
            candidate.VolumeNumber,
            "volume",
            PtvReadingMatchReasonCodes.VolumeMatch,
            PtvReadingMatchReasonCodes.VolumeMismatch,
            PtvReadingMatchReasonCodes.VolumeMissing,
            matchImpact: 20,
            mismatchImpact: -30,
            missingImpact: -4,
            reasons,
            ref score,
            ref hardConflict,
            ref identityRejected,
            rejectOnMismatch: false);
        ApplyNumberEvidence(
            query.ChapterNumber,
            candidate.ChapterNumber,
            "chapter",
            PtvReadingMatchReasonCodes.ChapterMatch,
            PtvReadingMatchReasonCodes.ChapterMismatch,
            PtvReadingMatchReasonCodes.ChapterMissing,
            matchImpact: 15,
            mismatchImpact: -25,
            missingImpact: -3,
            reasons,
            ref score,
            ref hardConflict,
            ref identityRejected,
            rejectOnMismatch: false);
        if (query.MediaClass == PtvReadingMediaClass.Comic)
        {
            ApplyComicYearEvidence(query, candidate, reasons, ref score, ref hardConflict, ref identityRejected);
        }
        else
        {
            ApplyLegacyYearEvidence(query, candidate, reasons, ref score, ref hardConflict);
        }
        ApplyMediaClassEvidence(query, candidate, reasons, ref score, ref hardConflict);
        ApplyAuthorEvidence(query, candidate, reasons, ref score);
        var comicIdentityIncomplete = query.MediaClass == PtvReadingMediaClass.Comic
            && reasons.Any(reason => reason.Code is PtvReadingMatchReasonCodes.SeriesTitleMissing
                or PtvReadingMatchReasonCodes.IssueMissing
                or PtvReadingMatchReasonCodes.EditionMissing
                or PtvReadingMatchReasonCodes.SeriesRunYearMissing);

        if (identityRejected)
        {
            score = Math.Min(score, 39);
            hardConflict = true;
        }
        else if (exactProviderId)
        {
            score = 100;
            hardConflict = false;
        }
        else if (comicIdentityIncomplete)
        {
            // A provider result lacking the requested issue/run evidence remains reviewable, but
            // cannot be promoted as a strong automatic suggestion from title similarity alone.
            score = Math.Min(score, 69);
        }
        else if (hardConflict)
        {
            score = Math.Min(score, 69);
        }

        score = Math.Clamp(score, 0, 100);
        return new PtvReadingCandidateScore
        {
            Score = score,
            Confidence = score switch
            {
                _ when identityRejected => "rejected",
                >= 90 => "excellent",
                >= 75 => "strong",
                >= 55 => "possible",
                _ => "weak"
            },
            HasHardConflict = hardConflict,
            IsRejected = identityRejected,
            Reasons = reasons
        };
    }

    /// <summary>Scores and returns candidates in a deterministic order independent of provider response order.</summary>
    public IReadOnlyList<PtvRankedMetadataCandidate> Rank(
        PtvStructuredMetadataQuery query,
        IEnumerable<PtvNormalizedMetadataCandidate> candidates)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(candidates);

        return candidates
            .Select(candidate =>
            {
                var bounded = candidate.ToBoundedTransportModel();
                var match = Score(query, bounded);
                bounded.Score = match.Score;
                bounded.ScoreReasons = match.Reasons;
                return new PtvRankedMetadataCandidate { Candidate = bounded, Match = match };
            })
            .OrderByDescending(result => result.Match.Score)
            .ThenBy(result => result.Match.HasHardConflict)
            .ThenBy(result => PtvReadingMetadataParser.NormalizeTitle(result.Candidate.Title), StringComparer.Ordinal)
            .ThenBy(result => result.Candidate.Provider, StringComparer.OrdinalIgnoreCase)
            .ThenBy(result => result.Candidate.ProviderId, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static bool ApplyProviderIdEvidence(
        PtvStructuredMetadataQuery query,
        PtvNormalizedMetadataCandidate candidate,
        ICollection<PtvReadingMatchScoreReason> reasons,
        ref int score,
        ref bool hardConflict)
    {
        var candidateIds = new Dictionary<string, string>(candidate.ExternalIds ?? [], StringComparer.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(candidate.Provider) && !string.IsNullOrWhiteSpace(candidate.ProviderId))
        {
            candidateIds[candidate.Provider] = candidate.ProviderId;
        }

        if (query.ProviderId is not null)
        {
            var matchingId = FindProviderId(candidateIds, query.ProviderId.Provider);
            if (matchingId is not null && string.Equals(matchingId, query.ProviderId.Id, StringComparison.OrdinalIgnoreCase))
            {
                AddReason(reasons, PtvReadingMatchReasonCodes.ProviderIdMatch, 100, "The verified provider ID matches exactly.", query.ProviderId.Provider);
                score += 100;
                return true;
            }

            if (matchingId is not null)
            {
                AddReason(reasons, PtvReadingMatchReasonCodes.ProviderIdMismatch, -60, "The provider ID contradicts the requested identity.", query.ProviderId.Provider);
                score -= 60;
                hardConflict = true;
            }
        }

        foreach (var existingId in query.ExistingProviderIds ?? [])
        {
            var matchingId = FindProviderId(candidateIds, existingId.Key);
            if (matchingId is null)
            {
                continue;
            }

            if (string.Equals(matchingId, existingId.Value, StringComparison.OrdinalIgnoreCase))
            {
                AddReason(reasons, PtvReadingMatchReasonCodes.ProviderIdMatch, 100, "An existing Jellyfin provider ID matches exactly.", existingId.Key);
                score += 100;
                return true;
            }

            AddReason(reasons, PtvReadingMatchReasonCodes.ProviderIdMismatch, -60, "An existing Jellyfin provider ID points to another record.", existingId.Key);
            score -= 60;
            hardConflict = true;
        }

        return false;
    }

    private static void ApplyTitleEvidence(
        PtvStructuredMetadataQuery query,
        PtvNormalizedMetadataCandidate candidate,
        ICollection<PtvReadingMatchScoreReason> reasons,
        ref int score)
    {
        var queryPrimary = PtvReadingMetadataParser.NormalizeTitle(query.SeriesTitle ?? query.CleanedTitle);
        var queryTitles = new[] { query.SeriesTitle, query.CleanedTitle }
            .Concat(query.AlternateTitles ?? [])
            .Select(PtvReadingMetadataParser.NormalizeTitle)
            .Where(value => value.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var isComic = query.MediaClass == PtvReadingMediaClass.Comic;
        if (isComic
            && (candidate.SeriesTitleEvidence != PtvReadingIdentityEvidenceSource.Provider
                || string.IsNullOrWhiteSpace(candidate.SeriesTitle)))
        {
            AddReason(
                reasons,
                PtvReadingMatchReasonCodes.SeriesTitleMissing,
                -12,
                "The provider did not identify an authoritative parent series title.",
                query.SeriesTitle);
            score -= 12;
            return;
        }

        var candidatePrimary = (isComic
                ? new[] { candidate.SeriesTitle }
                : new[] { candidate.SeriesTitle, candidate.Title })
            .Select(PtvReadingMetadataParser.NormalizeTitle)
            .Where(value => value.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var candidateAlternates = (candidate.AlternateTitles ?? [])
            .Concat((candidate.LocalizedTitles ?? []).Values)
            .Select(PtvReadingMetadataParser.NormalizeTitle)
            .Where(value => value.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        if (queryPrimary.Length > 0 && candidatePrimary.Contains(queryPrimary, StringComparer.Ordinal))
        {
            AddReason(reasons, PtvReadingMatchReasonCodes.ExactTitle, 40, "The normalized series title matches exactly.", query.SeriesTitle ?? query.CleanedTitle);
            score += 40;
            return;
        }

        var exactAlternate = queryTitles.Any(queryTitle => candidateAlternates.Contains(queryTitle, StringComparer.Ordinal))
            || candidatePrimary.Any(candidateTitle => (query.AlternateTitles ?? [])
                .Select(PtvReadingMetadataParser.NormalizeTitle)
                .Contains(candidateTitle, StringComparer.Ordinal));
        if (exactAlternate)
        {
            AddReason(reasons, PtvReadingMatchReasonCodes.ExactAlternateTitle, 38, "A localized or alternate title matches exactly.");
            score += 38;
            return;
        }

        var allCandidateTitles = candidatePrimary.Concat(candidateAlternates).Distinct(StringComparer.Ordinal).ToList();
        var similarity = queryTitles.Count == 0 || allCandidateTitles.Count == 0
            ? 0
            : queryTitles.Max(queryTitle => allCandidateTitles.Max(candidateTitle => TitleSimilarity(queryTitle, candidateTitle)));

        if (similarity >= 0.85)
        {
            AddReason(reasons, PtvReadingMatchReasonCodes.StrongTitle, 30, "The normalized titles are a strong fuzzy match.", similarity.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture));
            score += 30;
        }
        else if (similarity >= 0.6)
        {
            AddReason(reasons, PtvReadingMatchReasonCodes.PartialTitle, 15, "The titles are a partial match.", similarity.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture));
            score += 15;
        }
        else
        {
            AddReason(reasons, PtvReadingMatchReasonCodes.TitleMismatch, -45, "The candidate series title does not match the local title.");
            score -= 45;
        }
    }

    private static void ApplyLocalIdentityEvidence(
        PtvStructuredMetadataQuery query,
        ICollection<PtvReadingMatchScoreReason> reasons,
        ref int score,
        ref bool hardConflict)
    {
        if (query.FolderCorroboratesSeriesTitle)
        {
            AddReason(
                reasons,
                PtvReadingMatchReasonCodes.FolderSeriesCorroboration,
                4,
                "The folder corroborates the parsed series title.",
                query.SeriesTitle);
            score += 4;
        }

        if (query.FolderCorroboratesSeriesStartYear)
        {
            AddReason(
                reasons,
                PtvReadingMatchReasonCodes.FolderRunCorroboration,
                4,
                "The folder corroborates the parsed comic run year.",
                query.SeriesStartYear?.ToString(System.Globalization.CultureInfo.InvariantCulture));
            score += 4;
        }

        foreach (var conflict in (query.IdentityConflicts ?? [])
            .Where(conflict => conflict is not null)
            .GroupBy(conflict => conflict.Field, StringComparer.Ordinal)
            .Select(group => group.First())
            .Take(2))
        {
            AddReason(
                reasons,
                PtvReadingMatchReasonCodes.LocalIdentityConflict,
                -20,
                $"The filename and folder disagree about the parsed {FriendlyIdentityField(conflict.Field)}.",
                conflict.Field);
            score -= 20;
            hardConflict = true;
        }
    }

    private static void ApplyEditionEvidence(
        PtvStructuredMetadataQuery query,
        PtvNormalizedMetadataCandidate candidate,
        ICollection<PtvReadingMatchScoreReason> reasons,
        ref int score,
        ref bool hardConflict,
        ref bool identityRejected)
    {
        var localExplicit = query.EditionKindEvidence != PtvReadingIdentityEvidenceSource.Unknown
            && query.EditionKind != PtvReadingEditionKind.Standard;
        var providerExplicit = candidate.EditionKindEvidence == PtvReadingIdentityEvidenceSource.Provider;
        // Provider edition data is useful only when the local filename/folder supplied an
        // explicit edition constraint. A regular local issue has Standard/Unknown as a
        // neutral default, so an Annual/Special provider result must not be rejected here.
        if (!localExplicit)
        {
            return;
        }

        if (localExplicit && !providerExplicit)
        {
            AddReason(
                reasons,
                PtvReadingMatchReasonCodes.EditionMissing,
                -12,
                "The provider did not identify the comic edition type.",
                query.EditionKind.ToString());
            score -= 12;
            return;
        }

        if (localExplicit && query.EditionKind == candidate.EditionKind)
        {
            AddReason(
                reasons,
                PtvReadingMatchReasonCodes.EditionMatch,
                20,
                "The comic edition type matches.",
                query.EditionKind.ToString());
            score += 20;
            return;
        }

        AddReason(
            reasons,
            PtvReadingMatchReasonCodes.EditionMismatch,
            -60,
            "The provider edition type contradicts the local comic edition.",
            $"local {query.EditionKind}; provider {candidate.EditionKind}");
        score -= 60;
        hardConflict = true;
        identityRejected = true;
    }

    private static string FriendlyIdentityField(string field) => field switch
    {
        "seriesTitle" => "series title",
        "seriesStartYear" => "series run year",
        _ => "identity"
    };

    private static void ApplyNumberEvidence(
        string? localNumber,
        string? providerNumber,
        string label,
        string matchCode,
        string mismatchCode,
        string missingCode,
        int matchImpact,
        int mismatchImpact,
        int missingImpact,
        ICollection<PtvReadingMatchScoreReason> reasons,
        ref int score,
        ref bool hardConflict,
        ref bool identityRejected,
        bool rejectOnMismatch)
    {
        var local = PtvReadingMetadataParser.NormalizeNumber(localNumber, allowRomanNumeral: true);
        if (local is null)
        {
            return;
        }

        var provider = PtvReadingMetadataParser.NormalizeNumber(providerNumber, allowRomanNumeral: true);
        if (provider is null)
        {
            AddReason(reasons, missingCode, missingImpact, $"The provider did not identify a {label} number.", local);
            score += missingImpact;
            return;
        }

        if (string.Equals(local, provider, StringComparison.Ordinal))
        {
            AddReason(reasons, matchCode, matchImpact, $"The {label} number matches.", local);
            score += matchImpact;
            return;
        }

        AddReason(reasons, mismatchCode, mismatchImpact, $"The provider {label} number contradicts the local {label}.", $"local {local}; provider {provider}");
        score += mismatchImpact;
        hardConflict = true;
        identityRejected |= rejectOnMismatch;
    }

    private static void ApplyComicYearEvidence(
        PtvStructuredMetadataQuery query,
        PtvNormalizedMetadataCandidate candidate,
        ICollection<PtvReadingMatchScoreReason> reasons,
        ref int score,
        ref bool hardConflict,
        ref bool identityRejected)
    {
        // Existing clients used Year for comic-run searches. Preserve that compatibility while
        // keeping issue publication evidence in its own field for all new callers.
        var localRunYear = query.SeriesStartYear ?? query.Year;
        var candidateRunYear = candidate.SeriesStartYearEvidence == PtvReadingIdentityEvidenceSource.Unknown
            ? null
            : candidate.StartYear;
        if (localRunYear is not null)
        {
            if (candidateRunYear is null)
            {
                AddReason(
                    reasons,
                    PtvReadingMatchReasonCodes.SeriesRunYearMissing,
                    -6,
                    "The provider did not identify the comic series run year.",
                    localRunYear.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
                score -= 6;
            }
            else if (candidateRunYear == localRunYear)
            {
                AddReason(
                    reasons,
                    PtvReadingMatchReasonCodes.SeriesRunYearMatch,
                    25,
                    "The comic series run year matches.",
                    localRunYear.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
                score += 25;
            }
            else
            {
                AddReason(
                    reasons,
                    PtvReadingMatchReasonCodes.SeriesRunYearMismatch,
                    -35,
                    "The provider identifies a different comic series run.",
                    $"local {localRunYear}; provider {candidateRunYear}");
                score -= 35;
                hardConflict = true;
                identityRejected = true;
            }
        }

        var localPublicationYear = query.IssuePublicationYear ?? query.IssuePublicationDate?.Year;
        var candidatePublicationYear = candidate.IssuePublicationYear
            ?? candidate.IssuePublicationDate?.Year
            ?? candidate.Year;
        if (localPublicationYear is null || candidatePublicationYear is null)
        {
            return;
        }

        var difference = Math.Abs(localPublicationYear.Value - candidatePublicationYear.Value);
        if (difference == 0)
        {
            AddReason(
                reasons,
                PtvReadingMatchReasonCodes.IssuePublicationYearMatch,
                10,
                "The issue publication year matches.",
                localPublicationYear.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
            score += 10;
        }
        else if (difference == 1)
        {
            AddReason(
                reasons,
                PtvReadingMatchReasonCodes.IssuePublicationYearNear,
                4,
                "The issue publication year differs by one year.",
                candidatePublicationYear.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
            score += 4;
        }
        else
        {
            AddReason(
                reasons,
                PtvReadingMatchReasonCodes.IssuePublicationYearMismatch,
                -10,
                "The issue publication year does not match.",
                $"local {localPublicationYear}; provider {candidatePublicationYear}");
            score -= 10;
            hardConflict = true;
        }
    }

    private static void ApplyLegacyYearEvidence(
        PtvStructuredMetadataQuery query,
        PtvNormalizedMetadataCandidate candidate,
        ICollection<PtvReadingMatchScoreReason> reasons,
        ref int score,
        ref bool hardConflict)
    {
        if (query.Year is null)
        {
            return;
        }

        var candidateYear = candidate.Year ?? candidate.StartYear;
        if (candidateYear is null)
        {
            return;
        }

        var difference = Math.Abs(query.Year.Value - candidateYear.Value);
        if (difference == 0)
        {
            AddReason(reasons, PtvReadingMatchReasonCodes.YearMatch, 15, "The publication year matches.", query.Year.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
            score += 15;
        }
        else if (difference == 1)
        {
            AddReason(reasons, PtvReadingMatchReasonCodes.YearNear, 8, "The publication year differs by one year.", candidateYear.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
            score += 8;
        }
        else
        {
            AddReason(reasons, PtvReadingMatchReasonCodes.YearMismatch, -15, "The publication year indicates a different edition or series run.", $"local {query.Year}; provider {candidateYear}");
            score -= 15;
            hardConflict = true;
        }
    }

    private static void ApplyMediaClassEvidence(
        PtvStructuredMetadataQuery query,
        PtvNormalizedMetadataCandidate candidate,
        ICollection<PtvReadingMatchScoreReason> reasons,
        ref int score,
        ref bool hardConflict)
    {
        if (query.MediaClass == PtvReadingMediaClass.Unknown || candidate.MediaClass == PtvReadingMediaClass.Unknown)
        {
            return;
        }

        if (query.MediaClass == candidate.MediaClass)
        {
            AddReason(reasons, PtvReadingMatchReasonCodes.MediaClassMatch, 15, "The media class matches.", query.MediaClass.ToString());
            score += 15;
        }
        else if (AreCompatibleMediaClasses(query.MediaClass, candidate.MediaClass))
        {
            AddReason(reasons, PtvReadingMatchReasonCodes.MediaClassCompatible, 8, "The provider media class is compatible with the local edition.", candidate.MediaClass.ToString());
            score += 8;
        }
        else
        {
            AddReason(reasons, PtvReadingMatchReasonCodes.MediaClassMismatch, -25, "The provider returned a conflicting media class.", candidate.MediaClass.ToString());
            score -= 25;
            hardConflict = true;
        }
    }

    private static void ApplyAuthorEvidence(
        PtvStructuredMetadataQuery query,
        PtvNormalizedMetadataCandidate candidate,
        ICollection<PtvReadingMatchScoreReason> reasons,
        ref int score)
    {
        var queryAuthor = PtvReadingMetadataParser.NormalizeTitle(query.Author);
        if (queryAuthor.Length == 0)
        {
            return;
        }

        if ((candidate.Authors ?? [])
            .Concat(candidate.Artists ?? [])
            .Select(credit => PtvReadingMetadataParser.NormalizeTitle(credit.Name))
            .Any(author => author == queryAuthor || TitleSimilarity(author, queryAuthor) >= 0.9))
        {
            AddReason(reasons, PtvReadingMatchReasonCodes.AuthorMatch, 10, "A creator name matches the local metadata.", query.Author);
            score += 10;
        }
    }

    private static bool AreCompatibleMediaClasses(PtvReadingMediaClass left, PtvReadingMediaClass right)
    {
        var leftManga = left is PtvReadingMediaClass.Manga or PtvReadingMediaClass.Manhwa or PtvReadingMediaClass.Manhua;
        var rightManga = right is PtvReadingMediaClass.Manga or PtvReadingMediaClass.Manhwa or PtvReadingMediaClass.Manhua;
        return (leftManga && rightManga)
            || (left is PtvReadingMediaClass.Comic or PtvReadingMediaClass.GraphicNovel
                && right is PtvReadingMediaClass.Comic or PtvReadingMediaClass.GraphicNovel)
            || (left is PtvReadingMediaClass.Book or PtvReadingMediaClass.GraphicNovel
                && right is PtvReadingMediaClass.Book or PtvReadingMediaClass.GraphicNovel);
    }

    private static string? FindProviderId(IReadOnlyDictionary<string, string> identifiers, string provider)
    {
        var normalizedProvider = NormalizeProvider(provider);
        return identifiers.FirstOrDefault(pair => NormalizeProvider(pair.Key) == normalizedProvider).Value;
    }

    private static string NormalizeProvider(string? provider)
    {
        return new string((provider ?? string.Empty).Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
    }

    private static double TitleSimilarity(string left, string right)
    {
        if (left == right)
        {
            return 1;
        }

        if (left.Length == 0 || right.Length == 0)
        {
            return 0;
        }

        var leftTokens = left.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);
        var rightTokens = right.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);
        var tokenDice = 2d * leftTokens.Intersect(rightTokens, StringComparer.Ordinal).Count() / (leftTokens.Count + rightTokens.Count);

        var maximumLength = Math.Max(left.Length, right.Length);
        var editSimilarity = 1d - ((double)LevenshteinDistance(left, right) / maximumLength);
        return Math.Max(tokenDice, editSimilarity);
    }

    private static int LevenshteinDistance(string left, string right)
    {
        var previous = Enumerable.Range(0, right.Length + 1).ToArray();
        var current = new int[right.Length + 1];

        for (var leftIndex = 1; leftIndex <= left.Length; leftIndex++)
        {
            current[0] = leftIndex;
            for (var rightIndex = 1; rightIndex <= right.Length; rightIndex++)
            {
                var substitution = previous[rightIndex - 1] + (left[leftIndex - 1] == right[rightIndex - 1] ? 0 : 1);
                current[rightIndex] = Math.Min(Math.Min(current[rightIndex - 1] + 1, previous[rightIndex] + 1), substitution);
            }

            (previous, current) = (current, previous);
        }

        return previous[right.Length];
    }

    private static void AddReason(
        ICollection<PtvReadingMatchScoreReason> reasons,
        string code,
        int impact,
        string message,
        string? evidence = null)
    {
        reasons.Add(new PtvReadingMatchScoreReason
        {
            Code = code,
            Impact = impact,
            Message = message,
            Evidence = evidence
        });
    }
}
