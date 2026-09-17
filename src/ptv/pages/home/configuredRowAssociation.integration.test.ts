import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ admin: true, getSettings: vi.fn(), getRows: vi.fn() }));
vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: { currentApiClient: () => null, getApiClient: () => null }
}));
vi.mock('../../api', () => ({
    getCurrentPtvApiClient: () => null,
    getPtvCurrentUser: vi.fn(async () => ({ Id: 'test-admin' })),
    getPtvItems: vi.fn(async () => ({ Items: [], TotalRecordCount: 0 })),
    getPtvRecentlyAdded: vi.fn(async () => []),
    getPtvResumeItems: vi.fn(async () => []),
    isPtvAdminUser: () => mocks.admin
}));
vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => ({ getSettings: mocks.getSettings, getRows: mocks.getRows }),
    normalizePtvApiError: () => ({ kind: 'server', message: 'simulated unavailable' })
}));

import {
    createRowsFromFeaturedPayload,
    fetchRowsEndpointSettings,
    getRowsEndpointSettingsHash
} from './hooks';
import { sanitizeFeaturedPayloadForSharedCache } from '../../modules/cache/featuredContentCache';
import { reconcilePtvFeaturedPayloadForUser } from './featuredPayloadIdentity';
import {
    beginConfiguredRowVerification,
    retireConfiguredRowFreshness,
    verifyConfiguredRowFreshness,
    type ConfiguredRowProof
} from './configuredRowFreshness';

const scope = 'a'.repeat(64);
const generation = '1'.repeat(64);
const ruleAlias = 'b'.repeat(64);
const sectionAlias = 'c'.repeat(64);
const otherInstance = 'd'.repeat(64);
const configuration = () => ({
    currentPresentationAuthority: { version: 1, scope, generation },
    enabled: true,
    schemaVersion: 2,
    rules: [ { id: 'latest-rule', name: 'Latest Movies', sourceType: 'latest', mediaType: 'Movie', rowCount: 1, itemLimit: 16 } ],
    configuredRowAssociations: {
        version: 1,
        scope,
        rules: [ { ruleId: 'latest-rule', association: ruleAlias } ],
        sections: [ { rule: ruleAlias, section: sectionAlias } ]
    }
});
const payload = (items = [ { Id: 'survivor', Name: 'Fixture', Type: 'Movie' } ]) => ({
    currentPresentationAuthority: { version: 1, scope, generation },
    heroItems: [],
    sectionItems: { section: items },
    sections: [ {
        id: 'section', title: 'Featured', source: 'authorized', sourceType: 'latest', rowType: 'configured-rule', mediaType: 'Movie',
        configuredRowAssociation: { version: 1, scope, rule: ruleAlias, section: sectionAlias }
    } ]
});

let configuredProof: ConfiguredRowProof | null = null;

function establishConfiguredProof(
    value = payload(),
    rowSettings = configuration()
) {
    return verifyConfiguredRowFreshness({
        verification: beginConfiguredRowVerification('server-a:user-a'),
        settings: rowSettings,
        featured: value,
        readAuthority: async () => ({
            currentPresentationAuthority: { version: 1, scope, generation },
            configuredPresentationBindings: rowSettings.configuredRowAssociations.sections
        })
    });
}

function createVerifiedRows(
    value: Parameters<typeof createRowsFromFeaturedPayload>[0],
    rowSettings: NonNullable<Parameters<typeof createRowsFromFeaturedPayload>[1]>['rowSettings']
) {
    return createRowsFromFeaturedPayload(value, { configuredProof, rowSettings });
}

beforeEach(async () => {
    mocks.admin = true;
    mocks.getSettings.mockReset();
    mocks.getRows.mockReset();
    retireConfiguredRowFreshness('test-reset');
    configuredProof = await establishConfiguredProof();
    expect(configuredProof).not.toBeNull();
});

describe('configured row association Home integration', () => {
    it('restores the administrator label only after matching and keeps exact authorized items', () => {
        const value = payload();
        const result = createVerifiedRows(value, configuration());
        expect(result.skippedRows).toEqual([]);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toMatchObject({ title: 'Latest Movies', ruleId: 'latest-rule', id: `featured-associated-${sectionAlias}` });
        expect(result.rows[0].items).toEqual(value.sectionItems.section);
        expect(value.sections[0]).not.toHaveProperty('ruleId');
        expect(value.sections[0]).not.toHaveProperty('sourceRuleId');
    });

    it('preserves metadata through existing cache compaction and current-user reconciliation', () => {
        const value = payload();
        const compact = sanitizeFeaturedPayloadForSharedCache(value);
        const reconciled = reconcilePtvFeaturedPayloadForUser(compact, value.sectionItems.section);
        const result = createVerifiedRows(reconciled, configuration());
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].title).toBe('Latest Movies');
    });

    it('does not fabricate a populated row from an empty authorized section', () => {
        const result = createVerifiedRows(payload([]), configuration());
        expect(result.rows).toEqual([]);
        expect(result.skippedRows.some(row => row.reason === 'empty-items')).toBe(true);
    });

    it('keeps a partially authorized survivor set without additional discovery', () => {
        const value = payload([ { Id: 'only-survivor', Name: 'Fixture', Type: 'Movie' } ]);
        expect(createVerifiedRows(value, configuration()).rows[0].items).toEqual(value.sectionItems.section);
        expect(mocks.getRows).not.toHaveBeenCalled();
        expect(mocks.getSettings).not.toHaveBeenCalled();
    });

    it('does not accept stale scope even with a valid raw legacy rule ID', () => {
        const value = payload();
        Object.assign(value.sections[0], { sourceRuleId: 'latest-rule' });
        value.sections[0].configuredRowAssociation.scope = 'f'.repeat(64);
        const result = createVerifiedRows(value, configuration());
        expect(result.rows).toEqual([]);
        expect(result.skippedRows[0].reason).toBe('configured-association-scope-mismatch');
    });

    it('preserves restricted-user non-adoption and never loads admin configuration', async () => {
        mocks.admin = false;
        expect(await fetchRowsEndpointSettings()).toBeNull();
        expect(mocks.getSettings).not.toHaveBeenCalled();
        expect(mocks.getRows).not.toHaveBeenCalled();
        const result = createRowsFromFeaturedPayload(payload(), { rowSettings: null });
        expect(result.rows).toEqual([]);
        expect(result.skippedRows[0].reason).toBe('configured-row-home-output-disabled');
    });

    it('keeps valid instance identities stable across reload and renamed generic IDs', () => {
        const original = payload();
        const next = payload();
        next.sections[0].id = 'section-9';
        Object.assign(next.sectionItems, { 'section-9': next.sectionItems.section });
        expect(createVerifiedRows(original, configuration()).rows[0].id)
            .toBe(createVerifiedRows(next, configuration()).rows[0].id);
    });

    it('supports two subrows without inventing a derived title or selector', async () => {
        const config = configuration();
        config.rules[0].rowCount = 2;
        config.configuredRowAssociations.sections.push({ rule: ruleAlias, section: otherInstance });
        const value = payload();
        value.sections.push({ ...value.sections[0], id: 'section-2', configuredRowAssociation: { version: 1, scope, rule: ruleAlias, section: otherInstance } });
        Object.assign(value.sectionItems, { 'section-2': [ { Id: 'second-survivor', Name: 'Second', Type: 'Movie' } ] });
        configuredProof = await establishConfiguredProof(value, config);
        const result = createVerifiedRows(value, config);
        expect(result.rows).toHaveLength(2);
        expect(new Set(result.rows.map(row => row.id)).size).toBe(2);
        expect(result.rows.map(row => row.title)).toEqual([ 'Featured', 'Featured' ]);
        expect(result.rows.map(row => row.sourceValue)).toEqual([ undefined, undefined ]);
    });

    it('rejects duplicate instances rather than silently deduplicating an ambiguous response', () => {
        const value = payload();
        value.sections.push({ ...value.sections[0] });
        const result = createVerifiedRows(value, configuration());
        expect(result.rows).toEqual([]);
    });

    it('retains the existing configured row-count limit for multiple issued instances', async () => {
        const config = configuration();
        config.configuredRowAssociations.sections.push({ rule: ruleAlias, section: otherInstance });
        const value = payload();
        value.sections.push({ ...value.sections[0], id: 'section-2', configuredRowAssociation: { version: 1, scope, rule: ruleAlias, section: otherInstance } });
        Object.assign(value.sectionItems, { 'section-2': [ { Id: 'second-survivor', Name: 'Second', Type: 'Movie' } ] });
        configuredProof = await establishConfiguredProof(value, config);
        const result = createVerifiedRows(value, config);
        expect(result.rows).toHaveLength(1);
        expect(result.skippedRows[0].reason).toBe('configured-row-limit-reached');
    });

    it('preserves an unreduced section label while selecting the issued owner rather than a conflicting raw ID', () => {
        const value = payload();
        Object.assign(value.sections[0], { title: 'Authorized existing label', source: 'generated', sourceRuleId: 'wrong-rule' });
        const result = createVerifiedRows(value, configuration());
        expect(result.rows[0]).toMatchObject({ title: 'Authorized existing label', ruleId: 'latest-rule' });
    });

    it('omits an unverified legacy configured row while preserving a marker-free generic fallback', () => {
        const value = {
            heroItems: [], sectionItems: { legacy: [ { Id: 'legacy-item', Type: 'Movie' } ] },
            sections: [ { id: 'legacy', sourceRuleId: 'latest-rule', sourceType: 'latest', title: 'Legacy latest', rowType: 'configured-rule' } ]
        };
        const config = { enabled: true, rules: configuration().rules };
        const unverified = createRowsFromFeaturedPayload(value, { configuredProof, rowSettings: config });
        expect(unverified.rows).toEqual([]);
        expect(unverified.skippedRows[0].reason).toBe('configured-authority-unverified');
        value.sections[0].rowType = 'fallback';
        delete (value.sections[0] as { sourceRuleId?: string }).sourceRuleId;
        expect(createRowsFromFeaturedPayload(value, { rowSettings: null }).rows).toHaveLength(1);
    });

    it('excludes only response association metadata from the legacy configuration hash', () => {
        const config = configuration();
        const legacy = { enabled: config.enabled, schemaVersion: config.schemaVersion, rules: config.rules };
        expect(getRowsEndpointSettingsHash(config)).toBe(getRowsEndpointSettingsHash(legacy));
        expect(getRowsEndpointSettingsHash({ ...legacy, rules: [ { ...legacy.rules[0], name: 'Changed' } ] }))
            .not.toBe(getRowsEndpointSettingsHash(legacy));
    });

    it('preserves the response mapping through the primary settings endpoint', async () => {
        const config = configuration();
        mocks.getSettings.mockResolvedValue({ rows: config });
        const actual = await fetchRowsEndpointSettings();
        expect(actual?.configuredRowAssociations).toEqual(config.configuredRowAssociations);
        expect(createRowsFromFeaturedPayload(payload(), { configuredProof, rowSettings: actual }).rows).toHaveLength(1);
        expect(mocks.getRows).not.toHaveBeenCalled();
    });

    it('preserves the response mapping through the rows fallback endpoint', async () => {
        const config = configuration();
        mocks.getSettings.mockRejectedValue(new Error('simulated unavailable'));
        mocks.getRows.mockResolvedValue(config);
        const actual = await fetchRowsEndpointSettings();
        expect(actual?.configuredRowAssociations).toEqual(config.configuredRowAssociations);
        expect(createRowsFromFeaturedPayload(payload(), { configuredProof, rowSettings: actual }).rows).toHaveLength(1);
        expect(mocks.getRows).toHaveBeenCalledOnce();
    });
});
