export const PTV_RENDER_PROFILES = {
    DESKTOP: 'PTV_DESKTOP',
    WEBOS: 'PTV_WEBOS',
    WEBOS_OPTIMIZED: 'PTV_WEBOS_OPTIMIZED',
    LOWPOWER: 'PTV_LOWPOWER',
    MOBILE: 'PTV_MOBILE',
    TV: 'PTV_TV'
} as const;

export type PtvRenderProfileId = typeof PTV_RENDER_PROFILES[keyof typeof PTV_RENDER_PROFILES];
export type PtvRenderProfileSelectionReason = 'desktop' | 'low-power' | 'mobile' | 'tv' | 'webos';

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
    selectionReason?: PtvRenderProfileSelectionReason;
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
        selectionReason: 'desktop',
        className: 'ptv-render-desktop',
        id: PTV_RENDER_PROFILES.DESKTOP,
        tier: 'desktop'
    },
    [PTV_RENDER_PROFILES.WEBOS]: {
        allowsAnimatedRows: false,
        allowsBackdropFilter: false,
        allowsBlurLayers: false,
        allowsDecorativeBackdrops: false,
        allowsHeroAutoRotate: false,
        selectionReason: 'webos',
        className: 'ptv-render-webos',
        id: PTV_RENDER_PROFILES.WEBOS,
        tier: 'tv'
    },
    [PTV_RENDER_PROFILES.WEBOS_OPTIMIZED]: {
        allowsAnimatedRows: false,
        allowsBackdropFilter: false,
        allowsBlurLayers: false,
        allowsDecorativeBackdrops: false,
        allowsHeroAutoRotate: false,
        selectionReason: 'webos',
        className: 'ptv-render-webos',
        id: PTV_RENDER_PROFILES.WEBOS_OPTIMIZED,
        tier: 'tv'
    },
    [PTV_RENDER_PROFILES.MOBILE]: {
        allowsAnimatedRows: true,
        allowsBackdropFilter: true,
        allowsBlurLayers: true,
        allowsDecorativeBackdrops: true,
        allowsHeroAutoRotate: true,
        selectionReason: 'mobile',
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
        selectionReason: 'tv',
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
        selectionReason: 'low-power',
        className: 'ptv-render-lowpower',
        id: PTV_RENDER_PROFILES.LOWPOWER,
        tier: 'lowpower'
    }
};

function withMatchReason(
    profile: PtvRenderProfileContract,
    matchReason: string,
    selectionReason: PtvRenderProfileSelectionReason
): PtvRenderProfileContract {
    return {
        ...profile,
        matchReason,
        selectionReason
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

    if (client.isWebOs) {
        return withMatchReason(
            PTV_RENDER_PROFILE_CONTRACTS[PTV_RENDER_PROFILES.WEBOS_OPTIMIZED],
            'webos-signal',
            'webos'
        );
    }

    if (isTenFootClient) {
        return withMatchReason(
            PTV_RENDER_PROFILE_CONTRACTS[PTV_RENDER_PROFILES.TV],
            'tv-signal',
            'tv'
        );
    }

    if (client.isMobile || client.isTablet) {
        return withMatchReason(
            PTV_RENDER_PROFILE_CONTRACTS[PTV_RENDER_PROFILES.MOBILE],
            'mobile-signal',
            'mobile'
        );
    }

    if (client.isLowPower || client.isConstrainedHardware || !client.supportsBackdropFilter) {
        return withMatchReason(
            PTV_RENDER_PROFILE_CONTRACTS[PTV_RENDER_PROFILES.LOWPOWER],
            client.supportsBackdropFilter === false
                ? 'no-backdrop-filter'
                : client.isConstrainedHardware
                    ? 'constrained-hardware'
                    : 'low-power-signal',
            'low-power'
        );
    }

    return withMatchReason(
        PTV_RENDER_PROFILE_CONTRACTS[PTV_RENDER_PROFILES.DESKTOP],
        'desktop-default',
        'desktop'
    );
}

export function applyPtvRenderProfileClasses(
    root: HTMLElement,
    renderProfile: PtvRenderProfileContract
) {
    const activeClass = renderProfile.className;
    const profileClasses = new Set(
        Object.values(PTV_RENDER_PROFILE_CONTRACTS).map(profile => profile.className)
    );

    profileClasses.forEach(profileClass => {
        root.classList.toggle(profileClass, profileClass === activeClass);
    });

    root.dataset.ptvRenderProfile = renderProfile.id;
    root.dataset.ptvRenderProfileSelection = renderProfile.selectionReason || 'unknown';
    root.dataset.ptvRenderTier = renderProfile.tier;
    root.dataset.ptvRenderMatchReason = renderProfile.matchReason || '';
}
