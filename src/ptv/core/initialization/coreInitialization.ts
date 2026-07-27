import {
    createPtvCoreError,
    toPtvCoreError,
    type PtvCoreError,
    type PtvCoreResult
} from '../errors/coreError';

export const PTV_CORE_INITIALIZATION_STEPS = [
    'environment',
    'device-identity',
    'session',
    'settings',
    'cache',
    'api',
    'diagnostics',
    'navigation',
    'playback',
    'ready'
] as const;

export type PtvCoreInitializationStepName = typeof PTV_CORE_INITIALIZATION_STEPS[number];
export type PtvCoreInitializationStepStatus = 'degraded' | 'failed' | 'skipped' | 'success';
export type PtvCoreInitializationAction = 'none' | 'route-to-login';

export type PtvCoreInitializationStepResult = Readonly<{
    critical: boolean;
    durationMs: number;
    endedAt: string;
    error?: PtvCoreError;
    name: PtvCoreInitializationStepName;
    startedAt: string;
    status: PtvCoreInitializationStepStatus;
}>;

export type PtvCoreInitializationResult = Readonly<{
    action: PtvCoreInitializationAction;
    degraded: boolean;
    error?: PtvCoreError;
    ready: boolean;
    steps: readonly PtvCoreInitializationStepResult[];
}>;

export type PtvCoreInitializationHandler =
    () => Promise<PtvCoreResult<void> | void> | PtvCoreResult<void> | void;

export type PtvCoreInitializationAdapter = Readonly<{
    api?: PtvCoreInitializationHandler;
    cache?: PtvCoreInitializationHandler;
    deviceIdentity?: PtvCoreInitializationHandler;
    diagnostics?: PtvCoreInitializationHandler;
    dispose?: () => Promise<void> | void;
    environment?: PtvCoreInitializationHandler;
    navigation?: PtvCoreInitializationHandler;
    playback?: PtvCoreInitializationHandler;
    session?: PtvCoreInitializationHandler;
    settings?: PtvCoreInitializationHandler;
}>;

export type PtvCoreInitializationEvent =
    | Readonly<{ name: PtvCoreInitializationStepName; type: 'step-started' }>
    | Readonly<{ result: PtvCoreInitializationStepResult; type: 'step-completed' }>
    | Readonly<{ result: PtvCoreInitializationResult; type: 'completed' }>;

const DEFAULT_CRITICAL_STEPS = new Set<PtvCoreInitializationStepName>([
    'api',
    'device-identity',
    'environment',
    'session'
]);

function getHandler(
    adapter: PtvCoreInitializationAdapter,
    name: PtvCoreInitializationStepName
): PtvCoreInitializationHandler | undefined {
    switch (name) {
        case 'device-identity':
            return adapter.deviceIdentity;
        case 'environment':
        case 'session':
        case 'settings':
        case 'cache':
        case 'api':
        case 'diagnostics':
        case 'navigation':
        case 'playback':
            return adapter[name];
        case 'ready':
            return undefined;
        default:
            return undefined;
    }
}

function notify(
    observer: ((event: PtvCoreInitializationEvent) => void) | undefined,
    event: PtvCoreInitializationEvent
) {
    try {
        observer?.(event);
    } catch {
        // Observers are diagnostic only and cannot control initialization.
    }
}

function skippedStep(
    name: PtvCoreInitializationStepName,
    criticalSteps: ReadonlySet<PtvCoreInitializationStepName>
): PtvCoreInitializationStepResult {
    const timestamp = new Date().toISOString();

    return {
        critical: criticalSteps.has(name),
        durationMs: 0,
        endedAt: timestamp,
        name,
        startedAt: timestamp,
        status: 'skipped'
    };
}

async function executeInitializationStep(
    name: PtvCoreInitializationStepName,
    handler: PtvCoreInitializationHandler | undefined,
    critical: boolean
): Promise<PtvCoreInitializationStepResult> {
    const startedAtMs = Date.now();
    let error: PtvCoreError | undefined;
    let status: PtvCoreInitializationStepStatus = 'success';

    if (name !== 'ready' && !handler) {
        status = 'skipped';
    } else if (handler) {
        try {
            const handlerResult = await handler();
            if (handlerResult && !handlerResult.success) {
                error = handlerResult.error;
                status = critical ? 'failed' : 'degraded';
            }
        } catch (handlerError) {
            error = toPtvCoreError(handlerError, {
                code: 'CORE_INITIALIZATION_STEP_FAILED',
                message: 'PiggieTV could not finish starting.',
                operation: `core-initialization:${name}`
            });
            status = critical ? 'failed' : 'degraded';
        }
    }

    if (error?.kind === 'authentication') status = 'failed';
    const endedAtMs = Date.now();

    return {
        critical,
        durationMs: Math.max(0, endedAtMs - startedAtMs),
        endedAt: new Date(endedAtMs).toISOString(),
        error,
        name,
        startedAt: new Date(startedAtMs).toISOString(),
        status
    };
}

function getTerminalInitializationError(
    result: PtvCoreInitializationStepResult
): PtvCoreError {
    return result.error || createPtvCoreError({
        code: 'CORE_INITIALIZATION_STEP_FAILED',
        kind: 'unknown',
        message: 'PiggieTV could not finish starting.',
        operation: `core-initialization:${result.name}`
    });
}

export function createPtvCoreInitializer(
    adapter: PtvCoreInitializationAdapter,
    options: Readonly<{
        criticalSteps?: ReadonlySet<PtvCoreInitializationStepName>;
        observer?: (event: PtvCoreInitializationEvent) => void;
    }> = {}
) {
    const criticalSteps = options.criticalSteps || DEFAULT_CRITICAL_STEPS;
    let completed: PtvCoreInitializationResult | null = null;
    let inFlight: Promise<PtvCoreInitializationResult> | null = null;

    const run = async (): Promise<PtvCoreInitializationResult> => {
        const results: PtvCoreInitializationStepResult[] = [];
        let action: PtvCoreInitializationAction = 'none';
        let terminalError: PtvCoreError | undefined;
        let stopped = false;

        for (const name of PTV_CORE_INITIALIZATION_STEPS) {
            let result: PtvCoreInitializationStepResult;
            if (stopped) {
                result = skippedStep(name, criticalSteps);
            } else {
                notify(options.observer, { name, type: 'step-started' });
                result = await executeInitializationStep(
                    name,
                    getHandler(adapter, name),
                    criticalSteps.has(name)
                );
            }

            if (result.status === 'failed') {
                terminalError = getTerminalInitializationError(result);
                if (result.error?.kind === 'authentication') action = 'route-to-login';
                stopped = true;
            }

            results.push(result);
            notify(options.observer, { result, type: 'step-completed' });
        }

        const result: PtvCoreInitializationResult = {
            action,
            degraded: results.some(step => step.status === 'degraded'),
            error: terminalError,
            ready: !terminalError && results.some(step => step.name === 'ready' && step.status === 'success'),
            steps: results
        };
        notify(options.observer, { result, type: 'completed' });
        completed = result;

        return result;
    };

    return {
        async dispose() {
            await adapter.dispose?.();
            completed = null;
            inFlight = null;
        },
        getResult() {
            return completed;
        },
        initialize(): Promise<PtvCoreInitializationResult> {
            if (completed) return Promise.resolve(completed);
            if (!inFlight) {
                inFlight = run().finally(() => {
                    inFlight = null;
                });
            }

            return inFlight;
        }
    };
}
