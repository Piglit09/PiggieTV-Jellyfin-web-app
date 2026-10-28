import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'PTVWebPrepublicationGate.fixture.ps1');
const pwsh = [ process.env.PTV_PWSH,
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime',
        'dependencies', 'native', 'powershell', 'pwsh.exe')
].find(candidate => candidate && path.isAbsolute(candidate) && fs.existsSync(candidate));
assert.ok(pwsh, 'An absolute PowerShell 7 executable is required for the fixture');

test('pre-publication gate denies unsafe server, session, Beta, and approval evidence', () => {
    const result = spawnSync(pwsh, [ '-NoProfile', '-File', script ], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120_000
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PREPUBLICATION_GATE_FIXTURES: 78 passed, 0 failed/u);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-sensitive-token-never-print/u);
});
