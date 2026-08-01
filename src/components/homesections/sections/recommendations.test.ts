import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const diagnosticMocks = vi.hoisted(() => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('components/cardbuilder/cardBuilder', () => ({
    default: {
        getCardsHtml: vi.fn(({ items }: { items: unknown[] }) => `<article data-items="${items.length}"></article>`)
    }
}));
vi.mock('components/images/imageLoader', () => ({
    default: { lazyChildren: vi.fn() }
}));
vi.mock('lib/globalize', () => ({
    default: { translate: vi.fn((_key: string, name = '') => `Because ${name}`) }
}));
vi.mock('ptv/core/observability', () => diagnosticMocks);
vi.mock('utils/card', () => ({ getBackdropShape: vi.fn(() => 'backdrop') }));

import { loadRecommendations } from './recommendations';

function createApiClient() {
    return {
        getCurrentUserId: vi.fn(() => 'user-a'),
        getGenres: vi.fn(async () => ({ Items: [
            { Id: 'genre-a', Name: 'Drama' },
            { Id: 'genre-b', Name: 'Comedy' },
            { Id: 'genre-c', Name: 'Action' }
        ] })),
        getJSON: vi.fn(async (url: string) => {
            if (url === 'Movies/Recommendations') {
                return [ {
                    BaselineItemId: 'seed',
                    BaselineItemName: 'Seed',
                    Items: [
                        { Id: 'one' },
                        { Id: 'two' },
                        { Id: 'three' }
                    ],
                    RecommendationType: 'SimilarToLikedItem'
                } ];
            }

            return { Items: [] };
        }),
        getUrl: vi.fn((path: string) => path)
    };
}

describe('Movies recommendation scheduling', () => {
    let element: HTMLDivElement;

    beforeEach(() => {
        vi.useFakeTimers();
        diagnosticMocks.recordPtvEvent.mockClear();
        element = document.createElement('div');
        document.body.appendChild(element);
    });

    afterEach(() => {
        window.dispatchEvent(new Event('hashchange'));
        element.remove();
        vi.useRealTimers();
    });

    it('renders route-critical sources before starting deferred genre work', async () => {
        const apiClient = createApiClient();

        await loadRecommendations(element, apiClient, { Id: 'user-a' }, { enableOverflow: true });

        expect(element.classList.contains('hide')).toBe(false);
        expect(apiClient.getGenres).not.toHaveBeenCalled();
        expect(element.dataset.ptvRouteCriticalPending).toBeUndefined();

        await vi.advanceTimersByTimeAsync(250);
        expect(apiClient.getGenres).toHaveBeenCalledTimes(1);
    });

    it('retires deferred work on route exit without an automatic retry', async () => {
        const apiClient = createApiClient();

        await loadRecommendations(element, apiClient, { Id: 'user-a' }, { enableOverflow: true });
        window.dispatchEvent(new Event('hashchange'));
        await vi.advanceTimersByTimeAsync(500);

        expect(apiClient.getGenres).not.toHaveBeenCalled();
        expect(diagnosticMocks.recordPtvEvent.mock.calls.filter(([, name]) => (
            name === 'movies-recommendation-generation-started'
        ))).toHaveLength(1);
    });
});
