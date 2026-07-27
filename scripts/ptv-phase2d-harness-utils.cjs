const FORBIDDEN_ARTIFACT_KEYS = new Set([
    'account',
    'body',
    'cookie',
    'cookies',
    'hash',
    'headers',
    'href',
    'id',
    'itemid',
    'query',
    'responsebody',
    'serverid',
    'title',
    'token',
    'url',
    'userid'
]);

class Phase2dStageError extends Error {
    constructor(code, options = {}) {
        super(code);
        this.name = 'Phase2dStageError';
        this.code = code;
        this.failedStage = options.failedStage || null;
        this.safeCauseCategory = options.safeCauseCategory || 'stage-assertion';
        this.stages = Array.isArray(options.stages) ? options.stages : [];
    }
}

function roundDuration(value) {
    return Math.max(0, Math.round(value * 10) / 10);
}

function classifySafeHarnessError(error) {
    if (error instanceof Phase2dStageError) return error.code;

    const message = error instanceof Error ? error.message : String(error || '');
    if (/strict mode violation|resolved to \d+ elements/i.test(message)) return 'selector-failure';
    if (/detached|not attached to the dom/i.test(message)) return 'detached-node';
    if (/execution context|target.*closed|browser.*closed/i.test(message)) return 'browser-context-issue';
    if (/app.?router/i.test(message)) return 'app-router-observation-failure';
    if (/instrument/i.test(message)) return 'event-instrumentation-failure';
    if (/unsupported.*type/i.test(message)) return 'unsupported-result-type';
    if (/timeout/i.test(message) || error?.name === 'TimeoutError') return 'timeout';
    if (/route/i.test(message)) return 'route-mismatch';
    if (/^[a-z0-9][a-z0-9-]{1,100}$/i.test(message)) return message.toLowerCase();

    return 'page-evaluation-exception';
}

function createStageRecorder() {
    const stages = [];

    async function requireStage(name, failureCode, action, isPassed = value => value !== false) {
        const startedAt = performance.now();

        try {
            const outcome = await action();
            const evidence = outcome && typeof outcome === 'object' && 'evidence' in outcome ?
                outcome.evidence :
                {};
            const value = outcome && typeof outcome === 'object' && 'value' in outcome ?
                outcome.value :
                outcome;
            const passed = Boolean(isPassed(value));
            stages.push({
                durationMs: roundDuration(performance.now() - startedAt),
                name,
                passed,
                ...evidence
            });
            if (!passed) {
                throw new Phase2dStageError(failureCode, {
                    failedStage: name,
                    safeCauseCategory: 'stage-assertion',
                    stages: [ ...stages ]
                });
            }

            return value;
        } catch (error) {
            if (error instanceof Phase2dStageError) throw error;

            stages.push({
                durationMs: roundDuration(performance.now() - startedAt),
                errorCategory: classifySafeHarnessError(error),
                name,
                passed: false
            });
            throw new Phase2dStageError(failureCode, {
                failedStage: name,
                safeCauseCategory: classifySafeHarnessError(error),
                stages: [ ...stages ]
            });
        }
    }

    return {
        requireStage,
        snapshot: () => stages.map(stage => ({ ...stage }))
    };
}

function classifyMissingItemOutcome(value) {
    if (value?.transportStatus === 404 && value?.clientRejected === true) {
        return 'transport-404-client-rejection';
    }
    if (value?.transportStatus === 200 && value?.resolvedMediaType === 'UserRootFolder') {
        return 'user-root-sentinel';
    }
    if (value?.transportStatus === 200 && value?.coreErrorCode === 'API_ITEM_DETAILS_ID_INVALID') {
        return 'transport-200-core-parsing-failure';
    }
    if (value?.transportStatus === 200 && value?.clientRejected === false) {
        return 'transport-200-resolved-item';
    }

    return 'unclassified-item-result';
}

function findForbiddenArtifactPath(value, path = '$') {
    if (!value || typeof value !== 'object') return null;

    for (const [ key, child ] of Object.entries(value)) {
        if (FORBIDDEN_ARTIFACT_KEYS.has(key.toLowerCase())) return `${path}.${key}`;
        const nested = findForbiddenArtifactPath(child, `${path}.${key}`);
        if (nested) return nested;
    }

    return null;
}

// This function is intentionally closure-free so Playwright can serialize it
// directly into the attached browser page.
function installPhase2dInstrumentation() {
    const current = window.__PTV_PHASE2D_VALIDATION__;
    current?.restore?.(true);

    const router = window.Emby?.Page;
    if (!router || typeof router.show !== 'function') return false;

    const hadOwnShow = Object.prototype.hasOwnProperty.call(router, 'show');
    const ownShow = router.show;
    const originalShow = router.show;
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    const debug = window.PTV?.debug;
    const debugStateKey = 'ptv:phase2d:debug-was-enabled';
    let debugInitiallyEnabled;
    try {
        const storedState = window.sessionStorage.getItem(debugStateKey);
        if (storedState === null) {
            debugInitiallyEnabled = Boolean(debug?.report?.().active);
            window.sessionStorage.setItem(debugStateKey, debugInitiallyEnabled ? '1' : '0');
        } else {
            debugInitiallyEnabled = storedState === '1';
        }
    } catch {
        debugInitiallyEnabled = Boolean(debug?.report?.().active);
    }

    const getRouteCategory = () => {
        const route = `${window.location.pathname}${window.location.hash}`.toLowerCase();
        if (route.includes('/details?')) return 'details';
        if (route.includes('/search')) return 'search';
        if (route.includes('/home')) return 'home';
        if (route.includes('/music')) return 'music';
        if (route.includes('/reading') || route.includes('/books') || route.includes('/comics')) {
            return 'reading';
        }
        return 'other';
    };
    const state = {
        appRouterTransitions: 0,
        debugInitiallyEnabled,
        hashTransitions: 0,
        historyTransitions: 0,
        primaryActivations: 0,
        primaryActivationsPrevented: 0,
        popStateTransitions: 0,
        routeCategoryTransitions: 0
    };
    const recordHistoryTransition = (original, thisValue, args) => {
        const before = getRouteCategory();
        const result = original.apply(thisValue, args);
        state.historyTransitions += 1;
        if (getRouteCategory() !== before) state.routeCategoryTransitions += 1;
        return result;
    };
    const wrappedShow = function (...args) {
        state.appRouterTransitions += 1;
        return originalShow.apply(this, args);
    };
    const wrappedPushState = function (...args) {
        return recordHistoryTransition(originalPushState, this, args);
    };
    const wrappedReplaceState = function (...args) {
        return recordHistoryTransition(originalReplaceState, this, args);
    };
    const onHashChange = () => {
        state.hashTransitions += 1;
    };
    const onPopState = () => {
        state.popStateTransitions += 1;
        state.routeCategoryTransitions += 1;
    };
    const onPrimaryActivationCapture = event => {
        const activationTarget = event.target?.closest?.(
            'a.ptv-native-card-media-link,a.ptv-search-card'
        );
        if (!activationTarget || event.button !== 0) return;

        state.primaryActivations += 1;
        window.setTimeout(() => {
            if (event.defaultPrevented) state.primaryActivationsPrevented += 1;
        }, 0);
    };

    router.show = wrappedShow;
    window.history.pushState = wrappedPushState;
    window.history.replaceState = wrappedReplaceState;
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onPopState);
    window.document.addEventListener('click', onPrimaryActivationCapture, true);
    if (debug) {
        debug.enable();
        debug.clear();
    }

    window.__PTV_PHASE2D_VALIDATION__ = {
        getCounts() {
            const events = debug?.report?.().events || [];
            const countEvent = name => events.filter(event => event?.name === name).length;

            return {
                appRouterTransitions: state.appRouterTransitions,
                coreApiDiagnostics: countEvent('ptv-core-item-details-request')
                    + countEvent('ptv-core-series-seasons-request')
                    + countEvent('ptv-core-season-episodes-request'),
                coreEpisodeDiagnostics: countEvent('ptv-core-season-episodes-request'),
                coreItemDiagnostics: countEvent('ptv-core-item-details-request'),
                coreNavigationDiagnostics: countEvent('ptv-core-details-navigation'),
                coreSeasonDiagnostics: countEvent('ptv-core-series-seasons-request'),
                diagnosticsAvailable: Boolean(debug?.shouldCollect?.()),
                hashTransitions: state.hashTransitions,
                historyTransitions: state.historyTransitions,
                primaryActivations: state.primaryActivations,
                primaryActivationsPrevented: state.primaryActivationsPrevented,
                popStateTransitions: state.popStateTransitions,
                routeCategoryTransitions: state.routeCategoryTransitions
            };
        },
        reset() {
            state.appRouterTransitions = 0;
            state.hashTransitions = 0;
            state.historyTransitions = 0;
            state.primaryActivations = 0;
            state.primaryActivationsPrevented = 0;
            state.popStateTransitions = 0;
            state.routeCategoryTransitions = 0;
            debug?.clear?.();
        },
        restore(keepSessionMarker = false) {
            window.removeEventListener('hashchange', onHashChange);
            window.removeEventListener('popstate', onPopState);
            window.document.removeEventListener('click', onPrimaryActivationCapture, true);
            if (router.show === wrappedShow) {
                if (hadOwnShow) router.show = ownShow;
                else delete router.show;
            }
            if (window.history.pushState === wrappedPushState) {
                window.history.pushState = originalPushState;
            }
            if (window.history.replaceState === wrappedReplaceState) {
                window.history.replaceState = originalReplaceState;
            }
            if (debug && !debugInitiallyEnabled) debug.disable();
            if (!keepSessionMarker) {
                try {
                    window.sessionStorage.removeItem(debugStateKey);
                } catch {
                    // Session storage can be unavailable in restricted browser contexts.
                }
            }
            delete window.__PTV_PHASE2D_VALIDATION__;
        }
    };

    return true;
}

module.exports = {
    Phase2dStageError,
    classifyMissingItemOutcome,
    classifySafeHarnessError,
    createStageRecorder,
    findForbiddenArtifactPath,
    installPhase2dInstrumentation
};
