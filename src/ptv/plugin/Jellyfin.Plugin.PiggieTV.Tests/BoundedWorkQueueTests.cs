using Jellyfin.Plugin.PiggieTV.Services;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class BoundedWorkQueueTests
{
    [Fact]
    public async Task RunAsyncBoundsConcurrencyAndDefersOverflow()
    {
        var active = 0;
        var maximumActive = 0;
        var work = Enumerable.Range(0, 10)
            .Select(index => (Func<CancellationToken, Task<int>>)(async cancellationToken =>
            {
                var current = Interlocked.Increment(ref active);
                maximumActive = Math.Max(maximumActive, current);
                await Task.Delay(10, cancellationToken);
                Interlocked.Decrement(ref active);
                return index;
            }))
            .ToArray();

        var result = await PtvBoundedWorkQueue.RunAsync(work, 2, 5, CancellationToken.None);

        Assert.Equal(5, result.AttemptedCount);
        Assert.Equal(5, result.Results.Count);
        Assert.Equal(5, result.SkippedCount);
        Assert.Equal(0, result.FailedCount);
        Assert.Equal(0, result.CancelledCount);
        Assert.InRange(maximumActive, 1, 2);
    }

    [Fact]
    public async Task RunAsyncRetainsCompletedResultsWhenBudgetIsCancelled()
    {
        using var cancellationSource = new CancellationTokenSource(TimeSpan.FromMilliseconds(70));
        var work = Enumerable.Range(0, 20)
            .Select(index => (Func<CancellationToken, Task<int>>)(async cancellationToken =>
            {
                await Task.Delay(25, cancellationToken);
                return index;
            }))
            .ToArray();

        var result = await PtvBoundedWorkQueue.RunAsync(work, 2, 20, cancellationSource.Token);

        Assert.NotEmpty(result.Results);
        Assert.True(result.CancelledCount > 0);
        Assert.Equal(20, result.Results.Count + result.FailedCount + result.CancelledCount);
    }
}
