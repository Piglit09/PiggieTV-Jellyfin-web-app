import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import process from 'node:process';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'dist');
const TOP_COUNT = 30;

if (!existsSync(DIST)) {
    console.error('dist does not exist. Run npm run build:production first.');
    process.exit(1);
}

const files = [];
function walk(directory) {
    for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        const stats = statSync(path);
        if (stats.isDirectory()) walk(path);
        else files.push({ bytes: stats.size, path: relative(DIST, path).replaceAll('\\', '/') });
    }
}
walk(DIST);
files.sort((left, right) => right.bytes - left.bytes);

const format = bytes => `${(bytes / 1024).toFixed(1)} KiB`;
const scriptBytes = files.filter(file => extname(file.path) === '.js').reduce((sum, file) => sum + file.bytes, 0);
const styleBytes = files.filter(file => extname(file.path) === '.css').reduce((sum, file) => sum + file.bytes, 0);

console.log('# PiggieTV production bundle report');
console.log(`Assets: ${files.length}`);
console.log(`JavaScript: ${format(scriptBytes)}`);
console.log(`CSS: ${format(styleBytes)}`);
console.log('');
console.log(`Largest ${TOP_COUNT} emitted assets:`);
for (const [index, file] of files.slice(0, TOP_COUNT).entries()) {
    console.log(`${index + 1}. ${format(file.bytes)}  ${file.path}`);
}
