import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventType } from '../../../constants/eventType';
import Events from '../../../utils/events';

type HeaderItem = Record<string, unknown>;
type ModuleLifecycle = { refresh(): void; destroy(): void };

const fixture = vi.hoisted(() => {
    const state = {
        item: null as HeaderItem | null,
        lifecycle: null as ModuleLifecycle | null
    };
    const player = { id: 'htmlvideoplayer', name: 'HTML Video Player', _callbacks: {} };
    const manager = {
        _callbacks: {},
        currentItem: () => state.item,
        getCurrentPlayer: () => player,
        getPlayerState: () => ({ NowPlayingItem: state.item, PlayState: { IsPaused: false } })
    };
    const back = vi.fn();
    const getScaledImageUrl = vi.fn((id: string, options: { tag: string; type: string }) => (
        `http://127.0.0.1:8097/Items/${id}/Images/${options.type}?tag=${options.tag}`
    ));
    const loadImage = vi.fn<(url: string, priority: string, scope: string) => {
        cancel: () => void;
        promise: Promise<boolean>;
    }>(() => ({ cancel: vi.fn(), promise: Promise.resolve(false) }));

    return { back, getScaledImageUrl, loadImage, manager, player, state };
});

// Keep the complete PTV playback entry point, its Events wiring and chrome
// bridge real. Isolate unrelated network/pause artwork/router collaborators.
vi.mock('../../../components/playback/playbackmanager', () => ({ playbackManager: fixture.manager }));
vi.mock('../../../lib/jellyfin-apiclient', () => ({
    ServerConnections: { getApiClient: () => ({
        getScaledImageUrl: fixture.getScaledImageUrl,
        getCurrentUserId: () => 'local-user',
        getItem: () => Promise.resolve(null)
    }) }
}));
vi.mock('../../../components/router/appRouter', () => ({ appRouter: { back: fixture.back } }));
vi.mock('../../core/lifecycle', () => ({
    registerModule: (lifecycle: ModuleLifecycle) => { fixture.state.lifecycle = lifecycle; }
}));
vi.mock('../../core/imageManager', () => ({ cancelPtvImageScope: vi.fn(), loadPtvImage: fixture.loadImage }));
vi.mock('../../core/observer', () => ({ watchDom: () => () => undefined }));
vi.mock('../../core/clientProfile', () => ({ getPtvClientProfile: () => ({ isTv: false }) }));
vi.mock('../../core/featureSettings', () => ({ getPtvPlaybackMode: () => 'compatible', isPtvPlaybackMode: () => false }));
vi.mock('../../core/observability', () => ({ recordPtvEvent: vi.fn() }));
vi.mock('../../core/tvFocus', () => ({
    notifyPtvTvFocusContentReady: vi.fn(),
    notifyPtvTvPlaybackFocus: vi.fn(),
    notifyPtvTvPlaybackSurfaceReady: vi.fn(),
    registerPtvTvPlaybackBackHandler: () => () => undefined
}));
vi.mock('../../services/playbackPresentationService', () => ({ setPtvVideoPlaybackPresentation: vi.fn() }));
vi.mock('./playbackChrome', () => ({}));
vi.mock('./playback.scss', () => ({}));

function episode(): HeaderItem {
    return {
        Id: 'episode-1',
        MediaType: 'Video',
        Name: 'Episode title',
        SeriesId: 'series-1',
        SeriesName: 'Series title',
        ServerId: 'local-server',
        Type: 'Episode'
    };
}

function header(): HTMLElement {
    const element = document.querySelector('.ptv-player-topbar');
    expect(element).toBeInstanceOf(HTMLElement);
    return element as HTMLElement;
}

describe('PTV playback header wiring', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        vi.resetModules();
        vi.clearAllMocks();
        fixture.manager._callbacks = {};
        fixture.player._callbacks = {};
        fixture.state.item = episode();
        fixture.state.lifecycle = null;
        fixture.back.mockImplementation(() => undefined);
        document.documentElement.className = '';
        document.body.className = 'videoOsdBody';
        document.body.innerHTML = '<section id="videoOsdPage"><div class="videoOsdBottom"></div></section>';
        window.history.replaceState(null, '', '#/video');
        await import('./index');
    });

    afterEach(() => {
        fixture.state.lifecycle?.destroy();
        vi.clearAllTimers();
        vi.useRealTimers();
        window.history.replaceState(null, '', '#/home');
    });

    it('restores one top bar with Series identity and the existing Back owner', () => {
        Events.trigger(document, EventType.SHOW_VIDEO_OSD, [true]);
        fixture.state.lifecycle?.refresh();
        fixture.state.lifecycle?.refresh();

        expect(document.querySelectorAll('.ptv-player-topbar')).toHaveLength(1);
        expect(header().querySelector('.ptv-player-top-title')?.textContent).toBe('Series title');
        expect(header().getAttribute('aria-hidden')).toBe('false');
        (header().querySelector('.ptv-player-top-back') as HTMLButtonElement).click();
        expect(fixture.back).toHaveBeenCalledTimes(1);
    });

    it('follows the existing show/hide event and disables hidden Back focus', () => {
        Events.trigger(document, EventType.SHOW_VIDEO_OSD, [true]);
        const back = header().querySelector('.ptv-player-top-back') as HTMLButtonElement;
        expect(back.tabIndex).toBe(0);

        Events.trigger(document, EventType.SHOW_VIDEO_OSD, [false]);
        expect(header().getAttribute('aria-hidden')).toBe('true');
        expect(back.tabIndex).toBe(-1);

        Events.trigger(document, EventType.SHOW_VIDEO_OSD, [true]);
        expect(header().getAttribute('aria-hidden')).toBe('false');
        expect(back.tabIndex).toBe(0);
    });

    it('uses the existing hide timer and active-owner interaction query, then hides both chrome surfaces', async () => {
        const { registerPtvVideoControlsVisibilityHandler } = await import('./videoInputOwnership');
        let held = true;
        const visibility = vi.fn((visible: boolean) => Events.trigger(document, EventType.SHOW_VIDEO_OSD, [visible]));
        const lease = registerPtvVideoControlsVisibilityHandler('jellyfin-video-controller', visibility, () => held);
        try {
            Events.trigger(document, EventType.SHOW_VIDEO_OSD, [true]);
            vi.advanceTimersByTime(4200);
            expect(visibility).not.toHaveBeenCalled();
            expect(header().getAttribute('aria-hidden')).toBe('false');

            held = false;
            vi.advanceTimersByTime(4200);
            expect(visibility).toHaveBeenCalledExactlyOnceWith(false);
            expect(header().getAttribute('aria-hidden')).toBe('true');
            expect(document.documentElement.classList.contains('ptv-player-chrome-visible')).toBe(false);
        } finally {
            lease.release();
        }
    });

    it('keeps top identity current when the same player advances to a Movie', () => {
        const oldHeader = header();
        fixture.state.item = { Id: 'movie-1', MediaType: 'Video', Name: 'Movie title', Type: 'Movie' };
        Events.trigger(fixture.manager, 'playbackstart', [fixture.player, fixture.manager.getPlayerState()]);

        expect(header()).toBe(oldHeader);
        expect(header().querySelector('.ptv-player-top-title')?.textContent).toBe('Movie title');
        expect(header().textContent).not.toContain('Episode title');
    });

    it('uses the Series logo rather than the Episode logo', () => {
        fixture.state.item = {
            ...episode(),
            ImageTags: { Logo: 'episode-logo' },
            ParentLogoImageTag: 'series-logo',
            ParentLogoItemId: 'series-1'
        };
        fixture.state.lifecycle?.refresh();

        const headerLoads = fixture.loadImage.mock.calls.filter(([, , scope]) => scope === 'player-header-logo');
        expect(headerLoads.map(([url]) => url)).toEqual(['http://127.0.0.1:8097/Items/series-1/Images/Logo?tag=series-logo']);
    });

    it('does not use an unproven parent logo as Series identity', () => {
        fixture.state.item = { ...episode(), ParentLogoImageTag: 'wrong-logo', ParentLogoItemId: 'season-1' };
        fixture.state.lifecycle?.refresh();
        expect(header().querySelector('.ptv-player-top-title')?.textContent).toBe('Series title');
        expect(fixture.loadImage.mock.calls.filter(([, , scope]) => scope === 'player-header-logo')).toHaveLength(0);
    });

    it('keeps Movie identity and does not borrow a collection parent logo', () => {
        fixture.state.item = {
            Id: 'movie-1', ServerId: 'local-server', Name: 'Movie title', Type: 'Movie', ImageTags: { Logo: 'movie-logo' },
            ParentLogoImageTag: 'collection-logo', ParentLogoItemId: 'collection-1'
        };
        fixture.state.lifecycle?.refresh();
        expect(header().querySelector('.ptv-player-top-title')?.textContent).toBe('Movie title');
        const headerLoads = fixture.loadImage.mock.calls.filter(([, , scope]) => scope === 'player-header-logo');
        expect(headerLoads.map(([url]) => url)).toEqual(['http://127.0.0.1:8097/Items/movie-1/Images/Logo?tag=movie-logo']);
    });

    it('removes the header and current Back binding on playback stop', () => {
        const detachedBack = header().querySelector('.ptv-player-top-back') as HTMLButtonElement;
        expect(header().isConnected).toBe(true);
        Events.trigger(fixture.manager, 'playbackstop', [{}]);
        expect(document.querySelector('.ptv-player-topbar')).toBeNull();
        detachedBack.click();
        expect(fixture.back).not.toHaveBeenCalled();
    });

    it('cancels the owned header logo handle before surface reconciliation removes it', () => {
        fixture.state.item = {
            ...episode(), ParentLogoImageTag: 'series-logo', ParentLogoItemId: 'series-1'
        };
        fixture.state.lifecycle?.refresh();
        const index = fixture.loadImage.mock.calls.findIndex(([, , scope]) => scope === 'player-header-logo');
        expect(index).toBeGreaterThanOrEqual(0);
        const load = fixture.loadImage.mock.results[index].value as { cancel: () => void };
        Events.trigger(fixture.manager, 'playbackstop', [{}]);
        expect(load.cancel).toHaveBeenCalledTimes(1);
    });

    it('retains existing history fallback when the router rejects Back', async () => {
        const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
        fixture.back.mockImplementation(() => Promise.reject(new Error('route unavailable')));
        (header().querySelector('.ptv-player-top-back') as HTMLButtonElement).click();
        await Promise.resolve();

        expect(fixture.back).toHaveBeenCalledTimes(1);
        expect(historyBack).toHaveBeenCalledTimes(1);
    });
});
