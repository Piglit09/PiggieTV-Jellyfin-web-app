import { describe, expect, it } from 'vitest';

import {
    getPtvMusicRouteHomeGate,
    isPtvMusicCatalogView,
    isPtvMusicHomeIndependentView
} from './musicRoutePolicy';

describe('isPtvMusicCatalogView', () => {
    it.each([
        'library',
        'artists',
        'albums',
        'genres',
        'songs',
        'playlists'
    ])('treats %s as a catalog entry route', view => {
        expect(isPtvMusicCatalogView(view)).toBe(true);
    });

    it.each([
        'home',
        'explore',
        'history',
        'liked',
        'player',
        'artist',
        'album',
        'playlist'
    ])('does not start the catalog index for %s', view => {
        expect(isPtvMusicCatalogView(view)).toBe(false);
    });

    it.each([
        'library',
        'artists',
        'albums',
        'genres',
        'songs',
        'playlists'
    ])('does not gate the %s route on an empty, pending Home snapshot', view => {
        expect(getPtvMusicRouteHomeGate(view, {
            hasError: false,
            hasHomeSections: false,
            isLoading: true
        })).toBe('ready');
    });

    it('retains the global loading and error gates for Home-dependent routes', () => {
        expect(getPtvMusicRouteHomeGate('home', {
            hasError: false,
            hasHomeSections: false,
            isLoading: true
        })).toBe('loading');
        expect(getPtvMusicRouteHomeGate('explore', {
            hasError: true,
            hasHomeSections: false,
            isLoading: false
        })).toBe('error');
        expect(getPtvMusicRouteHomeGate('home', {
            hasError: true,
            hasHomeSections: true,
            isLoading: false
        })).toBe('ready');
    });

    it.each([
        'album',
        'artist',
        'item',
        'history',
        'liked',
        'player',
        'playlist'
    ])('lets the %s route render without waiting for a broad Home snapshot', view => {
        expect(isPtvMusicHomeIndependentView(view)).toBe(true);
        expect(getPtvMusicRouteHomeGate(view, {
            hasError: false,
            hasHomeSections: false,
            isLoading: true
        })).toBe('ready');
    });

    it.each(['home', 'explore'])('keeps %s owned by the Home snapshot', view => {
        expect(isPtvMusicHomeIndependentView(view)).toBe(false);
    });
});
