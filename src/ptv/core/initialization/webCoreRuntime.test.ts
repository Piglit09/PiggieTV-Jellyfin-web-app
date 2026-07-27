import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/client', () => ({
    getCurrentPtvApiClient: () => null,
    getPtvCurrentUserId: () => '',
    getPtvServerId: () => ''
}));
vi.mock('../../shell/routeController', () => ({ startPtvRouteController: vi.fn() }));
vi.mock('../../services/playbackStateService', () => ({ startPtvPlaybackStateService: vi.fn() }));
vi.mock('../../services/diagnostics/webDiagnosticPlatform', () => ({
    disposePtvWebDiagnosticPlatformForTests: vi.fn(),
    initializePtvWebDiagnosticPlatform: vi.fn(),
    recordPtvCoreInitializationDiagnostic: vi.fn()
}));
vi.mock('../../utils/libraryIndexCache', () => ({ initializePtvLibraryIndexCache: () => Promise.resolve(true) }));
vi.mock('../capabilities/webCapabilityAdapter', () => ({
    getPtvWebCapabilityReport: () => ({
        capabilities: {},
        contractVersion: '1.0',
        deviceClass: 'desktop',
        platform: 'web'
    })
}));
vi.mock('../observability', () => ({ recordPtvEvent: vi.fn() }));
vi.mock('../runtime', () => ({ registerPtvRuntimeListener: vi.fn(() => vi.fn()) }));

import { createPtvCoreError, ptvCoreFailure } from '../errors/coreError';
import {
    createPtvWebCoreRuntime,
    getPtvWebCoreRuntime,
    resetPtvWebCoreRuntimeForTests,
    type PtvWebCoreRuntimeDependencies
} from './webCoreRuntime';

function failure(kind: 'authentication' | 'cache' | 'unknown', code: string) {
    return ptvCoreFailure<void>(createPtvCoreError({
        code,
        kind,
        message: code,
        operation: 'test'
    }));
}

function dependencies(
    overrides: PtvWebCoreRuntimeDependencies = {},
    calls: string[] = []
): PtvWebCoreRuntimeDependencies {
    const handler = (name: string) => () => {
        calls.push(name);
    };

    return {
        api: handler('api'),
        cache: handler('cache'),
        deviceIdentity: handler('device-identity'),
        diagnostics: handler('diagnostics'),
        environment: handler('environment'),
        getScope: () => ({ kind: 'user', serverId: 'server', userId: 'user' }),
        getSettings: () => ({
            dynamicBackdropsEnabled: true,
            heroEnabled: true,
            homeRowsEnabled: true,
            playbackMode: 'auto',
            tvLowPowerModeEnabled: true
        }),
        navigation: handler('navigation'),
        playback: handler('playback'),
        registerSettingsListener: () => handler('settings-listener-disposed'),
        session: handler('session'),
        settings: handler('settings'),
        ...overrides
    };
}

afterEach(async () => {
    await resetPtvWebCoreRuntimeForTests();
});

describe('web core runtime adoption', () => {
    it('runs the documented lifecycle successfully', async () => {
        const calls: string[] = [];
        const runtime = createPtvWebCoreRuntime(dependencies({}, calls));
        const result = await runtime.initialize();

        expect(result.ready).toBe(true);
        expect(result.degraded).toBe(false);
        expect(result.steps.map(step => step.name)).toEqual([
            'environment',
            'device-identity',
            'session',
            'settings',
            'cache',
            'api',
            'diagnostics',
            'navigation',
            'playback',
            'ready'
        ]);
        expect(calls).toEqual(result.steps.filter(step => step.name !== 'ready').map(step => step.name));
    });

    it.each([
        ['cache', 'CACHE_UNAVAILABLE'],
        ['diagnostics', 'DIAGNOSTICS_UNAVAILABLE']
    ] as const)('degrades when noncritical %s initialization fails', async (step, code) => {
        const runtime = createPtvWebCoreRuntime(dependencies({
            [step]: () => failure(step === 'cache' ? 'cache' : 'unknown', code)
        }));
        const result = await runtime.initialize();

        expect(result.ready).toBe(true);
        expect(result.degraded).toBe(true);
        expect(result.steps.find(candidate => candidate.name === step)?.status).toBe('degraded');
    });

    it('preserves the existing login action for authentication failures', async () => {
        const runtime = createPtvWebCoreRuntime(dependencies({
            session: () => failure('authentication', 'SESSION_EXPIRED')
        }));
        const result = await runtime.initialize();

        expect(result.ready).toBe(false);
        expect(result.action).toBe('route-to-login');
        expect(result.steps.find(step => step.name === 'session')?.status).toBe('failed');
        expect(result.steps.find(step => step.name === 'settings')?.status).toBe('skipped');
    });

    it('stops on a critical API initialization failure', async () => {
        const runtime = createPtvWebCoreRuntime(dependencies({
            api: () => failure('unknown', 'API_INITIALIZATION_FAILED')
        }));
        const result = await runtime.initialize();

        expect(result.ready).toBe(false);
        expect(result.action).toBe('none');
        expect(result.steps.find(step => step.name === 'api')?.status).toBe('failed');
        expect(result.steps.find(step => step.name === 'diagnostics')?.status).toBe('skipped');
    });

    it('shares concurrent initialization and reuses the completed result', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        const api = vi.fn(() => gate);
        const runtime = createPtvWebCoreRuntime(dependencies({ api }));
        const first = runtime.initialize();
        const second = runtime.initialize();

        expect(first).toBe(second);
        release();
        const completed = await first;

        expect(await runtime.initialize()).toBe(completed);
        expect(api).toHaveBeenCalledTimes(1);
    });

    it('deduplicates settings listeners and disposes before reset', async () => {
        const install = vi.fn(() => vi.fn());
        const runtime = createPtvWebCoreRuntime(dependencies({
            registerSettingsListener: install,
            settings: undefined
        }));

        await runtime.initialize();
        await runtime.initialize();
        expect(install).toHaveBeenCalledTimes(1);

        const dispose = install.mock.results[0]?.value;
        await runtime.dispose();
        expect(dispose).toHaveBeenCalledTimes(1);

        await runtime.initialize();
        expect(install).toHaveBeenCalledTimes(2);
    });

    it('survives repeated global entry such as hot reload', async () => {
        const first = getPtvWebCoreRuntime();
        const second = getPtvWebCoreRuntime();

        expect(second).toBe(first);
    });
});
