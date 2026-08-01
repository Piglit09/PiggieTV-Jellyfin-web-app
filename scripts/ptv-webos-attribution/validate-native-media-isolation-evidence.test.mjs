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
    validateNativeMediaIsolationFinalOutcome,
    validateNativeMediaIsolationKnownPrivateValueScan,
    validateNativeMediaIsolationPrivacy
} from './validate-native-media-isolation-evidence.mjs';

const STARTED_AT = '2026-07-28T11:44:44.1999073+00:00';
const ENDED_AT = '2026-07-28T11:47:38.7590415+00:00';

function createTemporaryRoot(t, prefix = 'ptv-native-media-outcome-') {
    const root = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => {
        const resolved = resolve(root);
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

function createFixture(t, {
    result,
    decision,
    observedDurationSeconds,
    platformRebootProven,
    uptimeAfter
}) {
    const root = createTemporaryRoot(t);
    const documents = {
        approval: {
            status: 'explicit',
            destructiveRiskAcknowledged: true,
            launchAuthorized: true
        },
        phase: {
            decision,
            productionModified: false,
            ownershipBoundariesModified: false
        },
        delivery: {
            actualRunDecision: {
                selectedDeliveryCategory: 'DirectPlay',
                videoTranscode: false,
                audioTranscode: false,
                containerRemux: false,
                subtitleBurnIn: false,
                candidateCount: 1,
                rawRecordRetained: false
            },
            countableAsCleanIsolation: true
        },
        instrumentation: {
            preflight: {
                forbiddenHelperTotal: 0,
                staticServerCount: 1
            },
            countedInterval: {
                periodicProcessResourcePolling: 0,
                appPresenceQueries: 0,
                networkProbes: 0,
                cdpOrInspectorAttachments: 0,
                rendererOrBrowserInjections: 0,
                syntheticOrDeveloperInputs: 0,
                postStartPhysicalInputCount: 0
            }
        },
        matrix: {
            runs: [{
                changedDimension: 'baseline-not-applicable',
                deliveryMode: 'DirectPlay'
            }]
        },
        run: {
            result,
            actualDeliveryMode: 'DirectPlay',
            observedDurationSeconds,
            platformRebootProven
        },
        uptimeBefore: {
            observedAt: '2026-07-28T11:09:25.7017940+00:00',
            uptimeSeconds: 20625.56,
            sampleCount: 1
        },
        uptimeAfter,
        cleanup: {
            completedAt: '2026-07-28T11:51:45.7546622+00:00',
            validationApplicationClosedByCommand: true,
            validationApplicationClosureConfirmedByOperator: true,
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
        staticDelivery: {
            serverActiveDuringCountedInterval: true,
            serverActiveAfterCleanup: false,
            serverCount: 1,
            exactIndexMatched: true,
            rendererInjectionDetected: false,
            rawRequestDataRetained: false,
            cleanupStoppedAt: '2026-07-28T11:50:23.2934068+00:00',
            listenerRemoved: true
        },
        markers: []
    };

    function persist() {
        writeJson(root, 'run-01-baseline/approval.json', documents.approval);
        writeJson(root, 'phase-summary.json', documents.phase);
        writeJson(root, 'run-01-baseline/delivery-mode.json', documents.delivery);
        writeJson(root, 'run-01-baseline/instrumentation-absence.json', documents.instrumentation);
        writeJson(root, 'comparison-matrix.json', documents.matrix);
        writeJson(root, 'run-01-baseline/run-summary.json', documents.run);
        writeJson(root, 'run-01-baseline/uptime-before.json', documents.uptimeBefore);
        writeJson(root, 'run-01-baseline/uptime-after.json', documents.uptimeAfter);
        writeJson(root, 'run-01-baseline/cleanup.json', documents.cleanup);
        writeJson(root, 'run-01-baseline/static-delivery-summary.json', documents.staticDelivery);
        writeText(
            root,
            'run-01-baseline/operator-markers.ndjson',
            documents.markers.map(marker => JSON.stringify(marker)).join('\n')
        );
    }

    persist();
    return { documents, persist, root };
}

function createInterruptedFixture(t) {
    const fixture = createFixture(t, {
        result: 'interrupted-unsolicited-pause',
        decision: 'HOLD-inconclusive',
        observedDurationSeconds: 174.56,
        platformRebootProven: false,
        uptimeAfter: {
            observedAt: '2026-07-28T11:48:18.4417315+00:00',
            uptimeSeconds: 22958.39,
            sampleCount: 1,
            increasedFromPreRun: true,
            platformRebootProven: false
        }
    });
    const { documents } = fixture;
    documents.approval = {
        status: 'explicit',
        destructiveRiskAcknowledged: true,
        approvalReceivedAt: '2026-07-28T11:05:25.657Z',
        launchAuthorized: true,
        consumedByPrestartAttempt: true,
        countedPlaybackStarted: true,
        relaunchApprovalReceivedAt: '2026-07-28T11:35:41.7978990+00:00',
        relaunchAuthorized: true
    };
    documents.phase = {
        currentStatus: 'complete-hold-inconclusive',
        run1: {
            status: 'interrupted-unsolicited-pause',
            result: 'interrupted-unsolicited-pause',
            actualDeliveryMode: 'DirectPlay',
            observedDurationSeconds: 174.56,
            postStartInputCount: 0
        },
        decision: 'HOLD-inconclusive',
        productionModified: false,
        ownershipBoundariesModified: false
    };
    documents.instrumentation.countedInterval = {
        status: 'ended-zero-input',
        startedAt: STARTED_AT,
        endedAt: ENDED_AT,
        observedDurationSeconds: 174.56,
        periodicProcessResourcePolling: 0,
        appPresenceQueries: 0,
        networkProbes: 0,
        cdpOrInspectorAttachments: 0,
        rendererOrBrowserInjections: 0,
        syntheticOrDeveloperInputs: 0,
        postStartPhysicalInputCount: 0
    };
    documents.matrix.runs[0] = {
        changedDimension: 'baseline-not-applicable',
        deliveryMode: 'DirectPlay',
        result: 'interrupted-unsolicited-pause',
        durationSeconds: 174.56,
        postStartInputCount: 0,
        platformRebootProven: false
    };
    documents.run = {
        result: 'interrupted-unsolicited-pause',
        decision: 'HOLD-inconclusive',
        countedInterval: {
            startedAt: STARTED_AT,
            endedAt: ENDED_AT,
            observedDurationSeconds: 174.56,
            postStartPhysicalInputCount: 0
        },
        observedDurationSeconds: 174.56,
        actualDeliveryMode: 'DirectPlay',
        physicalPlaybackStart: true,
        interruptionCategory: 'unsolicited-playback-pause',
        stableDurationProven: false,
        platformRebootProven: false,
        preRunUptimeIncreasedAfterRun: true
    };
    documents.markers = [
        {
            sequence: 1,
            observedAt: '2026-07-28T11:34:56.0192162+00:00',
            category: 'prestart-operator-exit',
            countedInterval: false
        },
        {
            sequence: 2,
            observedAt: STARTED_AT,
            category: 'playback-start-confirmed',
            countedInterval: true,
            state: 'playing',
            inputMethod: 'physical-lg-remote',
            postStartPhysicalInputCount: 0
        },
        {
            sequence: 3,
            observedAt: ENDED_AT,
            category: 'unsolicited-playback-pause',
            countedInterval: true,
            state: 'paused-without-operator-input',
            postStartPhysicalInputCount: 0,
            intervalStopped: true
        },
        {
            sequence: 4,
            observedAt: '2026-07-28T11:51:13.2754604+00:00',
            category: 'post-run-application-closed',
            countedInterval: false,
            state: 'cleanup-confirmed'
        }
    ];
    fixture.persist();
    return fixture;
}

function validKnownPrivateValueScan() {
    return {
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
    };
}

test('accepts the existing stable final outcome', t => {
    const fixture = createFixture(t, {
        result: 'stable',
        decision: 'HOLD-baseline-stable-comparisons-incomplete',
        observedDurationSeconds: 900,
        platformRebootProven: false,
        uptimeAfter: {
            increasedFromPreRun: true,
            platformRebootProven: false
        }
    });

    assert.doesNotThrow(() => validateNativeMediaIsolationFinalOutcome(fixture.root));
});

test('accepts the existing full-platform-reboot final outcome', t => {
    const fixture = createFixture(t, {
        result: 'full-platform-reboot',
        decision: 'BLOCK-baseline-rebooted',
        observedDurationSeconds: 120,
        platformRebootProven: true,
        uptimeAfter: {
            platformRebootProven: true,
            recoveryProbes: [{}, {}],
            validationApplicationPresentAfterBoot: false
        }
    });

    assert.doesNotThrow(() => validateNativeMediaIsolationFinalOutcome(fixture.root));
});

test('accepts the complete interrupted HOLD-inconclusive evidence contract', t => {
    const fixture = createInterruptedFixture(t);

    assert.doesNotThrow(() => validateNativeMediaIsolationFinalOutcome(fixture.root));
});

test('rejects interrupted evidence without actual DirectPlay or zero-input parity', t => {
    const fixture = createInterruptedFixture(t);
    fixture.documents.delivery.actualRunDecision.selectedDeliveryCategory = 'Transcode';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));

    fixture.documents.delivery.actualRunDecision.selectedDeliveryCategory = 'DirectPlay';
    fixture.documents.phase.run1.postStartInputCount = 1;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));
});

test('rejects interrupted evidence with cross-file result or duration disagreement', t => {
    const fixture = createInterruptedFixture(t);
    fixture.documents.matrix.runs[0].result = 'stable';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));

    fixture.documents.matrix.runs[0].result = 'interrupted-unsolicited-pause';
    fixture.documents.instrumentation.countedInterval.observedDurationSeconds = 174;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));
});

test('rejects interrupted evidence without an ordered physical-remote start and pause', t => {
    const fixture = createInterruptedFixture(t);
    fixture.documents.markers[1].inputMethod = 'unknown';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));

    fixture.documents.markers[1].inputMethod = 'physical-lg-remote';
    fixture.documents.markers.reverse();
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));
});

test('rejects marker duration that disagrees with the declared 174.56 seconds', t => {
    const fixture = createInterruptedFixture(t);
    fixture.documents.markers[2].observedAt = '2026-07-28T11:47:39.7590415+00:00';
    fixture.documents.run.countedInterval.endedAt = fixture.documents.markers[2].observedAt;
    fixture.documents.instrumentation.countedInterval.endedAt = fixture.documents.markers[2].observedAt;
    fixture.persist();

    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));
});

test('rejects interrupted evidence without continuous pre/post uptime', t => {
    const fixture = createInterruptedFixture(t);
    fixture.documents.uptimeAfter.uptimeSeconds += 5;
    fixture.persist();

    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));
});

test('rejects consumed approval without a fresh authorized relaunch', t => {
    const fixture = createInterruptedFixture(t);
    fixture.documents.approval.relaunchAuthorized = false;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));

    fixture.documents.approval.relaunchAuthorized = true;
    fixture.documents.approval.relaunchApprovalReceivedAt = '2026-07-28T11:34:00.000Z';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));
});

test('rejects incomplete cleanup or a static server left active', t => {
    const fixture = createInterruptedFixture(t);
    fixture.documents.cleanup.staticListenerCount = 1;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));

    fixture.documents.cleanup.staticListenerCount = 0;
    fixture.documents.staticDelivery.serverActiveAfterCleanup = true;
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));
});

test('rejects alternate unsolicited-pause result and decision names', t => {
    const fixture = createInterruptedFixture(t);
    fixture.documents.run.result = 'unsolicited-pause';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));

    fixture.documents.run.result = 'interrupted-unsolicited-pause';
    fixture.documents.phase.decision = 'HOLD-baseline-stable-comparisons-incomplete';
    fixture.persist();
    assert.throws(() => validateNativeMediaIsolationFinalOutcome(fixture.root));
});

test('rejects private identity keys, raw credentials, and private/link-local addresses', t => {
    const root = createTemporaryRoot(t, 'ptv-native-media-privacy-');
    const findings = [
        ['snake-case-identity', '{"media_source_id":"redacted"}'],
        ['x-emby-token', 'X-Emby-Token: redacted'],
        ['authorization', 'Authorization: redacted'],
        ['cookie', 'Cookie: redacted'],
        ['link-local-v4', ['169', '254', '20', '30'].join('.')],
        ['private-v6', ['fd12', '3456', '', '1'].join(':')],
        ['link-local-v6', ['fe80', '', '1'].join(':')],
        ['loopback-v6', ['', '', '1'].join(':')]
    ];

    for (const [directory, value] of findings) {
        writeText(root, `${directory}/safe.txt`, value);
        assert.throws(() => validateNativeMediaIsolationPrivacy(join(root, directory), false));
    }

    const linkLocalFilename = `${['169', '254', '20', '30'].join('.')}.txt`;
    writeText(root, `private-filename/${linkLocalFilename}`, 'redacted');
    assert.throws(() => validateNativeMediaIsolationPrivacy(join(root, 'private-filename'), false));
});

test('validates the category-only known-private-value scan', t => {
    const root = createTemporaryRoot(t, 'ptv-native-media-known-values-');
    const scan = validKnownPrivateValueScan();
    writeJson(root, 'known-private-value-scan.json', scan);
    assert.doesNotThrow(() => validateNativeMediaIsolationKnownPrivateValueScan(root));

    scan.additionalSchemaAndManualReviewCategories.rawKeyCode = 1;
    writeJson(root, 'known-private-value-scan.json', scan);
    assert.throws(() => validateNativeMediaIsolationKnownPrivateValueScan(root));
});
