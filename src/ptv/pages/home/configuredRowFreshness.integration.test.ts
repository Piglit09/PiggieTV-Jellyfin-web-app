import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: { currentApiClient: () => null, getApiClient: () => null }
}));
vi.mock('../../api', () => ({
    getCurrentPtvApiClient: () => null,
    getPtvCurrentUser: vi.fn(async () => ({ Id: 'test-admin' })),
    getPtvItems: vi.fn(async () => ({ Items: [], TotalRecordCount: 0 })),
    getPtvRecentlyAdded: vi.fn(async () => []),
    getPtvResumeItems: vi.fn(async () => []),
    isPtvAdminUser: () => true,
    requestPtvJson: vi.fn()
}));

import {
    createRowsFromFeaturedPayload,
    retainCurrentNativeHomePresentation,
    type NativeHomeRow,
    type NativeHomeState
} from './hooks';
import {
    beginConfiguredRowVerification,
    getConfiguredRowProofAuthority,
    retireConfiguredRowFreshness,
    verifyConfiguredRowFreshness
} from './configuredRowFreshness';
import { acceptHomeLibraryAuthority, beginHomeLibraryVerification,
    getHomeLibraryAuthoritySnapshot } from './homeLibraryTransitionFreshness';

const identity = 'server-a:user-a';
const scope = 'a'.repeat(64);
const generation = '1'.repeat(64);
const ruleAlias = 'b'.repeat(64);
const sectionAlias = 'c'.repeat(64);
const presentationAuthority = () => ({ version: 1, scope, generation });
const configuration = () => ({
    currentPresentationAuthority: presentationAuthority(),
    enabled: true,
    schemaVersion: 2,
    rules: [ {
        id: 'latest-rule',
        itemLimit: 16,
        mediaType: 'Movie',
        name: 'Latest Movies',
        rowCount: 1,
        sourceType: 'latest'
    } ],
    configuredRowAssociations: {
        version: 1,
        scope,
        rules: [ { ruleId: 'latest-rule', association: ruleAlias } ],
        sections: [ { rule: ruleAlias, section: sectionAlias } ]
    }
});
const payload = () => ({
    currentPresentationAuthority: presentationAuthority(),
    heroItems: [],
    sectionItems: { section: [ { Id: 'authorized-item', Name: 'Fixture', Type: 'Movie' } ] },
    sections: [ {
        configuredRowAssociation: { version: 1, scope, rule: ruleAlias, section: sectionAlias },
        id: 'section',
        mediaType: 'Movie',
        rowType: 'configured-rule',
        source: 'authorized',
        sourceType: 'latest',
        title: 'Featured'
    } ]
});

async function currentProof() {
    return verifyConfiguredRowFreshness({
        verification: beginConfiguredRowVerification(identity),
        settings: configuration(),
        featured: payload(),
        readAuthority: async () => ({
            currentPresentationAuthority: presentationAuthority(),
            configuredPresentationBindings: [ { rule: ruleAlias, section: sectionAlias } ]
        })
    });
}

function row(overrides: Partial<NativeHomeRow>): NativeHomeRow {
    return {
        id: 'row',
        items: [],
        kind: 'items',
        rowType: 'fallback',
        source: 'recently-added',
        subtitle: '',
        title: 'Row',
        ...overrides
    };
}

function homeState(
    rows: NativeHomeRow[],
    heroItems: Array<{ Id: string; Name: string }>,
    independentHeroItems: Array<{ Id: string; Name: string }> = []
): NativeHomeState {
    const access = getHomeLibraryAuthoritySnapshot();
    return {
        debug: { home: {} as never, performance: {} as never, recommendations: {} as never },
        error: null,
        heroAccessEpoch: access.userAccess?.accessEpoch || null,
        heroItem: heroItems[0] || null,
        heroItems,
        independentHeroItems,
        isLoading: false,
        rows: rows.map(value => value.source === 'featured-cache' || value.source === 'featured-endpoint' ?
            { ...value, homeUserAccessEpoch: access.userAccess?.accessEpoch || undefined,
                homeLibraryRevision: access.revision } : value),
        user: null
    };
}

beforeEach(() => {
    retireConfiguredRowFreshness('test-reset');
    const revision = beginHomeLibraryVerification(identity);
    acceptHomeLibraryAuthority({
        currentHomeTopology: { version: 1, epoch: 'f'.repeat(64), held: false },
        currentHomeUserAccess: { version: 1, userId: 'user-a', accessEpoch: 'e'.repeat(64),
            held: false, policyProven: true }
    }, revision, identity);
});

describe('configured-row freshness Home row-builder integration', () => {
    it('does not infer Hero authority for unknown or old access provenance', () => {
        const independentItem = { Id: 'independent-hero', Name: 'Independent' };
        const current = homeState([ row({ id: 'generic', items: [ independentItem ] }) ],
            [ independentItem ], [ independentItem ]);

        expect(retainCurrentNativeHomePresentation({ ...current, heroAccessEpoch: undefined }, identity).heroItems)
            .toEqual([]);
        expect(retainCurrentNativeHomePresentation({ ...current, heroAccessEpoch: 'd'.repeat(64) }, identity).heroItems)
            .toEqual([]);
        expect(retainCurrentNativeHomePresentation(current, identity).heroItems).toEqual([ independentItem ]);
    });

    it('promotes and tags a configured row only through a live private proof', async () => {
        const proof = await currentProof();
        const result = createRowsFromFeaturedPayload(payload(), {
            configuredProof: proof,
            rowSettings: configuration()
        });

        expect(proof).not.toBeNull();
        expect(result.skippedRows).toEqual([]);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({
            configuredPresentationAuthority: getConfiguredRowProofAuthority(proof),
            id: `featured-associated-${sectionAlias}`,
            ruleId: 'latest-rule',
            title: 'Latest Movies'
        });
    });

    it('fails closed for the same matching response pair when no final proof is supplied', () => {
        const result = createRowsFromFeaturedPayload(payload(), {
            configuredProof: null,
            rowSettings: configuration()
        });

        expect(result.rows).toEqual([]);
        expect(result.skippedRows).toHaveLength(1);
    });

    it('does not let client-edited opaque association metadata force configured adoption', async () => {
        const proof = await currentProof();
        const edited = payload();
        edited.sections[0].configuredRowAssociation.section = 'd'.repeat(64);
        const result = createRowsFromFeaturedPayload(edited, {
            configuredProof: proof,
            rowSettings: configuration()
        });

        expect(result.rows).toEqual([]);
        expect(result.skippedRows).toHaveLength(1);
    });

    it.each([
        [ 'old opaque association', { configuredRowAssociation: { version: 1, scope, rule: ruleAlias, section: sectionAlias } } ],
        [ 'case-varied null authority marker', { ConfiguredPresentationAuthority: null } ]
    ])('does not let rowType fallback disguise an unverified configured section with %s', (_label, marker) => {
        const disguised = payload();
        const sectionValue = { ...disguised.sections[0] } as Record<string, unknown>;
        delete sectionValue.configuredRowAssociation;
        Object.assign(sectionValue, marker, { rowType: 'fallback' });
        disguised.sections[0] = sectionValue as never;
        const result = createRowsFromFeaturedPayload(disguised, {
            configuredProof: null,
            rowSettings: null
        });

        expect(result.rows).toEqual([]);
        expect(result.skippedRows).toHaveLength(1);
    });

    it('keeps a genuinely generic authorized row independent of configured proof state', () => {
        const generic = payload();
        const genericSection = { ...generic.sections[0], rowType: 'fallback' } as Record<string, unknown>;
        delete genericSection.configuredRowAssociation;
        generic.sections[0] = genericSection as never;
        const result = createRowsFromFeaturedPayload(generic, {
            configuredProof: null,
            rowSettings: null
        });

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].configuredPresentationAuthority).toBeUndefined();
    });

    it('retires configured rows and their derived heroes while preserving generic and independent hero provenance', async () => {
        const proof = await currentProof();
        const key = getConfiguredRowProofAuthority(proof);
        const configuredItem = { Id: 'configured-hero', Name: 'Configured' };
        const genericItem = { Id: 'generic-hero', Name: 'Generic' };
        const independentItem = { Id: 'independent-hero', Name: 'Independent' };
        const state = homeState([
            row({
                configuredPresentationAuthority: key,
                id: 'configured',
                items: [ configuredItem ],
                rowType: 'configured-rule',
                source: 'featured-cache'
            }),
            row({ id: 'generic', items: [ genericItem ] })
        ], [ configuredItem, genericItem, independentItem ], [ independentItem ]);

        const current = retainCurrentNativeHomePresentation(state, identity);
        expect(current.rows.map(value => value.id)).toEqual([ 'configured', 'generic' ]);
        retireConfiguredRowFreshness('observed-mutation');
        const retired = retainCurrentNativeHomePresentation(current, identity);

        expect(retired.rows.map(value => value.id)).toEqual([ 'generic' ]);
        expect(retired.heroItems.map(item => item.Id)).toEqual([ 'generic-hero', 'independent-hero' ]);
        expect(retired.heroItem?.Id).toBe('generic-hero');
        expect(retired.configuredHeroAuthorities).toEqual({});
    });

    it('keeps a shared hero when an independent generic row still owns the same item', async () => {
        const proof = await currentProof();
        const shared = { Id: 'shared-hero', Name: 'Shared' };
        const state = homeState([
            row({
                configuredPresentationAuthority: getConfiguredRowProofAuthority(proof),
                id: 'configured',
                items: [ shared ],
                rowType: 'configured-rule',
                source: 'featured-cache'
            }),
            row({ id: 'generic', items: [ shared ] })
        ], [ shared ]);

        retireConfiguredRowFreshness('observed-mutation');
        const retired = retainCurrentNativeHomePresentation(state, identity);
        expect(retired.rows.map(value => value.id)).toEqual([ 'generic' ]);
        expect(retired.heroItems.map(item => item.Id)).toEqual([ 'shared-hero' ]);
        expect(retired.heroItem?.Id).toBe('shared-hero');
    });

    it('carries configured hero provenance when a same-id row replaces item P with Q but the old P hero falls back', async () => {
        const proof = await currentProof();
        const key = getConfiguredRowProofAuthority(proof);
        const itemP = { Id: 'configured-p', Name: 'P' };
        const itemQ = { Id: 'configured-q', Name: 'Q' };
        const previous = retainCurrentNativeHomePresentation(homeState([ row({
            configuredPresentationAuthority: key,
            id: 'configured-same-id',
            items: [ itemP ],
            rowType: 'configured-rule',
            source: 'featured-cache'
        }) ], [ itemP ]), identity);
        const replacement = retainCurrentNativeHomePresentation({
            ...homeState([ row({
                configuredPresentationAuthority: key,
                id: 'configured-same-id',
                items: [ itemQ ],
                rowType: 'configured-rule',
                source: 'featured-cache'
            }) ], [ itemP ]),
            configuredHeroAuthorities: previous.configuredHeroAuthorities
        }, identity);

        expect(replacement.configuredHeroAuthorities).toEqual({ 'configured-p': key });
        retireConfiguredRowFreshness('observed-mutation');
        const retired = retainCurrentNativeHomePresentation(replacement, identity);
        expect(retired.heroItems).toEqual([]);
        expect(retired.heroItem).toBeNull();
    });

    it('preserves the exact live Resume owner but retires its stale configured presentation metadata', async () => {
        const proof = await currentProof();
        const resumeItem = { Id: 'resume-item', Name: 'In progress' };
        const state = homeState([ row({
            configuredPresentationAuthority: getConfiguredRowProofAuthority(proof),
            id: 'resume',
            items: [ resumeItem ],
            rowType: 'configured-rule',
            ruleId: 'configured-continue',
            source: 'resume',
            sourceGroupId: 'Custom',
            sourceRuleId: 'configured-continue',
            sourceType: 'continueWatching',
            subtitle: 'Custom subtitle',
            title: 'Custom Continue'
        }) ], []);

        expect(retainCurrentNativeHomePresentation(state, identity).rows[0].title).toBe('Custom Continue');
        retireConfiguredRowFreshness('observed-mutation');
        const [ retained ] = retainCurrentNativeHomePresentation(state, identity).rows;

        expect(retained).toMatchObject({
            id: 'resume',
            items: [ resumeItem ],
            rowType: 'fallback',
            source: 'resume',
            sourceGroupId: 'jellyfin-defaults',
            subtitle: 'Pick up where you left off',
            title: 'Continue Watching'
        });
        expect(retained.configuredPresentationAuthority).toBeUndefined();
        expect(retained.ruleId).toBeUndefined();
        expect(retained.sourceRuleId).toBeUndefined();
    });
});
