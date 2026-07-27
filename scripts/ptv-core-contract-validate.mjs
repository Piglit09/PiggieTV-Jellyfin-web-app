import fs from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = process.cwd();
const schemaDirectory = path.join(root, 'contracts', 'ptv-core', 'v1');
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

const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: true
});
addFormats(ajv);
schemas.forEach(({ schema }) => {
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

console.log(`Validated ${schemas.length} PTV Core v1 schemas and compatibility fixtures.`);
