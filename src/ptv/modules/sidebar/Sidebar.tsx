import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import SidebarSection from './SidebarSection';
import { PTV_ASSETS, PTV_BRANDING, PTV_EVENTS, PTV_ROUTES } from '../../core/config';
import { applyPtvResponsiveImage } from '../../core/images';
import { getPtvNavigationSections } from '../../shell';
import { usePtvNavigationAccess } from '../../shell/usePtvNavigationAccess';
import { usePtvArrCalendarAvailability } from '../calendar/arrCalendarAvailability';
import { cancelPendingPtvRequestActivation } from '../request/requestLoader';

type SidebarProps = {
    isOpen: boolean;
    onClose: () => void;
};

const Sidebar: FC<SidebarProps> = ({ isOpen, onClose }) => {
    const [activeRoute, setActiveRoute] = useState(window.location.hash || PTV_ROUTES.home);
    const navigationAccess = usePtvNavigationAccess();
    const calendarAvailability = usePtvArrCalendarAvailability();
    const sections = getPtvNavigationSections(
        navigationAccess.status === 'ready' ? navigationAccess.access : null,
        { calendarAvailable: navigationAccess.status === 'ready' && calendarAvailability.showEntry }
    );
    const navigationKey = JSON.stringify(sections.map(section => section.items.map(item => [item.id, item.href, item.label])));
    const previousAccessRef = useRef({
        identityKey: navigationAccess.identityKey,
        navigationKey,
        status: navigationAccess.status
    });
    const mountSidebarLogo = useCallback((image: HTMLImageElement | null) => {
        if (image) {
            image.dataset.ptvLogo = 'sidebar';
            image.dataset.ptvImageComponent = 'sidebar-logo';
            applyPtvResponsiveImage(image, PTV_ASSETS.responsive.logos.sidebar);
        }
    }, []);

    useEffect(() => {
        document.body.classList.toggle('ptv-sidebar-is-open', isOpen);

        return () => {
            document.body.classList.remove('ptv-sidebar-is-open');
        };
    }, [isOpen]);

    useEffect(() => {
        const previous = previousAccessRef.current;
        if (isOpen && (
            Boolean(previous.identityKey && previous.identityKey !== navigationAccess.identityKey)
            || previous.status === 'ready' && navigationAccess.status !== 'ready'
            || previous.navigationKey !== navigationKey
        )) onClose();
        previousAccessRef.current = {
            identityKey: navigationAccess.identityKey,
            navigationKey,
            status: navigationAccess.status
        };
    }, [isOpen, navigationAccess.identityKey, navigationAccess.status, navigationKey, onClose]);

    useEffect(() => {
        const onHashChange = () => {
            setActiveRoute(window.location.hash || PTV_ROUTES.home);
            onClose();
        };

        const onRequestOpen = () => {
            onClose();
        };

        window.addEventListener('hashchange', onHashChange);
        window.addEventListener(PTV_EVENTS.requestOpen, onRequestOpen);

        return () => {
            window.removeEventListener('hashchange', onHashChange);
            window.removeEventListener(PTV_EVENTS.requestOpen, onRequestOpen);
        };
    }, [onClose]);

    return (
        <>
            <aside
                className={`ptv-sidebar ${isOpen ? 'ptv-sidebar-open' : ''}`}
                aria-hidden={!isOpen}
            >
                <a
                    href={PTV_ROUTES.home}
                    className='ptv-sidebar-brand'
                    data-ptv-brand='sidebar'
                    aria-label={`Go to ${PTV_BRANDING.appName} home`}
                    onClick={cancelPendingPtvRequestActivation}
                >
                    <img
                        ref={mountSidebarLogo}
                        alt={PTV_BRANDING.appName}
                        className='ptv-sidebar-logo ptv-sidebar-logo-image'
                        data-ptv-logo='sidebar'
                        data-ptv-image-component='sidebar-logo'
                        width='226'
                        height='58'
                        loading='eager'
                        decoding='async'
                        draggable={false}
                    />
                </a>

                <nav className='ptv-sidebar-nav' aria-label='PiggieTV navigation'>
                    {sections.map(section => (
                        <SidebarSection
                            key={section.id}
                            section={section}
                            activeRoute={activeRoute}
                            onAction={onClose}
                        />
                    ))}
                </nav>
            </aside>

            <button
                type='button'
                className={`ptv-sidebar-backdrop ${isOpen ? 'ptv-sidebar-backdrop-open' : ''}`}
                aria-label='Close menu'
                onClick={onClose}
            />
        </>
    );
};

export default Sidebar;
