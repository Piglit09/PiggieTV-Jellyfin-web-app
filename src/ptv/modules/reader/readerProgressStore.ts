/* eslint-disable sonarjs/pseudo-random */
import { getPtvApiClient } from '../../api/client';
import { getPtvAuthenticatedDisplayIdentityKey } from '../../services/displayIdentity';
import type { ReaderBookmark, ReaderProgressState } from './readerModels';

const PROGRESS_PREFIX = 'ptv.reader.progress.v2.';
const BOOKMARK_PREFIX = 'ptv.reader.bookmarks.v2.';

function safeKey(value: string) {
    return encodeURIComponent(value || 'unknown');
}

function getScopedKey(prefix: string, stableId: string, serverId?: string): string | null {
    if (!stableId.trim()) return null;

    const identity = getPtvAuthenticatedDisplayIdentityKey(getPtvApiClient(serverId));

    return identity ? `${prefix}${identity}.${safeKey(stableId)}` : null;
}

function readJson<T>(key: string, fallback: T): T {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key: string, value: unknown) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Keep reading even when persistence is unavailable.
    }
}

export function loadReaderProgress(stableId: string, serverId?: string): ReaderProgressState | null {
    const key = getScopedKey(PROGRESS_PREFIX, stableId, serverId);

    return key ? readJson<ReaderProgressState | null>(key, null) : null;
}

export function saveReaderProgress(progress: ReaderProgressState, serverId?: string) {
    const key = getScopedKey(PROGRESS_PREFIX, progress.stableId, serverId);

    if (!key) return;
    writeJson(key, {
        ...progress,
        updatedAt: Date.now()
    });
}

export function loadReaderBookmarks(stableId: string, serverId?: string): ReaderBookmark[] {
    const key = getScopedKey(BOOKMARK_PREFIX, stableId, serverId);

    return key ? readJson<ReaderBookmark[]>(key, []) : [];
}

export function saveReaderBookmarks(stableId: string, bookmarks: ReaderBookmark[], serverId?: string) {
    const key = getScopedKey(BOOKMARK_PREFIX, stableId, serverId);

    if (key) writeJson(key, bookmarks);
}

export function addReaderBookmark(bookmark: Omit<ReaderBookmark, 'id' | 'createdAt'>, serverId?: string): ReaderBookmark[] {
    const bookmarks = loadReaderBookmarks(bookmark.stableId, serverId);
    const nextBookmark: ReaderBookmark = {
        ...bookmark,
        id: `${Date.now()}-${Math.round(Math.random() * 100000)}`,
        createdAt: Date.now()
    };
    const next = [nextBookmark, ...bookmarks].slice(0, 100);
    saveReaderBookmarks(bookmark.stableId, next, serverId);
    return next;
}

/* eslint-enable sonarjs/pseudo-random */
