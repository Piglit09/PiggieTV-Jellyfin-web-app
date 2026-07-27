import {
    createPtvNavigationIntent,
    type PtvNavigationIntent
} from './navigationIntent';
import {
    createPtvCoreError,
    ptvCoreFailure,
    ptvCoreSuccess,
    type PtvCoreResult
} from '../errors/coreError';

export type PtvWebNavigationDiagnostic = Readonly<{
    adapterSuccess: boolean;
    coreErrorCode: string | null;
    destination: string;
    durationMs: number;
    hasLibraryId: boolean;
    hasMediaId: boolean;
    sourceFeature: string;
}>;

export type PtvWebNavigationExecutor = (route: string) => Promise<unknown> | unknown;

function navigationAdapterError(code: string, message: string, detail?: string) {
    return createPtvCoreError({
        code,
        developerDetail: detail,
        kind: 'validation',
        message,
        operation: 'web-navigation-adapter'
    });
}

function encodeQueryEntry(key: string, value: string) {
    return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function recordNavigationDiagnosticSafely(
    diagnostic: ((value: PtvWebNavigationDiagnostic) => void) | undefined,
    value: PtvWebNavigationDiagnostic
) {
    try {
        diagnostic?.(value);
    } catch {
        // Diagnostics are deliberately nonblocking.
    }
}

export function buildPtvWebNavigationRoute(intent: PtvNavigationIntent): PtvCoreResult<string> {
    const validated = createPtvNavigationIntent(intent);
    if (!validated.success) return validated;
    if (validated.value.destination !== 'details') {
        return ptvCoreFailure(navigationAdapterError(
            'NAVIGATION_DESTINATION_UNSUPPORTED',
            'The web adapter does not support that destination.',
            validated.value.destination
        ));
    }

    const queryEntries: string[] = [
        encodeQueryEntry('id', validated.value.mediaId || '')
    ];
    const query = { ...validated.value.query };
    const hasLibraryQuery = ['libraryId', 'parentId', 'topParentId']
        .some(key => Object.prototype.hasOwnProperty.call(query, key));

    if (validated.value.libraryId && !hasLibraryQuery) {
        queryEntries.push(encodeQueryEntry('parentId', validated.value.libraryId));
    }
    Object.entries(query).forEach(([key, value]) => {
        if (['id', 'itemId', 'mediaId'].includes(key)) return;
        queryEntries.push(encodeQueryEntry(key, value));
    });

    return ptvCoreSuccess(`#/details?${queryEntries.join('&')}`);
}

export async function executePtvWebNavigationIntent(
    intent: PtvNavigationIntent,
    options: Readonly<{
        diagnostic?: (value: PtvWebNavigationDiagnostic) => void;
        navigate: PtvWebNavigationExecutor;
        sourceFeature: string;
    }>
): Promise<PtvCoreResult<string>> {
    const startedAt = performance.now();
    const route = buildPtvWebNavigationRoute(intent);

    if (!route.success) {
        recordNavigationDiagnosticSafely(options.diagnostic, {
            adapterSuccess: false,
            coreErrorCode: route.error.code,
            destination: intent.destination,
            durationMs: Math.max(0, performance.now() - startedAt),
            hasLibraryId: Boolean(intent.libraryId),
            hasMediaId: Boolean(intent.mediaId),
            sourceFeature: options.sourceFeature
        });

        return route;
    }

    try {
        await options.navigate(route.value);
        recordNavigationDiagnosticSafely(options.diagnostic, {
            adapterSuccess: true,
            coreErrorCode: null,
            destination: intent.destination,
            durationMs: Math.max(0, performance.now() - startedAt),
            hasLibraryId: Boolean(intent.libraryId),
            hasMediaId: Boolean(intent.mediaId),
            sourceFeature: options.sourceFeature
        });

        return route;
    } catch (error) {
        const coreError = createPtvCoreError({
            cause: error,
            code: 'NAVIGATION_ADAPTER_FAILED',
            kind: 'unknown',
            message: 'PiggieTV could not open that destination.',
            operation: 'web-navigation-adapter'
        });
        recordNavigationDiagnosticSafely(options.diagnostic, {
            adapterSuccess: false,
            coreErrorCode: coreError.code,
            destination: intent.destination,
            durationMs: Math.max(0, performance.now() - startedAt),
            hasLibraryId: Boolean(intent.libraryId),
            hasMediaId: Boolean(intent.mediaId),
            sourceFeature: options.sourceFeature
        });

        return ptvCoreFailure(coreError);
    }
}

export function createPtvWebDetailsIntent(options: Readonly<{
    backBehavior?: PtvNavigationIntent['backBehavior'];
    libraryId?: string;
    mediaId?: string;
    query?: Readonly<Record<string, string>>;
    requiredCapabilities?: readonly string[];
}>) {
    return createPtvNavigationIntent({
        backBehavior: options.backBehavior || 'preserve',
        destination: 'details',
        libraryId: options.libraryId,
        mediaId: options.mediaId,
        query: options.query,
        requiredCapabilities: options.requiredCapabilities
    });
}

export async function executePtvWebDetailsNavigation(options: Readonly<{
    backBehavior?: PtvNavigationIntent['backBehavior'];
    diagnostic?: (value: PtvWebNavigationDiagnostic) => void;
    libraryId?: string;
    mediaId?: string;
    navigate: PtvWebNavigationExecutor;
    query?: Readonly<Record<string, string>>;
    requiredCapabilities?: readonly string[];
    sourceFeature: string;
}>): Promise<PtvCoreResult<string>> {
    const startedAt = performance.now();
    const intent = createPtvWebDetailsIntent(options);

    if (!intent.success) {
        recordNavigationDiagnosticSafely(options.diagnostic, {
            adapterSuccess: false,
            coreErrorCode: intent.error.code,
            destination: 'details',
            durationMs: Math.max(0, performance.now() - startedAt),
            hasLibraryId: Boolean(options.libraryId),
            hasMediaId: Boolean(options.mediaId),
            sourceFeature: options.sourceFeature
        });

        return intent;
    }

    return executePtvWebNavigationIntent(intent.value, options);
}
