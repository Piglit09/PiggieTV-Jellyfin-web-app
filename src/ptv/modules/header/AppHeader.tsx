import React, { type FC, useEffect } from 'react';

import PTVShell, { type PtvShellSection } from '../../shell/PTVShell';

interface AppHeaderParams {
    isHidden?: boolean;
    menuButtonLabel?: string;
    onMenuButtonClick?: () => void;
}

function getAuthenticatedHeaderSection(): PtvShellSection {
    const route = `${window.location.pathname || ''}${window.location.hash || ''}`.toLowerCase();

    if (
        route.includes('/dashboard')
        || route.includes('/metadata')
        || route.includes('/configurationpage')
    ) return 'dashboard';

    if (
        route.includes('/profile')
        || route.includes('/settings')
        || route.includes('/mypreferences')
        || route.includes('/quickconnect')
        || route.includes('/userprofile')
        || route.includes('/tv-navigation-debug')
    ) return 'settings';

    return 'home';
}

function getAuthenticatedHeaderTitle(section: PtvShellSection) {
    if (section === 'dashboard') return 'Dashboard';
    if (section === 'settings') return 'Settings';
    return 'PiggieTV';
}

function LegacyHeaderAnchors() {
    return (
        <>
            <div aria-hidden='true' className='mainDrawer hide ptv-mainDrawer'>
                <div className='mainDrawer-scrollContainer scrollContainer focuscontainer-y ptv-mainDrawer-scrollContainer' />
            </div>
            <div aria-hidden='true' className='skinHeader focuscontainer-x ptv-legacy-skinHeader' />
        </>
    );
}

const AppHeader: FC<AppHeaderParams> = ({
    isHidden = false,
    menuButtonLabel,
    onMenuButtonClick
}) => {
    useEffect(() => {
        void import('../../../scripts/libraryMenu');
    }, []);

    if (isHidden) {
        return (
            <div
                aria-hidden='true'
                className='ptv-auth-header-compatibility'
                data-ptv-auth-compatibility='true'
                style={{ display: 'none' }}
            >
                <LegacyHeaderAnchors />
            </div>
        );
    }

    const section = getAuthenticatedHeaderSection();

    return (
        <div className='ptv-app-header-root' data-ptv-authenticated-navigation='true'>
            <LegacyHeaderAnchors />
            <PTVShell
                headerOnly
                menuLabel={menuButtonLabel}
                onMenuClick={onMenuButtonClick}
                registerRuntimeShell={false}
                section={section}
                title={getAuthenticatedHeaderTitle(section)}
            >
                {null}
            </PTVShell>
        </div>
    );
};

export default AppHeader;
