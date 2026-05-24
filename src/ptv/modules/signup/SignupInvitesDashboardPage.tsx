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

import { PTV_PLUGIN_API, PTV_SERVICES } from '../../core/config';

type FrameState = 'blocked' | 'loading' | 'ready';

const SIGNUP_ADMIN_URL = PTV_SERVICES.signupAdminUrl;
const SIGNUP_INVITE_URL = PTV_SERVICES.signUpUrl;

function openExternal(url: string) {
    const externalWindow = window.open(url, '_blank', 'noopener,noreferrer');

    if (externalWindow) {
        externalWindow.opener = null;
    }
}

async function copyTextToClipboard(text: string) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    throw new Error(`Clipboard API unavailable for ${text.length} characters.`);
}

const SignupInvitesDashboardPage = () => {
    const [frameState, setFrameState] = useState<FrameState>('loading');
    const [statusMessage, setStatusMessage] = useState('');
    const proxyEndpoints = useMemo(() => [
        `GET /${PTV_PLUGIN_API.endpoints.jfaGoStatus}`,
        `GET /${PTV_PLUGIN_API.endpoints.jfaGoInvites}`,
        `POST /${PTV_PLUGIN_API.endpoints.jfaGoInvites}`,
        `DELETE /${PTV_PLUGIN_API.endpoints.jfaGoInvites}/:code`
    ], []);

    useEffect(() => {
        if (frameState !== 'loading') return undefined;

        const timer = window.setTimeout(() => {
            setFrameState(current => current === 'loading' ? 'blocked' : current);
        }, 9000);

        return () => window.clearTimeout(timer);
    }, [frameState]);

    const copyInviteLink = useCallback(() => {
        copyTextToClipboard(SIGNUP_INVITE_URL)
            .then(() => setStatusMessage('Invite link copied.'))
            .catch(() => setStatusMessage('Unable to copy invite link.'));
    }, []);

    const copyProxyContract = useCallback(() => {
        copyTextToClipboard(proxyEndpoints.join('\n'))
            .then(() => setStatusMessage('PTV jfa-go proxy contract copied.'))
            .catch(() => setStatusMessage('Unable to copy proxy contract.'));
    }, [proxyEndpoints]);
    const openSignupAdmin = useCallback(() => openExternal(SIGNUP_ADMIN_URL), []);
    const openSignupInvite = useCallback(() => openExternal(SIGNUP_INVITE_URL), []);
    const setFrameReady = useCallback(() => setFrameState('ready'), []);
    const setFrameBlocked = useCallback(() => setFrameState('blocked'), []);

    return (
        <Page
            id='ptvSignupInvitesPage'
            title='Signup / Invites'
            className='mainAnimatedPage type-interior ptv-dashboard-control-page ptv-signup-invites-page'
        >
            <Box className='content-primary ptv-dashboard-control-content ptv-signup-invites-content'>
                <Stack spacing={2}>
                    <Box>
                        <Typography variant='h1'>Signup / Invites</Typography>
                        <Typography variant='body1' color='text.secondary'>
                            Native PiggieTV control surface for the jfa-go invite engine.
                        </Typography>
                    </Box>

                    {statusMessage ? <Alert severity='info'>{statusMessage}</Alert> : null}

                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12, lg: 4 }}>
                            <Card className='ptv-dashboard-card ptv-control-card ptv-control-card-compact'>
                                <CardContent>
                                    <Stack spacing={1.5}>
                                        <Stack direction='row' justifyContent='space-between' alignItems='center'>
                                            <Typography variant='h2'>Invite Engine</Typography>
                                            <Chip
                                                className='ptv-status-badge ptv-status-badge-backend'
                                                label='jfa-go'
                                                size='small'
                                            />
                                        </Stack>
                                        <Divider />
                                        <Typography>
                                            Public invite: {PTV_SERVICES.signupInviteCode}
                                        </Typography>
                                        <Typography>
                                            Admin panel: {SIGNUP_ADMIN_URL}
                                        </Typography>
                                        <Typography>
                                            PiggieTV renders the native shell; jfa-go remains the account and invite backend.
                                        </Typography>
                                        <Stack direction='row' spacing={1.5} flexWrap='wrap' useFlexGap>
                                            <Button type='button' variant='contained' onClick={openSignupAdmin}>
                                                Open Admin
                                            </Button>
                                            <Button type='button' variant='outlined' onClick={openSignupInvite}>
                                                Open Invite
                                            </Button>
                                            <Button type='button' variant='outlined' onClick={copyInviteLink}>
                                                Copy Invite Link
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 8 }}>
                            <Card className='ptv-dashboard-card ptv-control-card ptv-signup-proxy-card'>
                                <CardContent>
                                    <Stack spacing={1.5}>
                                        <Stack direction='row' justifyContent='space-between' alignItems='center'>
                                            <Typography variant='h2'>Native Invite API</Typography>
                                            <Chip
                                                className='ptv-status-badge'
                                                label='backend proxy required'
                                                size='small'
                                            />
                                        </Stack>
                                        <Divider />
                                        <Alert severity='warning'>
                                            jfa-go admin API keys must stay server-side. Use the PTV plugin/helper proxy before enabling native create/disable invite actions in frontend JavaScript.
                                        </Alert>
                                        <Box className='ptv-signup-invite-fields'>
                                            <span>Active invites</span>
                                            <span>Expiration</span>
                                            <span>Max uses</span>
                                            <span>Profile assignment</span>
                                            <span>Create invite</span>
                                            <span>Disable invite</span>
                                            <span>Copy link</span>
                                            <span>Approval queue</span>
                                        </Box>
                                        <Button type='button' variant='outlined' onClick={copyProxyContract}>
                                            Copy Proxy Contract
                                        </Button>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Card className='ptv-dashboard-card ptv-control-card ptv-signup-admin-card'>
                                <CardContent>
                                    <Stack spacing={1.5}>
                                        <Stack direction='row' justifyContent='space-between' alignItems='center' flexWrap='wrap' gap={1.5}>
                                            <Box>
                                                <Typography variant='h2'>jfa-go Admin Panel</Typography>
                                                <Typography variant='body2' color='text.secondary'>
                                                    Embedded for invite management while the native backend proxy grows in.
                                                </Typography>
                                            </Box>
                                            <Chip
                                                className='ptv-status-badge'
                                                label={frameState === 'ready' ? 'embedded' : frameState}
                                                size='small'
                                            />
                                        </Stack>
                                        <Box className='ptv-signup-admin-frame-shell' data-ptv-frame-state={frameState}>
                                            {frameState === 'loading' ? (
                                                <Box className='ptv-signup-admin-frame-state'>Loading jfa-go admin...</Box>
                                            ) : null}
                                            {frameState === 'blocked' ? (
                                                <Box className='ptv-signup-admin-frame-state'>
                                                    <Typography variant='h2'>jfa-go blocked embedded access</Typography>
                                                    <Typography>
                                                        Check jfa-go frame/CSP settings, Cloudflare, and Nginx Proxy Manager headers.
                                                    </Typography>
                                                    <Button type='button' variant='contained' onClick={openSignupAdmin}>
                                                        Open jfa-go Admin
                                                    </Button>
                                                </Box>
                                            ) : null}
                                            <iframe
                                                className='ptv-signup-admin-frame'
                                                title='jfa-go admin panel'
                                                src={SIGNUP_ADMIN_URL}
                                                loading='lazy'
                                                referrerPolicy='no-referrer-when-downgrade'
                                                sandbox='allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts'
                                                allow='clipboard-read; clipboard-write'
                                                onLoad={setFrameReady}
                                                onError={setFrameBlocked}
                                            />
                                        </Box>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>
                    </Grid>
                </Stack>
            </Box>
        </Page>
    );
};

SignupInvitesDashboardPage.displayName = 'SignupInvitesDashboardPage';

export default SignupInvitesDashboardPage;
