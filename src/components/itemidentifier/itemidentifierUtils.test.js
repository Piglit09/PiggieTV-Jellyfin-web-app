import { describe, expect, it } from 'vitest';

import {
    buildReadingMetadataPreview,
    buildRemoteSearchPayload,
    getReadingIdentifyInfo,
    getSafeReadingProviderLink,
    normalizeReadingMetadataCandidate,
    rankMetadataSearchResults
} from './itemidentifierUtils';

const sakiSearch = {
    Name: 'Saki the Succubus Hungers Tonight v03 (2020) (Digital) (LuCaZ).cbz',
    Path: '/Manga/Saki the Succubus Hungers Tonight v03 (2020) (Digital) (LuCaZ).cbz',
    ProviderIds: {},
    SeriesName: 'Saki the Succubus Hungers Tonight'
};

describe('Reading metadata normalization', () => {
    it('keeps ComicVine marketing copy out of the canonical title', () => {
        const result = normalizeReadingMetadataCandidate({
            IndexNumber: 3,
            Name: "Does she have a fever? She's looking kind of hot...",
            ProviderIds: {
                ComicVine: 'saki-the-succubus-hungers-tonight-3-does-she-have-/4000-790398'
            },
            SearchProviderName: 'Comic Vine',
            SeriesName: 'Saki the Succubus Hungers Tonight'
        }, sakiSearch);

        expect(result.Name).toBe('Saki the Succubus Hungers Tonight Vol. 3');
        expect(result.Overview).toContain('Does she have a fever?');
        expect(result.PtvProviderDisplayTitle).toContain('Does she have a fever?');
        expect(result.PtvReadingMetadata).toMatchObject({
            canonicalTitle: 'Saki the Succubus Hungers Tonight Vol. 3',
            providerId: 'saki-the-succubus-hungers-tonight-3-does-she-have-/4000-790398',
            seriesTitle: 'Saki the Succubus Hungers Tonight',
            volumeNumber: 3
        });
        expect(result.ProviderIds.ComicVine).toBe('saki-the-succubus-hungers-tonight-3-does-she-have-/4000-790398');
    });

    it('builds a useful issue title from a bare ComicVine result name', () => {
        const result = normalizeReadingMetadataCandidate({
            IndexNumber: 3,
            Name: '#003',
            ProviderIds: { ComicVine: 'absolute-carnage-vs-deadpool-3/4000-723106' },
            SeriesName: 'Absolute Carnage vs. Deadpool'
        }, {
            Name: 'Absolute Carnage vs. Deadpool 003 (2019).cbr',
            Path: '/Comics/Absolute Carnage vs. Deadpool 003 (2019).cbr'
        });

        expect(result.Name).toBe('Absolute Carnage vs. Deadpool #3');
        expect(result.SeriesName).toBe('Absolute Carnage vs. Deadpool');
        expect(result.IndexNumber).toBe(3);
    });

    it('creates structured lookup data from the shared filename parser', () => {
        expect(getReadingIdentifyInfo(sakiSearch)).toMatchObject({
            IndexNumber: 3,
            Name: 'Saki the Succubus Hungers Tonight Vol. 3',
            SeriesName: 'Saki the Succubus Hungers Tonight',
            Year: 2020
        });

        expect(buildRemoteSearchPayload(sakiSearch, 'item-1', 'Book')).toMatchObject({
            ItemId: 'item-1',
            SearchInfo: {
                IndexNumber: 3,
                Name: 'Saki the Succubus Hungers Tonight Vol. 3',
                SeriesName: 'Saki the Succubus Hungers Tonight',
                Year: 2020
            }
        });
    });
});

describe('Reading metadata result ranking', () => {
    it('ranks an exact series and volume above a wrong volume', () => {
        const ranked = rankMetadataSearchResults([
            {
                IndexNumber: 8,
                Name: '#8',
                ProviderIds: { ComicVine: 'saki-8/4000-8' },
                SearchProviderName: 'Comic Vine',
                SeriesName: 'Saki the Succubus Hungers Tonight'
            },
            {
                IndexNumber: 3,
                Name: '#3',
                ProviderIds: { ComicVine: 'saki-3/4000-3' },
                SearchProviderName: 'Comic Vine',
                SeriesName: 'Saki the Succubus Hungers Tonight'
            }
        ], sakiSearch);

        expect(ranked[0].rawResult.IndexNumber).toBe(3);
        expect(ranked[0].confidence).toMatch(/Strong|Excellent/);
        expect(ranked[0].rankReason).toContain('volume/issue match');
    });

    it('ranks the matching Saki volume 2 result above other volumes', () => {
        const ranked = rankMetadataSearchResults([
            {
                IndexNumber: 3,
                Name: '#3',
                ProviderIds: { ComicVine: 'saki-3/4000-3' },
                SearchProviderName: 'Comic Vine',
                SeriesName: 'Saki the Succubus Hungers Tonight'
            },
            {
                IndexNumber: 2,
                Name: '#2',
                ProviderIds: { ComicVine: 'saki-2/4000-2' },
                SearchProviderName: 'Comic Vine',
                SeriesName: 'Saki the Succubus Hungers Tonight'
            }
        ], {
            Name: 'Saki the Succubus Hungers Tonight v02 (2020) (Digital) (LuCaZ).cbz',
            Path: '/Manga/Saki the Succubus Hungers Tonight v02 (2020) (Digital) (LuCaZ).cbz',
            ProviderIds: {},
            SeriesName: 'Saki the Succubus Hungers Tonight'
        });

        expect(ranked[0].rawResult.IndexNumber).toBe(2);
        expect(ranked[0].rankReason).toContain('volume/issue match');
    });

    it('ranks exact ISBN and provider IDs deterministically', () => {
        const searchInfo = {
            ISBN: '9781462923007',
            Name: 'Learn Japanese with Manga Volume One',
            ProviderIds: {
                GoogleBooks: 'mrNLEAAAQBAJ',
                ISBN: '9781462923007'
            }
        };
        const results = [
            {
                Name: 'Learn Japanese with Manga',
                ProviderIds: { GoogleBooks: 'other', ISBN: '0000000000000' },
                SearchProviderName: 'Google Books'
            },
            {
                Name: 'Learn Japanese with Manga Volume One',
                ProviderIds: { GoogleBooks: 'mrNLEAAAQBAJ', ISBN: '9781462923007' },
                SearchProviderName: 'Google Books'
            }
        ];

        const firstRun = rankMetadataSearchResults(results, searchInfo);
        const secondRun = rankMetadataSearchResults([...results].reverse(), searchInfo);

        expect(firstRun[0].providerId).toBe('mrNLEAAAQBAJ');
        expect(secondRun[0].providerId).toBe('mrNLEAAAQBAJ');
        expect(firstRun[0].rankScore).toBeGreaterThan(firstRun[1].rankScore);
    });
});

describe('Reading metadata preview safety', () => {
    it('shows current and proposed values without selecting an unrelated title', () => {
        const preview = buildReadingMetadataPreview({
            ImageTags: { Primary: 'existing-cover' },
            Name: 'The Ancient Magus\' Bride Vol. 7',
            Path: '/Manga/The Ancient Magus\' Bride v07.cbz',
            SeriesName: 'The Ancient Magus\' Bride'
        }, {
            ImageUrl: 'https://example.test/new-cover.jpg',
            Name: 'A Completely Different Series #7',
            Overview: 'A provider summary.',
            ProviderIds: { ComicVine: 'different/4000-7' },
            SeriesName: 'A Completely Different Series'
        });
        const name = preview.find(field => field.key === 'Name');
        const image = preview.find(field => field.key === 'PrimaryImage');
        const overview = preview.find(field => field.key === 'Overview');

        expect(name).toMatchObject({
            currentValue: "The Ancient Magus' Bride Vol. 7",
            proposedValue: 'A Completely Different Series #7',
            selected: false
        });
        expect(image).toMatchObject({ selected: false });
        expect(overview).toMatchObject({ proposedValue: 'A provider summary.', selected: true });
    });

    it('selects a missing cover but never selects an empty provider value', () => {
        const preview = buildReadingMetadataPreview({
            Name: 'Saki the Succubus Hungers Tonight Vol. 2',
            Path: '/Manga/Saki the Succubus Hungers Tonight v02.cbz'
        }, {
            ImageUrl: 'https://example.test/cover.jpg',
            Name: 'Saki the Succubus Hungers Tonight Vol. 2',
            Overview: ''
        });

        expect(preview.find(field => field.key === 'PrimaryImage')).toMatchObject({ selected: true });
        expect(preview.find(field => field.key === 'Overview')).toMatchObject({ selected: false });
    });
});

describe('Reading provider links', () => {
    it('creates links only for validated provider identifiers', () => {
        expect(getSafeReadingProviderLink('GoogleBooks', 'mrNLEAAAQBAJ')).toBe('https://books.google.com/books?id=mrNLEAAAQBAJ');
        expect(getSafeReadingProviderLink('ComicVine', '/absolute-carnage/4000-723106/')).toBe('https://comicvine.gamespot.com/absolute-carnage/4000-723106/');
        expect(getSafeReadingProviderLink('ComicVine', ['java', 'script:alert(1)'].join(''))).toBe('');
        expect(getSafeReadingProviderLink('Unknown', 'item-1')).toBe('');
    });
});
