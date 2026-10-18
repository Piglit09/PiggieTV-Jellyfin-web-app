import fs from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const directory = path.join(process.cwd(), 'contracts', 'ptv-channels', 'v1');
const baseId = 'https://piggietv.com/contracts/ptv-channels/v1/';
const readJson = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
const schemaFiles = fs.readdirSync(directory).filter(file => file.endsWith('.schema.json')).sort();
const requiredSchemas = [
    'admin.schema.json', 'capabilities-response.schema.json', 'channel-list-response.schema.json',
    'common.schema.json', 'entry.schema.json', 'error-response.schema.json',
    'guide-query.schema.json', 'guide-response.schema.json', 'resolve-request.schema.json',
    'resolve-response.schema.json'
];
for (const file of requiredSchemas) {
    if (!schemaFiles.includes(file)) throw new Error('Missing Channels schema ' + file);
}

// Valid "not required" privacy clauses span allOf references, which Ajv cannot type-infer locally.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
addFormats(ajv);
for (const file of schemaFiles) {
    const schema = readJson(file);
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema'
        || schema.$id !== baseId + file) {
        throw new Error(file + ' has an unexpected dialect or $id.');
    }
    ajv.addSchema(schema);
}
for (const file of schemaFiles) {
    if (!ajv.getSchema(baseId + file)) throw new Error(file + ' did not compile.');
}

const manifest = readJson('http-contract.json');
if (manifest.contractVersion !== '1.0' || manifest.basePath !== '/Ptv/v1/channels') {
    throw new Error('Unexpected Channels manifest version or namespace.');
}
const operations = new Map(manifest.operations.map(operation => [operation.id, operation]));
if (operations.size !== manifest.operations.length) throw new Error('Duplicate operation id.');
const expectedOperations = [
    'capabilities', 'list', 'guide', 'resolve', 'admin-list', 'admin-create',
    'admin-read', 'admin-update', 'admin-preview'
];
const expectedHttp = {
    capabilities: ['GET', '/Ptv/v1/channels/capabilities', 'user', null, null, 'capabilities-response.schema.json', 200],
    list: ['GET', '/Ptv/v1/channels', 'user', null, null, 'channel-list-response.schema.json', 200],
    guide: ['GET', '/Ptv/v1/channels/{channelId}/guide', 'user', null, 'guide-query.schema.json', 'guide-response.schema.json', 200],
    resolve: ['POST', '/Ptv/v1/channels/{channelId}/resolve', 'user', 'resolve-request.schema.json', null, 'resolve-response.schema.json', 200],
    'admin-list': ['GET', '/Ptv/v1/channels/admin/{resource}', 'administrator', null, null, 'admin.schema.json#/$defs/listEnvelope', 200],
    'admin-create': ['POST', '/Ptv/v1/channels/admin/{resource}', 'administrator', 'admin.schema.json#/$defs/writeEnvelope', null, 'admin.schema.json#/$defs/readEnvelope', 201],
    'admin-read': ['GET', '/Ptv/v1/channels/admin/{resource}/{id}', 'administrator', null, null, 'admin.schema.json#/$defs/readEnvelope', 200],
    'admin-update': ['PUT', '/Ptv/v1/channels/admin/{resource}/{id}', 'administrator', 'admin.schema.json#/$defs/writeEnvelope', null, 'admin.schema.json#/$defs/readEnvelope', 200],
    'admin-preview': ['POST', '/Ptv/v1/channels/admin/preview', 'administrator', 'admin.schema.json#/$defs/previewRequest', null, 'admin.schema.json#/$defs/previewResponse', 200]
};
for (const id of expectedOperations) {
    if (!operations.has(id)) throw new Error('Missing Channels operation ' + id);
    const operation = operations.get(id);
    const actual = [operation.method, operation.path, operation.auth, operation.requestSchema ?? null,
        operation.querySchema ?? null, operation.responseSchema, operation.successStatus];
    if (JSON.stringify(actual) !== JSON.stringify(expectedHttp[id])) {
        throw new Error('Unexpected HTTP mapping for ' + id);
    }
    const expectedETag = ['admin-create', 'admin-read', 'admin-update'].includes(id) ?
        'resourceRevision' : undefined;
    if (operation.responseETag !== expectedETag
        || Boolean(operation.requestIfMatch) !== (id === 'admin-update')) {
        throw new Error('Unexpected conditional HTTP contract for ' + id);
    }
}
if (operations.size !== expectedOperations.length) throw new Error('Unexpected Channels operation count.');
if (operations.get('guide').maxWindowHours !== 24
    || operations.get('guide').maxEntriesPerPage !== 500) {
    throw new Error('Guide limits differ from the approved RFC.');
}
const schemaFor = reference => {
    const validate = ajv.getSchema(baseId + reference);
    if (!validate) throw new Error('Uncompiled schema reference: ' + reference);
    return validate;
};
for (const operation of manifest.operations) {
    if (!operation.path.startsWith(manifest.basePath)
        || !['GET', 'POST', 'PUT'].includes(operation.method)
        || !['user', 'administrator'].includes(operation.auth)
        || operation.cacheControl !== 'private, no-store') {
        throw new Error('Invalid HTTP contract for ' + operation.id);
    }
    schemaFor(operation.responseSchema);
    if (operation.requestSchema) schemaFor(operation.requestSchema);
    if (operation.querySchema) schemaFor(operation.querySchema);
    const params = operation.path.split('/')
        .filter(part => part.startsWith('{') && part.endsWith('}'));
    if (params.length > 0 && !operation.pathParamsSchema) {
        throw new Error('Missing path parameter schema for ' + operation.id);
    }
    if (operation.pathParamsSchema) {
        operation.validatePathParams = ajv.compile(operation.pathParamsSchema);
        if (operation.path.includes('{resource}')) {
            const allowed = operation.pathParamsSchema.properties?.resource?.enum;
            if (JSON.stringify(allowed) !== JSON.stringify(['definitions', 'collections', 'blocks'])) {
                throw new Error('Unexpected admin resource path values for ' + operation.id);
            }
        }
    }
}
schemaFor('error-response.schema.json');

const fixtureFiles = ['fixtures/user-success.json', 'fixtures/user-errors.json', 'fixtures/admin.json'];
const fixtures = fixtureFiles.flatMap(file => readJson(file));
const byId = new Map(fixtures.map(fixture => [fixture.id, fixture]));
if (byId.size !== fixtures.length) throw new Error('Duplicate positive fixture id.');
const knownItemIds = new Set(fixtures.flatMap(fixture => {
    if (fixture.operation === 'resolve' && fixture.status === 200) {
        return [fixture.response.itemId];
    }
    if (fixture.operation === 'admin-preview' && fixture.status === 200) {
        return fixture.response.entries.map(entry => entry.itemId).filter(Boolean);
    }
    return [];
}));
const differenceMs = (end, start) => Date.parse(end) - Date.parse(start);
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};
const validatePayload = (reference, payload, label) => {
    const validate = schemaFor(reference);
    assert(validate(payload), label + ' failed ' + reference + ': ' + ajv.errorsText(validate.errors));
};
const resourceTypeFor = resource => ({ definitions: 'definition', collections: 'collection', blocks: 'block' })[resource];
const resourceRevision = response => {
    const field = {
        definition: 'definitionRevision',
        collection: 'collectionRevision',
        block: 'blockRevision'
    }[response.resourceType];
    return response.resource?.[field];
};
const resourceIdentity = (resourceType, resource) => {
    const idField = { definition: 'channelId', collection: 'collectionId', block: 'blockId' }[resourceType];
    const revisionField = {
        definition: 'definitionRevision', collection: 'collectionRevision', block: 'blockRevision'
    }[resourceType];
    return resourceType + ':' + resource[idField] + ':' + resource[revisionField];
};
const canonicalJson = value => {
    if (Array.isArray(value)) return value.map(canonicalJson);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, canonicalJson(child)]));
    }
    return value;
};
const authoritativeAdminResources = new Map();
for (const fixture of fixtures) {
    if (!['admin-create', 'admin-update'].includes(fixture.operation)
        || fixture.status !== operations.get(fixture.operation).successStatus) continue;
    const { resourceType, resource } = fixture.response;
    const key = resourceIdentity(resourceType, resource);
    if (authoritativeAdminResources.has(key)) throw new Error('Duplicate authoritative admin revision ' + key);
    authoritativeAdminResources.set(key, JSON.stringify(canonicalJson(resource)));
}
const assertAdminRepresentation = (resourceType, resource, label) => {
    const key = resourceIdentity(resourceType, resource);
    const expected = authoritativeAdminResources.get(key);
    assert(expected, label + ': unknown admin resource revision ' + key);
    assert(JSON.stringify(canonicalJson(resource)) === expected,
        label + ': admin representation changed without a new revision');
};
const assertEntries = (entries, fromUtc, toUtc, label) => {
    let previousEnd = null;
    const ids = new Set();
    for (const entry of entries) {
        assert(differenceMs(entry.endUtc, entry.startUtc) > 0, label + ': nonpositive entry duration');
        assert(differenceMs(entry.endUtc, fromUtc) > 0 && differenceMs(toUtc, entry.startUtc) > 0,
            label + ': entry does not intersect requested window');
        if (previousEnd) {
            assert(differenceMs(entry.startUtc, previousEnd) >= 0, label + ': overlapping or unordered entries');
        }
        previousEnd = entry.endUtc;
        if (entry.programId) {
            assert(!ids.has(entry.programId), label + ': duplicate programId on one page');
            ids.add(entry.programId);
        }
    }
};
const assertNoItemId = (value, label) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        assert(key !== 'itemId', label + ': itemId escaped into a user projection or error');
        assertNoItemId(child, label);
    }
};
const assertNoKnownItemIds = (value, label) => {
    if (typeof value === 'string') {
        for (const itemId of knownItemIds) {
            assert(!value.includes(itemId), label + ': known Jellyfin item ID escaped in a string');
        }
    } else if (value && typeof value === 'object') {
        for (const child of Object.values(value)) assertNoKnownItemIds(child, label);
    }
};
const assertAdminFields = (payload, label) => {
    const { resourceType, resource } = payload;
    if (resourceType === 'definition') {
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: resource.timeZone });
        } catch {
            throw new Error(label + ': invalid IANA time zone');
        }
    }
    if (resourceType === 'collection' && resource.minDurationMs !== undefined
        && resource.maxDurationMs !== undefined) {
        assert(resource.minDurationMs <= resource.maxDurationMs, label + ': reversed duration range');
    }
};
const assertPathAndHeaders = (fixture, operation) => {
    const label = fixture.id;
    const templateParams = operation.path.split('/')
        .filter(part => part.startsWith('{') && part.endsWith('}'))
        .map(part => part.slice(1, -1));
    for (const param of templateParams) {
        assert(typeof fixture.pathParams?.[param] === 'string' && fixture.pathParams[param].length > 0,
            label + ': missing path parameter ' + param);
    }
    if (operation.validatePathParams) {
        assert(operation.validatePathParams(fixture.pathParams),
            label + ': invalid path parameters: ' + ajv.errorsText(operation.validatePathParams.errors));
    } else {
        assert(fixture.pathParams === undefined, label + ': unexpected path parameters');
    }
    assert(fixture.headers?.['Cache-Control'] === operation.cacheControl, label + ': incorrect Cache-Control');
};
const assertSuccess = (fixture, operation) => {
    const label = fixture.id;
    const validUser = ['user', 'restrictedUser', 'administrator'].includes(fixture.principal);
    assert(operation.auth === 'administrator' ? fixture.principal === 'administrator' : validUser,
        label + ': unauthorized success principal');
    if (operation.requestSchema) {
        assert(fixture.request, label + ': missing request body');
        validatePayload(operation.requestSchema, fixture.request, label + ' request');
    }
    if (operation.querySchema) {
        assert(fixture.query, label + ': missing query');
        validatePayload(operation.querySchema, fixture.query, label + ' query');
    }
    validatePayload(operation.responseSchema, fixture.response, label + ' response');
    if (operation.auth === 'user' && operation.id !== 'resolve') {
        assertNoItemId(fixture.response, label);
        assertNoKnownItemIds(fixture.response, label);
    }
    if (operation.requestIfMatch) {
        const value = fixture.requestHeaders?.['If-Match'];
        assert(typeof value === 'string' && value.startsWith('"') && value.endsWith('"')
            && value.length > 2, label + ': success lacks a quoted If-Match');
    }
    if (operation.responseETag) {
        assert(fixture.headers.ETag === '"' + resourceRevision(fixture.response) + '"',
            label + ': ETag does not match the returned resource revision');
    }
    if (operation.requestIfMatch) {
        assert(fixture.requestHeaders['If-Match'] !== fixture.headers.ETag,
            label + ': update did not advance the resource revision');
    }
};
const assertErrorAttempt = (fixture, operation, code) => {
    const label = fixture.id;
    if (operation.requestSchema && !['INVALID_REQUEST', 'UNAUTHENTICATED',
        'PRINCIPAL_UNAVAILABLE', 'ADMIN_REQUIRED'].includes(code)) {
        assert(fixture.request, label + ': error lacks the attempted request body');
    }
    if (fixture.request && operation.requestSchema
        && !['INVALID_REQUEST', 'UNSUPPORTED_CONTRACT'].includes(code)) {
        validatePayload(operation.requestSchema, fixture.request, label + ' request');
    }
    if (operation.querySchema && !['UNAUTHENTICATED', 'PRINCIPAL_UNAVAILABLE'].includes(code)) {
        assert(fixture.query, label + ': error lacks the attempted query');
    }
    if (fixture.query && operation.querySchema && code !== 'INVALID_REQUEST') {
        validatePayload(operation.querySchema, fixture.query, label + ' query');
    }
};
const assertErrorSemantics = (fixture, operation, code) => {
    const label = fixture.id;
    if (label === 'invalid-guide-window') {
        assert(differenceMs(fixture.query.toUtc, fixture.query.fromUtc) > 24 * 60 * 60 * 1000,
            label + ': expected an oversized guide window');
    }
    if (code === 'INVALID_DEFINITION') {
        assert(fixture.request.resourceType === 'block'
            && fixture.request.resource.collectionId === fixture.fixtureContext?.collectionId
            && fixture.request.resource.selectionMode === 'seededShuffle'
            && fixture.fixtureContext?.mediaType === 'episode'
            && fixture.fixtureContext?.invalidReason === 'MODE_MEDIA_TYPE_MISMATCH',
        label + ': expected a concrete mode/media-type conflict');
    }
    if (code === 'UNAUTHENTICATED') assert(fixture.principal === 'anonymous', label + ': wrong anonymous principal');
    if (code === 'PRINCIPAL_UNAVAILABLE') {
        assert(['apiKeyOnly', 'missingUser', 'ambiguousUser', 'deletedUser', 'disabledUser']
            .includes(fixture.principal), label + ': wrong missing-user principal');
    }
    if (code === 'ADMIN_REQUIRED') {
        assert(operation.auth === 'administrator' && fixture.principal !== 'administrator',
            label + ': wrong admin-denial principal');
    }
    if (code === 'RESOURCE_NOT_FOUND') {
        assert(operation.auth === 'administrator' && fixture.principal === 'administrator',
            label + ': wrong admin resource lookup context');
    }
    if (code === 'PROGRAM_ROLLOVER') {
        const delay = differenceMs(fixture.response.error.retryAtUtc, fixture.response.serverTimeUtc);
        assert(delay > 0 && delay <= 10000, label + ': rollover retry is outside the terminal window');
    }
};
const assertError = (fixture, operation) => {
    const label = fixture.id;
    const code = fixture.response?.error?.code;
    assert(manifest.errorStatus[code] === fixture.status, label + ': error code/status mismatch');
    validatePayload('error-response.schema.json', fixture.response, label + ' error');
    assertErrorAttempt(fixture, operation, code);
    assertErrorSemantics(fixture, operation, code);
    assertNoItemId(fixture.response, label);
    assertNoKnownItemIds(fixture.response, label);
};
const assertList = fixture => {
    const { response, id: label } = fixture;
    assertNoItemId(response, label);
    const ids = new Set();
    for (const channel of response.channels) {
        assert(!ids.has(channel.channelId), label + ': duplicate channelId');
        ids.add(channel.channelId);
        if (channel.state === 'ready') {
            assert(differenceMs(response.serverTimeUtc, channel.now.startUtc) >= 0
                && differenceMs(channel.now.endUtc, response.serverTimeUtc) > 0,
            label + ': Now does not contain server time');
            if (channel.next) {
                assert(differenceMs(channel.next.startUtc, channel.now.endUtc) >= 0,
                    label + ': Next starts before Now ends');
            }
        }
    }
};
const assertGuide = fixture => {
    const { response, id: label } = fixture;
    assertNoItemId(response, label);
    const { fromUtc, toUtc } = response;
    assert(fixture.pathParams.channelId === response.channelId, label + ': wrong guide channel');
    assert(fixture.query?.fromUtc === fromUtc && fixture.query?.toUtc === toUtc,
        label + ': guide window differs from request');
    const span = differenceMs(toUtc, fromUtc);
    assert(span > 0 && span <= operations.get('guide').maxWindowHours * 60 * 60 * 1000,
        label + ': guide window exceeds 24 hours');
    assertEntries(response.entries, fromUtc, toUtc, label);
};
const assertResolve = fixture => {
    const { response, id: label } = fixture;
    assert(fixture.pathParams.channelId === response.channelId, label + ': wrong resolve channel');
    assert(differenceMs(response.serverTimeUtc, response.startUtc) === response.positionMs,
        label + ': positionMs differs from committed timestamps');
    assert(differenceMs(response.endUtc, response.serverTimeUtc) === response.remainingMs
        && response.remainingMs > 10000, label + ': remainingMs differs or should roll over');
    if (fixture.request.expectedProgramId) {
        assert(fixture.request.expectedProgramId === response.programId
            && fixture.request.expectedEntryRevision === response.entryRevision,
        label + ': successful resolve changed the expected entry');
    }
};
const assertAdminResource = fixture => {
    const { response, id: label } = fixture;
    const type = resourceTypeFor(fixture.pathParams.resource);
    assert(type && response.resourceType === type, label + ': admin resource type/path mismatch');
    if (fixture.operation === 'admin-list') {
        for (const resource of response.resources) assertAdminRepresentation(type, resource, label);
        return;
    }
    assertAdminRepresentation(type, response.resource, label);
    const idField = { definition: 'channelId', collection: 'collectionId', block: 'blockId' }[type];
    if (fixture.operation === 'admin-read' || fixture.operation === 'admin-update') {
        assert(fixture.pathParams.id === response.resource[idField],
            label + ': admin resource ID differs from requested path');
    }
    if (fixture.request) {
        assert(fixture.request.resourceType === type, label + ': admin request type/path mismatch');
        assertAdminFields(fixture.request, label);
        if (type === 'block') {
            assert(response.resource.repeatWindowMs === (fixture.request.resource.repeatWindowMs ?? 86400000),
                label + ': block readback does not contain the effective repeat window');
        }
    }
};
const assertPreview = fixture => {
    const { request, response, id: label } = fixture;
    const span = differenceMs(request.toUtc, request.fromUtc);
    assert(span > 0 && span <= 48 * 60 * 60 * 1000, label + ': preview window exceeds 48 hours');
    assert(request.channelId === response.channelId && request.fromUtc === response.fromUtc
        && request.toUtc === response.toUtc, label + ': preview scope differs from request');
    assert(!request.candidate || request.candidate.resourceType === 'definition'
        || Boolean(request.candidateResourceId), label + ': preview replacement lacks candidateResourceId');
    assert(!request.candidateResourceId || Boolean(request.candidate), label + ': orphan candidateResourceId');
    if (request.candidate) assertAdminFields(request.candidate, label);
    assertEntries(response.entries, response.fromUtc, response.toUtc, label);
};
const successChecks = new Map([
    ['list', assertList],
    ['guide', assertGuide],
    ['resolve', assertResolve],
    ['admin-list', assertAdminResource],
    ['admin-create', assertAdminResource],
    ['admin-read', assertAdminResource],
    ['admin-update', assertAdminResource],
    ['admin-preview', assertPreview]
]);
const validateFixture = fixture => {
    const operation = operations.get(fixture.operation);
    assert(operation, fixture.id + ': unknown operation');
    assertPathAndHeaders(fixture, operation);
    if (fixture.status === operation.successStatus && !fixture.response?.error) {
        assertSuccess(fixture, operation);
        successChecks.get(fixture.operation)?.(fixture);
    } else {
        assertError(fixture, operation);
    }
};
for (const fixture of fixtures) validateFixture(fixture);
for (const type of ['definition', 'collection', 'block']) {
    const update = byId.get('update-' + type);
    const readback = byId.get('read-' + type + '-after-update');
    assert(update && readback && update.headers.ETag === readback.headers.ETag
        && JSON.stringify(canonicalJson(update.response.resource))
            === JSON.stringify(canonicalJson(readback.response.resource)),
    type + ': authoritative GET after PUT differs from its committed response');
}
const compatibilityFixtures = readJson('fixtures/compatibility.json');
assert(compatibilityFixtures.length === 1, 'Expected one older-Plugin compatibility fixture.');
const olderPlugin = compatibilityFixtures[0];
assert(olderPlugin.id === 'older-plugin-without-capabilities-route'
    && olderPlugin.operation === 'capabilities'
    && olderPlugin.principal === 'user'
    && olderPlugin.transportStatus === 404
    && olderPlugin.bodyContract === 'host-defined'
    && olderPlugin.expectedClientState === 'unsupported'
    && !Object.hasOwn(olderPlugin, 'response'),
'An absent capability route must be a transport-level unsupported Plugin state.');
for (const operation of expectedOperations) {
    assert(fixtures.some(fixture => fixture.operation === operation
        && fixture.status === operations.get(operation).successStatus),
    'Missing success fixture for ' + operation);
}
for (const code of Object.keys(manifest.errorStatus)) {
    assert(fixtures.some(fixture => fixture.response?.error?.code === code),
        'Missing error fixture for ' + code);
}
const visibleProjection = byId.get('guide-user-projection');
const redactedProjection = byId.get('guide-restricted-projection');
assert(visibleProjection.response.timelineRevision === redactedProjection.response.timelineRevision
    && visibleProjection.response.entries[0].programId === redactedProjection.response.entries[0].programId
    && visibleProjection.response.entries[0].availability === 'playable'
    && redactedProjection.response.entries[0].availability === 'unavailable',
'User-scope fixtures must project one shared program without leaking restricted metadata.');

const applyChange = (document, change) => {
    const segments = change.path.split('/').slice(1).map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
    assert(change.path.startsWith('/') && segments.length > 0, 'Invalid fixture pointer ' + change.path);
    const parent = segments.slice(0, -1).reduce((value, segment) => {
        assert(value && Object.hasOwn(value, segment), 'Missing fixture pointer segment ' + segment);
        return value[segment];
    }, document);
    const key = segments.at(-1);
    if (change.op === 'add') {
        assert(!Object.hasOwn(parent, key), 'Fixture add already exists: ' + change.path);
        parent[key] = change.value;
    } else if (change.op === 'replace') {
        assert(Object.hasOwn(parent, key), 'Fixture replace missing: ' + change.path);
        parent[key] = change.value;
    } else if (change.op === 'remove') {
        assert(Object.hasOwn(parent, key), 'Fixture remove missing: ' + change.path);
        delete parent[key];
    } else {
        throw new Error('Unknown fixture mutation ' + change.op);
    }
};
const invalidFixtures = readJson('fixtures/invalid.json');
const cloneJson = value => JSON.parse(JSON.stringify(value));
for (const invalid of invalidFixtures) {
    const base = byId.get(invalid.base);
    assert(base, 'Unknown negative fixture base ' + invalid.base);
    const mutated = cloneJson(base);
    mutated.id = invalid.id;
    for (const change of invalid.changes) applyChange(mutated, change);
    let rejected = false;
    try {
        validateFixture(mutated);
    } catch {
        rejected = true;
    }
    assert(rejected, 'Invalid fixture ' + invalid.id + ' was accepted.');
}
const additiveResponse = cloneJson(byId.get('list-ready-and-recovering'));
additiveResponse.id = 'additive-response-field';
additiveResponse.response.futureField = 'accepted';
additiveResponse.response.channels[0].now.futureField = 'accepted';
validateFixture(additiveResponse);

console.log('Validated ' + schemaFiles.length + ' PTV Channels v1 schemas, '
    + manifest.operations.length + ' operations, ' + fixtures.length + ' positive and '
    + invalidFixtures.length + ' negative fixtures, and ' + compatibilityFixtures.length
    + ' transport compatibility fixture.');
