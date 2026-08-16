using MediaBrowser.Model.Tasks;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Jellyfin scheduled task for validated PTV account data backups.</summary>
public sealed class PtvAccountBackupTask : IScheduledTask, IConfigurableScheduledTask
{
    private readonly IPtvAccountBackupService _backupService;

    /// <summary>Initializes the Jellyfin account backup task.</summary>
    public PtvAccountBackupTask(IPtvAccountBackupService backupService)
    {
        _backupService = backupService;
    }

    /// <inheritdoc />
    public string Name => "PTV Account Data Backup";

    /// <inheritdoc />
    public string Key => "PtvAccountDataBackup";

    /// <inheritdoc />
    public string Description => "Creates a checksummed, schema-validated backup of durable PiggieTV profiles and email verification metadata.";

    /// <inheritdoc />
    public string Category => "PiggieTV";

    /// <inheritdoc />
    public bool IsHidden => false;

    /// <inheritdoc />
    public bool IsEnabled => true;

    /// <inheritdoc />
    public bool IsLogged => true;

    /// <inheritdoc />
    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        progress.Report(5);
        var result = await _backupService.CreateBackupAsync("scheduled", cancellationToken).ConfigureAwait(false);
        if (!result.Ok)
        {
            throw new PtvAccountBackupException(result.Code, result.Message);
        }

        progress.Report(100);
    }

    /// <inheritdoc />
    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() =>
    [
        new()
        {
            Type = TaskTriggerInfoType.DailyTrigger,
            TimeOfDayTicks = TimeSpan.FromHours(3).Ticks
        }
    ];
}
