import {
    getPtvCoreAliasedField,
    type PtvCoreApiResponse
} from './apiContracts';
import {
    createPtvCoreError,
    getPtvCoreErrorKindForHttpStatus,
    ptvCoreFailure,
    ptvCoreSuccess,
    toPtvCoreError,
    type PtvCoreError,
    type PtvCoreResult
} from '../errors/coreError';
import {
    jellyfinTicksToMilliseconds,
    normalizePtvCoreMediaType,
    type PtvMediaIdentity
} from '../media/mediaContracts';

export const PTV_ITEM_DETAILS_OPERATION = 'jellyfin-item-details';
export const PTV_ITEM_DETAILS_ROUTE_IDENTIFIER = 'jellyfin:item-details';

export type PtvCoreItemDetails<TItem> = Readonly<{
    item: TItem;
    media: PtvMediaIdentity;
    runtimeMs?: number;
}>;

export type PtvItemDetailsApiDiagnostic = Readonly<{
    coreErrorCode: string | null;
    durationMs: number;
    method: 'GET';
    operationName: typeof PTV_ITEM_DETAILS_OPERATION;
    requestId: string;
    responseSize: number | null;
    routeIdentifier: typeof PTV_ITEM_DETAILS_ROUTE_IDENTIFIER;
    status: number | null;
    success: boolean;
}>;

export type ExecutePtvItemDetailsBoundaryOptions = Readonly<{
    diagnostic?: (diagnostic: PtvItemDetailsApiDiagnostic) => void;
    requestId: string;
    serverId?: string;
    transport: () => Promise<unknown>;
    userId?: string;
}>;

function getRequiredOpaqueId(value: unknown): string | null {
    const id = getPtvCoreAliasedField(value, 'id');

    return typeof id === 'string' && id.trim() ? id : null;
}

function getOptionalString(value: unknown, camelCaseKey: string): string | undefined {
    const candidate = getPtvCoreAliasedField(value, camelCaseKey);

    return typeof candidate === 'string' && candidate.trim() ? candidate : undefined;
}

function getSerializedSize(value: unknown): number | undefined {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
        return undefined;
    }
}

function getErrorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const record = error as Record<string, unknown>;
    const response = record.response && typeof record.response === 'object' ?
        record.response as Record<string, unknown> :
        undefined;
    const coreError = record.coreError && typeof record.coreError === 'object' ?
        record.coreError as Record<string, unknown> :
        undefined;
    const status = record.statusCode
        ?? record.status
        ?? response?.status
        ?? coreError?.httpStatus;

    return typeof status === 'number' && status >= 100 && status <= 599 ? status : undefined;
}

function isTimeoutError(error: unknown) {
    if (!error || typeof error !== 'object') return false;
    const record = error as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.toLowerCase() : '';
    const message = typeof record.message === 'string' ? record.message.toLowerCase() : '';

    return name === 'timeouterror' || message.includes('timeout') || message.includes('timed out');
}

function mapItemDetailsError(error: unknown, requestId: string): PtvCoreError {
    const cancelled = toPtvCoreError(error, {
        correlationId: requestId,
        operation: PTV_ITEM_DETAILS_OPERATION
    });
    if (cancelled.kind === 'cancelled') return cancelled;

    const status = getErrorStatus(error);
    const timedOut = isTimeoutError(error);
    let code = 'API_NETWORK_FAILURE';
    if (status) code = `API_HTTP_${status}`;
    else if (timedOut) code = 'API_TIMEOUT';

    return createPtvCoreError({
        cause: error,
        code,
        correlationId: requestId,
        httpStatus: status,
        kind: status ? getPtvCoreErrorKindForHttpStatus(status) : 'network',
        message: timedOut ? 'The item details request timed out.' : 'PiggieTV could not load item details.',
        operation: PTV_ITEM_DETAILS_OPERATION,
        retryable: timedOut || status === undefined || status === 408 || status === 429 || status >= 500
    });
}

function recordDiagnosticSafely(
    diagnostic: ExecutePtvItemDetailsBoundaryOptions['diagnostic'],
    value: PtvItemDetailsApiDiagnostic
) {
    try {
        diagnostic?.(value);
    } catch {
        // Diagnostics are deliberately nonblocking.
    }
}

export function normalizePtvItemDetailsResponse<TItem>(
    response: unknown,
    options: Readonly<{
        requestId?: string;
        serverId?: string;
        userId?: string;
    }> = {}
): PtvCoreResult<PtvCoreItemDetails<TItem>> {
    const id = getRequiredOpaqueId(response);
    if (!id) {
        return ptvCoreFailure(createPtvCoreError({
            code: 'API_ITEM_DETAILS_ID_INVALID',
            correlationId: options.requestId,
            kind: 'parsing',
            message: 'The item details response did not contain a valid media ID.',
            operation: PTV_ITEM_DETAILS_OPERATION
        }));
    }

    const rawRuntimeTicks = getPtvCoreAliasedField(response, 'runTimeTicks');
    const responseServerId = getOptionalString(response, 'serverId');
    const responseUserId = getOptionalString(response, 'userId');

    return ptvCoreSuccess({
        item: response as TItem,
        media: {
            id,
            libraryId: getOptionalString(response, 'parentId'),
            mediaType: normalizePtvCoreMediaType(getPtvCoreAliasedField(response, 'type')),
            originalMediaType: getOptionalString(response, 'type'),
            serverId: responseServerId || options.serverId || '',
            sortTitle: getOptionalString(response, 'sortName'),
            title: getOptionalString(response, 'name') || '',
            userId: responseUserId || options.userId
        },
        runtimeMs: rawRuntimeTicks === undefined || rawRuntimeTicks === null ?
            undefined :
            jellyfinTicksToMilliseconds(rawRuntimeTicks)
    });
}

export async function executePtvItemDetailsApiBoundary<TItem>(
    options: ExecutePtvItemDetailsBoundaryOptions
): Promise<PtvCoreResult<PtvCoreApiResponse<PtvCoreItemDetails<TItem>>>> {
    const startedAt = performance.now();
    let status: number | undefined;

    try {
        const response = await options.transport();
        const durationMs = Math.max(0, performance.now() - startedAt);
        const normalized = normalizePtvItemDetailsResponse<TItem>(response, options);

        if (!normalized.success) {
            recordDiagnosticSafely(options.diagnostic, {
                coreErrorCode: normalized.error.code,
                durationMs,
                method: 'GET',
                operationName: PTV_ITEM_DETAILS_OPERATION,
                requestId: options.requestId,
                responseSize: getSerializedSize(response) ?? null,
                routeIdentifier: PTV_ITEM_DETAILS_ROUTE_IDENTIFIER,
                status: 200,
                success: false
            });

            return normalized;
        }

        const responseBytes = getSerializedSize(response);
        recordDiagnosticSafely(options.diagnostic, {
            coreErrorCode: null,
            durationMs,
            method: 'GET',
            operationName: PTV_ITEM_DETAILS_OPERATION,
            requestId: options.requestId,
            responseSize: responseBytes ?? null,
            routeIdentifier: PTV_ITEM_DETAILS_ROUTE_IDENTIFIER,
            status: 200,
            success: true
        });

        return ptvCoreSuccess({
            correlationId: options.requestId,
            durationMs,
            headers: {},
            responseBytes,
            status: 200,
            value: normalized.value
        });
    } catch (error) {
        status = getErrorStatus(error);
        const durationMs = Math.max(0, performance.now() - startedAt);
        const coreError = mapItemDetailsError(error, options.requestId);

        recordDiagnosticSafely(options.diagnostic, {
            coreErrorCode: coreError.code,
            durationMs,
            method: 'GET',
            operationName: PTV_ITEM_DETAILS_OPERATION,
            requestId: options.requestId,
            responseSize: null,
            routeIdentifier: PTV_ITEM_DETAILS_ROUTE_IDENTIFIER,
            status: status ?? null,
            success: false
        });

        return ptvCoreFailure(coreError);
    }
}
