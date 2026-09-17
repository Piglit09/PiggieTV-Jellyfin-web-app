import { describe, expect, it } from 'vitest';

import {
    createPtvReadingArtworkLifecycle,
    getPtvReadingArtworkActiveSource,
    transitionPtvReadingArtworkLifecycle
} from './readingArtworkLifecycle';

function error(state: ReturnType<typeof createPtvReadingArtworkLifecycle>) {
    return transitionPtvReadingArtworkLifecycle(state, {
        attemptKey: state.attemptKey,
        lifecycleKey: state.lifecycleKey,
        type: 'error'
    });
}

describe('Reading artwork lifecycle', () => {
    it('moves from primary to alternate to a terminal placeholder without looping', () => {
        const initial = createPtvReadingArtworkLifecycle({
            alternateSrc: '/alternate.jpg',
            generation: 'tag-1',
            identity: 'item-1',
            placeholderSrc: '/placeholder.svg',
            primarySrc: '/primary.jpg'
        });
        const primaryFailure = error(initial);
        const alternateFailure = error(primaryFailure.state);
        const placeholderFailure = error(alternateFailure.state);
        const duplicateFailure = error(placeholderFailure.state);

        expect(getPtvReadingArtworkActiveSource(initial)).toEqual({
            kind: 'primary',
            src: '/primary.jpg'
        });
        expect(primaryFailure.outcome).toMatchObject({ nextSource: 'alternate', terminal: false });
        expect(getPtvReadingArtworkActiveSource(primaryFailure.state).kind).toBe('alternate');
        expect(alternateFailure.outcome).toMatchObject({ nextSource: 'placeholder', terminal: false });
        expect(getPtvReadingArtworkActiveSource(alternateFailure.state).kind).toBe('placeholder');
        expect(placeholderFailure.outcome).toMatchObject({
            source: 'placeholder',
            status: 'failed',
            terminal: true
        });
        expect(placeholderFailure.state.phase).toBe('failed');
        expect(duplicateFailure).toEqual({
            accepted: false,
            outcome: null,
            state: placeholderFailure.state
        });
    });

    it('rejects callbacks issued for an older artwork generation', () => {
        const oldGeneration = createPtvReadingArtworkLifecycle({
            alternateSrc: '/old-alternate.jpg',
            generation: 'old-tag',
            identity: 'item-1',
            placeholderSrc: '/placeholder.svg',
            primarySrc: '/old-primary.jpg'
        });
        const newGeneration = createPtvReadingArtworkLifecycle({
            alternateSrc: '/new-alternate.jpg',
            generation: 'new-tag',
            identity: 'item-1',
            placeholderSrc: '/placeholder.svg',
            primarySrc: '/new-primary.jpg'
        });
        const staleTransition = transitionPtvReadingArtworkLifecycle(newGeneration, {
            attemptKey: oldGeneration.attemptKey,
            lifecycleKey: oldGeneration.lifecycleKey,
            type: 'error'
        });

        expect(staleTransition.accepted).toBe(false);
        expect(staleTransition.state).toBe(newGeneration);
        expect(getPtvReadingArtworkActiveSource(staleTransition.state).src).toBe('/new-primary.jpg');
    });

    it('rejects a late load from a failed source after its fallback begins', () => {
        const initial = createPtvReadingArtworkLifecycle({
            alternateSrc: '/alternate.jpg',
            generation: 2,
            identity: 'item-2',
            placeholderSrc: '/placeholder.svg',
            primarySrc: '/primary.jpg'
        });
        const primaryFailure = error(initial);
        const staleLoad = transitionPtvReadingArtworkLifecycle(primaryFailure.state, {
            attemptKey: initial.attemptKey,
            lifecycleKey: initial.lifecycleKey,
            type: 'load'
        });

        expect(staleLoad.accepted).toBe(false);
        expect(staleLoad.state).toBe(primaryFailure.state);
        expect(getPtvReadingArtworkActiveSource(staleLoad.state).kind).toBe('alternate');
    });

    it('starts from the first available source while retaining placeholder termination', () => {
        const withoutPrimary = createPtvReadingArtworkLifecycle({
            alternateSrc: '/alternate.jpg',
            generation: 1,
            identity: 'item-3',
            placeholderSrc: '/placeholder.svg'
        });
        const placeholderOnly = createPtvReadingArtworkLifecycle({
            generation: 1,
            identity: 'item-4',
            placeholderSrc: '/placeholder.svg'
        });

        expect(getPtvReadingArtworkActiveSource(withoutPrimary).kind).toBe('alternate');
        expect(getPtvReadingArtworkActiveSource(error(withoutPrimary).state).kind).toBe('placeholder');
        expect(getPtvReadingArtworkActiveSource(placeholderOnly).kind).toBe('placeholder');
    });

    it('advances through arbitrary backdrop candidates in deterministic order', () => {
        const initial = createPtvReadingArtworkLifecycle({
            generation: 'backdrop-tag-1',
            identity: 'item-backdrop',
            placeholderSrc: '/placeholder.svg',
            sources: [
                { kind: 'backdrop', src: '/backdrop.jpg' },
                { kind: 'parent-primary', src: '/parent-primary.jpg' },
                { kind: 'thumb', src: '/thumb.jpg' },
                { kind: 'primary', src: '/backdrop.jpg' }
            ]
        });
        const backdropFailure = error(initial);
        const parentFailure = error(backdropFailure.state);
        const thumbFailure = error(parentFailure.state);

        expect(initial.sources).toEqual([
            { kind: 'backdrop', src: '/backdrop.jpg' },
            { kind: 'parent-primary', src: '/parent-primary.jpg' },
            { kind: 'thumb', src: '/thumb.jpg' },
            { kind: 'placeholder', src: '/placeholder.svg' }
        ]);
        expect(backdropFailure.outcome).toMatchObject({
            nextSource: 'parent-primary',
            source: 'backdrop',
            terminal: false
        });
        expect(parentFailure.outcome).toMatchObject({
            nextSource: 'thumb',
            source: 'parent-primary',
            terminal: false
        });
        expect(thumbFailure.outcome).toMatchObject({
            nextSource: 'placeholder',
            source: 'thumb',
            terminal: false
        });
        expect(getPtvReadingArtworkActiveSource(thumbFailure.state)).toEqual({
            kind: 'placeholder',
            src: '/placeholder.svg'
        });
    });

    it('rejects a pending callback when the item identity changes with the same generation label', () => {
        const oldItem = createPtvReadingArtworkLifecycle({
            generation: 'shared-tag',
            identity: 'item-old',
            placeholderSrc: '/placeholder.svg',
            sources: [{ kind: 'backdrop', src: '/old-backdrop.jpg' }]
        });
        const newItem = createPtvReadingArtworkLifecycle({
            generation: 'shared-tag',
            identity: 'item-new',
            placeholderSrc: '/placeholder.svg',
            sources: [{ kind: 'backdrop', src: '/new-backdrop.jpg' }]
        });
        const staleTransition = transitionPtvReadingArtworkLifecycle(newItem, {
            attemptKey: oldItem.attemptKey,
            lifecycleKey: oldItem.lifecycleKey,
            type: 'error'
        });

        expect(staleTransition.accepted).toBe(false);
        expect(staleTransition.state).toBe(newItem);
        expect(getPtvReadingArtworkActiveSource(staleTransition.state)).toEqual({
            kind: 'backdrop',
            src: '/new-backdrop.jpg'
        });
    });
});
