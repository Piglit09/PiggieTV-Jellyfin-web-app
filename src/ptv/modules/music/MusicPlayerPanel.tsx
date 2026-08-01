/* eslint-disable react/jsx-no-bind, no-void */
import React, {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState
} from 'react';

import { getPtvCurrentUserId, getPtvServerId } from '../../api';
import { PtvIcon } from '../icons';
import {
    addPtvMusicToQueue,
    clearPtvMusicQueue,
    movePtvMusicQueueItem,
    playPtvMusicNext,
    playPtvMusicQueueItem,
    removePtvMusicQueueItem,
    savePtvMusicQueueAsPlaylist
} from './musicQueue';
import { loadPtvMusicContinuity, savePtvMusicContinuityPlayerTab, type PtvMusicContinuityPlayerTab } from './musicContinuity';
import {
    type PtvMusicQueueItem,
    type PtvMusicQueueSnapshot,
    type PtvMusicItem
} from './musicTypes';

type MusicPlayerPanelProps = Readonly<{
    isRelatedLoading: boolean;
    item: PtvMusicItem;
    relatedItems: PtvMusicItem[];
    snapshot: PtvMusicQueueSnapshot;
}>;

type QueueAnnouncement = {
    action: string;
    description?: string;
};

const PTV_MUSIC_PLAYER_TABS: ReadonlyArray<PtvMusicContinuityPlayerTab> = ['Up Next', 'Lyrics', 'Related'];
const PTV_PANEL_STATUS_TIMEOUT_MS = 1600;
const LazyMusicLyricsPanel = React.lazy(() => import('./MusicLyricsPanel'));

const QueueRenderBoundary = React.memo(function QueueRenderBoundary({
    children
}: Readonly<{
    children: React.ReactNode;
    renderKey: string;
}>) {
    // eslint-disable-next-line react/jsx-no-useless-fragment -- The fragment is the memoized queue reconciliation boundary.
    return <>{children}</>;
}, (previous, next) => previous.renderKey === next.renderKey);

function getPtvMusicItemName(item: PtvMusicItem) {
    return String(item.Name || item.SortName || item.Id || '').trim() || 'Unknown track';
}

function getPtvMusicItemArtist(item: PtvMusicItem) {
    return String(item.AlbumArtist || item.Artist || item.Artists?.[0] || item.ArtistItems?.[0]?.Name || 'Unknown artist');
}

function formatPanelRoute(panel?: string | null) {
    const parts = window.location.hash.split('?');
    const base = parts[0] || '#/music/player';
    const params = (parts[1] || '')
        .split('&')
        .filter(Boolean)
        .filter(value => value.split('=')[0] !== 'panel');

    if (panel) {
        params.push(`panel=${encodeURIComponent(panel)}`);
    }

    const query = params.join('&');

    return query ? `${base}?${query}` : base;
}

function hasPanelRoute(hash: string) {
    return (hash.split('?')[1] || '')
        .split('&')
        .some(value => value.split('=')[0] === 'panel');
}

function useFocusRestorer() {
    const restoreRequestRef = useRef<{
        fallbackToken?: string;
        token: string;
    } | null>(null);
    const hostRef = useRef<HTMLElement | null>(null);
    const animationFrameRef = useRef(0);

    const setHost = useCallback((host: HTMLElement | null) => {
        hostRef.current = host;
    }, []);

    const remember = useCallback((token: string, fallbackToken?: string) => {
        restoreRequestRef.current = {
            fallbackToken,
            token
        };
    }, []);

    const restore = useCallback(() => {
        const restoreFocus = () => {
            animationFrameRef.current = 0;
            const host = hostRef.current;
            const request = restoreRequestRef.current;

            restoreRequestRef.current = null;
            if (!host || !request) return;

            const findToken = (token?: string) => {
                if (!token) return null;

                const candidates = host.querySelectorAll<HTMLElement>('[data-ptv-focus-token]');

                for (const candidate of candidates) {
                    if (candidate.getAttribute('data-ptv-focus-token') === token) {
                        return candidate;
                    }
                }

                return null;
            };
            const target = findToken(request.token)
                || findToken(request.fallbackToken)
                || host.querySelector<HTMLElement>('button:not([disabled])');

            target?.focus({ preventScroll: true });
        };

        if (animationFrameRef.current && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(animationFrameRef.current);
        }

        if (typeof window.requestAnimationFrame === 'function') {
            animationFrameRef.current = window.requestAnimationFrame(restoreFocus);
        } else {
            void Promise.resolve().then(restoreFocus);
        }
    }, []);

    useEffect(() => () => {
        if (animationFrameRef.current && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(animationFrameRef.current);
        }
    }, []);

    return useMemo(() => ({
        remember,
        restore,
        setHost
    }), [remember, restore, setHost]);
}

function MusicPlayerPanel({ isRelatedLoading, item, relatedItems, snapshot }: MusicPlayerPanelProps) {
    const continuityServerId = getPtvServerId();
    const continuityUserId = getPtvCurrentUserId(continuityServerId);
    const continuationScope = useMemo(() => ({
        serverId: continuityServerId,
        userId: continuityUserId
    }), [continuityServerId, continuityUserId]);
    const continuityScopeKey = JSON.stringify([continuityServerId || '', continuityUserId || '']);
    const [tabState, setTabState] = useState<{
        activeTab: PtvMusicContinuityPlayerTab;
        scopeKey: string;
    }>({
        activeTab: 'Up Next',
        scopeKey: continuityScopeKey
    });
    const activeTab = tabState.scopeKey === continuityScopeKey ? tabState.activeTab : 'Up Next';
    const [announcement, setAnnouncement] = useState<QueueAnnouncement | null>(null);
    const announcementTimerRef = useRef(0);
    const panelRef = useRef<HTMLElement>(null);
    const panelInstanceId = useId();
    const focus = useFocusRestorer();

    useEffect(() => {
        const continuity = loadPtvMusicContinuity(continuationScope);
        const restoredTab: PtvMusicContinuityPlayerTab = (
            continuity?.lastPlayerTab === 'Lyrics'
            || continuity?.lastPlayerTab === 'Up Next'
            || continuity?.lastPlayerTab === 'Related'
        ) ? continuity.lastPlayerTab : 'Up Next';

        setTabState({
            activeTab: restoredTab,
            scopeKey: continuityScopeKey
        });
    }, [continuationScope, continuityScopeKey]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;

            const hash = window.location.hash;
            if (!hash.startsWith('#/music/player')) return;

            if (!hasPanelRoute(hash)) return;

            event.preventDefault();
            window.location.hash = formatPanelRoute();
        };

        window.addEventListener('keydown', onKeyDown);

        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, []);

    useEffect(() => () => {
        if (announcementTimerRef.current) {
            window.clearTimeout(announcementTimerRef.current);
        }
    }, []);

    useEffect(() => {
        focus.setHost(panelRef.current);
    }, [focus]);

    const queueItems = useMemo(() => (
        snapshot.playlist.map((playlistItem, index) => ({
            playlistItem,
            index
        }))
    ), [snapshot.playlist]);
    const currentItemName = getPtvMusicItemName(snapshot.currentItem || item);
    const playerTabId = `${panelInstanceId}-tab`;
    const queueKeyboardInstructionsId = `${panelInstanceId}-queue-keyboard-instructions`;
    const announcementDescription = announcement?.description ? ` ${announcement.description}` : '';
    const queueMessage = announcement ? `${announcement.action}${announcementDescription}` : '';
    const queueRenderKey = JSON.stringify([
        currentItemName,
        queueMessage,
        snapshot.currentIndex,
        snapshot.queueSourceLabel,
        snapshot.playlist.map(playlistItem => [
            playlistItem.PlaylistItemId || '',
            playlistItem.Id || '',
            playlistItem.Name || '',
            playlistItem.AlbumArtist || playlistItem.Artist || '',
            playlistItem.Artists?.[0] || '',
            playlistItem.ArtistItems?.[0]?.Name || ''
        ])
    ]);

    const announceQueueAction = (action: string, description?: string) => {
        if (announcementTimerRef.current) {
            window.clearTimeout(announcementTimerRef.current);
        }

        setAnnouncement({ action, description });
        announcementTimerRef.current = window.setTimeout(() => {
            announcementTimerRef.current = 0;
            setAnnouncement(null);
        }, PTV_PANEL_STATUS_TIMEOUT_MS);
    };

    const selectTab = (tab: PtvMusicContinuityPlayerTab) => {
        setTabState({
            activeTab: tab,
            scopeKey: continuityScopeKey
        });
        savePtvMusicContinuityPlayerTab(continuationScope, tab);
    };

    const rememberAndRun = async (
        event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
        playlistItemId: string,
        action: () => Promise<unknown> | unknown,
        announcementLabel: string
    ) => {
        let focused: HTMLElement | null = null;

        if (event.currentTarget instanceof HTMLElement) {
            focused = event.currentTarget;
        } else if (event.target instanceof HTMLElement) {
            focused = event.target;
        }
        if (!focused) return;
        const focusToken = focused.getAttribute('data-ptv-focus-token');
        const row = focused.closest<HTMLElement>('[data-playlist-item]');
        const fallbackRow = row?.nextElementSibling || row?.previousElementSibling;
        const fallbackPlaylistItemId = fallbackRow?.getAttribute('data-playlist-item') || '';

        if (focusToken) {
            focus.remember(
                focusToken,
                fallbackPlaylistItemId ? `track:${fallbackPlaylistItemId}:primary` : undefined
            );
        }

        try {
            await Promise.resolve(action());
            announceQueueAction(announcementLabel);
        } catch {
            announceQueueAction(`Could not update ${playlistItemId ? 'that queue item' : 'the queue'}`);
        } finally {
            focus.restore();
        }
    };

    const moveQueuedItem = async (
        event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
        playlistItemId: string,
        targetIndex: number,
        playlistName: string
    ) => {
        await rememberAndRun(event, playlistItemId, () => movePtvMusicQueueItem(playlistItemId, targetIndex), playlistName);
    };

    const onQueueItemKeyDown = (
        event: React.KeyboardEvent<HTMLElement>,
        queueItem: PtvMusicQueueItem,
        index: number
    ) => {
        const key = event.key;
        const targetLimit = snapshot.playlist.length;
        const canMoveToTop = index > snapshot.currentIndex + 1;
        const canMoveEarlier = index > snapshot.currentIndex + 1;
        const canMoveLater = index < targetLimit - 1;
        const canMoveToBottom = index < targetLimit - 1;

        if (index <= snapshot.currentIndex) {
            return;
        }

        if (key === 'Home') {
            if (!canMoveToTop) return;

            event.preventDefault();
            void moveQueuedItem(event, queueItem.PlaylistItemId || `index-${index}`, snapshot.currentIndex + 1, `${queueItem.Name} to top`);
            return;
        }

        if (key === 'End') {
            if (!canMoveToBottom) return;

            event.preventDefault();
            void moveQueuedItem(event, queueItem.PlaylistItemId || `index-${index}`, targetLimit, `${queueItem.Name} to bottom`);
            return;
        }

        if (key === 'ArrowUp' && index > 0) {
            if (!canMoveEarlier) return;

            event.preventDefault();
            void moveQueuedItem(event, queueItem.PlaylistItemId || `index-${index}`, index - 1, `${queueItem.Name} earlier`);
            return;
        }

        if (key === 'ArrowDown' && canMoveLater) {
            event.preventDefault();
            void moveQueuedItem(event, queueItem.PlaylistItemId || `index-${index}`, index + 1, `${queueItem.Name} later`);
            return;
        }

        if (key === 'Delete' || key === 'Backspace') {
            event.preventDefault();
            void rememberAndRun(
                event,
                queueItem.PlaylistItemId || `index-${index}`,
                () => removePtvMusicQueueItem(queueItem.PlaylistItemId || `index-${index}`),
                `Removed ${queueItem.Name}`
            );
        }
    };

    const onLyricsTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const currentIndex = PTV_MUSIC_PLAYER_TABS.indexOf(activeTab);
        if (currentIndex === -1) return;
        let nextIndex = currentIndex;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            nextIndex = (currentIndex + PTV_MUSIC_PLAYER_TABS.length - 1) % PTV_MUSIC_PLAYER_TABS.length;
        }
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            nextIndex = (currentIndex + 1) % PTV_MUSIC_PLAYER_TABS.length;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            nextIndex = 0;
        }
        if (event.key === 'End') {
            event.preventDefault();
            nextIndex = PTV_MUSIC_PLAYER_TABS.length - 1;
        }

        if (nextIndex === currentIndex) return;

        const nextTab = PTV_MUSIC_PLAYER_TABS[nextIndex];
        const nextButton = document.getElementById(`${playerTabId}-${nextIndex}`);

        selectTab(nextTab);
        if (nextButton) {
            nextButton.focus();
        }
    };

    const onSaveQueue = async () => {
        await savePtvMusicQueueAsPlaylist('PiggieTV Now Playing Queue');
        announceQueueAction('Saved');
    };

    return (
        <aside className='ptv-music-player-panel' ref={panelRef}>
            <div className='ptv-music-player-tabs' aria-label='Now playing panels' role='tablist'>
                {PTV_MUSIC_PLAYER_TABS.map((tab, index) => (
                    <button
                        key={tab}
                        id={`${playerTabId}-${index}`}
                        onClick={() => selectTab(tab)}
                        onKeyDown={onLyricsTabKeyDown}
                        aria-controls={`${playerTabId}-${tab.toLowerCase().replace(/\s+/g, '-')}`}
                        aria-selected={activeTab === tab}
                        className={activeTab === tab ? 'ptv-music-player-tab-active' : ''}
                        role='tab'
                        tabIndex={activeTab === tab ? 0 : -1}
                        type='button'
                    >
                        {tab}
                    </button>
                ))}
            </div>
            <div
                aria-live='polite'
                role='status'
                className='ptv-music-player-status'
            >
                {queueMessage || ' '}
            </div>
            {snapshot.playbackError ? (
                <p className='ptv-music-player-error' role='alert'>
                    {snapshot.playbackError}
                </p>
            ) : null}
            <section
                aria-labelledby={`${playerTabId}-${PTV_MUSIC_PLAYER_TABS.indexOf(activeTab)}`}
                role='tabpanel'
                id={`${playerTabId}-${activeTab.toLowerCase().replace(/\s+/g, '-')}`}
                className='ptv-music-list'
            >
                {activeTab === 'Up Next' ? (
                    <QueueRenderBoundary renderKey={queueRenderKey}>
                        <>
                            <p id={queueKeyboardInstructionsId} className='ptv-music-sr-only'>
                                Use Up and Down Arrow to reorder, Home and End to move to the queue edges,
                                and Delete or Backspace to remove an upcoming track.
                            </p>
                            <div className='ptv-music-player-panel-actions'>
                                <div>
                                    <strong>Playing from</strong>
                                    <span>{currentItemName}</span>
                                </div>
                                <span>
                                    <button type='button' onClick={() => { void clearPtvMusicQueue(); }}>
                                        Clear upcoming
                                    </button>
                                    <button type='button' onClick={onSaveQueue}>
                                        Save queue
                                    </button>
                                </span>
                            </div>
                            <div className='ptv-music-related-queue-note'>
                                <strong>{snapshot.queueSourceLabel || 'Queue'}</strong>
                                <span>{snapshot.playlist.length} items</span>
                            </div>
                            <ol className='ptv-music-queue-list' aria-label='Playback queue'>
                                {queueItems.map(({ index, playlistItem }) => {
                                    const playlistItemId = playlistItem.PlaylistItemId || '';
                                    const trackName = getPtvMusicItemName(playlistItem);
                                    const artistName = getPtvMusicItemArtist(playlistItem);
                                    const isCurrent = snapshot.currentIndex === index;
                                    const canMoveEarlier = index > snapshot.currentIndex + 1;
                                    const canMoveLater = index < snapshot.playlist.length - 1;
                                    const canMoveToTop = index > snapshot.currentIndex + 1;
                                    const canMoveToBottom = index < snapshot.playlist.length - 1;
                                    const canMoveToPlayNext = index > snapshot.currentIndex + 1;
                                    const canAddToEnd = index < snapshot.playlist.length - 1;
                                    const actionsDisabled = isCurrent || !playlistItemId;

                                    return (
                                        <li
                                            key={playlistItemId || `index-${index}`}
                                            data-playlist-item={playlistItemId}
                                            className={`ptv-music-queue-item${isCurrent ? ' ptv-music-queue-item-current' : ''}`}
                                        >
                                            <button
                                                className='ptv-music-queue-item-main'
                                                type='button'
                                                disabled={isCurrent}
                                                onClick={() => void playPtvMusicQueueItem(playlistItemId)}
                                                onKeyDown={event => {
                                                    if (!actionsDisabled) {
                                                        onQueueItemKeyDown(event, playlistItem, index);
                                                    }
                                                }}
                                                aria-label={
                                                    isCurrent ?
                                                        `Playing ${trackName}` :
                                                        `Play ${trackName}`
                                                }
                                                aria-describedby={isCurrent ? undefined : queueKeyboardInstructionsId}
                                                aria-keyshortcuts={isCurrent ? undefined : 'ArrowUp ArrowDown Home End Delete Backspace'}
                                                data-ptv-focus-token={`track:${playlistItemId}:primary`}
                                            >
                                                <span>{isCurrent ? '*' : index + 1}</span>
                                                <span>
                                                    <strong>{trackName}</strong>
                                                    <small>{artistName}</small>
                                                    {isCurrent ? <em>Playing</em> : null}
                                                </span>
                                                <PtvIcon name={isCurrent ? 'speaker' : 'play'} />
                                            </button>
                                            {!isCurrent ? (
                                                <span className='ptv-music-queue-item-actions'>
                                                    <button
                                                        aria-label={`Move ${trackName} earlier`}
                                                        data-ptv-focus-token={`track:${playlistItemId}:move-earlier`}
                                                        disabled={!canMoveEarlier}
                                                        type='button'
                                                        onClick={event => {
                                                            void moveQueuedItem(
                                                                event,
                                                                playlistItemId,
                                                                index - 1,
                                                                `${trackName} earlier`
                                                            );
                                                        }}
                                                    >
                                                        Up
                                                    </button>
                                                    <button
                                                        aria-label={`Move ${trackName} later`}
                                                        data-ptv-focus-token={`track:${playlistItemId}:move-later`}
                                                        disabled={!canMoveLater}
                                                        type='button'
                                                        onClick={event => {
                                                            void moveQueuedItem(
                                                                event,
                                                                playlistItemId,
                                                                index + 1,
                                                                `${trackName} later`
                                                            );
                                                        }}
                                                    >
                                                        Down
                                                    </button>
                                                    <button
                                                        aria-label={`Move ${trackName} to top`}
                                                        data-ptv-focus-token={`track:${playlistItemId}:move-top`}
                                                        disabled={!canMoveToTop}
                                                        type='button'
                                                        onClick={event => {
                                                            void moveQueuedItem(
                                                                event,
                                                                playlistItemId,
                                                                snapshot.currentIndex + 1,
                                                                `${trackName} to top`
                                                            );
                                                        }}
                                                    >
                                                        Top
                                                    </button>
                                                    <button
                                                        aria-label={`Move ${trackName} to bottom`}
                                                        data-ptv-focus-token={`track:${playlistItemId}:move-bottom`}
                                                        disabled={!canMoveToBottom}
                                                        type='button'
                                                        onClick={event => {
                                                            void moveQueuedItem(
                                                                event,
                                                                playlistItemId,
                                                                snapshot.playlist.length,
                                                                `${trackName} to bottom`
                                                            );
                                                        }}
                                                    >
                                                        Bottom
                                                    </button>
                                                    <button
                                                        aria-label={`Play ${trackName} next`}
                                                        data-ptv-focus-token={`track:${playlistItemId}:play-next`}
                                                        disabled={!canMoveToPlayNext}
                                                        type='button'
                                                        onClick={event => {
                                                            void moveQueuedItem(
                                                                event,
                                                                playlistItemId,
                                                                snapshot.currentIndex + 1,
                                                                `${trackName} next`
                                                            );
                                                        }}
                                                    >
                                                        Play Next
                                                    </button>
                                                    <button
                                                        aria-label={`Add ${trackName} to end`}
                                                        data-ptv-focus-token={`track:${playlistItemId}:add-end`}
                                                        disabled={!canAddToEnd}
                                                        type='button'
                                                        onClick={event => {
                                                            void moveQueuedItem(
                                                                event,
                                                                playlistItemId,
                                                                snapshot.playlist.length,
                                                                `${trackName} add end`
                                                            );
                                                        }}
                                                    >
                                                        Add to end
                                                    </button>
                                                    <button
                                                        aria-label={`Remove ${trackName} from queue`}
                                                        data-ptv-focus-token={`track:${playlistItemId}:remove`}
                                                        type='button'
                                                        onClick={event => {
                                                            void rememberAndRun(
                                                                event,
                                                                playlistItemId,
                                                                () => removePtvMusicQueueItem(playlistItemId),
                                                                `Removed ${trackName}`
                                                            );
                                                        }}
                                                    >
                                                        x
                                                    </button>
                                                </span>
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ol>
                        </>
                    </QueueRenderBoundary>
                ) : null}
                {activeTab === 'Lyrics' ? (
                    <React.Suspense fallback={(
                        <section
                            className='ptv-music-lyrics-panel'
                            aria-busy='true'
                            aria-label={`${getPtvMusicItemName(item)} lyrics`}
                        >
                            <p aria-live='polite' role='status'>Loading lyrics...</p>
                        </section>
                    )}>
                        <LazyMusicLyricsPanel
                            item={item}
                            positionTicks={snapshot.positionTicks}
                            runtimeTicks={snapshot.runtimeTicks}
                        />
                    </React.Suspense>
                ) : null}
                {activeTab === 'Related' ? (
                    <ol className='ptv-music-related-list'>
                        {isRelatedLoading ? <p>Loading related tracks...</p> : null}
                        {!isRelatedLoading && relatedItems.map(relatedItem => {
                            const relatedItemId = relatedItem.Id || '';
                            const relatedTrackName = getPtvMusicItemName(relatedItem);

                            return (
                                <li key={relatedItemId || relatedTrackName} className='ptv-music-related-item'>
                                    <span>
                                        <strong>{relatedTrackName}</strong>
                                        <small>{getPtvMusicItemArtist(relatedItem)}</small>
                                    </span>
                                    <span>
                                        <button
                                            type='button'
                                            onClick={() => void playPtvMusicNext(relatedItem)}
                                            aria-label={`Play ${relatedTrackName} next`}
                                        >
                                            Play next
                                        </button>
                                        <button
                                            type='button'
                                            onClick={() => void addPtvMusicToQueue(relatedItem)}
                                            aria-label={`Add ${relatedTrackName} to queue`}
                                        >
                                            Add
                                        </button>
                                    </span>
                                </li>
                            );
                        })}
                    </ol>
                ) : null}
            </section>
        </aside>
    );
}

export default MusicPlayerPanel;
/* eslint-enable react/jsx-no-bind, no-void */
