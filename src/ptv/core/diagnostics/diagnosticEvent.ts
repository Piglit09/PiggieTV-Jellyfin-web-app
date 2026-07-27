import {
    PTV_CORE_CONTRACT_VERSION,
    type PtvCoreContractVersion,
    type PtvCorePlatform
} from '../contracts/version';
import type { PtvCoreError } from '../errors/coreError';
import {
    getPtvCoreSerializedSize,
    sanitizePtvCoreMetadata,
    type PtvCoreDiagnosticValue
} from './redaction';

export type PtvDiagnosticCategory =
    | 'api'
    | 'cache'
    | 'crash'
    | 'focus'
    | 'image'
    | 'navigation'
    | 'performance'
    | 'playback'
    | 'reader'
    | 'recommendation'
    | 'startup';

export type PtvDiagnosticEvent = Readonly<{
    appVersion: string;
    category: PtvDiagnosticCategory;
    contractVersion: PtvCoreContractVersion;
    deviceClass: string;
    durationMs?: number;
    errorCode?: string;
    metadata: Record<string, PtvCoreDiagnosticValue>;
    name: string;
    platform: PtvCorePlatform;
    serverIdHash?: string;
    sessionId: string;
    success: boolean;
    timestamp: string;
    userIdHash?: string;
}>;

export type CreatePtvDiagnosticEventOptions = Readonly<{
    appVersion: string;
    category: PtvDiagnosticCategory;
    deviceClass: string;
    durationMs?: number;
    error?: PtvCoreError;
    maxBytes?: number;
    metadata?: unknown;
    name: string;
    platform: PtvCorePlatform;
    serverIdHash?: string;
    sessionId: string;
    success: boolean;
    timestamp?: string;
    userIdHash?: string;
}>;

export function createPtvDiagnosticEvent(options: CreatePtvDiagnosticEventOptions): PtvDiagnosticEvent {
    const event: PtvDiagnosticEvent = {
        appVersion: options.appVersion,
        category: options.category,
        contractVersion: PTV_CORE_CONTRACT_VERSION,
        deviceClass: options.deviceClass,
        durationMs: options.durationMs === undefined ? undefined : Math.max(0, Math.round(options.durationMs)),
        errorCode: options.error?.code,
        metadata: sanitizePtvCoreMetadata(options.metadata),
        name: options.name,
        platform: options.platform,
        serverIdHash: options.serverIdHash,
        sessionId: options.sessionId,
        success: options.success,
        timestamp: options.timestamp || new Date().toISOString(),
        userIdHash: options.userIdHash
    };

    if (options.maxBytes !== undefined && getPtvCoreSerializedSize(event) > options.maxBytes) {
        return {
            ...event,
            metadata: {
                dropped: true,
                reason: 'payload-size-limit'
            }
        };
    }

    return event;
}

export interface PtvDiagnosticSink {
    enabled(): boolean;
    record(event: PtvDiagnosticEvent): Promise<void> | void;
}

export async function recordPtvDiagnosticEventSafely(
    sink: PtvDiagnosticSink,
    event: PtvDiagnosticEvent
): Promise<boolean> {
    if (!sink.enabled()) return false;

    try {
        await sink.record(event);
        return true;
    } catch {
        return false;
    }
}
