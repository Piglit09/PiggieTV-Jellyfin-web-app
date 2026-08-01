import { describe, expect, it } from 'vitest';

import type { PtvMusicItem } from './musicTypes';
import { buildPtvCollectionMixSeed } from './musicMixSeed';

const album: PtvMusicItem = {
    Id: 'album',
    Name: 'Album',
    Type: 'MusicAlbum'
};
const playlist: PtvMusicItem = {
    Id: 'playlist',
    Name: 'Playlist',
    Type: 'Playlist'
};
const track: PtvMusicItem = {
    Id: 'track',
    Name: 'Track',
    Type: 'Audio'
};

describe('PiggieTV collection mix seeds', () => {
    it('keeps an Album Mix anchored to its album', () => {
        expect(buildPtvCollectionMixSeed(album, 'album', 'Album', [track])).toMatchObject({
            id: 'album',
            item: album,
            kind: 'album',
            label: 'Album'
        });
    });

    it('anchors a Playlist Mix to its first available track instead of random discovery', () => {
        expect(buildPtvCollectionMixSeed(playlist, 'playlist', 'Playlist', [track])).toMatchObject({
            id: 'track',
            item: track,
            kind: 'song',
            label: 'Playlist',
            value: 'Track'
        });
    });

    it('uses a bounded discovery fallback only for an empty playlist', () => {
        expect(buildPtvCollectionMixSeed(playlist, 'playlist', 'Playlist', [])).toMatchObject({
            id: 'playlist',
            kind: 'random',
            label: 'Playlist'
        });
    });
});
