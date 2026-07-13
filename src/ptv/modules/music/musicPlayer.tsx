/* eslint-disable react/jsx-no-bind, no-void */
import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { recordPtvEvent } from '../../core/observability';
import { PtvIcon } from '../icons';

import {
    clearPtvMusicQueue,
    movePtvMusicQueueItem,
    nextPtvMusicTrack,
    openPtvMusicPlayer,
    playPtvMusicTracks,
    previousPtvMusicTrack,
    removePtvMusicQueueItem,
    savePtvMusicQueueAsPlaylist,
    seekPtvMusicFromClientX,
    seekPtvMusicPercent,
    setPtvMusicRepeatMode,
    setPtvMusicVirtualQueue,
    setPtvMusicVolume,
    subscribeToPtvMusicQueue,
    togglePtvMusicMute,
    togglePtvMusicPlayPause,
    togglePtvMusicShuffle
} from './musicQueue';
import {
    fetchPtvMusicLyrics,
    getMusicImagePlaceholder,
    getMusicImageUrl,
    getPtvMusicAlbum,
    getPtvMusicArtist,
    getPtvMusicCodec,
    getPtvMusicTitle
} from './musicApi';
import type {
    PtvMusicArtistRef,
    PtvMusicItem,
    PtvMusicLyricLine,
    PtvMusicQueueItem,
    PtvMusicQueueSnapshot
} from './musicTypes';
import {
    isPtvMusicItemLiked,
    setPtvMusicItemLiked,
    subscribeToPtvLikedMusic
} from './musicLikes';
import { PtvMusicPlaylistModal } from './musicPlaylistModal';
import { buildPtvMusicRelatedTracks } from './musicRecommendations';

const EMPTY_QUEUE_SNAPSHOT: PtvMusicQueueSnapshot = {
    autoQueueSeedItem: null,
    autoQueueSeedRevision: 0,
    currentIndex: -1,
    currentItem: null,
    isAudio: false,
    isMuted: false,
    isPlaying: false,
    isShuffled: false,
    playlist: [],
    positionTicks: 0,
    repeatMode: 'RepeatNone',
    runtimeTicks: 0,
    volumeLevel: 50
};

function formatTicks(ticks: number) {
    const totalSeconds = Math.max(0, Math.floor(ticks / 10000000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const paddedSeconds = seconds < 10 ? `0${seconds}` : String(seconds);

    return `${minutes}:${paddedSeconds}`;
}

function getProgressPercent(snapshot: PtvMusicQueueSnapshot) {
    if (!snapshot.runtimeTicks) return 0;

    return Math.max(0, Math.min(100, (snapshot.positionTicks / snapshot.runtimeTicks) * 100));
}

function getRepeatLabel(mode: string) {
    if (mode === 'RepeatOne') return 'Repeat One';
    if (mode === 'RepeatAll') return 'Repeat All';

    return 'Repeat Off';
}

function getMusicQueueItemKey(item: PtvMusicQueueItem) {
    return item.PlaylistItemId
        || item.Id
        || item.ProviderIds?.MusicBrainzTrackId
        || `${getPtvMusicTitle(item)}-${getPtvMusicArtist(item)}-${getPtvMusicAlbum(item)}`;
}

function getNextRepeatMode(mode: string) {
    if (mode === 'RepeatNone') return 'RepeatAll';
    if (mode === 'RepeatAll') return 'RepeatOne';

    return 'RepeatNone';
}

function getMusicArtistRefs(item: PtvMusicItem): PtvMusicArtistRef[] {
    const refs = [
        ...(item.ArtistItems || []),
        ...(item.AlbumArtists || [])
    ];
    const seen = new Set<string>();

    return refs.filter(ref => {
        const key = ref.Id || ref.Name || '';

        if (!key || seen.has(key)) return false;

        seen.add(key);
        return true;
    });
}

function getArtistHref(ref: PtvMusicArtistRef) {
    return ref.Id ? `#/music/artist/${encodeURIComponent(ref.Id)}` : '';
}

function getAlbumHref(item: PtvMusicItem) {
    const albumId = item.AlbumId || (item.Type === 'MusicAlbum' ? item.Id : '');

    return albumId ? `#/music/album/${encodeURIComponent(albumId)}` : '';
}

function getLyricTimingScale(lyrics: PtvMusicLyricLine[], runtimeTicks: number) {
    const maxStart = Math.max(...lyrics.map(line => Number(line.Start || 0)), 0);

    if (!maxStart || !runtimeTicks) return 1;

    const runtimeSeconds = runtimeTicks / 10000000;
    const runtimeMilliseconds = runtimeTicks / 10000;

    if (maxStart <= runtimeSeconds + 5) return 10000000;
    if (maxStart <= runtimeMilliseconds + 5000) return 10000;

    return 1;
}

function getActiveLyricIndex(lyrics: PtvMusicLyricLine[], positionTicks: number, runtimeTicks: number) {
    const timedLyrics = lyrics.filter(line => Number(line.Start || 0) > 0);

    if (!timedLyrics.length) return -1;

    const timingScale = getLyricTimingScale(lyrics, runtimeTicks);
    let activeIndex = -1;

    lyrics.forEach((line, index) => {
        const startTicks = Number(line.Start || 0) * timingScale;

        if (startTicks > 0 && startTicks <= positionTicks) {
            activeIndex = index;
        }
    });

    return activeIndex;
}

function useRelatedMusicTracks(snapshot: PtvMusicQueueSnapshot) {
    const seedItem = snapshot.autoQueueSeedItem || snapshot.currentItem;
    const currentItemId = snapshot.currentItem?.Id || '';
    const [relatedItems, setRelatedItems] = useState<PtvMusicItem[]>([]);
    const [isRelatedLoading, setRelatedLoading] = useState(false);

    useEffect(() => {
        let disposed = false;

        if (!seedItem) {
            setRelatedItems([]);
            setRelatedLoading(false);

            return () => {
                disposed = true;
            };
        }

        setRelatedLoading(true);
        void buildPtvMusicRelatedTracks(seedItem, {
            limit: 18
        }).then(items => {
            if (disposed) return;

            const visibleItems = items.filter(relatedItem => relatedItem.Id !== currentItemId);

            setRelatedItems(visibleItems);
            setPtvMusicVirtualQueue(seedItem, visibleItems, 'player-related');
        }).finally(() => {
            if (!disposed) {
                setRelatedLoading(false);
            }
        });

        return () => {
            disposed = true;
        };
    }, [currentItemId, seedItem, snapshot.autoQueueSeedRevision]);

    return {
        isRelatedLoading,
        relatedItems
    };
}

function isPtvMusicRouteHash(hash = window.location.hash) {
    return /^#\/music(?:[/?]|$)/i.test(hash);
}

function useMusicQueueSnapshot() {
    const [snapshot, setSnapshot] = useState<PtvMusicQueueSnapshot>(EMPTY_QUEUE_SNAPSHOT);

    useEffect(() => subscribeToPtvMusicQueue(setSnapshot), []);

    return snapshot;
}

function useLyrics(item: PtvMusicItem | null) {
    const [lyrics, setLyrics] = useState<PtvMusicLyricLine[]>([]);

    useEffect(() => {
        let isMounted = true;

        setLyrics([]);

        if (!item?.Id || !item.HasLyrics) {
            return () => {
                isMounted = false;
            };
        }

        void fetchPtvMusicLyrics(item)
            .then(response => {
                if (isMounted) {
                    setLyrics(response.Lyrics || []);
                }
            });

        return () => {
            isMounted = false;
        };
    }, [item]);

    return lyrics;
}

function useLikedMusicItem(item: PtvMusicItem | null, failureStage: string) {
    const [isLiked, setLiked] = useState(() => isPtvMusicItemLiked(item));

    useEffect(() => {
        setLiked(isPtvMusicItemLiked(item));

        return subscribeToPtvLikedMusic(() => {
            setLiked(isPtvMusicItemLiked(item));
        });
    }, [item]);

    const toggleLiked = () => {
        if (!item) return;

        const nextLiked = !isLiked;

        setLiked(nextLiked);
        void setPtvMusicItemLiked(item, nextLiked)
            .catch(error => {
                setLiked(!nextLiked);
                recordPtvEvent('render', 'music-playback-error', {
                    error: error instanceof Error ? error.message : String(error),
                    itemId: item.Id || null,
                    stage: failureStage
                });
            });
    };

    return {
        isLiked,
        toggleLiked
    };
}

type PlayerButtonProps = Readonly<{
    children?: React.ReactNode;
    className?: string;
    disabled?: boolean;
    icon?: string;
    isActive?: boolean;
    label: string;
    onClick: () => void;
}>;

function PlayerButton({
    children,
    className = '',
    disabled = false,
    icon,
    isActive = false,
    label,
    onClick
}: PlayerButtonProps) {
    return (
        <button
            type='button'
            className={`ptv-music-control ${isActive ? 'ptv-music-control-active' : ''} ${className}`.trim()}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
        >
            {icon ? <PtvIcon name={icon} /> : null}
            {children ? <span>{children}</span> : null}
        </button>
    );
}

type QueueDrawerProps = Readonly<{
    isOpen: boolean;
    onClose: () => void;
    snapshot: PtvMusicQueueSnapshot;
}>;

function QueueDrawer({ isOpen, onClose, snapshot }: QueueDrawerProps) {
    const [playlistName, setPlaylistName] = useState('PiggieTV Queue');
    const [status, setStatus] = useState('');

    const onSave = (event: FormEvent) => {
        event.preventDefault();
        setStatus('Saving...');
        recordPtvEvent('render', 'playlist-save-clicked', {
            source: 'queue-drawer'
        });

        void savePtvMusicQueueAsPlaylist(playlistName)
            .then(() => {
                setStatus('Saved');
                recordPtvEvent('render', 'playlist-save-success', {
                    source: 'queue-drawer'
                });
            })
            .catch(error => {
                setStatus(error instanceof Error ? error.message : 'Could not save queue');
                recordPtvEvent('render', 'playlist-save-failed', {
                    error: error instanceof Error ? error.message : String(error),
                    source: 'queue-drawer'
                });
                recordPtvEvent('render', 'music-playback-error', {
                    error: error instanceof Error ? error.message : String(error),
                    stage: 'save-queue'
                });
            });
    };

    return (
        <aside
            className={`ptv-music-queue-drawer ${isOpen ? 'ptv-music-queue-drawer-open' : ''}`}
            aria-hidden={!isOpen}
            aria-label='Music queue'
        >
            <div className='ptv-music-queue-header'>
                <div>
                    <p className='ptv-music-kicker'>Queue</p>
                    <h2>{snapshot.playlist.length} tracks</h2>
                </div>
                <button type='button' className='ptv-music-icon-button' aria-label='Close queue' onClick={onClose}>
                    <PtvIcon name='back' />
                </button>
            </div>

            <div className='ptv-music-queue-actions'>
                <button type='button' onClick={() => void clearPtvMusicQueue()}>Clear</button>
                <form onSubmit={onSave}>
                    <input
                        aria-label='Playlist name'
                        value={playlistName}
                        onChange={event => setPlaylistName(event.target.value)}
                    />
                    <button type='submit'>Save</button>
                </form>
                {status ? <p aria-live='polite'>{status}</p> : null}
            </div>

            <ol className='ptv-music-queue-list'>
                {snapshot.playlist.map((item, index) => (
                    <QueueItem
                        key={getMusicQueueItemKey(item)}
                        currentIndex={snapshot.currentIndex}
                        index={index}
                        item={item}
                        total={snapshot.playlist.length}
                    />
                ))}
            </ol>
        </aside>
    );
}

type QueueItemProps = Readonly<{
    currentIndex: number;
    index: number;
    item: PtvMusicQueueItem;
    total: number;
}>;

function QueueItem({ currentIndex, index, item, total }: QueueItemProps) {
    const playlistItemId = item.PlaylistItemId || item.Id || '';
    const isCurrent = index === currentIndex;

    return (
        <li className={`ptv-music-queue-item ${isCurrent ? 'ptv-music-queue-item-current' : ''}`}>
            <img
                alt=''
                decoding='async'
                loading='lazy'
                src={getMusicImageUrl(item, 96)}
                onError={event => {
                    event.currentTarget.src = getMusicImagePlaceholder();
                }}
            />
            <div>
                <strong>{getPtvMusicTitle(item)}</strong>
                <span>{getPtvMusicArtist(item)}</span>
            </div>
            <div className='ptv-music-queue-item-actions'>
                <button
                    type='button'
                    aria-label='Move up'
                    disabled={index === 0}
                    onClick={() => void movePtvMusicQueueItem(playlistItemId, index - 1)}
                >
                    <PtvIcon name='skipPrevious' />
                </button>
                <button
                    type='button'
                    aria-label='Move down'
                    disabled={index >= total - 1}
                    onClick={() => void movePtvMusicQueueItem(playlistItemId, index + 1)}
                >
                    <PtvIcon name='skipNext' />
                </button>
                <button
                    type='button'
                    aria-label='Remove from queue'
                    onClick={() => void removePtvMusicQueueItem(playlistItemId)}
                >
                    <PtvIcon name='delete' />
                </button>
            </div>
        </li>
    );
}

function PlayerArtistLinks({ item }: Readonly<{ item: PtvMusicItem }>) {
    const artistRefs = getMusicArtistRefs(item);

    if (!artistRefs.length) {
        return <span>{getPtvMusicArtist(item)}</span>;
    }

    return (
        <span className='ptv-music-player-meta-links'>
            {artistRefs.map((artist, index) => {
                const href = getArtistHref(artist);
                const label = artist.Name || getPtvMusicArtist(item);

                return (
                    <React.Fragment key={artist.Id || artist.Name || index}>
                        {index > 0 ? <span>, </span> : null}
                        {href ? (
                            <a className='ptv-music-player-meta-link' href={href}>{label}</a>
                        ) : (
                            <span>{label}</span>
                        )}
                    </React.Fragment>
                );
            })}
        </span>
    );
}

function PlayerAlbumLink({ item }: Readonly<{ item: PtvMusicItem }>) {
    const album = getPtvMusicAlbum(item);
    const href = getAlbumHref(item);

    if (!album) return null;
    if (!href) return <span className='ptv-music-kicker'>{album}</span>;

    return (
        <a className='ptv-music-kicker ptv-music-player-meta-link' href={href}>
            {album}
        </a>
    );
}

type RelatedSongCardProps = Readonly<{
    index: number;
    items: PtvMusicItem[];
    item: PtvMusicItem;
}>;

function RelatedSongCard({ index, items, item }: RelatedSongCardProps) {
    const title = getPtvMusicTitle(item);
    const meta = [getPtvMusicArtist(item), getPtvMusicAlbum(item)].filter(Boolean).join(' - ');

    const playItem = () => {
        void playPtvMusicTracks(items, index, {
            preserveVirtualQueue: true
        });
    };

    return (
        <article className='ptv-music-related-song-card'>
            <button type='button' aria-label={`Play ${title}`} onClick={playItem}>
                <span className='ptv-music-player-song-play'>
                    <PtvIcon name='play' />
                </span>
                <img
                    alt=''
                    decoding='async'
                    loading='lazy'
                    src={getMusicImageUrl(item, 112)}
                    onError={event => {
                        event.currentTarget.src = getMusicImagePlaceholder();
                    }}
                />
                <span className='ptv-music-player-song-copy'>
                    <strong>{title}</strong>
                    <em>{meta}</em>
                </span>
            </button>
        </article>
    );
}

type FullscreenPlayerProps = Readonly<{
    lyrics: PtvMusicLyricLine[];
    onClose: () => void;
    onPlaylistOpen: () => void;
    onQueueOpen: () => void;
    snapshot: PtvMusicQueueSnapshot;
}>;

type FullscreenVolumeControlProps = Readonly<{
    isMuted: boolean;
    volumeLevel: number;
}>;

function FullscreenVolumeControl({ isMuted, volumeLevel }: FullscreenVolumeControlProps) {
    return (
        <div
            className='ptv-music-fullscreen-volume'
            style={{ '--ptv-music-volume': `${isMuted ? 0 : volumeLevel}%` } as React.CSSProperties}
        >
            <button
                type='button'
                className={isMuted ? 'ptv-music-volume-muted' : ''}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
                title={isMuted ? 'Unmute' : 'Mute'}
                onClick={() => togglePtvMusicMute()}
            >
                <PtvIcon name='volume' />
            </button>
            <input
                type='range'
                min={0}
                max={100}
                value={volumeLevel}
                aria-label='Volume'
                onChange={event => setPtvMusicVolume(Number(event.target.value))}
            />
            <span>{isMuted ? 'Muted' : `${volumeLevel}%`}</span>
        </div>
    );
}

type FullscreenLyricsPanelProps = Readonly<{
    lyrics: PtvMusicLyricLine[];
    positionTicks: number;
    runtimeTicks: number;
}>;

function FullscreenLyricsPanel({ lyrics, positionTicks, runtimeTicks }: FullscreenLyricsPanelProps) {
    const activeLyricRef = useRef<HTMLParagraphElement | null>(null);
    const lyricsScrollRef = useRef<HTMLDivElement | null>(null);
    const activeLyricIndex = useMemo(
        () => getActiveLyricIndex(lyrics, positionTicks, runtimeTicks),
        [lyrics, positionTicks, runtimeTicks]
    );

    useEffect(() => {
        const container = lyricsScrollRef.current;
        const activeLine = activeLyricRef.current;

        if (!container || !activeLine || activeLyricIndex < 0) return;

        const nextTop = Math.max(
            0,
            activeLine.offsetTop - (container.clientHeight / 2) + (activeLine.offsetHeight / 2)
        );

        container.scrollTo({
            behavior: 'smooth',
            top: nextTop
        });
    }, [activeLyricIndex, lyrics.length]);

    return (
        <div className='ptv-music-lyrics-panel'>
            <div className='ptv-music-lyrics-heading'>
                <p className='ptv-music-kicker'>Lyrics</p>
            </div>
            {lyrics.length ? (
                <div ref={lyricsScrollRef} className='ptv-music-lyrics-lines'>
                    {lyrics.map((line, index) => (
                        <p
                            key={`${line.Start || 0}-${line.Text || ''}`}
                            ref={activeLyricIndex === index ? activeLyricRef : null}
                            className={activeLyricIndex === index ? 'ptv-music-lyric-active' : ''}
                        >
                            {line.Text}
                        </p>
                    ))}
                </div>
            ) : (
                <p className='ptv-music-empty'>No lyrics metadata</p>
            )}
        </div>
    );
}

function FullscreenPlayer({
    lyrics,
    onClose,
    onPlaylistOpen,
    onQueueOpen,
    snapshot
}: FullscreenPlayerProps) {
    const item = snapshot.currentItem;
    const progress = getProgressPercent(snapshot);
    const { isLiked, toggleLiked } = useLikedMusicItem(item, 'favorite');
    const { isRelatedLoading, relatedItems } = useRelatedMusicTracks(snapshot);

    useEffect(() => {
        recordPtvEvent('render', 'music-player-mounted', {
            itemId: item?.Id || null
        });
    }, [item?.Id]);

    if (!item) return null;

    return (
        <section className='ptv-music-fullscreen' aria-label='Music player'>
            <div className='ptv-music-fullscreen-bg'>
                <img
                    alt=''
                    decoding='async'
                    loading='eager'
                    src={getMusicImageUrl(item, 700, 'Backdrop')}
                    onError={event => {
                        event.currentTarget.src = getMusicImagePlaceholder();
                    }}
                />
            </div>
            <div className='ptv-music-fullscreen-topbar'>
                <button type='button' className='ptv-music-icon-button' aria-label='Collapse player' onClick={onClose}>
                    <PtvIcon name='back' />
                </button>
                <p className='ptv-music-kicker'>{getPtvMusicCodec(item).toUpperCase() || 'AUDIO'}</p>
                <button type='button' className='ptv-music-icon-button' aria-label='Open queue' onClick={onQueueOpen}>
                    <PtvIcon name='playlists' />
                </button>
            </div>

            <div className='ptv-music-fullscreen-main'>
                <img
                    className='ptv-music-fullscreen-art'
                    alt=''
                    decoding='async'
                    loading='eager'
                    src={getMusicImageUrl(item, 700)}
                    onError={event => {
                        event.currentTarget.src = getMusicImagePlaceholder();
                    }}
                />

                <div className='ptv-music-fullscreen-info'>
                    <PlayerAlbumLink item={item} />
                    <h1>{getPtvMusicTitle(item)}</h1>
                    <p><PlayerArtistLinks item={item} /></p>

                    <div
                        className='ptv-music-progress-block'
                        style={{ '--ptv-music-progress': `${progress}%` } as React.CSSProperties}
                    >
                        <input
                            type='range'
                            min={0}
                            max={100}
                            step={0.1}
                            value={progress}
                            aria-label='Seek'
                            onPointerDown={event => seekPtvMusicFromClientX(event.clientX, event.currentTarget)}
                            onChange={event => seekPtvMusicPercent(Number(event.target.value))}
                        />
                        <div className='ptv-music-time-row'>
                            <span>{formatTicks(snapshot.positionTicks)}</span>
                            <span>{formatTicks(snapshot.runtimeTicks)}</span>
                        </div>
                    </div>

                    <div className='ptv-music-player-controls'>
                        <PlayerButton
                            icon='shuffle'
                            isActive={snapshot.isShuffled}
                            label='Shuffle'
                            onClick={() => togglePtvMusicShuffle()}
                        />
                        <PlayerButton icon='skipPrevious' label='Previous' onClick={() => void previousPtvMusicTrack()} />
                        <PlayerButton
                            icon='favorite'
                            isActive={isLiked}
                            label={isLiked ? 'Remove from Liked Songs' : 'Like song'}
                            onClick={toggleLiked}
                        />
                        <PlayerButton
                            className='ptv-music-control-primary'
                            icon={snapshot.isPlaying ? 'pause' : 'play'}
                            label={snapshot.isPlaying ? 'Pause' : 'Play'}
                            onClick={() => void togglePtvMusicPlayPause()}
                        />
                        <PlayerButton icon='skipNext' label='Next' onClick={() => void nextPtvMusicTrack()} />
                        <PlayerButton
                            icon='refresh'
                            isActive={snapshot.repeatMode !== 'RepeatNone'}
                            label={getRepeatLabel(snapshot.repeatMode)}
                            onClick={() => setPtvMusicRepeatMode(getNextRepeatMode(snapshot.repeatMode))}
                        >
                            {snapshot.repeatMode === 'RepeatOne' ? '1' : null}
                        </PlayerButton>
                        <PlayerButton
                            className='ptv-music-control-add'
                            label='Add to playlist'
                            onClick={onPlaylistOpen}
                        >
                            +
                        </PlayerButton>
                    </div>

                    <FullscreenVolumeControl isMuted={snapshot.isMuted} volumeLevel={snapshot.volumeLevel} />
                </div>

                <FullscreenLyricsPanel
                    lyrics={lyrics}
                    positionTicks={snapshot.positionTicks}
                    runtimeTicks={snapshot.runtimeTicks}
                />
            </div>

            <section className='ptv-music-fullscreen-related' aria-label='Related songs'>
                <div className='ptv-music-fullscreen-related-heading'>
                    <div>
                        <p className='ptv-music-kicker'>Related songs</p>
                        <h2>More like this</h2>
                    </div>
                    {isRelatedLoading ? <span>Finding matches...</span> : <span>{relatedItems.length} songs</span>}
                </div>
                {isRelatedLoading && !relatedItems.length ? (
                    <p className='ptv-music-empty'>Finding related tracks...</p>
                ) : null}
                {!isRelatedLoading && !relatedItems.length ? (
                    <p className='ptv-music-empty'>No related tracks matched this song yet.</p>
                ) : null}
                {relatedItems.length ? (
                    <div className='ptv-music-related-song-row'>
                        {relatedItems.map((relatedItem, index) => (
                            <RelatedSongCard
                                key={`${relatedItem.Id || relatedItem.Name || index}-related`}
                                index={index}
                                item={relatedItem}
                                items={relatedItems}
                            />
                        ))}
                    </div>
                ) : null}
            </section>
        </section>
    );
}

export function PtvMusicPlayerDock() {
    const snapshot = useMusicQueueSnapshot();
    const [isExpanded, setExpanded] = useState(false);
    const [isMusicRoute, setMusicRoute] = useState(() => isPtvMusicRouteHash());
    const [isQueueOpen, setQueueOpen] = useState(false);
    const [isPlaylistModalOpen, setPlaylistModalOpen] = useState(false);
    const item = snapshot.currentItem;
    const lyrics = useLyrics(item);
    const progress = useMemo(() => getProgressPercent(snapshot), [snapshot]);
    const { isLiked, toggleLiked } = useLikedMusicItem(item, 'mini-favorite');

    useEffect(() => {
        const syncMusicRouteState = () => {
            const nextIsMusicRoute = isPtvMusicRouteHash();

            setMusicRoute(nextIsMusicRoute);

            if (!nextIsMusicRoute) {
                setExpanded(false);
                setQueueOpen(false);
                setPlaylistModalOpen(false);
            }
        };

        syncMusicRouteState();
        window.addEventListener('hashchange', syncMusicRouteState);
        window.addEventListener('popstate', syncMusicRouteState);

        return () => {
            window.removeEventListener('hashchange', syncMusicRouteState);
            window.removeEventListener('popstate', syncMusicRouteState);
        };
    }, []);

    useEffect(() => {
        document.documentElement.classList.toggle('ptv-music-active', Boolean(item));
        document.body.classList.toggle('ptv-music-active', Boolean(item));

        return () => {
            document.documentElement.classList.remove('ptv-music-active');
            document.body.classList.remove('ptv-music-active');
        };
    }, [item]);

    useEffect(() => {
        const syncPlayerRoute = () => {
            const shouldExpand = window.location.hash === '#/music/player';

            if (shouldExpand && item) {
                setExpanded(true);
                recordPtvEvent('render', 'music-player-opened', {
                    itemId: item.Id || null,
                    source: 'route'
                });
                return;
            }

            if (!shouldExpand) {
                setExpanded(false);
            }
        };

        syncPlayerRoute();
        window.addEventListener('hashchange', syncPlayerRoute);
        window.addEventListener('popstate', syncPlayerRoute);

        return () => {
            window.removeEventListener('hashchange', syncPlayerRoute);
            window.removeEventListener('popstate', syncPlayerRoute);
        };
    }, [item]);

    if (!item) return null;

    const openNowPlaying = () => {
        openPtvMusicPlayer('mini-player');
    };

    const closeExpandedPlayer = () => {
        setExpanded(false);
        recordPtvEvent('render', 'music-player-closed', {
            itemId: item.Id || null
        });

        if (window.location.hash === '#/music/player') {
            window.location.hash = '#/music';
        }
    };

    return (
        <>
            {isMusicRoute ? <div className='ptv-music-mini-player' data-ptv-music-player='mini'>
                <button
                    type='button'
                    className='ptv-music-mini-progress'
                    aria-label='Seek track'
                    style={{ '--ptv-music-progress': `${progress}%` } as React.CSSProperties}
                    onPointerDown={event => seekPtvMusicFromClientX(event.clientX, event.currentTarget)}
                >
                    <span />
                </button>

                <button
                    type='button'
                    className='ptv-music-mini-now-playing'
                    onClick={openNowPlaying}
                    aria-label='Open now playing'
                >
                    <img
                        alt=''
                        decoding='async'
                        loading='lazy'
                        src={getMusicImageUrl(item, 120)}
                        onError={event => {
                            event.currentTarget.src = getMusicImagePlaceholder();
                        }}
                    />
                    <span>
                        <strong>{getPtvMusicTitle(item)}</strong>
                        <em>{getPtvMusicArtist(item)} - {getPtvMusicAlbum(item)}</em>
                    </span>
                </button>

                <div className='ptv-music-mini-transport'>
                    <PlayerButton icon='skipPrevious' label='Previous' onClick={() => void previousPtvMusicTrack()} />
                    <PlayerButton
                        className='ptv-music-control-primary'
                        icon={snapshot.isPlaying ? 'pause' : 'play'}
                        label={snapshot.isPlaying ? 'Pause' : 'Play'}
                        onClick={() => void togglePtvMusicPlayPause()}
                    />
                    <PlayerButton icon='skipNext' label='Next' onClick={() => void nextPtvMusicTrack()} />
                    <div className='ptv-music-mini-time'>
                        <span>{formatTicks(snapshot.positionTicks)}</span>
                        <span>{formatTicks(snapshot.runtimeTicks)}</span>
                    </div>
                </div>

                <div className='ptv-music-mini-controls'>
                    <PlayerButton
                        icon='favorite'
                        isActive={isLiked}
                        label={isLiked ? 'Remove from Liked Songs' : 'Like song'}
                        onClick={toggleLiked}
                    />
                    <PlayerButton className='ptv-music-control-add' label='Add to playlist' onClick={() => setPlaylistModalOpen(true)}>
                        +
                    </PlayerButton>
                    <PlayerButton icon='shuffle' isActive={snapshot.isShuffled} label='Shuffle' onClick={() => togglePtvMusicShuffle()} />
                    <PlayerButton
                        icon='refresh'
                        isActive={snapshot.repeatMode !== 'RepeatNone'}
                        label={getRepeatLabel(snapshot.repeatMode)}
                        onClick={() => setPtvMusicRepeatMode(getNextRepeatMode(snapshot.repeatMode))}
                    >
                        {snapshot.repeatMode === 'RepeatOne' ? '1' : null}
                    </PlayerButton>
                    <PlayerButton icon='playlists' label='Queue' onClick={() => setQueueOpen(true)} />
                    <div className='ptv-music-mini-volume'>
                        <button type='button' aria-label='Mute' onClick={() => togglePtvMusicMute()}>
                            <PtvIcon name='volume' />
                        </button>
                        <input
                            type='range'
                            min={0}
                            max={100}
                            value={snapshot.volumeLevel}
                            aria-label='Volume'
                            onChange={event => setPtvMusicVolume(Number(event.target.value))}
                        />
                    </div>
                    <PlayerButton icon='fullscreen' label='Full screen player' onClick={() => openPtvMusicPlayer('mini-fullscreen-button')} />
                </div>
            </div> : null}

            {isExpanded ? (
                <FullscreenPlayer
                    lyrics={lyrics}
                    onClose={closeExpandedPlayer}
                    onPlaylistOpen={() => setPlaylistModalOpen(true)}
                    onQueueOpen={() => setQueueOpen(true)}
                    snapshot={snapshot}
                />
            ) : null}

            <QueueDrawer
                isOpen={isQueueOpen}
                onClose={() => setQueueOpen(false)}
                snapshot={snapshot}
            />
            <PtvMusicPlaylistModal
                isOpen={isPlaylistModalOpen}
                item={item}
                onClose={() => setPlaylistModalOpen(false)}
            />
        </>
    );
}

export default PtvMusicPlayerDock;

/* eslint-enable react/jsx-no-bind, no-void */
