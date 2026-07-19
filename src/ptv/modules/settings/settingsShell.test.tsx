import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const observabilityMocks = vi.hoisted(() => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('../../core/observability', () => observabilityMocks);

import { mountPtvSettingsShell, unmountPtvSettingsShell } from './settingsShell';

describe('PTV settings shell ownership', () => {
    afterEach(() => {
        flushSync(() => unmountPtvSettingsShell());
    });

    it('keeps enhanced Settings Jellyfin-owned without mounting a native PTV shell', () => {
        flushSync(() => mountPtvSettingsShell());
        flushSync(() => mountPtvSettingsShell());

        expect(document.querySelector('#ptv-settings-shell-root')).toBeNull();
        expect(document.querySelector('.ptv-shell-header')).toBeNull();
        expect(observabilityMocks.recordPtvEvent).toHaveBeenCalledWith('render', 'settings-enhancement-mounted', {
            nativeShellMounted: false,
            owner: 'jellyfin'
        });
    });
});
