import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    PtvMusicItem,
    PtvMusicLyricsResponse,
    PtvMusicQueueItem,
    PtvMusicQueueSnapshot
} from './musicTypes';

const lyricsMocks = vi.hoisted(() => ({
    fetch: vi.fn()
}));

const identityMocks = vi.hoisted(() => ({
    serverId: 'panel-server',
    userId: 'panel-user'
}));

const profileMocks = vi.hoisted(() => ({
    isTv: false
}));

const playlistModalMocks = vi.hoisted(() => ({
    add: vi.fn()
}));

const iconMocks = vi.hoisted(() => ({
    render: vi.fn()
}));

const queueMocks = vi.hoisted(() => ({
    add: vi.fn(),
    clear: vi.fn(),
    move: vi.fn(),
    playItem: vi.fn(),
    playNext: vi.fn(),
    remove: vi.fn(),
    save: vi.fn()
}));

const continuityMocks = vi.hoisted(() => ({
    load: vi.fn(),
    saveTab: vi.fn()
}));

vi.mock('../../api', () => ({
    getPtvCurrentUserId: () => identityMocks.userId,
    getPtvServerId: () => identityMocks.serverId
}));

vi.mock('../../core/clientProfile', () => ({
    getPtvClientProfile: () => ({
        isTv: profileMocks.isTv
    })
}));

vi.mock('../icons', () => ({
    PtvIcon: ({ name }: Readonly<{ name: string }>) => {
        iconMocks.render(name);

        return <span data-icon={name} />;
    }
}));

vi.mock('./musicApi', () => ({
    fetchPtvMusicLyrics: lyricsMocks.fetch
}));

vi.mock('./musicContinuity', () => ({
    loadPtvMusicContinuity: continuityMocks.load,
    savePtvMusicContinuityPlayerTab: continuityMocks.saveTab
}));

vi.mock('./musicQueue', () => ({
    addPtvMusicToQueue: queueMocks.add,
    clearPtvMusicQueue: queueMocks.clear,
    movePtvMusicQueueItem: queueMocks.move,
    playPtvMusicNext: queueMocks.playNext,
    playPtvMusicQueueItem: queueMocks.playItem,
    removePtvMusicQueueItem: queueMocks.remove,
    savePtvMusicQueueAsPlaylist: queueMocks.save
}));

import MusicPlayerPanel from './MusicPlayerPanel';

type Deferred<T> = {
    promise: Promise<T>;
    reject: (reason?: unknown) => void;
    resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
    let reject!: Deferred<T>['reject'];
    let resolve!: Deferred<T>['resolve'];
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        reject = rejectPromise;
        resolve = resolvePromise;
    });

    return {
        promise,
        reject,
        resolve
    };
}

function setReactActEnvironment(value: boolean) {
    const environment = globalThis as typeof globalThis & Record<string, unknown>;

    environment['IS_REACT_ACT_ENVIRONMENT'] = value;
}

function createQueueItem(id: string, title: string, artist = 'Panel Artist'): PtvMusicQueueItem {
    return {
        Album: `${artist} Album`,
        AlbumArtist: artist,
        AlbumId: `${artist}-album`,
        HasLyrics: true,
        Id: id,
        Name: title,
        PlaylistItemId: `queue-${id}`,
        Type: 'Audio'
    };
}

function createQueueSnapshot(
    playlist: PtvMusicQueueItem[],
    currentIndex = 0
): PtvMusicQueueSnapshot {
    return {
        autoQueueSeedItem: null,
        autoQueueSeedRevision: 0,
        currentIndex,
        currentItem: currentIndex >= 0 ? playlist[currentIndex] || null : null,
        isAudio: true,
        isLoading: false,
        isMuted: false,
        isPlaying: true,
        isShuffled: false,
        playlist,
        positionTicks: 0,
        queueSourceLabel: 'Panel test queue',
        repeatMode: 'RepeatNone',
        runtimeTicks: 100,
        volumeLevel: 100
    };
}

describe('MusicPlayerPanel', () => {
    let container: HTMLDivElement;
    let root: Root;
    let scrollIntoViewMock: ReturnType<typeof vi.fn>;

    const getButton = (label: string) => {
        const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
            .find(candidate => candidate.textContent?.trim() === label);

        if (!button) throw new Error(`Button "${label}" was not rendered.`);

        return button;
    };

    const renderPanel = async (
        item: PtvMusicItem,
        snapshot: PtvMusicQueueSnapshot,
        relatedItems: PtvMusicItem[] = []
    ) => {
        await act(async () => {
            root.render(
                <MusicPlayerPanel
                    isRelatedLoading={false}
                    item={item}
                    onAddToPlaylist={playlistModalMocks.add}
                    relatedItems={relatedItems}
                    snapshot={snapshot}
                />
            );
        });
    };

    const clickButton = async (label: string) => {
        await act(async () => {
            getButton(label).click();
            await Promise.resolve();
        });
    };

    const pressTabKey = async (button: HTMLButtonElement, key: string) => {
        const event = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key
        });

        await act(async () => {
            button.dispatchEvent(event);
            await Promise.resolve();
        });

        return event;
    };

    beforeEach(() => {
        setReactActEnvironment(true);
        window.location.hash = '#/music/player';
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        identityMocks.serverId = 'panel-server';
        identityMocks.userId = 'panel-user';
        profileMocks.isTv = false;
        playlistModalMocks.add.mockReset();
        iconMocks.render.mockReset();
        scrollIntoViewMock = vi.fn();
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: scrollIntoViewMock,
            writable: true
        });

        Object.values(queueMocks).forEach(mock => {
            mock.mockReset();
            mock.mockResolvedValue(undefined);
        });
        lyricsMocks.fetch.mockReset();
        lyricsMocks.fetch.mockResolvedValue({
            Lyrics: []
        });
        continuityMocks.load.mockReset();
        continuityMocks.load.mockReturnValue(null);
        continuityMocks.saveTab.mockReset();
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        window.location.hash = '';
        delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        setReactActEnvironment(false);
    });

    it('exposes an accessible tab contract and loads Lyrics only after that tab opens', async () => {
        const current = createQueueItem('current', 'Current Track');

        await renderPanel(current, createQueueSnapshot([current]));

        const tabList = container.querySelector('[role="tablist"]');
        const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

        expect(tabList?.getAttribute('aria-label')).toBe('Now playing panels');
        expect(tabs.map(tab => tab.textContent)).toEqual(['Up Next', 'Lyrics', 'Related']);
        expect(tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
        expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1]);
        expect(lyricsMocks.fetch).not.toHaveBeenCalled();

        await clickButton('Lyrics');

        await vi.waitFor(() => {
            expect(lyricsMocks.fetch).toHaveBeenCalledTimes(1);
        });

        expect(tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
        expect(tabs.map(tab => tab.tabIndex)).toEqual([-1, 0, -1]);
        expect(container.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(tabs[1].id);
        expect(lyricsMocks.fetch).toHaveBeenCalledTimes(1);
        expect(lyricsMocks.fetch).toHaveBeenCalledWith(current, expect.any(AbortSignal));
    });

    it('moves and wraps tab focus with horizontal arrow keys', async () => {
        const current = createQueueItem('current', 'Current Track');

        await renderPanel(current, createQueueSnapshot([current]));

        const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

        tabs[0].focus();
        const rightEvent = await pressTabKey(tabs[0], 'ArrowRight');

        expect(rightEvent.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(tabs[1]);
        expect(tabs[1].getAttribute('aria-selected')).toBe('true');
        expect(continuityMocks.saveTab).toHaveBeenLastCalledWith({
            serverId: 'panel-server',
            userId: 'panel-user'
        }, 'Lyrics');

        await pressTabKey(tabs[1], 'ArrowLeft');
        expect(document.activeElement).toBe(tabs[0]);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');

        await pressTabKey(tabs[0], 'ArrowLeft');
        expect(document.activeElement).toBe(tabs[2]);
        expect(tabs[2].getAttribute('aria-selected')).toBe('true');
        expect(continuityMocks.saveTab).toHaveBeenLastCalledWith({
            serverId: 'panel-server',
            userId: 'panel-user'
        }, 'Related');

        await pressTabKey(tabs[2], 'ArrowRight');
        expect(document.activeElement).toBe(tabs[0]);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    });

    it('moves tab focus to the first and last tab with Home and End', async () => {
        const current = createQueueItem('current', 'Current Track');

        await renderPanel(current, createQueueSnapshot([current]));

        const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

        tabs[0].focus();
        const endEvent = await pressTabKey(tabs[0], 'End');

        expect(endEvent.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(tabs[2]);
        expect(tabs[2].getAttribute('aria-selected')).toBe('true');

        const homeEvent = await pressTabKey(tabs[2], 'Home');

        expect(homeEvent.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(tabs[0]);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        expect(continuityMocks.saveTab).toHaveBeenLastCalledWith({
            serverId: 'panel-server',
            userId: 'panel-user'
        }, 'Up Next');
    });

    it('aborts prior-track lyric work and rejects its stale completion', async () => {
        const priorTrack = createQueueItem('prior', 'Prior Track');
        const currentTrack = createQueueItem('current', 'Current Track');
        const priorLyrics = createDeferred<PtvMusicLyricsResponse>();
        const currentLyrics = createDeferred<PtvMusicLyricsResponse>();

        lyricsMocks.fetch
            .mockReturnValueOnce(priorLyrics.promise)
            .mockReturnValueOnce(currentLyrics.promise);

        await renderPanel(priorTrack, createQueueSnapshot([priorTrack]));
        await clickButton('Lyrics');

        await vi.waitFor(() => {
            expect(lyricsMocks.fetch).toHaveBeenCalledTimes(1);
        });

        const priorSignal = lyricsMocks.fetch.mock.calls[0]?.[1] as AbortSignal;

        await renderPanel(currentTrack, createQueueSnapshot([currentTrack]));

        expect(priorSignal.aborted).toBe(true);
        expect(lyricsMocks.fetch).toHaveBeenCalledTimes(2);

        await act(async () => {
            priorLyrics.resolve({
                Lyrics: [{
                    Start: 0,
                    Text: 'Retired lyric'
                }]
            });
            await priorLyrics.promise;
        });

        expect(container.textContent).not.toContain('Retired lyric');

        await act(async () => {
            currentLyrics.resolve({
                Lyrics: [{
                    Start: 0,
                    Text: 'Current lyric'
                }]
            });
            await currentLyrics.promise;
        });

        expect(container.textContent).toContain('Current lyric');
        expect(container.textContent).not.toContain('Retired lyric');
    });

    it('shows a Retry action after lyric failure and retries through the existing API owner', async () => {
        const current = createQueueItem('current', 'Current Track');

        lyricsMocks.fetch
            .mockRejectedValueOnce(new Error('Lyrics unavailable'))
            .mockResolvedValueOnce({
                Lyrics: [{
                    Start: 0,
                    Text: 'Recovered lyric'
                }]
            });

        await renderPanel(current, createQueueSnapshot([current]));
        await clickButton('Lyrics');

        await vi.waitFor(() => {
            expect(container.textContent).toContain('Lyrics could not be loaded.');
        });
        expect(getButton('Retry')).toBeTruthy();

        await clickButton('Retry');

        expect(lyricsMocks.fetch).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Recovered lyric');
    });

    it('renders plain-text lyrics as an unsynchronized screen-reader list', async () => {
        const current = createQueueItem('current', 'Current Track');

        lyricsMocks.fetch.mockResolvedValue({
            Lyrics: 'First line\r\nSecond line'
        });

        await renderPanel(current, createQueueSnapshot([current]));
        await clickButton('Lyrics');

        await vi.waitFor(() => {
            expect(container.textContent).toContain('Second line');
        });

        const lyrics = container.querySelector('[aria-label="Current Track lyrics"]');
        const lines = lyrics?.querySelectorAll('[role="listitem"]');

        expect(lyrics?.getAttribute('aria-busy')).toBe('false');
        expect(lines).toHaveLength(2);
        expect(Array.from(lines || []).every(line => !line.hasAttribute('aria-current'))).toBe(true);
    });

    it('retires the prior identity tab and pending lyrics before rendering the next user', async () => {
        const current = createQueueItem('current', 'Current Track');
        const priorLyrics = createDeferred<PtvMusicLyricsResponse>();

        continuityMocks.load.mockImplementation((scope: { userId?: string }) => (
            scope.userId === 'panel-user' ? { lastPlayerTab: 'Lyrics' } : null
        ));
        lyricsMocks.fetch.mockReturnValue(priorLyrics.promise);

        await renderPanel(current, createQueueSnapshot([current]));
        await vi.waitFor(() => {
            expect(lyricsMocks.fetch).toHaveBeenCalledTimes(1);
        });
        const priorSignal = lyricsMocks.fetch.mock.calls[0]?.[1] as AbortSignal;

        identityMocks.userId = 'next-panel-user';
        await renderPanel(current, createQueueSnapshot([current]));

        const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

        expect(tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
        expect(priorSignal.aborted).toBe(true);

        await act(async () => {
            priorLyrics.resolve({
                Lyrics: [{ Start: 0, Text: 'Prior user lyric' }]
            });
            await priorLyrics.promise;
        });

        expect(container.textContent).not.toContain('Prior user lyric');
    });

    it('protects the current queue item and exposes bounded actions through the canonical menu', async () => {
        const current = createQueueItem('current', 'Current Track');
        const firstUpcoming = createQueueItem('first-upcoming', 'First Upcoming');
        const secondUpcoming = createQueueItem('second-upcoming', 'Second Upcoming');

        await renderPanel(
            current,
            createQueueSnapshot([
                current,
                firstUpcoming,
                secondUpcoming
            ])
        );

        const currentRow = container.querySelector('.ptv-music-queue-item-current')!;
        const firstUpcomingRow = Array.from(container.querySelectorAll('.ptv-music-queue-item'))
            .find(row => row.textContent?.includes('First Upcoming'))!;
        const moveEarlier = firstUpcomingRow.querySelector<HTMLButtonElement>(
            '[aria-label="Move First Upcoming earlier"]'
        )!;
        const moveLater = firstUpcomingRow.querySelector<HTMLButtonElement>(
            '[aria-label="Move First Upcoming later"]'
        )!;
        const currentPrimary = currentRow.querySelector<HTMLButtonElement>('.ptv-music-queue-item-main')!;
        const currentActions = currentRow.querySelector<HTMLButtonElement>('[aria-label="Open actions for Current Track"]')!;
        const firstUpcomingActions = firstUpcomingRow.querySelector<HTMLButtonElement>(
            '[aria-label="Open actions for First Upcoming"]'
        )!;

        expect(currentPrimary.disabled).toBe(false);
        expect(currentPrimary.getAttribute('aria-disabled')).toBe('true');
        expect(moveEarlier.disabled).toBe(true);
        expect(moveLater.disabled).toBe(false);
        expect(firstUpcomingRow.querySelectorAll('.ptv-music-queue-item-actions > button')).toHaveLength(3);

        await act(async () => {
            moveLater.click();
            firstUpcomingActions.click();
            await Promise.resolve();
        });

        expect(queueMocks.move).toHaveBeenCalledWith('queue-first-upcoming', 2);

        const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
        const menuLabels = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
            .map(button => button.textContent?.trim());
        const remove = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
            .find(button => button.textContent?.trim() === 'Remove from queue')!;

        expect(menuLabels).toEqual([
            'Move earlier',
            'Move later',
            'Move to top',
            'Move to bottom',
            'Play next',
            'Add to playlist',
            'Remove from queue'
        ]);

        await act(async () => {
            remove.click();
            await Promise.resolve();
        });

        expect(queueMocks.remove).toHaveBeenCalledWith('queue-first-upcoming');

        await act(async () => {
            currentActions.click();
            await Promise.resolve();
        });

        const currentMenuItems = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        const currentRemove = currentMenuItems.find(button => button.textContent?.trim() === 'Remove from queue')!;
        const addToPlaylist = currentMenuItems.find(button => button.textContent?.trim() === 'Add to playlist')!;

        expect(currentRemove.disabled).toBe(true);
        expect(addToPlaylist.disabled).toBe(false);

        await act(async () => {
            addToPlaylist.click();
        });

        expect(playlistModalMocks.add).toHaveBeenCalledWith(current);
    });

    it('transfers menu focus and restoration ownership when another row opens it', async () => {
        const current = createQueueItem('current', 'Current Track');
        const firstUpcoming = createQueueItem('first-upcoming', 'First Upcoming');
        const secondUpcoming = createQueueItem('second-upcoming', 'Second Upcoming');

        await renderPanel(current, createQueueSnapshot([current, firstUpcoming, secondUpcoming]));

        const currentActions = container.querySelector<HTMLButtonElement>(
            '[aria-label="Open actions for Current Track"]'
        )!;
        const upcomingActions = container.querySelector<HTMLButtonElement>(
            '[aria-label="Open actions for First Upcoming"]'
        )!;

        upcomingActions.focus();
        await act(async () => {
            upcomingActions.click();
        });

        expect(document.activeElement?.textContent?.trim()).toBe('Move later');

        currentActions.focus();
        await act(async () => {
            currentActions.click();
        });

        const currentMenu = document.querySelector<HTMLElement>('[role="menu"]')!;

        expect(currentMenu.getAttribute('aria-labelledby')).toBe(currentActions.id);
        expect(document.activeElement?.textContent?.trim()).toBe('Add to playlist');

        const escapeEvent = await pressTabKey(document.activeElement as HTMLButtonElement, 'Escape');

        expect(escapeEvent.defaultPrevented).toBe(true);
        expect(document.querySelector('[role="menu"]')).toBeNull();
        expect(document.activeElement).toBe(currentActions);
    });

    it('renders exactly one truthful current-item state without changing the queue row', async () => {
        const current = createQueueItem('current', 'Current Track');
        const snapshot = createQueueSnapshot([current]);

        await renderPanel(current, {
            ...snapshot,
            isLoading: true
        });

        const currentRow = container.querySelector<HTMLElement>('.ptv-music-queue-item-current')!;
        const state = currentRow.querySelector('.ptv-music-queue-playing-state');

        expect(state?.textContent).toBe('Loading');
        expect(currentRow.querySelectorAll('.ptv-music-queue-playing-state')).toHaveLength(1);
        expect(currentRow.querySelector('[data-icon="speaker"]')).toBeNull();

        await renderPanel(current, {
            ...snapshot,
            isLoading: false,
            isPlaying: false,
            positionTicks: 10
        });

        expect(container.querySelector('.ptv-music-queue-item-current')).toBe(currentRow);
        expect(currentRow.querySelector('.ptv-music-queue-playing-state')?.textContent).toBe('Paused');
        expect(currentRow.querySelector<HTMLButtonElement>('.ptv-music-queue-item-main')?.ariaLabel)
            .toBe('Paused Current Track');
        expect(currentRow.getAttribute('aria-busy')).toBeNull();
        expect(currentRow.querySelectorAll('.ptv-music-queue-playing-state')).toHaveLength(1);

        await renderPanel(current, {
            ...snapshot,
            isLoading: false,
            isPlaying: true,
            positionTicks: 20
        });

        expect(container.querySelector('.ptv-music-queue-item-current')).toBe(currentRow);
        expect(currentRow.querySelector('.ptv-music-queue-playing-state')?.textContent).toBe('Playing');
        expect(currentRow.querySelectorAll('.ptv-music-queue-playing-state')).toHaveLength(1);
    });

    it('keeps focus keys unique when queue items lack playlist identifiers', async () => {
        const first = {
            ...createQueueItem('duplicate', 'Repeated Track'),
            PlaylistItemId: ''
        };
        const second = {
            ...createQueueItem('duplicate', 'Repeated Track'),
            PlaylistItemId: ''
        };

        await renderPanel(first, createQueueSnapshot([first, second]));

        const focusKeys = Array.from(container.querySelectorAll<HTMLElement>('[data-ptv-focus-key]'))
            .map(element => element.dataset.ptvFocusKey);
        const focusTokens = Array.from(container.querySelectorAll<HTMLElement>('[data-ptv-focus-token]'))
            .map(element => element.dataset.ptvFocusToken);

        expect(focusKeys).toHaveLength(8);
        expect(new Set(focusKeys).size).toBe(focusKeys.length);
        expect(new Set(focusTokens).size).toBe(focusTokens.length);
    });

    it('never delegates current-row alignment to ancestor-scrolling APIs', async () => {
        const playlist = Array.from({ length: 10 }, (_, index) => (
            createQueueItem(`track-${index}`, `Track ${index}`)
        ));
        const snapshot = createQueueSnapshot(playlist, 5);

        await renderPanel(playlist[5], snapshot);

        expect(scrollIntoViewMock).not.toHaveBeenCalled();

        await renderPanel(playlist[5], {
            ...snapshot,
            playlist: playlist.map(queueItem => ({ ...queueItem })),
            positionTicks: 25
        });

        expect(scrollIntoViewMock).not.toHaveBeenCalled();

        await renderPanel(playlist[6], createQueueSnapshot(playlist, 6));

        expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });

    it('coalesces queue-local alignment and preserves a focused non-current row', async () => {
        const playlist = Array.from({ length: 10 }, (_, index) => (
            createQueueItem(`track-${index}`, `Track ${index}`)
        ));
        const animationFrames = new Map<number, FrameRequestCallback>();
        const scrollWrites: number[] = [];
        const resizeObserve = vi.fn();
        const resizeDisconnect = vi.fn();
        let nextFrame = 1;
        const resizeCallbacks: ResizeObserverCallback[] = [];

        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            const frame = nextFrame++;

            animationFrames.set(frame, callback);
            return frame;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(frame => {
            animationFrames.delete(frame);
        });
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: ResizeObserverCallback) {
                resizeCallbacks.push(callback);
            }

            observe = resizeObserve;
            disconnect = resizeDisconnect;
        });

        await renderPanel(playlist[5], createQueueSnapshot(playlist, 5));

        const list = container.querySelector<HTMLOListElement>('.ptv-music-queue-list')!;
        const currentRow = container.querySelector<HTMLElement>('.ptv-music-queue-item-current')!;
        const upcomingRow = Array.from(container.querySelectorAll<HTMLElement>('.ptv-music-queue-item'))[6];
        const upcomingPrimary = upcomingRow.querySelector<HTMLButtonElement>('.ptv-music-queue-item-main')!;
        const listRect = {
            bottom: 200,
            height: 100,
            left: 0,
            right: 300,
            top: 100,
            width: 300
        } as DOMRect;
        const clippedRowRect = {
            bottom: 224,
            height: 64,
            left: 0,
            right: 300,
            top: 160,
            width: 300
        } as DOMRect;
        const visibleRowRect = {
            ...clippedRowRect,
            bottom: 184,
            top: 120
        } as DOMRect;
        const rowRectSpy = vi.spyOn(currentRow, 'getBoundingClientRect').mockReturnValue(clippedRowRect);
        let queueScrollTop = 0;

        vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(listRect);
        Object.defineProperty(list, 'clientHeight', { configurable: true, value: 100 });
        Object.defineProperty(list, 'clientTop', { configurable: true, value: 0 });
        Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 640 });
        Object.defineProperty(list, 'scrollTop', {
            configurable: true,
            get: () => queueScrollTop,
            set: value => {
                queueScrollTop = value;
                scrollWrites.push(value);
            }
        });
        scrollIntoViewMock.mockClear();
        const outerScrollBefore = [
            document.documentElement.scrollTop,
            document.body.scrollTop,
            container.querySelector<HTMLElement>('.ptv-music-player-panel')?.scrollTop || 0
        ];
        const flushAnimationFrames = () => {
            const callbacks = Array.from(animationFrames.values());

            animationFrames.clear();
            for (const callback of callbacks) callback(performance.now());
        };

        flushAnimationFrames();

        expect(scrollWrites).toEqual([24]);
        expect(scrollIntoViewMock).not.toHaveBeenCalled();

        rowRectSpy.mockReturnValue(visibleRowRect);
        resizeCallbacks[0]?.([], {} as ResizeObserver);
        resizeCallbacks[0]?.([], {} as ResizeObserver);
        resizeCallbacks[0]?.([], {} as ResizeObserver);

        expect(animationFrames.size).toBe(1);
        flushAnimationFrames();
        expect(scrollWrites).toEqual([24]);

        rowRectSpy.mockReturnValue(clippedRowRect);
        upcomingPrimary.focus();
        resizeCallbacks[0]?.([], {} as ResizeObserver);
        flushAnimationFrames();

        expect(scrollWrites).toEqual([24]);
        expect(document.activeElement).toBe(upcomingPrimary);

        await renderPanel(playlist[5], {
            ...createQueueSnapshot(playlist, 5),
            positionTicks: 25
        });

        expect(animationFrames.size).toBe(0);
        expect([
            document.documentElement.scrollTop,
            document.body.scrollTop,
            container.querySelector<HTMLElement>('.ptv-music-player-panel')?.scrollTop || 0
        ]).toEqual(outerScrollBefore);
        expect(resizeObserve).toHaveBeenCalledTimes(2);
        expect(resizeDisconnect).not.toHaveBeenCalled();
    });

    it('bounds 100-row mutation work and skips position-only progress reconciliation', async () => {
        const playlist = Array.from({ length: 100 }, (_, index) => (
            createQueueItem(`track-${index}`, `Track ${index}`)
        ));
        const snapshot = createQueueSnapshot(playlist, 50);

        await renderPanel(playlist[50], snapshot);

        const rows = Array.from(container.querySelectorAll<HTMLElement>('.ptv-music-queue-item'));
        const iconRenderCount = iconMocks.render.mock.calls.length;

        expect(rows).toHaveLength(40);
        expect(container.querySelector('.ptv-music-queue-list')?.getAttribute('data-ptv-rendered-count'))
            .toBe('40');
        expect(rows.every(row => row.getAttribute('aria-setsize') === '100')).toBe(true);

        await renderPanel(playlist[50], {
            ...snapshot,
            playlist: playlist.map(queueItem => ({ ...queueItem })),
            positionTicks: 50
        });

        const nextRows = Array.from(container.querySelectorAll<HTMLElement>('.ptv-music-queue-item'));

        expect(nextRows.every((row, index) => row === rows[index])).toBe(true);
        expect(iconMocks.render).toHaveBeenCalledTimes(iconRenderCount);
        expect(scrollIntoViewMock).not.toHaveBeenCalled();

        const mutationIconStart = iconMocks.render.mock.calls.length;
        const reordered = playlist.map(queueItem => ({ ...queueItem }));
        const lastItem = reordered[61];

        reordered[61] = reordered[60];
        reordered[60] = lastItem;
        await renderPanel(playlist[50], {
            ...snapshot,
            playlist: reordered
        });

        expect(iconMocks.render.mock.calls.length - mutationIconStart).toBe(8);
        expect(scrollIntoViewMock).not.toHaveBeenCalled();
    });

    it('uses one stable TV row target and restores it after the menu closes', async () => {
        const current = createQueueItem('current', 'Current Track');
        const upcoming = createQueueItem('upcoming', 'Upcoming Track');

        profileMocks.isTv = true;
        await renderPanel(current, createQueueSnapshot([current, upcoming]));

        const upcomingRow = Array.from(container.querySelectorAll<HTMLElement>('.ptv-music-queue-item'))
            .find(row => row.textContent?.includes('Upcoming Track'))!;
        const primary = upcomingRow.querySelector<HTMLButtonElement>('.ptv-music-queue-item-main')!;

        expect(upcomingRow.querySelectorAll('button')).toHaveLength(1);
        expect(upcomingRow.querySelector('.ptv-music-queue-item-actions')).toBeNull();

        primary.focus();
        await act(async () => {
            primary.click();
            await Promise.resolve();
        });

        expect(document.querySelector('[role="menu"]')).not.toBeNull();
        expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(8);
        expect(document.activeElement?.textContent?.trim()).toBe('Play this item');

        const focusedMenuItem = document.activeElement as HTMLButtonElement;
        const escapeEvent = await pressTabKey(focusedMenuItem, 'Escape');

        expect(escapeEvent.defaultPrevented).toBe(true);
        expect(document.querySelector('[role="menu"]')).toBeNull();
        expect(document.activeElement).toBe(primary);
    });

    it('closes the row menu before Escape changes the player route', async () => {
        const current = createQueueItem('current', 'Current Track');
        const upcoming = createQueueItem('upcoming', 'Upcoming Track');

        window.location.hash = '#/music/player?panel=queue';
        await renderPanel(current, createQueueSnapshot([current, upcoming]));

        const overflow = container.querySelector<HTMLButtonElement>('[aria-label="Open actions for Upcoming Track"]')!;

        await act(async () => {
            overflow.click();
            await Promise.resolve();
        });

        const focusedMenuItem = document.activeElement as HTMLButtonElement;

        await pressTabKey(focusedMenuItem, 'Escape');

        expect(document.querySelector('[role="menu"]')).toBeNull();
        expect(window.location.hash).toBe('#/music/player?panel=queue');

        const routeEscape = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Escape'
        });

        await act(async () => {
            window.dispatchEvent(routeEscape);
        });

        expect(routeEscape.defaultPrevented).toBe(true);
        expect(window.location.hash).toBe('#/music/player');
    });

    it('delegates clear and save actions to the existing queue owner', async () => {
        const current = createQueueItem('current', 'Current Track');
        const upcoming = createQueueItem('upcoming', 'Upcoming Track');

        await renderPanel(current, createQueueSnapshot([
            current,
            upcoming
        ]));

        await clickButton('Clear upcoming');
        await clickButton('Save queue');

        expect(queueMocks.clear).toHaveBeenCalledTimes(1);
        expect(queueMocks.save).toHaveBeenCalledTimes(1);
        expect(queueMocks.save).toHaveBeenCalledWith('PiggieTV Now Playing Queue');
        expect(container.textContent).toContain('Saved');
    });

    it('restores the player route when Escape closes the queue panel', async () => {
        const current = createQueueItem('current', 'Current Track');

        window.location.hash = '#/music/player?panel=queue';
        await renderPanel(current, createQueueSnapshot([current]));

        const escapeEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Escape'
        });

        await act(async () => {
            window.dispatchEvent(escapeEvent);
        });

        expect(escapeEvent.defaultPrevented).toBe(true);
        expect(window.location.hash).toBe('#/music/player');
    });

    it('supports bounded keyboard mutation across a 50-item queue', async () => {
        const playlist = Array.from({ length: 50 }, (_, index) => (
            createQueueItem(`track-${index}`, `Track ${index}`)
        ));

        await renderPanel(playlist[0], createQueueSnapshot(playlist));

        const rows = Array.from(container.querySelectorAll<HTMLElement>('.ptv-music-queue-item'));
        const lastPrimary = rows[39].querySelector<HTMLButtonElement>('.ptv-music-queue-item-main')!;
        const firstUpcomingPrimary = rows[1].querySelector<HTMLButtonElement>('.ptv-music-queue-item-main')!;

        expect(rows).toHaveLength(40);
        const homeEvent = await pressTabKey(lastPrimary, 'Home');

        expect(homeEvent.defaultPrevented).toBe(true);
        expect(queueMocks.move).toHaveBeenLastCalledWith('queue-track-39', 1);

        queueMocks.move.mockClear();
        const noOpHome = await pressTabKey(firstUpcomingPrimary, 'Home');

        expect(noOpHome.defaultPrevented).toBe(false);
        expect(queueMocks.move).not.toHaveBeenCalled();

        const deleteEvent = await pressTabKey(lastPrimary, 'Delete');

        expect(deleteEvent.defaultPrevented).toBe(true);
        expect(queueMocks.remove).toHaveBeenLastCalledWith('queue-track-39');
    });
});
