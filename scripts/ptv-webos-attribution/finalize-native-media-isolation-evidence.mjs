import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const GENERATED_FILES = new Set([
    'artifact-inventory.json',
    'known-private-value-scan.json',
    'privacy-scan.json'
]);

const PRIVACY_PATTERNS = Object.freeze({
    privateTenAddress: /\b10(?:\.\d{1,3}){3}\b/u,
    privateOneNinetyTwoAddress: /\b192\.168(?:\.\d{1,3}){2}\b/u,
    privateOneSeventyTwoAddress: /\b172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}\b/u,
    privateLinkLocalV4Address: /\b169\.254(?:\.\d{1,3}){2}\b/u,
    privateOrLinkLocalV6Address: /(?:f[cd]|fe[89ab])[0-9a-f]*:/iu,
    loopbackAddress: /\b127(?:\.\d{1,3}){3}\b/u,
    loopbackV6Address: /::1(?![0-9a-f:])/iu,
    rawUrl: /\b(?:https?|wss?|rtsp|file):\/\//iu,
    absoluteWindowsPath: /(?:^|[\s"'])(?:[a-z]:\\|\\\\)[^\s"']*/imu,
    absoluteHomePath: /(?:^|[\s"'])\/(?:home|Users)\/[^\s"']+/mu,
    forbiddenIdentityKey: /"(?:itemId|mediaSourceId|playSessionId|sessionId|userId|deviceId|serverId|bootId|filename|fileName|path|rawUrl|streamUrl|mediaTitle|keyCode)"\s*:/iu,
    forbiddenSnakeCaseIdentityKey: /"(?:item_id|media_source_id|play_session_id|session_id|user_id|device_id|server_id|boot_id|file_name|raw_url|stream_url|media_title|key_code)"\s*:/iu,
    tokenCookieOrCredential: /"(?:authorization|cookie|password|accessToken|refreshToken|apiKey|token)"\s*:/iu,
    snakeCaseCredential: /"(?:access_token|refresh_token|api_key)"\s*:/iu,
    rawCredentialHeader: /\b(?:authorization|cookie|x-emby-token)\s*[:=]/iu,
    bearerToken: /\bbearer\s+[a-z0-9._~-]+/iu
});

function listFiles(root) {
    const files = [];

    function visit(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) visit(path);
            else if (entry.isFile()) files.push(path);
        }
    }

    visit(root);
    return files;
}

function normalizeRelative(root, path) {
    return relative(root, path).split(sep).join('/');
}

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function finalizeEvidence(evidenceRoot) {
    const root = resolve(evidenceRoot);
    assert.equal(existsSync(root), true, 'Evidence root does not exist');

    const scannedFiles = listFiles(root).filter(path => {
        return !GENERATED_FILES.has(normalizeRelative(root, path));
    });
    const combined = scannedFiles.map(path => {
        return `${normalizeRelative(root, path)}\n${readFileSync(path, 'utf8')}`;
    }).join('\n');
    const findings = Object.fromEntries(
        Object.entries(PRIVACY_PATTERNS).map(([name, pattern]) => [
            name,
            pattern.test(combined) ? 1 : 0
        ])
    );
    assert.equal(
        Object.values(findings).every(count => count === 0),
        true,
        'Privacy validation failed'
    );

    writeJson(join(root, 'privacy-scan.json'), {
        schemaVersion: 'ptv-webos-native-media-isolation-privacy-scan-v1',
        status: 'PASS',
        filesScanned: scannedFiles.length,
        findings,
        rawPrivateValuesRetained: false
    });

    const inventoryFiles = listFiles(root)
        .filter(path => normalizeRelative(root, path) !== 'artifact-inventory.json')
        .sort((left, right) => normalizeRelative(root, left).localeCompare(normalizeRelative(root, right)));
    writeJson(join(root, 'artifact-inventory.json'), {
        schemaVersion: 'ptv-webos-native-media-isolation-artifact-inventory-v1',
        selfHashExcluded: true,
        artifacts: inventoryFiles.map(path => ({
            file: normalizeRelative(root, path),
            sizeBytes: statSync(path).size,
            sha256: sha256(path),
            classification: 'share-safe'
        }))
    });

    return {
        status: 'PASS',
        filesScanned: scannedFiles.length,
        artifactsInventoried: inventoryFiles.length
    };
}

const evidenceRoot = process.argv[2];
assert.equal(
    typeof evidenceRoot,
    'string',
    'Usage: node finalize-native-media-isolation-evidence.mjs <evidence-root>'
);
assert.equal(process.argv.length, 3, 'Unexpected validation arguments');
process.stdout.write(`${JSON.stringify(finalizeEvidence(evidenceRoot), null, 2)}\n`);
