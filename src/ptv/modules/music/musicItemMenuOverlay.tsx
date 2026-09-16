import React, {
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
    type RefObject,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState
} from 'react';
import { createPortal } from 'react-dom';

export type PtvMusicItemMenuRect = Readonly<{
    bottom: number;
    height: number;
    left: number;
    right: number;
    top: number;
    width: number;
}>;

export type PtvMusicItemMenuViewport = Readonly<{
    height: number;
    left: number;
    top: number;
    width: number;
}>;

export type PtvMusicItemMenuPosition = Readonly<{
    left: number;
    maxHeight: number;
    top: number;
    width: number;
}>;

type PtvMusicItemMenuOverlayProps = Readonly<{
    children: ReactNode;
    id: string;
    labelledBy: string;
    onClose: () => void;
    triggerRef: RefObject<HTMLButtonElement>;
}>;

const MENU_GAP = 8;
const MENU_MARGIN = 14;
const MENU_MAX_WIDTH = 260;
const MENU_MIN_HEIGHT = 38;
const MENU_MIN_WIDTH = 188;
const HIDDEN_MENU_STYLE: CSSProperties = {
    left: '-10000px',
    top: '-10000px',
    visibility: 'hidden'
};
const ENABLED_MENU_ITEM_SELECTOR = '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])';

function clamp(value: number, minimum: number, maximum: number) {
    if (maximum <= minimum) return minimum;
    return Math.min(Math.max(value, minimum), maximum);
}

function getEnabledMenuItems(panel: HTMLElement | null) {
    return panel ?
        Array.from(panel.querySelectorAll<HTMLElement>(ENABLED_MENU_ITEM_SELECTOR)) :
        [];
}

function focusMenuItem(items: HTMLElement[], index: number) {
    const menu = items[index]?.closest<HTMLElement>('[role="menu"]');

    menu?.querySelectorAll<HTMLElement>('[role="menuitem"]').forEach(item => {
        item.tabIndex = -1;
    });
    const nextItem = items[index];

    if (nextItem) {
        nextItem.tabIndex = 0;
        nextItem.focus();
    }
}

export function getPtvMusicItemMenuViewport(targetWindow: Window = window): PtvMusicItemMenuViewport {
    const visualViewport = targetWindow.visualViewport;

    return {
        height: visualViewport?.height || targetWindow.innerHeight || targetWindow.document.documentElement.clientHeight || 0,
        left: visualViewport?.offsetLeft || 0,
        top: visualViewport?.offsetTop || 0,
        width: visualViewport?.width || targetWindow.innerWidth || targetWindow.document.documentElement.clientWidth || 0
    };
}

export function getPtvMusicItemMenuPosition(
    trigger: PtvMusicItemMenuRect,
    viewport: PtvMusicItemMenuViewport,
    panel: Readonly<{ height: number; width: number }>
): PtvMusicItemMenuPosition {
    const leftBoundary = viewport.left + MENU_MARGIN;
    const rightBoundary = viewport.left + viewport.width - MENU_MARGIN;
    const topBoundary = viewport.top + MENU_MARGIN;
    const bottomBoundary = viewport.top + viewport.height - MENU_MARGIN;
    const availableWidth = Math.max(0, rightBoundary - leftBoundary);
    const width = Math.min(
        Math.max(MENU_MIN_WIDTH, panel.width),
        MENU_MAX_WIDTH,
        availableWidth
    );
    const left = clamp(trigger.right - width, leftBoundary, rightBoundary - width);
    const availableAbove = Math.max(0, trigger.top - MENU_GAP - topBoundary);
    const availableBelow = Math.max(0, bottomBoundary - trigger.bottom - MENU_GAP);
    let placeAbove = availableAbove >= availableBelow;

    if (panel.height <= availableAbove) {
        placeAbove = true;
    } else if (panel.height <= availableBelow) {
        placeAbove = false;
    }

    const availableHeight = placeAbove ? availableAbove : availableBelow;
    const maxHeight = Math.min(Math.max(MENU_MIN_HEIGHT, panel.height), availableHeight);
    const preferredTop = placeAbove ?
        trigger.top - MENU_GAP - maxHeight :
        trigger.bottom + MENU_GAP;
    const top = clamp(preferredTop, topBoundary, bottomBoundary - maxHeight);

    return {
        left,
        maxHeight,
        top,
        width
    };
}

export default function PtvMusicItemMenuOverlay({
    children,
    id,
    labelledBy,
    onClose,
    triggerRef
}: PtvMusicItemMenuOverlayProps) {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const positionFrameRef = useRef<number | null>(null);
    const [panelStyle, setPanelStyle] = useState<CSSProperties>(HIDDEN_MENU_STYLE);
    const restoreTriggerFocus = useCallback(() => {
        const trigger = triggerRef.current;

        if (trigger?.isConnected && !trigger.disabled) {
            trigger.focus();
        }
    }, [triggerRef]);
    const focusFirstEnabledItem = useCallback(() => {
        const items = getEnabledMenuItems(panelRef.current);

        if (items.length) {
            focusMenuItem(items, 0);
        }
    }, []);
    const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            restoreTriggerFocus();
            return;
        }

        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

        const items = getEnabledMenuItems(panelRef.current);

        if (!items.length) return;

        event.preventDefault();
        event.stopPropagation();

        const currentIndex = items.indexOf(document.activeElement as HTMLElement);
        let nextIndex = 0;

        if (event.key === 'End') {
            nextIndex = items.length - 1;
        } else if (event.key === 'ArrowUp') {
            nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
        } else if (event.key === 'ArrowDown') {
            nextIndex = currentIndex < 0 || currentIndex === items.length - 1 ? 0 : currentIndex + 1;
        }

        focusMenuItem(items, nextIndex);
    }, [onClose, restoreTriggerFocus]);
    const schedulePosition = useCallback(() => {
        if (positionFrameRef.current !== null) return;

        positionFrameRef.current = window.requestAnimationFrame(() => {
            positionFrameRef.current = null;
            const panel = panelRef.current;
            const trigger = triggerRef.current;

            if (!panel || !trigger?.isConnected) return;

            const panelRect = panel.getBoundingClientRect();
            const position = getPtvMusicItemMenuPosition(
                trigger.getBoundingClientRect(),
                getPtvMusicItemMenuViewport(),
                {
                    height: Math.max(panel.scrollHeight, panelRect.height, MENU_MIN_HEIGHT),
                    width: Math.max(panel.scrollWidth, panelRect.width, MENU_MIN_WIDTH)
                }
            );

            setPanelStyle({
                left: `${position.left}px`,
                maxHeight: `${position.maxHeight}px`,
                top: `${position.top}px`,
                visibility: 'visible',
                width: `${position.width}px`
            });

            // A button activation may restore focus to its trigger after React
            // commits the portal. Reassert the menu scope on the already-owned
            // positioning frame without stealing focus that moved elsewhere.
            if (document.activeElement === trigger) {
                focusFirstEnabledItem();
            }
        });
    }, [focusFirstEnabledItem, triggerRef]);

    useEffect(() => {
        schedulePosition();
        const visualViewport = window.visualViewport;

        window.addEventListener('orientationchange', schedulePosition);
        window.addEventListener('resize', schedulePosition);
        window.addEventListener('scroll', schedulePosition, true);
        visualViewport?.addEventListener('resize', schedulePosition);
        visualViewport?.addEventListener('scroll', schedulePosition);

        return () => {
            window.removeEventListener('orientationchange', schedulePosition);
            window.removeEventListener('resize', schedulePosition);
            window.removeEventListener('scroll', schedulePosition, true);
            visualViewport?.removeEventListener('resize', schedulePosition);
            visualViewport?.removeEventListener('scroll', schedulePosition);

            if (positionFrameRef.current !== null) {
                window.cancelAnimationFrame(positionFrameRef.current);
                positionFrameRef.current = null;
            }
        };
    }, [schedulePosition]);

    useLayoutEffect(() => {
        focusFirstEnabledItem();

        return restoreTriggerFocus;
    }, [focusFirstEnabledItem, restoreTriggerFocus]);

    if (typeof document === 'undefined' || !document.body) return null;

    return createPortal(
        <div
            ref={panelRef}
            id={id}
            className='ptv-music-item-menu-popover ptv-music-item-menu-overlay'
            data-ptv-music-item-menu-overlay='true'
            role='menu'
            aria-labelledby={labelledBy}
            style={panelStyle}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
        >
            {children}
        </div>,
        document.body
    );
}
