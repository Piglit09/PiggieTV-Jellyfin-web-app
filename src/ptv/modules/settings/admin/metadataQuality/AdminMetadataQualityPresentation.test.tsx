import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    MetadataQualityDetail,
    MetadataQualityQueue,
    MetadataQualitySummary
} from './AdminMetadataQualityPresentation';
import {
    DEFAULT_ADMIN_METADATA_QUALITY_FILTERS,
    type AdminMetadataQualityDetail,
    type AdminMetadataQualityResultPage,
    type AdminMetadataQualitySummary
} from './adminMetadataQualityModel';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const summary: AdminMetadataQualitySummary = {
    counts: {
        dismissed: 1,
        healthy: 92,
        incomplete: 3,
        likelyIncorrect: 1,
        needsReview: 4,
        resolved: 2,
        totalScanned: 100,
        unavailable: 0
    },
    lastScanAt: '2026-08-13T12:00:00Z',
    libraries: [ { id: 'library-a', name: 'Movies' } ],
    ruleVersion: '1',
    scan: {
        completedAt: '2026-08-13T12:00:00Z',
        errorMessage: null,
        itemCount: 100,
        mode: 'changed',
        processedCount: 100,
        runId: 'run-a',
        startedAt: '2026-08-13T11:59:00Z',
        state: 'completed'
    },
    scannerVersion: '1'
};

const detail: AdminMetadataQualityDetail = {
    aiReviewed: true,
    candidates: [],
    completenessScore: 88,
    currentMatch: {
        providerIds: { TMDb: '60935' },
        runtimeMinutes: 103,
        title: 'The Thing',
        type: 'Movie',
        year: 2011
    },
    fileName: 'The.Thing.1982.2160p.mkv',
    folderName: 'The Thing (1982)',
    itemId: 'item a',
    itemType: 'Movie',
    libraryId: 'library-a',
    libraryName: 'Movies',
    matchConfidence: 34,
    providerVerified: true,
    reasons: [ {
        code: 'YEAR_MISMATCH',
        evidence: '1982 versus 2011',
        message: 'The filename year conflicts with the current match.',
        severity: 'error'
    } ],
    resolutionState: null,
    scannedAt: '2026-08-13T12:00:00Z',
    signals: { filenameYear: 1982, providerIdConflict: true },
    status: 'likely_wrong',
    suggestedMatch: {
        providerIds: { TMDb: '1091' },
        runtimeMinutes: 109,
        title: 'The Thing',
        type: 'Movie',
        year: 1982
    },
    title: 'The Thing'
};

const page: AdminMetadataQualityResultPage = {
    items: [ detail ],
    limit: 50,
    startIndex: 0,
    totalRecordCount: 1
};

describe('Metadata Quality presentation', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it('shows real summary counts and a bounded explainable review queue', async () => {
        await act(async () => root.render(
            <MemoryRouter>
                <MetadataQualitySummary error={false} loading={false} onRetry={vi.fn()} summary={summary} />
                <MetadataQualityQueue
                    error={false}
                    fetching={false}
                    filters={DEFAULT_ADMIN_METADATA_QUALITY_FILTERS}
                    libraries={summary.libraries}
                    loading={false}
                    onFiltersChange={vi.fn()}
                    onRetry={vi.fn()}
                    page={{ ...page, items: [ { ...detail, aiReviewed: false } ] }}
                />
            </MemoryRouter>
        ));

        expect(container.textContent).toContain('92');
        expect(container.textContent).toContain('Likely Incorrect');
        expect(container.textContent).toContain('The filename year conflicts with the current match.');
        expect(container.textContent).toContain('Identity confidence and completeness are scored separately.');
        expect(container.textContent).toContain('Provider checked');
        expect(container.textContent).not.toContain('Provider verified');
        expect(container.querySelectorAll('.ptv-metadata-quality-result-card')).toHaveLength(1);
        expect(container.querySelector('a[href="/settings/admin/media/metadata-quality/item%20a"]')).not.toBeNull();
    });

    it('shows side-by-side evidence with Identify on the review page', async () => {
        const onDismiss = vi.fn();
        const onKeepCurrent = vi.fn();
        await act(async () => root.render(
            <MemoryRouter>
                <MetadataQualityDetail
                    busy={false}
                    detail={detail}
                    error={false}
                    identify={<div data-testid='inline-identify'>Inline Identify workflow</div>}
                    loading={false}
                    onDismiss={onDismiss}
                    onKeepCurrent={onKeepCurrent}
                    onRetry={vi.fn()}
                />
            </MemoryRouter>
        ));

        expect(container.textContent).toContain('Match confidence34%');
        expect(container.textContent).toContain('Completeness88%');
        expect(container.textContent).toContain('Current match');
        expect(container.textContent).toContain('Suggested match');
        expect(container.querySelector('[data-testid="inline-identify"]')).not.toBeNull();
        expect(container.textContent).toContain('Inline Identify workflow');
        expect(container.querySelector('a[href="/settings/admin/media/metadata-manager/item%20a"]')).not.toBeNull();
        expect(container.textContent).toContain('Open the full metadata editor');
        expect(container.textContent).not.toContain('Review Suggested Fix');
        expect(onDismiss).not.toHaveBeenCalled();
        expect(onKeepCurrent).not.toHaveBeenCalled();
    });

    it('keeps inline Identify available when provider verification is unavailable', async () => {
        await act(async () => root.render(
            <MemoryRouter>
                <MetadataQualityDetail
                    busy={false}
                    detail={{ ...detail, providerVerified: false }}
                    error={false}
                    identify={<div data-testid='inline-identify'>Search providers manually</div>}
                    loading={false}
                    onDismiss={vi.fn()}
                    onKeepCurrent={vi.fn()}
                    onRetry={vi.fn()}
                />
            </MemoryRouter>
        ));

        expect(container.textContent).not.toContain('Review Suggested Fix');
        expect(container.textContent).toContain('Search providers manually');
        expect(container.textContent).toContain('Open the full metadata editor');
    });

    it('presents a truthful manual-review state when no candidate is reliable', async () => {
        await act(async () => root.render(
            <MemoryRouter>
                <MetadataQualityDetail
                    busy={false}
                    detail={{
                        ...detail,
                        candidates: [ {
                            confidence: 'weak',
                            hasHardConflict: true,
                            providerIds: { ComicVine: '4000-6' },
                            runtimeMinutes: null,
                            score: 5,
                            source: 'Comic Vine',
                            title: '#006',
                            type: 'Book',
                            year: 2026
                        } ],
                        providerVerified: true,
                        suggestedMatch: null
                    }}
                    error={false}
                    loading={false}
                    onDismiss={vi.fn()}
                    onKeepCurrent={vi.fn()}
                    onRetry={vi.fn()}
                />
            </MemoryRouter>
        ));

        expect(container.textContent).toContain('No reliable automatic match found. Review manually.');
        expect(container.textContent).toContain('Candidates considered');
        expect(container.textContent).toContain('Weak · 5% match');
        expect(container.textContent).not.toContain('Rejected · 5% match');
        expect(container.textContent).not.toContain('verified candidates');
        expect(container.textContent).not.toContain('Review Suggested Fix');
        expect(container.textContent).toContain('Open the full metadata editor');
    });

    it('renders separate comic run and publication identity alongside inline Identify', async () => {
        const suggestedMatch = {
            issueNumber: '009',
            issuePublicationDate: '2020-12-16',
            issuePublicationYear: 2020,
            mediaClass: 'comic' as const,
            provider: 'Comic Vine',
            providerIds: { ComicVine: '4000-77815' },
            publisher: 'Marvel',
            runtimeMinutes: null,
            seriesStartYear: 2019,
            seriesTitle: 'Deadpool',
            title: '#9',
            type: 'Book',
            volumeId: '4050-120205',
            year: 2020
        };
        await act(async () => root.render(
            <MemoryRouter>
                <MetadataQualityDetail
                    busy={false}
                    detail={{
                        ...detail,
                        candidates: [
                            { ...suggestedMatch, confidence: 'excellent', hasHardConflict: false, score: 98, source: 'Comic Vine' },
                            {
                                confidence: 'rejected',
                                hasHardConflict: true,
                                issueNumber: '006',
                                providerIds: { ComicVine: '4000-6' },
                                runtimeMinutes: null,
                                score: 12,
                                seriesStartYear: 2026,
                                seriesTitle: 'Deadpool',
                                source: 'Comic Vine',
                                title: '#006',
                                type: 'Book',
                                year: 2026
                            }
                        ],
                        itemId: 'deadpool-9',
                        itemType: 'Book',
                        suggestedMatch,
                        title: 'Deadpool 009 (2019) (Digital) (Zone-Empire)'
                    }}
                    error={false}
                    identify={<div data-testid='inline-identify'>Comic Identify workflow</div>}
                    loading={false}
                    onDismiss={vi.fn()}
                    onKeepCurrent={vi.fn()}
                    onRetry={vi.fn()}
                />
            </MemoryRouter>
        ));

        expect(container.textContent).toContain('Deadpool (2019) #9');
        expect(container.textContent).toContain('Marvel · Published Dec 16, 2020');
        expect(container.textContent).toContain('Other candidates');
        expect(container.textContent).toContain('Rejected · 12% match');

        expect(container.textContent).toContain('Comic Identify workflow');
    });

    it('keeps review results visible when the independent summary source fails', async () => {
        await act(async () => root.render(
            <MemoryRouter>
                <MetadataQualitySummary error loading={false} onRetry={vi.fn()} summary={undefined} />
                <MetadataQualityQueue
                    error={false}
                    fetching={false}
                    filters={DEFAULT_ADMIN_METADATA_QUALITY_FILTERS}
                    libraries={[]}
                    loading={false}
                    onFiltersChange={vi.fn()}
                    onRetry={vi.fn()}
                    page={page}
                />
            </MemoryRouter>
        ));

        expect(container.textContent).toContain('Metadata Quality status is unavailable.');
        expect(container.textContent).toContain('The Thing');
    });
});
