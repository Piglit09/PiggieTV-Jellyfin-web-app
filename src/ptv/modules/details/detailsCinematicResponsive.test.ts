import { describe, expect, it, vi } from 'vitest';

vi.mock('../recommendations/engine/recommendationEngine', () => ({
    getPtvRecommendationHomeData: vi.fn()
}));

vi.mock('../../../components/images/imageLoader', () => ({
    default: {
        lazyChildren: vi.fn()
    }
}));

vi.mock('../../api', () => ({
    getPtvItemImageCandidates: vi.fn(() => [])
}));

vi.mock('../../core/itemRoutes', () => ({
    recordPtvItemRouteClick: vi.fn(),
    resolvePtvItemRoute: vi.fn(item => ({
        fallbackReason: '',
        href: `#/details?id=${item.Id}`,
        routeSource: 'jellyfin-fallback'
    }))
}));

vi.mock('../../core/tvFocus', () => ({
    focusPtvTvElement: vi.fn()
}));

vi.mock('./detailsAuthoritativeRelationships', () => ({
    getPtvAuthoritativeRelationships: vi.fn(() => Promise.resolve([]))
}));

import type { PtvCinematicDetailsModel } from './detailsCinematicModel';
import { createPtvCinematicDetailsElement } from './detailsCinematicExperience';

const model: PtvCinematicDetailsModel = {
    candidateCount: 2,
    dedupedCandidateCount: 0,
    facts: ['Movie'],
    family: 'video',
    gateway: {
        actions: [{ label: 'Release order', shelfId: 'timeline' }],
        description: 'Evidence-backed connections.',
        metadata: ['Drama', 'Studio'],
        stats: ['2 video'],
        title: 'Fixture Universe'
    },
    kicker: 'Explore this universe',
    shelves: [{
        description: 'Ordered by release date.',
        id: 'timeline',
        items: [0, 1].map(index => ({
            item: { Id: `item-${index}`, Name: `Item ${index}`, Type: 'Movie' },
            itemId: `item-${index}`,
            kind: 'media' as const,
            reason: 'Same Collection',
            reasonChips: ['Same Collection'],
            sequence: index + 1,
            subtitle: 'Movie',
            title: `Item ${index}`
        })),
        orderExplanation: 'Ordered by release date.',
        orderLabel: 'Release order',
        orderSource: 'release',
        presentation: 'timeline',
        relationship: 'explicit-collection',
        title: 'Release timeline'
    }],
    summary: 'Evidence-backed connections.',
    title: 'Fixture'
};

describe('F4A cinematic rendering', () => {
    it('renders a dense gateway, timeline, explanation chips, and unique focus keys', () => {
        const section = createPtvCinematicDetailsElement(model);

        document.body.append(section);
        const keys = Array.from(section.querySelectorAll('[data-ptv-focus-key]')).map(node => node.getAttribute('data-ptv-focus-key'));

        expect(section.querySelector('h2')?.textContent).toBe('Fixture Universe');
        expect(section.querySelectorAll('.ptv-cinematic-details__stat')).toHaveLength(1);
        expect(section.querySelector('.ptv-cinematic-shelf--timeline')).toBeTruthy();
        expect(section.querySelectorAll('.ptv-cinematic-card__reason')).toHaveLength(2);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('keeps card focus keys tied to identity when enrichment changes row order', () => {
        const first = createPtvCinematicDetailsElement(model);
        const reordered = createPtvCinematicDetailsElement({
            ...model,
            shelves: model.shelves.map(shelf => ({
                ...shelf,
                items: [...shelf.items].reverse()
            }))
        });
        const keyByItem = (section: HTMLElement) => Object.fromEntries(
            Array.from(section.querySelectorAll<HTMLElement>('.ptv-cinematic-card'))
                .map(card => [
                    card.getAttribute('href'),
                    card.dataset.ptvFocusKey
                ])
        );

        expect(keyByItem(reordered)).toEqual(keyByItem(first));
    });

    it('omits empty sections and keeps the primary gateway independent', () => {
        const empty = createPtvCinematicDetailsElement({ ...model, shelves: [] });

        expect(empty.querySelector('h2')?.textContent).toBe('Fixture Universe');
        expect(empty.querySelectorAll('.ptv-cinematic-shelf')).toHaveLength(0);
    });

    it('commits the first progressive shelf before its host inserts the detached section', () => {
        const section = createPtvCinematicDetailsElement(model, { progressive: true });

        expect(section.isConnected).toBe(false);
        expect(section.querySelectorAll('.ptv-cinematic-shelf')).toHaveLength(1);
        expect(section.getAttribute('data-ptv-settled-shelf-count')).toBe('1');
    });
});
