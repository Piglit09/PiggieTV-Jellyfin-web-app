import { describe, expect, it, vi } from 'vitest';

import {
    createPtvCoreError,
    ptvCoreFailure,
    ptvCoreSuccess
} from '../errors/coreError';
import {
    createPtvCoreInitializer,
    PTV_CORE_INITIALIZATION_STEPS
} from './coreInitialization';

describe('PTV Core initialization', () => {
    it('runs the controlled sequence once and shares concurrent callers', async () => {
        const calls: string[] = [];
        const handler = (name: string) => async () => {
            calls.push(name);
            return ptvCoreSuccess(undefined);
        };
        const initializer = createPtvCoreInitializer({
            api: handler('api'),
            cache: handler('cache'),
            deviceIdentity: handler('device-identity'),
            diagnostics: handler('diagnostics'),
            environment: handler('environment'),
            navigation: handler('navigation'),
            playback: handler('playback'),
            session: handler('session'),
            settings: handler('settings')
        });

        const firstPromise = initializer.initialize();
        const secondPromise = initializer.initialize();
        const [first, second] = await Promise.all([firstPromise, secondPromise]);

        expect(first).toBe(second);
        expect(first.ready).toBe(true);
        expect(first.steps.map(step => step.name)).toEqual(PTV_CORE_INITIALIZATION_STEPS);
        expect(calls).toEqual(PTV_CORE_INITIALIZATION_STEPS.filter(name => name !== 'ready'));
        await initializer.initialize();
        expect(calls).toHaveLength(9);
    });

    it('degrades for noncritical cache/diagnostics failure and still becomes ready', async () => {
        const initializer = createPtvCoreInitializer({
            api: () => ptvCoreSuccess(undefined),
            cache: () => {
                throw new Error('corrupt cache');
            },
            deviceIdentity: () => ptvCoreSuccess(undefined),
            diagnostics: () => ptvCoreFailure(createPtvCoreError({
                code: 'DIAGNOSTICS_UNAVAILABLE',
                kind: 'unsupported-platform',
                message: 'Unavailable.'
            })),
            environment: () => ptvCoreSuccess(undefined),
            session: () => ptvCoreSuccess(undefined)
        });

        const result = await initializer.initialize();

        expect(result).toMatchObject({ degraded: true, ready: true });
        expect(result.steps.find(step => step.name === 'cache')?.status).toBe('degraded');
        expect(result.steps.find(step => step.name === 'diagnostics')?.status).toBe('degraded');
    });

    it('stops on authentication failure and asks the platform to route to login', async () => {
        const api = vi.fn();
        const initializer = createPtvCoreInitializer({
            api,
            deviceIdentity: () => ptvCoreSuccess(undefined),
            environment: () => ptvCoreSuccess(undefined),
            session: () => ptvCoreFailure(createPtvCoreError({
                code: 'AUTH_SESSION_EXPIRED',
                kind: 'authentication',
                message: 'Sign in again.'
            }))
        });

        const result = await initializer.initialize();

        expect(result).toMatchObject({
            action: 'route-to-login',
            error: { code: 'AUTH_SESSION_EXPIRED' },
            ready: false
        });
        expect(api).not.toHaveBeenCalled();
        expect(result.steps.find(step => step.name === 'api')?.status).toBe('skipped');
    });

    it('isolates observer errors and disposes the adapter explicitly', async () => {
        const dispose = vi.fn();
        const initializer = createPtvCoreInitializer({
            api: () => ptvCoreSuccess(undefined),
            deviceIdentity: () => ptvCoreSuccess(undefined),
            dispose,
            environment: () => ptvCoreSuccess(undefined),
            session: () => ptvCoreSuccess(undefined)
        }, {
            observer: () => {
                throw new Error('observer failed');
            }
        });

        expect((await initializer.initialize()).ready).toBe(true);
        await initializer.dispose();
        expect(dispose).toHaveBeenCalledOnce();
        expect(initializer.getResult()).toBeNull();
    });
});
