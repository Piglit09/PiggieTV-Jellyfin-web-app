using MediaBrowser.Model.Tasks;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Daily incremental PiggieTV Metadata Quality scheduled task.</summary>
public sealed class PtvMetadataQualityTask : IScheduledTask, IConfigurableScheduledTask
{
    private readonly IPtvMetadataQualityService _service;

    public PtvMetadataQualityTask(IPtvMetadataQualityService service)
    {
        _service = service;
    }

    public string Name => "PTV Metadata Quality Scan";

    public string Key => "PtvMetadataQualityScan";

    public string Description => "Audits new and changed library metadata and builds an explainable administrator review queue.";

    public string Category => "PiggieTV";

    public bool IsHidden => false;

    public bool IsEnabled => true;

    public bool IsLogged => true;

    public Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken) =>
        _service.RunScheduledScanAsync(progress, cancellationToken);

    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() =>
    [
        new()
        {
            Type = TaskTriggerInfoType.DailyTrigger,
            TimeOfDayTicks = TimeSpan.FromHours(4).Ticks
        }
    ];
}
