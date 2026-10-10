import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeAdminReadingMetadataSearchResponse } from '../metadataManager/adminReadingMetadataAdapters';
import { identityAssessment } from '../metadataManager/adminReadingIdentityTestFixtures';
import type { AdminMetadataIdentifyPanelProps } from '../metadataManager/AdminMetadataIdentifyPanel';
import type { AdminMetadataItemBundle } from '../metadataManager/adminMetadataManagerModel';
import AdminMetadataQualityIdentify, {
    createAdminMetadataQualityIdentifyPrefill
} from './AdminMetadataQualityIdentify';
import type { AdminMetadataQualityDetail } from './adminMetadataQualityModel';

const identifyMocks = vi.hoisted(() => ({
    realPanel: false,
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

vi.mock('../metadataManager/AdminMetadataIdentifyPanel', async importOriginal => {
    const actual = await importOriginal<typeof import('../metadataManager/AdminMetadataIdentifyPanel')>();
    return { default: (props: AdminMetadataIdentifyPanelProps) => {
        identifyMocks.panel(props);
        return identifyMocks.realPanel ? <actual.default {...props} /> : null;
    } };
});

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

function managerState(overrides: Record<string, unknown> = {}) {
    return {
        activeMutation: null,
        applyIdentifyResult: vi.fn(),
        fetchIdentifyProviders: vi.fn(),
        fetchReadingProviders: vi.fn(),
        itemBundle: itemBundle(),
        itemError: null,
        itemLoading: false,
        refetchItem: vi.fn(),
        searchIdentify: vi.fn(),
        searchReadingIdentify: vi.fn(),
        ...overrides
    };
}

describe('Metadata Quality inline Identify adapter', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        identifyMocks.realPanel = false;
        identifyMocks.useApi.mockReturnValue({
            __legacyApiClient__: { serverInfo: vi.fn() },
            api: {},
            user: { Id: 'admin-a' }
        });
        identifyMocks.useManager.mockReturnValue(managerState());
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

    it('replaces a stalled loading state with the reachable Retry action', async () => {
        const detail = qualityDetail();
        const refetchItem = vi.fn();
        identifyMocks.useManager.mockReturnValue(managerState({
            itemBundle: null,
            itemLoading: true
        }));
        await act(async () => root.render(<AdminMetadataQualityIdentify detail={detail} />));
        expect(container.textContent).toContain('Loading Identify tools...');

        identifyMocks.useManager.mockReturnValue(managerState({
            itemBundle: null,
            itemError: new Error('bounded item request failed'),
            refetchItem
        }));
        await act(async () => root.render(<AdminMetadataQualityIdentify detail={detail} />));
        expect(container.textContent).toContain("Identify tools couldn't be loaded.");

        await act(async () => container.querySelector('button')?.click());
        expect(refetchItem).toHaveBeenCalledOnce();
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
    it('shows archive failure in the shared parsed evidence even with OPF success and no matches', async () => {
        identifyMocks.realPanel = true;
        const bundle = itemBundle();
        const response = normalizeAdminReadingMetadataSearchResponse({ candidates: [] });
        identifyMocks.useManager.mockReturnValue(managerState({
            itemBundle: { ...bundle, item: { ...bundle.item, type: 'Book' } },
            fetchReadingProviders: vi.fn(async () => ({ providers: [] })),
            searchReadingIdentify: vi.fn(async () => ({ ...response,
                localMetadata: { state: 'inspected', sources: [ 'OPF' ], warnings: [] },
                identitySources: { ...identityAssessment().sources, archiveState: 'unverified', archiveReasonCode: 'HELPER_UNAVAILABLE' }
            }))
        }));
        await act(async () => root.render(<AdminMetadataQualityIdentify detail={qualityDetail({ providerVerified: false })} />));
        await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Search')?.click());
        expect(container.querySelector('.ptv-reading-parsed-query')?.textContent).toContain('Archive identity could not be verified');
        expect(container.textContent).toContain('helper unavailable');
        expect(container.textContent).toContain('No matches found');
    });

    it('renders the real shared Reading workflow and requires the conflict acknowledgment', async () => {
        identifyMocks.realPanel = true;
        const bundle = itemBundle();
        const assessment = identityAssessment({ itemId: 'item-a', requiresConflictAcknowledgment: true,
            findings: [ { code: 'ISSUE_CONFLICT', field: 'Issue', leftSource: 'ComicInfo', leftValue: '1',
                rightSource: 'Provider', rightValue: '9', isConflict: true, isMaterialUncertainty: false } ] });
        const response = normalizeAdminReadingMetadataSearchResponse({ candidates: [ {
            title: 'Synthetic match', provider: 'ComicVine', providerId: '4000-123'
        } ] });
        const candidate = { ...response.candidates[0], assessmentContext: 'signed-context', archiveRevision: 'revision-a',
            assessmentDigest: 'digest-a', identityAssessment: assessment };
        const applyIdentifyResult = vi.fn(async () => bundle);
        identifyMocks.useManager.mockReturnValue(managerState({
            identityScope: { serverId: 'server-a', userId: 'admin-a' },
            itemBundle: { ...bundle, item: { ...bundle.item, type: 'Book' } },
            fetchReadingProviders: vi.fn(async () => ({ providers: [] })),
            searchReadingIdentify: vi.fn(async () => ({ ...response, candidates: [ candidate ] })), applyIdentifyResult
        }));
        const button = (text: string) => Array.from(document.body.querySelectorAll('button')).find(item => item.textContent === text);
        await act(async () => root.render(<AdminMetadataQualityIdentify detail={qualityDetail({ providerVerified: false })} />));
        await act(async () => button('Search')?.click());
        await act(async () => button('Review match')?.click());
        expect(document.body.textContent).toContain('ComicInfo: 1');
        expect(button('Apply despite conflict')?.disabled).toBe(true);
        const checkbox = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]');
        expect(checkbox?.checked).toBe(false);
        await act(async () => checkbox?.click());
        expect(button('Apply despite conflict')?.disabled).toBe(false);
        expect(applyIdentifyResult).not.toHaveBeenCalled();
    });
});
