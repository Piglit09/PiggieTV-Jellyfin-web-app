import { describe, expect, it } from 'vitest';

import { parsePtvBrowseRoute } from './browseRoute';
import {
    getPtvFocusedBrowseDiagnosticLoaderKey,
    getPtvFocusedBrowseLoaderKey,
    PtvFocusedBrowseLoadOwner,
    type PtvFocusedBrowseLoaderScope
} from './focusedBrowseLoader';

const unscoped: PtvFocusedBrowseLoaderScope = {
    alias: '',
    libraryIds: [],
    status: 'unscoped'
};
const animeScope: PtvFocusedBrowseLoaderScope = {
    alias: 'anime',
    libraryIds: ['anime-library-id'],
    status: 'resolved'
};

function getKey(pathname: string, search: string, scope = unscoped, metadataId = '') {
    return getPtvFocusedBrowseLoaderKey(parsePtvBrowseRoute(pathname, search), scope, metadataId);
}

describe('focusedBrowseLoader identity', () => {
    it.each([
        ['Crime -> Horror', '/movies', '?view=genre&genre=Crime', '?view=genre&genre=Horror', unscoped, unscoped],
        ['Horror -> Comedy', '/movies', '?view=genre&genre=Horror', '?view=genre&genre=Comedy', unscoped, unscoped],
        ['Universal Pictures -> Warner Bros.', '/movies', '?view=studio&studio=Universal%20Pictures', '?view=studio&studio=Warner%20Bros.', unscoped, unscoped],
        ['HBO -> Netflix', '/shows', '?view=network&network=HBO', '?view=network&network=Netflix', unscoped, unscoped],
        ['unscoped Horror -> Anime Horror', '/shows', '?view=genre&genre=Horror', '?topParentId=anime&view=genre&genre=Horror', unscoped, animeScope],
        ['alien -> predator', '/movies', '?view=latest&query=alien', '?view=latest&query=predator', unscoped, unscoped],
        ['ascending -> descending', '/movies', '?view=genre&genre=Crime&sortOrder=Ascending', '?view=genre&genre=Crime&sortOrder=Descending', unscoped, unscoped],
        ['page 0 -> page 1', '/movies', '?view=genre&genre=Crime&page=0', '?view=genre&genre=Crime&page=1', unscoped, unscoped]
    ])('creates a distinct key for %s', (_label, pathname, firstSearch, secondSearch, firstScope, secondScope) => {
        expect(getKey(pathname, firstSearch, firstScope))
            .not.toBe(getKey(pathname, secondSearch, secondScope));
    });

    it('normalizes equivalent effective values without changing display values', () => {
        const first = getKey('/movies', '?genre=%20Crime%20&view=genre&query=ALIEN');
        const second = getKey('/movies', '?query=alien&view=genre&genre=crime');

        expect(first).toBe(second);
        expect(parsePtvBrowseRoute('/movies', '?view=genre&genre=Crime').genre).toBe('Crime');
    });

    it('includes resolved metadata, selected parent, page size, and scope IDs internally', () => {
        const studioRoute = parsePtvBrowseRoute('/movies', '?view=studio&studio=Universal%20Pictures');
        const seasonRoute = parsePtvBrowseRoute('/shows', '?view=season&seriesId=series-one');

        expect(getPtvFocusedBrowseLoaderKey(studioRoute, unscoped, 'universal-id'))
            .not.toBe(getPtvFocusedBrowseLoaderKey(studioRoute, unscoped, 'other-universal-id'));
        expect(getPtvFocusedBrowseLoaderKey(seasonRoute, unscoped))
            .not.toBe(getPtvFocusedBrowseLoaderKey({ ...seasonRoute, seasonParentId: 'series-two' }, unscoped));
        expect(getPtvFocusedBrowseLoaderKey(studioRoute, unscoped))
            .not.toBe(getPtvFocusedBrowseLoaderKey({ ...studioRoute, pageSize: 25 }, unscoped));
        expect(getPtvFocusedBrowseLoaderKey(studioRoute, animeScope))
            .not.toBe(getPtvFocusedBrowseLoaderKey(studioRoute, { ...animeScope, libraryIds: ['other-library-id'] }));
    });

    it('emits an exact named filter without exposing raw resolved IDs', () => {
        const route = parsePtvBrowseRoute('/movies', '?view=genre&genre=Crime');

        expect(getPtvFocusedBrowseDiagnosticLoaderKey(route, unscoped))
            .toBe('movies:genre:genre:unscoped:Crime:SortName:Ascending:0:50');
        expect(getPtvFocusedBrowseDiagnosticLoaderKey(
            parsePtvBrowseRoute('/shows', '?topParentId=private-library-id&view=genre&genre=Horror'),
            { alias: 'private-library-id', libraryIds: ['raw-jellyfin-library-id'], status: 'resolved' }
        )).not.toContain('private-library-id');
    });
});

describe('focusedBrowseLoader request ownership', () => {
    it('suppresses a late Crime result after rapid navigation to Horror', async () => {
        const owner = new PtvFocusedBrowseLoadOwner();
        const crimeToken = owner.begin(getKey('/movies', '?view=genre&genre=Crime'));
        let resolveCrime!: (value: string) => void;
        const crimeRequest = new Promise<string>(resolve => {
            resolveCrime = resolve;
        });
        const committed: string[] = [];
        const commitWhenActive = async (token: typeof crimeToken, request: Promise<string>) => {
            const value = await request;

            if (owner.isActive(token)) committed.push(value);
        };
        const pendingCrime = commitWhenActive(crimeToken, crimeRequest);
        const horrorToken = owner.begin(getKey('/movies', '?view=genre&genre=Horror'));
        const pendingHorror = commitWhenActive(horrorToken, Promise.resolve('Horror'));

        await pendingHorror;
        resolveCrime('Crime');
        await pendingCrime;

        expect(committed).toEqual(['Horror']);
        expect(owner.isActive(crimeToken)).toBe(false);
        expect(owner.isActive(horrorToken)).toBe(true);
    });
});
