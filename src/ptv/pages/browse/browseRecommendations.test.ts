import { describe, expect, it } from 'vitest';
import type { PtvItem } from '../../api';
import { selectPtvBrowseRecommendations } from './browseRecommendations';

const libraries: Record<string, PtvItem[]> = {
    shows: [{ Id: 'shows-1', Name: 'Show one', Type: 'Series' }, { Id: 'shows-2', Type: 'Series' }],
    anime: [{ Id: 'anime-1', Name: 'Anime one', Type: 'Series' }, { Id: 'anime-2', Type: 'Series' }],
    cartoons: [{ Id: 'cartoons-1', Name: 'Cartoon one', Type: 'Series' }]
};
const warmGlobalCandidates = Object.values(libraries).flat().reverse().map(item => ({ item, mediaType: 'show' }));

describe('browse recommendation library membership', () => {
    it.each(['shows', 'anime', 'cartoons'])('never accepts same-type foreign IDs on %s', library => {
        const result = selectPtvBrowseRecommendations('shows', warmGlobalCandidates, libraries[library]);
        expect(result.map(item => item.Id)).toEqual(libraries[library].map(item => item.Id).reverse());
    });

    it('does not fill an empty or small library result from the global ranking', () => {
        expect(selectPtvBrowseRecommendations('shows', warmGlobalCandidates, [])).toEqual([]);
        expect(selectPtvBrowseRecommendations('shows', warmGlobalCandidates, libraries.cartoons)).toEqual(libraries.cartoons);
        expect(selectPtvBrowseRecommendations('shows', [], libraries.anime)).toEqual([]);
    });

    it('uses authoritative membership rather than the heuristic anime media label', () => {
        const result = selectPtvBrowseRecommendations('shows', [{ item: libraries.anime[0], mediaType: 'anime' }], libraries.anime);
        expect(result).toEqual([libraries.anime[0]]);
    });

    it('uses the freshly scoped DTO, preserving rank but not a stale global snapshot', () => {
        const current = { ...libraries.anime[0], Name: 'Current metadata' };
        const result = selectPtvBrowseRecommendations('shows', [{ item: libraries.anime[0], mediaType: 'show' }], [current]);
        expect(result[0]).toBe(current);
    });

    it('retains isolation through route switches, back navigation and fresh route reconstruction with warm ranking', () => {
        for (const library of ['anime', 'shows', 'cartoons', 'anime', 'anime']) {
            const freshMembership = libraries[library].map(item => ({ ...item }));
            const result = selectPtvBrowseRecommendations('shows', warmGlobalCandidates, freshMembership);
            expect(result.every(item => freshMembership.includes(item))).toBe(true);
            expect(result.map(item => item.Id).sort((a, b) => String(a).localeCompare(String(b))))
                .toEqual(freshMembership.map(item => item.Id).sort((a, b) => String(a).localeCompare(String(b))));
        }
    });

    it('isolates Movies from Anime Movies even though both have Movie type', () => {
        const movie = { Id: 'movie', Type: 'Movie' };
        const animeMovie = { Id: 'anime-movie', Type: 'Movie' };
        expect(selectPtvBrowseRecommendations('movies', [movie, animeMovie].map(item => ({ item, mediaType: 'movie' })), [movie])).toEqual([movie]);
    });

    it('deduplicates ranked IDs and excludes absent IDs and wrong item types', () => {
        expect(selectPtvBrowseRecommendations('shows', [
            { item: { Id: 'anime-1', Type: 'Series' } },
            { item: { Id: 'anime-1', Type: 'Series' } },
            { item: { Type: 'Series' } },
            { item: { Id: 'episode', Type: 'Episode' } }
        ], [...libraries.anime, { Id: 'episode', Type: 'Episode' }])).toEqual([libraries.anime[0]]);
    });
});
