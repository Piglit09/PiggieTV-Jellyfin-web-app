import { recordPtvEvent } from '../../core/observability';

let settingsEnhancementMounted = false;

export function mountPtvSettingsShell() {
    if (settingsEnhancementMounted) return unmountPtvSettingsShell;

    settingsEnhancementMounted = true;
    recordPtvEvent('render', 'settings-enhancement-mounted', {
        nativeShellMounted: true,
        owner: 'piggietv'
    });

    return unmountPtvSettingsShell;
}

export function unmountPtvSettingsShell() {
    if (!settingsEnhancementMounted) return;

    settingsEnhancementMounted = false;
    recordPtvEvent('render', 'settings-enhancement-unmounted', {
        nativeShellMounted: true,
        owner: 'piggietv'
    });
}
