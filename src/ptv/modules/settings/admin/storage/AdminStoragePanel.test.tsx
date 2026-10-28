import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Api } from '@jellyfin/sdk';
import type { ApiClient } from 'jellyfin-apiclient';
import { describe, expect, it } from 'vitest';

import type { AdminStorageRow } from './adminStorageModel';
import AdminStoragePanel, { AdminStorageView } from './AdminStoragePanel';

const known: AdminStorageRow = {
    freeBytes: 750,
    name: 'F:',
    paths: [ 'Movies: F:/movies', 'Shows: F:/shows' ],
    totalBytes: 1000,
    usedBytes: 250,
    usedPercent: 25
};

describe('admin storage view', () => {
    it('shows a mount once with used, free, total and numeric percentage', () => {
        const html = renderToStaticMarkup(<AdminStorageView rows={[ known ]} />);

        expect(html).toContain('F:');
        expect(html).toContain('Movies: F:/movies');
        expect(html).toContain('Shows: F:/shows');
        expect(html).toContain('Used');
        expect(html).toContain('Free');
        expect(html).toContain('Total');
        expect(html).toContain('25%');
        expect(html).toContain('value="25"');
    });

    it('identifies unavailable metrics without rendering a fabricated progress bar', () => {
        const html = renderToStaticMarkup(<AdminStorageView rows={[ {
            ...known,
            freeBytes: null,
            totalBytes: null,
            usedPercent: null
        } ]} />);

        expect(html).toContain('Unavailable');
        expect(html).not.toContain('<progress');
        expect(html).not.toContain('0%');
        expect(html).not.toContain('100%');
    });

    it('shows a useful state when the server supplies no mount information', () => {
        const html = renderToStaticMarkup(<AdminStorageView rows={[]} />);

        expect(html).toContain('Storage information unavailable');
        expect(html).not.toContain('<progress');
    });

    it('shows unavailable instead of loading forever when server identity is unresolved', () => {
        const html = renderToStaticMarkup(
            <QueryClientProvider client={new QueryClient()}>
                <AdminStoragePanel />
            </QueryClientProvider>
        );

        expect(html).toContain('Storage information unavailable');
        expect(html).not.toContain('Loading storage information');
    });

    it('shows unavailable when the server is known but the authenticated user is unresolved', () => {
        const html = renderToStaticMarkup(
            <QueryClientProvider client={new QueryClient()}>
                <AdminStoragePanel
                    api={{} as Api}
                    apiClient={{ serverId: () => 'server-a', getCurrentUserId: () => null } as unknown as ApiClient}
                />
            </QueryClientProvider>
        );

        expect(html).toContain('Storage information unavailable');
        expect(html).not.toContain('Loading storage information');
        expect(html).not.toContain('Retry storage');
    });
});
