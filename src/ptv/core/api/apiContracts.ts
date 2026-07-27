import type { PtvCoreResult } from '../errors/coreError';

export type PtvCoreHttpMethod = 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT';
export type PtvCoreQueryValue = boolean | number | string | readonly (boolean | number | string)[] | null | undefined;

export type PtvCoreApiRequest<TBody = unknown> = Readonly<{
    authenticated?: boolean;
    body?: TBody;
    correlationId?: string;
    headers?: Readonly<Record<string, string>>;
    idempotent?: boolean;
    method: PtvCoreHttpMethod;
    path: string;
    query?: Readonly<Record<string, PtvCoreQueryValue>>;
    signal?: AbortSignal;
    timeoutMs?: number;
}>;

export type PtvCoreApiResponse<T> = Readonly<{
    correlationId?: string;
    durationMs: number;
    headers: Readonly<Record<string, string>>;
    responseBytes?: number;
    status: number;
    value: T;
}>;

export interface PtvCoreApiClient {
    request<TResponse, TBody = unknown>(
        request: PtvCoreApiRequest<TBody>
    ): Promise<PtvCoreResult<PtvCoreApiResponse<TResponse>>>;
}

export type PtvCoreRetryPolicy = Readonly<{
    baseDelayMs: number;
    maxAttempts: number;
    maxDelayMs: number;
    retryableStatuses: ReadonlySet<number>;
}>;

export const DEFAULT_PTV_CORE_RETRY_POLICY: PtvCoreRetryPolicy = {
    baseDelayMs: 250,
    maxAttempts: 3,
    maxDelayMs: 2000,
    retryableStatuses: new Set([408, 425, 429, 500, 502, 503, 504])
};

const SUPPORTED_HTTP_METHODS = new Set<PtvCoreHttpMethod>([
    'DELETE',
    'GET',
    'HEAD',
    'OPTIONS',
    'PATCH',
    'POST',
    'PUT'
]);
const SAFE_HTTP_METHODS = new Set<PtvCoreHttpMethod>(['GET', 'HEAD', 'OPTIONS']);

export function normalizePtvCoreHttpMethod(value: unknown): PtvCoreHttpMethod | null {
    if (typeof value !== 'string') return null;
    const method = value.trim().toUpperCase() as PtvCoreHttpMethod;

    return SUPPORTED_HTTP_METHODS.has(method) ? method : null;
}

export function normalizePtvCoreBaseUrl(value: string): string {
    const trimmed = value.trim();
    const lowerCaseValue = trimmed.toLowerCase();
    if (!lowerCaseValue.startsWith('http://') && !lowerCaseValue.startsWith('https://')) {
        throw new TypeError('PTV Core API base URL must use HTTP or HTTPS.');
    }

    const protocolEnd = trimmed.indexOf('://') + 3;
    const queryIndex = trimmed.indexOf('?', protocolEnd);
    const hashIndex = trimmed.indexOf('#', protocolEnd);
    const boundaryIndexes = [queryIndex, hashIndex].filter(index => index >= 0);
    const contentEnd = boundaryIndexes.length ? Math.min(...boundaryIndexes) : trimmed.length;
    let normalized = trimmed.slice(0, contentEnd);

    if (!normalized.slice(protocolEnd).split('/')[0]) {
        throw new TypeError('PTV Core API base URL must include a host.');
    }
    while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);

    return normalized;
}

export function buildPtvCoreApiUrl(
    baseUrl: string,
    path: string,
    query: Readonly<Record<string, PtvCoreQueryValue>> = {}
): string {
    const normalizedBaseUrl = normalizePtvCoreBaseUrl(baseUrl);
    let normalizedPath = path.trim();
    while (normalizedPath.startsWith('/')) normalizedPath = normalizedPath.slice(1);
    const queryParts: string[] = [];

    Object.entries(query).forEach(([key, rawValue]) => {
        if (rawValue === undefined || rawValue === null || rawValue === '') return;
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        const serialized = values
            .filter(value => value !== '')
            .map(value => String(value))
            .join(',');
        if (serialized) {
            queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(serialized)}`);
        }
    });

    const queryString = queryParts.length ? `?${queryParts.join('&')}` : '';

    return `${normalizedBaseUrl}/${normalizedPath}${queryString}`;
}

export function getPtvCoreAliasedField(
    value: unknown,
    camelCaseKey: string,
    pascalCaseKey = `${camelCaseKey.slice(0, 1).toUpperCase()}${camelCaseKey.slice(1)}`
): unknown {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;

    return record[camelCaseKey] ?? record[pascalCaseKey];
}

export function createPtvCoreRequestHeaders(
    headers: Readonly<Record<string, string>> = {},
    authorization?: Readonly<{ name?: string; value: string }>
): Record<string, string> {
    const result = { ...headers };
    if (authorization?.value.trim()) {
        result[authorization.name || 'Authorization'] = authorization.value;
    }

    return result;
}

export function createPtvCoreRequestCancellation(options: Readonly<{
    signal?: AbortSignal;
    timeoutMs?: number;
}> = {}) {
    const AbortControllerConstructor = globalThis['AbortController'];
    const controller = new AbortControllerConstructor();
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timeoutId = options.timeoutMs !== undefined && options.timeoutMs >= 0 ?
        globalThis.setTimeout(abort, options.timeoutMs) :
        undefined;

    return {
        dispose() {
            if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
            options.signal?.removeEventListener('abort', abort);
        },
        signal: controller.signal
    };
}

export function shouldRetryPtvCoreRequest(options: Readonly<{
    attempt: number;
    explicitIdempotent?: boolean;
    method: PtvCoreHttpMethod;
    policy?: PtvCoreRetryPolicy;
    status?: number;
}>): boolean {
    const policy = options.policy || DEFAULT_PTV_CORE_RETRY_POLICY;
    if (options.attempt >= policy.maxAttempts) return false;
    if (!SAFE_HTTP_METHODS.has(options.method) && options.explicitIdempotent !== true) return false;

    return options.status === undefined || policy.retryableStatuses.has(options.status);
}

export function getPtvCoreRetryDelayMs(
    attempt: number,
    policy: PtvCoreRetryPolicy = DEFAULT_PTV_CORE_RETRY_POLICY
): number {
    const exponentialDelay = policy.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));

    return Math.min(exponentialDelay, policy.maxDelayMs);
}
