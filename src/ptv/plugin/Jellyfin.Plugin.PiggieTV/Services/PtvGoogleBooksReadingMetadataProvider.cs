using System.Diagnostics;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Provider-neutral adapter around PiggieTV's existing Google Books lookup service.</summary>
public sealed class PtvGoogleBooksReadingMetadataProvider : IPtvReadingMetadataProvider
{
    private const string ProviderId = "google-books";
    private readonly IPtvGoogleBooksMetadataLookupService _lookup;

    public PtvGoogleBooksReadingMetadataProvider(IPtvGoogleBooksMetadataLookupService lookup)
    {
        _lookup = lookup;
    }

    public string Id => ProviderId;

    public string DisplayName => "Google Books";

    public bool Supports(PtvMetadataSearchContext context) =>
        context.MediaClassOverride is null
            or PtvReadingMediaClass.Unknown
            or PtvReadingMediaClass.Book
            or PtvReadingMediaClass.GraphicNovel
            or PtvReadingMediaClass.Comic;

    public async Task<PtvReadingProviderSearchResult> SearchAsync(
        PtvStructuredMetadataQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var stopwatch = Stopwatch.StartNew();
        try
        {
            var directId = query.ProviderId is { } providerId
                && (providerId.Provider.Equals(ProviderId, StringComparison.OrdinalIgnoreCase)
                    || providerId.Provider.Equals("GoogleBooks", StringComparison.OrdinalIgnoreCase))
                ? providerId.Id
                : null;
            var response = await _lookup.SearchAsync(
                new PtvGoogleBooksMetadataLookupRequest
                {
                    GoogleBooksId = directId,
                    Title = query.SeriesTitle ?? query.CleanedTitle,
                    Author = query.Author,
                    Isbn = query.Isbn,
                    Year = query.Year,
                    Limit = 10
                },
                cancellationToken).ConfigureAwait(false);

            if (!response.Provider.Enabled)
            {
                return Failure(
                    PtvReadingProviderState.Disabled,
                    PtvReadingProviderFailureKind.Unavailable,
                    "google-books-disabled",
                    "Google Books is disabled.",
                    stopwatch.ElapsedMilliseconds);
            }

            if (!response.Ok)
            {
                var kind = response.Provider.StatusCode switch
                {
                    401 or 403 => PtvReadingProviderFailureKind.Authentication,
                    429 => PtvReadingProviderFailureKind.RateLimit,
                    _ when response.Provider.Error == "title-or-isbn-required" => PtvReadingProviderFailureKind.BadRequest,
                    _ => PtvReadingProviderFailureKind.Unavailable
                };
                var state = kind switch
                {
                    PtvReadingProviderFailureKind.Authentication => PtvReadingProviderState.Misconfigured,
                    PtvReadingProviderFailureKind.RateLimit => PtvReadingProviderState.RateLimited,
                    _ => PtvReadingProviderState.Unreachable
                };
                return Failure(
                    state,
                    kind,
                    NormalizeError(response.Provider.Error),
                    "Google Books could not complete this request.",
                    stopwatch.ElapsedMilliseconds);
            }

            return new PtvReadingProviderSearchResult
            {
                Provider = ProviderId,
                State = PtvReadingProviderState.Available,
                Candidates = response.Candidates
                    .Take(10)
                    .Select(Normalize)
                    .Where(candidate => candidate is not null)
                    .Select(candidate => candidate!.ToBoundedTransportModel())
                    .ToList(),
                CacheHit = response.Provider.Cached,
                DurationMilliseconds = response.Provider.DurationMs ?? stopwatch.ElapsedMilliseconds
            };
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return Failure(
                PtvReadingProviderState.Unreachable,
                PtvReadingProviderFailureKind.Unavailable,
                "google-books-unavailable",
                "Google Books is temporarily unavailable.",
                stopwatch.ElapsedMilliseconds);
        }
        finally
        {
            stopwatch.Stop();
        }
    }

    public async Task<PtvNormalizedMetadataCandidate?> GetByIdAsync(
        string providerId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(providerId) || providerId.Length > 128)
        {
            return null;
        }

        var response = await _lookup.SearchAsync(
            new PtvGoogleBooksMetadataLookupRequest
            {
                GoogleBooksId = providerId.Trim(),
                Limit = 1
            },
            cancellationToken).ConfigureAwait(false);
        return response.Ok
            ? response.Candidates.Select(Normalize).FirstOrDefault(candidate => candidate is not null)?.ToBoundedTransportModel()
            : null;
    }

    public Task<PtvReadingProviderStatus> GetStatusAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var configuration = PtvPluginSettingsNormalizer.Normalize(
            Plugin.Instance?.Configuration ?? new PluginConfiguration());
        return Task.FromResult(new PtvReadingProviderStatus
        {
            Provider = ProviderId,
            State = configuration.GoogleBooksSettings.GoogleBooksEnabled
                ? PtvReadingProviderState.Available
                : PtvReadingProviderState.Disabled,
            Message = configuration.GoogleBooksSettings.GoogleBooksEnabled ? "Ready" : "Disabled"
        });
    }

    private static PtvNormalizedMetadataCandidate? Normalize(PtvGoogleBooksMetadataCandidate value)
    {
        var id = FindProviderId(value.ProviderIds, "GoogleBooks");
        var title = PtvReadingMetadataSafety.Text(value.Name ?? value.OriginalTitle);
        if (id is null || title is null)
        {
            return null;
        }

        var candidate = new PtvNormalizedMetadataCandidate
        {
            Provider = ProviderId,
            ProviderId = id,
            MediaClass = PtvReadingMediaClass.Book,
            Title = title,
            Year = value.ProductionYear,
            StartYear = value.ProductionYear,
            Description = PtvReadingMetadataSafety.PlainText(value.Overview),
            Authors = value.Authors.Take(64).Select(author => new PtvReadingPersonCredit
            {
                Name = PtvReadingMetadataSafety.Text(author) ?? string.Empty,
                Role = "Author"
            }).Where(author => author.Name.Length > 0).ToList(),
            Genres = PtvReadingMetadataSafety.Strings(value.Genres),
            Tags = PtvReadingMetadataSafety.Strings(value.Tags),
            Publisher = PtvReadingMetadataSafety.Text(value.Publisher),
            Language = PtvReadingMetadataSafety.Text(value.Language, 32),
            CoverUrl = PtvReadingMetadataSafety.HttpUrl(value.ImageUrl),
            SourceUrl = PtvReadingMetadataSafety.HttpUrl(value.Url),
            Score = (int)Math.Round(Math.Clamp(value.Confidence, 0d, 100d))
        };
        var originalTitle = PtvReadingMetadataSafety.Text(value.OriginalTitle);
        if (originalTitle is not null && !originalTitle.Equals(title, StringComparison.OrdinalIgnoreCase))
        {
            candidate.AlternateTitles.Add(originalTitle);
        }

        candidate.ExternalIds["GoogleBooks"] = id;
        candidate.Isbn10 = FindProviderId(value.ProviderIds, "ISBN10");
        candidate.Isbn13 = FindProviderId(value.ProviderIds, "ISBN13");
        if (candidate.Isbn10 is not null) candidate.ExternalIds["ISBN10"] = candidate.Isbn10;
        if (candidate.Isbn13 is not null) candidate.ExternalIds["ISBN13"] = candidate.Isbn13;
        return candidate;
    }

    private static string? FindProviderId(
        IReadOnlyDictionary<string, string> providerIds,
        string key) => providerIds.TryGetValue(key, out var value)
            ? PtvReadingMetadataSafety.Text(value, 256)
            : null;

    private static string NormalizeError(string? providerError) => providerError switch
    {
        "title-or-isbn-required" => "google-books-query-required",
        "cancelled" => "google-books-cancelled",
        _ => "google-books-unavailable"
    };

    private static PtvReadingProviderSearchResult Failure(
        PtvReadingProviderState state,
        PtvReadingProviderFailureKind kind,
        string code,
        string message,
        long durationMilliseconds) => new()
        {
            Provider = ProviderId,
            State = state,
            DurationMilliseconds = durationMilliseconds,
            Failure = new PtvReadingProviderFailure
            {
                Provider = ProviderId,
                Kind = kind,
                Code = code,
                Message = message
            }
        };
}
