import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    existsSync,
    readFileSync
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
    validateNativeMediaIsolationKnownPrivateValueScan,
    validateNativeMediaIsolationPrivacy
} from './validate-native-media-isolation-evidence.mjs';
import { validateNativeMediaIsolationRepeatInventory } from './validate-native-media-isolation-repeat-evidence.mjs';

const RUN_DIRECTORY = 'run-03-c1-forced-video-transcode';
const R2_DIRECTORY = 'webos-native-media-isolation-20260728-070944Z';
const R2A_DIRECTORY = 'webos-native-media-isolation-repeat-20260728-121430Z';
const CLASSIFICATION = 'directplay-stable-vs-video-transcode-correlation-only';
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
const FROZEN_REFERENCES = Object.freeze({
    r2: Object.freeze({
        artifactInventorySha256: 'a1f0c85102e9792c671b310feb4435a2b2c4a024f9ef2ad95ef328352d069a8a',
        buildIdentitySha256: '56427582a4b8c1c0a5d362aaed2e37193a1c659c5f7ac31998d4a066f1d2e7d9',
        mediaCategorySha256: '6b95b3f38c29e1f983d0f5af8a65ce43d71d86f9f7ccf553f4eefae130257537',
        deliveryModeSha256: '6e955981b188ed1a7febb0656a87c0d0e524669a168667d43fee895648536fe5'
    }),
    r2a: Object.freeze({
        artifactInventorySha256: '3ec2125897384a2c7f035c3bdd2bd1120d6f83abba17719b5972d747f5b76c60',
        buildIdentitySha256: 'f5de0589775c977992758da96a38d0198a410f8c1d78b479cb19dba3bb601cbe',
        mediaCategorySha256: 'badcb6e710c0b4aa30c10710061e6dd834134d82856708e7215fe32d054fcb22',
        deliveryModeSha256: '4b1a533b9f9137568fffaf9b59b515b747db5cae123b2ceeb7299a7fc48b39f6'
    })
});
const REQUIRED_FILES = Object.freeze([
    'README.md',
    'artifact-inventory.json',
    'comparison-matrix.json',
    'comparison-to-stable-baseline.json',
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
    `${RUN_DIRECTORY}/quality-setting-boundary.json`,
    `${RUN_DIRECTORY}/run-summary.json`,
    `${RUN_DIRECTORY}/static-delivery-summary.json`,
    `${RUN_DIRECTORY}/transcode-output-category.json`,
    `${RUN_DIRECTORY}/uptime-after.json`,
    `${RUN_DIRECTORY}/uptime-before.json`
]);
const TIME_TOLERANCE_SECONDS = 10;

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function readNdjson(path) {
    return readFileSync(path, 'utf8')
        .split(/\r?\n/u)
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line));
}

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function parseTimestamp(value, label) {
    assert.equal(typeof value, 'string', `${label} must be an ISO timestamp`);
    const parsed = Date.parse(value);
    assert.equal(Number.isFinite(parsed), true, `${label} must be an ISO timestamp`);
    return parsed;
}

function validateBuildAndMedia(root) {
    const build = readJson(join(root, RUN_DIRECTORY, 'build-identity.json'));
    const media = readJson(join(root, RUN_DIRECTORY, 'media-category.json'));
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

    assert.equal(media.sourceIdentityRetained, false);
    assert.equal(media.sameSourceAsStableBaseline, true);
    assert.equal(media.sourceVideoBitrateBps, undefined);
    assert.equal(media.sourceAggregateBitrateBps, undefined);
    assert.equal(media.durationSeconds, undefined);
    assert.equal(media.bitrateClass, 'moderate');
    assert.equal(media.durationClass, '15-minutes-or-longer');
    assert.equal(media.container, 'mp4');
    assert.equal(media.videoCodec, 'h264-avc');
    assert.equal(media.videoProfile, 'high');
    assert.equal(media.videoLevel, '4.1');
    assert.equal(media.audioCodec, 'aac-lc');
    assert.equal(media.resolution.width, 1904);
    assert.equal(media.resolution.height, 1072);
    assert.equal(media.frameRate.average, 23.976);
    assert.equal(media.frameRate.real, 23.976);
    assert.equal(media.frameRate.constantOrConventional, true);
    assert.equal(media.bitDepth, 8);
    assert.equal(media.chromaFormat, 'yuv420p');
    assert.equal(media.dynamicRange, 'sdr');
    assert.equal(media.subtitleState, 'none');
    assert.equal(media.audioStreamCount, 1);
    assert.equal(media.channelLayout, 'stereo');
    assert.equal(media.sampleRateHz, 48000);
    assert.equal(media.multipleVideoVersions, false);
    assert.equal(media.meetsBaselineRequirements, true);
    assert.equal(media.temporaryCapBps, 720000);
    assert.equal(media.temporaryCapBelowSourceBitrate, true);
}

export function validateNativeMediaIsolationC1FrozenLineage(root) {
    const parent = resolve(root, '..');
    const references = [
        {
            directory: R2_DIRECTORY,
            run: 'run-01-baseline',
            hashes: FROZEN_REFERENCES.r2
        },
        {
            directory: R2A_DIRECTORY,
            run: 'run-02-same-baseline-repeat',
            hashes: FROZEN_REFERENCES.r2a
        }
    ];

    for (const reference of references) {
        const frozenRoot = resolve(parent, reference.directory);
        assert.equal(frozenRoot.startsWith(`${parent}${sep}`), true);
        const expectedFiles = {
            'artifact-inventory.json': reference.hashes.artifactInventorySha256,
            [`${reference.run}/build-identity.json`]: reference.hashes.buildIdentitySha256,
            [`${reference.run}/media-category.json`]: reference.hashes.mediaCategorySha256,
            [`${reference.run}/delivery-mode.json`]: reference.hashes.deliveryModeSha256
        };
        for (const [relativePath, expectedHash] of Object.entries(expectedFiles)) {
            const path = join(frozenRoot, ...relativePath.split('/'));
            assert.equal(existsSync(path), true, `Missing frozen evidence file: ${relativePath}`);
            assert.equal(sha256(path), expectedHash);
        }
    }
}

function validateQualityBoundary(boundary) {
    assert.equal(boundary.settingScope.network, 'in-network');
    assert.equal(boundary.settingScope.mediaType, 'Video');
    assert.equal(boundary.settingScope.storage, 'validation-app-local-persistent-setting');
    assert.equal(boundary.original.value, 'Auto');
    assert.equal(boundary.original.automaticBitrateDetection, true);
    assert.equal(boundary.original.verification, 'physical-ui-operator-confirmed');
    assert.equal(boundary.original.observedBeforeChange, true);
    assert.equal(boundary.original.observationTimestampRetained, false);
    assert.equal(boundary.original.observedAt, undefined);
    assert.equal(boundary.original.confirmationReportedAfterTemporaryApplication, true);
    assert.equal(boundary.temporary.value, '720 kbps');
    assert.equal(boundary.temporary.bitrateBps, 720000);
    assert.equal(boundary.temporary.applicationMethod, 'existing-physical-webos-ui');
    assert.equal(boundary.temporary.physicallyVerified, true);
    assert.equal(boundary.restoration.required, true);
    assert.equal(boundary.restoration.targetValue, 'Auto');
    assert.equal(boundary.restoration.restoredAtBasis, 'physical-ui-confirmation-boundary');
    assert.equal(boundary.restoration.applicationMethod, 'existing-physical-webos-ui');
    assert.equal(boundary.restoration.physicallyVerified, true);
    assert.equal(boundary.restoration.automaticBitrateDetection, true);
    assert.equal(boundary.restoration.exactOriginalValueRestored, true);
    assert.equal(boundary.restorationDeliveryVerification.selectedDeliveryCategory, 'DirectPlay');
    assert.equal(boundary.restorationDeliveryVerification.videoTranscode, false);
    assert.equal(boundary.restorationDeliveryVerification.audioTranscode, false);
    assert.equal(boundary.restorationDeliveryVerification.subtitleBurnIn, false);
    assert.equal(boundary.restorationDeliveryVerification.candidateCount, 1);
    assert.equal(boundary.restorationDeliveryVerification.postRestorationServerReadQueries, 1);
    assert.equal(
        boundary.restorationDeliveryVerification.physicalUiAutoAndDirectConfirmedAt,
        boundary.restoration.restoredAt
    );
    assert.equal(boundary.restorationDeliveryVerification.rawRecordRetained, false);
    assert.equal(boundary.intendedChangedDimension, 'delivery-request-policy');
    assert.deepEqual(boundary.operatorControlledChanges, ['temporary-ui-quality-cap']);
    assert.equal(boundary.productSourceModified, false);
    assert.equal(boundary.serverConfigurationModified, false);
    assert.equal(boundary.persistentChangeRemaining, false);
}

function validateDelivery(delivery, output) {
    assert.equal(delivery.preRunBaselineDeliveryCategory, 'DirectPlay');
    assert.equal(delivery.requestedDeliveryCategory, 'Transcode');
    assert.equal(delivery.setupVerification.selectedDeliveryCategory, 'Transcode');
    assert.equal(delivery.setupVerification.videoTranscode, true);
    assert.equal(delivery.setupVerification.audioTranscode, false);
    assert.equal(delivery.setupVerification.subtitleBurnIn, false);
    assert.equal(delivery.setupVerification.candidateCount, 1);
    assert.equal(delivery.setupVerification.excludedFromCountedCandidateCount, true);
    assert.equal(delivery.setupVerification.rawRecordRetained, false);
    assert.equal(delivery.actualRunDecision.selectedDeliveryCategory, 'Transcode');
    assert.equal(delivery.actualRunDecision.videoTranscode, true);
    assert.equal(delivery.actualRunDecision.audioTranscode, false);
    assert.equal(delivery.actualRunDecision.subtitleBurnIn, false);
    assert.equal(delivery.actualRunDecision.candidateCount, 1);
    assert.equal(delivery.actualRunDecision.rawRecordRetained, false);
    assert.equal(delivery.actualRunDecision.postRunServerReadQueries, 1);
    assert.equal(delivery.actualRunDecision.outputBitrateBps, undefined);
    assert.equal(delivery.actualRunDecision.outputBitrateClass, 'under-1-mbps');
    assert.equal(delivery.countedIntervalServerQueries, 0);
    assert.equal(delivery.setupDeliveryCandidatesExcluded, true);
    assert.equal(delivery.countableAsCleanC1, true);

    assert.equal(output.deliveryCategory, 'Transcode');
    assert.equal(output.videoTranscode, true);
    assert.equal(output.audioTranscode, false);
    assert.equal(output.subtitleBurnIn, false);
    assert.equal(output.candidateCount, 1);
    assert.equal(output.rawRecordRetained, false);
    assert.equal(output.setupDeliveryCandidatesExcluded, true);
    assert.equal(output.source.aggregateBitrateBps, undefined);
    assert.equal(output.source.bitrateClass, 'moderate');
    assert.equal(output.output.aggregateBitrateBps, undefined);
    assert.equal(output.output.bitrateClass, 'under-1-mbps');
    assert.deepEqual(output.dependentOutputChanges, [
        'video-resolution',
        'aggregate-bitrate',
        'delivery-container-and-segmentation'
    ]);
    assert.equal(output.strictSingleEncodedOutputDimensionProven, false);
    assert.equal(output.encodedOutputDimensionsIndependentlyNormalized, false);
}

function validateInstrumentation(instrumentation) {
    assert.equal(instrumentation.preflight.forbiddenHelperTotal, 0);
    assert.equal(instrumentation.preflight.staticServerCount, 0);
    assert.equal(
        Object.entries(instrumentation.preflight)
            .filter(([name]) => !['forbiddenHelperTotal', 'staticServerCount'].includes(name))
            .every(([, count]) => count === 0),
        true
    );
    assert.equal(instrumentation.countedInterval.periodicProcessResourcePolling, 0);
    assert.equal(instrumentation.countedInterval.appPresenceQueries, 0);
    assert.equal(instrumentation.countedInterval.networkProbes, 0);
    assert.equal(instrumentation.countedInterval.serverQueries, 0);
    assert.equal(instrumentation.countedInterval.cdpOrInspectorAttachments, 0);
    assert.equal(instrumentation.countedInterval.rendererOrBrowserInjections, 0);
    assert.equal(instrumentation.countedInterval.syntheticOrDeveloperInputs, 0);
    assert.equal(instrumentation.countedInterval.postStartPhysicalInputCount, 0);
}

function validateComparison(comparison, matrix, run) {
    assert.equal(comparison.stableBaselineReference.phase, 'PiggieTV WebOS Phase 3A.1R.2a');
    assert.equal(comparison.stableBaselineReference.run, 'run-02-same-baseline-repeat');
    assert.equal(
        comparison.stableBaselineReference.artifactInventorySha256,
        FROZEN_REFERENCES.r2a.artifactInventorySha256
    );
    assert.equal(
        comparison.stableBaselineReference.buildIdentitySha256,
        FROZEN_REFERENCES.r2a.buildIdentitySha256
    );
    assert.equal(
        comparison.stableBaselineReference.mediaCategorySha256,
        FROZEN_REFERENCES.r2a.mediaCategorySha256
    );
    assert.equal(
        comparison.stableBaselineReference.deliveryModeSha256,
        FROZEN_REFERENCES.r2a.deliveryModeSha256
    );
    assert.equal(
        comparison.stableBaselineReference.runSummarySha256,
        '7ea2f7d3b6aaff3fa521623d9ceffc00d8a6783ce84fbd58f53cf0bad9ad4800'
    );
    assert.equal(comparison.stableBaselineReference.result, 'stable');
    assert.equal(comparison.stableBaselineReference.observedDurationSeconds, 971);
    assert.equal(comparison.stableBaselineReference.deliveryMode, 'DirectPlay');
    assert.equal(comparison.plannedComparison.sameBuild, true);
    assert.equal(comparison.plannedComparison.sameWrapper, true);
    assert.equal(comparison.plannedComparison.samePhysicalDevice, true);
    assert.equal(comparison.plannedComparison.sameFirmware, true);
    assert.equal(comparison.plannedComparison.sameSourceVerifiedInMemory, true);
    assert.equal(comparison.plannedComparison.sameSourceIdentityRetained, false);
    assert.equal(comparison.plannedComparison.sameSubtitleState, true);
    assert.equal(comparison.plannedComparison.intendedChangedDimension, 'delivery-request-policy');
    assert.equal(comparison.plannedComparison.deliveryTransition, 'DirectPlay-to-video-Transcode');
    assert.deepEqual(
        comparison.plannedComparison.operatorControlledChanges,
        ['temporary-ui-quality-cap']
    );
    assert.deepEqual(comparison.plannedComparison.dependentOutputChanges, [
        'video-resolution',
        'aggregate-bitrate',
        'delivery-container-and-segmentation'
    ]);
    assert.equal(comparison.plannedComparison.strictSingleIndependentVariableProven, false);
    assert.equal(comparison.plannedComparison.strictSingleEncodedOutputDimensionProven, false);
    assert.equal(comparison.plannedComparison.classification, CLASSIFICATION);

    assert.equal(matrix.runs.length, 2);
    const [stable, c1] = matrix.runs;
    assert.equal(stable.run, 'stable-baseline-reference');
    assert.equal(stable.evidenceFrozen, true);
    assert.equal(stable.result, 'stable');
    assert.equal(stable.durationSeconds, 971);
    assert.equal(stable.deliveryMode, 'DirectPlay');
    assert.equal(c1.run, RUN_DIRECTORY);
    assert.equal(c1.result, run.result);
    assert.equal(c1.deliveryMode, 'Transcode');
    assert.equal(c1.videoTranscode, true);
    assert.equal(c1.audioTranscode, false);
    assert.equal(c1.subtitleBurnIn, false);
    assert.equal(c1.candidateCount, 1);
    assert.equal(c1.intendedChangedDimension, 'delivery-request-policy');
    assert.deepEqual(c1.operatorControlledChanges, ['temporary-ui-quality-cap']);
    assert.equal(c1.strictSingleIndependentVariableProven, false);
    assert.equal(c1.strictSingleEncodedOutputDimensionProven, false);
    assert.equal(c1.postStartInputCount, 0);
    assert.equal(c1.classification, CLASSIFICATION);
    assert.equal(c1.durationSeconds, 909);
}

function validateCleanup(cleanup, staticDelivery) {
    assert.equal(cleanup.validationApplicationClosedByCommand, true);
    assert.equal(cleanup.validationApplicationPresentAfterCleanup, false);
    assert.equal(cleanup.staticServerOwnershipVerified, true);
    assert.equal(cleanup.staticServerProcessPresent, false);
    assert.equal(cleanup.staticListenerCount, 0);
    assert.equal(cleanup.staticServerProcessIdentifierRetained, false);
    assert.equal(cleanup.relevantNodeHelperCount, 0);
    assert.equal(cleanup.temporaryRuntimeDirectoryCreated, false);
    assert.equal(cleanup.temporaryRuntimeDirectoryRemovalRequired, false);
    assert.equal(cleanup.temporaryRuntimeDirectoryPresentAfterCleanup, false);
    assert.equal(cleanup.temporaryRuntimeDirectoryRemoved, null);
    assert.equal(cleanup.temporaryRuntimeDirectoryStatus, 'not-applicable');
    assert.equal(cleanup.forbiddenHelpers.total, 0);
    assert.equal(Object.values(cleanup.forbiddenHelpers).every(count => count === 0), true);
    assert.equal(staticDelivery.serverActiveDuringPreflight, false);
    assert.equal(staticDelivery.serverActiveDuringCountedInterval, true);
    assert.equal(staticDelivery.serverActiveAfterCleanup, false);
    assert.equal(staticDelivery.serverCount, 1);
    assert.equal(staticDelivery.serverCountScope, 'counted-interval');
    assert.equal(staticDelivery.servedIndexSha256, EXPECTED_BUILD.artifacts['index.html']);
    assert.equal(staticDelivery.expectedIndexSha256, EXPECTED_BUILD.artifacts['index.html']);
    assert.equal(staticDelivery.exactIndexMatched, true);
    assert.equal(staticDelivery.rendererInjectionDetected, false);
    assert.equal(staticDelivery.requestCountingAvailable, false);
    assert.equal(staticDelivery.requestCountsRetained, false);
    assert.equal(staticDelivery.rawRequestDataRetained, false);
    assert.equal(staticDelivery.staticServerOwnershipVerified, true);
    assert.equal(staticDelivery.processIdentifierRetained, false);
    assert.equal(staticDelivery.listenerRemoved, true);
}

function validateOutcomeDecision(run, phase, uptimeAfter) {
    if (run.result === 'stable') {
        assert.equal(run.stableDurationProven, true);
        assert.equal(run.observedDurationSeconds >= 900, true);
        assert.equal(run.platformRebootProven, false);
        assert.equal(uptimeAfter.platformRebootProven, false);
        assert.equal(phase.decision.startsWith('HOLD'), true);
    } else if (run.result === 'inconclusive') {
        assert.equal(run.stableDurationProven, false);
        assert.equal(run.observedDurationSeconds > 0, true);
        assert.equal(run.platformRebootProven, false);
        assert.equal(uptimeAfter.platformRebootProven, false);
        assert.equal(phase.decision.startsWith('HOLD'), true);
    } else {
        assert.equal(run.result, 'full-platform-reboot');
        assert.equal(run.platformRebootProven, true);
        assert.equal(uptimeAfter.platformRebootProven, true);
        assert.equal(phase.decision.startsWith('BLOCK'), true);
    }
    assert.equal(run.isolationConclusion, 'inconclusive');
    assert.equal(phase.isolationConclusion, 'inconclusive');
}

export function validateNativeMediaIsolationC1Outcome(root) {
    const approval = readJson(join(root, RUN_DIRECTORY, 'approval.json'));
    const boundary = readJson(join(root, RUN_DIRECTORY, 'quality-setting-boundary.json'));
    const cleanup = readJson(join(root, RUN_DIRECTORY, 'cleanup.json'));
    const comparison = readJson(join(root, 'comparison-to-stable-baseline.json'));
    const delivery = readJson(join(root, RUN_DIRECTORY, 'delivery-mode.json'));
    const device = readJson(join(root, RUN_DIRECTORY, 'device-state-before.json'));
    const instrumentation = readJson(join(root, RUN_DIRECTORY, 'instrumentation-absence.json'));
    const launch = readJson(join(root, RUN_DIRECTORY, 'launch-summary.json'));
    const markers = readNdjson(join(root, RUN_DIRECTORY, 'operator-markers.ndjson'));
    const matrix = readJson(join(root, 'comparison-matrix.json'));
    const output = readJson(join(root, RUN_DIRECTORY, 'transcode-output-category.json'));
    const phase = readJson(join(root, 'phase-summary.json'));
    const run = readJson(join(root, RUN_DIRECTORY, 'run-summary.json'));
    const staticDelivery = readJson(join(root, RUN_DIRECTORY, 'static-delivery-summary.json'));
    const uptimeAfter = readJson(join(root, RUN_DIRECTORY, 'uptime-after.json'));
    const uptimeBefore = readJson(join(root, RUN_DIRECTORY, 'uptime-before.json'));

    assert.equal(approval.status, 'explicit');
    assert.equal(approval.destructiveRiskAcknowledged, true);
    assert.equal(approval.launchAuthorized, true);
    assert.equal(approval.countedPlaybackStarted, true);
    validateQualityBoundary(boundary);
    validateDelivery(delivery, output);
    validateInstrumentation(instrumentation);
    validateComparison(comparison, matrix, run);
    validateCleanup(cleanup, staticDelivery);

    assert.equal(device.deviceClass, 'physical-lg-television');
    assert.equal(device.model, 'LG-70UN7070PUA');
    assert.equal(device.webosVersion, '5.6.2');
    assert.equal(device.firmwareVersion, '04.64.00');
    assert.equal(device.boardClass, 'K6LP_ATSC_US');
    assert.equal(device.sameDeviceCategoriesAsStableBaseline, true);
    assert.equal(device.validationApplicationRunning, false);
    assert.equal(device.networkAddressRetained, false);

    assert.equal(markers.length >= 8, true);
    const setup = markers.find(marker => marker.category === 'setup-playback-excluded');
    const setupStopped = markers.find(marker => marker.category === 'setup-playback-stopped');
    const start = markers.find(marker => marker.category === 'playback-start-confirmed');
    const terminal = markers.find(marker => marker.category === 'counted-interval-ended');
    const postCountProof = markers.find(
        marker => marker.category === 'stable-visual-and-delivery-confirmed'
    );
    const restored = markers.find(marker => marker.category === 'quality-setting-restored');
    const cleanupComplete = markers.find(marker => marker.category === 'post-run-cleanup-complete');
    assert.notEqual(setup, undefined);
    assert.notEqual(setupStopped, undefined);
    assert.notEqual(start, undefined);
    assert.notEqual(terminal, undefined);
    assert.notEqual(postCountProof, undefined);
    assert.notEqual(restored, undefined);
    assert.notEqual(cleanupComplete, undefined);
    assert.equal(markers.indexOf(setup) < markers.indexOf(setupStopped), true);
    assert.equal(markers.indexOf(setupStopped) < markers.indexOf(start), true);
    assert.equal(markers.indexOf(start) < markers.indexOf(terminal), true);
    assert.equal(markers.indexOf(terminal) < markers.indexOf(postCountProof), true);
    assert.equal(markers.indexOf(postCountProof) < markers.indexOf(restored), true);
    assert.equal(markers.indexOf(restored) < markers.indexOf(cleanupComplete), true);
    assert.equal(setup.countedInterval, false);
    assert.equal(setup.setupDeliveryCandidatesExcludedFromCountedRun, true);
    assert.equal(setup.selectedDeliveryCategory, 'Transcode');
    assert.equal(setup.videoTranscode, true);
    assert.equal(setup.audioTranscode, false);
    assert.equal(setup.subtitleBurnIn, false);
    assert.equal(setupStopped.countedInterval, false);
    assert.equal(setupStopped.matchingPlaybackSessionCount, 0);
    assert.equal(start.inputMethod, 'physical-lg-remote');
    assert.equal(start.postStartPhysicalInputCount, 0);
    assert.equal(terminal.postStartPhysicalInputCount, 0);
    assert.equal(terminal.observedDurationSeconds, 909);
    assert.equal(postCountProof.countedInterval, false);
    assert.equal(postCountProof.observedDurationSeconds, 909);
    assert.equal(postCountProof.selectedDeliveryCategory, 'Transcode');
    assert.equal(postCountProof.videoTranscode, true);
    assert.equal(postCountProof.audioTranscode, false);
    assert.equal(postCountProof.subtitleBurnIn, false);
    assert.equal(postCountProof.candidateCount, 1);
    assert.equal(postCountProof.platformRebootProven, false);
    assert.equal(restored.state, 'auto-restored');
    assert.equal(restored.observedAt, boundary.restoration.restoredAt);
    assert.equal(restored.targetValue, 'Auto');
    assert.equal(restored.physicalUiConfirmed, true);
    assert.equal(restored.deliveryCategory, 'DirectPlay');
    assert.equal(restored.videoTranscode, false);
    assert.equal(restored.audioTranscode, false);
    assert.equal(cleanupComplete.validationApplicationPresent, false);
    assert.equal(cleanupComplete.staticServerProcessPresent, false);
    assert.equal(cleanupComplete.staticListenerCount, 0);
    assert.equal(cleanupComplete.relevantNodeHelperCount, 0);
    assert.equal(cleanupComplete.observedAt, cleanup.completedAt);

    assert.equal(run.actualDeliveryMode, 'Transcode');
    assert.equal(run.videoTranscode, true);
    assert.equal(run.audioTranscode, false);
    assert.equal(run.subtitleBurnIn, false);
    assert.equal(run.deliveryCandidateCount, 1);
    assert.equal(run.countedInterval.startedAt, start.observedAt);
    assert.equal(run.countedInterval.endedAt, terminal.observedAt);
    assert.equal(run.countedInterval.postStartPhysicalInputCount, 0);
    assert.equal(run.observedDurationSeconds, run.countedInterval.observedDurationSeconds);
    assert.equal(run.observedDurationSeconds, 909);
    assert.equal(terminal.observedDurationSeconds, run.observedDurationSeconds);
    assert.equal(run.qualitySettingRestored, true);
    assert.equal(run.classification, CLASSIFICATION);
    assert.equal(run.strictSingleIndependentVariableProven, false);
    assert.equal(run.strictSingleEncodedOutputDimensionProven, false);
    assert.equal(run.productionModified, false);
    assert.equal(run.ownershipBoundariesModified, false);

    assert.equal(instrumentation.countedInterval.startedAt, run.countedInterval.startedAt);
    assert.equal(instrumentation.countedInterval.endedAt, run.countedInterval.endedAt);
    assert.equal(
        instrumentation.countedInterval.observedDurationSeconds,
        run.observedDurationSeconds
    );
    assert.equal(launch.launchCount, 1);
    assert.equal(launch.launchSucceeded, true);
    assert.equal(launch.rawLaunchOutputRetained, false);
    assert.equal(launch.postLaunchDeviceQueries, 0);
    assert.equal(launch.playbackStartedAt, run.countedInterval.startedAt);

    assert.equal(phase.phase, 'PiggieTV WebOS Phase 3A.1R.2b');
    assert.equal(phase.run3.directory, RUN_DIRECTORY);
    assert.equal(phase.run3.result, run.result);
    assert.equal(phase.run3.actualDeliveryMode, 'Transcode');
    assert.equal(phase.run3.videoTranscode, true);
    assert.equal(phase.run3.observedDurationSeconds, run.observedDurationSeconds);
    assert.equal(phase.run3.postStartInputCount, 0);
    assert.equal(phase.run3.intendedChangedDimension, 'delivery-request-policy');
    assert.deepEqual(phase.run3.operatorControlledChanges, ['temporary-ui-quality-cap']);
    assert.equal(phase.run3.qualitySettingRestored, true);
    assert.equal(phase.run3.classification, CLASSIFICATION);
    assert.equal(phase.run3.strictSingleIndependentVariableProven, false);
    assert.equal(phase.run3.strictSingleEncodedOutputDimensionProven, false);
    assert.equal(phase.nextPhase.separateApprovalRequired, true);
    assert.equal(phase.nextPhase.automaticLaunch, false);
    assert.equal(phase.productionModified, false);
    assert.equal(phase.ownershipBoundariesModified, false);
    validateOutcomeDecision(run, phase, uptimeAfter);
    assert.equal(matrix.runs[1].durationSeconds, run.observedDurationSeconds);

    const appliedAt = parseTimestamp(boundary.temporary.appliedAt, 'quality applied');
    const originalConfirmationAt = parseTimestamp(
        boundary.original.operatorConfirmationReportedAt,
        'original Auto operator confirmation'
    );
    const approvalAt = parseTimestamp(
        approval.approvalReceivedAt ?? approval.approvalRecordedAt,
        'approval'
    );
    const launchAt = parseTimestamp(launch.requestedAt, 'launch');
    const setupAt = parseTimestamp(setup.observedAt, 'excluded setup playback');
    const setupStoppedAt = parseTimestamp(setupStopped.observedAt, 'setup playback stopped');
    const startAt = parseTimestamp(start.observedAt, 'playback start');
    const terminalAt = parseTimestamp(terminal.observedAt, 'interval end');
    const postCountProofAt = parseTimestamp(postCountProof.observedAt, 'post-count proof');
    const restorationDeliveryAt = parseTimestamp(
        boundary.restorationDeliveryVerification.observedAt,
        'restoration DirectPlay proof'
    );
    const restoredAt = parseTimestamp(boundary.restoration.restoredAt, 'quality restored');
    const appClosedAt = parseTimestamp(
        cleanup.validationApplicationCloseCompletedAt,
        'validation app closed'
    );
    const staticCleanupAt = parseTimestamp(
        staticDelivery.cleanupStoppedAt,
        'static delivery stopped'
    );
    const cleanupAt = parseTimestamp(cleanup.completedAt, 'cleanup');
    assert.equal(approvalAt < launchAt, true);
    assert.equal(launchAt < appliedAt && appliedAt < setupAt, true);
    assert.equal(setupAt < originalConfirmationAt, true);
    assert.equal(originalConfirmationAt < setupStoppedAt && setupStoppedAt < startAt, true);
    assert.equal(startAt < terminalAt && terminalAt < postCountProofAt, true);
    assert.equal(postCountProofAt < restorationDeliveryAt, true);
    assert.equal(restorationDeliveryAt < restoredAt && restoredAt < appClosedAt, true);
    assert.equal(appClosedAt < staticCleanupAt && staticCleanupAt < cleanupAt, true);
    assert.equal(
        cleanup.staticProcessAndListenerAbsenceVerifiedAt,
        staticDelivery.cleanupStoppedAt
    );
    assert.equal(cleanup.validationApplicationAbsenceVerifiedAt, cleanup.completedAt);
    assert.equal(cleanup.relevantNodeHelperAbsenceVerifiedAt, cleanup.completedAt);

    if (run.platformRebootProven === false) {
        const beforeUptimeAt = parseTimestamp(uptimeBefore.observedAt, 'uptime before');
        const afterUptimeAt = parseTimestamp(uptimeAfter.observedAt, 'uptime after');
        assert.equal(uptimeBefore.uptimeSeconds, 27769.58);
        assert.equal(uptimeAfter.uptimeSeconds, 31621.51);
        assert.equal(uptimeBefore.sampleCount, 1);
        assert.equal(uptimeAfter.sampleCount, 1);
        assert.equal(uptimeAfter.increasedFromPreRun, true);
        assert.equal(uptimeAfter.platformRebootProven, false);
        assert.equal(
            uptimeAfter.timestampBoundaryPrecision,
            'pre-read-timestamp-captured-after-concurrent-one-shot-queries'
        );
        assert.equal(uptimeAfter.wallToUptimeDeltaDifferenceSeconds, 5.62);
        assert.equal(uptimeAfter.uptimeSeconds > uptimeBefore.uptimeSeconds, true);
        assert.equal(beforeUptimeAt < startAt && terminalAt < afterUptimeAt, true);
        const wallDelta = (afterUptimeAt - beforeUptimeAt) / 1000;
        const uptimeDelta = uptimeAfter.uptimeSeconds - uptimeBefore.uptimeSeconds;
        assert.equal(Math.abs(wallDelta - uptimeDelta) <= TIME_TOLERANCE_SECONDS, true);
    }
}

export function validateNativeMediaIsolationC1Evidence(evidenceRoot) {
    const root = resolve(evidenceRoot);
    assert.equal(existsSync(root), true, 'Evidence root does not exist');
    for (const path of REQUIRED_FILES) {
        assert.equal(existsSync(join(root, path)), true, `Missing evidence file: ${path}`);
    }
    validateBuildAndMedia(root);
    validateNativeMediaIsolationC1FrozenLineage(root);
    validateNativeMediaIsolationPrivacy(root, true);
    validateNativeMediaIsolationKnownPrivateValueScan(root);
    validateNativeMediaIsolationC1Outcome(root);
    validateNativeMediaIsolationRepeatInventory(root);
    return {
        status: 'PASS',
        schemaVersion: 'ptv-webos-native-media-isolation-c1-validation-v1',
        mode: 'final',
        evidenceRoot: 'privacy-redacted',
        frozenLineageValidated: true,
        exactBuildSourceTvParityValidated: true,
        actualVideoTranscodeValidated: true,
        qualityRestorationValidated: true,
        privacyValidated: true,
        artifactInventoryValidated: true
    };
}

function main(argv) {
    assert.equal(argv.length, 1, 'Usage: validate-native-media-isolation-c1-evidence.mjs <evidence-root>');
    process.stdout.write(
        `${JSON.stringify(validateNativeMediaIsolationC1Evidence(argv[0]), null, 2)}\n`
    );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
    main(process.argv.slice(2));
}
