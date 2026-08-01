import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

vi.mock('../../services/runtimeStability', () => ({
    readPtvLocalStorageJson: <T>(key: string, fallback: T): T => {
        try {
            const rawValue = window.localStorage.getItem(key);

            return rawValue ? JSON.parse(rawValue) as T : fallback;
        } catch {
            return fallback;
        }
    },
    removePtvLocalStorageKey: (key: string) => {
        try {
            window.localStorage.removeItem(key);
            return true;
        } catch {
            return false;
        }
    },
    writePtvLocalStorageJson: (
        key: string,
        value: unknown,
        options: { maxBytes?: number } = {}
    ) => {
        try {
            const payload = JSON.stringify(value);

            if (payload.length > (options.maxBytes || Number.MAX_SAFE_INTEGER)) return false;

            window.localStorage.setItem(key, payload);
            return true;
        } catch {
            return false;
        }
    }
}));

import type { PtvMusicItem } from './musicTypes';
import {
    clearPtvMusicContinuity,
    clearPtvMusicRecentTracks,
    compactPtvMusicContinuityItem,
    createPtvMusicContinuityDocument,
    getPtvMusicContinuityScopeKey,
    getPtvMusicContinuityStorageKey,
    inspectPtvMusicContinuityDocument,
    isMeaningfulPtvMusicRecentTrack,
    loadPtvMusicContinuity,
    normalizePtvMusicContinuityRoute,
    PTV_MUSIC_CONTINUITY_MAX_AGE_MS,
    PTV_MUSIC_CONTINUITY_MAX_BYTES,
    PTV_MUSIC_CONTINUITY_QUEUE_LIMIT,
    PTV_MUSIC_CONTINUITY_RECENT_LIMIT,
    recordPtvMusicRecentTrack,
    removePtvMusicRecentTrack,
    savePtvMusicContinuityPlayerTab,
    savePtvMusicContinuityRoute,
    savePtvMusicQueueContinuity,
    subscribeToPtvMusicContinuity
} from './musicContinuity';

const NOW = 1_800_000_000_000;
const TICKS_PER_SECOND = 10_000_000;
const SCOPE = {
    serverId: 'server-private-identity',
    userId: 'user-private-identity'
};
const OTHER_SCOPE = {
    serverId: 'server-private-identity',
    userId: 'other-user-private-identity'
};

const activeCleanups: Array<() => void> = [];

function getTrack(index: number, overrides: Record<string, unknown> = {}): PtvMusicItem {
    return {
        Album: `Album ${index}`,
        AlbumArtist: `Album Artist ${index % 5}`,
        AlbumId: `album-${index % 8}`,
        Artist: `Artist ${index % 5}`,
        ArtistItems: [{
            Id: `artist-${index % 5}`,
            Name: `Artist ${index % 5}`
        }],
        Artists: [`Artist ${index % 5}`],
        Id: `track-${index}`,
        ImageTags: {
            Primary: `image-tag-${index}`
        },
        MediaType: 'Audio',
        Name: `Track ${index}`,
        RunTimeTicks: 180 * TICKS_PER_SECOND,
        Type: 'Audio',
        ...overrides
    } as PtvMusicItem;
}

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    activeCleanups.splice(0).forEach(cleanup => {
        cleanup();
    });
    window.localStorage.clear();
});

describe('PiggieTV Music continuity scope and privacy', () => {
    it('requires both identities and hashes them out of the key and document', () => {
        expect(getPtvMusicContinuityStorageKey({
            serverId: '',
            userId: SCOPE.userId
        })).toBeNull();
        expect(getPtvMusicContinuityStorageKey({
            serverId: SCOPE.serverId,
            userId: ''
        })).toBeNull();

        const key = getPtvMusicContinuityStorageKey(SCOPE);
        const document = createPtvMusicContinuityDocument(SCOPE, NOW);

        expect(key).toBeTruthy();
        expect(key).not.toContain(String(SCOPE.serverId));
        expect(key).not.toContain(String(SCOPE.userId));
        expect(document?.scopeKey).toBe(getPtvMusicContinuityScopeKey(SCOPE));
        expect(JSON.stringify(document)).not.toContain(String(SCOPE.serverId));
        expect(JSON.stringify(document)).not.toContain(String(SCOPE.userId));
        expect(getPtvMusicContinuityStorageKey(OTHER_SCOPE)).not.toBe(key);
    });

    it('compacts queue items through an explicit non-sensitive allowlist', () => {
        const unsafeTrack = getTrack(1, {
            ApiKey: 'secret-api-key',
            MediaSources: [{
                Path: 'C:\\private\\music.flac',
                TranscodingUrl: 'https://private.example/audio?token=secret'
            }],
            Path: 'C:\\private\\music.flac',
            ProviderIds: {
                Private: 'secret-provider-id'
            },
            Token: 'secret-token',
            Url: 'https://private.example/item'
        });
        const compact = compactPtvMusicContinuityItem(unsafeTrack);
        const serialized = JSON.stringify(compact);

        expect(compact).toMatchObject({
            Album: 'Album 1',
            Artist: 'Artist 1',
            Id: 'track-1',
            MediaType: 'Audio',
            Name: 'Track 1',
            Type: 'Audio'
        });
        expect(serialized).not.toContain('secret');
        expect(serialized).not.toContain('private.example');
        expect(serialized).not.toContain('C:\\\\private');
        expect(serialized).not.toContain('MediaSources');
        expect(serialized).not.toContain('Path');
        expect(serialized).not.toContain('ProviderIds');
        expect(serialized).not.toContain('Token');
        expect(serialized).not.toContain('Url');
        expect(compactPtvMusicContinuityItem({
            Id: 'missing-audio-discriminator'
        })).toBeNull();
        expect(compactPtvMusicContinuityItem({
            Id: 'conflicting-type',
            MediaType: 'Audio',
            Type: 'Video'
        })).toBeNull();
    });
});

describe('PiggieTV Music route, tab, and queue continuity', () => {
    it('keeps only a canonical Music route without origin or query material', () => {
        expect(normalizePtvMusicContinuityRoute(
            'https://private.example/web/#/music/artist/artist-1?token=secret'
        )).toBe('#/music/artist/artist-1');
        expect(normalizePtvMusicContinuityRoute('#/music/genres')).toBe('#/music/genres');
        expect(normalizePtvMusicContinuityRoute('#/music/history')).toBe('#/music/history');
        expect(normalizePtvMusicContinuityRoute('#/movies')).toBeNull();
        expect(normalizePtvMusicContinuityRoute('C:\\private\\music')).toBeNull();
        expect(normalizePtvMusicContinuityRoute('#/music/artist/%E0%A4%A')).toBeNull();
        expect(normalizePtvMusicContinuityRoute('#/music/unknown')).toBeNull();

        savePtvMusicContinuityRoute(
            SCOPE,
            'https://private.example/web/#/music/artist/artist-1?token=secret',
            NOW
        );
        savePtvMusicContinuityPlayerTab(SCOPE, 'Lyrics', NOW + 1);

        const document = loadPtvMusicContinuity(SCOPE, NOW + 1);
        const stored = window.localStorage.getItem(getPtvMusicContinuityStorageKey(SCOPE) || '');

        expect(document?.lastRoute).toBe('#/music/artist/artist-1');
        expect(document?.lastPlayerTab).toBe('Lyrics');
        expect(stored).not.toContain('private.example');
        expect(stored).not.toContain('token');
    });

    it('bounds a queue around the current item while retaining passive context', () => {
        const playlist = Array.from({ length: 140 }, (_, index) => getTrack(index));

        savePtvMusicQueueContinuity(SCOPE, {
            currentIndex: 115,
            isShuffled: true,
            playlist,
            positionTicks: 75 * TICKS_PER_SECOND,
            repeatMode: 'RepeatAll',
            runtimeTicks: 180 * TICKS_PER_SECOND
        }, {
            kind: 'mix',
            source: 'artist-radio',
            sourceId: 'artist-3'
        }, NOW);

        const queue = loadPtvMusicContinuity(SCOPE, NOW)?.queue;

        expect(queue?.items).toHaveLength(PTV_MUSIC_CONTINUITY_QUEUE_LIMIT);
        expect(queue?.items[queue.currentIndex]?.Id).toBe('track-115');
        expect(queue).toMatchObject({
            context: {
                kind: 'mix',
                source: 'artist-radio',
                sourceId: 'artist-3'
            },
            currentItemId: 'track-115',
            positionTicks: 75 * TICKS_PER_SECOND,
            repeatMode: 'RepeatAll',
            runtimeTicks: 180 * TICKS_PER_SECOND,
            shuffled: true
        });
    });

    it('fits worst-case compact metadata under the safe storage budget', () => {
        const longText = 'x'.repeat(600);
        const playlist = Array.from({ length: 140 }, (_track, index) => getTrack(index, {
            Album: longText,
            AlbumArtist: longText,
            AlbumId: `album-${index}-${longText}`,
            AlbumPrimaryImageItemId: `album-image-${index}-${longText}`,
            AlbumPrimaryImageTag: `album-tag-${index}-${longText}`,
            Artist: longText,
            ArtistItems: Array.from({ length: 8 }, (_artist, artistIndex) => ({
                Id: `artist-${artistIndex}-${longText}`,
                Name: longText
            })),
            Artists: Array.from({ length: 8 }, () => longText),
            ImageTags: {
                Primary: `image-${index}-${longText}`
            },
            Name: longText
        }));

        savePtvMusicQueueContinuity(SCOPE, {
            currentIndex: 70,
            isShuffled: false,
            playlist,
            positionTicks: 0,
            queueSourceLabel: 'Saved queue session',
            repeatMode: 'RepeatNone',
            runtimeTicks: 180 * TICKS_PER_SECOND
        }, {}, NOW);

        const key = getPtvMusicContinuityStorageKey(SCOPE) || '';
        const stored = window.localStorage.getItem(key) || '';
        const queue = loadPtvMusicContinuity(SCOPE, NOW)?.queue;

        expect(stored.length).toBeLessThanOrEqual(PTV_MUSIC_CONTINUITY_MAX_BYTES);
        expect(queue?.items.length).toBeGreaterThan(0);
        expect(queue?.items.length).toBeLessThanOrEqual(PTV_MUSIC_CONTINUITY_QUEUE_LIMIT);
        expect(queue?.currentItemId).toBe('track-70');
        expect(queue?.context.source).toBe('Saved queue session');
    });
});

describe('PiggieTV Music recent track continuity', () => {
    it('records only meaningful listening and deduplicates newest-first', () => {
        const track = getTrack(1);

        expect(isMeaningfulPtvMusicRecentTrack(track, {
            positionTicks: 2 * TICKS_PER_SECOND
        })).toBe(false);
        expect(recordPtvMusicRecentTrack(SCOPE, track, {
            positionTicks: 2 * TICKS_PER_SECOND
        }, NOW)).toBeNull();

        recordPtvMusicRecentTrack(SCOPE, track, {
            positionTicks: 35 * TICKS_PER_SECOND
        }, NOW);
        recordPtvMusicRecentTrack(SCOPE, getTrack(2), {
            completed: true
        }, NOW + 1);
        recordPtvMusicRecentTrack(SCOPE, track, {
            positionTicks: 70 * TICKS_PER_SECOND
        }, NOW + 2);

        const recent = loadPtvMusicContinuity(SCOPE, NOW + 2)?.recentTracks;

        expect(recent).toHaveLength(2);
        expect(recent?.map(entry => entry.item.Id)).toEqual(['track-1', 'track-2']);
        expect(recent?.[0]).toMatchObject({
            completed: false,
            lastPlayedAt: NOW + 2,
            positionTicks: 70 * TICKS_PER_SECOND
        });
    });

    it('bounds meaningful history and drops duplicate item identities', () => {
        for (let index = 0; index < PTV_MUSIC_CONTINUITY_RECENT_LIMIT + 8; index += 1) {
            recordPtvMusicRecentTrack(SCOPE, getTrack(index), {
                completed: true
            }, NOW + index);
        }

        const recent = loadPtvMusicContinuity(
            SCOPE,
            NOW + PTV_MUSIC_CONTINUITY_RECENT_LIMIT + 8
        )?.recentTracks || [];

        expect(recent).toHaveLength(PTV_MUSIC_CONTINUITY_RECENT_LIMIT);
        expect(new Set(recent.map(entry => entry.item.Id)).size).toBe(recent.length);
        expect(recent[0].item.Id).toBe(`track-${PTV_MUSIC_CONTINUITY_RECENT_LIMIT + 7}`);
        expect(recent.at(-1)?.item.Id).toBe('track-8');
    });

    it('removes one history entry or clears the scoped history without touching route state', () => {
        savePtvMusicContinuityRoute(SCOPE, '#/music/history', NOW);
        recordPtvMusicRecentTrack(SCOPE, getTrack(1), { completed: true }, NOW + 1);
        recordPtvMusicRecentTrack(SCOPE, getTrack(2), { completed: true }, NOW + 2);

        removePtvMusicRecentTrack(SCOPE, 'track-1', NOW + 3);
        expect(loadPtvMusicContinuity(SCOPE, NOW + 3)).toMatchObject({
            lastRoute: '#/music/history',
            recentTracks: [
                {
                    item: {
                        Id: 'track-2'
                    }
                }
            ]
        });

        clearPtvMusicRecentTracks(SCOPE, NOW + 4);
        expect(loadPtvMusicContinuity(SCOPE, NOW + 4)).toMatchObject({
            lastRoute: '#/music/history',
            recentTracks: []
        });
    });
});

describe('PiggieTV Music continuity recovery', () => {
    it('rejects and removes malformed, stale, and wrong-scope documents', () => {
        const key = getPtvMusicContinuityStorageKey(SCOPE) || '';

        window.localStorage.setItem(key, '{malformed');
        expect(loadPtvMusicContinuity(SCOPE, NOW)).toBeNull();
        expect(window.localStorage.getItem(key)).toBeNull();

        const stale = createPtvMusicContinuityDocument(
            SCOPE,
            NOW - PTV_MUSIC_CONTINUITY_MAX_AGE_MS - 1
        );

        window.localStorage.setItem(key, JSON.stringify(stale));
        expect(loadPtvMusicContinuity(SCOPE, NOW)).toBeNull();
        expect(window.localStorage.getItem(key)).toBeNull();

        const valid = createPtvMusicContinuityDocument(SCOPE, NOW);
        const wrongScopeKey = getPtvMusicContinuityScopeKey(OTHER_SCOPE);

        window.localStorage.setItem(key, JSON.stringify({
            ...valid,
            scopeKey: wrongScopeKey
        }));
        expect(loadPtvMusicContinuity(SCOPE, NOW)).toBeNull();
        expect(window.localStorage.getItem(key)).toBeNull();
    });

    it('repairs optional fields but does not revive an invalid schema', () => {
        const base = createPtvMusicContinuityDocument(SCOPE, NOW);
        const repaired = inspectPtvMusicContinuityDocument({
            ...base,
            lastPlayerTab: 'private-tab',
            lastRoute: 'https://private.example/not-music?token=secret',
            queue: {
                items: 'not-an-array'
            },
            recentTracks: [{
                item: {
                    Id: ''
                }
            }]
        }, SCOPE, NOW);

        expect(repaired).toMatchObject({
            document: {
                lastPlayerTab: 'Up Next',
                lastRoute: '#/music',
                queue: null,
                recentTracks: []
            },
            status: 'valid'
        });
        expect(inspectPtvMusicContinuityDocument({
            ...base,
            version: 999
        }, SCOPE, NOW).status).toBe('invalid');
    });

    it('expires queue context independently from fresh route continuity', () => {
        const oldQueueDocument = savePtvMusicQueueContinuity(SCOPE, {
            currentIndex: 0,
            isShuffled: false,
            playlist: [getTrack(1)],
            positionTicks: 0,
            repeatMode: 'RepeatNone',
            runtimeTicks: 180 * TICKS_PER_SECOND
        }, {}, NOW);
        const inspected = inspectPtvMusicContinuityDocument({
            ...oldQueueDocument,
            queue: {
                ...oldQueueDocument?.queue,
                capturedAt: NOW - PTV_MUSIC_CONTINUITY_MAX_AGE_MS - 1
            },
            updatedAt: NOW
        }, SCOPE, NOW);

        expect(inspected.status).toBe('valid');
        expect(inspected.document?.queue).toBeNull();
    });

    it('never loads one user scope through another user scope', () => {
        savePtvMusicContinuityRoute(SCOPE, '#/music/album/album-1', NOW);

        expect(loadPtvMusicContinuity(SCOPE, NOW)?.lastRoute)
            .toBe('#/music/album/album-1');
        expect(loadPtvMusicContinuity(OTHER_SCOPE, NOW)).toBeNull();
    });
});

describe('PiggieTV Music continuity notifications', () => {
    it('notifies scoped subscribers for local writes and clear, then detaches', () => {
        const changes: Array<{
            route: string | null;
            reason: string;
        }> = [];
        const unsubscribe = subscribeToPtvMusicContinuity(
            SCOPE,
            (document, change) => {
                changes.push({
                    route: document?.lastRoute || null,
                    reason: change.reason
                });
            },
            false
        );

        activeCleanups.push(unsubscribe);
        savePtvMusicContinuityRoute(SCOPE, '#/music/album/album-1');
        clearPtvMusicContinuity(SCOPE);

        expect(changes).toEqual([
            {
                reason: 'route',
                route: '#/music/album/album-1'
            },
            {
                reason: 'clear',
                route: null
            }
        ]);

        unsubscribe();
        savePtvMusicContinuityRoute(SCOPE, '#/music/artist/artist-1');
        expect(changes).toHaveLength(2);
    });

    it('normalizes external storage events before notifying the scope', () => {
        const changes: Array<{
            external: boolean;
            route: string | null;
        }> = [];
        const unsubscribe = subscribeToPtvMusicContinuity(
            SCOPE,
            (document, change) => {
                changes.push({
                    external: change.external,
                    route: document?.lastRoute || null
                });
            },
            false
        );
        const key = getPtvMusicContinuityStorageKey(SCOPE) || '';
        const externalDocument = {
            ...createPtvMusicContinuityDocument(SCOPE),
            lastRoute: '#/music/playlist/playlist-1'
        };

        activeCleanups.push(unsubscribe);
        window.dispatchEvent(new StorageEvent('storage', {
            key,
            newValue: JSON.stringify(externalDocument),
            storageArea: window.localStorage
        }));

        expect(changes).toEqual([{
            external: true,
            route: '#/music/playlist/playlist-1'
        }]);
    });

    it('isolates listener errors and rolls back a failed initial subscription', () => {
        let throwingListenerCalls = 0;
        const observedReasons: string[] = [];
        const unsubscribeThrowing = subscribeToPtvMusicContinuity(
            SCOPE,
            () => {
                throwingListenerCalls += 1;
                throw new Error('observer failed');
            },
            false
        );
        const unsubscribeObserving = subscribeToPtvMusicContinuity(
            SCOPE,
            (_document, change) => {
                observedReasons.push(change.reason);
            },
            false
        );

        activeCleanups.push(unsubscribeThrowing, unsubscribeObserving);
        expect(() => savePtvMusicContinuityRoute(SCOPE, '#/music/albums')).not.toThrow();
        expect(throwingListenerCalls).toBe(1);
        expect(observedReasons).toEqual(['route']);

        let initialFailureCalls = 0;

        expect(() => subscribeToPtvMusicContinuity(SCOPE, () => {
            initialFailureCalls += 1;
            throw new Error('initial observer failed');
        })).toThrow('initial observer failed');

        savePtvMusicContinuityRoute(SCOPE, '#/music/artists');
        expect(initialFailureCalls).toBe(1);
    });
});
