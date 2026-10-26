import type { PtvLibrary, PtvUser } from '../api/types';

export type PtvNavigationAccess = Readonly<{
    movies: ReadonlyArray<Readonly<{ id: string; name: string; kind: 'movies' | 'animeMovies' }>>;
    shows: ReadonlyArray<Readonly<{ id: string; name: string; kind: 'shows' | 'anime' | 'cartoons' }>>;
    music: ReadonlyArray<Readonly<{ id: string; name: string }>>;
    reading: ReadonlyArray<Readonly<{ id: string; name: string; kind: 'books' | 'comics' | 'manga' }>>;
    collections: boolean;
    isAdmin: boolean;
    liveTv: boolean;
}>;

const NAVIGATION_COLLECTION_TYPES = new Set(['movies', 'tvshows', 'music', 'books', 'boxsets']);

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function movieKind(name: string): 'movies' | 'animeMovies' {
    return /\b(?:anime|ani)\s*movies?\b/i.test(name) ? 'animeMovies' : 'movies';
}

function showKind(name: string): 'shows' | 'anime' | 'cartoons' {
    if (/\bcartoons?\b/i.test(name)) return 'cartoons';
    if (/\banime\b/i.test(name)) return 'anime';

    return 'shows';
}

function readingKind(name: string): 'books' | 'comics' | 'manga' {
    if (/\bmanga\b/i.test(name)) return 'manga';
    if (/\bcomics?\b/i.test(name)) return 'comics';

    return 'books';
}

export function derivePtvNavigationAccess(
    views: readonly PtvLibrary[],
    user: PtvUser
): PtvNavigationAccess {
    const movies: PtvNavigationAccess['movies'][number][] = [];
    const shows: PtvNavigationAccess['shows'][number][] = [];
    const music: PtvNavigationAccess['music'][number][] = [];
    const reading: PtvNavigationAccess['reading'][number][] = [];
    const seenIds = new Set<string>();
    let collections = false;

    // Only project authenticated Users/{userId}/Views supplied by the caller.
    // A name or filesystem path on its own never grants a navigation entry.
    for (const view of views) {
        const id = text(view?.Id);
        const type = text(view?.CollectionType).toLowerCase();

        if (!id || seenIds.has(id.toLowerCase())) continue;
        if (!NAVIGATION_COLLECTION_TYPES.has(type)) continue;

        seenIds.add(id.toLowerCase());
        const name = text(view.Name);

        switch (type) {
            case 'movies':
                movies.push({
                    id,
                    name: name || 'Movies',
                    kind: movieKind(name)
                });
                break;
            case 'tvshows':
                shows.push({
                    id,
                    name: name || 'Shows',
                    kind: showKind(name)
                });
                break;
            case 'music':
                music.push({ id, name: name || 'Music' });
                break;
            case 'books':
                reading.push({
                    id,
                    name: name || 'Books',
                    kind: readingKind(name)
                });
                break;
            case 'boxsets':
                collections = true;
                break;
        }
    }

    return {
        movies,
        shows,
        music,
        reading,
        collections,
        isAdmin: user?.Policy?.IsAdministrator === true,
        liveTv: user?.Policy?.EnableLiveTvAccess === true
    };
}
