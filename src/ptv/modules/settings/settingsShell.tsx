import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import PTVShell from '../../shell/PTVShell';

const SETTINGS_SHELL_ROOT_ID = 'ptv-settings-shell-root';

let settingsShellRoot: Root | null = null;
let settingsShellHost: HTMLDivElement | null = null;

function renderPtvSettingsShell() {
    settingsShellRoot?.render(
        <PTVShell headerOnly section='settings' title='Settings'>
            {null}
        </PTVShell>
    );
}

export function mountPtvSettingsShell() {
    if (settingsShellRoot) return unmountPtvSettingsShell;

    settingsShellHost = document.createElement('div');
    settingsShellHost.id = SETTINGS_SHELL_ROOT_ID;
    settingsShellHost.className = 'ptv-settings-shell-root';
    document.body.append(settingsShellHost);
    settingsShellRoot = createRoot(settingsShellHost);
    renderPtvSettingsShell();

    return unmountPtvSettingsShell;
}

export function unmountPtvSettingsShell() {
    settingsShellRoot?.unmount();
    settingsShellRoot = null;
    settingsShellHost?.remove();
    settingsShellHost = null;
}
