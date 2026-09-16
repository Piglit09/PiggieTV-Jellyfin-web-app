import React, { act, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import LegacyMetadataManagerRedirect, { getNativeMetadataManagerRoute } from './LegacyMetadataManagerRedirect';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

function LocationWithBack() {
    const location = useLocation();
    const navigate = useNavigate();
    const handleBack = useCallback(() => navigate(-1), [ navigate ]);
    return (
        <>
            <output>{`${location.pathname}${location.search}`}</output>
            <button onClick={handleBack} type='button'>Back</button>
        </>
    );
}

describe('legacy Metadata Manager redirect', () => {
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

    async function renderRedirect(initialEntry: string, previousEntry = '/before-metadata') {
        await act(async () => root.render(
            <MemoryRouter
                key={initialEntry}
                initialEntries={[ previousEntry, initialEntry ]}
                initialIndex={1}
            >
                <Routes>
                    <Route path='/metadata' element={<LegacyMetadataManagerRedirect />} />
                    <Route path='*' element={<LocationWithBack />} />
                </Routes>
            </MemoryRouter>
        ));
    }

    it('maps the catalog and immutable item legacy URLs to native routes', async () => {
        await renderRedirect('/metadata');
        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/media/metadata-manager');

        await renderRedirect('/metadata?id=item-a&tab=ignored');
        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/media/metadata-manager/item-a');
    });

    it('falls back safely for a missing item and encodes preserved item identity', () => {
        expect(getNativeMetadataManagerRoute('   ')).toBe('/settings/admin/media/metadata-manager');
        expect(getNativeMetadataManagerRoute('item/with space')).toBe(
            '/settings/admin/media/metadata-manager/item%2Fwith%20space'
        );
    });

    it('replaces legacy history instead of retaining the compatibility route', async () => {
        await renderRedirect('/metadata?id=item-a');
        await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
        expect(container.querySelector('output')?.textContent).toBe('/before-metadata');
    });
});
