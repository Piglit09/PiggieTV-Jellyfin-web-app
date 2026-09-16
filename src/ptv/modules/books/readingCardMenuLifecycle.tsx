import React, {
    createContext,
    type MouseEvent as ReactMouseEvent,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react';

type ReadingCardMenuRegistration = Readonly<{
    id: string;
    root: HTMLDetailsElement;
    trigger: HTMLElement;
}>;

type ReadingCardMenuOwnerValue = Readonly<{
    activeMenuId: string | null;
    closeMenu: (id: string, restoreFocus?: boolean) => void;
    openMenu: (registration: ReadingCardMenuRegistration) => void;
}>;

type ReadingCardMenuOwnerProps = Readonly<{
    children: ReactNode;
    contentVersion: unknown;
    routeKey: string;
}>;

type ReadingCardMenuProps = Readonly<{
    children: ReactNode;
    label: string;
    trigger: ReactNode;
}>;

const READING_CARD_MENU_OWNER_CONTEXT = createContext<ReadingCardMenuOwnerValue | null>(null);

function setDetailsOpen(root: HTMLDetailsElement, open: boolean) {
    if (root.open !== open) root.open = open;
}

export function ReadingCardMenuOwner({ children, contentVersion, routeKey }: ReadingCardMenuOwnerProps) {
    const activeMenuRef = useRef<ReadingCardMenuRegistration | null>(null);
    const [ activeMenuId, setActiveMenuId ] = useState<string | null>(null);
    const closeActiveMenu = useCallback((restoreFocus = false) => {
        const activeMenu = activeMenuRef.current;

        if (!activeMenu) return;

        setDetailsOpen(activeMenu.root, false);
        activeMenuRef.current = null;
        setActiveMenuId(null);

        if (restoreFocus && activeMenu.trigger.isConnected) {
            activeMenu.trigger.focus();
        }
    }, []);
    const closeMenu = useCallback((id: string, restoreFocus = false) => {
        if (activeMenuRef.current?.id !== id) return;
        closeActiveMenu(restoreFocus);
    }, [closeActiveMenu]);
    const openMenu = useCallback((registration: ReadingCardMenuRegistration) => {
        const activeMenu = activeMenuRef.current;

        if (activeMenu?.id === registration.id) return;
        if (activeMenu) setDetailsOpen(activeMenu.root, false);

        setDetailsOpen(registration.root, true);
        activeMenuRef.current = registration;
        setActiveMenuId(registration.id);
    }, []);

    useLayoutEffect(() => {
        closeActiveMenu(true);
    }, [closeActiveMenu, contentVersion, routeKey]);

    useEffect(() => {
        if (!activeMenuId) return undefined;

        const handlePointerDown = (event: PointerEvent) => {
            const activeMenu = activeMenuRef.current;
            const target = event.target;

            if (!activeMenu || !(target instanceof Node) || activeMenu.root.contains(target)) return;
            closeActiveMenu();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !activeMenuRef.current) return;

            event.preventDefault();
            event.stopPropagation();
            closeActiveMenu(true);
        };

        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('keydown', handleKeyDown, true);

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [activeMenuId, closeActiveMenu]);

    useEffect(() => () => {
        const activeMenu = activeMenuRef.current;

        if (activeMenu) setDetailsOpen(activeMenu.root, false);
        activeMenuRef.current = null;
    }, []);

    const owner = useMemo<ReadingCardMenuOwnerValue>(() => ({
        activeMenuId,
        closeMenu,
        openMenu
    }), [activeMenuId, closeMenu, openMenu]);

    return (
        <READING_CARD_MENU_OWNER_CONTEXT.Provider value={owner}>
            {children}
        </READING_CARD_MENU_OWNER_CONTEXT.Provider>
    );
}

function useReadingCardMenuOwner() {
    const owner = useContext(READING_CARD_MENU_OWNER_CONTEXT);

    if (!owner) throw new Error('ReadingCardMenu must be rendered inside ReadingCardMenuOwner.');
    return owner;
}

export function ReadingCardMenu({ children, label, trigger }: ReadingCardMenuProps) {
    const { activeMenuId, closeMenu, openMenu } = useReadingCardMenuOwner();
    const reactId = useId();
    const instanceId = `ptv-reading-card-menu-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const panelId = `${instanceId}-panel`;
    const triggerId = `${instanceId}-trigger`;
    const rootRef = useRef<HTMLDetailsElement>(null);
    const triggerRef = useRef<HTMLElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const isOpen = activeMenuId === instanceId;
    const dismiss = useCallback(() => {
        closeMenu(instanceId, true);
    }, [closeMenu, instanceId]);
    const toggle = useCallback((event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault();

        if (isOpen) {
            closeMenu(instanceId);
            return;
        }

        const root = rootRef.current;
        const triggerElement = triggerRef.current;

        if (root && triggerElement) {
            openMenu({
                id: instanceId,
                root,
                trigger: triggerElement
            });
        }
    }, [closeMenu, instanceId, isOpen, openMenu]);

    useLayoutEffect(() => {
        if (!isOpen) return;

        menuRef.current
            ?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])')
            ?.focus();
    }, [isOpen]);

    useEffect(() => () => closeMenu(instanceId), [closeMenu, instanceId]);

    return (
        <details ref={rootRef} className='ptv-books-card-overflow' open={isOpen}>
            <summary
                ref={triggerRef}
                id={triggerId}
                role='button'
                aria-controls={panelId}
                aria-expanded={isOpen}
                aria-haspopup='menu'
                aria-label={label}
                title={label}
                onClick={toggle}
            >
                {trigger}
            </summary>
            <div
                ref={menuRef}
                id={panelId}
                className='ptv-books-card-overflow-menu'
                role='menu'
                aria-labelledby={triggerId}
                onClickCapture={dismiss}
            >
                {children}
            </div>
        </details>
    );
}
