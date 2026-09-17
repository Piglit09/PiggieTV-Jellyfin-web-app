import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PtvItemImageCandidate } from '../../api/images';
import {
    createPtvMusicImageCandidateSelection,
    getRememberedPtvMusicImageCandidate,
    resetPtvMusicImageCandidateSelectionForTests,
    selectPtvMusicImageCandidate
} from './musicImageCandidateSelection';

vi.mock('../../api/images', () => ({
    hasPtvImageCandidateFailed: vi.fn(() => false),
    markPtvImageCandidateFailed: vi.fn()
}));

function getCandidate(
    id: string,
    overrides: Partial<PtvItemImageCandidate> = {}
): PtvItemImageCandidate {
    return {
        imageItemId: id,
        imageType: 'Primary',
        requestedType: 'Primary',
        tag: `${id}-tag`,
        tagMode: 'tagged-primary',
        url: `https://media.example/items/${id}/images/Primary?tag=${id}-tag`,
        ...overrides
    };
}

function getFailureKey(candidate: PtvItemImageCandidate) {
    const origin = candidate.url.split('/items/')[0];

    return [ origin, candidate.imageItemId, candidate.imageType, candidate.tag || 'untagged' ].join(':');
}

function createFailureRegistry() {
    const failedKeys = new Set<string>();
    const hasFailed = vi.fn((candidate: PtvItemImageCandidate) => failedKeys.has(getFailureKey(candidate)));
    const markFailed = vi.fn((candidate: PtvItemImageCandidate) => {
        failedKeys.add(getFailureKey(candidate));
    });

    return {
        failedKeys,
        registry: { hasFailed, markFailed }
    };
}

afterEach(() => {
    resetPtvMusicImageCandidateSelectionForTests();
});

describe('PiggieTV Music image candidate selection', () => {
    it('chooses the first nonfailed tagged candidate before an earlier untagged fallback', () => {
        const { registry } = createFailureRegistry();
        const selection = createPtvMusicImageCandidateSelection({ failureRegistry: registry });
        const untagged = getCandidate('album-1', {
            tag: '',
            tagMode: 'untagged-primary-fallback',
            url: 'https://media.example/items/album-1/images/Primary'
        });
        const firstTagged = getCandidate('album-1');
        const secondTagged = getCandidate('parent-1');

        expect(selection.select([ untagged, firstTagged, secondTagged ])).toBe(firstTagged);
        expect(selection.getRememberedCandidate(firstTagged.url)).toBe(firstTagged);
    });

    it('skips failed tagged candidates before falling back to the first nonfailed candidate', () => {
        const { failedKeys, registry } = createFailureRegistry();
        const selection = createPtvMusicImageCandidateSelection({ failureRegistry: registry });
        const untagged = getCandidate('album-2', {
            tag: '',
            tagMode: 'untagged-primary-fallback',
            url: 'https://media.example/items/album-2/images/Primary'
        });
        const failedTagged = getCandidate('album-2');
        const availableTagged = getCandidate('parent-2');

        failedKeys.add(getFailureKey(failedTagged));
        expect(selection.select([ untagged, failedTagged, availableTagged ])).toBe(availableTagged);

        failedKeys.add(getFailureKey(availableTagged));
        expect(selection.select([ untagged, failedTagged, availableTagged ])).toBe(untagged);
    });

    it('marks the remembered semantic candidate once when an image URL fails', () => {
        const { registry } = createFailureRegistry();
        const selection = createPtvMusicImageCandidateSelection({ failureRegistry: registry });
        const candidate = getCandidate('album-3');

        selection.select([ candidate ]);

        expect(selection.markFailedByUrl(candidate.url)).toBe(candidate);
        expect(registry.markFailed).toHaveBeenCalledTimes(1);
        expect(registry.markFailed).toHaveBeenCalledWith(candidate);
        expect(selection.markFailedByUrl(candidate.url)).toBe(candidate);
        expect(registry.markFailed).toHaveBeenCalledTimes(1);
        expect(selection.markFailedByUrl('https://media.example/unknown')).toBeNull();
    });

    it('suppresses the same item, type, and tag across image size variants', () => {
        const { registry } = createFailureRegistry();
        const selection = createPtvMusicImageCandidateSelection({ failureRegistry: registry });
        const smallCandidate = getCandidate('album-4', {
            url: 'https://media.example/items/album-4/images/Primary?tag=album-4-tag&maxWidth=320'
        });
        const largeCandidate = getCandidate('album-4', {
            url: 'https://media.example/items/album-4/images/Primary?tag=album-4-tag&maxWidth=640'
        });
        const untaggedFallback = getCandidate('album-4', {
            tag: '',
            tagMode: 'untagged-primary-fallback',
            url: 'https://media.example/items/album-4/images/Primary?maxWidth=640'
        });

        expect(selection.select([ smallCandidate ])).toBe(smallCandidate);
        expect(selection.markFailedByUrl(smallCandidate.url)).toBe(smallCandidate);
        expect(selection.select([ largeCandidate, untaggedFallback ])).toBe(untaggedFallback);
    });

    it('bounds remembered URL ownership with deterministic least-recently-used eviction', () => {
        const { registry } = createFailureRegistry();
        const selection = createPtvMusicImageCandidateSelection({
            failureRegistry: registry,
            maxEntries: 2
        });
        const first = getCandidate('album-5');
        const second = getCandidate('album-6');
        const third = getCandidate('album-7');

        selection.select([ first ]);
        selection.select([ second ]);
        expect(selection.getRememberedCandidate(first.url)).toBe(first);

        selection.select([ third ]);

        expect(selection.getRememberedCandidate(first.url)).toBe(first);
        expect(selection.getRememberedCandidate(second.url)).toBeNull();
        expect(selection.getRememberedCandidate(third.url)).toBe(third);
    });

    it('exposes a reset for the shared test-owned candidate memory', () => {
        const candidate = getCandidate('shared-reset-album');

        expect(selectPtvMusicImageCandidate([ candidate ])).toBe(candidate);
        expect(getRememberedPtvMusicImageCandidate(candidate.url)).toBe(candidate);

        resetPtvMusicImageCandidateSelectionForTests();

        expect(getRememberedPtvMusicImageCandidate(candidate.url)).toBeNull();
    });
});
