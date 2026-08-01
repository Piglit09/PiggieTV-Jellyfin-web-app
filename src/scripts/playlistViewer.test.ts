import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPtvAbortController } from '../ptv/core/abortController';

const mocks = vi.hoisted(() => ({
    getListViewHtml: vi.fn(),
    getPtvCurrentUserId: vi.fn(),
    requestPtvJson: vi.fn()
}));

vi.mock('components/listview/listview', () => ({
    default: {
        getListViewHtml: mocks.getListViewHtml
    }
}));

vi.mock('../ptv/api/client', () => ({
    getPtvCurrentUserId: mocks.getPtvCurrentUserId,
    requestPtvJson: mocks.requestPtvJson
}));

import PlaylistViewer from './playlistViewer';

type PlaylistItemsContainer = HTMLDivElement & {
    enableDragReordering: ReturnType<typeof vi.fn>;
    fetchData?: () => Promise<{ Items: Array<{ Id: string; Name: string }> }>;
    getItemsHtml?: (items: Array<{ Id: string; Name: string }>) => string;
    refreshItems: ReturnType<typeof vi.fn>;
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, reject, resolve };
}

function createAbortError() {
    const error = new Error('cancelled');

    error.name = 'AbortError';
    return error;
}

function createPlaylistPage() {
    const page = document.createElement('div');

    page.innerHTML = `
        <div id="childrenContent">
            <div class="itemsContainer vertical-wrap"></div>
        </div>
    `;

    const itemsContainer = page.querySelector('.itemsContainer') as PlaylistItemsContainer;

    itemsContainer.enableDragReordering = vi.fn();
    itemsContainer.refreshItems = vi.fn(async () => {
        const result = await itemsContainer.fetchData?.();
        const items = result?.Items || [];

        itemsContainer.innerHTML = itemsContainer.getItemsHtml?.(items) || '';
    });

    return { itemsContainer, page };
}

describe('PlaylistViewer coordinated detail transport', () => {
    beforeEach(() => {
        mocks.getPtvCurrentUserId.mockReset().mockReturnValue('user-1');
        mocks.requestPtvJson.mockReset();
        mocks.getListViewHtml.mockReset().mockImplementation(({ items }) => (
            items.map((item: { Name: string }) => item.Name).join(',')
        ));
    });

    it('uses the route-owned signal and complete identity for permissions and items', async () => {
        const { itemsContainer, page } = createPlaylistPage();
        const controller = createPtvAbortController();

        mocks.requestPtvJson
            .mockResolvedValueOnce({ CanEdit: true })
            .mockResolvedValueOnce({
                Items: [{ Id: 'track-1', Name: 'Track one' }]
            });

        await PlaylistViewer.render(page, {
            Id: 'playlist-1',
            ServerId: 'server-1'
        }, {
            isCurrent: () => true,
            signal: controller.signal,
            userId: 'user-1'
        });

        expect(mocks.requestPtvJson).toHaveBeenNthCalledWith(
            1,
            'Playlists/playlist-1/Users/user-1',
            {
                serverId: 'server-1',
                signal: controller.signal
            }
        );
        expect(mocks.requestPtvJson).toHaveBeenNthCalledWith(
            2,
            'Playlists/playlist-1/Items',
            {
                params: {
                    EnableImageTypes: 'Primary,Backdrop,Banner,Thumb',
                    Fields: 'PrimaryImageAspectRatio,MediaSourceCount,Chapters,Trickplay',
                    UserId: 'user-1'
                },
                serverId: 'server-1',
                signal: controller.signal
            }
        );
        expect(itemsContainer.enableDragReordering).toHaveBeenCalledWith(true);
        expect(itemsContainer.classList.contains('vertical-list')).toBe(true);
        expect(itemsContainer.textContent).toBe('Track one');
    });

    it('reuses the route permission promise instead of issuing a duplicate lookup', async () => {
        const { itemsContainer, page } = createPlaylistPage();
        const controller = createPtvAbortController();

        mocks.requestPtvJson.mockResolvedValueOnce({
            Items: [{ Id: 'track-1', Name: 'Track one' }]
        });

        await PlaylistViewer.render(page, {
            Id: 'playlist-1',
            ServerId: 'server-1'
        }, {
            editabilityPromise: Promise.resolve(true),
            isCurrent: () => true,
            signal: controller.signal,
            userId: 'user-1'
        });

        expect(mocks.requestPtvJson).toHaveBeenCalledTimes(1);
        expect(mocks.requestPtvJson).toHaveBeenCalledWith(
            'Playlists/playlist-1/Items',
            expect.objectContaining({
                serverId: 'server-1',
                signal: controller.signal
            })
        );
        expect(itemsContainer.enableDragReordering).toHaveBeenCalledWith(true);
    });

    it('rejects late A1 data after hide without overwriting same-item A2', async () => {
        const { itemsContainer, page } = createPlaylistPage();
        const lateA1 = deferred<{ Items: Array<{ Id: string; Name: string }> }>();
        const firstController = createPtvAbortController();
        const secondController = createPtvAbortController();
        let generation = 1;

        mocks.requestPtvJson
            .mockResolvedValueOnce({ CanEdit: false })
            .mockReturnValueOnce(lateA1.promise)
            .mockResolvedValueOnce({ CanEdit: true })
            .mockResolvedValueOnce({
                Items: [{ Id: 'track-a2', Name: 'A2 track' }]
            });

        const firstRender = PlaylistViewer.render(page, {
            Id: 'playlist-a',
            ServerId: 'server-1'
        }, {
            isCurrent: () => generation === 1,
            signal: firstController.signal,
            userId: 'user-1'
        });

        await vi.waitFor(() => {
            expect(mocks.requestPtvJson).toHaveBeenCalledTimes(2);
        });

        generation = 2;
        firstController.abort();

        await PlaylistViewer.render(page, {
            Id: 'playlist-a',
            ServerId: 'server-1'
        }, {
            isCurrent: () => generation === 2,
            signal: secondController.signal,
            userId: 'user-1'
        });

        expect(itemsContainer.textContent).toBe('A2 track');

        lateA1.resolve({
            Items: [{ Id: 'track-a1', Name: 'late A1 track' }]
        });

        await expect(firstRender).rejects.toMatchObject({
            name: 'AbortError'
        });
        expect(itemsContainer.textContent).toBe('A2 track');
        expect(itemsContainer.enableDragReordering).toHaveBeenLastCalledWith(true);
    });

    it('does not let a late A1 permission failure run a stale catch mutation', async () => {
        const { itemsContainer, page } = createPlaylistPage();
        const latePermission = deferred<{ CanEdit: boolean }>();
        const firstController = createPtvAbortController();
        const secondController = createPtvAbortController();
        let generation = 1;

        mocks.requestPtvJson
            .mockReturnValueOnce(latePermission.promise)
            .mockResolvedValueOnce({ CanEdit: true })
            .mockResolvedValueOnce({
                Items: [{ Id: 'track-a2', Name: 'A2 track' }]
            });

        const firstRender = PlaylistViewer.render(page, {
            Id: 'playlist-a',
            ServerId: 'server-1'
        }, {
            isCurrent: () => generation === 1,
            signal: firstController.signal,
            userId: 'user-1'
        });

        generation = 2;
        firstController.abort();

        await PlaylistViewer.render(page, {
            Id: 'playlist-a',
            ServerId: 'server-1'
        }, {
            isCurrent: () => generation === 2,
            signal: secondController.signal,
            userId: 'user-1'
        });

        latePermission.reject(new Error('late permission 500'));

        await expect(firstRender).rejects.toMatchObject({
            name: 'AbortError'
        });
        expect(itemsContainer.textContent).toBe('A2 track');
        expect(itemsContainer.enableDragReordering).toHaveBeenLastCalledWith(true);
    });

    it('propagates cancellation without running the refresh continuation', async () => {
        const { itemsContainer, page } = createPlaylistPage();
        const controller = createPtvAbortController();

        mocks.requestPtvJson.mockRejectedValueOnce(createAbortError());

        await expect(PlaylistViewer.render(page, {
            Id: 'playlist-1',
            ServerId: 'server-1'
        }, {
            isCurrent: () => true,
            signal: controller.signal,
            userId: 'user-1'
        })).rejects.toMatchObject({
            name: 'AbortError'
        });

        expect(itemsContainer.enableDragReordering).not.toHaveBeenCalled();
        expect(itemsContainer.refreshItems).not.toHaveBeenCalled();
        expect(page.querySelector('#childrenContent')?.classList).not
            .toContain('verticalSection-extrabottompadding');
    });

    it('treats a 404 permission record as optional without a fallback request', async () => {
        const { itemsContainer, page } = createPlaylistPage();
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const notFound = Object.assign(new Error('permission 404'), {
            statusCode: 404
        });

        mocks.requestPtvJson
            .mockRejectedValueOnce(notFound)
            .mockResolvedValueOnce({
                Items: [{ Id: 'track-1', Name: 'Track one' }]
            });

        await PlaylistViewer.render(page, {
            Id: 'playlist-1',
            ServerId: 'server-1'
        }, {
            isCurrent: () => true,
            signal: createPtvAbortController().signal,
            userId: 'user-1'
        });

        expect(mocks.requestPtvJson).toHaveBeenCalledTimes(2);
        expect(itemsContainer.enableDragReordering).toHaveBeenCalledWith(false);
        expect(itemsContainer.textContent).toBe('Track one');
        info.mockRestore();
    });
});
