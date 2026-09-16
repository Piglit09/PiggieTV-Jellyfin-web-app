import { useCallback, useEffect, useRef, useState } from 'react';

import { isPtvTimeoutError, withPtvTimeout } from '../../../../utils/withPtvTimeout';

export const ADMIN_CONFIGURATION_SAVE_TIMEOUT_MS = 90_000;
export const ADMIN_CONFIGURATION_SAVE_TIMEOUT_MESSAGE =
    'The server did not confirm this save in time. Reload the latest values before trying again.';

type AdminConfigurationSaveOptions = Readonly<{
    createTimeoutError?: (message: string) => Error;
    resourceKeys?: readonly string[];
    timeoutMessage?: string;
    timeoutMs?: number;
}>;

const adminConfigurationResourceSettlements = new Map<string, Promise<void>>();
const EMPTY_ADMIN_CONFIGURATION_RESOURCE_KEYS: readonly string[] = [];

export function getAdminConfigurationSaveResourceKey(
    serverKey: string,
    resource: string
) {
    return JSON.stringify([ serverKey, resource ]);
}

/** Clears process-wide settlement ownership between isolated unit tests. */
export function resetAdminConfigurationSaveSettlementsForTests() {
    adminConfigurationResourceSettlements.clear();
}

function createAdminConfigurationSaveAbortError() {
    const error = new Error('This settings save is no longer active.');
    error.name = 'AbortError';
    return error;
}

/**
 * Prevents work that ignored cancellation from publishing after its save
 * generation timed out, was superseded, or lost its mounted owner.
 */
export function throwIfAdminConfigurationSaveRetired(signal: AbortSignal) {
    if (signal.aborted) throw createAdminConfigurationSaveAbortError();
}

function runSerializedAdminConfigurationSave<T>(
    resourceKeys: readonly string[],
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>
) {
    const keys = [ ...new Set(resourceKeys.filter(Boolean)) ]
        .sort((left, right) => left.localeCompare(right));
    if (!keys.length) return Promise.resolve().then(() => operation(signal));

    const predecessors = [ ...new Set(keys.map(key => (
        adminConfigurationResourceSettlements.get(key)
    )).filter((value): value is Promise<void> => Boolean(value))) ];
    const ready = Promise.all(predecessors).then(() => undefined);
    const current = ready.then(async () => {
        // A queued generation may time out while an older server request is
        // still settling. It must never start after its own UI owner retired.
        throwIfAdminConfigurationSaveRetired(signal);
        const value = await operation(signal);
        throwIfAdminConfigurationSaveRetired(signal);
        return value;
    });
    const settlement = current.then(
        () => undefined,
        () => undefined
    );

    // Claim every underlying resource synchronously. Composite settings pages
    // therefore cannot deadlock or be overtaken through only one of their
    // authoritative documents.
    keys.forEach(key => {
        adminConfigurationResourceSettlements.set(key, settlement);
    });
    void settlement.then(() => {
        keys.forEach(key => {
            if (adminConfigurationResourceSettlements.get(key) === settlement) {
                adminConfigurationResourceSettlements.delete(key);
            }
        });
    });
    return current;
}

/**
 * Owns one bounded administrator-settings save operation at a time.
 *
 * The caller supplies the complete operation, including any query cancellation
 * or baseline work that must finish before the server write. This keeps every
 * phase inside the same deadline and guarantees that saving reaches a terminal
 * state even when one of those phases never settles. The resource helper must
 * wrap only the authoritative write/readback phase so a stalled preflight does
 * not reserve a server resource that it never reached.
 */
export function useAdminConfigurationSave<T>({
    createTimeoutError,
    resourceKeys = EMPTY_ADMIN_CONFIGURATION_RESOURCE_KEYS,
    timeoutMessage = ADMIN_CONFIGURATION_SAVE_TIMEOUT_MESSAGE,
    timeoutMs = ADMIN_CONFIGURATION_SAVE_TIMEOUT_MS
}: AdminConfigurationSaveOptions = {}) {
    const promiseRef = useRef<Promise<T> | null>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);
    const [ saving, setSaving ] = useState(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            controllerRef.current?.abort();
        };
    }, []);

    const run = useCallback((operation: (signal: AbortSignal) => Promise<T>) => {
        if (promiseRef.current) return promiseRef.current;

        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        controllerRef.current = controller;
        if (mountedRef.current) setSaving(true);

        // Deferring the callback converts synchronous failures into a rejected
        // promise while still placing all of its asynchronous work under the
        // timeout established immediately below.
        const operationPromise = Promise.resolve().then(() => (
            operation(controller.signal)
        ));
        const promise = withPtvTimeout(
            operationPromise,
            timeoutMs,
            timeoutMessage,
            () => controller.abort(),
            controller.signal
        ).catch((error: unknown) => {
            if (isPtvTimeoutError(error) && createTimeoutError) {
                throw createTimeoutError(timeoutMessage);
            }
            throw error;
        }).finally(() => {
            if (promiseRef.current === promise) promiseRef.current = null;
            if (controllerRef.current === controller) controllerRef.current = null;
            if (mountedRef.current) setSaving(false);
        });

        promiseRef.current = promise;
        return promise;
    }, [ createTimeoutError, timeoutMessage, timeoutMs ]);

    const runResourceOperation = useCallback(function runResourceOperation<TResult>(
        signal: AbortSignal,
        operation: (signal: AbortSignal) => Promise<TResult>
    ) {
        return runSerializedAdminConfigurationSave(
            resourceKeys,
            signal,
            operation
        );
    }, [ resourceKeys ]);

    const getCurrent = useCallback(() => promiseRef.current, []);

    return { getCurrent, run, runResourceOperation, saving } as const;
}
