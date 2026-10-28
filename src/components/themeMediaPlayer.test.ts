import { beforeEach, describe, expect, it, vi } from 'vitest';

const themePlayerMocks = vi.hoisted(() => {
    const state = {
        currentItem: null as { Id: string; MediaType: string } | null,
        deferNextPlay: false,
        deferNextStop: false,
        isPlaying: false,
        resolvePendingPlay: null as (() => void) | null,
        resolvePendingStop: null as (() => void) | null,
        paused: true,
        skipNextPlayCommit: false,
        songsEnabled: false,
        userId: 'user-a'
    };
    const player = {
        paused: vi.fn(() => state.paused)
    };
    const playbackManager = {
        currentItem: vi.fn(() => state.currentItem),
        getCurrentPlayer: vi.fn(() => state.isPlaying ? player : null),
        isPlaying: vi.fn(() => state.isPlaying),
        play: vi.fn(({
            items,
            playbackStartGuard
        }: {
            items: Array<{ Id: string; MediaType: string }>;
            playbackStartGuard?: () => boolean;
        }) => {
            const skipPlaybackCommit = state.skipNextPlayCommit;
            state.skipNextPlayCommit = false;

            if (state.deferNextPlay) {
                state.deferNextPlay = false;

                return new Promise<void>(resolve => {
                    state.resolvePendingPlay = () => {
                        if (playbackStartGuard?.() === false) {
                            state.resolvePendingPlay = null;
                            resolve();
                            return;
                        }

                        if (skipPlaybackCommit) {
                            state.resolvePendingPlay = null;
                            resolve();
                            return;
                        }

                        state.currentItem = items[0] || null;
                        state.isPlaying = true;
                        state.resolvePendingPlay = null;
                        resolve();
                    };
                });
            }

            if (playbackStartGuard?.() === false) return Promise.resolve();
            if (skipPlaybackCommit) return Promise.resolve();

            state.currentItem = items[0] || null;
            state.isPlaying = true;
            return Promise.resolve();
        }),
        // Keep the loaded source until the asynchronous stop settles. This is
        // the browser race the preference and route retries must tolerate.
        stop: vi.fn(() => {
            const stoppedItemId = state.currentItem?.Id || null;
            const settleStop = () => {
                if (!stoppedItemId || state.currentItem?.Id === stoppedItemId) {
                    state.currentItem = null;
                    state.isPlaying = false;
                    state.paused = true;
                }
            };

            if (state.deferNextStop) {
                state.deferNextStop = false;

                return new Promise<void>(resolve => {
                    state.resolvePendingStop = () => {
                        settleStop();
                        state.resolvePendingStop = null;
                        resolve();
                    };
                });
            }

            return Promise.resolve().then(settleStop);
        })
    };
    const userSettings = {
        enableThemeSongs: vi.fn(() => state.songsEnabled),
        enableThemeVideos: vi.fn(() => false)
    };

    return {
        getThemeMedia: vi.fn(),
        playbackManager,
        playbackStartHandler: null as ((...args: unknown[]) => void) | null,
        player,
        queryItem: vi.fn(),
        settingsChangeHandler: null as ((...args: unknown[]) => void) | null,
        state,
        userSettings
    };
});

vi.mock('@jellyfin/sdk/lib/generated-client/models/item-sort-by', () => ({
    ItemSortBy: {
        Random: 'Random'
    }
}));

vi.mock('@jellyfin/sdk/lib/generated-client/models/media-type', () => ({
    MediaType: {
        Audio: 'Audio',
        Video: 'Video'
    }
}));

vi.mock('@jellyfin/sdk/lib/utils/api/library-api', () => ({
    getLibraryApi: vi.fn(() => ({
        getThemeMedia: themePlayerMocks.getThemeMedia
    }))
}));

vi.mock('hooks/useItem', () => ({
    getItemQuery: vi.fn((_api, itemId: string) => ({
        itemId,
        queryKey: ['item', itemId]
    }))
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        getApiClient: vi.fn(() => ({
            getCurrentUserId: () => themePlayerMocks.state.userId
        }))
    }
}));

vi.mock('ptv/core/safeConsole', () => ({
    ptvSafeConsole: {
        error: vi.fn(),
        warn: vi.fn()
    }
}));

vi.mock('scripts/settings/userSettings', () => ({
    currentSettings: themePlayerMocks.userSettings
}));

vi.mock('types/base/models/item-kind', () => ({
    ItemKind: {
        Channel: 'Channel',
        CollectionFolder: 'CollectionFolder',
        Person: 'Person',
        Program: 'Program',
        SeriesTimer: 'SeriesTimer',
        TvChannel: 'TvChannel',
        UserView: 'UserView'
    }
}));

vi.mock('utils/events.ts', () => ({
    default: {
        on: vi.fn((target: unknown, type: string, handler: (...args: unknown[]) => void) => {
            if (target === themePlayerMocks.userSettings && type === 'change') {
                themePlayerMocks.settingsChangeHandler = handler;
            }

            if (target === themePlayerMocks.playbackManager && type === 'playbackstart') {
                themePlayerMocks.playbackStartHandler = handler;
            }
        })
    }
}));

vi.mock('utils/jellyfin-apiclient/compat', () => ({
    toApi: vi.fn(() => ({}))
}));

vi.mock('utils/query/queryClient', () => ({
    queryClient: {
        fetchQuery: themePlayerMocks.queryItem
    }
}));

vi.mock('./playback/playbackmanager', () => ({
    playbackManager: themePlayerMocks.playbackManager
}));

import './themeMediaPlayer';

async function settlePromises() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

function showThemePage(itemId = 'item-a', serverId = 'server-a') {
    document.dispatchEvent(new CustomEvent('viewshow', {
        detail: {
            params: {
                id: itemId,
                serverId
            }
        }
    }));
}

function getCurrentItemId() {
    return themePlayerMocks.state.currentItem?.Id;
}

describe('theme media preference playback', () => {
    beforeEach(() => {
        document.dispatchEvent(new CustomEvent('viewshow', { detail: { options: {} } }));
        vi.clearAllMocks();
        themePlayerMocks.state.currentItem = null;
        themePlayerMocks.state.deferNextPlay = false;
        themePlayerMocks.state.deferNextStop = false;
        themePlayerMocks.state.isPlaying = false;
        themePlayerMocks.state.paused = true;
        themePlayerMocks.state.resolvePendingPlay = null;
        themePlayerMocks.state.resolvePendingStop = null;
        themePlayerMocks.state.skipNextPlayCommit = false;
        themePlayerMocks.state.songsEnabled = false;
        themePlayerMocks.state.userId = 'user-a';
        themePlayerMocks.queryItem.mockImplementation(async ({ itemId }: { itemId: string }) => ({
            Id: itemId,
            Type: 'Series'
        }));
        themePlayerMocks.getThemeMedia.mockResolvedValue({
            data: {
                ThemeSongsResult: {
                    Items: [{
                        Id: 'song-a',
                        MediaType: 'Audio'
                    }],
                    OwnerId: 'owner-a'
                }
            }
        });
    });

    it('loads a fresh theme owner when the user changes on the same server and item', async () => {
        themePlayerMocks.state.songsEnabled = true;
        themePlayerMocks.state.paused = false;
        showThemePage('shared-series');
        await settlePromises();
        expect(getCurrentItemId()).toBe('song-a');

        themePlayerMocks.state.userId = 'user-b';
        themePlayerMocks.getThemeMedia.mockResolvedValueOnce({ data: { ThemeSongsResult: {
            Items: [{ Id: 'song-user-b', MediaType: 'Audio' }], OwnerId: 'owner-user-b'
        } } });
        showThemePage('shared-series');
        await settlePromises();

        expect(themePlayerMocks.getThemeMedia).toHaveBeenCalledTimes(2);
        expect(themePlayerMocks.getThemeMedia.mock.calls.at(-1)?.[0].userId).toBe('user-b');
        expect(getCurrentItemId()).toBe('song-user-b');
    });

    it('rejects a theme lookup whose authenticated user retired before its result', async () => {
        let resolveTheme!: (value: unknown) => void;
        themePlayerMocks.getThemeMedia.mockReturnValueOnce(new Promise(resolve => {
            resolveTheme = resolve;
        }));
        themePlayerMocks.state.songsEnabled = true;
        showThemePage('series-retired-user');
        await settlePromises();
        themePlayerMocks.state.userId = '';

        resolveTheme({ data: { ThemeSongsResult: {
            Items: [{ Id: 'retired-user-song', MediaType: 'Audio' }], OwnerId: 'old-user'
        } } });
        await settlePromises();

        expect(themePlayerMocks.playbackManager.play).not.toHaveBeenCalled();
    });

    it('keeps preference, autoplay, cancellation, and route races under one playback owner', async () => {
        showThemePage();
        await settlePromises();

        expect(themePlayerMocks.getThemeMedia).toHaveBeenCalledTimes(1);
        expect(themePlayerMocks.playbackManager.play).not.toHaveBeenCalled();

        themePlayerMocks.state.deferNextPlay = true;
        themePlayerMocks.state.songsEnabled = true;
        themePlayerMocks.settingsChangeHandler?.({ type: 'change' }, 'enableThemeSongs');
        await settlePromises();

        expect(themePlayerMocks.getThemeMedia).toHaveBeenCalledTimes(1);
        expect(themePlayerMocks.playbackManager.play).toHaveBeenCalledTimes(1);

        themePlayerMocks.state.songsEnabled = false;
        themePlayerMocks.settingsChangeHandler?.({ type: 'change' }, 'enableThemeSongs');
        expect(themePlayerMocks.playbackManager.stop).not.toHaveBeenCalled();

        themePlayerMocks.state.resolvePendingPlay?.();
        await settlePromises();

        expect(themePlayerMocks.playbackManager.stop).not.toHaveBeenCalled();

        themePlayerMocks.state.currentItem = null;
        themePlayerMocks.state.isPlaying = false;
        themePlayerMocks.state.songsEnabled = true;
        themePlayerMocks.settingsChangeHandler?.({ type: 'change' }, 'enableThemeSongs');
        await settlePromises();

        expect(themePlayerMocks.playbackManager.play).toHaveBeenCalledTimes(2);

        themePlayerMocks.playbackStartHandler?.({ type: 'playbackstart' }, themePlayerMocks.player);
        showThemePage();
        await settlePromises();

        expect(themePlayerMocks.playbackManager.play).toHaveBeenCalledTimes(3);

        themePlayerMocks.state.paused = false;
        themePlayerMocks.playbackStartHandler?.({ type: 'playbackstart' }, themePlayerMocks.player);
        themePlayerMocks.settingsChangeHandler?.({ type: 'change' }, 'enableThemeSongs');
        await settlePromises();

        expect(themePlayerMocks.playbackManager.play).toHaveBeenCalledTimes(3);

        const stopsBeforeDisable = themePlayerMocks.playbackManager.stop.mock.calls.length;
        themePlayerMocks.state.deferNextStop = true;
        themePlayerMocks.state.songsEnabled = false;
        themePlayerMocks.settingsChangeHandler?.({ type: 'change' }, 'enableThemeSongs');

        expect(themePlayerMocks.playbackManager.stop).toHaveBeenCalledTimes(stopsBeforeDisable + 1);

        themePlayerMocks.state.songsEnabled = true;
        themePlayerMocks.state.paused = true;
        themePlayerMocks.settingsChangeHandler?.({ type: 'change' }, 'enableThemeSongs');
        await settlePromises();

        expect(themePlayerMocks.playbackManager.play).toHaveBeenCalledTimes(4);

        themePlayerMocks.state.paused = false;
        themePlayerMocks.playbackStartHandler?.({ type: 'playbackstart' }, themePlayerMocks.player);
        themePlayerMocks.getThemeMedia.mockResolvedValueOnce({
            data: {
                ThemeSongsResult: {
                    Items: [{ Id: 'song-b', MediaType: 'Audio' }],
                    OwnerId: 'owner-b'
                }
            }
        });

        const stopsBeforeRouteChange = themePlayerMocks.playbackManager.stop.mock.calls.length;
        showThemePage('item-b');
        await settlePromises();

        expect(themePlayerMocks.playbackManager.play).toHaveBeenCalledTimes(5);
        expect(themePlayerMocks.playbackManager.stop).toHaveBeenCalledTimes(stopsBeforeRouteChange);
        expect(themePlayerMocks.playbackManager.play.mock.calls.at(-1)?.[0].items[0]?.Id).toBe('song-b');
        expect(getCurrentItemId()).toBe('song-b');

        themePlayerMocks.state.currentItem = null;
        themePlayerMocks.state.deferNextPlay = true;
        themePlayerMocks.state.isPlaying = false;
        showThemePage('item-manual-race');
        await settlePromises();

        expect(themePlayerMocks.playbackManager.play).toHaveBeenCalledTimes(6);

        themePlayerMocks.state.currentItem = {
            Id: 'user-video',
            MediaType: 'Video'
        };
        themePlayerMocks.state.isPlaying = true;
        themePlayerMocks.state.paused = false;
        themePlayerMocks.playbackStartHandler?.({ type: 'playbackstart' }, themePlayerMocks.player);
        const stopsBeforeStaleAttempt = themePlayerMocks.playbackManager.stop.mock.calls.length;
        themePlayerMocks.state.resolvePendingPlay?.();
        await settlePromises();

        expect(themePlayerMocks.playbackManager.stop).toHaveBeenCalledTimes(stopsBeforeStaleAttempt);
        expect(getCurrentItemId()).toBe('user-video');

        themePlayerMocks.state.currentItem = null;
        themePlayerMocks.state.isPlaying = false;
        themePlayerMocks.state.paused = true;
        themePlayerMocks.state.songsEnabled = false;

        let resolveOldTheme!: (value: unknown) => void;
        const oldTheme = new Promise(resolve => {
            resolveOldTheme = resolve;
        });

        themePlayerMocks.getThemeMedia
            .mockImplementationOnce(() => oldTheme)
            .mockResolvedValueOnce({
                data: {
                    ThemeSongsResult: {
                        Items: [{ Id: 'song-current', MediaType: 'Audio' }],
                        OwnerId: 'owner-current'
                    }
                }
            });

        showThemePage('item-old');
        await settlePromises();
        showThemePage('item-current');
        await settlePromises();

        resolveOldTheme({
            data: {
                ThemeSongsResult: {
                    Items: [{ Id: 'song-stale', MediaType: 'Audio' }],
                    OwnerId: 'owner-stale'
                }
            }
        });
        await settlePromises();

        themePlayerMocks.state.songsEnabled = true;
        themePlayerMocks.settingsChangeHandler?.({ type: 'change' }, 'enableThemeSongs');
        await settlePromises();

        const latestPlay = themePlayerMocks.playbackManager.play.mock.calls.at(-1)?.[0];

        expect(latestPlay?.items[0]?.Id).toBe('song-current');

        themePlayerMocks.getThemeMedia
            .mockResolvedValueOnce({
                data: {
                    ThemeSongsResult: {
                        Items: [{ Id: 'song-late-a', MediaType: 'Audio' }],
                        OwnerId: 'owner-late-a'
                    }
                }
            })
            .mockResolvedValueOnce({
                data: {
                    ThemeSongsResult: {
                        Items: [{ Id: 'song-ready-b', MediaType: 'Audio' }],
                        OwnerId: 'owner-ready-b'
                    }
                }
            });

        themePlayerMocks.state.deferNextPlay = true;
        showThemePage('item-late-a');
        await settlePromises();
        const resolveLateA = themePlayerMocks.state.resolvePendingPlay;

        showThemePage('item-ready-b');
        await settlePromises();

        const playsBeforeLateA = themePlayerMocks.playbackManager.play.mock.calls.length;
        const stopsBeforeLateA = themePlayerMocks.playbackManager.stop.mock.calls.length;
        resolveLateA?.();
        await settlePromises();

        expect(themePlayerMocks.playbackManager.stop).toHaveBeenCalledTimes(stopsBeforeLateA);
        expect(themePlayerMocks.playbackManager.play).toHaveBeenCalledTimes(playsBeforeLateA);
        expect(getCurrentItemId()).toBe('song-ready-b');

        themePlayerMocks.getThemeMedia
            .mockResolvedValueOnce({
                data: {
                    ThemeSongsResult: {
                        Items: [{ Id: 'song-pending-a', MediaType: 'Audio' }],
                        OwnerId: 'owner-pending-a'
                    }
                }
            })
            .mockResolvedValueOnce({
                data: {
                    ThemeSongsResult: {
                        Items: [{ Id: 'song-pending-b', MediaType: 'Audio' }],
                        OwnerId: 'owner-pending-b'
                    }
                }
            });

        themePlayerMocks.state.deferNextPlay = true;
        showThemePage('item-pending-a');
        await settlePromises();
        const resolvePendingA = themePlayerMocks.state.resolvePendingPlay;

        themePlayerMocks.state.deferNextPlay = true;
        showThemePage('item-pending-b');
        await settlePromises();
        const resolvePendingB = themePlayerMocks.state.resolvePendingPlay;
        const stopsBeforePendingA = themePlayerMocks.playbackManager.stop.mock.calls.length;

        resolvePendingA?.();
        await settlePromises();

        expect(themePlayerMocks.playbackManager.stop).toHaveBeenCalledTimes(stopsBeforePendingA);

        resolvePendingB?.();
        await settlePromises();

        expect(getCurrentItemId()).toBe('song-pending-b');

        themePlayerMocks.getThemeMedia
            .mockResolvedValueOnce({
                data: {
                    ThemeSongsResult: {
                        Items: [{ Id: 'song-before-failure', MediaType: 'Audio' }],
                        OwnerId: 'owner-before-failure'
                    }
                }
            })
            .mockResolvedValueOnce({
                data: {
                    ThemeSongsResult: {
                        Items: [{ Id: 'song-retryable', MediaType: 'Audio' }],
                        OwnerId: 'owner-retryable'
                    }
                }
            });

        themePlayerMocks.state.deferNextPlay = true;
        showThemePage('item-before-failure');
        await settlePromises();
        const resolveBeforeFailure = themePlayerMocks.state.resolvePendingPlay;

        themePlayerMocks.state.deferNextPlay = true;
        themePlayerMocks.state.skipNextPlayCommit = true;
        showThemePage('item-retryable');
        await settlePromises();
        const resolveFailedReplacement = themePlayerMocks.state.resolvePendingPlay;
        const stopsBeforeFailedReplacement = themePlayerMocks.playbackManager.stop.mock.calls.length;

        resolveBeforeFailure?.();
        await settlePromises();
        resolveFailedReplacement?.();
        await settlePromises();

        expect(themePlayerMocks.playbackManager.stop).toHaveBeenCalledTimes(stopsBeforeFailedReplacement + 1);
        expect(getCurrentItemId()).toBeUndefined();

        showThemePage('item-retryable');
        await settlePromises();

        expect(getCurrentItemId()).toBe('song-retryable');
    });
});
