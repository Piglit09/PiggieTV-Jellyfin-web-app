import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { findPotentialSecretLabels, isSecretScanCandidatePath } from './ptv-secret-scan-rules.mjs';

const ROOT = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dirname, '..');
const EXCLUDED_PREFIXES = [
    '.dotnet-home/',
    'node_modules/',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/bin/',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/obj/',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/bin/',
    'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/obj/'
];
const gitCandidates = process.platform === 'win32' ?
    [
        resolve(process.env.ProgramFiles || 'C:/Program Files', 'Git/cmd/git.exe'),
        resolve(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Git/cmd/git.exe')
    ] :
    ['/usr/bin/git', '/usr/local/bin/git'];
const gitExecutable = gitCandidates.find(candidate => existsSync(candidate));
if (!gitExecutable) throw new Error('Could not locate a trusted Git executable.');

const repositoryFiles = execFileSync(gitExecutable, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
}).split('\0').filter(Boolean);

const findings = [];
for (const filePath of repositoryFiles) {
    const normalizedPath = filePath.replaceAll('\\', '/');
    if (EXCLUDED_PREFIXES.some(prefix => normalizedPath.startsWith(prefix))) continue;
    if (!isSecretScanCandidatePath(normalizedPath)) continue;

    let content;
    try {
        content = readFileSync(resolve(ROOT, filePath), 'utf8');
    } catch {
        continue;
    }

    for (const label of findPotentialSecretLabels(content)) {
        findings.push(`${normalizedPath}: ${label}`);
    }
}

if (findings.length) {
    console.error('Potential committed secrets detected:');
    for (const finding of findings) {
        console.error(`- ${finding}`);
    }
    process.exit(1);
}

console.log(`Secret scan passed for ${repositoryFiles.length} repository paths (generated dependency/build trees excluded).`);
