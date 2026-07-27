import { PTV_CORE_CONTRACT_VERSION, type PtvCoreContractVersion } from '../contracts/version';
import { redactPtvCoreText } from '../diagnostics/redaction';

export type PtvCoreErrorKind =
    | 'authentication'
    | 'authorization'
    | 'cache'
    | 'cancelled'
    | 'network'
    | 'parsing'
    | 'playback'
    | 'server'
    | 'unknown'
    | 'unsupported-platform'
    | 'validation';

export type PtvCoreError = Readonly<{
    cause?: string;
    code: string;
    contractVersion: PtvCoreContractVersion;
    correlationId?: string;
    developerDetail?: string;
    httpStatus?: number;
    kind: PtvCoreErrorKind;
    message: string;
    operation?: string;
    retryable: boolean;
    timestamp: string;
}>;

export type PtvCoreResult<T> =
    | Readonly<{ success: true; value: T }>
    | Readonly<{ error: PtvCoreError; success: false }>;

export type CreatePtvCoreErrorOptions = Readonly<{
    cause?: unknown;
    code: string;
    correlationId?: string;
    developerDetail?: string;
    httpStatus?: number;
    kind: PtvCoreErrorKind;
    message: string;
    operation?: string;
    retryable?: boolean;
    timestamp?: string;
}>;

const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function getSafeCauseName(cause: unknown): string | undefined {
    if (cause instanceof Error) return cause.name || 'Error';
    if (typeof cause === 'string' && cause.trim()) return redactPtvCoreText(cause, 200);
    if (cause && typeof cause === 'object') {
        const constructorName = (cause as { constructor?: { name?: unknown } }).constructor?.name;
        if (typeof constructorName === 'string' && constructorName) return constructorName;
    }

    return undefined;
}

function isAbortError(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const record = error as { message?: unknown; name?: unknown };
    const name = typeof record.name === 'string' ? record.name : '';
    const message = typeof record.message === 'string' ? record.message.toLowerCase() : '';

    return name === 'AbortError'
        || name === 'CanceledError'
        || message.includes('cancelled')
        || message.includes('canceled');
}

function getHttpStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;

    const record = error as Record<string, unknown>;
    const response = record.response && typeof record.response === 'object' ?
        record.response as Record<string, unknown> :
        undefined;
    const candidate = record.httpStatus ?? record.statusCode ?? record.status ?? response?.status;

    return typeof candidate === 'number' && candidate >= 100 && candidate <= 599 ? candidate : undefined;
}

export function getPtvCoreErrorKindForHttpStatus(status: number): PtvCoreErrorKind {
    if (status === 401) return 'authentication';
    if (status === 403) return 'authorization';

    return 'server';
}

export function createPtvCoreError(options: CreatePtvCoreErrorOptions): PtvCoreError {
    return {
        cause: getSafeCauseName(options.cause),
        code: options.code,
        contractVersion: PTV_CORE_CONTRACT_VERSION,
        correlationId: options.correlationId ?
            redactPtvCoreText(options.correlationId, 200) :
            undefined,
        developerDetail: options.developerDetail ?
            redactPtvCoreText(options.developerDetail, 2000) :
            undefined,
        httpStatus: options.httpStatus,
        kind: options.kind,
        message: redactPtvCoreText(options.message, 500) || 'PiggieTV could not complete the operation.',
        operation: options.operation ? redactPtvCoreText(options.operation, 500) : undefined,
        retryable: options.retryable ?? false,
        timestamp: options.timestamp || new Date().toISOString()
    };
}

function resolvePtvCoreErrorKind(
    explicitKind: PtvCoreErrorKind | undefined,
    cancelled: boolean,
    httpStatus: number | undefined
): PtvCoreErrorKind {
    if (explicitKind) return explicitKind;
    if (cancelled) return 'cancelled';
    if (httpStatus) return getPtvCoreErrorKindForHttpStatus(httpStatus);

    return 'unknown';
}

function resolvePtvCoreErrorCode(
    explicitCode: string | undefined,
    cancelled: boolean,
    httpStatus: number | undefined
) {
    if (explicitCode) return explicitCode;
    if (cancelled) return 'OPERATION_CANCELLED';
    if (httpStatus) return `API_HTTP_${httpStatus}`;

    return 'UNKNOWN_FAILURE';
}

export function toPtvCoreError(
    error: unknown,
    options: Partial<Omit<CreatePtvCoreErrorOptions, 'cause'>> = {}
): PtvCoreError {
    if (isPtvCoreError(error)) return error;

    const httpStatus = options.httpStatus ?? getHttpStatus(error);
    const cancelled = isAbortError(error);
    const kind = resolvePtvCoreErrorKind(options.kind, cancelled, httpStatus);
    const errorMessage = error instanceof Error ? error.message : '';

    return createPtvCoreError({
        cause: error,
        code: resolvePtvCoreErrorCode(options.code, cancelled, httpStatus),
        correlationId: options.correlationId,
        developerDetail: options.developerDetail || errorMessage || undefined,
        httpStatus,
        kind,
        message: options.message || (
            cancelled ? 'The operation was cancelled.' : 'PiggieTV could not complete the operation.'
        ),
        operation: options.operation,
        retryable: options.retryable ?? (
            kind === 'network' || (httpStatus !== undefined && RETRYABLE_HTTP_STATUS.has(httpStatus))
        ),
        timestamp: options.timestamp
    });
}

export function isPtvCoreError(value: unknown): value is PtvCoreError {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<PtvCoreError>;

    return record.contractVersion === PTV_CORE_CONTRACT_VERSION
        && typeof record.code === 'string'
        && typeof record.kind === 'string'
        && typeof record.message === 'string'
        && typeof record.retryable === 'boolean'
        && typeof record.timestamp === 'string';
}

export function ptvCoreSuccess<T>(value: T): PtvCoreResult<T> {
    return { success: true, value };
}

export function ptvCoreFailure<T = never>(error: PtvCoreError): PtvCoreResult<T> {
    return { error, success: false };
}
