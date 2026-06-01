using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Periodically removes expired PiggieTV signup verification and reset records.
/// </summary>
public sealed class PtvSignupCleanupService : BackgroundService
{
    private static readonly TimeSpan CleanupInterval = TimeSpan.FromMinutes(5);
    private readonly ILogger<PtvSignupCleanupService> _logger;
    private readonly IPtvSignupService _signupService;

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvSignupCleanupService"/> class.
    /// </summary>
    /// <param name="logger">Logger.</param>
    /// <param name="signupService">Signup service.</param>
    public PtvSignupCleanupService(
        ILogger<PtvSignupCleanupService> logger,
        IPtvSignupService signupService)
    {
        _logger = logger;
        _signupService = signupService;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(CleanupInterval);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false);
                var removed = _signupService.CleanupExpiredRecords();

                if (removed > 0)
                {
                    _logger.LogInformation("PiggieTV signup cleanup removed {RemovedCount} expired records.", removed);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "PiggieTV signup cleanup failed.");
            }
        }
    }
}
