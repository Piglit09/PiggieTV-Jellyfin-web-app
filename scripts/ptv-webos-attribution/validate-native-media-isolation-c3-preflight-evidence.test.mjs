import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
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
    join,
    relative,
    sep
} from 'node:path';
import test from 'node:test';

import {
    validateNativeMediaIsolationC3PreflightEvidence,
    validateNativeMediaIsolationC3PreflightOutcome
} from './validate-native-media-isolation-c3-preflight-evidence.mjs';

const PHASE = 'PiggieTV WebOS Phase 3A.1R.2d';
const RUN_DIRECTORY = 'run-05-c3-non-aac-audio-transcode';
const STATUS = 'HOLD-c3-preflight-no-conforming-asset';
const DECISION = 'HOLD-inconclusive';
const NEXT_PHASE =
    'C3 privacy-safe test-asset preparation on an isolated non-production Jellyfin instance';
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

function writeJson(root, path, value) {
    const absolutePath = join(root, ...path.split('/'));
    mkdirSync(join(absolutePath, '..'), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root, path, value) {
    const absolutePath = join(root, ...path.split('/'));
    mkdirSync(join(absolutePath, '..'), { recursive: true });
    writeFileSync(absolutePath, value);
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

function createFixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'ptv-c3-preflight-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const documents = {
        approval: {
            phase: PHASE,
            run: RUN_DIRECTORY,
            status: 'explicit',
            scope: 'single-c3-non-aac-audio-transcode-comparison',
            approvalReceivedAt: '2026-07-28T17:00:00.000Z',
            launchAuthorized: true,
            rebootRiskAcknowledged: true,
            approvalConsumed: false,
            launchAttempted: false,
            playbackAttempted: false,
            launchCount: 0,
            playbackStartCount: 0
        },
        build: {
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
            buildOrWrapperModified: false
        },
        candidate: {
            preflightOnly: true,
            privacyProjection: 'category-only',
            rawRecordsRetained: false,
            sourceIdentityRetained: false,
            titleRetained: false,
            itemIdentifierRetained: false,
            pathRetained: false,
            strictCriteria: {
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
            },
            strictCandidateCount: 0,
            closestCandidates: [
                {
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
                },
                {
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
                }
            ],
            conformingAssetAvailable: false,
            noCandidateSelected: true,
            playbackProhibitedByGate: true,
            result: 'no-conforming-asset'
        },
        instrumentation: {
            preflight: {
                totalReadOnlyCommandCount: 15,
                bounded: true,
                nonPeriodic: true,
                mutationCommandCount: 0,
                successfulCommandCount: 12,
                nonzeroExitCommandCount: 3,
                categories: {
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
                },
                failureCategories: [
                    'quoting-syntax',
                    'schema-syntax',
                    'alias-syntax'
                ],
                rawCommandOutputRetained: false,
                privateRuntimeValuesRetained: false
            },
            activity: {
                tvQueryCount: 0,
                appQueryCount: 0,
                playbackQueryCount: 0,
                inspectorQueryCount: 0,
                pollerQueryCount: 0,
                rendererInjectionCount: 0,
                launchCount: 0,
                playbackStartCount: 0,
                countedIntervalCount: 0
            },
            mutations: {
                production: 0,
                productSource: 0,
                serverConfiguration: 0,
                libraryData: 0,
                media: 0,
                device: 0
            }
        },
        launch: {
            approvalConsumed: false,
            launchCount: 0,
            playbackStartCount: 0,
            launchAttempted: false,
            playbackAttempted: false,
            staticServerStarted: false,
            validationApplicationStarted: false,
            countedIntervalStarted: false,
            reason: 'candidate-gate-no-conforming-asset'
        },
        cleanup: {
            cleanupNeeded: false,
            cleanupPerformed: false,
            reason: 'nothing-launched-or-started',
            validationApplicationPresent: false,
            staticServerProcessPresent: false,
            staticListenerCount: 0,
            relevantHelperCount: 0,
            inspectorAttachmentCount: 0,
            pollerCount: 0,
            temporaryArtifactCreated: false,
            temporaryApiSessionCreated: false,
            productionModified: false
        },
        phase: {
            schemaVersion: 'ptv-webos-native-media-isolation-c3-preflight-summary-v1',
            phase: PHASE,
            run: {
                directory: RUN_DIRECTORY,
                status: STATUS
            },
            evidenceRoot: 'privacy-redacted',
            status: STATUS,
            decision: DECISION,
            approvalConsumed: false,
            launchCount: 0,
            playbackStartCount: 0,
            strictCandidateCount: 0,
            productionModified: false,
            productSourceModified: false,
            serverConfigurationModified: false,
            libraryDataModified: false,
            ownershipBoundariesModified: false,
            cleanupNeeded: false,
            isolationConclusion: 'inconclusive',
            nextPhase: NEXT_PHASE
        }
    };

    function persist() {
        writeText(
            root,
            'README.md',
            `# ${PHASE}\n\nStatus: ${STATUS}.\n`
        );
        writeText(
            root,
            'final-report.md',
            `# C3 preflight\n\nStatus: ${STATUS}.\n\nDecision: ${DECISION}.\n\n`
                + `Exactly one next phase: ${NEXT_PHASE}.\n`
        );
        writeJson(root, 'phase-summary.json', documents.phase);
        writeJson(root, `${RUN_DIRECTORY}/approval.json`, documents.approval);
        writeJson(root, `${RUN_DIRECTORY}/build-identity.json`, documents.build);
        writeJson(
            root,
            `${RUN_DIRECTORY}/candidate-selection.json`,
            documents.candidate
        );
        writeJson(root, `${RUN_DIRECTORY}/cleanup.json`, documents.cleanup);
        writeJson(
            root,
            `${RUN_DIRECTORY}/instrumentation-absence.json`,
            documents.instrumentation
        );
        writeJson(root, `${RUN_DIRECTORY}/launch-summary.json`, documents.launch);
    }

    function finalize() {
        persist();
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
        const privacyExclusions = new Set([
            'artifact-inventory.json',
            'known-private-value-scan.json',
            'privacy-scan.json'
        ]);
        const filesScanned = listFiles(root)
            .map(path => normalizeRelative(root, path))
            .filter(path => !privacyExclusions.has(path))
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
    return {
        documents,
        finalize,
        persist,
        root
    };
}

test('accepts the privacy-safe C3 preflight HOLD without launch or playback', t => {
    const fixture = createFixture(t);
    assert.doesNotThrow(() => validateNativeMediaIsolationC3PreflightOutcome(fixture.root));
});

test('rejects consumed approval, launch, playback, or counted activity', t => {
    for (const mutate of [
        documents => {
            documents.approval.approvalConsumed = true;
        },
        documents => {
            documents.launch.launchCount = 1;
        },
        documents => {
            documents.approval.playbackStartCount = 1;
        },
        documents => {
            documents.instrumentation.activity.countedIntervalCount = 1;
        }
    ]) {
        const fixture = createFixture(t);
        mutate(fixture.documents);
        fixture.persist();
        assert.throws(() => validateNativeMediaIsolationC3PreflightOutcome(fixture.root));
    }
});

test('requires the exact frozen production build and wrapper identities', t => {
    for (const mutate of [
        documents => {
            documents.build.git.commit = 'different';
        },
        documents => {
            documents.build.artifacts[0].sha256 = 'different';
        },
        documents => {
            documents.build.validationWrapper.packageSha256 = 'different';
        },
        documents => {
            documents.build.buildOrWrapperModified = true;
        }
    ]) {
        const fixture = createFixture(t);
        mutate(fixture.documents);
        fixture.persist();
        assert.throws(() => validateNativeMediaIsolationC3PreflightOutcome(fixture.root));
    }
});

test('requires exactly 15 bounded non-periodic read-only commands and their failures', t => {
    for (const mutate of [
        documents => {
            documents.instrumentation.preflight.totalReadOnlyCommandCount = 13;
        },
        documents => {
            documents.instrumentation.preflight.bounded = false;
        },
        documents => {
            documents.instrumentation.preflight.nonPeriodic = false;
        },
        documents => {
            documents.instrumentation.preflight.mutationCommandCount = 1;
        },
        documents => {
            documents.instrumentation.preflight.categories.capabilityOrSchema.nonzeroExit = 1;
        }
    ]) {
        const fixture = createFixture(t);
        mutate(fixture.documents);
        fixture.persist();
        assert.throws(() => validateNativeMediaIsolationC3PreflightOutcome(fixture.root));
    }
});

test('rejects any TV, app, playback, inspector, poller, or renderer activity', t => {
    for (const field of [
        'tvQueryCount',
        'appQueryCount',
        'playbackQueryCount',
        'inspectorQueryCount',
        'pollerQueryCount',
        'rendererInjectionCount'
    ]) {
        const fixture = createFixture(t);
        fixture.documents.instrumentation.activity[field] = 1;
        fixture.persist();
        assert.throws(() => validateNativeMediaIsolationC3PreflightOutcome(fixture.root));
    }
});

test('requires zero strict candidates and exact privacy-safe closest categories', t => {
    for (const mutate of [
        documents => {
            documents.candidate.strictCandidateCount = 1;
        },
        documents => {
            documents.candidate.closestCandidates[0].count = 4;
        },
        documents => {
            documents.candidate.closestCandidates[0].channelLayout = 'stereo';
        },
        documents => {
            documents.candidate.closestCandidates[1].container = 'mp4';
        },
        documents => {
            documents.candidate.closestCandidates[1].disqualifyingDimensions = [
                'audio-channel-layout'
            ];
        },
        documents => {
            documents.candidate.playbackProhibitedByGate = false;
        }
    ]) {
        const fixture = createFixture(t);
        mutate(fixture.documents);
        fixture.persist();
        assert.throws(() => validateNativeMediaIsolationC3PreflightOutcome(fixture.root));
    }
});

test('rejects retained raw records or source, title, item, and path identities', t => {
    for (const field of [
        'rawRecordsRetained',
        'sourceIdentityRetained',
        'titleRetained',
        'itemIdentifierRetained',
        'pathRetained'
    ]) {
        const fixture = createFixture(t);
        fixture.documents.candidate[field] = true;
        fixture.persist();
        assert.throws(() => validateNativeMediaIsolationC3PreflightOutcome(fixture.root));
    }
});

test('requires no mutation and a truthful no-op cleanup boundary', t => {
    for (const mutate of [
        documents => {
            documents.instrumentation.mutations.serverConfiguration = 1;
        },
        documents => {
            documents.phase.libraryDataModified = true;
        },
        documents => {
            documents.cleanup.cleanupNeeded = true;
        },
        documents => {
            documents.cleanup.cleanupPerformed = true;
        },
        documents => {
            documents.cleanup.relevantHelperCount = 1;
        },
        documents => {
            documents.cleanup.staticListenerCount = 1;
        }
    ]) {
        const fixture = createFixture(t);
        mutate(fixture.documents);
        fixture.persist();
        assert.throws(() => validateNativeMediaIsolationC3PreflightOutcome(fixture.root));
    }
});

test('requires the exact HOLD decision and isolated non-production next phase', t => {
    const badDecision = createFixture(t);
    badDecision.documents.phase.decision = 'GO';
    badDecision.persist();
    assert.throws(() => validateNativeMediaIsolationC3PreflightOutcome(badDecision.root));

    const repeatedNextPhase = createFixture(t);
    writeText(
        repeatedNextPhase.root,
        'final-report.md',
        `Status: ${STATUS}. Decision: ${DECISION}. ${NEXT_PHASE}. ${NEXT_PHASE}.\n`
    );
    assert.throws(() =>
        validateNativeMediaIsolationC3PreflightOutcome(repeatedNextPhase.root)
    );
});

test('full validator enforces privacy scans and artifact inventory', t => {
    const fixture = createFixture(t);
    fixture.finalize();
    assert.deepEqual(validateNativeMediaIsolationC3PreflightEvidence(fixture.root), {
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
    });
});

test('full validator rejects private identity fields and stale inventory hashes', t => {
    const privateFixture = createFixture(t);
    privateFixture.documents.candidate.mediaTitle = 'not-retainable';
    privateFixture.finalize();
    assert.throws(() =>
        validateNativeMediaIsolationC3PreflightEvidence(privateFixture.root)
    );

    const staleFixture = createFixture(t);
    staleFixture.finalize();
    writeText(staleFixture.root, 'README.md', '# changed after inventory\n');
    assert.throws(() =>
        validateNativeMediaIsolationC3PreflightEvidence(staleFixture.root)
    );
});
