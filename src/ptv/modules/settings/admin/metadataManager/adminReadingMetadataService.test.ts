import { describe, expect, it, vi } from 'vitest';

import {
    loadAdminReadingMetadataProviders,
    searchAdminReadingMetadata,
    type AdminReadingMetadataApiClient
} from './adminReadingMetadataService';
import type { AdminReadingMetadataSearchRequest } from './adminReadingMetadataModel';

function client(methods: Partial<AdminReadingMetadataApiClient>): AdminReadingMetadataApiClient {
    return {
        getReadingMetadataProviders: vi.fn(),
        searchReadingMetadata: vi.fn(),
        ...methods
    } as unknown as AdminReadingMetadataApiClient;
}

describe('Reading metadata service', () => {
    it('loads and normalizes provider status through the authenticated plugin client', async () => {
        const getReadingMetadataProviders = vi.fn().mockResolvedValue({
            Providers: [{
                DisplayName: 'AniList',
                Message: null,
                Provider: 'AniList',
                RetryAfterSeconds: null,
                State: 'available'
            }, {
                DisplayName: '',
                Message: 'A future state is not trusted at the browser boundary.',
                Provider: 'Future Provider',
                RetryAfterSeconds: 30,
                State: 'future-state'
            }]
        });
        // eslint-disable-next-line compat/compat
        const signal = new AbortController().signal;

        const response = await loadAdminReadingMetadataProviders(client({
            getReadingMetadataProviders
        }), signal);

        expect(getReadingMetadataProviders).toHaveBeenCalledWith({ signal });
        expect(response.providers).toEqual([{
            displayName: 'AniList',
            message: null,
            provider: 'AniList',
            retryAfterSeconds: null,
            state: 'available'
        }, {
            displayName: 'Future Provider',
            message: 'A future state is not trusted at the browser boundary.',
            provider: 'Future Provider',
            retryAfterSeconds: 30,
            state: 'unknown'
        }]);
    });

    it('forwards every explicit search dimension and its AbortSignal exactly once', async () => {
        const searchReadingMetadata = vi.fn().mockResolvedValue({
            Candidates: [{
                MediaClass: 'manga',
                Provider: 'anilist',
                ProviderId: '30013',
                Score: 91,
                Title: 'Matched title'
            }],
            LocalMetadata: {
                Sources: [ 'ComicInfo.xml' ],
                State: 'inspected',
                Warnings: []
            },
            ProviderResults: [{
                CacheHit: false,
                Candidates: [],
                DurationMilliseconds: 125,
                Failure: null,
                Provider: 'anilist',
                State: 'available'
            }],
            Query: {
                ChapterNumber: '31',
                Classification: {
                    Confidence: 0.9,
                    MediaClass: 'manga',
                    Reasons: [ 'Manga context.' ]
                },
                IssueNumber: '7',
                MediaClass: 'manga',
                VolumeNumber: '4'
            }
        });
        const request: AdminReadingMetadataSearchRequest = {
            author: 'Writer One',
            chapterNumber: '31',
            isbn: '9780000000000',
            issueNumber: '7',
            itemId: 'item-a',
            mediaClass: 'manga',
            provider: 'AniList',
            providerId: '30013',
            seriesTitle: 'Series title',
            title: 'Matched title',
            volumeNumber: '4',
            year: 2023
        };
        // eslint-disable-next-line compat/compat
        const signal = new AbortController().signal;

        const response = await searchAdminReadingMetadata(client({ searchReadingMetadata }), request, signal);

        expect(searchReadingMetadata).toHaveBeenCalledOnce();
        expect(searchReadingMetadata).toHaveBeenCalledWith(request, { signal });
        expect(response.query).toMatchObject({
            chapterNumber: '31',
            issueNumber: '7',
            mediaClass: 'manga',
            volumeNumber: '4'
        });
        expect(response.candidates).toEqual([ expect.objectContaining({
            provider: 'anilist',
            providerId: '30013',
            score: 91,
            title: 'Matched title'
        }) ]);
        expect(response.localMetadata).toEqual({
            sources: [ 'ComicInfo.xml' ],
            state: 'inspected',
            warnings: []
        });
        expect(response.providerResults).toEqual([ expect.objectContaining({
            durationMilliseconds: 125,
            provider: 'anilist',
            state: 'available'
        }) ]);
    });

    it('normalizes missing clients and private transport failures without leaking details', async () => {
        await expect(loadAdminReadingMetadataProviders(null)).rejects.toThrow(
            'Reading metadata providers are temporarily unavailable.'
        );
        await expect(searchAdminReadingMetadata(client({
            searchReadingMetadata: vi.fn().mockRejectedValue(new Error(
                'GET /private/server/path?access_token=do-not-leak'
            ))
        }), {
            itemId: 'item-a',
            title: 'Safe title'
        })).rejects.toThrow('Reading identification results could not be loaded.');

        try {
            await searchAdminReadingMetadata(client({
                searchReadingMetadata: vi.fn().mockRejectedValue({
                    response: { data: { privateProviderPayload: true } }
                })
            }), { itemId: 'item-a' });
        } catch (error) {
            expect(String(error)).not.toMatch(/privateProviderPayload|access_token|private\/server/);
        }
    });
});
