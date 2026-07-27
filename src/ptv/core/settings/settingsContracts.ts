import type { PtvCoreResult } from '../errors/coreError';
import type { PtvCoreScope } from '../contracts/version';

export type PtvSettingsDocument<TValues extends Record<string, unknown>> = Readonly<{
    schemaVersion: number;
    scope: PtvCoreScope;
    unknownFields: Record<string, unknown>;
    values: TValues;
}>;

export interface PtvCoreSettingsStore<TValues extends Record<string, unknown>> {
    load(scope: PtvCoreScope): Promise<PtvCoreResult<PtvSettingsDocument<TValues>>>;
    migrate(
        document: PtvSettingsDocument<Record<string, unknown>>,
        targetSchemaVersion: number
    ): Promise<PtvCoreResult<PtvSettingsDocument<TValues>>>;
    reset(scope: PtvCoreScope): Promise<PtvCoreResult<void>>;
    save(document: PtvSettingsDocument<TValues>): Promise<PtvCoreResult<void>>;
    validate(values: unknown): PtvCoreResult<TValues>;
}
