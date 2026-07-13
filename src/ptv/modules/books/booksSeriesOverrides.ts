import type {
    PtvReadingSeriesOverride
} from './booksSeries';
import type {
    PtvReadingRouteKind
} from './booksTypes';

const PTV_READING_SERIES_OVERRIDE_VERSION = 1;
const PTV_READING_SERIES_OVERRIDE_KEY_PREFIX = `ptv:reading:series-overrides:v${PTV_READING_SERIES_OVERRIDE_VERSION}:`;

function getOverrideStorageKey(routeKind: PtvReadingRouteKind) {
    return `${PTV_READING_SERIES_OVERRIDE_KEY_PREFIX}${routeKind}`;
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
        seriesKey: readOptionalString(value.seriesKey),
        seriesTitle: readOptionalString(value.seriesTitle),
        seriesYear: readOptionalNumber(value.seriesYear),
        volumeNumber: readOptionalNumber(value.volumeNumber)
    };
}

export function loadPtvReadingSeriesOverrides(routeKind: PtvReadingRouteKind): Record<string, PtvReadingSeriesOverride> {
    if (typeof localStorage === 'undefined') return {};

    try {
        const rawValue = localStorage.getItem(getOverrideStorageKey(routeKind));
        const parsedValue = rawValue ? JSON.parse(rawValue) as unknown : null;

        if (!isRecord(parsedValue)) return {};

        return Object.entries(parsedValue).reduce<Record<string, PtvReadingSeriesOverride>>((overrides, [itemId, value]) => {
            const override = sanitizeOverride(itemId, value);

            if (override) {
                overrides[itemId] = override;
            }

            return overrides;
        }, {});
    } catch {
        return {};
    }
}

export function savePtvReadingSeriesOverrides(
    routeKind: PtvReadingRouteKind,
    overrides: Record<string, PtvReadingSeriesOverride>
) {
    if (typeof localStorage === 'undefined') return;

    try {
        const nextOverrides = Object.fromEntries(Object.entries(overrides).filter(([itemId]) => itemId));

        if (Object.keys(nextOverrides).length) {
            localStorage.setItem(getOverrideStorageKey(routeKind), JSON.stringify(nextOverrides));
        } else {
            localStorage.removeItem(getOverrideStorageKey(routeKind));
        }
    } catch {
        // Non-critical local correction state; ignore storage failures.
    }
}

export function upsertPtvReadingSeriesOverride(
    routeKind: PtvReadingRouteKind,
    override: PtvReadingSeriesOverride
) {
    const overrides = loadPtvReadingSeriesOverrides(routeKind);

    overrides[override.itemId] = override;
    savePtvReadingSeriesOverrides(routeKind, overrides);

    return overrides;
}

export function removePtvReadingSeriesOverride(routeKind: PtvReadingRouteKind, itemId: string) {
    const overrides = loadPtvReadingSeriesOverrides(routeKind);

    delete overrides[itemId];
    savePtvReadingSeriesOverrides(routeKind, overrides);

    return overrides;
}
