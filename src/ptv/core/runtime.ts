import { dispatchPtvCustomEvent } from './events';

type PtvRuntimeFeatureDisposer = () => void;

type PtvRuntimeFeatureRecord = {
    disposer: PtvRuntimeFeatureDisposer;
    featureId: string;
    registeredAt: number;
};

type PtvRuntimeListenerRecord = {
    disposer: PtvRuntimeFeatureDisposer;
    key: string;
    registeredAt: number;
};

export type PtvRuntimeDiagnostics = {
    duplicateFeatureRegistrationSuppressedCount: number;
    duplicateListenerSuppressedCount: number;
    featureRegistrationCount: Record<string, number>;
    initializationCallSites: string[];
    listenerRegistrationCount: number;
    listenerRegistrationCountByKey: Record<string, number>;
    ready: boolean;
    runtimeCreateCount: number;
    runtimeGetCount: number;
    runtimeOwner: string;
    runtimeReadyAwaitCount: number;
};

export type PtvRuntime = {
    createdAt: number;
    owner: string;
    ready: Promise<PtvRuntime>;
};

type PtvRuntimeState = {
    duplicateFeatureRegistrationSuppressedCount: number;
    duplicateListenerSuppressedCount: number;
    featureRegistrationCount: Record<string, number>;
    features: Map<string, PtvRuntimeFeatureRecord>;
    initializationCallSites: string[];
    listenerRegistrationCount: number;
    listenerRegistrationCountByKey: Record<string, number>;
    listeners: Map<string, PtvRuntimeListenerRecord>;
    ready: boolean;
    readyPromise: Promise<PtvRuntime>;
    readyResolve: (runtime: PtvRuntime) => void;
    runtime: PtvRuntime | null;
    runtimeCreateCount: number;
    runtimeGetCount: number;
    runtimeOwner: string;
    runtimeReadyAwaitCount: number;
};

type PtvRuntimeWindow = Window & {
    PTV?: Record<string, unknown> & {
        runtime?: Record<string, unknown>;
    };
    __PTV_RUNTIME_STATE__?: PtvRuntimeState;
};

const runtimeWindow = window as PtvRuntimeWindow;
const dispatchRuntimeEvent = dispatchPtvCustomEvent as (eventName: string, detail?: unknown) => void;

function noop() {
    return undefined;
}

function createReadyState(): Pick<PtvRuntimeState, 'readyPromise' | 'readyResolve'> {
    let readyResolve: (runtime: PtvRuntime) => void = noop;
    const readyPromise = new Promise<PtvRuntime>(resolve => {
        readyResolve = resolve;
    });

    return {
        readyPromise,
        readyResolve
    };
}

function getRuntimeState(): PtvRuntimeState {
    if (runtimeWindow.__PTV_RUNTIME_STATE__) return runtimeWindow.__PTV_RUNTIME_STATE__;

    const readyState = createReadyState();
    const state: PtvRuntimeState = {
        duplicateFeatureRegistrationSuppressedCount: 0,
        duplicateListenerSuppressedCount: 0,
        featureRegistrationCount: {},
        features: new Map(),
        initializationCallSites: [],
        listenerRegistrationCount: 0,
        listenerRegistrationCountByKey: {},
        listeners: new Map(),
        ready: false,
        readyPromise: readyState.readyPromise,
        readyResolve: readyState.readyResolve,
        runtime: null,
        runtimeCreateCount: 0,
        runtimeGetCount: 0,
        runtimeOwner: '',
        runtimeReadyAwaitCount: 0
    };

    runtimeWindow.__PTV_RUNTIME_STATE__ = state;

    return state;
}

function publishRuntimeApi() {
    const state = getRuntimeState();
    const root = runtimeWindow.PTV || (runtimeWindow.PTV = {});
    const existingRuntime = root.runtime && typeof root.runtime === 'object' ?
        root.runtime as Record<string, unknown> :
        {};

    root.runtime = {
        ...existingRuntime,
        awaitReady: awaitPtvRuntimeReady,
        get: getPtvRuntime,
        registerFeature: registerPtvRuntimeFeature,
        registerListener: registerPtvRuntimeListener,
        report: getPtvRuntimeDiagnostics,
        ready: state.readyPromise
    };
}

function warnDuplicateRuntimeCreation(owner: string) {
    if (!/^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(window.location.hostname || '')) return;

    console.warn('[PiggieTV Runtime] Duplicate runtime creation attempt suppressed.', {
        owner,
        runtimeOwner: getRuntimeState().runtimeOwner
    });
}

export function createPtvRuntime(owner = 'ptv-app') {
    const state = getRuntimeState();

    state.initializationCallSites.push(owner);

    if (state.runtime) {
        warnDuplicateRuntimeCreation(owner);
        publishRuntimeApi();
        return state.runtime;
    }

    state.runtimeCreateCount += 1;
    state.runtimeOwner = owner;
    state.runtime = {
        createdAt: Date.now(),
        owner,
        ready: state.readyPromise
    };

    publishRuntimeApi();
    dispatchRuntimeEvent('ptv:runtimecreated', getPtvRuntimeDiagnostics());

    return state.runtime;
}

export function getPtvRuntime() {
    const state = getRuntimeState();

    state.runtimeGetCount += 1;
    publishRuntimeApi();

    return state.runtime;
}

export function awaitPtvRuntimeReady() {
    const state = getRuntimeState();

    state.runtimeReadyAwaitCount += 1;
    publishRuntimeApi();

    return state.readyPromise;
}

export function markPtvRuntimeReady() {
    const state = getRuntimeState();
    const runtime = state.runtime || createPtvRuntime('runtime-ready');

    if (state.ready) return runtime;

    state.ready = true;
    state.readyResolve(runtime);
    dispatchRuntimeEvent('ptv:runtimeready', getPtvRuntimeDiagnostics());

    return runtime;
}

export function registerPtvRuntimeFeature(featureId: string, attach: () => PtvRuntimeFeatureDisposer | void) {
    const state = getRuntimeState();

    if (state.features.has(featureId)) {
        state.duplicateFeatureRegistrationSuppressedCount += 1;
        dispatchRuntimeEvent('ptv:runtimefeatureduplicate', {
            featureId,
            ...getPtvRuntimeDiagnostics()
        });
        return state.features.get(featureId)?.disposer || noop;
    }

    const disposer = attach() || noop;

    state.featureRegistrationCount[featureId] = (state.featureRegistrationCount[featureId] || 0) + 1;
    state.features.set(featureId, {
        disposer,
        featureId,
        registeredAt: Date.now()
    });
    dispatchRuntimeEvent('ptv:runtimefeatureregistered', {
        featureId,
        ...getPtvRuntimeDiagnostics()
    });
    publishRuntimeApi();

    return disposer;
}

export function registerPtvRuntimeListener(key: string, attach: () => PtvRuntimeFeatureDisposer | void) {
    const state = getRuntimeState();

    if (state.listeners.has(key)) {
        state.duplicateListenerSuppressedCount += 1;
        dispatchRuntimeEvent('ptv:runtimelistenerduplicate', {
            key,
            ...getPtvRuntimeDiagnostics()
        });
        return state.listeners.get(key)?.disposer || noop;
    }

    const disposer = attach() || noop;

    state.listenerRegistrationCount += 1;
    state.listenerRegistrationCountByKey[key] = (state.listenerRegistrationCountByKey[key] || 0) + 1;
    state.listeners.set(key, {
        disposer,
        key,
        registeredAt: Date.now()
    });
    dispatchRuntimeEvent('ptv:runtimelistenerregistered', {
        key,
        ...getPtvRuntimeDiagnostics()
    });
    publishRuntimeApi();

    return disposer;
}

export function getPtvRuntimeDiagnostics(): PtvRuntimeDiagnostics {
    const state = getRuntimeState();

    return {
        duplicateFeatureRegistrationSuppressedCount: state.duplicateFeatureRegistrationSuppressedCount,
        duplicateListenerSuppressedCount: state.duplicateListenerSuppressedCount,
        featureRegistrationCount: { ...state.featureRegistrationCount },
        initializationCallSites: [...state.initializationCallSites],
        listenerRegistrationCount: state.listenerRegistrationCount,
        listenerRegistrationCountByKey: { ...state.listenerRegistrationCountByKey },
        ready: state.ready,
        runtimeCreateCount: state.runtimeCreateCount,
        runtimeGetCount: state.runtimeGetCount,
        runtimeOwner: state.runtimeOwner,
        runtimeReadyAwaitCount: state.runtimeReadyAwaitCount
    };
}

export function resetPtvRuntimeForTests() {
    const state = getRuntimeState();

    state.features.forEach(feature => feature.disposer());
    state.listeners.forEach(listener => listener.disposer());
    delete runtimeWindow.__PTV_RUNTIME_STATE__;
    publishRuntimeApi();
}

publishRuntimeApi();
