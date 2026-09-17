import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const frontendConfig = read('src/ptv/core/config.ts');
const apiRoutes = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvApiRoutes.cs');
const cacheValidator = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Services/PtvFeaturedContentValidator.cs');
const statusController = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvStatusController.cs');
const relationshipController = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvRelationshipController.cs');
const recommendationController = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvRecommendationController.cs');
const readingMetadataController = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvReadingMetadataController.cs');
const statusResponse = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Models/PtvStatusResponse.cs');
const project = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj');
const pluginManifest = JSON.parse(read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/meta.json'));
const packageJson = JSON.parse(read('package.json'));
const expectedPluginVersion = '0.5.18.0';

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
    ['Reading metadata providers', "readingMetadataProviders: 'Ptv/v1/reading/metadata/providers'"],
    ['Reading metadata search', "readingMetadataSearch: 'Ptv/v1/reading/metadata/search'"],
    ['reading series overrides', "readingSeriesOverrides: 'Ptv/v1/reading/series-overrides'"],
    ['authoritative relationships', "relationships: 'Ptv/v1/relationships'"],
    ['recommendation policy v2', "recommendationPolicyRank: 'Ptv/v2/recommendations/rank'"],
    ['Calendar data', "arrCalendar: 'Ptv/v1/calendar'"],
    ['Calendar availability', "arrCalendarAvailability: 'Ptv/v1/integrations/calendar-availability'"]
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
if (contract.pluginTarget !== '10.11.11') {
    failures.push(`Unexpected Jellyfin package target: expected 10.11.11, received ${contract.pluginTarget}`);
}

for (const [label, sourceText] of requiredRoutes) {
    if (!frontendConfig.includes(sourceText)) failures.push(`Missing frontend ${label} contract: ${sourceText}`);
}

const backendContracts = [
    ['Reading metadata controller', readingMetadataController, /\[Route\("Ptv\/v1\/reading\/metadata"\)\]/],
    ['Reading metadata providers route', readingMetadataController, /\[HttpGet\("providers"\)\]/],
    ['Reading metadata search route', readingMetadataController, /\[HttpPost\("search"\)\]/],
    ['Reading metadata administrator authorization', readingMetadataController, /Policies\.RequiresElevation/],
    ['reading override GET route', statusController, /\[HttpGet\("reading\/series-overrides\/\{routeKind\}"\)\]/],
    ['reading override PUT route', statusController, /\[HttpPut\("reading\/series-overrides\/\{routeKind\}"\)\]/],
    ['Calendar route', statusController, /\[HttpGet\("calendar"\)\]/],
    ['Calendar compatibility route', statusController, /\[HttpGet\("integrations\/arr\/calendar"\)\]/],
    ['secret-free Calendar availability route', statusController, /\[HttpGet\("integrations\/calendar-availability"\)\]/],
    ['administrator-only detailed integration status', statusController, /GetIntegrationsStatus\(\)[\s\S]*?CanWriteFeaturedContentSafeAsync\("integrations\/status"\)/],
    ['relationship GET route', relationshipController, /\[HttpGet\("\{sourceItemId\}"\)\]/],
    ['relationship POST route', relationshipController, /\[HttpPost\]/],
    ['relationship PUT route', relationshipController, /\[HttpPut\("\{mappingId\}"\)\]/],
    ['relationship DELETE route', relationshipController, /\[HttpDelete\("\{mappingId\}"\)\]/],
    ['recommendation policy v2 controller', recommendationController, /\[Route\("Ptv\/v2\/recommendations"\)\]/],
    ['recommendation policy v2 rank route', recommendationController, /\[HttpPost\("rank"\)\]/],
    ['recommendation v1 compatibility route', recommendationController, /\[HttpGet\("~\/Ptv\/v1\/recommendations"\)\]/],
    ['recommendation policy status feature', statusController, /"recommendationPolicyV2"/],
    ['reading override status feature', statusResponse, /"readingSeriesOverrides"/],
    ['relationship status feature', statusResponse, /"detailsRelationships"/],
    ['PTV Core contract version', statusResponse, /\[JsonPropertyName\("contractVersion"\)\][\s\S]*?=\s*"1\.0"/],
    ['PTV Core cache version', statusResponse, /\[JsonPropertyName\("cacheVersion"\)\]/],
    ['recommendation schema version', statusResponse, /\[JsonPropertyName\("recommendationSchemaVersion"\)\]/],
    ['diagnostics capability', statusResponse, /\[JsonPropertyName\("diagnosticsCapable"\)\]/],
    ['server capabilities', statusResponse, /\[JsonPropertyName\("serverCapabilities"\)\]/],
    ['supported feature flags', statusResponse, /\[JsonPropertyName\("supportedFeatureFlags"\)\]/],
    ['client compatibility warnings', statusResponse, /\[JsonPropertyName\("clientCompatibilityWarnings"\)\]/]
];

for (const [label, source, pattern] of backendContracts) {
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
