import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import React, { useEffect, useMemo, useState, type FC } from 'react';
import { useSearchParams } from 'react-router-dom';

import { appHost } from 'components/apphost';
import layoutManager from 'components/layoutManager';
import Loading from 'components/loading/LoadingComponent';
import Page from 'components/Page';
import { AppFeature } from 'constants/appFeature';
import LinkButton from 'elements/emby-button/LinkButton';
import { useApi } from 'hooks/useApi';
import { useQuickConnectEnabled } from 'hooks/useQuickConnect';
import { useUsers } from 'hooks/useUsers';
import globalize from 'lib/globalize';
import browser from 'scripts/browser';
import Dashboard from 'utils/dashboard';
import shell from 'scripts/shell';
import keyboardNavigation from 'scripts/keyboardNavigation';

const LegacyMaterialIcon = ({
    icon,
    ptvIcon,
    className = ''
}: {
    icon: string;
    ptvIcon: string;
    className?: string;
}) => (
    <span
        className={`material-icons listItemIcon listItemIcon-transparent ${icon} ptv-icon-legacy ptv-icon-hydrated ptv-icon-${ptvIcon} ${className}`.trim()}
        data-icon={ptvIcon}
        data-ptv-icon={ptvIcon}
        aria-hidden='true'
    >
        {icon}
    </span>
);

const UserSettingsPage: FC = () => {
    const { user: currentUser } = useApi();
    const [ searchParams ] = useSearchParams();
    const {
        data: isQuickConnectEnabled,
        isPending: isQuickConnectEnabledPending
    } = useQuickConnectEnabled();
    const { data: users } = useUsers();
    const [ user, setUser ] = useState<UserDto>();

    const userId = useMemo(() => (
        searchParams.get('userId') || currentUser?.Id
    ), [ currentUser, searchParams ]);
    const isLoggedInUser = useMemo(() => (
        userId && userId === currentUser?.Id
    ), [ currentUser, userId ]);

    useEffect(() => {
        if (userId) {
            if (userId === currentUser?.Id) setUser(currentUser);
            else setUser(users?.find(({ Id }) => userId === Id));
        }
    }, [ currentUser, userId, users ]);

    if (!userId || !user || isQuickConnectEnabledPending) {
        return (
            <Loading />
        );
    }

    // gamepad toggle unavailable on EdgeUWP, and smoothscroll unavailable on non-TV layout
    const isControlsPageEmpty = !keyboardNavigation.canEnableGamepad() && !layoutManager.tv;

    return (
        <Page
            id='myPreferencesMenuPage'
            className='libraryPage userPreferencesPage noSecondaryNavPage mainAnimatedPage'
            title={globalize.translate('Settings')}
            shouldAutoFocus
        >
            <div className='padded-left padded-right padded-bottom-page padded-top'>
                <div
                    className='readOnlyContent'
                    style={{
                        margin: '0 auto'
                    }}
                >
                    <div className='verticalSection verticalSection-extrabottompadding'>
                        <h2
                            className='sectionTitle headerUsername'
                            style={{
                                paddingLeft: '0.25em'
                            }}
                        >
                            {user.Name}
                        </h2>

                        <LinkButton
                            href={`#/userprofile?userId=${userId}`}
                            className='lnkUserProfile listItem-border'
                            style={{
                                display: 'block',
                                margin: 0,
                                padding: 0
                            }}
                        >
                            <div className='listItem'>
                                <LegacyMaterialIcon icon='person' ptvIcon='user' />
                                <div className='listItemBody'>
                                    <div className='listItemBodyText'>
                                        {globalize.translate('Profile')}
                                    </div>
                                </div>
                            </div>
                        </LinkButton>

                        {isQuickConnectEnabled && (
                            <LinkButton
                                href={`#/quickconnect?userId=${userId}`}
                                className='lnkQuickConnectPreferences listItem-border'
                                style={{
                                    display: 'block',
                                    margin: 0,
                                    padding: 0
                                }}
                            >
                                <div className='listItem'>
                                    <LegacyMaterialIcon icon='phonelink_lock' ptvIcon='display' />
                                    <div className='listItemBody'>
                                        <div className='listItemBodyText'>
                                            {globalize.translate('QuickConnect')}
                                        </div>
                                    </div>
                                </div>
                            </LinkButton>
                        )}

                        <LinkButton
                            href={`#/mypreferencesdisplay?userId=${userId}`}
                            className='lnkDisplayPreferences listItem-border'
                            style={{
                                display: 'block',
                                margin: 0,
                                padding: 0
                            }}
                        >
                            <div className='listItem'>
                                <LegacyMaterialIcon icon='tv' ptvIcon='display' />
                                <div className='listItemBody'>
                                    <div className='listItemBodyText'>
                                        {globalize.translate('Display')}
                                    </div>
                                </div>
                            </div>
                        </LinkButton>

                        <LinkButton
                            href={`#/mypreferenceshome?userId=${userId}`}
                            className='lnkHomePreferences listItem-border'
                            style={{
                                display: 'block',
                                margin: 0,
                                padding: 0
                            }}
                        >
                            <div className='listItem'>
                                <LegacyMaterialIcon icon='home' ptvIcon='home' />
                                <div className='listItemBody'>
                                    <div className='listItemBodyText'>
                                        {globalize.translate('Home')}
                                    </div>
                                </div>
                            </div>
                        </LinkButton>

                        <LinkButton
                            href={`#/mypreferencesplayback?userId=${userId}`}
                            className='lnkPlaybackPreferences listItem-border'
                            style={{
                                display: 'block',
                                margin: 0,
                                padding: 0
                            }}
                        >
                            <div className='listItem'>
                                <LegacyMaterialIcon icon='play_circle_filled' ptvIcon='play' />
                                <div className='listItemBody'>
                                    <div className='listItemBodyText'>
                                        {globalize.translate('TitlePlayback')}
                                    </div>
                                </div>
                            </div>
                        </LinkButton>

                        <LinkButton
                            href={`#/mypreferencessubtitles?userId=${userId}`}
                            className='lnkSubtitlePreferences listItem-border'
                            style={{
                                display: 'block',
                                margin: 0,
                                padding: 0
                            }}
                        >
                            <div className='listItem'>
                                <LegacyMaterialIcon icon='closed_caption' ptvIcon='subtitles' />
                                <div className='listItemBody'>
                                    <div className='listItemBodyText'>
                                        {globalize.translate('Subtitles')}
                                    </div>
                                </div>
                            </div>
                        </LinkButton>

                        {appHost.supports(AppFeature.DownloadManagement) && (
                            <LinkButton
                                onClick={shell.openDownloadManager}
                                className='downloadManager listItem-border'
                                style={{
                                    display: 'block',
                                    margin: 0,
                                    padding: 0
                                }}
                            >
                                <div className='listItem'>
                                    <LegacyMaterialIcon icon='download' ptvIcon='download' />
                                    <div className='listItemBody'>
                                        <div className='listItemBodyText'>
                                            {globalize.translate('DownloadManager')}
                                        </div>
                                    </div>
                                </div>
                            </LinkButton>
                        )}

                        {appHost.supports(AppFeature.ClientSettings) && (
                            <LinkButton
                                onClick={shell.openClientSettings}
                                className='clientSettings listItem-border'
                                style={{
                                    display: 'block',
                                    margin: 0,
                                    padding: 0
                                }}
                            >
                                <div className='listItem'>
                                    <LegacyMaterialIcon icon='devices_other' ptvIcon='devices' />
                                    <div className='listItemBody'>
                                        <div className='listItemBodyText'>
                                            {globalize.translate('ClientSettings')}
                                        </div>
                                    </div>
                                </div>
                            </LinkButton>
                        )}

                        {isLoggedInUser && !browser.mobile && !isControlsPageEmpty && (
                            <LinkButton
                                href={`#/mypreferencescontrols?userId=${userId}`}
                                className='lnkControlsPreferences listItem-border'
                                style={{
                                    display: 'block',
                                    margin: 0,
                                    padding: 0
                                }}
                            >
                                <div className='listItem'>
                                    <LegacyMaterialIcon icon='keyboard' ptvIcon='controls' />
                                    <div className='listItemBody'>
                                        <div className='listItemBodyText'>
                                            {globalize.translate('Controls')}
                                        </div>
                                    </div>
                                </div>
                            </LinkButton>
                        )}

                        {isLoggedInUser && (
                            <LinkButton
                                href='#/tv-navigation-debug'
                                className='listItem-border ptv-tv-navigation-debug-link'
                                style={{
                                    display: 'block',
                                    margin: 0,
                                    padding: 0
                                }}
                            >
                                <div className='listItem'>
                                    <LegacyMaterialIcon icon='keyboard' ptvIcon='controls' />
                                    <div className='listItemBody'>
                                        <div className='listItemBodyText'>TV Navigation Debug</div>
                                    </div>
                                </div>
                            </LinkButton>
                        )}
                    </div>

                    {isLoggedInUser && user.Policy?.IsAdministrator && !layoutManager.tv && (
                        <div className='adminSection verticalSection verticalSection-extrabottompadding'>
                            <h2
                                className='sectionTitle headerUsername'
                                style={{
                                    paddingLeft: '0.25em'
                                }}
                            >
                                {globalize.translate('HeaderAdmin')}
                            </h2>

                            <LinkButton
                                href='#/dashboard'
                                className='listItem-border'
                                style={{
                                    display: 'block',
                                    margin: 0,
                                    padding: 0
                                }}
                            >
                                <div className='listItem'>
                                    <LegacyMaterialIcon icon='dashboard' ptvIcon='dashboard' />
                                    <div className='listItemBody'>
                                        <div className='listItemBodyText'>
                                            {globalize.translate('TabDashboard')}
                                        </div>
                                    </div>
                                </div>
                            </LinkButton>

                            <LinkButton
                                href='#/metadata'
                                className='listItem-border'
                                style={{
                                    display: 'block',
                                    margin: 0,
                                    padding: 0
                                }}
                            >
                                <div className='listItem'>
                                    <LegacyMaterialIcon icon='mode_edit' ptvIcon='metadata' />
                                    <div className='listItemBody'>
                                        <div className='listItemBodyText'>
                                            {globalize.translate('MetadataManager')}
                                        </div>
                                    </div>
                                </div>
                            </LinkButton>
                        </div>
                    )}

                    {isLoggedInUser && (
                        <div className='userSection verticalSection verticalSection-extrabottompadding'>
                            <h2
                                className='sectionTitle headerUsername'
                                style={{
                                    paddingLeft: '0.25em'
                                }}
                            >
                                {globalize.translate('HeaderUser')}
                            </h2>

                            {appHost.supports(AppFeature.MultiServer) && (
                                <LinkButton
                                    onClick={Dashboard.selectServer}
                                    className='selectServer listItem-border'
                                    style={{
                                        display: 'block',
                                        margin: 0,
                                        padding: 0
                                    }}
                                >
                                    <div className='listItem'>
                                        <LegacyMaterialIcon icon='storage' ptvIcon='server' />
                                        <div className='listItemBody'>
                                            <div className='listItemBodyText'>
                                                {globalize.translate('SelectServer')}
                                            </div>
                                        </div>
                                    </div>
                                </LinkButton>
                            )}

                            <LinkButton
                                onClick={Dashboard.logout}
                                className='btnLogout listItem-border'
                                style={{
                                    display: 'block',
                                    margin: 0,
                                    padding: 0
                                }}
                            >
                                <div className='listItem'>
                                    <LegacyMaterialIcon icon='exit_to_app' ptvIcon='signout' />
                                    <div className='listItemBody'>
                                        <div className='listItemBodyText'>
                                            {globalize.translate('ButtonSignOut')}
                                        </div>
                                    </div>
                                </div>
                            </LinkButton>

                            {appHost.supports(AppFeature.ExitMenu) && (
                                <LinkButton
                                    onClick={appHost.exit}
                                    className='exitApp listItem-border'
                                    style={{
                                        display: 'block',
                                        margin: 0,
                                        padding: 0
                                    }}
                                >
                                    <div className='listItem'>
                                        <LegacyMaterialIcon icon='close' ptvIcon='signout' />
                                        <div className='listItemBody'>
                                            <div className='listItemBodyText'>
                                                {globalize.translate('ButtonExitApp')}
                                            </div>
                                        </div>
                                    </div>
                                </LinkButton>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </Page>
    );
};

export default UserSettingsPage;
