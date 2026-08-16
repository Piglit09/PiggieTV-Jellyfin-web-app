using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Deterministically parses local Reading identity without contacting a metadata provider.</summary>
public sealed class PtvReadingMetadataParser
{
    private static readonly TimeSpan RegexTimeout = TimeSpan.FromMilliseconds(100);

    private static readonly Regex BracketGroupPattern = CreateRegex(@"[\(\[](?<value>[^\)\]]{1,96})[\)\]]");
    private static readonly Regex VolumePattern = CreateRegex(@"(?<![\p{L}\p{N}])(?:vol(?:ume)?|book)\s*[\.\-:#]?\s*(?<number>\d+(?:\.\d+)?|[ivx]+)(?![\p{L}\p{N}])");
    private static readonly Regex CompactVolumePattern = CreateRegex(@"(?<![\p{L}\p{N}])v\s*(?<number>\d+(?:\.\d+)?|[ivx]+)(?![\p{L}\p{N}])");
    private static readonly Regex ChapterPattern = CreateRegex(@"(?<![\p{L}\p{N}])(?:ch(?:apter)?|chap)\s*[\.\-:#]?\s*(?<number>\d+(?:\.\d+)?|[ivx]+)(?![\p{L}\p{N}])");
    private static readonly Regex ExplicitIssuePattern = CreateRegex(@"(?<![\p{L}\p{N}])(?:issue\s*#?|no\.?\s*|#)\s*(?<number>\d+(?:\.\d+)?|[ivx]+)(?![\p{L}\p{N}])");
    private static readonly Regex TrailingNumberPattern = CreateRegex(@"^(?<series>.+?[\p{L}\p{M}])\s+(?<number>\d{1,3}(?:\.\d+)?)$");
    private static readonly Regex StandaloneNumberPattern = CreateRegex(@"^#?\s*(?<number>\d{1,3}(?:\.\d+)?)$");
    private static readonly Regex FolderRunPattern = CreateRegex(@"^(?<series>.+?[\p{L}\p{M}])(?:\s*[-_.]\s*|\s+|\s*[\(\[]\s*)(?<year>(?:18|19|20|21)\d{2})\s*[\)\]]?$");
    private static readonly Regex EditionPattern = CreateRegex(@"(?<![\p{L}\p{N}])(?<edition>annual|special|ova|oad|omnibus|tpb|trade\s+paperback|collected\s+edition)(?![\p{L}\p{N}])");
    private static readonly Regex SeparatorPattern = CreateRegex(@"[\s_]+", RegexOptions.CultureInvariant);
    private static readonly Regex ComparisonPunctuationPattern = CreateRegex(@"[^\p{L}\p{M}\p{N}']+", RegexOptions.CultureInvariant);
    private static readonly Regex ComparisonWhitespacePattern = CreateRegex(@"\s+", RegexOptions.CultureInvariant);

    private static readonly HashSet<string> MediaExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".cbz", ".cbr", ".cb7", ".cbt", ".pdf", ".epub", ".mobi", ".azw", ".azw3"
    };

    private static readonly HashSet<string> NoiseTokens = new(StringComparer.OrdinalIgnoreCase)
    {
        "digital", "digital-empire", "zone-empire", "empire", "minutemen", "fixed", "repack",
        "web", "web-dl", "webrip", "scan", "retail"
    };

    /// <summary>Parses a file/title and combines it with bounded, existing Jellyfin context.</summary>
    public PtvStructuredMetadataQuery Parse(string? fileNameOrTitle, PtvMetadataSearchContext? context = null)
    {
        context ??= new PtvMetadataSearchContext();
        var safeFileName = GetSafeFileName(fileNameOrTitle ?? context.FileName ?? context.ExistingTitle ?? string.Empty);
        var rawTitle = StripKnownMediaExtension(safeFileName).Trim();
        var working = rawTitle;
        var ignoredTokens = new List<string>();
        int? parsedYear = null;
        var folderIdentity = ParseComicFolderIdentity(context.FolderName);

        working = BracketGroupPattern.Replace(working, match =>
        {
            var value = match.Groups["value"].Value.Trim();
            if (TryParseYear(value, out var year))
            {
                parsedYear ??= year;
                ignoredTokens.Add(value);
                return " ";
            }

            if (IsNoiseToken(value))
            {
                ignoredTokens.Add(value);
                return " ";
            }

            return match.Value;
        });

        working = RemoveStandaloneNoise(working, ignoredTokens);
        working = NormalizeSeparatorsForParsing(working);

        var editionKind = DetectEditionKind(working);
        working = EditionPattern.Replace(working, " ");
        working = CleanupSeriesTitle(working);

        string? issueNumber = null;
        string? volumeNumber = null;
        string? chapterNumber = null;
        var hadExplicitIssue = false;
        var hadExplicitVolume = false;
        var hadExplicitChapter = false;

        var chapterMatch = ChapterPattern.Match(working);
        if (chapterMatch.Success)
        {
            chapterNumber = NormalizeNumber(chapterMatch.Groups["number"].Value, allowRomanNumeral: true);
            hadExplicitChapter = chapterNumber is not null;
            working = RemoveMatch(working, chapterMatch);
        }

        var volumeMatch = VolumePattern.Match(working);
        if (!volumeMatch.Success)
        {
            volumeMatch = CompactVolumePattern.Match(working);
        }

        if (volumeMatch.Success)
        {
            volumeNumber = NormalizeNumber(volumeMatch.Groups["number"].Value, allowRomanNumeral: true);
            hadExplicitVolume = volumeNumber is not null;
            working = RemoveMatch(working, volumeMatch);
        }

        var issueMatch = ExplicitIssuePattern.Match(working);
        if (issueMatch.Success)
        {
            issueNumber = NormalizeNumber(issueMatch.Groups["number"].Value, allowRomanNumeral: true);
            hadExplicitIssue = issueNumber is not null;
            working = RemoveMatch(working, issueMatch);
        }

        working = CleanupSeriesTitle(working);

        // Western-comic filenames also commonly place an unbracketed run year immediately
        // before or after an explicit issue marker (for example, "Deadpool 2022 #9").
        // The explicit issue marker is the contextual guard that keeps ordinary numeric book
        // titles from being reinterpreted as comic runs.
        if (parsedYear is null && hadExplicitIssue)
        {
            var inlineRun = FolderRunPattern.Match(working);
            if (inlineRun.Success && TryParseYear(inlineRun.Groups["year"].Value, out var inlineRunYear))
            {
                parsedYear = inlineRunYear;
                working = CleanupSeriesTitle(inlineRun.Groups["series"].Value);
            }
        }

        var contextualClass = DetectContextMediaClass(context);
        if (contextualClass == PtvReadingMediaClass.Unknown
            && folderIdentity.SeriesTitle is not null
            && folderIdentity.SeriesStartYear is not null
            && IsComicArchive(safeFileName))
        {
            contextualClass = PtvReadingMediaClass.Comic;
        }

        if (issueNumber is null && volumeNumber is null && chapterNumber is null)
        {
            var trailingMatch = TrailingNumberPattern.Match(working);
            if (trailingMatch.Success)
            {
                var rawNumber = trailingMatch.Groups["number"].Value;
                var normalizedNumber = NormalizeNumber(rawNumber);
                var hasStrongBareIssueEvidence = parsedYear is not null || ignoredTokens.Count > 0;

                if (normalizedNumber is not null && contextualClass == PtvReadingMediaClass.Comic)
                {
                    issueNumber = normalizedNumber;
                    working = trailingMatch.Groups["series"].Value;
                }
                else if (normalizedNumber is not null && IsMangaFamily(contextualClass))
                {
                    volumeNumber = normalizedNumber;
                    working = trailingMatch.Groups["series"].Value;
                }
                else if (normalizedNumber is not null && hasStrongBareIssueEvidence && HasLeadingZero(rawNumber))
                {
                    issueNumber = normalizedNumber;
                    hadExplicitIssue = true;
                    working = trailingMatch.Groups["series"].Value;
                }
            }

            if (issueNumber is null && contextualClass == PtvReadingMediaClass.Comic)
            {
                var standaloneMatch = StandaloneNumberPattern.Match(working);
                if (standaloneMatch.Success)
                {
                    issueNumber = NormalizeNumber(standaloneMatch.Groups["number"].Value);
                    hadExplicitIssue = issueNumber is not null;
                    if (issueNumber is not null)
                    {
                        working = string.Empty;
                    }
                }
            }
        }

        var filenameSeriesTitle = CleanupSeriesTitle(working);
        var seriesTitle = filenameSeriesTitle;
        var seriesTitleEvidence = filenameSeriesTitle.Length > 0
            ? PtvReadingIdentityEvidenceSource.FileName
            : PtvReadingIdentityEvidenceSource.Unknown;
        if (seriesTitle.Length == 0 && folderIdentity.SeriesTitle is not null)
        {
            seriesTitle = folderIdentity.SeriesTitle;
            seriesTitleEvidence = PtvReadingIdentityEvidenceSource.Folder;
        }

        if (seriesTitle.Length == 0)
        {
            var fallbackSeriesTitle = CleanupSeriesTitle(context.ExistingTitle ?? rawTitle);
            // A provider display label such as "#009" is an issue label, not a parent
            // series identity. Requiring a letter avoids promoting that number to a
            // provider-backed series title while preserving legitimate titles such as 1984.
            if (fallbackSeriesTitle.Any(char.IsLetter))
            {
                seriesTitle = fallbackSeriesTitle;
                seriesTitleEvidence = PtvReadingIdentityEvidenceSource.ExistingMetadata;
            }
        }

        var classification = Classify(
            context,
            seriesTitle,
            issueNumber,
            volumeNumber,
            chapterNumber,
            editionKind,
            hadExplicitIssue,
            hadExplicitVolume,
            hadExplicitChapter,
            IsComicArchive(safeFileName));

        var isComic = classification.MediaClass == PtvReadingMediaClass.Comic;
        var seriesStartYear = isComic ? parsedYear ?? folderIdentity.SeriesStartYear : null;
        var seriesStartYearEvidence = !isComic || seriesStartYear is null
            ? PtvReadingIdentityEvidenceSource.Unknown
            : parsedYear is not null
                ? PtvReadingIdentityEvidenceSource.FileName
                : PtvReadingIdentityEvidenceSource.Folder;
        var folderCorroboratesSeriesTitle = filenameSeriesTitle.Length > 0
            && folderIdentity.SeriesTitle is not null
            && string.Equals(NormalizeTitle(filenameSeriesTitle), NormalizeTitle(folderIdentity.SeriesTitle), StringComparison.Ordinal);
        var folderCorroboratesSeriesStartYear = isComic
            && parsedYear is not null
            && folderIdentity.SeriesStartYear == parsedYear;
        var identityConflicts = BuildIdentityConflicts(
            filenameSeriesTitle,
            parsedYear,
            folderIdentity,
            isComic);
        var issuePublicationDate = isComic ? context.PremiereDate : null;
        var issuePublicationYear = isComic
            ? issuePublicationDate?.Year ?? context.ProductionYear
            : null;

        var alternateTitles = new[] { context.ExistingTitle, context.ExistingOriginalTitle }
            .Concat(context.LocalAlternateTitles ?? [])
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(PtvReadingMetadataLimits.MaximumCollectionItems)
            .ToList();

        return new PtvStructuredMetadataQuery
        {
            RawTitle = Bound(rawTitle, PtvReadingMetadataLimits.MaximumTitleLength),
            RawFileName = Bound(safeFileName, PtvReadingMetadataLimits.MaximumTitleLength),
            CleanedTitle = Bound(seriesTitle, PtvReadingMetadataLimits.MaximumTitleLength),
            SeriesTitle = BoundNullable(seriesTitle, PtvReadingMetadataLimits.MaximumTitleLength),
            IssueNumber = issueNumber,
            VolumeNumber = volumeNumber,
            ChapterNumber = chapterNumber,
            Year = parsedYear ?? (isComic ? folderIdentity.SeriesStartYear : null) ?? context.ProductionYear,
            SeriesStartYear = seriesStartYear,
            IssuePublicationYear = issuePublicationYear,
            IssuePublicationDate = issuePublicationDate,
            IssuePublicationEvidence = issuePublicationYear is null && issuePublicationDate is null
                ? PtvReadingIdentityEvidenceSource.Unknown
                : PtvReadingIdentityEvidenceSource.ExistingMetadata,
            SeriesTitleEvidence = seriesTitleEvidence,
            IssueNumberEvidence = issueNumber is null
                ? PtvReadingIdentityEvidenceSource.Unknown
                : PtvReadingIdentityEvidenceSource.FileName,
            SeriesStartYearEvidence = seriesStartYearEvidence,
            FolderCorroboratesSeriesTitle = folderCorroboratesSeriesTitle,
            FolderCorroboratesSeriesStartYear = folderCorroboratesSeriesStartYear,
            IdentityConflicts = identityConflicts,
            Author = BoundNullable(context.Author, PtvReadingMetadataLimits.MaximumTitleLength),
            Isbn = NormalizeIsbn(context.Isbn),
            OriginalLanguage = BoundNullable(context.OriginalLanguage, 64),
            MediaClass = classification.MediaClass,
            EditionKind = editionKind,
            EditionKindEvidence = editionKind == PtvReadingEditionKind.Standard
                ? PtvReadingIdentityEvidenceSource.Unknown
                : PtvReadingIdentityEvidenceSource.FileName,
            ExistingProviderIds = BoundProviderIds(context.ExistingProviderIds ?? []),
            AlternateTitles = alternateTitles,
            IgnoredFilenameTokens = ignoredTokens
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(PtvReadingMetadataLimits.MaximumCollectionItems)
                .ToList(),
            Classification = classification
        };
    }

    /// <summary>Normalizes titles for comparison while preserving Unicode letters and combining marks.</summary>
    public static string NormalizeTitle(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var normalized = value.Normalize(NormalizationForm.FormKC)
            .Replace('\u2018', '\'')
            .Replace('\u2019', '\'')
            .Replace('\u02BC', '\'')
            .Replace('\uFF07', '\'')
            .Replace('\u2010', '-')
            .Replace('\u2011', '-')
            .Replace('\u2012', '-')
            .Replace('\u2013', '-')
            .Replace('\u2014', '-')
            .Replace('\u2212', '-')
            .ToLowerInvariant();

        normalized = ComparisonPunctuationPattern.Replace(normalized, " ");
        return ComparisonWhitespacePattern.Replace(normalized, " ").Trim();
    }

    /// <summary>Normalizes an issue, volume, or chapter number while preserving decimal identity.</summary>
    public static string? NormalizeNumber(string? value, bool allowRomanNumeral = false)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        trimmed = Regex.Replace(
            trimmed,
            @"^(?:issue|number|no\.?|volume|vol\.?|book|chapter|ch\.?)\s*#?\s*",
            string.Empty,
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
            RegexTimeout).Trim().TrimStart('#').Trim();

        if (allowRomanNumeral && TryParseRomanNumeral(trimmed, out var romanNumber))
        {
            return romanNumber.ToString(CultureInfo.InvariantCulture);
        }

        if (!decimal.TryParse(trimmed, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var numeric)
            || numeric < 0)
        {
            return null;
        }

        return numeric.ToString("0.############################", CultureInfo.InvariantCulture);
    }

    /// <summary>Converts Roman numerals I through X only when called from an explicit number context.</summary>
    public static bool TryParseRomanNumeral(string? value, out int number)
    {
        number = (value ?? string.Empty).Trim().ToUpperInvariant() switch
        {
            "I" => 1,
            "II" => 2,
            "III" => 3,
            "IV" => 4,
            "V" => 5,
            "VI" => 6,
            "VII" => 7,
            "VIII" => 8,
            "IX" => 9,
            "X" => 10,
            _ => 0
        };

        return number > 0;
    }

    private static PtvReadingMediaClassification Classify(
        PtvMetadataSearchContext context,
        string seriesTitle,
        string? issueNumber,
        string? volumeNumber,
        string? chapterNumber,
        PtvReadingEditionKind editionKind,
        bool hadExplicitIssue,
        bool hadExplicitVolume,
        bool hadExplicitChapter,
        bool hasComicArchive)
    {
        var reasons = new List<string>();
        if (context.MediaClassOverride is { } overridden)
        {
            return Classification(overridden, 1, "Administrator supplied a media classification override.");
        }

        var fromContext = DetectContextMediaClass(context);
        if (fromContext != PtvReadingMediaClass.Unknown)
        {
            reasons.Add("Existing local metadata or provider identity identifies the media class.");
            return new PtvReadingMediaClassification { MediaClass = fromContext, Confidence = 0.98, Reasons = reasons };
        }

        if (!string.IsNullOrWhiteSpace(context.Isbn))
        {
            return Classification(PtvReadingMediaClass.Book, 0.98, "A local ISBN identifies a book workflow.");
        }

        if (editionKind is PtvReadingEditionKind.Omnibus or PtvReadingEditionKind.TradePaperback)
        {
            return Classification(PtvReadingMediaClass.GraphicNovel, 0.9, "A collected-edition filename marker was detected.");
        }

        var contextText = string.Join(' ', new[]
        {
            seriesTitle,
            context.ExistingTitle,
            context.ExistingOriginalTitle,
            context.FolderName,
            context.OriginalLanguage
        }.Where(value => !string.IsNullOrWhiteSpace(value))).ToLowerInvariant();

        if (contextText.Contains("manhwa", StringComparison.Ordinal)
            || contextText.Contains("webtoon", StringComparison.Ordinal)
            || string.Equals(context.OriginalLanguage, "ko", StringComparison.OrdinalIgnoreCase))
        {
            return Classification(PtvReadingMediaClass.Manhwa, 0.88, "Korean/manhwa local metadata was detected.");
        }

        if (contextText.Contains("manhua", StringComparison.Ordinal)
            || (context.OriginalLanguage?.StartsWith("zh", StringComparison.OrdinalIgnoreCase) == true && (hadExplicitVolume || hadExplicitChapter)))
        {
            return Classification(PtvReadingMediaClass.Manhua, 0.88, "Chinese/manhua local metadata was detected.");
        }

        if (contextText.Contains("manga", StringComparison.Ordinal)
            || string.Equals(context.OriginalLanguage, "ja", StringComparison.OrdinalIgnoreCase)
            || ((hadExplicitVolume || hadExplicitChapter) && ContainsCjk(seriesTitle)))
        {
            return Classification(PtvReadingMediaClass.Manga, 0.9, "Manga-specific local metadata was detected.");
        }

        if (editionKind is PtvReadingEditionKind.Annual or PtvReadingEditionKind.Special || hadExplicitIssue)
        {
            return Classification(PtvReadingMediaClass.Comic, 0.9, "An issue or western-comic edition marker was detected.");
        }

        if (hadExplicitVolume || hadExplicitChapter)
        {
            return Classification(PtvReadingMediaClass.Manga, 0.72, "A volume or chapter naming pattern was detected.");
        }

        if (issueNumber is not null && (context.ProductionYear is not null || hasComicArchive))
        {
            return Classification(PtvReadingMediaClass.Comic, 0.7, "A padded local issue identity was detected with comic context.");
        }

        if (volumeNumber is not null || chapterNumber is not null)
        {
            return Classification(PtvReadingMediaClass.Manga, 0.65, "A local volume or chapter identity was detected.");
        }

        return Classification(PtvReadingMediaClass.Unknown, 0.25, "The filename alone does not identify a reliable media class.");
    }

    private static PtvReadingMediaClass DetectContextMediaClass(PtvMetadataSearchContext context)
    {
        if (context.MediaClassOverride is { } overridden)
        {
            return overridden;
        }

        foreach (var provider in (context.ExistingProviderIds ?? []).Keys)
        {
            var normalized = NormalizeTitle(provider).Replace(" ", string.Empty, StringComparison.Ordinal);
            if (normalized.Contains("comicvine", StringComparison.Ordinal))
            {
                return PtvReadingMediaClass.Comic;
            }

            if (normalized is "anilist" or "mangadex" or "myanimelist" or "mal")
            {
                return PtvReadingMediaClass.Manga;
            }

            if (normalized is "googlebooks" or "openlibrary" or "isbn")
            {
                return PtvReadingMediaClass.Book;
            }
        }

        return PtvReadingMediaClass.Unknown;
    }

    /// <summary>Returns an explicitly named Reading edition without treating absence as provider evidence.</summary>
    public static PtvReadingEditionKind DetectEditionKind(string? value)
    {
        var match = EditionPattern.Match(value ?? string.Empty);
        if (!match.Success)
        {
            return PtvReadingEditionKind.Standard;
        }

        return match.Groups["edition"].Value.Trim().ToLowerInvariant() switch
        {
            "annual" => PtvReadingEditionKind.Annual,
            "special" or "ova" or "oad" => PtvReadingEditionKind.Special,
            "omnibus" => PtvReadingEditionKind.Omnibus,
            "tpb" or "trade paperback" or "collected edition" => PtvReadingEditionKind.TradePaperback,
            _ => PtvReadingEditionKind.Standard
        };
    }

    private static PtvReadingMediaClassification Classification(PtvReadingMediaClass mediaClass, double confidence, string reason)
    {
        return new PtvReadingMediaClassification
        {
            MediaClass = mediaClass,
            Confidence = Math.Clamp(confidence, 0, 1),
            Reasons = [reason]
        };
    }

    private static string RemoveStandaloneNoise(string value, ICollection<string> ignoredTokens)
    {
        var working = value;
        foreach (var noise in NoiseTokens.OrderByDescending(token => token.Length))
        {
            var pattern = CreateRegex($@"(?<![\p{{L}}\p{{N}}]){Regex.Escape(noise).Replace("\\-", "[- ]", StringComparison.Ordinal)}(?![\p{{L}}\p{{N}}])");
            working = pattern.Replace(working, match =>
            {
                if (string.Equals(CleanupSeriesTitle(working), match.Value, StringComparison.OrdinalIgnoreCase))
                {
                    return match.Value;
                }

                ignoredTokens.Add(match.Value.Trim());
                return " ";
            });
        }

        return working;
    }

    private static bool IsNoiseToken(string value)
    {
        var normalized = value.Trim().Replace(' ', '-');
        return NoiseTokens.Contains(normalized);
    }

    private static bool TryParseYear(string value, out int year)
    {
        return int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out year)
            && year is >= 1800 and <= 2199;
    }

    private static bool ContainsCjk(string value)
    {
        return value.EnumerateRunes().Any(rune =>
            rune.Value is >= 0x3040 and <= 0x30FF
                or >= 0x3400 and <= 0x9FFF
                or >= 0xAC00 and <= 0xD7AF);
    }

    private static bool HasLeadingZero(string value)
    {
        var integerPart = value.Split('.', 2)[0];
        return integerPart.Length > 1 && integerPart[0] == '0';
    }

    private static bool IsMangaFamily(PtvReadingMediaClass mediaClass)
    {
        return mediaClass is PtvReadingMediaClass.Manga or PtvReadingMediaClass.Manhwa or PtvReadingMediaClass.Manhua;
    }

    private static FolderComicIdentity ParseComicFolderIdentity(string? folderName)
    {
        var safeFolderName = GetSafeFileName(folderName ?? string.Empty);
        var working = NormalizeSeparatorsForParsing(safeFolderName);
        var match = FolderRunPattern.Match(working);
        if (!match.Success || !TryParseYear(match.Groups["year"].Value, out var year))
        {
            return new FolderComicIdentity();
        }

        var seriesTitle = CleanupSeriesTitle(match.Groups["series"].Value);
        return seriesTitle.Length == 0
            ? new FolderComicIdentity()
            : new FolderComicIdentity
            {
                SeriesTitle = Bound(seriesTitle, PtvReadingMetadataLimits.MaximumTitleLength),
                SeriesStartYear = year
            };
    }

    private static List<PtvReadingIdentityConflict> BuildIdentityConflicts(
        string filenameSeriesTitle,
        int? filenameSeriesStartYear,
        FolderComicIdentity folder,
        bool isComic)
    {
        var conflicts = new List<PtvReadingIdentityConflict>();
        if (!isComic)
        {
            return conflicts;
        }

        if (filenameSeriesTitle.Length > 0
            && folder.SeriesTitle is not null
            && !string.Equals(NormalizeTitle(filenameSeriesTitle), NormalizeTitle(folder.SeriesTitle), StringComparison.Ordinal))
        {
            conflicts.Add(new PtvReadingIdentityConflict
            {
                Field = "seriesTitle",
                PreferredSource = PtvReadingIdentityEvidenceSource.FileName,
                PreferredValue = Bound(filenameSeriesTitle, PtvReadingMetadataLimits.MaximumTitleLength),
                ConflictingSource = PtvReadingIdentityEvidenceSource.Folder,
                ConflictingValue = Bound(folder.SeriesTitle, PtvReadingMetadataLimits.MaximumTitleLength)
            });
        }

        if (filenameSeriesStartYear is not null
            && folder.SeriesStartYear is not null
            && filenameSeriesStartYear != folder.SeriesStartYear)
        {
            conflicts.Add(new PtvReadingIdentityConflict
            {
                Field = "seriesStartYear",
                PreferredSource = PtvReadingIdentityEvidenceSource.FileName,
                PreferredValue = filenameSeriesStartYear.Value.ToString(CultureInfo.InvariantCulture),
                ConflictingSource = PtvReadingIdentityEvidenceSource.Folder,
                ConflictingValue = folder.SeriesStartYear.Value.ToString(CultureInfo.InvariantCulture)
            });
        }

        return conflicts;
    }

    private static bool IsComicArchive(string fileName)
    {
        var extension = Path.GetExtension(fileName);
        return extension.Equals(".cbz", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".cbr", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".cb7", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".cbt", StringComparison.OrdinalIgnoreCase);
    }

    private static string RemoveMatch(string value, Match match)
    {
        return CleanupSeriesTitle(string.Concat(value.AsSpan(0, match.Index), " ", value.AsSpan(match.Index + match.Length)));
    }

    private static string NormalizeSeparatorsForParsing(string value)
    {
        return SeparatorPattern.Replace(value.Replace('\u00A0', ' '), " ").Trim();
    }

    private static string CleanupSeriesTitle(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var cleaned = ComparisonWhitespacePattern.Replace(value.Replace('_', ' '), " ").Trim();
        return cleaned.Trim(' ', '-', '\u2013', '\u2014', ':', '#', '.', ',');
    }

    private static string GetSafeFileName(string value)
    {
        var normalized = value.Replace('\\', '/').Trim();
        var separator = normalized.LastIndexOf('/');
        var fileName = separator >= 0 ? normalized[(separator + 1)..] : normalized;
        return Bound(fileName, PtvReadingMetadataLimits.MaximumTitleLength);
    }

    private static string StripKnownMediaExtension(string fileName)
    {
        var extensionIndex = fileName.LastIndexOf('.');
        if (extensionIndex <= 0)
        {
            return fileName;
        }

        var extension = fileName[extensionIndex..];
        return MediaExtensions.Contains(extension) ? fileName[..extensionIndex] : fileName;
    }

    private static string? NormalizeIsbn(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = new string(value.Where(character => char.IsDigit(character) || character is 'X' or 'x').ToArray()).ToUpperInvariant();
        return normalized.Length is 10 or 13 ? normalized : null;
    }

    private static Dictionary<string, string> BoundProviderIds(IEnumerable<KeyValuePair<string, string>> values)
    {
        var bounded = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in values.Where(pair => !string.IsNullOrWhiteSpace(pair.Key) && !string.IsNullOrWhiteSpace(pair.Value)))
        {
            var key = Bound(pair.Key, 64);
            if (bounded.ContainsKey(key))
            {
                continue;
            }

            bounded[key] = Bound(pair.Value, PtvReadingMetadataLimits.MaximumIdentifierLength);
            if (bounded.Count >= PtvReadingMetadataLimits.MaximumExternalIds)
            {
                break;
            }
        }

        return bounded;
    }

    private static string Bound(string? value, int maximumLength)
    {
        var normalized = value?.Trim() ?? string.Empty;
        return normalized.Length <= maximumLength ? normalized : normalized[..maximumLength];
    }

    private static string? BoundNullable(string? value, int maximumLength)
    {
        var bounded = Bound(value, maximumLength);
        return bounded.Length == 0 ? null : bounded;
    }

    private static Regex CreateRegex(string pattern, RegexOptions options = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
    {
        return new Regex(pattern, options | RegexOptions.Compiled, RegexTimeout);
    }

    private sealed class FolderComicIdentity
    {
        public string? SeriesTitle { get; init; }

        public int? SeriesStartYear { get; init; }
    }
}
