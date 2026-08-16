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

import type { PtvRecommendationHomeData } from '../recommendations/types/recommendationTypes';
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

    it('renders exact library relationships after the broad source retires', async () => {
        vi.useFakeTimers();
        recommendationMocks.getHomeData.mockReturnValue(new Promise(() => undefined));
        let resolveRelated!: (items: Array<Record<string, unknown>>) => void;

        relatedMocks.getRelatedItems.mockReturnValue(new Promise(resolve => {
            resolveRelated = resolve;
        }));

        const director = { Id: 'director', Name: 'Exact Director', Type: 'Director' };
        const section = await loadPtvCinematicDetailsElement({
            Id: 'seed',
            Name: 'Seed',
            People: [director],
            Type: 'Movie'
        });

        await vi.advanceTimersByTimeAsync(8000);
        resolveRelated([{
            Id: 'related',
            Name: 'Related',
            People: [director],
            Type: 'Movie'
        }]);
        await vi.advanceTimersByTimeAsync(0);

        expect(section?.getAttribute('data-ptv-source-settled')).toBe('retired');
        expect(section?.querySelector('[data-ptv-shelf-id="explicit-connections"] .ptv-cinematic-card__title')?.textContent)
            .toBe('Related');
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

    it('retires hung no-discovery enrichment at the shared eight-second bound', async () => {
        vi.useFakeTimers();
        let relationshipSignal: AbortSignal | undefined;

        recommendationMocks.getHomeData.mockReturnValue(new Promise(() => undefined));
        relationshipMocks.getRelationships.mockImplementation((_itemId, options) => {
            relationshipSignal = options?.signal;
            return new Promise(() => undefined);
        });

        const section = await loadPtvCinematicDetailsElement({ Id: 'seed', Name: 'Seed', Type: 'Movie' });

        document.body.append(section as HTMLElement);
        expect(section?.getAttribute('aria-busy')).toBe('true');

        await vi.advanceTimersByTimeAsync(8000);
        await vi.runOnlyPendingTimersAsync();

        expect(relationshipSignal?.aborted).toBe(true);
        expect(section?.getAttribute('data-ptv-source-settled')).toBe('retired');
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

    it('restores active cinematic focus through the existing focus owner after enrichment', async () => {
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

        expect(enrichedAction).not.toBe(initialAction);
        expect(enrichedAction?.dataset.ptvFocusKey).toBe('details:cinematic:gateway:universe-entities');
        expect(focusMocks.focusElement).toHaveBeenCalledWith(enrichedAction, 'details-cinematic-enrichment');
        expect(document.activeElement).toBe(enrichedAction);
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
