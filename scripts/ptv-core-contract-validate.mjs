import fs from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = process.cwd();
const schemaDirectory = path.join(root, 'contracts', 'ptv-core', 'v1');
const v2SchemaDirectory = path.join(root, 'contracts', 'ptv-core', 'v2');
const schemaFiles = fs.readdirSync(schemaDirectory)
    .filter(file => file.endsWith('.schema.json'))
    .sort();

if (schemaFiles.length !== 11) {
    throw new Error(`Expected 11 PTV Core v1 schemas, found ${schemaFiles.length}.`);
}

const schemas = schemaFiles.map(file => {
    const schema = JSON.parse(fs.readFileSync(path.join(schemaDirectory, file), 'utf8'));

    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
        throw new Error(`${file} does not declare JSON Schema 2020-12.`);
    }
    if (!schema.$id?.includes('/ptv-core/v1/')) {
        throw new Error(`${file} does not declare a ptv-core/v1 $id.`);
    }

    return { file, schema };
});
const v2SchemaFiles = fs.readdirSync(v2SchemaDirectory)
    .filter(file => file.endsWith('.schema.json'))
    .sort();

if (v2SchemaFiles.length !== 3) {
    throw new Error(`Expected 3 PTV Core v2 schemas, found ${v2SchemaFiles.length}.`);
}

const v2Schemas = v2SchemaFiles.map(file => {
    const schema = JSON.parse(fs.readFileSync(path.join(v2SchemaDirectory, file), 'utf8'));

    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
        throw new Error(`${file} does not declare JSON Schema 2020-12.`);
    }
    if (!schema.$id?.includes('/ptv-core/v2/')) {
        throw new Error(`${file} does not declare a ptv-core/v2 $id.`);
    }

    return { file, schema };
});

const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: true
});
addFormats(ajv);
schemas.forEach(({ schema }) => {
    ajv.addSchema(schema);
});
v2Schemas.forEach(({ schema }) => {
    ajv.addSchema(schema);
});

const byFile = new Map(schemas.map(({ file, schema }) => [file, schema]));
const iso = '2026-07-22T12:00:00.000Z';
const coreError = {
    contractVersion: '1.0',
    kind: 'network',
    code: 'API_TIMEOUT',
    message: 'The request timed out.',
    retryable: true,
    timestamp: iso,
    futureField: 'accepted'
};
const recommendationItem = {
    id: 'item-1',
    title: 'Example',
    mediaType: 'movie',
    score: 0.9,
    source: 'jellyfin',
    classification: 'affinity',
    reasons: [{ text: 'Matches a favorite genre.' }]
};
const recommendationRow = {
    id: 'row-1',
    title: 'Because you watched',
    items: [recommendationItem]
};

const fixtures = new Map([
    ['core-error.schema.json', coreError],
    ['diagnostic-event.schema.json', {
        contractVersion: '1.0',
        category: 'startup',
        name: 'core-ready',
        appVersion: '1.0.0',
        platform: 'web',
        deviceClass: 'desktop',
        sessionId: 'session-1',
        timestamp: iso,
        success: true,
        metadata: {}
    }],
    ['diagnostic-snapshot.schema.json', {
        contractVersion: '1.0',
        schemaVersion: 1,
        generatedAt: iso,
        diagnosticSessionId: 'diagnostic-session-1',
        privacyClassification: 'local-only',
        health: {
            status: 'healthy',
            reason: 'Observed systems are healthy.',
            lastUpdated: iso,
            metrics: {},
            warnings: [],
            collectorAvailable: true
        },
        build: {},
        platform: {},
        core: {},
        server: {},
        plugin: {},
        focusChanges: [],
        focusGraphs: [],
        focusScopes: [],
        focusVisibility: [],
        requests: [],
        routes: [],
        frames: [],
        latestFocus: {},
        inputs: [],
        images: [],
        shelves: [],
        cache: {},
        recommendations: {},
        collectorCapabilities: { frameTiming: true },
        droppedEvents: { byStream: {}, total: 0 },
        retentionLimits: { requests: 200 },
        session: {},
        self: {},
        warnings: []
    }],
    ['feature-flags.schema.json', {
        contractVersion: '1.0',
        schemaVersion: 1,
        scope: { kind: 'user', serverId: 'server-1', userId: 'user-1' },
        values: { recommendations: true }
    }],
    ['recommendation-item.schema.json', recommendationItem],
    ['recommendation-row.schema.json', recommendationRow],
    ['recommendation-response.schema.json', {
        contractVersion: '1.0',
        cacheVersion: 1,
        generatedAt: iso,
        serverId: 'server-1',
        userId: 'user-1',
        rows: [recommendationRow]
    }],
    ['cache-envelope.schema.json', {
        contractVersion: '1.0',
        schemaVersion: 1,
        key: 'home',
        scope: { kind: 'user', serverId: 'server-1', userId: 'user-1' },
        createdAt: iso,
        expiresAt: '2026-07-23T12:00:00.000Z',
        payload: { rows: [] }
    }],
    ['client-capability-report.schema.json', {
        contractVersion: '1.0',
        platform: 'android-tv',
        deviceClass: 'tv',
        capabilities: { videoPlayback: true, remoteInput: true }
    }],
    ['playback-state.schema.json', {
        contractVersion: '1.0',
        status: 'paused',
        mediaId: 'item-1',
        mediaKind: 'video',
        positionMs: 1000,
        durationMs: 2000,
        queue: ['item-1'],
        queueIndex: 0,
        repeatMode: 'off',
        shuffled: false,
        completed: false
    }],
    ['navigation-intent.schema.json', {
        contractVersion: '1.0',
        destination: 'details',
        mediaId: 'item-1',
        query: {},
        backBehavior: 'default',
        requiredCapabilities: []
    }]
]);
const policyRequestFixture = JSON.parse(fs.readFileSync(
    path.join(v2SchemaDirectory, 'fixtures', 'music-radio-policy.json'),
    'utf8'
));
const v2Fixtures = new Map([
    ['recommendation-quality-event.schema.json', {
        contractVersion: '2.0',
        policyVersion: 'music-premium-v2',
        algorithmId: 'ptv-diversified-sequence-v2',
        eventType: 'generated',
        surface: 'radio',
        timestamp: iso,
        requestId: 'request-1',
        cohort: 'fixture',
        itemCount: 24,
        familiarCount: 6,
        discoveryCount: 18,
        generationLatencyMs: 12,
        reasonCodes: ['seed-genre', 'artist-diversity']
    }],
    ['recommendation-policy-request.schema.json', policyRequestFixture],
    ['recommendation-policy-response.schema.json', {
        contractVersion: '2.0',
        policyVersion: 'music-premium-v2',
        algorithmId: 'ptv-diversified-sequence-v2',
        requestId: 'request-1',
        cohort: 'fixture',
        surface: 'radio',
        generatedAt: iso,
        generationLatencyMs: 12,
        constraints: {
            discoveryTarget: 0.75,
            familiarTarget: 0.25,
            maxItemsPerArtist: 3,
            maxItemsPerAlbum: 2,
            maxConsecutiveArtist: 2,
            maxConsecutiveAlbum: 2
        },
        items: [{
            id: 'b1',
            title: 'B One',
            mediaType: 'music',
            source: 'similar',
            classification: 'discovery',
            rank: 1,
            score: 94,
            transitionScore: 10,
            reasons: ['seed-genre']
        }]
    }]
]);

for (const { file, schema } of schemas) {
    const validate = ajv.getSchema(schema.$id);
    if (!validate) throw new Error(`${file} was not compiled.`);

    const fixture = fixtures.get(file);
    if (!fixture) throw new Error(`${file} has no positive fixture.`);
    if (!validate(fixture)) {
        throw new Error(`${file} rejected its fixture: ${ajv.errorsText(validate.errors)}`);
    }

    const invalid = { ...fixture };
    const firstRequired = schema.required?.[0];
    if (!firstRequired) throw new Error(`${file} must declare required fields.`);
    delete invalid[firstRequired];
    if (validate(invalid)) {
        throw new Error(`${file} accepted a fixture missing required field ${firstRequired}.`);
    }
}

for (const { file, schema } of v2Schemas) {
    const validate = ajv.getSchema(schema.$id);
    if (!validate) throw new Error(`${file} was not compiled.`);

    const fixture = v2Fixtures.get(file);
    if (!fixture) throw new Error(`${file} has no positive fixture.`);
    if (!validate(fixture)) {
        throw new Error(`${file} rejected its fixture: ${ajv.errorsText(validate.errors)}`);
    }

    const requiredFields = schema.required || [];
    if (!requiredFields.length) throw new Error(`${file} must declare required fields.`);
    for (const requiredField of requiredFields) {
        const invalid = structuredClone(fixture);
        delete invalid[requiredField];
        if (validate(invalid)) {
            throw new Error(`${file} accepted a fixture missing required field ${requiredField}.`);
        }
    }
}

const navigationSchema = byFile.get('navigation-intent.schema.json');
const validateNavigation = ajv.getSchema(navigationSchema.$id);
if (validateNavigation({
    contractVersion: '1.0',
    destination: 'player',
    query: {},
    backBehavior: 'default',
    requiredCapabilities: []
})) {
    throw new Error('Navigation schema accepted player intent without mediaId.');
}

const validateError = ajv.getSchema(byFile.get('core-error.schema.json').$id);
if (validateError({ ...coreError, kind: 'future-error-kind' })) {
    throw new Error('Core error schema accepted an invalid error kind.');
}

const qualityEventSchema = v2Schemas.find(({ file }) => file === 'recommendation-quality-event.schema.json')?.schema;
const validateQualityEvent = qualityEventSchema ? ajv.getSchema(qualityEventSchema.$id) : null;
const qualityEventFixture = v2Fixtures.get('recommendation-quality-event.schema.json');
if (!validateQualityEvent || !qualityEventFixture) {
    throw new Error('Recommendation quality event contract was not compiled.');
}
if (validateQualityEvent({ ...qualityEventFixture, itemId: 'private-media-id', userId: 'private-user-id' })) {
    throw new Error('Recommendation quality event accepted private media or user identifiers.');
}

const policyRequestSchema = v2Schemas.find(({ file }) => file === 'recommendation-policy-request.schema.json')?.schema;
const validatePolicyRequest = policyRequestSchema ? ajv.getSchema(policyRequestSchema.$id) : null;
if (!validatePolicyRequest) throw new Error('Recommendation policy request contract was not compiled.');
const seedlessRadioRequest = structuredClone(policyRequestFixture);
seedlessRadioRequest.seed = { id: 'seed-without-affinity' };
if (validatePolicyRequest(seedlessRadioRequest)) {
    throw new Error('Recommendation policy request accepted radio without artist, album, or genre affinity.');
}
const whitespaceRadioRequest = structuredClone(policyRequestFixture);
whitespaceRadioRequest.seed = { id: 'seed-with-whitespace', albumId: ' ', artistIds: [''], genres: ['  '] };
if (validatePolicyRequest(whitespaceRadioRequest)) {
    throw new Error('Recommendation policy request accepted radio affinity that normalizes to nothing.');
}
for (const [label, mutate] of [
    ['limit below one', value => { value.limit = 0; }],
    ['limit above two hundred', value => { value.limit = 201; }],
    ['unknown surface', value => { value.surface = 'surprise-me'; }],
    ['unknown classification', value => { value.candidates[0].classification = 'unknown'; }],
    ['candidate without id', value => { delete value.candidates[0].id; }]
]) {
    const invalid = structuredClone(policyRequestFixture);
    mutate(invalid);
    if (validatePolicyRequest(invalid)) {
        throw new Error(`Recommendation policy request accepted ${label}.`);
    }
}

const policyResponseSchema = v2Schemas.find(({ file }) => file === 'recommendation-policy-response.schema.json')?.schema;
const validatePolicyResponse = policyResponseSchema ? ajv.getSchema(policyResponseSchema.$id) : null;
const policyResponseFixture = v2Fixtures.get('recommendation-policy-response.schema.json');
if (!validatePolicyResponse || !policyResponseFixture) {
    throw new Error('Recommendation policy response contract was not compiled.');
}
for (const [label, mutate] of [
    ['unknown surface', value => { value.surface = 'surprise-me'; }],
    ['out-of-range constraint', value => { value.constraints.discoveryTarget = 2; }],
    ['malformed ranked item', value => { value.items = [{}]; }],
    ['zero item rank', value => { value.items[0].rank = 0; }],
    ['empty reason code', value => { value.items[0].reasons = ['']; }]
]) {
    const invalid = structuredClone(policyResponseFixture);
    mutate(invalid);
    if (validatePolicyResponse(invalid)) {
        throw new Error(`Recommendation policy response accepted ${label}.`);
    }
}

if (validateQualityEvent({ ...qualityEventFixture, eventType: 'hovered' })) {
    throw new Error('Recommendation quality event accepted an unknown event type.');
}

console.log(`Validated ${schemas.length} PTV Core v1 schemas, ${v2Schemas.length} PTV Core v2 schemas, and compatibility fixtures.`);
