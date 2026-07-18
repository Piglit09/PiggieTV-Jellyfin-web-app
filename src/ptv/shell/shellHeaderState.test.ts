import { describe, expect, it } from 'vitest';

import type { PtvRouteControllerState } from './routeController';
import { getHeaderStatusForRoute } from './shellHeaderState';

function createRoute(hash: string, overrides: Partial<PtvRouteControllerState> = {}): PtvRouteControllerState {
    return {
        activeFeatureIds: [],
        canRenderNative: true,
        fallbackReason: '',
        full: `/web/${hash}`,
        hash,
        layout: 'standard',
        mode: 'native',
        normalizedPath: hash.replace(/^#/, '').split('?')[0],
        owner: 'shell',
        pageType: 'generic',
        path: '/web/',
        routeGeneration: 1,
        routeId: 'generic',
        routeKey: hash,
        ...overrides
    };
}

describe('PTV shell header route ownership', () => {
    it('clears a stale Reading header on dashboard and fallback routes', () => {
        const readingHeader = { mounted: true, pageTitle: 'Reading', section: 'reading' };

        expect(getHeaderStatusForRoute(readingHeader, createRoute('#/dashboard/piggietv', {
            mode: 'enhanced',
            owner: 'dashboard',
            routeId: 'dashboard'
        }))).toBeNull();
        expect(getHeaderStatusForRoute(readingHeader, createRoute('#/details?id=item', {
            canRenderNative: false,
            mode: 'fallback'
        }))).toBeNull();
    });

    it('keeps only a mounted header owned by the active native route', () => {
        const readingHeader = { mounted: true, pageTitle: 'Manga', section: 'reading' };

        expect(getHeaderStatusForRoute(readingHeader, createRoute('#/reading/manga?view=library'))).toBe(readingHeader);
        expect(getHeaderStatusForRoute({ ...readingHeader, mounted: false }, createRoute('#/reading'))).toBeNull();
        expect(getHeaderStatusForRoute({ ...readingHeader, section: 'music' }, createRoute('#/reading'))).toBeNull();
    });
});
