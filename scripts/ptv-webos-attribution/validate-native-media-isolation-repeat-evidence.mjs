import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
    validateNativeMediaIsolationKnownPrivateValueScan,
    validateNativeMediaIsolationPrivacy
} from './validate-native-media-isolation-evidence.mjs';

const RUN_DIRECTORY = 'run-02-same-baseline-repeat';
const PRIOR_EVIDENCE_DIRECTORY = 'webos-native-media-isolation-20260728-070944Z';
const PRIOR_ARTIFACT_INVENTORY_SHA256 = 'a1f0c85102e9792c671b310feb4435a2b2c4a024f9ef2ad95ef328352d069a8a';
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
    }),
    staticServerScriptSha256: '8b8d4c66f9bd18a0bb033eda2ac424ae95633563fb221846a16cd8a293e6cb81'
});
const EXPECTED_PRIOR_HASHES = Object.freeze({
    buildIdentitySha256: '56427582a4b8c1c0a5d362aaed2e37193a1c659c5f7ac31998d4a066f1d2e7d9',
    mediaCategorySha256: '6b95b3f38c29e1f983d0f5af8a65ce43d71d86f9f7ccf553f4eefae130257537',
    deliveryModeSha256: '6e955981b188ed1a7febb0656a87c0d0e524669a168667d43fee895648536fe5'
});
const REQUIRED_FILES = Object.freeze([
    'README.md',
    'artifact-inventory.json',
    'comparison-matrix.json',
    'comparison-to-prior.json',
    'final-report.md',
    'known-private-value-scan.json',
    'phase-summary.json',
    'privacy-scan.json',
    `${RUN_DIRECTORY}/approval.json`,
    `${RUN_DIRECTORY}/build-identity.json`,
    `${RUN_DIRECTORY}/cleanup.json`,
    `${RUN_DIRECTORY}/delivery-mode.json`,
    `${RUN_DIRECTORY}/device-state-before.json`,
    `${RUN_DIRECTORY}/instrumentation-absence.json`,
    `${RUN_DIRECTORY}/launch-summary.json`,
    `${RUN_DIRECTORY}/media-category.json`,
    `${RUN_DIRECTORY}/operator-markers.ndjson`,
    `${RUN_DIRECTORY}/run-summary.json`,
    `${RUN_DIRECTORY}/static-delivery-summary.json`,
    `${RUN_DIRECTORY}/uptime-after.json`,
    `${RUN_DIRECTORY}/uptime-before.json`
]);
const EARLY_STABLE_SECONDS = 867.64;
const STABLE_DURATION_SECONDS = 971;
const TIME_TOLERANCE_SECONDS = 0.01;
const UPTIME_WALL_DELTA_TOLERANCE_SECONDS = 1;
const CROSS_RUN_CLASSIFICATION = 'repeat-stable-prior-pause-not-reproduced';
const FINAL_DECISION = 'HOLD-baseline-stable-comparisons-incomplete';
const NEXT_PHASE = 'Phase 3A.1R.2b - C1 Forced Video-Transcode Single-Dimension Comparison.';

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function readNdjson(path) {
    return readFileSync(path, 'utf8')
        .split(/\r?\n/u)
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line));
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

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
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

function assertApproximatelyEqual(actual, expected, tolerance = TIME_TOLERANCE_SECONDS) {
    assert.equal(Math.abs(actual - expected) <= tolerance, true);
}

function validateBuild(root) {
    const build = readJson(join(root, RUN_DIRECTORY, 'build-identity.json'));
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
    assert.equal(build.staticServerScriptSha256, EXPECTED_BUILD.staticServerScriptSha256);
}

function validateMedia(root) {
    const media = readJson(join(root, RUN_DIRECTORY, 'media-category.json'));
    assert.equal(media.sourceIdentityRetained, false);
    assert.equal(media.sourceKind, 'same-existing-library-item-as-prior-run');
    assert.equal(media.container, 'mp4');
    assert.equal(media.videoCodec, 'h264-avc');
    assert.equal(media.videoProfile, 'high');
    assert.equal(media.videoLevel, '4.1');
    assert.equal(media.audioCodec, 'aac-lc');
    assert.equal(media.resolution.width, 1904);
    assert.equal(media.resolution.height, 1072);
    assert.equal(media.resolution.class, '1080p-or-lower');
    assert.equal(media.frameRate.average, 23.976);
    assert.equal(media.frameRate.real, 23.976);
    assert.equal(media.frameRate.class, 'conventional');
    assert.equal(media.frameRate.constantOrConventional, true);
    assert.equal(media.bitDepth, 8);
    assert.equal(media.chromaFormat, 'yuv420p');
    assert.equal(media.dynamicRange, 'sdr');
    assert.equal(media.subtitleState, 'none');
    assert.equal(media.audioStreamCount, 1);
    assert.equal(media.channelLayout, 'stereo');
    assert.equal(media.sampleRateHz, 48000);
    assert.equal(media.bitrateClass, 'moderate');
    assert.equal(media.durationClass, '15-minutes-or-longer');
    assert.equal(media.multipleVideoVersions, false);
    assert.equal(media.sameSourceAsPriorRun, true);
    assert.equal(media.meetsBaselineRequirements, true);
}

function validateCleanupAndStaticDelivery(cleanup, staticDelivery) {
    assert.equal(cleanup.validationApplicationClosedByCommand, true);
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

    assert.equal(staticDelivery.serverActiveDuringPreflight, true);
    assert.equal(staticDelivery.serverActiveDuringCountedInterval, true);
    assert.equal(staticDelivery.serverActiveAfterCleanup, false);
    assert.equal(staticDelivery.serverCount, 1);
    assert.equal(staticDelivery.servedIndexSha256, EXPECTED_BUILD.artifacts['index.html']);
    assert.equal(staticDelivery.expectedIndexSha256, EXPECTED_BUILD.artifacts['index.html']);
    assert.equal(staticDelivery.exactIndexMatched, true);
    assert.equal(staticDelivery.rendererInjectionDetected, false);
    assert.equal(staticDelivery.requestCountingAvailable, false);
    assert.equal(staticDelivery.requestCountsRetained, false);
    assert.equal(staticDelivery.rawRequestDataRetained, false);
    assert.equal(staticDelivery.listenerRemoved, true);
}

function validateInstrumentation(instrumentation) {
    assert.equal(instrumentation.preflight.forbiddenHelperTotal, 0);
    assert.equal(instrumentation.preflight.staticServerCount, 1);
    assert.equal(
        Object.entries(instrumentation.preflight)
            .filter(([name]) => !['forbiddenHelperTotal', 'staticServerCount'].includes(name))
            .every(([, count]) => count === 0),
        true
    );
    assert.equal(instrumentation.countedInterval.status, 'ended-zero-input');
    assert.equal(instrumentation.countedInterval.periodicProcessResourcePolling, 0);
    assert.equal(instrumentation.countedInterval.appPresenceQueries, 0);
    assert.equal(instrumentation.countedInterval.networkProbes, 0);
    assert.equal(instrumentation.countedInterval.cdpOrInspectorAttachments, 0);
    assert.equal(instrumentation.countedInterval.rendererOrBrowserInjections, 0);
    assert.equal(instrumentation.countedInterval.syntheticOrDeveloperInputs, 0);
    assert.equal(instrumentation.countedInterval.postStartPhysicalInputCount, 0);
}

function validatePriorAndIsolation(comparison, matrix, phase, run) {
    assert.equal(comparison.priorEvidenceArtifactInventorySha256, PRIOR_ARTIFACT_INVENTORY_SHA256);
    assert.deepEqual(comparison.priorEvidenceHashes, EXPECTED_PRIOR_HASHES);
    assert.deepEqual(comparison.priorRun, {
        result: 'interrupted-unsolicited-pause',
        observedDurationSeconds: 174.56,
        deliveryMode: 'DirectPlay',
        postStartInputCount: 0,
        platformRebootProven: false
    });
    assert.equal(comparison.repeatConfiguration.exactBuildIdentitySame, true);
    assert.equal(comparison.repeatConfiguration.validationWrapperIdentitySame, true);
    assert.equal(comparison.repeatConfiguration.televisionAndFirmwareSame, true);
    assert.equal(comparison.repeatConfiguration.mediaSourceSame, true);
    assert.equal(comparison.repeatConfiguration.mediaTechnicalCategoriesSame, true);
    assert.equal(comparison.repeatConfiguration.userPlaybackSettingsChangedByPhase, false);
    assert.equal(
        comparison.repeatConfiguration.userPlaybackSettingsSameAsPriorIndependentlyProven,
        false
    );
    assert.equal(comparison.repeatConfiguration.subtitlesDisabled, true);
    assert.equal(comparison.repeatConfiguration.deliveryTargetSame, true);
    assert.equal(comparison.repeatConfiguration.instrumentationPolicySame, true);
    assert.equal(comparison.repeatConfiguration.postStartInputPolicySame, true);
    assert.equal(comparison.repeatConfiguration.playbackStartMethodSame, true);
    assert.equal(
        comparison.repeatConfiguration.intendedChangedDimension,
        'repeat-trial-index-only'
    );
    assert.deepEqual(comparison.repeatConfiguration.changedDimensions, []);
    assert.equal(comparison.repeatConfiguration.oneDimensionIsolationProven, false);
    assert.deepEqual(
        comparison.repeatConfiguration.uncontrolledOrUnprovenDifferences,
        ['prior-playback-start-position', 'user-playback-settings-parity']
    );
    assert.equal(comparison.repeatConfiguration.rawMediaIdentityRetained, false);
    assert.deepEqual(comparison.currentRun, {
        result: 'stable',
        observedDurationSeconds: STABLE_DURATION_SECONDS,
        deliveryMode: 'DirectPlay',
        deliveryCandidateCount: 1,
        postStartInputCount: 0,
        platformRebootProven: false,
        stableDurationProven: true,
        playbackStartAtZeroOperatorReported: true,
        playbackStartAtZeroIndependentlyProven: false
    });
    assert.equal(comparison.crossRunClassification, CROSS_RUN_CLASSIFICATION);
    assert.equal(comparison.interpretationRule, 'repeatability-correlation-only-not-root-causation');

    assert.equal(matrix.runs.length, 2);
    const [priorMatrixRun, currentMatrixRun] = matrix.runs;
    assert.equal(priorMatrixRun.run, 'prior-run-01-baseline-reference');
    assert.equal(priorMatrixRun.evidenceFrozen, true);
    assert.equal(priorMatrixRun.exactBuildMatch, true);
    assert.equal(priorMatrixRun.mediaCategory, 'low-complexity-h264-aac-mp4-sdr');
    assert.equal(
        priorMatrixRun.instrumentation,
        'zero-renderer-injection-zero-periodic-polling'
    );
    assert.deepEqual(priorMatrixRun.countedIntervalQueries, {
        processOrResource: 0,
        appPresence: 0,
        network: 0,
        inspectorOrCdp: 0
    });
    assert.equal(priorMatrixRun.result, comparison.priorRun.result);
    assert.equal(priorMatrixRun.durationSeconds, comparison.priorRun.observedDurationSeconds);
    assert.equal(priorMatrixRun.deliveryMode, comparison.priorRun.deliveryMode);
    assert.equal(priorMatrixRun.postStartInputCount, comparison.priorRun.postStartInputCount);
    assert.equal(priorMatrixRun.stableDurationProven, false);
    assert.equal(priorMatrixRun.platformRebootProven, false);
    assert.equal(currentMatrixRun.run, RUN_DIRECTORY);
    assert.equal(currentMatrixRun.exactBuildMatch, true);
    assert.equal(currentMatrixRun.mediaCategory, 'low-complexity-h264-aac-mp4-sdr');
    assert.equal(
        currentMatrixRun.instrumentation,
        'zero-renderer-injection-zero-periodic-polling'
    );
    assert.deepEqual(currentMatrixRun.countedIntervalQueries, {
        processOrResource: 0,
        appPresence: 0,
        network: 0,
        inspectorOrCdp: 0
    });
    assert.equal(currentMatrixRun.result, run.result);
    assert.equal(currentMatrixRun.durationSeconds, run.observedDurationSeconds);
    assert.equal(currentMatrixRun.deliveryMode, run.actualDeliveryMode);
    assert.equal(currentMatrixRun.intendedChangedDimension, 'repeat-trial-index-only');
    assert.deepEqual(currentMatrixRun.changedDimensions, []);
    assert.equal(currentMatrixRun.oneDimensionIsolationProven, false);
    assert.equal(currentMatrixRun.postStartInputCount, 0);
    assert.equal(currentMatrixRun.stableDurationProven, true);
    assert.equal(currentMatrixRun.platformRebootProven, false);
    assert.equal(currentMatrixRun.crossRunClassification, CROSS_RUN_CLASSIFICATION);

    assert.equal(phase.run2.intendedChangedDimension, 'repeat-trial-index-only');
    assert.deepEqual(phase.run2.changedDimensions, []);
    assert.equal(phase.run2.oneDimensionIsolationProven, false);
}

function validateMarkers(markers) {
    assert.equal(markers.length, 4);
    assert.deepEqual(markers.map(marker => marker.sequence), [1, 2, 3, 4]);
    assert.deepEqual(markers.map(marker => marker.category), [
        'playback-start-confirmed',
        'early-stable-report',
        'stable-duration-confirmed',
        'post-run-application-closed'
    ]);
    assert.equal(markers.some(marker => marker.category === 'unsolicited-playback-pause'), false);
    const [start, early, terminal, closed] = markers;

    assert.equal(start.countedInterval, true);
    assert.equal(start.state, 'playing');
    assert.equal(start.inputMethod, 'physical-lg-remote');
    assert.equal(start.startPosition, 'operator-reported-from-beginning');
    assert.equal(start.startPositionIndependentlyProven, false);
    assert.equal(start.postStartPhysicalInputCount, 0);
    assert.equal(early.countedInterval, true);
    assert.equal(early.state, 'playing');
    assert.equal(early.observedDurationSeconds, EARLY_STABLE_SECONDS);
    assert.equal(early.postStartPhysicalInputCount, 0);
    assert.equal(early.intervalStopped, false);
    assert.equal(terminal.countedInterval, true);
    assert.equal(terminal.state, 'playing');
    assert.equal(terminal.observedDurationSeconds, STABLE_DURATION_SECONDS);
    assert.equal(terminal.postStartPhysicalInputCount, 0);
    assert.equal(terminal.intervalStopped, true);
    assert.equal(closed.countedInterval, false);
    assert.equal(closed.state, 'cleanup-command-succeeded');

    const startAt = parseTimestamp(start.observedAt, 'playback-start marker');
    const earlyAt = parseTimestamp(early.observedAt, 'early-stable marker');
    const terminalAt = parseTimestamp(terminal.observedAt, 'terminal-stable marker');
    const closedAt = parseTimestamp(closed.observedAt, 'post-run-close marker');
    assert.equal(startAt < earlyAt && earlyAt < terminalAt && terminalAt < closedAt, true);
    assertApproximatelyEqual((earlyAt - startAt) / 1000, EARLY_STABLE_SECONDS);
    assertApproximatelyEqual((terminalAt - startAt) / 1000, STABLE_DURATION_SECONDS);

    return { closedAt, startAt, terminalAt };
}

export function validateNativeMediaIsolationRepeatOutcome(root) {
    const approval = readJson(join(root, RUN_DIRECTORY, 'approval.json'));
    const cleanup = readJson(join(root, RUN_DIRECTORY, 'cleanup.json'));
    const comparison = readJson(join(root, 'comparison-to-prior.json'));
    const delivery = readJson(join(root, RUN_DIRECTORY, 'delivery-mode.json'));
    const device = readJson(join(root, RUN_DIRECTORY, 'device-state-before.json'));
    const instrumentation = readJson(join(root, RUN_DIRECTORY, 'instrumentation-absence.json'));
    const launch = readJson(join(root, RUN_DIRECTORY, 'launch-summary.json'));
    const markers = readNdjson(join(root, RUN_DIRECTORY, 'operator-markers.ndjson'));
    const matrix = readJson(join(root, 'comparison-matrix.json'));
    const phase = readJson(join(root, 'phase-summary.json'));
    const run = readJson(join(root, RUN_DIRECTORY, 'run-summary.json'));
    const staticDelivery = readJson(join(root, RUN_DIRECTORY, 'static-delivery-summary.json'));
    const uptimeBefore = readJson(join(root, RUN_DIRECTORY, 'uptime-before.json'));
    const uptimeAfter = readJson(join(root, RUN_DIRECTORY, 'uptime-after.json'));

    assert.equal(approval.status, 'explicit');
    assert.equal(approval.destructiveRiskAcknowledged, true);
    assert.equal(approval.launchAuthorized, true);
    assert.equal(approval.countedPlaybackStarted, true);

    assert.equal(delivery.preRunEligibility.sameSourceAsPriorDirectPlayRun, true);
    assert.equal(delivery.preRunEligibility.sourceAdvertisesDirectPlay, true);
    assert.equal(delivery.preRunEligibility.technicalProfileCompatible, true);
    assert.equal(delivery.preRunEligibility.selectedDeliveryCategory, 'DirectPlay');
    assert.equal(delivery.actualRunDecision.selectedDeliveryCategory, 'DirectPlay');
    assert.equal(delivery.actualRunDecision.videoTranscode, false);
    assert.equal(delivery.actualRunDecision.audioTranscode, false);
    assert.equal(delivery.actualRunDecision.containerRemux, false);
    assert.equal(delivery.actualRunDecision.subtitleBurnIn, false);
    assert.equal(delivery.actualRunDecision.candidateCount, 1);
    assert.equal(delivery.actualRunDecision.rawRecordRetained, false);
    assert.equal(delivery.actualRunDecision.postRunServerReadQueries, 2);
    assert.equal(delivery.countableAsCleanRepeat, true);

    validateInstrumentation(instrumentation);
    validateCleanupAndStaticDelivery(cleanup, staticDelivery);
    validatePriorAndIsolation(comparison, matrix, phase, run);
    const { closedAt, startAt, terminalAt } = validateMarkers(markers);

    assert.equal(run.result, 'stable');
    assert.equal(run.decision, FINAL_DECISION);
    assert.equal(run.crossRunClassification, CROSS_RUN_CLASSIFICATION);
    assert.equal(run.countedInterval.startedAt, markers[0].observedAt);
    assert.equal(run.countedInterval.endedAt, markers[2].observedAt);
    assert.equal(run.countedInterval.observedDurationSeconds, STABLE_DURATION_SECONDS);
    assert.equal(run.countedInterval.postStartPhysicalInputCount, 0);
    assert.equal(run.observedDurationSeconds, STABLE_DURATION_SECONDS);
    assert.equal(run.actualDeliveryMode, 'DirectPlay');
    assert.equal(run.physicalPlaybackStart, true);
    assert.equal(run.playbackStartAtZeroOperatorReported, true);
    assert.equal(run.playbackStartAtZeroIndependentlyProven, false);
    assert.equal(run.stableDurationProven, true);
    assert.equal(run.platformRebootProven, false);
    assert.equal(run.preRunUptimeIncreasedAfterRun, true);
    assert.equal(run.productionModified, false);
    assert.equal(run.ownershipBoundariesModified, false);
    assert.equal(run.rawMediaOrSessionIdentityRetained, false);

    assert.equal(instrumentation.countedInterval.startedAt, run.countedInterval.startedAt);
    assert.equal(instrumentation.countedInterval.endedAt, run.countedInterval.endedAt);
    assert.equal(
        instrumentation.countedInterval.observedDurationSeconds,
        run.observedDurationSeconds
    );
    assert.equal(
        instrumentation.countedInterval.postStartPhysicalInputCount,
        run.countedInterval.postStartPhysicalInputCount
    );

    assert.equal(launch.launchCount, 1);
    assert.equal(launch.launchSucceeded, true);
    assert.equal(launch.rawLaunchOutputRetained, false);
    assert.equal(launch.postLaunchDeviceQueries, 0);
    assert.equal(launch.result, 'counted-playback-stable-duration-complete');
    assert.equal(launch.countedRunStarted, true);
    assert.equal(launch.playbackStartedAt, run.countedInterval.startedAt);
    assert.equal(launch.countedIntervalEndedAt, run.countedInterval.endedAt);
    assert.equal(launch.observedDurationSeconds, run.observedDurationSeconds);

    assert.equal(device.deviceClass, 'physical-lg-television');
    assert.equal(device.model, 'LG-70UN7070PUA');
    assert.equal(device.webosVersion, '5.6.2');
    assert.equal(device.firmwareVersion, '04.64.00');
    assert.equal(device.boardClass, 'K6LP_ATSC_US');
    assert.equal(device.sameDeviceCategoriesAsPriorRun, true);
    assert.equal(device.validationApplicationRunning, false);
    assert.equal(device.rawProcessSnapshotRetained, false);
    assert.equal(device.networkAddressRetained, false);

    assert.equal(phase.phase, 'PiggieTV WebOS Phase 3A.1R.2a');
    assert.equal(phase.currentStatus, 'complete-hold-baseline-stable-comparisons-incomplete');
    assert.equal(phase.run2.directory, RUN_DIRECTORY);
    assert.equal(phase.run2.status, 'stable');
    assert.equal(phase.run2.result, run.result);
    assert.equal(phase.run2.explicitApproval, true);
    assert.equal(phase.run2.exactBuildMatched, true);
    assert.equal(phase.run2.sameBaselineTechnicalCategories, true);
    assert.equal(phase.run2.plannedDeliveryMode, 'DirectPlay');
    assert.equal(phase.run2.actualDeliveryMode, run.actualDeliveryMode);
    assert.equal(phase.run2.periodicPollingPlanned, false);
    assert.equal(phase.run2.postStartInputPlanned, 0);
    assert.equal(phase.run2.postStartInputCount, run.countedInterval.postStartPhysicalInputCount);
    assert.equal(phase.run2.observedDurationSeconds, run.observedDurationSeconds);
    assert.equal(phase.run2.stableDurationProven, true);
    assert.equal(phase.run2.platformRebootProven, false);
    assert.equal(phase.run2.crossRunClassification, CROSS_RUN_CLASSIFICATION);
    assert.equal(phase.officialWebosComparisonIncluded, false);
    assert.equal(phase.decision, FINAL_DECISION);
    assert.deepEqual(phase.nextPhase, {
        id: 'Phase 3A.1R.2b',
        title: 'C1 Forced Video-Transcode Single-Dimension Comparison',
        separateApprovalRequired: true,
        automaticLaunch: false
    });
    assert.equal(phase.productionModified, false);
    assert.equal(phase.ownershipBoundariesModified, false);

    assertFinitePositive(uptimeBefore.uptimeSeconds, 'uptime-before uptimeSeconds');
    assertFinitePositive(uptimeAfter.uptimeSeconds, 'uptime-after uptimeSeconds');
    assert.equal(uptimeBefore.uptimeSeconds, 24748.8);
    assert.equal(uptimeAfter.uptimeSeconds, 25970.21);
    assert.equal(uptimeBefore.sampleCount, 1);
    assert.equal(uptimeAfter.sampleCount, 1);
    assert.equal(uptimeAfter.increasedFromPreRun, true);
    assert.equal(uptimeAfter.platformRebootProven, false);
    assert.equal(uptimeAfter.uptimeSeconds > uptimeBefore.uptimeSeconds, true);
    const uptimeBeforeAt = parseTimestamp(uptimeBefore.observedAt, 'uptime-before observation');
    const uptimeAfterAt = parseTimestamp(uptimeAfter.observedAt, 'uptime-after observation');
    assert.equal(uptimeBeforeAt < startAt, true);
    assert.equal(uptimeAfterAt > terminalAt, true);
    const wallDeltaSeconds = (uptimeAfterAt - uptimeBeforeAt) / 1000;
    const uptimeDeltaSeconds = uptimeAfter.uptimeSeconds - uptimeBefore.uptimeSeconds;
    assertApproximatelyEqual(
        wallDeltaSeconds,
        uptimeDeltaSeconds,
        UPTIME_WALL_DELTA_TOLERANCE_SECONDS
    );

    const approvalAt = parseTimestamp(approval.approvalReceivedAt, 'approval');
    const launchRequestedAt = parseTimestamp(launch.requestedAt, 'launch request');
    const staticCleanupAt = parseTimestamp(staticDelivery.cleanupStoppedAt, 'static cleanup');
    const cleanupCompletedAt = parseTimestamp(cleanup.completedAt, 'cleanup completion');
    assert.equal(approvalAt < launchRequestedAt, true);
    assert.equal(terminalAt < uptimeAfterAt, true);
    assert.equal(uptimeAfterAt < closedAt, true);
    assert.equal(closedAt < staticCleanupAt, true);
    assert.equal(staticCleanupAt < cleanupCompletedAt, true);
}

function validateFinalReport(root) {
    const report = readFileSync(join(root, 'final-report.md'), 'utf8');
    const normalized = report.replace(/\s+/gu, ' ');
    assert.equal(normalized.includes('**Exactly one next phase:**'), true);
    assert.equal(normalized.includes(NEXT_PHASE), true);
    assert.equal(normalized.includes('Do not run it automatically.'), true);
    assert.equal((normalized.match(/Exactly one next phase/gu) || []).length, 1);
    assert.equal(
        (normalized.match(/C1 Forced Video-Transcode Single-Dimension Comparison/gu) || []).length,
        1
    );
}

export function validateNativeMediaIsolationRepeatInventory(root) {
    const inventory = readJson(join(root, 'artifact-inventory.json'));
    assert.equal(inventory.selfHashExcluded, true);
    const actualPaths = listFiles(root)
        .map(path => normalizeRelative(root, path))
        .filter(path => path !== 'artifact-inventory.json')
        .sort();
    const inventoryPaths = inventory.artifacts.map(artifact => artifact.file).sort();
    assert.deepEqual(inventoryPaths, actualPaths);

    for (const artifact of inventory.artifacts) {
        assert.equal(typeof artifact.file, 'string');
        assert.equal(isAbsolute(artifact.file), false);
        assert.equal(artifact.file.includes('\\'), false);
        assert.equal(artifact.file.split('/').includes('..'), false);
        const absolutePath = resolve(root, artifact.file);
        assert.equal(absolutePath.startsWith(`${root}${sep}`), true);
        assert.equal(statSync(absolutePath).size, artifact.sizeBytes);
        assert.equal(sha256(absolutePath), artifact.sha256);
        assert.equal(artifact.classification, 'share-safe');
    }
}

export function validateNativeMediaIsolationRepeatPriorEvidence(root) {
    const evidenceParent = resolve(root, '..');
    const priorRoot = resolve(evidenceParent, PRIOR_EVIDENCE_DIRECTORY);
    assert.equal(priorRoot.startsWith(`${evidenceParent}${sep}`), true);
    const expectedFiles = {
        'artifact-inventory.json': PRIOR_ARTIFACT_INVENTORY_SHA256,
        'run-01-baseline/build-identity.json': EXPECTED_PRIOR_HASHES.buildIdentitySha256,
        'run-01-baseline/media-category.json': EXPECTED_PRIOR_HASHES.mediaCategorySha256,
        'run-01-baseline/delivery-mode.json': EXPECTED_PRIOR_HASHES.deliveryModeSha256
    };

    for (const [relativePath, expectedHash] of Object.entries(expectedFiles)) {
        const path = join(priorRoot, ...relativePath.split('/'));
        assert.equal(existsSync(path), true, `Missing frozen prior evidence file: ${relativePath}`);
        assert.equal(sha256(path), expectedHash);
    }
}

export function validateNativeMediaIsolationRepeatEvidence(evidenceRoot) {
    const root = resolve(evidenceRoot);
    assert.equal(existsSync(root), true, 'Evidence root does not exist');
    for (const path of REQUIRED_FILES) {
        assert.equal(existsSync(join(root, path)), true, `Missing evidence file: ${path}`);
    }

    validateBuild(root);
    validateMedia(root);
    validateNativeMediaIsolationRepeatPriorEvidence(root);
    validateNativeMediaIsolationPrivacy(root, true);
    validateNativeMediaIsolationKnownPrivateValueScan(root);
    validateNativeMediaIsolationRepeatOutcome(root);
    validateFinalReport(root);
    validateNativeMediaIsolationRepeatInventory(root);

    return {
        status: 'PASS',
        schemaVersion: 'ptv-webos-native-media-isolation-repeat-validation-v1',
        mode: 'final',
        evidenceRoot: 'privacy-redacted',
        priorFrozenEvidenceValidated: true,
        exactBuildIdentityMatched: true,
        sameBaselineMediaCategoriesValidated: true,
        privacyValidated: true,
        repeatOutcomeValidated: true,
        artifactInventoryValidated: true
    };
}

function main(argv) {
    assert.equal(
        argv.length,
        1,
        'Usage: validate-native-media-isolation-repeat-evidence.mjs <evidence-root>'
    );
    process.stdout.write(
        `${JSON.stringify(validateNativeMediaIsolationRepeatEvidence(argv[0]), null, 2)}\n`
    );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
    main(process.argv.slice(2));
}
