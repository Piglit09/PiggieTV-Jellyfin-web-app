import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    existsSync,
    readFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
    validateNativeMediaIsolationKnownPrivateValueScan,
    validateNativeMediaIsolationPrivacy
} from './validate-native-media-isolation-evidence.mjs';
import {
    validateNativeMediaIsolationRepeatInventory
} from './validate-native-media-isolation-repeat-evidence.mjs';

export const C3_AAC_CONTROL_CONTRACT = Object.freeze({
    runDirectory: 'run-05-c3-synthetic-aac-control',
    phase: 'PiggieTV WebOS Phase 3A.1R.2d - C3 synthetic AAC control',
    approvalScope: 'single-c3-synthetic-aac-physical-control-run',
    minimumStableSeconds: 900,
    preparedAssetDurationSeconds: 960.96,
    stableDecision: 'HOLD-baseline-stable-comparisons-incomplete',
    rebootDecision: 'BLOCK-baseline-rebooted',
    inconclusiveDecision: 'HOLD-inconclusive',
    preparedEvidenceDirectory:
        'webos-native-media-isolation-c3-asset-preparation-20260728-183948Z',
    preparedEvidenceHashes: Object.freeze({
        artifactInventory:
            'b18195d762d676769e389352d82b42f04cdbd05c9e4a1561991f5ebacd36baee',
        pairManifest:
            '73b41931f0965fc29f96fe6e8690cd03701ea83df309dcef0ade39fe7fba7354',
        pairEquivalence:
            'e20c1762b4d392042e1d04da6b2501772d50d9c67cf57315b0c09ebfd1599874',
        deliveryPrediction:
            'eb3f0f77953d0e19e34d55036744bba5a1ea23471cfabef7d3f2135d7c68cdba'
    }),
    controlAssetSha256:
        '54d26c99a5d3ebf8a6a613efb255c67984a602d0b74e4be736c0a2fad9558a32',
    candidateAssetSha256:
        'e36bb24c52104fec2db585afa9c0acfa9c3cb336c5612f92c34ecaa95fd32c23',
    nextPhaseAfterStable:
        'C3 paired DTS candidate physical run with separate explicit approval',
    nextPhaseAfterReboot:
        'WebOS synthetic AAC DirectPlay reboot attribution with separate explicit approval',
    nextPhaseAfterInconclusive:
        'Repeat the C3 synthetic AAC control with fresh explicit approval'
});

const EXPECTED_BUILD = Object.freeze({
    commit: '44899b1fb556f4983ae2c1fa4e861d1ad0b4f4d8',
    packageVersion: '10.11.11',
    artifacts: Object.freeze({
        'index.html': '9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc',
        'runtime.bundle.js':
            '93ce794233526fc506b6cf58777397ea22f203b9387f808caad8912150656043',
        'main.jellyfin.bundle.js':
            '8320ae8655682107692777ba8d62d74d014bbaa01b6c3648a60b0caf0f265161'
    }),
    wrapper: Object.freeze({
        appInfoSha256:
            '76cdc80786399fc2a65758a139e19918c0181bd1e0bc95dd22d2a5e590c4284c',
        indexSha256:
            'c4a24b16740f19982c8df3dc92bffc7bbed91840da6e25b41204010a8e0c2f02',
        packageSha256:
            '01da6c157e9822416df9f91f7d38764a6e1b67fa6d2bbc65779400f46c095794'
    })
});

const REQUIRED_FILES = Object.freeze([
    'README.md',
    'artifact-inventory.json',
    'comparison-matrix.json',
    'comparison-to-c3-preparation.json',
    'final-report.md',
    'known-private-value-scan.json',
    'phase-summary.json',
    'privacy-scan.json',
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/approval.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/build-identity.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/cleanup.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/delivery-mode.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/device-state-before.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/candidate-exclusion.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/fixture-lineage.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/instrumentation-absence.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/isolated-server-boundary.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/launch-summary.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/media-category.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/operator-markers.ndjson`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/reboot-proof.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/run-summary.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/static-delivery-summary.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/uptime-after.json`,
    `${C3_AAC_CONTROL_CONTRACT.runDirectory}/uptime-before.json`
]);

const UPTIME_WALL_TOLERANCE_SECONDS = 10;
const STABLE_WALL_TOLERANCE_SECONDS = 5;
const ZERO_COUNTED_INSTRUMENTATION = Object.freeze({
    periodicProcessResourcePolling: 0,
    appPresenceQueries: 0,
    networkProbes: 0,
    serverQueries: 0,
    cdpOrInspectorAttachments: 0,
    rendererOrBrowserInjections: 0,
    syntheticOrDeveloperInputs: 0,
    postStartPhysicalInputCount: 0
});
const DTS_ZERO_ACTIVITY = Object.freeze({
    stagedCount: 0,
    mountedCount: 0,
    indexedCount: 0,
    planningQueryCount: 0,
    metadataQueryCount: 0,
    mediaRequestCount: 0,
    playbackStartCount: 0,
    transcodeEventCount: 0
});
const INCONCLUSIVE_CATEGORIES = Object.freeze([
    'application-closed',
    'delivery-unproven',
    'input-observed',
    'playback-error',
    'polling-or-observer-influence',
    'reboot-proof-incomplete',
    'unsolicited-pause'
]);

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function readNdjson(path) {
    return readFileSync(path, 'utf8')
        .split(/\r?\n/u)
        .filter(Boolean)
        .map(line => JSON.parse(line));
}

function parseTimestamp(value, label) {
    assert.equal(typeof value, 'string', `${label} must be an ISO timestamp`);
    const timestamp = Date.parse(value);
    assert.equal(Number.isFinite(timestamp), true, `${label} must be an ISO timestamp`);
    return timestamp;
}

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function validateApproval(approval, launch) {
    assert.equal(approval.schemaVersion, 1);
    assert.equal(approval.run, C3_AAC_CONTROL_CONTRACT.runDirectory);
    assert.equal(approval.status, 'explicit');
    assert.equal(approval.scope, C3_AAC_CONTROL_CONTRACT.approvalScope);
    const approvalAt = parseTimestamp(approval.approvalReceivedAt, 'approval');
    const preflightAt = parseTimestamp(approval.preflightPassedAt, 'preflight');
    const consumedAt = parseTimestamp(approval.consumedAt, 'approval consumption');
    const launchAt = parseTimestamp(launch.requestedAt, 'launch request');
    assert.equal(approvalAt < preflightAt, true);
    assert.equal(preflightAt <= consumedAt, true);
    assert.equal(consumedAt, launchAt);
    assert.equal(approval.destructiveRiskAcknowledged, true);
    assert.equal(approval.readOnlyPreflightAuthorized, true);
    assert.equal(approval.singleValidationApplicationLaunchAttemptAuthorized, true);
    assert.equal(approval.singleSyntheticAacControlPlaybackAuthorized, true);
    assert.equal(approval.dtsCandidateStagingAuthorized, false);
    assert.equal(approval.dtsCandidatePlanningAuthorized, false);
    assert.equal(approval.dtsCandidatePlaybackAuthorized, false);
    assert.equal(approval.productionContactAuthorized, false);
    assert.equal(approval.repeatOrRelaunchAuthorized, false);
    assert.equal(
        approval.consumedBy,
        'first-validation-application-launch-attempt'
    );
    assert.equal(approval.launchAttemptCount, 1);
    assert.equal([0, 1].includes(approval.countedPlaybackStartCount), true);
    assert.equal(approval.approvalExhausted, true);
}

function validateBuild(build) {
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
    assert.equal(build.productionBundleServedLocally, true);
    assert.equal(build.developmentServerClientPresent, false);
    assert.equal(build.responseInjectionPresent, false);
    assert.equal(build.productSourceModifiedForRun, false);
    assert.equal(
        build.staticServerScriptSha256,
        '8b8d4c66f9bd18a0bb033eda2ac424ae95633563fb221846a16cd8a293e6cb81'
    );
}

function validateFixtureReference(reference) {
    assert.equal(reference.schemaVersion, 1);
    assert.equal(
        reference.preparedEvidenceDirectory,
        C3_AAC_CONTROL_CONTRACT.preparedEvidenceDirectory
    );
    assert.deepEqual(
        reference.preparedEvidenceHashes,
        C3_AAC_CONTROL_CONTRACT.preparedEvidenceHashes
    );
    assert.equal(reference.selectedRole, 'control');
    assert.equal(
        reference.selectedAssetSha256,
        C3_AAC_CONTROL_CONTRACT.controlAssetSha256
    );
    assert.equal(reference.selectedAssetHashMatchedBeforeStage, true);
    assert.equal(reference.selectedAssetReadOnly, true);
    assert.deepEqual(reference.stagedRoles, ['control']);
    assert.equal(reference.candidateRetainedSealed, true);
    assert.equal(
        reference.candidateAssetSha256,
        C3_AAC_CONTROL_CONTRACT.candidateAssetSha256
    );
    assert.equal(reference.candidateHashMatchedWithoutStageOrMount, true);
    assert.equal(reference.candidateStaged, false);
    assert.equal(reference.candidateMounted, false);
    assert.equal(reference.candidateClientReachable, false);
    assert.equal(reference.rawFixtureNamesRetained, false);
    assert.equal(reference.fixturePathsRetained, false);
}

function validateCandidateExclusion(exclusion) {
    assert.equal(exclusion.schemaVersion, 1);
    assert.equal(exclusion.role, 'candidate');
    assert.equal(exclusion.codecCategory, 'dts-core');
    assert.equal(exclusion.authorized, false);
    assert.equal(exclusion.staged, false);
    assert.equal(exclusion.mounted, false);
    assert.equal(exclusion.indexed, false);
    assert.equal(exclusion.clientReachable, false);
    assert.equal(exclusion.selectable, false);
    assert.equal(exclusion.runtimeDeliveryProven, false);
    assert.equal(exclusion.futureRunAuthorized, false);
    assert.deepEqual(exclusion.activity, DTS_ZERO_ACTIVITY);
}

function validateMedia(media) {
    assert.equal(media.schemaVersion, 1);
    assert.equal(media.role, 'control');
    assert.equal(media.sourceKind, 'deterministic-synthetic-neutral');
    assert.equal(media.sourceIdentityRetained, false);
    assert.equal(media.assetSha256Retained, true);
    assert.equal(media.assetSha256, C3_AAC_CONTROL_CONTRACT.controlAssetSha256);
    assert.equal(media.container, 'mp4');
    assert.equal(media.containerFragmented, false);
    assert.equal(media.progressiveFastStart, true);
    assert.equal(media.videoStreamCount, 1);
    assert.equal(media.videoCodec, 'h264-avc');
    assert.equal(media.videoSampleEntry, 'avc1');
    assert.equal(media.videoProfile, 'high');
    assert.equal(media.videoLevel, '4.1');
    assert.equal(media.audioCodec, 'aac-lc');
    assert.equal(media.audioSampleEntry, 'mp4a');
    assert.equal(media.audioProfile, 'lc');
    assert.equal(media.audioCodecString, 'mp4a.40.2');
    assert.deepEqual(media.resolution, {
        width: 1904,
        height: 1072
    });
    assert.deepEqual(media.frameRate, {
        numerator: 24000,
        denominator: 1001,
        class: 'conventional-cfr'
    });
    assert.equal(media.frameCount, 23040);
    assert.equal(media.durationSeconds, C3_AAC_CONTROL_CONTRACT.preparedAssetDurationSeconds);
    assert.equal(media.bitDepth, 8);
    assert.equal(media.chromaFormat, 'yuv420p');
    assert.equal(media.dynamicRange, 'sdr');
    assert.equal(media.colorPrimaries, 'bt709');
    assert.equal(media.colorTransfer, 'bt709');
    assert.equal(media.colorMatrix, 'bt709');
    assert.equal(media.colorRange, 'limited');
    assert.equal(media.subtitleState, 'none');
    assert.equal(media.subtitleStreamCount, 0);
    assert.equal(media.audioStreamCount, 1);
    assert.equal(media.channelLayout, 'stereo');
    assert.equal(media.sampleRateHz, 48000);
    assert.equal(media.bitrateClass, 'moderate');
    assert.equal(media.multipleVideoVersions, false);
    assert.equal(media.extraStreamCount, 0);
    assert.equal(media.exactPreparedControlMatched, true);
}

function validateServerBoundary(boundary) {
    assert.equal(boundary.schemaVersion, 1);
    assert.equal(boundary.environment, 'fresh-disposable-isolated-non-production');
    assert.equal(boundary.jellyfinVersion, '10.11.11');
    assert.equal(
        boundary.serverImageDigestSha256,
        'aefb67e6a7ff1debdd154a78a7bbb780fd0c873d8639210a7f6a2016ad2b35db'
    );
    assert.equal(boundary.syntheticOnlyLibrary, true);
    assert.equal(boundary.libraryItemCount, 1);
    assert.equal(boundary.mountedFixtureCount, 1);
    assert.deepEqual(boundary.mountedRoles, ['control']);
    assert.equal(boundary.mediaMountReadOnly, true);
    assert.equal(boundary.dedicatedTemporaryAccount, true);
    assert.equal(boundary.freshConfiguration, true);
    assert.equal(boundary.freshDatabase, true);
    assert.equal(boundary.freshCache, true);
    assert.equal(boundary.productionCredentialsUsed, false);
    assert.equal(boundary.productionRouteAvailable, false);
    assert.equal(boundary.productionConfigurationMounted, false);
    assert.equal(boundary.productionDatabaseMounted, false);
    assert.equal(boundary.productionMediaMounted, false);
    assert.equal(boundary.publicInternetExposure, false);
    assert.equal(boundary.discoveryEnabled, false);
    assert.equal(boundary.networkLimitedToPhysicalValidationPath, true);
    assert.equal(boundary.candidateStaged, false);
    assert.equal(boundary.candidateMounted, false);
    assert.equal(boundary.candidateIndexed, false);
    assert.equal(boundary.candidateClientReachable, false);
    assert.deepEqual(boundary.dtsActivity, DTS_ZERO_ACTIVITY);
    assert.equal(boundary.rawRuntimeIdentityRetained, false);
}

function assertDirectPlaySignature(value, label) {
    assert.equal(value.selectedDeliveryCategory, 'DirectPlay', `${label} delivery`);
    assert.equal(value.mediaSourceCandidateCount, 1, `${label} candidate count`);
    assert.equal(value.container, 'mp4', `${label} container`);
    assert.equal(value.videoCodec, 'h264-avc', `${label} video codec`);
    assert.equal(value.audioCodec, 'aac-lc', `${label} audio codec`);
    assert.equal(value.videoDirect, true, `${label} video direct`);
    assert.equal(value.audioDirect, true, `${label} audio direct`);
    assert.equal(value.videoTranscode, false, `${label} video transcode`);
    assert.equal(value.audioTranscode, false, `${label} audio transcode`);
    assert.equal(value.containerRemux, false, `${label} container remux`);
    assert.equal(value.subtitleBurnIn, false, `${label} subtitle burn-in`);
    assert.equal(value.transcodingUrlPresent, false, `${label} transcoding URL`);
    assert.deepEqual(value.transcodingReasons, [], `${label} reasons`);
}

function validateDelivery(delivery, run) {
    assert.equal(delivery.schemaVersion, 1);
    assert.equal(delivery.controlAssetSha256, C3_AAC_CONTROL_CONTRACT.controlAssetSha256);
    assert.equal(delivery.sourceBoundToPreparedHashInMemory, true);
    assert.equal(delivery.sourceIdentityRetained, false);
    assert.equal(delivery.rawPlanningResponseRetained, false);
    assert.equal(delivery.rawPlaybackRecordRetained, false);
    assert.equal(delivery.rawUrlsRetained, false);
    assert.equal(delivery.rawIdsRetained, false);

    const planning = delivery.preRunPlanning;
    assert.equal(planning.queryCount, 1);
    assert.equal(planning.bounded, true);
    assert.equal(planning.nonPeriodic, true);
    assert.equal(planning.occurredBeforeCountedInterval, true);
    assert.equal(planning.supportsDirectPlay, true);
    assert.equal(planning.deviceProfileWebosVersion, '5.6.2');
    assert.equal(planning.videoQuality, 'auto');
    assert.equal(planning.allowedAudioChannels, 'stereo-or-greater');
    assert.equal(planning.subtitleState, 'off');
    assertDirectPlaySignature(planning, 'pre-run planning');

    const actual = delivery.actualRunDecision;
    assert.equal(Number.isInteger(actual.serverReadCount), true);
    assert.equal(actual.serverReadCount > 0, true);
    assert.equal(actual.bounded, true);
    assert.equal(actual.nonPeriodic, true);
    assert.equal(actual.occurredAfterCountedInterval, true);
    if (actual.actualRuntimeMethodProven) {
        assert.equal(
            actual.proofMethod,
            'post-count-bounded-live-server-playback-record'
        );
        assert.equal(actual.matchingPlaybackSessionCount, 1);
        assertDirectPlaySignature(actual, 'actual runtime');
        assert.equal(actual.ffmpegProcessObserved, false);
        assert.equal(actual.ffmpegCommandObserved, false);
        assert.equal(actual.serverTranscodeEventCount, 0);
        assert.equal(actual.playbackActiveDuringProof, true);
        assert.equal(run.actualDeliveryMode, 'DirectPlay');
    } else {
        assert.equal(
            ['interrupted', 'stable-delivery-unproven'].includes(run.result),
            true
        );
        assert.equal(run.interruptionCategory, 'delivery-unproven');
        assert.equal(
            actual.proofMethod,
            'post-count-bounded-server-record-attempts'
        );
        assert.equal(actual.serverReadCount, 5);
        assert.equal(actual.liveReadAttemptCount, 1);
        assert.equal(actual.recoveryReadAttemptCount, 4);
        assert.equal(actual.usableNormalizedRecordCount, 0);
        assert.equal(actual.firstReadOccurredWhilePlaybackActive, true);
        assert.equal(actual.safeResultCapturedFromActiveRead, false);
        assert.equal(actual.finalReadNowPlayingSessionPresent, false);
        assert.equal(actual.matchingPlaybackSessionCount, null);
        assert.equal(actual.selectedDeliveryCategory, 'unproven');
        assert.equal(actual.mediaSourceCandidateCount, null);
        assert.equal(actual.videoDirect, null);
        assert.equal(actual.audioDirect, null);
        assert.equal(actual.videoTranscode, null);
        assert.equal(actual.audioTranscode, null);
        assert.equal(actual.containerRemux, null);
        assert.equal(actual.subtitleBurnIn, null);
        assert.equal(actual.transcodingUrlPresent, null);
        assert.deepEqual(actual.transcodingReasons, []);
        assert.equal(
            actual.proofFailureCategory,
            'safe-local-reduction-failed-no-usable-runtime-category-retained'
        );
        assert.equal(actual.logReadCount, 1);
        assert.equal(actual.ffmpegProcessObserved, false);
        assert.equal(actual.ffmpegCommandObserved, false);
        assert.equal(actual.serverTranscodeEventCount, 0);
        assert.equal(actual.serverErrorMarkerCount, 0);
        assert.equal(actual.ffmpegAbsenceUsedToInferDirectPlay, false);
        assert.equal(run.actualDeliveryMode, 'unproven');
    }
    assert.equal(delivery.countedIntervalServerQueryCount, 0);
    assert.equal(
        delivery.countableAsExactSyntheticAacDirectPlayControl,
        actual.actualRuntimeMethodProven
            && run.result !== 'interrupted'
            && run.observedDurationSeconds
                >= C3_AAC_CONTROL_CONTRACT.minimumStableSeconds
            && run.countedInterval.postStartPhysicalInputCount === 0
            && run.countedInterval.queryAndPollingCount === 0
    );
    assert.deepEqual(delivery.dtsActivity, DTS_ZERO_ACTIVITY);
}

function validateInstrumentation(instrumentation, run) {
    assert.equal(instrumentation.schemaVersion, 1);
    assert.equal(instrumentation.preflight.forbiddenHelperTotal, 0);
    assert.equal(
        Object.entries(instrumentation.preflight)
            .filter(([name]) => !['forbiddenHelperTotal', 'staticServerCount'].includes(name))
            .every(([, count]) => count === 0),
        true
    );
    assert.equal(instrumentation.preflight.staticServerCount, 1);
    const actual = {
        periodicProcessResourcePolling:
            instrumentation.countedInterval.periodicProcessResourcePolling,
        appPresenceQueries: instrumentation.countedInterval.appPresenceQueries,
        networkProbes: instrumentation.countedInterval.networkProbes,
        serverQueries: instrumentation.countedInterval.serverQueries,
        cdpOrInspectorAttachments:
            instrumentation.countedInterval.cdpOrInspectorAttachments,
        rendererOrBrowserInjections:
            instrumentation.countedInterval.rendererOrBrowserInjections,
        syntheticOrDeveloperInputs:
            instrumentation.countedInterval.syntheticOrDeveloperInputs,
        postStartPhysicalInputCount:
            instrumentation.countedInterval.postStartPhysicalInputCount
    };
    for (const value of Object.values(actual)) {
        assert.equal(Number.isInteger(value), true);
        assert.equal(value >= 0, true);
    }
    if (run.result !== 'interrupted') {
        assert.deepEqual(actual, ZERO_COUNTED_INSTRUMENTATION);
    } else if (run.interruptionCategory === 'input-observed') {
        assert.equal(actual.postStartPhysicalInputCount > 0, true);
        assert.deepEqual(
            {
                ...actual,
                postStartPhysicalInputCount: 0
            },
            ZERO_COUNTED_INSTRUMENTATION
        );
    } else if (run.interruptionCategory === 'polling-or-observer-influence') {
        assert.equal(
            Object.entries(actual)
                .filter(([name]) => name !== 'postStartPhysicalInputCount')
                .some(([, count]) => count > 0),
            true
        );
        assert.equal(actual.postStartPhysicalInputCount, 0);
    } else {
        assert.deepEqual(actual, ZERO_COUNTED_INSTRUMENTATION);
    }
}

function validateDevice(device) {
    assert.equal(device.schemaVersion, 1);
    assert.equal(device.deviceClass, 'physical-lg-television');
    assert.equal(device.model, 'LG-70UN7070PUA');
    assert.equal(device.webosVersion, '5.6.2');
    assert.equal(device.firmwareVersion, '04.64.00');
    assert.equal(device.boardClass, 'K6LP_ATSC_US');
    assert.equal(device.fullyBootedAndStable, true);
    assert.equal(device.validationApplicationRunning, false);
    assert.equal(device.validationApplicationAbsenceQueryCount, 1);
    assert.equal(device.networkAddressRetained, false);
    assert.equal(device.bootIdentifierRetained, false);
}

function validateMarkers(markers, run) {
    assert.equal(markers.length >= 4, true);
    assert.deepEqual(
        markers.map(marker => marker.sequence),
        Array.from({ length: markers.length }, (_, index) => index + 1)
    );

    const start = markers.find(marker => marker.category === 'playback-start-confirmed');
    const terminal = markers.find(marker => marker.category === run.terminalMarkerCategory);
    const deliveryCategory = run.actualDeliveryMode === 'DirectPlay' ?
        'post-count-directplay-proven' :
        'post-count-delivery-unproven';
    const delivery = markers.find(marker => marker.category === deliveryCategory);
    const applicationAbsentAtClose = run.result === 'full-platform-reboot'
        || run.applicationStateAtCleanup
            === 'already-not-running-after-normal-completion';
    const closeCategory = applicationAbsentAtClose ?
        'post-run-application-absence-confirmed' :
        'post-run-application-closed';
    const closed = markers.find(marker => marker.category === closeCategory);
    const cleanup = markers.find(marker => marker.category === 'post-run-cleanup-complete');

    for (const marker of [start, terminal, delivery, closed, cleanup]) {
        assert.notEqual(marker, undefined);
    }
    assert.equal(markers.indexOf(start) < markers.indexOf(terminal), true);
    assert.equal(markers.indexOf(terminal) < markers.indexOf(delivery), true);
    assert.equal(markers.indexOf(delivery) < markers.indexOf(closed), true);
    assert.equal(markers.indexOf(closed) < markers.indexOf(cleanup), true);
    assert.equal(start.countedInterval, true);
    assert.equal(start.state, 'playing');
    assert.equal(start.inputMethod, 'physical-lg-remote');
    assert.equal(start.startPosition, 'zero');
    assert.equal(start.postStartPhysicalInputCount, 0);
    assert.equal(terminal.countedInterval, true);
    assert.equal(
        terminal.postStartPhysicalInputCount,
        run.countedInterval.postStartPhysicalInputCount
    );
    assert.equal(delivery.countedInterval, false);
    assert.equal(delivery.selectedDeliveryCategory, run.actualDeliveryMode);
    assert.equal(
        delivery.mediaSourceCandidateCount,
        run.actualDeliveryMode === 'DirectPlay' ? 1 : null
    );
    assert.equal(delivery.dtsActivityCount, 0);
    assert.equal(closed.countedInterval, false);
    assert.equal(cleanup.countedInterval, false);

    const startAt = parseTimestamp(start.observedAt, 'playback start marker');
    const terminalAt = parseTimestamp(terminal.observedAt, 'terminal marker');
    const deliveryAt = parseTimestamp(delivery.observedAt, 'delivery proof marker');
    const closedAt = parseTimestamp(closed.observedAt, 'application close marker');
    const cleanupAt = parseTimestamp(cleanup.observedAt, 'cleanup marker');
    assert.equal(startAt < terminalAt, true);
    assert.equal(terminalAt < deliveryAt, true);
    assert.equal(deliveryAt <= closedAt, true);
    assert.equal(closedAt < cleanupAt, true);
    assert.equal(
        Math.abs((terminalAt - startAt) / 1000 - run.observedDurationSeconds)
            <= STABLE_WALL_TOLERANCE_SECONDS,
        true
    );
    return {
        cleanupAt,
        closedAt,
        deliveryAt,
        startAt,
        terminalAt
    };
}

function validateStableOutcome(run, phase, reboot) {
    assert.equal(run.result, 'stable');
    assert.equal(run.displayResult, 'PASS — SINGLE SYNTHETIC AAC CONTROL STABLE');
    assert.equal(run.classification, 'synthetic-aac-control-stable');
    assert.equal(run.terminalMarkerCategory, 'stable-duration-confirmed');
    assert.equal(run.decision, C3_AAC_CONTROL_CONTRACT.stableDecision);
    assert.equal(run.observedDurationSeconds >= C3_AAC_CONTROL_CONTRACT.minimumStableSeconds, true);
    assert.equal(
        run.observedDurationSeconds
            <= C3_AAC_CONTROL_CONTRACT.preparedAssetDurationSeconds + 5,
        true
    );
    assert.equal(run.stableDurationProven, true);
    assert.equal(run.countedObservationCompletedNormally, true);
    assert.equal(['playing', 'ended'].includes(run.playbackStateAtTerminal), true);
    assert.equal(
        run.normalMediaCompletionObserved,
        run.playbackStateAtTerminal === 'ended'
    );
    assert.equal(run.platformRebootProven, false);
    assert.equal(run.interruptionCategory, null);
    assert.equal(reboot.classification, 'not-observed');
    assert.equal(reboot.platformRebootProven, false);
    assert.equal(reboot.continuousUptimeProven, true);
    assert.equal(phase.status, 'complete-hold-c3-aac-control-stable');
    assert.equal(phase.nextPhase.title, C3_AAC_CONTROL_CONTRACT.nextPhaseAfterStable);
}

function validateRebootOutcome(run, phase, reboot) {
    assert.equal(run.result, 'full-platform-reboot');
    assert.equal(run.displayResult, 'BLOCK — BASELINE REBOOTED');
    assert.equal(run.classification, 'synthetic-aac-control-full-platform-reboot');
    assert.equal(run.terminalMarkerCategory, 'full-platform-reboot-observed');
    assert.equal(run.decision, C3_AAC_CONTROL_CONTRACT.rebootDecision);
    assert.equal(run.stableDurationProven, false);
    assert.equal(run.countedObservationCompletedNormally, false);
    assert.equal(run.playbackStateAtTerminal, 'interrupted-by-platform-reboot');
    assert.equal(run.normalMediaCompletionObserved, false);
    assert.equal(run.platformRebootProven, true);
    assert.equal(run.interruptionCategory, 'full-platform-reboot');
    assert.equal(reboot.classification, 'full-platform-reboot');
    assert.equal(reboot.platformRebootProven, true);
    assert.equal(reboot.visualRebootObserved, true);
    assert.equal(reboot.completeNetworkDisappearanceObserved, true);
    assert.equal(reboot.lowPostRecoveryUptimeObserved, true);
    assert.equal(reboot.postRecoveryUptimeSampleCount, 2);
    assert.equal(reboot.postRecoverySamplesConsistent, true);
    assert.equal(reboot.validationApplicationAbsentAfterBoot, true);
    assert.equal(reboot.derivedBootTimeConsistent, true);
    assert.equal(reboot.derivedBootTimeRetained, false);
    assert.equal(reboot.applicationRelaunchCount, 0);
    assert.equal(phase.status, 'complete-block-c3-aac-control-rebooted');
    assert.equal(phase.nextPhase.title, C3_AAC_CONTROL_CONTRACT.nextPhaseAfterReboot);
}

function validateInconclusiveOutcome(run, phase, reboot) {
    assert.equal(run.result, 'interrupted');
    assert.equal(run.displayResult, 'HOLD — INCONCLUSIVE');
    assert.equal(run.classification, 'synthetic-aac-control-inconclusive');
    assert.equal(run.terminalMarkerCategory, 'counted-interval-inconclusive');
    assert.equal(run.decision, C3_AAC_CONTROL_CONTRACT.inconclusiveDecision);
    assert.equal(run.stableDurationProven, false);
    assert.equal(run.countedObservationCompletedNormally, false);
    assert.equal(run.normalMediaCompletionObserved, false);
    assert.equal(INCONCLUSIVE_CATEGORIES.includes(run.interruptionCategory), true);
    assert.equal(run.platformRebootCorrelatedToDirectPlayControl, false);
    assert.equal(reboot.correlationClaimed, false);
    assert.equal(phase.status, 'complete-hold-c3-aac-control-inconclusive');
    assert.equal(phase.nextPhase.title, C3_AAC_CONTROL_CONTRACT.nextPhaseAfterInconclusive);
}

function validateStableDeliveryUnprovenOutcome(run, phase, reboot) {
    assert.equal(run.result, 'stable-delivery-unproven');
    assert.equal(
        run.displayResult,
        'HOLD — INCONCLUSIVE'
    );
    assert.equal(
        run.classification,
        'synthetic-aac-control-stable-delivery-unproven'
    );
    assert.equal(run.terminalMarkerCategory, 'stable-duration-confirmed');
    assert.equal(run.decision, C3_AAC_CONTROL_CONTRACT.inconclusiveDecision);
    assert.equal(
        run.observedDurationSeconds >= C3_AAC_CONTROL_CONTRACT.minimumStableSeconds,
        true
    );
    assert.equal(run.stableDurationProven, true);
    assert.equal(run.countedObservationCompletedNormally, true);
    assert.equal(run.playbackStateAtTerminal, 'playing');
    assert.equal(run.normalMediaCompletionObserved, true);
    assert.equal(run.completionObservedAfterCountedInterval, true);
    assert.equal(run.platformRebootProven, false);
    assert.equal(run.interruptionCategory, 'delivery-unproven');
    assert.equal(run.stablePhysicalObservationPromotedToPass, false);
    assert.equal(
        run.applicationStateAtCleanup,
        'already-not-running-after-normal-completion'
    );
    assert.equal(run.platformRebootCorrelatedToDirectPlayControl, false);
    assert.equal(reboot.classification, 'not-observed');
    assert.equal(reboot.platformRebootProven, false);
    assert.equal(reboot.continuousUptimeProven, true);
    assert.equal(reboot.correlationClaimed, false);
    assert.equal(
        phase.status,
        'complete-hold-c3-aac-control-stable-delivery-unproven'
    );
    assert.equal(
        phase.nextPhase.title,
        C3_AAC_CONTROL_CONTRACT.nextPhaseAfterInconclusive
    );
}

function validateRunAndPhase(run, phase, reboot) {
    assert.equal(run.schemaVersion, 1);
    assert.equal(run.run, C3_AAC_CONTROL_CONTRACT.runDirectory);
    assert.equal(['DirectPlay', 'unproven'].includes(run.actualDeliveryMode), true);
    if (['stable', 'full-platform-reboot'].includes(run.result)) {
        assert.equal(run.actualDeliveryMode, 'DirectPlay');
    }
    assert.equal(run.physicalPlaybackStart, true);
    assert.equal(run.playbackStartAtZero, true);
    assert.equal(
        Number.isInteger(run.countedInterval.postStartPhysicalInputCount),
        true
    );
    assert.equal(run.countedInterval.postStartPhysicalInputCount >= 0, true);
    assert.equal(Number.isInteger(run.countedInterval.queryAndPollingCount), true);
    assert.equal(run.countedInterval.queryAndPollingCount >= 0, true);
    if (run.result !== 'interrupted') {
        assert.equal(run.countedInterval.postStartPhysicalInputCount, 0);
        assert.equal(run.countedInterval.queryAndPollingCount, 0);
    }
    assert.equal(run.observedDurationSeconds, run.countedInterval.observedDurationSeconds);
    assert.equal(run.productionContactCount, 0);
    assert.equal(run.productionModified, false);
    assert.equal(run.productSourceModified, false);
    assert.equal(run.ownershipBoundariesModified, false);
    assert.equal(run.rawMediaOrSessionIdentityRetained, false);
    assert.deepEqual(run.dtsActivity, DTS_ZERO_ACTIVITY);
    assert.equal(run.candidateRuntimeDeliveryProven, false);
    assert.equal(run.futureDtsRunAuthorized, false);
    assert.equal(
        [
            'already-not-running-after-normal-completion',
            'closed-by-command'
        ].includes(run.applicationStateAtCleanup),
        true
    );

    assert.equal(
        phase.schemaVersion,
        'ptv-webos-native-media-isolation-c3-aac-control-summary-v1'
    );
    assert.equal(phase.phase, C3_AAC_CONTROL_CONTRACT.phase);
    assert.equal(phase.decision, run.decision);
    assert.equal(phase.run.directory, C3_AAC_CONTROL_CONTRACT.runDirectory);
    assert.equal(phase.run.result, run.result);
    assert.equal(phase.run.actualDeliveryMode, run.actualDeliveryMode);
    assert.equal(phase.run.observedDurationSeconds, run.observedDurationSeconds);
    assert.equal(
        phase.run.postStartInputCount,
        run.countedInterval.postStartPhysicalInputCount
    );
    assert.deepEqual(phase.run.dtsActivity, DTS_ZERO_ACTIVITY);
    assert.equal(phase.run.futureDtsRunAuthorized, false);
    assert.equal(phase.productionContactCount, 0);
    assert.equal(phase.productionModified, false);
    assert.equal(phase.productSourceModified, false);
    assert.equal(phase.productionServerConfigurationModified, false);
    assert.equal(phase.productionLibraryDataModified, false);
    assert.equal(phase.ownershipBoundariesModified, false);
    assert.equal(phase.dtsCandidateRunPerformed, false);
    assert.equal(phase.dtsCandidateRunAuthorized, false);
    assert.equal(phase.nextPhase.separateApprovalRequired, true);
    assert.equal(phase.nextPhase.automaticLaunch, false);

    if (run.result === 'stable') {
        validateStableOutcome(run, phase, reboot);
    } else if (run.result === 'full-platform-reboot') {
        validateRebootOutcome(run, phase, reboot);
    } else if (run.result === 'stable-delivery-unproven') {
        validateStableDeliveryUnprovenOutcome(run, phase, reboot);
    } else {
        validateInconclusiveOutcome(run, phase, reboot);
    }
}

function validateUptime(before, after, run, reboot, timeline) {
    assert.equal(before.schemaVersion, 1);
    assert.equal(after.schemaVersion, 1);
    assert.equal(before.sampleCount, 1);
    assert.equal(before.bootIdentifierRetained, false);
    assert.equal(after.bootIdentifierRetained, false);
    assert.equal(typeof before.uptimeSeconds, 'number');
    assert.equal(before.uptimeSeconds > 0, true);
    const beforeAt = parseTimestamp(before.observedAt, 'uptime before');
    const afterAt = parseTimestamp(after.observedAt, 'uptime after');
    assert.equal(beforeAt < timeline.startAt, true);
    assert.equal(timeline.terminalAt < afterAt, true);

    if (['stable', 'stable-delivery-unproven'].includes(run.result)) {
        assert.equal(after.sampleCount, 1);
        assert.equal(after.increasedFromPreRun, true);
        assert.equal(after.platformRebootProven, false);
        assert.equal(after.continuousUptimeProven, true);
        assert.equal(after.uptimeSeconds > before.uptimeSeconds, true);
        const wallDelta = (afterAt - beforeAt) / 1000;
        const uptimeDelta = after.uptimeSeconds - before.uptimeSeconds;
        assert.equal(
            Math.abs(wallDelta - uptimeDelta) <= UPTIME_WALL_TOLERANCE_SECONDS,
            true
        );
    } else if (run.result === 'full-platform-reboot') {
        assert.equal(after.sampleCount, 2);
        assert.equal(after.platformRebootProven, true);
        assert.equal(after.lowPostRecoveryUptimeObserved, true);
        assert.equal(after.postRecoverySamplesConsistent, true);
        assert.equal(reboot.postRecoveryUptimeSampleCount, after.sampleCount);
    } else {
        assert.equal(['not-proven', 'proven'].includes(after.rebootProofState), true);
        assert.equal(run.platformRebootProven, after.rebootProofState === 'proven');
    }
}

function validateLaunch(launch, approval, run) {
    assert.equal(launch.schemaVersion, 1);
    assert.equal(launch.launchAttemptCount, 1);
    assert.equal(launch.launchSucceeded, true);
    assert.equal(launch.automaticLaunch, false);
    assert.equal(launch.rawLaunchOutputRetained, false);
    assert.equal(launch.relaunchCount, 0);
    assert.equal(launch.countedRunStarted, true);
    assert.equal(launch.playbackStartCount, 1);
    assert.equal(launch.playbackStartedAt, run.countedInterval.startedAt);
    assert.equal(approval.countedPlaybackStartCount, launch.playbackStartCount);
}

function validateCleanup(cleanup, staticDelivery, server, timeline, run) {
    assert.equal(cleanup.schemaVersion, 1);
    const cleanupAt = parseTimestamp(cleanup.completedAt, 'cleanup completion');
    assert.equal(cleanupAt, timeline.cleanupAt);
    assert.equal(
        cleanup.validationApplicationClosedByCommand,
        run.result !== 'full-platform-reboot'
            && run.applicationStateAtCleanup
                !== 'already-not-running-after-normal-completion'
    );
    assert.equal(cleanup.validationApplicationPresentAfterCleanup, false);
    assert.equal(cleanup.validationApplicationAbsenceConfirmed, true);
    assert.equal(cleanup.validationApplicationCloseCommandIssued, true);
    assert.equal(
        cleanup.validationApplicationAlreadyAbsentAtCloseCommand,
        run.applicationStateAtCleanup
            === 'already-not-running-after-normal-completion'
    );
    assert.equal(cleanup.validationApplicationUninstalled, true);
    assert.equal(cleanup.validationApplicationRelaunched, false);
    assert.equal(cleanup.temporaryValidationSessionInvalidated, true);
    assert.equal(cleanup.validationApplicationTestStorageCleared, true);
    assert.equal(cleanup.staticServerOwnershipVerified, true);
    assert.equal(cleanup.staticServerProcessPresent, false);
    assert.equal(cleanup.staticListenerCount, 0);
    assert.equal(cleanup.isolatedServerStopped, true);
    assert.equal(typeof cleanup.isolatedServerRemoved, 'boolean');
    assert.equal(
        cleanup.isolatedServerStateRetainedOffline,
        !cleanup.isolatedServerRemoved
    );
    assert.equal(cleanup.isolatedNetworkRemoved, true);
    assert.equal(cleanup.temporaryCredentialsDestroyed, true);
    if (cleanup.isolatedServerRemoved) {
        assert.equal(cleanup.temporaryTestAccountRemoved, true);
        assert.equal(cleanup.temporaryConfigurationRemoved, true);
        assert.equal(cleanup.temporaryDatabaseRemoved, true);
        assert.equal(cleanup.temporaryCacheRemoved, true);
        assert.equal(cleanup.temporaryLibraryRemoved, true);
    } else {
        assert.equal(cleanup.temporaryTestAccountDisabled, true);
        assert.equal(cleanup.retainedServerListenerCount, 0);
        assert.equal(cleanup.retainedServerNetworkExposure, false);
        assert.equal(cleanup.retainedServerStateSecured, true);
    }
    assert.equal(cleanup.finalPairRetained, true);
    assert.equal(cleanup.finalPairSealedReadOnly, true);
    assert.equal(cleanup.candidateTouchedDuringRun, false);
    assert.deepEqual(cleanup.dtsActivity, DTS_ZERO_ACTIVITY);
    assert.equal(cleanup.productionCleanupNeeded, false);
    assert.equal(cleanup.productionModified, false);
    assert.equal(cleanup.televisionPersistentConfigurationModified, false);
    assert.equal(cleanup.ownedTemporaryResourcesAbsent, true);
    assert.equal(cleanup.forbiddenHelpers.total, 0);
    assert.equal(
        Object.entries(cleanup.forbiddenHelpers)
            .filter(([name]) => name !== 'total')
            .every(([, count]) => count === 0),
        true
    );

    assert.equal(staticDelivery.schemaVersion, 1);
    assert.equal(staticDelivery.serverActiveDuringCountedInterval, true);
    assert.equal(staticDelivery.serverActiveAfterCleanup, false);
    assert.equal(staticDelivery.serverCount, 1);
    assert.equal(
        staticDelivery.serverScriptSha256,
        '8b8d4c66f9bd18a0bb033eda2ac424ae95633563fb221846a16cd8a293e6cb81'
    );
    assert.deepEqual(
        Object.fromEntries(
            staticDelivery.servedArtifacts.map(artifact => [artifact.name, artifact.sha256])
        ),
        EXPECTED_BUILD.artifacts
    );
    assert.equal(staticDelivery.exactArtifactsMatched, true);
    assert.equal(staticDelivery.developmentServerClientPresent, false);
    assert.equal(staticDelivery.rendererInjectionDetected, false);
    assert.equal(staticDelivery.rawRequestDataRetained, false);
    assert.equal(staticDelivery.listenerRemoved, true);
    assert.equal(server.removedDuringCleanup, cleanup.isolatedServerRemoved);
}

function validateComparison(matrix, run) {
    assert.equal(matrix.schemaVersion, 1);
    assert.equal(matrix.runs.length, 1);
    const [control] = matrix.runs;
    assert.equal(control.run, C3_AAC_CONTROL_CONTRACT.runDirectory);
    assert.equal(control.role, 'paired-control');
    assert.equal(control.result, run.result);
    assert.equal(control.deliveryMode, run.actualDeliveryMode);
    assert.equal(
        control.postStartInputCount,
        run.countedInterval.postStartPhysicalInputCount
    );
    assert.equal(
        control.queryAndPollingCount,
        run.countedInterval.queryAndPollingCount
    );
    assert.equal(control.durationSeconds, run.observedDurationSeconds);
    assert.equal(control.platformRebootProven, run.platformRebootProven);
    assert.deepEqual(control.dtsActivity, DTS_ZERO_ACTIVITY);
    assert.equal(matrix.pairedCandidate.authorized, false);
    assert.equal(matrix.pairedCandidate.performed, false);
    assert.equal(matrix.pairedCandidate.runtimeDeliveryProven, false);
    assert.equal(matrix.comparisonsPerformed, 0);
    assert.equal(matrix.interpretation, 'control-only-no-audio-codec-comparison');
    assert.equal(matrix.decision, run.decision);
}

function validatePreparationComparison(comparison, fixture, run) {
    assert.equal(comparison.schemaVersion, 1);
    assert.equal(
        comparison.preparedEvidenceDirectory,
        C3_AAC_CONTROL_CONTRACT.preparedEvidenceDirectory
    );
    assert.deepEqual(
        comparison.preparedEvidenceHashes,
        C3_AAC_CONTROL_CONTRACT.preparedEvidenceHashes
    );
    assert.equal(comparison.controlRoleSelected, true);
    assert.equal(comparison.controlAssetSha256, C3_AAC_CONTROL_CONTRACT.controlAssetSha256);
    assert.equal(comparison.controlHashReverifiedBeforeLaunch, true);
    assert.equal(comparison.preparationPredictionOnly, true);
    assert.equal(comparison.runtimeDirectPlayReproofRequired, true);
    assert.equal(
        comparison.runtimeDirectPlayReproofCompleted,
        run.actualDeliveryMode === 'DirectPlay'
    );
    assert.equal(
        comparison.runtimeDirectPlayReproofFailed,
        run.actualDeliveryMode === 'unproven'
    );
    assert.equal(comparison.candidateExcluded, true);
    assert.deepEqual(comparison.dtsActivity, DTS_ZERO_ACTIVITY);
    assert.equal(comparison.controlAssetSha256, fixture.selectedAssetSha256);
}

function validateReports(root, run, phase) {
    const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(/\s+/gu, ' ');
    const report = readFileSync(join(root, 'final-report.md'), 'utf8').replace(/\s+/gu, ' ');
    assert.equal(readme.includes(C3_AAC_CONTROL_CONTRACT.phase), true);
    assert.equal(report.includes(run.decision), true);
    assert.equal(report.includes(phase.nextPhase.title), true);
    assert.equal(report.includes('Exactly one next phase'), true);
    assert.equal(report.includes('separate explicit approval'), true);
    assert.equal(
        report.includes(
            'The DTS candidate was not staged, mounted, indexed, queried, requested, or played.'
        ),
        true
    );
    assert.equal(report.includes('Production was not contacted or modified.'), true);
    assert.equal((report.match(/Exactly one next phase/gu) || []).length, 1);
    if (run.result === 'stable') {
        assert.equal(
            report.includes('HOLD — BASELINE STABLE, COMPARISONS INCOMPLETE'),
            true
        );
        assert.equal(report.includes('does not prove the path safe'), true);
    } else if (run.result === 'full-platform-reboot') {
        assert.equal(report.includes('BLOCK — BASELINE REBOOTED'), true);
    } else {
        assert.equal(report.includes('HOLD — INCONCLUSIVE'), true);
        if (run.result === 'stable-delivery-unproven') {
            assert.equal(
                report.includes(
                    'The stable physical observation is not promoted to PASS.'
                ),
                true
            );
        }
    }
}

export function validateNativeMediaIsolationC3AacControlPreparedReference(root) {
    const priorRoot = resolve(root, '..', C3_AAC_CONTROL_CONTRACT.preparedEvidenceDirectory);
    const files = {
        'artifact-inventory.json':
            C3_AAC_CONTROL_CONTRACT.preparedEvidenceHashes.artifactInventory,
        'pair-manifest.json':
            C3_AAC_CONTROL_CONTRACT.preparedEvidenceHashes.pairManifest,
        'pair-equivalence.json':
            C3_AAC_CONTROL_CONTRACT.preparedEvidenceHashes.pairEquivalence,
        'delivery-prediction.json':
            C3_AAC_CONTROL_CONTRACT.preparedEvidenceHashes.deliveryPrediction
    };
    for (const [relativePath, expectedHash] of Object.entries(files)) {
        const path = join(priorRoot, relativePath);
        assert.equal(existsSync(path), true, `Missing prepared evidence: ${relativePath}`);
        assert.equal(sha256(path), expectedHash, `Prepared evidence drift: ${relativePath}`);
    }
}

export function validateNativeMediaIsolationC3AacControlOutcome(root) {
    const runRoot = join(root, C3_AAC_CONTROL_CONTRACT.runDirectory);
    const approval = readJson(join(runRoot, 'approval.json'));
    const build = readJson(join(runRoot, 'build-identity.json'));
    const candidateExclusion = readJson(join(runRoot, 'candidate-exclusion.json'));
    const cleanup = readJson(join(runRoot, 'cleanup.json'));
    const delivery = readJson(join(runRoot, 'delivery-mode.json'));
    const device = readJson(join(runRoot, 'device-state-before.json'));
    const fixture = readJson(join(runRoot, 'fixture-lineage.json'));
    const instrumentation = readJson(join(runRoot, 'instrumentation-absence.json'));
    const launch = readJson(join(runRoot, 'launch-summary.json'));
    const markers = readNdjson(join(runRoot, 'operator-markers.ndjson'));
    const media = readJson(join(runRoot, 'media-category.json'));
    const matrix = readJson(join(root, 'comparison-matrix.json'));
    const preparationComparison = readJson(join(root, 'comparison-to-c3-preparation.json'));
    const phase = readJson(join(root, 'phase-summary.json'));
    const reboot = readJson(join(runRoot, 'reboot-proof.json'));
    const run = readJson(join(runRoot, 'run-summary.json'));
    const server = readJson(join(runRoot, 'isolated-server-boundary.json'));
    const staticDelivery = readJson(join(runRoot, 'static-delivery-summary.json'));
    const uptimeAfter = readJson(join(runRoot, 'uptime-after.json'));
    const uptimeBefore = readJson(join(runRoot, 'uptime-before.json'));

    validateApproval(approval, launch);
    validateBuild(build);
    validateCandidateExclusion(candidateExclusion);
    validateFixtureReference(fixture);
    validateMedia(media);
    validateServerBoundary(server);
    validateDelivery(delivery, run);
    validateInstrumentation(instrumentation, run);
    validateDevice(device);
    validateLaunch(launch, approval, run);
    validateRunAndPhase(run, phase, reboot);
    const timeline = validateMarkers(markers, run);
    validateUptime(uptimeBefore, uptimeAfter, run, reboot, timeline);
    validateCleanup(cleanup, staticDelivery, server, timeline, run);
    validateComparison(matrix, run);
    validatePreparationComparison(preparationComparison, fixture, run);
    validateReports(root, run, phase);

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
    assert.equal(
        [
            instrumentation.countedInterval.periodicProcessResourcePolling,
            instrumentation.countedInterval.appPresenceQueries,
            instrumentation.countedInterval.networkProbes,
            instrumentation.countedInterval.serverQueries,
            instrumentation.countedInterval.cdpOrInspectorAttachments,
            instrumentation.countedInterval.rendererOrBrowserInjections,
            instrumentation.countedInterval.syntheticOrDeveloperInputs
        ].reduce((sum, count) => sum + count, 0),
        run.countedInterval.queryAndPollingCount
    );
    assert.equal(run.countedInterval.startedAt, markers[0].observedAt);
    assert.equal(run.countedInterval.endedAt, markers.find(
        marker => marker.category === run.terminalMarkerCategory
    ).observedAt);
    const deliveryMarkerCategory = run.actualDeliveryMode === 'DirectPlay' ?
        'post-count-directplay-proven' :
        'post-count-delivery-unproven';
    assert.equal(delivery.actualRunDecision.observedAt, markers.find(
        marker => marker.category === deliveryMarkerCategory
    ).observedAt);
    assert.equal(cleanup.completedAt, markers.find(
        marker => marker.category === 'post-run-cleanup-complete'
    ).observedAt);
}

export function validateNativeMediaIsolationC3AacControlEvidence(evidenceRoot) {
    const root = resolve(evidenceRoot);
    assert.equal(existsSync(root), true, 'Evidence root does not exist');
    for (const path of REQUIRED_FILES) {
        assert.equal(existsSync(join(root, path)), true, `Missing evidence file: ${path}`);
    }
    validateNativeMediaIsolationC3AacControlPreparedReference(root);
    validateNativeMediaIsolationPrivacy(root, true);
    validateNativeMediaIsolationKnownPrivateValueScan(root);
    validateNativeMediaIsolationC3AacControlOutcome(root);
    validateNativeMediaIsolationRepeatInventory(root);
    return {
        status: 'PASS',
        schemaVersion:
            'ptv-webos-native-media-isolation-c3-aac-control-validation-v1',
        mode: 'final',
        evidenceRoot: 'privacy-redacted',
        approvalConsumptionValidated: true,
        exactBuildAndPreparedControlValidated: true,
        isolatedNonProductionBoundaryValidated: true,
        actualDeliveryProofRequirementEnforced: true,
        zeroInputAndInstrumentationValidated: true,
        uptimeAndRebootClassificationValidated: true,
        dtsNotAuthorizedAndZeroActivityValidated: true,
        cleanupValidated: true,
        privacyValidated: true,
        artifactInventoryValidated: true
    };
}

function main(argv) {
    assert.equal(
        argv.length,
        1,
        'Usage: validate-native-media-isolation-c3-aac-control-evidence.mjs <evidence-root>'
    );
    process.stdout.write(
        `${JSON.stringify(
            validateNativeMediaIsolationC3AacControlEvidence(argv[0]),
            null,
            2
        )}\n`
    );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
    main(process.argv.slice(2));
}
