export const PTV_DETAIL_LOAD_TIMEOUT_MS = 20_000;

export class PtvDetailLoadTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Details did not finish loading within ${timeoutMs}ms.`);
        this.name = 'PtvDetailLoadTimeoutError';
    }
}

function createPtvDetailAbortError() {
    const error = new Error('Details request was cancelled.');

    error.name = 'AbortError';
    return error;
}

export function awaitPtvDetailLoad<T>(
    promise: Promise<T>,
    options: {
        onTimeout?: () => void;
        signal?: AbortSignal;
        timeoutMs?: number;
    } = {}
): Promise<T> {
    const timeoutMs = options.timeoutMs ?? PTV_DETAIL_LOAD_TIMEOUT_MS;

    if (options.signal?.aborted) {
        return Promise.reject(createPtvDetailAbortError());
    }

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            globalThis.clearTimeout(timeoutId);
            options.signal?.removeEventListener('abort', onAbort);
        };
        const settle = (callback: () => void) => {
            if (settled) return;

            settled = true;
            cleanup();
            callback();
        };
        const onAbort = () => settle(() => reject(createPtvDetailAbortError()));
        const timeoutId = globalThis.setTimeout(() => {
            settle(() => {
                options.onTimeout?.();
                reject(new PtvDetailLoadTimeoutError(timeoutMs));
            });
        }, timeoutMs);

        options.signal?.addEventListener('abort', onAbort, { once: true });
        promise.then(
            value => settle(() => resolve(value)),
            error => settle(() => reject(error))
        );
    });
}

export function clearPtvDetailLoadFailure(page: Element) {
    page.querySelector('.ptv-detail-load-failure')?.remove();
}

export function renderPtvDetailLoadFailure(
    page: Element,
    message: string,
    onRetry: () => void
) {
    clearPtvDetailLoadFailure(page);

    const panel = document.createElement('section');
    const title = document.createElement('strong');
    const description = document.createElement('span');
    const retry = document.createElement('button');
    const host = page.querySelector('.detailPagePrimaryContainer')
        || page.querySelector('.detailPageWrapperContainer')
        || page;

    panel.className = 'ptv-detail-load-failure';
    panel.setAttribute('role', 'alert');
    title.textContent = 'Details need another try';
    description.textContent = message;
    retry.type = 'button';
    retry.className = 'button-submit raised emby-button';
    retry.dataset.ptvFocusKey = 'details:retry';
    retry.textContent = 'Retry';
    retry.addEventListener('click', onRetry, { once: true });
    panel.append(title, description, retry);
    host.append(panel);

    return panel;
}
