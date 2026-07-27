import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../components/router/appRouter', () => ({
    appRouter: {
        show: vi.fn()
    }
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: vi.fn(() => true)
}));

import { appRouter } from '../../../components/router/appRouter';

import { resolvePtvItemRoute } from '../../core/itemRoutes';
import { recordPtvEvent } from '../../core/observability';
import {
    activateNativeSearchCard,
    openNativeSearchDetails,
    shouldUsePtvSearchDetailsNavigation,
    type PtvSearchCardActivationEvent
} from './nativeSearchDetailsNavigation';

function createActivationEvent(
    overrides: Partial<PtvSearchCardActivationEvent> = {}
): PtvSearchCardActivationEvent {
    return {
        altKey: false,
        button: 0,
        ctrlKey: false,
        defaultPrevented: false,
        metaKey: false,
        preventDefault: vi.fn(),
        shiftKey: false,
        ...overrides
    };
}

function countEvent(eventName: string) {
    return vi.mocked(recordPtvEvent).mock.calls
        .filter(([, recordedEvent]) => recordedEvent === eventName)
        .length;
}

describe('native Search details navigation adoption', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(appRouter.show).mockResolvedValue(undefined);
    });

    it('turns one movie card activation into one Core intent and one appRouter call', async () => {
        const item = { Id: 'movie 1', ServerId: 'server 1', Type: 'Movie' };
        const route = resolvePtvItemRoute(item, {
            fallbackHref: '#/details?id=movie%201&serverId=server%201',
            source: 'ptv-search'
        });
        const event = createActivationEvent();

        const result = await activateNativeSearchCard({
            event,
            item,
            route,
            sourceGroup: 'movies'
        });

        expect(result).toEqual({
            success: true,
            value: '#/details?id=movie%201&serverId=server%201'
        });
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(appRouter.show).toHaveBeenCalledTimes(1);
        expect(appRouter.show).toHaveBeenCalledWith('#/details?id=movie%201&serverId=server%201');
        expect(countEvent('ptv-item-route-click')).toBe(1);
        expect(countEvent('ptv-core-details-navigation')).toBe(1);
    });

    it.each([
        ['Series', 'show-1', 'shows'],
        ['Season', 'season-1', 'seasons'],
        ['Episode', 'episode-1', 'episodes'],
        ['BoxSet', 'collection-1', 'collections']
    ])('adopts the existing generic details route for %s', async (type, id, sourceGroup) => {
        const item = { Id: id, Type: type };
        const route = resolvePtvItemRoute(item, {
            fallbackHref: `#/details?id=${id}`
        });

        await activateNativeSearchCard({
            event: createActivationEvent(),
            item,
            route,
            sourceGroup
        });

        expect(appRouter.show).toHaveBeenCalledTimes(1);
        expect(appRouter.show).toHaveBeenCalledWith(`#/details?id=${id}`);
    });

    it('preserves parent scope, extra query state, and encoded opaque IDs', async () => {
        const result = await openNativeSearchDetails({
            href: '#/details?id=episode%2F1&parentId=library%20one&serverId=server%201&from=search%20term',
            mediaId: 'episode/1'
        });

        expect(result).toEqual({
            success: true,
            value: '#/details?id=episode%2F1&parentId=library%20one&serverId=server%201&from=search%20term'
        });
        expect(appRouter.show).toHaveBeenCalledWith(
            '#/details?id=episode%2F1&parentId=library%20one&serverId=server%201&from=search%20term'
        );
    });

    it.each([
        [{ Id: 'book-1', Type: 'Book' }, 'ptv-reading'],
        [{ Id: 'song-1', Type: 'Audio' }, 'ptv-music'],
        [{ Id: 'album-1', Type: 'MusicAlbum' }, 'ptv-music'],
        [{ Id: 'artist-1', Type: 'MusicArtist' }, 'ptv-music']
    ])('leaves specialized item routing under the existing anchor behavior', async (item, routeSource) => {
        const route = resolvePtvItemRoute(item);
        const event = createActivationEvent();

        const result = activateNativeSearchCard({
            event,
            item,
            route,
            sourceGroup: 'specialized'
        });

        expect(result).toBeNull();
        expect(route.routeSource).toBe(routeSource);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(appRouter.show).not.toHaveBeenCalled();
        expect(countEvent('ptv-item-route-click')).toBe(1);
        expect(countEvent('ptv-core-details-navigation')).toBe(0);
    });

    it.each([
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { altKey: true },
        { button: 1 }
    ])('preserves modified and middle-click browser behavior for %o', overrides => {
        const item = { Id: 'movie-1', Type: 'Movie' };
        const route = resolvePtvItemRoute(item);
        const event = createActivationEvent(overrides);

        const result = activateNativeSearchCard({
            event,
            item,
            route,
            sourceGroup: 'movies'
        });

        expect(result).toBeNull();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(appRouter.show).not.toHaveBeenCalled();
        expect(countEvent('ptv-item-route-click')).toBe(1);
    });

    it('does not intercept unsupported generic types', () => {
        const item = { Id: 'folder-1', Type: 'Folder' };
        const route = resolvePtvItemRoute(item);
        const event = createActivationEvent();

        expect(shouldUsePtvSearchDetailsNavigation(item, route)).toBe(false);
        expect(activateNativeSearchCard({
            event,
            item,
            route,
            sourceGroup: 'unsupported'
        })).toBeNull();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(appRouter.show).not.toHaveBeenCalled();
        expect(countEvent('ptv-item-route-click')).toBe(1);
    });

    it('prevents an invalid generic details href without calling appRouter', async () => {
        const item = { Id: '', Type: 'Movie' };
        const route = resolvePtvItemRoute(item, {
            fallbackHref: '#/details?id=&serverId=server-1'
        });
        const event = createActivationEvent();

        const result = await activateNativeSearchCard({
            event,
            item,
            route,
            sourceGroup: 'movies'
        });

        expect(result).toMatchObject({
            error: { code: 'NAVIGATION_MEDIA_ID_REQUIRED' },
            success: false
        });
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(appRouter.show).not.toHaveBeenCalled();
        expect(countEvent('ptv-item-route-click')).toBe(1);
        expect(countEvent('ptv-core-details-navigation')).toBe(1);
    });

    it('maps an appRouter exception to one Core failure diagnostic', async () => {
        vi.mocked(appRouter.show).mockRejectedValue(new Error('router unavailable'));
        const item = { Id: 'movie-1', Type: 'Movie' };
        const route = resolvePtvItemRoute(item);

        const result = await activateNativeSearchCard({
            event: createActivationEvent(),
            item,
            route,
            sourceGroup: 'movies'
        });

        expect(result).toMatchObject({
            error: { code: 'NAVIGATION_ADAPTER_FAILED' },
            success: false
        });
        expect(appRouter.show).toHaveBeenCalledTimes(1);
        expect(countEvent('ptv-item-route-click')).toBe(1);
        expect(countEvent('ptv-core-details-navigation')).toBe(1);
    });

    it('keeps navigation successful when the Core diagnostic sink fails', async () => {
        vi.mocked(recordPtvEvent).mockImplementation((_, eventName) => {
            if (eventName === 'ptv-core-details-navigation') {
                throw new Error('diagnostic unavailable');
            }
        });
        const item = { Id: 'movie-1', Type: 'Movie' };

        await expect(activateNativeSearchCard({
            event: createActivationEvent(),
            item,
            route: resolvePtvItemRoute(item),
            sourceGroup: 'movies'
        })).resolves.toMatchObject({
            success: true
        });
        expect(appRouter.show).toHaveBeenCalledTimes(1);
    });

    it('deduplicates a double activation while navigation is in flight', async () => {
        let resolveNavigation: (() => void) | undefined;
        vi.mocked(appRouter.show).mockImplementation(() => new Promise<void>(resolve => {
            resolveNavigation = resolve;
        }));
        const item = { Id: 'movie-1', Type: 'Movie' };
        const route = resolvePtvItemRoute(item);
        const first = activateNativeSearchCard({
            event: createActivationEvent(),
            item,
            route,
            sourceGroup: 'movies'
        });
        const second = activateNativeSearchCard({
            event: createActivationEvent(),
            item,
            route,
            sourceGroup: 'movies'
        });

        expect(first).toBe(second);
        expect(appRouter.show).toHaveBeenCalledTimes(1);
        expect(countEvent('ptv-item-route-click')).toBe(1);
        resolveNavigation?.();
        await first;
        expect(countEvent('ptv-core-details-navigation')).toBe(1);
    });
});
