type PtvWebAppBootstrapState = {
    initializationCount: number;
    promise: Promise<void> | null;
    reuseCount: number;
    started: boolean;
};

type PtvWebAppBootstrapWindow = Window & Partial<
    Record<'__PTV_WEB_APP_BOOTSTRAP__', PtvWebAppBootstrapState>
>;

function getState() {
    const runtimeWindow = window as PtvWebAppBootstrapWindow;

    runtimeWindow.__PTV_WEB_APP_BOOTSTRAP__ ||= {
        initializationCount: 0,
        promise: null,
        reuseCount: 0,
        started: false
    };

    return runtimeWindow.__PTV_WEB_APP_BOOTSTRAP__;
}

export function initializePtvWebAppOnce(initialize: () => Promise<void>) {
    const state = getState();

    if (state.promise) {
        state.reuseCount += 1;
        return state.promise;
    }

    state.initializationCount += 1;
    const initialization = Promise.resolve()
        .then(initialize)
        .then(() => {
            state.started = true;
        });

    state.promise = initialization;
    void initialization.catch(() => {
        if (state.promise === initialization) state.promise = null;
    });

    return initialization;
}

export function getPtvWebAppBootstrapSnapshot() {
    const state = getState();

    return {
        initializationCount: state.initializationCount,
        reuseCount: state.reuseCount,
        started: state.started
    };
}

export function resetPtvWebAppBootstrapForTests() {
    delete (window as PtvWebAppBootstrapWindow).__PTV_WEB_APP_BOOTSTRAP__;
}
