import React, { FC, useCallback } from 'react';
import { PtvIcon } from '../icons';
import { PTV_ROUTES } from '../../core/config';
import { requestJellyfinLogout } from '../../services/jellyfinLogoutAction';
import {
    cancelPendingPtvRequestActivation,
    openPtvRequestPortal
} from '../request/requestLoader';
import type { PtvSidebarItem } from './sidebar.types';

type SidebarItemProps = {
    item: PtvSidebarItem;
    isActive?: boolean;
    onAction?: () => void;
};

const SidebarItem: FC<SidebarItemProps> = ({
    item,
    isActive = false,
    onAction
}) => {
    const isRequestItem = item.id === 'request';
    const isLogoutAction = item.action === 'logout';

    const handleClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>): void => {
        if (!isRequestItem) {
            cancelPendingPtvRequestActivation();
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation?.();
        void openPtvRequestPortal();
    }, [isRequestItem]);
    const handleLogout = useCallback(() => {
        cancelPendingPtvRequestActivation();
        onAction?.();
        void requestJellyfinLogout();
    }, [onAction]);
    const contents = (<>
        <PtvIcon
            name={item.icon}
            className={`ptv-sidebar-item-icon ${isActive ? 'ptv-icon-active' : ''}`}
        />
        <span className='ptv-sidebar-item-label'>
            {item.label}
        </span>
    </>);

    if (isLogoutAction) {
        return (
            <button
                type='button'
                className='ptv-sidebar-item'
                aria-label={item.label}
                data-ptv-action='logout'
                data-ptv-nav-id={item.id}
                onClick={handleLogout}
            >
                {contents}
            </button>
        );
    }

    return (
        <a
            href={isRequestItem ? PTV_ROUTES.requestSafe : item.href || PTV_ROUTES.home}
            className={`ptv-sidebar-item ${isActive ? 'ptv-sidebar-item-active' : ''}`}
            aria-label={item.label}
            data-ptv-nav-id={item.id}
            data-ptv-request-trigger={isRequestItem ? 'true' : undefined}
            target={item.isExternal ? '_blank' : undefined}
            rel={item.isExternal ? 'noopener noreferrer' : undefined}
            onClick={handleClick}
        >
            {contents}
        </a>
    );
};

export default SidebarItem;
