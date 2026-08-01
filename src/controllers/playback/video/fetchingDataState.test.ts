import { describe, expect, it, vi } from 'vitest';

import { createVideoFetchingDataState } from './fetchingDataState';

describe('video fetching-data presentation state', () => {
    it('clears loading after established playback and ignores retired-player events', () => {
        const setVisible = vi.fn();
        const state = createVideoFetchingDataState(setVisible);
        const first = { isFetching: true };
        const replacement = { isFetching: false };

        state.bind(first);
        expect(setVisible).toHaveBeenLastCalledWith(true);

        first.isFetching = false;
        state.established(first);
        expect(setVisible).toHaveBeenLastCalledWith(false);

        state.bind(replacement);
        state.begin(first);
        expect(setVisible).toHaveBeenLastCalledWith(false);
    });

    it('clears on enrichment failure, replacement, and teardown', () => {
        const setVisible = vi.fn();
        const state = createVideoFetchingDataState(setVisible);
        const player = { isFetching: false };

        state.bind(player);
        state.begin(player);
        state.end(player);
        expect(setVisible).toHaveBeenLastCalledWith(false);

        state.begin(player);
        state.release(player);
        expect(setVisible).toHaveBeenLastCalledWith(false);
    });
});
