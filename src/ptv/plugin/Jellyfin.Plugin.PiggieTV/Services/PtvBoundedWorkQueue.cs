using System.Collections.Concurrent;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Executes a bounded slice of asynchronous work without discarding completed results when cancellation occurs.
/// </summary>
public static class PtvBoundedWorkQueue
{
    /// <summary>
    /// Runs a bounded set of work items with fixed concurrency.
    /// </summary>
    /// <typeparam name="T">Result type.</typeparam>
    /// <param name="workItems">Work item factories.</param>
    /// <param name="maxConcurrency">Maximum concurrent workers.</param>
    /// <param name="maxItems">Maximum work items attempted in this pass.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Completed results and outcome counts.</returns>
    public static async Task<PtvBoundedWorkResult<T>> RunAsync<T>(
        IReadOnlyList<Func<CancellationToken, Task<T>>> workItems,
        int maxConcurrency,
        int maxItems,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(workItems);

        var selectedCount = Math.Min(workItems.Count, Math.Max(0, maxItems));
        var skippedCount = Math.Max(0, workItems.Count - selectedCount);
        if (selectedCount == 0)
        {
            return new PtvBoundedWorkResult<T>(new Dictionary<int, T>(), 0, 0, 0, skippedCount);
        }

        var results = new ConcurrentDictionary<int, T>();
        var nextIndex = -1;
        var attemptedCount = 0;
        var failedCount = 0;
        var cancelledAttemptCount = 0;
        var workerCount = Math.Min(Math.Max(1, maxConcurrency), selectedCount);
        var workers = Enumerable.Range(0, workerCount).Select(async _ =>
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var index = Interlocked.Increment(ref nextIndex);
                if (index >= selectedCount) return;

                Interlocked.Increment(ref attemptedCount);
                try
                {
                    results[index] = await workItems[index](cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    Interlocked.Increment(ref cancelledAttemptCount);
                    if (cancellationToken.IsCancellationRequested) return;
                }
                catch
                {
                    Interlocked.Increment(ref failedCount);
                }
            }
        });

        await Task.WhenAll(workers).ConfigureAwait(false);

        var unattemptedSelectedCount = Math.Max(0, selectedCount - attemptedCount);
        var cancelledCount = cancelledAttemptCount + unattemptedSelectedCount;
        return new PtvBoundedWorkResult<T>(
            new SortedDictionary<int, T>(results),
            attemptedCount,
            failedCount,
            cancelledCount,
            skippedCount);
    }
}

/// <summary>
/// Result of a bounded asynchronous work pass.
/// </summary>
/// <typeparam name="T">Work result type.</typeparam>
/// <param name="Results">Completed results keyed by original work index.</param>
/// <param name="AttemptedCount">Number of work items started.</param>
/// <param name="FailedCount">Number of work items that failed with an exception.</param>
/// <param name="CancelledCount">Number of selected work items cancelled or not started after cancellation.</param>
/// <param name="SkippedCount">Number of work items deferred by the per-pass limit.</param>
public sealed record PtvBoundedWorkResult<T>(
    IReadOnlyDictionary<int, T> Results,
    int AttemptedCount,
    int FailedCount,
    int CancelledCount,
    int SkippedCount);
