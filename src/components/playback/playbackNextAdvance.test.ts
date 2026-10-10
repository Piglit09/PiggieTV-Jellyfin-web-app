import { beforeEach, describe, expect, it, vi } from 'vitest';

import Events from '../../utils/events';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

const fixture = vi.hoisted(() => ({
    player: null as Record<string, unknown> | null,
    intercept: vi.fn(),
    user: vi.fn(),
    itemLookup: vi.fn()
}));

vi.mock('../pluginManager', () => ({
    pluginManager: {
        _callbacks: {},
        ofType: (type: string) => {
            if (type === 'mediaplayer') return fixture.player ? [fixture.player] : [];
            if (type === 'preplayintercept') return [{ intercept: fixture.intercept }];
            return [];
        }
    }
}));
vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: { getApiClient: () => ({
    getCurrentUser: fixture.user,
    getCurrentUserId: () => 'fixture-user',
    getItem: fixture.itemLookup
}) } }));
vi.mock('apps/stable/features/playback/utils/mediaSegmentManager', () => ({ bindMediaSegmentManager: () => undefined }));
vi.mock('apps/stable/features/playback/utils/mediaSessionSubscriber', () => ({ bindMediaSessionSubscriber: () => undefined }));
vi.mock('../loading/loading', () => ({ default: { show: () => undefined, hide: () => undefined } }));
vi.mock('../apphost', () => ({ appHost: { supports: () => false } }));
vi.mock('../alert', () => ({ default: () => undefined }));
vi.mock('../itemHelper', () => ({ default: {} }));
vi.mock('../../lib/globalize', () => ({ default: { translate: (key: string) => key } }));
vi.mock('../../scripts/settings/userSettings', () => ({}));
vi.mock('../../scripts/settings/appSettings', () => ({ default: { get: () => undefined } }));
vi.mock('./skipsegment.ts', () => ({ bindSkipSegment: () => undefined }));

import { PlaybackManager } from './playbackmanager';

describe('PlaybackManager next-item claim', () => {
    beforeEach(() => {
        fixture.intercept.mockReset();
        fixture.user.mockReset();
        fixture.itemLookup.mockReset();
    });

    it('does not start a second Next while prompt click and natural end race', async () => {
        const pendingPlay = deferred<void>();
        const pendingUser = deferred<{ Configuration: { EnableNextEpisodeAutoPlay: boolean } }>();
        fixture.intercept.mockReturnValue(pendingPlay.promise);
        fixture.user.mockReturnValue(pendingUser.promise);
        const player = {
            id: 'player', name: 'fixture player', isLocalPlayer: true, _callbacks: {},
            streamInfo: { item: { Name: 'Episode 1', MediaType: 'Video' }, mediaSource: {} },
            canPlayMediaType: () => true,
            play: vi.fn(), stop: vi.fn(), destroy: vi.fn()
        };
        fixture.player = player;
        const manager = new PlaybackManager();
        Object.assign(manager, { _currentPlayer: player });
        const nextItem = { Id: 'episode-2', ServerId: 'server', Name: 'Episode 2', MediaType: 'Video', Type: 'Episode' };
        manager._playQueueManager.getNextItemInfo = () => ({ item: nextItem, index: 1 });
        manager.getPlayerState = () => ({ NowPlayingItem: { Id: 'episode-1', ServerId: 'server' }, PlayState: { PositionTicks: 0 } });
        const reportStop = vi.fn();
        Events.on(manager, 'playbackstop', reportStop);

        manager.nextTrack(player);
        Events.trigger(player, 'stopped');
        pendingUser.resolve({ Configuration: { EnableNextEpisodeAutoPlay: true } });
        await Promise.resolve();
        await Promise.resolve();

        expect(fixture.intercept).toHaveBeenCalledTimes(1);
        expect(reportStop).toHaveBeenCalledOnce();
        // Play remains deferred: both intents arbitrate before media negotiation.
    });

    it('does not autoplay a replacement queued item after the ended-item user lookup', async () => {
        const pendingPlay = deferred<void>();
        const pendingUser = deferred<{ Configuration: { EnableNextEpisodeAutoPlay: boolean } }>();
        fixture.intercept.mockReturnValue(pendingPlay.promise);
        fixture.user.mockReturnValue(pendingUser.promise);
        const player = {
            id: 'player', name: 'fixture player', isLocalPlayer: true, _callbacks: {},
            streamInfo: { item: { Name: 'Episode 1', MediaType: 'Video' }, mediaSource: {} },
            canPlayMediaType: () => true,
            play: vi.fn(), stop: vi.fn(), destroy: vi.fn()
        };
        fixture.player = player;
        const manager = new PlaybackManager();
        Object.assign(manager, { _currentPlayer: player });
        let nextId = 'episode-2';
        manager._playQueueManager.getNextItemInfo = () => ({ item: { Id: nextId, ServerId: 'server', Name: nextId, MediaType: 'Video', Type: 'Episode' }, index: 1 });
        manager.getPlayerState = () => ({ NowPlayingItem: { Id: 'episode-1', ServerId: 'server' }, PlayState: { PositionTicks: 0 } });

        Events.trigger(player, 'stopped');
        nextId = 'replacement';
        pendingUser.resolve({ Configuration: { EnableNextEpisodeAutoPlay: true } });
        await Promise.resolve();
        await Promise.resolve();

        expect(fixture.intercept).not.toHaveBeenCalled();
    });

    it.each(['after stop', 'before stop'])('does not autoplay the ended episode queue when explicit play begins %s', async requestOrder => {
        const pendingUser = deferred<{ Configuration: { EnableNextEpisodeAutoPlay: boolean } }>();
        const pendingExplicitItem = deferred<unknown>();
        fixture.user.mockReturnValue(pendingUser.promise);
        fixture.itemLookup.mockReturnValue(pendingExplicitItem.promise);
        fixture.intercept.mockReturnValue(new Promise<void>(() => undefined));
        const player = {
            id: 'player', name: 'fixture player', isLocalPlayer: true, _callbacks: {},
            streamInfo: { item: { Name: 'Episode A', MediaType: 'Video' }, mediaSource: {} },
            canPlayMediaType: () => true,
            play: vi.fn(), stop: vi.fn(), destroy: vi.fn()
        };
        fixture.player = player;
        const manager = new PlaybackManager();
        Object.assign(manager, { _currentPlayer: player });
        const queuedNext = { Id: 'episode-a-next', ServerId: 'server', Name: 'Episode A next', MediaType: 'Video', Type: 'Episode' };
        manager._playQueueManager.getNextItemInfo = () => ({ item: queuedNext, index: 1 });
        manager.getPlayerState = () => ({ NowPlayingItem: { Id: 'episode-a', ServerId: 'server' }, PlayState: { PositionTicks: 0 } });

        if (requestOrder === 'before stop') void manager.play({ serverId: 'server', ids: ['episode-b'] });
        Events.trigger(player, 'stopped');
        if (requestOrder === 'after stop') void manager.play({ serverId: 'server', ids: ['episode-b'] });
        expect(fixture.itemLookup).toHaveBeenCalledOnce();
        pendingUser.resolve({ Configuration: { EnableNextEpisodeAutoPlay: true } });
        await Promise.resolve();
        await Promise.resolve();

        expect(fixture.intercept).not.toHaveBeenCalled();
    });

    it('still starts one queued episode on ordinary natural end', async () => {
        const pendingPlay = deferred<void>();
        const pendingUser = deferred<{ Configuration: { EnableNextEpisodeAutoPlay: boolean } }>();
        fixture.intercept.mockReturnValue(pendingPlay.promise);
        fixture.user.mockReturnValue(pendingUser.promise);
        const player = {
            id: 'player', name: 'fixture player', isLocalPlayer: true, _callbacks: {},
            streamInfo: { item: { Name: 'Episode 1', MediaType: 'Video' }, mediaSource: {} },
            canPlayMediaType: () => true,
            play: vi.fn(), stop: vi.fn(), destroy: vi.fn()
        };
        fixture.player = player;
        const manager = new PlaybackManager();
        Object.assign(manager, { _currentPlayer: player });
        const nextItem = { Id: 'episode-2', ServerId: 'server', Name: 'Episode 2', MediaType: 'Video', Type: 'Episode' };
        manager._playQueueManager.getNextItemInfo = () => ({ item: nextItem, index: 1 });
        manager.getPlayerState = () => ({ NowPlayingItem: { Id: 'episode-1', ServerId: 'server' }, PlayState: { PositionTicks: 0 } });
        const reportStop = vi.fn();
        Events.on(manager, 'playbackstop', reportStop);

        Events.trigger(player, 'stopped');
        pendingUser.resolve({ Configuration: { EnableNextEpisodeAutoPlay: true } });
        await Promise.resolve();
        await Promise.resolve();

        expect(reportStop).toHaveBeenCalledOnce();
        expect(fixture.intercept).toHaveBeenCalledTimes(1);
    });
});
