import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const EXPECTED_BUILD = Object.freeze({
    commit: '44899b1fb556f4983ae2c1fa4e861d1ad0b4f4d8',
    packageVersion: '10.11.11',
    artifacts: Object.freeze({
        'index.html': '9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc',
        'runtime.bundle.js': '93ce794233526fc506b6cf58777397ea22f203b9387f808caad8912150656043',
        'main.jellyfin.bundle.js': '8320ae8655682107692777ba8d62d74d014bbaa01b6c3648a60b0caf0f265161'
    })
});

const REQUIRED_ROOT_FILES = Object.freeze([
    'README.md',
    'phase-summary.json',
    'privacy-scan.json',
    'artifact-inventory.json'
]);

const REQUIRED_RUN_FILES = Object.freeze([
    'build-identity.json',
    'device-state-before.json',
    'external-monitor-summary.json',
    'launch-boundary.ndjson',
    'operator-markers.ndjson',
    'resource-monitor.csv',
    'run-summary.json',
    'session.json',
    'static-delivery-boundary.json',
    'uptime-after.json',
    'uptime-before.json'
]);

const FORBIDDEN_PRIVACY_PATTERNS = Object.freeze({
    privateTenAddress: /\b10(?:\.\d{1,3}){3}\b/u,
    privateOneNinetyTwoAddress: /\b192\.168(?:\.\d{1,3}){2}\b/u,
    privateOneSeventyTwoAddress: /\b172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}\b/u,
    loopbackAddress: /\b127(?:\.\d{1,3}){3}\b/u,
    rawUrl: /\b(?:https?|wss?|rtsp|file):\/\//iu,
    absoluteWindowsPath: /(?:^|[\s"'])(?:[a-z]:\\|\\\\)[^\s"']*/imu,
    absoluteHomePath: /(?:^|[\s"'])\/(?:home|Users)\/[^\s"']+/mu,
    sensitiveIdentifierKey: /"(?:itemId|mediaSourceId|playSessionId|userId|deviceId|serverId|bootId|keyCode)"\s*:/iu,
    tokenCookieOrCredential: /"(?:authorization|cookie|password|accessToken|refreshToken|apiKey)"\s*:/iu,
    bearerToken: /\bbearer\s+[a-z0-9._~-]+/iu
});

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

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

function assertExactKeys(value, expectedKeys, label) {
    assert.equal(value !== null && typeof value === 'object' && !Array.isArray(value), true, `${label} must be an object`);
    assert.deepEqual(Object.keys(value).sort(), [...expectedKeys].sort(), `${label} fields changed`);
}

function assertSafeRelativePath(value, label) {
    assert.equal(typeof value, 'string', `${label} must be a string`);
    assert.equal(isAbsolute(value), false, `${label} must be relative`);
    assert.equal(value.includes('\\'), false, `${label} must use portable separators`);
    assert.equal(value.split('/').includes('..'), false, `${label} must stay inside the evidence root`);
}

function assertRequiredFiles(root) {
    for (const path of REQUIRED_ROOT_FILES) {
        assert.equal(existsSync(join(root, path)), true, `Missing required evidence file: ${path}`);
    }
    for (const path of REQUIRED_RUN_FILES) {
        const relativePath = `experiment-a-no-instrumentation/${path}`;
        assert.equal(existsSync(join(root, relativePath)), true, `Missing required evidence file: ${relativePath}`);
    }
}

function validateBuildIdentity(root) {
    const build = readJson(join(root, 'experiment-a-no-instrumentation', 'build-identity.json'));
    assertExactKeys(
        build,
        ['artifacts', 'capturedAt', 'packageVersion', 'git', 'postRunVerification', 'schemaVersion', 'validationSession'],
        'build-identity'
    );
    assert.equal(build.schemaVersion, 1);
    assert.equal(build.packageVersion, EXPECTED_BUILD.packageVersion);
    assert.equal(build.git.commit, EXPECTED_BUILD.commit);
    assert.equal(build.postRunVerification.matched, true);
    assert.match(build.validationSession, /^validation-[0-9a-f]{32}$/u);
    assert.equal(build.artifacts.length, 3);

    const artifacts = Object.fromEntries(build.artifacts.map(artifact => [artifact.name, artifact.sha256]));
    assert.deepEqual(artifacts, EXPECTED_BUILD.artifacts);
}

function validatePhaseResult(root) {
    const phase = readJson(join(root, 'phase-summary.json'));
    assertExactKeys(
        phase,
        [
            'schemaVersion',
            'phase',
            'title',
            'decision',
            'experimentA',
            'experimentB',
            'experimentC',
            'classification',
            'evidenceLimitations',
            'nextPhase',
            'productionModified',
            'ownershipBoundariesModified'
        ],
        'phase-summary'
    );
    assert.equal(phase.decision, 'BLOCK-native-platform-reproduced');
    assert.equal(phase.experimentA.observerPresent, false);
    assert.equal(phase.experimentA.cdpPresent, false);
    assert.equal(phase.experimentA.externalResourcePollingActive, true);
    assert.equal(phase.experimentA.inputCountAfterPlaybackStart, 0);
    assert.equal(phase.experimentA.platformRebootProven, true);
    assert.equal(phase.experimentB, 'not-run-by-design');
    assert.equal(phase.experimentC, 'not-run-by-design');
    assert.equal(phase.nextPhase, 'WebOS native media-path isolation');
    assert.equal(phase.productionModified, false);
    assert.equal(phase.ownershipBoundariesModified, false);
}

function validateRunResult(root) {
    const run = readJson(join(root, 'experiment-a-no-instrumentation', 'run-summary.json'));
    assertExactKeys(
        run,
        [
            'schemaVersion',
            'experiment',
            'runClassification',
            'visibleResult',
            'approval',
            'experimentConfiguration',
            'timeline',
            'mediaPath',
            'externalProcessObservation',
            'platformResult',
            'experiments',
            'provenFacts',
            'causalClaimsNotProven',
            'initiatingTriggerClassification',
            'decision'
        ],
        'run-summary'
    );
    assert.equal(run.runClassification, 'native-platform-path-reproduced-without-instrumentation');
    assert.equal(run.visibleResult, 'full-tv-reboot');
    assert.equal(run.approval.status, 'explicit');
    assert.equal(run.approval.destructiveRiskAcknowledgedBeforeLaunch, true);
    assert.equal(run.experimentConfiguration.forbiddenInstrumentationConfirmedAbsent, true);
    assert.equal(run.experimentConfiguration.externalResourcePollingActive, true);
    assert.equal(run.experimentConfiguration.externalResourcePollIntervalSeconds, 5);
    assert.equal(run.experimentConfiguration.inputCountAfterPlaybackStart, 0);
    assert.equal(run.timeline.observedPlaybackMillisecondsToDerivedBoot, 108057);
    assert.equal(run.platformResult.fullNetworkAndDeveloperChannelLossObserved, true);
    assert.equal(run.platformResult.fullPlatformRebootProven, true);
    assert.equal(run.platformResult.validationApplicationPresentAfterBoot, false);
    assert.equal(run.experiments.experimentB, 'not-run-by-design');
    assert.equal(run.experiments.experimentC, 'not-run-by-design');
    assert.equal(run.mediaPath.rendererPathClass, 'html5-video-element');
    assert.equal(run.mediaPath.hardwareDecodePath, 'unknown');
}

function validateDeviceAndUptime(root) {
    const directory = join(root, 'experiment-a-no-instrumentation');
    const device = readJson(join(directory, 'device-state-before.json'));
    const before = readJson(join(directory, 'uptime-before.json'));
    const after = readJson(join(directory, 'uptime-after.json'));
    const monitor = readJson(join(directory, 'external-monitor-summary.json'));

    assert.equal(device.model, 'LG 70UN7070PUA');
    assert.equal(device.webosVersion, '5.6.2');
    assert.equal(device.firmwareVersion, '04.64.00');
    assert.equal(device.boardProfile, 'K6LP_ATSC_US / TV');
    assert.equal(device.validationApplication.runningBeforeLaunch, false);
    assert.equal(Object.values(device.instrumentationAbsence).every(value => value === false || value === 0), true);
    assert.equal(before.queryStatus, 'ok');
    assert.equal(before.uptimeSeconds, 3483.57);
    assert.equal(after.platformRebootProven, true);
    assert.equal(after.firstRecoveryProbe.uptimeSeconds, 152.03);
    assert.equal(monitor.configuration.cdp, false);
    assert.equal(monitor.configuration.inspector, false);
    assert.equal(monitor.configuration.rendererObserver, false);
    assert.equal(monitor.configuration.eventSink, false);
    assert.equal(monitor.configuration.browserInput, false);
    assert.equal(monitor.cleanup.helperProcessCountAfterCleanup, 0);
    assert.equal(monitor.cleanup.staticListenerCountAfterCleanup, 0);
}

function validatePrivacy(root) {
    const scan = readJson(join(root, 'privacy-scan.json'));
    assertExactKeys(
        scan,
        [
            'schemaVersion',
            'scannedAt',
            'scope',
            'privacyClassification',
            'filesScanned',
            'findings',
            'allowedSafeIdentifiers',
            'status'
        ],
        'privacy-scan'
    );
    assert.equal(scan.schemaVersion, 'ptv-webos-phase3a1r1-privacy-scan-v1');
    assert.equal(scan.status, 'PASS');
    assert.equal(scan.privacyClassification, 'share-safe');
    assert.equal(Object.values(scan.findings).every(count => count === 0), true);

    const scannedFiles = listFiles(root).filter(path => {
        const relativePath = normalizeRelative(root, path);
        return !['privacy-scan.json', 'artifact-inventory.json'].includes(relativePath);
    });
    assert.equal(scan.filesScanned, scannedFiles.length);

    const combined = scannedFiles.map(path => readFileSync(path, 'utf8')).join('\n');
    for (const [name, pattern] of Object.entries(FORBIDDEN_PRIVACY_PATTERNS)) {
        assert.equal(pattern.test(combined), false, `Privacy finding: ${name}`);
    }
}

function validateInventory(root) {
    const inventory = readJson(join(root, 'artifact-inventory.json'));
    assertExactKeys(
        inventory,
        ['schemaVersion', 'generatedAt', 'privacyClassification', 'selfHashExcluded', 'artifacts'],
        'artifact-inventory'
    );
    assert.equal(inventory.schemaVersion, 'ptv-webos-phase3a1r1-artifact-inventory-v1');
    assert.equal(inventory.privacyClassification, 'share-safe');
    assert.equal(inventory.selfHashExcluded, true);

    const actualPaths = listFiles(root)
        .map(path => normalizeRelative(root, path))
        .filter(path => path !== 'artifact-inventory.json')
        .sort();
    const inventoryPaths = inventory.artifacts.map(artifact => artifact.file).sort();
    assert.deepEqual(inventoryPaths, actualPaths);

    for (const artifact of inventory.artifacts) {
        assertExactKeys(artifact, ['file', 'sha256', 'sizeBytes', 'purpose', 'classification'], `artifact ${artifact.file}`);
        assertSafeRelativePath(artifact.file, `artifact ${artifact.file}`);
        const absolutePath = resolve(root, artifact.file);
        assert.equal(absolutePath.startsWith(`${root}${sep}`), true, `Artifact escaped evidence root: ${artifact.file}`);
        assert.equal(statSync(absolutePath).size, artifact.sizeBytes, `Artifact size mismatch: ${artifact.file}`);
        assert.equal(sha256(absolutePath), artifact.sha256, `Artifact hash mismatch: ${artifact.file}`);
        assert.equal(artifact.classification, 'share-safe');
    }
}

export function validateRebootIsolationEvidence(evidenceRoot) {
    const root = resolve(evidenceRoot);
    assert.equal(existsSync(root), true, 'Evidence root does not exist');
    assertRequiredFiles(root);
    validateBuildIdentity(root);
    validatePhaseResult(root);
    validateRunResult(root);
    validateDeviceAndUptime(root);
    validatePrivacy(root);
    validateInventory(root);

    return {
        status: 'PASS',
        schemaVersion: 'ptv-webos-phase3a1r1-validation-v1',
        evidenceRoot: 'privacy-redacted',
        requiredFilesPresent: true,
        exactBuildIdentityMatched: true,
        instrumentationAbsenceValidated: true,
        fullPlatformRebootValidated: true,
        privacyValidated: true,
        inventoryHashesValidated: true
    };
}

function main(argv) {
    assert.equal(argv.length, 1, 'Usage: node validate-reboot-isolation-evidence.mjs <evidence-root>');
    process.stdout.write(`${JSON.stringify(validateRebootIsolationEvidence(argv[0]), null, 2)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
    main(process.argv.slice(2));
}
