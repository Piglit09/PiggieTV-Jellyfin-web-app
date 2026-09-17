import { describe, expect, it, vi } from 'vitest';

import {
    createPtvReadingIdentifyReconciliationCoordinator,
    type PtvReadingIdentifyReconciliationDiagnostic
} from './readingIdentifyReconciliation';

type Deferred<T> = Readonly<{
    promise: Promise<T>;
    reject: (error: unknown) => void;
    resolve: (value: T) => void;
}>;

function deferred<T>(): Deferred<T> {
    let reject!: (error: unknown) => void;
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });

    return {
        promise,
        reject,
        resolve
    };
}

function abortError() {
    return Object.assign(new Error('Request cancelled.'), {
        name: 'AbortError'
    });
}

function waitForAbort(options: Readonly<{ signal: AbortSignal }>) {
    return new Promise<string>((_resolve, reject) => {
        const rejectAsAborted = () => reject(abortError());

        options.signal.addEventListener('abort', rejectAsAborted, { once: true });
    });
}

describe('Reading Identify reconciliation coordinator', () => {
    it('retains the current item when a successful mutation readback is still unconfirmed', () => {
        const publish = vi.fn();
        const read = vi.fn();
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({ publish, read });

        const result = coordinator.reconcileMutation('manga-a', 'pre-identify-cover', {
            authority: 'unconfirmed',
            operationGeneration: 1
        });

        expect(result).toEqual({
            generation: 1,
            operationGeneration: 1,
            status: 'retained-unconfirmed'
        });
        expect(read).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });

    it('publishes an already-authoritative mutation result without a readback', () => {
        const publish = vi.fn();
        const read = vi.fn();
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({ publish, read });

        expect(coordinator.reconcileMutation('manga-a', 'authoritative-cover', {
            authority: 'confirmed',
            operationGeneration: 1
        })).toEqual({
            generation: 1,
            operationGeneration: 1,
            status: 'published',
            value: 'authoritative-cover'
        });
        expect(read).not.toHaveBeenCalled();
        expect(publish).toHaveBeenCalledExactlyOnceWith('manga-a', 'authoritative-cover');
    });

    it('treats the first terminal event for a mutation generation as final and idempotent', () => {
        const publish = vi.fn();
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({
            publish,
            read: vi.fn()
        });

        expect(coordinator.reconcileMutation('manga-a', 'stale', {
            authority: 'unconfirmed',
            operationGeneration: 1
        }).status).toBe('retained-unconfirmed');
        expect(coordinator.reconcileMutation('manga-a', 'late-confirmed', {
            authority: 'confirmed',
            operationGeneration: 1
        }).status).toBe('retained-unconfirmed');
        expect(coordinator.reconcileMutation('manga-a', 'duplicate', {
            authority: 'confirmed',
            operationGeneration: 1
        }).status).toBe('retained-unconfirmed');

        expect(publish).not.toHaveBeenCalled();
    });

    it('rejects an older Identify event after a newer generation reconciles', () => {
        const publish = vi.fn();
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({
            publish,
            read: vi.fn()
        });

        coordinator.reconcileMutation('manga-a', 'generation-b', {
            authority: 'confirmed',
            operationGeneration: 2
        });
        const stale = coordinator.reconcileMutation('manga-a', 'generation-a', {
            authority: 'confirmed',
            operationGeneration: 1
        });

        expect(stale).toEqual({
            generation: 1,
            operationGeneration: 1,
            status: 'ignored-stale'
        });
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledWith('manga-a', 'generation-b');
    });

    it('rejects a same-operation confirmation after a newer local publication', () => {
        const publish = vi.fn();
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({
            publish,
            read: vi.fn()
        });

        coordinator.reconcileMutation('manga-a', 'unconfirmed-a', {
            authority: 'unconfirmed',
            operationGeneration: 1
        });
        coordinator.publishAuthoritative('manga-a', 'newer-local-value');
        const late = coordinator.reconcileMutation('manga-a', 'late-confirmed-a', {
            authority: 'confirmed',
            operationGeneration: 1
        });

        expect(late.status).toBe('ignored-stale');
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledWith('manga-a', 'newer-local-value');
    });

    it('rejects a same-operation confirmation after route cancellation', () => {
        const publish = vi.fn();
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({
            publish,
            read: vi.fn()
        });

        coordinator.reconcileMutation('manga-a', 'unconfirmed-a', {
            authority: 'unconfirmed',
            operationGeneration: 1
        });
        coordinator.cancelAll();

        expect(coordinator.reconcileMutation('manga-a', 'late-confirmed-a', {
            authority: 'confirmed',
            operationGeneration: 1
        }).status).toBe('ignored-stale');
        expect(coordinator.reconcileMutation('manga-a', 'confirmed-b', {
            authority: 'confirmed',
            operationGeneration: 2
        }).status).toBe('published');
        expect(publish).toHaveBeenCalledExactlyOnceWith('manga-a', 'confirmed-b');
    });

    it('rejects a same-operation confirmation after a newer targeted read starts', async () => {
        const pending = deferred<string>();
        const publish = vi.fn();
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({
            publish,
            read: vi.fn(() => pending.promise)
        });

        coordinator.reconcileMutation('manga-a', 'unconfirmed-a', {
            authority: 'unconfirmed',
            operationGeneration: 1
        });
        const newerRead = coordinator.requestReadback('manga-a');
        await Promise.resolve();

        expect(coordinator.reconcileMutation('manga-a', 'late-confirmed-a', {
            authority: 'confirmed',
            operationGeneration: 1
        }).status).toBe('ignored-stale');

        pending.resolve('newer-read-value');
        await expect(newerRead).resolves.toMatchObject({
            status: 'published',
            value: 'newer-read-value'
        });
        expect(publish).toHaveBeenCalledExactlyOnceWith('manga-a', 'newer-read-value');
    });

    it('retires an older pending item read when a newer unconfirmed mutation arrives', async () => {
        const pending = deferred<string>();
        let signal: AbortSignal | undefined;
        const publish = vi.fn();
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({
            publish,
            read: vi.fn((_itemId, options) => {
                signal = options.signal;
                return pending.promise;
            })
        });
        const oldRead = coordinator.requestReadback('manga-a');

        await Promise.resolve();
        const mutation = coordinator.reconcileMutation('manga-a', 'unconfirmed-b', {
            authority: 'unconfirmed',
            operationGeneration: 2
        });
        pending.resolve('late-generation-a');

        expect(mutation.status).toBe('retained-unconfirmed');
        expect(signal?.aborted).toBe(true);
        await expect(oldRead).resolves.toMatchObject({ status: 'cancelled' });
        expect(publish).not.toHaveBeenCalled();
    });

    it('preserves mutation ordering across route cancellation and supports a later reopen', () => {
        const publish = vi.fn();
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({
            publish,
            read: vi.fn()
        });

        coordinator.reconcileMutation('manga-a', 'unconfirmed-b', {
            authority: 'unconfirmed',
            operationGeneration: 2
        });
        coordinator.cancelAll();

        expect(coordinator.reconcileMutation('manga-a', 'late-a', {
            authority: 'confirmed',
            operationGeneration: 1
        }).status).toBe('ignored-stale');
        expect(coordinator.reconcileMutation('manga-a', 'confirmed-c', {
            authority: 'confirmed',
            operationGeneration: 3
        }).status).toBe('published');
        expect(publish).toHaveBeenCalledExactlyOnceWith('manga-a', 'confirmed-c');
    });

    it('coalesces simultaneous readbacks for one item into the same promise', async () => {
        const pending = deferred<string>();
        const publish = vi.fn();
        const read = vi.fn(() => pending.promise);
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({ publish, read });
        const first = coordinator.requestReadback('manga-a');
        const second = coordinator.requestReadback('manga-a');

        expect(second).toBe(first);
        await Promise.resolve();
        expect(read).toHaveBeenCalledTimes(1);

        pending.resolve('fresh-cover');

        await expect(first).resolves.toEqual({
            generation: 1,
            status: 'published',
            value: 'fresh-cover'
        });
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledWith('manga-a', 'fresh-cover');
    });

    it('allows different item readbacks to run concurrently', async () => {
        const requests = new Map<string, Deferred<string>>();
        const publish = vi.fn();
        const read = vi.fn((itemId: string) => {
            const request = deferred<string>();

            requests.set(itemId, request);
            return request.promise;
        });
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({ publish, read });
        const first = coordinator.requestReadback('manga-a');
        const second = coordinator.requestReadback('manga-b');

        await Promise.resolve();
        expect(read).toHaveBeenCalledTimes(2);

        requests.get('manga-b')?.resolve('cover-b');
        await expect(second).resolves.toMatchObject({ status: 'published', value: 'cover-b' });
        expect(publish).toHaveBeenCalledWith('manga-b', 'cover-b');

        requests.get('manga-a')?.resolve('cover-a');
        await expect(first).resolves.toMatchObject({ status: 'published', value: 'cover-a' });
        expect(publish).toHaveBeenCalledWith('manga-a', 'cover-a');
    });

    it('advances generation and retires an older readback on authoritative publish', async () => {
        const pending = deferred<string>();
        let signal: AbortSignal | undefined;
        const publish = vi.fn();
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({
            publish,
            read: vi.fn((_itemId, options) => {
                signal = options.signal;
                return pending.promise;
            })
        });
        const staleReadback = coordinator.requestReadback('manga-a');

        await Promise.resolve();
        expect(coordinator.publishAuthoritative('manga-a', 'authoritative-cover')).toBe(1);
        expect(signal?.aborted).toBe(true);
        expect(coordinator.getGeneration('manga-a')).toBe(1);

        pending.resolve('stale-cover');

        await expect(staleReadback).resolves.toEqual({
            generation: 1,
            status: 'cancelled'
        });
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledWith('manga-a', 'authoritative-cover');
    });

    it('prevents stale completion from publishing over a later reusable readback', async () => {
        const first = deferred<string>();
        const second = deferred<string>();
        const publish = vi.fn();
        const read = vi.fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({ publish, read });
        const staleReadback = coordinator.requestReadback('manga-a');

        await Promise.resolve();
        coordinator.cancelAll();

        const currentReadback = coordinator.requestReadback('manga-a');
        await Promise.resolve();
        second.resolve('current-cover');
        await expect(currentReadback).resolves.toEqual({
            generation: 2,
            status: 'published',
            value: 'current-cover'
        });

        first.resolve('stale-cover');
        await expect(staleReadback).resolves.toEqual({
            generation: 2,
            status: 'cancelled'
        });
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledWith('manga-a', 'current-cover');
    });

    it('treats cancellation as a terminal non-error and never retries', async () => {
        const read = vi.fn((_itemId: string, options: Readonly<{ signal: AbortSignal }>) => waitForAbort(options));
        const publish = vi.fn();
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({ publish, read });
        const request = coordinator.requestReadback('manga-a');

        await Promise.resolve();
        coordinator.cancelAll();

        await expect(request).resolves.toEqual({
            generation: 1,
            status: 'cancelled'
        });
        expect(read).toHaveBeenCalledTimes(1);
        expect(publish).not.toHaveBeenCalled();
    });

    it('returns failures once without an implicit retry', async () => {
        const error = new Error('Server unavailable.');
        const read = vi.fn().mockRejectedValue(error);
        const publish = vi.fn();
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({ publish, read });

        await expect(coordinator.requestReadback('manga-a')).resolves.toEqual({
            error,
            generation: 0,
            status: 'failed'
        });
        expect(read).toHaveBeenCalledTimes(1);
        expect(publish).not.toHaveBeenCalled();
    });

    it('emits only bounded identifier-free diagnostic categories and reasons', async () => {
        const diagnostics: PtvReadingIdentifyReconciliationDiagnostic[] = [];
        const pending = deferred<string>();
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({
            onDiagnostic: event => diagnostics.push(event),
            publish: vi.fn(),
            read: vi.fn(() => pending.promise)
        });
        const first = coordinator.requestReadback('private-media-id');
        const second = coordinator.requestReadback('private-media-id');

        coordinator.publishAuthoritative('private-media-id', 'authoritative');
        pending.resolve('stale');
        await Promise.all([ first, second ]);

        expect(diagnostics).toEqual([
            { category: 'readback', reason: 'started' },
            { category: 'readback', reason: 'coalesced' },
            { category: 'retirement', reason: 'authoritative-publish' },
            { category: 'publication', reason: 'authoritative' }
        ]);
        diagnostics.forEach(event => {
            expect(Object.keys(event)).toEqual([ 'category', 'reason' ]);
            expect(JSON.stringify(event)).not.toContain('private-media-id');
        });
    });

    it('keeps mutation authority diagnostics free of item values and identifiers', () => {
        const diagnostics: PtvReadingIdentifyReconciliationDiagnostic[] = [];
        const coordinator = createPtvReadingIdentifyReconciliationCoordinator({
            onDiagnostic: event => diagnostics.push(event),
            publish: vi.fn(),
            read: vi.fn()
        });

        coordinator.reconcileMutation('private-item-id', 'private-title-and-tags', {
            authority: 'unconfirmed',
            operationGeneration: 1
        });

        expect(diagnostics).toEqual([
            { category: 'mutation', reason: 'unconfirmed' }
        ]);
        expect(JSON.stringify(diagnostics)).not.toContain('private-item-id');
        expect(JSON.stringify(diagnostics)).not.toContain('private-title-and-tags');
    });
});
