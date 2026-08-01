import { beforeEach, describe, expect, it, vi } from 'vitest';

const appSettingsMocks = vi.hoisted(() => ({
    get: vi.fn(),
    set: vi.fn()
}));

vi.mock('./appSettings', () => ({
    default: appSettingsMocks
}));

vi.mock('../browser', () => ({
    default: {
        chrome: true,
        edgeChromium: false,
        firefox: false,
        safari: false
    }
}));

import { UserSettings } from './userSettings';

function createDeferred<T>() {
    let reject!: (reason?: unknown) => void;
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        reject = rejectPromise;
        resolve = resolvePromise;
    });

    return {
        promise,
        reject,
        resolve
    };
}

function createApiClient() {
    return {
        getDisplayPreferences: vi.fn(async () => ({
            CustomPrefs: {}
        })),
        updateDisplayPreferences: vi.fn()
    };
}

describe('UserSettings serialized persistence', () => {
    beforeEach(() => {
        appSettingsMocks.get.mockReset();
        appSettingsMocks.set.mockReset();
    });

    it('serializes snapshots and flushes the latest staged write without overlap', async () => {
        const firstSave = createDeferred<void>();
        const secondSave = createDeferred<void>();
        const apiClient = createApiClient();
        const settings = new UserSettings();

        apiClient.updateDisplayPreferences
            .mockImplementationOnce(() => firstSave.promise)
            .mockImplementationOnce(() => secondSave.promise);

        await settings.setUserInfo('user-a', apiClient);
        settings.set('ptv-home', 'first', true);
        const firstFlush = settings.flushServerPreferences();

        settings.set('ptv-home', 'second', true);
        const secondFlush = settings.flushServerPreferences();

        await vi.waitFor(() => {
            expect(apiClient.updateDisplayPreferences).toHaveBeenCalledTimes(1);
        });
        expect(apiClient.updateDisplayPreferences.mock.calls[0][1].CustomPrefs['ptv-home']).toBe('first');

        firstSave.resolve();
        await firstFlush;

        await vi.waitFor(() => {
            expect(apiClient.updateDisplayPreferences).toHaveBeenCalledTimes(2);
        });
        expect(apiClient.updateDisplayPreferences.mock.calls[1][1].CustomPrefs['ptv-home']).toBe('second');

        secondSave.resolve();
        await secondFlush;
    });

    it('keeps a failed revision dirty so an explicit flush retries it', async () => {
        const apiClient = createApiClient();
        const settings = new UserSettings();

        apiClient.updateDisplayPreferences
            .mockRejectedValueOnce(new Error('temporary failure'))
            .mockResolvedValueOnce(undefined);

        await settings.setUserInfo('user-a', apiClient);
        settings.set('ptv-home', 'value', true);

        await expect(settings.flushServerPreferences()).rejects.toThrow('temporary failure');
        await expect(settings.flushServerPreferences()).resolves.toBeUndefined();

        expect(apiClient.updateDisplayPreferences).toHaveBeenCalledTimes(2);
        expect(apiClient.updateDisplayPreferences.mock.calls[1][1].CustomPrefs['ptv-home']).toBe('value');
    });

    it('rejects a late preference load from a superseded user identity', async () => {
        const firstLoad = createDeferred<{ CustomPrefs: Record<string, string> }>();
        const firstClient = createApiClient();
        const secondClient = createApiClient();
        const settings = new UserSettings();

        firstClient.getDisplayPreferences.mockReturnValueOnce(firstLoad.promise);
        secondClient.getDisplayPreferences.mockResolvedValueOnce({
            CustomPrefs: {
                owner: 'user-b'
            }
        });

        const firstBinding = settings.setUserInfo('user-a', firstClient);
        await settings.setUserInfo('user-b', secondClient);

        firstLoad.resolve({
            CustomPrefs: {
                owner: 'user-a'
            }
        });
        await firstBinding;

        expect(settings.getData().CustomPrefs.owner).toBe('user-b');
    });
});
