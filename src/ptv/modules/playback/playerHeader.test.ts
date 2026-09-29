import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ensurePlayerHeader,
    getPlayerHeaderIdentity,
    removePlayerHeader,
    setPlayerHeaderVisible,
    updatePlayerHeader
} from './playerHeader';

const imageLoads = vi.hoisted(() => [] as Array<{
    url: string;
    cancel: ReturnType<typeof vi.fn>;
    resolve: (loaded: boolean) => void;
    reject: (error: Error) => void;
}>);

vi.mock('../../core/imageManager', () => ({
    loadPtvImage: (url: string) => {
        let resolve!: (loaded: boolean) => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<boolean>((yes, no) => {
            resolve = yes;
            reject = no;
        });
        const cancel = vi.fn();
        imageLoads.push({ url, cancel, resolve, reject });
        return { cancel, promise, url };
    }
}));

describe('player header identity and ownership', () => {
    let root: HTMLElement;

    beforeEach(() => {
        imageLoads.length = 0;
        root = document.createElement('div');
        root.className = 'ptv-player-chrome-root';
        document.body.append(root);
    });

    afterEach(() => {
        removePlayerHeader(root);
        root.remove();
    });

    it('uses Series identity and only its proven parent logo for Episodes', () => {
        expect(getPlayerHeaderIdentity({
            Id: 'episode', Type: 'Episode', Name: 'Episode title', SeriesId: 'series', SeriesName: 'Series title',
            ImageTags: { Logo: 'episode-logo' }, ParentLogoItemId: 'series', ParentLogoImageTag: 'series-logo'
        })).toEqual({ title: 'Series title', logo: { itemId: 'series', tag: 'series-logo' } });
    });

    it('falls back to Series text if the parent logo is not proven to be that Series', () => {
        expect(getPlayerHeaderIdentity({
            Id: 'episode', Type: 'Episode', Name: 'Episode title', SeriesId: 'series', SeriesName: 'Series title',
            ParentLogoItemId: 'season', ParentLogoImageTag: 'season-logo'
        })).toEqual({ title: 'Series title', logo: null });
    });

    it('never substitutes an episode title for a missing Series identity', () => {
        expect(getPlayerHeaderIdentity({ Type: 'Episode', Name: 'Episode title' })).toEqual({ title: 'Series', logo: null });
    });

    it('uses the Movie own identity, not collection/episode metadata', () => {
        expect(getPlayerHeaderIdentity({
            Id: 'movie', Type: 'Movie', Name: 'Movie title', SeriesName: 'Not a Series',
            ImageTags: { Logo: 'movie-logo' }, ParentLogoItemId: 'collection', ParentLogoImageTag: 'collection-logo'
        })).toEqual({ title: 'Movie title', logo: { itemId: 'movie', tag: 'movie-logo' } });
    });

    it('creates one header and does not accumulate Back listeners', () => {
        const back = vi.fn();
        const first = ensurePlayerHeader(root, back);
        expect(ensurePlayerHeader(root, back)).toBe(first);
        expect(root.querySelectorAll('.ptv-player-topbar')).toHaveLength(1);
        (first.querySelector('.ptv-player-top-back') as HTMLButtonElement).click();
        expect(back).toHaveBeenCalledTimes(1);
    });

    it('keeps text visible until the logo successfully loads, and deduplicates same identity updates', async () => {
        const header = ensurePlayerHeader(root, vi.fn());
        updatePlayerHeader(header, 'Series', '/series-logo');
        updatePlayerHeader(header, 'Series', '/series-logo');
        expect(imageLoads).toHaveLength(1);
        expect(header.classList.contains('ptv-player-topbar-has-logo')).toBe(false);
        expect(header.querySelector('.ptv-player-top-title')?.textContent).toBe('Series');

        imageLoads[0].resolve(true);
        await Promise.resolve();
        expect(header.classList.contains('ptv-player-topbar-has-logo')).toBe(true);
        expect(header.querySelector('.ptv-player-top-title')?.textContent).toBe('Series');
    });

    it.each(['not loaded', 'rejected'])('retains title fallback when a logo is %s', async outcome => {
        const header = ensurePlayerHeader(root, vi.fn());
        updatePlayerHeader(header, 'Movie', '/missing-logo');
        if (outcome === 'rejected') imageLoads[0].reject(new Error('image failed'));
        else imageLoads[0].resolve(false);
        await Promise.resolve();
        await Promise.resolve();

        expect(header.classList.contains('ptv-player-topbar-has-logo')).toBe(false);
        expect(header.querySelector('.ptv-player-top-title')?.textContent).toBe('Movie');
    });

    it('does not apply an old logo after switching identity', async () => {
        const header = ensurePlayerHeader(root, vi.fn());
        updatePlayerHeader(header, 'Series A', '/logo-a');
        updatePlayerHeader(header, 'Series B', '/logo-b');
        expect(imageLoads[0].cancel).toHaveBeenCalledTimes(1);
        imageLoads[0].resolve(true);
        await Promise.resolve();
        expect(header.classList.contains('ptv-player-topbar-has-logo')).toBe(false);
        expect(header.querySelector('.ptv-player-top-title')?.textContent).toBe('Series B');
        imageLoads[1].resolve(true);
        await Promise.resolve();
        expect((header.querySelector('.ptv-player-top-logo') as HTMLElement).style.backgroundImage).toContain('/logo-b');
    });

    it('retires logo work and Back callbacks on teardown without resurrecting the header', async () => {
        const back = vi.fn();
        const header = ensurePlayerHeader(root, back);
        const oldBack = header.querySelector('.ptv-player-top-back') as HTMLButtonElement;
        updatePlayerHeader(header, 'Series', '/logo');
        removePlayerHeader(root);
        oldBack.click();
        imageLoads[0].resolve(true);
        await Promise.resolve();

        expect(back).not.toHaveBeenCalled();
        expect(imageLoads[0].cancel).toHaveBeenCalledTimes(1);
        expect(root.querySelector('.ptv-player-topbar')).toBeNull();
        expect(header.classList.contains('ptv-player-topbar-has-logo')).toBe(false);
    });

    it('makes Back unfocusable while hidden and restores it with controls', () => {
        const header = ensurePlayerHeader(root, vi.fn());
        const back = header.querySelector('.ptv-player-top-back') as HTMLButtonElement;
        setPlayerHeaderVisible(header, true);
        back.focus();
        expect(document.activeElement).toBe(back);
        setPlayerHeaderVisible(header, false);
        expect(header.getAttribute('aria-hidden')).toBe('true');
        expect(back.tabIndex).toBe(-1);
        expect(document.activeElement).not.toBe(back);
        setPlayerHeaderVisible(header, true);
        expect(header.getAttribute('aria-hidden')).toBe('false');
        expect(back.tabIndex).toBe(0);
    });
});
