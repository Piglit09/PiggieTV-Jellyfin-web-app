import React, { lazy, Suspense, useCallback, useEffect, useMemo } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';

import Page from 'components/Page';
import Loading from 'components/loading/LoadingComponent';
import { useApi } from '../../../hooks/useApi';
import { useQuickConnectEnabled } from '../../../hooks/useQuickConnect';

import ProfilePage from '../account/ProfilePage';
import {
    startPtvAccountProfileService,
    usePtvAccountProfile
} from '../account/accountProfileStore';
import PtvSettingsLayout from './PtvSettingsLayout';
import SettingsHub from './SettingsHub';
import {
    getPtvSettingsSection,
    type PtvSettingsSectionId
} from './settingsModel';
import AdminSettings from './pages/AdminSettings';
import AppearanceSettings from './pages/AppearanceSettings';
import ConnectionSettings from './pages/ConnectionSettings';
import ControlSettings from './pages/ControlSettings';
import DeviceSettings from './pages/DeviceSettings';
import HomeSettings from './pages/HomeSettings';
import MediaSettings from './pages/MediaSettings';
import PlaybackSettings from './pages/PlaybackSettings';
import SubtitleSettings from './pages/SubtitleSettings';

const AdminUsersRoute = lazy(() => import('./admin/users/AdminUsersRoute'));
const AdminPeopleRoute = lazy(() => import('./admin/people/AdminPeopleRoute'));
const AdminLibrariesRoute = lazy(() => import('./admin/libraries/AdminLibrariesRoute'));
const AdminLibraryDisplayRoute = lazy(() => import('./admin/libraryDisplay/AdminLibraryDisplayRoute'));
const AdminMetadataRoute = lazy(() => import('./admin/metadata/AdminMetadataRoute'));
const AdminMetadataQualityRoute = lazy(() => import('./admin/metadataQuality/AdminMetadataQualityRoute'));
const AdminMetadataManagerRoute = lazy(() => import('./admin/metadataManager/AdminMetadataManagerRoute'));
const AdminNfoRoute = lazy(() => import('./admin/nfo/AdminNfoRoute'));
const AdminLiveTvRoute = lazy(() => import('./admin/liveTv/AdminLiveTvRoute'));
const AdminPlaybackRoute = lazy(() => import('./admin/playback/AdminPlaybackRoute'));
const AdminPiggietvRoute = lazy(() => import('./admin/piggietv/AdminPiggietvRoute'));
const AdminPluginsRoute = lazy(() => import('./admin/plugins/AdminPluginsRoute'));
const AdminServerRoute = lazy(() => import('./admin/server/AdminServerRoute'));
const AdminTasksRoute = lazy(() => import('./admin/tasks/AdminTasksRoute'));
const AdminSignupInvitesRoute = lazy(() => import('./admin/signupInvites/AdminSignupInvitesRoute'));

function normalizeSettingsPathname(pathname: string) {
    let normalized = pathname;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized || '/';
}

function sectionContent(
    section: PtvSettingsSectionId,
    context: Readonly<{
        api: ReturnType<typeof useApi>['api'];
        apiClient: ReturnType<typeof useApi>['__legacyApiClient__'];
        avatarUrl: string;
        email?: string | null;
        isAdministrator: boolean;
        quickConnectEnabled: boolean;
        userId: string;
        username: string;
    }>
) {
    switch (section) {
        case 'profile':
            return <ProfilePage avatarUrl={context.avatarUrl} embedded isAdministrator={context.isAdministrator} />;
        case 'devices':
            return <DeviceSettings api={context.api} apiClient={context.apiClient} quickConnectEnabled={context.quickConnectEnabled} userId={context.userId} />;
        case 'appearance':
            return <AppearanceSettings />;
        case 'home':
            return <HomeSettings apiClient={context.apiClient} userId={context.userId} />;
        case 'playback':
            return <PlaybackSettings apiClient={context.apiClient} userId={context.userId} />;
        case 'subtitles':
            return <SubtitleSettings apiClient={context.apiClient} userId={context.userId} />;
        case 'controls':
            return <ControlSettings />;
        case 'connection':
            return <ConnectionSettings apiClient={context.apiClient} />;
        case 'admin':
            return <AdminSettings api={context.api} apiClient={context.apiClient} />;
        case 'admin-activity':
            return <Suspense fallback={<Loading />}><AdminPeopleRoute section='activity' /></Suspense>;
        case 'admin-devices':
            return <Suspense fallback={<Loading />}><AdminPeopleRoute section='devices' /></Suspense>;
        case 'admin-library-display':
            return <Suspense fallback={<Loading />}><AdminLibraryDisplayRoute /></Suspense>;
        case 'admin-library-metadata':
            return <Suspense fallback={<Loading />}><AdminMetadataRoute /></Suspense>;
        case 'admin-library-nfo':
            return <Suspense fallback={<Loading />}><AdminNfoRoute /></Suspense>;
        case 'admin-live-tv':
        case 'admin-dvr':
            return <Suspense fallback={<Loading />}><AdminLiveTvRoute /></Suspense>;
        case 'admin-metadata-quality':
            return <Suspense fallback={<Loading />}><AdminMetadataQualityRoute /></Suspense>;
        case 'admin-metadata-manager':
            return <Suspense fallback={<Loading />}><AdminMetadataManagerRoute /></Suspense>;
        case 'admin-playback':
            return <Suspense fallback={<Loading />}><AdminPlaybackRoute /></Suspense>;
        case 'admin-piggietv':
            return <Suspense fallback={<Loading />}><AdminPiggietvRoute /></Suspense>;
        case 'admin-plugins':
            return <Suspense fallback={<Loading />}><AdminPluginsRoute /></Suspense>;
        case 'admin-server':
            return <Suspense fallback={<Loading />}><AdminServerRoute /></Suspense>;
        case 'admin-tasks':
            return <Suspense fallback={<Loading />}><AdminTasksRoute /></Suspense>;
        case 'admin-signup-invites':
            return <Suspense fallback={<Loading />}><AdminSignupInvitesRoute /></Suspense>;
        case 'admin-libraries':
            return <Suspense fallback={<Loading />}><AdminLibrariesRoute /></Suspense>;
        case 'admin-users':
            return <Suspense fallback={<Loading />}><AdminUsersRoute /></Suspense>;
        case 'media':
            return <MediaSettings />;
        case 'hub':
        default:
            return <SettingsHub email={context.email} isAdministrator={context.isAdministrator} username={context.username} />;
    }
}

export default function SettingsPage() {
    const location = useLocation();
    const {
        __legacyApiClient__: apiClient,
        api,
        currentUserStatus: apiCurrentUserStatus,
        retryCurrentUser,
        user
    } = useApi();
    const quickConnect = useQuickConnectEnabled();
    const account = usePtvAccountProfile();
    const section = getPtvSettingsSection(location.pathname);
    const normalizedPathname = normalizeSettingsPathname(location.pathname);
    const isUnknownAdminRoute = section === 'admin' && normalizedPathname !== '/settings/admin';
    const requiresAdministrator = section === 'admin'
        || section === 'admin-activity'
        || section === 'admin-devices'
        || section === 'admin-library-display'
        || section === 'admin-library-metadata'
        || section === 'admin-library-nfo'
        || section === 'admin-libraries'
        || section === 'admin-live-tv'
        || section === 'admin-dvr'
        || section === 'admin-metadata-quality'
        || section === 'admin-metadata-manager'
        || section === 'admin-playback'
        || section === 'admin-piggietv'
        || section === 'admin-plugins'
        || section === 'admin-server'
        || section === 'admin-tasks'
        || section === 'admin-signup-invites'
        || section === 'admin-users'
        || section === 'media';
    const userId = user?.Id || '';
    const username = user?.Name || account.profile?.username || 'PiggieTV member';
    const currentUserStatus = apiCurrentUserStatus || (user ? 'ready' : 'loading');
    const isAdministrator = Boolean(user?.Policy?.IsAdministrator);
    const handleRetryCurrentUser = useCallback(() => {
        retryCurrentUser?.().catch(() => undefined);
    }, [retryCurrentUser]);
    const avatarUrl = useMemo(() => (
        userId && user?.PrimaryImageTag && apiClient ? apiClient.getUserImageUrl(userId, {
            maxHeight: 160,
            maxWidth: 160,
            tag: user.PrimaryImageTag,
            type: 'Primary'
        }) : ''
    ), [apiClient, user?.PrimaryImageTag, userId]);

    useEffect(() => startPtvAccountProfileService(), []);

    if (requiresAdministrator && (currentUserStatus !== 'ready' || !user)) {
        if (currentUserStatus === 'error') {
            return (
                <Page
                    className='mainAnimatedPage noSecondaryNavPage ptv-settings-page'
                    id='ptvSettingsPage'
                    isBackButtonEnabled={false}
                    isMenuButtonEnabled
                    shouldAutoFocus
                    title='Settings'
                >
                    <main className='ptv-settings-hub'>
                        <section aria-labelledby='ptv-admin-auth-error-title' className='ptv-settings-group' role='alert'>
                            <header>
                                <h1 id='ptv-admin-auth-error-title'>Administration unavailable</h1>
                                <p>We could not verify your administrator access. No administration data was loaded.</p>
                            </header>
                            <div className='ptv-settings-form-actions'>
                                <Link to='/settings'>Back to Settings</Link>
                                <button
                                    disabled={!retryCurrentUser}
                                    onClick={handleRetryCurrentUser}
                                    type='button'
                                >
                                    Retry authorization
                                </button>
                            </div>
                        </section>
                    </main>
                </Page>
            );
        }

        return <Loading />;
    }

    if (requiresAdministrator && !isAdministrator) {
        return <Navigate replace to='/settings' />;
    }

    if (isUnknownAdminRoute) {
        return <Navigate replace to='/settings/admin' />;
    }

    const context = {
        api,
        apiClient,
        avatarUrl,
        email: account.profile?.email,
        isAdministrator,
        quickConnectEnabled: Boolean(quickConnect.data),
        userId,
        username
    };

    return (
        <Page
            className='mainAnimatedPage noSecondaryNavPage ptv-settings-page'
            id='ptvSettingsPage'
            isBackButtonEnabled={false}
            isMenuButtonEnabled
            shouldAutoFocus
            title='Settings'
        >
            <div data-ptv-settings-section={section}>
                <PtvSettingsLayout currentSection={section} isAdministrator={isAdministrator}>
                    {sectionContent(section, context)}
                </PtvSettingsLayout>
            </div>
        </Page>
    );
}
