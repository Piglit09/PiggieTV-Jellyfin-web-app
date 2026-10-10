import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
    nextTrack: vi.fn(),
    remaining: 1000,
    autoplay: true,
    queueId: 'next',
    queueServerId: 'server-a',
    queuePlaylistItemId: 'slot-a',
    userPromise: null as Promise<unknown> | null
}));

vi.mock('../../utils/dom', () => ({ default: { whichTransitionEvent: () => 'transitionend', addEventListener: (target: EventTarget, type: string, listener: EventListener) => target.addEventListener(type, listener), removeEventListener: (target: EventTarget, type: string, listener: EventListener) => target.removeEventListener(type, listener) } }));
vi.mock('../playback/playbackmanager', () => ({ playbackManager: { nextTrack: fixture.nextTrack, getNextItem: () => ({ item: { Id: fixture.queueId, ServerId: fixture.queueServerId, PlaylistItemId: fixture.queuePlaylistItemId } }), duration: () => 10000, currentTime: () => (1000 - fixture.remaining) / 1000 } }));
vi.mock('../mediainfo/mediainfo', () => ({ default: { getPrimaryMediaInfoHtml: () => '' } }));
vi.mock('../layoutManager', () => ({ default: { tv: false } }));
vi.mock('../focusManager', () => ({ default: { focus: () => undefined } }));
vi.mock('../../lib/globalize', () => ({ default: { translate: (key: string) => key } }));
vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: { getApiClient: () => ({ getCurrentUser: () => fixture.userPromise || Promise.resolve({ Configuration: { EnableNextEpisodeAutoPlay: fixture.autoplay } }) }) } }));
vi.mock('../itemHelper', () => ({ default: { getDisplayName: (item: { Name: string }) => item.Name } }));
vi.mock('../../elements/emby-button/emby-button', () => ({}));

import UpNextDialog from './upnextdialog';

async function createDialog() {
    const parent = document.createElement('div');
    document.body.append(parent);
    const player = { id: 'player', isLocalPlayer: true };
    const dialog = new UpNextDialog({ parent, player, nextItem: { Id: 'next', ServerId: 'server-a', PlaylistItemId: 'slot-a', Name: 'Next', Type: 'Episode' } });
    await Promise.resolve();
    await Promise.resolve();
    return { parent, player, dialog };
}

describe('Up Next advance ownership', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        fixture.nextTrack.mockClear();
        fixture.remaining = 1000;
        fixture.autoplay = true;
        fixture.queueId = 'next';
        fixture.queueServerId = 'server-a';
        fixture.queuePlaylistItemId = 'slot-a';
        fixture.userPromise = null;
    });

    it('advances only once for rapid Start Now taps before hide completes', async () => {
        const { parent, player, dialog } = await createDialog();
        const button = parent.querySelector('.btnStartNow') as HTMLButtonElement;
        button.click();
        button.click();
        parent.dispatchEvent(new Event('transitionend'));
        await Promise.resolve();
        expect(fixture.nextTrack).toHaveBeenCalledTimes(1);
        expect(fixture.nextTrack).toHaveBeenCalledWith(player);
        dialog.destroy();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('leaves natural-end advancement to PlaybackManager when expiry races Start Now', async () => {
        const { parent, dialog } = await createDialog();
        fixture.remaining = 0;
        vi.advanceTimersByTime(400);
        (parent.querySelector('.btnStartNow') as HTMLButtonElement).click();
        parent.dispatchEvent(new Event('transitionend'));
        await Promise.resolve();
        expect(fixture.nextTrack).not.toHaveBeenCalled();
        dialog.destroy();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('Hide retires the countdown without advancing', async () => {
        const { parent, dialog } = await createDialog();
        (parent.querySelector('.btnHide') as HTMLButtonElement).click();
        parent.dispatchEvent(new Event('transitionend'));
        fixture.remaining = 0;
        vi.advanceTimersByTime(800);
        expect(fixture.nextTrack).not.toHaveBeenCalled();
        dialog.destroy();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('does not build a prompt after its user preference request outlives destruction', async () => {
        let resolveUser!: (value: unknown) => void;
        fixture.userPromise = new Promise(resolve => {
            resolveUser = resolve;
        });
        const parent = document.createElement('div');
        document.body.append(parent);
        const dialog = new UpNextDialog({ parent, player: {}, nextItem: { Id: 'next', Name: 'Next', Type: 'Episode' } });
        dialog.destroy();
        resolveUser({ Configuration: { EnableNextEpisodeAutoPlay: true } });
        await Promise.resolve();
        await Promise.resolve();
        expect(parent.innerHTML).toBe('');
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('does not advance a different queued episode after prompt display', async () => {
        const { parent, dialog } = await createDialog();
        fixture.queueId = 'replacement';
        (parent.querySelector('.btnStartNow') as HTMLButtonElement).click();
        expect(fixture.nextTrack).not.toHaveBeenCalled();
        dialog.destroy();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it.each([
        ['server', () => { fixture.queueServerId = 'server-b'; }],
        ['playlist slot', () => { fixture.queuePlaylistItemId = 'slot-b'; }]
    ])('does not advance the same item ID after the queued %s changes', async (_change, replaceQueue) => {
        const { parent, dialog } = await createDialog();
        replaceQueue();
        (parent.querySelector('.btnStartNow') as HTMLButtonElement).click();
        expect(fixture.nextTrack).not.toHaveBeenCalled();
        dialog.destroy();
        vi.clearAllTimers();
        vi.useRealTimers();
    });
});
