import { describe, expect, it } from 'vitest';

import {
    clearPtvRecentSearches,
    getPtvSearchHistoryKey,
    loadPtvRecentSearches,
    savePtvRecentSearch
} from './nativeSearchHistory';

function createMemoryStorage() {
    const entries = new Map<string, string>();

    return {
        entries,
        storage: {
            getItem: (key: string) => entries.get(key) ?? null,
            removeItem: (key: string) => {
                entries.delete(key);
            },
            setItem: (key: string, value: string) => {
                entries.set(key, value);
            }
        }
    };
}

describe('native Search recent history', () => {
    it('isolates history by server and user without an unscoped fallback', () => {
        const { storage } = createMemoryStorage();

        savePtvRecentSearch('Movie one', 'server-a', 'user-a', storage);
        savePtvRecentSearch('Movie two', 'server-a', 'user-b', storage);

        expect(loadPtvRecentSearches('server-a', 'user-a', storage)).toEqual(['Movie one']);
        expect(loadPtvRecentSearches('server-a', 'user-b', storage)).toEqual(['Movie two']);
        expect(getPtvSearchHistoryKey('', 'user-a')).toBeNull();
    });

    it('deduplicates case-insensitively and bounds retained history', () => {
        const { storage } = createMemoryStorage();

        for (let index = 0; index < 10; index += 1) {
            savePtvRecentSearch(`Query ${index}`, 'server-a', 'user-a', storage);
        }
        savePtvRecentSearch(' query 9 ', 'server-a', 'user-a', storage);

        const history = loadPtvRecentSearches('server-a', 'user-a', storage);

        expect(history).toHaveLength(8);
        expect(history[0]).toBe('query 9');
        expect(history.filter(entry => entry.toLowerCase() === 'query 9')).toHaveLength(1);
    });

    it('removes malformed storage and recovers to an empty history', () => {
        const { entries, storage } = createMemoryStorage();
        const key = getPtvSearchHistoryKey('server-a', 'user-a')!;

        entries.set(key, '{not-json');

        expect(loadPtvRecentSearches('server-a', 'user-a', storage)).toEqual([]);
        expect(entries.has(key)).toBe(false);
    });

    it('clears only the active identity history', () => {
        const { storage } = createMemoryStorage();

        savePtvRecentSearch('Alpha', 'server-a', 'user-a', storage);
        savePtvRecentSearch('Beta', 'server-a', 'user-b', storage);

        expect(clearPtvRecentSearches('server-a', 'user-a', storage)).toBe(true);
        expect(loadPtvRecentSearches('server-a', 'user-a', storage)).toEqual([]);
        expect(loadPtvRecentSearches('server-a', 'user-b', storage)).toEqual(['Beta']);
    });

    it('does not let unavailable storage interrupt Search', () => {
        const unavailableStorage = {
            getItem: () => {
                throw new Error('unavailable');
            },
            removeItem: () => {
                throw new Error('unavailable');
            },
            setItem: () => {
                throw new Error('unavailable');
            }
        };

        expect(loadPtvRecentSearches('server-a', 'user-a', unavailableStorage)).toEqual([]);
        expect(savePtvRecentSearch('Alpha', 'server-a', 'user-a', unavailableStorage)).toEqual(['Alpha']);
        expect(clearPtvRecentSearches('server-a', 'user-a', unavailableStorage)).toBe(false);
    });
});
