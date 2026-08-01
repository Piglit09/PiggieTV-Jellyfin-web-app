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
import {
    validateNativeMediaIsolationRepeatInventory
} from './validate-native-media-isolation-repeat-evidence.mjs';

const PHASE = 'PiggieTV WebOS Phase 3A.1R.2d - C3 asset preparation';
const STATUS = 'READY-c3-paired-fixture-prepared';
const DECISION = 'READY-c3-paired-fixture-prepared-no-playback-authorized';
const APPROVAL_SCOPE = 'c3-privacy-safe-paired-test-asset-preparation-only';
const NEXT_PHASE =
    'C3 synthetic AAC control playback with separate explicit approval';
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
const REQUIRED_FILES = Object.freeze([
    'README.md',
    'activity-boundary.json',
    'approval.json',
    'artifact-inventory.json',
    'build-identity.json',
    'cleanup-and-retention.json',
    'delivery-prediction.json',
    'final-report.md',
    'isolated-instance.json',
    'known-private-value-scan.json',
    'pair-equivalence.json',
    'pair-manifest.json',
    'phase-summary.json',
    'privacy-scan.json',
    'toolchain-identity.json'
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMON_CONTAINER = Object.freeze({
    name: 'mp4',
    fragmented: false,
    progressiveFastStart: true,
    encrypted: false,
    videoTrackCount: 1,
    audioTrackCount: 1,
    subtitleTrackCount: 0,
    dataTrackCount: 0,
    attachmentCount: 0,
    chapterCount: 0,
    globalMetadataCount: 0,
    trackOrder: 'video-audio'
});
const COMMON_VIDEO = Object.freeze({
    codec: 'h264-avc',
    sampleEntry: 'avc1',
    profile: 'high',
    level: '4.1',
    width: 1904,
    height: 1072,
    sampleAspectRatio: '1:1',
    scanType: 'progressive',
    frameRateNumerator: 24000,
    frameRateDenominator: 1001,
    frameRateClass: 'conventional-cfr',
    frameCount: 23040,
    durationSeconds: 960.96,
    bitDepth: 8,
    chromaFormat: 'yuv420p',
    dynamicRange: 'sdr',
    colorPrimaries: 'bt709',
    colorTransfer: 'bt709',
    colorMatrix: 'bt709',
    colorRange: 'limited',
    hdrMetadata: false,
    dolbyVisionMetadata: false,
    bitrateClass: 'moderate'
});
const COMMON_AUDIO_GEOMETRY = Object.freeze({
    sampleRateHz: 48000,
    channelCount: 2,
    channelLayout: 'stereo',
    samplesPerChannel: 46126080,
    durationSeconds: 960.96,
    streamCount: 1,
    defaultDisposition: true,
    language: 'unset',
    nominalBitrateBps: 384000
});
const ZERO_ACTIVITY = Object.freeze({
    televisionQueryCount: 0,
    televisionMutationCount: 0,
    applicationQueryCount: 0,
    applicationLaunchCount: 0,
    playbackStartCount: 0,
    mediaStreamRequestCount: 0,
    countedIntervalCount: 0,
    inspectorQueryCount: 0,
    pollerQueryCount: 0,
    rendererInjectionCount: 0,
    productionQueryCount: 0,
    productionMutationCount: 0
});
const ZERO_OUT_OF_SCOPE_MUTATIONS = Object.freeze({
    production: 0,
    productSource: 0,
    productionServerConfiguration: 0,
    productionLibraryData: 0,
    ownershipBoundaries: 0,
    television: 0,
    validationApplication: 0
});

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function parseTimestamp(value, label) {
    assert.equal(typeof value, 'string', `${label} must be an ISO timestamp`);
    const timestamp = Date.parse(value);
    assert.equal(Number.isFinite(timestamp), true, `${label} must be an ISO timestamp`);
    return timestamp;
}

function assertSha256(value, label) {
    assert.equal(typeof value, 'string', `${label} must be a SHA-256 string`);
    assert.match(value, SHA256_PATTERN, `${label} must be lowercase hexadecimal`);
}

function assertPinnedTool(tool, name) {
    assert.equal(tool.name, name);
    assert.equal(typeof tool.version, 'string');
    assert.equal(tool.version.length > 0, true);
    assert.equal(tool.versionPinned, true);
    assertSha256(tool.sha256, `${name} identity`);
}

function validateApproval(approval) {
    assert.equal(approval.schemaVersion, 1);
    assert.equal(approval.phase, PHASE);
    assert.equal(approval.status, 'explicit');
    assert.equal(approval.scope, APPROVAL_SCOPE);
    parseTimestamp(approval.approvalReceivedAt, 'approvalReceivedAt');
    assert.equal(approval.preparationAuthorized, true);
    assert.equal(approval.isolatedNonProductionWritesAuthorized, true);
    assert.equal(approval.televisionContactAuthorized, false);
    assert.equal(approval.validationApplicationLaunchAuthorized, false);
    assert.equal(approval.mediaPlaybackAuthorized, false);
    assert.equal(approval.productionContactAuthorized, false);
    assert.equal(approval.futurePhysicalRunAuthorized, false);
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
    assert.equal(build.buildOrWrapperModified, false);
    assert.equal(build.profileSourceCommit, EXPECTED_BUILD.commit);
}

function validateIsolatedInstance(instance) {
    assert.equal(instance.schemaVersion, 1);
    assert.equal(instance.environment, 'isolated-non-production');
    assert.equal(instance.jellyfinVersion, '10.11.11');
    assert.equal(instance.serverImage.versionPinned, true);
    assertSha256(instance.serverImage.digestSha256, 'server image identity');
    assert.equal(instance.serverFfmpeg.versionPinned, true);
    assert.equal(typeof instance.serverFfmpeg.version, 'string');
    assert.equal(instance.serverFfmpeg.version.length > 0, true);
    assertSha256(instance.serverFfmpeg.digestSha256, 'server FFmpeg identity');
    assert.deepEqual(instance.network, {
        internalOnly: true,
        publicPortPublished: false,
        lanPortPublished: false,
        productionRouteAvailable: false,
        discoveryEnabled: false,
        reverseProxyPresent: false
    });
    assert.deepEqual(instance.mounts, {
        productionConfigurationMounted: false,
        productionDatabaseMounted: false,
        productionMediaMounted: false,
        productionBackupMounted: false,
        productionCacheMounted: false,
        productionPluginDirectoryMounted: false,
        containerControlSocketMounted: false,
        syntheticMediaReadOnlyAfterGeneration: true
    });
    assert.equal(instance.freshConfiguration, true);
    assert.equal(instance.freshDatabase, true);
    assert.equal(instance.freshCache, true);
    assert.equal(instance.testAccountOnly, true);
    assert.equal(instance.productionCredentialsUsed, false);
    assert.equal(instance.pluginsInstalled, false);
    assert.equal(instance.rawRuntimeIdentityRetained, false);
    assert.equal(instance.isolationBoundaryValidated, true);
}

function validateToolchain(toolchain) {
    assert.equal(toolchain.schemaVersion, 1);
    assertPinnedTool(toolchain.ffmpeg, 'ffmpeg');
    assert.equal(toolchain.ffmpeg.h264Encoder, 'libx264');
    assert.equal(toolchain.ffmpeg.aacLcEncoderAvailable, true);
    assert.equal(toolchain.ffmpeg.dtsCoreEncoderAvailable, true);
    assertPinnedTool(toolchain.ffprobe, 'ffprobe');
    assertPinnedTool(toolchain.gpac, 'gpac-mp4box');
    assert.equal(toolchain.gpac.isobmffDtsCoreMuxingGatePassed, true);
    assert.equal(toolchain.gpac.outputDtsCoreSampleEntry, 'dtsc');
    assert.equal(toolchain.finalMuxer.name, 'gpac-mp4box');
    assert.equal(toolchain.finalMuxer.sameVersionAndPolicyForBothAssets, true);
    assert.equal(toolchain.finalMuxer.ffmpegDtsMp4MuxerUsed, false);
    assert.equal(toolchain.unpinnedToolCount, 0);
}

function validatePairManifest(manifest) {
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.privacyProjection, 'normalized-category-and-integrity-only');
    assert.equal(manifest.rawProbeOutputRetained, false);
    assert.equal(manifest.sourceNamesRetained, false);
    assert.equal(manifest.absolutePathsRetained, false);
    assert.equal(manifest.privateSourceMediaUsed, false);
    assert.equal(manifest.sourceKind, 'deterministic-synthetic-neutral');
    assert.equal(manifest.neutralContent, true);
    assert.equal(
        manifest.audioMasterKind,
        'deterministic-non-speech-stereo-test-signal'
    );
    assert.deepEqual(manifest.common.container, COMMON_CONTAINER);
    assert.deepEqual(manifest.common.video, COMMON_VIDEO);
    assert.deepEqual(manifest.common.audioGeometry, COMMON_AUDIO_GEOMETRY);
    assert.equal(manifest.common.durationClass, '15-minutes-or-longer');
    assert.equal(manifest.common.subtitleState, 'none');
    assert.equal(manifest.common.multipleVideoVersions, false);
    assert.deepEqual(manifest.control, {
        role: 'control',
        audioCodec: 'aac-lc',
        audioProfile: 'lc',
        sampleEntry: 'mp4a',
        codecString: 'mp4a.40.2'
    });
    assert.deepEqual(manifest.candidate, {
        role: 'candidate',
        audioCodec: 'dts-core',
        audioProfile: 'core',
        sampleEntry: 'dtsc',
        codecString: 'dtsc',
        dtsHdExtensionPresent: false
    });
    assert.equal(manifest.completelyKnownTechnicalProperties, true);
}

function validatePairEquivalence(equivalence) {
    assert.equal(equivalence.schemaVersion, 1);
    assert.equal(equivalence.sameFinalMuxerAndPolicy, true);
    assertSha256(equivalence.finalAssetSha256.control, 'control asset identity');
    assertSha256(equivalence.finalAssetSha256.candidate, 'candidate asset identity');
    assert.notEqual(
        equivalence.finalAssetSha256.control,
        equivalence.finalAssetSha256.candidate
    );
    assertSha256(
        equivalence.videoPayloadSha256.control,
        'control video payload identity'
    );
    assertSha256(
        equivalence.videoPayloadSha256.candidate,
        'candidate video payload identity'
    );
    assert.equal(
        equivalence.videoPayloadSha256.control,
        equivalence.videoPayloadSha256.candidate
    );
    assertSha256(
        equivalence.videoPacketTimingSha256.control,
        'control video timing identity'
    );
    assertSha256(
        equivalence.videoPacketTimingSha256.candidate,
        'candidate video timing identity'
    );
    assert.equal(
        equivalence.videoPacketTimingSha256.control,
        equivalence.videoPacketTimingSha256.candidate
    );
    assertSha256(equivalence.audioPcmMasterSha256, 'audio PCM master identity');
    assert.equal(equivalence.videoPayloadByteIdentical, true);
    assert.equal(equivalence.videoPacketTimingIdentical, true);
    assert.equal(equivalence.videoGeometryIdentical, true);
    assert.equal(equivalence.videoColorMetadataIdentical, true);
    assert.equal(equivalence.audioUsesSamePcmMaster, true);
    assert.equal(equivalence.audioSampleGeometryIdentical, true);
    assert.equal(equivalence.audioPresentationTimingWithinCodecFrameTolerance, true);
    assert.equal(equivalence.audioNominalBitrateIdentical, true);
    assert.equal(equivalence.containerBrandsIdentical, true);
    assert.equal(equivalence.trackOrderIdentical, true);
    assert.equal(equivalence.trackIdentifiersIdentical, true);
    assert.equal(equivalence.videoTimescaleIdentical, true);
    assert.deepEqual(equivalence.audioTimescales, {
        control: '1/48000',
        candidate: '1/90000'
    });
    assert.equal(equivalence.audioTimescaleCodecDependent, true);
    assert.equal(equivalence.metadataPolicyIdentical, true);
    assert.deepEqual(equivalence.differences.independentlySelected, [
        'audio-codec'
    ]);
    assert.deepEqual(equivalence.differences.codecDependent, [
        'audio-compressed-payload',
        'audio-sample-entry',
        'audio-codec-configuration',
        'audio-packetization',
        'audio-timescale'
    ]);
    assert.equal(equivalence.unexpectedIndependentDifferenceCount, 0);
    assert.equal(equivalence.completeDecode.control, 'PASS');
    assert.equal(equivalence.completeDecode.candidate, 'PASS');
    assert.equal(equivalence.independentAnalyzerCount >= 2, true);
    assert.equal(equivalence.independentAnalyzersAgree, true);
    assert.equal(equivalence.exactPairValidated, true);
    assert.equal(equivalence.finalPairRetainedOutsideEvidence, true);
    assert.equal(equivalence.retainedMappingUsesRolesOnly, true);
}

function validateControlPrediction(control) {
    assert.equal(control.role, 'control');
    assert.equal(control.predictionOnly, true);
    assert.equal(control.serverPlanningCategory, 'DirectPlay');
    assert.equal(control.clientDeliveryCategory, 'DirectPlay');
    assert.equal(control.candidateCount, 1);
    assert.equal(control.serverSupportsDirectPlay, true);
    assert.equal(control.serverSupportsDirectStream, true);
    assert.equal(control.serverSupportsTranscoding, true);
    assert.equal(control.videoDirect, true);
    assert.equal(control.audioDirect, true);
    assert.equal(control.videoTranscode, false);
    assert.equal(control.audioTranscode, false);
    assert.equal(control.containerRemux, false);
    assert.equal(control.subtitleBurnIn, false);
    assert.deepEqual(control.transcodeReasons, []);
}

function validateCandidatePrediction(candidate) {
    assert.equal(candidate.role, 'candidate');
    assert.equal(candidate.predictionOnly, true);
    assert.equal(candidate.serverPlanningCategory, 'Transcode');
    assert.equal(candidate.clientDeliveryCategory, 'DirectStream');
    assert.equal(candidate.candidateCount, 1);
    assert.equal(candidate.serverSupportsDirectPlay, false);
    assert.equal(candidate.serverSupportsDirectStream, false);
    assert.equal(candidate.serverSupportsTranscoding, true);
    assert.equal(candidate.httpDirectStreamReportingDisabled, true);
    assert.equal(candidate.streamInfoPlayMethodForUrlCreation, 'Transcode');
    assert.equal(candidate.finalEncodingDecisionDeferredUntilMediaRequest, true);
    assert.equal(candidate.actualTranscodeCommandObserved, false);
    assert.deepEqual(candidate.videoCodecOptions, [
        'h264',
        'hevc'
    ]);
    assert.deepEqual(candidate.audioCodecOptions, [
        'aac',
        'mp3',
        'ac3',
        'eac3'
    ]);
    assert.equal(candidate.videoStreamCopyAllowed, true);
    assert.equal(candidate.videoSourceMatchesCopyCandidate, true);
    assert.equal(
        candidate.videoCopyPredictionBasis,
        'exact-source-logic-and-audio-only-reason'
    );
    assert.equal(candidate.videoDirect, true);
    assert.equal(candidate.audioDirect, false);
    assert.equal(candidate.videoTranscode, false);
    assert.equal(candidate.audioTranscode, true);
    assert.equal(candidate.predictedOutputAudioCodec, 'aac');
    assert.equal(candidate.predictedOutputChannelLayout, 'stereo');
    assert.equal(candidate.videoCopyRuntimeProven, false);
    assert.equal(candidate.audioTranscodeRuntimeProven, false);
    assert.equal(candidate.outputAudioCodecRuntimeProven, false);
    assert.equal(candidate.serverTranscodeProtocol, 'hls');
    assert.equal(candidate.serverTranscodeContainer, 'ts');
    assert.equal(candidate.containerRemux, true);
    assert.equal(candidate.subtitleBurnIn, false);
    assert.deepEqual(candidate.transcodeReasons, [
        'AudioCodecNotSupported'
    ]);
}

function validateDeliveryPrediction(delivery) {
    assert.equal(delivery.schemaVersion, 1);
    assert.equal(delivery.predictionOnly, true);
    assert.equal(delivery.actualPlaybackOccurred, false);
    assert.equal(delivery.rawPlanningResponsesRetained, false);
    assert.equal(delivery.rawRuntimeValuesRetained, false);
    assert.equal(delivery.profile.sourceCommit, EXPECTED_BUILD.commit);
    assert.equal(delivery.profile.webosVersion, '5.6.2');
    assert.equal(delivery.profile.sameProfileUsedForBoth, true);
    assert.equal(delivery.profile.dtsUserOverrideEnabled, false);
    assert.equal(delivery.profile.dtsAdvertisedForDirectPlay, false);
    assert.equal(delivery.profile.aacAdvertisedForDirectPlay, true);
    assert.equal(delivery.profile.h264AdvertisedForDirectPlay, true);
    assert.equal(delivery.profile.stereoPermitted, true);
    assert.equal(delivery.profile.videoQuality, 'auto');
    assert.equal(delivery.profile.subtitleState, 'off');
    assertSha256(
        delivery.profile.relevantSubsetSha256,
        'relevant device-profile subset identity'
    );
    assert.deepEqual(delivery.planningQueries, {
        controlCount: 1,
        candidateCount: 2,
        totalCount: 3,
        bounded: true,
        nonPeriodic: true,
        actualMediaRequestCount: 0
    });
    validateControlPrediction(delivery.control);
    validateCandidatePrediction(delivery.candidate);
    assert.equal(delivery.runtimeDeliveryProven, false);
    assert.equal(delivery.futurePhysicalRunMustReproveDelivery, true);
    assert.equal(delivery.predictionEligibleForFutureRun, true);
}

function validateActivity(activity) {
    assert.equal(activity.schemaVersion, 1);
    assert.deepEqual(activity.outOfScopeActivity, ZERO_ACTIVITY);
    assert.deepEqual(activity.outOfScopeMutations, ZERO_OUT_OF_SCOPE_MUTATIONS);
    assert.deepEqual(activity.preparationActivity, {
        syntheticFixtureCount: 2,
        isolatedInstanceCreationCount: 1,
        isolatedPlanningQueryCount: 3,
        bounded: true,
        nonPeriodic: true,
        isolatedOnly: true
    });
    assert.equal(activity.noOutOfScopeActivity, true);
}

function validateCleanup(cleanup) {
    assert.equal(cleanup.schemaVersion, 1);
    parseTimestamp(cleanup.completedAt, 'cleanup completion');
    assert.equal(cleanup.isolatedServerStopped, true);
    assert.equal(cleanup.isolatedServerRemoved, true);
    assert.equal(cleanup.isolatedNetworkRemoved, true);
    assert.equal(cleanup.temporaryTestAccountRemoved, true);
    assert.equal(cleanup.temporaryCredentialsDestroyed, true);
    assert.equal(cleanup.temporaryIntermediatesRemoved, true);
    assert.equal(cleanup.ownedTemporaryResourcesAbsent, true);
    assert.equal(cleanup.finalPairRetained, true);
    assert.equal(cleanup.finalPairSealedReadOnly, true);
    assert.equal(cleanup.retainedFixtureLocationDisclosed, false);
    assert.equal(cleanup.productionCleanupNeeded, false);
    assert.equal(cleanup.productionModified, false);
    assert.equal(cleanup.televisionModified, false);
    assert.equal(cleanup.validationApplicationModified, false);
}

function validatePhase(phase) {
    assert.equal(
        phase.schemaVersion,
        'ptv-webos-native-media-isolation-c3-asset-preparation-summary-v1'
    );
    assert.equal(phase.phase, PHASE);
    assert.equal(phase.status, STATUS);
    assert.equal(phase.decision, DECISION);
    assert.equal(phase.approvalScope, APPROVAL_SCOPE);
    parseTimestamp(phase.completedAt, 'phase completion');
    assert.equal(phase.preparationCompleted, true);
    assert.equal(phase.exactPairValidated, true);
    assert.equal(phase.deliveryPredictionValidated, true);
    assert.equal(phase.isolatedInstanceValidated, true);
    assert.equal(phase.televisionContactCount, 0);
    assert.equal(phase.applicationLaunchCount, 0);
    assert.equal(phase.playbackStartCount, 0);
    assert.equal(phase.productionContactCount, 0);
    assert.equal(phase.productionModified, false);
    assert.equal(phase.productSourceModified, false);
    assert.equal(phase.productionServerConfigurationModified, false);
    assert.equal(phase.productionLibraryDataModified, false);
    assert.equal(phase.ownershipBoundariesModified, false);
    assert.equal(phase.runtimePlaybackProven, false);
    assert.equal(phase.televisionSafetyProven, false);
    assert.equal(phase.futurePhysicalRunAuthorized, false);
    assert.equal(phase.isolationConclusion, 'fixture-prepared-runtime-unproven');
    assert.equal(phase.nextPhase, NEXT_PHASE);
}

function validateReports(root) {
    const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(/\s+/gu, ' ');
    const report = readFileSync(join(root, 'final-report.md'), 'utf8').replace(/\s+/gu, ' ');
    const displayDecision =
        'READY - C3 PAIRED FIXTURE PREPARED; NO PLAYBACK AUTHORIZED';
    assert.equal(readme.includes(PHASE), true);
    assert.equal(readme.includes(STATUS), true);
    assert.equal(report.includes(displayDecision), true);
    assert.equal(report.includes(DECISION), true);
    assert.equal(report.includes(NEXT_PHASE), true);
    assert.equal(report.includes('requires separate explicit approval'), true);
    assert.equal(report.includes('Runtime playback remains unproven.'), true);
    assert.equal(
        report.includes(
            'No television contact, app launch, media playback, or production contact occurred.'
        ),
        true
    );
    assert.equal((report.match(new RegExp(NEXT_PHASE, 'gu')) || []).length, 1);
}

export function validateNativeMediaIsolationC3AssetPreparationOutcome(root) {
    const activity = readJson(join(root, 'activity-boundary.json'));
    const approval = readJson(join(root, 'approval.json'));
    const build = readJson(join(root, 'build-identity.json'));
    const cleanup = readJson(join(root, 'cleanup-and-retention.json'));
    const delivery = readJson(join(root, 'delivery-prediction.json'));
    const instance = readJson(join(root, 'isolated-instance.json'));
    const equivalence = readJson(join(root, 'pair-equivalence.json'));
    const manifest = readJson(join(root, 'pair-manifest.json'));
    const phase = readJson(join(root, 'phase-summary.json'));
    const toolchain = readJson(join(root, 'toolchain-identity.json'));

    validateActivity(activity);
    validateApproval(approval);
    validateBuild(build);
    validateCleanup(cleanup);
    validateDeliveryPrediction(delivery);
    validateIsolatedInstance(instance);
    validatePairEquivalence(equivalence);
    validatePairManifest(manifest);
    validatePhase(phase);
    validateToolchain(toolchain);
    validateReports(root);

    const approvalAt = parseTimestamp(
        approval.approvalReceivedAt,
        'approvalReceivedAt'
    );
    const cleanupAt = parseTimestamp(cleanup.completedAt, 'cleanup completion');
    const phaseAt = parseTimestamp(phase.completedAt, 'phase completion');
    assert.equal(approvalAt < cleanupAt, true);
    assert.equal(cleanupAt <= phaseAt, true);
    assert.equal(
        activity.outOfScopeActivity.televisionQueryCount,
        phase.televisionContactCount
    );
    assert.equal(
        activity.outOfScopeActivity.applicationLaunchCount,
        phase.applicationLaunchCount
    );
    assert.equal(
        activity.outOfScopeActivity.playbackStartCount,
        phase.playbackStartCount
    );
    assert.equal(
        activity.outOfScopeActivity.productionQueryCount,
        phase.productionContactCount
    );
    assert.equal(
        equivalence.exactPairValidated,
        phase.exactPairValidated
    );
    assert.equal(
        delivery.predictionEligibleForFutureRun,
        phase.deliveryPredictionValidated
    );
}

export function validateNativeMediaIsolationC3AssetPreparationEvidence(evidenceRoot) {
    const root = resolve(evidenceRoot);
    assert.equal(existsSync(root), true, 'Evidence root does not exist');
    for (const path of REQUIRED_FILES) {
        assert.equal(existsSync(join(root, path)), true, `Missing evidence file: ${path}`);
    }
    validateNativeMediaIsolationPrivacy(root, true);
    validateNativeMediaIsolationKnownPrivateValueScan(root);
    validateNativeMediaIsolationC3AssetPreparationOutcome(root);
    validateNativeMediaIsolationRepeatInventory(root);
    return {
        status: 'PASS',
        schemaVersion:
            'ptv-webos-native-media-isolation-c3-asset-preparation-validation-v1',
        mode: 'final-preparation-ready',
        evidenceRoot: 'privacy-redacted',
        approvalBoundaryValidated: true,
        exactBuildAndWrapperValidated: true,
        isolatedNonProductionBoundaryValidated: true,
        pinnedToolchainValidated: true,
        exactAacDtsPairValidated: true,
        deliveryPredictionValidated: true,
        zeroTvAppPlaybackProductionActivityValidated: true,
        cleanupAndRetentionValidated: true,
        privacyValidated: true,
        artifactInventoryValidated: true
    };
}

function main(argv) {
    assert.equal(
        argv.length,
        1,
        'Usage: validate-native-media-isolation-c3-asset-preparation-evidence.mjs <evidence-root>'
    );
    process.stdout.write(
        `${JSON.stringify(
            validateNativeMediaIsolationC3AssetPreparationEvidence(argv[0]),
            null,
            2
        )}\n`
    );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
    main(process.argv.slice(2));
}
