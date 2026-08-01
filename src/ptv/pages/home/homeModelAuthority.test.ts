import { describe, expect, it } from 'vitest';

import {
    decideNativeHomeModelReplacement,
    mergeSettledNativeHomeRows
} from './homeModelAuthority';

const populated = { heroItems: [ {} ], rows: [ { items: [ {}, {} ] } ] };

describe('native Home model authority', () => {
    it('preserves populated shelves when an empty plugin cache arrives', () => {
        expect(decideNativeHomeModelReplacement({ current: populated, currentGeneration: 1, incoming: { rows: [], sectionCount: 6 }, incomingGeneration: 1 }))
            .toMatchObject({ allow: false, reason: 'preserve-populated-current-model' });
    });

    it('preserves stale populated content when refresh is empty partial', () => {
        expect(decideNativeHomeModelReplacement({ current: populated, currentGeneration: 2, incoming: { completeness: 'partial', rows: [] }, incomingGeneration: 2 }).allow).toBe(false);
    });

    it('allows progressive live content without a cache', () => {
        expect(decideNativeHomeModelReplacement({ current: { rows: [] }, currentGeneration: 3, incoming: { completeness: 'partial', rows: [ { items: [ {} ] } ] }, incomingGeneration: 3 }).allow).toBe(true);
    });

    it('keeps Jellyfin rows independent of TMDb and recommendations', () => {
        expect(decideNativeHomeModelReplacement({ current: { rows: [] }, currentGeneration: 4, incoming: populated, incomingGeneration: 4 }).allow).toBe(true);
    });

    it('rejects a slow result from a retired route generation', () => {
        expect(decideNativeHomeModelReplacement({ current: populated, currentGeneration: 7, incoming: populated, incomingGeneration: 6 }))
            .toMatchObject({ allow: false, reason: 'stale-route-generation' });
    });

    it('rejects six empty section shells without a cache', () => {
        expect(decideNativeHomeModelReplacement({ current: { rows: [] }, currentGeneration: 8, incoming: { rows: [], sectionCount: 6 }, incomingGeneration: 8 }))
            .toMatchObject({ allow: false, reason: 'reject-section-shell-model' });
    });

    it('allows an intentional empty-library state to settle', () => {
        expect(decideNativeHomeModelReplacement({ current: { rows: [] }, currentGeneration: 9, incoming: { emptyLibraryConfirmed: true, rows: [] }, incomingGeneration: 9 }))
            .toMatchObject({ allow: true, reason: 'accept-intentional-empty' });
    });

    it('allows a complete cache to replace a partial model', () => {
        expect(decideNativeHomeModelReplacement({ current: { completeness: 'partial', rows: [ { items: [ {} ] } ] }, currentGeneration: 10, incoming: populated, incomingGeneration: 10 }).allow).toBe(true);
    });

    it('rejects stale configuration and recommendation hashes', () => {
        expect(decideNativeHomeModelReplacement({ configurationMatches: false, current: populated, currentGeneration: 11, incoming: populated, incomingGeneration: 11 }).reason).toBe('configuration-hash-mismatch');
        expect(decideNativeHomeModelReplacement({ current: populated, currentGeneration: 11, incoming: populated, incomingGeneration: 11, recommendationMatches: false }).reason).toBe('recommendation-hash-mismatch');
    });

    it('preserves a settled shelf omitted by a late partial model', () => {
        const current = [
            { id: 'continue', items: [ 'continue-a' ] },
            { id: 'recent', items: [ 'recent-a' ] }
        ];
        const incoming = [
            { id: 'continue', items: [ 'continue-b' ] }
        ];

        expect(mergeSettledNativeHomeRows(current, incoming)).toEqual([
            { id: 'continue', items: [ 'continue-b' ] },
            { id: 'recent', items: [ 'recent-a' ] }
        ]);
    });

    it('does not let an empty late recommendation erase its settled shelf', () => {
        const current = [ { id: 'because-you-watched', items: [ 'movie-a' ] } ];
        const incoming = [ { id: 'because-you-watched', items: [] } ];

        expect(mergeSettledNativeHomeRows(current, incoming)).toEqual(current);
    });

    it('accepts a populated same-shelf refresh without duplicating its identity', () => {
        const current = [ { id: 'recent', items: [ 'old' ] } ];
        const incoming = [ { id: 'recent', items: [ 'new' ] } ];

        expect(mergeSettledNativeHomeRows(current, incoming)).toEqual(incoming);
    });
});
