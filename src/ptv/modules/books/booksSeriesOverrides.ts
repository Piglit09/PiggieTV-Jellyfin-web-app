import type {
    PtvReadingSeriesOverride
} from './booksSeries';
import type {
    PtvReadingRouteKind
} from './booksTypes';
import { getCurrentPtvPluginApiClient } from '../../core/pluginApi';

const PTV_READING_SERIES_OVERRIDE_VERSION = 1;
const PTV_READING_SERIES_OVERRIDE_KEY_PREFIX = `ptv:reading:series-overrides:v${PTV_READING_SERIES_OVERRIDE_VERSION}:`;
const PTV_READING_SERIES_OVERRIDE_MIGRATION_KEY_PREFIX = `ptv:reading:series-overrides:migrated:v${PTV_READING_SERIES_OVERRIDE_VERSION}:`;

type ReadingSeriesOverridesResponse = {
    overrides?: unknown;
    Overrides?: unknown;
};

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

    if (!pluginApi) return cachedOverrides;

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

            return authoritativeOverrides;
        }

        storeCachedOverrides(routeKind, serverOverrides);
        markMigrationCompleted(routeKind);

        return serverOverrides;
    } catch {
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

    if (!pluginApi) return false;

    await pluginApi.saveReadingSeriesOverrides(routeKind, { overrides: nextOverrides });
    markMigrationCompleted(routeKind);

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
