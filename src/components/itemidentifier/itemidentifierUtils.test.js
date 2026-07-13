import { describe, expect, it } from 'vitest';

import {
    buildRemoteSearchPayload,
    createMetadataSearchResultViewModel,
    dedupeExternalIdInfos,
    getReadingIdentifyName,
    getRemoteSearchResponseShape,
    getRemoteSearchApplyPayload,
    hasRemoteSearchProviderIds,
    normalizeRemoteProviderIdValue,
    normalizeRemoteProviderIds,
    normalizeRemoteSearchResultForApply,
    normalizeRemoteSearchResults,
    sanitizeProviderIds
} from './itemidentifierUtils';

describe('itemidentifierUtils', () => {
    it('normalizes raw array metadata responses', () => {
        const response = [
            { Name: 'Book One' }
        ];

        expect(normalizeRemoteSearchResults(response)).toEqual(response);
        expect(getRemoteSearchResponseShape(response)).toBe('array');
    });

    it('normalizes wrapped metadata responses', () => {
        expect(normalizeRemoteSearchResults({
            SearchResults: [
                { Name: 'Search Result' }
            ]
        })).toEqual([
            { Name: 'Search Result' }
        ]);
        expect(normalizeRemoteSearchResults({
            Response: {
                Items: [
                    { Name: 'Nested Item' }
                ]
            }
        })).toEqual([
            { Name: 'Nested Item' }
        ]);
    });

    it('returns an empty array for empty or malformed metadata responses', () => {
        expect(normalizeRemoteSearchResults(null)).toEqual([]);
        expect(normalizeRemoteSearchResults({ Error: 'Provider failed' })).toEqual([]);
    });

    it('deduplicates provider ID fields while preserving Jellyfin key casing', () => {
        expect(dedupeExternalIdInfos([
            { Key: 'ComicVine', Name: 'Comic Vine' },
            { Key: 'comic-vine', Name: 'Comic Vine Duplicate' },
            { Key: 'GoogleBooks', Name: 'Google Books' },
            { Key: 'Google Books', Name: 'Google Books Duplicate' },
            { Key: 'OpenLibrary', Name: 'Open Library' }
        ])).toEqual([
            { Key: 'GoogleBooks', Name: 'Google Books' },
            { Key: 'ComicVine', Name: 'Comic Vine' },
            { Key: 'OpenLibrary', Name: 'Open Library' }
        ]);
    });

    it('does not send empty provider IDs that can overwrite a valid Google Books ID', () => {
        expect(sanitizeProviderIds([
            { key: 'GoogleBooks', value: 'mrNLEAAAQBAJ' },
            { key: 'GoogleBooks', value: '' },
            { key: 'ComicVine', value: '   ' },
            { key: '', value: 'ignored' }
        ])).toEqual({
            GoogleBooks: 'mrNLEAAAQBAJ'
        });
    });

    it('normalizes duplicate provider ID keys to Jellyfin provider keys', () => {
        expect(normalizeRemoteProviderIds({
            'Comic Vine': 'https://comicvine.gamespot.com/absolute-carnage-vs-deadpool-3/4000-723106',
            ComicVine: 'absolute-carnage-vs-deadpool-3/4000-723106',
            'Google Books': 'mrNLEAAAQBAJ'
        })).toEqual({
            ComicVine: 'absolute-carnage-vs-deadpool-3/4000-723106',
            GoogleBooks: 'mrNLEAAAQBAJ'
        });
    });

    it('scopes Google Books provider ID searches to the Google Books provider, including disabled providers', () => {
        expect(buildRemoteSearchPayload({
            Name: 'Learn Japanese with Manga Volume One'
        }, 'item-1', 'Book', [
            { key: 'GoogleBooks', providerName: 'Google Books', value: 'mrNLEAAAQBAJ' },
            { key: 'ISBN', providerName: 'ISBN', value: '9781462923007' }
        ])).toEqual({
            IncludeDisabledProviders: true,
            ItemId: 'item-1',
            SearchProviderName: 'Google Books',
            SearchInfo: {
                Name: 'Learn Japanese with Manga Volume One',
                ProviderIds: {
                    GoogleBooks: 'mrNLEAAAQBAJ',
                    ISBN: '9781462923007'
                }
            }
        });
    });

    it('maps ISBN-only book searches into the Google Books query syntax Jellyfin supports', () => {
        expect(buildRemoteSearchPayload({
            ISBN: '978-1-4629-2300-7'
        }, 'item-1', 'Book')).toEqual({
            IncludeDisabledProviders: true,
            ItemId: 'item-1',
            SearchProviderName: 'Google Books',
            SearchInfo: {
                Name: 'isbn:9781462923007',
                ProviderIds: {}
            }
        });
    });

    it('keeps author input useful by folding it into the BookInfo name query', () => {
        expect(buildRemoteSearchPayload({
            Author: 'Marc Bernabe',
            Name: 'Learn Japanese with Manga Volume One'
        }, 'item-1', 'Book')).toEqual({
            IncludeDisabledProviders: true,
            ItemId: 'item-1',
            SearchInfo: {
                Name: 'Learn Japanese with Manga Volume One Marc Bernabe',
                ProviderIds: {}
            }
        });
    });

    it('cleans reading filenames before pre-filling title search', () => {
        expect(getReadingIdentifyName({
            Name: 'Example Manga v02 (2020) (Digital) (LuCaZ).cbz'
        })).toBe('Example Manga v02 (2020)');
    });

    it('normalizes pasted Google Books and Comic Vine provider IDs', () => {
        expect(normalizeRemoteProviderIdValue(
            'GoogleBooks',
            'https://books.google.com/books/edition/Batman_and_Harley_Quinn_2017_1/qDw7DwAAQBAJ?hl=en'
        )).toBe('qDw7DwAAQBAJ');
        expect(normalizeRemoteProviderIdValue(
            'ComicVine',
            'https://comicvine.gamespot.com/batman-and-harley-quinn-1/4000-678037/'
        )).toBe('batman-and-harley-quinn-1/4000-678037');
    });

    it('keeps Comic Vine result provider IDs in Jellyfin apply shape', () => {
        const result = normalizeRemoteSearchResultForApply({
            Id: 'batman-and-harley-quinn-1/4000-678037',
            Name: 'Batman and Harley Quinn #001',
            SearchProviderName: 'Comic Vine',
            providerIds: {
                'comic-vine': 'batman-and-harley-quinn-1/4000-678037'
            }
        });

        expect(result.ProviderIds).toEqual({
            ComicVine: 'batman-and-harley-quinn-1/4000-678037'
        });
        expect(hasRemoteSearchProviderIds(result)).toBe(true);
    });

    it('derives provider IDs from selected provider result IDs when the server omits ProviderIds casing', () => {
        const result = normalizeRemoteSearchResultForApply({
            id: 'qDw7DwAAQBAJ',
            Name: 'Batman and Harley Quinn (2017-) #1',
            searchProviderName: 'Google Books'
        });

        expect(result.ProviderIds).toEqual({
            GoogleBooks: 'qDw7DwAAQBAJ'
        });
        expect(result.SearchProviderName).toBe('Google Books');
    });

    it('preserves the full raw Comic Vine result behind the search result view model', () => {
        const rawResult = {
            Id: 'absolute-carnage-vs-deadpool-3/4000-723106',
            ImageUrl: 'https://comicvine.example/cover.jpg',
            Name: 'Absolute Carnage vs. Deadpool 003',
            Overview: '<p>Full provider description.</p>',
            People: [
                { Name: 'Frank Tieri', Type: 'Writer' }
            ],
            ProviderIds: {
                'Comic Vine': 'https://comicvine.gamespot.com/absolute-carnage-vs-deadpool-3/4000-723106'
            },
            SearchProviderName: 'Comic Vine',
            Studios: [
                { Name: 'Marvel' }
            ],
            Tags: ['Carnage']
        };
        const viewModel = createMetadataSearchResultViewModel(rawResult);

        expect(viewModel.displayTitle).toBe('Absolute Carnage vs. Deadpool 003');
        expect(viewModel.displayOverview).toBe('<p>Full provider description.</p>');
        expect(viewModel.rawResult.Overview).toBe('<p>Full provider description.</p>');
        expect(viewModel.rawResult.People).toEqual(rawResult.People);
        expect(viewModel.rawResult.Studios).toEqual(rawResult.Studios);
        expect(viewModel.rawResult.Tags).toEqual(rawResult.Tags);
    });

    it('submits the complete raw remote result instead of reconstructed display fields', () => {
        const viewModel = createMetadataSearchResultViewModel({
            Id: 'absolute-carnage-vs-deadpool-3/4000-723106',
            Name: 'Absolute Carnage vs. Deadpool 003',
            Overview: 'Full provider description.',
            ProviderIds: {
                ComicVine: 'absolute-carnage-vs-deadpool-3/4000-723106'
            },
            SearchProviderName: 'Comic Vine',
            SeriesName: 'Absolute Carnage vs. Deadpool',
            ProviderSpecificPayload: {
                issueId: 723106
            }
        });
        const payload = getRemoteSearchApplyPayload(viewModel);

        expect(payload).toMatchObject({
            Name: 'Absolute Carnage vs. Deadpool 003',
            Overview: 'Full provider description.',
            ProviderIds: {
                ComicVine: 'absolute-carnage-vs-deadpool-3/4000-723106'
            },
            ProviderSpecificPayload: {
                issueId: 723106
            },
            SearchProviderName: 'Comic Vine',
            SeriesName: 'Absolute Carnage vs. Deadpool'
        });
    });
});
