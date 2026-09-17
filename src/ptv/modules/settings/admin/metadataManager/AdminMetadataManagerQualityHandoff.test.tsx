import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminMetadataManagerIdentifyHandoff } from './adminMetadataManagerIdentifyHandoff';

const routeMocks = vi.hoisted(() => ({
    page: vi.fn((props: unknown) => <output data-props={JSON.stringify(props)} data-testid='metadata-manager-page' />)
}));

vi.mock('./PtvAdminMetadataManagerPage', () => ({
    default: routeMocks.page
}));

vi.mock('../../../../../components/loading/LoadingComponent', () => ({
    default: () => <div>Loading</div>
}));

import AdminMetadataManagerRoute from './AdminMetadataManagerRoute';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

describe('Metadata Quality to Metadata Manager route handoff', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    async function renderRoute(state?: unknown) {
        await act(async () => root.render(
            <MemoryRouter initialEntries={[ {
                pathname: '/settings/admin/media/metadata-manager/item-a',
                state
            } ]}>
                <AdminMetadataManagerRoute />
            </MemoryRouter>
        ));
        await act(async () => Promise.resolve());
    }

    it('passes a validated suggestion only to its matching immutable item route', async () => {
        await renderRoute(createAdminMetadataManagerIdentifyHandoff({
            itemId: 'item-a',
            name: 'The Thing',
            providerIds: { TMDb: '1091' },
            year: 1982
        }));

        expect(routeMocks.page.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
            identifyPrefill: {
                issueNumber: null,
                itemId: 'item-a',
                mediaClass: null,
                name: 'The Thing',
                provider: null,
                providerIds: { TMDb: '1091' },
                seriesStartYear: null,
                seriesTitle: null,
                year: 1982
            },
            itemId: 'item-a'
        }));
    });

    it('forwards structured comic evidence only to the matching immutable item route', async () => {
        await renderRoute(createAdminMetadataManagerIdentifyHandoff({
            issueNumber: '9',
            itemId: 'item-a',
            mediaClass: 'comic',
            name: 'Deadpool',
            provider: 'Comic Vine',
            providerIds: { ComicVine: '4000-77815' },
            seriesStartYear: 2019,
            seriesTitle: 'Deadpool',
            year: 2020
        }));

        expect(routeMocks.page.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
            identifyPrefill: expect.objectContaining({
                issueNumber: '9',
                mediaClass: 'comic',
                seriesStartYear: 2019,
                seriesTitle: 'Deadpool',
                year: 2020
            }),
            itemId: 'item-a'
        }));
    });

    it('loads safely without prefill after a direct refresh and performs no action itself', async () => {
        await renderRoute();

        expect(routeMocks.page.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
            identifyPrefill: null,
            itemId: 'item-a'
        }));
        expect(container.querySelector('[data-testid="metadata-manager-page"]')).not.toBeNull();
    });
});
