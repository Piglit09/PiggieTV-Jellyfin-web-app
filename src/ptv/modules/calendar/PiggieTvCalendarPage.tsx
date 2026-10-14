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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Page from 'components/Page';

import {
    getCurrentPtvPluginApiClient,
    normalizePtvApiError
} from '../../core/pluginApi';
import PTVShell from '../../shell/PTVShell';
import {
    capturePtvRouteCriticalLifecycleOwner,
    recordPtvRouteCriticalPending,
    recordPtvRouteCriticalTerminal,
    type PtvRouteCriticalLifecycleOwner,
    type PtvRouteCriticalTerminalOutcome
} from '../../shell/routeCriticalLifecycle';

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

    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ?
        new Date(`${value}T12:00:00`) :
        new Date(value);

    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short',
        weekday: 'short',
        year: 'numeric'
    }).format(date);
}

function getCalendarDateKey(value?: string | null) {
    if (!value) return 'tba';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return value.slice(0, 10);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
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

export function groupCalendarItems(items: PtvArrCalendarItem[]): CalendarGroup[] {
    const groups = new Map<string, CalendarGroup>();

    [...items]
        .sort((left, right) => getSortKey(left).localeCompare(getSortKey(right)))
        .forEach(item => {
            const key = getCalendarDateKey(item.date);
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

    return Array.from(groups.values()).sort((left, right) => {
        if (left.key === 'tba') return 1;
        if (right.key === 'tba') return -1;

        return left.key.localeCompare(right.key);
    });
}

function isConfiguredCalendarService(service: PtvArrCalendarServiceStatus) {
    return Boolean(service.enabled && service.configured && service.supported);
}

export function isHealthyCalendarService(service: PtvArrCalendarServiceStatus) {
    if (!isConfiguredCalendarService(service) || service.error) return false;

    return service.statusCode == null || (service.statusCode >= 200 && service.statusCode < 300);
}

export function getPtvCalendarRouteCriticalOutcome(
    response: PtvArrCalendarResponse
): PtvRouteCriticalTerminalOutcome {
    const items = response.items || EMPTY_CALENDAR_ITEMS;
    const configuredServices = (response.services || EMPTY_CALENDAR_SERVICES)
        .filter(isConfiguredCalendarService);
    const healthyServiceCount = configuredServices.filter(isHealthyCalendarService).length;
    const failedServiceCount = configuredServices.length - healthyServiceCount;

    if (healthyServiceCount > 0 && failedServiceCount > 0) return 'partial';
    if (items.length > 0) return response.ok === false || failedServiceCount > 0 ? 'partial' : 'success';
    if (failedServiceCount > 0 && healthyServiceCount === 0) return 'failed';
    if (response.ok === false && configuredServices.length > 0) return 'failed';

    return 'empty';
}

function getCalendarServiceState(service: PtvArrCalendarServiceStatus) {
    if (isHealthyCalendarService(service)) return 'healthy';
    if (isConfiguredCalendarService(service)) return 'degraded';

    return 'inactive';
}

function getCalendarServiceErrorMessage(service: PtvArrCalendarServiceStatus) {
    if (!service.error) return '';
    if (service.statusCode === 401 || service.statusCode === 403) return 'Authentication failed. Check the saved API key.';
    if (service.statusCode === 404) return 'The calendar endpoint is unavailable for this service.';
    if (service.statusCode && service.statusCode >= 500) return 'The service returned a server error.';
    if (service.error.toLowerCase().includes('timed out') || service.error.toLowerCase().includes('timeout')) {
        return 'The service timed out.';
    }

    return 'The service calendar could not be loaded.';
}

function getCalendarErrorMessage(error: unknown) {
    const normalized = normalizePtvApiError(error);

    return normalized.message || 'Release calendar could not be loaded.';
}

const PiggieTvCalendarPage = () => {
    const [calendar, setCalendar] = useState<PtvArrCalendarResponse | null>(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const requestRef = useRef<{
        controller: AbortController | null;
        generation: number;
        owner: PtvRouteCriticalLifecycleOwner;
        promise: Promise<void>;
    } | null>(null);
    const requestGenerationRef = useRef(0);

    const loadCalendar = useCallback(() => {
        if (requestRef.current) return requestRef.current.promise;

        const owner = capturePtvRouteCriticalLifecycleOwner('calendar');

        recordPtvRouteCriticalPending(owner);

        const pluginApi = getCurrentPtvPluginApiClient();

        if (!pluginApi?.getArrCalendar) {
            setErrorMessage('PiggieTV plugin API is unavailable.');
            recordPtvRouteCriticalTerminal(owner, 'failed');
            return Promise.resolve();
        }

        const generation = ++requestGenerationRef.current;
        // eslint-disable-next-line compat/compat -- Jellyfin provides the legacy-browser AbortController polyfill.
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        setLoading(true);
        setErrorMessage('');

        const promise = pluginApi.getArrCalendar<PtvArrCalendarResponse>({
            params: {
                daysAfter: CALENDAR_DAYS_AFTER,
                daysBefore: CALENDAR_DAYS_BEFORE
            },
            signal: controller?.signal
        })
            .then(response => {
                if (generation !== requestGenerationRef.current) return;
                setCalendar(response);
                recordPtvRouteCriticalTerminal(owner, getPtvCalendarRouteCriticalOutcome(response));

                if (response?.ok === false) {
                    setErrorMessage(response.message || 'Release calendar returned a degraded response.');
                }
            })
            .catch(err => {
                if (generation !== requestGenerationRef.current || controller?.signal.aborted) {
                    recordPtvRouteCriticalTerminal(owner, 'cancelled');
                    return;
                }
                setErrorMessage(getCalendarErrorMessage(err));
                recordPtvRouteCriticalTerminal(owner, 'failed');
            })
            .finally(() => {
                if (generation !== requestGenerationRef.current) return;
                requestRef.current = null;
                setLoading(false);
            });

        requestRef.current = { controller, generation, owner, promise };
        return promise;
    }, []);

    useEffect(() => {
        void loadCalendar();

        return () => {
            requestGenerationRef.current += 1;
            if (requestRef.current) {
                recordPtvRouteCriticalTerminal(requestRef.current.owner, 'cancelled');
            }
            requestRef.current?.controller?.abort();
            requestRef.current = null;
        };
    }, [loadCalendar]);

    const items = calendar?.items || EMPTY_CALENDAR_ITEMS;
    const services = calendar?.services || EMPTY_CALENDAR_SERVICES;
    const groups = useMemo(() => groupCalendarItems(items), [items]);
    const configuredServiceCount = services.filter(isConfiguredCalendarService).length;
    const activeServiceCount = services.filter(isHealthyCalendarService).length;
    const serviceErrors = services.filter(service => isConfiguredCalendarService(service) && service.error);

    return (
        <Page
            id='ptvCalendarPage'
            title='Release Calendar'
            className='mainAnimatedPage type-interior ptv-calendar-page'
        >
            <PTVShell section='request' showBackButton title='Release Calendar'>
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
                        {!loading && services.length > 0 && configuredServiceCount === 0 ? (
                            <Alert severity='info'>
                                Configure and save a Sonarr, Radarr, or Lidarr API key in the PiggieTV dashboard to enable the release calendar.
                            </Alert>
                        ) : null}

                        {!loading && configuredServiceCount > 0 && activeServiceCount === 0 ? (
                            <Alert severity='warning'>
                                Configured calendar providers are currently unavailable. Review each provider status and retry.
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
                                                        className={`ptv-status-badge ${isHealthyCalendarService(service) ? 'ptv-status-badge-info' : 'ptv-status-badge-path'}`}
                                                        label={getCalendarServiceState(service)}
                                                        size='small'
                                                    />
                                                </Stack>
                                                <Typography className='ptv-calendar-service-meta'>
                                                    {service.supported === false ? 'No calendar adapter' : `${service.itemCount || 0} items`}
                                                </Typography>
                                                {isConfiguredCalendarService(service) && service.error ? (
                                                    <Typography className='ptv-calendar-service-error'>{getCalendarServiceErrorMessage(service)}</Typography>
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
            </PTVShell>
        </Page>
    );
};

PiggieTvCalendarPage.displayName = 'PiggieTvCalendarPage';

export default PiggieTvCalendarPage;
