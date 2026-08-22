import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminMetadataItemBundle } from '../metadataManager/adminMetadataManagerModel';
import AdminMetadataQualityIdentify, {
    createAdminMetadataQualityIdentifyPrefill
} from './AdminMetadataQualityIdentify';
import type { AdminMetadataQualityDetail } from './adminMetadataQualityModel';

const identifyMocks = vi.hoisted(() => ({
    panel: vi.fn(),
    useApi: vi.fn(),
    useManager: vi.fn()
}));

vi.mock('../../../../../hooks/useApi', () => ({
    useApi: identifyMocks.useApi
}));

vi.mock('../metadataManager/useAdminMetadataManager', () => ({
    useAdminMetadataManager: identifyMocks.useManager
}));

vi.mock('../metadataManager/AdminMetadataIdentifyPanel', () => ({
    default: (props: unknown) => {
        identifyMocks.panel(props);
        return null;
    }
}));

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

function qualityDetail(overrides: Partial<AdminMetadataQualityDetail> = {}): AdminMetadataQualityDetail {
    return {
        aiReviewed: false,
        candidates: [],
        completenessScore: 80,
        currentMatch: null,
        fileName: null,
        folderName: null,
        itemId: 'item-a',
        itemType: 'Movie',
        libraryId: 'library-a',
        libraryName: 'Movies',
        matchConfidence: 40,
        providerVerified: true,
        reasons: [],
        resolutionState: null,
        scannedAt: null,
        signals: {},
        status: 'review',
        suggestedMatch: {
            providerIds: { Tmdb: '550' },
            runtimeMinutes: 139,
            title: 'Fight Club',
            type: 'Movie',
            year: 1999
        },
        title: 'Incorrect title',
        ...overrides
    };
}

function itemBundle(): AdminMetadataItemBundle {
    return {
        ancestors: [],
        authoritativeItem: {},
        editor: { editableFields: [], parentalRatings: [], providerFields: [] },
        editorInfo: {},
        form: { name: 'Incorrect title', productionYear: 1999, providerIds: {} },
        item: { id: 'item-a', name: 'Incorrect title', type: 'Movie' }
    } as unknown as AdminMetadataItemBundle;
}

describe('Metadata Quality inline Identify adapter', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        identifyMocks.useApi.mockReturnValue({
            __legacyApiClient__: { serverInfo: vi.fn() },
            api: {},
            user: { Id: 'admin-a' }
        });
        identifyMocks.useManager.mockReturnValue({
            activeMutation: null,
            applyIdentifyResult: vi.fn(),
            fetchIdentifyProviders: vi.fn(),
            fetchReadingProviders: vi.fn(),
            itemBundle: itemBundle(),
            itemError: null,
            itemLoading: false,
            refetchItem: vi.fn(),
            searchIdentify: vi.fn(),
            searchReadingIdentify: vi.fn()
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.clearAllMocks();
    });

    it('mounts the authoritative item-only Identify workspace with a verified suggestion', async () => {
        const detail = qualityDetail();
        await act(async () => root.render(<AdminMetadataQualityIdentify detail={detail} />));

        expect(identifyMocks.useManager).toHaveBeenCalledWith(expect.objectContaining({
            itemId: 'item-a',
            userId: 'admin-a',
            workspaceEnabled: false
        }));
        expect(identifyMocks.panel).toHaveBeenCalledWith(expect.objectContaining({
            bundle: expect.objectContaining({ item: expect.objectContaining({ id: 'item-a' }) }),
            identifyPrefill: expect.objectContaining({
                itemId: 'item-a',
                name: 'Fight Club',
                providerIds: { Tmdb: '550' },
                year: 1999
            })
        }));
        expect(container.textContent).toContain('verified Metadata Quality suggestion is prefilled');
    });

    it('does not trust an unverified suggestion as Identify prefill', () => {
        expect(createAdminMetadataQualityIdentifyPrefill(qualityDetail({ providerVerified: false }))).toBeNull();
    });

    it('preserves structured reading identity in the inline prefill', () => {
        expect(createAdminMetadataQualityIdentifyPrefill(qualityDetail({
            itemId: 'book-a',
            itemType: 'Book',
            suggestedMatch: {
                issueNumber: '009',
                mediaClass: 'comic',
                provider: 'Comic Vine',
                providerIds: { ComicVine: '4000-77815' },
                runtimeMinutes: null,
                seriesStartYear: 2019,
                seriesTitle: 'Deadpool',
                title: '#9',
                type: 'Book',
                year: 2020
            }
        }))).toMatchObject({
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
});
