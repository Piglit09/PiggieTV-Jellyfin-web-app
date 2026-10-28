import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AdminMetadataManagerServiceError,
    type AdminMetadataForm,
    type AdminMetadataIdentifyResult,
    type AdminMetadataItemBundle,
    type AdminMetadataProviderField
} from './adminMetadataManagerModel';
import { AdminReadingAssessmentChangedError } from './adminReadingMetadataService';
import { identityAssessment } from './adminReadingIdentityTestFixtures';
import type {
    AdminReadingMetadataCandidate,
    AdminReadingMetadataSearchRequest,
    AdminReadingMetadataSearchResponse,
    AdminReadingProviderStatus
} from './adminReadingMetadataModel';
import {
    useAdminMetadataIdentifyController,
    validateAdminMetadataIdentifyPrefill,
    type AdminMetadataIdentifyController,
    type AdminMetadataIdentifyControllerOperations,
    type UseAdminMetadataIdentifyControllerInput
} from './useAdminMetadataIdentifyController';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

function metadataForm(overrides: Partial<AdminMetadataForm> = {}): AdminMetadataForm {
    return {
        communityRating: null,
        criticRating: null,
        customRating: '',
        endDate: '',
        genres: [],
        indexNumber: null,
        lockData: false,
        lockedFields: [],
        name: 'Original title',
        officialRating: '',
        originalTitle: '',
        overview: '',
        parentIndexNumber: null,
        people: [],
        premiereDate: '',
        productionLocations: [],
        productionYear: 2020,
        providerIds: { TMDb: 'current-id' },
        runtimeMinutes: null,
        sortName: '',
        studios: [],
        tagline: '',
        tags: [],
        ...overrides
    };
}

function itemBundle(
    id = 'item-a',
    type = 'Movie',
    form = metadataForm()
): AdminMetadataItemBundle {
    return {
        ancestors: [],
        authoritativeItem: { Id: id, Name: form.name },
        editor: {
            editableFields: [ 'name', 'productionYear', 'providerIds' ],
            parentalRatings: [],
            providerFields: []
        },
        editorInfo: {},
        form,
        item: {
            backdropImageTags: [],
            collectionType: '',
            id,
            imageTags: {},
            isFolder: false,
            name: form.name,
            parentId: 'library-a',
            primaryImageTag: null,
            type
        }
    } as AdminMetadataItemBundle;
}

function identifyResult(name = 'Matched title'): AdminMetadataIdentifyResult {
    return {
        id: `result:${name}`,
        imageUrl: null,
        name,
        overview: 'Provider result',
        providerIds: { TMDb: 'matched-id' },
        providerName: 'TheMovieDb',
        source: {},
        year: 1982
    };
}

function readingCandidate(overrides: Partial<AdminReadingMetadataCandidate> = {}): AdminReadingMetadataCandidate {
    return {
        assessmentContext: 'signed-context',
        assessmentDigest: 'digest-a',
        archiveRevision: 'revision-a',
        identityAssessment: identityAssessment({ providerId: '4000-77815' }),
        alternateTitles: [],
        artists: [],
        authors: [],
        bannerUrl: null,
        chapterNumber: null,
        countryOfOrigin: 'US',
        coverUrl: null,
        description: 'Provider result',
        endYear: null,
        externalIds: { ComicVine: '4000-77815' },
        genres: [],
        isbn10: null,
        isbn13: null,
        issueNumber: '9',
        language: 'en',
        localizedTitles: {},
        mediaClass: 'comic',
        provider: 'ComicVine',
        providerId: '4000-77815',
        publisher: 'Marvel',
        score: 96,
        scoreReasons: [],
        seriesTitle: 'Deadpool',
        sourceUrl: null,
        startYear: 2019,
        status: null,
        tags: [],
        title: 'Deadpool #9',
        totalChapters: null,
        totalVolumes: null,
        volumeNumber: null,
        year: 2020,
        ...overrides
    };
}

function readingResponse(candidate = readingCandidate()): AdminReadingMetadataSearchResponse {
    return {
        candidates: [ candidate ],
        localMetadata: { sources: [], state: 'not-found', warnings: [] },
        providerResults: [],
        query: {
            alternateTitles: [],
            author: null,
            chapterNumber: null,
            classification: { confidence: 0.95, mediaClass: 'comic', reasons: [] },
            cleanedTitle: 'Deadpool',
            editionKind: 'standard',
            existingProviderIds: {},
            ignoredFilenameTokens: [],
            isbn: null,
            issueNumber: '9',
            mediaClass: 'comic',
            originalLanguage: 'en',
            providerId: null,
            rawFileName: 'Deadpool 009.cbz',
            rawTitle: 'Deadpool 009',
            seriesTitle: 'Deadpool',
            volumeNumber: null,
            year: 2020
        }
    };
}

function operations(
    saved = itemBundle(),
    overrides: Partial<AdminMetadataIdentifyControllerOperations> = {}
): AdminMetadataIdentifyControllerOperations {
    return {
        activeMutation: null,
        applyIdentifyResult: vi.fn(async () => saved),
        fetchIdentifyProviders: vi.fn(async () => []),
        fetchReadingProviders: vi.fn(async () => ({ providers: [] })),
        searchIdentify: vi.fn(async () => []),
        searchReadingIdentify: vi.fn(async () => readingResponse()),
        ...overrides
    };
}

function deferred<Value>() {
    let resolve!: (value: Value) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function standard(controller: AdminMetadataIdentifyController) {
    if (controller.kind !== 'standard') throw new Error('Expected standard Identify controller.');
    return controller.workflowProps.identify;
}

function reading(controller: AdminMetadataIdentifyController) {
    if (controller.kind !== 'reading') throw new Error('Expected Reading Identify controller.');
    return controller.workflowProps;
}

describe('shared admin metadata Identify controller', () => {
    let container: HTMLDivElement;
    let root: Root;
    let latest: AdminMetadataIdentifyController;

    function Harness({ input }: Readonly<{ input: UseAdminMetadataIdentifyControllerInput }>) {
        latest = useAdminMetadataIdentifyController(input);
        return null;
    }

    async function render(input: UseAdminMetadataIdentifyControllerInput) {
        await act(async () => root.render(<Harness input={input} />));
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.clearAllMocks();
    });

    it.each(['archive', 'displayed value'])('ChangedArchiveResetsReview / SameReasonCodeDifferentDisplayedValueResetsReview: %s', async change => {
        const candidate = readingCandidate();
        const changed = identityAssessment({ ...candidate.identityAssessment!,
            archiveRevision: change === 'archive' ? 'revision-b' : 'revision-a',
            sources: { ...candidate.identityAssessment!.sources,
                comicInfo: { ...candidate.identityAssessment!.sources.comicInfo, issueNumber: '10' } }
        });
        let current!: () => boolean;
        const ops = operations(itemBundle(), { searchReadingIdentify: vi.fn(async () => readingResponse(candidate)), applyIdentifyResult: vi.fn(async (_result, guard) => {
            current = guard!.isCurrent;
            throw new AdminReadingAssessmentChangedError(changed);
        }) });
        await render({ bundle: itemBundle('book-a', 'Book'), operations: ops });
        await act(async () => reading(latest).onSearch({ itemId: 'book-a', title: 'Synthetic' }));
        const approval = { assessmentContext: 'signed-context', assessmentDigest: 'digest-a', archiveRevision: 'revision-a',
            searchGeneration: 'generation-a', acknowledgedConflictCodes: [], acknowledgedUnverifiedCodes: [] };
        await act(async () => {
            await expect(reading(latest).onApply(candidate, approval)).rejects.toThrow();
        });
        expect(reading(latest).response?.candidates[0].identityAssessment).toEqual(changed);
        expect(reading(latest).response?.candidates[0].archiveRevision).toBe(changed.archiveRevision);
        expect(current()).toBe(false);
    });

    it('invalidates a pending Reading guard when the review owner unmounts', async () => {
        const candidate = readingCandidate();
        let current!: () => boolean;
        const ops = operations(itemBundle(), {
            searchReadingIdentify: vi.fn(async () => readingResponse(candidate)),
            applyIdentifyResult: vi.fn(async (_result, guard) => {
                current = guard!.isCurrent;
                return itemBundle();
            })
        });
        await render({ bundle: itemBundle('book-a', 'Book'), operations: ops });
        await act(async () => reading(latest).onSearch({ itemId: 'book-a' }));
        await act(async () => reading(latest).onApply(candidate, {
            assessmentContext: 'signed-context', assessmentDigest: 'digest-a', archiveRevision: 'revision-a',
            searchGeneration: 'generation-a', acknowledgedConflictCodes: [], acknowledgedUnverifiedCodes: []
        }));
        expect(current()).toBe(true);
        await act(async () => root.render(null));
        expect(current()).toBe(false);
    });

    it('accepts only a bounded prefill for the immutable item and never searches or applies on mount', async () => {
        const controllerOperations = operations();
        const validPrefill = {
            itemId: 'item-a',
            name: 'The Thing',
            providerIds: { TMDb: '1091' },
            year: 1982
        } as const;

        expect(validateAdminMetadataIdentifyPrefill(validPrefill, 'item-a')).toEqual(expect.objectContaining({
            itemId: 'item-a',
            name: 'The Thing',
            providerIds: { TMDb: '1091' },
            year: 1982
        }));
        expect(validateAdminMetadataIdentifyPrefill(validPrefill, 'item-b')).toBeNull();
        expect(validateAdminMetadataIdentifyPrefill({
            ...validPrefill,
            name: 'Unsafe\u0000title'
        }, 'item-a')).toBeNull();

        await render({
            bundle: itemBundle(),
            identifyPrefill: validPrefill,
            operations: controllerOperations
        });

        expect(standard(latest)).toMatchObject({
            initialName: 'The Thing',
            initialProviderIds: { TMDb: '1091' },
            initialYear: 1982,
            supported: true
        });
        expect(controllerOperations.fetchIdentifyProviders).not.toHaveBeenCalled();
        expect(controllerOperations.searchIdentify).not.toHaveBeenCalled();
        expect(controllerOperations.applyIdentifyResult).not.toHaveBeenCalled();

        await render({
            bundle: itemBundle(),
            identifyPrefill: { ...validPrefill, itemId: 'another-item' },
            operations: controllerOperations
        });
        expect(standard(latest)).toMatchObject({
            initialName: 'Original title',
            initialProviderIds: { TMDb: 'current-id' },
            initialYear: 2020
        });
    });

    it('loads standard providers lazily and keeps a search failure visible until a successful retry', async () => {
        const provider: AdminMetadataProviderField = {
            available: true,
            key: 'TMDb',
            label: 'TheMovieDb',
            type: null,
            value: null
        };
        const fetchIdentifyProviders = vi.fn(async () => [ provider ]);
        const searchIdentify = vi.fn()
            .mockRejectedValueOnce(new AdminMetadataManagerServiceError('identify-unavailable', 'Provider search failed.'))
            .mockResolvedValueOnce([ identifyResult() ]);
        await render({
            bundle: itemBundle(),
            operations: operations(itemBundle(), { fetchIdentifyProviders, searchIdentify })
        });

        await act(async () => standard(latest).onLoadProviders());
        await vi.waitFor(() => expect(standard(latest).providerFields).toEqual([ provider ]));

        const query = { name: 'The Thing', providerIds: {}, year: 1982 };
        await act(async () => standard(latest).onSearch(query));
        await vi.waitFor(() => expect(standard(latest).error).toBe('Provider search failed.'));
        await act(async () => Promise.resolve());
        expect(standard(latest).error).toBe('Provider search failed.');

        await act(async () => standard(latest).onSearch(query));
        await vi.waitFor(() => expect(standard(latest).results).toEqual([ identifyResult() ]));
        expect(standard(latest).error).toBeNull();
        expect(searchIdentify).toHaveBeenLastCalledWith({ itemType: 'Movie', query });
    });

    it('ignores an older standard search response after a newer search completes', async () => {
        const first = deferred<readonly AdminMetadataIdentifyResult[]>();
        const second = deferred<readonly AdminMetadataIdentifyResult[]>();
        const searchIdentify = vi.fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        await render({
            bundle: itemBundle(),
            operations: operations(itemBundle(), { searchIdentify })
        });

        await act(async () => {
            standard(latest).onSearch({ name: 'First', providerIds: {}, year: null });
            await Promise.resolve();
        });
        await act(async () => {
            standard(latest).onSearch({ name: 'Second', providerIds: {}, year: null });
            await Promise.resolve();
        });
        await act(async () => second.resolve([ identifyResult('Second result') ]));
        await vi.waitFor(() => expect(standard(latest).results[0]?.name).toBe('Second result'));
        await act(async () => first.resolve([ identifyResult('First result') ]));

        expect(standard(latest).results[0]?.name).toBe('Second result');
        expect(standard(latest).searching).toBe(false);
    });

    it('does not publish a provider response after the controller moves to another item', async () => {
        const itemAProviders = deferred<readonly AdminMetadataProviderField[]>();
        const providerB: AdminMetadataProviderField = {
            available: true,
            key: 'TVDb',
            label: 'TheTVDB',
            type: null,
            value: null
        };
        await render({
            bundle: itemBundle('item-a'),
            operations: operations(itemBundle('item-a'), {
                fetchIdentifyProviders: vi.fn(() => itemAProviders.promise)
            })
        });
        await act(async () => {
            standard(latest).onLoadProviders();
            await Promise.resolve();
        });

        await render({
            bundle: itemBundle('item-b'),
            operations: operations(itemBundle('item-b'), {
                fetchIdentifyProviders: vi.fn(async () => [ providerB ])
            })
        });
        await act(async () => standard(latest).onLoadProviders());
        await vi.waitFor(() => expect(standard(latest).providerFields).toEqual([ providerB ]));

        await act(async () => itemAProviders.resolve([ {
            available: true,
            key: 'TMDb',
            label: 'TheMovieDb',
            type: null,
            value: null
        } ]));
        expect(standard(latest).providerFields).toEqual([ providerB ]);
    });

    it('persists blocker and apply failures, then reports the authoritative saved bundle through onApplied', async () => {
        const saved = itemBundle('item-a', 'Movie', metadataForm({ name: 'Saved match' }));
        const applyIdentifyResult = vi.fn()
            .mockRejectedValueOnce(new AdminMetadataManagerServiceError('identify-unavailable', 'Jellyfin rejected the match.'))
            .mockResolvedValueOnce(saved);
        const onApplied = vi.fn();
        let blocked = 'Save or reset your metadata edits before applying an Identify match.';
        await render({
            applyBlocker: () => blocked,
            bundle: itemBundle(),
            onApplied,
            operations: operations(saved, { applyIdentifyResult })
        });

        let applyFailure: unknown;
        await act(async () => {
            try {
                await standard(latest).onApply(identifyResult());
            } catch (error) {
                applyFailure = error;
            }
        });
        expect(applyFailure).toBeInstanceOf(Error);
        expect((applyFailure as Error).message).toBe(blocked);
        await vi.waitFor(() => expect(standard(latest).applyError).toBe(blocked));
        expect(standard(latest).error).toBeNull();
        expect(applyIdentifyResult).not.toHaveBeenCalled();

        await act(async () => standard(latest).onClearApplyError());
        expect(standard(latest).applyError).toBeNull();

        blocked = '';
        applyFailure = null;
        await act(async () => {
            try {
                await standard(latest).onApply(identifyResult());
            } catch (error) {
                applyFailure = error;
            }
        });
        expect(applyFailure).toBeInstanceOf(Error);
        expect((applyFailure as Error).message).toBe('Jellyfin rejected the match.');
        await vi.waitFor(() => expect(standard(latest).applyError).toBe('Jellyfin rejected the match.'));
        await act(async () => Promise.resolve());
        expect(standard(latest).applyError).toBe('Jellyfin rejected the match.');
        expect(standard(latest).error).toBeNull();

        await act(async () => standard(latest).onApply(identifyResult()));
        await vi.waitFor(() => expect(standard(latest).message).toContain('Identify result applied'));
        expect(standard(latest).applyError).toBeNull();
        expect(onApplied).toHaveBeenCalledOnce();
        expect(onApplied).toHaveBeenCalledWith(saved);
    });

    it('returns structured Reading props, strips the caller item id, and applies only the chosen candidate', async () => {
        const candidate = readingCandidate();
        const response = readingResponse(candidate);
        const providers: readonly AdminReadingProviderStatus[] = [ {
            displayName: 'Comic Vine',
            message: null,
            provider: 'ComicVine',
            retryAfterSeconds: null,
            state: 'available'
        } ];
        const fetchReadingProviders = vi.fn(async () => ({ providers }));
        const searchReadingIdentify = vi.fn(async () => response);
        const saved = itemBundle('book-a', 'Book', metadataForm({ name: 'Deadpool #9' }));
        const applyIdentifyResult = vi.fn(async () => saved);
        const onApplied = vi.fn();
        await render({
            bundle: itemBundle('book-a', 'Book'),
            identifyPrefill: {
                issueNumber: '9',
                itemId: 'book-a',
                mediaClass: 'comic',
                name: 'Deadpool',
                provider: 'Comic Vine',
                providerIds: { ComicVine: '4000-77815' },
                seriesStartYear: 2019,
                seriesTitle: 'Deadpool',
                year: 2020
            },
            onApplied,
            operations: operations(saved, {
                applyIdentifyResult,
                fetchReadingProviders,
                searchReadingIdentify
            })
        });

        expect(latest.kind).toBe('reading');
        expect(reading(latest)).toMatchObject({
            initialIssueNumber: '9',
            initialMediaClass: 'comic',
            initialName: 'Deadpool',
            initialProvider: 'Comic Vine',
            initialProviderIds: { ComicVine: '4000-77815' },
            initialSeriesStartYear: 2019,
            initialSeriesTitle: 'Deadpool',
            initialYear: 2019,
            itemId: 'book-a'
        });
        expect(searchReadingIdentify).not.toHaveBeenCalled();
        expect(applyIdentifyResult).not.toHaveBeenCalled();

        await act(async () => reading(latest).onLoadProviders());
        await vi.waitFor(() => expect(reading(latest).providers).toEqual(providers));

        const request: AdminReadingMetadataSearchRequest = {
            issueNumber: '9',
            itemId: 'spoofed-item',
            mediaClass: 'comic',
            seriesTitle: 'Deadpool',
            title: 'Deadpool',
            year: 2019
        };
        await act(async () => reading(latest).onSearch(request));
        await vi.waitFor(() => expect(reading(latest).response).toBe(response));
        expect(searchReadingIdentify).toHaveBeenCalledWith({
            searchGeneration: expect.any(String),
            author: undefined,
            chapterNumber: undefined,
            isbn: undefined,
            issueNumber: '9',
            mediaClass: 'comic',
            provider: undefined,
            providerId: undefined,
            seriesTitle: 'Deadpool',
            title: 'Deadpool',
            volumeNumber: undefined,
            year: 2019
        });

        await act(async () => reading(latest).onApply(candidate, { assessmentContext: 'signed-context', assessmentDigest: 'digest-a', archiveRevision: 'revision-a', searchGeneration: 'generation-a', acknowledgedConflictCodes: [], acknowledgedUnverifiedCodes: [] }));
        expect(applyIdentifyResult).toHaveBeenCalledOnce();
        expect(applyIdentifyResult).toHaveBeenCalledWith(expect.objectContaining({
            readingCandidate: candidate,
            readingQuery: response.query
        }), expect.objectContaining({ approval: expect.objectContaining({ assessmentContext: 'signed-context' }), isCurrent: expect.any(Function) }));
        expect(onApplied).toHaveBeenCalledWith(saved);
        expect(reading(latest).message).toContain('Reading metadata applied');
    });
    it('rejects a removed candidate rather than substituting result zero', async () => {
        const saved = itemBundle('book-a', 'Book');
        const applyIdentifyResult = vi.fn(async () => saved);
        await render({ bundle: saved, operations: operations(saved, { applyIdentifyResult }) });
        await act(async () => {
            await expect(reading(latest).onApply(readingCandidate(), {
                assessmentContext: 'context', assessmentDigest: 'digest', archiveRevision: 'revision', searchGeneration: 'generation',
                acknowledgedConflictCodes: [], acknowledgedUnverifiedCodes: []
            })).rejects.toThrow();
        });
        expect(applyIdentifyResult).not.toHaveBeenCalled();
    });

    it.each([ true, false ])('creates distinct bounded search generations with crypto available: %s', async available => {
        if (!available) vi.stubGlobal('crypto', undefined);
        const saved = itemBundle('book-a', 'Book');
        const searchReadingIdentify = vi.fn<(request: Omit<AdminReadingMetadataSearchRequest, 'itemId'>) => Promise<AdminReadingMetadataSearchResponse>>(async () => readingResponse(readingCandidate()));
        await render({ bundle: saved, operations: operations(saved, { searchReadingIdentify }) });
        try {
            await act(async () => reading(latest).onSearch({ itemId: 'book-a', title: 'Synthetic' }));
            await act(async () => reading(latest).onSearch({ itemId: 'book-a', title: 'Synthetic' }));
            const generations = searchReadingIdentify.mock.calls.map(call => (call[0] as AdminReadingMetadataSearchRequest).searchGeneration);
            expect(generations[0]).toMatch(/^[a-zA-Z0-9-]{1,64}$/);
            expect(generations[1]).not.toBe(generations[0]);
        } finally { vi.unstubAllGlobals(); }
    });

    it('rejects retained callbacks after another search and old Plugin results without context', async () => {
        const saved = itemBundle('book-a', 'Book');
        const oldCandidate = readingCandidate({ assessmentContext: null });
        const applyIdentifyResult = vi.fn(async () => saved);
        const searchReadingIdentify = vi.fn(async () => readingResponse(oldCandidate));
        await render({ bundle: saved, operations: operations(saved, { applyIdentifyResult, searchReadingIdentify }) });
        const approval = { assessmentContext: 'signed-context', assessmentDigest: 'digest-a', archiveRevision: 'revision-a',
            searchGeneration: 'generation-a', acknowledgedConflictCodes: [], acknowledgedUnverifiedCodes: [] };
        await act(async () => reading(latest).onSearch({ itemId: 'book-a', title: 'Synthetic' }));
        const previousApply = reading(latest).onApply;
        await act(async () => {
            await expect(previousApply(oldCandidate, approval)).rejects.toThrow();
        });
        await act(async () => reading(latest).onSearch({ itemId: 'book-a', title: 'Another' }));
        await act(async () => {
            await expect(previousApply(oldCandidate, approval)).rejects.toThrow();
        });
        await act(async () => {
            await expect(reading(latest).onApply(readingCandidate(), approval)).rejects.toThrow();
        });
        expect(applyIdentifyResult).not.toHaveBeenCalled();
    });
});
