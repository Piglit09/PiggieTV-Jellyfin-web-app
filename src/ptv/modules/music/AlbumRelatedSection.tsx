import React, { useMemo } from 'react';

import {
    getPtvMusicArtist,
    getPtvMusicGenres,
    uniquePtvMusicItems
} from './musicApi';
import type {
    PtvMusicHomeData,
    PtvMusicItem
} from './musicTypes';

type AlbumRelatedSectionProps = Readonly<{
    children: (items: PtvMusicItem[]) => React.ReactNode;
    homeData: PtvMusicHomeData;
    item: PtvMusicItem;
}>;

function getRelatedMusicAlbums(item: PtvMusicItem, homeData: PtvMusicHomeData) {
    const itemArtist = getPtvMusicArtist(item).toLowerCase();
    const itemGenres = new Set(getPtvMusicGenres(item).map(genre => genre.toLowerCase()));

    return uniquePtvMusicItems(homeData.sections
        .flatMap(section => section.items)
        .filter(candidate => candidate.Type === 'MusicAlbum' && candidate.Id !== item.Id)
        .map(candidate => ({
            candidate,
            score: (getPtvMusicArtist(candidate).toLowerCase() === itemArtist ? 20 : 0)
                + (getPtvMusicGenres(candidate).filter(genre => itemGenres.has(genre.toLowerCase())).length * 5)
        }))
        .sort((left, right) => right.score - left.score)
        .map(entry => entry.candidate))
        .slice(0, 16);
}

export default function AlbumRelatedSection({
    children,
    homeData,
    item
}: AlbumRelatedSectionProps) {
    const items = useMemo(
        () => getRelatedMusicAlbums(item, homeData),
        [homeData, item]
    );

    return <>{children(items)}</>;
}
