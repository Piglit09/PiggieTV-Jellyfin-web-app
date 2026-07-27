import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const frontendConfig = read('src/ptv/core/config.ts');
const apiRoutes = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvApiRoutes.cs');
const cacheValidator = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Services/PtvFeaturedContentValidator.cs');
const statusController = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvStatusController.cs');
const statusResponse = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Models/PtvStatusResponse.cs');
const project = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj');
const pluginManifest = JSON.parse(read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/meta.json'));
const packageJson = JSON.parse(read('package.json'));
const expectedPluginVersion = ['10', '11', '8', '2'].join('.');

function requiredMatch(source, pattern, label) {
    const match = source.match(pattern);
    if (!match) throw new Error(`Could not read ${label}.`);
    return match[1];
}

const contract = {
    frontendApiVersion: Number(requiredMatch(frontendConfig, /PTV_PLUGIN_API\s*=\s*\{[\s\S]*?version:\s*(\d+)/, 'frontend API version')),
    frontendCacheVersion: Number(requiredMatch(frontendConfig, /featuredContentVersion:\s*(\d+)/, 'frontend cache version')),
    pluginApiVersion: Number(requiredMatch(apiRoutes, /CurrentVersion\s*=\s*(\d+)/, 'plugin API version')),
    pluginCacheVersion: Number(requiredMatch(cacheValidator, /FeaturedCacheVersion\s*=\s*(\d+)/, 'plugin cache version')),
    pluginTarget: requiredMatch(project, /<PtvJellyfinPackageVersion>([^<]+)</, 'plugin Jellyfin target'),
    pluginVersion: requiredMatch(project, /<PtvPluginVersion>([^<]+)</, 'plugin version'),
    pluginManifestVersion: pluginManifest.version,
    webVersion: packageJson.version
};

const requiredRoutes = [
    ['status', "status: 'Ptv/v1/status'"],
    ['featured', "featuredContent: 'Ptv/v1/featured'"],
    ['featured refresh', "featuredContentRefresh: 'Ptv/v1/featured/refresh'"],
    ['Google Books metadata', "googleBooksMetadataSearch: 'Ptv/v1/reading/metadata/googlebooks/search'"],
    ['reading series overrides', "readingSeriesOverrides: 'Ptv/v1/reading/series-overrides'"]
];

const failures = [];
if (contract.frontendApiVersion !== contract.pluginApiVersion) {
    failures.push(`API mismatch: frontend v${contract.frontendApiVersion}, plugin v${contract.pluginApiVersion}`);
}
if (contract.frontendCacheVersion !== contract.pluginCacheVersion) {
    failures.push(`Cache mismatch: frontend v${contract.frontendCacheVersion}, plugin v${contract.pluginCacheVersion}`);
}
if (contract.pluginVersion !== expectedPluginVersion) {
    failures.push(`Plugin release mismatch: expected ${expectedPluginVersion}, project reports ${contract.pluginVersion}`);
}
if (contract.pluginManifestVersion !== contract.pluginVersion) {
    failures.push(`Plugin manifest mismatch: project ${contract.pluginVersion}, manifest ${contract.pluginManifestVersion}`);
}
if (contract.pluginTarget !== '10.11.8') {
    failures.push(`Unexpected Jellyfin package target: expected 10.11.8, received ${contract.pluginTarget}`);
}

for (const [label, sourceText] of requiredRoutes) {
    if (!frontendConfig.includes(sourceText)) failures.push(`Missing frontend ${label} contract: ${sourceText}`);
}

const backendContracts = [
    ['reading override GET route', /\[HttpGet\("reading\/series-overrides\/\{routeKind\}"\)\]/],
    ['reading override PUT route', /\[HttpPut\("reading\/series-overrides\/\{routeKind\}"\)\]/],
    ['reading override status feature', /"readingSeriesOverrides"/],
    ['PTV Core contract version', /\[JsonPropertyName\("contractVersion"\)\][\s\S]*?=\s*"1\.0"/],
    ['PTV Core cache version', /\[JsonPropertyName\("cacheVersion"\)\]/],
    ['recommendation schema version', /\[JsonPropertyName\("recommendationSchemaVersion"\)\]/],
    ['diagnostics capability', /\[JsonPropertyName\("diagnosticsCapable"\)\]/],
    ['server capabilities', /\[JsonPropertyName\("serverCapabilities"\)\]/],
    ['supported feature flags', /\[JsonPropertyName\("supportedFeatureFlags"\)\]/],
    ['client compatibility warnings', /\[JsonPropertyName\("clientCompatibilityWarnings"\)\]/]
];

for (const [label, pattern] of backendContracts) {
    const source = label.includes('route') && !label.includes('status') ? statusController : statusResponse;
    if (!pattern.test(source)) failures.push(`Missing plugin ${label}.`);
}

if (failures.length) {
    console.error('PiggieTV frontend/plugin contract check failed:');
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exit(1);
}

console.log(JSON.stringify(contract, null, 2));
console.log('PiggieTV frontend/plugin API, cache schema, and required routes are compatible.');
