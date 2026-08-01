import assert from 'node:assert/strict';
import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
    validateNativeMediaIsolationC1FrozenLineage,
    validateNativeMediaIsolationC1Outcome
} from './validate-native-media-isolation-c1-evidence.mjs';

const RUN_DIRECTORY = 'run-03-c1-forced-video-transcode';
const STARTED_AT = '2026-07-28T13:54:34.0209837Z';
const ENDED_AT = '2026-07-28T14:09:43.2536931Z';
const CLASSIFICATION = 'directplay-stable-vs-video-transcode-correlation-only';

function createTemporaryRoot(t) {
    const root = mkdtempSync(join(tmpdir(), 'ptv-native-media-c1-'));
    t.after(() => {
        const resolved = resolve(root);
        if (resolved.startsWith(resolve(tmpdir()))) rmSync(resolved, { force: true, recursive: true });
    });
    return root;
}

function writeJson(root, relativePath, value) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createC1Fixture(t) {
    const root = createTemporaryRoot(t);
    const documents = {
        approval: {
            status: 'explicit',
            destructiveRiskAcknowledged: true,
            approvalRecordedAt: '2026-07-28T13:03:05.6418848Z',
            launchAuthorized: true,
            countedPlaybackStarted: true
        },
        boundary: {
            settingScope: {
                network: 'in-network',
                mediaType: 'Video',
                storage: 'validation-app-local-persistent-setting'
            },
            original: {
                value: 'Auto',
                automaticBitrateDetection: true,
                verification: 'physical-ui-operator-confirmed',
                observedBeforeChange: true,
                observationTimestampRetained: false,
                operatorConfirmationReportedAt: '2026-07-28T13:50:52.8189356Z',
                confirmationReportedAfterTemporaryApplication: true
            },
            temporary: {
                value: '720 kbps',
                bitrateBps: 720000,
                applicationMethod: 'existing-physical-webos-ui',
                appliedAt: '2026-07-28T13:45:49.8648822Z',
                physicallyVerified: true
            },
            restoration: {
                required: true,
                targetValue: 'Auto',
                restoredAt: '2026-07-28T14:18:23.6956438Z',
                restoredAtBasis: 'physical-ui-confirmation-boundary',
                applicationMethod: 'existing-physical-webos-ui',
                physicallyVerified: true,
                automaticBitrateDetection: true,
                exactOriginalValueRestored: true
            },
            restorationDeliveryVerification: {
                observedAt: '2026-07-28T14:16:05.2748634Z',
                selectedDeliveryCategory: 'DirectPlay',
                videoTranscode: false,
                audioTranscode: false,
                subtitleBurnIn: false,
                candidateCount: 1,
                postRestorationServerReadQueries: 1,
                physicalUiAutoAndDirectConfirmedAt: '2026-07-28T14:18:23.6956438Z',
                rawRecordRetained: false
            },
            intendedChangedDimension: 'delivery-request-policy',
            operatorControlledChanges: ['temporary-ui-quality-cap'],
            productSourceModified: false,
            serverConfigurationModified: false,
            persistentChangeRemaining: false
        },
        cleanup: {
            completedAt: '2026-07-28T14:20:50.2290941Z',
            validationApplicationClosedByCommand: true,
            validationApplicationCloseCompletedAt: '2026-07-28T14:20:27.1344630Z',
            validationApplicationPresentAfterCleanup: false,
            validationApplicationAbsenceVerifiedAt: '2026-07-28T14:20:50.2290941Z',
            staticServerOwnershipVerified: true,
            staticServerProcessPresent: false,
            staticListenerCount: 0,
            staticProcessAndListenerAbsenceVerifiedAt: '2026-07-28T14:20:28.5616612Z',
            staticServerProcessIdentifierRetained: false,
            relevantNodeHelperCount: 0,
            relevantNodeHelperAbsenceVerifiedAt: '2026-07-28T14:20:50.2290941Z',
            temporaryRuntimeDirectoryCreated: false,
            temporaryRuntimeDirectoryRemovalRequired: false,
            temporaryRuntimeDirectoryPresentAfterCleanup: false,
            temporaryRuntimeDirectoryRemoved: null,
            temporaryRuntimeDirectoryStatus: 'not-applicable',
            forbiddenHelpers: {
                attributionHelpers: 0,
                total: 0
            }
        },
        comparison: {
            stableBaselineReference: {
                phase: 'PiggieTV WebOS Phase 3A.1R.2a',
                run: 'run-02-same-baseline-repeat',
                artifactInventorySha256: '3ec2125897384a2c7f035c3bdd2bd1120d6f83abba17719b5972d747f5b76c60',
                buildIdentitySha256: 'f5de0589775c977992758da96a38d0198a410f8c1d78b479cb19dba3bb601cbe',
                mediaCategorySha256: 'badcb6e710c0b4aa30c10710061e6dd834134d82856708e7215fe32d054fcb22',
                deliveryModeSha256: '4b1a533b9f9137568fffaf9b59b515b747db5cae123b2ceeb7299a7fc48b39f6',
                runSummarySha256: '7ea2f7d3b6aaff3fa521623d9ceffc00d8a6783ce84fbd58f53cf0bad9ad4800',
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
                sameStartPolicyPlanned: true,
                intendedChangedDimension: 'delivery-request-policy',
                deliveryTransition: 'DirectPlay-to-video-Transcode',
                operatorControlledChanges: ['temporary-ui-quality-cap'],
                dependentOutputChanges: [
                    'video-resolution',
                    'aggregate-bitrate',
                    'delivery-container-and-segmentation'
                ],
                strictSingleIndependentVariableProven: false,
                strictSingleEncodedOutputDimensionProven: false,
                classification: CLASSIFICATION
            },
            retainedLimitations: [
                'same source was verified in memory without retaining source identity',
                'strict single independent variable was not proven'
            ]
        },
        delivery: {
            preRunBaselineDeliveryCategory: 'DirectPlay',
            requestedDeliveryCategory: 'Transcode',
            setupVerification: {
                selectedDeliveryCategory: 'Transcode',
                videoTranscode: true,
                audioTranscode: false,
                subtitleBurnIn: false,
                candidateCount: 1,
                excludedFromCountedCandidateCount: true,
                rawRecordRetained: false
            },
            actualRunDecision: {
                selectedDeliveryCategory: 'Transcode',
                videoTranscode: true,
                audioTranscode: false,
                subtitleBurnIn: false,
                candidateCount: 1,
                rawRecordRetained: false,
                postRunServerReadQueries: 1,
                outputBitrateClass: 'under-1-mbps'
            },
            countedIntervalServerQueries: 0,
            setupDeliveryCandidatesExcluded: true,
            countableAsCleanC1: true
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
                forbiddenHelperTotal: 0,
                staticServerCount: 0
            },
            countedInterval: {
                startedAt: STARTED_AT,
                endedAt: ENDED_AT,
                observedDurationSeconds: 909,
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
            requestedAt: '2026-07-28T13:40:00.000Z',
            launchCount: 1,
            launchSucceeded: true,
            rawLaunchOutputRetained: false,
            postLaunchDeviceQueries: 0,
            playbackStartedAt: STARTED_AT
        },
        markers: [
            {
                sequence: 1,
                observedAt: '2026-07-28T13:03:05.6418848Z',
                category: 'explicit-approval-recorded',
                countedInterval: false
            },
            {
                sequence: 2,
                observedAt: '2026-07-28T13:08:35.5294093Z',
                category: 'preflight-complete',
                countedInterval: false
            },
            {
                sequence: 3,
                observedAt: '2026-07-28T13:49:16.1136127Z',
                category: 'setup-playback-excluded',
                countedInterval: false,
                setupDeliveryCandidatesExcludedFromCountedRun: true,
                selectedDeliveryCategory: 'Transcode',
                videoTranscode: true,
                audioTranscode: false,
                subtitleBurnIn: false
            },
            {
                sequence: 4,
                observedAt: '2026-07-28T13:52:20.3469214Z',
                category: 'setup-playback-stopped',
                countedInterval: false,
                matchingPlaybackSessionCount: 0
            },
            {
                sequence: 5,
                observedAt: STARTED_AT,
                category: 'playback-start-confirmed',
                inputMethod: 'physical-lg-remote',
                postStartPhysicalInputCount: 0
            },
            {
                sequence: 6,
                observedAt: ENDED_AT,
                category: 'counted-interval-ended',
                observedDurationSeconds: 909,
                postStartPhysicalInputCount: 0
            },
            {
                sequence: 7,
                observedAt: '2026-07-28T14:12:41.8364062Z',
                category: 'stable-visual-and-delivery-confirmed',
                countedInterval: false,
                observedDurationSeconds: 909,
                selectedDeliveryCategory: 'Transcode',
                videoTranscode: true,
                audioTranscode: false,
                subtitleBurnIn: false,
                candidateCount: 1,
                platformRebootProven: false
            },
            {
                sequence: 8,
                observedAt: '2026-07-28T14:18:23.6956438Z',
                category: 'quality-setting-restored',
                countedInterval: false,
                state: 'auto-restored',
                targetValue: 'Auto',
                physicalUiConfirmed: true,
                deliveryCategory: 'DirectPlay',
                videoTranscode: false,
                audioTranscode: false
            },
            {
                sequence: 9,
                observedAt: '2026-07-28T14:20:50.2290941Z',
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
                    result: 'stable',
                    durationSeconds: 971,
                    deliveryMode: 'DirectPlay'
                },
                {
                    run: RUN_DIRECTORY,
                    result: 'stable',
                    durationSeconds: 909,
                    deliveryMode: 'Transcode',
                    videoTranscode: true,
                    audioTranscode: false,
                    subtitleBurnIn: false,
                    candidateCount: 1,
                    intendedChangedDimension: 'delivery-request-policy',
                    operatorControlledChanges: ['temporary-ui-quality-cap'],
                    strictSingleIndependentVariableProven: false,
                    strictSingleEncodedOutputDimensionProven: false,
                    postStartInputCount: 0,
                    classification: CLASSIFICATION
                }
            ]
        },
        output: {
            deliveryCategory: 'Transcode',
            videoTranscode: true,
            audioTranscode: false,
            subtitleBurnIn: false,
            candidateCount: 1,
            rawRecordRetained: false,
            setupDeliveryCandidatesExcluded: true,
            source: {
                bitrateClass: 'moderate'
            },
            output: {
                bitrateClass: 'under-1-mbps'
            },
            dependentOutputChanges: [
                'video-resolution',
                'aggregate-bitrate',
                'delivery-container-and-segmentation'
            ],
            strictSingleEncodedOutputDimensionProven: false,
            encodedOutputDimensionsIndependentlyNormalized: false
        },
        phase: {
            phase: 'PiggieTV WebOS Phase 3A.1R.2b',
            run3: {
                directory: RUN_DIRECTORY,
                result: 'stable',
                actualDeliveryMode: 'Transcode',
                videoTranscode: true,
                observedDurationSeconds: 909,
                postStartInputCount: 0,
                intendedChangedDimension: 'delivery-request-policy',
                operatorControlledChanges: ['temporary-ui-quality-cap'],
                qualitySettingRestored: true,
                classification: CLASSIFICATION,
                strictSingleIndependentVariableProven: false,
                strictSingleEncodedOutputDimensionProven: false
            },
            decision: 'HOLD-c1-correlation-only',
            isolationConclusion: 'inconclusive',
            nextPhase: {
                separateApprovalRequired: true,
                automaticLaunch: false
            },
            productionModified: false,
            ownershipBoundariesModified: false
        },
        run: {
            result: 'stable',
            actualDeliveryMode: 'Transcode',
            videoTranscode: true,
            audioTranscode: false,
            subtitleBurnIn: false,
            deliveryCandidateCount: 1,
            countedInterval: {
                startedAt: STARTED_AT,
                endedAt: ENDED_AT,
                observedDurationSeconds: 909,
                postStartPhysicalInputCount: 0
            },
            observedDurationSeconds: 909,
            stableDurationProven: true,
            platformRebootProven: false,
            qualitySettingRestored: true,
            classification: CLASSIFICATION,
            strictSingleIndependentVariableProven: false,
            strictSingleEncodedOutputDimensionProven: false,
            isolationConclusion: 'inconclusive',
            productionModified: false,
            ownershipBoundariesModified: false
        },
        staticDelivery: {
            serverActiveDuringPreflight: false,
            serverActiveDuringCountedInterval: true,
            serverActiveAfterCleanup: false,
            serverCount: 1,
            serverCountScope: 'counted-interval',
            servedIndexSha256: '9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc',
            expectedIndexSha256: '9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc',
            exactIndexMatched: true,
            rendererInjectionDetected: false,
            requestCountingAvailable: false,
            requestCountsRetained: false,
            rawRequestDataRetained: false,
            staticServerOwnershipVerified: true,
            processIdentifierRetained: false,
            cleanupStoppedAt: '2026-07-28T14:20:28.5616612Z',
            listenerRemoved: true
        },
        uptimeBefore: {
            observedAt: '2026-07-28T13:08:35.5294093Z',
            uptimeSeconds: 27769.58,
            sampleCount: 1
        },
        uptimeAfter: {
            observedAt: '2026-07-28T14:12:41.8364062Z',
            uptimeSeconds: 31621.51,
            sampleCount: 1,
            increasedFromPreRun: true,
            platformRebootProven: false,
            timestampBoundaryPrecision:
                'pre-read-timestamp-captured-after-concurrent-one-shot-queries',
            wallToUptimeDeltaDifferenceSeconds: 5.62
        }
    };

    function persist() {
        writeJson(root, `${RUN_DIRECTORY}/quality-setting-boundary.json`, documents.boundary);
        writeJson(root, 'comparison-to-stable-baseline.json', documents.comparison);
        writeJson(root, 'comparison-matrix.json', documents.matrix);
        writeJson(root, 'phase-summary.json', documents.phase);
        writeJson(root, `${RUN_DIRECTORY}/approval.json`, documents.approval);
        writeJson(root, `${RUN_DIRECTORY}/cleanup.json`, documents.cleanup);
        writeJson(root, `${RUN_DIRECTORY}/delivery-mode.json`, documents.delivery);
        writeJson(root, `${RUN_DIRECTORY}/device-state-before.json`, documents.device);
        writeJson(root, `${RUN_DIRECTORY}/instrumentation-absence.json`, documents.instrumentation);
        writeJson(root, `${RUN_DIRECTORY}/launch-summary.json`, documents.launch);
        const markerText = `${documents.markers.map(marker => JSON.stringify(marker)).join('\n')}\n`;
        const markerPath = join(root, RUN_DIRECTORY, 'operator-markers.ndjson');
        mkdirSync(dirname(markerPath), { recursive: true });
        writeFileSync(markerPath, markerText);
        writeJson(root, `${RUN_DIRECTORY}/run-summary.json`, documents.run);
        writeJson(root, `${RUN_DIRECTORY}/static-delivery-summary.json`, documents.staticDelivery);
        writeJson(root, `${RUN_DIRECTORY}/transcode-output-category.json`, documents.output);
        writeJson(root, `${RUN_DIRECTORY}/uptime-before.json`, documents.uptimeBefore);
        writeJson(root, `${RUN_DIRECTORY}/uptime-after.json`, documents.uptimeAfter);
    }

    persist();
    return { documents, persist, root };
}

test('accepts a stable C1 correlation-only video-transcode outcome', t => {
    const fixture = createC1Fixture(t);

    assert.doesNotThrow(() => validateNativeMediaIsolationC1Outcome(fixture.root));
});

test('rejects delivery that does not prove video-only Transcode with one candidate', t => {
    const fixture = createC1Fixture(t);
    fixture.documents.delivery.actualRunDecision.videoTranscode = false;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));

    fixture.documents.delivery.actualRunDecision.videoTranscode = true;
    fixture.documents.output.audioTranscode = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));
});

test('requires privacy-safe bitrate classes and rejects exact output bitrate leakage', t => {
    const fixture = createC1Fixture(t);
    fixture.documents.delivery.actualRunDecision.outputBitrateBps = 847665;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));

    delete fixture.documents.delivery.actualRunDecision.outputBitrateBps;
    fixture.documents.output.output.bitrateClass = 'exact-value-removed';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));
});

test('requires setup playback and its delivery candidates to be excluded from the counted run', t => {
    const fixture = createC1Fixture(t);
    fixture.documents.markers[2].countedInterval = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));

    fixture.documents.markers[2].countedInterval = false;
    fixture.documents.delivery.setupVerification.excludedFromCountedCandidateCount = false;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));
});

test('requires approval then launch then quality observation and application before counted start', t => {
    const fixture = createC1Fixture(t);
    fixture.documents.approval.approvalRecordedAt = '2026-07-28T13:46:00.000Z';
    fixture.persist();

    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));
});

test('rejects missing exact Auto to 720 kbps to Auto restoration', t => {
    const fixture = createC1Fixture(t);
    fixture.documents.boundary.temporary.bitrateBps = 1000000;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));

    fixture.documents.boundary.temporary.bitrateBps = 720000;
    fixture.documents.boundary.restoration.exactOriginalValueRestored = false;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));

    fixture.documents.boundary.restoration.exactOriginalValueRestored = true;
    fixture.documents.boundary.original.observedAt = '2026-07-28T13:44:00.000Z';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));
});

test('rejects a second operator change or an overclaimed independent variable', t => {
    const fixture = createC1Fixture(t);
    fixture.documents.comparison.plannedComparison.operatorControlledChanges.push(
        'subtitle-change'
    );
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));

    fixture.documents.comparison.plannedComparison.operatorControlledChanges = [
        'temporary-ui-quality-cap'
    ];
    fixture.documents.run.strictSingleIndependentVariableProven = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));
});

test('rejects post-start input or counted-interval polling', t => {
    const fixture = createC1Fixture(t);
    fixture.documents.instrumentation.countedInterval.postStartPhysicalInputCount = 1;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));

    fixture.documents.instrumentation.countedInterval.postStartPhysicalInputCount = 0;
    fixture.documents.instrumentation.countedInterval.networkProbes = 1;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));
});

test('bounds uptime wall-clock drift at 10 seconds and preserves reboot detection', t => {
    const fixture = createC1Fixture(t);
    fixture.documents.uptimeAfter.observedAt = '2026-07-28T14:12:31.0000000Z';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));

    fixture.documents.uptimeAfter.observedAt = '2026-07-28T14:12:41.8364062Z';
    fixture.documents.uptimeAfter.platformRebootProven = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));
});

test('requires truthful cleanup when no temporary runtime directory existed', t => {
    const fixture = createC1Fixture(t);
    fixture.documents.cleanup.temporaryRuntimeDirectoryRemoved = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));

    fixture.documents.cleanup.temporaryRuntimeDirectoryRemoved = null;
    fixture.documents.cleanup.temporaryRuntimeDirectoryCreated = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));
});

test('rejects build-adjacent device parity drift and production mutation', t => {
    const fixture = createC1Fixture(t);
    fixture.documents.device.firmwareVersion = 'different';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));

    fixture.documents.device.firmwareVersion = '04.64.00';
    fixture.documents.phase.productionModified = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));
});

test('requires HOLD for stable and BLOCK plus inconclusive isolation for reboot', t => {
    const fixture = createC1Fixture(t);
    fixture.documents.phase.decision = 'APPROVE';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));

    fixture.documents.run.result = 'full-platform-reboot';
    fixture.documents.run.stableDurationProven = false;
    fixture.documents.run.platformRebootProven = true;
    fixture.documents.phase.run3.result = 'full-platform-reboot';
    fixture.documents.phase.decision = 'BLOCK-c1-rebooted-isolation-inconclusive';
    fixture.documents.matrix.runs[1].result = 'full-platform-reboot';
    fixture.documents.uptimeAfter.platformRebootProven = true;
    fixture.persist();
    assert.doesNotThrow(() => validateNativeMediaIsolationC1Outcome(fixture.root));

    fixture.documents.phase.isolationConclusion = 'proven';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationC1Outcome(fixture.root));
});

test('validates immutable R.2 and R.2a sibling lineage', () => {
    const prospectiveRoot = resolve(
        'test-results',
        'webos-native-media-isolation-c1-focused-validator'
    );

    assert.doesNotThrow(() => validateNativeMediaIsolationC1FrozenLineage(prospectiveRoot));
});
