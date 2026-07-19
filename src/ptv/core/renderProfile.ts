export const PTV_RENDER_PROFILES = {
    DESKTOP: 'PTV_DESKTOP',
    LOWPOWER: 'PTV_LOWPOWER',
    MOBILE: 'PTV_MOBILE',
    TV: 'PTV_TV'
} as const;

export type PtvRenderProfileId = typeof PTV_RENDER_PROFILES[keyof typeof PTV_RENDER_PROFILES];

export type PtvRenderClientSignals = {
    isAndroidTv?: boolean;
    isCoarsePointer: boolean;
    isConstrainedHardware: boolean;
    isFireTv: boolean;
    isLowPower: boolean;
    isMobile: boolean;
    isRoku?: boolean;
    isTablet?: boolean;
    isTenFootClient?: boolean;
    isTizen?: boolean;
    isTv: boolean;
    isWebOs: boolean;
    supportsBackdropFilter: boolean;
};

export type PtvRenderProfileContract = {
    className: string;
    id: PtvRenderProfileId;
    matchReason?: string;
    tier: 'desktop' | 'lowpower' | 'mobile' | 'tv';
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
    [PTV_RENDER_PROFILES.MOBILE]: {
        allowsAnimatedRows: true,
        allowsBackdropFilter: true,
        allowsBlurLayers: true,
        allowsDecorativeBackdrops: true,
        allowsHeroAutoRotate: true,
        className: 'ptv-render-mobile',
        id: PTV_RENDER_PROFILES.MOBILE,
        tier: 'mobile'
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

function withMatchReason(
    profile: PtvRenderProfileContract,
    matchReason: string
): PtvRenderProfileContract {
    return {
        ...profile,
        matchReason
    };
}

export function getPtvRenderProfile(client: PtvRenderClientSignals): PtvRenderProfileContract {
    const isTenFootClient = Boolean(
        client.isFireTv
        || client.isTv
        || client.isWebOs
        || client.isAndroidTv
        || client.isRoku
        || client.isTizen
        || client.isTenFootClient
    );

    if (isTenFootClient) {
        return withMatchReason(
            PTV_RENDER_PROFILE_CONTRACTS[PTV_RENDER_PROFILES.TV],
            'tv-signal'
        );
    }

    if (client.isMobile || client.isTablet) {
        return withMatchReason(
            PTV_RENDER_PROFILE_CONTRACTS[PTV_RENDER_PROFILES.MOBILE],
            'mobile-signal'
        );
    }

    if (client.isLowPower || client.isConstrainedHardware || !client.supportsBackdropFilter) {
        return withMatchReason(
            PTV_RENDER_PROFILE_CONTRACTS[PTV_RENDER_PROFILES.LOWPOWER],
            client.isLowPower || client.isConstrainedHardware ? 'low-power-signal' : 'no-backdrop-filter'
        );
    }

    return withMatchReason(
        PTV_RENDER_PROFILE_CONTRACTS[PTV_RENDER_PROFILES.DESKTOP],
        'desktop-default'
    );
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
    root.dataset.ptvRenderMatchReason = renderProfile.matchReason || '';
}
