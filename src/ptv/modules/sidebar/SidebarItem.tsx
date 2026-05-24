import React, { FC, useCallback } from 'react';
import { PtvIcon } from '../icons';
import { PTV_EVENTS, PTV_ROUTES } from '../../core/config';
import { dispatchPtvCustomEvent } from '../../core/events';
import { openRequestPortal } from '../request';
import type { PtvSidebarItem } from './sidebar.types';

type SidebarItemProps = {
    item: PtvSidebarItem;
    isActive?: boolean;
};

const SidebarItem: FC<SidebarItemProps> = ({
    item,
    isActive = false
}) => {
    const isRequestItem = item.id === 'request';

    const handleClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>): void => {
        if (!isRequestItem) return;

        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation?.();
        openRequestPortal();
        dispatchPtvCustomEvent(PTV_EVENTS.requestOpen);
    }, [isRequestItem]);

    return (
        <a
            href={isRequestItem ? PTV_ROUTES.requestSafe : item.href}
            className={`ptv-sidebar-item ${isActive ? 'ptv-sidebar-item-active' : ''}`}
            aria-label={item.label}
            data-ptv-nav-id={item.id}
            data-ptv-request-trigger={isRequestItem ? 'true' : undefined}
            target={item.isExternal ? '_blank' : undefined}
            rel={item.isExternal ? 'noopener noreferrer' : undefined}
            onClick={handleClick}
        >
            <PtvIcon
                name={item.icon}
                className={`ptv-sidebar-item-icon ${isActive ? 'ptv-icon-active' : ''}`}
            />
            <span className='ptv-sidebar-item-label'>
                {item.label}
            </span>
        </a>
    );
};

export default SidebarItem;
