import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recommendationMocks = vi.hoisted(() => ({
    getHomeData: vi.fn()
}));
const imageMocks = vi.hoisted(() => ({
    lazyChildren: vi.fn()
}));
const focusMocks = vi.hoisted(() => ({
    focusElement: vi.fn()
}));
const relationshipMocks = vi.hoisted(() => ({
    getRelationships: vi.fn()
}));
const relatedMocks = vi.hoisted(() => ({
    getRelatedItems: vi.fn()
}));
const routeMocks = vi.hoisted(() => ({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- The optional argument keeps mock call tuples aligned with the resolver contract.
    resolve: vi.fn((item: { Id?: string; Type?: string }, _options?: { mediaType?: string }) => ({
        fallbackReason: '',
        href: `#/details?id=${item.Id}`,
        routeSource: 'jellyfin-fallback'
    }))
}));

vi.mock('../recommendations/engine/recommendationEngine', () => ({
    getPtvRecommendationHomeData: recommendationMocks.getHomeData
}));

vi.mock('../../../components/images/imageLoader', () => ({
    default: {
        lazyChildren: imageMocks.lazyChildren
    }
}));

vi.mock('../../api', () => ({
    getPtvItemImageCandidates: vi.fn(item => [{
        imageItemId: item.Id,
        imageType: 'Primary',
        requestedType: 'Primary',
        tag: 'primary-tag',
        tagMode: 'tagged-primary',
        url: `/image/${item.Id}`
    }])
}));

vi.mock('../../core/itemRoutes', () => ({
    recordPtvItemRouteClick: vi.fn(),
    resolvePtvItemRoute: routeMocks.resolve
}));

vi.mock('../../core/tvFocus', () => ({
    focusPtvTvElement: focusMocks.focusElement
}));

vi.mock('./detailsAuthoritativeRelationships', () => ({
    getPtvAuthoritativeRelationships: relationshipMocks.getRelationships
}));

vi.mock('./detailsRelatedSource', () => ({
    loadPtvDetailRelatedItems: relatedMocks.getRelatedItems
}));

import type {
    PtvRecommendationHomeData,
    PtvRecommendationItem,
    PtvRecommendationScore
} from '../recommendations/types/recommendationTypes';
import type { PtvCinematicDetailsModel } from './detailsCinematicModel';
import {
    activatePtvCinematicDetailsArtwork,
    createPtvCinematicDetailsElement,
    createPtvCinematicDetailsSkeleton,
    loadPtvCinematicDetailsElement
} from './detailsCinematicExperience';

const model: PtvCinematicDetailsModel = {
    candidateCount: 2,
    dedupedCandidateCount: 1,
    facts: ['Movie', '2026', '2h 5m'],
    family: 'video',
    kicker: 'Beyond the credits',
    shelves: [{
        description: 'Explicit collection metadata.',
        id: 'franchise-order',
        items: [{
            item: {
                Id: 'related',
                ImageBlurHashes: { Primary: { 'primary-tag': 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH' } },
                Name: 'Related Movie',
                Type: 'Movie'
            },
            itemId: 'related',
            reason: 'Same explicit collection',
            sequence: 1,
            subtitle: 'Movie \u00b7 2025',
            title: 'Related Movie'
        }],
        orderLabel: 'Release order',
        relationship: 'explicit-collection',
        title: 'Continue the franchise'
    }],
    summary: 'Continue through explicit relationships.',
    title: 'Fixture Movie'
};

const emptyHomeData: PtvRecommendationHomeData = {
    candidates: [],
    generatedAt: 1,
    mixes: [],
    profileUpdatedAt: 1,
    quality: {
        duplicateItemsRemoved: 0,
        rowOverlapPercentage: 0,
        scoreDistribution: { buckets: [], max: 0, median: 0, min: 0, p25: 0, p75: 0, p90: 0 },
        unresolvedArtistCount: 0
    },
    rows: []
};

function simulateBrowserShelfMoveScrollReset() {
    const originalInsertBefore = Node.prototype.insertBefore;
    const movedShelfIds: string[] = [];

    // Chromium can reset a nested horizontal rail when its mounted shelf is moved.
    Node.prototype.insertBefore = function<T extends Node>(this: Node, child: T, reference: Node | null): T {
        const wasMountedShelf = this.isSameNode(child.parentNode) && child instanceof HTMLElement
            && child.hasAttribute('data-ptv-shelf-id');
        const result = originalInsertBefore.call(this, child, reference) as T;

        if (wasMountedShelf && child instanceof HTMLElement) {
            movedShelfIds.push(child.dataset.ptvShelfId || '');
            const rail = child.querySelector<HTMLElement>('.ptv-cinematic-shelf__rail');

            if (rail) rail.scrollLeft = 0;
        }

        return result;
    };

    return {
        movedShelfIds,
        restore: () => { Node.prototype.insertBefore = originalInsertBefore; }
    };
}

describe('cinematic Details experience', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        recommendationMocks.getHomeData.mockReset();
        imageMocks.lazyChildren.mockReset();
        focusMocks.focusElement.mockReset();
        relationshipMocks.getRelationships.mockReset();
        relationshipMocks.getRelationships.mockResolvedValue([]);
        relatedMocks.getRelatedItems.mockReset();
        relatedMocks.getRelatedItems.mockResolvedValue([]);
        routeMocks.resolve.mockReset();
        routeMocks.resolve.mockImplementation((item: { Id?: string }) => ({
            fallbackReason: '',
            href: `#/details?id=${item.Id}`,
            routeSource: 'jellyfin-fallback'
        }));
        focusMocks.focusElement.mockImplementation((element: HTMLElement) => {
            element.focus({ preventScroll: true });
            return true;
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders an accessible cinematic section with stable focus keys and BlurHash artwork', () => {
        const section = createPtvCinematicDetailsElement(model);

        document.body.append(section);

        expect(section.getAttribute('aria-labelledby')).toBe('ptv-cinematic-details-heading');
        expect(section.querySelector('h2')?.textContent).toBe('Beyond Fixture Movie');
        expect(section.querySelectorAll('[role="listitem"]')).toHaveLength(1);
        expect(section.querySelector('.ptv-cinematic-card')?.getAttribute('href')).toBe('#/details?id=related');
        expect(section.querySelector('.ptv-cinematic-card')?.getAttribute('data-ptv-focus-key')).toBe('details:cinematic:franchise-order:related');
        expect(section.querySelector('.ptv-cinematic-card__artwork')?.getAttribute('data-blurhash')).toBeTruthy();
        expect(section.querySelector('.ptv-cinematic-card__sequence')?.textContent).toBe('1');
    });

    it('provides a bounded nonblocking loading state', () => {
        const skeleton = createPtvCinematicDetailsSkeleton({ Id: 'seed', Name: 'Fixture Movie', Type: 'Movie' });

        expect(skeleton.getAttribute('aria-busy')).toBe('true');
        expect(skeleton.querySelector('[role="status"]')?.textContent).toContain('Finding strong connections');
        expect(skeleton.querySelectorAll('.ptv-cinematic-skeleton-card')).toHaveLength(4);
    });

    it('retires recommendation work when its owner aborts', async () => {
        const signal = { aborted: true } as AbortSignal;

        const section = await loadPtvCinematicDetailsElement({ Id: 'seed', Name: 'Seed', Type: 'Movie' }, {
            signal
        });

        expect(section).toBeNull();
        expect(recommendationMocks.getHomeData).not.toHaveBeenCalled();
    });

    it('bounds optional enrichment without removing settled metadata navigation', async () => {
        vi.useFakeTimers();
        recommendationMocks.getHomeData.mockReturnValue(new Promise(() => undefined));

        const section = await loadPtvCinematicDetailsElement({
            Genres: ['Drama'],
            Id: 'seed',
            Name: 'Seed',
            Type: 'Movie'
        });

        expect(section?.getAttribute('data-ptv-source-settled')).toBe('false');
        expect(relatedMocks.getRelatedItems).toHaveBeenCalledWith(expect.objectContaining({ Id: 'seed' }), expect.objectContaining({
            includeSimilar: false,
            includeStudios: false
        }));
        expect(section?.querySelectorAll('.ptv-cinematic-card')).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(8000);

        expect(section?.getAttribute('data-ptv-source-settled')).toBe('retired');
        expect(section?.querySelectorAll('.ptv-cinematic-card')).toHaveLength(1);
    });

    it('keeps shelf, card, and artwork nodes when all three enrichments settle without a model change', async () => {
        let resolveRelationships!: (value: []) => void;
        let resolveRelated!: (value: []) => void;
        let resolveHomeData!: (value: PtvRecommendationHomeData) => void;

        relationshipMocks.getRelationships.mockReturnValue(new Promise<[]>(resolve => {
            resolveRelationships = resolve;
        }));
        relatedMocks.getRelatedItems.mockReturnValue(new Promise<[]>(resolve => {
            resolveRelated = resolve;
        }));
        recommendationMocks.getHomeData.mockReturnValue(new Promise<PtvRecommendationHomeData>(resolve => {
            resolveHomeData = resolve;
        }));

        const section = await loadPtvCinematicDetailsElement({
            Genres: ['Drama'], Id: 'seed', Name: 'Seed', Type: 'Movie'
        });
        document.body.append(section as HTMLElement);
        const shelf = section?.querySelector('[data-ptv-shelf-id]');
        const card = shelf?.querySelector('.ptv-cinematic-card');
        const artwork = card?.querySelector('.ptv-cinematic-card__artwork');

        expect(shelf).not.toBeNull();
        expect(card).not.toBeNull();
        expect(artwork).not.toBeNull();
        imageMocks.lazyChildren.mockClear();
        resolveRelationships([]);
        resolveRelated([]);
        resolveHomeData(emptyHomeData);

        await vi.waitFor(() => {
            expect(section?.getAttribute('data-ptv-source-settled')).toBe('true');
        });
        expect.soft(section?.querySelector('[data-ptv-shelf-id]')).toBe(shelf);
        expect.soft(section?.querySelector('.ptv-cinematic-card')).toBe(card);
        expect.soft(section?.querySelector('.ptv-cinematic-card__artwork')).toBe(artwork);
        expect(imageMocks.lazyChildren.mock.calls.length).toBe(0);
    });

    it('adds a relationship shelf while preserving an unchanged shelf and its rail position', async () => {
        let resolveRelationships!: (value: Array<Record<string, unknown>>) => void;
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
        const controller = new AbortController();

        relationshipMocks.getRelationships.mockReturnValue(new Promise(resolve => {
            resolveRelationships = resolve;
        }));
        recommendationMocks.getHomeData.mockReturnValue(new Promise(() => undefined));

        const section = await loadPtvCinematicDetailsElement({
            Genres: ['Drama'], Id: 'seed', Name: 'Seed', Type: 'Movie'
        }, { signal: controller.signal });
        document.body.append(section as HTMLElement);
        const originalShelf = section?.querySelector<HTMLElement>('[data-ptv-shelf-id="universe-entities"]');
        const originalCard = originalShelf?.querySelector('.ptv-cinematic-card');
        const originalArtwork = originalCard?.querySelector('.ptv-cinematic-card__artwork');
        const rail = originalShelf?.querySelector<HTMLElement>('.ptv-cinematic-shelf__rail');
        const initialAction = section?.querySelector<HTMLElement>(
            '[data-ptv-focus-key="details:cinematic:gateway:universe-entities"]'
        );

        expect(originalShelf).not.toBeNull();
        if (rail) rail.scrollLeft = 137;
        initialAction?.focus();
        const browserMove = simulateBrowserShelfMoveScrollReset();

        try {
            resolveRelationships([{
                category: 'soundtrack',
                direction: 'source-to-target',
                displayOrder: 0,
                item: { Id: 'album', Name: 'Album', Type: 'MusicAlbum' }
            }]);

            await vi.waitFor(() => {
                expect(section?.querySelector('[data-ptv-shelf-id="cross-library"] .ptv-cinematic-card')).not.toBeNull();
            });
            expect(section?.querySelector('[data-ptv-shelf-id="universe-entities"]')).toBe(originalShelf);
            expect(originalShelf?.querySelector('.ptv-cinematic-card')).toBe(originalCard);
            expect(originalCard?.querySelector('.ptv-cinematic-card__artwork')).toBe(originalArtwork);
            expect(rail?.scrollLeft).toBe(137);
            expect(browserMove.movedShelfIds).not.toContain('universe-entities');
            expect(section?.contains(document.activeElement)).toBe(true);
            expect(document.activeElement?.getAttribute('data-ptv-focus-key'))
                .toBe('details:cinematic:gateway:universe-entities');
        } finally {
            browserMove.restore();
            controller.abort();
        }
    });

    it('replaces B in A B C D without moving a scrolled unchanged C shelf', async () => {
        let resolveHomeData!: (value: PtvRecommendationHomeData) => void;
        let resolveRelated!: (items: Array<Record<string, unknown>>) => void;
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
        const controller = new AbortController();
        const director = { Id: 'director', Name: 'Exact Director', Type: 'Director' };
        const seed = {
            CollectionName: 'Saga', Id: 'seed', Name: 'Seed', People: [director], Type: 'Movie'
        };
        const score = (item: PtvRecommendationItem): PtvRecommendationScore => ({
            affinityScore: 50,
            discoveryWeight: 20,
            item,
            mediaType: 'movie',
            reasons: [],
            score: 50,
            source: 'fixture'
        });
        const recommended = Array.from({ length: 8 }, (_, index) => score({
            Id: `recommendation-${index}`, Name: `Recommendation ${index}`, Type: 'Movie'
        }));

        recommendationMocks.getHomeData.mockReturnValue(new Promise<PtvRecommendationHomeData>(resolve => {
            resolveHomeData = resolve;
        }));
        relatedMocks.getRelatedItems.mockReturnValue(new Promise(resolve => {
            resolveRelated = resolve;
        }));
        const section = await loadPtvCinematicDetailsElement(seed, { signal: controller.signal });

        document.body.append(section as HTMLElement);
        resolveHomeData({
            ...emptyHomeData,
            candidates: [
                score({ CollectionName: 'Saga', Id: 'timeline', Name: 'Timeline', Type: 'Movie' }),
                score({ Id: 'connection-a', Name: 'Connection A', People: [director], Type: 'Movie' })
            ],
            rows: [{
                explanation: 'Authoritative recommendation fixture.',
                id: 'recommended-for-you',
                items: recommended,
                title: 'Recommended for you'
            }]
        });
        const order = () => Array.from(section?.querySelectorAll<HTMLElement>('[data-ptv-shelf-id]') || [],
            shelf => shelf.dataset.ptvShelfId);
        const expectedOrder = [
            'franchise-order', 'explicit-connections', 'personalized-recommended-for-you', 'universe-entities'
        ];

        await vi.waitFor(() => expect(order()).toEqual(expectedOrder));
        const shelfB = section?.querySelector<HTMLElement>('[data-ptv-shelf-id="explicit-connections"]');
        const shelfC = section?.querySelector<HTMLElement>('[data-ptv-shelf-id="personalized-recommended-for-you"]');
        const shelfD = section?.querySelector<HTMLElement>('[data-ptv-shelf-id="universe-entities"]');
        const cardC = shelfC?.querySelector<HTMLElement>('.ptv-cinematic-card');
        const artworkC = cardC?.querySelector<HTMLElement>('.ptv-cinematic-card__artwork');
        const railC = shelfC?.querySelector<HTMLElement>('.ptv-cinematic-shelf__rail');
        const browserMove = simulateBrowserShelfMoveScrollReset();

        expect(shelfB?.querySelectorAll('.ptv-cinematic-card')).toHaveLength(1);
        expect(shelfC?.querySelectorAll('.ptv-cinematic-card')).toHaveLength(8);
        expect(railC).not.toBeNull();
        if (railC) railC.scrollLeft = 220;
        cardC?.focus();
        expect(document.activeElement).toBe(cardC);
        try {
            resolveRelated([{
                Id: 'connection-b', Name: 'Connection B', People: [director], Type: 'Movie'
            }]);
            await vi.waitFor(() => {
                expect(section?.querySelectorAll('[data-ptv-shelf-id="explicit-connections"] .ptv-cinematic-card'))
                    .toHaveLength(2);
            });
            expect(order()).toEqual(expectedOrder);
            expect(section?.querySelector('[data-ptv-shelf-id="explicit-connections"]')).not.toBe(shelfB);
            expect(section?.querySelector('[data-ptv-shelf-id="universe-entities"]')).not.toBe(shelfD);
            expect(section?.querySelector('[data-ptv-shelf-id="personalized-recommended-for-you"]')).toBe(shelfC);
            expect(shelfC?.querySelector('.ptv-cinematic-card')).toBe(cardC);
            expect(cardC?.querySelector('.ptv-cinematic-card__artwork')).toBe(artworkC);
            expect(railC?.scrollLeft).toBe(220);
            expect(browserMove.movedShelfIds).not.toContain('personalized-recommended-for-you');
            expect(document.activeElement).toBe(cardC);
        } finally {
            browserMove.restore();
            controller.abort();
        }
    });

    it('removes an obsolete shelf before an unchanged scrolled shelf without moving the latter', async () => {
        let resolveHomeData!: (value: PtvRecommendationHomeData) => void;
        let resolveRelated!: (items: Array<Record<string, unknown>>) => void;
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
        const controller = new AbortController();
        const director = { Id: 'director', Name: 'Exact Director', Type: 'Director' };

        recommendationMocks.getHomeData.mockReturnValue(new Promise<PtvRecommendationHomeData>(resolve => {
            resolveHomeData = resolve;
        }));
        relatedMocks.getRelatedItems.mockReturnValue(new Promise(resolve => {
            resolveRelated = resolve;
        }));
        const section = await loadPtvCinematicDetailsElement({
            Genres: ['Drama'], Id: 'seed', Name: 'Seed', People: [director], Type: 'Movie'
        }, { signal: controller.signal });

        document.body.append(section as HTMLElement);
        const recommended: PtvRecommendationScore = {
            affinityScore: 50,
            discoveryWeight: 20,
            item: { Id: 'shared', Name: 'Shared', Type: 'Movie' },
            mediaType: 'movie',
            reasons: [],
            score: 50,
            source: 'fixture'
        };

        resolveHomeData({
            ...emptyHomeData,
            candidates: [recommended],
            rows: [{
                explanation: 'Authoritative recommendation fixture.',
                id: 'recommended-for-you',
                items: [recommended],
                title: 'Recommended for you'
            }]
        });
        const order = () => Array.from(section?.querySelectorAll<HTMLElement>('[data-ptv-shelf-id]') || [],
            shelf => shelf.dataset.ptvShelfId);

        await vi.waitFor(() => expect(order()).toEqual(['personalized-recommended-for-you', 'universe-entities']));
        const shelf = section?.querySelector<HTMLElement>('[data-ptv-shelf-id="universe-entities"]');
        const card = shelf?.querySelector<HTMLElement>('.ptv-cinematic-card');
        const artwork = card?.querySelector<HTMLElement>('.ptv-cinematic-card__artwork');
        const rail = shelf?.querySelector<HTMLElement>('.ptv-cinematic-shelf__rail');

        expect(rail).not.toBeNull();
        if (rail) rail.scrollLeft = 137;
        card?.focus();
        const browserMove = simulateBrowserShelfMoveScrollReset();

        try {
            resolveRelated([{ Genres: ['Drama'], Id: 'shared', Name: 'Shared', Type: 'Movie' }]);
            await vi.waitFor(() => expect(order()).toEqual(['explicit-connections', 'universe-entities']));
            expect(section?.querySelector('[data-ptv-shelf-id="universe-entities"]')).toBe(shelf);
            expect(shelf?.querySelector('.ptv-cinematic-card')).toBe(card);
            expect(card?.querySelector('.ptv-cinematic-card__artwork')).toBe(artwork);
            expect(rail?.scrollLeft).toBe(137);
            expect(browserMove.movedShelfIds).not.toContain('universe-entities');
            expect(document.activeElement).toBe(card);
        } finally {
            browserMove.restore();
            controller.abort();
        }
    });

    it.each([
        { direction: 'ltr', scrollLeft: 220 },
        { direction: 'rtl', scrollLeft: -220 }
    ])('preserves $direction rail position and focus when a reused shelf genuinely must move', async ({
        direction, scrollLeft
    }) => {
        let resolveHomeData!: (value: PtvRecommendationHomeData) => void;
        let resolveRelated!: (items: Array<Record<string, unknown>>) => void;
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
        const controller = new AbortController();

        recommendationMocks.getHomeData.mockReturnValue(new Promise<PtvRecommendationHomeData>(resolve => {
            resolveHomeData = resolve;
        }));
        relatedMocks.getRelatedItems.mockReturnValue(new Promise(resolve => {
            resolveRelated = resolve;
        }));
        const section = await loadPtvCinematicDetailsElement({
            Id: 'seed', Name: 'Seed', People: [{ Id: 'director', Name: 'Director', Type: 'Director' }], Type: 'Movie'
        }, { signal: controller.signal });

        document.body.append(section as HTMLElement);
        const recommended = Array.from({ length: 8 }, (_, index): PtvRecommendationScore => ({
            affinityScore: 50,
            discoveryWeight: 20,
            item: { Id: `recommendation-${index}`, Name: `Recommendation ${index}`, Type: 'Movie' },
            mediaType: 'movie',
            reasons: [],
            score: 50,
            source: 'fixture'
        }));

        resolveHomeData({
            ...emptyHomeData,
            rows: [{
                explanation: 'Authoritative recommendation fixture.',
                id: 'recommended-for-you',
                items: recommended,
                title: 'Recommended for you'
            }]
        });
        const shelves = section?.querySelector<HTMLElement>('.ptv-cinematic-details__shelves');
        const order = () => Array.from(shelves?.children || [], shelf => (shelf as HTMLElement).dataset.ptvShelfId);

        await vi.waitFor(() => expect(order()).toEqual(['personalized-recommended-for-you', 'universe-entities']));
        const personalized = shelves?.querySelector<HTMLElement>('[data-ptv-shelf-id="personalized-recommended-for-you"]');
        const universe = shelves?.querySelector<HTMLElement>('[data-ptv-shelf-id="universe-entities"]');
        const personalizedRail = personalized?.querySelector<HTMLElement>('.ptv-cinematic-shelf__rail');
        const universeRail = universe?.querySelector<HTMLElement>('.ptv-cinematic-shelf__rail');
        const focusedCard = personalized?.querySelector<HTMLElement>('.ptv-cinematic-card');

        expect(personalized).not.toBeNull();
        expect(universe).not.toBeNull();
        expect(personalizedRail).not.toBeNull();
        expect(universeRail).not.toBeNull();
        if (personalized && universe) shelves?.insertBefore(universe, personalized);
        expect(order()).toEqual(['universe-entities', 'personalized-recommended-for-you']);
        for (const rail of [personalizedRail, universeRail]) {
            if (!rail) continue;
            Object.defineProperty(rail, 'scrollWidth', { configurable: true, value: 600 });
            Object.defineProperty(rail, 'clientWidth', { configurable: true, value: 200 });
            rail.style.direction = direction;
        }
        if (personalizedRail) personalizedRail.scrollLeft = scrollLeft;
        if (universeRail) universeRail.scrollLeft = 137;
        expect(window.getComputedStyle(personalizedRail as HTMLElement).direction).toBe(direction);
        focusedCard?.focus();
        const browserMove = simulateBrowserShelfMoveScrollReset();

        try {
            resolveRelated([]);
            await vi.waitFor(() => expect(order()).toEqual(['personalized-recommended-for-you', 'universe-entities']));
            expect(shelves?.querySelector('[data-ptv-shelf-id="personalized-recommended-for-you"]')).toBe(personalized);
            expect(shelves?.querySelector('[data-ptv-shelf-id="universe-entities"]')).toBe(universe);
            expect(browserMove.movedShelfIds).toHaveLength(1);
            expect(personalizedRail?.scrollLeft).toBe(scrollLeft);
            expect(universeRail?.scrollLeft).toBe(137);
            expect(document.activeElement).toBe(focusedCard);
        } finally {
            browserMove.restore();
            controller.abort();
        }
    });

    it('routes an enriched gateway action to a shelf connected to the active section', async () => {
        let resolveHomeData!: (value: PtvRecommendationHomeData) => void;

        recommendationMocks.getHomeData.mockReturnValue(new Promise<PtvRecommendationHomeData>(resolve => {
            resolveHomeData = resolve;
        }));
        const section = await loadPtvCinematicDetailsElement({
            Genres: ['Drama'], Id: 'seed', Name: 'Seed', Type: 'Movie'
        });
        document.body.append(section as HTMLElement);
        resolveHomeData(emptyHomeData);

        await vi.waitFor(() => {
            expect(section?.getAttribute('data-ptv-source-settled')).toBe('true');
        });
        const action = section?.querySelector<HTMLElement>('.ptv-cinematic-details__action');
        const shelf = section?.querySelector<HTMLElement>('[data-ptv-shelf-id="universe-entities"]');
        const target = shelf?.querySelector<HTMLElement>('[data-ptv-focus-key]');

        expect(action).not.toBeNull();
        expect(target).not.toBeNull();
        if (shelf) shelf.scrollIntoView = vi.fn();
        focusMocks.focusElement.mockClear();
        action?.click();
        expect(focusMocks.focusElement).toHaveBeenCalledWith(target, 'details-cinematic-gateway');
        expect(section?.contains(target as Node)).toBe(true);
    });

    it('renders exact library relationships after the broad source retires', async () => {
        vi.useFakeTimers();
        recommendationMocks.getHomeData.mockReturnValue(new Promise(() => undefined));
        let resolveRelated!: (items: Array<Record<string, unknown>>) => void;
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
        const controller = new AbortController();

        relatedMocks.getRelatedItems.mockReturnValue(new Promise(resolve => {
            resolveRelated = resolve;
        }));

        const section = await loadPtvCinematicDetailsElement({
            Id: 'seed',
            Name: 'Seed',
            Tags: ['exact-connection'],
            Type: 'Movie'
        }, {
            signal: controller.signal
        });

        document.body.append(section as HTMLElement);
        await vi.advanceTimersByTimeAsync(8000);
        await vi.advanceTimersByTimeAsync(250);
        resolveRelated([{
            Id: 'related',
            Name: 'Related',
            Tags: ['exact-connection'],
            Type: 'Movie'
        }]);
        await vi.advanceTimersByTimeAsync(0);

        expect(section?.getAttribute('data-ptv-source-settled')).toBe('retired');
        expect(section?.querySelector('[data-ptv-shelf-id="explicit-connections"] .ptv-cinematic-card__title')?.textContent)
            .toBe('Related');
        expect(section?.isConnected).toBe(true);
        expect(section?.hidden).toBe(false);
        controller.abort();
    });

    it('renders an authoritative relationship without waiting for recommendation scans', async () => {
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
        const controller = new AbortController();

        recommendationMocks.getHomeData.mockReturnValue(new Promise(() => undefined));
        relationshipMocks.getRelationships.mockResolvedValue([{
            category: 'soundtrack',
            direction: 'source-to-target',
            displayOrder: 0,
            item: { Id: 'album', Name: 'Album', Type: 'MusicAlbum' }
        }]);

        const section = await loadPtvCinematicDetailsElement({
            Genres: ['Drama'],
            Id: 'seed',
            Name: 'Seed',
            Type: 'Movie'
        }, {
            signal: controller.signal
        });

        await vi.waitFor(() => {
            expect(section?.querySelector('[data-ptv-shelf-id="cross-library"]')).not.toBeNull();
        });
        expect(section?.querySelector('[data-ptv-shelf-id="cross-library"] a')?.getAttribute('href'))
            .toBe('#/details?id=album');
        expect(section?.getAttribute('data-ptv-source-settled')).toBe('false');
        controller.abort();
    });

    it('renders an authoritative relationship without discovery metadata or recommendation settlement', async () => {
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
        const controller = new AbortController();

        recommendationMocks.getHomeData.mockReturnValue(new Promise(() => undefined));
        relationshipMocks.getRelationships.mockResolvedValue([{
            category: 'adaptation',
            direction: 'source-to-target',
            displayOrder: 0,
            item: { Id: 'book', Name: 'Book', Type: 'Book' }
        }]);

        const section = await loadPtvCinematicDetailsElement({
            Id: 'seed',
            Name: 'Seed',
            Type: 'Movie'
        }, {
            signal: controller.signal
        });

        await vi.waitFor(() => {
            expect(section?.querySelector('[data-ptv-shelf-id="cross-library"]')).not.toBeNull();
        });
        expect(section?.getAttribute('data-ptv-source-settled')).toBe('false');
        controller.abort();
    });

    it('hides hung no-discovery enrichment at eight seconds and removes it on owner abort', async () => {
        vi.useFakeTimers();
        let relationshipSignal: AbortSignal | undefined;
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
        const controller = new AbortController();

        recommendationMocks.getHomeData.mockReturnValue(new Promise(() => undefined));
        relationshipMocks.getRelationships.mockImplementation((_itemId, options) => {
            relationshipSignal = options?.signal;
            return new Promise(() => undefined);
        });

        const section = await loadPtvCinematicDetailsElement({ Id: 'seed', Name: 'Seed', Type: 'Movie' }, {
            signal: controller.signal
        });

        document.body.append(section as HTMLElement);
        expect(section?.getAttribute('aria-busy')).toBe('true');

        await vi.advanceTimersByTimeAsync(8000);
        await vi.runOnlyPendingTimersAsync();

        expect(relationshipSignal?.aborted).toBe(true);
        expect(section?.getAttribute('data-ptv-source-settled')).toBe('retired');
        expect(section?.hidden).toBe(true);
        expect(section?.isConnected).toBe(true);

        controller.abort();
        await vi.runOnlyPendingTimersAsync();
        expect(section?.isConnected).toBe(false);
    });

    it('removes a retired empty section when both allowed late sources settle without a shelf', async () => {
        vi.useFakeTimers();
        let resolveRelationships!: (value: []) => void;
        let resolveRelated!: (value: []) => void;

        recommendationMocks.getHomeData.mockReturnValue(new Promise(() => undefined));
        relationshipMocks.getRelationships.mockReturnValue(new Promise<[]>(resolve => {
            resolveRelationships = resolve;
        }));
        relatedMocks.getRelatedItems.mockReturnValue(new Promise<[]>(resolve => {
            resolveRelated = resolve;
        }));
        const section = await loadPtvCinematicDetailsElement({ Id: 'seed', Name: 'Seed', Type: 'Movie' });

        document.body.append(section as HTMLElement);
        await vi.advanceTimersByTimeAsync(8000);
        expect(section?.hidden).toBe(true);
        expect(section?.isConnected).toBe(true);

        resolveRelationships([]);
        resolveRelated([]);
        await vi.advanceTimersByTimeAsync(0);
        expect(section?.isConnected).toBe(false);
    });

    it('preserves rail scroll when late enrichment replaces cinematic children', async () => {
        let resolveHomeData!: (value: PtvRecommendationHomeData) => void;
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
        const controller = new AbortController();

        relationshipMocks.getRelationships.mockReturnValue(new Promise(() => undefined));
        recommendationMocks.getHomeData.mockReturnValue(new Promise<PtvRecommendationHomeData>(resolve => {
            resolveHomeData = resolve;
        }));

        const section = await loadPtvCinematicDetailsElement({
            Genres: ['Drama'],
            Id: 'seed',
            Name: 'Seed',
            Type: 'Movie'
        }, {
            signal: controller.signal
        });
        const initialRail = section?.querySelector<HTMLElement>('.ptv-cinematic-shelf__rail');

        if (initialRail) initialRail.scrollLeft = 137;
        resolveHomeData({
            candidates: [],
            generatedAt: 1,
            mixes: [],
            profileUpdatedAt: 1,
            quality: {
                duplicateItemsRemoved: 0,
                rowOverlapPercentage: 0,
                scoreDistribution: { buckets: [], max: 0, median: 0, min: 0, p25: 0, p75: 0, p90: 0 },
                unresolvedArtistCount: 0
            },
            rows: []
        });

        await vi.waitFor(() => {
            expect(section?.getAttribute('data-ptv-source-settled')).toBe('true');
        });
        expect(section?.querySelector<HTMLElement>('.ptv-cinematic-shelf__rail')?.scrollLeft).toBe(137);
        controller.abort();
    });

    it('restores changed-shelf rail scroll after its replacement is connected', async () => {
        let resolveRelated!: (items: Array<Record<string, unknown>>) => void;
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
        const controller = new AbortController();
        const director = { Id: 'director', Name: 'Exact Director', Type: 'Director' };
        const seed = { Genres: ['Drama'], Id: 'seed', Name: 'Seed', People: [director], Type: 'Movie' };
        const initialCandidate = { Genres: ['Drama'], Id: 'first', Name: 'First', Type: 'Movie' };
        const originalScrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollLeft');
        const connectedOffsets = new WeakMap<HTMLElement, number>();

        // Model browsers that clamp a detached rail's scroll position to zero.
        Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
            configurable: true,
            get(this: HTMLElement) { return connectedOffsets.get(this) || 0; },
            set(this: HTMLElement, value: number) {
                if (this.isConnected) connectedOffsets.set(this, value);
            }
        });

        try {
            recommendationMocks.getHomeData.mockResolvedValue({
                ...emptyHomeData,
                candidates: [{
                    affinityScore: 50,
                    discoveryWeight: 20,
                    item: initialCandidate,
                    mediaType: 'movie',
                    reasons: [],
                    score: 50,
                    source: 'fixture'
                }]
            });
            relatedMocks.getRelatedItems.mockReturnValue(new Promise(resolve => {
                resolveRelated = resolve;
            }));
            const section = await loadPtvCinematicDetailsElement(seed, { signal: controller.signal });

            document.body.append(section as HTMLElement);
            await vi.waitFor(() => {
                expect(section?.querySelector('[data-ptv-shelf-id="explicit-connections"]')).not.toBeNull();
            });
            const originalShelf = section?.querySelector<HTMLElement>('[data-ptv-shelf-id="explicit-connections"]');
            const originalRail = originalShelf?.querySelector<HTMLElement>('.ptv-cinematic-shelf__rail');

            if (originalRail) originalRail.scrollLeft = 137;
            resolveRelated([{
                Id: 'second', Name: 'Second', People: [director], Type: 'Movie'
            }]);
            await vi.waitFor(() => {
                expect(section?.querySelectorAll('[data-ptv-shelf-id="explicit-connections"] .ptv-cinematic-card'))
                    .toHaveLength(2);
            });
            const updatedShelf = section?.querySelector<HTMLElement>('[data-ptv-shelf-id="explicit-connections"]');

            expect(updatedShelf).not.toBe(originalShelf);
            expect(updatedShelf?.querySelector<HTMLElement>('.ptv-cinematic-shelf__rail')?.scrollLeft).toBe(137);
        } finally {
            controller.abort();
            if (originalScrollDescriptor) {
                Object.defineProperty(HTMLElement.prototype, 'scrollLeft', originalScrollDescriptor);
            } else {
                Reflect.deleteProperty(HTMLElement.prototype, 'scrollLeft');
            }
        }
    });

    it('keeps active gateway focus when unchanged enrichment settles', async () => {
        let resolveHomeData!: (value: PtvRecommendationHomeData) => void;
        const homeData = new Promise<PtvRecommendationHomeData>(resolve => {
            resolveHomeData = resolve;
        });

        recommendationMocks.getHomeData.mockReturnValue(homeData);

        const section = await loadPtvCinematicDetailsElement({
            Genres: ['Drama'],
            Id: 'seed',
            Name: 'Seed',
            Type: 'Movie'
        });

        document.body.append(section as HTMLElement);
        const initialAction = section?.querySelector<HTMLElement>('.ptv-cinematic-details__action');

        initialAction?.focus();
        expect(document.activeElement).toBe(initialAction);

        resolveHomeData({
            candidates: [],
            generatedAt: 1,
            mixes: [],
            profileUpdatedAt: 1,
            quality: {
                duplicateItemsRemoved: 0,
                rowOverlapPercentage: 0,
                scoreDistribution: { buckets: [], max: 0, median: 0, min: 0, p25: 0, p75: 0, p90: 0 },
                unresolvedArtistCount: 0
            },
            rows: []
        });

        await vi.waitFor(() => {
            expect(section?.getAttribute('data-ptv-source-settled')).toBe('true');
        });

        const enrichedAction = section?.querySelector<HTMLElement>('.ptv-cinematic-details__action');

        expect(enrichedAction).toBe(initialAction);
        expect(enrichedAction?.dataset.ptvFocusKey).toBe('details:cinematic:gateway:universe-entities');
        expect(focusMocks.focusElement).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(initialAction);
    });

    it('delegates artwork loading to the existing image owner', () => {
        const section = createPtvCinematicDetailsElement(model);

        activatePtvCinematicDetailsArtwork(section);

        expect(imageMocks.lazyChildren).toHaveBeenCalledOnce();
        expect(imageMocks.lazyChildren).toHaveBeenCalledWith(section);
    });

    it('derives canonical routing hints from each destination media family', () => {
        const types = ['Movie', 'Series', 'MusicAlbum', 'MusicArtist', 'Book', 'Comic', 'Manga', 'Photo'];
        const routingModel: PtvCinematicDetailsModel = {
            ...model,
            shelves: [{
                ...model.shelves[0],
                items: types.map(type => ({
                    item: { Id: type, Name: type, Type: type },
                    itemId: type,
                    reason: 'Configured Connection',
                    subtitle: type,
                    title: type
                }))
            }]
        };

        createPtvCinematicDetailsElement(routingModel);

        const mediaTypeByDestination = Object.fromEntries(routeMocks.resolve.mock.calls.map(([item, options]) => [
            item.Type,
            options?.mediaType
        ]));

        expect(mediaTypeByDestination).toEqual({
            Book: 'book',
            Comic: 'book',
            Manga: 'book',
            Movie: undefined,
            MusicAlbum: 'music',
            MusicArtist: 'music',
            Photo: undefined,
            Series: undefined
        });
    });
});
