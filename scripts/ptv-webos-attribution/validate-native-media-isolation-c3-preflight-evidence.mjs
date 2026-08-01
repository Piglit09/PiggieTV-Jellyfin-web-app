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

const PHASE = 'PiggieTV WebOS Phase 3A.1R.2d';
const RUN_DIRECTORY = 'run-05-c3-non-aac-audio-transcode';
const STATUS = 'HOLD-c3-preflight-no-conforming-asset';
const DECISION = 'HOLD-inconclusive';
const NEXT_PHASE =
    'C3 privacy-safe test-asset preparation on an isolated non-production Jellyfin instance';
const APPROVAL_SCOPE = 'single-c3-non-aac-audio-transcode-comparison';
const NO_CANDIDATE_REASON = 'candidate-gate-no-conforming-asset';
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
    'artifact-inventory.json',
    'final-report.md',
    'known-private-value-scan.json',
    'phase-summary.json',
    'privacy-scan.json',
    `${RUN_DIRECTORY}/approval.json`,
    `${RUN_DIRECTORY}/build-identity.json`,
    `${RUN_DIRECTORY}/candidate-selection.json`,
    `${RUN_DIRECTORY}/cleanup.json`,
    `${RUN_DIRECTORY}/instrumentation-absence.json`,
    `${RUN_DIRECTORY}/launch-summary.json`
]);
const STRICT_CRITERIA = Object.freeze({
    container: 'mp4',
    videoCodec: 'h264-avc',
    videoProfile: 'high',
    videoLevel: '4.1',
    width: 1904,
    height: 1072,
    audioCodec: 'dts-core',
    channelLayout: 'stereo',
    audioStreamCount: 1,
    subtitleState: 'none',
    multipleVideoVersions: false
});
const ZERO_ACTIVITY = Object.freeze({
    tvQueryCount: 0,
    appQueryCount: 0,
    playbackQueryCount: 0,
    inspectorQueryCount: 0,
    pollerQueryCount: 0,
    rendererInjectionCount: 0,
    launchCount: 0,
    playbackStartCount: 0,
    countedIntervalCount: 0
});
const ZERO_MUTATIONS = Object.freeze({
    production: 0,
    productSource: 0,
    serverConfiguration: 0,
    libraryData: 0,
    media: 0,
    device: 0
});

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function parseTimestamp(value, label) {
    assert.equal(typeof value, 'string', `${label} must be an ISO timestamp`);
    assert.equal(Number.isFinite(Date.parse(value)), true, `${label} must be an ISO timestamp`);
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
}

function validateApproval(approval) {
    assert.equal(approval.phase, PHASE);
    assert.equal(approval.run, RUN_DIRECTORY);
    assert.equal(approval.status, 'explicit');
    assert.equal(approval.scope, APPROVAL_SCOPE);
    parseTimestamp(approval.approvalReceivedAt, 'approvalReceivedAt');
    assert.equal(approval.launchAuthorized, true);
    assert.equal(approval.rebootRiskAcknowledged, true);
    assert.equal(approval.approvalConsumed, false);
    assert.equal(approval.launchAttempted, false);
    assert.equal(approval.playbackAttempted, false);
    assert.equal(approval.launchCount, 0);
    assert.equal(approval.playbackStartCount, 0);
}

function validateClosestCandidates(candidate) {
    assert.equal(Array.isArray(candidate.closestCandidates), true);
    assert.equal(candidate.closestCandidates.length, 2);
    const mp4 = candidate.closestCandidates[0];
    assert.deepEqual(mp4, {
        category: 'mp4-h264-dts-core-5.1',
        count: 5,
        container: 'mp4',
        videoCodec: 'h264-avc',
        audioCodec: 'dts-core',
        channelLayout: '5.1',
        videoProfileOrResolutionMatches: false,
        qualifies: false,
        disqualifyingDimensions: [
            'audio-channel-layout',
            'video-profile-or-resolution'
        ]
    });
    const mkv = candidate.closestCandidates[1];
    assert.deepEqual(mkv, {
        category: 'mkv-h264-high-4.1-dts-core-5.1',
        count: 16,
        container: 'mkv',
        videoCodec: 'h264-avc',
        videoProfile: 'high',
        videoLevel: '4.1',
        audioCodec: 'dts-core',
        channelLayout: '5.1',
        qualifies: false,
        disqualifyingDimensions: [
            'container',
            'audio-channel-layout'
        ]
    });
}

function validateCandidate(candidate) {
    assert.equal(candidate.preflightOnly, true);
    assert.equal(candidate.privacyProjection, 'category-only');
    assert.equal(candidate.rawRecordsRetained, false);
    assert.equal(candidate.sourceIdentityRetained, false);
    assert.equal(candidate.titleRetained, false);
    assert.equal(candidate.itemIdentifierRetained, false);
    assert.equal(candidate.pathRetained, false);
    assert.deepEqual(candidate.strictCriteria, STRICT_CRITERIA);
    assert.equal(candidate.strictCandidateCount, 0);
    validateClosestCandidates(candidate);
    assert.equal(candidate.conformingAssetAvailable, false);
    assert.equal(candidate.noCandidateSelected, true);
    assert.equal(candidate.playbackProhibitedByGate, true);
    assert.equal(candidate.result, 'no-conforming-asset');
}

function validateInstrumentation(instrumentation) {
    const preflight = instrumentation.preflight;
    assert.equal(preflight.totalReadOnlyCommandCount, 15);
    assert.equal(preflight.bounded, true);
    assert.equal(preflight.nonPeriodic, true);
    assert.equal(preflight.mutationCommandCount, 0);
    assert.equal(preflight.successfulCommandCount, 12);
    assert.equal(preflight.nonzeroExitCommandCount, 3);
    assert.deepEqual(preflight.categories, {
        serviceOrIdentity: {
            attempted: 2,
            nonzeroExit: 0
        },
        capabilityOrSchema: {
            attempted: 4,
            nonzeroExit: 2
        },
        mediaFeasibilityAggregate: {
            attempted: 9,
            nonzeroExit: 1
        }
    });
    assert.deepEqual(preflight.failureCategories, [
        'quoting-syntax',
        'schema-syntax',
        'alias-syntax'
    ]);
    assert.equal(preflight.rawCommandOutputRetained, false);
    assert.equal(preflight.privateRuntimeValuesRetained, false);
    assert.deepEqual(instrumentation.activity, ZERO_ACTIVITY);
    assert.deepEqual(instrumentation.mutations, ZERO_MUTATIONS);
}

function validateLaunch(launch) {
    assert.equal(launch.approvalConsumed, false);
    assert.equal(launch.launchCount, 0);
    assert.equal(launch.playbackStartCount, 0);
    assert.equal(launch.launchAttempted, false);
    assert.equal(launch.playbackAttempted, false);
    assert.equal(launch.staticServerStarted, false);
    assert.equal(launch.validationApplicationStarted, false);
    assert.equal(launch.countedIntervalStarted, false);
    assert.equal(launch.reason, NO_CANDIDATE_REASON);
}

function validateCleanup(cleanup) {
    assert.equal(cleanup.cleanupNeeded, false);
    assert.equal(cleanup.cleanupPerformed, false);
    assert.equal(cleanup.reason, 'nothing-launched-or-started');
    assert.equal(cleanup.validationApplicationPresent, false);
    assert.equal(cleanup.staticServerProcessPresent, false);
    assert.equal(cleanup.staticListenerCount, 0);
    assert.equal(cleanup.relevantHelperCount, 0);
    assert.equal(cleanup.inspectorAttachmentCount, 0);
    assert.equal(cleanup.pollerCount, 0);
    assert.equal(cleanup.temporaryArtifactCreated, false);
    assert.equal(cleanup.temporaryApiSessionCreated, false);
    assert.equal(cleanup.productionModified, false);
}

function validatePhase(phase) {
    assert.equal(phase.schemaVersion, 'ptv-webos-native-media-isolation-c3-preflight-summary-v1');
    assert.equal(phase.phase, PHASE);
    assert.deepEqual(phase.run, {
        directory: RUN_DIRECTORY,
        status: STATUS
    });
    assert.equal(phase.evidenceRoot, 'privacy-redacted');
    assert.equal(phase.status, STATUS);
    assert.equal(phase.decision, DECISION);
    assert.equal(phase.approvalConsumed, false);
    assert.equal(phase.launchCount, 0);
    assert.equal(phase.playbackStartCount, 0);
    assert.equal(phase.strictCandidateCount, 0);
    assert.equal(phase.productionModified, false);
    assert.equal(phase.productSourceModified, false);
    assert.equal(phase.serverConfigurationModified, false);
    assert.equal(phase.libraryDataModified, false);
    assert.equal(phase.ownershipBoundariesModified, false);
    assert.equal(phase.cleanupNeeded, false);
    assert.equal(phase.isolationConclusion, 'inconclusive');
    assert.equal(phase.nextPhase, NEXT_PHASE);
}

function validateReports(root) {
    const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(/\s+/gu, ' ');
    const report = readFileSync(join(root, 'final-report.md'), 'utf8').replace(/\s+/gu, ' ');
    assert.equal(readme.includes(PHASE), true);
    assert.equal(readme.includes(STATUS), true);
    assert.equal(report.includes(STATUS), true);
    assert.equal(report.includes(DECISION), true);
    assert.equal(report.includes(NEXT_PHASE), true);
    assert.equal((report.match(new RegExp(NEXT_PHASE, 'gu')) || []).length, 1);
}

export function validateNativeMediaIsolationC3PreflightOutcome(root) {
    const approval = readJson(join(root, RUN_DIRECTORY, 'approval.json'));
    const build = readJson(join(root, RUN_DIRECTORY, 'build-identity.json'));
    const candidate = readJson(join(root, RUN_DIRECTORY, 'candidate-selection.json'));
    const cleanup = readJson(join(root, RUN_DIRECTORY, 'cleanup.json'));
    const instrumentation = readJson(
        join(root, RUN_DIRECTORY, 'instrumentation-absence.json')
    );
    const launch = readJson(join(root, RUN_DIRECTORY, 'launch-summary.json'));
    const phase = readJson(join(root, 'phase-summary.json'));

    validateApproval(approval);
    validateBuild(build);
    validateCandidate(candidate);
    validateInstrumentation(instrumentation);
    validateLaunch(launch);
    validateCleanup(cleanup);
    validatePhase(phase);
    validateReports(root);

    assert.equal(approval.approvalConsumed, launch.approvalConsumed);
    assert.equal(approval.approvalConsumed, phase.approvalConsumed);
    assert.equal(approval.launchCount, launch.launchCount);
    assert.equal(approval.launchCount, instrumentation.activity.launchCount);
    assert.equal(approval.launchCount, phase.launchCount);
    assert.equal(approval.playbackStartCount, launch.playbackStartCount);
    assert.equal(
        approval.playbackStartCount,
        instrumentation.activity.playbackStartCount
    );
    assert.equal(approval.playbackStartCount, phase.playbackStartCount);
    assert.equal(candidate.strictCandidateCount, phase.strictCandidateCount);
    assert.equal(cleanup.cleanupNeeded, phase.cleanupNeeded);
}

export function validateNativeMediaIsolationC3PreflightEvidence(evidenceRoot) {
    const root = resolve(evidenceRoot);
    assert.equal(existsSync(root), true, 'Evidence root does not exist');
    for (const path of REQUIRED_FILES) {
        assert.equal(existsSync(join(root, path)), true, `Missing evidence file: ${path}`);
    }
    validateNativeMediaIsolationPrivacy(root, true);
    validateNativeMediaIsolationKnownPrivateValueScan(root);
    validateNativeMediaIsolationC3PreflightOutcome(root);
    validateNativeMediaIsolationRepeatInventory(root);
    return {
        status: 'PASS',
        schemaVersion: 'ptv-webos-native-media-isolation-c3-preflight-validation-v1',
        mode: 'final-preflight-hold',
        evidenceRoot: 'privacy-redacted',
        exactBuildAndWrapperValidated: true,
        noConformingCandidateValidated: true,
        noLaunchOrPlaybackValidated: true,
        boundedReadOnlyPreflightValidated: true,
        privacyValidated: true,
        artifactInventoryValidated: true
    };
}

function main(argv) {
    assert.equal(
        argv.length,
        1,
        'Usage: validate-native-media-isolation-c3-preflight-evidence.mjs <evidence-root>'
    );
    process.stdout.write(
        `${JSON.stringify(
            validateNativeMediaIsolationC3PreflightEvidence(argv[0]),
            null,
            2
        )}\n`
    );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
    main(process.argv.slice(2));
}
