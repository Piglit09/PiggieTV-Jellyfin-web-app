import { PTV_CORE_CONTRACT_VERSION, type PtvCoreContractVersion, type PtvCoreScope } from '../contracts/version';

export type PtvFeatureFlagDocument = Readonly<{
    contractVersion: PtvCoreContractVersion;
    schemaVersion: number;
    scope: PtvCoreScope;
    updatedAt?: string;
    values: Record<string, boolean>;
}>;

export function createPtvFeatureFlagDocument(options: Readonly<{
    schemaVersion?: number;
    scope: PtvCoreScope;
    updatedAt?: string;
    values?: Record<string, boolean>;
}>): PtvFeatureFlagDocument {
    return {
        contractVersion: PTV_CORE_CONTRACT_VERSION,
        schemaVersion: options.schemaVersion || 1,
        scope: { ...options.scope },
        updatedAt: options.updatedAt,
        values: { ...options.values }
    };
}

export function getPtvFeatureFlag(
    document: PtvFeatureFlagDocument | null | undefined,
    key: string,
    defaults: Readonly<Record<string, boolean>> = {}
): boolean {
    const stored = document?.values[key];

    return typeof stored === 'boolean' ? stored : defaults[key] === true;
}

export function setPtvFeatureFlag(
    document: PtvFeatureFlagDocument,
    key: string,
    enabled: boolean,
    updatedAt = new Date().toISOString()
): PtvFeatureFlagDocument {
    return {
        ...document,
        updatedAt,
        values: {
            ...document.values,
            [key]: enabled
        }
    };
}
