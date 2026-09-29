/* eslint-disable compat/compat -- URL is used by the jsdom test fixture. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPtvServiceWorkerScriptUrl, PtvUpdateService } from './updateService';

const CURRENT_BUILD = {
    buildDate: '2026-09-29T10:00:00.000Z',
    buildId: 'ptv-web-0.5.61',
    commitSha: '9345d88380ee57352131b04184d63f7fa1224300',
    ptvWebVersion: '0.5.61'
};
const LATER_BUILD = {
    buildDate: '2026-09-29T11:00:00.000Z',
    buildId: 'ptv-web-0.5.62',
    commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ptvWebVersion: '0.5.62'
};

class FixtureMessagePort {
    closed = false;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    peer?: FixtureMessagePort;

    close() {
        this.closed = true;
    }

    postMessage(data: unknown) {
        if (!this.closed && !this.peer?.closed) this.peer?.onmessage?.({ data });
    }
}

class FixtureMessageChannel {
    port1 = new FixtureMessagePort();
    port2 = new FixtureMessagePort();

    constructor() {
        this.port1.peer = this.port2;
        this.port2.peer = this.port1;
    }
}

type FixtureWorker = {
    addEventListener: (type: string, listener: () => void) => void;
    notifyStateChange: () => void;
    postMessage?: (message: unknown, ports?: Transferable[]) => void;
    replies: Array<(response?: unknown) => void>;
    scriptURL: string;
    state: string;
};

function createWorker(options: {
    generation?: unknown;
    holdIdentity?: boolean;
    noPostMessage?: boolean;
    scriptURL?: string;
    skipWaitingError?: Error;
    state?: string;
} = {}): FixtureWorker {
    const listeners = new Map<string, () => void>();
    const generation = options.generation === undefined ? LATER_BUILD : options.generation;
    const replies: FixtureWorker['replies'] = [];
    return {
        addEventListener: (type, listener) => listeners.set(type, listener),
        notifyStateChange: () => listeners.get('statechange')?.(),
        postMessage: options.noPostMessage ? undefined : vi.fn((message, ports) => {
            const type = (message as { type?: string }).type;
            if (type === 'PTV_GET_BUILD_GENERATION') {
                const port = ports?.[0] as unknown as FixtureMessagePort;
                const reply = (response: unknown = { generation, type: 'PTV_BUILD_GENERATION' }) => port.postMessage(response);
                replies.push(reply);
                if (!options.holdIdentity) reply();
            } else if (type === 'SKIP_WAITING' && options.skipWaitingError) {
                throw options.skipWaitingError;
            }
        }),
        replies,
        scriptURL: options.scriptURL || new URL('serviceworker.js', window.location.href).href,
        state: options.state || 'installed'
    };
}

async function settle() {
    for (let index = 0; index < 8; index++) await Promise.resolve();
}

function createFixture(options: {
    activationTimeoutMs?: number;
    controller?: FixtureWorker | null;
    getActivityReason?: () => string;
    initialStorage?: Record<string, string>;
    registrationError?: Error;
    registration?: {
        active?: FixtureWorker | null;
        installing?: FixtureWorker | null;
        waiting?: FixtureWorker | null;
    };
    worker?: FixtureWorker;
} = {}) {
    const listeners = new Map<string, () => void>();
    const worker = options.worker || createWorker();
    const registration = {
        active: createWorker({ generation: CURRENT_BUILD, state: 'activated' }) as FixtureWorker | null,
        addEventListener: vi.fn((type: string, listener: () => void) => listeners.set(type, listener)),
        installing: null as FixtureWorker | null,
        update: vi.fn().mockResolvedValue(undefined),
        waiting: worker as FixtureWorker | null,
        ...options.registration
    };
    const controllerListeners = new Map<string, () => void>();
    const serviceWorker = {
        addEventListener: vi.fn((type: string, listener: () => void) => controllerListeners.set(type, listener)),
        controller: options.controller === undefined ? registration.active : options.controller,
        getRegistration: options.registrationError ?
            vi.fn().mockRejectedValue(options.registrationError) :
            vi.fn().mockResolvedValue(registration)
    };
    const reload = vi.fn();
    const storage = new Map<string, string>(Object.entries(options.initialStorage || {}));
    const service = new PtvUpdateService({
        activationTimeoutMs: options.activationTimeoutMs,
        getActivityReason: options.getActivityReason,
        reload,
        serviceWorker,
        sessionStorage: {
            getItem: key => storage.get(key) || null,
            removeItem: key => { storage.delete(key); },
            setItem: (key, value) => { storage.set(key, value); }
        }
    });

    async function activate(activeWorker = worker) {
        activeWorker.state = 'activated';
        registration.active = activeWorker;
        registration.installing = null;
        registration.waiting = null;
        serviceWorker.controller = activeWorker;
        controllerListeners.get('controllerchange')?.();
        await settle();
    }

    async function install(nextWorker: FixtureWorker) {
        registration.installing = nextWorker;
        registration.waiting = nextWorker;
        listeners.get('updatefound')?.();
        await settle();
    }

    return { activate, controllerListeners, install, registration, reload, service, serviceWorker, storage, worker };
}

describe('PiggieTV update service', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.useFakeTimers();
        vi.stubGlobal('MessageChannel', FixtureMessageChannel);
        vi.stubGlobal('__PTV_VERSION__', CURRENT_BUILD.ptvWebVersion);
        vi.stubGlobal('__PTV_BUILD_ID__', CURRENT_BUILD.buildId);
        vi.stubGlobal('__COMMIT_SHA__', CURRENT_BUILD.commitSha);
        vi.stubGlobal('__PTV_BUILD_DATE__', CURRENT_BUILD.buildDate);
    });

    afterEach(() => {
        document.documentElement.removeAttribute('data-ptv-now-playing');
        delete document.documentElement.dataset.ptvDashboardUnsaved;
        document.body.replaceChildren();
        delete (window as Window & { PTV?: unknown }).PTV;
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('resolves the worker relative to the served Jellyfin Web base path', () => {
        expect(getPtvServiceWorkerScriptUrl()).toBe('serviceworker.js');
    });

    it('stays idle when no service-worker registration exists', async () => {
        const service = new PtvUpdateService({
            serviceWorker: { getRegistration: vi.fn().mockResolvedValue(undefined) }
        });
        await service.start();
        expect(service.getSnapshot().state).toBe('idle');
    });

    it('announces a verified later waiting build', async () => {
        const fixture = createFixture();
        await fixture.service.start();
        expect(fixture.service.getSnapshot().state).toBe('available');
    });

    it.each([
        ['same build', CURRENT_BUILD],
        ['same generation rebuilt at a later date', { ...CURRENT_BUILD, buildDate: '2026-09-30T11:00:00.000Z' }],
        ['older release with a later build date', { ...LATER_BUILD, ptvWebVersion: '0.5.60' }],
        ['older same-release generation', { ...CURRENT_BUILD, commitSha: LATER_BUILD.commitSha, buildDate: '2026-09-28T11:00:00.000Z' }]
    ])('does not manufacture availability for %s', async (_name, generation) => {
        const fixture = createFixture({ worker: createWorker({ generation }) });
        await fixture.service.start();
        expect(fixture.service.getSnapshot().state).toBe('idle');
        expect(fixture.service.applyWhenSafe()).toBe(false);
        expect(fixture.reload).not.toHaveBeenCalled();
    });

    it('announces a later same-release source generation', async () => {
        const fixture = createFixture({ worker: createWorker({
            generation: { ...CURRENT_BUILD, commitSha: LATER_BUILD.commitSha, buildDate: LATER_BUILD.buildDate }
        }) });
        await fixture.service.start();
        expect(fixture.service.getSnapshot().state).toBe('available');
    });

    it('does not announce the first installation of the running build', async () => {
        const installer = createWorker({ generation: CURRENT_BUILD });
        const fixture = createFixture({ controller: null, registration: { active: null, installing: installer, waiting: null } });
        await fixture.service.start();
        expect(fixture.service.getSnapshot().state).toBe('idle');
    });

    it('clears the notice after the document reloads into the target build', async () => {
        const fixture = createFixture();
        await fixture.service.start();
        fixture.service.applyWhenSafe();
        await fixture.activate();
        vi.stubGlobal('__PTV_VERSION__', LATER_BUILD.ptvWebVersion);
        vi.stubGlobal('__PTV_BUILD_ID__', LATER_BUILD.buildId);
        vi.stubGlobal('__COMMIT_SHA__', LATER_BUILD.commitSha);
        vi.stubGlobal('__PTV_BUILD_DATE__', LATER_BUILD.buildDate);
        const restarted = createFixture({ worker: fixture.worker, initialStorage: Object.fromEntries(fixture.storage) });
        await restarted.service.start();
        expect(restarted.service.getSnapshot().state).toBe('idle');
        expect(restarted.reload).not.toHaveBeenCalled();
    });

    it('keeps a later active build available after another context activates it', async () => {
        const fixture = createFixture();
        await fixture.service.start();
        await fixture.activate();
        expect(fixture.service.getSnapshot().state).toBe('available');
        expect(fixture.reload).not.toHaveBeenCalled();
        fixture.service.applyWhenSafe();
        expect(fixture.reload).toHaveBeenCalledOnce();
    });

    it('retires a stale notice when external activation returns to the running generation', async () => {
        const fixture = createFixture();
        await fixture.service.start();
        await fixture.activate(createWorker({ generation: CURRENT_BUILD, state: 'activated' }));
        expect(fixture.service.getSnapshot().state).toBe('idle');
        expect(fixture.service.applyWhenSafe()).toBe(false);
    });

    it.each([
        ['absent generation', null],
        ['invalid release', { ...LATER_BUILD, ptvWebVersion: 'later' }],
        ['invalid commit', { ...LATER_BUILD, commitSha: 'unavailable' }],
        ['invalid build date', { ...LATER_BUILD, buildDate: 'tomorrow' }],
        ['invalid build identifier', { ...LATER_BUILD, buildId: '<script>' }]
    ])('keeps the current app usable after %s', async (_name, generation) => {
        const fixture = createFixture({ worker: createWorker({ generation }) });
        await fixture.service.start();
        expect(fixture.service.getSnapshot().state).toBe('idle');
        expect(fixture.reload).not.toHaveBeenCalled();
    });

    it('ignores a response with the wrong protocol type', async () => {
        const worker = createWorker({ holdIdentity: true });
        const fixture = createFixture({ worker });
        const starting = fixture.service.start();
        await settle();
        worker.replies[0]?.({ generation: LATER_BUILD, type: 'UNRELATED' });
        await starting;
        expect(fixture.service.getSnapshot().state).toBe('idle');
    });

    it('does not announce an unidentified worker that cannot receive messages', async () => {
        const fixture = createFixture({ worker: createWorker({ noPostMessage: true }) });
        await fixture.service.start();
        expect(fixture.service.getSnapshot().state).toBe('idle');
        expect(fixture.service.applyWhenSafe()).toBe(false);
        expect(fixture.reload).not.toHaveBeenCalled();
    });

    it('fails safe when identity times out and ignores the late reply', async () => {
        const worker = createWorker({ holdIdentity: true });
        const fixture = createFixture({ worker });
        const starting = fixture.service.start();
        await settle();
        await vi.advanceTimersByTimeAsync(3000);
        await starting;
        worker.replies[0]?.();
        await settle();
        expect(fixture.service.getSnapshot().state).toBe('idle');
        expect(fixture.reload).not.toHaveBeenCalled();
    });

    it('ignores a superseded later reply after the running generation wins', async () => {
        const worker = createWorker({ holdIdentity: true });
        const fixture = createFixture({ worker });
        const starting = fixture.service.start();
        await settle();
        await fixture.install(createWorker({ generation: CURRENT_BUILD }));
        worker.replies[0]?.();
        await starting;
        expect(fixture.service.getSnapshot().state).toBe('idle');
    });

    it('does not let an older reply hide a newer verified candidate', async () => {
        const worker = createWorker({ generation: CURRENT_BUILD, holdIdentity: true });
        const fixture = createFixture({ worker });
        const starting = fixture.service.start();
        await settle();
        await fixture.install(createWorker());
        worker.replies[0]?.();
        await starting;
        expect(fixture.service.getSnapshot().state).toBe('available');
    });

    it('does not resurrect an old candidate after controller registration verification fails', async () => {
        const worker = createWorker({ holdIdentity: true });
        const fixture = createFixture({ worker });
        const starting = fixture.service.start();
        await settle();
        fixture.serviceWorker.getRegistration.mockRejectedValueOnce(new Error('registration unavailable'));
        fixture.controllerListeners.get('controllerchange')?.();
        await settle();
        worker.replies[0]?.();
        await starting;
        expect(fixture.service.getSnapshot().state).toBe('idle');
        expect(fixture.reload).not.toHaveBeenCalled();
    });

    it.each(['success', 'error'])('keeps the newer controller candidate after an older registration %s completes', async completion => {
        const fixture = createFixture({ activationTimeoutMs: 250 });
        await fixture.service.start();
        const olderRegistration = { ...fixture.registration };
        let resolveOlder!: (registration: typeof olderRegistration) => void;
        let rejectOlder!: (error: Error) => void;
        const pendingRegistration = new Promise<typeof olderRegistration>((resolve, reject) => {
            resolveOlder = resolve;
            rejectOlder = reject;
        });
        fixture.serviceWorker.getRegistration.mockReturnValueOnce(pendingRegistration);
        fixture.controllerListeners.get('controllerchange')?.();
        await settle();

        const newerWorker = createWorker({ generation: { ...LATER_BUILD, ptvWebVersion: '0.5.63', buildId: 'ptv-web-0.5.63' } });
        fixture.serviceWorker.getRegistration.mockResolvedValue({ ...fixture.registration, waiting: newerWorker });
        fixture.controllerListeners.get('controllerchange')?.();
        await settle();
        expect(fixture.service.getSnapshot().state).toBe('available');

        if (completion === 'success') resolveOlder(olderRegistration);
        else rejectOlder(new Error('older registration failed'));
        await settle();
        expect(fixture.service.getSnapshot().state).toBe('available');
        expect(fixture.service.applyWhenSafe()).toBe(true);
        await vi.advanceTimersByTimeAsync(250);
        expect(fixture.reload).toHaveBeenCalledOnce();
        expect(fixture.storage.get('ptv:update:reloading')).toBe(JSON.stringify([
            '0.5.63', 'ptv-web-0.5.63', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        ]));
    });

    it.each([
        ['success', 'updatefound'],
        ['error', 'updatefound'],
        ['success', 'statechange'],
        ['error', 'statechange']
    ])('keeps the newer worker candidate after older registration %s completes following %s', async (completion, event) => {
        const newerWorker = createWorker({
            generation: { ...LATER_BUILD, ptvWebVersion: '0.5.63', buildId: 'ptv-web-0.5.63' },
            state: 'installing'
        });
        const fixture = createFixture({ activationTimeoutMs: 250, registration: { installing: newerWorker } });
        await fixture.service.start();
        const olderRegistration = { ...fixture.registration, installing: null };
        let resolveOlder!: (registration: typeof fixture.registration) => void;
        let rejectOlder!: (error: Error) => void;
        const pendingRegistration = new Promise<typeof fixture.registration>((resolve, reject) => {
            resolveOlder = resolve;
            rejectOlder = reject;
        });
        fixture.serviceWorker.getRegistration.mockReturnValueOnce(pendingRegistration);
        fixture.controllerListeners.get('controllerchange')?.();
        await settle();

        newerWorker.state = 'installed';
        if (event === 'updatefound') {
            await fixture.install(newerWorker);
        } else {
            fixture.registration.waiting = newerWorker;
            newerWorker.notifyStateChange();
            await settle();
        }
        expect(fixture.service.getSnapshot().state).toBe('available');
        if (completion === 'success') resolveOlder(olderRegistration);
        else rejectOlder(new Error('older registration failed'));
        await settle();

        expect(fixture.service.getSnapshot().state).toBe('available');
        expect(fixture.service.applyWhenSafe()).toBe(true);
        await vi.advanceTimersByTimeAsync(250);
        expect(fixture.reload).toHaveBeenCalledOnce();
        expect(fixture.storage.get('ptv:update:reloading')).toBe(JSON.stringify([
            '0.5.63', 'ptv-web-0.5.63', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        ]));
    });

    it.each(['success', 'error'])('keeps the newer candidate after an older initial registration %s completes', async completion => {
        const fixture = createFixture({ activationTimeoutMs: 250 });
        let resolveInitial!: (registration: typeof fixture.registration) => void;
        let rejectInitial!: (error: Error) => void;
        const pendingRegistration = new Promise<typeof fixture.registration>((resolve, reject) => {
            resolveInitial = resolve;
            rejectInitial = reject;
        });
        fixture.serviceWorker.getRegistration.mockReturnValueOnce(pendingRegistration);
        const starting = fixture.service.start();
        await settle();
        const newerWorker = createWorker({ generation: { ...LATER_BUILD, ptvWebVersion: '0.5.63', buildId: 'ptv-web-0.5.63' } });
        fixture.serviceWorker.getRegistration.mockResolvedValue({ ...fixture.registration, waiting: newerWorker });
        fixture.controllerListeners.get('controllerchange')?.();
        await settle();
        expect(fixture.service.getSnapshot().state).toBe('available');

        if (completion === 'success') resolveInitial(fixture.registration);
        else rejectInitial(new Error('older initial registration failed'));
        await starting;
        expect(fixture.service.getSnapshot().state).toBe('available');
        expect(fixture.service.applyWhenSafe()).toBe(true);
        await vi.advanceTimersByTimeAsync(250);
        expect(fixture.reload).toHaveBeenCalledOnce();
        expect(fixture.storage.get('ptv:update:reloading')).toBe(JSON.stringify([
            '0.5.63', 'ptv-web-0.5.63', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        ]));
    });

    it.each([
        ['https://different.invalid/serviceworker.js'],
        [new URL('unrelatedworker.js', window.location.href).href]
    ])('rejects worker identity outside the expected script: %s', async scriptURL => {
        const fixture = createFixture({ worker: createWorker({ scriptURL }) });
        await fixture.service.start();
        expect(fixture.service.getSnapshot().state).toBe('idle');
    });

    it('dismisses only the verified candidate in this session', async () => {
        const fixture = createFixture();
        await fixture.service.start();
        fixture.service.dismiss();
        expect(fixture.service.getSnapshot().state).toBe('dismissed');
        await fixture.install(createWorker());
        expect(fixture.service.getSnapshot().state).toBe('dismissed');
        await fixture.install(createWorker({ generation: { ...LATER_BUILD, ptvWebVersion: '0.5.63', buildId: 'ptv-web-0.5.63' } }));
        expect(fixture.service.getSnapshot().state).toBe('available');
    });

    it('ignores the obsolete session-wide dismissal flag for a later candidate', async () => {
        const fixture = createFixture({ initialStorage: { ['ptv:update:dismissed']: 'true' } });
        await fixture.service.start();
        expect(fixture.service.getSnapshot().state).toBe('available');
    });

    it('activates and reloads once after a safe verified controller transition', async () => {
        const fixture = createFixture();
        await fixture.service.start();
        expect(fixture.service.applyWhenSafe()).toBe(true);
        await fixture.activate();
        expect(fixture.reload).toHaveBeenCalledOnce();
        expect(fixture.service.getSnapshot().state).toBe('idle');
        await fixture.activate();
        await vi.advanceTimersByTimeAsync(3000);
        expect(fixture.reload).toHaveBeenCalledOnce();
    });

    it('does not let an obsolete reload marker suppress a later update', async () => {
        const fixture = createFixture({ initialStorage: { ['ptv:update:reloading']: 'true' } });
        await fixture.service.start();
        fixture.service.applyWhenSafe();
        await fixture.activate();
        expect(fixture.reload).toHaveBeenCalledOnce();
    });

    it('bounds a failed reload to one attempt for the verified target generation', async () => {
        const fixture = createFixture({ activationTimeoutMs: 250 });
        await fixture.service.start();
        fixture.service.applyWhenSafe();
        await vi.advanceTimersByTimeAsync(250);
        const restarted = createFixture({ initialStorage: Object.fromEntries(fixture.storage) });
        await restarted.service.start();
        expect(restarted.service.getSnapshot().state).toBe('idle');
        expect(restarted.service.applyWhenSafe()).toBe(false);
        expect(restarted.reload).not.toHaveBeenCalled();
    });

    it('falls back once when a verified waiting worker rejects activation', async () => {
        const fixture = createFixture({ worker: createWorker({ skipWaitingError: new Error('activation failed') }) });
        await fixture.service.start();
        expect(fixture.service.applyWhenSafe()).toBe(true);
        expect(fixture.service.getSnapshot().state).toBe('idle');
        expect(fixture.reload).toHaveBeenCalledOnce();
    });

    it('reloads once if controllerchange does not arrive before the activation timeout', async () => {
        const fixture = createFixture({ activationTimeoutMs: 250 });
        await fixture.service.start();
        fixture.service.applyWhenSafe();
        await vi.advanceTimersByTimeAsync(249);
        expect(fixture.reload).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(fixture.reload).toHaveBeenCalledOnce();
        await fixture.activate();
        expect(fixture.reload).toHaveBeenCalledOnce();
    });

    it('falls back once for an uncontrolled page with a verified later build', async () => {
        const fixture = createFixture({ activationTimeoutMs: 250, controller: null });
        await fixture.service.start();
        fixture.service.applyWhenSafe();
        await vi.advanceTimersByTimeAsync(250);
        expect(fixture.reload).toHaveBeenCalledOnce();
    });

    it('treats repeated reload clicks as one activation attempt', async () => {
        const fixture = createFixture();
        await fixture.service.start();
        expect(fixture.service.applyWhenSafe()).toBe(true);
        expect(fixture.service.applyWhenSafe()).toBe(false);
        await fixture.activate();
        expect(fixture.reload).toHaveBeenCalledOnce();
    });

    it.each([
        ['Playback is active.'],
        ['Reading is active.'],
        ['Metadata is being applied.'],
        ['Dashboard changes have not been saved.']
    ])('defers application while activity is unsafe: %s', async activityReason => {
        const fixture = createFixture({ getActivityReason: () => activityReason });
        await fixture.service.start();
        expect(fixture.service.applyWhenSafe()).toBe(false);
        expect(fixture.service.getSnapshot()).toMatchObject({ activityReason, state: 'deferred' });
        expect(fixture.reload).not.toHaveBeenCalled();
    });

    const activityCases = [
        ['Playback is active.', () => document.documentElement.setAttribute('data-ptv-now-playing', 'true')],
        ['Reading is active.', () => { document.body.innerHTML = '<div class="ptv-reader"></div>'; }],
        ['Metadata is being applied.', () => { document.body.innerHTML = '<div data-ptv-metadata-applying="true"></div>'; }],
        ['Dashboard changes have not been saved.', () => { document.documentElement.dataset.ptvDashboardUnsaved = 'true'; }]
    ] as const;

    it.each(activityCases)('rechecks the real activity gate before controller reload: %s', async (activityReason, beginActivity) => {
        const fixture = createFixture();
        await fixture.service.start();
        fixture.service.applyWhenSafe();
        beginActivity();
        await fixture.activate();
        expect(fixture.reload).not.toHaveBeenCalled();
        expect(fixture.service.getSnapshot()).toMatchObject({ activityReason, state: 'deferred' });
    });

    it.each(activityCases)('rechecks the real activity gate before fallback reload: %s', async (activityReason, beginActivity) => {
        const fixture = createFixture({ activationTimeoutMs: 250 });
        await fixture.service.start();
        fixture.service.applyWhenSafe();
        beginActivity();
        await vi.advanceTimersByTimeAsync(250);
        expect(fixture.reload).not.toHaveBeenCalled();
        expect(fixture.service.getSnapshot()).toMatchObject({ activityReason, state: 'deferred' });
    });

    it('recovers a deferred active generation when activity ends', async () => {
        let active = false;
        const fixture = createFixture({ getActivityReason: () => active ? 'Reading is active.' : '' });
        await fixture.service.start();
        fixture.service.applyWhenSafe();
        active = true;
        await fixture.activate();
        active = false;
        expect(fixture.service.retryDeferredUpdate()).toBe(true);
        expect(fixture.reload).toHaveBeenCalledOnce();
        expect(fixture.service.getSnapshot().state).toBe('idle');
    });

    it('cancels activation cleanup when a different candidate replaces it', async () => {
        const fixture = createFixture({ activationTimeoutMs: 250 });
        await fixture.service.start();
        fixture.service.applyWhenSafe();
        await fixture.install(createWorker({ generation: CURRENT_BUILD }));
        await vi.advanceTimersByTimeAsync(250);
        expect(fixture.reload).not.toHaveBeenCalled();
        expect(fixture.service.getSnapshot().state).toBe('idle');
    });

    it('reports registration failure without reloading', async () => {
        const fixture = createFixture({ registrationError: new Error('registration unavailable') });
        await fixture.service.start();
        expect(fixture.service.getSnapshot()).toMatchObject({ error: 'registration unavailable', state: 'error' });
        expect(fixture.reload).not.toHaveBeenCalled();
    });

    it('the standalone worker returns compile-time provenance through the request port', async () => {
        vi.resetModules();
        const handlers = new Map<string, (event: unknown) => void>();
        vi.stubGlobal('self', {
            addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
            location: { origin: window.location.origin }
        });
        await import('../../serviceworker.js');
        const replies: unknown[] = [];
        handlers.get('message')?.({
            data: { type: 'PTV_GET_BUILD_GENERATION' },
            origin: window.location.origin,
            ports: [{ postMessage: (data: unknown) => replies.push(data) }]
        });
        expect(replies).toEqual([{ generation: CURRENT_BUILD, type: 'PTV_BUILD_GENERATION' }]);
    });

    it('the standalone worker ignores a cross-origin identity request', async () => {
        vi.resetModules();
        const handlers = new Map<string, (event: unknown) => void>();
        vi.stubGlobal('self', {
            addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
            location: { origin: window.location.origin }
        });
        await import('../../serviceworker.js');
        const replies: unknown[] = [];
        handlers.get('message')?.({
            data: { type: 'PTV_GET_BUILD_GENERATION' },
            origin: 'https://different.invalid',
            ports: [{ postMessage: (data: unknown) => replies.push(data) }]
        });
        expect(replies).toEqual([]);
    });
});

/* eslint-enable compat/compat */
