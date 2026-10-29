import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PtvMusicPlaylistRequest, PtvMusicPlaylistResult } from './musicTypes';

const identity = vi.hoisted(() => ({ serverId: 'server-a', userId: 'user-a' }));
const playlists = vi.hoisted(() => ({ generate: vi.fn(), save: vi.fn() }));

vi.mock('components/Page', () => ({ default: () => null }));
vi.mock('components/toast/toast', () => ({ default: vi.fn() }));
vi.mock('RootAppRouter', () => ({ history: {} }));
vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: { currentApiClient: () => null } }));
vi.mock('../../shell/PTVShell', () => ({ default: () => null }));
vi.mock('../../core/router', () => ({ scheduleRouteCheck: vi.fn() }));
vi.mock('../../core/observability', () => ({ recordPtvEvent: vi.fn() }));
vi.mock('../../core/clientProfile', () => ({}));
vi.mock('../../core/tvFocus', () => ({}));
vi.mock('../../services/playbackPresentationService', () => ({}));
vi.mock('../../services/runtimeOverlayOcclusion', () => ({}));
vi.mock('../../utils/usePtvAdminDebugVisibility', () => ({
    usePtvAdminDebugVisibility: () => ({ canShowDebug: false, isAdmin: false })
}));
vi.mock('../../api', () => ({
    getPtvApiUrl: vi.fn(() => ''),
    getPtvCurrentUserId: () => identity.userId,
    getPtvServerId: () => identity.serverId,
    hasPtvImageUrlFailed: vi.fn(() => false),
    setPtvFavorite: vi.fn()
}));
vi.mock('./musicQueue', () => ({ playPtvMusicNext: vi.fn() }));
vi.mock('./musicPlayerResourcePolicy', () => ({}));
vi.mock('./musicIdentifyAdoption', () => ({}));
vi.mock('./musicAlbumArtistResolution', () => ({}));
vi.mock('./musicItemMenuOverlay', () => ({ default: () => null }));
vi.mock('./musicLikes', () => ({}));
vi.mock('./musicPlaylistEvents', () => ({}));
vi.mock('./musicLoadState', () => ({}));
vi.mock('./musicArtistFavoriteCache', () => ({}));
vi.mock('./musicMixSeed', () => ({}));
vi.mock('./musicIdentityCache', () => ({ PtvMusicIdentityResourceCache: class {} }));
vi.mock('./musicRoutePolicy', () => ({}));
vi.mock('./musicProgressiveDetail', () => ({}));
vi.mock('./musicRecommendations', () => ({}));
vi.mock('./musicApi', () => ({
    getPtvMusicAlbum: (item: { Album?: string }) => item.Album || '',
    getPtvMusicArtist: (item: { AlbumArtist?: string }) => item.AlbumArtist || '',
    getPtvMusicTitle: (item: { Name?: string }) => item.Name || '',
    getMusicImagePlaceholder: () => '',
    getMusicImageUrl: () => '',
    uniquePtvMusicItems: (items: unknown[]) => items
}));
vi.mock('./musicArtwork', () => ({ default: () => null }));
vi.mock('./musicPlaylists', () => ({
    generatePtvMusicPlaylist: playlists.generate,
    savePtvMusicPlaylist: playlists.save
}));
vi.mock('../icons', () => ({ PtvIcon: () => null }));

let SmartPlaylistPanel: typeof import('./musicPage')['SmartPlaylistPanel'];

beforeAll(async () => {
    vi.stubGlobal('__WEBPACK_SERVE__', false);
    ({ SmartPlaylistPanel } = await import('./musicPage'));
});

afterAll(() => {
    vi.unstubAllGlobals();
});

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}

function result(name: string, itemCount: number): PtvMusicPlaylistResult {
    return {
        description: name,
        items: Array.from({ length: itemCount }, (_, index) => ({
            Id: `${name}-${index}`,
            Name: `${name} ${index}`,
            Type: 'Audio'
        })),
        name,
        seed: { kind: 'random' }
    };
}

function setReactActEnvironment(value: boolean) {
    const environment = globalThis as typeof globalThis & Record<string, unknown>;

    environment['IS_REACT_ACT_ENVIRONMENT'] = value;
}

describe('Smart Playlist Generate action', () => {
    let host: HTMLDivElement;
    let root: Root | null;
    let onGenerated: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        identity.serverId = 'server-a';
        identity.userId = 'user-a';
        playlists.generate.mockReset();
        playlists.save.mockReset().mockResolvedValue({ Id: 'saved-playlist' });
        onGenerated = vi.fn();
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        setReactActEnvironment(true);
    });

    afterEach(() => {
        if (root) act(() => root?.unmount());
        host.remove();
        setReactActEnvironment(false);
    });

    function render(generated: PtvMusicPlaylistResult | null = null) {
        act(() => root?.render(<SmartPlaylistPanel generated={generated} onGenerated={onGenerated} />));
    }

    function submit() {
        act(() => {
            host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
    }

    it('uses a fresh session seed per click and publishes only the newest result', async () => {
        const first = deferred<PtvMusicPlaylistResult>();
        const second = deferred<PtvMusicPlaylistResult>();

        playlists.generate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        render();
        submit();
        submit();

        const firstRequest = playlists.generate.mock.calls[0]?.[0] as PtvMusicPlaylistRequest;
        const secondRequest = playlists.generate.mock.calls[1]?.[0] as PtvMusicPlaylistRequest;

        expect(playlists.generate).toHaveBeenCalledTimes(2);
        expect(firstRequest.sessionSeed).toBeTruthy();
        expect(secondRequest.sessionSeed).toBeTruthy();
        expect(secondRequest.sessionSeed).not.toBe(firstRequest.sessionSeed);
        expect(firstRequest.signal?.aborted).toBe(true);
        expect(firstRequest.isCurrent?.()).toBe(false);
        expect(secondRequest.isCurrent?.()).toBe(true);

        const newerResult = result('Newer Mix', 1);

        await act(async () => {
            second.resolve(newerResult);
            await second.promise;
        });
        await act(async () => {
            first.resolve(result('Older Mix', 2));
            await first.promise;
        });

        expect(onGenerated).toHaveBeenCalledExactlyOnceWith(newerResult);
        expect(host.querySelector('[role="status"]')?.textContent || host.querySelector('[aria-live="polite"]')?.textContent)
            .toBe('1 tracks');
    });

    it('retires a pending generation when the panel unmounts', async () => {
        const pending = deferred<PtvMusicPlaylistResult>();

        playlists.generate.mockReturnValue(pending.promise);
        render();
        submit();
        const request = playlists.generate.mock.calls[0]?.[0] as PtvMusicPlaylistRequest;

        act(() => root?.unmount());
        root = null;
        expect(request.signal?.aborted).toBe(true);
        expect(request.isCurrent?.()).toBe(false);

        await act(async () => {
            pending.resolve(result('Retired Mix', 1));
            await pending.promise;
        });
        expect(onGenerated).not.toHaveBeenCalled();
    });

    it('retires a pending generation when the display identity changes', async () => {
        const pending = deferred<PtvMusicPlaylistResult>();

        playlists.generate.mockReturnValue(pending.promise);
        render();
        submit();
        const request = playlists.generate.mock.calls[0]?.[0] as PtvMusicPlaylistRequest;

        identity.userId = 'user-b';
        expect(request.isCurrent?.()).toBe(false);
        expect(request.signal?.aborted).toBe(true);
        render();

        await act(async () => {
            pending.resolve(result('Previous User Mix', 1));
            await pending.promise;
        });
        expect(onGenerated).not.toHaveBeenCalled();
    });

    it('does not start a generation without a server and user identity', () => {
        playlists.generate.mockResolvedValue(result('Unexpected Mix', 0));
        identity.userId = '';
        render();
        submit();

        expect(playlists.generate).not.toHaveBeenCalled();
        expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe('Sign in to build a mix.');
    });

    it('plays or saves the displayed queue without starting another generation', async () => {
        const generated = result('Displayed Mix', 1);

        render(generated);
        const buttons = Array.from(host.querySelectorAll('button'));
        const playButton = buttons.find(button => button.textContent?.trim() === 'Play');
        const saveButton = buttons.find(button => button.textContent?.trim() === 'Save');

        act(() => playButton?.click());
        await act(async () => {
            saveButton?.click();
            await Promise.resolve();
        });

        expect(playlists.generate).not.toHaveBeenCalled();
        expect(playlists.save).toHaveBeenCalledExactlyOnceWith(generated.name, generated.items);
    });
});
