import React, { useCallback, useMemo, useState } from 'react';

import Page from 'components/Page';

import {
    getPtvCurrentUser,
    getPtvItemImageCandidates,
    getPtvItemImageUrl,
    isPtvAdminUser
} from '../../api';
import { PTV_ROUTES } from '../../core/config';
import {
    recordPtvItemRouteClick,
    resolvePtvItemRoute
} from '../../core/itemRoutes';
import { recordPtvEvent } from '../../core/observability';
import { PtvIcon } from '../icons';
import { getPtvRecommendationDashboardData } from './engine/recommendationEngine';
import { getRecommendationTitle } from './scoring/metadata';
import type {
    PtvRecommendationDashboardData,
    PtvRecommendationMediaType,
    PtvRecommendationMix,
    PtvRecommendationRow,
    PtvRecommendationScore
} from './types/recommendationTypes';

import './recommendations.scss';

const HOME_FOCUS_ROW_IDS = new Set([
    'recommended-for-you',
    'because-you-watched',
    'ptv-discovery',
    'rediscover'
]);

const RECOMMENDATION_HUB_TABS = [
    {
        href: PTV_ROUTES.recommendations,
        label: 'Recommendations'
    },
    {
        href: PTV_ROUTES.music,
        label: 'Music'
    },
    {
        href: PTV_ROUTES.reading,
        label: 'Reading'
    },
    {
        href: '#/tv?topParentId=anime',
        label: 'Anime'
    }
];

type HubSection = {
    ctaHref: string;
    ctaLabel: string;
    id: string;
    rows: PtvRecommendationRow[];
    title: string;
};

function getErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error;
    if (error === undefined) return 'unknown error: request rejected without error detail';
    if (error === null) return 'unknown error: request rejected with null error';

    return 'unknown error';
}

function getMediaTypeLabel(mediaType: PtvRecommendationMediaType | 'mixed' | undefined) {
    if (!mediaType || mediaType === 'mixed') return 'Mixed';
    if (mediaType === 'show') return 'Shows';
    if (mediaType === 'movie') return 'Movies';
    if (mediaType === 'audiobook') return 'Audiobooks';

    return mediaType.charAt(0).toUpperCase() + mediaType.slice(1);
}

function isReadingMedia(mediaType: PtvRecommendationMediaType | 'mixed' | undefined) {
    return mediaType === 'book'
        || mediaType === 'comic'
        || mediaType === 'manga'
        || mediaType === 'audiobook';
}

function getHubSectionId(row: PtvRecommendationRow) {
    if (row.id.startsWith('because-you-like-')) return 'genres';
    if (row.mediaType === 'music' || row.id.includes('listen') || row.id.includes('music')) return 'music';
    if (isReadingMedia(row.mediaType)) return 'reading';
    if (row.mediaType === 'anime' || row.id.includes('anime')) return 'anime';
    if (row.mediaType === 'movie' || row.mediaType === 'show') return 'video';

    return 'discovery';
}

function makeMixRow(mix: PtvRecommendationMix): PtvRecommendationRow {
    return {
        explanation: mix.description,
        id: `mix-${mix.id}`,
        items: mix.items,
        mediaType: 'mixed',
        title: mix.title
    };
}

function getHubSections(data: PtvRecommendationDashboardData | null): HubSection[] {
    if (!data) return [];

    const rows = [
        ...data.rows.filter(row => !HOME_FOCUS_ROW_IDS.has(row.id)),
        ...data.mixes.map(makeMixRow)
    ];
    const sectionMap = new Map<string, HubSection>([
        ['video', {
            ctaHref: '#/movies',
            ctaLabel: 'Open Movies',
            id: 'video',
            rows: [],
            title: 'Movies & Shows'
        }],
        ['anime', {
            ctaHref: '#/tv?topParentId=anime',
            ctaLabel: 'Open Anime',
            id: 'anime',
            rows: [],
            title: 'Anime'
        }],
        ['reading', {
            ctaHref: PTV_ROUTES.reading,
            ctaLabel: 'Open Reading',
            id: 'reading',
            rows: [],
            title: 'Reading'
        }],
        ['music', {
            ctaHref: PTV_ROUTES.music,
            ctaLabel: 'Open Music',
            id: 'music',
            rows: [],
            title: 'Music'
        }],
        ['genres', {
            ctaHref: PTV_ROUTES.search,
            ctaLabel: 'Search',
            id: 'genres',
            rows: [],
            title: 'Genre Recommendations'
        }],
        ['discovery', {
            ctaHref: PTV_ROUTES.search,
            ctaLabel: 'Explore',
            id: 'discovery',
            rows: [],
            title: 'Discovery'
        }]
    ]);

    rows.forEach(row => {
        const section = sectionMap.get(getHubSectionId(row));

        if (section && row.items.length) {
            section.rows.push(row);
        }
    });

    return Array.from(sectionMap.values()).filter(section => section.rows.length);
}

function getScoreHref(score: PtvRecommendationScore) {
    return resolvePtvItemRoute(score.item, {
        fallbackHref: PTV_ROUTES.search,
        mediaType: score.mediaType,
        source: 'recommendations-hub'
    });
}

function getScoreImageUrl(score: PtvRecommendationScore) {
    const candidates = getPtvItemImageCandidates(score.item, {
        baseOptions: {
            fillHeight: 360,
            fillWidth: 240,
            quality: 88
        },
        order: ['Primary', 'ParentPrimary', 'Thumb', 'Backdrop', 'SeriesPrimary']
    });
    const tagged = candidates.find(candidate => candidate.tag);

    return tagged?.url
        || candidates[0]?.url
        || getPtvItemImageUrl(score.item, {
            fillHeight: 360,
            fillWidth: 240,
            imageType: 'Primary',
            quality: 88
        });
}

function RecommendationCard({ score }: Readonly<{ score: PtvRecommendationScore }>) {
    const title = getRecommendationTitle(score.item);
    const imageUrl = getScoreImageUrl(score);
    const reasons = score.reasons.map(reason => reason.label).slice(0, 3).join(', ');
    const route = getScoreHref(score);
    const handleClick = () => {
        recordPtvItemRouteClick(score.item, route, {
            action: 'open-card',
            mediaType: score.mediaType,
            source: 'recommendations-hub'
        });
    };

    return (
        <a
            className='ptv-recommendations-card'
            data-ptv-route-fallback-reason={route.fallbackReason}
            data-ptv-route-source={route.routeSource}
            href={route.href}
            onClick={handleClick}
        >
            <span className='ptv-recommendations-card-art'>
                {imageUrl ? <img alt='' loading='lazy' src={imageUrl} /> : <span>{title.slice(0, 1)}</span>}
            </span>
            <strong>{title}</strong>
            <small>{getMediaTypeLabel(score.mediaType)} - Score {Math.round(score.score)}</small>
            {reasons ? <em>{reasons}</em> : null}
        </a>
    );
}

function RecommendationRowView({ row }: Readonly<{ row: PtvRecommendationRow }>) {
    return (
        <section className='ptv-recommendations-row'>
            <div className='ptv-recommendations-row-heading'>
                <div>
                    <p>{getMediaTypeLabel(row.mediaType)}</p>
                    <h3>{row.title}</h3>
                    <span>{row.explanation}</span>
                </div>
            </div>
            <div className='ptv-recommendations-rail'>
                {row.items.slice(0, 18).map(score => (
                    <RecommendationCard key={`${row.id}-${score.item.Id || score.item.ProviderIds?.Imdb || score.item.ProviderIds?.Tmdb || getRecommendationTitle(score.item)}-${score.mediaType}-${score.score}`} score={score} />
                ))}
            </div>
        </section>
    );
}

function HubSectionView({ section }: Readonly<{ section: HubSection }>) {
    return (
        <section className='ptv-recommendations-section'>
            <div className='ptv-recommendations-section-heading'>
                <h2>{section.title}</h2>
                <a href={section.ctaHref}>{section.ctaLabel}</a>
            </div>
            {section.rows.map(row => (
                <RecommendationRowView key={row.id} row={row} />
            ))}
        </section>
    );
}

async function ensureRecommendationAdmin() {
    const user = await getPtvCurrentUser();

    if (!isPtvAdminUser(user)) {
        throw new Error('Recommendation generation is available to Jellyfin administrators only.');
    }
}

export default function RecommendationsHubPage() {
    const [data, setData] = useState<PtvRecommendationDashboardData | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const sections = useMemo(() => getHubSections(data), [data]);

    const loadHub = useCallback((forceRefresh = false) => {
        setLoading(true);
        setError('');

        void ensureRecommendationAdmin()
            .then(() => getPtvRecommendationDashboardData({ forceRefresh }))
            .then(nextData => {
                setData(nextData);
                recordPtvEvent('recommendation', 'recommendations-hub-rendered', {
                    candidateCount: nextData.candidates.length,
                    hiddenHomeRowCount: nextData.rows.filter(row => HOME_FOCUS_ROW_IDS.has(row.id)).length,
                    hubRowCount: getHubSections(nextData).reduce((total, section) => total + section.rows.length, 0),
                    route: window.location.hash
                });
            })
            .catch(loadError => {
                setError(getErrorMessage(loadError));
            })
            .finally(() => {
                setLoading(false);
            });
    }, []);

    const refreshHub = useCallback(() => {
        loadHub(true);
    }, [loadHub]);
    let recommendationActionLabel = 'Generate';

    if (loading) {
        recommendationActionLabel = 'Generating';
    } else if (data) {
        recommendationActionLabel = 'Refresh';
    }

    return (
        <Page
            id='ptvRecommendationsHubPage'
            title='Recommendations'
            className='ptv-recommendations-page'
            isBackButtonEnabled={false}
            isMenuButtonEnabled
        >
            <main className='ptv-recommendations-hub'>
                <header className='ptv-recommendations-hero'>
                    <div>
                        <p>Recommendations Hub</p>
                        <h1>Recommendations</h1>
                        <span>{data ? `${data.metrics.recommendationCount} candidates - ${data.rows.length} generated rows` : 'Generate local library recommendations'}</span>
                        <nav className='ptv-recommendations-tabs' aria-label='Recommendation destinations'>
                            {RECOMMENDATION_HUB_TABS.map(tab => (
                                <a
                                    key={tab.href}
                                    className={tab.href === PTV_ROUTES.recommendations ? 'ptv-recommendations-tab-active' : ''}
                                    href={tab.href}
                                >
                                    {tab.label}
                                </a>
                            ))}
                        </nav>
                    </div>
                    <button type='button' onClick={refreshHub} disabled={loading}>
                        <PtvIcon name='refresh' />
                        <span>{recommendationActionLabel}</span>
                    </button>
                </header>

                {error ? (
                    <section className='ptv-recommendations-error' role='alert'>
                        {error}
                    </section>
                ) : null}

                {loading && !data ? (
                    <section className='ptv-recommendations-loading' role='status'>
                        Generating recommendations
                    </section>
                ) : null}

                {sections.map(section => (
                    <HubSectionView key={section.id} section={section} />
                ))}
            </main>
        </Page>
    );
}
