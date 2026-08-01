import React, { useCallback, useMemo } from 'react';

import { PtvIcon } from '../icons';
import {
    getPtvMusicGenres,
    uniquePtvMusicItems
} from './musicApi';
import type {
    PtvMusicHomeData,
    PtvMusicItem
} from './musicTypes';

type MusicGenresViewProps = Readonly<{
    activeSourceButton: string;
    homeData: PtvMusicHomeData;
    isBusy: boolean;
    onStartMix: (genre: string) => void;
    tracks: PtvMusicItem[];
}>;

function getHomeMusicTracks(homeData: PtvMusicHomeData) {
    return homeData.sections
        .flatMap(section => section.items)
        .filter(item => item.Type === 'Audio' || item.MediaType === 'Audio');
}

export default function MusicGenresView({
    activeSourceButton,
    homeData,
    isBusy,
    onStartMix,
    tracks
}: MusicGenresViewProps) {
    const genreRows = useMemo(() => {
        const counts = new Map<string, number>();

        uniquePtvMusicItems([
            ...tracks,
            ...getHomeMusicTracks(homeData)
        ]).forEach(track => {
            getPtvMusicGenres(track).forEach(genre => {
                const normalizedGenre = genre.trim();

                if (normalizedGenre) {
                    counts.set(normalizedGenre, (counts.get(normalizedGenre) || 0) + 1);
                }
            });
        });

        return Array.from(counts)
            .map(([name, count]) => ({ count, name }))
            .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
    }, [homeData, tracks]);
    const onGenreMixClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        const genre = event.currentTarget.dataset.genre;

        if (genre) onStartMix(genre);
    }, [onStartMix]);

    return (
        <div className='ptv-music-view ptv-music-genres-view'>
            <section className='ptv-music-library-hero'>
                <p className='ptv-music-kicker'>Discovery</p>
                <h1>Genres</h1>
                <div>
                    <span>{genreRows.length} genres in your library</span>
                    <span>Mixes favor variety and less-recently-played tracks</span>
                </div>
            </section>
            {!genreRows.length ? (
                <section className='ptv-music-empty-state'>
                    <PtvIcon name='music' />
                    <h2>No genre metadata found</h2>
                    <p>Genre mixes appear after your library index is available.</p>
                </section>
            ) : (
                <section className='ptv-music-genre-grid' aria-label='Music genres'>
                    {genreRows.map(({ count, name }) => (
                        <article key={name}>
                            <div>
                                <strong>{name}</strong>
                                <span>{count} {count === 1 ? 'track' : 'tracks'}</span>
                            </div>
                            <button
                                type='button'
                                data-genre={name}
                                disabled={isBusy}
                                onClick={onGenreMixClick}
                            >
                                <PtvIcon name='shuffle' />
                                {activeSourceButton === `genre-mix-${name}` ? (
                                    <span className='ptv-music-action-spinner' aria-hidden='true' />
                                ) : null}
                                <span>Start Mix</span>
                            </button>
                        </article>
                    ))}
                </section>
            )}
        </div>
    );
}
