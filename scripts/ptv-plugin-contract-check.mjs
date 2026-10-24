import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const frontendConfig = read('src/ptv/core/config.ts');
const frontendTransport = read('src/ptv/core/pluginApi.ts');
const apiRoutes = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvApiRoutes.cs');
const homeTransitionsController = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvHomeTransitionsController.cs');
const homeUserAccessController = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvHomeUserAccessController.cs');
const cacheValidator = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Services/PtvFeaturedContentValidator.cs');
const statusController = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvStatusController.cs');
const relationshipController = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvRelationshipController.cs');
const recommendationController = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvRecommendationController.cs');
const readingMetadataController = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvReadingMetadataController.cs');
const statusResponse = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Models/PtvStatusResponse.cs');
const project = read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj');
const pluginManifest = JSON.parse(read('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/meta.json'));
const packageJson = JSON.parse(read('package.json'));
const expectedPluginVersion = '0.5.25.0';

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
    ['controlled Home topology route', "homeTransitions: 'Ptv/v1/home-transitions'"],
    ['controlled Home user-access route', "homeUserAccess: 'Ptv/v1/home-user-access'"],
    ['Google Books metadata', "googleBooksMetadataSearch: 'Ptv/v1/reading/metadata/googlebooks/search'"],
    ['Reading metadata providers', "readingMetadataProviders: 'Ptv/v1/reading/metadata/providers'"],
    ['Reading metadata search', "readingMetadataSearch: 'Ptv/v1/reading/metadata/search'"],
    ['Reading identity reassess route', "readingMetadataReassess: 'Ptv/v1/reading/metadata/reassess'"],
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
if (contract.pluginTarget !== '12.2.0') {
    failures.push(`Unexpected Jellyfin package target: expected 12.2.0, received ${contract.pluginTarget}`);
}

for (const [label, sourceText] of requiredRoutes) {
    if (!frontendConfig.includes(sourceText)) failures.push(`Missing frontend ${label} contract: ${sourceText}`);
}

const backendContracts = [
    ['controlled Home topology route', apiRoutes, /public const string HomeTransitions\s*=\s*"Ptv\/v1\/home-transitions"/],
    ['controlled Home user-access route', apiRoutes, /public const string HomeUserAccess\s*=\s*"Ptv\/v1\/home-user-access"/],
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

function frontendAction(name) {
    const start = frontendTransport.indexOf(`${name}(`);
    if (start < 0) return '';
    const end = frontendTransport.indexOf('\n        },', start);
    return end < 0 ? '' : frontendTransport.slice(start, end);
}

const homeFrontendActions = [
    ['topology Begin POST', 'beginHomeTransition', '${PTV_PLUGIN_API.endpoints.homeTransitions}/begin'],
    ['topology Complete POST', 'completeHomeTransition', '${PTV_PLUGIN_API.endpoints.homeTransitions}/${encodeURIComponent(operationId)}/complete'],
    ['user-access Begin POST', 'beginHomeUserAccess', '${PTV_PLUGIN_API.endpoints.homeUserAccess}/begin'],
    ['user-access Complete POST', 'completeHomeUserAccess', '${PTV_PLUGIN_API.endpoints.homeUserAccess}/${encodeURIComponent(operationId)}/complete']
];

for (const [label, name, routePath] of homeFrontendActions) {
    const action = frontendAction(name);
    if (!action.includes(routePath) || !/\bmethod:\s*'POST'/.test(action)) {
        failures.push(`Missing frontend controlled Home ${label}.`);
    }
}

const readingActionStart = frontendTransport.indexOf('reassessReadingMetadata<');
const readingActionEnd = frontendTransport.indexOf('\n        },', readingActionStart);
const readingAction = readingActionStart < 0 || readingActionEnd < 0 ?
    '' :
    frontendTransport.slice(readingActionStart, readingActionEnd);
if (!readingAction.includes('PTV_PLUGIN_API.endpoints.readingMetadataReassess')
    || !/\bmethod:\s*'POST'/.test(readingAction)) {
    failures.push('Missing frontend Reading identity reassess POST.');
}
if (!/\bbypassCache:\s*true/.test(readingAction)) {
    failures.push('Missing frontend Reading identity reassess bypassCache.');
}

function pluginActionPreamble(source, route, name) {
    const attribute = `[HttpPost("${route}")]`;
    const routeIndex = source.indexOf(attribute);
    if (routeIndex < 0) return '';
    const declaration = `public async Task<IActionResult> ${name}(`;
    const methodIndex = source.indexOf(declaration, routeIndex + attribute.length);
    if (methodIndex < 0 || methodIndex - routeIndex > 100) return '';
    const bodyIndex = source.indexOf('{', methodIndex + declaration.length);
    if (bodyIndex < 0 || bodyIndex - methodIndex > 500) return '';
    return source.slice(bodyIndex, bodyIndex + 350);
}

const homePluginControllers = [
    ['topology', homeTransitionsController, 'HomeTransitions', 'PtvHomeTransitionsController'],
    ['user-access', homeUserAccessController, 'HomeUserAccess', 'PtvHomeUserAccessController']
];
const administratorGuard = /if\s*\(!await IsAdministrator\(\)\.ConfigureAwait\(false\)\)\s*return Forbid\(\);/;

for (const [label, source, routeConstant, controller] of homePluginControllers) {
    const controllerBoundary = new RegExp(`\\[Authorize\\]\\s*\\[Route\\(PtvApiRoutes\\.${routeConstant}\\)\\]\\s*public sealed class ${controller}\\(`);
    if (!controllerBoundary.test(source)
        || !/private async Task<bool> IsAdministrator\(\)[\s\S]{0,180}Policies\.RequiresElevation/.test(source)) {
        failures.push(`Missing plugin controlled Home ${label} administrator boundary.`);
    }
    for (const [name, route] of [['Begin', 'begin'], ['Complete', '{operationId:guid}/complete']]) {
        const preamble = pluginActionPreamble(source, route, name);
        if (!preamble) {
            failures.push(`Missing plugin controlled Home ${label} ${name} POST.`);
        } else if (!administratorGuard.test(preamble)) {
            failures.push(`Missing plugin controlled Home ${label} ${name} administrator guard.`);
        }
    }
}

const readingControllerBoundary = /\[Authorize\]\s*\[Route\("Ptv\/v1\/reading\/metadata"\)\]\s*public sealed class PtvReadingMetadataController/;
const readingAdminPolicy = /private async Task<bool> IsAdministratorAsync\(\)[\s\S]{0,400}Policies\.RequiresElevation/;
if (!readingControllerBoundary.test(readingMetadataController)
    || !readingAdminPolicy.test(readingMetadataController)) {
    failures.push('Missing plugin Reading identity reassess administrator boundary.');
}

const readingReassessRoute = readingMetadataController.indexOf('[HttpPost("reassess")]');
const readingReassessMethod = readingReassessRoute < 0 ? -1 : readingMetadataController.indexOf(
    'public async Task<ActionResult<PtvReadingIdentityAssessment>> Reassess(',
    readingReassessRoute
);
const readingReassessBody = readingReassessMethod < 0 ? -1 : readingMetadataController.indexOf('{', readingReassessMethod);
const readingReassessEnd = readingReassessBody < 0 ? -1 : readingMetadataController.indexOf(
    'private bool TryGetAuthenticatedUserId(',
    readingReassessBody
);
const readingReassessAction = readingReassessRoute < 0
    || readingReassessMethod - readingReassessRoute > 800
    || readingReassessBody < 0
    || readingReassessEnd < 0 ?
    '' :
    readingMetadataController.slice(readingReassessBody, readingReassessEnd);
if (!readingReassessAction) {
    failures.push('Missing plugin Reading identity reassess POST.');
} else {
    if (!/if\s*\(!await IsAdministratorAsync\(\)\.ConfigureAwait\(false\)\) return Forbid\(\);/.test(readingReassessAction)) {
        failures.push('Missing plugin Reading identity reassess administrator guard.');
    }
    if (!/if\s*\(!TryGetAuthenticatedUserId\(out var administratorId\)\) return Unauthorized\(\);/.test(readingReassessAction)) {
        failures.push('Missing plugin Reading identity reassess authenticated user binding.');
    }
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
