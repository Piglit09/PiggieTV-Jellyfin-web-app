import { afterEach, describe, expect, it } from 'vitest';

import { getActiveDetailsPage } from './activeDetailsPage';

describe('active details page selection', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('prefers the visible restored page over a hidden cached predecessor', () => {
        document.body.innerHTML = `
            <main id="itemDetailPage" class="itemDetailPage hide" data-page="stale"></main>
            <main id="itemDetailPage" class="itemDetailPage" data-page="current"></main>
        `;

        expect(getActiveDetailsPage()?.getAttribute('data-page')).toBe('current');
    });

    it('does not guess among hidden view-cache slots during a transition', () => {
        document.body.innerHTML = `
            <main class="itemDetailPage hide" data-page="stale"></main>
            <main class="itemDetailPage hide" data-page="incoming"></main>
        `;

        expect(getActiveDetailsPage()).toBeNull();
    });
});
