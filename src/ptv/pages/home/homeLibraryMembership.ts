import { HomeOwnershipReadBudget, type HomeOwnershipReadKind } from './homeOwnershipReadBudget';
import { getPtvCurrentUserId, getPtvServerId } from '../../api/client';
import { getPtvItems } from '../../api/items';
import { getPtvUserViews } from '../../api/libraries';
import type { PtvItemQuery } from '../../api/types';
import { createPtvAbortController } from '../../core/abortController';
import { recordPtvEvent } from '../../core/observability';
import type { HomeLibraryOwnershipClaim } from './homeLibraryOwnership';

const PAGE_SIZE = 200;
const MAX_PAGES_PER_LIBRARY = 3;
const MAX_LIBRARIES = 8;
const MAX_CONCURRENT_READS = 2;
const READ_TIMEOUT_MS = 10_000;

type LibraryClaim = Extract<HomeLibraryOwnershipClaim, { kind: 'library' }>;
type ItemsPage = { Items?: Array<{ Id?: string; Type?: string }>; StartIndex?: number; TotalRecordCount?: number };
type ViewsPage = { Items?: Array<{ Id?: string; CollectionType?: string }> };
type ReadOptions = { serverId: string; userId: string; signal: AbortSignal };
type ReadViewsOptions = ReadOptions & { scope: 'route' };

export type HomeLibraryMembershipProof = Readonly<{
    status: 'verified' | 'partial' | 'rejected';
    provenIds: ReadonlySet<string>;
    reason?: string;
}>;

type AuthorityOptions = Readonly<{
    serverId: string;
    userId: string;
    generation: string | number;
    signal?: AbortSignal;
    isCurrent: () => boolean;
    budget?: HomeOwnershipReadBudget;
    readViews?: (options: ReadViewsOptions) => Promise<unknown>;
    readItems?: (query: Record<string, unknown>, options: ReadOptions) => Promise<unknown>;
}>;

type ScopeState = {
    libraryId: string;
    structuralTypes: readonly string[];
    requested: Set<string>;
    found: Set<string>;
    seen: Set<string>;
    start: number;
    total: number | null;
    complete: boolean;
    failed: string | null;
    running: Promise<void> | null;
};

type ReadTask = {
    read: () => Promise<unknown>;
    resolve: (result: unknown) => void;
    reject: (reason: unknown) => void;
};

const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const normalizedId = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const emptyProof = (reason: string): HomeLibraryMembershipProof =>
    ({ status: 'rejected', provenIds: new Set<string>(), reason });
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

function hasMatchingView(views: ViewsPage | null, claim: LibraryClaim) {
    const matches = views?.Items?.filter(view => normalizedId(view.Id) === claim.libraryId) || [];
    return matches.length === 1 && matches[0].CollectionType === claim.expectedCollectionType;
}

function getStructuralTypeSet(types: readonly string[]) {
    const values = [ ...new Set(types) ].sort((left, right) => left.localeCompare(right));
    return values.length && values.every(type => [ 'Movie', 'MusicAlbum', 'Series' ].includes(type)) ? values : null;
}

/** One user-scoped authority for one active Home visit. Never persist its proof. */
export function createHomeLibraryMembershipAuthority(options: AuthorityOptions) {
    const budget = options.budget || new HomeOwnershipReadBudget();
    const controller = createPtvAbortController();
    const scopes = new Map<string, ScopeState>();
    const libraries = new Set<string>();
    const pagesByLibrary = new Map<string, number>();
    const queue: ReadTask[] = [];
    const emittedRows = new Set<string>();
    const readViews = options.readViews || getPtvUserViews;
    const readItems = options.readItems || ((query: Record<string, unknown>, readOptions: ReadOptions) =>
        getPtvItems(query as PtvItemQuery, readOptions));
    let retiredReason: string | null = null;
    let viewsPromise: Promise<ViewsPage | null> | null = null;
    let activeReads = 0;
    let logicalRequests = 0;
    let physicalRequests = 0;
    let verifiedCount = 0;
    let rejectedCount = 0;
    let ceilingReported = false;

    const current = () => {
        const hasGeneration = typeof options.generation === 'string' || typeof options.generation === 'number';
        if (retiredReason || options.signal?.aborted || controller.signal.aborted
            || !options.serverId || !options.userId || !hasGeneration
            || typeof options.isCurrent !== 'function') return false;
        try {
            return normalizedId(getPtvServerId()) === normalizedId(options.serverId)
                && normalizedId(getPtvCurrentUserId(options.serverId)) === normalizedId(options.userId)
                && options.isCurrent();
        } catch {
            return false;
        }
    };

    const rejectQueue = () => {
        while (queue.length) queue.shift()?.reject(new Error('Home membership authority retired.'));
    };

    const retire = (reason = 'route-retired') => {
        if (retiredReason) return;
        retiredReason = reason;
        controller.abort();
        rejectQueue();
        scopes.clear();
        recordPtvEvent('row-fetch', 'home-verification-route-retired', { reason });
    };

    const assertCurrent = () => {
        if (!current()) {
            retire('identity-or-generation-changed');
            throw new Error('Home membership authority retired.');
        }
    };

    const startRequest = (kind: HomeOwnershipReadKind) => {
        assertCurrent();
        if (!budget.reserve(kind)) {
            if (!ceilingReported) {
                ceilingReported = true;
                recordPtvEvent('row-fetch', 'home-request-ceiling', {
                    logicalRequests, physicalRequests, generation: String(options.generation)
                });
            }
            throw new Error('home-request-ceiling');
        }
        logicalRequests += 1;
        physicalRequests += 1;
    };

    const timedRead = (read: () => Promise<unknown>): Promise<unknown> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        const aborted = new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(new Error('Home membership authority retired.'));
            controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
                retire('timeout');
                reject(new Error('Home membership read timed out.'));
            }, READ_TIMEOUT_MS);
        });
        return Promise.race([ Promise.resolve().then(read), aborted, timeout ]).finally(() => {
            if (timer) clearTimeout(timer);
            if (onAbort) controller.signal.removeEventListener('abort', onAbort);
        });
    };

    const pump = () => {
        if (!current()) {
            rejectQueue();
            return;
        }
        while (activeReads < MAX_CONCURRENT_READS && queue.length) {
            const task = queue.shift()!;
            activeReads += 1;
            timedRead(async () => {
                startRequest('items');
                return task.read();
            }).then(task.resolve, task.reject).finally(() => {
                activeReads -= 1;
                pump();
            });
        }
    };

    const scheduledRead = (read: () => Promise<unknown>) => new Promise<unknown>((resolve, reject) => {
        queue.push({ read, resolve, reject });
        pump();
    });

    const getViews = () => {
        if (!viewsPromise) {
            viewsPromise = timedRead(async () => {
                startRequest('views');
                return readViews({ serverId: options.serverId, userId: options.userId,
                    scope: 'route', signal: controller.signal });
            }).then(value => {
                assertCurrent();
                const page = record(value);
                if (!Array.isArray(page?.Items) || !isCount(page.TotalRecordCount)
                    || page.TotalRecordCount !== page.Items.length
                    || page.StartIndex !== undefined && page.StartIndex !== 0) return null;
                return page as ViewsPage;
            }).catch(() => null);
        }
        return viewsPromise;
    };

    const validPage = (value: unknown, state: ScopeState): ItemsPage | null => {
        const page = record(value);
        if (!page || !Array.isArray(page.Items) || page.Items.length > PAGE_SIZE
            || !isCount(page.TotalRecordCount) || page.TotalRecordCount < state.start + page.Items.length
            || page.StartIndex !== undefined && page.StartIndex !== state.start
            || state.total !== null && page.TotalRecordCount !== state.total
            || page.Items.length === 0 && state.start < page.TotalRecordCount
            || page.Items.length < PAGE_SIZE && state.start + page.Items.length < page.TotalRecordCount) return null;
        const items = page.Items as unknown[];
        const pageIds = new Set<string>();
        for (const itemValue of items) {
            const item = record(itemValue);
            const id = normalizedId(item?.Id);
            if (!id || !state.structuralTypes.includes(String(item?.Type || ''))
                || pageIds.has(id) || state.seen.has(id)) return null;
            pageIds.add(id);
        }
        return page as ItemsPage;
    };

    const scan = async (state: ScopeState) => {
        try {
            while (!state.complete && !state.failed && state.start < PAGE_SIZE * MAX_PAGES_PER_LIBRARY
                && (pagesByLibrary.get(state.libraryId) || 0) < MAX_PAGES_PER_LIBRARY
                && [ ...state.requested ].some(id => !state.found.has(id))) {
                assertCurrent();
                pagesByLibrary.set(state.libraryId, (pagesByLibrary.get(state.libraryId) || 0) + 1);
                const value = await scheduledRead(() => readItems({ ParentId: state.libraryId,
                    Recursive: true, IncludeItemTypes: state.structuralTypes.join(','),
                    Limit: PAGE_SIZE, StartIndex: state.start, EnableTotalRecordCount: true,
                    SortBy: 'SortName', SortOrder: 'Ascending', EnableImages: false }, {
                    serverId: options.serverId, userId: options.userId, signal: controller.signal
                }));
                assertCurrent();
                const page = validPage(value, state);
                if (!page) throw new Error('page-drift');
                state.total = page.TotalRecordCount!;
                for (const item of page.Items || []) {
                    const id = normalizedId(item.Id);
                    state.seen.add(id);
                    if (state.requested.has(id)) state.found.add(id);
                }
                state.start += page.Items!.length;
                state.complete = state.start >= state.total;
            }
        } catch (error) {
            state.failed = record(error)?.message === 'home-request-ceiling' ? 'home-request-ceiling' :
                retiredReason || 'home-membership-unresolved';
            state.found.clear();
        }
    };

    const emitSummary = (claim: LibraryClaim, result: HomeLibraryMembershipProof, candidateCount: number) => {
        const key = `${claim.ruleId}\u0000${claim.sectionId}`;
        if (emittedRows.has(key)) return;
        emittedRows.add(key);
        verifiedCount += result.provenIds.size;
        rejectedCount += Math.max(0, candidateCount - result.provenIds.size);
        recordPtvEvent('row-fetch', 'home-membership-summary', {
            generation: String(options.generation), ruleId: claim.ruleId, sectionId: claim.sectionId,
            logicalRequests, physicalRequests, verifiedCount: result.provenIds.size,
            rejectedCount: Math.max(0, candidateCount - result.provenIds.size),
            reason: result.reason || result.status
        });
    };

    const ensureScanned = async (state: ScopeState, requested: ReadonlySet<string>) => {
        requested.forEach(id => {
            state.requested.add(id);
            if (state.seen.has(id)) state.found.add(id);
        });
        while (!state.failed && !state.complete && state.start < PAGE_SIZE * MAX_PAGES_PER_LIBRARY
            && (pagesByLibrary.get(state.libraryId) || 0) < MAX_PAGES_PER_LIBRARY
            && [ ...requested ].some(id => !state.found.has(id))) {
            if (!state.running) {
                state.running = scan(state).finally(() => {
                    state.running = null;
                });
            }
            await state.running;
            assertCurrent();
        }
    };

    const prove = async (claim: LibraryClaim, candidateIds: readonly string[]): Promise<HomeLibraryMembershipProof> => {
        const requested = new Set(candidateIds.map(normalizedId).filter(Boolean));
        let result: HomeLibraryMembershipProof = emptyProof('home-membership-unresolved');
        try {
            assertCurrent();
            if (!requested.size) {
                result = { status: 'verified', provenIds: new Set<string>() };
                return result;
            }
            if (!libraries.has(claim.libraryId) && libraries.size >= MAX_LIBRARIES) {
                result = emptyProof('home-request-ceiling');
                return result;
            }
            libraries.add(claim.libraryId);
            const views = await getViews();
            assertCurrent();
            if (!hasMatchingView(views, claim)) {
                result = emptyProof('home-scope-unresolved');
                return result;
            }
            const structuralTypes = getStructuralTypeSet(claim.structuralTypes);
            if (!structuralTypes) {
                result = emptyProof('home-scope-unresolved');
                return result;
            }
            const key = `${claim.libraryId}\u0000${structuralTypes.join(',')}`;
            let state = scopes.get(key);
            if (!state) {
                state = { libraryId: claim.libraryId, structuralTypes, requested: new Set(), found: new Set(),
                    seen: new Set(), start: 0, total: null, complete: false, failed: null, running: null };
                scopes.set(key, state);
            }
            await ensureScanned(state, requested);
            if (state.failed) {
                result = emptyProof(state.failed);
            } else {
                const provenIds = new Set([ ...requested ].filter(id => state.found.has(id)));
                const capped = (pagesByLibrary.get(state.libraryId) || 0) >= MAX_PAGES_PER_LIBRARY && !state.complete;
                result = { status: capped ? 'partial' : 'verified', provenIds };
            }
            return result;
        } catch {
            result = emptyProof(retiredReason || 'home-membership-unresolved');
            return result;
        } finally {
            emitSummary(claim, result, requested.size);
        }
    };

    if (options.signal?.aborted) retire('route-retired');
    else options.signal?.addEventListener('abort', () => retire('route-retired'), { once: true });

    return {
        prove,
        retire,
        getStats: () => ({ logicalRequests, physicalRequests, verifiedCount, rejectedCount,
            libraryCount: libraries.size, retired: Boolean(retiredReason) })
    };
}
