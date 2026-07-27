import React, { FC, useCallback, useEffect, useState } from 'react';
import SidebarSection from './SidebarSection';
import { PTV_ASSETS, PTV_BRANDING, PTV_EVENTS, PTV_ROUTES } from '../../core/config';
import { applyPtvResponsiveImage } from '../../core/images';
import { getPtvNavigationSections } from '../../shell';

type SidebarProps = {
    isOpen: boolean;
    onClose: () => void;
};

const Sidebar: FC<SidebarProps> = ({ isOpen, onClose }) => {
    const [activeRoute, setActiveRoute] = useState(window.location.hash || PTV_ROUTES.home);
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
                    {getPtvNavigationSections().map(section => (
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
