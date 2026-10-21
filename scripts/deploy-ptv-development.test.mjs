import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'deploy-ptv-development.ps1');
const pwsh = [process.env.PTV_PWSH,
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime',
        'dependencies', 'native', 'powershell', 'pwsh.exe')
].find(candidate => candidate && path.isAbsolute(candidate) && fs.existsSync(candidate));

test('production and incomplete component input are denied before any live operation', () => {
    assert.ok(pwsh, 'PowerShell 7 is required');
    const production = spawnSync(pwsh, ['-NoProfile', '-File', script,
        '-EnvironmentId', 'JF_PRODUCTION_50', '-WebManifest', 'missing.json'],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    assert.notEqual(production.status, 0);
    assert.match(production.stderr + production.stdout, /JF_DEVELOPMENT_125/u);
    const incomplete = spawnSync(pwsh, ['-NoProfile', '-File', script,
        '-EnvironmentId', 'JF_DEVELOPMENT_125', '-WebManifest', 'missing.json'],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    assert.notEqual(incomplete.status, 0);
    assert.match(incomplete.stderr + incomplete.stdout, /component pair|WebArtifactRoot/u);
});

test('Plugin mutation requires a graceful shutdown credential before live checks', () => {
    const result = spawnSync(pwsh, ['-NoProfile', '-File', script,
        '-EnvironmentId', 'JF_DEVELOPMENT_125',
        '-PluginArtifactRoot', 'missing-package', '-PluginManifest', 'missing-manifest'],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /requires a \.125 administrator token/u);
    assert.doesNotMatch(result.stderr + result.stdout, /Protected development preflight/u);
});
