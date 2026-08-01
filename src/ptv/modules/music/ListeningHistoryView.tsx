import React, { useCallback, useMemo, useState } from 'react';

import {
    getPtvCurrentUserId,
    getPtvServerId
} from '../../api';
import { PtvIcon } from '../icons';
import {
    clearPtvMusicRecentTracks,
    removePtvMusicRecentTrack
} from './musicContinuity';
import type { PtvMusicItem } from './musicTypes';

export type MusicContinuityHistoryEntry = Readonly<{
    completed: boolean;
    item: PtvMusicItem;
    lastPlayedAt: number;
    positionTicks: number;
    runtimeTicks: number;
}>;

type ListeningHistoryViewProps = Readonly<{
    history: MusicContinuityHistoryEntry[];
    isBusy: boolean;
    onPlay: (entry: MusicContinuityHistoryEntry) => void;
}>;

type HistoryFilter = 'albums' | 'artists' | 'tracks';

function getMusicTitle(item: PtvMusicItem) {
    return String(item.Name || item.SortName || 'Track');
}

function getMusicArtist(item: PtvMusicItem) {
    return String(item.Artist || item.AlbumArtist || item.ArtistItems?.[0]?.Name || 'Unknown artist');
}

function formatRelativeListeningTime(timestamp: number) {
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));

    if (elapsedMinutes < 1) return 'Just now';
    if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

    const elapsedHours = Math.floor(elapsedMinutes / 60);

    if (elapsedHours < 24) return `${elapsedHours}h ago`;

    return `${Math.floor(elapsedHours / 24)}d ago`;
}

function buildHistoryEntries(history: MusicContinuityHistoryEntry[], filter: HistoryFilter) {
    if (filter === 'tracks') {
        return history.map(entry => ({
            entry,
            href: '',
            id: entry.item.Id,
            subtitle: getMusicArtist(entry.item),
            title: getMusicTitle(entry.item)
        }));
    }

    const seen = new Set<string>();

    return history.reduce<Array<{
        entry: MusicContinuityHistoryEntry;
        href: string;
        id: string;
        subtitle: string;
        title: string;
    }>>((entries, entry) => {
        const artist = entry.item.ArtistItems?.find(candidate => candidate.Id);
        const id = filter === 'albums' ? entry.item.AlbumId || '' : artist?.Id || '';

        if (!id || seen.has(id)) return entries;

        seen.add(id);
        entries.push({
            entry,
            href: filter === 'albums' ?
                `#/music/album/${encodeURIComponent(id)}` :
                `#/music/artist/${encodeURIComponent(id)}`,
            id,
            subtitle: filter === 'albums' ? getMusicArtist(entry.item) : 'Artist',
            title: filter === 'albums' ?
                String(entry.item.Album || 'Album') :
                String(artist?.Name || getMusicArtist(entry.item))
        });

        return entries;
    }, []);
}

export default function ListeningHistoryView({
    history,
    isBusy,
    onPlay
}: ListeningHistoryViewProps) {
    const [filter, setFilter] = useState<HistoryFilter>('tracks');
    const serverId = getPtvServerId();
    const userId = getPtvCurrentUserId(serverId);
    const derivedEntries = useMemo(
        () => buildHistoryEntries(history, filter),
        [filter, history]
    );
    const onHistoryFilterClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        const nextFilter = event.currentTarget.dataset.filter as HistoryFilter | undefined;

        if (nextFilter) setFilter(nextFilter);
    }, []);
    const onClearHistory = useCallback(() => {
        clearPtvMusicRecentTracks({ serverId, userId });
    }, [serverId, userId]);
    const onHistoryPlayClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        const itemId = event.currentTarget.dataset.itemId;
        const entry = history.find(candidate => candidate.item.Id === itemId);

        if (entry) onPlay(entry);
    }, [history, onPlay]);
    const onHistoryRemoveClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        removePtvMusicRecentTrack({ serverId, userId }, event.currentTarget.dataset.itemId || '');
    }, [serverId, userId]);

    return (
        <div className='ptv-music-view ptv-music-history-view'>
            <section className='ptv-music-library-hero'>
                <p className='ptv-music-kicker'>Your activity</p>
                <h1>Listening History</h1>
                <div>
                    <span>{history.length} recent tracks</span>
                    <span>Stored only for this server and user</span>
                </div>
            </section>
            <div className='ptv-music-history-controls'>
                <div role='group' aria-label='History type'>
                    {(['tracks', 'albums', 'artists'] as const).map(value => (
                        <button
                            key={value}
                            aria-pressed={filter === value}
                            data-filter={value}
                            type='button'
                            onClick={onHistoryFilterClick}
                        >
                            {value.charAt(0).toUpperCase() + value.slice(1)}
                        </button>
                    ))}
                </div>
                <button
                    type='button'
                    disabled={!history.length}
                    onClick={onClearHistory}
                >
                    Clear history
                </button>
            </div>
            {!derivedEntries.length ? (
                <section className='ptv-music-empty-state'>
                    <PtvIcon name='activity' />
                    <h2>No recent {filter}</h2>
                    <p>Meaningful listening appears here after a few seconds.</p>
                </section>
            ) : (
                <ol className='ptv-music-history-list'>
                    {derivedEntries.map(({ entry, href, id, subtitle, title }) => (
                        <li key={`${filter}-${id}`}>
                            <div>
                                <strong>{title}</strong>
                                <span>{subtitle} · {formatRelativeListeningTime(entry.lastPlayedAt)}</span>
                            </div>
                            <span>
                                {filter === 'tracks' ? (
                                    <button
                                        type='button'
                                        data-item-id={entry.item.Id}
                                        disabled={isBusy}
                                        onClick={onHistoryPlayClick}
                                    >
                                        <PtvIcon name={entry.positionTicks && !entry.completed ? 'resume' : 'play'} />
                                        <span>{entry.positionTicks && !entry.completed ? 'Resume' : 'Play'}</span>
                                    </button>
                                ) : <a href={href}>Open</a>}
                                <button
                                    type='button'
                                    aria-label={`Remove ${title} from listening history`}
                                    data-item-id={entry.item.Id}
                                    onClick={onHistoryRemoveClick}
                                >
                                    <PtvIcon name='delete' />
                                </button>
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}
