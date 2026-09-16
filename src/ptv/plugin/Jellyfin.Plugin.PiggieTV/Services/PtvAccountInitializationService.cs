using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Runs idempotent account recovery/profile synchronization after plugin startup.</summary>
public sealed class PtvAccountInitializationService : BackgroundService
{
    private readonly IPtvAccountService _accountService;
    private readonly ILogger<PtvAccountInitializationService> _logger;

    /// <summary>Initializes startup migration.</summary>
    public PtvAccountInitializationService(
        IPtvAccountService accountService,
        ILogger<PtvAccountInitializationService> logger)
    {
        _accountService = accountService;
        _logger = logger;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            var migration = await _accountService.InitializeAsync(stoppingToken).ConfigureAwait(false);
            _logger.LogInformation(
                "PiggieTV account initialization completed. JellyfinUsers={JellyfinUsers}; Profiles={Profiles}; VerifiedRecovered={VerifiedRecovered}; UnverifiedRecovered={UnverifiedRecovered}; Missing={Missing}; AmbiguousSkipped={AmbiguousSkipped}; Orphans={Orphans}.",
                migration.JellyfinUsersDiscovered,
                migration.ExistingProfiles,
                migration.VerifiedEmailsRecovered,
                migration.UnverifiedEmailsRecovered,
                migration.UsersStillMissingEmail,
                migration.AmbiguousRecordsSkipped,
                migration.OrphanedRecordsFound);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Normal plugin shutdown.
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PiggieTV account initialization failed. Existing Jellyfin authentication remains available.");
        }
    }
}
