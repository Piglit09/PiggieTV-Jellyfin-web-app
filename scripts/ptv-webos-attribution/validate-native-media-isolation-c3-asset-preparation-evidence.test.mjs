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
    validateNativeMediaIsolationC3AssetPreparationEvidence,
    validateNativeMediaIsolationC3AssetPreparationOutcome
} from './validate-native-media-isolation-c3-asset-preparation-evidence.mjs';

const PHASE = 'PiggieTV WebOS Phase 3A.1R.2d - C3 asset preparation';
const STATUS = 'READY-c3-paired-fixture-prepared';
const DECISION = 'READY-c3-paired-fixture-prepared-no-playback-authorized';
const APPROVAL_SCOPE = 'c3-privacy-safe-paired-test-asset-preparation-only';
const NEXT_PHASE =
    'C3 synthetic AAC control playback with separate explicit approval';
const FROZEN_COMMIT = '44899b1fb556f4983ae2c1fa4e861d1ad0b4f4d8';
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
    const root = mkdtempSync(join(tmpdir(), 'ptv-c3-asset-preparation-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const documents = {
        activity: {
            schemaVersion: 1,
            outOfScopeActivity: {
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
            },
            outOfScopeMutations: {
                production: 0,
                productSource: 0,
                productionServerConfiguration: 0,
                productionLibraryData: 0,
                ownershipBoundaries: 0,
                television: 0,
                validationApplication: 0
            },
            preparationActivity: {
                syntheticFixtureCount: 2,
                isolatedInstanceCreationCount: 1,
                isolatedPlanningQueryCount: 3,
                bounded: true,
                nonPeriodic: true,
                isolatedOnly: true
            },
            noOutOfScopeActivity: true
        },
        approval: {
            schemaVersion: 1,
            phase: PHASE,
            status: 'explicit',
            scope: APPROVAL_SCOPE,
            approvalReceivedAt: '2026-07-28T17:30:00.000Z',
            preparationAuthorized: true,
            isolatedNonProductionWritesAuthorized: true,
            televisionContactAuthorized: false,
            validationApplicationLaunchAuthorized: false,
            mediaPlaybackAuthorized: false,
            productionContactAuthorized: false,
            futurePhysicalRunAuthorized: false
        },
        build: {
            git: {
                commit: FROZEN_COMMIT
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
            buildOrWrapperModified: false,
            profileSourceCommit: FROZEN_COMMIT
        },
        cleanup: {
            schemaVersion: 1,
            completedAt: '2026-07-28T18:00:00.000Z',
            isolatedServerStopped: true,
            isolatedServerRemoved: true,
            isolatedNetworkRemoved: true,
            temporaryTestAccountRemoved: true,
            temporaryCredentialsDestroyed: true,
            temporaryIntermediatesRemoved: true,
            ownedTemporaryResourcesAbsent: true,
            finalPairRetained: true,
            finalPairSealedReadOnly: true,
            retainedFixtureLocationDisclosed: false,
            productionCleanupNeeded: false,
            productionModified: false,
            televisionModified: false,
            validationApplicationModified: false
        },
        delivery: {
            schemaVersion: 1,
            predictionOnly: true,
            actualPlaybackOccurred: false,
            rawPlanningResponsesRetained: false,
            rawRuntimeValuesRetained: false,
            profile: {
                sourceCommit: FROZEN_COMMIT,
                webosVersion: '5.6.2',
                sameProfileUsedForBoth: true,
                dtsUserOverrideEnabled: false,
                dtsAdvertisedForDirectPlay: false,
                aacAdvertisedForDirectPlay: true,
                h264AdvertisedForDirectPlay: true,
                stereoPermitted: true,
                videoQuality: 'auto',
                subtitleState: 'off',
                relevantSubsetSha256: 'b'.repeat(64)
            },
            planningQueries: {
                controlCount: 1,
                candidateCount: 2,
                totalCount: 3,
                bounded: true,
                nonPeriodic: true,
                actualMediaRequestCount: 0
            },
            control: {
                role: 'control',
                predictionOnly: true,
                serverPlanningCategory: 'DirectPlay',
                clientDeliveryCategory: 'DirectPlay',
                candidateCount: 1,
                serverSupportsDirectPlay: true,
                serverSupportsDirectStream: true,
                serverSupportsTranscoding: true,
                videoDirect: true,
                audioDirect: true,
                videoTranscode: false,
                audioTranscode: false,
                containerRemux: false,
                subtitleBurnIn: false,
                transcodeReasons: []
            },
            candidate: {
                role: 'candidate',
                predictionOnly: true,
                serverPlanningCategory: 'Transcode',
                clientDeliveryCategory: 'DirectStream',
                candidateCount: 1,
                serverSupportsDirectPlay: false,
                serverSupportsDirectStream: false,
                serverSupportsTranscoding: true,
                httpDirectStreamReportingDisabled: true,
                streamInfoPlayMethodForUrlCreation: 'Transcode',
                finalEncodingDecisionDeferredUntilMediaRequest: true,
                actualTranscodeCommandObserved: false,
                videoCodecOptions: [
                    'h264',
                    'hevc'
                ],
                audioCodecOptions: [
                    'aac',
                    'mp3',
                    'ac3',
                    'eac3'
                ],
                videoStreamCopyAllowed: true,
                videoSourceMatchesCopyCandidate: true,
                videoCopyPredictionBasis:
                    'exact-source-logic-and-audio-only-reason',
                videoDirect: true,
                audioDirect: false,
                videoTranscode: false,
                audioTranscode: true,
                predictedOutputAudioCodec: 'aac',
                predictedOutputChannelLayout: 'stereo',
                videoCopyRuntimeProven: false,
                audioTranscodeRuntimeProven: false,
                outputAudioCodecRuntimeProven: false,
                serverTranscodeProtocol: 'hls',
                serverTranscodeContainer: 'ts',
                containerRemux: true,
                subtitleBurnIn: false,
                transcodeReasons: [
                    'AudioCodecNotSupported'
                ]
            },
            runtimeDeliveryProven: false,
            futurePhysicalRunMustReproveDelivery: true,
            predictionEligibleForFutureRun: true
        },
        instance: {
            schemaVersion: 1,
            environment: 'isolated-non-production',
            jellyfinVersion: '10.11.11',
            serverImage: {
                versionPinned: true,
                digestSha256: '6'.repeat(64)
            },
            serverFfmpeg: {
                versionPinned: true,
                version: 'fixture-server-ffmpeg',
                digestSha256: '7'.repeat(64)
            },
            network: {
                internalOnly: true,
                publicPortPublished: false,
                lanPortPublished: false,
                productionRouteAvailable: false,
                discoveryEnabled: false,
                reverseProxyPresent: false
            },
            mounts: {
                productionConfigurationMounted: false,
                productionDatabaseMounted: false,
                productionMediaMounted: false,
                productionBackupMounted: false,
                productionCacheMounted: false,
                productionPluginDirectoryMounted: false,
                containerControlSocketMounted: false,
                syntheticMediaReadOnlyAfterGeneration: true
            },
            freshConfiguration: true,
            freshDatabase: true,
            freshCache: true,
            testAccountOnly: true,
            productionCredentialsUsed: false,
            pluginsInstalled: false,
            rawRuntimeIdentityRetained: false,
            isolationBoundaryValidated: true
        },
        equivalence: {
            schemaVersion: 1,
            sameFinalMuxerAndPolicy: true,
            finalAssetSha256: {
                control: '1'.repeat(64),
                candidate: '2'.repeat(64)
            },
            videoPayloadSha256: {
                control: '3'.repeat(64),
                candidate: '3'.repeat(64)
            },
            videoPacketTimingSha256: {
                control: '4'.repeat(64),
                candidate: '4'.repeat(64)
            },
            audioPcmMasterSha256: '5'.repeat(64),
            videoPayloadByteIdentical: true,
            videoPacketTimingIdentical: true,
            videoGeometryIdentical: true,
            videoColorMetadataIdentical: true,
            audioUsesSamePcmMaster: true,
            audioSampleGeometryIdentical: true,
            audioPresentationTimingWithinCodecFrameTolerance: true,
            audioNominalBitrateIdentical: true,
            containerBrandsIdentical: true,
            trackOrderIdentical: true,
            trackIdentifiersIdentical: true,
            videoTimescaleIdentical: true,
            audioTimescales: {
                control: '1/48000',
                candidate: '1/90000'
            },
            audioTimescaleCodecDependent: true,
            metadataPolicyIdentical: true,
            differences: {
                independentlySelected: [
                    'audio-codec'
                ],
                codecDependent: [
                    'audio-compressed-payload',
                    'audio-sample-entry',
                    'audio-codec-configuration',
                    'audio-packetization',
                    'audio-timescale'
                ]
            },
            unexpectedIndependentDifferenceCount: 0,
            completeDecode: {
                control: 'PASS',
                candidate: 'PASS'
            },
            independentAnalyzerCount: 2,
            independentAnalyzersAgree: true,
            exactPairValidated: true,
            finalPairRetainedOutsideEvidence: true,
            retainedMappingUsesRolesOnly: true
        },
        manifest: {
            schemaVersion: 1,
            privacyProjection: 'normalized-category-and-integrity-only',
            rawProbeOutputRetained: false,
            sourceNamesRetained: false,
            absolutePathsRetained: false,
            privateSourceMediaUsed: false,
            sourceKind: 'deterministic-synthetic-neutral',
            neutralContent: true,
            audioMasterKind: 'deterministic-non-speech-stereo-test-signal',
            common: {
                container: {
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
                },
                video: {
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
                },
                audioGeometry: {
                    sampleRateHz: 48000,
                    channelCount: 2,
                    channelLayout: 'stereo',
                    samplesPerChannel: 46126080,
                    durationSeconds: 960.96,
                    streamCount: 1,
                    defaultDisposition: true,
                    language: 'unset',
                    nominalBitrateBps: 384000
                },
                durationClass: '15-minutes-or-longer',
                subtitleState: 'none',
                multipleVideoVersions: false
            },
            control: {
                role: 'control',
                audioCodec: 'aac-lc',
                audioProfile: 'lc',
                sampleEntry: 'mp4a',
                codecString: 'mp4a.40.2'
            },
            candidate: {
                role: 'candidate',
                audioCodec: 'dts-core',
                audioProfile: 'core',
                sampleEntry: 'dtsc',
                codecString: 'dtsc',
                dtsHdExtensionPresent: false
            },
            completelyKnownTechnicalProperties: true
        },
        phase: {
            schemaVersion:
                'ptv-webos-native-media-isolation-c3-asset-preparation-summary-v1',
            phase: PHASE,
            status: STATUS,
            decision: DECISION,
            approvalScope: APPROVAL_SCOPE,
            completedAt: '2026-07-28T18:00:00.000Z',
            preparationCompleted: true,
            exactPairValidated: true,
            deliveryPredictionValidated: true,
            isolatedInstanceValidated: true,
            televisionContactCount: 0,
            applicationLaunchCount: 0,
            playbackStartCount: 0,
            productionContactCount: 0,
            productionModified: false,
            productSourceModified: false,
            productionServerConfigurationModified: false,
            productionLibraryDataModified: false,
            ownershipBoundariesModified: false,
            runtimePlaybackProven: false,
            televisionSafetyProven: false,
            futurePhysicalRunAuthorized: false,
            isolationConclusion: 'fixture-prepared-runtime-unproven',
            nextPhase: NEXT_PHASE
        },
        toolchain: {
            schemaVersion: 1,
            ffmpeg: {
                name: 'ffmpeg',
                version: 'fixture-ffmpeg',
                versionPinned: true,
                sha256: '8'.repeat(64),
                h264Encoder: 'libx264',
                aacLcEncoderAvailable: true,
                dtsCoreEncoderAvailable: true
            },
            ffprobe: {
                name: 'ffprobe',
                version: 'fixture-ffprobe',
                versionPinned: true,
                sha256: '9'.repeat(64)
            },
            gpac: {
                name: 'gpac-mp4box',
                version: 'fixture-gpac',
                versionPinned: true,
                sha256: 'a'.repeat(64),
                isobmffDtsCoreMuxingGatePassed: true,
                outputDtsCoreSampleEntry: 'dtsc'
            },
            finalMuxer: {
                name: 'gpac-mp4box',
                sameVersionAndPolicyForBothAssets: true,
                ffmpegDtsMp4MuxerUsed: false
            },
            unpinnedToolCount: 0
        }
    };

    function persist() {
        writeText(root, 'README.md', `# ${PHASE}\n\nStatus: ${STATUS}.\n`);
        writeText(
            root,
            'final-report.md',
            '# C3 paired fixture preparation\n\n'
                + '**READY - C3 PAIRED FIXTURE PREPARED; NO PLAYBACK AUTHORIZED**\n\n'
                + `Decision: ${DECISION}.\n\n`
                + 'No television contact, app launch, media playback, or production '
                + 'contact occurred. Runtime playback remains unproven.\n\n'
                + `Exactly one next phase: ${NEXT_PHASE}; it requires separate `
                + 'explicit approval.\n'
        );
        writeJson(root, 'activity-boundary.json', documents.activity);
        writeJson(root, 'approval.json', documents.approval);
        writeJson(root, 'build-identity.json', documents.build);
        writeJson(root, 'cleanup-and-retention.json', documents.cleanup);
        writeJson(root, 'delivery-prediction.json', documents.delivery);
        writeJson(root, 'isolated-instance.json', documents.instance);
        writeJson(root, 'pair-equivalence.json', documents.equivalence);
        writeJson(root, 'pair-manifest.json', documents.manifest);
        writeJson(root, 'phase-summary.json', documents.phase);
        writeJson(root, 'toolchain-identity.json', documents.toolchain);
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
            schemaVersion:
                'ptv-webos-native-media-isolation-artifact-inventory-v1',
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

test('accepts an exact preparation-only READY outcome', t => {
    const fixture = createFixture(t);
    assert.doesNotThrow(() =>
        validateNativeMediaIsolationC3AssetPreparationOutcome(fixture.root)
    );
});

test('rejects approval for TV, app, playback, production, or a future run', t => {
    for (const field of [
        'televisionContactAuthorized',
        'validationApplicationLaunchAuthorized',
        'mediaPlaybackAuthorized',
        'productionContactAuthorized',
        'futurePhysicalRunAuthorized'
    ]) {
        const fixture = createFixture(t);
        fixture.documents.approval[field] = true;
        fixture.persist();
        assert.throws(() =>
            validateNativeMediaIsolationC3AssetPreparationOutcome(fixture.root)
        );
    }
});

test('requires the exact frozen build, wrapper, and profile source', t => {
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
            documents.build.profileSourceCommit = 'different';
        },
        documents => {
            documents.build.buildOrWrapperModified = true;
        }
    ]) {
        const fixture = createFixture(t);
        mutate(fixture.documents);
        fixture.persist();
        assert.throws(() =>
            validateNativeMediaIsolationC3AssetPreparationOutcome(fixture.root)
        );
    }
});

test('requires a pinned isolated non-production Jellyfin boundary', t => {
    for (const mutate of [
        documents => {
            documents.instance.jellyfinVersion = 'different';
        },
        documents => {
            documents.instance.serverImage.versionPinned = false;
        },
        documents => {
            documents.instance.network.productionRouteAvailable = true;
        },
        documents => {
            documents.instance.network.lanPortPublished = true;
        },
        documents => {
            documents.instance.mounts.productionMediaMounted = true;
        },
        documents => {
            documents.instance.productionCredentialsUsed = true;
        },
        documents => {
            documents.instance.rawRuntimeIdentityRetained = true;
        }
    ]) {
        const fixture = createFixture(t);
        mutate(fixture.documents);
        fixture.persist();
        assert.throws(() =>
            validateNativeMediaIsolationC3AssetPreparationOutcome(fixture.root)
        );
    }
});

test('requires pinned tools, one muxer policy, and a proven dtsc gate', t => {
    for (const mutate of [
        documents => {
            documents.toolchain.ffmpeg.versionPinned = false;
        },
        documents => {
            documents.toolchain.gpac.sha256 = 'different';
        },
        documents => {
            documents.toolchain.gpac.isobmffDtsCoreMuxingGatePassed = false;
        },
        documents => {
            documents.toolchain.gpac.outputDtsCoreSampleEntry = 'dts';
        },
        documents => {
            documents.toolchain.finalMuxer.sameVersionAndPolicyForBothAssets = false;
        },
        documents => {
            documents.toolchain.finalMuxer.ffmpegDtsMp4MuxerUsed = true;
        },
        documents => {
            documents.toolchain.unpinnedToolCount = 1;
        }
    ]) {
        const fixture = createFixture(t);
        mutate(fixture.documents);
        fixture.persist();
        assert.throws(() =>
            validateNativeMediaIsolationC3AssetPreparationOutcome(fixture.root)
        );
    }
});

test('requires the exact normalized AAC-LC and DTS Core pair manifest', t => {
    for (const mutate of [
        documents => {
            documents.manifest.common.container.name = 'mkv';
        },
        documents => {
            documents.manifest.common.video.width = 1920;
        },
        documents => {
            documents.manifest.common.video.frameRateNumerator = 24;
        },
        documents => {
            documents.manifest.common.video.colorPrimaries = 'unknown';
        },
        documents => {
            documents.manifest.common.audioGeometry.channelCount = 6;
        },
        documents => {
            documents.manifest.common.audioGeometry.nominalBitrateBps = 768000;
        },
        documents => {
            documents.manifest.common.subtitleState = 'text';
        },
        documents => {
            documents.manifest.control.codecString = 'mp4a';
        },
        documents => {
            documents.manifest.candidate.sampleEntry = 'dstc';
        },
        documents => {
            documents.manifest.candidate.dtsHdExtensionPresent = true;
        }
    ]) {
        const fixture = createFixture(t);
        mutate(fixture.documents);
        fixture.persist();
        assert.throws(() =>
            validateNativeMediaIsolationC3AssetPreparationOutcome(fixture.root)
        );
    }
});

test('requires byte-identical video payload and timing with one selected difference', t => {
    for (const mutate of [
        documents => {
            documents.equivalence.videoPayloadSha256.candidate = 'c'.repeat(64);
        },
        documents => {
            documents.equivalence.videoPacketTimingIdentical = false;
        },
        documents => {
            documents.equivalence.audioUsesSamePcmMaster = false;
        },
        documents => {
            documents.equivalence.audioSampleGeometryIdentical = false;
        },
        documents => {
            documents.equivalence.trackIdentifiersIdentical = false;
        },
        documents => {
            documents.equivalence.videoTimescaleIdentical = false;
        },
        documents => {
            documents.equivalence.audioTimescales.candidate = '1/48000';
        },
        documents => {
            documents.equivalence.audioTimescaleCodecDependent = false;
        },
        documents => {
            documents.equivalence.differences.independentlySelected = [
                'audio-codec',
                'container'
            ];
        },
        documents => {
            documents.equivalence.unexpectedIndependentDifferenceCount = 1;
        },
        documents => {
            documents.equivalence.completeDecode.candidate = 'FAIL';
        },
        documents => {
            documents.equivalence.independentAnalyzerCount = 1;
        }
    ]) {
        const fixture = createFixture(t);
        mutate(fixture.documents);
        fixture.persist();
        assert.throws(() =>
            validateNativeMediaIsolationC3AssetPreparationOutcome(fixture.root)
        );
    }
});

test('requires exact server planning flags and client delivery prediction', t => {
    for (const mutate of [
        documents => {
            documents.delivery.control.serverPlanningCategory = 'Transcode';
        },
        documents => {
            documents.delivery.control.serverSupportsDirectStream = false;
        },
        documents => {
            documents.delivery.control.audioTranscode = true;
        },
        documents => {
            documents.delivery.candidate.predictionOnly = false;
        },
        documents => {
            documents.delivery.candidate.serverPlanningCategory = 'DirectStream';
        },
        documents => {
            documents.delivery.candidate.clientDeliveryCategory = 'Transcode';
        },
        documents => {
            documents.delivery.candidate.serverSupportsDirectPlay = true;
        },
        documents => {
            documents.delivery.candidate.serverSupportsDirectStream = true;
        },
        documents => {
            documents.delivery.candidate.serverSupportsTranscoding = false;
        },
        documents => {
            documents.delivery.candidate.videoTranscode = true;
        },
        documents => {
            documents.delivery.candidate.audioTranscode = false;
        },
        documents => {
            documents.delivery.candidate.httpDirectStreamReportingDisabled = false;
        },
        documents => {
            documents.delivery.candidate.streamInfoPlayMethodForUrlCreation = 'DirectStream';
        },
        documents => {
            documents.delivery.candidate.finalEncodingDecisionDeferredUntilMediaRequest = false;
        },
        documents => {
            documents.delivery.candidate.actualTranscodeCommandObserved = true;
        },
        documents => {
            documents.delivery.candidate.videoCodecOptions = [ 'h264' ];
        },
        documents => {
            documents.delivery.candidate.audioCodecOptions = [ 'aac' ];
        },
        documents => {
            documents.delivery.candidate.videoStreamCopyAllowed = false;
        },
        documents => {
            documents.delivery.candidate.videoSourceMatchesCopyCandidate = false;
        },
        documents => {
            documents.delivery.candidate.videoCopyPredictionBasis = 'runtime-observed';
        },
        documents => {
            documents.delivery.candidate.predictedOutputAudioCodec = 'mp3';
        },
        documents => {
            documents.delivery.candidate.videoCopyRuntimeProven = true;
        },
        documents => {
            documents.delivery.candidate.audioTranscodeRuntimeProven = true;
        },
        documents => {
            documents.delivery.candidate.outputAudioCodecRuntimeProven = true;
        },
        documents => {
            documents.delivery.candidate.serverTranscodeContainer = 'mp4';
        },
        documents => {
            documents.delivery.candidate.candidateCount = 2;
        },
        documents => {
            documents.delivery.candidate.transcodeReasons = [
                'AudioCodecNotSupported',
                'ContainerNotSupported'
            ];
        },
        documents => {
            documents.delivery.profile.dtsUserOverrideEnabled = true;
        },
        documents => {
            documents.delivery.planningQueries.controlCount = 2;
        },
        documents => {
            documents.delivery.planningQueries.candidateCount = 1;
        },
        documents => {
            documents.delivery.planningQueries.totalCount = 2;
        },
        documents => {
            documents.delivery.planningQueries.bounded = false;
        },
        documents => {
            documents.delivery.planningQueries.nonPeriodic = false;
        },
        documents => {
            documents.delivery.planningQueries.actualMediaRequestCount = 1;
        },
        documents => {
            documents.activity.preparationActivity.isolatedPlanningQueryCount = 2;
        }
    ]) {
        const fixture = createFixture(t);
        mutate(fixture.documents);
        fixture.persist();
        assert.throws(() =>
            validateNativeMediaIsolationC3AssetPreparationOutcome(fixture.root)
        );
    }
});

test('rejects any TV, app, playback, production, inspector, or poller activity', t => {
    for (const field of Object.keys(createFixture(t).documents.activity.outOfScopeActivity)) {
        const fixture = createFixture(t);
        fixture.documents.activity.outOfScopeActivity[field] = 1;
        fixture.persist();
        assert.throws(() =>
            validateNativeMediaIsolationC3AssetPreparationOutcome(fixture.root)
        );
    }
});

test('requires truthful cleanup, sealed retention, and exact READY phase state', t => {
    for (const mutate of [
        documents => {
            documents.cleanup.isolatedServerStopped = false;
        },
        documents => {
            documents.cleanup.temporaryCredentialsDestroyed = false;
        },
        documents => {
            documents.cleanup.finalPairSealedReadOnly = false;
        },
        documents => {
            documents.phase.decision = 'PASS';
        },
        documents => {
            documents.phase.runtimePlaybackProven = true;
        },
        documents => {
            documents.phase.futurePhysicalRunAuthorized = true;
        },
        documents => {
            documents.phase.nextPhase = 'automatic-playback';
        }
    ]) {
        const fixture = createFixture(t);
        mutate(fixture.documents);
        fixture.persist();
        assert.throws(() =>
            validateNativeMediaIsolationC3AssetPreparationOutcome(fixture.root)
        );
    }
});

test('full validator enforces privacy scans and artifact inventory', t => {
    const fixture = createFixture(t);
    fixture.finalize();
    assert.deepEqual(
        validateNativeMediaIsolationC3AssetPreparationEvidence(fixture.root),
        {
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
        }
    );
});

test('full validator rejects private identity fields and stale inventory hashes', t => {
    const privateFixture = createFixture(t);
    privateFixture.documents.manifest.mediaTitle = 'not-retainable';
    privateFixture.finalize();
    assert.throws(() =>
        validateNativeMediaIsolationC3AssetPreparationEvidence(privateFixture.root)
    );

    const staleFixture = createFixture(t);
    staleFixture.finalize();
    writeText(staleFixture.root, 'README.md', '# changed after inventory\n');
    assert.throws(() =>
        validateNativeMediaIsolationC3AssetPreparationEvidence(staleFixture.root)
    );
});
