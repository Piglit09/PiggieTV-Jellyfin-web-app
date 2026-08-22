import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getAdminMetadataIdentifyType } from './adminMetadataManagerAdapters';
import {
    createAdminMetadataManagerIdentifyHandoff,
    readAdminMetadataManagerIdentifyHandoff,
    type AdminMetadataManagerIdentifyPrefill
} from './adminMetadataManagerIdentifyHandoff';
import {
    AdminMetadataManagerServiceError,
    type AdminMetadataIdentifyQuery,
    type AdminMetadataIdentifyResult,
    type AdminMetadataIdentifyType,
    type AdminMetadataItemBundle,
    type AdminMetadataProviderField
} from './adminMetadataManagerModel';
import type { AdminMetadataIdentifyWorkflowProps } from './AdminMetadataManagerWorkflows';
import type { AdminReadingIdentifyWorkflowProps } from './AdminReadingIdentifyWorkflow';
import { toAdminMetadataIdentifyResult } from './adminReadingMetadataAdapters';
import type {
    AdminReadingMetadataProvidersResponse,
    AdminReadingMetadataSearchRequest,
    AdminReadingMetadataSearchResponse
} from './adminReadingMetadataModel';

type StandardIdentifySearchRequest = Readonly<{
    itemType: AdminMetadataIdentifyType;
    query: AdminMetadataIdentifyQuery;
}>;

export type AdminMetadataIdentifyControllerOperations = Readonly<{
    activeMutation: string | null;
    applyIdentifyResult: (result: AdminMetadataIdentifyResult) => Promise<AdminMetadataItemBundle>;
    fetchIdentifyProviders: () => Promise<readonly AdminMetadataProviderField[]>;
    fetchReadingProviders: () => Promise<AdminReadingMetadataProvidersResponse>;
    searchIdentify: (request: StandardIdentifySearchRequest) => Promise<readonly AdminMetadataIdentifyResult[]>;
    searchReadingIdentify: (
        request: Omit<AdminReadingMetadataSearchRequest, 'itemId'>
    ) => Promise<AdminReadingMetadataSearchResponse>;
}>;

export type UseAdminMetadataIdentifyControllerInput = Readonly<{
    applyBlocker?: () => string | null | undefined;
    bundle: AdminMetadataItemBundle;
    identifyPrefill?: AdminMetadataManagerIdentifyPrefill | null;
    onApplied?: (bundle: AdminMetadataItemBundle) => void;
    operations: AdminMetadataIdentifyControllerOperations;
}>;

export type AdminMetadataStandardIdentifyController = Readonly<{
    kind: 'standard';
    workflowKey: string;
    workflowProps: Readonly<{
        identify: AdminMetadataIdentifyWorkflowProps;
        itemId: string;
        itemName: string;
        itemType: string;
    }>;
}>;

export type AdminMetadataReadingIdentifyController = Readonly<{
    kind: 'reading';
    workflowKey: string;
    workflowProps: AdminReadingIdentifyWorkflowProps;
}>;

export type AdminMetadataIdentifyController =
    | AdminMetadataReadingIdentifyController
    | AdminMetadataStandardIdentifyController;

function safeMessage(error: unknown, fallback: string) {
    return error instanceof AdminMetadataManagerServiceError ? error.message : fallback;
}

/**
 * Reuses the bounded Metadata Quality handoff validator without treating a
 * caller-provided object as trusted metadata. The immutable item must match.
 */
export function validateAdminMetadataIdentifyPrefill(
    prefill: AdminMetadataManagerIdentifyPrefill | null | undefined,
    itemId: string
) {
    if (!prefill) return null;
    const handoff = createAdminMetadataManagerIdentifyHandoff(prefill);
    return handoff ? readAdminMetadataManagerIdentifyHandoff(handoff, itemId) : null;
}

function prefillKey(prefill: AdminMetadataManagerIdentifyPrefill | null) {
    if (!prefill) return 'authoritative';
    return JSON.stringify({
        issueNumber: prefill.issueNumber ?? null,
        mediaClass: prefill.mediaClass ?? null,
        name: prefill.name,
        provider: prefill.provider ?? null,
        providerIds: Object.entries(prefill.providerIds).sort(([ left ], [ right ]) => left.localeCompare(right)),
        seriesStartYear: prefill.seriesStartYear ?? null,
        seriesTitle: prefill.seriesTitle ?? null,
        year: prefill.year
    });
}

function readingRequestWithoutItemId(
    request: AdminReadingMetadataSearchRequest
): Omit<AdminReadingMetadataSearchRequest, 'itemId'> {
    return {
        author: request.author,
        chapterNumber: request.chapterNumber,
        isbn: request.isbn,
        issueNumber: request.issueNumber,
        mediaClass: request.mediaClass,
        provider: request.provider,
        providerId: request.providerId,
        seriesTitle: request.seriesTitle,
        title: request.title,
        volumeNumber: request.volumeNumber,
        year: request.year
    };
}

/**
 * Shared state machine for standard and Reading Identify. Provider suggestions
 * are search hints only; only an explicitly selected provider result reaches
 * applyIdentifyResult.
 */
export function useAdminMetadataIdentifyController(
    input: UseAdminMetadataIdentifyControllerInput
): AdminMetadataIdentifyController {
    const {
        activeMutation,
        applyIdentifyResult,
        fetchIdentifyProviders,
        fetchReadingProviders,
        searchIdentify,
        searchReadingIdentify
    } = input.operations;
    const { bundle } = input;
    const itemId = bundle.item.id;
    const itemName = bundle.form.name;
    const itemType = bundle.item.type;
    const identifyType = getAdminMetadataIdentifyType(itemType);
    const validatedPrefill = useMemo(
        () => validateAdminMetadataIdentifyPrefill(input.identifyPrefill, itemId),
        [ input.identifyPrefill, itemId ]
    );
    const workflowKey = `${itemId}:${prefillKey(validatedPrefill)}`;
    const activeScopeRef = useRef(workflowKey);
    activeScopeRef.current = workflowKey;

    const [ identifyProviders, setIdentifyProviders ] = useState<readonly AdminMetadataProviderField[]>([]);
    const [ identifyProviderError, setIdentifyProviderError ] = useState<string | null>(null);
    const [ identifyProvidersLoading, setIdentifyProvidersLoading ] = useState(false);
    const [ identifyResults, setIdentifyResults ] = useState<readonly AdminMetadataIdentifyResult[]>([]);
    const [ readingProviders, setReadingProviders ] = useState<AdminReadingMetadataProvidersResponse['providers']>([]);
    const [ readingProviderError, setReadingProviderError ] = useState<string | null>(null);
    const [ readingProvidersLoading, setReadingProvidersLoading ] = useState(false);
    const [ readingResponse, setReadingResponse ] = useState<AdminReadingMetadataSearchResponse | null>(null);
    const [ searchError, setSearchError ] = useState<string | null>(null);
    const [ applyError, setApplyError ] = useState<string | null>(null);
    const [ message, setMessage ] = useState<string | null>(null);
    const [ searching, setSearching ] = useState(false);
    const [ applyPending, setApplyPending ] = useState(false);
    const providerFlightsRef = useRef(new Set<string>());
    const searchGenerationRef = useRef(0);
    const applyFlightsRef = useRef(new Map<string, Promise<void>>());

    useEffect(() => {
        searchGenerationRef.current += 1;
        setIdentifyProviders([]);
        setIdentifyProviderError(null);
        setIdentifyProvidersLoading(false);
        setIdentifyResults([]);
        setReadingProviders([]);
        setReadingProviderError(null);
        setReadingProvidersLoading(false);
        setReadingResponse(null);
        setSearchError(null);
        setApplyError(null);
        setMessage(null);
        setSearching(false);
        setApplyPending(false);
    }, [ workflowKey ]);

    const loadIdentifyProviders = useCallback(async () => {
        if (!identifyType) return;
        const scope = workflowKey;
        const flightKey = `${scope}:standard-providers`;
        if (providerFlightsRef.current.has(flightKey)) return;
        providerFlightsRef.current.add(flightKey);
        setIdentifyProvidersLoading(true);
        setIdentifyProviderError(null);
        try {
            const providers = await fetchIdentifyProviders();
            if (activeScopeRef.current === scope) setIdentifyProviders(providers);
        } catch (error) {
            if (activeScopeRef.current === scope) {
                setIdentifyProviderError(safeMessage(error, 'Identify providers are unavailable.'));
            }
        } finally {
            providerFlightsRef.current.delete(flightKey);
            if (activeScopeRef.current === scope) setIdentifyProvidersLoading(false);
        }
    }, [ fetchIdentifyProviders, identifyType, workflowKey ]);

    const loadReadingProviders = useCallback(async () => {
        const scope = workflowKey;
        const flightKey = `${scope}:reading-providers`;
        if (providerFlightsRef.current.has(flightKey)) return;
        providerFlightsRef.current.add(flightKey);
        setReadingProvidersLoading(true);
        setReadingProviderError(null);
        try {
            const response = await fetchReadingProviders();
            if (activeScopeRef.current === scope) setReadingProviders(response.providers);
        } catch (error) {
            if (activeScopeRef.current === scope) {
                setReadingProviderError(safeMessage(error, 'Reading metadata providers are unavailable.'));
            }
        } finally {
            providerFlightsRef.current.delete(flightKey);
            if (activeScopeRef.current === scope) setReadingProvidersLoading(false);
        }
    }, [ fetchReadingProviders, workflowKey ]);

    const beginSearch = useCallback((scope: string) => {
        const generation = searchGenerationRef.current + 1;
        searchGenerationRef.current = generation;
        setSearching(true);
        setSearchError(null);
        setApplyError(null);
        setMessage(null);
        return { generation, scope } as const;
    }, []);

    const isCurrentSearch = useCallback((scope: string, generation: number) => (
        activeScopeRef.current === scope && searchGenerationRef.current === generation
    ), []);
    const clearApplyError = useCallback(() => setApplyError(null), []);

    const runIdentifySearch = useCallback(async (query: AdminMetadataIdentifyQuery) => {
        if (!identifyType) return;
        const search = beginSearch(workflowKey);
        setIdentifyResults([]);
        try {
            const results = await searchIdentify({ itemType: identifyType, query });
            if (!isCurrentSearch(search.scope, search.generation)) return;
            setIdentifyResults(results);
            if (!results.length) setMessage('No matching provider results were found.');
        } catch (error) {
            if (isCurrentSearch(search.scope, search.generation)) {
                setSearchError(safeMessage(error, 'Identify results could not be loaded.'));
            }
        } finally {
            if (isCurrentSearch(search.scope, search.generation)) setSearching(false);
        }
    }, [ beginSearch, identifyType, isCurrentSearch, searchIdentify, workflowKey ]);

    const runReadingSearch = useCallback(async (request: AdminReadingMetadataSearchRequest) => {
        const search = beginSearch(workflowKey);
        setReadingResponse(null);
        try {
            const response = await searchReadingIdentify(readingRequestWithoutItemId(request));
            if (!isCurrentSearch(search.scope, search.generation)) return;
            setReadingResponse(response);
            if (!response.candidates.length) setMessage('No matching provider results were found.');
        } catch (error) {
            if (isCurrentSearch(search.scope, search.generation)) {
                setSearchError(safeMessage(error, 'Reading identification results could not be loaded.'));
            }
        } finally {
            if (isCurrentSearch(search.scope, search.generation)) setSearching(false);
        }
    }, [ beginSearch, isCurrentSearch, searchReadingIdentify, workflowKey ]);

    const runApply = useCallback((result: AdminMetadataIdentifyResult, successMessage: string) => {
        const scope = workflowKey;
        const active = applyFlightsRef.current.get(scope);
        if (active) return active;

        // Defer work one microtask so the flight is registered even when an
        // apply blocker rejects before the first network await.
        const promise = Promise.resolve().then(async () => {
            setApplyPending(true);
            setApplyError(null);
            setSearchError(null);
            setMessage(null);
            let blockerMessage: string | null = null;
            try {
                blockerMessage = input.applyBlocker?.()?.trim() || null;
                if (blockerMessage) {
                    throw new AdminMetadataManagerServiceError('invalid-input', blockerMessage);
                }
                const saved = await applyIdentifyResult(result);
                if (activeScopeRef.current !== scope) return;
                input.onApplied?.(saved);
                setMessage(successMessage);
            } catch (error) {
                if (activeScopeRef.current === scope) {
                    // A local blocker is already bounded application copy. Keep
                    // it exact even if HMR/chunk boundaries break instanceof.
                    setApplyError(blockerMessage || safeMessage(error, "The Identify match couldn't be applied."));
                }
                throw error;
            } finally {
                applyFlightsRef.current.delete(scope);
                if (activeScopeRef.current === scope) setApplyPending(false);
            }
        });
        applyFlightsRef.current.set(scope, promise);
        return promise;
    }, [ applyIdentifyResult, input.applyBlocker, input.onApplied, workflowKey ]);

    const initialName = validatedPrefill?.name || bundle.form.name || '';
    const initialProviderIds = validatedPrefill?.providerIds || bundle.form.providerIds || {};
    const initialYear = validatedPrefill ? validatedPrefill.year : bundle.form.productionYear ?? null;
    const applying = applyPending || activeMutation === 'apply-identify';

    if (itemType === 'Book') {
        return {
            kind: 'reading',
            workflowKey,
            workflowProps: {
                applyError,
                applying,
                error: searchError,
                initialIssueNumber: validatedPrefill?.issueNumber,
                initialMediaClass: validatedPrefill?.mediaClass,
                initialName,
                initialProvider: validatedPrefill?.provider,
                initialProviderIds,
                initialSeriesStartYear: validatedPrefill?.seriesStartYear,
                initialSeriesTitle: validatedPrefill?.seriesTitle,
                initialYear: validatedPrefill ?
                    validatedPrefill.seriesStartYear ?? validatedPrefill.year :
                    bundle.form.productionYear ?? null,
                itemId,
                itemName,
                message,
                onApply: candidate => {
                    const candidateIndex = readingResponse?.candidates.indexOf(candidate) ?? -1;
                    return runApply(
                        toAdminMetadataIdentifyResult(
                            candidate,
                            candidateIndex < 0 ? 0 : candidateIndex,
                            readingResponse?.query
                        ),
                        'Reading metadata applied. Locked fields and artwork were preserved.'
                    );
                },
                onClearApplyError: clearApplyError,
                onLoadProviders: loadReadingProviders,
                onRetryProviders: loadReadingProviders,
                onSearch: runReadingSearch,
                providerError: readingProviderError,
                providers: readingProviders,
                providersLoading: readingProvidersLoading,
                response: readingResponse,
                searching
            }
        };
    }

    return {
        kind: 'standard',
        workflowKey,
        workflowProps: {
            identify: {
                applyError,
                applying,
                error: searchError,
                initialName,
                initialProviderIds,
                initialYear,
                message,
                onApply: result => runApply(
                    result,
                    'Identify result applied. Jellyfin may continue processing the item.'
                ),
                onClearApplyError: clearApplyError,
                onLoadProviders: loadIdentifyProviders,
                onRetryProviders: loadIdentifyProviders,
                onSearch: runIdentifySearch,
                providerError: identifyProviderError,
                providerFields: identifyProviders,
                providersLoading: identifyProvidersLoading,
                results: identifyResults,
                searching,
                supported: Boolean(identifyType)
            },
            itemId,
            itemName,
            itemType
        }
    };
}
