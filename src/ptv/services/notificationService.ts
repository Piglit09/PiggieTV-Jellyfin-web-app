import { recordPtvEvent } from '../core/observability';
import { redactPtvCoreText, sanitizePtvCoreMetadata } from '../core/diagnostics/redaction';

export type PtvNotificationSeverity = 'info' | 'success' | 'warning' | 'error';
export type PtvNotificationSource = 'jellyfin' | 'ptv' | 'request' | 'music' | 'reading' | 'playback';

export type PtvNotification = {
    createdAt: number;
    dedupeKey?: string;
    dismissible: boolean;
    id: string;
    itemId?: string;
    message?: string;
    occurrenceCount: number;
    read: boolean;
    retryKey?: string;
    retryLabel?: string;
    route?: string;
    source: PtvNotificationSource;
    technicalDetails?: string;
    title: string;
    type: PtvNotificationSeverity;
    updatedAt: number;
};

export type PtvNotificationInput = {
    dedupeKey?: string;
    dismissible?: boolean;
    itemId?: string;
    message?: string;
    onRetry?: () => void | Promise<void>;
    retryKey?: string;
    retryLabel?: string;
    route?: string;
    source: PtvNotificationSource;
    technicalDetails?: string | Record<string, unknown>;
    title: string;
    type?: PtvNotificationSeverity;
};

export type PtvNotificationSnapshot = {
    duplicateSuppressionCount: number;
    lastNotificationSource: PtvNotificationSource | 'none';
    notifications: PtvNotification[];
    subscriberCount: number;
    totalCount: number;
    unreadCount: number;
};

const PTV_NOTIFICATION_STORAGE_KEY = 'ptv:notifications:v1';
const PTV_NOTIFICATION_MAX_ITEMS = 50;
const PTV_NOTIFICATION_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

let duplicateSuppressionCount = 0;
let lastNotificationSource: PtvNotificationSource | 'none' = 'none';
let notifications: PtvNotification[] = loadPtvNotifications();
const subscribers = new Set<(snapshot: PtvNotificationSnapshot) => void>();
const retryHandlers = new Map<string, () => void | Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getString(value: unknown) {
    return typeof value === 'string' ? value : '';
}

function getNumber(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getBoolean(value: unknown, fallback: boolean) {
    return typeof value === 'boolean' ? value : fallback;
}

function getTechnicalDetails(value: unknown) {
    if (typeof value === 'string') return redactPtvCoreText(value, 4000);
    if (!isRecord(value)) return undefined;

    try {
        return JSON.stringify(sanitizePtvCoreMetadata(value), null, 2);
    } catch {
        return undefined;
    }
}

function isNotificationSeverity(value: unknown): value is PtvNotificationSeverity {
    return value === 'info' || value === 'success' || value === 'warning' || value === 'error';
}

function isNotificationSource(value: unknown): value is PtvNotificationSource {
    return value === 'jellyfin'
        || value === 'ptv'
        || value === 'request'
        || value === 'music'
        || value === 'reading'
        || value === 'playback';
}

function normalizeStoredNotification(value: unknown): PtvNotification | null {
    if (!isRecord(value)) return null;

    const id = getString(value.id);
    const title = getString(value.title);
    const source = value.source;

    if (!id || !title || !isNotificationSource(source)) return null;

    const now = Date.now();

    return {
        createdAt: getNumber(value.createdAt, now),
        dedupeKey: redactPtvCoreText(getString(value.dedupeKey), 500) || undefined,
        dismissible: getBoolean(value.dismissible, true),
        id,
        itemId: getString(value.itemId) || undefined,
        message: redactPtvCoreText(getString(value.message), 1000) || undefined,
        occurrenceCount: Math.max(1, getNumber(value.occurrenceCount, 1)),
        read: getBoolean(value.read, false),
        retryKey: redactPtvCoreText(getString(value.retryKey), 500) || undefined,
        retryLabel: getString(value.retryLabel) || undefined,
        route: redactPtvCoreText(getString(value.route), 500) || undefined,
        source,
        technicalDetails: getTechnicalDetails(value.technicalDetails),
        title: redactPtvCoreText(title, 300),
        type: isNotificationSeverity(value.type) ? value.type : 'info',
        updatedAt: getNumber(value.updatedAt, getNumber(value.createdAt, now))
    };
}

function loadPtvNotifications() {
    try {
        const raw = window.localStorage?.getItem(PTV_NOTIFICATION_STORAGE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map(normalizeStoredNotification)
            .filter((item): item is PtvNotification => Boolean(item))
            .slice(0, PTV_NOTIFICATION_MAX_ITEMS);
    } catch {
        return [];
    }
}

function savePtvNotifications() {
    try {
        window.localStorage?.setItem(
            PTV_NOTIFICATION_STORAGE_KEY,
            JSON.stringify(notifications.slice(0, PTV_NOTIFICATION_MAX_ITEMS))
        );
    } catch {
        // Notifications remain useful in-memory when storage is unavailable.
    }
}

function createNotificationId(input: PtvNotificationInput, createdAt: number) {
    const seed = input.dedupeKey || `${input.source}:${input.title}:${input.message || ''}`;

    return `ptv-notification-${createdAt.toString(36)}-${Math.abs(hashString(seed)).toString(36)}`;
}

function hashString(value: string) {
    let hash = 0;

    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }

    return hash;
}

function getDedupeKey(input: PtvNotificationInput) {
    return redactPtvCoreText(
        input.dedupeKey || `${input.source}:${input.type || 'info'}:${input.title}:${input.message || ''}`,
        500
    );
}

function getRetryKey(input: PtvNotificationInput, dedupeKey: string) {
    if (!input.onRetry) return undefined;

    return redactPtvCoreText(input.retryKey || dedupeKey, 500);
}

function getSnapshot(): PtvNotificationSnapshot {
    const visibleNotifications = notifications.slice(0, PTV_NOTIFICATION_MAX_ITEMS);

    return {
        duplicateSuppressionCount,
        lastNotificationSource,
        notifications: visibleNotifications,
        subscriberCount: subscribers.size,
        totalCount: visibleNotifications.length,
        unreadCount: visibleNotifications.filter(notification => !notification.read).length
    };
}

function notifySubscribers() {
    const snapshot = getSnapshot();

    subscribers.forEach(subscriber => {
        subscriber(snapshot);
    });
}

export function getPtvNotificationSnapshot() {
    return getSnapshot();
}

export function subscribePtvNotifications(subscriber: (snapshot: PtvNotificationSnapshot) => void) {
    subscribers.add(subscriber);
    subscriber(getSnapshot());

    return () => {
        subscribers.delete(subscriber);
    };
}

export function addPtvNotification(input: PtvNotificationInput) {
    const createdAt = Date.now();
    const dedupeKey = getDedupeKey(input);
    const retryKey = getRetryKey(input, dedupeKey);
    const existingIndex = notifications.findIndex(notification => (
        notification.dedupeKey === dedupeKey
        && createdAt - notification.updatedAt <= PTV_NOTIFICATION_DEDUPE_WINDOW_MS
    ));

    lastNotificationSource = input.source;

    if (retryKey && input.onRetry) {
        retryHandlers.set(retryKey, input.onRetry);
    }

    if (existingIndex >= 0) {
        duplicateSuppressionCount += 1;
        const existing = notifications[existingIndex];
        const nextNotification: PtvNotification = {
            ...existing,
            message: input.message ? redactPtvCoreText(input.message, 1000) : existing.message,
            occurrenceCount: existing.occurrenceCount + 1,
            read: false,
            retryKey: retryKey || existing.retryKey,
            retryLabel: input.retryLabel || existing.retryLabel,
            route: input.route ? redactPtvCoreText(input.route, 500) : existing.route,
            technicalDetails: getTechnicalDetails(input.technicalDetails) || existing.technicalDetails,
            updatedAt: createdAt
        };

        notifications = [
            nextNotification,
            ...notifications.filter((_, index) => index !== existingIndex)
        ].slice(0, PTV_NOTIFICATION_MAX_ITEMS);
        savePtvNotifications();
        notifySubscribers();

        return nextNotification;
    }

    const notification: PtvNotification = {
        createdAt,
        dedupeKey,
        dismissible: input.dismissible !== false,
        id: createNotificationId(input, createdAt),
        itemId: input.itemId,
        message: input.message ? redactPtvCoreText(input.message, 1000) : undefined,
        occurrenceCount: 1,
        read: false,
        retryKey,
        retryLabel: input.retryLabel,
        route: input.route ? redactPtvCoreText(input.route, 500) : undefined,
        source: input.source,
        technicalDetails: getTechnicalDetails(input.technicalDetails),
        title: redactPtvCoreText(input.title, 300),
        type: input.type || 'info',
        updatedAt: createdAt
    };

    notifications = [notification, ...notifications].slice(0, PTV_NOTIFICATION_MAX_ITEMS);
    savePtvNotifications();
    notifySubscribers();
    recordPtvEvent('render', 'ptv-notification-added', {
        source: notification.source,
        type: notification.type
    });

    return notification;
}

export function markAllPtvNotificationsRead() {
    notifications = notifications.map(notification => ({
        ...notification,
        read: true
    }));
    savePtvNotifications();
    notifySubscribers();
}

export function markPtvNotificationRead(id: string) {
    notifications = notifications.map(notification => notification.id === id ? {
        ...notification,
        read: true
    } : notification);
    savePtvNotifications();
    notifySubscribers();
}

export function clearDismissiblePtvNotifications() {
    notifications = notifications.filter(notification => !notification.dismissible);
    savePtvNotifications();
    notifySubscribers();
}

export function dismissPtvNotification(id: string) {
    notifications = notifications.filter(notification => notification.id !== id || !notification.dismissible);
    savePtvNotifications();
    notifySubscribers();
}

export function hasPtvNotificationRetryHandler(notification: Pick<PtvNotification, 'retryKey'>) {
    return Boolean(notification.retryKey && retryHandlers.has(notification.retryKey));
}

export async function runPtvNotificationRetry(notification: Pick<PtvNotification, 'id' | 'retryKey'>) {
    const retryHandler = notification.retryKey ? retryHandlers.get(notification.retryKey) : null;

    if (!retryHandler) return false;

    await retryHandler();
    markPtvNotificationRead(notification.id);

    return true;
}

export function getPtvNotificationDiagnostics() {
    return getSnapshot();
}
