import { describe, expect, it } from 'vitest';

import type { PtvItem } from '../api/types';
import {
    filterPtvSearchRecoveryCandidates,
    getPtvSearchRecoveryReason,
    mergePtvSearchRecoveryItems,
    shouldRecoverPtvSearchResults
} from './searchRecovery';

function movie(id: string, name: string, path: string, providerId?: string): PtvItem {
    return {
        Id: id,
        Name: name,
        Path: path,
        ProductionYear: 2025,
        ProviderIds: providerId ? { Tmdb: providerId } : undefined,
        Type: 'Movie'
    };
}

describe('PTV Movie search recovery', () => {
    it('recovers Toy Story 5 from the bounded authenticated candidate set and deduplicates root aliases before limiting', () => {
        const primary = [
            movie('1', 'Toy Story', '/media/Movies/Toy Story (1995)/movie.mkv', '101'),
            movie('2', 'Toy Story 2', '/media/Movies/Toy Story 2 (1999)/movie.mkv', '102'),
            movie('3', 'Toy Story 3', '/media/Movies/Toy Story 3 (2010)/movie.mkv', '103'),
            movie('4', 'Toy Story 4', '/media/Movies/Toy Story 4 (2019)/movie.mkv', '104')
        ];
        const supplemental = [
            movie('alternate-4', 'Toy Story 4', '/media-local/Movies/Toy Story 4 (2019)/movie.mkv', '104'),
            movie('5', 'Toy Story 5', '/media-local/Movies/Toy Story 5 (2025)/movie.mkv', '105')
        ];

        const matches = filterPtvSearchRecoveryCandidates(supplemental, 'Toy Story');
        const merged = mergePtvSearchRecoveryItems(primary, matches, 14);

        expect(merged.map(item => item.Name)).toEqual([
            'Toy Story',
            'Toy Story 2',
            'Toy Story 3',
            'Toy Story 4',
            'Toy Story 5'
        ]);
    });

    it('does not add a supplemental request for complete movie results or non-movie groups', () => {
        const completeMovieReason = getPtvSearchRecoveryReason({
            includeItemTypes: 'Movie',
            limit: 4,
            parentId: undefined,
            primaryItemCount: 4,
            primaryLibraryRoots: { deduplicatedCount: 0, groups: [], inputCount: 4, outputCount: 4 },
            primaryStatus: 'success'
        });
        const readingReason = getPtvSearchRecoveryReason({
            includeItemTypes: 'Book',
            limit: 14,
            parentId: undefined,
            primaryItemCount: 0,
            primaryLibraryRoots: { deduplicatedCount: 0, groups: [], inputCount: 0, outputCount: 0 },
            primaryStatus: 'success'
        });

        expect(completeMovieReason).toBe('complete-primary-result');
        expect(shouldRecoverPtvSearchResults(completeMovieReason)).toBe(false);
        expect(readingReason).toBe('disabled-non-movie-group');
        expect(shouldRecoverPtvSearchResults(readingReason)).toBe(false);
    });

    it('matches normalized titles, original titles, sort names, years, and path basenames without widening the supplied candidate set', () => {
        const accessibleCandidates: PtvItem[] = [
            { ...movie('5', 'Different Local Name', '/media-local/Movies/Toy Story 5 (2025)/movie.mkv', '105'), OriginalTitle: 'Toy Story 5', SortName: 'Toy Story 5' }
        ];

        expect(filterPtvSearchRecoveryCandidates(accessibleCandidates, 'Toy Story 5 2025')).toHaveLength(1);
        expect(filterPtvSearchRecoveryCandidates(accessibleCandidates, 'Toy Story 5 2024')).toHaveLength(0);
        expect(filterPtvSearchRecoveryCandidates([], 'Toy Story')).toEqual([]);
    });
});
