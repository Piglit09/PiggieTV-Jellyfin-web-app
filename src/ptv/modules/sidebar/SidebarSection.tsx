import React, { FC } from 'react';
import SidebarItem from './SidebarItem';
import type { PtvSidebarSection } from './sidebar.types';

type SidebarSectionProps = {
    section: PtvSidebarSection;
    activeRoute: string;
    onAction?: () => void;
};

const SidebarSection: FC<SidebarSectionProps> = ({
    section,
    activeRoute,
    onAction
}) => {
    return (
        <section className='ptv-sidebar-section'>
            {section.title ? (
                <div className='ptv-sidebar-section-title'>
                    {section.title}
                </div>
            ) : null}

            <div className='ptv-sidebar-section-items'>
                {section.items.map(item => {
                    const isRequestItem = item.id === 'request';
                    const isActive = isRequestItem ?
                        document.documentElement.classList.contains('ptv-request-active') :
                        Boolean(item.href && activeRoute.startsWith(item.href));

                    return (
                        <SidebarItem
                            key={item.id}
                            item={item}
                            isActive={isActive}
                            onAction={onAction}
                        />
                    );
                })}
            </div>
        </section>
    );
};

export default SidebarSection;
