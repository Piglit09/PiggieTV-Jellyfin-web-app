import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
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
    validateNativeMediaIsolationRepeatEvidence,
    validateNativeMediaIsolationRepeatInventory,
    validateNativeMediaIsolationRepeatOutcome,
    validateNativeMediaIsolationRepeatPriorEvidence
} from './validate-native-media-isolation-repeat-evidence.mjs';

const RUN_DIRECTORY = 'run-02-same-baseline-repeat';
const REPEAT_EVIDENCE_DIRECTORY = 'webos-native-media-isolation-repeat-20260728-121430Z';
const PRIOR_EVIDENCE_DIRECTORY = 'webos-native-media-isolation-20260728-070944Z';
const STARTED_AT = '2026-07-28T12:21:52.8885377+00:00';
const ENDED_AT = '2026-07-28T12:38:03.8927444+00:00';

function createTemporaryRoot(t) {
    const container = mkdtempSync(join(tmpdir(), 'ptv-native-media-repeat-'));
    const root = join(container, REPEAT_EVIDENCE_DIRECTORY);
    mkdirSync(root, { recursive: true });
    t.after(() => {
        const resolved = resolve(container);
        if (resolved.startsWith(resolve(tmpdir()))) rmSync(resolved, { force: true, recursive: true });
    });
    return root;
}

function writeText(root, relativePath, value) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
}

function writeJson(root, relativePath, value) {
    writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
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

function hash(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function createRepeatFixture(t) {
    const root = createTemporaryRoot(t);
    const documents = {
        approval: {
            status: 'explicit',
            destructiveRiskAcknowledged: true,
            approvalReceivedAt: '2026-07-28T12:14:30.1079018+00:00',
            launchAuthorized: true,
            countedPlaybackStarted: true
        },
        cleanup: {
            completedAt: '2026-07-28T12:40:15.5387864+00:00',
            validationApplicationClosedByCommand: true,
            staticServerOwnershipVerified: true,
            staticServerProcessPresent: false,
            staticListenerCount: 0,
            temporaryRuntimeDirectoryRemoved: true,
            forbiddenHelpers: {
                attributionHelpers: 0,
                sinkOrHeartbeatHelpers: 0,
                inspectorHelpers: 0,
                resourcePollers: 0,
                persistentDeviceShells: 0,
                developmentServers: 0,
                total: 0
            }
        },
        comparison: {
            priorEvidenceArtifactInventorySha256: 'a1f0c85102e9792c671b310feb4435a2b2c4a024f9ef2ad95ef328352d069a8a',
            priorEvidenceHashes: {
                buildIdentitySha256: '56427582a4b8c1c0a5d362aaed2e37193a1c659c5f7ac31998d4a066f1d2e7d9',
                mediaCategorySha256: '6b95b3f38c29e1f983d0f5af8a65ce43d71d86f9f7ccf553f4eefae130257537',
                deliveryModeSha256: '6e955981b188ed1a7febb0656a87c0d0e524669a168667d43fee895648536fe5'
            },
            priorRun: {
                result: 'interrupted-unsolicited-pause',
                observedDurationSeconds: 174.56,
                deliveryMode: 'DirectPlay',
                postStartInputCount: 0,
                platformRebootProven: false
            },
            repeatConfiguration: {
                exactBuildIdentitySame: true,
                validationWrapperIdentitySame: true,
                televisionAndFirmwareSame: true,
                mediaSourceSame: true,
                mediaTechnicalCategoriesSame: true,
                userPlaybackSettingsChangedByPhase: false,
                userPlaybackSettingsSameAsPriorIndependentlyProven: false,
                subtitlesDisabled: true,
                deliveryTargetSame: true,
                instrumentationPolicySame: true,
                postStartInputPolicySame: true,
                playbackStartMethodSame: true,
                intendedChangedDimension: 'repeat-trial-index-only',
                changedDimensions: [],
                oneDimensionIsolationProven: false,
                uncontrolledOrUnprovenDifferences: [
                    'prior-playback-start-position',
                    'user-playback-settings-parity'
                ],
                rawMediaIdentityRetained: false
            },
            currentRun: {
                result: 'stable',
                observedDurationSeconds: 971,
                deliveryMode: 'DirectPlay',
                deliveryCandidateCount: 1,
                postStartInputCount: 0,
                platformRebootProven: false,
                stableDurationProven: true,
                playbackStartAtZeroOperatorReported: true,
                playbackStartAtZeroIndependentlyProven: false
            },
            crossRunClassification: 'repeat-stable-prior-pause-not-reproduced',
            interpretationRule: 'repeatability-correlation-only-not-root-causation'
        },
        delivery: {
            preRunEligibility: {
                sameSourceAsPriorDirectPlayRun: true,
                sourceAdvertisesDirectPlay: true,
                technicalProfileCompatible: true,
                selectedDeliveryCategory: 'DirectPlay'
            },
            actualRunDecision: {
                selectedDeliveryCategory: 'DirectPlay',
                videoTranscode: false,
                audioTranscode: false,
                containerRemux: false,
                subtitleBurnIn: false,
                candidateCount: 1,
                rawRecordRetained: false,
                postRunServerReadQueries: 2
            },
            countableAsCleanRepeat: true
        },
        device: {
            deviceClass: 'physical-lg-television',
            model: 'LG-70UN7070PUA',
            webosVersion: '5.6.2',
            firmwareVersion: '04.64.00',
            boardClass: 'K6LP_ATSC_US',
            sameDeviceCategoriesAsPriorRun: true,
            validationApplicationRunning: false,
            rawProcessSnapshotRetained: false,
            networkAddressRetained: false
        },
        instrumentation: {
            preflight: {
                forbiddenHelperTotal: 0,
                staticServerCount: 1
            },
            countedInterval: {
                status: 'ended-zero-input',
                startedAt: STARTED_AT,
                endedAt: ENDED_AT,
                observedDurationSeconds: 971,
                periodicProcessResourcePolling: 0,
                appPresenceQueries: 0,
                networkProbes: 0,
                cdpOrInspectorAttachments: 0,
                rendererOrBrowserInjections: 0,
                syntheticOrDeveloperInputs: 0,
                postStartPhysicalInputCount: 0
            }
        },
        launch: {
            requestedAt: '2026-07-28T12:18:43.1219915+00:00',
            launchCount: 1,
            launchSucceeded: true,
            rawLaunchOutputRetained: false,
            postLaunchDeviceQueries: 0,
            result: 'counted-playback-stable-duration-complete',
            countedRunStarted: true,
            playbackStartedAt: STARTED_AT,
            countedIntervalEndedAt: ENDED_AT,
            observedDurationSeconds: 971
        },
        markers: [
            {
                sequence: 1,
                observedAt: STARTED_AT,
                category: 'playback-start-confirmed',
                countedInterval: true,
                state: 'playing',
                inputMethod: 'physical-lg-remote',
                startPosition: 'operator-reported-from-beginning',
                startPositionIndependentlyProven: false,
                postStartPhysicalInputCount: 0
            },
            {
                sequence: 2,
                observedAt: '2026-07-28T12:36:20.5292486+00:00',
                category: 'early-stable-report',
                countedInterval: true,
                state: 'playing',
                observedDurationSeconds: 867.64,
                postStartPhysicalInputCount: 0,
                intervalStopped: false
            },
            {
                sequence: 3,
                observedAt: ENDED_AT,
                category: 'stable-duration-confirmed',
                countedInterval: true,
                state: 'playing',
                observedDurationSeconds: 971,
                postStartPhysicalInputCount: 0,
                intervalStopped: true
            },
            {
                sequence: 4,
                observedAt: '2026-07-28T12:39:46.1164879+00:00',
                category: 'post-run-application-closed',
                countedInterval: false,
                state: 'cleanup-command-succeeded'
            }
        ],
        matrix: {
            runs: [
                {
                    run: 'prior-run-01-baseline-reference',
                    evidenceFrozen: true,
                    exactBuildMatch: true,
                    mediaCategory: 'low-complexity-h264-aac-mp4-sdr',
                    result: 'interrupted-unsolicited-pause',
                    durationSeconds: 174.56,
                    deliveryMode: 'DirectPlay',
                    instrumentation: 'zero-renderer-injection-zero-periodic-polling',
                    countedIntervalQueries: {
                        processOrResource: 0,
                        appPresence: 0,
                        network: 0,
                        inspectorOrCdp: 0
                    },
                    postStartInputCount: 0,
                    stableDurationProven: false,
                    platformRebootProven: false
                },
                {
                    run: RUN_DIRECTORY,
                    exactBuildMatch: true,
                    mediaCategory: 'low-complexity-h264-aac-mp4-sdr',
                    result: 'stable',
                    durationSeconds: 971,
                    deliveryMode: 'DirectPlay',
                    instrumentation: 'zero-renderer-injection-zero-periodic-polling',
                    countedIntervalQueries: {
                        processOrResource: 0,
                        appPresence: 0,
                        network: 0,
                        inspectorOrCdp: 0
                    },
                    intendedChangedDimension: 'repeat-trial-index-only',
                    changedDimensions: [],
                    oneDimensionIsolationProven: false,
                    postStartInputCount: 0,
                    stableDurationProven: true,
                    platformRebootProven: false,
                    crossRunClassification: 'repeat-stable-prior-pause-not-reproduced'
                }
            ]
        },
        phase: {
            phase: 'PiggieTV WebOS Phase 3A.1R.2a',
            currentStatus: 'complete-hold-baseline-stable-comparisons-incomplete',
            run2: {
                directory: RUN_DIRECTORY,
                status: 'stable',
                result: 'stable',
                explicitApproval: true,
                exactBuildMatched: true,
                sameBaselineTechnicalCategories: true,
                plannedDeliveryMode: 'DirectPlay',
                actualDeliveryMode: 'DirectPlay',
                intendedChangedDimension: 'repeat-trial-index-only',
                changedDimensions: [],
                oneDimensionIsolationProven: false,
                periodicPollingPlanned: false,
                postStartInputPlanned: 0,
                postStartInputCount: 0,
                observedDurationSeconds: 971,
                stableDurationProven: true,
                platformRebootProven: false,
                crossRunClassification: 'repeat-stable-prior-pause-not-reproduced'
            },
            officialWebosComparisonIncluded: false,
            decision: 'HOLD-baseline-stable-comparisons-incomplete',
            nextPhase: {
                id: 'Phase 3A.1R.2b',
                title: 'C1 Forced Video-Transcode Single-Dimension Comparison',
                separateApprovalRequired: true,
                automaticLaunch: false
            },
            productionModified: false,
            ownershipBoundariesModified: false
        },
        run: {
            result: 'stable',
            decision: 'HOLD-baseline-stable-comparisons-incomplete',
            crossRunClassification: 'repeat-stable-prior-pause-not-reproduced',
            countedInterval: {
                startedAt: STARTED_AT,
                endedAt: ENDED_AT,
                observedDurationSeconds: 971,
                postStartPhysicalInputCount: 0
            },
            observedDurationSeconds: 971,
            actualDeliveryMode: 'DirectPlay',
            physicalPlaybackStart: true,
            playbackStartAtZeroOperatorReported: true,
            playbackStartAtZeroIndependentlyProven: false,
            stableDurationProven: true,
            platformRebootProven: false,
            preRunUptimeIncreasedAfterRun: true,
            productionModified: false,
            ownershipBoundariesModified: false,
            rawMediaOrSessionIdentityRetained: false
        },
        staticDelivery: {
            serverActiveDuringPreflight: true,
            serverActiveDuringCountedInterval: true,
            serverActiveAfterCleanup: false,
            serverCount: 1,
            servedIndexSha256: '9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc',
            expectedIndexSha256: '9187f5ba5c1ac71abff98e7eab0a550fd59ca63305de8465c7b6e47ed2d2f5fc',
            exactIndexMatched: true,
            rendererInjectionDetected: false,
            requestCountingAvailable: false,
            requestCountsRetained: false,
            rawRequestDataRetained: false,
            cleanupStoppedAt: '2026-07-28T12:39:55.5441656+00:00',
            listenerRemoved: true
        },
        uptimeBefore: {
            observedAt: '2026-07-28T12:18:09.0892875+00:00',
            uptimeSeconds: 24748.8,
            sampleCount: 1
        },
        uptimeAfter: {
            observedAt: '2026-07-28T12:38:29.9011619+00:00',
            uptimeSeconds: 25970.21,
            sampleCount: 1,
            increasedFromPreRun: true,
            platformRebootProven: false
        }
    };

    function persist() {
        writeJson(root, 'comparison-to-prior.json', documents.comparison);
        writeJson(root, 'comparison-matrix.json', documents.matrix);
        writeJson(root, 'phase-summary.json', documents.phase);
        writeJson(root, `${RUN_DIRECTORY}/approval.json`, documents.approval);
        writeJson(root, `${RUN_DIRECTORY}/cleanup.json`, documents.cleanup);
        writeJson(root, `${RUN_DIRECTORY}/delivery-mode.json`, documents.delivery);
        writeJson(root, `${RUN_DIRECTORY}/device-state-before.json`, documents.device);
        writeJson(root, `${RUN_DIRECTORY}/instrumentation-absence.json`, documents.instrumentation);
        writeJson(root, `${RUN_DIRECTORY}/launch-summary.json`, documents.launch);
        writeText(
            root,
            `${RUN_DIRECTORY}/operator-markers.ndjson`,
            `${documents.markers.map(marker => JSON.stringify(marker)).join('\n')}\n`
        );
        writeJson(root, `${RUN_DIRECTORY}/run-summary.json`, documents.run);
        writeJson(root, `${RUN_DIRECTORY}/static-delivery-summary.json`, documents.staticDelivery);
        writeJson(root, `${RUN_DIRECTORY}/uptime-before.json`, documents.uptimeBefore);
        writeJson(root, `${RUN_DIRECTORY}/uptime-after.json`, documents.uptimeAfter);
    }

    persist();
    return { documents, persist, root };
}

function completeFixture(fixture) {
    const { root } = fixture;
    const priorSource = resolve('test-results', PRIOR_EVIDENCE_DIRECTORY);
    const priorDestination = join(dirname(root), PRIOR_EVIDENCE_DIRECTORY);
    for (const relativePath of [
        'artifact-inventory.json',
        'run-01-baseline/build-identity.json',
        'run-01-baseline/media-category.json',
        'run-01-baseline/delivery-mode.json'
    ]) {
        const destination = join(priorDestination, ...relativePath.split('/'));
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(join(priorSource, ...relativePath.split('/')), destination);
    }
    writeText(root, 'README.md', '# Repeat evidence\n');
    writeText(
        root,
        'final-report.md',
        [
            '# Final report',
            '',
            '**Exactly one next phase:** **Phase 3A.1R.2b - C1 Forced Video-Transcode Single-Dimension Comparison.**',
            'Do not run it automatically.',
            ''
        ].join('\n')
    );
    writeJson(root, `${RUN_DIRECTORY}/build-identity.json`, {
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
        staticServerScriptSha256: '8b8d4c66f9bd18a0bb033eda2ac424ae95633563fb221846a16cd8a293e6cb81',
        exactRequiredIdentityMatched: true
    });
    writeJson(root, `${RUN_DIRECTORY}/media-category.json`, {
        sourceIdentityRetained: false,
        sourceKind: 'same-existing-library-item-as-prior-run',
        container: 'mp4',
        videoCodec: 'h264-avc',
        videoProfile: 'high',
        videoLevel: '4.1',
        audioCodec: 'aac-lc',
        resolution: {
            width: 1904,
            height: 1072,
            class: '1080p-or-lower'
        },
        frameRate: {
            average: 23.976,
            real: 23.976,
            class: 'conventional',
            constantOrConventional: true
        },
        bitDepth: 8,
        chromaFormat: 'yuv420p',
        dynamicRange: 'sdr',
        subtitleState: 'none',
        audioStreamCount: 1,
        channelLayout: 'stereo',
        sampleRateHz: 48000,
        bitrateClass: 'moderate',
        durationClass: '15-minutes-or-longer',
        multipleVideoVersions: false,
        sameSourceAsPriorRun: true,
        meetsBaselineRequirements: true
    });
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

    const findings = {
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
    };
    const excluded = new Set([
        'artifact-inventory.json',
        'known-private-value-scan.json',
        'privacy-scan.json'
    ]);
    const filesScanned = listFiles(root)
        .map(path => relative(root, path).split(sep).join('/'))
        .filter(path => !excluded.has(path))
        .length;
    writeJson(root, 'privacy-scan.json', {
        status: 'PASS',
        filesScanned,
        findings,
        rawPrivateValuesRetained: false
    });

    const artifacts = listFiles(root)
        .map(path => ({
            absolutePath: path,
            file: relative(root, path).split(sep).join('/')
        }))
        .filter(artifact => artifact.file !== 'artifact-inventory.json')
        .map(artifact => ({
            file: artifact.file,
            sizeBytes: statSync(artifact.absolutePath).size,
            sha256: hash(artifact.absolutePath),
            classification: 'share-safe'
        }));
    writeJson(root, 'artifact-inventory.json', {
        selfHashExcluded: true,
        artifacts
    });
}

test('accepts the complete stable repeat evidence contract', t => {
    const fixture = createRepeatFixture(t);
    completeFixture(fixture);

    assert.deepEqual(validateNativeMediaIsolationRepeatEvidence(fixture.root), {
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
    });

    const copiedPriorDelivery = join(
        dirname(fixture.root),
        PRIOR_EVIDENCE_DIRECTORY,
        'run-01-baseline',
        'delivery-mode.json'
    );
    writeText(dirname(fixture.root), relative(dirname(fixture.root), copiedPriorDelivery), '{}\n');
    assert.throws(() => validateNativeMediaIsolationRepeatPriorEvidence(fixture.root));
});

test('rejects a different prior frozen artifact or prior result', t => {
    const fixture = createRepeatFixture(t);
    fixture.documents.comparison.priorEvidenceArtifactInventorySha256 = '0'.repeat(64);
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationRepeatOutcome(fixture.root));

    fixture.documents.comparison.priorEvidenceArtifactInventorySha256 =
        'a1f0c85102e9792c671b310feb4435a2b2c4a024f9ef2ad95ef328352d069a8a';
    fixture.documents.comparison.priorRun.result = 'stable';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationRepeatOutcome(fixture.root));
});

test('rejects non-DirectPlay delivery or post-start input', t => {
    const fixture = createRepeatFixture(t);
    fixture.documents.delivery.actualRunDecision.containerRemux = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationRepeatOutcome(fixture.root));

    fixture.documents.delivery.actualRunDecision.containerRemux = false;
    fixture.documents.instrumentation.countedInterval.postStartPhysicalInputCount = 1;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationRepeatOutcome(fixture.root));
});

test('rejects missing physical-remote start or mismatched stable markers', t => {
    const fixture = createRepeatFixture(t);
    fixture.documents.markers[0].inputMethod = 'unknown';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationRepeatOutcome(fixture.root));

    fixture.documents.markers[0].inputMethod = 'physical-lg-remote';
    fixture.documents.markers[1].observedDurationSeconds = 868;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationRepeatOutcome(fixture.root));
});

test('rejects uptime discontinuity or a reboot claim', t => {
    const fixture = createRepeatFixture(t);
    fixture.documents.uptimeAfter.uptimeSeconds += 5;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationRepeatOutcome(fixture.root));

    fixture.documents.uptimeAfter.uptimeSeconds -= 5;
    fixture.documents.uptimeAfter.platformRebootProven = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationRepeatOutcome(fixture.root));
});

test('rejects promotion of the unproven one-dimension isolation claim', t => {
    const fixture = createRepeatFixture(t);
    fixture.documents.comparison.repeatConfiguration.oneDimensionIsolationProven = true;
    fixture.persist();

    assert.throws(() => validateNativeMediaIsolationRepeatOutcome(fixture.root));
});

test('rejects a promoted decision or inconsistent cross-run classification', t => {
    const fixture = createRepeatFixture(t);
    fixture.documents.phase.decision = 'APPROVE';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationRepeatOutcome(fixture.root));

    fixture.documents.phase.decision = 'HOLD-baseline-stable-comparisons-incomplete';
    fixture.documents.run.crossRunClassification = 'repeat-stable';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationRepeatOutcome(fixture.root));
});

test('rejects incomplete cleanup and stale artifact inventory hashes', t => {
    const fixture = createRepeatFixture(t);
    fixture.documents.cleanup.staticListenerCount = 1;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationRepeatOutcome(fixture.root));

    fixture.documents.cleanup.staticListenerCount = 0;
    fixture.persist();
    completeFixture(fixture);
    writeText(fixture.root, 'README.md', '# Changed after inventory\n');
    assert.throws(() => validateNativeMediaIsolationRepeatInventory(fixture.root));
});
