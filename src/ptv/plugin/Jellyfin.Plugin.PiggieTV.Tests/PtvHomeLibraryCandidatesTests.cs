using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvHomeLibraryCandidatesTests
{
    private static readonly Guid AnimeId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    [Fact]
    public void PagesOneMultiRootLibraryToCompletionAndMemoizesByIdAndTypeSet()
    {
        var calls = 0;
        var items = Enumerable.Range(1, 203).Select(i => (BaseItem)new Series
        {
            Id = Guid.Parse($"bbbbbbbb-bbbb-bbbb-bbbb-{i:D12}"),
            Path = i % 2 == 0 ? $"/media-local/Anime/{i}" : $"/mnt/ptv-media/Anime/{i}"
        }).ToArray();
        var provider = new PtvHomeLibraryCandidates((id, types, start, limit) =>
        {
            Assert.Equal(AnimeId, id);
            Assert.Equal(["Series"], types);
            calls++;
            return new PtvHomeLibraryCandidatePage(items.Skip(start).Take(limit).ToArray(), items.Length);
        });

        var first = provider.GetCandidates(AnimeId, ["Series"], CancellationToken.None);
        var second = provider.GetCandidates(AnimeId, ["Series"], CancellationToken.None);
        Assert.Equal(203, first.Count);
        Assert.Same(first, second);
        Assert.Equal(2, calls);
        Assert.Contains(first, item => item.Path.StartsWith("/media-local/Anime/", StringComparison.Ordinal));
        Assert.Contains(first, item => item.Path.StartsWith("/mnt/ptv-media/Anime/", StringComparison.Ordinal));
    }

    [Fact]
    public void IncompleteOrChangingPaginationFailsClosed()
    {
        var provider = new PtvHomeLibraryCandidates((_, _, _, _) => new PtvHomeLibraryCandidatePage([], 205));
        Assert.Throws<InvalidOperationException>(() => provider.GetCandidates(AnimeId, ["Series"], CancellationToken.None));

        var calls = 0;
        provider = new PtvHomeLibraryCandidates((_, _, start, _) =>
        {
            calls++;
            return start == 0
                ? new PtvHomeLibraryCandidatePage(Enumerable.Range(1, 200).Select(i => (BaseItem)new Series { Id = Guid.Parse($"cccccccc-cccc-cccc-cccc-{i:D12}") }).ToArray(), 205)
                : new PtvHomeLibraryCandidatePage([new Series { Id = Guid.NewGuid() }], 206);
        });
        Assert.Throws<InvalidOperationException>(() => provider.GetCandidates(AnimeId, ["Series"], CancellationToken.None));
        Assert.Equal(2, calls);
    }

    [Fact]
    public void QueryErrorAndCancellationNeverReturnPartialCandidates()
    {
        var provider = new PtvHomeLibraryCandidates((_, _, _, _) => throw new IOException("Synthetic query failure."));
        Assert.Throws<InvalidOperationException>(() => provider.GetCandidates(AnimeId, ["Series"], CancellationToken.None));

        using var canceled = new CancellationTokenSource();
        canceled.Cancel();
        provider = new PtvHomeLibraryCandidates((_, _, _, _) => throw new Xunit.Sdk.XunitException("Query should not run."));
        Assert.Throws<OperationCanceledException>(() => provider.GetCandidates(AnimeId, ["Series"], canceled.Token));
    }

    [Fact]
    public void DifferentTypeSetsDoNotShareProofAndDuplicateIdsAreDeduped()
    {
        var calls = 0;
        var firstId = Guid.NewGuid();
        var provider = new PtvHomeLibraryCandidates((_, types, _, _) =>
        {
            calls++;
            return types.SequenceEqual(["Movie"])
                ? new PtvHomeLibraryCandidatePage([new Movie { Id = firstId }, new Movie { Id = firstId }], 2)
                : new PtvHomeLibraryCandidatePage([new Series { Id = Guid.NewGuid() }], 1);
        });
        Assert.Single(provider.GetCandidates(AnimeId, ["Movie"], CancellationToken.None));
        Assert.Single(provider.GetCandidates(AnimeId, ["Series"], CancellationToken.None));
        Assert.Equal(2, calls);
    }
}
