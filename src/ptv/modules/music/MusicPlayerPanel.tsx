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
import { getPtvClientProfile } from '../../core/clientProfile';
import { acquirePtvRuntimeOverlayOcclusion } from '../../services/runtimeOverlayOcclusion';
import { PtvIcon } from '../icons';
import { loadPtvMusicContinuity, savePtvMusicContinuityPlayerTab, type PtvMusicContinuityPlayerTab } from './musicContinuity';
import PtvMusicItemMenuOverlay from './musicItemMenuOverlay';
import {
    addPtvMusicToQueue,
    clearPtvMusicQueue,
    movePtvMusicQueueItem,
    playPtvMusicNext,
    playPtvMusicQueueItem,
    removePtvMusicQueueItem,
    savePtvMusicQueueAsPlaylist
} from './musicQueue';
import {
    type PtvMusicQueueItem,
    type PtvMusicQueueSnapshot,
    type PtvMusicItem
} from './musicTypes';

type MusicPlayerPanelProps = Readonly<{
    isRelatedLoading: boolean;
    item: PtvMusicItem;
    onAddToPlaylist: (item: PtvMusicItem) => void;
    relatedItems: PtvMusicItem[];
    snapshot: PtvMusicQueueSnapshot;
}>;

type QueueAnnouncement = {
    action: string;
    description?: string;
};

type QueueActionRequest = Readonly<{
    action: () => Promise<unknown> | unknown;
    announcementLabel: string;
    fallbackFocusToken?: string;
    focusToken: string;
    playlistItemId: string;
}>;

type QueueMenuState = Readonly<{
    focusToken: string;
    index: number;
    item: PtvMusicQueueItem;
    triggerRef: React.RefObject<HTMLButtonElement>;
    triggerId: string;
}>;

type QueuePaneProps = Readonly<{
    currentIndex: number;
    currentItemName: string;
    isLoading: boolean;
    isPlaying: boolean;
    isTv: boolean;
    onAddToPlaylist: (item: PtvMusicItem) => void;
    onClearQueue: () => void;
    onRunAction: (request: QueueActionRequest) => Promise<void>;
    onSaveQueue: () => Promise<void>;
    playlist: PtvMusicQueueItem[];
    queueKeyboardInstructionsId: string;
    queueSourceLabel?: string;
    renderKey: number | string;
}>;

type QueueRowProps = Readonly<{
    currentIndex: number;
    index: number;
    isLoading: boolean;
    isPlaying: boolean;
    isMenuOpen: boolean;
    isTv: boolean;
    item: PtvMusicQueueItem;
    menuId: string;
    onOpenMenu: (
        trigger: HTMLButtonElement,
        item: PtvMusicQueueItem,
        index: number,
        focusToken: string,
        triggerId: string
    ) => void;
    onRunAction: (request: QueueActionRequest) => Promise<void>;
    playlistLength: number;
    queueKeyboardInstructionsId: string;
}>;

const PTV_MUSIC_PLAYER_TABS: ReadonlyArray<PtvMusicContinuityPlayerTab> = ['Up Next', 'Lyrics', 'Related'];
const PTV_PANEL_STATUS_TIMEOUT_MS = 1600;
const PTV_QUEUE_RENDER_WINDOW = 40;
const PTV_QUEUE_RENDER_OVERSCAN = 6;
const LazyMusicLyricsPanel = React.lazy(() => import('./MusicLyricsPanel'));

type QueueRenderWindow = Readonly<{
    end: number;
    start: number;
}>;

function getQueueRenderWindow(playlistLength: number, anchorIndex: number): QueueRenderWindow {
    if (playlistLength <= PTV_QUEUE_RENDER_WINDOW) {
        return { end: playlistLength, start: 0 };
    }

    const maximumStart = Math.max(0, playlistLength - PTV_QUEUE_RENDER_WINDOW);
    const start = Math.max(0, Math.min(maximumStart, anchorIndex - Math.floor(PTV_QUEUE_RENDER_WINDOW / 3)));

    return {
        end: Math.min(playlistLength, start + PTV_QUEUE_RENDER_WINDOW),
        start
    };
}

function areQueueRenderWindowsEqual(left: QueueRenderWindow, right: QueueRenderWindow) {
    return left.start === right.start && left.end === right.end;
}

function getPtvMusicItemName(item: PtvMusicItem) {
    return String(item.Name || item.SortName || item.Id || '').trim() || 'Unknown track';
}

function getPtvMusicItemArtist(item: PtvMusicItem) {
    return String(item.AlbumArtist || item.Artist || item.Artists?.[0] || item.ArtistItems?.[0]?.Name || 'Unknown artist');
}

function getPtvMusicItemAlbum(item: PtvMusicItem) {
    return String(item.Album || '').trim();
}

function getQueueItemFocusId(item: PtvMusicQueueItem, index: number) {
    return item.PlaylistItemId || `${item.Id || 'queue-item'}:${index}`;
}

function getQueuePrimaryFocusToken(item: PtvMusicQueueItem, index: number) {
    return `track:${getQueueItemFocusId(item, index)}:primary`;
}

function getQueueFallbackFocusToken(playlist: PtvMusicQueueItem[], index: number) {
    const fallbackIndex = index < playlist.length - 1 ? index + 1 : index - 1;
    const fallbackItem = playlist[fallbackIndex];

    return fallbackItem ? getQueuePrimaryFocusToken(fallbackItem, fallbackIndex) : undefined;
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

type QueueRowHandlerOptions = Readonly<{
    actionsDisabled: boolean;
    canMoveEarlier: boolean;
    canMoveLater: boolean;
    currentIndex: number;
    fallbackFocusToken?: string;
    index: number;
    isCurrent: boolean;
    isTv: boolean;
    item: PtvMusicQueueItem;
    onOpenMenu: QueueRowProps['onOpenMenu'];
    onRunAction: QueueRowProps['onRunAction'];
    playlistItemId: string;
    playlistLength: number;
    primaryFocusToken: string;
    trackName: string;
    triggerId: string;
}>;

function createQueueRowHandlers({
    actionsDisabled,
    canMoveEarlier,
    canMoveLater,
    currentIndex,
    fallbackFocusToken,
    index,
    isCurrent,
    isTv,
    item,
    onOpenMenu,
    onRunAction,
    playlistItemId,
    playlistLength,
    primaryFocusToken,
    trackName,
    triggerId
}: QueueRowHandlerOptions) {
    const openMenu = (trigger: HTMLButtonElement, focusToken: string) => {
        onOpenMenu(trigger, item, index, focusToken, triggerId);
    };
    const runMove = (
        focusToken: string,
        targetIndex: number,
        announcementLabel: string
    ) => onRunAction({
        action: () => movePtvMusicQueueItem(playlistItemId, targetIndex),
        announcementLabel,
        fallbackFocusToken,
        focusToken,
        playlistItemId
    });
    const onPrimaryClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        if (isTv) {
            openMenu(event.currentTarget, primaryFocusToken);
            return;
        }

        if (isCurrent || !playlistItemId) return;

        void playPtvMusicQueueItem(playlistItemId);
    };
    const onContextMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
        if (!isTv) return;

        event.preventDefault();
        openMenu(event.currentTarget, primaryFocusToken);
    };
    const onPrimaryKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (isTv) {
            const opensMenu = event.key === 'ContextMenu'
                || (event.shiftKey && event.key === 'F10');

            if (opensMenu) {
                event.preventDefault();
                openMenu(event.currentTarget, primaryFocusToken);
            }

            return;
        }

        if (actionsDisabled) return;

        const moveByKey: Record<
            'ArrowDown' | 'ArrowUp' | 'End' | 'Home',
            readonly [number, string] | null
        > = {
            ArrowDown: canMoveLater ? [index + 1, `${trackName} later`] : null,
            ArrowUp: canMoveEarlier ? [index - 1, `${trackName} earlier`] : null,
            End: canMoveLater ? [playlistLength, `${trackName} to bottom`] : null,
            Home: canMoveEarlier ? [currentIndex + 1, `${trackName} to top`] : null
        } as const;
        const move = moveByKey[event.key as keyof typeof moveByKey];

        if (move) {
            event.preventDefault();
            void runMove(primaryFocusToken, move[0], move[1]);
            return;
        }

        if (event.key !== 'Delete' && event.key !== 'Backspace') return;

        event.preventDefault();
        void onRunAction({
            action: () => removePtvMusicQueueItem(playlistItemId),
            announcementLabel: `Removed ${trackName}`,
            fallbackFocusToken,
            focusToken: primaryFocusToken,
            playlistItemId
        });
    };

    return {
        openMenu,
        onContextMenu,
        onPrimaryClick,
        onPrimaryKeyDown,
        runMove
    };
}

type QueueItemPrimaryProps = Readonly<{
    currentState: string;
    index: number;
    isCurrent: boolean;
    isLoading: boolean;
    isMenuOpen: boolean;
    isTv: boolean;
    menuId: string;
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
    onPrimaryClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    onPrimaryKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
    primaryFocusToken: string;
    primaryLabel: string;
    queueKeyboardInstructionsId: string;
    secondaryLabel: string;
    trackName: string;
    triggerId: string;
}>;

function QueueItemPrimary({
    currentState,
    index,
    isCurrent,
    isLoading,
    isMenuOpen,
    isTv,
    menuId,
    onContextMenu,
    onPrimaryClick,
    onPrimaryKeyDown,
    primaryFocusToken,
    primaryLabel,
    queueKeyboardInstructionsId,
    secondaryLabel,
    trackName,
    triggerId
}: QueueItemPrimaryProps) {
    const describedBy = !isTv && !isCurrent ? queueKeyboardInstructionsId : undefined;
    const keyboardShortcuts = !isTv && !isCurrent ? 'ArrowUp ArrowDown Home End Delete Backspace' : undefined;

    return (
        <button
            id={isTv ? triggerId : undefined}
            aria-controls={isTv && isMenuOpen ? menuId : undefined}
            aria-current={isCurrent ? 'true' : undefined}
            aria-describedby={describedBy}
            aria-disabled={isCurrent && !isTv ? 'true' : undefined}
            aria-expanded={isTv ? isMenuOpen : undefined}
            aria-haspopup={isTv ? 'menu' : undefined}
            aria-keyshortcuts={keyboardShortcuts}
            aria-label={primaryLabel}
            className='ptv-music-queue-item-main'
            data-ptv-focus-key={primaryFocusToken}
            data-ptv-focus-token={primaryFocusToken}
            type='button'
            onClick={onPrimaryClick}
            onContextMenu={onContextMenu}
            onKeyDown={onPrimaryKeyDown}
        >
            <span className='ptv-music-queue-position'>{index + 1}</span>
            <span className='ptv-music-queue-copy'>
                <strong>{trackName}</strong>
                <small>{secondaryLabel}</small>
            </span>
            {isCurrent ? (
                <em className='ptv-music-queue-playing-state' aria-busy={isLoading ? 'true' : undefined}>
                    {currentState}
                </em>
            ) : <PtvIcon name='play' />}
        </button>
    );
}

type QueueInlineActionsProps = Readonly<{
    canMoveEarlier: boolean;
    canMoveLater: boolean;
    focusId: string;
    index: number;
    isMenuOpen: boolean;
    isTv: boolean;
    menuId: string;
    openMenu: (trigger: HTMLButtonElement, focusToken: string) => void;
    runMove: (focusToken: string, targetIndex: number, announcementLabel: string) => Promise<void>;
    trackName: string;
    triggerId: string;
}>;

function QueueInlineActions({
    canMoveEarlier,
    canMoveLater,
    focusId,
    index,
    isMenuOpen,
    isTv,
    menuId,
    openMenu,
    runMove,
    trackName,
    triggerId
}: QueueInlineActionsProps) {
    if (isTv) return null;

    const earlierFocusToken = `track:${focusId}:move-earlier`;
    const laterFocusToken = `track:${focusId}:move-later`;
    const menuFocusToken = `track:${focusId}:actions`;

    return (
        <span className='ptv-music-queue-item-actions'>
            <button
                aria-label={`Move ${trackName} earlier`}
                className='ptv-music-queue-quick-action'
                data-ptv-focus-key={earlierFocusToken}
                data-ptv-focus-token={earlierFocusToken}
                disabled={!canMoveEarlier}
                title='Move earlier'
                type='button'
                onClick={() => {
                    void runMove(earlierFocusToken, index - 1, `${trackName} earlier`);
                }}
            >
                <PtvIcon name='skipPrevious' />
            </button>
            <button
                aria-label={`Move ${trackName} later`}
                className='ptv-music-queue-quick-action'
                data-ptv-focus-key={laterFocusToken}
                data-ptv-focus-token={laterFocusToken}
                disabled={!canMoveLater}
                title='Move later'
                type='button'
                onClick={() => {
                    void runMove(laterFocusToken, index + 1, `${trackName} later`);
                }}
            >
                <PtvIcon name='skipNext' />
            </button>
            <button
                id={triggerId}
                aria-controls={isMenuOpen ? menuId : undefined}
                aria-expanded={isMenuOpen}
                aria-haspopup='menu'
                aria-label={`Open actions for ${trackName}`}
                className='ptv-music-queue-overflow'
                data-ptv-focus-key={menuFocusToken}
                data-ptv-focus-token={menuFocusToken}
                title={`Actions for ${trackName}`}
                type='button'
                onClick={event => openMenu(event.currentTarget, menuFocusToken)}
            >
                <PtvIcon name='moreVertical' />
            </button>
        </span>
    );
}

function getQueueRowItemRenderKey(item: PtvMusicQueueItem) {
    return JSON.stringify([
        item.PlaylistItemId || '',
        item.Id || '',
        item.Name || '',
        item.SortName || '',
        item.Album || '',
        item.AlbumArtist || '',
        item.Artist || '',
        item.Artists?.[0] || '',
        item.ArtistItems?.[0]?.Name || ''
    ]);
}

function areQueueRowPropsEqual(previous: QueueRowProps, next: QueueRowProps) {
    const isCurrentRow = previous.index === previous.currentIndex;
    const loadingChangedForCurrent = isCurrentRow && previous.isLoading !== next.isLoading;
    const playbackChangedForCurrent = isCurrentRow && previous.isPlaying !== next.isPlaying;

    return previous.currentIndex === next.currentIndex
        && previous.index === next.index
        && !loadingChangedForCurrent
        && !playbackChangedForCurrent
        && previous.isMenuOpen === next.isMenuOpen
        && previous.isTv === next.isTv
        && previous.menuId === next.menuId
        && previous.onOpenMenu === next.onOpenMenu
        && previous.onRunAction === next.onRunAction
        && previous.playlistLength === next.playlistLength
        && previous.queueKeyboardInstructionsId === next.queueKeyboardInstructionsId
        && getQueueRowItemRenderKey(previous.item) === getQueueRowItemRenderKey(next.item);
}

const QueueRow = React.memo(function QueueRow({
    currentIndex,
    index,
    isLoading,
    isPlaying,
    isMenuOpen,
    isTv,
    item,
    menuId,
    onOpenMenu,
    onRunAction,
    playlistLength,
    queueKeyboardInstructionsId
}: QueueRowProps) {
    const playlistItemId = item.PlaylistItemId || '';
    const trackName = getPtvMusicItemName(item);
    const artistName = getPtvMusicItemArtist(item);
    const albumName = getPtvMusicItemAlbum(item);
    const secondaryLabel = albumName ? `${artistName} - ${albumName}` : artistName;
    const focusId = getQueueItemFocusId(item, index);
    const primaryFocusToken = getQueuePrimaryFocusToken(item, index);
    const triggerId = `ptv-music-queue-${focusId}-actions`;
    const isCurrent = currentIndex === index;
    const canMoveEarlier = Boolean(playlistItemId) && index > currentIndex + 1;
    const canMoveLater = Boolean(playlistItemId) && index > currentIndex && index < playlistLength - 1;
    const actionsDisabled = isCurrent || !playlistItemId;
    const fallbackFocusToken = index < playlistLength - 1 ? undefined : primaryFocusToken;
    let currentState = 'Paused';

    if (isLoading) {
        currentState = 'Loading';
    } else if (isPlaying) {
        currentState = 'Playing';
    }
    const playbackLabel = isCurrent ? `${currentState} ${trackName}` : `Play ${trackName}`;
    const primaryLabel = isTv ? `Open actions for ${trackName}` : playbackLabel;
    const {
        openMenu,
        onContextMenu,
        onPrimaryClick,
        onPrimaryKeyDown,
        runMove
    } = createQueueRowHandlers({
        actionsDisabled,
        canMoveEarlier,
        canMoveLater,
        currentIndex,
        fallbackFocusToken,
        index,
        isCurrent,
        isTv,
        item,
        onOpenMenu,
        onRunAction,
        playlistItemId,
        playlistLength,
        primaryFocusToken,
        trackName,
        triggerId
    });

    return (
        <li
            aria-current={isCurrent ? 'true' : undefined}
            aria-busy={isCurrent && isLoading ? 'true' : undefined}
            aria-posinset={index + 1}
            aria-setsize={playlistLength}
            className={`ptv-music-queue-item${isCurrent ? ' ptv-music-queue-item-current' : ''}`}
            data-playlist-item={playlistItemId}
        >
            <QueueItemPrimary
                currentState={currentState}
                index={index}
                isCurrent={isCurrent}
                isLoading={isLoading}
                isMenuOpen={isMenuOpen}
                isTv={isTv}
                menuId={menuId}
                onContextMenu={onContextMenu}
                onPrimaryClick={onPrimaryClick}
                onPrimaryKeyDown={onPrimaryKeyDown}
                primaryFocusToken={primaryFocusToken}
                primaryLabel={primaryLabel}
                queueKeyboardInstructionsId={queueKeyboardInstructionsId}
                secondaryLabel={secondaryLabel}
                trackName={trackName}
                triggerId={triggerId}
            />
            <QueueInlineActions
                canMoveEarlier={canMoveEarlier}
                canMoveLater={canMoveLater}
                focusId={focusId}
                index={index}
                isMenuOpen={isMenuOpen}
                isTv={isTv}
                menuId={menuId}
                openMenu={openMenu}
                runMove={runMove}
                trackName={trackName}
                triggerId={triggerId}
            />
        </li>
    );
}, areQueueRowPropsEqual);

const QueuePane = React.memo(function QueuePane({
    currentIndex,
    currentItemName,
    isLoading,
    isPlaying,
    isTv,
    onAddToPlaylist,
    onClearQueue,
    onRunAction,
    onSaveQueue,
    playlist,
    queueKeyboardInstructionsId,
    queueSourceLabel,
    renderKey
}: QueuePaneProps) {
    const listRef = useRef<HTMLOListElement>(null);
    const menuId = useId();
    const [activeMenu, setActiveMenu] = useState<QueueMenuState | null>(null);
    const [renderWindow, setRenderWindow] = useState<QueueRenderWindow>(() => (
        getQueueRenderWindow(playlist.length, Math.max(0, currentIndex))
    ));
    const currentItem = playlist[currentIndex];
    const currentFocusId = currentItem ? getQueueItemFocusId(currentItem, currentIndex) : '';
    const visiblePlaylist = playlist.slice(renderWindow.start, renderWindow.end);
    const isVirtualized = playlist.length > PTV_QUEUE_RENDER_WINDOW;

    const closeMenu = useCallback(() => setActiveMenu(null), []);
    const openMenu = useCallback((
        trigger: HTMLButtonElement,
        item: PtvMusicQueueItem,
        index: number,
        focusToken: string,
        triggerId: string
    ) => {
        setActiveMenu({
            focusToken,
            index,
            item,
            triggerRef: { current: trigger },
            triggerId
        });
    }, []);

    useEffect(() => {
        setRenderWindow(previous => {
            const currentIsMounted = currentIndex >= previous.start && currentIndex < previous.end;
            const previousIsValid = previous.end <= playlist.length
                && previous.end - previous.start <= PTV_QUEUE_RENDER_WINDOW;

            if (currentIsMounted && previousIsValid) return previous;

            return getQueueRenderWindow(playlist.length, Math.max(0, currentIndex));
        });
    }, [currentIndex, playlist.length, renderKey]);

    const onQueueScroll = useCallback((event: React.UIEvent<HTMLOListElement>) => {
        if (activeMenu || playlist.length <= PTV_QUEUE_RENDER_WINDOW) return;

        const list = event.currentTarget;
        const rowStride = Number.parseFloat(
            window.getComputedStyle(list).getPropertyValue('--ptv-music-queue-row-stride')
        ) || 74;
        const maximumStart = Math.max(0, playlist.length - PTV_QUEUE_RENDER_WINDOW);
        const start = Math.max(0, Math.min(
            maximumStart,
            Math.floor(list.scrollTop / rowStride) - PTV_QUEUE_RENDER_OVERSCAN
        ));
        const nextWindow = {
            end: Math.min(playlist.length, start + PTV_QUEUE_RENDER_WINDOW),
            start
        };

        setRenderWindow(previous => areQueueRenderWindowsEqual(previous, nextWindow) ? previous : nextWindow);
    }, [activeMenu, playlist.length]);

    useEffect(() => {
        if (!activeMenu) return undefined;

        return acquirePtvRuntimeOverlayOcclusion('ptv-music-queue-item-menu');
    }, [activeMenu]);

    useEffect(() => {
        const list = listRef.current;
        const currentRow = list?.querySelector<HTMLElement>('.ptv-music-queue-item-current');
        let alignmentFrame: number | null = null;
        let disposed = false;

        if (!list || !currentRow) return undefined;

        const alignCurrentRow = () => {
            alignmentFrame = null;
            if (disposed) return;

            const activeElement = document.activeElement;
            const focusedQueueRow = activeElement instanceof Element ?
                activeElement.closest<HTMLElement>('.ptv-music-queue-item') :
                null;

            if (focusedQueueRow && focusedQueueRow !== currentRow) return;

            const listRect = list.getBoundingClientRect();
            const rowRect = currentRow.getBoundingClientRect();
            const visibleTop = listRect.top + list.clientTop;
            const visibleBottom = visibleTop + list.clientHeight;
            const hasMeasuredLayout = list.clientHeight > 0 && rowRect.height > 0;

            if (!hasMeasuredLayout) return;

            let delta = 0;

            if (rowRect.top < visibleTop) {
                delta = rowRect.top - visibleTop;
            } else if (rowRect.bottom > visibleBottom) {
                delta = rowRect.bottom - visibleBottom;
            }

            if (Math.abs(delta) <= 1) return;

            const maximumScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
            const nextScrollTop = Math.min(
                maximumScrollTop,
                Math.max(0, list.scrollTop + delta)
            );

            if (Math.abs(nextScrollTop - list.scrollTop) > 1) {
                list.scrollTop = nextScrollTop;
            }
        };
        const scheduleAlignment = () => {
            if (disposed || alignmentFrame !== null) return;

            if (typeof window.requestAnimationFrame === 'function') {
                alignmentFrame = window.requestAnimationFrame(alignCurrentRow);
            } else {
                alignCurrentRow();
            }
        };

        scheduleAlignment();

        const resizeObserver = typeof ResizeObserver === 'function' ?
            new ResizeObserver(scheduleAlignment) :
            null;

        resizeObserver?.observe(list);
        resizeObserver?.observe(currentRow);

        return () => {
            disposed = true;
            if (alignmentFrame !== null) window.cancelAnimationFrame(alignmentFrame);
            resizeObserver?.disconnect();
        };
    }, [currentFocusId, currentIndex]);

    const runMenuAction = (
        action: () => Promise<unknown> | unknown,
        announcementLabel: string
    ) => {
        if (!activeMenu) return;

        const playlistItemId = activeMenu.item.PlaylistItemId || '';
        const fallbackFocusToken = getQueueFallbackFocusToken(playlist, activeMenu.index);
        const request = {
            action,
            announcementLabel,
            fallbackFocusToken,
            focusToken: activeMenu.focusToken,
            playlistItemId
        };

        closeMenu();
        void onRunAction(request);
    };
    const menuPlaylistItemId = activeMenu?.item.PlaylistItemId || '';
    const menuTrackName = activeMenu ? getPtvMusicItemName(activeMenu.item) : '';
    const menuIndex = activeMenu?.index ?? -1;
    const menuIsCurrent = menuIndex === currentIndex;
    const canMoveEarlier = Boolean(menuPlaylistItemId) && menuIndex > currentIndex + 1;
    const canMoveLater = Boolean(menuPlaylistItemId) && menuIndex > currentIndex && menuIndex < playlist.length - 1;
    const canPlayNext = Boolean(menuPlaylistItemId) && menuIndex > currentIndex + 1;

    return (
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
                    <button type='button' onClick={onClearQueue}>
                        Clear upcoming
                    </button>
                    <button type='button' onClick={() => { void onSaveQueue(); }}>
                        Save queue
                    </button>
                </span>
            </div>
            <div className='ptv-music-related-queue-note'>
                <strong>{queueSourceLabel || 'Queue'}</strong>
                <span>{playlist.length} items</span>
            </div>
            <ol
                ref={listRef}
                aria-label='Playback queue'
                className='ptv-music-queue-list'
                data-ptv-rendered-count={visiblePlaylist.length}
                onScroll={onQueueScroll}
            >
                {isVirtualized && renderWindow.start > 0 ? (
                    <li
                        aria-hidden='true'
                        className='ptv-music-queue-spacer'
                        role='presentation'
                        style={{ height: `calc(var(--ptv-music-queue-row-stride) * ${renderWindow.start})` }}
                    />
                ) : null}
                {visiblePlaylist.map((playlistItem, visibleIndex) => {
                    const index = renderWindow.start + visibleIndex;

                    return (
                        <QueueRow
                            key={getQueueItemFocusId(playlistItem, index)}
                            currentIndex={currentIndex}
                            index={index}
                            isLoading={isLoading}
                            isPlaying={isPlaying}
                            isMenuOpen={activeMenu?.index === index}
                            isTv={isTv}
                            item={playlistItem}
                            menuId={menuId}
                            onOpenMenu={openMenu}
                            onRunAction={onRunAction}
                            playlistLength={playlist.length}
                            queueKeyboardInstructionsId={queueKeyboardInstructionsId}
                        />
                    );
                })}
                {isVirtualized && renderWindow.end < playlist.length ? (
                    <li
                        aria-hidden='true'
                        className='ptv-music-queue-spacer'
                        role='presentation'
                        style={{ height: `calc(var(--ptv-music-queue-row-stride) * ${playlist.length - renderWindow.end})` }}
                    />
                ) : null}
            </ol>
            {activeMenu ? (
                <PtvMusicItemMenuOverlay
                    key={activeMenu.focusToken}
                    id={menuId}
                    labelledBy={activeMenu.triggerId}
                    onClose={closeMenu}
                    triggerRef={activeMenu.triggerRef}
                >
                    {isTv ? (
                        <button
                            disabled={menuIsCurrent || !menuPlaylistItemId}
                            role='menuitem'
                            type='button'
                            onClick={() => runMenuAction(
                                () => playPtvMusicQueueItem(menuPlaylistItemId),
                                `Playing ${menuTrackName}`
                            )}
                        >
                            <PtvIcon name='play' />
                            <span>Play this item</span>
                        </button>
                    ) : null}
                    <button
                        disabled={!canMoveEarlier}
                        role='menuitem'
                        type='button'
                        onClick={() => runMenuAction(
                            () => movePtvMusicQueueItem(menuPlaylistItemId, menuIndex - 1),
                            `${menuTrackName} earlier`
                        )}
                    >
                        <PtvIcon name='skipPrevious' />
                        <span>Move earlier</span>
                    </button>
                    <button
                        disabled={!canMoveLater}
                        role='menuitem'
                        type='button'
                        onClick={() => runMenuAction(
                            () => movePtvMusicQueueItem(menuPlaylistItemId, menuIndex + 1),
                            `${menuTrackName} later`
                        )}
                    >
                        <PtvIcon name='skipNext' />
                        <span>Move later</span>
                    </button>
                    <button
                        disabled={!canMoveEarlier}
                        role='menuitem'
                        type='button'
                        onClick={() => runMenuAction(
                            () => movePtvMusicQueueItem(menuPlaylistItemId, currentIndex + 1),
                            `${menuTrackName} to top`
                        )}
                    >
                        <PtvIcon name='skipPrevious' />
                        <span>Move to top</span>
                    </button>
                    <button
                        disabled={!canMoveLater}
                        role='menuitem'
                        type='button'
                        onClick={() => runMenuAction(
                            () => movePtvMusicQueueItem(menuPlaylistItemId, playlist.length),
                            `${menuTrackName} to bottom`
                        )}
                    >
                        <PtvIcon name='skipNext' />
                        <span>Move to bottom</span>
                    </button>
                    <button
                        disabled={!canPlayNext}
                        role='menuitem'
                        type='button'
                        onClick={() => runMenuAction(
                            () => movePtvMusicQueueItem(menuPlaylistItemId, currentIndex + 1),
                            `${menuTrackName} next`
                        )}
                    >
                        <PtvIcon name='play' />
                        <span>Play next</span>
                    </button>
                    <button
                        disabled={!activeMenu.item.Id}
                        role='menuitem'
                        type='button'
                        onClick={() => {
                            const selectedItem = activeMenu.item;

                            closeMenu();
                            onAddToPlaylist(selectedItem);
                        }}
                    >
                        <PtvIcon name='playlists' />
                        <span>Add to playlist</span>
                    </button>
                    <button
                        disabled={menuIsCurrent || !menuPlaylistItemId}
                        role='menuitem'
                        type='button'
                        onClick={() => runMenuAction(
                            () => removePtvMusicQueueItem(menuPlaylistItemId),
                            `Removed ${menuTrackName}`
                        )}
                    >
                        <PtvIcon name='delete' />
                        <span>Remove from queue</span>
                    </button>
                </PtvMusicItemMenuOverlay>
            ) : null}
        </>
    );
}, (previous, next) => (
    previous.renderKey === next.renderKey
    && previous.isTv === next.isTv
    && previous.onAddToPlaylist === next.onAddToPlaylist
    && previous.onClearQueue === next.onClearQueue
    && previous.onRunAction === next.onRunAction
    && previous.onSaveQueue === next.onSaveQueue
));

function MusicPlayerPanel({
    isRelatedLoading,
    item,
    onAddToPlaylist,
    relatedItems,
    snapshot
}: MusicPlayerPanelProps) {
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
            if (document.querySelector('[data-ptv-music-item-menu-overlay="true"]')) return;

            const hash = window.location.hash;
            if (!hash.startsWith('#/music/player') || !hasPanelRoute(hash)) return;

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

    const currentItemName = getPtvMusicItemName(snapshot.currentItem || item);
    const playerTabId = `${panelInstanceId}-tab`;
    const queueKeyboardInstructionsId = `${panelInstanceId}-queue-keyboard-instructions`;
    const announcementDescription = announcement?.description ? ` ${announcement.description}` : '';
    const queueMessage = announcement ? `${announcement.action}${announcementDescription}` : '';
    const isTv = getPtvClientProfile().isTv;
    const snapshotQueueRevision = Number((snapshot as PtvMusicQueueSnapshot & { queueRevision?: number }).queueRevision);
    const queueStateRenderKey = JSON.stringify([
        currentItemName,
        snapshot.currentIndex,
        snapshot.isLoading,
        snapshot.isPlaying,
        snapshot.queueSourceLabel
    ]);
    const queueRenderKey = Number.isFinite(snapshotQueueRevision) ?
        `${snapshotQueueRevision}:${queueStateRenderKey}` :
        JSON.stringify([
            queueStateRenderKey,
            snapshot.playlist.map((playlistItem, index) => [
                getQueueItemFocusId(playlistItem, index),
                playlistItem.Id || '',
                playlistItem.Name || '',
                playlistItem.Album || '',
                playlistItem.AlbumArtist || playlistItem.Artist || '',
                playlistItem.Artists?.[0] || '',
                playlistItem.ArtistItems?.[0]?.Name || ''
            ])
        ]);

    const announceQueueAction = useCallback((action: string, description?: string) => {
        if (announcementTimerRef.current) {
            window.clearTimeout(announcementTimerRef.current);
        }

        setAnnouncement({ action, description });
        announcementTimerRef.current = window.setTimeout(() => {
            announcementTimerRef.current = 0;
            setAnnouncement(null);
        }, PTV_PANEL_STATUS_TIMEOUT_MS);
    }, []);

    const selectTab = (tab: PtvMusicContinuityPlayerTab) => {
        setTabState({
            activeTab: tab,
            scopeKey: continuityScopeKey
        });
        savePtvMusicContinuityPlayerTab(continuationScope, tab);
    };

    const runQueueAction = useCallback(async ({
        action,
        announcementLabel,
        fallbackFocusToken,
        focusToken,
        playlistItemId
    }: QueueActionRequest) => {
        focus.remember(focusToken, fallbackFocusToken);

        try {
            await Promise.resolve(action());
            announceQueueAction(announcementLabel);
        } catch {
            announceQueueAction(`Could not update ${playlistItemId ? 'that queue item' : 'the queue'}`);
        } finally {
            focus.restore();
        }
    }, [announceQueueAction, focus]);

    const onClearQueue = useCallback(() => {
        void clearPtvMusicQueue();
    }, []);

    const onSaveQueue = useCallback(async () => {
        await savePtvMusicQueueAsPlaylist('PiggieTV Now Playing Queue');
        announceQueueAction('Saved');
    }, [announceQueueAction]);

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
        nextButton?.focus();
    };

    return (
        <aside className='ptv-music-player-panel' ref={panelRef}>
            <div className='ptv-music-player-tabs' aria-label='Now playing panels' role='tablist'>
                {PTV_MUSIC_PLAYER_TABS.map((tab, index) => (
                    <button
                        key={tab}
                        id={`${playerTabId}-${index}`}
                        aria-controls={`${playerTabId}-${tab.toLowerCase().replace(/\s+/g, '-')}`}
                        aria-selected={activeTab === tab}
                        className={activeTab === tab ? 'ptv-music-player-tab-active' : ''}
                        role='tab'
                        tabIndex={activeTab === tab ? 0 : -1}
                        type='button'
                        onClick={() => selectTab(tab)}
                        onKeyDown={onLyricsTabKeyDown}
                    >
                        {tab}
                    </button>
                ))}
            </div>
            <div aria-live='polite' role='status' className='ptv-music-player-status'>
                {queueMessage || ' '}
            </div>
            {snapshot.playbackError ? (
                <p className='ptv-music-player-error' role='alert'>
                    {snapshot.playbackError}
                </p>
            ) : null}
            <section
                aria-labelledby={`${playerTabId}-${PTV_MUSIC_PLAYER_TABS.indexOf(activeTab)}`}
                className={`ptv-music-list${activeTab === 'Up Next' ? ' ptv-music-list-up-next' : ''}`}
                id={`${playerTabId}-${activeTab.toLowerCase().replace(/\s+/g, '-')}`}
                role='tabpanel'
            >
                {activeTab === 'Up Next' ? (
                    <QueuePane
                        currentIndex={snapshot.currentIndex}
                        currentItemName={currentItemName}
                        isLoading={Boolean(snapshot.isLoading)}
                        isPlaying={snapshot.isPlaying}
                        isTv={isTv}
                        onAddToPlaylist={onAddToPlaylist}
                        onClearQueue={onClearQueue}
                        onRunAction={runQueueAction}
                        onSaveQueue={onSaveQueue}
                        playlist={snapshot.playlist}
                        queueKeyboardInstructionsId={queueKeyboardInstructionsId}
                        queueSourceLabel={snapshot.queueSourceLabel}
                        renderKey={queueRenderKey}
                    />
                ) : null}
                {activeTab === 'Lyrics' ? (
                    <React.Suspense fallback={(
                        <section
                            aria-busy='true'
                            aria-label={`${getPtvMusicItemName(item)} lyrics`}
                            className='ptv-music-lyrics-panel'
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
                                            aria-label={`Play ${relatedTrackName} next`}
                                            type='button'
                                            onClick={() => void playPtvMusicNext(relatedItem)}
                                        >
                                            Play next
                                        </button>
                                        <button
                                            aria-label={`Add ${relatedTrackName} to queue`}
                                            type='button'
                                            onClick={() => void addPtvMusicToQueue(relatedItem)}
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
