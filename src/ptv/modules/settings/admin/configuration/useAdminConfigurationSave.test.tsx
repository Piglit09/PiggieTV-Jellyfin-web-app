import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getAdminConfigurationSaveResourceKey,
    resetAdminConfigurationSaveSettlementsForTests,
    throwIfAdminConfigurationSaveRetired,
    useAdminConfigurationSave
} from './useAdminConfigurationSave';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

type SaveState = ReturnType<typeof useAdminConfigurationSave<number>>;

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function neverSettlingOperation() {
    const state: { signal?: AbortSignal } = {};
    const operation = (signal: AbortSignal) => {
        state.signal = signal;
        return new Promise<number>(() => undefined);
    };
    return { operation, state };
}

function Harness({
    resourceKeys,
    stateRef,
    timeoutMs = 100
}: Readonly<{
    resourceKeys?: readonly string[];
    stateRef: { current?: SaveState };
    timeoutMs?: number;
}>) {
    stateRef.current = useAdminConfigurationSave<number>({
        resourceKeys,
        timeoutMs
    });
    return null;
}

describe('administrator configuration save coordinator', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        resetAdminConfigurationSaveSettlementsForTests();
        container.remove();
    });

    it('rejects publication from a retired save generation', () => {
        expect(() => throwIfAdminConfigurationSaveRetired({
            aborted: false
        } as AbortSignal)).not.toThrow();
        expect(() => throwIfAdminConfigurationSaveRetired({
            aborted: true
        } as AbortSignal)).toThrow(expect.objectContaining({ name: 'AbortError' }));
    });

    it('keeps duplicate requests single-flight and reaches a terminal success state', async () => {
        const pending = deferred<number>();
        const operation = vi.fn(() => pending.promise);
        const stateRef: { current?: SaveState } = {};
        await act(async () => root.render(
            <Harness stateRef={stateRef} />
        ));

        let first!: Promise<number>;
        let second!: Promise<number>;
        await act(async () => {
            first = stateRef.current!.run(operation);
            second = stateRef.current!.run(operation);
            await Promise.resolve();
        });

        expect(first).toBe(second);
        expect(operation).toHaveBeenCalledOnce();
        expect(stateRef.current?.getCurrent()).toBe(first);
        expect(stateRef.current?.saving).toBe(true);

        let result: number | undefined;
        await act(async () => {
            pending.resolve(1);
            result = await first;
        });

        expect(result).toBe(1);
        expect(stateRef.current?.getCurrent()).toBeNull();
        expect(stateRef.current?.saving).toBe(false);
    });

    it('times out the complete operation, aborts its signal, and clears saving', async () => {
        const pending = neverSettlingOperation();
        const stateRef: { current?: SaveState } = {};
        await act(async () => root.render(
            <Harness stateRef={stateRef} timeoutMs={10} />
        ));

        let failure: unknown;
        await act(async () => {
            try {
                await stateRef.current!.run(pending.operation);
            } catch (error) {
                failure = error;
            }
        });

        expect(failure).toMatchObject({
            message: 'The server did not confirm this save in time. Reload the latest values before trying again.',
            name: 'PtvTimeoutError'
        });
        expect(pending.state.signal?.aborted).toBe(true);
        expect(stateRef.current?.getCurrent()).toBeNull();
        expect(stateRef.current?.saving).toBe(false);
    });

    it('aborts an active operation when its owner unmounts', async () => {
        const pending = neverSettlingOperation();
        const stateRef: { current?: SaveState } = {};
        await act(async () => root.render(
            <Harness stateRef={stateRef} />
        ));

        let savePromise!: Promise<number>;
        await act(async () => {
            savePromise = stateRef.current!.run(pending.operation);
            await Promise.resolve();
        });
        let failure: unknown;
        const observedSave = savePromise.catch(error => {
            failure = error;
        });

        await act(async () => {
            root.render(null);
        });
        await observedSave;

        expect(pending.state.signal?.aborted).toBe(true);
        expect(failure).toMatchObject({ name: 'AbortError' });
    });

    it('supports repeated saves without retaining prior mutation state', async () => {
        const operation = vi.fn()
            .mockResolvedValueOnce(1)
            .mockResolvedValueOnce(2);
        const stateRef: { current?: SaveState } = {};
        await act(async () => root.render(
            <Harness stateRef={stateRef} />
        ));

        let first: number | undefined;
        let second: number | undefined;
        await act(async () => {
            first = await stateRef.current!.run(operation);
        });
        await act(async () => {
            second = await stateRef.current!.run(operation);
        });

        expect([ first, second ]).toEqual([ 1, 2 ]);
        expect(operation).toHaveBeenCalledTimes(2);
        expect(stateRef.current?.getCurrent()).toBeNull();
        expect(stateRef.current?.saving).toBe(false);
    });

    it('does not reserve a resource when preflight times out before the write phase', async () => {
        const resourceKey = getAdminConfigurationSaveResourceKey(
            'preflight-server',
            'System/Configuration'
        );
        const preflight = deferred<void>();
        const operation = vi.fn().mockResolvedValue(2);
        const stateRef: { current?: SaveState } = {};
        await act(async () => root.render(
            <Harness
                resourceKeys={[ resourceKey ]}
                stateRef={stateRef}
                timeoutMs={10}
            />
        ));

        await act(async () => {
            await expect(stateRef.current!.run(async () => {
                await preflight.promise;
                return 1;
            })).rejects.toMatchObject({ name: 'PtvTimeoutError' });
        });

        let result: number | undefined;
        await act(async () => {
            result = await stateRef.current!.run(signal => (
                stateRef.current!.runResourceOperation(signal, operation)
            ));
        });

        expect(result).toBe(2);
        expect(operation).toHaveBeenCalledOnce();
        preflight.resolve(undefined);
    });

    it('holds a retry behind a timed-out write until the original request settles', async () => {
        const resourceKey = getAdminConfigurationSaveResourceKey(
            'late-write-server',
            'System/Configuration'
        );
        const lateWrite = deferred<number>();
        const firstOperation = vi.fn(() => lateWrite.promise);
        const retryOperation = vi.fn().mockResolvedValue(2);
        const firstRef: { current?: SaveState } = {};
        const retryRef: { current?: SaveState } = {};
        await act(async () => root.render(<>
            <Harness
                resourceKeys={[ resourceKey ]}
                stateRef={firstRef}
                timeoutMs={10}
            />
            <Harness
                resourceKeys={[ resourceKey ]}
                stateRef={retryRef}
                timeoutMs={250}
            />
        </>));

        await act(async () => {
            await expect(firstRef.current!.run(signal => (
                firstRef.current!.runResourceOperation(signal, firstOperation)
            ))).rejects.toMatchObject({ name: 'PtvTimeoutError' });
        });

        let retry!: Promise<number>;
        await act(async () => {
            retry = retryRef.current!.run(signal => (
                retryRef.current!.runResourceOperation(signal, retryOperation)
            ));
            await Promise.resolve();
        });
        expect(firstOperation).toHaveBeenCalledOnce();
        expect(retryOperation).not.toHaveBeenCalled();

        await act(async () => {
            lateWrite.resolve(1);
            await expect(retry).resolves.toBe(2);
        });
        expect(retryOperation).toHaveBeenCalledOnce();
    });

    it('never starts a queued generation that retires while waiting', async () => {
        const resourceKey = getAdminConfigurationSaveResourceKey(
            'retired-queue-server',
            'System/Configuration'
        );
        const lateWrite = deferred<number>();
        const lateOperation = vi.fn(() => lateWrite.promise);
        const retiredOperation = vi.fn().mockResolvedValue(2);
        const freshOperation = vi.fn().mockResolvedValue(3);
        const firstRef: { current?: SaveState } = {};
        const retiredRef: { current?: SaveState } = {};
        const freshRef: { current?: SaveState } = {};
        await act(async () => root.render(<>
            <Harness
                resourceKeys={[ resourceKey ]}
                stateRef={firstRef}
                timeoutMs={10}
            />
            <Harness
                resourceKeys={[ resourceKey ]}
                stateRef={retiredRef}
                timeoutMs={10}
            />
            <Harness
                resourceKeys={[ resourceKey ]}
                stateRef={freshRef}
                timeoutMs={250}
            />
        </>));

        await act(async () => {
            await expect(firstRef.current!.run(signal => (
                firstRef.current!.runResourceOperation(signal, lateOperation)
            ))).rejects.toMatchObject({ name: 'PtvTimeoutError' });
        });
        await act(async () => {
            await expect(retiredRef.current!.run(signal => (
                retiredRef.current!.runResourceOperation(signal, retiredOperation)
            ))).rejects.toMatchObject({ name: 'PtvTimeoutError' });
        });
        expect(retiredOperation).not.toHaveBeenCalled();

        await act(async () => {
            lateWrite.resolve(1);
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            await expect(freshRef.current!.run(signal => (
                freshRef.current!.runResourceOperation(signal, freshOperation)
            ))).resolves.toBe(3);
        });

        expect(retiredOperation).not.toHaveBeenCalled();
        expect(freshOperation).toHaveBeenCalledOnce();
    });

    it('claims composite resources atomically while unrelated resources remain concurrent', async () => {
        const globalKey = getAdminConfigurationSaveResourceKey(
            'composite-server',
            'System/Configuration'
        );
        const metadataKey = getAdminConfigurationSaveResourceKey(
            'composite-server',
            'System/Configuration/metadata'
        );
        const networkKey = getAdminConfigurationSaveResourceKey(
            'composite-server',
            'System/Configuration/network'
        );
        const compositeWrite = deferred<number>();
        const compositeOperation = vi.fn(() => compositeWrite.promise);
        const globalOperation = vi.fn().mockResolvedValue(2);
        const metadataOperation = vi.fn().mockResolvedValue(3);
        const networkOperation = vi.fn().mockResolvedValue(4);
        const compositeRef: { current?: SaveState } = {};
        const globalRef: { current?: SaveState } = {};
        const metadataRef: { current?: SaveState } = {};
        const networkRef: { current?: SaveState } = {};
        await act(async () => root.render(<>
            <Harness
                resourceKeys={[ globalKey, metadataKey ]}
                stateRef={compositeRef}
                timeoutMs={250}
            />
            <Harness resourceKeys={[ globalKey ]} stateRef={globalRef} timeoutMs={250} />
            <Harness resourceKeys={[ metadataKey ]} stateRef={metadataRef} timeoutMs={250} />
            <Harness resourceKeys={[ networkKey ]} stateRef={networkRef} timeoutMs={250} />
        </>));

        let composite!: Promise<number>;
        await act(async () => {
            composite = compositeRef.current!.run(signal => (
                compositeRef.current!.runResourceOperation(signal, compositeOperation)
            ));
            await Promise.resolve();
        });
        expect(compositeOperation).toHaveBeenCalledOnce();

        let global!: Promise<number>;
        let metadata!: Promise<number>;
        let network!: Promise<number>;
        await act(async () => {
            global = globalRef.current!.run(signal => (
                globalRef.current!.runResourceOperation(signal, globalOperation)
            ));
            metadata = metadataRef.current!.run(signal => (
                metadataRef.current!.runResourceOperation(signal, metadataOperation)
            ));
            network = networkRef.current!.run(signal => (
                networkRef.current!.runResourceOperation(signal, networkOperation)
            ));
            await expect(network).resolves.toBe(4);
        });
        expect(globalOperation).not.toHaveBeenCalled();
        expect(metadataOperation).not.toHaveBeenCalled();
        expect(networkOperation).toHaveBeenCalledOnce();

        await act(async () => {
            compositeWrite.resolve(1);
            await expect(Promise.all([ composite, global, metadata ])).resolves.toEqual([
                1,
                2,
                3
            ]);
        });
        expect(globalOperation).toHaveBeenCalledOnce();
        expect(metadataOperation).toHaveBeenCalledOnce();
    });
});
