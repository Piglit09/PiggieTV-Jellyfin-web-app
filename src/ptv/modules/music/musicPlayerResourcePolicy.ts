import { getPtvPerformanceProfile, type PtvPerformanceProfile } from '../../core/clientProfile';

type PtvMusicResourceProfile = Pick<PtvPerformanceProfile, 'isWebOs'>;

export type PtvMusicPlayerResourcePolicy = Readonly<{
    artworkWidth: number;
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
    if (!profile.isWebOs) {
        return {
            artworkWidth: 520,
            deferLyricsUntilSelected: false,
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
