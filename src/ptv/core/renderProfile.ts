export const PTV_RENDER_PROFILES = {
    DESKTOP: 'PTV_DESKTOP',
    LOWPOWER: 'PTV_LOWPOWER',
    TV: 'PTV_TV'
} as const;

export type PtvRenderProfileId = typeof PTV_RENDER_PROFILES[keyof typeof PTV_RENDER_PROFILES];

export type PtvRenderClientSignals = {
    isCoarsePointer: boolean;
    isConstrainedHardware: boolean;
    isFireTv: boolean;
    isLowPower: boolean;
    isMobile: boolean;
    isTv: boolean;
    isWebOs: boolean;
    supportsBackdropFilter: boolean;
};

export type PtvRenderProfileContract = {
    className: string;
    id: PtvRenderProfileId;
    tier: 'desktop' | 'lowpower' | 'tv';
    allowsAnimatedRows: boolean;
    allowsBackdropFilter: boolean;
    allowsBlurLayers: boolean;
    allowsDecorativeBackdrops: boolean;
    allowsHeroAutoRotate: boolean;
};

export const PTV_RENDER_PROFILE_CONTRACTS: Record<PtvRenderProfileId, PtvRenderProfileContract> = {
    [PTV_RENDER_PROFILES.DESKTOP]: {
        allowsAnimatedRows: true,
        allowsBackdropFilter: true,
        allowsBlurLayers: true,
        allowsDecorativeBackdrops: true,
        allowsHeroAutoRotate: true,
        className: 'ptv-render-desktop',
        id: PTV_RENDER_PROFILES.DESKTOP,
        tier: 'desktop'
    },
    [PTV_RENDER_PROFILES.TV]: {
        allowsAnimatedRows: false,
        allowsBackdropFilter: false,
        allowsBlurLayers: false,
        allowsDecorativeBackdrops: false,
        allowsHeroAutoRotate: false,
        className: 'ptv-render-tv',
        id: PTV_RENDER_PROFILES.TV,
        tier: 'tv'
    },
    [PTV_RENDER_PROFILES.LOWPOWER]: {
        allowsAnimatedRows: false,
        allowsBackdropFilter: false,
        allowsBlurLayers: false,
        allowsDecorativeBackdrops: false,
        allowsHeroAutoRotate: false,
        className: 'ptv-render-lowpower',
        id: PTV_RENDER_PROFILES.LOWPOWER,
        tier: 'lowpower'
    }
};

export function getPtvRenderProfile(client: PtvRenderClientSignals): PtvRenderProfileContract {
    const isKnownConstrainedTv = client.isFireTv || client.isWebOs || client.isConstrainedHardware;

    if (isKnownConstrainedTv || !client.supportsBackdropFilter) {
        return PTV_RENDER_PROFILE_CONTRACTS[PTV_RENDER_PROFILES.LOWPOWER];
    }

    if (client.isTv || client.isCoarsePointer || client.isMobile || client.isLowPower) {
        return PTV_RENDER_PROFILE_CONTRACTS[PTV_RENDER_PROFILES.TV];
    }

    return PTV_RENDER_PROFILE_CONTRACTS[PTV_RENDER_PROFILES.DESKTOP];
}

export function applyPtvRenderProfileClasses(
    root: HTMLElement,
    renderProfile: PtvRenderProfileContract
) {
    Object.values(PTV_RENDER_PROFILE_CONTRACTS).forEach(profile => {
        root.classList.toggle(profile.className, profile.id === renderProfile.id);
    });

    root.dataset.ptvRenderProfile = renderProfile.id;
    root.dataset.ptvRenderTier = renderProfile.tier;
}
