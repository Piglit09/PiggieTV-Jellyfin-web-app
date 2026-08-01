import React, { useEffect, useMemo, useState } from 'react';

import { recordPtvEvent } from '../../core/observability';
import {
    getPtvMusicArtist,
    getPtvMusicTitle,
    uniquePtvMusicItems
} from './musicApi';
import { buildPtvMusicRelatedTracks } from './musicRecommendations';
import type {
    PtvMusicHomeData,
    PtvMusicItem
} from './musicTypes';

const RELATED_ARTIST_ROW_LIMIT = 16;
const RELATED_ARTIST_TRACK_LIMIT = 40;

type ArtistRelatedSectionProps = Readonly<{
    artist: PtvMusicItem;
    children: (items: PtvMusicItem[]) => React.ReactNode;
    homeData: PtvMusicHomeData;
    topSongs: PtvMusicItem[];
}>;

function normalizeMusicLookupName(value: unknown) {
    return String(value || '').trim().toLocaleLowerCase();
}

function splitArtistNames(value: unknown) {
    return String(value || '')
        .split(',')
        .map(artist => artist.trim())
        .filter(Boolean);
}

function buildRelatedArtistsFromTracks(
    seedItem: PtvMusicItem,
    relatedTracks: PtvMusicItem[],
    artistPool: PtvMusicItem[]
) {
    const byId = new Map<string, PtvMusicItem>();
    const byName = new Map<string, PtvMusicItem>();
    const seedArtistId = normalizeMusicLookupName(seedItem.Id);
    const seedArtistName = normalizeMusicLookupName(getPtvMusicTitle(seedItem));
    const seen = new Set<string>();
    const result: PtvMusicItem[] = [];

    uniquePtvMusicItems(artistPool).forEach(artist => {
        const id = normalizeMusicLookupName(artist.Id);
        const name = normalizeMusicLookupName(getPtvMusicTitle(artist));

        if (id) byId.set(id, artist);
        if (name) byName.set(name, artist);
    });

    const addArtist = (artist: PtvMusicItem) => {
        const artistId = normalizeMusicLookupName(artist.Id);
        const artistName = normalizeMusicLookupName(getPtvMusicTitle(artist));
        const dedupeKey = artistId || artistName;

        if (artistId && artistId === seedArtistId) return;
        if (artistName && artistName === seedArtistName) return;
        if (!dedupeKey || seen.has(dedupeKey)) return;

        seen.add(dedupeKey);
        result.push(artist);
    };

    for (const track of relatedTracks) {
        if (result.length >= RELATED_ARTIST_ROW_LIMIT) break;

        (track.ArtistItems || []).forEach(artistRef => {
            if (result.length >= RELATED_ARTIST_ROW_LIMIT) return;

            const artistId = normalizeMusicLookupName(artistRef.Id);
            const artistName = normalizeMusicLookupName(artistRef.Name);
            const knownArtist = byId.get(artistId) || byName.get(artistName);

            if (knownArtist) {
                addArtist(knownArtist);
            } else if (artistRef.Id && artistRef.Name) {
                addArtist({
                    Id: artistRef.Id,
                    Name: artistRef.Name,
                    Type: 'MusicArtist'
                });
            }
        });

        splitArtistNames(getPtvMusicArtist(track)).forEach(artistName => {
            if (result.length >= RELATED_ARTIST_ROW_LIMIT) return;

            const artist = byName.get(normalizeMusicLookupName(artistName));

            if (artist) addArtist(artist);
        });
    }

    return result.slice(0, RELATED_ARTIST_ROW_LIMIT);
}

export default function ArtistRelatedSection({
    artist,
    children,
    homeData,
    topSongs
}: ArtistRelatedSectionProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [relatedArtists, setRelatedArtists] = useState<PtvMusicItem[]>([]);
    const seedItem = topSongs[0] || artist;
    const relatedTrackPool = useMemo(() => uniquePtvMusicItems([
        ...topSongs,
        ...homeData.sections
            .filter(section => section.kind === 'track')
            .flatMap(section => section.items)
    ]), [homeData, topSongs]);
    const artistPool = useMemo(() => uniquePtvMusicItems(homeData.sections
        .filter(section => section.kind === 'artist')
        .flatMap(section => section.items)), [homeData]);

    useEffect(() => {
        let isCurrent = true;
        const timerId = window.setTimeout(() => {
            setIsLoading(true);
            buildPtvMusicRelatedTracks(seedItem, {
                limit: RELATED_ARTIST_TRACK_LIMIT,
                pool: relatedTrackPool
            }).then(relatedTracks => {
                if (!isCurrent) return;

                setRelatedArtists(buildRelatedArtistsFromTracks(seedItem, relatedTracks, artistPool));
            }).catch(error => {
                if (!isCurrent) return;

                recordPtvEvent('render', 'music-related-artists-failed', {
                    artistId: seedItem.Id || null,
                    error: error instanceof Error ? error.message : String(error)
                });
                setRelatedArtists([]);
            }).finally(() => {
                if (isCurrent) setIsLoading(false);
            });
        }, 0);

        return () => {
            isCurrent = false;
            window.clearTimeout(timerId);
        };
    }, [artistPool, relatedTrackPool, seedItem]);

    if (isLoading) return <p className='ptv-music-empty'>Finding related artists...</p>;

    return <>{children(relatedArtists)}</>;
}
