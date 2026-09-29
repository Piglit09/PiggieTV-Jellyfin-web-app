import {
    getPtvCompiledUpdateGeneration,
    getPtvUpdateGenerationKey,
    isLaterPtvUpdateGeneration,
    PTV_UPDATE_GENERATION_REQUEST,
    PTV_UPDATE_GENERATION_RESPONSE,
    readPtvUpdateGeneration,
    type PtvUpdateGeneration
} from './updateGeneration';

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
    postMessage?: (message: unknown, ports: Transferable[]) => void;
    scriptURL?: string;
    state?: string;
};

type PtvRegistrationLike = {
    active?: PtvWorkerLike | null;
    addEventListener?: (type: string, listener: () => void) => void;
    installing?: PtvWorkerLike | null;
    update?: () => Promise<unknown>;
    waiting?: PtvWorkerLike | null;
};

type PtvServiceWorkerContainerLike = {
    addEventListener?: (type: string, listener: () => void) => void;
    controller?: PtvWorkerLike | null;
    getRegistration: () => Promise<PtvRegistrationLike | undefined>;
};

type PtvUpdateServiceOptions = {
    activationTimeoutMs?: number;
    getActivityReason?: () => string;
    reload?: () => void;
    serviceWorker?: PtvServiceWorkerContainerLike;
    sessionStorage?: Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;
};

type PtvUpdateListener = (snapshot: PtvUpdateSnapshot) => void;
type PtvUpdateCandidate = {
    generation: PtvUpdateGeneration;
    key: string;
    worker: PtvWorkerLike;
};

const DISMISSED_SESSION_KEY = 'ptv:update:dismissed';
const RELOAD_SESSION_KEY = 'ptv:update:reloading';
const DEFAULT_ACTIVATION_TIMEOUT_MS = 3000;
const IDENTITY_TIMEOUT_MS = 1000;

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
    private readonly activationTimeoutMs: number;
    private readonly getActivityReason: () => string;
    private readonly listeners = new Set<PtvUpdateListener>();
    private readonly reload: () => void;
    private readonly runningGeneration = getPtvCompiledUpdateGeneration();
    private readonly serviceWorker?: PtvServiceWorkerContainerLike;
    private readonly sessionStorage?: Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;
    private readonly watchedWorkers = new WeakSet<PtvWorkerLike>();
    private activationFallbackTimer: number | null = null;
    private activationGeneration = '';
    private applyInProgress = false;
    private candidate?: PtvUpdateCandidate;
    private observation = 0;
    private registration?: PtvRegistrationLike;
    private reloadedGeneration = '';
    private started = false;
    private snapshot: PtvUpdateSnapshot = {
        activityReason: '',
        error: '',
        state: 'idle'
    };

    constructor(options: PtvUpdateServiceOptions = {}) {
        this.activationTimeoutMs = options.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS;
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
        if (this.runningGeneration) {
            const runningKey = getPtvUpdateGenerationKey(this.runningGeneration);
            if (this.readSessionValue(RELOAD_SESSION_KEY) === runningKey) this.clearSessionValue(RELOAD_SESSION_KEY);
            if (this.readSessionValue(DISMISSED_SESSION_KEY) === runningKey) this.clearSessionValue(DISMISSED_SESSION_KEY);
        }
        this.serviceWorker.addEventListener?.('controllerchange', () => {
            void this.handleControllerChange();
        });

        const observation = ++this.observation;
        let registration: PtvRegistrationLike | undefined;
        try {
            registration = await this.serviceWorker.getRegistration();
        } catch (error) {
            if (observation !== this.observation) return;
            this.setSnapshot({ activityReason: '', error: getUpdateError(error), state: 'error' });
            return;
        }
        if (observation !== this.observation) return;
        this.observeRegistration(registration);
        if (!this.registration) return;
        await this.reconcileWorkers();
        try {
            await this.registration.update?.();
        } catch {
            // Browser update checks retry naturally; keep the current application usable.
        }
    }

    dismiss() {
        if (!this.candidate) return;
        this.writeSessionValue(DISMISSED_SESSION_KEY, this.candidate.key);
        this.retireActivation();
        this.setSnapshot({ activityReason: '', error: '', state: 'dismissed' });
    }

    applyWhenSafe() {
        const candidate = this.candidate;
        if (!candidate || this.applyInProgress || this.snapshot.state === 'applying') return false;
        if (this.getRegistrationWorker() !== candidate.worker) {
            void this.reconcileWorkers();
            return false;
        }
        if (this.hasReloaded(candidate.key)) return false;

        const activityReason = this.getActivityReason();
        if (activityReason) {
            this.setSnapshot({ activityReason, error: '', state: 'deferred' });
            return false;
        }

        this.applyInProgress = true;
        this.activationGeneration = candidate.key;
        this.setSnapshot({ activityReason: '', error: '', state: 'applying' });
        const pending = this.registration?.waiting === candidate.worker
            || this.registration?.installing === candidate.worker && candidate.worker.state === 'installed';
        if (!pending || typeof candidate.worker.postMessage !== 'function') {
            this.triggerReloadOnce(candidate.key);
            return true;
        }

        try {
            candidate.worker.postMessage({ type: 'SKIP_WAITING' }, []);
            this.scheduleActivationFallback(candidate.key);
        } catch {
            this.triggerReloadOnce(candidate.key);
        }
        return true;
    }

    retryDeferredUpdate() {
        if (this.snapshot.state !== 'deferred') return false;
        return this.applyWhenSafe();
    }

    private observeRegistration(registration?: PtvRegistrationLike) {
        if (!registration || registration === this.registration) return;
        this.registration = registration;
        registration.addEventListener?.('updatefound', () => {
            void this.reconcileWorkers();
        });
    }

    private getRegistrationWorker() {
        const registration = this.registration;
        if (registration?.waiting && registration.waiting.state !== 'redundant') return registration.waiting;
        if (registration?.installing?.state === 'installed') return registration.installing;
        if (registration?.active && registration.active.state !== 'redundant') return registration.active;
        return undefined;
    }

    private watchWorker(worker?: PtvWorkerLike | null) {
        if (!worker || this.watchedWorkers.has(worker)) return;
        this.watchedWorkers.add(worker);
        worker.addEventListener?.('statechange', () => {
            void this.reconcileWorkers();
        });
    }

    private async reconcileWorkers() {
        const observation = ++this.observation;
        this.watchWorker(this.registration?.installing);
        this.watchWorker(this.registration?.waiting);
        this.watchWorker(this.registration?.active);
        const worker = this.getRegistrationWorker();
        if (!worker) {
            this.clearCandidate();
            return;
        }
        if (this.candidate && this.candidate.worker !== worker) this.clearCandidate();

        const generation = await this.readWorkerGeneration(worker);
        if (observation !== this.observation || worker !== this.getRegistrationWorker()) return;
        if (!generation || !this.runningGeneration || !isLaterPtvUpdateGeneration(generation, this.runningGeneration)) {
            this.clearCandidate();
            return;
        }

        const key = getPtvUpdateGenerationKey(generation);
        if (this.hasReloaded(key)) {
            this.clearCandidate();
            return;
        }
        if (this.candidate?.key === key) {
            this.candidate = { generation, key, worker };
            return;
        }

        this.retireActivation();
        this.candidate = { generation, key, worker };
        const state = this.readSessionValue(DISMISSED_SESSION_KEY) === key ? 'dismissed' : 'available';
        this.setSnapshot({ activityReason: '', error: '', state });
    }

    private readWorkerGeneration(worker: PtvWorkerLike): Promise<PtvUpdateGeneration | null> {
        if (typeof worker.postMessage !== 'function' || typeof MessageChannel === 'undefined') return Promise.resolve(null);
        try {
            // This path requires a native service worker; pre-URL browsers cannot enter it.
            // eslint-disable-next-line compat/compat
            const expected = new URL(getPtvServiceWorkerScriptUrl(), window.location.href);
            // eslint-disable-next-line compat/compat
            const actual = new URL(worker.scriptURL || '');
            if (actual.origin !== expected.origin || actual.pathname !== expected.pathname) return Promise.resolve(null);
        } catch {
            return Promise.resolve(null);
        }

        return new Promise(resolve => {
            let channel: MessageChannel;
            try {
                channel = new MessageChannel();
            } catch {
                resolve(null);
                return;
            }
            let finished = false;
            const finish = (generation: PtvUpdateGeneration | null) => {
                if (finished) return;
                finished = true;
                window.clearTimeout(timer);
                channel.port1.onmessage = null;
                channel.port1.close();
                channel.port2.close();
                resolve(generation);
            };
            const timer = window.setTimeout(() => finish(null), IDENTITY_TIMEOUT_MS);
            channel.port1.onmessage = event => {
                const response = event.data as { generation?: unknown; type?: unknown } | null;
                finish(response?.type === PTV_UPDATE_GENERATION_RESPONSE ? readPtvUpdateGeneration(response.generation) : null);
            };
            try {
                worker.postMessage?.({ type: PTV_UPDATE_GENERATION_REQUEST }, [ channel.port2 ]);
            } catch {
                finish(null);
            }
        });
    }

    private async handleControllerChange() {
        const observation = ++this.observation;
        const applyingGeneration = this.activationGeneration;
        let registration: PtvRegistrationLike | undefined;
        try {
            registration = await this.serviceWorker?.getRegistration();
        } catch {
            if (observation !== this.observation) return;
            this.clearCandidate();
            return;
        }
        if (observation !== this.observation) return;
        this.observeRegistration(registration);
        const reconciliation = this.reconcileWorkers();
        const reconciliationObservation = this.observation;
        await reconciliation;
        if (reconciliationObservation !== this.observation) return;
        if (applyingGeneration && this.applyInProgress && this.activationGeneration === applyingGeneration
            && this.candidate?.key === applyingGeneration && this.serviceWorker?.controller === this.candidate.worker) {
            this.triggerReloadOnce(applyingGeneration);
        }
    }

    private scheduleActivationFallback(generation: string) {
        this.clearActivationFallback();
        this.activationFallbackTimer = window.setTimeout(() => {
            this.activationFallbackTimer = null;
            this.triggerReloadOnce(generation);
        }, this.activationTimeoutMs);
    }

    private clearActivationFallback() {
        if (this.activationFallbackTimer === null) return;
        window.clearTimeout(this.activationFallbackTimer);
        this.activationFallbackTimer = null;
    }

    private retireActivation() {
        this.clearActivationFallback();
        this.applyInProgress = false;
        this.activationGeneration = '';
    }

    private clearCandidate() {
        this.retireActivation();
        this.candidate = undefined;
        this.setSnapshot({ activityReason: '', error: '', state: 'idle' });
    }

    private hasReloaded(generation: string) {
        return this.reloadedGeneration === generation || this.readSessionValue(RELOAD_SESSION_KEY) === generation;
    }

    private triggerReloadOnce(generation: string) {
        if (!this.applyInProgress || this.activationGeneration !== generation || this.candidate?.key !== generation
            || this.hasReloaded(generation)) return;
        if (this.getRegistrationWorker() !== this.candidate.worker) {
            this.clearCandidate();
            void this.reconcileWorkers();
            return;
        }
        const activityReason = this.getActivityReason();
        this.retireActivation();
        if (activityReason) {
            this.setSnapshot({ activityReason, error: '', state: 'deferred' });
            return;
        }

        this.reloadedGeneration = generation;
        this.writeSessionValue(RELOAD_SESSION_KEY, generation);
        this.candidate = undefined;
        this.setSnapshot({ activityReason: '', error: '', state: 'idle' });
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

    private clearSessionValue(key: string) {
        try {
            this.sessionStorage?.removeItem?.(key);
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
