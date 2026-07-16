export type PtvUpdateState =
    | 'applying'
    | 'available'
    | 'deferred'
    | 'dismissed'
    | 'error'
    | 'idle';

export type PtvUpdateSnapshot = {
    activityReason: string;
    error: string;
    state: PtvUpdateState;
};

type PtvWorkerLike = {
    addEventListener?: (type: string, listener: () => void) => void;
    postMessage?: (message: unknown) => void;
    state?: string;
};

type PtvRegistrationLike = {
    addEventListener?: (type: string, listener: () => void) => void;
    installing?: PtvWorkerLike | null;
    update?: () => Promise<unknown>;
    waiting?: PtvWorkerLike | null;
};

type PtvServiceWorkerContainerLike = {
    addEventListener?: (type: string, listener: () => void) => void;
    controller?: unknown;
    getRegistration: () => Promise<PtvRegistrationLike | undefined>;
};

type PtvUpdateServiceOptions = {
    getActivityReason?: () => string;
    reload?: () => void;
    serviceWorker?: PtvServiceWorkerContainerLike;
    sessionStorage?: Pick<Storage, 'getItem' | 'setItem'>;
};

type PtvUpdateListener = (snapshot: PtvUpdateSnapshot) => void;

const DISMISSED_SESSION_KEY = 'ptv:update:dismissed';
const RELOAD_SESSION_KEY = 'ptv:update:reloading';

export function getPtvServiceWorkerScriptUrl() {
    return 'serviceworker.js';
}

function getUpdateError(error: unknown) {
    return error instanceof Error ? error.message : String(error || 'Unknown service-worker error.');
}

export function getPtvUnsafeUpdateActivityReason() {
    const runtimePlaybackState = (window as Window & {
        PTV?: {
            playbackState?: {
                getState?: () => { active?: boolean };
            };
        };
    }).PTV?.playbackState?.getState?.();

    if (runtimePlaybackState?.active || document.documentElement.hasAttribute('data-ptv-now-playing')) {
        return 'Playback is active.';
    }
    if (document.querySelector('.ptv-reader')) return 'Reading is active.';
    if (document.querySelector('[data-identify-apply-loading="true"], [data-ptv-metadata-applying="true"]')) {
        return 'Metadata is being applied.';
    }
    if (document.documentElement.dataset.ptvDashboardUnsaved === 'true') return 'Dashboard changes have not been saved.';

    return '';
}

export class PtvUpdateService {
    private readonly getActivityReason: () => string;
    private readonly listeners = new Set<PtvUpdateListener>();
    private readonly reload: () => void;
    private readonly serviceWorker?: PtvServiceWorkerContainerLike;
    private readonly sessionStorage?: Pick<Storage, 'getItem' | 'setItem'>;
    private registration?: PtvRegistrationLike;
    private started = false;
    private waitingWorker?: PtvWorkerLike;
    private snapshot: PtvUpdateSnapshot = {
        activityReason: '',
        error: '',
        state: 'idle'
    };

    constructor(options: PtvUpdateServiceOptions = {}) {
        this.getActivityReason = options.getActivityReason || getPtvUnsafeUpdateActivityReason;
        this.reload = options.reload || (() => window.location.reload());
        // The optional API is guarded by runtime presence and unavailable clients keep the current bundle.
        // eslint-disable-next-line compat/compat
        this.serviceWorker = options.serviceWorker || navigator.serviceWorker;
        this.sessionStorage = options.sessionStorage || window.sessionStorage;
    }

    getSnapshot() {
        return this.snapshot;
    }

    subscribe(listener: PtvUpdateListener) {
        this.listeners.add(listener);
        listener(this.snapshot);
        return () => this.listeners.delete(listener);
    }

    async start() {
        if (this.started || !this.serviceWorker) return;
        this.started = true;

        this.serviceWorker.addEventListener?.('controllerchange', () => this.handleControllerChange());

        try {
            this.registration = await this.serviceWorker.getRegistration();
            if (!this.registration) return;

            this.registration.addEventListener?.('updatefound', () => this.watchInstallingWorker());
            this.watchWaitingWorker();
            this.watchInstallingWorker();

            try {
                await this.registration.update?.();
            } catch {
                // Browser update checks retry naturally; keep the current application usable.
            }
        } catch (error) {
            this.setSnapshot({
                activityReason: '',
                error: getUpdateError(error),
                state: 'error'
            });
        }
    }

    dismiss() {
        this.writeSessionValue(DISMISSED_SESSION_KEY, 'true');
        this.setSnapshot({ activityReason: '', error: '', state: 'dismissed' });
    }

    applyWhenSafe() {
        if (!this.waitingWorker) return false;

        const activityReason = this.getActivityReason();
        if (activityReason) {
            this.setSnapshot({ activityReason, error: '', state: 'deferred' });
            return false;
        }

        this.setSnapshot({ activityReason: '', error: '', state: 'applying' });
        this.waitingWorker.postMessage?.({ type: 'SKIP_WAITING' });
        return true;
    }

    retryDeferredUpdate() {
        if (this.snapshot.state !== 'deferred') return false;
        return this.applyWhenSafe();
    }

    private watchWaitingWorker() {
        if (!this.registration?.waiting) return;
        this.markUpdateAvailable(this.registration.waiting);
    }

    private watchInstallingWorker() {
        const installingWorker = this.registration?.installing;
        if (!installingWorker) return;

        const handleStateChange = () => {
            if (installingWorker.state !== 'installed') return;
            this.markUpdateAvailable(this.registration?.waiting || installingWorker);
        };

        installingWorker.addEventListener?.('statechange', handleStateChange);
        handleStateChange();
    }

    private markUpdateAvailable(worker?: PtvWorkerLike | null) {
        if (!worker) return;
        this.waitingWorker = worker;

        if (this.readSessionValue(DISMISSED_SESSION_KEY) === 'true') {
            this.setSnapshot({ activityReason: '', error: '', state: 'dismissed' });
            return;
        }

        this.setSnapshot({ activityReason: '', error: '', state: 'available' });
    }

    private handleControllerChange() {
        if (this.snapshot.state !== 'applying') return;
        if (this.readSessionValue(RELOAD_SESSION_KEY) === 'true') return;

        this.writeSessionValue(RELOAD_SESSION_KEY, 'true');
        this.reload();
    }

    private readSessionValue(key: string) {
        try {
            return this.sessionStorage?.getItem(key) || '';
        } catch {
            return '';
        }
    }

    private writeSessionValue(key: string, value: string) {
        try {
            this.sessionStorage?.setItem(key, value);
        } catch {
            // Session storage is an optimization, not a requirement.
        }
    }

    private setSnapshot(snapshot: PtvUpdateSnapshot) {
        this.snapshot = snapshot;
        this.listeners.forEach(listener => {
            listener(snapshot);
        });
    }
}

let updateService: PtvUpdateService | null = null;

export function getPtvUpdateService() {
    updateService ||= new PtvUpdateService();
    return updateService;
}

export function resetPtvUpdateServiceForTests() {
    updateService = null;
}
