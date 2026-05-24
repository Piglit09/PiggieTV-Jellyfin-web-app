import React, { FC, useEffect, useMemo, useRef, useState } from 'react';

import { getPtvPerformanceProfile } from '../../core/clientProfile';
import { PTV_BRANDING, PTV_ROUTES } from '../../core/config';
import { syncPtvImagePreloads } from '../../core/images';
import type { FeaturedPayload } from '../cache/featuredContentCache';
import type { HeroApiClient, HeroItem } from './useHeroItem';
import { useHeroItems } from './useHeroItems';

import './hero.scss';

type HeroProps = {
    apiClient?: HeroApiClient;
    user?: { Id?: string };
    featuredContentPromise?: Promise<FeaturedPayload>;
};

function getDirectImageUrl(
    apiClient: HeroApiClient,
    itemId: string,
    type: string,
    options: { maxWidth: number; tag?: string; index?: number }
) {
    if (!apiClient.getUrl) return '';

    const path = typeof options.index === 'number' ?
        `Items/${itemId}/Images/${type}/${options.index}` :
        `Items/${itemId}/Images/${type}`;

    const params: Record<string, string | number> = {
        maxWidth: options.maxWidth
    };

    if (options.tag) {
        params.tag = options.tag;
    }

    return apiClient.getUrl(path, params);
}

function getImageUrl(
    apiClient: HeroApiClient,
    itemId: string,
    type: string,
    options: { maxWidth: number; tag?: string; index?: number }
) {
    return getDirectImageUrl(apiClient, itemId, type, options)
        || apiClient.getScaledImageUrl(itemId, {
            type,
            ...options
        });
}

function getBackdropUrl(apiClient?: HeroApiClient, item?: HeroItem | null) {
    if (!apiClient || !item?.Id) return '';

    const { heroBackdropMaxWidth } = getPtvPerformanceProfile();

    if (item.BackdropImageTags?.length) {
        return getImageUrl(apiClient, item.Id, 'Backdrop', {
            maxWidth: heroBackdropMaxWidth,
            index: 0,
            tag: item.BackdropImageTags[0]
        });
    }

    if (item.BackdropImageTag && (!item.BackdropItemId || item.BackdropItemId === item.Id)) {
        return getImageUrl(apiClient, item.Id, 'Backdrop', {
            maxWidth: heroBackdropMaxWidth,
            index: 0,
            tag: item.BackdropImageTag
        });
    }

    if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.length) {
        return getImageUrl(apiClient, item.ParentBackdropItemId, 'Backdrop', {
            maxWidth: heroBackdropMaxWidth,
            index: 0,
            tag: item.ParentBackdropImageTags[0]
        });
    }

    if (item.ParentBackdropItemId && item.ParentBackdropImageTag) {
        return getImageUrl(apiClient, item.ParentBackdropItemId, 'Backdrop', {
            maxWidth: heroBackdropMaxWidth,
            index: 0,
            tag: item.ParentBackdropImageTag
        });
    }

    if (item.BackdropItemId) {
        return getImageUrl(apiClient, item.BackdropItemId, 'Backdrop', {
            maxWidth: heroBackdropMaxWidth,
            index: 0
        });
    }

    const directBackdropUrl = getImageUrl(apiClient, item.Id, 'Backdrop', {
        maxWidth: heroBackdropMaxWidth,
        index: 0
    });

    if (directBackdropUrl) return directBackdropUrl;

    const primaryTag = item.ImageTags?.Primary || item.PrimaryImageTag;

    if (!primaryTag) return '';

    return getImageUrl(apiClient, item.Id, 'Primary', {
        maxWidth: heroBackdropMaxWidth,
        tag: primaryTag
    });
}

function getLogoUrl(apiClient?: HeroApiClient, item?: HeroItem | null) {
    if (!apiClient || !item) return '';

    const { heroLogoMaxWidth } = getPtvPerformanceProfile();

    if (item.ParentLogoItemId && item.ParentLogoImageTag) {
        return getImageUrl(apiClient, item.ParentLogoItemId, 'Logo', {
            maxWidth: heroLogoMaxWidth,
            tag: item.ParentLogoImageTag
        });
    }

    if (!item.Id || !item.ImageTags?.Logo) return '';

    return getImageUrl(apiClient, item.Id, 'Logo', {
        maxWidth: heroLogoMaxWidth,
        tag: item.ImageTags.Logo
    });
}

function getHeroTitle(item?: HeroItem | null) {
    if (!item) return PTV_BRANDING.appName;

    if ((item.Type === 'Episode' || item.Type === 'Season') && item.SeriesName) {
        return item.SeriesName;
    }

    return item.Name || PTV_BRANDING.appName;
}

function getHeroType(item?: HeroItem | null) {
    if (!item) return 'Movies';

    if (item.Type === 'Episode') return 'Series';

    return item.Type || 'Movies';
}

function getHeroEyebrow(item?: HeroItem | null) {
    if (item?.PtvHeroSource === 'seasonal') {
        return item.PtvHeroRecommendationLabel || 'Seasonal Pick';
    }

    if (item?.PtvHeroSource === 'continue') return 'Continue Watching';

    if (item?.PtvHeroSource === 'featured' && item.PtvHeroRecommendationLabel) {
        return item.PtvHeroRecommendationLabel;
    }

    return 'Featured Today';
}

function getFormattedCommunityRating(item?: HeroItem | null) {
    if (!item?.CommunityRating) return '';

    return item.CommunityRating.toFixed(1);
}

function getFormattedCriticRating(item?: HeroItem | null) {
    if (!item?.CriticRating) return '';

    return `${Math.round(item.CriticRating)}%`;
}

function getEndsAt(item?: HeroItem | null) {
    if (!item?.RunTimeTicks || item.Type === 'Series') return '';

    const endDate = new Date(Date.now() + (item.RunTimeTicks / 10000));

    return endDate.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

const Hero: FC<HeroProps> = ({ apiClient, user, featuredContentPromise }) => {
    const performanceProfile = useMemo(() => getPtvPerformanceProfile(), []);
    const heroItems = useHeroItems(apiClient, user, featuredContentPromise);
    const [heroIndex, setHeroIndex] = useState(0);
    const [previousBackdropUrl, setPreviousBackdropUrl] = useState('');
    const [isEntering, setIsEntering] = useState(false);
    const activeBackdropUrl = useRef('');

    useEffect(() => {
        setHeroIndex(0);
    }, [heroItems]);

    useEffect(() => {
        if (!performanceProfile.enableHeroAutoRotate) return undefined;
        if (heroItems.length <= 1) return undefined;

        const timer = window.setInterval(() => {
            setHeroIndex(index => (index + 1) % heroItems.length);
        }, 20000);

        return () => window.clearInterval(timer);
    }, [heroItems.length, performanceProfile.enableHeroAutoRotate]);

    const heroItem = heroItems[heroIndex] || null;
    const nextHeroItem = heroItems.length > 1 ? heroItems[(heroIndex + 1) % heroItems.length] : null;

    const backdropUrl = getBackdropUrl(apiClient, heroItem);
    const nextBackdropUrl = getBackdropUrl(apiClient, nextHeroItem);
    const logoUrl = getLogoUrl(apiClient, heroItem);
    const heroTitle = getHeroTitle(heroItem);
    const heroType = getHeroType(heroItem);
    const heroEyebrow = getHeroEyebrow(heroItem);
    const communityRating = getFormattedCommunityRating(heroItem);
    const criticRating = getFormattedCriticRating(heroItem);
    const endsAt = getEndsAt(heroItem);
    const detailsUrl = heroItem?.Id ? `#/details?id=${heroItem.Id}` : PTV_ROUTES.home;
    const heroKey = heroItem?.Id || 'static';
    const heroStateClass = heroItem ? 'ptv-hero-live' : 'ptv-hero-static';
    const transitionClass = performanceProfile.isLowPower || !isEntering ? 'is-active' : 'is-entering';
    const heroClassName = useMemo(
        () => `ptv-hero ${heroStateClass} ${transitionClass}`,
        [heroStateClass, transitionClass]
    );

    useEffect(() => {
        return syncPtvImagePreloads('hero-backdrop', [backdropUrl, nextBackdropUrl]);
    }, [backdropUrl, nextBackdropUrl]);

    useEffect(() => {
        if (performanceProfile.isLowPower) {
            activeBackdropUrl.current = backdropUrl;
            setPreviousBackdropUrl('');
            setIsEntering(false);

            return undefined;
        }

        const oldBackdropUrl = activeBackdropUrl.current;

        if (oldBackdropUrl && oldBackdropUrl !== backdropUrl) {
            setPreviousBackdropUrl(oldBackdropUrl);
        }

        activeBackdropUrl.current = backdropUrl;
        setIsEntering(true);

        const frame = window.requestAnimationFrame(() => {
            setIsEntering(false);
        });

        const timeout = window.setTimeout(() => {
            setPreviousBackdropUrl('');
        }, 650);

        return () => {
            window.cancelAnimationFrame(frame);
            window.clearTimeout(timeout);
        };
    }, [backdropUrl, heroKey, performanceProfile.isLowPower]);

    return (
        <section className={heroClassName}>
            {previousBackdropUrl ? (
                <img
                    className='ptv-hero-bg ptv-hero-bg-previous'
                    src={previousBackdropUrl}
                    alt=''
                    aria-hidden='true'
                    loading='lazy'
                    decoding='async'
                />
            ) : null}

            {backdropUrl ? (
                <img
                    className='ptv-hero-bg ptv-hero-bg-current'
                    src={backdropUrl}
                    alt=''
                    aria-hidden='true'
                    loading='eager'
                    decoding='async'
                />
            ) : (
                <div className='ptv-hero-bg ptv-hero-bg-current' aria-hidden='true' />
            )}

            <div className='ptv-hero-vignette' />
            <div className='ptv-hero-bottom-fade' />
            <div className='ptv-hero-ambient' />

            <div className='ptv-hero-inner'>
                <div className='ptv-hero-content' key={heroKey}>
                    <div className='ptv-hero-eyebrow'>
                        {heroEyebrow}
                    </div>

                    {logoUrl ? (
                        <img
                            className='ptv-hero-logo'
                            src={logoUrl}
                            alt={heroTitle}
                            loading='eager'
                            decoding='async'
                        />
                    ) : (
                        <h1 className='ptv-hero-title'>
                            {heroTitle}
                        </h1>
                    )}

                    <div className='ptv-hero-meta' aria-label='Title details'>
                        {communityRating ? (
                            <span className='ptv-hero-meta-item ptv-hero-star-rating'>
                                <span className='ptv-hero-star' aria-hidden='true'>★</span>
                                {communityRating}
                            </span>
                        ) : null}
                        {criticRating ? (
                            <span className='ptv-hero-meta-item ptv-hero-critic-rating'>
                                <span className='ptv-hero-tomato' aria-hidden='true' />
                                {criticRating}
                            </span>
                        ) : null}
                        {heroItem?.ProductionYear ? (
                            <span className='ptv-hero-meta-item'>{heroItem.ProductionYear}</span>
                        ) : null}
                        {heroItem?.OfficialRating ? (
                            <span className='ptv-hero-meta-item'>
                                <span className='ptv-hero-rating-badge'>{heroItem.OfficialRating}</span>
                            </span>
                        ) : null}
                        {endsAt ? (
                            <span className='ptv-hero-meta-item'>Ends at {endsAt}</span>
                        ) : null}
                        {!communityRating && !criticRating && !heroItem?.ProductionYear && !heroItem?.OfficialRating && !endsAt ? (
                            <span className='ptv-hero-meta-item'>{heroType}</span>
                        ) : null}
                    </div>

                    <p className='ptv-hero-description'>
                        {heroItem?.Overview || PTV_BRANDING.welcomeDescription}
                    </p>

                    <div className='ptv-hero-actions'>
                        <a
                            className='ptv-hero-btn ptv-hero-btn-primary'
                            href={detailsUrl}
                        >
                            {heroItem ? 'Watch Now' : 'Play'}
                        </a>

                        <a
                            className='ptv-hero-btn ptv-hero-btn-secondary'
                            href={detailsUrl}
                        >
                            Show Details
                        </a>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Hero;
