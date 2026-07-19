import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { PtvClientKind } from '../../core/clientProfile';
import { getCurrentPtvPluginApiClient, normalizePtvApiError } from '../../core/pluginApi';

type RemoteDiagnosticsClient = {
    clientId: string;
    diagnosticsActive: boolean;
    expiresAtUtc: string | null;
    hasReport: boolean;
    lastSeenUtc: string;
    lastLeaseRejection: string | null;
    leasePending: boolean;
    online: boolean;
    profile: PtvClientKind | 'unknown';
    reportedAtUtc: string | null;
    route: string;
    sessionId: string | null;
    snapshotPending: boolean;
};

type StoredRemoteDiagnosticsReport = {
    clientId: string;
    receivedAtUtc: string;
    report: unknown;
};

type BusyAction = 'download' | 'refresh' | 'report' | 'snapshot' | 'start' | 'stop' | null;

const PROFILE_FILTERS: Array<{ label: string; value: '' | PtvClientKind }> = [
    { label: 'All profiles', value: '' },
    { label: 'webOS', value: 'webos' },
    { label: 'Fire TV', value: 'firetv' },
    { label: 'TV / ten-foot', value: 'tv' },
    { label: 'Mobile', value: 'mobile' },
    { label: 'Desktop', value: 'desktop' }
];

function formatTimestamp(value: string | null | undefined) {
    if (!value) return 'n/a';

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatClientOption(client: RemoteDiagnosticsClient) {
    const shortId = client.clientId.slice(-8);
    const lastSeen = formatTimestamp(client.lastSeenUtc);

    return `${client.profile} | ${client.route} | ${shortId} | ${client.online ? 'online' : lastSeen}`;
}

function getApiErrorMessage(error: unknown) {
    return normalizePtvApiError(error).message || 'Remote diagnostics request failed.';
}

function getSessionLabel(client: RemoteDiagnosticsClient) {
    if (client.diagnosticsActive) return `client active until ${formatTimestamp(client.expiresAtUtc)}`;
    if (client.leasePending) return `waiting for client until ${formatTimestamp(client.expiresAtUtc)}`;

    return 'off';
}

function getPluginApi() {
    const pluginApi = getCurrentPtvPluginApiClient();
    if (!pluginApi) throw new Error('PiggieTV plugin API is not connected yet.');

    return pluginApi;
}

function downloadJson(value: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    // eslint-disable-next-line compat/compat -- Supported by every runtime targeted by the PiggieTV dashboard.
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    link.click();
    // eslint-disable-next-line compat/compat -- Paired with createObjectURL above to release the temporary report URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function RemoteDiagnosticsPanel() {
    const [busyAction, setBusyAction] = useState<BusyAction>(null);
    const [clients, setClients] = useState<RemoteDiagnosticsClient[]>([]);
    const [durationMinutes, setDurationMinutes] = useState<5 | 10>(5);
    const [errorMessage, setErrorMessage] = useState('');
    const [profileFilter, setProfileFilter] = useState<'' | PtvClientKind>('');
    const [report, setReport] = useState<StoredRemoteDiagnosticsReport | null>(null);
    const [selectedClientId, setSelectedClientId] = useState('');
    const [statusMessage, setStatusMessage] = useState('');

    const selectedClient = useMemo(
        () => clients.find(client => client.clientId === selectedClientId) || null,
        [clients, selectedClientId]
    );

    const refreshClients = useCallback(async (quiet = false) => {
        if (!quiet) setBusyAction('refresh');

        try {
            const nextClients = await getPluginApi().getRemoteDiagnosticsClients<RemoteDiagnosticsClient[]>(profileFilter || undefined, {
                bypassCache: true
            });

            setClients(nextClients);
            setSelectedClientId(previousId => {
                if (nextClients.some(client => client.clientId === previousId)) return previousId;

                return nextClients[0]?.clientId || '';
            });
            setErrorMessage('');
        } catch (error) {
            if (!quiet) setErrorMessage(getApiErrorMessage(error));
        } finally {
            if (!quiet) setBusyAction(null);
        }
    }, [profileFilter]);

    useEffect(() => {
        refreshClients().catch(() => undefined);
        const timer = window.setInterval(() => {
            refreshClients(true).catch(() => undefined);
        }, 15_000);

        return () => window.clearInterval(timer);
    }, [refreshClients]);

    useEffect(() => {
        setReport(null);
    }, [selectedClientId]);

    const runClientAction = useCallback(async (
        action: Exclude<BusyAction, 'download' | 'refresh' | 'report' | null>,
        request: (clientId: string) => Promise<unknown>,
        successMessage: string
    ) => {
        if (!selectedClientId) return;

        setBusyAction(action);
        setErrorMessage('');
        setStatusMessage('');
        try {
            await request(selectedClientId);
            setStatusMessage(successMessage);
            await refreshClients(true);
        } catch (error) {
            setErrorMessage(getApiErrorMessage(error));
        } finally {
            setBusyAction(null);
        }
    }, [refreshClients, selectedClientId]);

    const startSession = useCallback(() => runClientAction(
        'start',
        clientId => getPluginApi().startRemoteDiagnosticsSession(clientId, durationMinutes),
        `Temporary diagnostics enabled for ${durationMinutes} minutes. The client will receive the lease on its next local check-in.`
    ), [durationMinutes, runClientAction]);

    const stopSession = useCallback(() => runClientAction(
        'stop',
        clientId => getPluginApi().stopRemoteDiagnosticsSession(clientId),
        'Diagnostics lease revoked.'
    ), [runClientAction]);

    const requestSnapshot = useCallback(() => runClientAction(
        'snapshot',
        clientId => getPluginApi().requestRemoteDiagnosticsSnapshot(clientId),
        'One-time snapshot requested. Refresh after the client checks in.'
    ), [runClientAction]);

    const loadReport = useCallback(async (download = false) => {
        if (!selectedClientId) return;

        setBusyAction(download ? 'download' : 'report');
        setErrorMessage('');
        try {
            const nextReport = await getPluginApi().getRemoteDiagnosticsReport<StoredRemoteDiagnosticsReport>(selectedClientId, {
                bypassCache: true
            });

            setReport(nextReport);
            if (download) {
                const timestamp = nextReport.receivedAtUtc.replace(/[:.]/g, '-');
                downloadJson(nextReport.report, `piggie-tv-diagnostics-${selectedClientId}-${timestamp}.json`);
                setStatusMessage('Diagnostics report downloaded locally.');
            }
        } catch (error) {
            setErrorMessage(getApiErrorMessage(error));
        } finally {
            setBusyAction(null);
        }
    }, [selectedClientId]);

    const handleProfileFilterChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setProfileFilter(event.target.value as '' | PtvClientKind);
    }, []);
    const handleClientChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setSelectedClientId(event.target.value);
        setReport(null);
    }, []);
    const handleDurationChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setDurationMinutes(Number(event.target.value) === 10 ? 10 : 5);
    }, []);
    const handleRefresh = useCallback(() => {
        refreshClients().catch(() => undefined);
    }, [refreshClients]);
    const handleViewReport = useCallback(() => {
        loadReport().catch(() => undefined);
    }, [loadReport]);
    const handleDownloadReport = useCallback(() => {
        loadReport(true).catch(() => undefined);
    }, [loadReport]);

    return (
        <Stack spacing={1.25} data-ptv-remote-diagnostics-admin>
            <Divider />
            <Stack direction='row' alignItems='center' justifyContent='space-between' flexWrap='wrap' gap={1}>
                <Typography variant='h3'>Remote client diagnostics</Typography>
                <Chip
                    color={clients.some(client => client.sessionId) ? 'warning' : 'default'}
                    label={`${clients.length} recent client${clients.length === 1 ? '' : 's'}`}
                    size='small'
                />
            </Stack>
            <Typography color='text.secondary'>
                Local server only. Detailed collection is off by default, limited to a selected client for 5 or 10 minutes, held in memory, and automatically expires.
            </Typography>
            {errorMessage ? <Alert severity='error'>{errorMessage}</Alert> : null}
            {statusMessage ? <Alert severity='info'>{statusMessage}</Alert> : null}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                    fullWidth
                    label='Profile filter'
                    onChange={handleProfileFilterChange}
                    select
                    size='small'
                    value={profileFilter}
                >
                    {PROFILE_FILTERS.map(option => (
                        <MenuItem key={option.value || 'all'} value={option.value}>{option.label}</MenuItem>
                    ))}
                </TextField>
                <TextField
                    fullWidth
                    label='Client'
                    onChange={handleClientChange}
                    select
                    size='small'
                    value={selectedClientId}
                >
                    {clients.length === 0 ? <MenuItem disabled value=''>No clients checked in</MenuItem> : null}
                    {clients.map(client => (
                        <MenuItem key={client.clientId} value={client.clientId}>
                            {formatClientOption(client)}
                        </MenuItem>
                    ))}
                </TextField>
                <TextField
                    label='Duration'
                    onChange={handleDurationChange}
                    select
                    size='small'
                    value={durationMinutes}
                    sx={{ minWidth: 130 }}
                >
                    <MenuItem value={5}>5 minutes</MenuItem>
                    <MenuItem value={10}>10 minutes</MenuItem>
                </TextField>
            </Stack>
            {selectedClient ? (
                <Stack className='ptv-dashboard-status-list' spacing={0.5}>
                    <Typography>Profile / route: {selectedClient.profile} / {selectedClient.route}</Typography>
                    <Typography>Last seen: {formatTimestamp(selectedClient.lastSeenUtc)}</Typography>
                    <Typography>Session: {getSessionLabel(selectedClient)}</Typography>
                    <Typography>Lease rejection: {selectedClient.lastLeaseRejection || 'none'}</Typography>
                    <Typography>Snapshot: {selectedClient.snapshotPending ? 'pending' : 'not pending'}</Typography>
                    <Typography>Latest report: {selectedClient.hasReport ? formatTimestamp(selectedClient.reportedAtUtc) : 'none'}</Typography>
                </Stack>
            ) : null}
            <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                <Button disabled={busyAction !== null} onClick={handleRefresh} variant='outlined'>Refresh clients</Button>
                <Button disabled={!selectedClient || busyAction !== null} onClick={startSession} variant='contained'>Start diagnostics</Button>
                <Button disabled={!selectedClient?.sessionId || busyAction !== null} onClick={stopSession} variant='outlined'>Stop</Button>
                <Button disabled={!selectedClient || busyAction !== null} onClick={requestSnapshot} variant='outlined'>Request snapshot</Button>
                <Button disabled={!selectedClient?.hasReport || busyAction !== null} onClick={handleViewReport} variant='outlined'>View report</Button>
                <Button disabled={!selectedClient?.hasReport || busyAction !== null} onClick={handleDownloadReport} variant='outlined'>Download report</Button>
            </Stack>
            {report ? (
                <Box
                    component='pre'
                    sx={{
                        backgroundColor: 'rgba(0, 0, 0, 0.25)',
                        borderRadius: 1,
                        maxHeight: 360,
                        overflow: 'auto',
                        p: 1.25,
                        whiteSpace: 'pre-wrap'
                    }}
                >
                    {JSON.stringify(report.report, null, 2)}
                </Box>
            ) : null}
        </Stack>
    );
}
