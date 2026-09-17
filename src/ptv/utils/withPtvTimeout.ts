export class PtvTimeoutError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'PtvTimeoutError';
    }
}

export function isPtvTimeoutError(error: unknown): error is PtvTimeoutError {
    return typeof error === 'object'
        && error !== null
        && (error as { name?: unknown }).name === 'PtvTimeoutError';
}

function createPtvAbortError(): Error {
    const error = new Error('Request was cancelled.');
    error.name = 'AbortError';
    return error;
}

export function withPtvTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
    onTimeout?: () => void,
    signal?: AbortSignal
): Promise<T> {
    return new Promise((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
            globalThis.clearTimeout(timeoutId);
            signal?.removeEventListener('abort', handleAbort);
        };

        const finish = (callback: () => void) => {
            if (settled) return;

            settled = true;
            cleanup();
            callback();
        };

        const handleAbort = () => {
            finish(() => reject(createPtvAbortError()));
        };

        promise.then(
            value => finish(() => resolve(value)),
            error => finish(() => reject(error))
        );

        signal?.addEventListener('abort', handleAbort, { once: true });
        const timeoutId = globalThis.setTimeout(() => {
            finish(() => {
                try {
                    onTimeout?.();
                } catch (error) {
                    reject(error);
                    return;
                }
                reject(new PtvTimeoutError(message));
            });
        }, timeoutMs);
        if (signal?.aborted) handleAbort();
    });
}
