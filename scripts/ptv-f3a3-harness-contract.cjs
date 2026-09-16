'use strict';

const fs = require('node:fs');

const F3A3_EVIDENCE_SCHEMA_VERSION = 1;
const READINESS_STATES = new Set([ 'pending', 'populated', 'empty', 'error' ]);
const OWNERSHIP_COUNTERS = [
    'apiClients',
    'listeners',
    'observers',
    'runtimeRoots',
    'shells',
    'sockets',
    'timers'
];
const FORBIDDEN_KEY = /(?:authorization|cookie|credential|fullUrl|itemId|mediaTitle|password|privateKey|providerId|queryValue|rawTitle|requestBody|serverAddress|sessionId|token|userId|username|absolutePath|\btitle\b)/i;
const URL_VALUE = /https?:\/\/\S+/i;
const WINDOWS_PATH_VALUE = /(?:^|\s)[A-Za-z]:\\[^\s]+/;
const PRIVATE_ADDRESS_VALUE = /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|127\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|localhost)(?::\d+)?\b/i;

function createMonotonicClock() {
    const origin = process.hrtime.bigint();

    return {
        nowMs() {
            return Number(process.hrtime.bigint() - origin) / 1_000_000;
        }
    };
}

function classifyReadiness({ populated = false, empty = false, error = false } = {}) {
    const terminalStates = [
        [ 'populated', populated ],
        [ 'empty', empty ],
        [ 'error', error ]
    ].filter(([, active]) => active);

    if (terminalStates.length > 1) {
        throw new Error('A stage cannot commit more than one readiness state');
    }

    return terminalStates[0]?.[0] || 'pending';
}

function createStageLedger({ clock = createMonotonicClock() } = {}) {
    const stages = new Map();

    return {
        begin(name) {
            if (typeof name !== 'string' || name.trim() === '') {
                throw new TypeError('Stage names must be non-empty strings');
            }
            if (stages.has(name)) {
                throw new Error(`Duplicate stage name: ${name}`);
            }

            const stage = {
                name,
                startedAtMs: clock.nowMs(),
                completedAtMs: null,
                readiness: 'pending'
            };
            stages.set(name, stage);
            return stage;
        },

        finish(name, readinessInput = {}) {
            const stage = stages.get(name);
            if (!stage) {
                throw new Error(`Unknown stage: ${name}`);
            }
            if (stage.completedAtMs !== null) {
                throw new Error(`Stage already completed: ${name}`);
            }

            stage.completedAtMs = clock.nowMs();
            stage.readiness = classifyReadiness(readinessInput);
            stage.elapsedMs = Math.max(0, stage.completedAtMs - stage.startedAtMs);
            return { ...stage };
        },

        snapshot() {
            return Array.from(stages.values(), stage => ({ ...stage }));
        }
    };
}

function createGenerationGate() {
    let currentGeneration = 0;
    let retired = false;

    return {
        begin() {
            retired = false;
            currentGeneration += 1;
            return currentGeneration;
        },

        isCurrent(generation) {
            return !retired && generation === currentGeneration;
        },

        retire() {
            retired = true;
        }
    };
}

function createObserverDisposer(observer) {
    let disconnected = false;

    return () => {
        if (disconnected) return false;
        disconnected = true;
        observer?.disconnect?.();
        return true;
    };
}

function assertSinglePage(pages) {
    if (!Array.isArray(pages) || pages.length !== 1) {
        throw new Error(`Expected exactly one browser page, received ${Array.isArray(pages) ? pages.length : 'invalid'}`);
    }
    return pages[0];
}

function createBrowserOwnershipLease(browser, { externallyOwned = true } = {}) {
    let finalized = false;

    return {
        async finalize() {
            if (finalized) return { closed: false, repeated: true };
            finalized = true;

            if (externallyOwned) {
                return { closed: false, repeated: false };
            }

            await browser?.close?.();
            return { closed: true, repeated: false };
        }
    };
}

async function waitForResponseBodyCompletion(response) {
    if (!response || typeof response.finished !== 'function') {
        throw new TypeError('A response with a finished() contract is required');
    }

    const failure = await response.finished();
    if (failure) throw failure;
    return { completed: true };
}

function assertEvidencePrivacy(value, { forbiddenStrings = [] } = {}) {
    const seen = new Set();

    function visit(candidate, path) {
        if (candidate === null || candidate === undefined) return;

        if (typeof candidate === 'string') {
            if (URL_VALUE.test(candidate) || WINDOWS_PATH_VALUE.test(candidate) || PRIVATE_ADDRESS_VALUE.test(candidate)) {
                throw new Error(`Private evidence value at ${path}`);
            }
            for (const forbidden of forbiddenStrings) {
                if (forbidden && candidate.includes(forbidden)) {
                    throw new Error(`Forbidden evidence value at ${path}`);
                }
            }
            return;
        }

        if (typeof candidate !== 'object' || seen.has(candidate)) return;
        seen.add(candidate);

        if (Array.isArray(candidate)) {
            candidate.forEach((entry, index) => visit(entry, `${path}[${index}]`));
            return;
        }

        for (const [ key, entry ] of Object.entries(candidate)) {
            if (FORBIDDEN_KEY.test(key)) {
                throw new Error(`Forbidden evidence key at ${path}.${key}`);
            }
            visit(entry, `${path}.${key}`);
        }
    }

    visit(value, '$');
    return true;
}

function validateEvidenceDocument(document, options = {}) {
    assertEvidencePrivacy(document, options);

    if (!document || document.schemaVersion !== F3A3_EVIDENCE_SCHEMA_VERSION) {
        throw new Error(`Expected F3A3 evidence schema ${F3A3_EVIDENCE_SCHEMA_VERSION}`);
    }
    if (!Array.isArray(document.stages) || document.stages.length === 0) {
        throw new Error('Evidence must contain at least one stage');
    }

    const names = new Set();
    for (const stage of document.stages) {
        if (!stage || typeof stage.name !== 'string' || stage.name.trim() === '') {
            throw new Error('Every evidence stage requires a name');
        }
        if (names.has(stage.name)) {
            throw new Error(`Duplicate evidence stage: ${stage.name}`);
        }
        names.add(stage.name);

        if (!READINESS_STATES.has(stage.readiness)) {
            throw new Error(`Invalid readiness for stage ${stage.name}`);
        }
        if (!Number.isFinite(stage.elapsedMs) || stage.elapsedMs < 0) {
            throw new Error(`Invalid elapsed time for stage ${stage.name}`);
        }
    }

    const topology = document.topology || {};
    if (topology.pageCount !== 1) {
        throw new Error('Evidence must fail closed unless exactly one page is owned');
    }
    if (topology.externallyOwnedBrowser && topology.browserCloseCount !== 0) {
        throw new Error('An externally owned browser must not be closed by the harness');
    }

    const baseline = document.instrumentation?.baseline || {};
    const final = document.instrumentation?.final || {};
    for (const counter of OWNERSHIP_COUNTERS) {
        if (!Number.isFinite(baseline[counter]) || !Number.isFinite(final[counter])) {
            throw new Error(`Missing instrumentation counter: ${counter}`);
        }
        if (final[counter] > baseline[counter]) {
            throw new Error(`Instrumentation counter grew: ${counter}`);
        }
    }

    return {
        schemaVersion: document.schemaVersion,
        stageCount: document.stages.length,
        terminalStageCount: document.stages.filter(stage => stage.readiness !== 'pending').length
    };
}

if (require.main === module) {
    const evidencePath = process.argv[2];
    if (!evidencePath) {
        throw new Error('Usage: node ptv-f3a3-harness-contract.cjs <evidence.json>');
    }

    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    const summary = validateEvidenceDocument(evidence);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
}

module.exports = {
    F3A3_EVIDENCE_SCHEMA_VERSION,
    assertEvidencePrivacy,
    assertSinglePage,
    classifyReadiness,
    createBrowserOwnershipLease,
    createGenerationGate,
    createMonotonicClock,
    createObserverDisposer,
    createStageLedger,
    validateEvidenceDocument,
    waitForResponseBodyCompletion
};
