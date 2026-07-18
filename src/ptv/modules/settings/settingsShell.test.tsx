import React from 'react';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shell/PTVShell', () => ({
    default: ({ headerOnly, section }: { headerOnly?: boolean; section?: string }) => (
        <header
            className='ptv-shell-header'
            data-header-only={String(Boolean(headerOnly))}
            data-section={section}
        />
    )
}));

import { mountPtvSettingsShell, unmountPtvSettingsShell } from './settingsShell';

describe('PTV settings shell ownership', () => {
    afterEach(() => {
        flushSync(() => unmountPtvSettingsShell());
    });

    it('mounts one shared PTV settings header', () => {
        flushSync(() => mountPtvSettingsShell());
        flushSync(() => mountPtvSettingsShell());

        const host = document.querySelector('#ptv-settings-shell-root');
        const header = host?.querySelector<HTMLElement>('.ptv-shell-header');

        expect(document.querySelectorAll('#ptv-settings-shell-root')).toHaveLength(1);
        expect(header?.dataset.headerOnly).toBe('true');
        expect(header?.dataset.section).toBe('settings');
    });
});
