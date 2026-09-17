import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import MediaSettings from './MediaSettings';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

describe('Media Management launcher', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it('links every native media administration workspace', async () => {
        await act(async () => root.render(
            <MemoryRouter>
                <MediaSettings />
            </MemoryRouter>
        ));

        const links = Array.from(container.querySelectorAll('a'));
        expect(links.map(link => link.textContent)).toEqual(expect.arrayContaining([
            expect.stringContaining('Libraries'),
            expect.stringContaining('Library Display'),
            expect.stringContaining('Metadata'),
            expect.stringContaining('NFO Settings'),
            expect.stringContaining('Metadata Quality'),
            expect.stringContaining('Metadata Manager')
        ]));
        expect(container.querySelector('a[href="/settings/admin/libraries"]')).not.toBeNull();
        expect(container.querySelector('a[href="/settings/admin/libraries/display"]')).not.toBeNull();
        expect(container.querySelector('a[href="/settings/admin/libraries/metadata"]')).not.toBeNull();
        expect(container.querySelector('a[href="/settings/admin/libraries/nfo"]')).not.toBeNull();
        expect(container.querySelector('a[href="/settings/admin/media/metadata-quality"]')).not.toBeNull();
        expect(container.querySelector('a[href="/settings/admin/media/metadata-manager"]')).not.toBeNull();
        expect(container.querySelector('a[href="#/metadata"]')).toBeNull();
    });
});
