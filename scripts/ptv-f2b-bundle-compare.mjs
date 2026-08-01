import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync
} from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const reportDirectory = resolve(root, 'test-results', 'f2b');
const command = process.argv[2] || 'snapshot';

function reportPath(label) {
    return resolve(reportDirectory, `bundle-${label}.json`);
}

function walk(directory, files = []) {
    for (const name of readdirSync(directory)) {
        const absolutePath = join(directory, name);
        const stats = statSync(absolutePath);

        if (stats.isDirectory()) walk(absolutePath, files);
        else files.push(absolutePath);
    }

    return files;
}

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function classifyJavaScript(buffer) {
    const source = buffer.toString('utf8');
    const roles = [];

    if (source.includes('ptv-music-shell')) roles.push('music-route');
    if (source.includes('ptv-music-player-panel')) roles.push('music-player');
    if (
        source.includes('Lyrics could not be loaded.')
        && source.includes('No lyrics available.')
    ) {
        roles.push('music-lyrics');
    }

    return roles;
}

function createSnapshot(label, classification) {
    if (!existsSync(dist)) throw new Error('dist does not exist. Run the production build first.');

    const assets = walk(dist)
        .filter(absolutePath => ['.css', '.js'].includes(extname(absolutePath).toLowerCase()))
        .map(absolutePath => {
            const buffer = readFileSync(absolutePath);
            const path = relative(dist, absolutePath).replaceAll('\\', '/');
            const extension = extname(path).toLowerCase();

            return {
                bytes: buffer.length,
                path,
                roles: extension === '.js' && !/-json\.[^.]+\.chunk\.js$/.test(path) ?
                    classifyJavaScript(buffer) :
                    [],
                sha256: sha256(buffer)
            };
        })
        .sort((left, right) => left.path.localeCompare(right.path));
    const scripts = assets.filter(asset => extname(asset.path) === '.js');
    const styles = assets.filter(asset => extname(asset.path) === '.css');
    const roleAssets = role => scripts.filter(asset => asset.roles.includes(role));
    const mainJavaScript = scripts.find(asset => asset.path === 'main.jellyfin.bundle.js') || null;
    const mainCss = styles.find(asset => /^main\.jellyfin\..+\.css$/.test(asset.path)) || null;
    const musicRouteChunks = roleAssets('music-route');
    const musicPlayerChunks = roleAssets('music-player');
    const lyricsChunks = roleAssets('music-lyrics');

    return {
        assets,
        classification,
        environment: {
            node: process.version,
            platform: `${process.platform}-${process.arch}`
        },
        generatedAt: new Date().toISOString(),
        label,
        metrics: {
            assetCount: assets.length,
            cssBytes: styles.reduce((sum, asset) => sum + asset.bytes, 0),
            javaScriptBytes: scripts.reduce((sum, asset) => sum + asset.bytes, 0),
            lyricsChunkBytes: lyricsChunks.reduce((sum, asset) => sum + asset.bytes, 0),
            lyricsChunkPaths: lyricsChunks.map(asset => asset.path),
            lyricsIsSeparateLazyChunk: Boolean(
                lyricsChunks.length
                && lyricsChunks.every(asset => (
                    asset.path !== mainJavaScript?.path
                    && !musicRouteChunks.some(routeAsset => routeAsset.path === asset.path)
                ))
            ),
            mainCssBytes: mainCss?.bytes ?? null,
            mainCssPath: mainCss?.path ?? null,
            mainJavaScriptBytes: mainJavaScript?.bytes ?? null,
            mainJavaScriptPath: mainJavaScript?.path ?? null,
            musicPlayerChunkBytes: musicPlayerChunks.reduce((sum, asset) => sum + asset.bytes, 0),
            musicPlayerChunkPaths: musicPlayerChunks.map(asset => asset.path),
            musicRouteChunkBytes: musicRouteChunks.reduce((sum, asset) => sum + asset.bytes, 0),
            musicRouteChunkPaths: musicRouteChunks.map(asset => asset.path)
        },
        schemaVersion: 1
    };
}

function delta(before, after) {
    if (!Number.isFinite(before) || !Number.isFinite(after)) {
        return { after, before, bytes: null, percent: null };
    }

    const bytes = after - before;

    return {
        after,
        before,
        bytes,
        percent: before ? Math.round((bytes / before) * 100_000) / 1_000 : null
    };
}

function readSnapshot(label) {
    return JSON.parse(readFileSync(reportPath(label), 'utf8'));
}

function writeReport(path, value) {
    mkdirSync(reportDirectory, { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function snapshot() {
    const label = process.argv[3] || 'current';
    const classification = process.argv[4] || 'current-production-build';
    const result = createSnapshot(label, classification);
    const path = reportPath(label);

    writeReport(path, result);
    process.stdout.write(`${JSON.stringify({ metrics: result.metrics, path }, null, 2)}\n`);
}

function compare() {
    const beforeLabel = process.argv[3] || 'baseline';
    const afterLabel = process.argv[4] || 'current';
    const before = readSnapshot(beforeLabel);
    const after = readSnapshot(afterLabel);
    const report = {
        after: {
            classification: after.classification,
            generatedAt: after.generatedAt,
            label: after.label
        },
        before: {
            classification: before.classification,
            generatedAt: before.generatedAt,
            label: before.label
        },
        deltas: {
            allCss: delta(before.metrics.cssBytes, after.metrics.cssBytes),
            allJavaScript: delta(before.metrics.javaScriptBytes, after.metrics.javaScriptBytes),
            lyricsChunk: delta(before.metrics.lyricsChunkBytes, after.metrics.lyricsChunkBytes),
            mainCss: delta(before.metrics.mainCssBytes, after.metrics.mainCssBytes),
            mainJavaScript: delta(before.metrics.mainJavaScriptBytes, after.metrics.mainJavaScriptBytes),
            musicPlayerChunk: delta(before.metrics.musicPlayerChunkBytes, after.metrics.musicPlayerChunkBytes),
            musicRouteChunk: delta(before.metrics.musicRouteChunkBytes, after.metrics.musicRouteChunkBytes)
        },
        lyricsIsSeparateLazyChunk: after.metrics.lyricsIsSeparateLazyChunk,
        schemaVersion: 1
    };
    const path = resolve(reportDirectory, `bundle-compare-${beforeLabel}-to-${afterLabel}.json`);

    writeReport(path, report);
    process.stdout.write(`${JSON.stringify({ path, ...report }, null, 2)}\n`);
}

function verify() {
    const label = process.argv[3] || 'current';
    const expected = readSnapshot(label);
    const actual = createSnapshot(label, expected.classification);
    const actualHashes = new Map(actual.assets.map(asset => [asset.path, asset.sha256]));
    const mismatches = expected.assets
        .filter(asset => actualHashes.get(asset.path) !== asset.sha256)
        .map(asset => asset.path);
    const missingFromSnapshot = actual.assets
        .filter(asset => !expected.assets.some(expectedAsset => expectedAsset.path === asset.path))
        .map(asset => asset.path);
    const valid = !mismatches.length && !missingFromSnapshot.length;

    process.stdout.write(`${JSON.stringify({ label, mismatches, missingFromSnapshot, valid }, null, 2)}\n`);
    if (!valid) process.exitCode = 1;
}

if (command === 'snapshot') snapshot();
else if (command === 'compare') compare();
else if (command === 'verify') verify();
else throw new Error('Usage: ptv-f2b-bundle-compare.mjs <snapshot|compare|verify> [labels]');
