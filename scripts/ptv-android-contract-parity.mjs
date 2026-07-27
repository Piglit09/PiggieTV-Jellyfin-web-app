import fs from 'node:fs';
import path from 'node:path';

/* eslint-disable sonarjs/cognitive-complexity, sonarjs/slow-regex -- This parser reads bounded, repository-owned Kotlin contract source. */

const webRoot = process.cwd();
const repositories = {
    mobile: process.env.PTV_ANDROID_MOBILE_REPO
        || path.resolve(webRoot, '..', 'PiggieTV-Jellyfin-Android'),
    tv: process.env.PTV_ANDROID_TV_REPO
        || path.resolve(webRoot, '..', 'PiggieTV-AndoidTV')
};
const contractRelativePath = path.join(
    'app',
    'src',
    'main',
    'java',
    'com',
    'piggietv',
    'core',
    'PtvCoreContracts.kt'
);
const canonicalPath = path.join(webRoot, 'contracts', 'ptv-core', 'v1', 'android-contract-manifest.json');

function findMatching(source, start, open, close) {
    let depth = 0;
    let quoted = false;

    for (let index = start; index < source.length; index += 1) {
        const character = source[index];
        if (character === '"' && source[index - 1] !== '\\') quoted = !quoted;
        if (quoted) continue;
        if (character === open) depth += 1;
        if (character === close) depth -= 1;
        if (depth === 0) return index;
    }

    throw new Error(`Unbalanced ${open}${close} block at ${start}.`);
}

function splitTopLevel(value) {
    const parts = [];
    let start = 0;
    let round = 0;
    let angle = 0;
    let square = 0;
    let quoted = false;

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (character === '"' && value[index - 1] !== '\\') quoted = !quoted;
        if (quoted) continue;
        if (character === '(') round += 1;
        if (character === ')') round -= 1;
        if (character === '<') angle += 1;
        if (character === '>') angle -= 1;
        if (character === '[') square += 1;
        if (character === ']') square -= 1;
        if (character === ',' && round === 0 && angle === 0 && square === 0) {
            parts.push(value.slice(start, index));
            start = index + 1;
        }
    }
    parts.push(value.slice(start));

    return parts.map(part => part.trim()).filter(Boolean);
}

function normalizeType(type) {
    return type
        .replace(/\s+/g, ' ')
        .replace(/\s*([<>,?])\s*/g, '$1')
        .trim();
}

function parseModels(source) {
    const models = {};
    const pattern = /data\s+class\s+(\w+)(?:\s*<[^>{}]+>)?\s*\(/g;
    let match;

    while ((match = pattern.exec(source))) {
        const open = source.indexOf('(', match.index);
        const close = findMatching(source, open, '(', ')');
        const fields = splitTopLevel(source.slice(open + 1, close))
            .map(part => {
                const field = /\bval\s+(\w+)\s*:\s*([\s\S]+)/.exec(part);
                if (!field) return null;
                const rawType = field[2].split(/\s*=\s*/)[0];
                const type = normalizeType(rawType);

                return {
                    name: field[1],
                    nullable: type.endsWith('?'),
                    serializedName: field[1],
                    type
                };
            })
            .filter(Boolean)
            .sort((left, right) => left.name.localeCompare(right.name));
        models[match[1]] = fields;
        pattern.lastIndex = close + 1;
    }

    return Object.fromEntries(Object.entries(models).sort(([left], [right]) => left.localeCompare(right)));
}

function parseEnums(source) {
    const enums = {};
    const pattern = /enum\s+class\s+(\w+)(?:\s*\([^)]*\))?\s*\{/g;
    let match;

    while ((match = pattern.exec(source))) {
        const open = source.indexOf('{', match.index);
        const close = findMatching(source, open, '{', '}');
        const declarationBlock = source.slice(open + 1, close).split(/\n\s*(?:;|companion\s+object|fun\s+)/)[0];
        const values = splitTopLevel(declarationBlock)
            .map(part => {
                const entry = /^([A-Z][A-Z0-9_]*)(?:\s*\(\s*"([^"]+)"\s*\))?/.exec(part.trim());
                if (!entry) return null;

                return {
                    name: entry[1],
                    serializedName: entry[2] || entry[1],
                    value: entry[2] || entry[1]
                };
            })
            .filter(Boolean)
            .sort((left, right) => left.name.localeCompare(right.name));
        enums[match[1]] = values;
        pattern.lastIndex = close + 1;
    }

    return Object.fromEntries(Object.entries(enums).sort(([left], [right]) => left.localeCompare(right)));
}

export function createAndroidContractManifest(source) {
    const version = /const\s+val\s+VERSION\s*=\s*"([^"]+)"/.exec(source)?.[1];
    if (!version) throw new Error('PtvCoreContract.VERSION was not found.');
    const enums = parseEnums(source);
    const errorCodes = [...source.matchAll(/"([A-Z][A-Z0-9_]{2,})"/g)]
        .map(match => match[1])
        .filter(value => value.includes('_'))
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort();

    return {
        capabilityIdentifiers: (enums.PtvClientCapability || []).map(value => value.value).sort(),
        contractVersion: version,
        enums,
        errorCodes,
        models: parseModels(source)
    };
}

function firstDifference(left, right, location = '$') {
    if (Object.is(left, right)) return null;
    if (typeof left !== typeof right || left === null || right === null) {
        return `${location}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right)) return `${location}: collection kind differs`;
        if (left.length !== right.length) return `${location}: length ${left.length} !== ${right.length}`;
        for (let index = 0; index < left.length; index += 1) {
            const difference = firstDifference(left[index], right[index], `${location}[${index}]`);
            if (difference) return difference;
        }
        return null;
    }
    if (typeof left === 'object') {
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();
        const keyDifference = firstDifference(leftKeys, rightKeys, `${location} keys`);
        if (keyDifference) return keyDifference;
        for (const key of leftKeys) {
            const difference = firstDifference(left[key], right[key], `${location}.${key}`);
            if (difference) return difference;
        }
        return null;
    }

    return `${location}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`;
}

function assertEqual(left, right, label) {
    const difference = firstDifference(left, right);
    if (difference) throw new Error(`${label}: ${difference}`);
}

function writeGeneratedManifest(repository, manifest) {
    const output = path.join(repository, 'app', 'build', 'reports', 'ptv-core', 'contract-manifest.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
}

function schemaJsonType(kotlinType) {
    const type = kotlinType.replace(/\?$/, '');
    if (/^(Int|Long)$/.test(type)) return 'integer';
    if (type === 'Double') return 'number';
    if (type === 'Boolean') return 'boolean';
    if (type === 'String' || /^Ptv.*(?:Kind|Status|Mode|Destination|Behavior|Classification|Type)$/.test(type)) {
        return 'string';
    }
    if (/^(List|Set)</.test(type)) return 'array';
    if (/^Map</.test(type)) return 'object';
    return 'object';
}

function validateRequiredSchemaFields(manifest) {
    const mappings = {
        'cache-envelope.schema.json': 'PtvCacheEnvelope',
        'client-capability-report.schema.json': 'PtvClientCapabilityReport',
        'core-error.schema.json': 'PtvCoreError',
        'diagnostic-event.schema.json': 'PtvDiagnosticEvent',
        'feature-flags.schema.json': 'PtvFeatureFlagDocument',
        'navigation-intent.schema.json': 'PtvNavigationIntent',
        'playback-state.schema.json': 'PtvPlaybackState',
        'recommendation-item.schema.json': 'PtvRecommendationItem',
        'recommendation-response.schema.json': 'PtvRecommendationResponse',
        'recommendation-row.schema.json': 'PtvRecommendationRow'
    };

    for (const [file, modelName] of Object.entries(mappings)) {
        const schema = JSON.parse(fs.readFileSync(path.join(webRoot, 'contracts', 'ptv-core', 'v1', file), 'utf8'));
        const fields = new Map((manifest.models[modelName] || []).map(field => [field.serializedName, field]));
        for (const required of schema.required || []) {
            const field = fields.get(required);
            if (!field) throw new Error(`${modelName} is missing required schema field ${required}.`);
            if (field.nullable) throw new Error(`${modelName}.${required} is nullable but required by ${file}.`);
            const expectedType = schema.properties?.[required]?.type;
            if (typeof expectedType === 'string' && schemaJsonType(field.type) !== expectedType) {
                throw new Error(
                    `${modelName}.${required} type ${field.type} does not match ${file} type ${expectedType}.`
                );
            }
        }
        const versionField = schema.properties?.contractVersion;
        if (versionField?.const && versionField.const !== manifest.contractVersion) {
            throw new Error(`${file} contractVersion ${versionField.const} differs from Android ${manifest.contractVersion}.`);
        }
    }
}

const manifests = Object.fromEntries(Object.entries(repositories).map(([name, repository]) => {
    const sourcePath = path.join(repository, contractRelativePath);
    if (!fs.existsSync(sourcePath)) throw new Error(`${name} contract source is missing: ${sourcePath}`);
    const manifest = createAndroidContractManifest(fs.readFileSync(sourcePath, 'utf8'));
    writeGeneratedManifest(repository, manifest);
    return [name, manifest];
}));

if (process.argv.includes('--write')) {
    fs.writeFileSync(canonicalPath, `${JSON.stringify(manifests.mobile, null, 2)}\n`);
    console.log(`Wrote canonical Android contract manifest: ${canonicalPath}`);
}

if (!fs.existsSync(canonicalPath)) {
    throw new Error(`Canonical Android contract manifest is missing: ${canonicalPath}`);
}
const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));

assertEqual(manifests.mobile, manifests.tv, 'Android mobile/TV contract parity failed');
assertEqual(manifests.mobile, canonical, 'Android contract differs from contracts/ptv-core/v1');
validateRequiredSchemaFields(manifests.mobile);

console.log(
    `Validated Android contract parity: ${Object.keys(manifests.mobile.models).length} models, `
    + `${Object.keys(manifests.mobile.enums).length} enums, `
    + `${manifests.mobile.capabilityIdentifiers.length} capabilities, `
    + `${manifests.mobile.errorCodes.length} error codes.`
);

/* eslint-enable sonarjs/cognitive-complexity, sonarjs/slow-regex */
