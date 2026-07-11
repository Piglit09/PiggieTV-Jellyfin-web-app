/* eslint-disable sonarjs/pseudo-random */
import type { ReaderBookmark, ReaderProgressState } from './readerModels';

const PROGRESS_PREFIX = 'ptv.reader.progress.';
const BOOKMARK_PREFIX = 'ptv.reader.bookmarks.';

function safeKey(value: string) {
    return encodeURIComponent(value || 'unknown');
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

export function loadReaderProgress(stableId: string): ReaderProgressState | null {
    return readJson<ReaderProgressState | null>(`${PROGRESS_PREFIX}${safeKey(stableId)}`, null);
}

export function saveReaderProgress(progress: ReaderProgressState) {
    writeJson(`${PROGRESS_PREFIX}${safeKey(progress.stableId)}`, {
        ...progress,
        updatedAt: Date.now()
    });
}

export function loadReaderBookmarks(stableId: string): ReaderBookmark[] {
    return readJson<ReaderBookmark[]>(`${BOOKMARK_PREFIX}${safeKey(stableId)}`, []);
}

export function saveReaderBookmarks(stableId: string, bookmarks: ReaderBookmark[]) {
    writeJson(`${BOOKMARK_PREFIX}${safeKey(stableId)}`, bookmarks);
}

export function addReaderBookmark(bookmark: Omit<ReaderBookmark, 'id' | 'createdAt'>): ReaderBookmark[] {
    const bookmarks = loadReaderBookmarks(bookmark.stableId);
    const nextBookmark: ReaderBookmark = {
        ...bookmark,
        id: `${Date.now()}-${Math.round(Math.random() * 100000)}`,
        createdAt: Date.now()
    };
    const next = [nextBookmark, ...bookmarks].slice(0, 100);
    saveReaderBookmarks(bookmark.stableId, next);
    return next;
}

/* eslint-enable sonarjs/pseudo-random */
