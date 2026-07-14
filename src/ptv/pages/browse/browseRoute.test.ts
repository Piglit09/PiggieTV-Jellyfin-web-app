import { describe, expect, it } from 'vitest';

import { buildPtvBrowseHref, parsePtvBrowseRoute } from './browseRoute';

describe('browseRoute', () => {
    it('preserves the existing base landing routes', () => {
        const route = parsePtvBrowseRoute('/movies');

        expect(route.view).toBe('landing');
        expect(route.canonicalHref).toBe('#/movies');
        expect(route.page).toBe(0);
    });

    it('includes every data-affecting query value in the canonical route key', () => {
        const firstPage = parsePtvBrowseRoute('/shows', '?topParentId=anime&view=latest&page=1&sort=PremiereDate');
        const secondPage = parsePtvBrowseRoute('/shows', '?sort=PremiereDate&page=2&view=latest&topParentId=anime');

        expect(firstPage.scopeAlias).toBe('anime');
        expect(firstPage.view).toBe('latest');
        expect(firstPage.canonicalRouteKey).not.toBe(secondPage.canonicalRouteKey);
        expect(secondPage.canonicalHref).toContain('page=2');
    });

    it('normalizes equivalent parameter ordering to the same canonical state', () => {
        const first = parsePtvBrowseRoute('/movies', '?studio=A24&view=studio&topParentId=animemovies');
        const second = parsePtvBrowseRoute('/movies', '?topParentId=animemovies&view=studio&studio=A24');

        expect(first.canonicalRouteKey).toBe(second.canonicalRouteKey);
        expect(first.canonicalHref).toBe(second.canonicalHref);
    });

    it('builds typed genre, studio, and network links without falling back to search', () => {
        const movieRoute = parsePtvBrowseRoute('/movies');
        const showRoute = parsePtvBrowseRoute('/shows', '?topParentId=cartoons');

        expect(buildPtvBrowseHref(movieRoute, { genre: 'Science Fiction', view: 'genre' }))
            .toBe('#/movies?view=genre&genre=Science%20Fiction');
        expect(buildPtvBrowseHref(movieRoute, { studio: 'A24', view: 'studio' }))
            .toBe('#/movies?view=studio&studio=A24');
        expect(buildPtvBrowseHref(showRoute, { network: 'HBO', view: 'network' }))
            .toBe('#/shows?topParentId=cartoons&view=network&network=HBO');
    });

    it('rejects unsupported and incomplete focused routes explicitly', () => {
        const unsupported = parsePtvBrowseRoute('/movies', '?view=networks');
        const incompleteSeason = parsePtvBrowseRoute('/shows', '?view=season');

        expect(unsupported.view).toBe('unsupported');
        expect(unsupported.error).toContain('not supported');
        expect(incompleteSeason.error).toContain('series');
    });

    it('round-trips structured filter punctuation and Unicode exactly once', () => {
        const base = parsePtvBrowseRoute('/movies', '?topParentId=animemovies');
        const href = buildPtvBrowseHref(base, { genre: 'Kids & Family’s 日本', view: 'genre' });
        const [pathname, search = ''] = href.replace(/^#/, '').split('?');
        const parsed = parsePtvBrowseRoute(pathname, search);

        expect(parsed.genre).toBe('Kids & Family’s 日本');
        expect(parsed.scopeAlias).toBe('animemovies');
        expect(parsed.canonicalHref).toBe(href);
    });
});
