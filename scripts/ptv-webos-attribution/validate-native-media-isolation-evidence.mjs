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
    }),
    wrapper: Object.freeze({
        appInfoSha256: '76cdc80786399fc2a65758a139e19918c0181bd1e0bc95dd22d2a5e590c4284c',
        indexSha256: 'c4a24b16740f19982c8df3dc92bffc7bbed91840da6e25b41204010a8e0c2f02',
        packageSha256: '01da6c157e9822416df9f91f7d38764a6e1b67fa6d2bbc65779400f46c095794'
    })
});

const PREFLIGHT_FILES = Object.freeze([
    'README.md',
    'comparison-matrix.json',
    'phase-summary.json',
    'wrapper-comparison.json',
    'run-01-baseline/approval.json',
    'run-01-baseline/build-identity.json',
    'run-01-baseline/delivery-mode.json',
    'run-01-baseline/media-category.json'
]);

const FINAL_FILES = Object.freeze([
    ...PREFLIGHT_FILES,
    'artifact-inventory.json',
    'final-report.md',
    'known-private-value-scan.json',
    'privacy-scan.json',
    'run-01-baseline/cleanup.json',
    'run-01-baseline/device-state-before.json',
    'run-01-baseline/instrumentation-absence.json',
    'run-01-baseline/operator-markers.ndjson',
    'run-01-baseline/run-summary.json',
    'run-01-baseline/static-delivery-summary.json',
    'run-01-baseline/uptime-after.json',
    'run-01-baseline/uptime-before.json'
]);

const FORBIDDEN_PRIVACY_PATTERNS = Object.freeze({
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

const INTERRUPTED_RESULT = 'interrupted-unsolicited-pause';
const INTERRUPTED_DURATION_SECONDS = 174.56;
const DURATION_TOLERANCE_SECONDS = 0.01;
const UPTIME_WALL_DELTA_TOLERANCE_SECONDS = 1;

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function readNdjson(path) {
    return readFileSync(path, 'utf8')
        .split(/\r?\n/u)
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line));
}

function parseTimestamp(value, label) {
    assert.equal(typeof value, 'string', `${label} must be an ISO timestamp`);
    const timestamp = Date.parse(value);
    assert.equal(Number.isFinite(timestamp), true, `${label} must be an ISO timestamp`);
    return timestamp;
}

function assertFinitePositive(value, label) {
    assert.equal(typeof value, 'number', `${label} must be numeric`);
    assert.equal(Number.isFinite(value), true, `${label} must be finite`);
    assert.equal(value > 0, true, `${label} must be positive`);
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

function assertFiles(root, files) {
    for (const path of files) {
        assert.equal(existsSync(join(root, path)), true, `Missing evidence file: ${path}`);
    }
}

function validateBuild(root) {
    const build = readJson(join(root, 'run-01-baseline', 'build-identity.json'));
    assert.equal(build.git.commit, EXPECTED_BUILD.commit);
    assert.equal(build.packageVersion, EXPECTED_BUILD.packageVersion);
    assert.equal(build.exactRequiredIdentityMatched, true);
    assert.deepEqual(
        Object.fromEntries(build.artifacts.map(artifact => [artifact.name, artifact.sha256])),
        EXPECTED_BUILD.artifacts
    );
    assert.equal(build.validationWrapper.appInfoSha256, EXPECTED_BUILD.wrapper.appInfoSha256);
    assert.equal(build.validationWrapper.indexSha256, EXPECTED_BUILD.wrapper.indexSha256);
    assert.equal(build.validationWrapper.packageSha256, EXPECTED_BUILD.wrapper.packageSha256);
}

function validateMedia(root) {
    const media = readJson(join(root, 'run-01-baseline', 'media-category.json'));
    assert.equal(media.sourceIdentityRetained, false);
    assert.equal(media.container, 'mp4');
    assert.equal(media.videoCodec, 'h264-avc');
    assert.equal(media.videoLevel, '4.1');
    assert.equal(media.audioCodec, 'aac-lc');
    assert.equal(media.resolution.width <= 1920 && media.resolution.height <= 1080, true);
    assert.equal(media.frameRate.constantOrConventional, true);
    assert.equal(media.bitDepth, 8);
    assert.equal(media.chromaFormat, 'yuv420p');
    assert.equal(media.dynamicRange, 'sdr');
    assert.equal(media.subtitleState, 'none');
    assert.equal(media.audioStreamCount, 1);
    assert.equal(media.channelLayout, 'stereo');
    assert.equal(media.bitrateClass, 'moderate');
    assert.equal(media.durationClass, '15-minutes-or-longer');
    assert.equal(media.multipleVideoVersions, false);
    assert.equal(media.meetsBaselineRequirements, true);
}

function validateWrapperComparison(root) {
    const comparison = readJson(join(root, 'wrapper-comparison.json'));
    assert.equal(comparison.localValidationWrapper.nativeShell, false);
    assert.equal(comparison.localValidationWrapper.documentTopology, 'top-level-location-replacement');
    assert.equal(comparison.localValidationWrapper.targetMatchesCurrentStaticHost, true);
    assert.equal(comparison.officialJellyfinWebosReference.nativeShell, true);
    assert.equal(comparison.officialJellyfinWebosReference.installedOnComparedDevice, false);
    assert.equal(comparison.interpretation.upstreamEquivalent, false);
    assert.equal(comparison.interpretation.officialClientRunRequiresSeparateApproval, true);
}

export function validateNativeMediaIsolationPrivacy(root, final) {
    const allFiles = listFiles(root);
    const files = allFiles.filter(path => {
        const relativePath = normalizeRelative(root, path);
        return ![
            'artifact-inventory.json',
            'known-private-value-scan.json',
            'privacy-scan.json'
        ].includes(relativePath);
    });
    const combined = [
        ...allFiles.map(path => normalizeRelative(root, path)),
        ...files.map(path => readFileSync(path, 'utf8'))
    ].join('\n');

    for (const [name, pattern] of Object.entries(FORBIDDEN_PRIVACY_PATTERNS)) {
        assert.equal(pattern.test(combined), false, `Privacy finding: ${name}`);
    }

    if (final) {
        const scan = readJson(join(root, 'privacy-scan.json'));
        assert.equal(scan.status, 'PASS');
        assert.equal(scan.filesScanned, files.length);
        assert.equal(scan.rawPrivateValuesRetained, false);
        assert.deepEqual(
            Object.keys(scan.findings).sort(),
            Object.keys(FORBIDDEN_PRIVACY_PATTERNS).sort()
        );
        assert.equal(Object.values(scan.findings).every(count => count === 0), true);
    }
}

export function validateNativeMediaIsolationKnownPrivateValueScan(root) {
    const scan = readJson(join(root, 'known-private-value-scan.json'));
    assert.equal(scan.schemaVersion, 'ptv-webos-known-private-value-scan-v1');
    assert.equal(scan.status, 'PASS');
    assert.equal(scan.rawValuesRetained, false);
    assert.equal(scan.knownValueCoverageLimitedToCapturedCorrelationValues, true);
    assert.deepEqual(scan.categories, {
        mediaItemIdentifier: 0,
        mediaTitle: 0,
        mediaPath: 0,
        mediaFilename: 0
    });
    assert.deepEqual(scan.additionalSchemaAndManualReviewCategories, {
        mediaSourceIdentifier: 0,
        playbackSessionOrSessionIdentifier: 0,
        userIdentifier: 0,
        uniqueDeviceOrServerIdentifier: 0,
        playbackOrStreamUrl: 0,
        tokenCookieOrCredential: 0,
        localUsernameOrAbsolutePath: 0,
        bootIdentifier: 0,
        rawKeyCode: 0
    });
}

function assertSafeRelativePath(value) {
    assert.equal(typeof value, 'string');
    assert.equal(isAbsolute(value), false);
    assert.equal(value.includes('\\'), false);
    assert.equal(value.split('/').includes('..'), false);
}

function validateInventory(root) {
    const inventory = readJson(join(root, 'artifact-inventory.json'));
    assert.equal(inventory.selfHashExcluded, true);
    const actualPaths = listFiles(root)
        .map(path => normalizeRelative(root, path))
        .filter(path => path !== 'artifact-inventory.json')
        .sort();
    const inventoryPaths = inventory.artifacts.map(artifact => artifact.file).sort();
    assert.deepEqual(inventoryPaths, actualPaths);

    for (const artifact of inventory.artifacts) {
        assertSafeRelativePath(artifact.file);
        const absolutePath = resolve(root, artifact.file);
        assert.equal(absolutePath.startsWith(`${root}${sep}`), true);
        assert.equal(statSync(absolutePath).size, artifact.sizeBytes);
        assert.equal(sha256(absolutePath), artifact.sha256);
        assert.equal(artifact.classification, 'share-safe');
    }
}

function validateCleanupAndStaticDelivery(root) {
    const cleanup = readJson(join(root, 'run-01-baseline', 'cleanup.json'));
    const staticDelivery = readJson(join(root, 'run-01-baseline', 'static-delivery-summary.json'));

    assert.equal(cleanup.validationApplicationClosedByCommand, true);
    assert.equal(cleanup.validationApplicationClosureConfirmedByOperator, true);
    assert.equal(cleanup.staticServerOwnershipVerified, true);
    assert.equal(cleanup.staticServerProcessPresent, false);
    assert.equal(cleanup.staticListenerCount, 0);
    assert.equal(cleanup.temporaryRuntimeDirectoryRemoved, true);
    assert.equal(cleanup.forbiddenHelpers.total, 0);
    assert.equal(
        Object.entries(cleanup.forbiddenHelpers)
            .filter(([name]) => name !== 'total')
            .every(([, count]) => count === 0),
        true
    );

    assert.equal(staticDelivery.serverActiveDuringCountedInterval, true);
    assert.equal(staticDelivery.serverActiveAfterCleanup, false);
    assert.equal(staticDelivery.serverCount, 1);
    assert.equal(staticDelivery.exactIndexMatched, true);
    assert.equal(staticDelivery.rendererInjectionDetected, false);
    assert.equal(staticDelivery.rawRequestDataRetained, false);
    assert.equal(staticDelivery.listenerRemoved, true);
}

function validateInterruptedOutcome({
    approval,
    phase,
    instrumentation,
    matrix,
    run,
    root
}) {
    const matrixRun = matrix.runs[0];
    const interval = instrumentation.countedInterval;
    const runInterval = run.countedInterval;
    const before = readJson(join(root, 'run-01-baseline', 'uptime-before.json'));
    const after = readJson(join(root, 'run-01-baseline', 'uptime-after.json'));
    const markers = readNdjson(join(root, 'run-01-baseline', 'operator-markers.ndjson'));
    const playbackStartMarkers = markers.filter(marker => marker.category === 'playback-start-confirmed');
    const unsolicitedPauseMarkers = markers.filter(marker => marker.category === 'unsolicited-playback-pause');
    const postRunCloseMarkers = markers.filter(marker => marker.category === 'post-run-application-closed');

    assert.equal(playbackStartMarkers.length, 1);
    assert.equal(unsolicitedPauseMarkers.length, 1);
    assert.equal(postRunCloseMarkers.length, 1);
    const playbackStart = playbackStartMarkers[0];
    const unsolicitedPause = unsolicitedPauseMarkers[0];
    const postRunClose = postRunCloseMarkers[0];
    const playbackStartIndex = markers.indexOf(playbackStart);
    const unsolicitedPauseIndex = markers.indexOf(unsolicitedPause);
    const postRunCloseIndex = markers.indexOf(postRunClose);
    assert.equal(playbackStartIndex < unsolicitedPauseIndex, true);
    assert.equal(unsolicitedPauseIndex < postRunCloseIndex, true);
    assert.equal(playbackStart.sequence < unsolicitedPause.sequence, true);
    assert.equal(unsolicitedPause.sequence < postRunClose.sequence, true);
    assert.equal(playbackStart.countedInterval, true);
    assert.equal(playbackStart.state, 'playing');
    assert.equal(playbackStart.inputMethod, 'physical-lg-remote');
    assert.equal(playbackStart.postStartPhysicalInputCount, 0);
    assert.equal(unsolicitedPause.countedInterval, true);
    assert.equal(unsolicitedPause.state, 'paused-without-operator-input');
    assert.equal(unsolicitedPause.postStartPhysicalInputCount, 0);
    assert.equal(unsolicitedPause.intervalStopped, true);
    assert.equal(postRunClose.countedInterval, false);
    assert.equal(postRunClose.state, 'cleanup-confirmed');

    assert.equal(approval.countedPlaybackStarted, true);
    assert.equal(run.decision, 'HOLD-inconclusive');
    assert.equal(run.interruptionCategory, 'unsolicited-playback-pause');
    assert.equal(run.physicalPlaybackStart, true);
    assert.equal(run.stableDurationProven, false);
    assert.equal(run.preRunUptimeIncreasedAfterRun, true);
    assert.equal(phase.currentStatus, 'complete-hold-inconclusive');
    assert.equal(phase.run1.status, INTERRUPTED_RESULT);
    assert.equal(phase.run1.result, INTERRUPTED_RESULT);
    assert.equal(matrixRun.result, INTERRUPTED_RESULT);
    assert.equal(interval.status, 'ended-zero-input');

    assert.equal(run.actualDeliveryMode, 'DirectPlay');
    assert.equal(phase.run1.actualDeliveryMode, run.actualDeliveryMode);
    assert.equal(matrixRun.deliveryMode, run.actualDeliveryMode);

    assert.equal(run.observedDurationSeconds, INTERRUPTED_DURATION_SECONDS);
    assert.equal(runInterval.observedDurationSeconds, run.observedDurationSeconds);
    assert.equal(phase.run1.observedDurationSeconds, run.observedDurationSeconds);
    assert.equal(matrixRun.durationSeconds, run.observedDurationSeconds);
    assert.equal(interval.observedDurationSeconds, run.observedDurationSeconds);
    assert.equal(run.observedDurationSeconds > 0, true);
    assert.equal(run.observedDurationSeconds < 900, true);

    assert.equal(runInterval.postStartPhysicalInputCount, 0);
    assert.equal(phase.run1.postStartInputCount, runInterval.postStartPhysicalInputCount);
    assert.equal(matrixRun.postStartInputCount, runInterval.postStartPhysicalInputCount);
    assert.equal(interval.postStartPhysicalInputCount, runInterval.postStartPhysicalInputCount);
    assert.equal(matrixRun.platformRebootProven, false);
    assert.equal(run.platformRebootProven, matrixRun.platformRebootProven);
    assert.equal(after.platformRebootProven, run.platformRebootProven);

    assert.equal(runInterval.startedAt, playbackStart.observedAt);
    assert.equal(runInterval.endedAt, unsolicitedPause.observedAt);
    assert.equal(interval.startedAt, playbackStart.observedAt);
    assert.equal(interval.endedAt, unsolicitedPause.observedAt);
    const playbackStartAt = parseTimestamp(playbackStart.observedAt, 'playback-start marker');
    const unsolicitedPauseAt = parseTimestamp(unsolicitedPause.observedAt, 'unsolicited-pause marker');
    const postRunCloseAt = parseTimestamp(postRunClose.observedAt, 'post-run-close marker');
    assert.equal(unsolicitedPauseAt > playbackStartAt, true);
    assert.equal(postRunCloseAt > unsolicitedPauseAt, true);
    const markerDurationSeconds = (unsolicitedPauseAt - playbackStartAt) / 1000;
    assert.equal(
        Math.abs(markerDurationSeconds - run.observedDurationSeconds) <= DURATION_TOLERANCE_SECONDS,
        true
    );

    if (approval.consumedByPrestartAttempt === true) {
        assert.equal(approval.relaunchAuthorized, true);
        const prestartMarkers = markers.filter(marker => marker.category === 'prestart-operator-exit');
        assert.equal(prestartMarkers.length, 1);
        const prestart = prestartMarkers[0];
        assert.equal(markers.indexOf(prestart) < playbackStartIndex, true);
        const initialApprovalAt = parseTimestamp(approval.approvalReceivedAt, 'initial approval');
        const prestartAt = parseTimestamp(prestart.observedAt, 'prestart marker');
        const relaunchApprovalAt = parseTimestamp(
            approval.relaunchApprovalReceivedAt,
            'relaunch approval'
        );
        assert.equal(initialApprovalAt < prestartAt, true);
        assert.equal(prestartAt < relaunchApprovalAt, true);
        assert.equal(relaunchApprovalAt < playbackStartAt, true);
    }

    assertFinitePositive(before.uptimeSeconds, 'uptime-before uptimeSeconds');
    assertFinitePositive(after.uptimeSeconds, 'uptime-after uptimeSeconds');
    assert.equal(before.sampleCount, 1);
    assert.equal(after.sampleCount, 1);
    assert.equal(after.increasedFromPreRun, true);
    assert.equal(after.platformRebootProven, false);
    assert.equal(after.uptimeSeconds > before.uptimeSeconds, true);
    const beforeObservedAt = parseTimestamp(before.observedAt, 'uptime-before observation');
    const afterObservedAt = parseTimestamp(after.observedAt, 'uptime-after observation');
    assert.equal(beforeObservedAt < playbackStartAt, true);
    assert.equal(afterObservedAt > unsolicitedPauseAt, true);
    const wallDeltaSeconds = (afterObservedAt - beforeObservedAt) / 1000;
    const uptimeDeltaSeconds = after.uptimeSeconds - before.uptimeSeconds;
    assert.equal(
        Math.abs(wallDeltaSeconds - uptimeDeltaSeconds) <= UPTIME_WALL_DELTA_TOLERANCE_SECONDS,
        true
    );

    const cleanup = readJson(join(root, 'run-01-baseline', 'cleanup.json'));
    const staticDelivery = readJson(join(root, 'run-01-baseline', 'static-delivery-summary.json'));
    const staticCleanupAt = parseTimestamp(staticDelivery.cleanupStoppedAt, 'static cleanup');
    const cleanupCompletedAt = parseTimestamp(cleanup.completedAt, 'cleanup completion');
    assert.equal(unsolicitedPauseAt < staticCleanupAt, true);
    assert.equal(staticCleanupAt < postRunCloseAt, true);
    assert.equal(postRunCloseAt < cleanupCompletedAt, true);
}

export function validateNativeMediaIsolationFinalOutcome(root) {
    const approval = readJson(join(root, 'run-01-baseline', 'approval.json'));
    const phase = readJson(join(root, 'phase-summary.json'));
    const delivery = readJson(join(root, 'run-01-baseline', 'delivery-mode.json'));
    const instrumentation = readJson(join(root, 'run-01-baseline', 'instrumentation-absence.json'));
    const matrix = readJson(join(root, 'comparison-matrix.json'));
    const run = readJson(join(root, 'run-01-baseline', 'run-summary.json'));

    assert.equal(approval.status, 'explicit');
    assert.equal(approval.destructiveRiskAcknowledged, true);
    assert.equal(approval.launchAuthorized, true);
    assert.equal(delivery.actualRunDecision.selectedDeliveryCategory, 'DirectPlay');
    assert.equal(delivery.actualRunDecision.videoTranscode, false);
    assert.equal(delivery.actualRunDecision.audioTranscode, false);
    assert.equal(delivery.actualRunDecision.containerRemux, false);
    assert.equal(delivery.actualRunDecision.subtitleBurnIn, false);
    assert.equal(delivery.actualRunDecision.candidateCount, 1);
    assert.equal(delivery.actualRunDecision.rawRecordRetained, false);
    assert.equal(delivery.countableAsCleanIsolation, true);
    assert.equal(instrumentation.preflight.forbiddenHelperTotal, 0);
    assert.equal(instrumentation.preflight.staticServerCount, 1);
    assert.equal(instrumentation.countedInterval.periodicProcessResourcePolling, 0);
    assert.equal(instrumentation.countedInterval.appPresenceQueries, 0);
    assert.equal(instrumentation.countedInterval.networkProbes, 0);
    assert.equal(instrumentation.countedInterval.cdpOrInspectorAttachments, 0);
    assert.equal(instrumentation.countedInterval.rendererOrBrowserInjections, 0);
    assert.equal(instrumentation.countedInterval.syntheticOrDeveloperInputs, 0);
    assert.equal(instrumentation.countedInterval.postStartPhysicalInputCount, 0);
    assert.equal(matrix.runs.length, 1);
    assert.equal(matrix.runs[0].changedDimension, 'baseline-not-applicable');
    assert.equal(matrix.runs[0].deliveryMode, 'DirectPlay');
    assert.equal(run.actualDeliveryMode, 'DirectPlay');
    assert.equal(phase.productionModified, false);
    assert.equal(phase.ownershipBoundariesModified, false);
    assert.equal([
        'BLOCK-baseline-rebooted',
        'HOLD-baseline-stable-comparisons-incomplete',
        'HOLD-inconclusive'
    ].includes(phase.decision), true);
    validateCleanupAndStaticDelivery(root);

    if (approval.consumedByPrestartAttempt === true) {
        assert.equal(approval.relaunchAuthorized, true);
        const initialApprovalAt = parseTimestamp(approval.approvalReceivedAt, 'initial approval');
        const relaunchApprovalAt = parseTimestamp(
            approval.relaunchApprovalReceivedAt,
            'relaunch approval'
        );
        assert.equal(relaunchApprovalAt > initialApprovalAt, true);
    }

    if (run.result === 'stable') {
        assert.equal(existsSync(join(root, 'run-01-baseline', 'uptime-after.json')), true);
        assert.equal(run.observedDurationSeconds >= 900, true);
        assert.equal(run.platformRebootProven, false);
        assert.equal(phase.decision, 'HOLD-baseline-stable-comparisons-incomplete');
    } else if (run.result === INTERRUPTED_RESULT) {
        assert.equal(run.platformRebootProven, false);
        assert.equal(phase.decision, 'HOLD-inconclusive');
        validateInterruptedOutcome({
            approval,
            phase,
            instrumentation,
            matrix,
            run,
            root
        });
    } else {
        assert.equal(run.result, 'full-platform-reboot');
        assert.equal(existsSync(join(root, 'run-01-baseline', 'uptime-after.json')), true);
        const after = readJson(join(root, 'run-01-baseline', 'uptime-after.json'));
        assert.equal(after.platformRebootProven, true);
        assert.equal(after.recoveryProbes.length, 2);
        assert.equal(after.validationApplicationPresentAfterBoot, false);
        assert.equal(run.platformRebootProven, true);
        assert.equal(phase.decision, 'BLOCK-baseline-rebooted');
    }
}

export function validateNativeMediaIsolationEvidence(evidenceRoot, { allowPending = false } = {}) {
    const root = resolve(evidenceRoot);
    assert.equal(existsSync(root), true, 'Evidence root does not exist');
    assertFiles(root, allowPending ? PREFLIGHT_FILES : FINAL_FILES);
    validateBuild(root);
    validateMedia(root);
    validateWrapperComparison(root);
    validateNativeMediaIsolationPrivacy(root, !allowPending);

    if (allowPending) {
        const approval = readJson(join(root, 'run-01-baseline', 'approval.json'));
        const delivery = readJson(join(root, 'run-01-baseline', 'delivery-mode.json'));
        assert.equal(approval.status, 'pending');
        assert.equal(approval.launchAuthorized, false);
        assert.equal(delivery.actualRunDecision.selectedDeliveryCategory, 'pending');
        assert.equal(delivery.countableAsCleanIsolation, false);
    } else {
        validateNativeMediaIsolationKnownPrivateValueScan(root);
        validateNativeMediaIsolationFinalOutcome(root);
        validateInventory(root);
    }

    return {
        status: 'PASS',
        schemaVersion: 'ptv-webos-native-media-isolation-validation-v1',
        mode: allowPending ? 'preflight' : 'final',
        evidenceRoot: 'privacy-redacted',
        exactBuildIdentityMatched: true,
        wrapperComparisonValidated: true,
        baselineMediaCategoriesValidated: true,
        privacyValidated: true,
        finalOutcomeValidated: !allowPending
    };
}

function main(argv) {
    const allowPending = argv[0] === '--allow-pending';
    const path = allowPending ? argv[1] : argv[0];
    assert.equal(typeof path, 'string', 'Usage: validate-native-media-isolation-evidence.mjs [--allow-pending] <evidence-root>');
    assert.equal(argv.length, allowPending ? 2 : 1, 'Unexpected validation arguments');
    process.stdout.write(`${JSON.stringify(validateNativeMediaIsolationEvidence(path, { allowPending }), null, 2)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
    main(process.argv.slice(2));
}
