import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    getItem: vi.fn(),
    getRelationships: vi.fn(),
    serverId: 'server-a',
    userId: 'user-a'
}));
const coordinatorMocks = vi.hoisted(() => ({
    coordinate: vi.fn(async (
        _key: string,
        task: (signal: AbortSignal) => Promise<unknown>,
        options?: { signal?: AbortSignal }
    ) => {
        if (options?.signal?.aborted) {
            const error = new Error('aborted');

            error.name = 'AbortError';
            throw error;
        }

        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
        return task(new AbortController().signal);
    }),
    getKey: vi.fn((_method: string, identity: string) => identity)
}));

vi.mock('../../api', () => ({
    getPtvCurrentUserId: vi.fn(() => state.userId),
    getPtvItem: state.getItem,
    getPtvServerId: vi.fn((serverId?: string) => serverId || state.serverId)
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn(() => ({
        getItemRelationships: state.getRelationships
    }))
}));

vi.mock('../../services/requestCoordinator', () => ({
    coordinatePtvJsonRequest: coordinatorMocks.coordinate,
    getPtvRequestCoordinatorKey: coordinatorMocks.getKey
}));

import { getPtvAuthoritativeRelationships } from './detailsAuthoritativeRelationships';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(promiseResolve => {
        resolve = promiseResolve;
    });

    return { promise, resolve };
}

describe('cinematic authoritative relationship boundary', () => {
    beforeEach(() => {
        state.serverId = 'server-a';
        state.userId = 'user-a';
        state.getItem.mockReset();
        state.getRelationships.mockReset();
        coordinatorMocks.coordinate.mockClear();
        coordinatorMocks.getKey.mockClear();
    });

    it('hydrates only valid visible targets and deduplicates destination identity', async () => {
        state.getRelationships.mockResolvedValue({
            relationships: [
                { category: 'soundtrack', direction: 'source-to-target', displayOrder: 2, enabled: true, mappingId: 'map-a', schemaVersion: 1, targetItemId: 'album-a' },
                { category: 'soundtrack', direction: 'source-to-target', displayOrder: 3, enabled: true, mappingId: 'map-b', schemaVersion: 1, targetItemId: 'album-a' },
                { category: 'not-allowlisted', direction: 'source-to-target', displayOrder: 0, enabled: true, schemaVersion: 1, targetItemId: 'invalid' },
                { category: 'adaptation', direction: 'bidirectional', displayOrder: 1, enabled: false, schemaVersion: 1, targetItemId: 'disabled' },
                { category: 'related-book', direction: 'bidirectional', displayOrder: 1, enabled: true, mappingId: 'map-missing', schemaVersion: 1, targetItemId: 'missing' }
            ],
            schemaVersion: 1
        });
        state.getItem.mockImplementation(async (itemId: string) => {
            if (itemId === 'missing') throw new Error('not visible');

            return { Id: itemId, Name: 'Fixture', Type: 'MusicAlbum' };
        });

        await expect(getPtvAuthoritativeRelationships('source-a', { serverId: 'server-a' })).resolves.toEqual([{
            category: 'soundtrack',
            direction: 'source-to-target',
            displayOrder: 2,
            item: { Id: 'album-a', Name: 'Fixture', Type: 'MusicAlbum' }
        }]);
        expect(state.getItem).toHaveBeenCalledTimes(2);
        expect(coordinatorMocks.coordinate).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.objectContaining({
                diagnosticKey: 'GET auth ptv:item-relationships',
                endpoint: 'item-relationships'
            })
        );
    });

    it('rejects a stale identity immediately after the mapping response settles', async () => {
        const response = deferred<unknown>();

        state.getRelationships.mockReturnValue(response.promise);
        const result = getPtvAuthoritativeRelationships('source-a', { serverId: 'server-a' });

        state.userId = 'user-b';
        response.resolve({ relationships: [], schemaVersion: 1 });

        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
        expect(state.getItem).not.toHaveBeenCalled();
    });

    it('requires the exact contract version, explicit enablement, and matching hydrated identity', async () => {
        state.getRelationships.mockResolvedValue({
            relationships: [
                { category: 'adaptation', direction: 'source-to-target', displayOrder: 0, mappingId: 'missing-enabled', schemaVersion: 1, targetItemId: 'missing-enabled' },
                { category: 'adaptation', direction: 'source-to-target', displayOrder: 1, enabled: true, mappingId: 'string-version', schemaVersion: '1', targetItemId: 'string-version' },
                { category: 'adaptation', direction: 'source-to-target', displayOrder: '2', enabled: true, mappingId: 'string-order', schemaVersion: 1, targetItemId: 'string-order' },
                { category: 'adaptation', direction: 'source-to-target', displayOrder: 2, enabled: true, mappingId: 'wrong-target', schemaVersion: 1, targetItemId: 'expected-target' }
            ],
            schemaVersion: 1
        });
        state.getItem.mockResolvedValue({ Id: 'different-target', Name: 'Fixture', Type: 'Book' });

        await expect(getPtvAuthoritativeRelationships('source-a', { serverId: 'server-a' })).resolves.toEqual([]);
        expect(state.getItem).toHaveBeenCalledOnce();
        expect(state.getItem).toHaveBeenCalledWith('expected-target', expect.any(Object));
    });

    it('rejects a response whose schema version is only coercibly valid', async () => {
        state.getRelationships.mockResolvedValue({ relationships: [], schemaVersion: '1' });

        await expect(getPtvAuthoritativeRelationships('source-a', { serverId: 'server-a' })).resolves.toEqual([]);
        expect(state.getItem).not.toHaveBeenCalled();
    });

    it('rejects a stale identity after target hydration and never commits the old result', async () => {
        const item = deferred<{ Id: string; Name: string; Type: string }>();

        state.getRelationships.mockResolvedValue({
            relationships: [{
                category: 'adaptation',
                direction: 'source-to-target',
                displayOrder: 0,
                enabled: true,
                mappingId: 'map-a',
                schemaVersion: 1,
                targetItemId: 'book-a'
            }],
            schemaVersion: 1
        });
        state.getItem.mockReturnValue(item.promise);
        const result = getPtvAuthoritativeRelationships('source-a', { serverId: 'server-a' });

        await vi.waitFor(() => expect(state.getItem).toHaveBeenCalledOnce());
        state.userId = 'user-b';
        item.resolve({ Id: 'book-a', Name: 'Fixture', Type: 'Book' });

        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('does not admit work for an already-aborted owner', async () => {
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
        const controller = new AbortController();

        controller.abort();

        await expect(getPtvAuthoritativeRelationships('source-a', {
            serverId: 'server-a',
            signal: controller.signal
        })).rejects.toMatchObject({ name: 'AbortError' });
        expect(state.getRelationships).not.toHaveBeenCalled();
    });
});
