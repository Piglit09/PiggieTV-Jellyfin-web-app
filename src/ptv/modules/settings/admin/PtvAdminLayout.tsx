import React, { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import PtvIcon from '../../icons/PtvIcon';
import {
    getPtvAdminCategory,
    getPtvAdminDestination,
    getPtvAdminDestinationForLocation,
    type PtvAdminCategoryId,
    type PtvAdminDestination
} from './adminNavigation';
import {
    usePtvAdminNavigation
} from './useAdminNavigation';
import { PtvAdminNavigationContext } from './adminNavigationContext';

type PtvAdminLayoutProps = Readonly<{
    children: ReactNode;
    currentDestinationId?: string;
    mode?: 'dashboard' | 'settings';
}>;

type PtvAdminNavigationProps = Readonly<{
    currentDestinationId?: string;
    navigation: ReturnType<typeof usePtvAdminNavigation>;
    onNavigate?: () => void;
}>;

type AdminNavigationGroupProps = Readonly<{
    currentDestinationId?: string;
    group: ReturnType<typeof usePtvAdminNavigation>['groups'][number];
    isExpanded: boolean;
    isPluginNavigationError: boolean;
    isPluginNavigationPending: boolean;
    onNavigate?: () => void;
    onToggle: (categoryId: PtvAdminCategoryId) => void;
    retryPluginNavigation: () => Promise<unknown>;
}>;

const ADMIN_GROUP_STATE_KEY = 'ptv-admin-expanded-groups';

function readSearchParameter(search: string, key: string) {
    const query = search.startsWith('?') ? search.slice(1) : search;

    for (const pair of query.split('&')) {
        const separator = pair.indexOf('=');
        const rawKey = separator < 0 ? pair : pair.slice(0, separator);
        try {
            if (decodeURIComponent(rawKey.replace(/\+/g, ' ')) !== key) continue;
        } catch {
            continue;
        }

        const rawValue = separator < 0 ? '' : pair.slice(separator + 1);
        try {
            return decodeURIComponent(rawValue.replace(/\+/g, ' '));
        } catch {
            return '';
        }
    }

    return null;
}

function loadExpandedGroups(activeCategory?: PtvAdminCategoryId) {
    const fallback = new Set<PtvAdminCategoryId>([ 'overview', activeCategory || 'piggietv' ]);

    try {
        const stored = window.sessionStorage?.getItem(ADMIN_GROUP_STATE_KEY);
        if (!stored) return fallback;

        const parsed = JSON.parse(stored) as unknown;
        if (!Array.isArray(parsed)) return fallback;

        const valid = parsed.filter(value => Boolean(getPtvAdminCategory(value as PtvAdminCategoryId))) as PtvAdminCategoryId[];
        valid.push('overview');
        if (activeCategory) valid.push(activeCategory);
        return new Set(valid);
    } catch {
        return fallback;
    }
}

function saveExpandedGroups(groups: Set<PtvAdminCategoryId>) {
    try {
        window.sessionStorage?.setItem(ADMIN_GROUP_STATE_KEY, JSON.stringify(Array.from(groups)));
    } catch {
        // Session-only navigation preferences are optional.
    }
}

function AdminDestinationLink({
    currentDestinationId,
    destination,
    onNavigate
}: Readonly<{
    currentDestinationId?: string;
    destination: PtvAdminDestination;
    onNavigate?: () => void;
}>) {
    const content = (
        <>
            <PtvIcon name={destination.icon} size='18px' />
            <span>{destination.label}</span>
        </>
    );
    const commonProps = {
        'aria-current': destination.id === currentDestinationId ? 'page' as const : undefined,
        className: 'ptv-admin-sidebar-link',
        'data-admin-destination': destination.id,
        onClick: onNavigate,
        title: destination.description
    };

    if (destination.routeKind === 'router') {
        return <Link {...commonProps} to={destination.href}>{content}</Link>;
    }

    return <a {...commonProps} href={destination.href}>{content}</a>;
}

function AdminNavigationGroup({
    currentDestinationId,
    group,
    isExpanded,
    isPluginNavigationError,
    isPluginNavigationPending,
    onNavigate,
    onToggle,
    retryPluginNavigation
}: AdminNavigationGroupProps) {
    const { category, destinations } = group;
    const contentId = `ptv-admin-group-${category.id}`;
    const handleToggle = useCallback(() => onToggle(category.id), [category.id, onToggle]);
    const handleRetry = useCallback(() => {
        retryPluginNavigation().catch(() => undefined);
    }, [retryPluginNavigation]);

    return (
        <section className='ptv-admin-nav-group' data-admin-category={category.id}>
            {category.id === 'overview' ? (
                <h2>{category.label}</h2>
            ) : (
                <button
                    aria-controls={contentId}
                    aria-expanded={isExpanded}
                    className='ptv-admin-group-toggle'
                    onClick={handleToggle}
                    type='button'
                >
                    <span>{category.label}</span>
                    <PtvIcon name='right' size='14px' />
                </button>
            )}

            <div className='ptv-admin-group-destinations' hidden={!isExpanded} id={contentId}>
                {destinations.map(destination => (
                    <AdminDestinationLink
                        currentDestinationId={currentDestinationId}
                        destination={destination}
                        key={destination.id}
                        onNavigate={onNavigate}
                    />
                ))}
                {category.id === 'plugins' && isPluginNavigationPending && (
                    <span className='ptv-admin-plugin-nav-note' role='status'>Discovering plugin pages…</span>
                )}
                {category.id === 'plugins' && isPluginNavigationError && (
                    <button className='ptv-admin-plugin-nav-retry' onClick={handleRetry} type='button'>
                        Retry plugin pages
                    </button>
                )}
            </div>
        </section>
    );
}

export function PtvAdminNavigation({
    currentDestinationId,
    navigation,
    onNavigate
}: PtvAdminNavigationProps) {
    const location = useLocation();
    const activeDestination = getPtvAdminDestination(currentDestinationId || '')
        || navigation.dynamicPluginDestinations.find(destination => destination.id === currentDestinationId);
    const requestedCategory = readSearchParameter(location.search, 'section') as PtvAdminCategoryId | null;
    const activeCategory = requestedCategory && getPtvAdminCategory(requestedCategory) ?
        requestedCategory :
        activeDestination?.category;
    const [ expandedGroups, setExpandedGroups ] = useState(() => loadExpandedGroups(activeCategory));

    useEffect(() => {
        if (!activeCategory || expandedGroups.has(activeCategory)) return;

        setExpandedGroups(current => {
            const next = new Set(current);
            next.add(activeCategory);
            saveExpandedGroups(next);
            return next;
        });
    }, [activeCategory, expandedGroups]);

    const toggleGroup = useCallback((categoryId: PtvAdminCategoryId) => {
        if (categoryId === 'overview') return;

        setExpandedGroups(current => {
            const next = new Set(current);
            if (next.has(categoryId)) next.delete(categoryId);
            else next.add(categoryId);
            saveExpandedGroups(next);
            return next;
        });
    }, []);

    return (
        <nav aria-label='Administration'>
            {navigation.groups.map(group => (
                <AdminNavigationGroup
                    currentDestinationId={currentDestinationId}
                    group={group}
                    isExpanded={group.category.id === 'overview' || expandedGroups.has(group.category.id)}
                    isPluginNavigationError={navigation.isPluginNavigationError}
                    isPluginNavigationPending={navigation.isPluginNavigationPending}
                    key={group.category.id}
                    onNavigate={onNavigate}
                    onToggle={toggleGroup}
                    retryPluginNavigation={navigation.retryPluginNavigation}
                />
            ))}
        </nav>
    );
}

export default function PtvAdminLayout({
    children,
    currentDestinationId,
    mode = 'settings'
}: PtvAdminLayoutProps) {
    const location = useLocation();
    const [ isMobileNavigationOpen, setIsMobileNavigationOpen ] = useState(false);
    const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
    const mobileDrawerRef = useRef<HTMLElement>(null);
    const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
    const navigation = usePtvAdminNavigation();
    const pluginName = readSearchParameter(location.search, 'name');
    const dynamicDestination = pluginName ?
        navigation.dynamicPluginDestinations.find(destination => destination.href === `#/configurationpage?name=${encodeURIComponent(pluginName)}`) :
        undefined;
    const isPluginConfigurationRoute = location.pathname.replace(/\/$/, '').toLowerCase() === '/configurationpage'
        || window.location.hash.toLowerCase().startsWith('#/configurationpage');
    const resolvedDestination = useMemo(() => (
        getPtvAdminDestination(currentDestinationId || '')
        || dynamicDestination
        || getPtvAdminDestinationForLocation(location.pathname, location.search, window.location.hash)
        || (isPluginConfigurationRoute ? getPtvAdminDestination('plugin-manager') : undefined)
        || getPtvAdminDestination('overview')
    ), [currentDestinationId, dynamicDestination, isPluginConfigurationRoute, location.pathname, location.search]);
    const currentLabel = resolvedDestination?.label || 'Overview';
    const currentCategory = getPtvAdminCategory(resolvedDestination?.category || 'overview');
    const closeMobileNavigation = useCallback(() => {
        setIsMobileNavigationOpen(false);
        mobileMenuButtonRef.current?.focus();
    }, []);
    const openMobileNavigation = useCallback(() => setIsMobileNavigationOpen(true), []);
    const Root = mode === 'settings' ? 'main' : 'div';

    useEffect(() => {
        const requestedCategory = readSearchParameter(location.search, 'section') as PtvAdminCategoryId | null;
        const hasRequestedCategory = Boolean(requestedCategory && getPtvAdminCategory(requestedCategory));
        const isCompactLayout = typeof window.matchMedia === 'function'
            && window.matchMedia('(max-width: 1080px)').matches;

        setIsMobileNavigationOpen(hasRequestedCategory && isCompactLayout);
    }, [location.key, location.pathname, location.search]);

    useEffect(() => {
        if (!isMobileNavigationOpen) return;

        mobileCloseButtonRef.current?.focus();
        const handleDialogKeyboard = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeMobileNavigation();
                return;
            }

            if (event.key !== 'Tab') return;

            const focusable = Array.from(mobileDrawerRef.current?.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            ) || []).filter(element => !element.hasAttribute('hidden'));
            const first = focusable[0];
            const last = focusable.at(-1);
            if (!first || !last) return;

            if (event.shiftKey && (document.activeElement === first || !mobileDrawerRef.current?.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !mobileDrawerRef.current?.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleDialogKeyboard);
        return () => document.removeEventListener('keydown', handleDialogKeyboard);
    }, [closeMobileNavigation, isMobileNavigationOpen]);

    return (
        <PtvAdminNavigationContext.Provider value={navigation}>
            <Root className={`ptv-admin-shell ptv-admin-shell-${mode}`} data-admin-destination={resolvedDestination?.id}>
                <aside aria-label='Administration sections' className='ptv-admin-sidebar'>
                    <Link className='ptv-admin-back-link' to='/settings'>
                        <PtvIcon name='back' size='18px' />
                        <span>Back to Settings</span>
                    </Link>
                    <PtvAdminNavigation currentDestinationId={resolvedDestination?.id} navigation={navigation} />
                </aside>

                <button
                    aria-controls='ptv-admin-mobile-navigation'
                    aria-expanded={isMobileNavigationOpen}
                    className='ptv-admin-mobile-menu-button'
                    onClick={openMobileNavigation}
                    ref={mobileMenuButtonRef}
                    type='button'
                >
                    <PtvIcon name='menu' size='20px' />
                    Administration
                </button>

                {isMobileNavigationOpen && (
                    <div className='ptv-admin-mobile-drawer-backdrop'>
                        <button
                            aria-label='Close administration navigation'
                            className='ptv-admin-mobile-drawer-dismiss'
                            onClick={closeMobileNavigation}
                            tabIndex={-1}
                            type='button'
                        />
                        <aside
                            aria-labelledby='ptv-admin-mobile-navigation-title'
                            aria-modal='true'
                            className='ptv-admin-mobile-drawer'
                            id='ptv-admin-mobile-navigation'
                            ref={mobileDrawerRef}
                            role='dialog'
                        >
                            <header>
                                <strong id='ptv-admin-mobile-navigation-title'>Administration</strong>
                                <button
                                    aria-label='Close administration navigation'
                                    onClick={closeMobileNavigation}
                                    ref={mobileCloseButtonRef}
                                    type='button'
                                >
                                    <PtvIcon name='back' size='19px' />
                                </button>
                            </header>
                            <PtvAdminNavigation currentDestinationId={resolvedDestination?.id} navigation={navigation} onNavigate={closeMobileNavigation} />
                        </aside>
                    </div>
                )}

                <div className='ptv-admin-main-column'>
                    <div className='ptv-admin-mobile-context'>
                        <span>
                            <PtvIcon name={currentCategory?.icon || 'dashboard'} size='18px' />
                            {currentLabel}
                        </span>
                        <Link to='/settings'>
                            <PtvIcon name='back' size='18px' />
                            Settings
                        </Link>
                    </div>
                    {children}
                </div>
            </Root>
        </PtvAdminNavigationContext.Provider>
    );
}
