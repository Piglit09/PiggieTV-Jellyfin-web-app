import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
    focusPtvTvElement,
    getPtvRemoteDirection,
    isPtvRemoteBackKey,
    isPtvRemoteSelectKey
} from '../core/tvFocus';
import { PtvIcon, type PtvIconName } from '../modules/icons';
import {
    getPtvDropdownOverlayPosition,
    getPtvDropdownViewport,
    hasPtvDropdownPointerMoved
} from './primaryNavigationDropdown';

type PtvShellPrimaryDropdownLink = Readonly<{
    href: string;
    icon: PtvIconName;
    id: string;
    label: string;
}>;

export type PtvShellPrimaryDropdownProps = Readonly<{
    active?: boolean;
    icon: PtvIconName;
    id: string;
    isOpen: boolean;
    label: string;
    links: readonly PtvShellPrimaryDropdownLink[];
    onClose?: () => void;
    onLinkClick: () => void;
    onOpenFirstItem: () => void;
    onToggle: () => void;
}>;

type PtvPointerGesture = {
    moved: boolean;
    pointerId: number;
    startX: number;
    startY: number;
};

export default function PtvShellPrimaryDropdown({
    active,
    icon,
    id,
    isOpen,
    label,
    links,
    onClose,
    onLinkClick,
    onOpenFirstItem,
    onToggle
}: PtvShellPrimaryDropdownProps) {
    const panelId = `ptv-shell-${id}-menu`;
    const triggerId = `ptv-shell-${id}-trigger`;
    const panelRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const gestureRef = useRef<PtvPointerGesture | null>(null);
    const positionFrameRef = useRef<number | null>(null);
    const suppressNextPointerClickRef = useRef(false);
    const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
    const requestClose = useCallback(() => {
        if (onClose) onClose();
        else onToggle();
    }, [onClose, onToggle]);
    const focusMenuItem = useCallback((position: 'first' | 'last' = 'first') => {
        window.requestAnimationFrame(() => {
            const items = panelRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]');
            const target = position === 'last' ? items?.[items.length - 1] : items?.[0];

            if (target) focusPtvTvElement(target, 'primary-dropdown-open');
        });
    }, []);
    const schedulePanelPosition = useCallback(() => {
        if (positionFrameRef.current !== null) return;

        positionFrameRef.current = window.requestAnimationFrame(() => {
            positionFrameRef.current = null;
            const triggerRect = triggerRef.current?.getBoundingClientRect();

            if (!triggerRect) return;

            const measuredPanelHeight = panelRef.current?.getBoundingClientRect().height || ((links.length * 48) + 24);
            const position = getPtvDropdownOverlayPosition(
                triggerRect,
                getPtvDropdownViewport(),
                measuredPanelHeight
            );
            const nextStyle = {
                '--ptv-shell-dropdown-left': `${position.left}px`,
                '--ptv-shell-dropdown-max-height': `${position.maxHeight}px`,
                '--ptv-shell-dropdown-min-width': `${position.minWidth}px`,
                '--ptv-shell-dropdown-top': `${position.top}px`,
                '--ptv-shell-dropdown-width': `${position.width}px`
            } as React.CSSProperties;

            setPanelStyle(nextStyle);
        });
    }, [links.length]);
    const handleTriggerKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.defaultPrevented) return;

        if (isPtvRemoteSelectKey(event)) {
            event.preventDefault();
            event.stopPropagation();
            schedulePanelPosition();

            if (isOpen) {
                requestClose();
            } else {
                onOpenFirstItem();
                focusMenuItem();
            }
            return;
        }

        const direction = getPtvRemoteDirection(event);
        if (direction !== 'down' && direction !== 'up') return;

        event.preventDefault();
        event.stopPropagation();
        schedulePanelPosition();
        onOpenFirstItem();
        focusMenuItem(direction === 'up' ? 'last' : 'first');
    }, [focusMenuItem, isOpen, onOpenFirstItem, requestClose, schedulePanelPosition]);
    const handleTriggerClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        if (suppressNextPointerClickRef.current && event.detail > 0) {
            suppressNextPointerClickRef.current = false;
            event.preventDefault();
            return;
        }

        suppressNextPointerClickRef.current = false;
        schedulePanelPosition();
        onToggle();
    }, [onToggle, schedulePanelPosition]);
    const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;

        suppressNextPointerClickRef.current = false;
        gestureRef.current = {
            moved: false,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY
        };
    }, []);
    const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        const gesture = gestureRef.current;

        if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return;
        gesture.moved = hasPtvDropdownPointerMoved(
            gesture.startX,
            gesture.startY,
            event.clientX,
            event.clientY
        );
    }, []);
    const handlePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        const gesture = gestureRef.current;

        if (!gesture || gesture.pointerId !== event.pointerId) return;
        suppressNextPointerClickRef.current = gesture.moved;
        gestureRef.current = null;
    }, []);
    const handlePointerCancel = useCallback(() => {
        suppressNextPointerClickRef.current = true;
        gestureRef.current = null;
    }, []);
    const handlePanelKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented) return;

        if (isPtvRemoteBackKey(event)) {
            event.preventDefault();
            event.stopPropagation();
            requestClose();
            window.requestAnimationFrame(() => {
                if (triggerRef.current) focusPtvTvElement(triggerRef.current, 'primary-dropdown-back');
            });
            return;
        }

        if (isPtvRemoteSelectKey(event)) {
            const activeItem = document.activeElement instanceof HTMLAnchorElement
                && panelRef.current?.contains(document.activeElement) ?
                document.activeElement :
                null;

            if (!activeItem) return;

            event.preventDefault();
            event.stopPropagation();
            activeItem.click();
            return;
        }

        const direction = getPtvRemoteDirection(event);
        if (direction !== 'down' && direction !== 'up') return;

        const items = Array.from(panelRef.current?.querySelectorAll<HTMLAnchorElement>('a') || []);
        if (!items.length) return;

        event.preventDefault();
        event.stopPropagation();
        const currentIndex = Math.max(0, items.findIndex(item => item === document.activeElement));
        const offset = direction === 'down' ? 1 : -1;
        const nextIndex = (currentIndex + offset + items.length) % items.length;

        const target = items[nextIndex];

        if (target) focusPtvTvElement(target, `primary-dropdown-${direction}`);
    }, [requestClose]);

    useEffect(() => {
        if (!isOpen) return undefined;

        schedulePanelPosition();
        if (document.activeElement === triggerRef.current) {
            window.requestAnimationFrame(() => {
                const target = panelRef.current?.querySelector<HTMLAnchorElement>('[role="menuitem"]');

                if (target) focusPtvTvElement(target, 'primary-dropdown-first-item');
            });
        }
        const visualViewport = window.visualViewport;
        const navScroller = triggerRef.current?.closest('.ptv-shell-nav-primary');

        window.addEventListener('resize', schedulePanelPosition);
        window.addEventListener('orientationchange', schedulePanelPosition);
        window.addEventListener('scroll', schedulePanelPosition, true);
        visualViewport?.addEventListener('resize', schedulePanelPosition);
        visualViewport?.addEventListener('scroll', schedulePanelPosition);
        navScroller?.addEventListener('scroll', schedulePanelPosition, { passive: true });

        return () => {
            window.removeEventListener('resize', schedulePanelPosition);
            window.removeEventListener('orientationchange', schedulePanelPosition);
            window.removeEventListener('scroll', schedulePanelPosition, true);
            visualViewport?.removeEventListener('resize', schedulePanelPosition);
            visualViewport?.removeEventListener('scroll', schedulePanelPosition);
            navScroller?.removeEventListener('scroll', schedulePanelPosition);
            if (positionFrameRef.current !== null) {
                window.cancelAnimationFrame(positionFrameRef.current);
                positionFrameRef.current = null;
            }
        };
    }, [isOpen, schedulePanelPosition]);

    useEffect(() => {
        if (!isOpen) return undefined;

        const handleOutsidePointer = (event: PointerEvent) => {
            const target = event.target as Node | null;

            if (!target || triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            requestClose();
        };
        document.addEventListener('pointerdown', handleOutsidePointer, true);

        return () => {
            document.removeEventListener('pointerdown', handleOutsidePointer, true);
        };
    }, [isOpen, requestClose]);

    const panel = isOpen ? (
        <div
            ref={panelRef}
            aria-labelledby={triggerId}
            className='ptv-shell-dropdown-panel ptv-shell-dropdown-overlay'
            data-ptv-shell-primary-menu={id}
            id={panelId}
            onKeyDown={handlePanelKeyDown}
            role='menu'
            style={panelStyle}
            tabIndex={-1}
        >
            {links.map(link => (
                <a
                    key={link.id}
                    className='ptv-shell-dropdown-link'
                    href={link.href}
                    onClick={onLinkClick}
                    role='menuitem'
                >
                    <PtvIcon name={link.icon} />
                    <span>{link.label}</span>
                </a>
            ))}
        </div>
    ) : null;

    return (
        <div className={`ptv-shell-nav-dropdown${active ? ' is-active' : ''}${isOpen ? ' is-open' : ''}`}>
            <button
                ref={triggerRef}
                aria-controls={panelId}
                aria-expanded={isOpen}
                aria-haspopup='menu'
                className='ptv-shell-nav-button'
                data-ptv-directional-menu-open='true'
                id={triggerId}
                onClick={handleTriggerClick}
                onKeyDown={handleTriggerKeyDown}
                onPointerCancel={handlePointerCancel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                type='button'
            >
                <PtvIcon name={icon} />
                <span className='ptv-shell-nav-label'>{label}</span>
                <span className='ptv-shell-nav-caret' aria-hidden='true' />
            </button>
            {panel && typeof document !== 'undefined' ? createPortal(panel, document.body) : null}
        </div>
    );
}
