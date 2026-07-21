import { describe, expect, it } from 'vitest';

import {
    buildPtvMusicRecommendationShelves,
    createPtvMusicRecommendationEngine
} from './musicRecommendations';

type TestMusicItem = Parameters<typeof buildPtvMusicRecommendationShelves>[0][number];

function musicItem(
    id: string,
    artist: string,
    title: string,
    genres: string[] = []
) {
    return {
        Album: `${artist} album`,
        AlbumArtist: artist,
        AlbumId: `${artist}-album`,
        ArtistItems: [{ Name: artist }],
        Artists: [artist],
        DateCreated: '2026-07-19T00:00:00Z',
        Genres: genres,
        Id: id,
        Name: title,
        Type: 'Audio',
        UserData: {
            IsFavorite: false,
            PlayCount: 0
        }
    } as TestMusicItem;
}

describe('buildPtvMusicRecommendationShelves()', () => {
    it('initializes the engine before it generates shelf data', () => {
        const engine = createPtvMusicRecommendationEngine();

        expect(engine.initialized).toBe(false);

        const shelves = engine.buildShelves(
            [musicItem('seed-1', 'Seed Artist', 'Seed Track')],
            [musicItem('made-1', 'Seed Artist', 'Affinity Track')],
            [musicItem('recommended-1', 'New Artist', 'Discovery Track')]
        );

        expect(engine.initialized).toBe(true);
        expect(shelves.madeForYou.map(item => item.Id)).toEqual(['made-1']);
        expect(shelves.recommended.map(item => item.Id)).toEqual(['recommended-1']);
    });

    it('keeps affinity and discovery shelves distinct while using profile signals', () => {
        const shelves = buildPtvMusicRecommendationShelves(
            [
                musicItem('seed-alpha', 'Alpha', 'Played Alpha', ['Synth']),
                musicItem('seed-beta', 'Beta', 'Played Beta', ['Jazz'])
            ],
            [
                musicItem('aff-alpha', 'Alpha', 'Alpha Affinity', ['Synth']),
                musicItem('aff-beta', 'Beta', 'Beta Affinity', ['Jazz']),
                musicItem('aff-gamma', 'Gamma', 'Gamma Affinity', ['Synth']),
                musicItem('aff-delta', 'Delta', 'Delta Affinity', ['Country'])
            ],
            [
                musicItem('discover-epsilon', 'Epsilon', 'Epsilon Discovery', ['Pop']),
                musicItem('discover-zeta', 'Zeta', 'Zeta Discovery', ['Rock']),
                musicItem('discover-eta', 'Eta', 'Eta Discovery', ['Soul'])
            ],
            [],
            3
        );

        expect(shelves.madeForYou.map(item => item.Id)).toEqual([
            'aff-alpha',
            'aff-beta',
            'aff-gamma'
        ]);
        expect(shelves.recommended.map(item => item.Id)).toEqual([
            'discover-epsilon',
            'discover-eta',
            'discover-zeta'
        ]);
        expect(shelves.overlapPercentage).toBe(0);
    });

    it('reserves continue-listening items from discovery', () => {
        const continueItem = musicItem('resume-1', 'Resume Artist', 'Resume Track');
        const shelves = buildPtvMusicRecommendationShelves(
            [musicItem('seed-1', 'Seed Artist', 'Seed Track')],
            [continueItem, musicItem('aff-1', 'Affinity Artist', 'Affinity Track')],
            [continueItem, musicItem('discover-1', 'Discovery Artist', 'Discovery Track')],
            [continueItem],
            5
        );

        expect(shelves.madeForYou.map(item => item.Id)).toEqual(['aff-1']);
        expect(shelves.recommended.map(item => item.Id)).toEqual(['discover-1']);
    });
});
