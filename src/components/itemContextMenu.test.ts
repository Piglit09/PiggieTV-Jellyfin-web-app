import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPtvAbortController } from '../ptv/core/abortController';
import { createActionSheetCancelledError } from './actionSheet/actionSheetAbort';

const mocks = vi.hoisted(() => {
    const apiClient = {
        getCurrentUserId: vi.fn(() => 'user-1'),
        markPlayed: vi.fn(() => Promise.resolve()),
        markUnplayed: vi.fn(() => Promise.resolve()),
        updateFavoriteStatus: vi.fn(() => Promise.resolve())
    };

    return {
        actionSheetShow: vi.fn(),
        apiClient,
        appRouterShowItem: vi.fn(),
        getApiClient: vi.fn(() => apiClient),
        toast: vi.fn()
    };
});

vi.mock('../scripts/browser', () => ({
    default: {
        tv: false
    }
}));

vi.mock('../scripts/clipboard', () => ({
    copy: vi.fn(() => Promise.resolve())
}));

vi.mock('../utils/dom', () => ({
    default: {
        parentWithClass: vi.fn(() => null)
    }
}));

vi.mock('../lib/globalize', () => ({
    default: {
        translate: (key: string) => key
    }
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        getApiClient: mocks.getApiClient
    }
}));

vi.mock('./actionSheet/actionSheet', () => ({
    default: {
        show: mocks.actionSheetShow
    }
}));

vi.mock('./apphost', () => ({
    appHost: {
        supports: vi.fn(() => false)
    }
}));

vi.mock('./router/appRouter', () => ({
    appRouter: {
        getRouteUrl: vi.fn(() => '#/details'),
        showItem: mocks.appRouterShowItem
    }
}));

vi.mock('./itemHelper', () => {
    const helper = {
        canEdit: vi.fn(() => false),
        canEditImages: vi.fn(() => false),
        canEditLyrics: vi.fn(() => false),
        canEditSubtitles: vi.fn(() => false),
        canIdentify: vi.fn(() => false),
        canMarkPlayed: vi.fn(item => item.MediaType === 'Video'),
        canRate: vi.fn(item => Boolean(item.UserData)),
        canRefreshMetadata: vi.fn(() => false),
        canShare: vi.fn(() => false),
        isLocalItem: vi.fn(() => false),
        supportsAddingToCollection: vi.fn(() => false),
        supportsAddingToPlaylist: vi.fn(() => false)
    };

    return {
        canEditPlaylist: vi.fn(() => Promise.resolve(false)),
        default: helper
    };
});

vi.mock('./playback/playbackmanager', () => ({
    playbackManager: {
        canPlay: vi.fn(() => false),
        canQueue: vi.fn(() => false),
        getCurrentPlayer: vi.fn(() => null)
    }
}));

vi.mock('./toast/toast', () => ({
    default: mocks.toast
}));

vi.mock('../scripts/settings/userSettings', () => ({
    getSortValuesLegacy: vi.fn(() => ({
        sortBy: 'SortName',
        sortOrder: 'Ascending'
    }))
}));

import { getCommands, show } from './itemContextMenu';

const user = {
    Id: 'user-1',
    Policy: {
        EnableCollectionManagement: false,
        EnableContentDownloading: false,
        EnableLiveTvManagement: false,
        IsAdministrator: false
    }
};

function getMovie(overrides = {}) {
    return {
        Id: 'movie-1',
        MediaType: 'Video',
        ServerId: 'server-1',
        Type: 'Movie',
        UserData: {
            IsFavorite: false,
            Played: false
        },
        ...overrides
    };
}

function rejectWhenMenuSignalAborts(options: Readonly<{ signal: AbortSignal }>) {
    return new Promise<never>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
}

describe('item context menu user actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.apiClient.markPlayed.mockResolvedValue(undefined);
        mocks.apiClient.markUnplayed.mockResolvedValue(undefined);
        mocks.apiClient.updateFavoriteStatus.mockResolvedValue(undefined);
    });

    it('adds capability-gated details, favorite, and played commands', async () => {
        const commands = await getCommands({
            item: getMovie(),
            user
        });

        expect(commands).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'open', name: 'ViewDetails' }),
            expect.objectContaining({ id: 'favorite', name: 'AddToFavorites' }),
            expect.objectContaining({ id: 'markplayed', name: 'MarkPlayed' })
        ]));
    });

    it('uses inverse commands for favorite and played items and honors explicit gates', async () => {
        const inverseCommands = await getCommands({
            item: getMovie({
                UserData: {
                    IsFavorite: true,
                    Played: true
                }
            }),
            user
        });

        expect(inverseCommands).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'unfavorite', name: 'RemoveFromFavorites' }),
            expect.objectContaining({ id: 'markunplayed', name: 'MarkUnplayed' })
        ]));

        const gatedIds = (await getCommands({
            favorite: false,
            item: getMovie(),
            open: false,
            played: false,
            user
        })).map(command => command.id);

        expect(gatedIds).not.toContain('open');
        expect(gatedIds).not.toContain('favorite');
        expect(gatedIds).not.toContain('markplayed');
    });

    it('adds unique extension commands without allowing built-in command replacement', async () => {
        const commands = await getCommands({
            extraCommands: [
                {
                    icon: 'visibility_off',
                    id: 'ptv:not-interested',
                    name: 'Not interested'
                },
                {
                    id: 'ptv:not-interested',
                    name: 'Duplicate'
                },
                {
                    id: 'delete',
                    name: 'Unsafe override'
                }
            ],
            item: getMovie(),
            user
        });

        expect(commands.filter(command => command.id === 'ptv:not-interested')).toEqual([
            expect.objectContaining({
                icon: 'visibility_off',
                name: 'Not interested'
            })
        ]);
        expect(commands.find(command => command.id === 'delete')).toBeUndefined();
    });

    it('executes favorite state through the existing ApiClient and marks the item updated', async () => {
        mocks.actionSheetShow.mockResolvedValueOnce('favorite');

        const result = await show({
            item: getMovie(),
            user
        });

        expect(mocks.apiClient.updateFavoriteStatus).toHaveBeenCalledWith(
            'user-1',
            'movie-1',
            true
        );
        expect(result).toEqual({
            command: 'favorite',
            deleted: false,
            itemId: 'movie-1',
            updated: true
        });
    });

    it('routes View Details through the existing app router exactly once', async () => {
        mocks.actionSheetShow.mockResolvedValueOnce('open');

        const item = getMovie();
        const result = await show({
            item,
            user
        });

        expect(mocks.appRouterShowItem).toHaveBeenCalledTimes(1);
        expect(mocks.appRouterShowItem).toHaveBeenCalledWith(item);
        expect(result).toEqual({
            command: 'open',
            deleted: undefined,
            itemId: undefined,
            updated: undefined
        });
    });

    it('surfaces mutation failures and leaves the menu promise rejected', async () => {
        const error = new Error('mutation failed');

        mocks.actionSheetShow.mockResolvedValueOnce('markplayed');
        mocks.apiClient.markPlayed.mockRejectedValueOnce(error);

        await expect(show({
            item: getMovie(),
            user
        })).rejects.toBe(error);
        expect(mocks.toast).toHaveBeenCalledWith('ErrorDefault');
    });

    it('delegates extension execution to one optional callback', async () => {
        const onExtraCommand = vi.fn(() => Promise.resolve({
            updated: true
        }));

        mocks.actionSheetShow.mockResolvedValueOnce('ptv:not-interested');

        const item = getMovie();
        const result = await show({
            extraCommands: [{
                id: 'ptv:not-interested',
                name: 'Not interested'
            }],
            item,
            onExtraCommand,
            user
        });

        expect(onExtraCommand).toHaveBeenCalledWith('ptv:not-interested', item);
        expect(result).toEqual({
            command: 'ptv:not-interested',
            deleted: false,
            itemId: 'movie-1',
            updated: true
        });
    });

    it('surfaces synchronous extension failures through the same menu error path', async () => {
        const error = new Error('feedback unavailable');

        mocks.actionSheetShow.mockResolvedValueOnce('ptv:not-interested');

        await expect(show({
            extraCommands: [{
                id: 'ptv:not-interested',
                name: 'Not interested'
            }],
            item: getMovie(),
            onExtraCommand: () => {
                throw error;
            },
            user
        })).rejects.toBe(error);
        expect(mocks.toast).toHaveBeenCalledWith('ErrorDefault');
    });

    it('does not open a menu when its captured route identity is already stale', async () => {
        await expect(show({
            isCurrent: () => false,
            item: getMovie(),
            user
        })).resolves.toEqual({ cancelled: true });

        expect(mocks.actionSheetShow).not.toHaveBeenCalled();
        expect(mocks.apiClient.updateFavoriteStatus).not.toHaveBeenCalled();
    });

    it('does not execute a selected mutation after its route identity changes', async () => {
        const isCurrent = vi.fn()
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false);

        mocks.actionSheetShow.mockResolvedValueOnce('favorite');

        await expect(show({
            isCurrent,
            item: getMovie(),
            user
        })).resolves.toEqual({ cancelled: true });

        expect(mocks.actionSheetShow).toHaveBeenCalledTimes(1);
        expect(mocks.apiClient.updateFavoriteStatus).not.toHaveBeenCalled();
    });

    it('cancels a visible menu when its owning route operation retires', async () => {
        const controller = createPtvAbortController();

        mocks.actionSheetShow.mockImplementationOnce(rejectWhenMenuSignalAborts);

        const result = show({
            isCurrent: () => !controller.signal.aborted,
            item: getMovie(),
            signal: controller.signal,
            user
        });

        await vi.waitFor(() => expect(mocks.actionSheetShow).toHaveBeenCalledTimes(1));
        controller.abort();

        await expect(result).resolves.toEqual({ cancelled: true });
        expect(mocks.apiClient.updateFavoriteStatus).not.toHaveBeenCalled();
    });

    it('treats Escape or outside-click dismissal as a normal cancellation', async () => {
        mocks.actionSheetShow.mockRejectedValueOnce(createActionSheetCancelledError());

        await expect(show({
            item: getMovie(),
            user
        })).resolves.toEqual({ cancelled: true });

        expect(mocks.toast).not.toHaveBeenCalled();
        expect(mocks.apiClient.updateFavoriteStatus).not.toHaveBeenCalled();
    });
});
