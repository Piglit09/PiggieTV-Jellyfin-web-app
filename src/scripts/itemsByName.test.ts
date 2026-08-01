import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPtvAbortController } from '../ptv/core/abortController';

const mocks = vi.hoisted(() => ({
    getCardsHtml: vi.fn(),
    getListViewHtml: vi.fn(),
    getPtvCurrentUserId: vi.fn(),
    lazyChildren: vi.fn(),
    requestPtvJson: vi.fn(),
    translate: vi.fn((key: string) => key)
}));

vi.mock('components/cardbuilder/cardBuilder', () => ({
    default: {
        getCardsHtml: mocks.getCardsHtml
    }
}));

vi.mock('components/images/imageLoader', () => ({
    default: {
        lazyChildren: mocks.lazyChildren
    }
}));

vi.mock('components/listview/listview', () => ({
    default: {
        getListViewHtml: mocks.getListViewHtml
    }
}));

vi.mock('lib/globalize', () => ({
    default: {
        translate: mocks.translate
    }
}));

vi.mock('../ptv/api/client', () => ({
    getPtvCurrentUserId: mocks.getPtvCurrentUserId,
    requestPtvJson: mocks.requestPtvJson
}));

vi.mock('../elements/emby-itemscontainer/emby-itemscontainer', () => ({}));
vi.mock('../elements/emby-button/emby-button', () => ({}));

import ItemsByName from './itemsByName';

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

function createPage() {
    const page = document.createElement('div');

    page.innerHTML = '<div id="childrenContent"></div>';
    return page;
}

describe('ItemsByName coordinated detail transport', () => {
    beforeEach(() => {
        mocks.getPtvCurrentUserId.mockReset().mockReturnValue('user-1');
        mocks.requestPtvJson.mockReset();
        mocks.lazyChildren.mockReset();
        mocks.getCardsHtml.mockReset().mockImplementation(({ items }) => (
            items.map((item: { Name: string }) => item.Name).join(',')
        ));
        mocks.getListViewHtml.mockReset().mockImplementation(({ items }) => (
            items.map((item: { Name: string }) => item.Name).join(',')
        ));
    });

    it('uses the route-owned signal and complete identity for item fanout', async () => {
        const page = createPage();
        const controller = createPtvAbortController();

        mocks.requestPtvJson.mockResolvedValueOnce({
            Items: [{ Id: 'movie-1', Name: 'Movie one' }],
            TotalRecordCount: 1
        });

        await ItemsByName.renderItems(page, {
            Id: 'person-1',
            MovieCount: 1,
            ServerId: 'server-1',
            Type: 'Person'
        }, {
            isCurrent: () => true,
            signal: controller.signal,
            userId: 'user-1'
        });

        expect(mocks.requestPtvJson).toHaveBeenCalledWith(
            'Users/user-1/Items',
            {
                params: expect.objectContaining({
                    IncludeItemTypes: 'Movie',
                    PersonIds: 'person-1'
                }),
                serverId: 'server-1',
                signal: controller.signal
            }
        );
        expect(page.querySelector('[data-type="Movie"] .itemsContainer')?.textContent)
            .toBe('Movie one');
    });

    it('uses the coordinated album-artist endpoint without a legacy fallback', async () => {
        const page = createPage();
        const controller = createPtvAbortController();

        mocks.requestPtvJson.mockResolvedValueOnce({
            Items: [{ Id: 'artist-1', Name: 'Artist one' }],
            TotalRecordCount: 1
        });

        await ItemsByName.renderItems(page, {
            ArtistCount: 1,
            Id: 'studio-1',
            ServerId: 'server-1',
            Type: 'Studio'
        }, {
            isCurrent: () => true,
            signal: controller.signal,
            userId: 'user-1'
        });

        expect(mocks.requestPtvJson).toHaveBeenCalledWith(
            'Artists/AlbumArtists',
            {
                params: expect.objectContaining({
                    IncludeItemTypes: null,
                    StudioIds: 'studio-1',
                    UserId: 'user-1'
                }),
                serverId: 'server-1',
                signal: controller.signal
            }
        );
        expect(mocks.requestPtvJson).toHaveBeenCalledTimes(1);
    });

    it('ignores late A1 completion after hide while same-item A2 stays rendered', async () => {
        const page = createPage();
        const lateA1 = deferred<{
            Items: Array<{ Id: string; Name: string }>;
            TotalRecordCount: number;
        }>();
        const firstController = createPtvAbortController();
        const secondController = createPtvAbortController();
        let generation = 1;

        mocks.requestPtvJson
            .mockReturnValueOnce(lateA1.promise)
            .mockResolvedValueOnce({
                Items: [{ Id: 'movie-a2', Name: 'A2 movie' }],
                TotalRecordCount: 1
            });

        const firstRender = ItemsByName.renderItems(page, {
            Id: 'person-a',
            MovieCount: 1,
            ServerId: 'server-1',
            Type: 'Person'
        }, {
            isCurrent: () => generation === 1,
            signal: firstController.signal,
            userId: 'user-1'
        });

        generation = 2;
        firstController.abort();

        await ItemsByName.renderItems(page, {
            Id: 'person-a',
            MovieCount: 1,
            ServerId: 'server-1',
            Type: 'Person'
        }, {
            isCurrent: () => generation === 2,
            signal: secondController.signal,
            userId: 'user-1'
        });

        expect(page.querySelector('[data-type="Movie"] .itemsContainer')?.textContent)
            .toBe('A2 movie');

        lateA1.resolve({
            Items: [{ Id: 'movie-a1', Name: 'late A1 movie' }],
            TotalRecordCount: 1
        });
        await firstRender;

        expect(page.querySelector('[data-type="Movie"] .itemsContainer')?.textContent)
            .toBe('A2 movie');
    });

    it('does not let a late A1 rejection replace A2 with failure state', async () => {
        const page = createPage();
        const lateA1 = deferred<{
            Items: Array<{ Id: string; Name: string }>;
            TotalRecordCount: number;
        }>();
        const firstController = createPtvAbortController();
        const secondController = createPtvAbortController();
        let generation = 1;

        mocks.requestPtvJson
            .mockReturnValueOnce(lateA1.promise)
            .mockResolvedValueOnce({
                Items: [{ Id: 'movie-a2', Name: 'A2 movie' }],
                TotalRecordCount: 1
            });

        const firstRender = ItemsByName.renderItems(page, {
            Id: 'person-a',
            MovieCount: 1,
            ServerId: 'server-1',
            Type: 'Person'
        }, {
            isCurrent: () => generation === 1,
            signal: firstController.signal,
            userId: 'user-1'
        });

        generation = 2;
        firstController.abort();

        await ItemsByName.renderItems(page, {
            Id: 'person-a',
            MovieCount: 1,
            ServerId: 'server-1',
            Type: 'Person'
        }, {
            isCurrent: () => generation === 2,
            signal: secondController.signal,
            userId: 'user-1'
        });

        lateA1.reject(new Error('late A1 500'));
        await firstRender;

        expect(page.querySelector('[data-type="Movie"] .itemsContainer')?.textContent)
            .toBe('A2 movie');
        expect(page.querySelector('.ptv-detail-section-failure')).toBeNull();
    });

    it('keeps successful shelves ready and retries one failed shelf once', async () => {
        const page = createPage();
        let movieAttempts = 0;

        mocks.requestPtvJson.mockImplementation((_path, options) => {
            const includeType = options.params.IncludeItemTypes;

            if (includeType === 'Movie') {
                movieAttempts += 1;
                if (movieAttempts === 1) {
                    return Promise.reject(new Error('movie 500'));
                }

                return Promise.resolve({
                    Items: [{ Id: 'movie-1', Name: 'Recovered movie' }],
                    TotalRecordCount: 1
                });
            }

            return Promise.resolve({
                Items: [{ Id: 'series-1', Name: 'Ready series' }],
                TotalRecordCount: 1
            });
        });

        await ItemsByName.renderItems(page, {
            Id: 'person-1',
            MovieCount: 1,
            SeriesCount: 1,
            ServerId: 'server-1',
            Type: 'Person'
        }, {
            isCurrent: () => true,
            signal: createPtvAbortController().signal,
            userId: 'user-1'
        });

        const movieSection = page.querySelector('[data-type="Movie"]');
        const seriesSection = page.querySelector('[data-type="Series"]');
        const retry = movieSection?.querySelector(
            '.ptv-detail-section-failure button'
        );

        expect(retry?.textContent).toBe('Retry');
        expect(seriesSection?.querySelector('.itemsContainer')?.textContent)
            .toBe('Ready series');

        retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        await vi.waitFor(() => {
            expect(movieSection?.querySelector('.itemsContainer')?.textContent)
                .toBe('Recovered movie');
        });

        expect(movieAttempts).toBe(2);
        expect(seriesSection?.querySelector('.itemsContainer')?.textContent)
            .toBe('Ready series');
    });

    it('contains malformed optional metadata to its shelf', async () => {
        const page = createPage();

        mocks.requestPtvJson.mockResolvedValueOnce(null);

        await ItemsByName.renderItems(page, {
            Id: 'person-1',
            MovieCount: 1,
            ServerId: 'server-1',
            Type: 'Person'
        }, {
            isCurrent: () => true,
            signal: createPtvAbortController().signal,
            userId: 'user-1'
        });

        expect(
            page.querySelector(
                '[data-type="Movie"] .ptv-detail-section-failure button'
            )?.textContent
        ).toBe('Retry');
        expect(page.querySelectorAll('.verticalSection')).toHaveLength(1);
    });

    it('propagates cancellation without changing a shelf into failure state', async () => {
        const page = createPage();

        mocks.requestPtvJson.mockRejectedValueOnce(createAbortError());

        await expect(ItemsByName.renderItems(page, {
            Id: 'person-1',
            MovieCount: 1,
            ServerId: 'server-1',
            Type: 'Person'
        }, {
            isCurrent: () => true,
            signal: createPtvAbortController().signal,
            userId: 'user-1'
        })).rejects.toMatchObject({
            name: 'AbortError'
        });

        expect(page.querySelector('[data-type="Movie"] .ptv-detail-section-failure'))
            .toBeNull();
        expect(
            page.querySelector('[data-type="Movie"] .itemsContainer')?.textContent
        ).toBe('');
    });
});
