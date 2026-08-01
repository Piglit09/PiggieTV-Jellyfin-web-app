import { beforeEach, describe, expect, it, vi } from 'vitest';

import DefaultConfig from '../../config.json';

const { fetchLocal } = vi.hoisted(() => ({
    fetchLocal: vi.fn()
}));

vi.mock('../../utils/fetchLocal.ts', () => ({
    default: fetchLocal
}));

function createResponse(config: object) {
    return {
        json: vi.fn().mockResolvedValue(config),
        ok: true
    } as unknown as Response;
}

describe('web settings config loading', () => {
    beforeEach(() => {
        fetchLocal.mockReset();
        vi.resetModules();
    });

    it('shares one in-flight config fetch across settings readers and caches its result', async () => {
        const config = {
            plugins: [{ name: 'Test plugin' }],
            servers: [{ name: 'Test server' }],
            themes: [{ default: true, id: 'test', name: 'Test theme' }]
        };
        let resolveResponse: ((response: Response) => void) | undefined;
        const responsePromise = new Promise<Response>(resolve => {
            resolveResponse = resolve;
        });

        fetchLocal.mockReturnValue(responsePromise);
        const {
            getWebConfig,
            getPlugins,
            getServers,
            getThemes
        } = await import('./webSettings');
        const settings = [
            getWebConfig(),
            getServers(),
            getThemes(),
            getPlugins()
        ];

        expect(fetchLocal).toHaveBeenCalledTimes(1);
        resolveResponse?.(createResponse(config));
        await expect(Promise.all(settings)).resolves.toEqual([
            config,
            config.servers,
            config.themes,
            config.plugins
        ]);

        await expect(Promise.all([
            getWebConfig(),
            getServers(),
            getThemes(),
            getPlugins()
        ])).resolves.toEqual([
            config,
            config.servers,
            config.themes,
            config.plugins
        ]);
        expect(fetchLocal).toHaveBeenCalledTimes(1);
    });

    it('returns the bundled config after a failed request and retries later', async () => {
        const recoveredConfig = {
            servers: [{ name: 'Recovered server' }]
        };
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        fetchLocal
            .mockRejectedValueOnce(new Error('config unavailable'))
            .mockResolvedValueOnce(createResponse(recoveredConfig));
        const {
            getServers,
            subscribeWebConfig
        } = await import('./webSettings');
        const listener = vi.fn();
        const unsubscribe = subscribeWebConfig(listener);

        await expect(getServers()).resolves.toEqual(DefaultConfig.servers);
        expect(listener).not.toHaveBeenCalled();
        await expect(getServers()).resolves.toEqual(recoveredConfig.servers);
        expect(fetchLocal).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith(recoveredConfig);
        expect(warning).toHaveBeenCalledTimes(1);

        unsubscribe();
    });
});
