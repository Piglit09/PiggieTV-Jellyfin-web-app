import { describe, expect, it } from 'vitest';

import { getPtvMusicPlayerResourcePolicy } from './musicPlayerResourcePolicy';

describe('music player resource policy', () => {
    it('retains the existing presentation outside WebOS', () => {
        expect(getPtvMusicPlayerResourcePolicy({ isWebOs: false })).toEqual({
            artworkWidth: 520,
            deferLyricsUntilSelected: false,
            homeArtworkWidth: 380,
            renderHomeHeroBackdropImage: true,
            renderPageBackdropImage: true,
            renderPlayerBackdropImage: true,
            visibleGenreSectionLimit: Number.MAX_SAFE_INTEGER,
            visibleQuickPickLimit: 12,
            visibleRowItemLimit: 24
        });
    });

    it('limits simultaneous image decoding and eager lyrics work on WebOS', () => {
        expect(getPtvMusicPlayerResourcePolicy({ isWebOs: true })).toEqual({
            artworkWidth: 360,
            deferLyricsUntilSelected: true,
            homeArtworkWidth: 280,
            renderHomeHeroBackdropImage: false,
            renderPageBackdropImage: false,
            renderPlayerBackdropImage: false,
            visibleGenreSectionLimit: 4,
            visibleQuickPickLimit: 6,
            visibleRowItemLimit: 6
        });
    });
});
