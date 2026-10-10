import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(next => {
        resolve = next;
    });
    return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
    userId: 'user-a',
    admin: true,
    apiClient: {
        getCurrentUserId: () => mocks.userId,
        serverId: () => 'server-a',
        serverInfo: () => ({ Id: 'server-a' })
    },
    cached: vi.fn(),
    endpoint: vi.fn(),
    items: vi.fn(),
    views: vi.fn(),
    settings: vi.fn(),
    status: vi.fn(),
    currentUser: vi.fn(),
    resume: vi.fn(),
    recentlyAdded: vi.fn(),
    requestJson: vi.fn(),
    event: vi.fn()
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: { currentApiClient: () => null, getApiClient: () => null }
}));
vi.mock('../../api', () => ({
    getCurrentPtvApiClient: () => mocks.apiClient,
    getPtvCurrentUser: mocks.currentUser,
    getPtvCurrentUserId: () => mocks.userId,
    getPtvServerId: () => 'server-a',
    getPtvItems: mocks.items,
    getPtvRecentlyAdded: mocks.recentlyAdded,
    getPtvResumeItems: mocks.resume,
    isPtvAdminUser: () => mocks.admin,
    requestPtvJson: mocks.requestJson
}));
vi.mock('../../api/client', () => ({
    getPtvCurrentUserId: () => mocks.userId,
    getPtvServerId: () => 'server-a'
}));
vi.mock('../../api/items', () => ({ getPtvItems: mocks.items }));
vi.mock('../../api/libraries', () => ({ getPtvUserViews: mocks.views }));
vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => ({
        getFeaturedContentCacheDocument: mocks.endpoint,
        getRows: vi.fn(async () => null),
        getSettings: mocks.settings,
        getStatus: mocks.status
    }),
    normalizePtvApiError: (error: unknown) => ({ kind: 'server', message: String(error) })
}));
vi.mock('../../modules/cache/featuredContentCache', () => ({
    getCachedFeaturedContentPayload: mocks.cached,
    getFeaturedContentCacheStatus: () => ({ adoptionResult: 'accepted', cacheVersion: 9,
        isFresh: true, lastRejectionReason: null, payloadClassification: 'usable' }),
    getPtvFeaturedRowConfigHash: (settings: { rules?: { libraryScope?: { virtualFolderId?: string } }[] }) =>
        settings.rules?.some(rule => rule.libraryScope?.virtualFolderId === 'c'.repeat(32)) ?
            'changed-config-hash' : 'current-config-hash'
}));
vi.mock('../../core/clientProfile', () => ({
    getPtvPerformanceProfile: () => ({ isFireTv: false, isLowPower: false })
}));
vi.mock('../../core/observability', () => ({
    recordPtvEvent: mocks.event,
    recordPtvTiming: vi.fn(),
    shouldCollectDiagnostics: () => false,
    timePtvAsync: (_category: string, _name: string, task: () => Promise<unknown>) => task()
}));
vi.mock('../../shell/foundation', () => ({
    clearPtvShellStatus: vi.fn(),
    setPtvShellError: vi.fn(),
    setPtvShellLoading: vi.fn()
}));

import { getRowsEndpointSettingsHash, retireNativeHomeIdentityState, useNativeHomeData } from './hooks';
import { acceptHomeLibraryAuthority, beginHomeLibraryVerification, getHomeLibraryAuthoritySnapshot,
    isHomeLibraryAuthorityRetired, observeHomeLibraryAuthority, retireHomeLibraryAuthority } from './homeLibraryTransitionFreshness';
import { computeHomeResolvedScopeHash } from './homeLibraryOwnership';
import { retireConfiguredRowFreshness } from './configuredRowFreshness';

const libraryId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const associationScope = 'b'.repeat(64);
const associationRule = 'c'.repeat(64);
const associationSection = 'd'.repeat(64);
const presentationGeneration = 'e'.repeat(64);
const owned = { Id: 'owned', Name: 'Owned', Type: 'Movie' };
const foreign = { Id: 'foreign', Name: 'Foreign', Type: 'Movie' };
const globalItem = { Id: 'global', Name: 'Global', Type: 'Movie' };
const currentPresentationAuthority = () => ({ version: 1, scope: associationScope, generation: presentationGeneration });
const ownedRule = () => ({ id: 'latest-movies', name: 'Latest Movies', enabled: true,
    sourceType: 'latest', sourceValue: 'movies', mediaType: 'movies', rowCount: 1, itemLimit: 16,
    libraryScope: { mode: 'defaultLibrary', defaultKey: 'movies', virtualFolderId: libraryId } });
const rowSettings = () => ({
    currentPresentationAuthority: currentPresentationAuthority(),
    configuredRowAssociations: { version: 1, scope: associationScope,
        rules: [ { ruleId: 'latest-movies', association: associationRule } ],
        sections: [ { rule: associationRule, section: associationSection } ] },
    enabled: true, schemaVersion: 3, defaultsInitialized: true, showConfiguredRowsOnHome: true,
    rowSettings: { showConfiguredRowsOnHome: true, enableConfiguredRows: true },
    rules: [ ownedRule() ], categories: []
});
const currentScope = <T extends { scopeSchemaVersion: number }>(payload: T) => ({ ...payload, scopeSchemaVersion: 2 });
const featured = () => currentScope({
    currentPresentationAuthority: currentPresentationAuthority(),
    heroItems: [], rowConfigApplied: true, rowConfigVersion: 3,
    rowConfigHash: getRowsEndpointSettingsHash(rowSettings()), scopeSchemaVersion: 1,
    sectionItems: { owned: [ foreign, owned ], global: [ globalItem ] },
    sections: [
        { id: 'owned', source: 'authorized', rowType: 'configured-rule', sourceType: 'latest',
            mediaType: 'movies', scopeType: 'library', libraryId, topologyEpoch: 'f'.repeat(64),
            userAccessEpoch: '1'.repeat(64), bindingGeneration: 0, bindingKey: 'movies',
            sourceRuleId: 'latest-movies', resolvedScopeHash: computeHomeResolvedScopeHash(ownedRule()),
            configuredRowAssociation: { version: 1, scope: associationScope,
                rule: associationRule, section: associationSection } },
        { id: 'global', title: 'Global Discovery', source: 'authorized', rowType: 'fallback',
            scopeType: 'global', sourceType: 'latest', mediaType: 'Movie' }
    ]
});
const endpointDocument = () => ({ version: 1, featuredContent: { version: 9, payload: featured() } });
const redactedEndpointDocument = () => {
    const document = endpointDocument();
    delete (document.featuredContent.payload.sections[0] as { sourceRuleId?: string }).sourceRuleId;
    return document;
};
const fullEndpointDocument = () => {
    const document = endpointDocument();
    const section = document.featuredContent.payload.sections[0] as typeof document.featuredContent.payload.sections[0] & {
        rowConfigHash?: string; ruleId?: string;
    };
    section.source = 'movies';
    section.ruleId = 'latest-movies';
    section.rowConfigHash = getRowsEndpointSettingsHash(rowSettings());
    return document;
};
const status = () => ({ currentHomeTopology: { version: 1, epoch: 'f'.repeat(64), held: false },
    currentHomeUserAccess: { version: 1, userId: mocks.userId, accessEpoch: '1'.repeat(64),
        held: false, policyProven: true }, currentPresentationAuthority: currentPresentationAuthority(),
    configuredPresentationBindings: [ { rule: associationRule, section: associationSection } ] });

let latest: ReturnType<typeof useNativeHomeData> | null = null;
function Harness() {
    latest = useNativeHomeData();
    return <div data-rows={latest.rows.map(row => row.id).join(',')} />;
}

const reactActEnvironment = globalThis as typeof globalThis & {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
describe('Home library ownership publication', () => {
    let container: HTMLDivElement;
    let root: Root;
    const ownedRow = () => latest?.rows.find(row => row.sourceCacheSectionId === 'owned');
    const globalRow = () => latest?.rows.find(row => row.sourceCacheSectionId === 'global');
    async function flush() {
        await act(async () => {
            for (let index = 0; index < 200; index++) await Promise.resolve();
        });
    }

    beforeEach(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 73));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        mocks.userId = 'user-a';
        mocks.admin = true;
        for (const value of Object.values(mocks)) {
            if (typeof value === 'function' && 'mockReset' in value) value.mockReset();
        }
        mocks.currentUser.mockResolvedValue({ Id: 'user-a' });
        mocks.cached.mockResolvedValue(featured());
        mocks.endpoint.mockResolvedValue(endpointDocument());
        mocks.settings.mockResolvedValue({ rows: rowSettings() });
        mocks.status.mockResolvedValue(status());
        mocks.views.mockResolvedValue({ Items: [ { Id: libraryId, CollectionType: 'movies' } ],
            TotalRecordCount: 1, StartIndex: 0 });
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => query.ParentId ?
            { Items: [ owned ], TotalRecordCount: 1, StartIndex: 0 } :
            { Items: [ foreign, owned, globalItem ], TotalRecordCount: 3, StartIndex: 0 });
        mocks.resume.mockResolvedValue({ Items: [] });
        mocks.recentlyAdded.mockResolvedValue([]);
        mocks.requestJson.mockResolvedValue({ Items: [] });
        retireConfiguredRowFreshness('test-reset');
        retireNativeHomeIdentityState('server-a', 'user-a');
        latest = null;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        if (isHomeLibraryAuthorityRetired()) {
            const revision = beginHomeLibraryVerification('test-visit-after-controlled-transition');
            const held = { currentHomeTopology: { version: 1, epoch: 'e'.repeat(64), held: true },
                currentHomeUserAccess: { version: 1, userId: 'test-visit-after-controlled-transition',
                    accessEpoch: '1'.repeat(64), held: false, policyProven: true } };
            acceptHomeLibraryAuthority(held, revision, 'test-visit-after-controlled-transition');
            acceptHomeLibraryAuthority({ ...held, currentHomeTopology: { ...held.currentHomeTopology, held: false } },
                revision, 'test-visit-after-controlled-transition');
        }
        container.remove();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('keeps cache-only first render and derived Hero unproved while the single final status is deferred', async () => {
        const finalStatus = deferred<ReturnType<typeof status>>();
        mocks.status.mockReturnValue(finalStatus.promise);
        const response = featured();
        (response as { heroItems: unknown[] }).heroItems = [ owned ];
        mocks.cached.mockResolvedValue(response);
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()).toBeUndefined();
        expect(latest?.heroItems.some(item => item.Id === owned.Id)).toBe(false);
        expect(mocks.views).not.toHaveBeenCalled();
        expect(mocks.status).toHaveBeenCalledTimes(1);
        expect(mocks.status.mock.calls[0][0]).toMatchObject({ bypassCache: true });
        finalStatus.resolve(status());
        await flush();
        expect(ownedRow()).toBeDefined();
    });

    it.each([ 'missing', 'unproven', 'wrong-user' ])(
        'keeps a %s per-user authority from exposing Plugin Featured rows', async state => {
            const current = status();
            let userAccess: typeof current.currentHomeUserAccess | undefined;
            if (state === 'unproven') {
                userAccess = { ...current.currentHomeUserAccess, held: true, policyProven: false };
            } else if (state === 'wrong-user') {
                userAccess = { ...current.currentHomeUserAccess, userId: 'another-user' };
            }
            mocks.status.mockResolvedValue({ ...current, currentHomeUserAccess: userAccess });
            await act(async () => root.render(<Harness />));
            await flush();
            expect(ownedRow()).toBeUndefined();
            expect(globalRow()).toBeUndefined();
            expect(mocks.views).not.toHaveBeenCalled();
        });

    it('hides an independent Featured Hero while the new user lacks durable access proof', async () => {
        const response = featured();
        (response as { heroItems: unknown[] }).heroItems = [ { Id: 'independent-hero', Name: 'Hero', Type: 'Movie' } ];
        mocks.cached.mockResolvedValue(response);
        mocks.status.mockResolvedValue({ ...status(), currentHomeUserAccess: undefined });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(latest?.heroItems).toEqual([]);
        expect(globalRow()).toBeUndefined();
    });

    it('rejects a cached Hero from an older access epoch on the first Home visit while keeping global rows', async () => {
        const staleHero = { Id: 'stale-hero', Name: 'Stale Hero', Type: 'Movie', BackdropImageTags: [ 'image' ] };
        const response = featured();
        (response as typeof response & { heroAccessEpoch: string }).heroAccessEpoch = '2'.repeat(64);
        (response as { heroItems: unknown[] }).heroItems = [ staleHero ];
        mocks.cached.mockResolvedValue(response);
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => query.ParentId ?
            { Items: [ owned ], TotalRecordCount: 1, StartIndex: 0 } :
            { Items: [ foreign, owned, globalItem, staleHero ], TotalRecordCount: 4, StartIndex: 0 });

        await act(async () => root.render(<Harness />));
        await flush();

        expect(latest?.heroItems.some(item => item.Id === staleHero.Id)).toBe(false);
        expect(globalRow()?.items).toEqual([ globalItem ]);
    });

    it('rejects a Featured endpoint Hero whose response epoch differs from final Home access', async () => {
        const staleHero = { Id: 'late-hero', Name: 'Late Hero', Type: 'Movie', BackdropImageTags: [ 'image' ] };
        const response = endpointDocument();
        (response.featuredContent.payload as typeof response.featuredContent.payload & {
            heroAccessEpoch: string
        }).heroAccessEpoch = '2'.repeat(64);
        (response.featuredContent.payload as { heroItems: unknown[] }).heroItems = [ staleHero ];
        mocks.cached.mockResolvedValue(null);
        mocks.endpoint.mockResolvedValue(response);
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => {
            if (query.ParentId) {
                return { Items: [ owned ], TotalRecordCount: 1, StartIndex: 0 };
            }
            if (query.Ids) {
                return { Items: [ foreign, owned, globalItem, staleHero ],
                    TotalRecordCount: 4, StartIndex: 0 };
            }
            return { Items: [ foreign, owned, globalItem ], TotalRecordCount: 3, StartIndex: 0 };
        });

        await act(async () => root.render(<Harness />));
        await flush();

        expect(latest?.heroItems.some(item => item.Id === staleHero.Id)).toBe(false);
        expect(globalRow()?.items).toEqual([ globalItem ]);
    });

    it('retires mounted Plugin Featured rows and Hero on a changed user access epoch', async () => {
        const response = featured();
        (response as { heroItems: unknown[] }).heroItems = [ owned ];
        mocks.cached.mockResolvedValue(response);
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeDefined();
        act(() => observeHomeLibraryAuthority({ ...status(), currentHomeUserAccess: {
            ...status().currentHomeUserAccess, accessEpoch: '2'.repeat(64) } }));
        expect(ownedRow()).toBeUndefined();
        expect(latest?.heroItems.some(item => item.Id === owned.Id)).toBe(false);
        expect(globalRow()).toBeUndefined();
    });

    it('retires an independent Featured Hero when the mounted user access epoch changes', async () => {
        const { retainCurrentNativeHomePresentation } = await import('./hooks');
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeDefined();
        const state = { rows: [], heroItems: [ globalItem ], heroItem: globalItem,
            heroAccessEpoch: getHomeLibraryAuthoritySnapshot().userAccess?.accessEpoch,
            independentHeroItems: [ globalItem ], configuredHeroAuthorities: {} } as unknown as
            Parameters<typeof retainCurrentNativeHomePresentation>[0];
        expect(retainCurrentNativeHomePresentation(state, 'server-a:user-a').heroItems).toEqual([ globalItem ]);
        act(() => observeHomeLibraryAuthority({ ...status(), currentHomeUserAccess: {
            ...status().currentHomeUserAccess, accessEpoch: '2'.repeat(64) } }));
        expect(retainCurrentNativeHomePresentation(state, 'server-a:user-a').heroItems).toEqual([]);
        expect(globalRow()).toBeUndefined();
    });

    it('rejects a cached and endpoint section from another user access epoch while keeping global rows', async () => {
        const stale = featured();
        stale.sections[0].userAccessEpoch = '2'.repeat(64);
        mocks.cached.mockResolvedValue(stale);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: stale } });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()?.items).toEqual([ globalItem ]);
        expect(mocks.views).not.toHaveBeenCalled();
    });

    it('uses the authorized endpoint when a shared cache candidate has no per-user epoch', async () => {
        const shared = featured();
        delete (shared.sections[0] as { userAccessEpoch?: string }).userAccessEpoch;
        mocks.cached.mockResolvedValue(shared);
        await act(async () => root.render(<Harness />));
        await flush();
        expect(mocks.endpoint).toHaveBeenCalled();
        expect(ownedRow()?.items).toEqual([ owned ]);
    });

    it('retires the library proof when the Home route unmounts', async () => {
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeDefined();
        act(() => root.render(null));
        expect(getHomeLibraryAuthoritySnapshot().topology).toBeUndefined();
    });

    it('retires mounted Plugin Featured rows and derived Hero synchronously before a controlled write', async () => {
        const response = featured();
        (response as { heroItems: unknown[] }).heroItems = [ owned ];
        mocks.cached.mockResolvedValue(response);
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeDefined();
        act(() => retireHomeLibraryAuthority('before-controlled-write'));
        expect(ownedRow()).toBeUndefined();
        expect(latest?.heroItems.some(item => item.Id === owned.Id)).toBe(false);
        expect(globalRow()).toBeUndefined();
        await flush();
        expect(ownedRow()).toBeUndefined();
    });

    it.each([ null, { version: 1, epoch: 'f'.repeat(64), held: true },
        { version: 1, epoch: 'a'.repeat(64), held: false } ])(
        'rejects cached and endpoint ownership under missing held or mismatched status despite old Views and Items: %j', async topology => {
            mocks.status.mockResolvedValue({ ...status(), currentHomeTopology: topology });
            await act(async () => root.render(<Harness />));
            await flush();
            expect(ownedRow()).toBeUndefined();
            expect(globalRow()).toBeDefined();
            expect(mocks.views).not.toHaveBeenCalled();
        });

    it('holds early cached owned cards until current membership resolves and keeps survivor order', async () => {
        const page = deferred<{ Items: typeof owned[]; TotalRecordCount: number; StartIndex: number }>();
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => query.ParentId ? page.promise :
            { Items: [ foreign, owned, globalItem ], TotalRecordCount: 3, StartIndex: 0 });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()).toBeUndefined();
        page.resolve({ Items: [ owned ], TotalRecordCount: 1, StartIndex: 0 });
        await flush();
        expect(ownedRow()?.items).toEqual([ owned ]);
        expect(mocks.views).toHaveBeenCalledOnce();
    });

    it('filters a fresh endpoint row and never refills a foreign card', async () => {
        mocks.cached.mockResolvedValue(null);
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.items).toEqual([ owned ]);
        expect(globalRow()?.items).toEqual([ globalItem ]);
    });

    it('publishes a ledger-only new-ID row only after exact final-status attestation and current-user membership', async () => {
        const reboundId = 'b'.repeat(32);
        const response = featured();
        response.sections[0].libraryId = reboundId;
        response.sections[0].bindingGeneration = 2;
        response.sections[0].resolvedScopeHash = computeHomeResolvedScopeHash({ ...ownedRule(),
            libraryScope: { ...ownedRule().libraryScope, virtualFolderId: reboundId } });
        mocks.cached.mockResolvedValue(null);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
        mocks.status.mockResolvedValue({ ...status(), configuredPresentationBindings: [ {
            rule: associationRule, section: associationSection, libraryId: reboundId,
            topologyEpoch: 'f'.repeat(64), bindingGeneration: 2, explicitRebind: true
        } ] });
        mocks.views.mockResolvedValue({ Items: [ { Id: reboundId, CollectionType: 'movies' } ],
            TotalRecordCount: 1, StartIndex: 0 });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.items).toEqual([ owned ]);
        expect(mocks.views).toHaveBeenCalledOnce();
        expect(mocks.items.mock.calls.some(([ query ]) => query.ParentId === reboundId)).toBe(true);
    });

    it('accepts an unaffected unpinned default only after its seeded current ID is attested', async () => {
        const reboundId = 'b'.repeat(32);
        const settings = rowSettings();
        delete (settings.rules[0].libraryScope as { virtualFolderId?: string }).virtualFolderId;
        const response = featured();
        response.rowConfigHash = getRowsEndpointSettingsHash(settings);
        response.sections[0].libraryId = reboundId;
        response.sections[0].bindingGeneration = 2;
        response.sections[0].resolvedScopeHash = computeHomeResolvedScopeHash({ ...settings.rules[0],
            libraryScope: { ...settings.rules[0].libraryScope, virtualFolderId: reboundId } });
        mocks.settings.mockResolvedValue({ rows: settings });
        mocks.cached.mockResolvedValue(null);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
        mocks.status.mockResolvedValue({ ...status(), configuredPresentationBindings: [ {
            rule: associationRule, section: associationSection, libraryId: reboundId,
            topologyEpoch: 'f'.repeat(64), bindingGeneration: 2, explicitRebind: false
        } ] });
        mocks.views.mockResolvedValue({ Items: [ { Id: reboundId, CollectionType: 'movies' } ],
            TotalRecordCount: 1, StartIndex: 0 });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.items).toEqual([ owned ]);
    });

    it('lets a nonadmin see a fresh authorized new-ID row through current topology and membership without admin binding metadata', async () => {
        const reboundId = 'b'.repeat(32);
        const response = featured();
        delete (response.sections[0] as { sourceRuleId?: string }).sourceRuleId;
        response.sections[0].libraryId = reboundId;
        response.sections[0].bindingGeneration = 2;
        response.sections[0].resolvedScopeHash = computeHomeResolvedScopeHash({ ...ownedRule(),
            libraryScope: { ...ownedRule().libraryScope, virtualFolderId: reboundId } });
        mocks.admin = false;
        mocks.cached.mockResolvedValue(null);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
        mocks.status.mockResolvedValue({ ...status(), configuredPresentationBindings: [] });
        mocks.views.mockResolvedValue({ Items: [ { Id: reboundId, CollectionType: 'movies' } ],
            TotalRecordCount: 1, StartIndex: 0 });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.items).toEqual([ owned ]);
        expect(mocks.settings).not.toHaveBeenCalled();
        expect(mocks.views).toHaveBeenCalledOnce();
    });

    it('withholds a nonadmin new-ID section with poisoned authorization metadata before membership', async () => {
        const reboundId = 'b'.repeat(32);
        const response = featured();
        delete (response.sections[0] as { sourceRuleId?: string }).sourceRuleId;
        response.sections[0].libraryId = reboundId;
        response.sections[0].bindingGeneration = 2;
        (response.sections[0] as { configuredRowAssociation: { section: string } })
            .configuredRowAssociation.section = 'not-an-opaque-section';
        mocks.admin = false;
        mocks.cached.mockResolvedValue(null);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
        mocks.status.mockResolvedValue({ ...status(), configuredPresentationBindings: [] });
        mocks.views.mockResolvedValue({ Items: [ { Id: reboundId, CollectionType: 'movies' } ],
            TotalRecordCount: 1, StartIndex: 0 });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(mocks.views).not.toHaveBeenCalled();
    });

    it.each([ 'changed-library-id', 'changed-effective-hash', 'changed-generation', 'stale-attestation-epoch',
        'forged-mapping', 'duplicate-mapping', 'duplicate-final-binding', 'changed-saved-scope', 'missing-current-status' ])(
        'rejects %s despite a copied current association and authorized item', async poison => {
            const reboundId = 'b'.repeat(32);
            const response = featured();
            response.sections[0].libraryId = reboundId;
            response.sections[0].bindingGeneration = 2;
            response.sections[0].resolvedScopeHash = computeHomeResolvedScopeHash({ ...ownedRule(),
                libraryScope: { ...ownedRule().libraryScope, virtualFolderId: reboundId } });
            const settings = rowSettings();
            if (poison === 'changed-library-id') {
                response.sections[0].libraryId = 'c'.repeat(32);
                Object.assign(response.sections[0], { transitionBinding: 'verified' });
            }
            if (poison === 'changed-effective-hash') response.sections[0].resolvedScopeHash = computeHomeResolvedScopeHash(ownedRule());
            if (poison === 'changed-generation') response.sections[0].bindingGeneration = 3;
            if (poison === 'forged-mapping') settings.configuredRowAssociations.sections[0].section = '1'.repeat(64);
            if (poison === 'duplicate-mapping') {
                settings.configuredRowAssociations.sections.push({ rule: associationRule, section: associationSection });
            }
            if (poison === 'changed-saved-scope') settings.rules[0].libraryScope.virtualFolderId = 'c'.repeat(32);
            mocks.settings.mockResolvedValue({ rows: settings });
            mocks.cached.mockResolvedValue(null);
            mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
            const attested = { rule: associationRule, section: associationSection,
                libraryId: reboundId, topologyEpoch: poison === 'stale-attestation-epoch' ?
                    'e'.repeat(64) : 'f'.repeat(64), bindingGeneration: 2, explicitRebind: true };
            mocks.status.mockResolvedValue({ ...status(),
                currentHomeTopology: poison === 'missing-current-status' ? null : status().currentHomeTopology,
                configuredPresentationBindings: poison === 'duplicate-final-binding' ?
                    [ attested, { rule: associationRule, section: associationSection } ] : [ attested ] });
            mocks.views.mockResolvedValue({ Items: [ { Id: reboundId, CollectionType: 'movies' },
                { Id: 'c'.repeat(32), CollectionType: 'movies' } ], TotalRecordCount: 2, StartIndex: 0 });
            await act(async () => root.render(<Harness />));
            await flush();
            expect(ownedRow()).toBeUndefined();
            expect(globalRow()?.items).toEqual([ globalItem ]);
            expect(mocks.views).not.toHaveBeenCalled();
        }
    );

    it('keeps a verified global configured row while an attested owned refresh fails its scope check', async () => {
        const reboundId = 'b'.repeat(32);
        const settings = rowSettings();
        const globalRule = { ...ownedRule(), id: 'global-discovery', libraryScope: { mode: 'global' } } as typeof settings.rules[0];
        const globalRuleToken = '1'.repeat(64);
        const globalSectionToken = '2'.repeat(64);
        settings.rules.push(globalRule);
        settings.configuredRowAssociations.rules.push({ ruleId: globalRule.id, association: globalRuleToken });
        settings.configuredRowAssociations.sections.push({ rule: globalRuleToken, section: globalSectionToken });
        const response = featured();
        response.rowConfigHash = getRowsEndpointSettingsHash(settings);
        response.sections[0].libraryId = reboundId;
        response.sections[0].bindingGeneration = 2;
        // The saved-scope hash is stale: this owned row must stay absent.
        response.sections.push({ id: 'configured-global', title: 'Global configured discovery', source: 'authorized',
            rowType: 'configured-rule', sourceType: 'latest', sourceRuleId: globalRule.id, mediaType: 'movies',
            scopeType: 'global', rowConfigHash: response.rowConfigHash,
            resolvedScopeHash: computeHomeResolvedScopeHash(globalRule, 'global'),
            configuredRowAssociation: { version: 1, scope: associationScope,
                rule: globalRuleToken, section: globalSectionToken }
        } as unknown as typeof response.sections[0]);
        Object.assign(response.sectionItems, { 'configured-global': [ globalItem ] });
        mocks.settings.mockResolvedValue({ rows: settings });
        mocks.cached.mockResolvedValue(null);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
        mocks.status.mockResolvedValue({ ...status(), configuredPresentationBindings: [
            { rule: associationRule, section: associationSection, libraryId: reboundId,
                topologyEpoch: 'f'.repeat(64), bindingGeneration: 2, explicitRebind: true },
            { rule: globalRuleToken, section: globalSectionToken }
        ] });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        const configuredGlobal = latest?.rows.find(row => row.sourceCacheSectionId === 'configured-global');
        expect(configuredGlobal?.homeOwnershipKind).toBe('global');
        expect(configuredGlobal?.items).toEqual([ globalItem ]);
        expect(mocks.views).not.toHaveBeenCalled();
    });

    it('rejects an owned row with the wrong current section association', async () => {
        const response = featured();
        (response.sections[0] as { configuredRowAssociation: { section: string } })
            .configuredRowAssociation.section = 'f'.repeat(64);
        mocks.cached.mockResolvedValue(response);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()?.items).toEqual([ globalItem ]);
    });

    it('rejects an owned row with a stale resolved scope hash', async () => {
        const response = featured();
        response.sections[0].resolvedScopeHash = '12345';
        mocks.cached.mockResolvedValue(response);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()?.items).toEqual([ globalItem ]);
    });

    it('does not treat a schema-3 configured row with missing scope as legacy global', async () => {
        const settings = rowSettings();
        delete (settings.rules[0] as { libraryScope?: unknown }).libraryScope;
        const response = featured();
        const section = response.sections[0] as typeof response.sections[0] & {
            scopeType?: string; libraryId?: string; bindingKey?: string; resolvedScopeHash?: string;
        };
        delete (section as { scopeType?: string }).scopeType;
        delete section.libraryId;
        delete section.bindingKey;
        delete section.resolvedScopeHash;
        mocks.settings.mockResolvedValue({ rows: settings });
        mocks.cached.mockResolvedValue(response);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()?.items).toEqual([ globalItem ]);
    });

    it('does not downgrade a schema-3 payload through legacy settings with missing scope', async () => {
        const settings = rowSettings();
        settings.schemaVersion = 2;
        delete (settings.rules[0] as { libraryScope?: unknown }).libraryScope;
        const response = featured();
        delete (response as { scopeSchemaVersion?: number }).scopeSchemaVersion;
        const section = response.sections[0] as {
            scopeType?: string; libraryId?: string; bindingKey?: string; resolvedScopeHash?: string;
        };
        delete section.scopeType;
        delete section.libraryId;
        delete section.bindingKey;
        delete section.resolvedScopeHash;
        mocks.settings.mockResolvedValue({ rows: settings });
        mocks.cached.mockResolvedValue(response);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
    });

    it('does not launder a canonical pre-scope latest row into a global shelf', async () => {
        const settings = rowSettings();
        settings.schemaVersion = 2;
        delete (settings.rules[0] as { libraryScope?: unknown }).libraryScope;
        const response = featured();
        response.rowConfigVersion = 2;
        delete (response as { scopeSchemaVersion?: number }).scopeSchemaVersion;
        const section = response.sections[0] as {
            scopeType?: string; libraryId?: string; bindingKey?: string; resolvedScopeHash?: string;
        };
        delete section.scopeType;
        delete section.libraryId;
        delete section.bindingKey;
        delete section.resolvedScopeHash;
        mocks.settings.mockResolvedValue({ rows: settings });
        mocks.cached.mockResolvedValue(response);
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
    });

    it('retains a matched pre-scope global row without ownership hints', async () => {
        const settings = rowSettings();
        settings.schemaVersion = 2;
        settings.rules[0].id = 'custom-global';
        delete (settings.rules[0] as { libraryScope?: unknown }).libraryScope;
        settings.configuredRowAssociations.rules[0].ruleId = 'custom-global';
        const response = featured();
        response.rowConfigVersion = 2;
        delete (response as { scopeSchemaVersion?: number }).scopeSchemaVersion;
        const section = response.sections[0] as {
            sourceRuleId: string; scopeType?: string; libraryId?: string;
            bindingKey?: string; resolvedScopeHash?: string;
        };
        section.sourceRuleId = 'custom-global';
        delete section.scopeType;
        delete section.libraryId;
        delete section.bindingKey;
        delete section.resolvedScopeHash;
        mocks.settings.mockResolvedValue({ rows: settings });
        mocks.cached.mockResolvedValue(response);
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.homeOwnershipKind).toBe('global');
        expect(ownedRow()?.items).toEqual([ foreign, owned ]);
    });

    it('does not publish orphan section items as a global fallback in a scoped payload', async () => {
        const response = { ...featured(), sections: [], sectionItems: { owned: [ foreign, owned ] } };
        mocks.cached.mockResolvedValue(response);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
    });

    it('also rejects orphan section items from a fresh endpoint response', async () => {
        const response = { ...featured(), sections: [], sectionItems: { owned: [ foreign, owned ] } };
        mocks.cached.mockResolvedValue(null);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(mocks.endpoint).toHaveBeenCalledOnce();
        expect(ownedRow()).toBeUndefined();
    });

    it('rejects a scoped-v8 fallback that strips its configured scope claim', async () => {
        const response = featured();
        const section = response.sections[0] as {
            rowType: string; sourceRuleId?: string; configuredRowAssociation?: unknown;
            scopeType?: string; libraryId?: string; bindingKey?: string; resolvedScopeHash?: string;
        };
        section.rowType = 'fallback';
        delete section.sourceRuleId;
        delete section.configuredRowAssociation;
        delete section.scopeType;
        delete section.libraryId;
        delete section.bindingKey;
        delete section.resolvedScopeHash;
        mocks.cached.mockResolvedValue(response);
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()?.items).toEqual([ globalItem ]);
    });

    it('does not downgrade an outer-v8 endpoint missing its inner scope schema', async () => {
        const response = featured();
        delete (response as { scopeSchemaVersion?: number }).scopeSchemaVersion;
        const section = response.sections[0] as {
            rowType: string; sourceRuleId?: string; configuredRowAssociation?: unknown;
            scopeType?: string; libraryId?: string; bindingKey?: string; resolvedScopeHash?: string;
        };
        section.rowType = 'fallback';
        delete section.sourceRuleId;
        delete section.configuredRowAssociation;
        delete section.scopeType;
        delete section.libraryId;
        delete section.bindingKey;
        delete section.resolvedScopeHash;
        mocks.cached.mockResolvedValue(null);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(mocks.endpoint).toHaveBeenCalledOnce();
        expect(ownedRow()).toBeUndefined();
    });

    it('withholds pending Plugin configured rows after library-only retirement without restoring owned cache or Hero', async () => {
        const settings = rowSettings();
        const globalRule = { ...ownedRule(), id: 'global-discovery', libraryScope: { mode: 'global' } } as typeof settings.rules[0];
        settings.rules.push(globalRule);
        const globalAssociation = '1'.repeat(64);
        const globalSectionAssociation = '2'.repeat(64);
        settings.configuredRowAssociations.rules.push({ ruleId: globalRule.id, association: globalAssociation });
        settings.configuredRowAssociations.sections.push({ rule: globalAssociation, section: globalSectionAssociation });
        const response = featured();
        response.rowConfigHash = getRowsEndpointSettingsHash(settings);
        (response as { heroItems: unknown[] }).heroItems = [ owned ];
        response.sections.push({ id: 'configured-global', title: 'Global configured discovery', source: 'authorized',
            rowType: 'configured-rule', sourceType: 'latest', sourceRuleId: globalRule.id, mediaType: 'movies',
            scopeType: 'global', rowConfigHash: response.rowConfigHash,
            resolvedScopeHash: computeHomeResolvedScopeHash(globalRule, 'global'),
            configuredRowAssociation: { version: 1, scope: associationScope,
                rule: globalAssociation, section: globalSectionAssociation }
        } as unknown as typeof response.sections[0]);
        Object.assign(response.sectionItems, { 'configured-global': [ globalItem ] });
        const currentStatus = status();
        currentStatus.configuredPresentationBindings.push({ rule: globalAssociation, section: globalSectionAssociation });
        mocks.status.mockResolvedValue(currentStatus);
        const pendingSettings = deferred<{ rows: typeof settings }>();
        const pendingCache = deferred<typeof response>();
        mocks.settings.mockReturnValue(pendingSettings.promise);
        mocks.cached.mockReturnValue(pendingCache.promise);
        await act(async () => root.render(<Harness />));
        await flush();
        expect(mocks.status).not.toHaveBeenCalled();
        act(() => retireHomeLibraryAuthority('controlled-write-with-pending-inputs'));
        pendingSettings.resolve({ rows: settings });
        pendingCache.resolve(response);
        await flush();
        const configuredGlobal = latest?.rows.find(row => row.sourceCacheSectionId === 'configured-global');
        expect(configuredGlobal).toBeUndefined();
        expect(ownedRow()).toBeUndefined();
        expect(latest?.heroItems.some(item => item.Id === owned.Id)).toBe(false);
        expect(mocks.status).toHaveBeenCalledTimes(1);
        expect(mocks.status.mock.calls[0][0]).toMatchObject({ bypassCache: true });
        expect(mocks.views).not.toHaveBeenCalled();
        await flush();
        expect(ownedRow()).toBeUndefined();
    });

    it('leaves current global configured rows unchanged by ownership filtering', async () => {
        const settings = rowSettings();
        settings.rules[0] = { ...ownedRule(), id: 'global-discovery', libraryScope: { mode: 'global' } } as typeof settings.rules[0];
        settings.configuredRowAssociations.rules[0].ruleId = 'global-discovery';
        const response = featured();
        const section = response.sections[0] as typeof response.sections[0] & {
            libraryId?: string; bindingKey?: string; rowConfigHash?: string;
        };
        section.sourceRuleId = 'global-discovery';
        section.rowConfigHash = getRowsEndpointSettingsHash(settings);
        response.rowConfigHash = section.rowConfigHash;
        delete section.libraryId;
        delete section.bindingKey;
        section.scopeType = 'global';
        section.resolvedScopeHash = computeHomeResolvedScopeHash(settings.rules[0], 'global');
        response.sectionItems.owned = [ foreign, owned ];
        mocks.settings.mockResolvedValue({ rows: settings });
        mocks.cached.mockResolvedValue(response);
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.homeOwnershipKind).toBe('global');
        expect(ownedRow()?.items).toEqual([ foreign, owned ]);
    });

    it('suppresses an owned fallback row when the current user cannot view its library', async () => {
        mocks.cached.mockResolvedValue(null);
        mocks.views.mockResolvedValue({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()?.items).toEqual([ globalItem ]);
    });

    it('does not restore last-good owned cards before fresh proof on route return', async () => {
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.items).toEqual([ owned ]);
        act(() => root.unmount());
        root = createRoot(container);
        const page = deferred<{ Items: typeof owned[]; TotalRecordCount: number; StartIndex: number }>();
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => query.ParentId ? page.promise :
            { Items: [ foreign, owned, globalItem ], TotalRecordCount: 3, StartIndex: 0 });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()).toBeUndefined();
        page.resolve({ Items: [ owned ], TotalRecordCount: 1, StartIndex: 0 });
        await flush();
        expect(ownedRow()?.items).toEqual([ owned ]);
    });

    it('does not reuse the same row ID after its library binding changes', async () => {
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.items).toEqual([ owned ]);
        act(() => root.unmount());
        root = createRoot(container);

        const newLibraryId = 'ffffffffffffffffffffffffffffffff';
        const nextSettings = rowSettings();
        nextSettings.rules[0].libraryScope.virtualFolderId = newLibraryId;
        const nextFeatured = featured();
        nextFeatured.sections[0].libraryId = newLibraryId;
        nextFeatured.sections[0].resolvedScopeHash = computeHomeResolvedScopeHash(nextSettings.rules[0]);
        mocks.settings.mockResolvedValue({ rows: nextSettings });
        mocks.cached.mockResolvedValue(nextFeatured);
        mocks.views.mockResolvedValue({ Items: [ { Id: libraryId, CollectionType: 'movies' } ],
            TotalRecordCount: 1, StartIndex: 0 });

        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()?.items).toEqual([ globalItem ]);
    });

    it('ignores a membership read that completes after the Home route retires', async () => {
        const page = deferred<{ Items: typeof owned[]; TotalRecordCount: number; StartIndex: number }>();
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => query.ParentId ? page.promise :
            { Items: [ foreign, owned, globalItem ], TotalRecordCount: 3, StartIndex: 0 });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        act(() => root.unmount());
        root = createRoot(container);
        mocks.views.mockResolvedValue({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
        await act(async () => root.render(<Harness />));
        page.resolve({ Items: [ owned ], TotalRecordCount: 1, StartIndex: 0 });
        await flush();
        expect(ownedRow()).toBeUndefined();
    });

    it('does not stamp a membership result after configured freshness retires', async () => {
        mocks.admin = false;
        mocks.cached.mockResolvedValue(null);
        mocks.endpoint.mockResolvedValue(redactedEndpointDocument());
        const page = deferred<{ Items: typeof owned[]; TotalRecordCount: number; StartIndex: number }>();
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => query.ParentId ? page.promise :
            { Items: [ foreign, owned, globalItem ], TotalRecordCount: 3, StartIndex: 0 });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        act(() => retireConfiguredRowFreshness('test-membership-pending-revocation'));
        page.resolve({ Items: [ owned ], TotalRecordCount: 1, StartIndex: 0 });
        await flush();
        expect(ownedRow()).toBeUndefined();
    });

    it('does not restore a hero derived from an owned row before fresh proof', async () => {
        mocks.admin = false;
        mocks.cached.mockResolvedValue(null);
        const heroOwned = { ...owned, ImageTags: { Primary: 'owned-art' } };
        const document = redactedEndpointDocument();
        document.featuredContent.payload.sectionItems.owned = [ heroOwned ];
        mocks.endpoint.mockResolvedValue(document);
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => {
            if (query.ParentId) return { Items: [ heroOwned ], TotalRecordCount: 1, StartIndex: 0 };
            if (query.SortBy === 'Random') return { Items: [], TotalRecordCount: 0, StartIndex: 0 };
            return { Items: [ foreign, heroOwned, globalItem ], TotalRecordCount: 3, StartIndex: 0 };
        });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.items).toEqual([ heroOwned ]);
        expect(latest?.heroItem?.Id).toBe(owned.Id);

        act(() => root.unmount());
        root = createRoot(container);
        const nextUser = deferred<{ Id: string }>();
        mocks.currentUser.mockReturnValue(nextUser.promise);
        await act(async () => root.render(<Harness />));
        expect(ownedRow()).toBeUndefined();
        expect(latest?.heroItems.some(item => item.Id === owned.Id)).toBe(false);
        expect(latest?.heroItem?.Id).not.toBe(owned.Id);
        nextUser.resolve({ Id: 'user-a' });
    });

    it('retires an owned-row hero when freshness changes during the active visit', async () => {
        mocks.admin = false;
        mocks.cached.mockResolvedValue(null);
        const heroOwned = { ...owned, ImageTags: { Primary: 'owned-art' } };
        const document = redactedEndpointDocument();
        document.featuredContent.payload.sectionItems.owned = [ heroOwned ];
        mocks.endpoint.mockResolvedValue(document);
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => {
            if (query.ParentId) return { Items: [ heroOwned ], TotalRecordCount: 1, StartIndex: 0 };
            if (query.SortBy === 'Random') return { Items: [], TotalRecordCount: 0, StartIndex: 0 };
            return { Items: [ foreign, heroOwned, globalItem ], TotalRecordCount: 3, StartIndex: 0 };
        });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(latest?.heroItem?.Id).toBe(owned.Id);
        act(() => retireConfiguredRowFreshness('test-active-visit-revocation'));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(latest?.heroItems.some(item => item.Id === owned.Id)).toBe(false);
        expect(latest?.heroItem?.Id).not.toBe(owned.Id);
    });

    it('retires a cached Hero until fresh user access proof even when its ID overlaps an owned row', async () => {
        mocks.admin = false;
        mocks.cached.mockResolvedValue(null);
        const heroOwned = { ...owned, ImageTags: { Primary: 'owned-art' } };
        const document = redactedEndpointDocument();
        document.featuredContent.payload.sectionItems.owned = [ heroOwned ];
        Object.assign(document.featuredContent.payload, { heroItems: [ heroOwned ] });
        mocks.endpoint.mockResolvedValue(document);
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => query.ParentId ?
            { Items: [ heroOwned ], TotalRecordCount: 1, StartIndex: 0 } :
            { Items: [ foreign, heroOwned, globalItem ], TotalRecordCount: 3, StartIndex: 0 });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.items).toEqual([ heroOwned ]);
        expect(latest?.heroItem?.Id).toBe(owned.Id);

        act(() => root.unmount());
        root = createRoot(container);
        const nextUser = deferred<{ Id: string }>();
        mocks.currentUser.mockReturnValue(nextUser.promise);
        await act(async () => root.render(<Harness />));
        expect(ownedRow()).toBeUndefined();
        expect(latest?.heroItem).toBeNull();
        nextUser.resolve({ Id: 'user-a' });
    });

    it('uses a fresh restricted-user endpoint claim when its rule ID is redacted', async () => {
        mocks.admin = false;
        mocks.endpoint.mockResolvedValue(redactedEndpointDocument());
        await act(async () => root.render(<Harness />));
        await flush();
        expect(mocks.settings).not.toHaveBeenCalled();
        expect(mocks.endpoint).toHaveBeenCalledOnce();
        expect(ownedRow()?.items).toEqual([ owned ]);
        expect(mocks.status).toHaveBeenCalledTimes(1);
        expect(globalRow()?.items).toEqual([ globalItem ]);
    });

    it('rejects a restricted endpoint marker from a different presentation scope', async () => {
        mocks.admin = false;
        mocks.cached.mockResolvedValue(null);
        const document = redactedEndpointDocument();
        (document.featuredContent.payload.sections[0] as { configuredRowAssociation: { scope: string } })
            .configuredRowAssociation.scope = 'f'.repeat(64);
        mocks.endpoint.mockResolvedValue(document);
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
    });

    it('accepts a fully authorized restricted-user owned section with matching direct fields', async () => {
        mocks.admin = false;
        mocks.cached.mockResolvedValue(null);
        mocks.endpoint.mockResolvedValue(fullEndpointDocument());
        await act(async () => root.render(<Harness />));
        await flush();
        expect(mocks.settings).not.toHaveBeenCalled();
        expect(ownedRow()?.items).toEqual([ owned ]);
    });

    it('does not use restricted claims when an administrator settings read fails', async () => {
        mocks.cached.mockResolvedValue(null);
        mocks.settings.mockRejectedValue(new Error('settings unavailable'));
        mocks.endpoint.mockResolvedValue(fullEndpointDocument());
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()?.items).toEqual([ globalItem ]);
    });

    it('retires a restricted-user owned row synchronously when identity changes', async () => {
        mocks.admin = false;
        mocks.endpoint.mockResolvedValue(redactedEndpointDocument());
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.items).toEqual([ owned ]);

        mocks.userId = 'user-b';
        mocks.currentUser.mockResolvedValue({ Id: 'user-b' });
        mocks.views.mockResolvedValue({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
        await act(async () => root.render(<Harness />));
        expect(ownedRow()).toBeUndefined();
    });

    it('does not append unproved studio discovery items after an owned row is gated', async () => {
        const rule = { ...ownedRule(), id: 'studio-rule', name: 'Latest Studio A',
            sourceType: 'studio', sourceValue: 'Latest Studio A',
            libraryScope: { mode: 'virtualFolder', virtualFolderId: libraryId } };
        const settings = { ...rowSettings(), rules: [ rule ] };
        settings.configuredRowAssociations.rules[0].ruleId = 'studio-rule';
        const response = featured();
        response.sections[0].sourceRuleId = 'studio-rule';
        response.sections[0].sourceType = 'studio';
        delete (response.sections[0] as { bindingKey?: string }).bindingKey;
        response.sections[0].resolvedScopeHash = computeHomeResolvedScopeHash(rule);
        response.rowConfigHash = getRowsEndpointSettingsHash(settings);
        mocks.cached.mockResolvedValue(response);
        mocks.settings.mockResolvedValue({ rows: settings });
        mocks.requestJson.mockResolvedValue({ Items: [ { Id: 'studio-a', Name: 'Latest Studio A' } ] });
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => {
            if (query.ParentId) return { Items: [ owned ], TotalRecordCount: 1, StartIndex: 0 };
            if (query.StudioIds) return { Items: [ owned, foreign ], TotalRecordCount: 2, StartIndex: 0 };
            return { Items: [ foreign, owned, globalItem ], TotalRecordCount: 3, StartIndex: 0 };
        });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.items).toEqual([ owned ]);
    });
    it('rejects a late UserViews result after controlled retirement with Plugin shelves withheld', async () => {
        const pendingViews = deferred<{ Items: { Id: string; CollectionType: string }[]; TotalRecordCount: number; StartIndex: number }>();
        mocks.views.mockReturnValue(pendingViews.promise);
        await act(async () => root.render(<Harness />));
        await flush();
        expect(mocks.views).toHaveBeenCalledOnce();
        act(() => retireHomeLibraryAuthority('begin-during-views'));
        pendingViews.resolve({ Items: [ { Id: libraryId, CollectionType: 'movies' } ], TotalRecordCount: 1, StartIndex: 0 });
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()).toBeUndefined();
        expect(mocks.items.mock.calls.some(([query]) => Boolean(query.ParentId))).toBe(false);
    });

    it('rejects a late same-ID Items page and derived Hero after controlled retirement', async () => {
        const heroOwned = { ...owned, ImageTags: { Primary: 'owned-art' } };
        const response = featured();
        response.sectionItems.owned = [ heroOwned ];
        mocks.cached.mockResolvedValue(response);
        mocks.endpoint.mockResolvedValue({ version: 1, featuredContent: { version: 9, payload: response } });
        const pendingItems = deferred<{ Items: typeof heroOwned[]; TotalRecordCount: number; StartIndex: number }>();
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => query.ParentId ? pendingItems.promise :
            { Items: [ heroOwned, globalItem ], TotalRecordCount: 2, StartIndex: 0 });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(mocks.views).toHaveBeenCalledOnce();
        expect(mocks.items.mock.calls.some(([query]) => Boolean(query.ParentId))).toBe(true);
        act(() => retireHomeLibraryAuthority('begin-during-items'));
        mocks.status.mockResolvedValue({ ...status(), currentHomeTopology: { version: 1, epoch: 'a'.repeat(64), held: false } });
        pendingItems.resolve({ Items: [ heroOwned ], TotalRecordCount: 1, StartIndex: 0 });
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()).toBeUndefined();
        expect(latest?.heroItems.some(item => item.Id === heroOwned.Id)).toBe(false);
        expect(latest?.heroItem?.Id).not.toBe(heroOwned.Id);
    });

    it('rejects an old endpoint result that arrives after controlled retirement', async () => {
        mocks.admin = false;
        mocks.cached.mockResolvedValue(null);
        const pendingEndpoint = deferred<ReturnType<typeof redactedEndpointDocument>>();
        mocks.endpoint.mockReturnValue(pendingEndpoint.promise);
        await act(async () => root.render(<Harness />));
        await flush();
        expect(mocks.endpoint).toHaveBeenCalledOnce();
        act(() => retireHomeLibraryAuthority('begin-during-endpoint'));
        pendingEndpoint.resolve(redactedEndpointDocument());
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()).toBeUndefined();
        expect(mocks.views).not.toHaveBeenCalled();
    });
    it('withholds the Plugin last-good shelf when a pending visit fails after controlled retirement', async () => {
        mocks.admin = false;
        mocks.cached.mockResolvedValue(null);
        const heroOwned = { ...owned, ImageTags: { Primary: 'owned-art' } };
        const document = redactedEndpointDocument();
        document.featuredContent.payload.sectionItems.owned = [ heroOwned ];
        mocks.endpoint.mockResolvedValue(document);
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => {
            if (query.ParentId) return { Items: [ heroOwned ], TotalRecordCount: 1, StartIndex: 0 };
            if (query.SortBy === 'Random') return { Items: [], TotalRecordCount: 0, StartIndex: 0 };
            return { Items: [ heroOwned, globalItem ], TotalRecordCount: 2, StartIndex: 0 };
        });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.items).toEqual([ heroOwned ]);
        expect(latest?.heroItem?.Id).toBe(heroOwned.Id);

        act(() => root.unmount());
        root = createRoot(container);
        let rejectUser!: (reason: Error) => void;
        mocks.currentUser.mockReturnValue(new Promise((_resolve, reject) => {
            rejectUser = reject;
        }));
        await act(async () => root.render(<Harness />));
        await flush();
        act(() => retireHomeLibraryAuthority('begin-before-last-good-fallback'));
        rejectUser(new Error('user-read-failed'));
        await flush();
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()).toBeUndefined();
        expect(latest?.heroItems.some(item => item.Id === heroOwned.Id)).toBe(false);
        expect(latest?.heroItem?.Id).not.toBe(heroOwned.Id);
    });
    it('keeps a late supplemental completion from restoring prior owned cards or derived Hero', async () => {
        mocks.admin = false;
        mocks.cached.mockResolvedValue(null);
        const heroOwned = { ...owned, ImageTags: { Primary: 'owned-art' } };
        const firstDocument = redactedEndpointDocument();
        firstDocument.featuredContent.payload.sectionItems.owned = [ heroOwned ];
        mocks.endpoint.mockResolvedValue(firstDocument);
        mocks.items.mockImplementation(async (query: Record<string, unknown>) => {
            if (query.ParentId) return { Items: [ heroOwned ], TotalRecordCount: 1, StartIndex: 0 };
            if (query.SortBy === 'Random') return { Items: [], TotalRecordCount: 0, StartIndex: 0 };
            return { Items: [ heroOwned, globalItem ], TotalRecordCount: 2, StartIndex: 0 };
        });
        await act(async () => root.render(<Harness />));
        await flush();
        expect(ownedRow()?.items).toEqual([ heroOwned ]);
        expect(latest?.heroItem?.Id).toBe(heroOwned.Id);

        act(() => root.unmount());
        root = createRoot(container);
        mocks.admin = true;
        const disabled = rowSettings();
        disabled.enabled = false;
        disabled.rowSettings.enableConfiguredRows = false;
        const nextPayload = featured();
        mocks.cached.mockResolvedValue(nextPayload);
        mocks.settings.mockResolvedValue({ rows: disabled });
        const pendingResume = deferred<{ Items: typeof owned[] }>();
        mocks.resume.mockReturnValue(pendingResume.promise);
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            void Promise.resolve().then(() => callback(0));
            return 73;
        }));
        await act(async () => root.render(<Harness />));
        await flush();
        await act(async () => vi.advanceTimersByTimeAsync(0));
        await flush();
        expect(mocks.resume).toHaveBeenCalled();
        act(() => retireHomeLibraryAuthority('begin-during-supplemental'));
        pendingResume.resolve({ Items: [] });
        await flush();
        expect(latest?.debug.performance.backgroundRefreshCompleted).toBe(true);
        expect(ownedRow()).toBeUndefined();
        expect(globalRow()).toBeUndefined();
        expect(latest?.heroItems.some(item => item.Id === heroOwned.Id)).toBe(false);
        expect(latest?.heroItem?.Id).not.toBe(heroOwned.Id);
    });
});
