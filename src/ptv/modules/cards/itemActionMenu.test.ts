import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    show: vi.fn(() => Promise.resolve({ command: 'ptv-music:play' }))
}));

vi.mock('components/itemContextMenu', () => ({
    show: mocks.show
}));

import { showPtvItemActionMenu } from './itemActionMenu';

describe('showPtvItemActionMenu()', () => {
    it('forwards optional playback capability gates to the canonical menu', async () => {
        const item = {
            Id: 'track-1',
            MediaType: 'Audio',
            Type: 'Audio'
        };
        const positionTo = {} as HTMLElement;
        const user = {
            Id: 'user-1'
        };

        await showPtvItemActionMenu({
            instantMix: false,
            item,
            play: false,
            positionTo,
            queue: false,
            shuffle: false,
            user
        });

        expect(mocks.show).toHaveBeenCalledWith(expect.objectContaining({
            instantMix: false,
            item,
            play: false,
            positionTo,
            queue: false,
            shuffle: false,
            user
        }));
    });
});
