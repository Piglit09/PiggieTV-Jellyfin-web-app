import { describe, expect, it } from 'vitest';

import { getPtvMusicPlayerResourcePolicy } from './musicPlayerResourcePolicy';

describe('music player resource policy', () => {
    it('retains the existing presentation outside WebOS', () => {
        expect(getPtvMusicPlayerResourcePolicy({ isLowPower: false, isWebOs: false })).toEqual({
            artworkWidth: 520,
            catalogArtworkRootMargin: '360px',
            catalogImmediateArtworkLimit: 16,
            catalogInitialCardLimit: 32,
            catalogPageIncrement: 32,
            deferLyricsUntilSelected: true,
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
        expect(getPtvMusicPlayerResourcePolicy({ isLowPower: true, isWebOs: true })).toEqual({
            artworkWidth: 360,
            catalogArtworkRootMargin: '180px',
            catalogImmediateArtworkLimit: 12,
            catalogInitialCardLimit: 24,
            catalogPageIncrement: 24,
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

    it('applies the constrained catalog budget to non-WebOS low-power clients', () => {
        expect(getPtvMusicPlayerResourcePolicy({
            isLowPower: true,
            isWebOs: false
        }).catalogInitialCardLimit).toBe(24);
    });

    it.each([
        ['desktop', { isLowPower: false, isWebOs: false }],
        ['low-power', { isLowPower: true, isWebOs: true }]
    ])('cuts the R1 cold Album image request budget by at least 35% on %s', (_label, profile) => {
        const r1ColdAlbumImageRequests = 70;
        const shellImageAllowance = 2;
        const targetReduction = 0.35;
        const policy = getPtvMusicPlayerResourcePolicy(profile);
        const coldAlbumImageBudget = shellImageAllowance + policy.catalogInitialCardLimit;
        const reduction = (r1ColdAlbumImageRequests - coldAlbumImageBudget) / r1ColdAlbumImageRequests;

        expect(coldAlbumImageBudget).toBeLessThanOrEqual(Math.floor(r1ColdAlbumImageRequests * (1 - targetReduction)));
        expect(reduction).toBeGreaterThanOrEqual(targetReduction);
        expect(policy.catalogImmediateArtworkLimit).toBeLessThanOrEqual(policy.catalogInitialCardLimit);
    });
});
