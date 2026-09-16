import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
    getCurrentPtvPluginApiClient,
    normalizePtvApiError
} from '../../core/pluginApi';

const ARR_CALENDAR_CACHE_TTL_MS = 60_000;
const ARR_CALENDAR_RETRY_BASE_MS = 5_000;
const ARR_CALENDAR_MAX_AUTOMATIC_RETRIES = 2;
const ARR_CALENDAR_SERVICES = ['sonarr', 'radarr', 'lidarr'] as const;

type PtvArrCalendarAvailabilityService = {
    configured?: boolean;
    enabled?: boolean;
    service?: string | null;
    supported?: boolean;
};

export type PtvArrCalendarAvailabilityResponse = {
    capability?: {
        available?: boolean;
        canonicalRoute?: string | null;
        compatibilityRoute?: string | null;
    };
    error?: string | null;
    message?: string | null;
    ok?: boolean;
    services?: PtvArrCalendarAvailabilityService[];
};

export type PtvArrCalendarAvailabilitySnapshot = {
    capabilityAvailable: boolean;
    configuredServices: string[];
    error: string;
    identityKey: string;
    showEntry: boolean;
    status: 'idle' | 'loading' | 'available' | 'not-configured' | 'unsupported' | 'error';
};

type PtvArrCalendarAvailabilityEntry = {
    automaticRetryTimer: ReturnType<typeof setTimeout> | null;
    expiresAt: number;
    failureCount: number;
    generation: number;
    listeners: Set<() => void>;
    nextRetryAt: number;
    promise: Promise<PtvArrCalendarAvailabilitySnapshot> | null;
    snapshot: PtvArrCalendarAvailabilitySnapshot;
};

const availabilityByIdentity = new Map<string, PtvArrCalendarAvailabilityEntry>();

type PtvCalendarPluginApiClient = NonNullable<ReturnType<typeof getCurrentPtvPluginApiClient>>;

function getCalendarIdentityKey(pluginApi: PtvCalendarPluginApiClient | null = getCurrentPtvPluginApiClient()) {
    if (!pluginApi) return '';

    const serverId = pluginApi.getCurrentServerId()?.trim();
    const userId = pluginApi.getCurrentUserId()?.trim();

    return serverId && userId ? `${serverId}:${userId}` : '';
}

function createIdleSnapshot(identityKey: string): PtvArrCalendarAvailabilitySnapshot {
    return {
        capabilityAvailable: false,
        configuredServices: [],
        error: '',
        identityKey,
        showEntry: false,
        status: 'idle'
    };
}

const EMPTY_AVAILABILITY_SNAPSHOT = createIdleSnapshot('');

function getAvailabilityEntry(identityKey: string) {
    let entry = availabilityByIdentity.get(identityKey);

    if (!entry) {
        entry = {
            automaticRetryTimer: null,
            expiresAt: 0,
            failureCount: 0,
            generation: 0,
            listeners: new Set(),
            nextRetryAt: 0,
            promise: null,
            snapshot: createIdleSnapshot(identityKey)
        };
        availabilityByIdentity.set(identityKey, entry);
    }

    return entry;
}

function clearAutomaticRetry(entry: PtvArrCalendarAvailabilityEntry) {
    if (entry.automaticRetryTimer !== null) {
        clearTimeout(entry.automaticRetryTimer);
        entry.automaticRetryTimer = null;
    }
}

function retryAvailabilityIfDue(identityKey: string) {
    const entry = availabilityByIdentity.get(identityKey);

    if (
        !entry
        || entry.promise
        || entry.snapshot.status !== 'error'
        || entry.nextRetryAt > Date.now()
        || getCalendarIdentityKey() !== identityKey
    ) {
        return;
    }

    void refreshPtvArrCalendarAvailability(false);
}

function scheduleAutomaticRetry(
    identityKey: string,
    entry: PtvArrCalendarAvailabilityEntry
) {
    clearAutomaticRetry(entry);

    if (
        entry.listeners.size === 0
        || entry.snapshot.status !== 'error'
        || entry.failureCount > ARR_CALENDAR_MAX_AUTOMATIC_RETRIES
    ) {
        return;
    }

    const delay = Math.max(0, entry.nextRetryAt - Date.now());
    entry.automaticRetryTimer = setTimeout(() => {
        entry.automaticRetryTimer = null;
        retryAvailabilityIfDue(identityKey);
    }, delay);
}

function publishAvailability(
    entry: PtvArrCalendarAvailabilityEntry,
    snapshot: PtvArrCalendarAvailabilitySnapshot
) {
    entry.snapshot = snapshot;
    entry.listeners.forEach(listener => {
        listener();
    });
}

function isCalendarEndpointAdvertised(status: PtvArrCalendarAvailabilityResponse) {
    if (status.capability?.available !== true) return false;

    const routes = [status.capability.canonicalRoute, status.capability.compatibilityRoute]
        .filter((route): route is string => typeof route === 'string')
        .map(route => route.trim().toLowerCase());

    return routes.some(route => (
        route === '/ptv/v1/calendar'
        || route === '/ptv/v1/integrations/arr/calendar'
    ));
}

function isConfiguredCalendarService(service: PtvArrCalendarAvailabilityService | undefined) {
    return Boolean(
        service
        && service.supported === true
        && service.enabled === true
        && service.configured === true
    );
}

export function normalizePtvArrCalendarAvailability(
    identityKey: string,
    response: PtvArrCalendarAvailabilityResponse
): PtvArrCalendarAvailabilitySnapshot {
    if (response.ok === false) {
        throw new Error(response.error || response.message || 'PiggieTV integration status is unavailable.');
    }

    const capabilityAvailable = isCalendarEndpointAdvertised(response);
    const servicesByName = new Map(
        (response.services || []).map(service => [service.service?.toLowerCase(), service])
    );
    const configuredServices = ARR_CALENDAR_SERVICES.filter(serviceName => (
        isConfiguredCalendarService(servicesByName.get(serviceName))
    ));

    if (!capabilityAvailable) {
        return {
            capabilityAvailable: false,
            configuredServices,
            error: '',
            identityKey,
            showEntry: false,
            status: 'unsupported'
        };
    }

    if (!configuredServices.length) {
        return {
            capabilityAvailable: true,
            configuredServices: [],
            error: '',
            identityKey,
            showEntry: false,
            status: 'not-configured'
        };
    }

    return {
        capabilityAvailable: true,
        configuredServices,
        error: '',
        identityKey,
        showEntry: true,
        status: 'available'
    };
}

function getCalendarAvailabilityErrorMessage(error: unknown) {
    return normalizePtvApiError(error).message || 'PiggieTV integration status is unavailable.';
}

export function getPtvArrCalendarAvailabilitySnapshot(identityKey = getCalendarIdentityKey()) {
    if (!identityKey) return EMPTY_AVAILABILITY_SNAPSHOT;

    return getAvailabilityEntry(identityKey).snapshot;
}

export function subscribePtvArrCalendarAvailability(
    identityKey: string,
    listener: () => void
) {
    if (!identityKey) return () => undefined;

    const entry = getAvailabilityEntry(identityKey);
    entry.listeners.add(listener);
    scheduleAutomaticRetry(identityKey, entry);

    return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) clearAutomaticRetry(entry);
    };
}

export function refreshPtvArrCalendarAvailability(force = false) {
    const pluginApi = getCurrentPtvPluginApiClient();
    const identityKey = getCalendarIdentityKey(pluginApi);

    if (!pluginApi || !identityKey) return Promise.resolve(EMPTY_AVAILABILITY_SNAPSHOT);

    const entry = getAvailabilityEntry(identityKey);
    const now = Date.now();

    if (entry.promise) return entry.promise;
    if (!force && entry.expiresAt > now && entry.snapshot.status !== 'error') {
        return Promise.resolve(entry.snapshot);
    }

    const requestGeneration = ++entry.generation;
    clearAutomaticRetry(entry);
    publishAvailability(entry, {
        ...entry.snapshot,
        error: '',
        identityKey,
        status: 'loading'
    });

    const request = pluginApi.getArrCalendarAvailability<PtvArrCalendarAvailabilityResponse>(
        force ? { bypassCache: true } : undefined
    )
        .then(response => normalizePtvArrCalendarAvailability(identityKey, response))
        .then(snapshot => {
            if (entry.generation !== requestGeneration) return entry.snapshot;

            entry.failureCount = 0;
            entry.nextRetryAt = 0;
            entry.expiresAt = Date.now() + ARR_CALENDAR_CACHE_TTL_MS;
            publishAvailability(entry, snapshot);
            return snapshot;
        })
        .catch((error: unknown) => {
            if (entry.generation !== requestGeneration) return entry.snapshot;

            const snapshot: PtvArrCalendarAvailabilitySnapshot = {
                ...entry.snapshot,
                error: getCalendarAvailabilityErrorMessage(error),
                identityKey,
                status: 'error'
            };
            entry.failureCount += 1;
            entry.nextRetryAt = Date.now() + (
                ARR_CALENDAR_RETRY_BASE_MS * (2 ** Math.min(entry.failureCount - 1, 3))
            );
            entry.expiresAt = 0;
            publishAvailability(entry, snapshot);
            scheduleAutomaticRetry(identityKey, entry);
            return snapshot;
        })
        .finally(() => {
            if (entry.generation === requestGeneration) entry.promise = null;
        });

    entry.promise = request;
    return request;
}

export function invalidatePtvArrCalendarAvailability() {
    const identityKey = getCalendarIdentityKey();

    if (!identityKey) return Promise.resolve(EMPTY_AVAILABILITY_SNAPSHOT);

    const entry = getAvailabilityEntry(identityKey);
    clearAutomaticRetry(entry);
    entry.expiresAt = 0;
    entry.failureCount = 0;
    entry.generation += 1;
    entry.nextRetryAt = 0;
    entry.promise = null;

    return refreshPtvArrCalendarAvailability(true);
}

export function usePtvArrCalendarAvailability() {
    const identityKey = getCalendarIdentityKey();
    const subscribe = useCallback(
        (listener: () => void) => subscribePtvArrCalendarAvailability(identityKey, listener),
        [identityKey]
    );
    const getSnapshot = useCallback(
        () => getPtvArrCalendarAvailabilitySnapshot(identityKey),
        [identityKey]
    );
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    useEffect(() => {
        if (identityKey) void refreshPtvArrCalendarAvailability(false);
    }, [identityKey]);

    useEffect(() => {
        if (!identityKey || typeof window === 'undefined') return undefined;

        const retryWhenRelevant = () => retryAvailabilityIfDue(identityKey);
        window.addEventListener('focus', retryWhenRelevant);
        window.addEventListener('online', retryWhenRelevant);

        return () => {
            window.removeEventListener('focus', retryWhenRelevant);
            window.removeEventListener('online', retryWhenRelevant);
        };
    }, [identityKey]);

    return snapshot;
}

export function resetPtvArrCalendarAvailabilityForTests() {
    availabilityByIdentity.forEach(entry => {
        clearAutomaticRetry(entry);
        entry.generation += 1;
        entry.promise = null;
        entry.listeners.clear();
    });
    availabilityByIdentity.clear();
}
