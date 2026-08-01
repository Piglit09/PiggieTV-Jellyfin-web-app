import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    addToQueue: vi.fn(),
    generatePlaylist: vi.fn(),
    playNext: vi.fn(),
    playTracks: vi.fn()
}));

vi.mock('./musicQueue', () => ({
    addPtvMusicToQueue: mocks.addToQueue,
    playPtvMusicNext: mocks.playNext,
    playPtvMusicTracks: mocks.playTracks
}));

vi.mock('./musicPlaylists', () => ({
    generatePtvMusicPlaylist: mocks.generatePlaylist
}));

import {
    dispatchPtvMusicSearchAction,
    getPtvMusicSearchActionCommands,
    getPtvMusicSearchActionMenuExtension,
    PTV_MUSIC_SEARCH_ACTION_IDS
} from './musicSearchItemActions';

const audioItem = {
    Id: 'track-1',
    MediaType: 'Audio',
    Name: 'Track One',
    Type: 'Audio'
};

describe('Music-aware Search item actions', () => {
    beforeEach(() => {
        mocks.addToQueue.mockReset().mockResolvedValue({});
        mocks.generatePlaylist.mockReset().mockResolvedValue({
            items: [audioItem],
            name: 'Track One Mix',
            seed: {
                kind: 'song'
            }
        });
        mocks.playNext.mockReset().mockResolvedValue({});
        mocks.playTracks.mockReset().mockResolvedValue(undefined);
    });

    it('replaces stock playback commands with the four PTV commands for audio', () => {
        const extension = getPtvMusicSearchActionMenuExtension(audioItem);

        expect(extension).toMatchObject({
            instantMix: false,
            play: false,
            queue: false,
            shuffle: false
        });
        expect(extension?.extraCommands.map(command => command.id)).toEqual([
            PTV_MUSIC_SEARCH_ACTION_IDS.play,
            PTV_MUSIC_SEARCH_ACTION_IDS.playNext,
            PTV_MUSIC_SEARCH_ACTION_IDS.addToQueue,
            PTV_MUSIC_SEARCH_ACTION_IDS.startMix
        ]);
    });

    it.each([
        ['MusicAlbum', 'album-1'],
        ['MusicArtist', 'artist-1'],
        ['MusicGenre', 'genre-1']
    ])('offers only Start Mix for %s results', (type, id) => {
        expect(getPtvMusicSearchActionCommands({
            Id: id,
            Name: type,
            Type: type
        }).map(command => command.id)).toEqual([
            PTV_MUSIC_SEARCH_ACTION_IDS.startMix
        ]);
    });

    it('leaves non-Music results unchanged', async () => {
        const movie = {
            Id: 'movie-1',
            MediaType: 'Video',
            Name: 'Movie One',
            Type: 'Movie'
        };
        const audioBook = {
            Id: 'book-1',
            MediaType: 'Audio',
            Name: 'Audio Book One',
            Type: 'Book'
        };

        expect(getPtvMusicSearchActionMenuExtension(movie)).toBeUndefined();
        expect(getPtvMusicSearchActionMenuExtension(audioBook)).toBeUndefined();
        await expect(dispatchPtvMusicSearchAction(
            PTV_MUSIC_SEARCH_ACTION_IDS.play,
            movie
        )).rejects.toThrow('Unsupported PiggieTV Music search action.');
        expect(mocks.playTracks).not.toHaveBeenCalled();
    });

    it('dispatches Play, Play Next, and Add to Queue to the existing queue owner', async () => {
        await dispatchPtvMusicSearchAction(PTV_MUSIC_SEARCH_ACTION_IDS.play, audioItem);
        await dispatchPtvMusicSearchAction(PTV_MUSIC_SEARCH_ACTION_IDS.playNext, audioItem);
        await dispatchPtvMusicSearchAction(PTV_MUSIC_SEARCH_ACTION_IDS.addToQueue, audioItem);

        expect(mocks.playTracks).toHaveBeenCalledWith([audioItem], 0, {
            rejectOnPlaybackError: true
        });
        expect(mocks.playNext).toHaveBeenCalledWith(audioItem);
        expect(mocks.addToQueue).toHaveBeenCalledWith(audioItem);
    });

    it('dispatches Start Mix through the existing generator and queue owner', async () => {
        const artist = {
            Id: 'artist-1',
            Name: 'Artist One',
            Type: 'MusicArtist'
        };

        await dispatchPtvMusicSearchAction(PTV_MUSIC_SEARCH_ACTION_IDS.startMix, artist);

        expect(mocks.generatePlaylist).toHaveBeenCalledWith({
            seed: {
                id: 'artist-1',
                item: artist,
                kind: 'artist',
                label: 'Artist One',
                value: 'Artist One'
            }
        });
        expect(mocks.playTracks).toHaveBeenCalledWith([audioItem], 0, {
            rejectOnPlaybackError: true
        });
    });
});
