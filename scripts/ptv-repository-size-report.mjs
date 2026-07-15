import { execFileSync } from 'node:child_process';
import { extname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TOP_COUNT = 25;
// eslint-disable-next-line sonarjs/no-os-command-from-path -- The report intentionally inspects the active Git checkout.
const output = execFileSync('git', ['ls-tree', '-r', '-l', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
});

const entries = output.split('\n').filter(Boolean).map(line => {
    const match = line.match(/^\d+\s+\w+\s+([0-9a-f]+)\s+(\d+)\t(.+)$/);
    return match ? { bytes: Number(match[2]), oid: match[1], path: match[3] } : null;
}).filter(Boolean);
entries.sort((left, right) => right.bytes - left.bytes);

const GENERATED_PREFIXES = ['.dotnet-home/', 'dist/', 'node_modules/'];
const GENERATED_FILE_PATTERNS = [/^(?:\.ptv-|ptv-).*\.log$/];
const BINARY_ASSET_EXTENSIONS = new Set([
    '.avif', '.gif', '.ico', '.jpeg', '.jpg', '.mp3', '.mp4', '.png', '.wasm', '.webp', '.woff', '.woff2'
]);
const isGenerated = entry => GENERATED_PREFIXES.some(prefix => entry.path.startsWith(prefix))
    || GENERATED_FILE_PATTERNS.some(pattern => pattern.test(entry.path))
    || /\/(?:bin|obj)\//.test(entry.path);
const projectEntries = entries.filter(entry => !isGenerated(entry));
const totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
const generatedBytes = entries.filter(isGenerated).reduce((total, entry) => total + entry.bytes, 0);
const format = bytes => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

console.log('# PiggieTV repository size report');
console.log(`Tracked files: ${entries.length}`);
console.log(`Tracked bytes: ${format(totalBytes)}`);
console.log(`Tracked generated/dependency bytes: ${format(generatedBytes)}`);
console.log('');
console.log(`Largest ${TOP_COUNT} tracked files:`);
entries.slice(0, TOP_COUNT).forEach((entry, index) => {
    console.log(`${index + 1}. ${format(entry.bytes)}  ${entry.path}`);
});

console.log('');
console.log(`Largest ${TOP_COUNT} project-owned tracked files (generated/dependency trees excluded):`);
projectEntries.slice(0, TOP_COUNT).forEach((entry, index) => {
    console.log(`${index + 1}. ${format(entry.bytes)}  ${entry.path}`);
});

const lfsCandidates = projectEntries.filter(entry => (
    entry.bytes >= 1024 * 1024 && BINARY_ASSET_EXTENSIONS.has(extname(entry.path).toLowerCase())
));
console.log('');
console.log(`Potential Git LFS candidates (project-owned binary assets >= 1 MiB): ${lfsCandidates.length}`);
lfsCandidates.slice(0, TOP_COUNT).forEach((entry, index) => {
    console.log(`${index + 1}. ${format(entry.bytes)}  ${entry.path}`);
});

const binaryAssetsByOid = new Map();
projectEntries.filter(entry => BINARY_ASSET_EXTENSIONS.has(extname(entry.path).toLowerCase())).forEach(entry => {
    const matches = binaryAssetsByOid.get(entry.oid) || [];
    matches.push(entry);
    binaryAssetsByOid.set(entry.oid, matches);
});
const duplicateGroups = [...binaryAssetsByOid.values()]
    .filter(group => group.length > 1)
    .sort((left, right) => (right[0].bytes * right.length) - (left[0].bytes * left.length));
console.log('');
console.log(`Duplicate project-owned binary asset groups: ${duplicateGroups.length}`);
duplicateGroups.slice(0, TOP_COUNT).forEach((group, index) => {
    console.log(`${index + 1}. ${group.length} copies x ${format(group[0].bytes)}  ${group.map(entry => entry.path).join(' | ')}`);
});
