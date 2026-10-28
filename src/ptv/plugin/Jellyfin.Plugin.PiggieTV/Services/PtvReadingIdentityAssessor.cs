using Jellyfin.Plugin.PiggieTV.Models;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Independent identity review; never modifies ranking.</summary>
public sealed class PtvReadingIdentityAssessor
{
    /// <summary>Builds separate evidence from safe base names and archive-specific ComicInfo only.</summary>
    public static PtvReadingIdentitySources CreateSources(PtvMetadataSearchContext context,
        PtvReadingLocalMetadataInspectionResult inspection, PtvReadingIdentityRecord currentItem)
    {
        var parser = new PtvReadingMetadataParser();
        var filename = parser.Parse(Text(context.FileName, 512) ?? string.Empty, new() { MediaClassOverride = PtvReadingMediaClass.Comic });
        var folder = Text(context.FolderName, 512) ?? string.Empty;
        var folderRun = Regex.Match(folder, @"^(?<series>.+?)(?:\s+\((?<year>(?:19|20)\d{2})\)|\s+(?<year>(?:19|20)\d{2}))$",
            RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));
        var publication = Regex.Match(context.FileName ?? string.Empty,
            @"#\s*[0-9]+(?:\.[0-9]+)?\s+\((?<year>(?:19|20)\d{2})\)(?:\.[A-Za-z0-9]+)?$",
            RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));
        var comic = inspection.ComicInfo.State == PtvComicInfoArchiveInspectionState.Inspected ? inspection.ComicInfo.Metadata : null;
        DateTimeOffset? date = null;
        if (comic?.Year is >= 1 and <= 9999 && comic.Month is >= 1 and <= 12 && comic.Day >= 1
            && comic.Day <= DateTime.DaysInMonth(comic.Year.Value, comic.Month.Value))
            date = new DateTimeOffset(comic.Year.Value, comic.Month.Value, comic.Day.Value, 0, 0, 0, TimeSpan.Zero);
        return BoundSources(new()
        {
            ArchiveState = inspection.ComicInfo.State, ArchiveReasonCode = inspection.ComicInfo.ReasonCode,
            FileName = new()
            {
                HasRedactedIdentity = PtvReadingIdentityText.IsUnsafe(context.FileName),
                SeriesTitle = filename.SeriesTitle, IssueNumber = filename.IssueNumber,
                VolumeOrRunLabel = filename.VolumeNumber,
                RunEvidenceKind = filename.VolumeNumber is null ? PtvReadingRunEvidenceKind.Unknown : PtvReadingRunEvidenceKind.ExplicitVolume,
                IssuePublicationYear = publication.Success ? int.Parse(publication.Groups["year"].Value, CultureInfo.InvariantCulture) : null
            },
            ImmediateFolder = new()
            {
                HasRedactedIdentity = PtvReadingIdentityText.IsUnsafe(context.FolderName),
                SeriesTitle = folderRun.Success ? folderRun.Groups["series"].Value : null,
                VolumeOrRunLabel = folderRun.Success ? folderRun.Groups["year"].Value : null,
                RunEvidenceKind = folderRun.Success ? PtvReadingRunEvidenceKind.ExplicitRun : PtvReadingRunEvidenceKind.Unknown
            },
            ComicInfo = new()
            {
                SeriesTitle = comic?.SeriesTitle, IssueNumber = comic?.IssueNumber, VolumeOrRunLabel = comic?.VolumeNumber,
                IssuePublicationYear = comic?.Year, IssuePublicationDate = date
            },
            CurrentItem = currentItem
        });
    }

    /// <summary>Only established existing-item GCD key mappings receive known scopes.</summary>
    public static List<PtvReadingScopedProviderId> ExistingProviderIds(IEnumerable<KeyValuePair<string, string>> values)
        => values.Take(32).Select(pair => new PtvReadingScopedProviderId
        {
            Namespace = pair.Key.Equals("GCD", StringComparison.OrdinalIgnoreCase) ? "GCD"
                : pair.Key.Equals("GCDSeries", StringComparison.OrdinalIgnoreCase) ? "GCDSeries" : pair.Key,
            Scope = pair.Key.Equals("GCD", StringComparison.OrdinalIgnoreCase) ? PtvReadingProviderIdScope.Issue
                : pair.Key.Equals("GCDSeries", StringComparison.OrdinalIgnoreCase) ? PtvReadingProviderIdScope.Series : PtvReadingProviderIdScope.Unknown,
            Value = pair.Value
        }).ToList();

    public PtvReadingIdentityAssessment Assess(PtvReadingIdentitySources sources, PtvNormalizedMetadataCandidate candidate)
    {
        ArgumentNullException.ThrowIfNull(sources);
        ArgumentNullException.ThrowIfNull(candidate);
        var bounded = BoundSources(sources);
        var provider = BoundRecord(new()
        {
            HasRedactedIdentity = candidate.HasRedactedIdentity || PtvReadingIdentityText.IsUnsafe(candidate.Title),
            SeriesTitle = candidate.SeriesTitle,
            IssueNumber = candidate.IssueNumber,
            VolumeOrRunLabel = candidate.RunEvidenceKind == PtvReadingRunEvidenceKind.ExplicitRun
                ? candidate.StartYear?.ToString(CultureInfo.InvariantCulture) : candidate.VolumeNumber,
            RunEvidenceKind = candidate.RunEvidenceKind,
            IssuePublicationYear = candidate.IssuePublicationEvidence == PtvReadingIdentityEvidenceSource.Provider ? candidate.IssuePublicationYear : null,
            IssuePublicationDate = candidate.IssuePublicationEvidence == PtvReadingIdentityEvidenceSource.Provider ? candidate.IssuePublicationDate : null,
            ProviderIds = candidate.IdentityProviderIds
        }, PtvReadingIdentitySource.Provider);
        var result = new PtvReadingIdentityAssessment { Sources = bounded, Candidate = provider };
        void Add(string code, string field, PtvReadingIdentityRecord left, string? lv,
            PtvReadingIdentityRecord right, string? rv, bool conflict = false, bool uncertain = false)
            => result.Findings.Add(new()
            {
                Code = code, Field = field, LeftSource = left.Source, LeftValue = lv,
                RightSource = right.Source, RightValue = rv, IsConflict = conflict, IsMaterialUncertainty = uncertain
            });

        var embedded = bounded.ComicInfo;
        foreach (var record in new[] { bounded.FileName, bounded.ImmediateFolder, embedded, bounded.CurrentItem, provider })
            if (record.HasRedactedIdentity)
                Add("IDENTITY_TEXT_REDACTED", "Identity", record, null, provider, null, uncertain: true);
        if (bounded.ArchiveState is PtvComicInfoArchiveInspectionState.Unverified or PtvComicInfoArchiveInspectionState.NotAttempted)
            Add("ARCHIVE_IDENTITY_UNVERIFIED", "Archive", embedded, bounded.ArchiveReasonCode, provider, null, uncertain: true);
        if (bounded.ArchiveState == PtvComicInfoArchiveInspectionState.Inspected)
        {
            foreach (var other in new[] { bounded.FileName, bounded.ImmediateFolder, bounded.CurrentItem, provider })
            {
                Compare("SERIES_TITLE", "SeriesTitle", embedded.SeriesTitle, other.SeriesTitle, PtvReadingMetadataParser.NormalizeTitle);
                Compare("ISSUE_NUMBER", "IssueNumber", embedded.IssueNumber, other.IssueNumber,
                    value => PtvReadingMetadataParser.NormalizeNumber(value) ?? value.Trim().ToUpperInvariant());
                void Compare(string code, string field, string? left, string? right, Func<string, string> normalize)
                {
                    if (left is not null && right is not null)
                    {
                        if (!string.Equals(normalize(left), normalize(right), StringComparison.Ordinal))
                            Add(code + "_CONFLICT", field, embedded, left, other, right, conflict: true);
                    }
                    else if (other.Source == PtvReadingIdentitySource.Provider)
                        Add(code + "_UNDETERMINED", field, embedded, left, other, right, uncertain: true);
                }

                var kind = embedded.RunEvidenceKind;
                if (embedded.VolumeOrRunLabel is not null && kind != PtvReadingRunEvidenceKind.Unknown
                    && kind == other.RunEvidenceKind && other.VolumeOrRunLabel is not null
                    && !string.Equals(embedded.VolumeOrRunLabel, other.VolumeOrRunLabel, StringComparison.OrdinalIgnoreCase))
                    Add(kind == PtvReadingRunEvidenceKind.ExplicitRun ? "RUN_LABEL_CONFLICT" : "VOLUME_LABEL_CONFLICT",
                        "VolumeOrRunLabel", embedded, embedded.VolumeOrRunLabel, other, other.VolumeOrRunLabel, conflict: true);

                if (embedded.IssuePublicationYear is not null && other.IssuePublicationYear is not null
                    && embedded.IssuePublicationYear != other.IssuePublicationYear)
                    Add("ISSUE_PUBLICATION_YEAR_CONFLICT", "IssuePublicationYear", embedded,
                        embedded.IssuePublicationYear.Value.ToString(CultureInfo.InvariantCulture), other,
                        other.IssuePublicationYear.Value.ToString(CultureInfo.InvariantCulture), conflict: true);
                else if (embedded.IssuePublicationDate is not null && other.IssuePublicationDate is not null
                    && embedded.IssuePublicationDate.Value.Date != other.IssuePublicationDate.Value.Date)
                    Add("ISSUE_PUBLICATION_DATE_CONFLICT", "IssuePublicationDate", embedded,
                        embedded.IssuePublicationDate.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), other,
                        other.IssuePublicationDate.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), conflict: true);
            }
            if (embedded.VolumeOrRunLabel is not null && embedded.RunEvidenceKind == PtvReadingRunEvidenceKind.ExplicitRun
                && (provider.RunEvidenceKind != PtvReadingRunEvidenceKind.ExplicitRun || provider.VolumeOrRunLabel is null))
                Add("RUN_IDENTITY_UNDETERMINED", "VolumeOrRunLabel", embedded, embedded.VolumeOrRunLabel, provider, provider.VolumeOrRunLabel, uncertain: true);
        }

        foreach (var group in provider.ProviderIds.GroupBy(id => id.Namespace, StringComparer.Ordinal))
        {
            var ids = group.ToArray();
            var id = ids[0];
            var current = bounded.CurrentItem.ProviderIds.Where(value => value.Namespace == id.Namespace).ToArray();
            if (ids.Length != 1 || current.Length > 1)
            {
                Add("PROVIDER_ID_CONTRADICTORY", id.Namespace, bounded.CurrentItem, null, provider, null, uncertain: true);
                continue;
            }
            var exact = IsAllowlisted(id) && current.Length == 1 && IsAllowlisted(current[0]) && current[0].Scope == id.Scope;
            if (exact)
            {
                var agree = current[0].Value == id.Value;
                Add(agree ? "PROVIDER_ID_AGREEMENT" : "PROVIDER_ID_CONFLICT", id.Namespace,
                    bounded.CurrentItem, current[0].Value, provider, id.Value, conflict: !agree);
            }
            else
                Add("PROVIDER_ID_UNDETERMINED", id.Namespace, bounded.CurrentItem, current.FirstOrDefault()?.Value,
                    provider, id.Value, uncertain: !IsAllowlisted(id));
        }
        if (candidate.Provider.Equals("comic-vine", StringComparison.OrdinalIgnoreCase) && provider.ProviderIds.Count == 0)
            Add("PROVIDER_ID_UNDETERMINED", "ComicVine", bounded.CurrentItem, null, provider, null, uncertain: true);
        result.RequiresConflictAcknowledgment = result.Findings.Any(f => f.IsConflict);
        result.RequiresUnverifiedAcknowledgment = result.Findings.Any(f => f.IsMaterialUncertainty);
        // Fixed property order, sorted IDs and fixed comparison order are the canonical format (v1).
        // Hash the entire displayed assessment with the digest still empty, including both flags.
        result.AssessmentDigest = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(result)));
        return result;
    }

    internal static PtvReadingIdentitySources BoundSources(PtvReadingIdentitySources source) => new()
    {
        ArchiveState = source.ArchiveState,
        ArchiveReasonCode = source.ArchiveReasonCode is { Length: <= 128 } reason && Regex.IsMatch(reason, "^[A-Z0-9_]+$") ? reason : null,
        FileName = BoundRecord(source.FileName, PtvReadingIdentitySource.FileName),
        ImmediateFolder = BoundRecord(source.ImmediateFolder, PtvReadingIdentitySource.ImmediateFolder),
        ComicInfo = BoundRecord(source.ComicInfo, PtvReadingIdentitySource.ComicInfo),
        CurrentItem = BoundRecord(source.CurrentItem, PtvReadingIdentitySource.CurrentItem)
    };

    private static PtvReadingIdentityRecord BoundRecord(PtvReadingIdentityRecord source, PtvReadingIdentitySource label)
    {
        var volume = Text(source.VolumeOrRunLabel, 32);
        return new()
        {
            HasRedactedIdentity = source.HasRedactedIdentity || new[] { source.SeriesTitle, source.IssueNumber, source.VolumeOrRunLabel }
                .Any(PtvReadingIdentityText.IsUnsafe),
            Source = label, SeriesTitle = Text(source.SeriesTitle, 512), IssueNumber = Text(source.IssueNumber, 32),
            VolumeOrRunLabel = volume,
            RunEvidenceKind = label == PtvReadingIdentitySource.ComicInfo && volume is not null
                ? IsRunYear(volume) ? PtvReadingRunEvidenceKind.ExplicitRun : PtvReadingRunEvidenceKind.ExplicitVolume
                : source.RunEvidenceKind,
            IssuePublicationYear = source.IssuePublicationYear is >= 1 and <= 9999 ? source.IssuePublicationYear : source.IssuePublicationDate?.Year,
            IssuePublicationDate = source.IssuePublicationDate,
            ProviderIds = label is PtvReadingIdentitySource.Provider or PtvReadingIdentitySource.CurrentItem
                ? source.ProviderIds.Take(32).Select(id => id.ToBoundedTransportModel())
                    .OrderBy(id => id.Namespace, StringComparer.Ordinal).ThenBy(id => id.Scope).ThenBy(id => id.Value, StringComparer.Ordinal)
                    .DistinctBy(id => (id.Namespace, id.Scope, id.Value)).ToList() : []
        };
    }

    internal static bool IsRunYear(string value) => value.Length == 4 && int.TryParse(value, out var year) && year is >= 1900 and <= 2099;
    private static bool IsAllowlisted(PtvReadingScopedProviderId id) =>
        ((id.Namespace == "GCD" && id.Scope == PtvReadingProviderIdScope.Issue)
            || (id.Namespace == "GCDSeries" && id.Scope == PtvReadingProviderIdScope.Series))
        && id.Value.Length is > 0 and <= 32 && id.Value.All(c => c is >= '0' and <= '9');
    private static string? Text(string? value, int limit) => PtvReadingIdentityText.Bound(value, limit);
}
