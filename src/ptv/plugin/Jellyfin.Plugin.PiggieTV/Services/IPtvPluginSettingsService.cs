using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Manages PiggieTV plugin settings.
/// </summary>
public interface IPtvPluginSettingsService
{
    /// <summary>
    /// Gets public plugin settings.
    /// </summary>
    /// <returns>Public plugin settings.</returns>
    PtvPluginSettingsDto GetSettings();

    /// <summary>
    /// Saves public plugin settings from a partial patch.
    /// </summary>
    /// <param name="settings">Incoming settings patch.</param>
    /// <returns>Saved public plugin settings.</returns>
    PtvPluginSettingsDto SaveSettings(PtvPluginSettingsPatchDto settings);

    /// <summary>
    /// Resets plugin settings to defaults.
    /// </summary>
    /// <returns>Default public plugin settings.</returns>
    PtvPluginSettingsDto ResetSettings();
}
