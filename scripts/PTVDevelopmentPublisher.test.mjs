import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'PTVDevelopmentPublisher.fixture.ps1');
const pwsh = [process.env.PTV_PWSH,
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime',
        'dependencies', 'native', 'powershell', 'pwsh.exe')
].find(candidate => candidate && path.isAbsolute(candidate) && fs.existsSync(candidate));

test('development publisher changes only disposable Web and Plugin fixtures', () => {
    assert.ok(pwsh, 'PowerShell 7 is required');
    const result = spawnSync(pwsh, ['-NoProfile', '-File', fixture], {
        encoding: 'utf8', windowsHide: true, timeout: 120_000
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /DEVELOPMENT_PUBLISHER_FIXTURES: 7 passed, 0 failed/u);
});
