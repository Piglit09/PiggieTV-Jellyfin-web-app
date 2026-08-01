import { describe, expect, it } from 'vitest';

import { compactPtvMusicHomeSnapshotForStorage } from './musicHomeSnapshot';
import {
    getPtvMusicPageLimit,
    PTV_MUSIC_LIBRARY_RETAIN_LIMIT
} from './musicPaging';
import type { PtvMusicHomeData, PtvMusicItem } from './musicTypes';

describe('getPtvMusicPageLimit', () => {
    it('caps the final request to the remaining item budget', () => {
        expect(getPtvMusicPageLimit(336, 48, 360)).toBe(24);
    });

    it('returns zero when the fetch cap has already been reached', () => {
        expect(getPtvMusicPageLimit(360, 48, 360)).toBe(0);
    });

    it('uses the page size while enough budget remains', () => {
        expect(getPtvMusicPageLimit(0, 48, 360)).toBe(48);
    });

    it('normalizes invalid retained counts without exceeding the page size', () => {
        expect(getPtvMusicPageLimit(-10, 48, 24)).toBe(24);
    });

    it('caps catalog retention at the UI-reachable two pages', () => {
        expect(PTV_MUSIC_LIBRARY_RETAIN_LIMIT).toBe(96);
        expect(getPtvMusicPageLimit(48, 48, PTV_MUSIC_LIBRARY_RETAIN_LIMIT)).toBe(48);
        expect(getPtvMusicPageLimit(96, 48, PTV_MUSIC_LIBRARY_RETAIN_LIMIT)).toBe(0);
    });
});

describe('compactPtvMusicHomeSnapshotForStorage', () => {
    it('keeps render fields while removing full media source payloads', () => {
        const data: PtvMusicHomeData = {
            completeness: 'initial-usable',
            generatedAt: 123,
            isPartial: true,
            library: { id: 'library-1', name: 'Music' },
            nextEligibleRefreshAt: 456,
            refreshReason: 'intentional-initial-home-sections',
            sections: [{
                id: 'songs',
                items: [{
                    Album: 'Album',
                    AlbumId: 'album-1',
                    ArtistItems: [{ Id: 'artist-1', Name: 'Artist' }],
                    Artists: ['Artist'],
                    Id: 'track-1',
                    ImageTags: { Primary: 'tag-1' },
                    MediaSources: [{
                        Bitrate: 980000,
                        Container: 'flac',
                        Id: 'source-1',
                        MediaStreams: [{
                            BitRate: 980000,
                            Channels: 2,
                            Codec: 'flac',
                            SampleRate: 48000,
                            Type: 'Audio'
                        }],
                        Size: 123456789
                    }],
                    MediaStreams: [{
                        BitRate: 980000,
                        Codec: 'flac',
                        Type: 'Audio'
                    }],
                    Name: 'Track',
                    Overview: 'A'.repeat(1000),
                    Path: '/music/track.flac',
                    ProviderIds: { MusicBrainzTrack: 'mb-track' },
                    RunTimeTicks: 123456,
                    Tags: ['one', 'two'],
                    Type: 'Audio',
                    UserData: {
                        IsFavorite: true,
                        PlayCount: 4
                    }
                } as PtvMusicItem],
                kind: 'track',
                title: 'Songs'
            }],
            stats: {
                albumCount: 1,
                artistCount: 1,
                trackCount: 1
            }
        };

        const compacted = compactPtvMusicHomeSnapshotForStorage(data);
        const item = compacted.data.sections[0].items[0];

        expect(compacted.diagnostics.compactSnapshotBytes).toBeLessThan(compacted.diagnostics.rawSnapshotBytes);
        expect(compacted.diagnostics.fieldsRemovedCount).toBeGreaterThan(0);
        expect(item.Id).toBe('track-1');
        expect(item.ImageTags?.Primary).toBe('tag-1');
        expect(item.Container).toBe('flac');
        expect(item.Bitrate).toBe(980000);
        expect(item.MediaSources).toBeUndefined();
        expect((item as PtvMusicItem & { MediaStreams?: unknown }).MediaStreams).toBeUndefined();
        expect(item.Path).toBeUndefined();
        expect(item.ProviderIds).toBeUndefined();
        expect(item.Overview?.length).toBeLessThanOrEqual(260);
    });
});
