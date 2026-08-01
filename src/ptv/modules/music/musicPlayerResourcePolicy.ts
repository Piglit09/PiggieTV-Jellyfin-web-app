import { getPtvPerformanceProfile, type PtvPerformanceProfile } from '../../core/clientProfile';

type PtvMusicResourceProfile = Pick<PtvPerformanceProfile, 'isLowPower' | 'isWebOs'>;

export type PtvMusicPlayerResourcePolicy = Readonly<{
    artworkWidth: number;
    catalogArtworkRootMargin: string;
    catalogImmediateArtworkLimit: number;
    catalogInitialCardLimit: number;
    catalogPageIncrement: number;
    deferLyricsUntilSelected: boolean;
    homeArtworkWidth: number;
    renderHomeHeroBackdropImage: boolean;
    renderPageBackdropImage: boolean;
    renderPlayerBackdropImage: boolean;
    visibleGenreSectionLimit: number;
    visibleQuickPickLimit: number;
    visibleRowItemLimit: number;
}>;

export function getPtvMusicPlayerResourcePolicy(
    profile: PtvMusicResourceProfile = getPtvPerformanceProfile()
): PtvMusicPlayerResourcePolicy {
    if (!profile.isWebOs && !profile.isLowPower) {
        return {
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
        };
    }

    return {
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
    };
}
