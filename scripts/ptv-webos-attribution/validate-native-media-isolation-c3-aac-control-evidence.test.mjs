import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
    dirname,
    join,
    relative,
    sep
} from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
    C3_AAC_CONTROL_CONTRACT,
    validateNativeMediaIsolationC3AacControlEvidence,
    validateNativeMediaIsolationC3AacControlPreparedReference,
    validateNativeMediaIsolationC3AacControlOutcome
} from './validate-native-media-isolation-c3-aac-control-evidence.mjs';

const RUN = C3_AAC_CONTROL_CONTRACT.runDirectory;
const CONTROL_SHA = C3_AAC_CONTROL_CONTRACT.controlAssetSha256;
const CANDIDATE_SHA = C3_AAC_CONTROL_CONTRACT.candidateAssetSha256;
const ZERO_DTS = Object.freeze({
    stagedCount: 0,
    mountedCount: 0,
    indexedCount: 0,
    planningQueryCount: 0,
    metadataQueryCount: 0,
    mediaRequestCount: 0,
    playbackStartCount: 0,
    transcodeEventCount: 0
});
const TIMES = Object.freeze({
    approval: '2026-07-28T20:00:00.000Z',
    preflight: '2026-07-28T20:01:00.000Z',
    uptimeBefore: '2026-07-28T20:01:30.000Z',
    launch: '2026-07-28T20:02:00.000Z',
    start: '2026-07-28T20:02:10.000Z',
    terminal: '2026-07-28T20:17:10.000Z',
    delivery: '2026-07-28T20:17:20.000Z',
    uptimeAfter: '2026-07-28T20:17:30.000Z',
    closed: '2026-07-28T20:17:40.000Z',
    cleanup: '2026-07-28T20:18:00.000Z'
});
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

function writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
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

function createFixture() {
    const workspace = mkdtempSync(join(tmpdir(), 'ptv-c3-aac-control-'));
    const root = join(workspace, 'current');
    const runRoot = join(root, RUN);
    mkdirSync(runRoot, { recursive: true });

    writeJson(join(runRoot, 'approval.json'), {
        schemaVersion: 1,
        run: RUN,
        status: 'explicit',
        scope: C3_AAC_CONTROL_CONTRACT.approvalScope,
        approvalReceivedAt: TIMES.approval,
        preflightPassedAt: TIMES.preflight,
        consumedAt: TIMES.launch,
        destructiveRiskAcknowledged: true,
        readOnlyPreflightAuthorized: true,
        singleValidationApplicationLaunchAttemptAuthorized: true,
        singleSyntheticAacControlPlaybackAuthorized: true,
        dtsCandidateStagingAuthorized: false,
        dtsCandidatePlanningAuthorized: false,
        dtsCandidatePlaybackAuthorized: false,
        productionContactAuthorized: false,
        repeatOrRelaunchAuthorized: false,
        consumedBy: 'first-validation-application-launch-attempt',
        launchAttemptCount: 1,
        countedPlaybackStartCount: 1,
        approvalExhausted: true
    });
    writeJson(join(runRoot, 'build-identity.json'), {
        git: {
            commit: '44899b1fb556f4983ae2c1fa4e861d1ad0b4f4d8'
        },
        packageVersion: '10.11.11',
        exactRequiredIdentityMatched: true,
        artifacts: [
            {
                name: 'index.html',
                sha256:
                    '9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc'
            },
            {
                name: 'runtime.bundle.js',
                sha256:
                    '93ce794233526fc506b6cf58777397ea22f203b9387f808caad8912150656043'
            },
            {
                name: 'main.jellyfin.bundle.js',
                sha256:
                    '8320ae8655682107692777ba8d62d74d014bbaa01b6c3648a60b0caf0f265161'
            }
        ],
        validationWrapper: {
            appInfoSha256:
                '76cdc80786399fc2a65758a139e19918c0181bd1e0bc95dd22d2a5e590c4284c',
            indexSha256:
                'c4a24b16740f19982c8df3dc92bffc7bbed91840da6e25b41204010a8e0c2f02',
            packageSha256:
                '01da6c157e9822416df9f91f7d38764a6e1b67fa6d2bbc65779400f46c095794'
        },
        productionBundleServedLocally: true,
        developmentServerClientPresent: false,
        responseInjectionPresent: false,
        productSourceModifiedForRun: false,
        staticServerScriptSha256:
            '8b8d4c66f9bd18a0bb033eda2ac424ae95633563fb221846a16cd8a293e6cb81'
    });
    writeJson(join(runRoot, 'fixture-lineage.json'), {
        schemaVersion: 1,
        preparedEvidenceDirectory:
            C3_AAC_CONTROL_CONTRACT.preparedEvidenceDirectory,
        preparedEvidenceHashes:
            C3_AAC_CONTROL_CONTRACT.preparedEvidenceHashes,
        selectedRole: 'control',
        selectedAssetSha256: CONTROL_SHA,
        selectedAssetHashMatchedBeforeStage: true,
        selectedAssetReadOnly: true,
        stagedRoles: ['control'],
        candidateRetainedSealed: true,
        candidateAssetSha256: CANDIDATE_SHA,
        candidateHashMatchedWithoutStageOrMount: true,
        candidateStaged: false,
        candidateMounted: false,
        candidateClientReachable: false,
        rawFixtureNamesRetained: false,
        fixturePathsRetained: false
    });
    writeJson(join(runRoot, 'candidate-exclusion.json'), {
        schemaVersion: 1,
        role: 'candidate',
        codecCategory: 'dts-core',
        authorized: false,
        staged: false,
        mounted: false,
        indexed: false,
        clientReachable: false,
        selectable: false,
        runtimeDeliveryProven: false,
        futureRunAuthorized: false,
        activity: ZERO_DTS
    });
    writeJson(join(runRoot, 'media-category.json'), {
        schemaVersion: 1,
        role: 'control',
        sourceKind: 'deterministic-synthetic-neutral',
        sourceIdentityRetained: false,
        assetSha256Retained: true,
        assetSha256: CONTROL_SHA,
        container: 'mp4',
        containerFragmented: false,
        progressiveFastStart: true,
        videoStreamCount: 1,
        videoCodec: 'h264-avc',
        videoSampleEntry: 'avc1',
        videoProfile: 'high',
        videoLevel: '4.1',
        audioCodec: 'aac-lc',
        audioSampleEntry: 'mp4a',
        audioProfile: 'lc',
        audioCodecString: 'mp4a.40.2',
        resolution: {
            width: 1904,
            height: 1072
        },
        frameRate: {
            numerator: 24000,
            denominator: 1001,
            class: 'conventional-cfr'
        },
        frameCount: 23040,
        durationSeconds: 960.96,
        bitDepth: 8,
        chromaFormat: 'yuv420p',
        dynamicRange: 'sdr',
        colorPrimaries: 'bt709',
        colorTransfer: 'bt709',
        colorMatrix: 'bt709',
        colorRange: 'limited',
        subtitleState: 'none',
        subtitleStreamCount: 0,
        audioStreamCount: 1,
        channelLayout: 'stereo',
        sampleRateHz: 48000,
        bitrateClass: 'moderate',
        multipleVideoVersions: false,
        extraStreamCount: 0,
        exactPreparedControlMatched: true
    });
    writeJson(join(runRoot, 'isolated-server-boundary.json'), {
        schemaVersion: 1,
        environment: 'fresh-disposable-isolated-non-production',
        jellyfinVersion: '10.11.11',
        serverImageDigestSha256:
            'aefb67e6a7ff1debdd154a78a7bbb780fd0c873d8639210a7f6a2016ad2b35db',
        syntheticOnlyLibrary: true,
        libraryItemCount: 1,
        mountedFixtureCount: 1,
        mountedRoles: ['control'],
        mediaMountReadOnly: true,
        dedicatedTemporaryAccount: true,
        freshConfiguration: true,
        freshDatabase: true,
        freshCache: true,
        productionCredentialsUsed: false,
        productionRouteAvailable: false,
        productionConfigurationMounted: false,
        productionDatabaseMounted: false,
        productionMediaMounted: false,
        publicInternetExposure: false,
        discoveryEnabled: false,
        networkLimitedToPhysicalValidationPath: true,
        candidateStaged: false,
        candidateMounted: false,
        candidateIndexed: false,
        candidateClientReachable: false,
        dtsActivity: ZERO_DTS,
        rawRuntimeIdentityRetained: false,
        removedDuringCleanup: true
    });
    const directPlay = {
        selectedDeliveryCategory: 'DirectPlay',
        mediaSourceCandidateCount: 1,
        container: 'mp4',
        videoCodec: 'h264-avc',
        audioCodec: 'aac-lc',
        videoDirect: true,
        audioDirect: true,
        videoTranscode: false,
        audioTranscode: false,
        containerRemux: false,
        subtitleBurnIn: false,
        transcodingUrlPresent: false,
        transcodingReasons: []
    };
    writeJson(join(runRoot, 'delivery-mode.json'), {
        schemaVersion: 1,
        controlAssetSha256: CONTROL_SHA,
        sourceBoundToPreparedHashInMemory: true,
        sourceIdentityRetained: false,
        rawPlanningResponseRetained: false,
        rawPlaybackRecordRetained: false,
        rawUrlsRetained: false,
        rawIdsRetained: false,
        preRunPlanning: {
            queryCount: 1,
            bounded: true,
            nonPeriodic: true,
            occurredBeforeCountedInterval: true,
            supportsDirectPlay: true,
            deviceProfileWebosVersion: '5.6.2',
            videoQuality: 'auto',
            allowedAudioChannels: 'stereo-or-greater',
            subtitleState: 'off',
            ...directPlay
        },
        actualRunDecision: {
            proofMethod: 'post-count-bounded-live-server-playback-record',
            serverReadCount: 1,
            bounded: true,
            nonPeriodic: true,
            occurredAfterCountedInterval: true,
            matchingPlaybackSessionCount: 1,
            actualRuntimeMethodProven: true,
            ffmpegProcessObserved: false,
            ffmpegCommandObserved: false,
            serverTranscodeEventCount: 0,
            playbackActiveDuringProof: true,
            observedAt: TIMES.delivery,
            ...directPlay
        },
        countedIntervalServerQueryCount: 0,
        countableAsExactSyntheticAacDirectPlayControl: true,
        dtsActivity: ZERO_DTS
    });
    writeJson(join(runRoot, 'instrumentation-absence.json'), {
        schemaVersion: 1,
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
        countedInterval: {
            status: 'ended-zero-input',
            startedAt: TIMES.start,
            endedAt: TIMES.terminal,
            observedDurationSeconds: 900,
            periodicProcessResourcePolling: 0,
            appPresenceQueries: 0,
            networkProbes: 0,
            serverQueries: 0,
            cdpOrInspectorAttachments: 0,
            rendererOrBrowserInjections: 0,
            syntheticOrDeveloperInputs: 0,
            postStartPhysicalInputCount: 0
        }
    });
    writeJson(join(runRoot, 'device-state-before.json'), {
        schemaVersion: 1,
        deviceClass: 'physical-lg-television',
        model: 'LG-70UN7070PUA',
        webosVersion: '5.6.2',
        firmwareVersion: '04.64.00',
        boardClass: 'K6LP_ATSC_US',
        fullyBootedAndStable: true,
        validationApplicationRunning: false,
        validationApplicationAbsenceQueryCount: 1,
        networkAddressRetained: false,
        bootIdentifierRetained: false
    });
    writeJson(join(runRoot, 'launch-summary.json'), {
        schemaVersion: 1,
        requestedAt: TIMES.launch,
        launchAttemptCount: 1,
        launchSucceeded: true,
        automaticLaunch: false,
        rawLaunchOutputRetained: false,
        relaunchCount: 0,
        countedRunStarted: true,
        playbackStartCount: 1,
        playbackStartedAt: TIMES.start
    });
    const markers = [
        {
            sequence: 1,
            category: 'playback-start-confirmed',
            observedAt: TIMES.start,
            countedInterval: true,
            state: 'playing',
            inputMethod: 'physical-lg-remote',
            startPosition: 'zero',
            postStartPhysicalInputCount: 0
        },
        {
            sequence: 2,
            category: 'stable-duration-confirmed',
            observedAt: TIMES.terminal,
            countedInterval: true,
            state: 'playing',
            observedDurationSeconds: 900,
            postStartPhysicalInputCount: 0
        },
        {
            sequence: 3,
            category: 'post-count-directplay-proven',
            observedAt: TIMES.delivery,
            countedInterval: false,
            selectedDeliveryCategory: 'DirectPlay',
            mediaSourceCandidateCount: 1,
            dtsActivityCount: 0
        },
        {
            sequence: 4,
            category: 'post-run-application-closed',
            observedAt: TIMES.closed,
            countedInterval: false
        },
        {
            sequence: 5,
            category: 'post-run-cleanup-complete',
            observedAt: TIMES.cleanup,
            countedInterval: false
        }
    ];
    writeFileSync(
        join(runRoot, 'operator-markers.ndjson'),
        `${markers.map(marker => JSON.stringify(marker)).join('\n')}\n`
    );
    writeJson(join(runRoot, 'reboot-proof.json'), {
        schemaVersion: 1,
        classification: 'not-observed',
        platformRebootProven: false,
        continuousUptimeProven: true,
        correlationClaimed: false
    });
    writeJson(join(runRoot, 'run-summary.json'), {
        schemaVersion: 1,
        run: RUN,
        result: 'stable',
        displayResult: 'PASS — SINGLE SYNTHETIC AAC CONTROL STABLE',
        classification: 'synthetic-aac-control-stable',
        terminalMarkerCategory: 'stable-duration-confirmed',
        decision: C3_AAC_CONTROL_CONTRACT.stableDecision,
        countedInterval: {
            startedAt: TIMES.start,
            endedAt: TIMES.terminal,
            observedDurationSeconds: 900,
            postStartPhysicalInputCount: 0,
            queryAndPollingCount: 0
        },
        observedDurationSeconds: 900,
        actualDeliveryMode: 'DirectPlay',
        physicalPlaybackStart: true,
        playbackStartAtZero: true,
        stableDurationProven: true,
        countedObservationCompletedNormally: true,
        playbackStateAtTerminal: 'playing',
        normalMediaCompletionObserved: false,
        platformRebootProven: false,
        platformRebootCorrelatedToDirectPlayControl: false,
        interruptionCategory: null,
        productionContactCount: 0,
        productionModified: false,
        productSourceModified: false,
        ownershipBoundariesModified: false,
        rawMediaOrSessionIdentityRetained: false,
        applicationStateAtCleanup: 'closed-by-command',
        dtsActivity: ZERO_DTS,
        candidateRuntimeDeliveryProven: false,
        futureDtsRunAuthorized: false
    });
    writeJson(join(runRoot, 'uptime-before.json'), {
        schemaVersion: 1,
        observedAt: TIMES.uptimeBefore,
        uptimeSeconds: 10000,
        sampleCount: 1,
        bootIdentifierRetained: false
    });
    writeJson(join(runRoot, 'uptime-after.json'), {
        schemaVersion: 1,
        observedAt: TIMES.uptimeAfter,
        uptimeSeconds: 10960,
        sampleCount: 1,
        increasedFromPreRun: true,
        platformRebootProven: false,
        continuousUptimeProven: true,
        bootIdentifierRetained: false
    });
    writeJson(join(runRoot, 'cleanup.json'), {
        schemaVersion: 1,
        completedAt: TIMES.cleanup,
        validationApplicationClosedByCommand: true,
        validationApplicationPresentAfterCleanup: false,
        validationApplicationAbsenceConfirmed: true,
        validationApplicationCloseCommandIssued: true,
        validationApplicationAlreadyAbsentAtCloseCommand: false,
        validationApplicationUninstalled: true,
        validationApplicationRelaunched: false,
        temporaryValidationSessionInvalidated: true,
        validationApplicationTestStorageCleared: true,
        staticServerOwnershipVerified: true,
        staticServerProcessPresent: false,
        staticListenerCount: 0,
        isolatedServerStopped: true,
        isolatedServerRemoved: true,
        isolatedServerStateRetainedOffline: false,
        isolatedNetworkRemoved: true,
        temporaryTestAccountRemoved: true,
        temporaryCredentialsDestroyed: true,
        temporaryConfigurationRemoved: true,
        temporaryDatabaseRemoved: true,
        temporaryCacheRemoved: true,
        temporaryLibraryRemoved: true,
        finalPairRetained: true,
        finalPairSealedReadOnly: true,
        candidateTouchedDuringRun: false,
        dtsActivity: ZERO_DTS,
        productionCleanupNeeded: false,
        productionModified: false,
        televisionPersistentConfigurationModified: false,
        ownedTemporaryResourcesAbsent: true,
        forbiddenHelpers: {
            attributionHelpers: 0,
            sinkOrHeartbeatHelpers: 0,
            inspectorHelpers: 0,
            resourcePollers: 0,
            persistentDeviceShells: 0,
            developmentServers: 0,
            total: 0
        }
    });
    writeJson(join(runRoot, 'static-delivery-summary.json'), {
        schemaVersion: 1,
        serverActiveDuringCountedInterval: true,
        serverActiveAfterCleanup: false,
        serverCount: 1,
        serverScriptSha256:
            '8b8d4c66f9bd18a0bb033eda2ac424ae95633563fb221846a16cd8a293e6cb81',
        servedArtifacts: [
            {
                name: 'index.html',
                sha256:
                    '9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc'
            },
            {
                name: 'runtime.bundle.js',
                sha256:
                    '93ce794233526fc506b6cf58777397ea22f203b9387f808caad8912150656043'
            },
            {
                name: 'main.jellyfin.bundle.js',
                sha256:
                    '8320ae8655682107692777ba8d62d74d014bbaa01b6c3648a60b0caf0f265161'
            }
        ],
        exactArtifactsMatched: true,
        developmentServerClientPresent: false,
        rendererInjectionDetected: false,
        rawRequestDataRetained: false,
        listenerRemoved: true
    });
    writeJson(join(root, 'comparison-matrix.json'), {
        schemaVersion: 1,
        runs: [
            {
                run: RUN,
                role: 'paired-control',
                result: 'stable',
                deliveryMode: 'DirectPlay',
                postStartInputCount: 0,
                queryAndPollingCount: 0,
                durationSeconds: 900,
                platformRebootProven: false,
                dtsActivity: ZERO_DTS
            }
        ],
        pairedCandidate: {
            authorized: false,
            performed: false,
            runtimeDeliveryProven: false
        },
        comparisonsPerformed: 0,
        interpretation: 'control-only-no-audio-codec-comparison',
        decision: C3_AAC_CONTROL_CONTRACT.stableDecision
    });
    writeJson(join(root, 'comparison-to-c3-preparation.json'), {
        schemaVersion: 1,
        preparedEvidenceDirectory:
            C3_AAC_CONTROL_CONTRACT.preparedEvidenceDirectory,
        preparedEvidenceHashes:
            C3_AAC_CONTROL_CONTRACT.preparedEvidenceHashes,
        controlRoleSelected: true,
        controlAssetSha256: CONTROL_SHA,
        controlHashReverifiedBeforeLaunch: true,
        preparationPredictionOnly: true,
        runtimeDirectPlayReproofRequired: true,
        runtimeDirectPlayReproofCompleted: true,
        runtimeDirectPlayReproofFailed: false,
        candidateExcluded: true,
        dtsActivity: ZERO_DTS
    });
    writeJson(join(root, 'phase-summary.json'), {
        schemaVersion: 'ptv-webos-native-media-isolation-c3-aac-control-summary-v1',
        phase: C3_AAC_CONTROL_CONTRACT.phase,
        status: 'complete-hold-c3-aac-control-stable',
        decision: C3_AAC_CONTROL_CONTRACT.stableDecision,
        run: {
            directory: RUN,
            result: 'stable',
            actualDeliveryMode: 'DirectPlay',
            observedDurationSeconds: 900,
            postStartInputCount: 0,
            dtsActivity: ZERO_DTS,
            futureDtsRunAuthorized: false
        },
        productionContactCount: 0,
        productionModified: false,
        productSourceModified: false,
        productionServerConfigurationModified: false,
        productionLibraryDataModified: false,
        ownershipBoundariesModified: false,
        dtsCandidateRunPerformed: false,
        dtsCandidateRunAuthorized: false,
        nextPhase: {
            title: C3_AAC_CONTROL_CONTRACT.nextPhaseAfterStable,
            separateApprovalRequired: true,
            automaticLaunch: false
        }
    });
    writeFileSync(
        join(root, 'README.md'),
        `# ${C3_AAC_CONTROL_CONTRACT.phase}\n`
    );
    writeFileSync(
        join(root, 'final-report.md'),
        [
            '# C3 synthetic AAC control',
            '',
            'HOLD — BASELINE STABLE, COMPARISONS INCOMPLETE',
            '',
            C3_AAC_CONTROL_CONTRACT.stableDecision,
            '',
            'A single stable run does not prove the path safe.',
            '',
            'The DTS candidate was not staged, mounted, indexed, queried, requested, or played.',
            '',
            'Production was not contacted or modified.',
            '',
            `Exactly one next phase: ${C3_AAC_CONTROL_CONTRACT.nextPhaseAfterStable}; `
                + 'it requires separate explicit approval.'
        ].join('\n')
    );

    return {
        root,
        runRoot,
        workspace
    };
}

function mutateJson(path, mutate) {
    const value = readJson(path);
    mutate(value);
    writeJson(path, value);
}

function mutateToStableDeliveryUnproven(fixture) {
    mutateJson(join(fixture.runRoot, 'delivery-mode.json'), value => {
        value.actualRunDecision = {
            proofMethod: 'post-count-bounded-server-record-attempts',
            serverReadCount: 5,
            liveReadAttemptCount: 1,
            recoveryReadAttemptCount: 4,
            usableNormalizedRecordCount: 0,
            bounded: true,
            nonPeriodic: true,
            occurredAfterCountedInterval: true,
            firstReadOccurredWhilePlaybackActive: true,
            safeResultCapturedFromActiveRead: false,
            finalReadNowPlayingSessionPresent: false,
            matchingPlaybackSessionCount: null,
            actualRuntimeMethodProven: false,
            selectedDeliveryCategory: 'unproven',
            mediaSourceCandidateCount: null,
            videoDirect: null,
            audioDirect: null,
            videoTranscode: null,
            audioTranscode: null,
            containerRemux: null,
            subtitleBurnIn: null,
            transcodingUrlPresent: null,
            transcodingReasons: [],
            proofFailureCategory:
                'safe-local-reduction-failed-no-usable-runtime-category-retained',
            logReadCount: 1,
            ffmpegProcessObserved: false,
            ffmpegCommandObserved: false,
            serverTranscodeEventCount: 0,
            serverErrorMarkerCount: 0,
            ffmpegAbsenceUsedToInferDirectPlay: false,
            observedAt: TIMES.delivery
        };
        value.countableAsExactSyntheticAacDirectPlayControl = false;
    });
    mutateJson(join(fixture.runRoot, 'run-summary.json'), value => {
        value.result = 'stable-delivery-unproven';
        value.displayResult = 'HOLD — INCONCLUSIVE';
        value.classification =
            'synthetic-aac-control-stable-delivery-unproven';
        value.decision = C3_AAC_CONTROL_CONTRACT.inconclusiveDecision;
        value.actualDeliveryMode = 'unproven';
        value.playbackStateAtTerminal = 'playing';
        value.normalMediaCompletionObserved = true;
        value.completionObservedAfterCountedInterval = true;
        value.interruptionCategory = 'delivery-unproven';
        value.stablePhysicalObservationPromotedToPass = false;
        value.applicationStateAtCleanup =
            'already-not-running-after-normal-completion';
    });
    mutateJson(join(fixture.runRoot, 'cleanup.json'), value => {
        value.validationApplicationClosedByCommand = false;
        value.validationApplicationCloseCommandIssued = true;
        value.validationApplicationAlreadyAbsentAtCloseCommand = true;
        value.validationApplicationUninstalled = true;
    });
    mutateJson(join(fixture.root, 'comparison-matrix.json'), value => {
        value.runs[0].result = 'stable-delivery-unproven';
        value.runs[0].deliveryMode = 'unproven';
        value.decision = C3_AAC_CONTROL_CONTRACT.inconclusiveDecision;
    });
    mutateJson(
        join(fixture.root, 'comparison-to-c3-preparation.json'),
        value => {
            value.runtimeDirectPlayReproofCompleted = false;
            value.runtimeDirectPlayReproofFailed = true;
        }
    );
    mutateJson(join(fixture.root, 'phase-summary.json'), value => {
        value.status =
            'complete-hold-c3-aac-control-stable-delivery-unproven';
        value.decision = C3_AAC_CONTROL_CONTRACT.inconclusiveDecision;
        value.run.result = 'stable-delivery-unproven';
        value.run.actualDeliveryMode = 'unproven';
        value.nextPhase.title =
            C3_AAC_CONTROL_CONTRACT.nextPhaseAfterInconclusive;
    });

    const markers = [
        {
            sequence: 1,
            category: 'playback-start-confirmed',
            observedAt: TIMES.start,
            countedInterval: true,
            state: 'playing',
            inputMethod: 'physical-lg-remote',
            startPosition: 'zero',
            postStartPhysicalInputCount: 0
        },
        {
            sequence: 2,
            category: 'stable-duration-confirmed',
            observedAt: TIMES.terminal,
            countedInterval: true,
            state: 'playing',
            observedDurationSeconds: 900,
            postStartPhysicalInputCount: 0
        },
        {
            sequence: 3,
            category: 'post-count-delivery-unproven',
            observedAt: TIMES.delivery,
            countedInterval: false,
            selectedDeliveryCategory: 'unproven',
            mediaSourceCandidateCount: null,
            dtsActivityCount: 0
        },
        {
            sequence: 4,
            category: 'post-run-application-absence-confirmed',
            observedAt: TIMES.closed,
            countedInterval: false
        },
        {
            sequence: 5,
            category: 'post-run-cleanup-complete',
            observedAt: TIMES.cleanup,
            countedInterval: false
        }
    ];
    writeFileSync(
        join(fixture.runRoot, 'operator-markers.ndjson'),
        `${markers.map(marker => JSON.stringify(marker)).join('\n')}\n`
    );
    writeFileSync(
        join(fixture.root, 'final-report.md'),
        [
            '# C3 synthetic AAC control',
            '',
            'HOLD — INCONCLUSIVE',
            '',
            C3_AAC_CONTROL_CONTRACT.inconclusiveDecision,
            '',
            'The stable physical observation is not promoted to PASS.',
            '',
            'The DTS candidate was not staged, mounted, indexed, queried, requested, or played.',
            '',
            'Production was not contacted or modified.',
            '',
            `Exactly one next phase: ${C3_AAC_CONTROL_CONTRACT.nextPhaseAfterInconclusive}; `
                + 'it requires separate explicit approval.'
        ].join('\n')
    );
}

function finalizeFixture(fixture) {
    const scriptDirectory = dirname(fileURLToPath(import.meta.url));
    const sourcePreparationRoot = join(
        scriptDirectory,
        '..',
        '..',
        'test-results',
        C3_AAC_CONTROL_CONTRACT.preparedEvidenceDirectory
    );
    const preparationRoot = join(
        fixture.workspace,
        C3_AAC_CONTROL_CONTRACT.preparedEvidenceDirectory
    );
    mkdirSync(preparationRoot, { recursive: true });
    for (const file of [
        'artifact-inventory.json',
        'delivery-prediction.json',
        'pair-equivalence.json',
        'pair-manifest.json'
    ]) {
        copyFileSync(join(sourcePreparationRoot, file), join(preparationRoot, file));
    }

    writeJson(join(fixture.root, 'known-private-value-scan.json'), {
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
    const privacyExclusions = new Set([
        'artifact-inventory.json',
        'known-private-value-scan.json',
        'privacy-scan.json'
    ]);
    const filesScanned = listFiles(fixture.root)
        .map(path => normalizeRelative(fixture.root, path))
        .filter(path => !privacyExclusions.has(path))
        .length;
    writeJson(join(fixture.root, 'privacy-scan.json'), {
        status: 'PASS',
        filesScanned,
        rawPrivateValuesRetained: false,
        findings: PRIVACY_FINDINGS
    });
    const artifacts = listFiles(fixture.root)
        .map(path => ({
            file: normalizeRelative(fixture.root, path),
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
    writeJson(join(fixture.root, 'artifact-inventory.json'), {
        schemaVersion: 'ptv-webos-native-media-isolation-artifact-inventory-v1',
        selfHashExcluded: true,
        artifacts
    });
}

test('accepts a stable 900-second zero-input exact AAC DirectPlay control', t => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.workspace, { force: true, recursive: true }));
    assert.doesNotThrow(() => validateNativeMediaIsolationC3AacControlOutcome(fixture.root));
});

test('accepts normal physical completion while runtime delivery remains unproven', t => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.workspace, { force: true, recursive: true }));
    mutateToStableDeliveryUnproven(fixture);
    assert.doesNotThrow(() =>
        validateNativeMediaIsolationC3AacControlOutcome(fixture.root)
    );
});

test('full validator composes lineage, privacy, and artifact inventory gates', t => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.workspace, { force: true, recursive: true }));
    finalizeFixture(fixture);
    assert.deepEqual(
        validateNativeMediaIsolationC3AacControlEvidence(fixture.root),
        {
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
        }
    );
});

test('pins the control run to the frozen C3 preparation evidence', () => {
    const scriptDirectory = dirname(fileURLToPath(import.meta.url));
    const prospectiveRoot = join(
        scriptDirectory,
        '..',
        '..',
        'test-results',
        'webos-native-media-isolation-c3-aac-control-contract-test'
    );
    assert.doesNotThrow(() =>
        validateNativeMediaIsolationC3AacControlPreparedReference(prospectiveRoot)
    );
});

test('rejects approval consumed before the read-only gates pass', t => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.workspace, { force: true, recursive: true }));
    mutateJson(join(fixture.runRoot, 'approval.json'), value => {
        value.consumedAt = '2026-07-28T20:00:30.000Z';
    });
    assert.throws(() => validateNativeMediaIsolationC3AacControlOutcome(fixture.root));
});

test('rejects relaunch or retry authorization hidden in the approved run', t => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.workspace, { force: true, recursive: true }));
    mutateJson(join(fixture.runRoot, 'approval.json'), value => {
        value.repeatOrRelaunchAuthorized = true;
    });
    assert.throws(() => validateNativeMediaIsolationC3AacControlOutcome(fixture.root));
});

test('rejects DTS staging even when every other control field is valid', t => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.workspace, { force: true, recursive: true }));
    mutateJson(join(fixture.runRoot, 'isolated-server-boundary.json'), value => {
        value.candidateStaged = true;
        value.dtsActivity.stagedCount = 1;
    });
    assert.throws(() => validateNativeMediaIsolationC3AacControlOutcome(fixture.root));
});

test('rejects a transcode URL or non-direct runtime path', t => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.workspace, { force: true, recursive: true }));
    mutateJson(join(fixture.runRoot, 'delivery-mode.json'), value => {
        value.actualRunDecision.transcodingUrlPresent = true;
    });
    assert.throws(() => validateNativeMediaIsolationC3AacControlOutcome(fixture.root));
});

test('rejects any physical input after counted playback starts', t => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.workspace, { force: true, recursive: true }));
    mutateJson(join(fixture.runRoot, 'run-summary.json'), value => {
        value.countedInterval.postStartPhysicalInputCount = 1;
    });
    assert.throws(() => validateNativeMediaIsolationC3AacControlOutcome(fixture.root));
});

test('rejects a stable claim before 900 seconds', t => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.workspace, { force: true, recursive: true }));
    mutateJson(join(fixture.runRoot, 'run-summary.json'), value => {
        value.observedDurationSeconds = 899;
        value.countedInterval.observedDurationSeconds = 899;
    });
    assert.throws(() => validateNativeMediaIsolationC3AacControlOutcome(fixture.root));
});

test('rejects non-monotonic uptime for a no-reboot stable claim', t => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.workspace, { force: true, recursive: true }));
    mutateJson(join(fixture.runRoot, 'uptime-after.json'), value => {
        value.uptimeSeconds = 20;
    });
    assert.throws(() => validateNativeMediaIsolationC3AacControlOutcome(fixture.root));
});

test('rejects a stable phase decision outside the authoritative R.2 taxonomy', t => {
    const fixture = createFixture();
    t.after(() => rmSync(fixture.workspace, { force: true, recursive: true }));
    mutateJson(join(fixture.runRoot, 'run-summary.json'), value => {
        value.decision = 'READY-c3-aac-control';
    });
    assert.throws(() => validateNativeMediaIsolationC3AacControlOutcome(fixture.root));
});
