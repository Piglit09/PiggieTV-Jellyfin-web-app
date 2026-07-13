import React, { FC, useCallback, useEffect, useState } from 'react';
import Sidebar from '../sidebar/Sidebar';
import { PtvIcon } from '../icons';
import { PTV_ASSETS, PTV_BRANDING, PTV_EVENTS, PTV_ROUTES } from '../../core/config';
import { dispatchPtvCustomEvent } from '../../core/events';
import { applyPtvResponsiveImage } from '../../core/images';
import { getCurrentPtvPluginApiClient } from '../../core/pluginApi';
import { openRequestPortal } from '../request';
import { playPtvItem } from '../../api';

interface AppHeaderParams {
    isHidden?: boolean;
}

function navigateToSearch(): void {
    window.location.hash = PTV_ROUTES.search;
}

function navigateBack(): void {
    window.history.back();
}

function refreshPage(): void {
    window.location.reload();
}

type PtvRandomItemResponse = {
    behavior?: string;
    item?: {
        Id?: string;
        id?: string;
    };
    ok?: boolean;
};

function navigateToRandom(event: React.MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    const fallback = () => {
        window.location.hash = PTV_ROUTES.randomItem;
    };
    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi?.getRandomMovie) {
        fallback();
        return;
    }

    pluginApi.getRandomMovie<PtvRandomItemResponse>()
        .then(response => {
            const itemId = response.item?.id || response.item?.Id;

            if (!response.ok || !itemId) {
                fallback();
                return;
            }

            if (response.behavior === 'play') {
                playPtvItem(itemId).catch(fallback);
                return;
            }

            window.location.hash = `#/details?id=${encodeURIComponent(itemId)}`;
        })
        .catch(fallback);
}

function navigateToRequest(event: React.MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
    openRequestPortal();
    dispatchPtvCustomEvent(PTV_EVENTS.requestOpen);
}

function isActiveRoute(route: string): boolean {
    return window.location.hash.startsWith(route);
}

function isFavoritesRoute(): boolean {
    const hash = window.location.hash || '';

    return hash.startsWith(PTV_ROUTES.favoritesLegacy) || hash.includes('tab=1');
}

function isReadingRoute(): boolean {
    return /^#\/(?:reading|books|comics|manga|maga)(?:[/?]|$)/i.test(window.location.hash || '');
}

const AppHeader: FC<AppHeaderParams> = ({
    isHidden = false
}) => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isRequestActive, setIsRequestActive] = useState(
        document.documentElement.classList.contains('ptv-request-active')
    );

    const openSidebar = useCallback(() => {
        setIsSidebarOpen(true);
    }, []);

    const closeSidebar = useCallback(() => {
        setIsSidebarOpen(false);
    }, []);
    const mountHeaderLogo = useCallback((image: HTMLImageElement | null) => {
        if (image) {
            image.dataset.ptvLogo = 'header';
            image.dataset.ptvImageComponent = 'header-logo';
            applyPtvResponsiveImage(image, PTV_ASSETS.responsive.logos.bannerLight);
        }
    }, []);

    useEffect(() => {
        void import('scripts/libraryMenu');
    }, []);

    useEffect(() => {
        const syncRequestActive = () => {
            setIsRequestActive(document.documentElement.classList.contains('ptv-request-active'));
        };

        window.addEventListener(PTV_EVENTS.requestStateChange, syncRequestActive);
        window.addEventListener('hashchange', syncRequestActive);
        window.addEventListener('popstate', syncRequestActive);

        return () => {
            window.removeEventListener(PTV_EVENTS.requestStateChange, syncRequestActive);
            window.removeEventListener('hashchange', syncRequestActive);
            window.removeEventListener('popstate', syncRequestActive);
        };
    }, []);

    return (
        <div
            className='ptv-app-header-root'
            style={isHidden ? { display: 'none' } : undefined}
        >
            <div className='mainDrawer hide ptv-mainDrawer'>
                <div className='mainDrawer-scrollContainer scrollContainer focuscontainer-y ptv-mainDrawer-scrollContainer' />
            </div>

            <div className='skinHeader focuscontainer-x ptv-legacy-skinHeader' />

            <header className='ptv-skinHeader'>
                <div className='ptv-header-left'>
                    <button
                        type='button'
                        className='ptv-header-icon-btn ptv-back-btn'
                        aria-label='Go back'
                        onClick={navigateBack}
                    >
                        <PtvIcon name='back' />
                    </button>

                    <a
                        href={PTV_ROUTES.home}
                        className='ptv-header-icon-btn ptv-home-btn itemAction'
                        data-action='link'
                        aria-label='Home'
                    >
                        <PtvIcon name='home' />
                    </a>

                    <button
                        type='button'
                        className='ptv-header-icon-btn ptv-main-menu-btn'
                        aria-label='Open navigation menu'
                        onClick={openSidebar}
                    >
                        <PtvIcon name='menu' />
                    </button>

                    <a
                        href={PTV_ROUTES.home}
                        className='ptv-brand itemAction'
                        data-action='link'
                        aria-label='Go to home'
                    >
                        <img
                            ref={mountHeaderLogo}
                            alt={PTV_BRANDING.appName}
                            className='ptv-brand-logo'
                            data-ptv-logo='header'
                            data-ptv-image-component='header-logo'
                            loading='eager'
                            decoding='async'
                        />
                    </a>
                </div>

                <nav className='ptv-header-nav' aria-label='Primary navigation'>
                    <a
                        href={PTV_ROUTES.home}
                        className={`ptv-nav-link ${
                            !isRequestActive && isActiveRoute(PTV_ROUTES.home) ? 'ptv-nav-link-active' : ''
                        }`}
                    >
                        Home
                    </a>

                    <a
                        href={PTV_ROUTES.music}
                        className={`ptv-nav-link ${
                            !isRequestActive && isActiveRoute(PTV_ROUTES.music) ? 'ptv-nav-link-active' : ''
                        }`}
                    >
                        Music
                    </a>

                    <a
                        href={PTV_ROUTES.reading}
                        className={`ptv-nav-link ${
                            !isRequestActive && isReadingRoute() ? 'ptv-nav-link-active' : ''
                        }`}
                    >
                        PTV Reading
                    </a>

                    <a
                        href={PTV_ROUTES.favorites}
                        className={`ptv-nav-link ${
                            !isRequestActive && isFavoritesRoute() ? 'ptv-nav-link-active' : ''
                        }`}
                    >
                        Favorites
                    </a>

                    <a
                        href={PTV_ROUTES.requestSafe}
                        className={`ptv-nav-link ptv-top-tab ptv-top-tab-request ${
                            isRequestActive ? 'ptv-nav-link-active' : ''
                        }`}
                        data-ptv-request-trigger='true'
                        onClick={navigateToRequest}
                    >
                        Request
                    </a>
                </nav>

                <div className='ptv-header-actions'>
                    <a
                        href={PTV_ROUTES.randomItem}
                        className='ptv-header-icon-btn ptv-random-btn itemAction'
                        data-action='link'
                        aria-label='Random'
                        onClick={navigateToRandom}
                    >
                        <PtvIcon name='shuffle' />
                    </a>

                    <button
                        type='button'
                        className='ptv-header-icon-btn ptv-refresh-btn'
                        aria-label='Refresh'
                        onClick={refreshPage}
                    >
                        <PtvIcon name='refresh' />
                    </button>

                    <a
                        href={PTV_ROUTES.displayPreferences}
                        className='ptv-header-icon-btn ptv-display-btn itemAction'
                        data-action='link'
                        aria-label='Display settings'
                    >
                        <PtvIcon name='display' />
                    </a>

                    <button
                        type='button'
                        className='ptv-header-icon-btn ptv-search-btn'
                        aria-label='Search'
                        onClick={navigateToSearch}
                    >
                        <PtvIcon name='search' />
                    </button>

                    <a
                        href={PTV_ROUTES.profilePreferences}
                        className='ptv-header-icon-btn ptv-profile-btn itemAction'
                        data-action='link'
                        aria-label='Profile'
                    >
                        <PtvIcon name='profile' />
                    </a>
                </div>
            </header>

            <Sidebar
                isOpen={isSidebarOpen}
                onClose={closeSidebar}
            />

            <div className='mainDrawerHandle ptv-mainDrawerHandle' />
        </div>
    );
};

export default AppHeader;
