import type {
    PtvReadingSeriesOverride
} from './booksSeries';
import type {
    PtvReadingRouteKind
} from './booksTypes';
import { getCurrentPtvPluginApiClient } from '../../core/pluginApi';
import { recordPtvEvent } from '../../core/observability';

const PTV_READING_SERIES_OVERRIDE_VERSION = 1;
const PTV_READING_SERIES_OVERRIDE_KEY_PREFIX = `ptv:reading:series-overrides:v${PTV_READING_SERIES_OVERRIDE_VERSION}:`;
const PTV_READING_SERIES_OVERRIDE_MIGRATION_KEY_PREFIX = `ptv:reading:series-overrides:migrated:v${PTV_READING_SERIES_OVERRIDE_VERSION}:`;

type ReadingSeriesOverridesResponse = {
    overrides?: unknown;
    Overrides?: unknown;
};

export type PtvReadingOverridePersistenceState = Readonly<{
    authority: 'browser-cache' | 'server';
    endpointAvailable: boolean;
    lastCategory: 'endpoint-missing' | 'plugin-unavailable' | 'request-failed' | 'server-confirmed';
    routeKind: PtvReadingRouteKind;
    serverPersistenceConfirmed: boolean;
}>;

const overridePersistenceState = new Map<PtvReadingRouteKind, PtvReadingOverridePersistenceState>();

function setOverridePersistenceState(
    routeKind: PtvReadingRouteKind,
    state: Omit<PtvReadingOverridePersistenceState, 'routeKind'>
) {
    const nextState = { routeKind, ...state };

    overridePersistenceState.set(routeKind, nextState);
    recordPtvEvent('api', 'reading-series-override-persistence-state', nextState);

    return nextState;
}

function getOverrideFailureCategory(error: unknown): PtvReadingOverridePersistenceState['lastCategory'] {
    if (!error || typeof error !== 'object') return 'request-failed';

    let status = 0;

    if ('status' in error) status = Number(error.status);
    else if ('statusCode' in error) status = Number(error.statusCode);

    return status === 404 ? 'endpoint-missing' : 'request-failed';
}

export function getPtvReadingOverridePersistenceState(routeKind: PtvReadingRouteKind) {
    return overridePersistenceState.get(routeKind) || null;
}

function getOverrideStorageKey(routeKind: PtvReadingRouteKind) {
    return `${PTV_READING_SERIES_OVERRIDE_KEY_PREFIX}${routeKind}`;
}

function getOverrideMigrationKey(routeKind: PtvReadingRouteKind) {
    return `${PTV_READING_SERIES_OVERRIDE_MIGRATION_KEY_PREFIX}${routeKind}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readOptionalBoolean(value: unknown) {
    return typeof value === 'boolean' ? value : undefined;
}

function readOptionalNumber(value: unknown) {
    if (value === null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string' || !value.trim()) return undefined;

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeOverride(itemId: string, value: unknown): PtvReadingSeriesOverride | null {
    if (!itemId || !isRecord(value)) return null;

    return {
        coverItemId: readOptionalString(value.coverItemId),
        excluded: readOptionalBoolean(value.excluded),
        issueNumber: readOptionalNumber(value.issueNumber),
        itemId,
        mediaKind: value.mediaKind === 'book' || value.mediaKind === 'comic' || value.mediaKind === 'manga' ? value.mediaKind : undefined,
        seriesKey: readOptionalString(value.seriesKey),
        seriesTitle: readOptionalString(value.seriesTitle),
        seriesYear: readOptionalNumber(value.seriesYear),
        volumeNumber: readOptionalNumber(value.volumeNumber)
    };
}

function sanitizeOverrides(value: unknown) {
    if (!isRecord(value)) return {};

    return Object.entries(value).reduce<Record<string, PtvReadingSeriesOverride>>((overrides, [itemId, entry]) => {
        const override = sanitizeOverride(itemId, entry);

        if (override) overrides[itemId] = override;

        return overrides;
    }, {});
}

function storeCachedOverrides(routeKind: PtvReadingRouteKind, overrides: Record<string, PtvReadingSeriesOverride>) {
    if (typeof localStorage === 'undefined') return;

    try {
        if (Object.keys(overrides).length) {
            localStorage.setItem(getOverrideStorageKey(routeKind), JSON.stringify(overrides));
        } else {
            localStorage.removeItem(getOverrideStorageKey(routeKind));
        }
    } catch {
        // The plugin is authoritative; restricted browser storage must not block it.
    }
}

function hasCompletedMigration(routeKind: PtvReadingRouteKind) {
    if (typeof localStorage === 'undefined') return true;

    try {
        return localStorage.getItem(getOverrideMigrationKey(routeKind)) === 'true';
    } catch {
        return true;
    }
}

function markMigrationCompleted(routeKind: PtvReadingRouteKind) {
    if (typeof localStorage === 'undefined') return;

    try {
        localStorage.setItem(getOverrideMigrationKey(routeKind), 'true');
    } catch {
        // The marker is an optimization only. Server data remains authoritative.
    }
}

export function loadPtvReadingSeriesOverrides(routeKind: PtvReadingRouteKind): Record<string, PtvReadingSeriesOverride> {
    if (typeof localStorage === 'undefined') return {};

    try {
        const rawValue = localStorage.getItem(getOverrideStorageKey(routeKind));
        const parsedValue = rawValue ? JSON.parse(rawValue) as unknown : null;

        if (!isRecord(parsedValue)) return {};

        return sanitizeOverrides(parsedValue);
    } catch {
        return {};
    }
}

export async function loadPtvReadingSeriesOverridesFromServer(
    routeKind: PtvReadingRouteKind
): Promise<Record<string, PtvReadingSeriesOverride>> {
    const cachedOverrides = loadPtvReadingSeriesOverrides(routeKind);
    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi) {
        setOverridePersistenceState(routeKind, {
            authority: 'browser-cache',
            endpointAvailable: false,
            lastCategory: 'plugin-unavailable',
            serverPersistenceConfirmed: false
        });
        return cachedOverrides;
    }

    try {
        const response = await pluginApi.getReadingSeriesOverrides<ReadingSeriesOverridesResponse>(routeKind);
        const serverOverrides = sanitizeOverrides(response?.overrides ?? response?.Overrides);

        if (!Object.keys(serverOverrides).length && Object.keys(cachedOverrides).length && !hasCompletedMigration(routeKind)) {
            const migratedResponse = await pluginApi.saveReadingSeriesOverrides<ReadingSeriesOverridesResponse, { overrides: Record<string, PtvReadingSeriesOverride> }>(
                routeKind,
                { overrides: cachedOverrides }
            );
            const migratedOverrides = sanitizeOverrides(migratedResponse?.overrides ?? migratedResponse?.Overrides);
            const authoritativeOverrides = Object.keys(migratedOverrides).length ? migratedOverrides : cachedOverrides;

            storeCachedOverrides(routeKind, authoritativeOverrides);
            markMigrationCompleted(routeKind);
            setOverridePersistenceState(routeKind, {
                authority: 'server',
                endpointAvailable: true,
                lastCategory: 'server-confirmed',
                serverPersistenceConfirmed: true
            });

            return authoritativeOverrides;
        }

        storeCachedOverrides(routeKind, serverOverrides);
        markMigrationCompleted(routeKind);
        setOverridePersistenceState(routeKind, {
            authority: 'server',
            endpointAvailable: true,
            lastCategory: 'server-confirmed',
            serverPersistenceConfirmed: true
        });

        return serverOverrides;
    } catch (error) {
        const category = getOverrideFailureCategory(error);

        setOverridePersistenceState(routeKind, {
            authority: 'browser-cache',
            endpointAvailable: category !== 'endpoint-missing',
            lastCategory: category,
            serverPersistenceConfirmed: false
        });
        return cachedOverrides;
    }
}

export async function savePtvReadingSeriesOverrides(
    routeKind: PtvReadingRouteKind,
    overrides: Record<string, PtvReadingSeriesOverride>
) {
    const nextOverrides = sanitizeOverrides(overrides);

    storeCachedOverrides(routeKind, nextOverrides);

    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi) {
        setOverridePersistenceState(routeKind, {
            authority: 'browser-cache',
            endpointAvailable: false,
            lastCategory: 'plugin-unavailable',
            serverPersistenceConfirmed: false
        });
        return false;
    }

    try {
        await pluginApi.saveReadingSeriesOverrides(routeKind, { overrides: nextOverrides });
        markMigrationCompleted(routeKind);
        setOverridePersistenceState(routeKind, {
            authority: 'server',
            endpointAvailable: true,
            lastCategory: 'server-confirmed',
            serverPersistenceConfirmed: true
        });
    } catch (error) {
        const category = getOverrideFailureCategory(error);

        setOverridePersistenceState(routeKind, {
            authority: 'browser-cache',
            endpointAvailable: category !== 'endpoint-missing',
            lastCategory: category,
            serverPersistenceConfirmed: false
        });
        throw error;
    }

    return true;
}

export async function upsertPtvReadingSeriesOverride(
    routeKind: PtvReadingRouteKind,
    override: PtvReadingSeriesOverride
) {
    const overrides = loadPtvReadingSeriesOverrides(routeKind);

    overrides[override.itemId] = override;
    await savePtvReadingSeriesOverrides(routeKind, overrides);

    return overrides;
}

export async function removePtvReadingSeriesOverride(routeKind: PtvReadingRouteKind, itemId: string) {
    const overrides = loadPtvReadingSeriesOverrides(routeKind);

    delete overrides[itemId];
    await savePtvReadingSeriesOverrides(routeKind, overrides);

    return overrides;
}
