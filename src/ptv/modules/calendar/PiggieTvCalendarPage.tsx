import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import Page from 'components/Page';

import {
    getCurrentPtvPluginApiClient,
    normalizePtvApiError
} from '../../core/pluginApi';

import '../dashboard/dashboard.scss';
import './calendar.scss';

type PtvArrCalendarServiceStatus = {
    configured?: boolean;
    enabled?: boolean;
    error?: string | null;
    itemCount?: number;
    service: string;
    statusCode?: number | null;
    supported?: boolean;
};

type PtvArrCalendarItem = {
    date?: string | null;
    episodeNumber?: number | null;
    episodeTitle?: string | null;
    externalUrl?: string | null;
    hasFile?: boolean | null;
    id: string;
    monitored?: boolean | null;
    overview?: string | null;
    seasonNumber?: number | null;
    seriesTitle?: string | null;
    service: string;
    sortDate?: string | null;
    status?: string | null;
    title: string;
};

type PtvArrCalendarResponse = {
    enabled?: boolean;
    end?: string;
    itemCount?: number;
    items?: PtvArrCalendarItem[];
    message?: string;
    ok?: boolean;
    services?: PtvArrCalendarServiceStatus[];
    start?: string;
};

type CalendarGroup = {
    dateLabel: string;
    key: string;
    items: PtvArrCalendarItem[];
};

const CALENDAR_DAYS_BEFORE = 7;
const CALENDAR_DAYS_AFTER = 45;
const EMPTY_CALENDAR_ITEMS: PtvArrCalendarItem[] = [];
const EMPTY_CALENDAR_SERVICES: PtvArrCalendarServiceStatus[] = [];

function getServiceLabel(service: string) {
    return {
        lidarr: 'Lidarr',
        radarr: 'Radarr',
        sonarr: 'Sonarr'
    }[service.toLowerCase()] || service;
}

function formatCalendarDate(value?: string | null) {
    if (!value) return 'Date TBA';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short',
        weekday: 'short'
    }).format(date);
}

function getSortKey(item: PtvArrCalendarItem) {
    return item.sortDate || item.date || '';
}

function getEpisodeLabel(item: PtvArrCalendarItem) {
    if (!item.seasonNumber && !item.episodeNumber) return item.episodeTitle || '';

    const season = String(item.seasonNumber || 0).padStart(2, '0');
    const episode = String(item.episodeNumber || 0).padStart(2, '0');
    const prefix = `S${season}E${episode}`;

    return item.episodeTitle ? `${prefix} - ${item.episodeTitle}` : prefix;
}

function groupCalendarItems(items: PtvArrCalendarItem[]): CalendarGroup[] {
    const groups = new Map<string, CalendarGroup>();

    [...items]
        .sort((left, right) => getSortKey(left).localeCompare(getSortKey(right)))
        .forEach(item => {
            const key = item.date ? item.date.slice(0, 10) : 'tba';
            const existing = groups.get(key);

            if (existing) {
                existing.items.push(item);
                return;
            }

            groups.set(key, {
                dateLabel: formatCalendarDate(item.date),
                items: [item],
                key
            });
        });

    return Array.from(groups.values());
}

function getCalendarErrorMessage(error: unknown) {
    const normalized = normalizePtvApiError(error);

    return normalized.message || 'Release calendar could not be loaded.';
}

const PiggieTvCalendarPage = () => {
    const [calendar, setCalendar] = useState<PtvArrCalendarResponse | null>(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const loadCalendar = useCallback(() => {
        const pluginApi = getCurrentPtvPluginApiClient();

        if (!pluginApi?.getArrCalendar) {
            setErrorMessage('PiggieTV plugin API is unavailable.');
            return Promise.resolve();
        }

        setLoading(true);
        setErrorMessage('');

        return pluginApi.getArrCalendar<PtvArrCalendarResponse>({
            params: {
                daysAfter: CALENDAR_DAYS_AFTER,
                daysBefore: CALENDAR_DAYS_BEFORE
            }
        })
            .then(response => {
                setCalendar(response);

                if (response?.ok === false) {
                    setErrorMessage(response.message || 'Release calendar returned a degraded response.');
                }
            })
            .catch(err => {
                setErrorMessage(getCalendarErrorMessage(err));
            })
            .finally(() => {
                setLoading(false);
            });
    }, []);

    useEffect(() => {
        void loadCalendar();
    }, [loadCalendar]);

    const items = calendar?.items || EMPTY_CALENDAR_ITEMS;
    const services = calendar?.services || EMPTY_CALENDAR_SERVICES;
    const groups = useMemo(() => groupCalendarItems(items), [items]);
    const activeServiceCount = services.filter(service => service.enabled && service.configured && service.supported).length;
    const serviceErrors = services.filter(service => service.error);

    return (
        <Page
            id='ptvCalendarPage'
            title='Release Calendar'
            className='mainAnimatedPage type-interior ptv-calendar-page'
        >
            <Box className='content-primary ptv-calendar-content'>
                <Stack spacing={3}>
                    <Stack direction='row' alignItems='flex-start' justifyContent='space-between' gap={2} flexWrap='wrap'>
                        <Box>
                            <Typography variant='h1' className='ptv-calendar-title'>Release Calendar</Typography>
                            <Typography className='ptv-calendar-subtitle'>
                                Upcoming releases from configured Sonarr, Radarr, and Lidarr services.
                            </Typography>
                        </Box>
                        <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                            <Chip className='ptv-status-badge ptv-status-badge-info' label={`${activeServiceCount} active services`} size='small' />
                            <Chip className='ptv-status-badge ptv-status-badge-backend' label={`${items.length} releases`} size='small' />
                            <Button type='button' variant='contained' onClick={loadCalendar} disabled={loading}>
                                {loading ? 'Refreshing...' : 'Refresh'}
                            </Button>
                        </Stack>
                    </Stack>

                    {errorMessage ? <Alert severity='warning'>{errorMessage}</Alert> : null}
                    {!loading && services.length > 0 && activeServiceCount === 0 ? (
                        <Alert severity='info'>
                            Configure and save a Sonarr, Radarr, or Lidarr API key in the PiggieTV dashboard to enable the release calendar.
                        </Alert>
                    ) : null}

                    <Grid container spacing={2}>
                        {services.map(service => (
                            <Grid key={service.service} size={{ xs: 12, sm: 6, md: 3 }}>
                                <Card className='ptv-dashboard-card ptv-calendar-service-card'>
                                    <CardContent>
                                        <Stack spacing={1}>
                                            <Stack direction='row' justifyContent='space-between' alignItems='center' gap={1}>
                                                <Typography variant='h2'>{getServiceLabel(service.service)}</Typography>
                                                <Chip
                                                    className={`ptv-status-badge ${service.enabled && service.configured && service.supported ? 'ptv-status-badge-info' : 'ptv-status-badge-path'}`}
                                                    label={service.enabled && service.configured && service.supported ? 'enabled' : 'inactive'}
                                                    size='small'
                                                />
                                            </Stack>
                                            <Typography className='ptv-calendar-service-meta'>
                                                {service.supported === false ? 'No calendar adapter' : `${service.itemCount || 0} items`}
                                            </Typography>
                                            {service.error ? (
                                                <Typography className='ptv-calendar-service-error'>{service.error}</Typography>
                                            ) : null}
                                        </Stack>
                                    </CardContent>
                                </Card>
                            </Grid>
                        ))}
                    </Grid>

                    {serviceErrors.length > 0 ? (
                        <Alert severity='warning'>
                            Some calendar providers returned warnings. PiggieTV will still show data from the services that responded.
                        </Alert>
                    ) : null}

                    <Card className='ptv-dashboard-card ptv-calendar-list-card'>
                        <CardContent>
                            <Stack spacing={2.5}>
                                <Stack direction='row' justifyContent='space-between' alignItems='center' gap={1} flexWrap='wrap'>
                                    <Box>
                                        <Typography variant='h2'>Upcoming</Typography>
                                        <Typography className='ptv-calendar-service-meta'>
                                            {calendar?.start || 'today'} through {calendar?.end || 'upcoming'}
                                        </Typography>
                                    </Box>
                                </Stack>
                                <Divider />

                                {loading && !calendar ? (
                                    <Typography className='ptv-calendar-empty'>Loading upcoming media...</Typography>
                                ) : null}

                                {!loading && groups.length === 0 ? (
                                    <Typography className='ptv-calendar-empty'>
                                        {calendar?.message || 'No upcoming releases were found.'}
                                    </Typography>
                                ) : null}

                                {groups.map(group => (
                                    <Box key={group.key} className='ptv-calendar-day-group'>
                                        <Typography className='ptv-calendar-day-heading'>{group.dateLabel}</Typography>
                                        <Grid container spacing={1.5}>
                                            {group.items.map(item => (
                                                <Grid key={item.id} size={{ xs: 12, md: 6, xl: 4 }}>
                                                    <Box className='ptv-calendar-item'>
                                                        <Stack spacing={1}>
                                                            <Stack direction='row' justifyContent='space-between' alignItems='center' gap={1}>
                                                                <Chip
                                                                    className='ptv-status-badge ptv-status-badge-info'
                                                                    label={getServiceLabel(item.service)}
                                                                    size='small'
                                                                />
                                                                <Chip
                                                                    className='ptv-status-badge ptv-status-badge-path'
                                                                    label={item.hasFile ? 'downloaded' : 'upcoming'}
                                                                    size='small'
                                                                />
                                                            </Stack>
                                                            <Typography className='ptv-calendar-item-title'>{item.title}</Typography>
                                                            {getEpisodeLabel(item) ? (
                                                                <Typography className='ptv-calendar-item-meta'>{getEpisodeLabel(item)}</Typography>
                                                            ) : null}
                                                            {item.seriesTitle && item.seriesTitle !== item.title ? (
                                                                <Typography className='ptv-calendar-item-meta'>{item.seriesTitle}</Typography>
                                                            ) : null}
                                                            {item.overview ? (
                                                                <Typography className='ptv-calendar-item-overview'>{item.overview}</Typography>
                                                            ) : null}
                                                        </Stack>
                                                    </Box>
                                                </Grid>
                                            ))}
                                        </Grid>
                                    </Box>
                                ))}
                            </Stack>
                        </CardContent>
                    </Card>
                </Stack>
            </Box>
        </Page>
    );
};

PiggieTvCalendarPage.displayName = 'PiggieTvCalendarPage';

export default PiggieTvCalendarPage;
