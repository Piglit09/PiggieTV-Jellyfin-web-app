import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { useCallback, useEffect, useState, type MouseEvent } from 'react';

import Page from 'components/Page';

import { getPtvCurrentUser, isPtvAdminUser } from '../../api';
import { getPtvRouteControllerState } from '../../shell/routeController';
import {
    logPtvRecommendationFailure,
    logPtvRecommendationStage
} from './debug/recommendationRuntimeDebug';
import { getPtvRecommendationDashboardData } from './engine/recommendationEngine';
import type {
    PtvRecommendationDashboardData,
    PtvRecommendationScore
} from './types/recommendationTypes';

const PTV_ROW_BUILDER_HASH = '#/dashboard/piggietv/rows';

function getErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error;
    if (error === undefined) return 'unknown error: request rejected without error detail';
    if (error === null) return 'unknown error: request rejected with null error';

    return 'unknown error';
}

function getItemTitle(score: PtvRecommendationScore) {
    return score.item.Name
        || score.item.SeriesName
        || score.item.Album
        || score.item.Id
        || 'Untitled';
}

async function ensureRecommendationAdmin() {
    const user = await getPtvCurrentUser();

    if (!isPtvAdminUser(user)) {
        throw new Error('Recommendation generation is available to Jellyfin administrators only.');
    }
}

const RecommendationDashboardPage = () => {
    const [ initialRouteState ] = useState(() => getPtvRouteControllerState());
    const [ data, setData ] = useState<PtvRecommendationDashboardData | null>(null);
    const [ error, setError ] = useState('');
    const [ loading, setLoading ] = useState(false);

    const loadRecommendations = useCallback(async (forceRefresh = false) => {
        setLoading(true);
        setError('');

        try {
            await ensureRecommendationAdmin();
            const nextData = await getPtvRecommendationDashboardData({ forceRefresh });

            setData(nextData);
            logPtvRecommendationStage('Dashboard data loaded', {
                candidateCount: nextData.candidates.length,
                duplicateItemsRemoved: nextData.metrics.duplicateItemsRemoved,
                forceRefresh,
                recommendationRowsLoaded: nextData.rows.length,
                rowOverlapPercentage: nextData.metrics.rowOverlapPercentage,
                unresolvedArtistCount: nextData.metrics.unresolvedArtistCount
            });
        } catch (loadError) {
            const message = getErrorMessage(loadError);

            setError(message);
            logPtvRecommendationFailure('Dashboard data load', loadError, {
                forceRefresh,
                routeId: initialRouteState.routeId,
                windowLocationHash: window.location.hash
            });
        } finally {
            setLoading(false);
        }
    }, [ initialRouteState.routeId ]);

    useEffect(() => {
        logPtvRecommendationStage('Component mounted', {
            componentMounted: true,
            currentHash: window.location.hash,
            currentPageType: initialRouteState.pageType,
            currentRouteId: initialRouteState.routeId,
            currentRouteMode: initialRouteState.mode,
            pathname: window.location.pathname,
            route: 'piggietv/recommendations',
            windowLocationHash: window.location.hash
        });
    }, [ initialRouteState.mode, initialRouteState.pageType, initialRouteState.routeId ]);

    useEffect(() => {
        logPtvRecommendationStage('Dashboard rendered', {
            candidateCount: data?.candidates.length || 0,
            currentHash: window.location.hash,
            currentPageType: initialRouteState.pageType,
            currentRouteId: initialRouteState.routeId,
            error: error || '',
            loading,
            duplicateItemsRemoved: data?.metrics.duplicateItemsRemoved || 0,
            recommendationRowsRendered: data?.rows.length || 0,
            rowOverlapPercentage: data?.metrics.rowOverlapPercentage || 0,
            scoreDistribution: data?.metrics.scoreDistribution || null,
            unresolvedArtistCount: data?.metrics.unresolvedArtistCount || 0,
            windowLocationHash: window.location.hash
        });
    }, [ data, error, initialRouteState.pageType, initialRouteState.routeId, loading ]);

    const refreshRecommendations = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        void loadRecommendations(true);
    }, [ loadRecommendations ]);

    const openRowBuilder = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        window.location.hash = PTV_ROW_BUILDER_HASH;
    }, []);

    const rows = data?.rows || [];
    const topCandidates = data?.candidates.slice(0, 8) || [];
    let recommendationActionLabel = 'Generate';

    if (loading) {
        recommendationActionLabel = 'Generating...';
    } else if (data) {
        recommendationActionLabel = 'Refresh';
    }

    return (
        <Page
            id='ptvRecommendationDashboardPage'
            title='PiggieTV Recommendations'
            className='ptv-dashboard-page ptv-recommendation-dashboard-page'
            isMenuButtonEnabled
        >
            <Box sx={{ p: { xs: 2, md: 3 } }}>
                <Stack spacing={2.5}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent='space-between' alignItems={{ xs: 'stretch', md: 'center' }}>
                        <Box>
                            <Typography variant='h1'>PiggieTV Recommendations</Typography>
                            <Typography variant='body2' color='text.secondary'>
                                Runtime route check for the native recommendation engine.
                            </Typography>
                        </Box>
                        <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                            <Button type='button' variant='contained' disabled={loading} onClick={refreshRecommendations}>
                                {recommendationActionLabel}
                            </Button>
                            <Button href={PTV_ROW_BUILDER_HASH} variant='outlined' onClick={openRowBuilder}>
                                Open Row Builder
                            </Button>
                        </Stack>
                    </Stack>

                    <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                        <Chip label={`routeId=${initialRouteState.routeId}`} size='small' />
                        <Chip label={`mode=${initialRouteState.mode}`} size='small' />
                        <Chip label={`hash=${initialRouteState.hash || window.location.hash}`} size='small' />
                    </Stack>

                    {loading ? <LinearProgress /> : null}

                    {error ? (
                        <Alert severity='error'>
                            {error}
                        </Alert>
                    ) : null}

                    <Card className='ptv-dashboard-card ptv-control-card'>
                        <CardContent>
                            <Stack spacing={1.5}>
                                <Typography variant='h2'>Runtime Status</Typography>
                                <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                                    <Chip label={`recommendations=${data?.metrics.recommendationCount || 0}`} size='small' color={data ? 'success' : 'default'} />
                                    <Chip label={`rows=${rows.length}`} size='small' color={rows.length ? 'success' : 'default'} />
                                    <Chip label={`sources=${data?.metrics.sourceCount || 0}`} size='small' />
                                    <Chip label={`crossMedia=${data?.metrics.crossMediaMatches || 0}`} size='small' />
                                    <Chip label={`dupesRemoved=${data?.metrics.duplicateItemsRemoved || 0}`} size='small' />
                                    <Chip label={`overlap=${data?.metrics.rowOverlapPercentage || 0}%`} size='small' />
                                    <Chip label={`unknownArtists=${data?.metrics.unresolvedArtistCount || 0}`} size='small' />
                                    <Chip label={`scoreP90=${data?.metrics.scoreDistribution.p90 || 0}`} size='small' />
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>

                    <Card className='ptv-dashboard-card ptv-control-card'>
                        <CardContent>
                            <Stack spacing={1.5}>
                                <Typography variant='h2'>Generated Rows</Typography>
                                {rows.length ? rows.map(row => (
                                    <Box key={row.id} sx={{ borderTop: theme => `1px solid ${theme.palette.divider}`, pt: 1.25 }}>
                                        <Typography variant='subtitle1'>{row.title}</Typography>
                                        <Typography variant='body2' color='text.secondary'>
                                            {row.items.length} items - {row.explanation}
                                        </Typography>
                                    </Box>
                                )) : (
                                    <Typography variant='body2' color='text.secondary'>
                                        No recommendation rows generated yet.
                                    </Typography>
                                )}
                            </Stack>
                        </CardContent>
                    </Card>

                    <Card className='ptv-dashboard-card ptv-control-card'>
                        <CardContent>
                            <Stack spacing={1.5}>
                                <Typography variant='h2'>Top Candidates</Typography>
                                {topCandidates.length ? topCandidates.map(candidate => (
                                    <Stack key={`${candidate.item.Id || getItemTitle(candidate)}-${candidate.score}`} spacing={0.5}>
                                        <Typography variant='subtitle1'>{getItemTitle(candidate)}</Typography>
                                        <Typography variant='body2' color='text.secondary'>
                                            Score {Math.round(candidate.score)} - {candidate.mediaType} - {candidate.reasons.map(reason => reason.label).join(', ')}
                                        </Typography>
                                    </Stack>
                                )) : (
                                    <Typography variant='body2' color='text.secondary'>
                                        No candidates loaded yet.
                                    </Typography>
                                )}
                            </Stack>
                        </CardContent>
                    </Card>
                </Stack>
            </Box>
        </Page>
    );
};

RecommendationDashboardPage.displayName = 'RecommendationDashboardPage';

export default RecommendationDashboardPage;
