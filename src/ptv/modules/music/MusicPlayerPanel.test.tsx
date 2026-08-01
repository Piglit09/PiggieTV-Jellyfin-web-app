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

vi.mock('../icons', () => ({
    PtvIcon: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
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

    it('protects the current queue item while exposing reorder and remove actions for upcoming items', async () => {
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
        const remove = firstUpcomingRow.querySelector<HTMLButtonElement>(
            '[aria-label="Remove First Upcoming from queue"]'
        )!;

        expect(currentRow.querySelector('[aria-label^="Remove "]')).toBeNull();
        expect(currentRow.querySelector<HTMLButtonElement>('.ptv-music-queue-item-main')?.disabled).toBe(true);
        expect(moveEarlier.disabled).toBe(true);
        expect(moveLater.disabled).toBe(false);
        expect(remove).toBeTruthy();

        await act(async () => {
            moveLater.click();
            remove.click();
        });

        expect(queueMocks.move).toHaveBeenCalledWith('queue-first-upcoming', 2);
        expect(queueMocks.remove).toHaveBeenCalledWith('queue-first-upcoming');
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
        const lastPrimary = rows[49].querySelector<HTMLButtonElement>('.ptv-music-queue-item-main')!;
        const firstUpcomingPrimary = rows[1].querySelector<HTMLButtonElement>('.ptv-music-queue-item-main')!;

        expect(rows).toHaveLength(50);
        const homeEvent = await pressTabKey(lastPrimary, 'Home');

        expect(homeEvent.defaultPrevented).toBe(true);
        expect(queueMocks.move).toHaveBeenLastCalledWith('queue-track-49', 1);

        queueMocks.move.mockClear();
        const noOpHome = await pressTabKey(firstUpcomingPrimary, 'Home');

        expect(noOpHome.defaultPrevented).toBe(false);
        expect(queueMocks.move).not.toHaveBeenCalled();

        const deleteEvent = await pressTabKey(lastPrimary, 'Delete');

        expect(deleteEvent.defaultPrevented).toBe(true);
        expect(queueMocks.remove).toHaveBeenLastCalledWith('queue-track-49');
    });
});
