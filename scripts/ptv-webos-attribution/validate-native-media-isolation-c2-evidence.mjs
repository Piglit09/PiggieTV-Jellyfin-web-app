import assert from 'node:assert/strict';
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
import { validateNativeMediaIsolationRepeatInventory } from './validate-native-media-isolation-repeat-evidence.mjs';

const RUN_DIRECTORY = 'run-04-c2-audio-channel-directstream';
const PHASE = 'PiggieTV WebOS Phase 3A.1R.2c';
const CONTROL = 'client-advertised-audio-channel-limit';
const CLASSIFICATION =
    'directplay-stable-vs-audio-limit-induced-directstream-correlation-only';
const AUDIO_CHANNEL_REASON = 'AudioChannelsNotSupported';
const ATTRIBUTION_PROOF_METHOD =
    'excluded-pre-count-setup-bound-by-same-in-memory-source-and-unchanged-state';
const ATTRIBUTION_LIMITATIONS = Object.freeze([
    'no-live-post-count-session',
    'actual-delivery-attributed-from-excluded-setup'
]);
const CLIENT_SETTING_EVIDENCE_METHOD =
    'operator-controlled-single-field-physical-ui-observation';
const CLIENT_SETTING_LIMITATION = 'complete-client-local-settings-not-digitally-snapshotted';
const DEPENDENT_OUTPUT_CHANGES = Object.freeze([
    'audio-channel-count',
    'audio-encode',
    'hls-container-and-segmentation'
]);
const ZERO_COUNTED_INTERVAL_QUERIES = Object.freeze({
    processOrResource: 0,
    appPresence: 0,
    network: 0,
    server: 0,
    inspectorOrCdp: 0
});
const COUNTED_INSTRUMENTATION =
    'zero-renderer-injection-zero-periodic-polling';
const SINGLE_RUN_LIMITATION = 'single-stable-run-not-proof-of-safety';
const TIME_TOLERANCE_SECONDS = 10;
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
    staticServerImplementation: 'python-standard-library-http-server',
    staticServerScriptSha256: null,
    implementationSameAsStableBaseline: false
});
const STABLE_BASELINE = Object.freeze({
    artifactInventorySha256: '3ec2125897384a2c7f035c3bdd2bd1120d6f83abba17719b5972d747f5b76c60',
    buildIdentitySha256: 'f5de0589775c977992758da96a38d0198a410f8c1d78b479cb19dba3bb601cbe',
    mediaCategorySha256: 'badcb6e710c0b4aa30c10710061e6dd834134d82856708e7215fe32d054fcb22',
    deliveryModeSha256: '4b1a533b9f9137568fffaf9b59b515b747db5cae123b2ceeb7299a7fc48b39f6',
    runSummarySha256: '7ea2f7d3b6aaff3fa521623d9ceffc00d8a6783ce84fbd58f53cf0bad9ad4800'
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
    `${RUN_DIRECTORY}/audio-channel-setting-boundary.json`,
    `${RUN_DIRECTORY}/build-identity.json`,
    `${RUN_DIRECTORY}/cleanup.json`,
    `${RUN_DIRECTORY}/delivery-mode.json`,
    `${RUN_DIRECTORY}/device-state-before.json`,
    `${RUN_DIRECTORY}/directstream-output-category.json`,
    `${RUN_DIRECTORY}/instrumentation-absence.json`,
    `${RUN_DIRECTORY}/launch-summary.json`,
    `${RUN_DIRECTORY}/media-category.json`,
    `${RUN_DIRECTORY}/operator-markers.ndjson`,
    `${RUN_DIRECTORY}/run-summary.json`,
    `${RUN_DIRECTORY}/server-user-configuration-boundary.json`,
    `${RUN_DIRECTORY}/static-delivery-summary.json`,
    `${RUN_DIRECTORY}/uptime-after.json`,
    `${RUN_DIRECTORY}/uptime-before.json`
]);

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
    const parsed = Date.parse(value);
    assert.equal(Number.isFinite(parsed), true, `${label} must be an ISO timestamp`);
    return parsed;
}

function assertDirectStreamSignature(value, label) {
    assert.equal(value.selectedDeliveryCategory, 'DirectStream', `${label} category`);
    assert.equal(value.videoDirect, true, `${label} video must be copied`);
    assert.equal(value.videoTranscode, false, `${label} video must not be encoded`);
    assert.equal(value.audioDirect, false, `${label} audio must not be direct`);
    assert.equal(value.audioTranscode, true, `${label} audio must be encoded`);
    assert.equal(value.containerRemux, true, `${label} must use a remuxed container`);
    assert.equal(value.outputContainerFamily, 'hls', `${label} container family`);
    assert.equal(value.segmentContainerCategory, 'ts', `${label} segment container`);
    assert.equal(value.subtitleBurnIn, false, `${label} must not burn subtitles`);
    assert.equal(value.candidateCount, 1, `${label} candidate count`);
    assert.deepEqual(
        value.transcodeReasons,
        [AUDIO_CHANNEL_REASON],
        `${label} must retain only the expected audio-channel reason`
    );
}

function assertRequiredLimitations(actual, required, label) {
    assert.equal(Array.isArray(actual), true, `${label} must be an array`);
    for (const limitation of required) {
        assert.equal(actual.includes(limitation), true, `${label} missing ${limitation}`);
    }
}

function assertSetupBoundAttribution(value, label) {
    assert.equal(value.selectedDeliveryCategory, 'DirectStream', `${label} category`);
    assert.equal(value.proofMethod, ATTRIBUTION_PROOF_METHOD, `${label} proof method`);
    assert.equal(value.countedPlaybackCompletedNormally, true, `${label} completion`);
    assert.equal(value.postCountMatchingActiveSessionCount, 0, `${label} post-count matches`);
    assert.equal(
        value.livePostCountDeliveryCandidateObserved,
        false,
        `${label} live post-count candidate`
    );
    assert.equal(value.sameSourceVerifiedInMemory, true, `${label} source binding`);
    assert.equal(value.sourceIdentityRetained, false, `${label} source identity retention`);
    assert.equal(value.audioChannelSettingUnchanged, true, `${label} audio setting state`);
    assert.equal(value.subtitleStateUnchanged, true, `${label} subtitle state`);
    assertRequiredLimitations(value.limitations, ATTRIBUTION_LIMITATIONS, `${label} limitations`);
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
    assert.equal(build.staticServerImplementation, EXPECTED_BUILD.staticServerImplementation);
    assert.equal(build.staticServerScriptSha256, EXPECTED_BUILD.staticServerScriptSha256);
    assert.equal(
        build.implementationSameAsStableBaseline,
        EXPECTED_BUILD.implementationSameAsStableBaseline
    );

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
    assert.equal(media.channelLayout, 'stereo');
    assert.equal(media.audioStreamCount, 1);
    assert.equal(media.resolution.width, 1904);
    assert.equal(media.resolution.height, 1072);
    assert.equal(media.frameRate.average, 23.976);
    assert.equal(media.frameRate.real, 23.976);
    assert.equal(media.frameRate.constantOrConventional, true);
    assert.equal(media.bitDepth, 8);
    assert.equal(media.chromaFormat, 'yuv420p');
    assert.equal(media.dynamicRange, 'sdr');
    assert.equal(media.subtitleState, 'none');
    assert.equal(media.multipleVideoVersions, false);
    assert.equal(media.meetsBaselineRequirements, true);
}

function validateSettingBoundary(boundary) {
    assert.deepEqual(boundary.settingScope, {
        setting: 'allowedAudioChannels',
        mediaType: 'VideoAudio',
        storage: 'validation-app-local-per-user-setting'
    });
    assert.deepEqual(boundary.original, {
        value: 'Auto',
        numericValue: -1,
        observedAt: boundary.original.observedAt,
        physicallyVerified: true
    });
    assert.equal(boundary.temporary.value, 'Mono');
    assert.equal(boundary.temporary.numericValue, 1);
    assert.equal(boundary.temporary.applicationMethod, 'existing-physical-webos-ui');
    assert.equal(boundary.temporary.physicallyVerified, true);
    assert.equal(boundary.deviceProfileConstraint.property, 'AudioChannels');
    assert.equal(boundary.deviceProfileConstraint.condition, 'LessThanEqual');
    assert.equal(boundary.deviceProfileConstraint.value, 1);
    assert.equal(boundary.deviceProfileConstraint.videoCapabilityOtherwiseUnchanged, true);
    assert.equal(boundary.effectiveClientPlaybackSettingDeltaCount, undefined);
    assert.equal(boundary.otherClientPlaybackSettingEffectiveDeltaCount, undefined);
    const clientEvidence = boundary.clientPlaybackSettingsComparisons;
    assert.equal(clientEvidence.evidenceMethod, CLIENT_SETTING_EVIDENCE_METHOD);
    assert.equal(clientEvidence.digitalSettingsSnapshotCaptured, false);
    assert.equal(clientEvidence.completeSettingsCompared, false);
    assert.equal(clientEvidence.operatorControlledFieldCount, 1);
    assert.deepEqual(clientEvidence.operatorControlledFieldPaths, ['allowedAudioChannels']);
    assert.equal(clientEvidence.otherEffectiveSettingsDeltaProvenAbsent, false);
    assert.equal(clientEvidence.rawSettingsRetained, false);
    assertRequiredLimitations(
        clientEvidence.limitations,
        [CLIENT_SETTING_LIMITATION],
        'client setting limitations'
    );
    assert.equal(boundary.restoration.required, true);
    assert.equal(boundary.restoration.targetValue, 'Auto');
    assert.equal(boundary.restoration.targetNumericValue, -1);
    assert.equal(boundary.restoration.applicationMethod, 'existing-physical-webos-ui');
    assert.equal(boundary.restoration.physicallyVerified, true);
    assert.equal(boundary.restoration.physicalUiAutoConfirmed, true);
    assert.equal(boundary.restoration.physicalUiSaveConfirmed, true);
    assert.equal(boundary.restoration.exactOriginalValueRestored, true);
    assert.equal(boundary.restoration.noPostRestorationPlayback, true);
    assert.equal(boundary.restoration.postRestorationPlaybackCount, 0);
    assert.equal(boundary.restoration.additionalPlaybackAuthorized, false);
    assert.equal(boundary.restoration.separateRebootRiskAuthorized, false);
    assert.equal(boundary.persistentChangeRemaining, undefined);
    assert.equal(boundary.targetSettingPersistentChangeRemaining, false);
    assert.equal(boundary.intendedChangedDimension, CONTROL);
    assert.deepEqual(boundary.operatorControlledChanges, [CONTROL]);
    assert.deepEqual(boundary.dependentOutputChanges, DEPENDENT_OUTPUT_CHANGES);
    assert.equal(boundary.productSourceModified, false);
    assert.equal(boundary.serverConfigurationModified, false);
    assert.equal(boundary.restorationDeliveryVerification, undefined);
}

function validateConfigurationComparison(comparison) {
    assert.equal(comparison.scope, 'server-stored-user-configuration');
    assert.equal(comparison.proofMethod, 'bounded-pre-post-deep-equality-in-memory');
    assert.equal(comparison.rawConfigurationRetained, false);
    assert.equal(comparison.noServerWriteClaimed, false);
    assert.equal(comparison.noServerSideEffectProven, false);
    assert.equal(comparison.totalUpdateUserConfigurationCallCount, 2);
    assert.equal(comparison.effectiveServerConfigurationValueDelta, false);
    assert.equal(comparison.serverConfigurationModified, false);

    for (const [name, save] of Object.entries({
        apply: comparison.applySave,
        restoration: comparison.restorationSave
    })) {
        assert.equal(save.updateUserConfigurationCallCount, 1, `${name} update count`);
        assert.equal(save.serverWriteOccurred, true, `${name} write disclosure`);
        assert.equal(save.beforeSnapshotCaptured, true, `${name} before snapshot`);
        assert.equal(save.afterSnapshotCaptured, true, `${name} after snapshot`);
        assert.equal(save.completeConfigurationCompared, true, `${name} complete comparison`);
        assert.equal(save.changedPropertyCount, 0, `${name} changed properties`);
        assert.deepEqual(save.changedPropertyPaths, [], `${name} changed property paths`);
        assert.equal(save.proofOutsideCountedInterval, true, `${name} proof timing`);
    }
}

function validateDelivery(delivery, output) {
    assert.equal(delivery.preRunBaselineDeliveryCategory, 'DirectPlay');
    assert.equal(delivery.requestedDeliveryCategory, 'DirectStream');
    assertDirectStreamSignature(delivery.setupVerification, 'setup delivery');
    assert.equal(delivery.setupVerification.excludedFromCountedCandidateCount, true);
    assert.equal(delivery.setupVerification.rawRecordRetained, false);
    assertSetupBoundAttribution(delivery.actualRunDecision, 'actual delivery attribution');
    assert.equal(delivery.actualRunDecision.postRunServerReadQueries, 1);
    assert.equal(delivery.actualRunDecision.rawRecordRetained, false);
    assert.equal(delivery.actualRunDecision.independentlyObservedCountedSignature, false);
    assert.equal(delivery.actualRunDecision.setupSegmentContainerCategory, 'ts');
    assert.equal(delivery.countedIntervalServerQueries, 0);
    assert.equal(Number.isInteger(delivery.preCountDiagnosticServerReadCount), true);
    assert.equal(delivery.preCountDiagnosticServerReadCount > 0, true);
    assert.equal(delivery.setupDeliveryCandidatesExcluded, true);
    assert.equal(delivery.countableAsConditionalC2Correlation, true);
    assert.equal(delivery.cleanSingleVariableComparisonProven, false);

    assert.equal(output.deliveryCategory, 'DirectStream');
    assertDirectStreamSignature(output, 'excluded setup output category');
    assert.equal(output.observationBoundary, 'excluded-pre-count-setup');
    assert.equal(output.proofMethod, ATTRIBUTION_PROOF_METHOD);
    assert.equal(output.appliesToCountedRunThroughBoundedAttribution, true);
    assert.equal(output.countedRunOutputIndependentlyObserved, false);
    assert.equal(output.postCountMatchingActiveSessionCount, 0);
    assertRequiredLimitations(
        output.limitations,
        ATTRIBUTION_LIMITATIONS,
        'output attribution limitations'
    );
    assert.equal(output.source.videoCodec, 'h264-avc');
    assert.equal(output.source.audioCodec, 'aac-lc');
    assert.equal(output.source.audioChannels, 2);
    assert.equal(output.source.container, 'mp4');
    assert.equal(output.output.videoCodec, 'h264');
    assert.equal(output.output.audioCodec, 'aac');
    assert.equal(output.output.audioChannels, 1);
    assert.equal(output.output.containerFamily, 'hls');
    assert.equal(output.output.segmentContainerCategory, 'ts');
    assert.equal(output.segmentContainerCategory, output.output.segmentContainerCategory);
    assert.equal(output.output.width, output.source.width);
    assert.equal(output.output.height, output.source.height);
    assert.deepEqual(output.dependentOutputChanges, DEPENDENT_OUTPUT_CHANGES);
    assert.equal(output.strictSingleEncodedOutputDimensionProven, false);
    assert.equal(output.rawRecordRetained, false);
    assert.equal(output.exactSourceOrOutputBitrateRetained, false);
}

function validateInstrumentation(instrumentation) {
    assert.equal(instrumentation.preflight.forbiddenHelperTotal, 0);
    assert.equal(
        Object.entries(instrumentation.preflight)
            .filter(([name]) => !['forbiddenHelperTotal', 'staticServerCount'].includes(name))
            .every(([, count]) => count === 0),
        true
    );
    assert.equal([0, 1].includes(instrumentation.preflight.staticServerCount), true);
    const preCount = instrumentation.preCountDiagnostics;
    assert.equal(preCount.disclosed, true);
    assert.equal(preCount.bounded, true);
    assert.equal(preCount.nonPeriodic, true);
    assert.equal(preCount.occurredOutsideCountedInterval, true);
    assert.equal(Number.isInteger(preCount.serverQueryCount), true);
    assert.equal(preCount.serverQueryCount > 0, true);
    assert.equal(preCount.periodicPollingCount, 0);
    const postCount = instrumentation.postCountRead;
    assert.equal(postCount.disclosed, true);
    assert.equal(postCount.bounded, true);
    assert.equal(postCount.nonPeriodic, true);
    assert.equal(postCount.occurredOutsideCountedInterval, true);
    assert.equal(postCount.serverQueryCount, 1);
    assert.equal(postCount.matchingActiveSessionCount, 0);
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
    const baseline = comparison.stableBaselineReference;
    assert.equal(baseline.phase, 'PiggieTV WebOS Phase 3A.1R.2a');
    assert.equal(baseline.run, 'run-02-same-baseline-repeat');
    assert.equal(baseline.artifactInventorySha256, STABLE_BASELINE.artifactInventorySha256);
    assert.equal(baseline.buildIdentitySha256, STABLE_BASELINE.buildIdentitySha256);
    assert.equal(baseline.mediaCategorySha256, STABLE_BASELINE.mediaCategorySha256);
    assert.equal(baseline.deliveryModeSha256, STABLE_BASELINE.deliveryModeSha256);
    assert.equal(baseline.runSummarySha256, STABLE_BASELINE.runSummarySha256);
    assert.equal(baseline.result, 'stable');
    assert.equal(baseline.observedDurationSeconds, 971);
    assert.equal(baseline.deliveryMode, 'DirectPlay');

    const planned = comparison.plannedComparison;
    assert.equal(planned.sameBuild, true);
    assert.equal(planned.sameWrapper, true);
    assert.equal(planned.samePhysicalDevice, true);
    assert.equal(planned.sameFirmware, true);
    assert.equal(planned.sameSourceVerifiedInMemory, true);
    assert.equal(planned.sameSourceIdentityRetained, false);
    assert.equal(planned.sameSubtitleState, true);
    assert.equal(planned.sameAudioTrack, true);
    assert.equal(planned.qualitySetting, 'Auto');
    assert.equal(planned.intendedChangedDimension, CONTROL);
    assert.equal(
        planned.deliveryTransition,
        'DirectPlay-to-audio-limit-induced-DirectStream'
    );
    assert.deepEqual(planned.operatorControlledChanges, [CONTROL]);
    assert.deepEqual(planned.dependentOutputChanges, DEPENDENT_OUTPUT_CHANGES);
    assert.equal(planned.operatorControlledFieldCount, 1);
    assert.equal(planned.completeClientSettingsCompared, false);
    assert.equal(planned.singleOperatorControlledChangeProven, false);
    assert.equal(planned.strictSingleIndependentVariableProven, false);
    assert.equal(planned.strictSingleEncodedOutputDimensionProven, false);
    assert.equal(planned.classification, CLASSIFICATION);

    assertSetupBoundAttribution(comparison.currentRun, 'comparison current run attribution');
    assert.equal(comparison.currentRun.actualDeliveryMode, 'DirectStream');
    assert.equal(comparison.currentRun.result, run.result);
    assert.equal(comparison.currentRun.observedDurationSeconds, run.observedDurationSeconds);
    assert.equal(comparison.currentRun.clientSettingRestored, true);
    assert.equal(comparison.currentRun.serverConfigurationEffectiveValueDelta, false);
    assert.equal(comparison.classification, CLASSIFICATION);
    assert.equal(comparison.isolationConclusion, 'inconclusive');

    assert.equal(matrix.runs.length, 2);
    const [stable, c2] = matrix.runs;
    assert.equal(stable.run, 'stable-baseline-reference');
    assert.equal(stable.evidenceFrozen, true);
    assert.equal(stable.result, 'stable');
    assert.equal(stable.durationSeconds, 971);
    assert.equal(stable.deliveryMode, 'DirectPlay');
    assert.equal(stable.exactBuildMatch, true);
    assert.equal(stable.mediaCategory, 'low-complexity-h264-aac-mp4-sdr');
    assert.equal(stable.changedDimension, 'none');
    assert.equal(stable.instrumentation, COUNTED_INSTRUMENTATION);
    assert.deepEqual(stable.countedIntervalQueries, ZERO_COUNTED_INTERVAL_QUERIES);
    assert.equal(stable.postStartInputCount, 0);
    assert.equal(stable.stableDurationProven, true);
    assert.equal(stable.platformRebootProven, false);
    assertRequiredLimitations(
        stable.evidenceLimitations,
        [SINGLE_RUN_LIMITATION],
        'stable baseline matrix limitations'
    );
    assert.equal(c2.run, RUN_DIRECTORY);
    assert.equal(c2.exactBuildMatch, true);
    assert.equal(c2.mediaCategory, 'same-low-complexity-h264-aac-mp4-sdr-source');
    assert.equal(c2.result, run.result);
    assert.equal(c2.durationSeconds, run.observedDurationSeconds);
    assert.equal(c2.deliveryMode, 'DirectStream');
    assertSetupBoundAttribution(c2, 'comparison matrix C2 attribution');
    assert.equal(c2.actualDeliveryMode, 'DirectStream');
    assert.equal(c2.intendedChangedDimension, CONTROL);
    assert.deepEqual(c2.operatorControlledChanges, [CONTROL]);
    assert.equal(c2.operatorControlledFieldCount, 1);
    assert.equal(c2.completeClientSettingsCompared, false);
    assert.equal(c2.singleOperatorControlledChangeProven, false);
    assert.equal(c2.strictSingleIndependentVariableProven, false);
    assert.equal(c2.strictSingleEncodedOutputDimensionProven, false);
    assert.equal(c2.instrumentation, COUNTED_INSTRUMENTATION);
    assert.deepEqual(c2.countedIntervalQueries, ZERO_COUNTED_INTERVAL_QUERIES);
    assert.equal(c2.postStartInputCount, 0);
    assert.equal(c2.stableDurationProven, true);
    assert.equal(c2.platformRebootProven, false);
    assertRequiredLimitations(
        c2.evidenceLimitations,
        [
            ...ATTRIBUTION_LIMITATIONS,
            CLIENT_SETTING_LIMITATION,
            SINGLE_RUN_LIMITATION
        ],
        'comparison matrix C2 limitations'
    );
    assert.equal(c2.classification, CLASSIFICATION);
    assert.equal(matrix.decision, run.decision);
    assert.equal(matrix.interpretationRule, 'correlation-only-not-root-causation');
}

function validateCleanup(cleanup, staticDelivery) {
    assert.equal(cleanup.validationApplicationClosedByCommand, true);
    assert.equal(cleanup.validationApplicationPresentAfterCleanup, false);
    assert.equal(cleanup.staticServerOwnershipVerified, true);
    assert.equal(cleanup.staticServerProcessPresent, false);
    assert.equal(cleanup.staticListenerCount, 0);
    assert.equal(cleanup.staticServerProcessIdentifierRetained, false);
    assert.equal(cleanup.relevantNodeHelperCount, 0);
    assert.equal(cleanup.forbiddenHelpers.total, 0);
    assert.equal(Object.values(cleanup.forbiddenHelpers).every(count => count === 0), true);
    assert.equal(staticDelivery.serverActiveDuringCountedInterval, true);
    assert.equal(staticDelivery.serverActiveAfterCleanup, false);
    assert.equal(staticDelivery.serverCount, 1);
    assert.equal(staticDelivery.serverCountScope, 'counted-interval');
    assert.equal(staticDelivery.servedArtifacts.length, 3);
    assert.deepEqual(
        Object.fromEntries(
            staticDelivery.servedArtifacts.map(artifact => [artifact.name, artifact.sha256])
        ),
        EXPECTED_BUILD.artifacts
    );
    assert.equal(staticDelivery.servedIndexSha256, EXPECTED_BUILD.artifacts['index.html']);
    assert.equal(staticDelivery.expectedIndexSha256, EXPECTED_BUILD.artifacts['index.html']);
    assert.equal(staticDelivery.exactIndexMatched, true);
    assert.equal(staticDelivery.rendererInjectionDetected, false);
    assert.equal(staticDelivery.rawRequestDataRetained, false);
    assert.equal(staticDelivery.staticServerOwnershipVerified, true);
    assert.equal(staticDelivery.processIdentifierRetained, false);
    assert.equal(staticDelivery.listenerRemoved, true);
}

function validateOutcomeDecision(run, phase, uptimeAfter) {
    assert.equal(run.decision, phase.decision);
    assert.equal(run.result, 'stable');
    assert.equal(run.stableDurationProven, true);
    assert.equal(run.countedPlaybackCompletedNormally, true);
    assert.equal(run.observedDurationSeconds, 915);
    assert.equal(run.observedDurationSeconds >= 900, true);
    assert.equal(run.platformRebootProven, false);
    assert.equal(uptimeAfter.platformRebootProven, false);
    assert.equal(run.decision, 'HOLD-media-comparisons-incomplete');
    assert.equal(run.isolationConclusion, 'inconclusive');
    assert.equal(phase.isolationConclusion, 'inconclusive');
}

export function validateNativeMediaIsolationC2Outcome(root) {
    const approval = readJson(join(root, RUN_DIRECTORY, 'approval.json'));
    const boundary = readJson(join(root, RUN_DIRECTORY, 'audio-channel-setting-boundary.json'));
    const cleanup = readJson(join(root, RUN_DIRECTORY, 'cleanup.json'));
    const comparison = readJson(join(root, 'comparison-to-stable-baseline.json'));
    const configuration = readJson(
        join(root, RUN_DIRECTORY, 'server-user-configuration-boundary.json')
    );
    const delivery = readJson(join(root, RUN_DIRECTORY, 'delivery-mode.json'));
    const device = readJson(join(root, RUN_DIRECTORY, 'device-state-before.json'));
    const instrumentation = readJson(join(root, RUN_DIRECTORY, 'instrumentation-absence.json'));
    const launch = readJson(join(root, RUN_DIRECTORY, 'launch-summary.json'));
    const markers = readNdjson(join(root, RUN_DIRECTORY, 'operator-markers.ndjson'));
    const matrix = readJson(join(root, 'comparison-matrix.json'));
    const output = readJson(join(root, RUN_DIRECTORY, 'directstream-output-category.json'));
    const phase = readJson(join(root, 'phase-summary.json'));
    const run = readJson(join(root, RUN_DIRECTORY, 'run-summary.json'));
    const staticDelivery = readJson(join(root, RUN_DIRECTORY, 'static-delivery-summary.json'));
    const uptimeAfter = readJson(join(root, RUN_DIRECTORY, 'uptime-after.json'));
    const uptimeBefore = readJson(join(root, RUN_DIRECTORY, 'uptime-before.json'));

    assert.equal(approval.status, 'explicit');
    assert.equal(approval.destructiveRiskAcknowledged, true);
    assert.equal(approval.launchAuthorized, true);
    assert.equal(approval.countedPlaybackStarted, true);
    validateSettingBoundary(boundary);
    validateConfigurationComparison(configuration);
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

    const applied = markers.find(marker => marker.category === 'audio-channel-limit-applied');
    const setup = markers.find(marker => marker.category === 'setup-playback-excluded');
    const setupStopped = markers.find(marker => marker.category === 'setup-playback-stopped');
    const start = markers.find(marker => marker.category === 'playback-start-confirmed');
    const terminal = markers.find(marker => marker.category === 'counted-interval-ended');
    const postCountRead = markers.find(marker => marker.category === 'post-count-session-read');
    const restored = markers.find(marker => marker.category === 'audio-channel-limit-restored');
    const cleanupComplete = markers.find(marker => marker.category === 'post-run-cleanup-complete');
    for (const marker of [
        applied,
        setup,
        setupStopped,
        start,
        terminal,
        postCountRead,
        restored,
        cleanupComplete
    ]) {
        assert.notEqual(marker, undefined);
    }
    assert.equal(markers.indexOf(applied) < markers.indexOf(setup), true);
    assert.equal(markers.indexOf(setup) < markers.indexOf(setupStopped), true);
    assert.equal(markers.indexOf(setupStopped) < markers.indexOf(start), true);
    assert.equal(markers.indexOf(start) < markers.indexOf(terminal), true);
    assert.equal(markers.indexOf(terminal) < markers.indexOf(postCountRead), true);
    assert.equal(markers.indexOf(postCountRead) < markers.indexOf(restored), true);
    assert.equal(markers.indexOf(restored) < markers.indexOf(cleanupComplete), true);
    assert.equal(applied.countedInterval, false);
    assert.equal(applied.state, 'mono-applied');
    assert.equal(applied.physicalUiConfirmed, true);
    assertDirectStreamSignature(setup, 'setup marker');
    assert.equal(setup.countedInterval, false);
    assert.equal(setup.setupDeliveryCandidatesExcludedFromCountedRun, true);
    assert.equal(setupStopped.matchingPlaybackSessionCount, 0);
    assert.equal(start.inputMethod, 'physical-lg-remote');
    assert.equal(start.postStartPhysicalInputCount, 0);
    assert.equal(terminal.postStartPhysicalInputCount, 0);
    assert.equal(terminal.observedDurationSeconds, run.observedDurationSeconds);
    assert.equal(terminal.countedPlaybackCompletedNormally, true);
    assert.equal(terminal.completionReason, 'normal-video-completion');
    assert.equal(postCountRead.countedInterval, false);
    assert.equal(postCountRead.countedPlaybackCompletedNormally, true);
    assert.equal(postCountRead.matchingActiveSessionCount, 0);
    assert.equal(postCountRead.livePostCountDeliveryCandidateObserved, false);
    assert.equal(postCountRead.serverReadCount, 1);
    assert.equal(postCountRead.bounded, true);
    assert.equal(postCountRead.nonPeriodic, true);
    assert.equal(postCountRead.proofMethod, ATTRIBUTION_PROOF_METHOD);
    assertRequiredLimitations(
        postCountRead.limitations,
        ATTRIBUTION_LIMITATIONS,
        'post-count marker limitations'
    );
    assert.equal(postCountRead.platformRebootProven, run.platformRebootProven);
    assert.equal(restored.state, 'auto-restored');
    assert.equal(restored.physicalUiConfirmed, true);
    assert.equal(restored.physicalUiSaveConfirmed, true);
    assert.equal(restored.noPostRestorationPlayback, true);
    assert.equal(restored.postRestorationPlaybackCount, 0);
    assert.equal(restored.additionalPlaybackAuthorized, false);
    assert.equal(restored.deliveryCategory, undefined);
    assert.equal(cleanupComplete.validationApplicationPresent, false);
    assert.equal(cleanupComplete.staticServerProcessPresent, false);
    assert.equal(cleanupComplete.staticListenerCount, 0);
    assert.equal(cleanupComplete.relevantNodeHelperCount, 0);

    assert.equal(run.actualDeliveryMode, 'DirectStream');
    assertSetupBoundAttribution(run, 'run summary attribution');
    assert.equal(run.independentlyObservedCountedSignature, false);
    assert.equal(run.countedInterval.startedAt, start.observedAt);
    assert.equal(run.countedInterval.endedAt, terminal.observedAt);
    assert.equal(run.countedInterval.postStartPhysicalInputCount, 0);
    assert.equal(run.countedInterval.queryAndPollingCount, 0);
    assert.equal(run.countedInterval.countedPlaybackCompletedNormally, true);
    assert.equal(run.observedDurationSeconds, run.countedInterval.observedDurationSeconds);
    assert.equal(run.clientSettingRestored, true);
    assert.equal(run.postRestorationPlaybackCount, 0);
    assert.equal(run.serverConfigurationEffectiveValueDelta, false);
    assert.equal(run.classification, CLASSIFICATION);
    assert.equal(run.operatorControlledFieldCount, 1);
    assert.equal(run.completeClientSettingsCompared, false);
    assert.equal(run.singleOperatorControlledChangeProven, false);
    assert.equal(run.strictSingleIndependentVariableProven, false);
    assert.equal(run.strictSingleEncodedOutputDimensionProven, false);
    assert.equal(run.productionModified, false);
    assert.equal(run.productSourceModified, false);
    assert.equal(run.serverConfigurationModified, false);
    assert.equal(run.ownershipBoundariesModified, false);

    assert.equal(instrumentation.countedInterval.startedAt, run.countedInterval.startedAt);
    assert.equal(instrumentation.countedInterval.endedAt, run.countedInterval.endedAt);
    assert.equal(
        instrumentation.countedInterval.observedDurationSeconds,
        run.observedDurationSeconds
    );
    assert.equal(
        instrumentation.preCountDiagnostics.serverQueryCount,
        delivery.preCountDiagnosticServerReadCount
    );
    assert.equal(
        instrumentation.postCountRead.serverQueryCount,
        delivery.actualRunDecision.postRunServerReadQueries
    );
    assert.equal(
        instrumentation.postCountRead.matchingActiveSessionCount,
        delivery.actualRunDecision.postCountMatchingActiveSessionCount
    );
    assert.equal(postCountRead.serverReadCount, instrumentation.postCountRead.serverQueryCount);
    assert.equal(launch.launchCount, 1);
    assert.equal(launch.launchSucceeded, true);
    assert.equal(launch.automaticLaunch, false);
    assert.equal(launch.rawLaunchOutputRetained, false);
    assert.equal(launch.playbackStartedAt, run.countedInterval.startedAt);

    assert.equal(phase.phase, PHASE);
    assert.equal(phase.run4.directory, RUN_DIRECTORY);
    assert.equal(phase.run4.result, run.result);
    assert.equal(phase.run4.actualDeliveryMode, 'DirectStream');
    assertSetupBoundAttribution(phase.run4, 'phase run attribution');
    assert.equal(phase.run4.observedDurationSeconds, run.observedDurationSeconds);
    assert.equal(phase.run4.postStartInputCount, 0);
    assert.equal(phase.run4.intendedChangedDimension, CONTROL);
    assert.deepEqual(phase.run4.operatorControlledChanges, [CONTROL]);
    assert.equal(phase.run4.clientSettingRestored, true);
    assert.equal(phase.run4.postRestorationPlaybackCount, 0);
    assert.equal(phase.run4.serverConfigurationEffectiveValueDelta, false);
    assert.equal(phase.run4.classification, CLASSIFICATION);
    assert.equal(phase.run4.operatorControlledFieldCount, 1);
    assert.equal(phase.run4.completeClientSettingsCompared, false);
    assert.equal(phase.run4.singleOperatorControlledChangeProven, false);
    assert.equal(phase.run4.strictSingleIndependentVariableProven, false);
    assert.equal(phase.run4.strictSingleEncodedOutputDimensionProven, false);
    assert.equal(phase.automaticLaunch, false);
    assert.equal(phase.productionModified, false);
    assert.equal(phase.productSourceModified, false);
    assert.equal(phase.serverConfigurationModified, false);
    assert.equal(phase.ownershipBoundariesModified, false);
    validateOutcomeDecision(run, phase, uptimeAfter);

    const approvalAt = parseTimestamp(
        approval.approvalReceivedAt ?? approval.approvalRecordedAt,
        'approval'
    );
    const launchAt = parseTimestamp(launch.requestedAt, 'launch');
    const originalAt = parseTimestamp(boundary.original.observedAt, 'original setting');
    const appliedAt = parseTimestamp(boundary.temporary.appliedAt, 'Mono applied');
    const applyConfigurationAt = parseTimestamp(
        configuration.applySave.verifiedAt,
        'apply configuration equality'
    );
    const setupAt = parseTimestamp(setup.observedAt, 'excluded setup playback');
    const setupStoppedAt = parseTimestamp(setupStopped.observedAt, 'setup playback stopped');
    const startAt = parseTimestamp(start.observedAt, 'playback start');
    const terminalAt = parseTimestamp(terminal.observedAt, 'interval end');
    const postCountReadAt = parseTimestamp(postCountRead.observedAt, 'post-count read');
    const restoredAt = parseTimestamp(boundary.restoration.restoredAt, 'Auto restored');
    const restorationConfigurationAt = parseTimestamp(
        configuration.restorationSave.verifiedAt,
        'restoration configuration equality'
    );
    const cleanupAt = parseTimestamp(cleanup.completedAt, 'cleanup');
    assert.equal(approvalAt < launchAt, true);
    assert.equal(launchAt < originalAt && originalAt < appliedAt, true);
    assert.equal(appliedAt <= applyConfigurationAt && applyConfigurationAt < setupAt, true);
    assert.equal(setupAt < setupStoppedAt && setupStoppedAt < startAt, true);
    assert.equal(startAt < terminalAt && terminalAt < postCountReadAt, true);
    assert.equal(postCountReadAt < restoredAt, true);
    assert.equal(restoredAt <= restorationConfigurationAt, true);
    assert.equal(restorationConfigurationAt < cleanupAt, true);
    assert.equal(applied.observedAt, boundary.temporary.appliedAt);
    assert.equal(restored.observedAt, boundary.restoration.restoredAt);
    assert.equal(cleanupComplete.observedAt, cleanup.completedAt);

    const beforeUptimeAt = parseTimestamp(uptimeBefore.observedAt, 'uptime before');
    const afterUptimeAt = parseTimestamp(uptimeAfter.observedAt, 'uptime after');
    assert.equal(beforeUptimeAt < startAt && postCountReadAt <= afterUptimeAt, true);
    assert.equal(uptimeAfter.increasedFromPreRun, true);
    assert.equal(uptimeAfter.uptimeSeconds > uptimeBefore.uptimeSeconds, true);
    const wallDelta = (afterUptimeAt - beforeUptimeAt) / 1000;
    const uptimeDelta = uptimeAfter.uptimeSeconds - uptimeBefore.uptimeSeconds;
    assert.equal(Math.abs(wallDelta - uptimeDelta) <= TIME_TOLERANCE_SECONDS, true);
}

export function validateNativeMediaIsolationC2Evidence(evidenceRoot) {
    const root = resolve(evidenceRoot);
    assert.equal(existsSync(root), true, 'Evidence root does not exist');
    for (const path of REQUIRED_FILES) {
        assert.equal(existsSync(join(root, path)), true, `Missing evidence file: ${path}`);
    }
    validateBuildAndMedia(root);
    validateNativeMediaIsolationPrivacy(root, true);
    validateNativeMediaIsolationKnownPrivateValueScan(root);
    validateNativeMediaIsolationC2Outcome(root);
    validateNativeMediaIsolationRepeatInventory(root);
    return {
        status: 'PASS',
        schemaVersion: 'ptv-webos-native-media-isolation-c2-validation-v1',
        mode: 'final',
        evidenceRoot: 'privacy-redacted',
        exactBuildSourceTvParityValidated: true,
        conditionalDirectStreamValidated: true,
        clientSettingAndServerConfigurationBoundariesValidated: true,
        privacyValidated: true,
        artifactInventoryValidated: true
    };
}

function main(argv) {
    assert.equal(
        argv.length,
        1,
        'Usage: validate-native-media-isolation-c2-evidence.mjs <evidence-root>'
    );
    process.stdout.write(
        `${JSON.stringify(validateNativeMediaIsolationC2Evidence(argv[0]), null, 2)}\n`
    );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
    main(process.argv.slice(2));
}
