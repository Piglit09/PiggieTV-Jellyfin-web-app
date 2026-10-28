import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const checker = join(root, 'scripts/ptv-plugin-contract-check.mjs');
const fixturePaths = [
    'package.json',
    'src/ptv/core/config.ts',
    'src/ptv/core/pluginApi.ts',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvApiRoutes.cs',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvHomeTransitionsController.cs',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvHomeUserAccessController.cs',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvReadingMetadataController.cs',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvRecommendationController.cs',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvRelationshipController.cs',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvStatusController.cs',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/meta.json',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Models/PtvStatusResponse.cs',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Services/PtvFeaturedContentValidator.cs'
];

function withFixture(action) {
    const fixture = mkdtempSync(join(tmpdir(), 'ptv-home-contract-'));
    try {
        for (const relativePath of fixturePaths) {
            const destination = join(fixture, relativePath);
            mkdirSync(dirname(destination), { recursive: true });
            copyFileSync(join(root, relativePath), destination);
        }
        action(fixture);
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
}

function runChecker(fixture) {
    return spawnSync(process.execPath, [checker], {
        cwd: fixture,
        encoding: 'utf8'
    });
}

function replaceOnce(fixture, relativePath, before, after) {
    const file = join(fixture, relativePath);
    const original = readFileSync(file, 'utf8');
    assert.ok(original.includes(before), `Fixture is missing ${before} in ${relativePath}`);
    const updated = original.replace(before, after);
    assert.ok(!updated.includes(before), `Fixture replacement was not unique in ${relativePath}`);
    writeFileSync(file, updated);
}

function removeActionGuard(fixture, relativePath, action) {
    const file = join(fixture, relativePath);
    const original = readFileSync(file, 'utf8');
    const actionStart = original.indexOf(`public async Task<IActionResult> ${action}(`);
    assert.notEqual(actionStart, -1);
    const guard = 'if (!await IsAdministrator().ConfigureAwait(false)) return Forbid();';
    const guardStart = original.indexOf(guard, actionStart);
    assert.ok(guardStart > actionStart && guardStart - actionStart < 400);
    writeFileSync(file, original.slice(0, guardStart) + original.slice(guardStart + guard.length));
}

test('accepts the intact controlled Home and Reading identity Web and Plugin contracts', () => {
    withFixture(fixture => {
        const result = runChecker(fixture);
        assert.equal(result.status, 0, result.stderr);
    });
});

const config = 'src/ptv/core/config.ts';
const transport = 'src/ptv/core/pluginApi.ts';
const routes = 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvApiRoutes.cs';
const topologyController = 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvHomeTransitionsController.cs';
const accessController = 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvHomeUserAccessController.cs';
const readingController = 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvReadingMetadataController.cs';

function changeReadingAction(fixture, before, after) {
    const file = join(fixture, readingController);
    const original = readFileSync(file, 'utf8');
    const start = original.indexOf('public async Task<ActionResult<PtvReadingIdentityAssessment>> Reassess(');
    assert.notEqual(start, -1, 'Reading reassess action is missing from the fixture');
    const end = original.indexOf('private bool TryGetAuthenticatedUserId(', start);
    assert.ok(end > start, 'Reading reassess action boundary is missing from the fixture');
    const action = original.slice(start, end);
    assert.ok(action.includes(before), `Reading reassess action is missing ${before}`);
    writeFileSync(file, original.slice(0, start) + action.replace(before, after) + original.slice(end));
}

const brokenContracts = [
    {
        name: 'rejects a missing Web controlled topology route',
        change: fixture => replaceOnce(fixture, config,
            "homeTransitions: 'Ptv/v1/home-transitions'", "homeTransitions: 'Ptv/v1/retired-transitions'"),
        error: /Missing frontend controlled Home topology route/
    },
    {
        name: 'rejects a missing Web user-access route',
        change: fixture => replaceOnce(fixture, config,
            "homeUserAccess: 'Ptv/v1/home-user-access'", "homeUserAccess: 'Ptv/v1/retired-user-access'"),
        error: /Missing frontend controlled Home user-access route/
    },
    {
        name: 'rejects a changed Plugin route constant',
        change: fixture => replaceOnce(fixture, routes,
            'HomeTransitions = "Ptv/v1/home-transitions"', 'HomeTransitions = "Ptv/v1/retired-transitions"'),
        error: /Missing plugin controlled Home topology route/
    },
    {
        name: 'rejects a Web Begin verb changed from POST to GET',
        change: fixture => {
            const file = join(fixture, transport);
            const original = readFileSync(file, 'utf8');
            const changed = original.replace(
                /(beginHomeTransition\(body:[\s\S]*?method: )'POST'/,
                "$1'GET'");
            assert.notEqual(changed, original);
            writeFileSync(file, changed);
        },
        error: /Missing frontend controlled Home topology Begin POST/
    },
    {
        name: 'rejects a Plugin Complete verb changed from POST to GET',
        change: fixture => replaceOnce(fixture, accessController,
            '[HttpPost("{operationId:guid}/complete")]', '[HttpGet("{operationId:guid}/complete")]'),
        error: /Missing plugin controlled Home user-access Complete POST/
    },
    {
        name: 'rejects a Plugin Begin action without an administrator guard',
        change: fixture => removeActionGuard(fixture, topologyController, 'Begin'),
        error: /Missing plugin controlled Home topology Begin administrator guard/
    },
    {
        name: 'rejects a Plugin Complete action without an administrator guard',
        change: fixture => removeActionGuard(fixture, accessController, 'Complete'),
        error: /Missing plugin controlled Home user-access Complete administrator guard/
    },
    {
        name: 'rejects a missing Web Reading reassess route',
        change: fixture => replaceOnce(fixture, config,
            "readingMetadataReassess: 'Ptv/v1/reading/metadata/reassess'",
            "readingMetadataReassess: 'Ptv/v1/reading/metadata/retired'"),
        error: /Missing frontend Reading identity reassess route/
    },
    {
        name: 'rejects a Web Reading reassess verb changed from POST to GET',
        change: fixture => {
            const file = join(fixture, transport);
            const original = readFileSync(file, 'utf8');
            const changed = original.replace(
                /(reassessReadingMetadata<[^]*?method: )'POST'/,
                "$1'GET'");
            assert.notEqual(changed, original);
            writeFileSync(file, changed);
        },
        error: /Missing frontend Reading identity reassess POST/
    },
    {
        name: 'rejects a cached Web Reading reassessment',
        change: fixture => replaceOnce(fixture, transport,
            "{ ...options, body, method: 'POST', bypassCache: true }",
            "{ ...options, body, method: 'POST', bypassCache: false }"),
        error: /Missing frontend Reading identity reassess bypassCache/
    },
    {
        name: 'rejects a Plugin Reading reassess verb changed from POST to GET',
        change: fixture => replaceOnce(fixture, readingController,
            '[HttpPost("reassess")]', '[HttpGet("reassess")]'),
        error: /Missing plugin Reading identity reassess POST/
    },
    {
        name: 'rejects a Plugin Reading reassess action without an administrator guard',
        change: fixture => changeReadingAction(fixture,
            'if (!await IsAdministratorAsync().ConfigureAwait(false)) return Forbid();',
            ''),
        error: /Missing plugin Reading identity reassess administrator guard/
    },
    {
        name: 'rejects a Plugin Reading reassess action without authenticated user binding',
        change: fixture => changeReadingAction(fixture,
            'if (!TryGetAuthenticatedUserId(out var administratorId)) return Unauthorized();',
            ''),
        error: /Missing plugin Reading identity reassess authenticated user binding/
    },
    {
        name: 'rejects a Plugin Reading controller without class authorization',
        change: fixture => replaceOnce(fixture, readingController,
            '[Authorize]',
            '/* Missing class authorization. */'),
        error: /Missing plugin Reading identity reassess administrator boundary/
    }
];

for (const { name, change, error } of brokenContracts) {
    test(name, () => {
        withFixture(fixture => {
            change(fixture);
            const result = runChecker(fixture);
            assert.notEqual(result.status, 0, 'Checker accepted a broken PTV contract.');
            assert.match(result.stderr, error);
        });
    });
}
