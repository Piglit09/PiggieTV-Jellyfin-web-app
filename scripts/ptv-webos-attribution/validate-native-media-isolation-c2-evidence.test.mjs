import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
    validateNativeMediaIsolationC2Evidence,
    validateNativeMediaIsolationC2Outcome
} from './validate-native-media-isolation-c2-evidence.mjs';

const RUN_DIRECTORY = 'run-04-c2-audio-channel-directstream';
const STARTED_AT = '2026-07-28T15:06:00.000Z';
const ENDED_AT = '2026-07-28T15:21:15.000Z';
const OBSERVED_DURATION_SECONDS = 915;
const CONTROL = 'client-advertised-audio-channel-limit';
const CLASSIFICATION =
    'directplay-stable-vs-audio-limit-induced-directstream-correlation-only';
const ATTRIBUTION_PROOF_METHOD =
    'excluded-pre-count-setup-bound-by-same-in-memory-source-and-unchanged-state';
const ATTRIBUTION_LIMITATIONS = [
    'no-live-post-count-session',
    'actual-delivery-attributed-from-excluded-setup'
];
const DEPENDENT_OUTPUT_CHANGES = [
    'audio-channel-count',
    'audio-encode',
    'hls-container-and-segmentation'
];
const ZERO_COUNTED_INTERVAL_QUERIES = {
    processOrResource: 0,
    appPresence: 0,
    network: 0,
    server: 0,
    inspectorOrCdp: 0
};
const COUNTED_INSTRUMENTATION =
    'zero-renderer-injection-zero-periodic-polling';
const CLIENT_SETTING_LIMITATION =
    'complete-client-local-settings-not-digitally-snapshotted';
const SINGLE_RUN_LIMITATION = 'single-stable-run-not-proof-of-safety';
const PRIVACY_FINDINGS = Object.freeze({
    privateTenAddress: 0,
    privateOneNinetyTwoAddress: 0,
    privateOneSeventyTwoAddress: 0,
    privateLinkLocalV4Address: 0,
    privateOrLinkLocalV6Address: 0,
    loopbackAddress: 0,
    loopbackV6Address: 0,
    rawUrl: 0,
    absoluteWindowsPath: 0,
    absoluteHomePath: 0,
    forbiddenIdentityKey: 0,
    forbiddenSnakeCaseIdentityKey: 0,
    tokenCookieOrCredential: 0,
    snakeCaseCredential: 0,
    rawCredentialHeader: 0,
    bearerToken: 0
});

function createTemporaryRoot(t) {
    const root = mkdtempSync(join(tmpdir(), 'ptv-native-media-c2-'));
    t.after(() => {
        const resolved = resolve(root);
        if (resolved.startsWith(resolve(tmpdir()))) {
            rmSync(resolved, { force: true, recursive: true });
        }
    });
    return root;
}

function writeJson(root, relativePath, value) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root, relativePath, value) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
}

function listFiles(root) {
    const files = [];
    function visit(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(path);
            } else if (entry.isFile()) {
                files.push(path);
            }
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

function directStreamSignature(extra = {}) {
    return {
        selectedDeliveryCategory: 'DirectStream',
        videoDirect: true,
        videoTranscode: false,
        audioDirect: false,
        audioTranscode: true,
        containerRemux: true,
        outputContainerFamily: 'hls',
        segmentContainerCategory: 'ts',
        subtitleBurnIn: false,
        candidateCount: 1,
        transcodeReasons: ['AudioChannelsNotSupported'],
        ...extra
    };
}

function setupBoundAttribution(extra = {}) {
    return {
        selectedDeliveryCategory: 'DirectStream',
        proofMethod: ATTRIBUTION_PROOF_METHOD,
        countedPlaybackCompletedNormally: true,
        postCountMatchingActiveSessionCount: 0,
        livePostCountDeliveryCandidateObserved: false,
        sameSourceVerifiedInMemory: true,
        sourceIdentityRetained: false,
        audioChannelSettingUnchanged: true,
        subtitleStateUnchanged: true,
        limitations: ATTRIBUTION_LIMITATIONS,
        ...extra
    };
}

function createC2Fixture(t) {
    const root = createTemporaryRoot(t);
    const documents = {
        approval: {
            status: 'explicit',
            destructiveRiskAcknowledged: true,
            approvalRecordedAt: '2026-07-28T15:00:00.000Z',
            launchAuthorized: true,
            countedPlaybackStarted: true
        },
        boundary: {
            settingScope: {
                setting: 'allowedAudioChannels',
                mediaType: 'VideoAudio',
                storage: 'validation-app-local-per-user-setting'
            },
            original: {
                value: 'Auto',
                numericValue: -1,
                observedAt: '2026-07-28T15:02:00.000Z',
                physicallyVerified: true
            },
            temporary: {
                value: 'Mono',
                numericValue: 1,
                appliedAt: '2026-07-28T15:03:00.000Z',
                applicationMethod: 'existing-physical-webos-ui',
                physicallyVerified: true
            },
            deviceProfileConstraint: {
                property: 'AudioChannels',
                condition: 'LessThanEqual',
                value: 1,
                videoCapabilityOtherwiseUnchanged: true
            },
            clientPlaybackSettingsComparisons: {
                evidenceMethod: 'operator-controlled-single-field-physical-ui-observation',
                digitalSettingsSnapshotCaptured: false,
                completeSettingsCompared: false,
                operatorControlledFieldCount: 1,
                operatorControlledFieldPaths: ['allowedAudioChannels'],
                otherEffectiveSettingsDeltaProvenAbsent: false,
                rawSettingsRetained: false,
                limitations: [CLIENT_SETTING_LIMITATION]
            },
            restoration: {
                required: true,
                targetValue: 'Auto',
                targetNumericValue: -1,
                restoredAt: '2026-07-28T15:22:00.000Z',
                applicationMethod: 'existing-physical-webos-ui',
                physicallyVerified: true,
                physicalUiAutoConfirmed: true,
                physicalUiSaveConfirmed: true,
                exactOriginalValueRestored: true,
                noPostRestorationPlayback: true,
                postRestorationPlaybackCount: 0,
                additionalPlaybackAuthorized: false,
                separateRebootRiskAuthorized: false
            },
            targetSettingPersistentChangeRemaining: false,
            intendedChangedDimension: CONTROL,
            operatorControlledChanges: [CONTROL],
            dependentOutputChanges: DEPENDENT_OUTPUT_CHANGES,
            productSourceModified: false,
            serverConfigurationModified: false
        },
        build: {
            git: {
                commit: '44899b1fb556f4983ae2c1fa4e861d1ad0b4f4d8'
            },
            packageVersion: '10.11.11',
            artifacts: [
                {
                    name: 'index.html',
                    sha256: '9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc'
                },
                {
                    name: 'runtime.bundle.js',
                    sha256: '93ce794233526fc506b6cf58777397ea22f203b9387f808caad8912150656043'
                },
                {
                    name: 'main.jellyfin.bundle.js',
                    sha256: '8320ae8655682107692777ba8d62d74d014bbaa01b6c3648a60b0caf0f265161'
                }
            ],
            validationWrapper: {
                appInfoSha256: '76cdc80786399fc2a65758a139e19918c0181bd1e0bc95dd22d2a5e590c4284c',
                indexSha256: 'c4a24b16740f19982c8df3dc92bffc7bbed91840da6e25b41204010a8e0c2f02',
                packageSha256: '01da6c157e9822416df9f91f7d38764a6e1b67fa6d2bbc65779400f46c095794'
            },
            staticServerImplementation: 'python-standard-library-http-server',
            staticServerScriptSha256: null,
            implementationSameAsStableBaseline: false,
            exactRequiredIdentityMatched: true
        },
        cleanup: {
            completedAt: '2026-07-28T15:24:10.000Z',
            validationApplicationClosedByCommand: true,
            validationApplicationPresentAfterCleanup: false,
            staticServerOwnershipVerified: true,
            staticServerProcessPresent: false,
            staticListenerCount: 0,
            staticServerProcessIdentifierRetained: false,
            relevantNodeHelperCount: 0,
            forbiddenHelpers: {
                attributionHelpers: 0,
                sinkOrHeartbeatHelpers: 0,
                total: 0
            }
        },
        comparison: {
            stableBaselineReference: {
                phase: 'PiggieTV WebOS Phase 3A.1R.2a',
                run: 'run-02-same-baseline-repeat',
                artifactInventorySha256:
                    '3ec2125897384a2c7f035c3bdd2bd1120d6f83abba17719b5972d747f5b76c60',
                buildIdentitySha256:
                    'f5de0589775c977992758da96a38d0198a410f8c1d78b479cb19dba3bb601cbe',
                mediaCategorySha256:
                    'badcb6e710c0b4aa30c10710061e6dd834134d82856708e7215fe32d054fcb22',
                deliveryModeSha256:
                    '4b1a533b9f9137568fffaf9b59b515b747db5cae123b2ceeb7299a7fc48b39f6',
                runSummarySha256:
                    '7ea2f7d3b6aaff3fa521623d9ceffc00d8a6783ce84fbd58f53cf0bad9ad4800',
                result: 'stable',
                observedDurationSeconds: 971,
                deliveryMode: 'DirectPlay'
            },
            plannedComparison: {
                sameBuild: true,
                sameWrapper: true,
                samePhysicalDevice: true,
                sameFirmware: true,
                sameSourceVerifiedInMemory: true,
                sameSourceIdentityRetained: false,
                sameSubtitleState: true,
                sameAudioTrack: true,
                qualitySetting: 'Auto',
                intendedChangedDimension: CONTROL,
                deliveryTransition: 'DirectPlay-to-audio-limit-induced-DirectStream',
                operatorControlledChanges: [CONTROL],
                dependentOutputChanges: DEPENDENT_OUTPUT_CHANGES,
                operatorControlledFieldCount: 1,
                completeClientSettingsCompared: false,
                singleOperatorControlledChangeProven: false,
                strictSingleIndependentVariableProven: false,
                strictSingleEncodedOutputDimensionProven: false,
                classification: CLASSIFICATION
            },
            currentRun: setupBoundAttribution({
                actualDeliveryMode: 'DirectStream',
                result: 'stable',
                observedDurationSeconds: OBSERVED_DURATION_SECONDS,
                clientSettingRestored: true,
                serverConfigurationEffectiveValueDelta: false
            }),
            classification: CLASSIFICATION,
            isolationConclusion: 'inconclusive'
        },
        configuration: {
            scope: 'server-stored-user-configuration',
            proofMethod: 'bounded-pre-post-deep-equality-in-memory',
            rawConfigurationRetained: false,
            noServerWriteClaimed: false,
            noServerSideEffectProven: false,
            totalUpdateUserConfigurationCallCount: 2,
            effectiveServerConfigurationValueDelta: false,
            serverConfigurationModified: false,
            applySave: {
                updateUserConfigurationCallCount: 1,
                serverWriteOccurred: true,
                beforeSnapshotCaptured: true,
                afterSnapshotCaptured: true,
                completeConfigurationCompared: true,
                changedPropertyCount: 0,
                changedPropertyPaths: [],
                proofOutsideCountedInterval: true,
                verifiedAt: '2026-07-28T15:03:20.000Z'
            },
            restorationSave: {
                updateUserConfigurationCallCount: 1,
                serverWriteOccurred: true,
                beforeSnapshotCaptured: true,
                afterSnapshotCaptured: true,
                completeConfigurationCompared: true,
                changedPropertyCount: 0,
                changedPropertyPaths: [],
                proofOutsideCountedInterval: true,
                verifiedAt: '2026-07-28T15:22:20.000Z'
            }
        },
        delivery: {
            preRunBaselineDeliveryCategory: 'DirectPlay',
            requestedDeliveryCategory: 'DirectStream',
            setupVerification: directStreamSignature({
                excludedFromCountedCandidateCount: true,
                rawRecordRetained: false
            }),
            actualRunDecision: setupBoundAttribution({
                postRunServerReadQueries: 1,
                rawRecordRetained: false,
                independentlyObservedCountedSignature: false,
                setupSegmentContainerCategory: 'ts'
            }),
            countedIntervalServerQueries: 0,
            preCountDiagnosticServerReadCount: 3,
            setupDeliveryCandidatesExcluded: true,
            countableAsConditionalC2Correlation: true,
            cleanSingleVariableComparisonProven: false
        },
        device: {
            deviceClass: 'physical-lg-television',
            model: 'LG-70UN7070PUA',
            webosVersion: '5.6.2',
            firmwareVersion: '04.64.00',
            boardClass: 'K6LP_ATSC_US',
            sameDeviceCategoriesAsStableBaseline: true,
            validationApplicationRunning: false,
            networkAddressRetained: false
        },
        instrumentation: {
            preflight: {
                attributionHelpers: 0,
                sinkOrHeartbeatHelpers: 0,
                inspectorHelpers: 0,
                resourcePollers: 0,
                persistentDeviceShells: 0,
                developmentServers: 0,
                forbiddenHelperTotal: 0,
                staticServerCount: 1
            },
            preCountDiagnostics: {
                disclosed: true,
                bounded: true,
                nonPeriodic: true,
                occurredOutsideCountedInterval: true,
                serverQueryCount: 3,
                periodicPollingCount: 0
            },
            postCountRead: {
                disclosed: true,
                bounded: true,
                nonPeriodic: true,
                occurredOutsideCountedInterval: true,
                serverQueryCount: 1,
                matchingActiveSessionCount: 0
            },
            countedInterval: {
                startedAt: STARTED_AT,
                endedAt: ENDED_AT,
                observedDurationSeconds: OBSERVED_DURATION_SECONDS,
                periodicProcessResourcePolling: 0,
                appPresenceQueries: 0,
                networkProbes: 0,
                serverQueries: 0,
                cdpOrInspectorAttachments: 0,
                rendererOrBrowserInjections: 0,
                syntheticOrDeveloperInputs: 0,
                postStartPhysicalInputCount: 0
            }
        },
        launch: {
            requestedAt: '2026-07-28T15:01:00.000Z',
            automaticLaunch: false,
            launchCount: 1,
            launchSucceeded: true,
            rawLaunchOutputRetained: false,
            playbackStartedAt: STARTED_AT
        },
        markers: [
            {
                sequence: 1,
                observedAt: '2026-07-28T15:03:00.000Z',
                category: 'audio-channel-limit-applied',
                countedInterval: false,
                state: 'mono-applied',
                physicalUiConfirmed: true
            },
            {
                sequence: 2,
                observedAt: '2026-07-28T15:04:00.000Z',
                category: 'setup-playback-excluded',
                countedInterval: false,
                setupDeliveryCandidatesExcludedFromCountedRun: true,
                ...directStreamSignature()
            },
            {
                sequence: 3,
                observedAt: '2026-07-28T15:05:00.000Z',
                category: 'setup-playback-stopped',
                countedInterval: false,
                matchingPlaybackSessionCount: 0
            },
            {
                sequence: 4,
                observedAt: STARTED_AT,
                category: 'playback-start-confirmed',
                countedInterval: true,
                inputMethod: 'physical-lg-remote',
                postStartPhysicalInputCount: 0
            },
            {
                sequence: 5,
                observedAt: ENDED_AT,
                category: 'counted-interval-ended',
                countedInterval: true,
                observedDurationSeconds: OBSERVED_DURATION_SECONDS,
                postStartPhysicalInputCount: 0,
                countedPlaybackCompletedNormally: true,
                completionReason: 'normal-video-completion'
            },
            {
                sequence: 6,
                observedAt: '2026-07-28T15:21:20.000Z',
                category: 'post-count-session-read',
                countedInterval: false,
                platformRebootProven: false,
                countedPlaybackCompletedNormally: true,
                matchingActiveSessionCount: 0,
                livePostCountDeliveryCandidateObserved: false,
                serverReadCount: 1,
                bounded: true,
                nonPeriodic: true,
                proofMethod: ATTRIBUTION_PROOF_METHOD,
                limitations: ATTRIBUTION_LIMITATIONS
            },
            {
                sequence: 7,
                observedAt: '2026-07-28T15:22:00.000Z',
                category: 'audio-channel-limit-restored',
                countedInterval: false,
                state: 'auto-restored',
                physicalUiConfirmed: true,
                physicalUiSaveConfirmed: true,
                noPostRestorationPlayback: true,
                postRestorationPlaybackCount: 0,
                additionalPlaybackAuthorized: false
            },
            {
                sequence: 8,
                observedAt: '2026-07-28T15:24:10.000Z',
                category: 'post-run-cleanup-complete',
                countedInterval: false,
                validationApplicationPresent: false,
                staticServerProcessPresent: false,
                staticListenerCount: 0,
                relevantNodeHelperCount: 0
            }
        ],
        matrix: {
            runs: [
                {
                    run: 'stable-baseline-reference',
                    evidenceFrozen: true,
                    exactBuildMatch: true,
                    mediaCategory: 'low-complexity-h264-aac-mp4-sdr',
                    result: 'stable',
                    durationSeconds: 971,
                    deliveryMode: 'DirectPlay',
                    changedDimension: 'none',
                    instrumentation: COUNTED_INSTRUMENTATION,
                    countedIntervalQueries: ZERO_COUNTED_INTERVAL_QUERIES,
                    postStartInputCount: 0,
                    stableDurationProven: true,
                    platformRebootProven: false,
                    evidenceLimitations: [SINGLE_RUN_LIMITATION]
                },
                setupBoundAttribution({
                    run: RUN_DIRECTORY,
                    exactBuildMatch: true,
                    mediaCategory: 'same-low-complexity-h264-aac-mp4-sdr-source',
                    result: 'stable',
                    durationSeconds: OBSERVED_DURATION_SECONDS,
                    deliveryMode: 'DirectStream',
                    actualDeliveryMode: 'DirectStream',
                    intendedChangedDimension: CONTROL,
                    operatorControlledChanges: [CONTROL],
                    operatorControlledFieldCount: 1,
                    completeClientSettingsCompared: false,
                    singleOperatorControlledChangeProven: false,
                    strictSingleIndependentVariableProven: false,
                    strictSingleEncodedOutputDimensionProven: false,
                    instrumentation: COUNTED_INSTRUMENTATION,
                    countedIntervalQueries: ZERO_COUNTED_INTERVAL_QUERIES,
                    postStartInputCount: 0,
                    stableDurationProven: true,
                    platformRebootProven: false,
                    evidenceLimitations: [
                        ...ATTRIBUTION_LIMITATIONS,
                        CLIENT_SETTING_LIMITATION,
                        SINGLE_RUN_LIMITATION
                    ],
                    classification: CLASSIFICATION
                })
            ],
            decision: 'HOLD-media-comparisons-incomplete',
            interpretationRule: 'correlation-only-not-root-causation'
        },
        media: {
            sourceIdentityRetained: false,
            sameSourceAsStableBaseline: true,
            container: 'mp4',
            videoCodec: 'h264-avc',
            videoProfile: 'high',
            videoLevel: '4.1',
            audioCodec: 'aac-lc',
            channelLayout: 'stereo',
            audioStreamCount: 1,
            resolution: {
                width: 1904,
                height: 1072
            },
            frameRate: {
                average: 23.976,
                real: 23.976,
                constantOrConventional: true
            },
            bitDepth: 8,
            chromaFormat: 'yuv420p',
            dynamicRange: 'sdr',
            subtitleState: 'none',
            multipleVideoVersions: false,
            bitrateClass: 'moderate',
            durationClass: '15-minutes-or-longer',
            meetsBaselineRequirements: true
        },
        output: {
            deliveryCategory: 'DirectStream',
            ...directStreamSignature(),
            observationBoundary: 'excluded-pre-count-setup',
            proofMethod: ATTRIBUTION_PROOF_METHOD,
            appliesToCountedRunThroughBoundedAttribution: true,
            countedRunOutputIndependentlyObserved: false,
            postCountMatchingActiveSessionCount: 0,
            limitations: ATTRIBUTION_LIMITATIONS,
            source: {
                videoCodec: 'h264-avc',
                audioCodec: 'aac-lc',
                audioChannels: 2,
                container: 'mp4',
                width: 1904,
                height: 1072
            },
            output: {
                videoCodec: 'h264',
                audioCodec: 'aac',
                audioChannels: 1,
                containerFamily: 'hls',
                segmentContainerCategory: 'ts',
                width: 1904,
                height: 1072
            },
            dependentOutputChanges: DEPENDENT_OUTPUT_CHANGES,
            strictSingleEncodedOutputDimensionProven: false,
            rawRecordRetained: false,
            exactSourceOrOutputBitrateRetained: false
        },
        phase: {
            phase: 'PiggieTV WebOS Phase 3A.1R.2c',
            run4: {
                directory: RUN_DIRECTORY,
                result: 'stable',
                actualDeliveryMode: 'DirectStream',
                ...setupBoundAttribution(),
                observedDurationSeconds: OBSERVED_DURATION_SECONDS,
                postStartInputCount: 0,
                intendedChangedDimension: CONTROL,
                operatorControlledChanges: [CONTROL],
                clientSettingRestored: true,
                postRestorationPlaybackCount: 0,
                serverConfigurationEffectiveValueDelta: false,
                classification: CLASSIFICATION,
                operatorControlledFieldCount: 1,
                completeClientSettingsCompared: false,
                singleOperatorControlledChangeProven: false,
                strictSingleIndependentVariableProven: false,
                strictSingleEncodedOutputDimensionProven: false
            },
            decision: 'HOLD-media-comparisons-incomplete',
            isolationConclusion: 'inconclusive',
            automaticLaunch: false,
            productionModified: false,
            productSourceModified: false,
            serverConfigurationModified: false,
            ownershipBoundariesModified: false
        },
        run: {
            run: RUN_DIRECTORY,
            result: 'stable',
            decision: 'HOLD-media-comparisons-incomplete',
            actualDeliveryMode: 'DirectStream',
            ...setupBoundAttribution({
                independentlyObservedCountedSignature: false
            }),
            countedInterval: {
                startedAt: STARTED_AT,
                endedAt: ENDED_AT,
                observedDurationSeconds: OBSERVED_DURATION_SECONDS,
                postStartPhysicalInputCount: 0,
                queryAndPollingCount: 0,
                countedPlaybackCompletedNormally: true
            },
            observedDurationSeconds: OBSERVED_DURATION_SECONDS,
            stableDurationProven: true,
            platformRebootProven: false,
            clientSettingRestored: true,
            postRestorationPlaybackCount: 0,
            serverConfigurationEffectiveValueDelta: false,
            classification: CLASSIFICATION,
            operatorControlledFieldCount: 1,
            completeClientSettingsCompared: false,
            singleOperatorControlledChangeProven: false,
            strictSingleIndependentVariableProven: false,
            strictSingleEncodedOutputDimensionProven: false,
            isolationConclusion: 'inconclusive',
            productionModified: false,
            productSourceModified: false,
            serverConfigurationModified: false,
            ownershipBoundariesModified: false
        },
        staticDelivery: {
            serverActiveDuringCountedInterval: true,
            serverActiveAfterCleanup: false,
            serverCount: 1,
            serverCountScope: 'counted-interval',
            servedArtifacts: [
                {
                    name: 'index.html',
                    sha256: '9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc'
                },
                {
                    name: 'runtime.bundle.js',
                    sha256: '93ce794233526fc506b6cf58777397ea22f203b9387f808caad8912150656043'
                },
                {
                    name: 'main.jellyfin.bundle.js',
                    sha256: '8320ae8655682107692777ba8d62d74d014bbaa01b6c3648a60b0caf0f265161'
                }
            ],
            servedIndexSha256:
                '9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc',
            expectedIndexSha256:
                '9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc',
            exactIndexMatched: true,
            rendererInjectionDetected: false,
            rawRequestDataRetained: false,
            staticServerOwnershipVerified: true,
            processIdentifierRetained: false,
            listenerRemoved: true
        },
        uptimeBefore: {
            observedAt: '2026-07-28T14:59:00.000Z',
            uptimeSeconds: 10000,
            sampleCount: 1
        },
        uptimeAfter: {
            observedAt: '2026-07-28T15:21:25.000Z',
            uptimeSeconds: 11345,
            sampleCount: 1,
            increasedFromPreRun: true,
            platformRebootProven: false
        }
    };

    function persist() {
        writeJson(root, 'comparison-to-stable-baseline.json', documents.comparison);
        writeJson(root, 'comparison-matrix.json', documents.matrix);
        writeJson(root, 'phase-summary.json', documents.phase);
        writeJson(root, `${RUN_DIRECTORY}/approval.json`, documents.approval);
        writeJson(
            root,
            `${RUN_DIRECTORY}/audio-channel-setting-boundary.json`,
            documents.boundary
        );
        writeJson(root, `${RUN_DIRECTORY}/build-identity.json`, documents.build);
        writeJson(root, `${RUN_DIRECTORY}/cleanup.json`, documents.cleanup);
        writeJson(root, `${RUN_DIRECTORY}/delivery-mode.json`, documents.delivery);
        writeJson(root, `${RUN_DIRECTORY}/device-state-before.json`, documents.device);
        writeJson(
            root,
            `${RUN_DIRECTORY}/directstream-output-category.json`,
            documents.output
        );
        writeJson(
            root,
            `${RUN_DIRECTORY}/instrumentation-absence.json`,
            documents.instrumentation
        );
        writeJson(root, `${RUN_DIRECTORY}/launch-summary.json`, documents.launch);
        writeJson(root, `${RUN_DIRECTORY}/media-category.json`, documents.media);
        writeText(
            root,
            `${RUN_DIRECTORY}/operator-markers.ndjson`,
            `${documents.markers.map(marker => JSON.stringify(marker)).join('\n')}\n`
        );
        writeJson(root, `${RUN_DIRECTORY}/run-summary.json`, documents.run);
        writeJson(
            root,
            `${RUN_DIRECTORY}/server-user-configuration-boundary.json`,
            documents.configuration
        );
        writeJson(
            root,
            `${RUN_DIRECTORY}/static-delivery-summary.json`,
            documents.staticDelivery
        );
        writeJson(root, `${RUN_DIRECTORY}/uptime-before.json`, documents.uptimeBefore);
        writeJson(root, `${RUN_DIRECTORY}/uptime-after.json`, documents.uptimeAfter);
    }

    function finalize() {
        persist();
        writeText(root, 'README.md', '# C2 evidence\n\nPrivacy-redacted controlled comparison.\n');
        writeText(
            root,
            'final-report.md',
            '# C2 final report\n\nDecision: HOLD. Isolation remains inconclusive.\n'
        );
        writeJson(root, 'known-private-value-scan.json', {
            schemaVersion: 'ptv-webos-known-private-value-scan-v1',
            status: 'PASS',
            rawValuesRetained: false,
            knownValueCoverageLimitedToCapturedCorrelationValues: true,
            categories: {
                mediaItemIdentifier: 0,
                mediaTitle: 0,
                mediaPath: 0,
                mediaFilename: 0
            },
            additionalSchemaAndManualReviewCategories: {
                mediaSourceIdentifier: 0,
                playbackSessionOrSessionIdentifier: 0,
                userIdentifier: 0,
                uniqueDeviceOrServerIdentifier: 0,
                playbackOrStreamUrl: 0,
                tokenCookieOrCredential: 0,
                localUsernameOrAbsolutePath: 0,
                bootIdentifier: 0,
                rawKeyCode: 0
            }
        });
        const excludedFromPrivacy = new Set([
            'artifact-inventory.json',
            'known-private-value-scan.json',
            'privacy-scan.json'
        ]);
        const filesScanned = listFiles(root)
            .map(path => normalizeRelative(root, path))
            .filter(path => !excludedFromPrivacy.has(path))
            .length;
        writeJson(root, 'privacy-scan.json', {
            status: 'PASS',
            filesScanned,
            rawPrivateValuesRetained: false,
            findings: PRIVACY_FINDINGS
        });
        const artifacts = listFiles(root)
            .map(path => ({
                file: normalizeRelative(root, path),
                path
            }))
            .filter(artifact => artifact.file !== 'artifact-inventory.json')
            .sort((left, right) => left.file.localeCompare(right.file))
            .map(artifact => ({
                file: artifact.file,
                sizeBytes: statSync(artifact.path).size,
                sha256: sha256(artifact.path),
                classification: 'share-safe'
            }));
        writeJson(root, 'artifact-inventory.json', {
            schemaVersion: 'ptv-webos-native-media-isolation-artifact-inventory-v1',
            selfHashExcluded: true,
            artifacts
        });
    }

    persist();
    return { documents, finalize, persist, root };
}

test('accepts the conditional audio-limit-induced DirectStream signature', t => {
    const fixture = createC2Fixture(t);

    assert.doesNotThrow(() => validateNativeMediaIsolationC2Outcome(fixture.root));
});

test('requires complete comparison-matrix identity, instrumentation, and limitations', t => {
    const fixture = createC2Fixture(t);
    const c2 = fixture.documents.matrix.runs[1];

    c2.exactBuildMatch = false;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    c2.exactBuildMatch = true;
    c2.countedIntervalQueries.server = 1;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    c2.countedIntervalQueries.server = 0;
    c2.platformRebootProven = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    c2.platformRebootProven = false;
    c2.evidenceLimitations = [SINGLE_RUN_LIMITATION];
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));
});

test('requires setup-bound attribution after normal completion and zero live post-count matches', t => {
    const fixture = createC2Fixture(t);
    const attribution = fixture.documents.delivery.actualRunDecision;

    attribution.proofMethod = 'live-post-count-session';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    attribution.proofMethod = ATTRIBUTION_PROOF_METHOD;
    attribution.livePostCountDeliveryCandidateObserved = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    attribution.livePostCountDeliveryCandidateObserved = false;
    attribution.postCountMatchingActiveSessionCount = 1;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    attribution.postCountMatchingActiveSessionCount = 0;
    attribution.countedPlaybackCompletedNormally = false;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));
});

test('accepts a co-timestamped bounded post-count session and uptime observation', t => {
    const fixture = createC2Fixture(t);

    fixture.documents.uptimeAfter.observedAt = '2026-07-28T15:21:20.000Z';
    fixture.documents.uptimeAfter.uptimeSeconds = 11340;
    fixture.persist();

    assert.doesNotThrow(() => validateNativeMediaIsolationC2Outcome(fixture.root));
});

test('rejects video encoding, pure Remux, missing audio encoding, or multiple candidates', t => {
    const fixture = createC2Fixture(t);
    const decision = fixture.documents.delivery.setupVerification;

    decision.videoDirect = false;
    decision.videoTranscode = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    decision.videoDirect = true;
    decision.videoTranscode = false;
    decision.audioDirect = true;
    decision.audioTranscode = false;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    decision.audioDirect = false;
    decision.audioTranscode = false;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    decision.audioTranscode = true;
    decision.candidateCount = 2;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    decision.candidateCount = 1;
    decision.subtitleBurnIn = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));
});

test('requires AudioChannelsNotSupported as the only server reason', t => {
    const fixture = createC2Fixture(t);

    fixture.documents.delivery.setupVerification.transcodeReasons = [
        'AudioChannelsNotSupported',
        'ContainerBitrateExceedsLimit'
    ];
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.delivery.setupVerification.transcodeReasons = [
        'ContainerBitrateExceedsLimit'
    ];
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));
});

test('requires truthful one-field operator evidence and exact physical Auto restoration', t => {
    const fixture = createC2Fixture(t);

    fixture.documents.boundary.clientPlaybackSettingsComparisons.completeSettingsCompared = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.boundary.clientPlaybackSettingsComparisons.completeSettingsCompared = false;
    fixture.documents.boundary.clientPlaybackSettingsComparisons
        .otherEffectiveSettingsDeltaProvenAbsent = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.boundary.clientPlaybackSettingsComparisons
        .otherEffectiveSettingsDeltaProvenAbsent = false;
    fixture.documents.boundary.clientPlaybackSettingsComparisons.operatorControlledFieldCount = 2;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.boundary.clientPlaybackSettingsComparisons.operatorControlledFieldCount = 1;
    fixture.documents.boundary.restoration.exactOriginalValueRestored = false;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.boundary.restoration.exactOriginalValueRestored = true;
    fixture.documents.boundary.restoration.physicalUiSaveConfirmed = false;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));
});

test('rejects any restoration playback or authorization for its separate reboot risk', t => {
    const fixture = createC2Fixture(t);

    fixture.documents.boundary.restoration.postRestorationPlaybackCount = 1;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.boundary.restoration.postRestorationPlaybackCount = 0;
    fixture.documents.boundary.restoration.additionalPlaybackAuthorized = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.boundary.restoration.additionalPlaybackAuthorized = false;
    fixture.documents.boundary.restoration.separateRebootRiskAuthorized = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));
});

test('requires disclosed idempotent server writes and complete zero-delta proof', t => {
    const fixture = createC2Fixture(t);

    fixture.documents.configuration.noServerWriteClaimed = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.configuration.noServerWriteClaimed = false;
    fixture.documents.configuration.noServerSideEffectProven = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.configuration.noServerSideEffectProven = false;
    fixture.documents.configuration.applySave.changedPropertyCount = 1;
    fixture.documents.configuration.applySave.changedPropertyPaths = ['AudioLanguagePreference'];
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.configuration.applySave.changedPropertyCount = 0;
    fixture.documents.configuration.applySave.changedPropertyPaths = [];
    fixture.documents.configuration.restorationSave.completeConfigurationCompared = false;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));
});

test('freezes the HLS segment-container subtype and ignores raw PlayMethod labeling', t => {
    const fixture = createC2Fixture(t);

    fixture.documents.delivery.actualRunDecision.rawServerPlayMethodCategory = 'Transcode';
    fixture.documents.delivery.setupVerification.rawServerPlayMethodCategory = 'Transcode';
    fixture.documents.output.rawServerPlayMethodCategory = 'Transcode';
    fixture.documents.run.rawServerPlayMethodCategory = 'Transcode';
    fixture.persist();
    assert.doesNotThrow(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.output.segmentContainerCategory = 'fmp4';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));
});

test('requires bounded disclosed pre-count reads and zero counted reads or polling', t => {
    const fixture = createC2Fixture(t);

    fixture.documents.instrumentation.countedInterval.postStartPhysicalInputCount = 1;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.instrumentation.countedInterval.postStartPhysicalInputCount = 0;
    fixture.documents.instrumentation.countedInterval.networkProbes = 1;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.instrumentation.countedInterval.networkProbes = 0;
    fixture.documents.delivery.countedIntervalServerQueries = 1;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.delivery.countedIntervalServerQueries = 0;
    fixture.documents.instrumentation.preCountDiagnostics.disclosed = false;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.instrumentation.preCountDiagnostics.disclosed = true;
    fixture.documents.instrumentation.preCountDiagnostics.nonPeriodic = false;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));
});

test('requires approval, one manual launch, and ordered setup/restoration boundaries', t => {
    const fixture = createC2Fixture(t);

    fixture.documents.approval.status = 'implicit';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.approval.status = 'explicit';
    fixture.documents.launch.launchCount = 2;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.launch.launchCount = 1;
    fixture.documents.configuration.applySave.verifiedAt = '2026-07-28T15:04:30.000Z';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));
});

test('requires the 915-second normal no-reboot HOLD while isolation stays inconclusive', t => {
    const fixture = createC2Fixture(t);

    fixture.documents.run.observedDurationSeconds = 899;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.run.observedDurationSeconds = OBSERVED_DURATION_SECONDS;
    fixture.documents.run.platformRebootProven = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.run.platformRebootProven = false;
    fixture.documents.run.decision = 'BLOCK-c2-full-platform-reboot';
    fixture.documents.phase.decision = 'BLOCK-c2-full-platform-reboot';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));

    fixture.documents.run.decision = 'HOLD-media-comparisons-incomplete';
    fixture.documents.phase.decision = 'HOLD-media-comparisons-incomplete';
    fixture.documents.phase.isolationConclusion = 'proven';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC2Outcome(fixture.root));
});

test('full validator enforces exact build, privacy scans, and artifact inventory', t => {
    const fixture = createC2Fixture(t);
    fixture.finalize();

    assert.deepEqual(validateNativeMediaIsolationC2Evidence(fixture.root), {
        status: 'PASS',
        schemaVersion: 'ptv-webos-native-media-isolation-c2-validation-v1',
        mode: 'final',
        evidenceRoot: 'privacy-redacted',
        exactBuildSourceTvParityValidated: true,
        conditionalDirectStreamValidated: true,
        clientSettingAndServerConfigurationBoundariesValidated: true,
        privacyValidated: true,
        artifactInventoryValidated: true
    });

    fixture.documents.build.git.commit = 'different';
    fixture.finalize();
    assert.throws(() => validateNativeMediaIsolationC2Evidence(fixture.root));
});

test('full validator rejects private identity fields and stale inventory hashes', t => {
    const privateFixture = createC2Fixture(t);
    privateFixture.documents.run.mediaTitle = 'not-retainable';
    privateFixture.finalize();
    assert.throws(() => validateNativeMediaIsolationC2Evidence(privateFixture.root));

    const staleFixture = createC2Fixture(t);
    staleFixture.finalize();
    writeText(staleFixture.root, 'README.md', '# changed after inventory\n');
    assert.throws(() => validateNativeMediaIsolationC2Evidence(staleFixture.root));
});
