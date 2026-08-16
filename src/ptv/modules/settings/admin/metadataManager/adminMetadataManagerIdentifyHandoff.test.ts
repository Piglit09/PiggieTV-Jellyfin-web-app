import { describe, expect, it } from 'vitest';

import {
    createAdminMetadataManagerIdentifyHandoff,
    readAdminMetadataManagerIdentifyHandoff
} from './adminMetadataManagerIdentifyHandoff';

describe('Metadata Quality Identify handoff', () => {
    it('carries only a bounded candidate hint for the immutable route item', () => {
        const state = createAdminMetadataManagerIdentifyHandoff({
            itemId: 'item-a',
            name: 'The Thing',
            providerIds: { TMDb: '1091' },
            year: 1982
        });

        expect(readAdminMetadataManagerIdentifyHandoff(state, 'item-a')).toEqual({
            issueNumber: null,
            itemId: 'item-a',
            mediaClass: null,
            name: 'The Thing',
            provider: null,
            providerIds: { TMDb: '1091' },
            seriesStartYear: null,
            seriesTitle: null,
            year: 1982
        });
    });

    it('carries bounded comic identity without conflating its run and publication years', () => {
        const state = createAdminMetadataManagerIdentifyHandoff({
            issueNumber: '009',
            itemId: 'book-a',
            mediaClass: 'comic',
            name: 'Deadpool',
            provider: 'Comic Vine',
            providerIds: { ComicVine: '4000-77815' },
            seriesStartYear: 2019,
            seriesTitle: 'Deadpool',
            year: 2020
        });

        expect(readAdminMetadataManagerIdentifyHandoff(state, 'book-a')).toEqual({
            issueNumber: '009',
            itemId: 'book-a',
            mediaClass: 'comic',
            name: 'Deadpool',
            provider: 'Comic Vine',
            providerIds: { ComicVine: '4000-77815' },
            seriesStartYear: 2019,
            seriesTitle: 'Deadpool',
            year: 2020
        });
    });

    it('accepts the bounded version-one history contract during the transition', () => {
        expect(readAdminMetadataManagerIdentifyHandoff({
            ptvMetadataQualityIdentify: {
                itemId: 'item-a',
                name: 'The Thing',
                providerIds: { TMDb: '1091' },
                version: 1,
                year: 1982
            }
        }, 'item-a')).toEqual({
            itemId: 'item-a',
            name: 'The Thing',
            providerIds: { TMDb: '1091' },
            year: 1982
        });
    });

    it('fails closed after refresh, for a different item, or for an unverified empty candidate', () => {
        const state = createAdminMetadataManagerIdentifyHandoff({
            itemId: 'item-a',
            name: 'The Thing',
            providerIds: { TMDb: '1091' },
            year: 1982
        });

        expect(readAdminMetadataManagerIdentifyHandoff(undefined, 'item-a')).toBeNull();
        expect(readAdminMetadataManagerIdentifyHandoff(state, 'item-b')).toBeNull();
        expect(createAdminMetadataManagerIdentifyHandoff({
            itemId: 'item-a',
            name: 'The Thing',
            providerIds: {},
            year: 1982
        })).toBeNull();
        expect(createAdminMetadataManagerIdentifyHandoff({
            issueNumber: 'Unsafe\u0000issue',
            itemId: 'item-a',
            mediaClass: 'comic',
            name: 'Deadpool',
            providerIds: { ComicVine: '4000-77815' },
            year: 2020
        })).toBeNull();
    });

    it('rejects malformed history state and unsafe strings instead of treating them as metadata', () => {
        expect(readAdminMetadataManagerIdentifyHandoff({
            ptvMetadataQualityIdentify: {
                itemId: 'item-a',
                name: 'Unsafe\u0000title',
                providerIds: { TMDb: '1091' },
                version: 1,
                year: 1982
            }
        }, 'item-a')).toBeNull();
        expect(readAdminMetadataManagerIdentifyHandoff({
            ptvMetadataQualityIdentify: {
                itemId: 'item-a',
                name: 'The Thing',
                providerIds: { TMDb: '1091' },
                version: 99,
                year: 1982
            }
        }, 'item-a')).toBeNull();
    });
});
