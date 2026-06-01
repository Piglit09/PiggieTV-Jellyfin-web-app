import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import Page from 'components/Page';

import {
    getPtvItemImageUrl,
    playPtvItem,
    type PtvItem,
    type PtvLibrary
} from '../../api';
import { PTV_ASSETS, PTV_BRANDING, PTV_ROUTES } from '../../core/config';
import { recordPtvEvent } from '../../core/observability';
import { resolvePtvStaticAssetUrl } from '../../core/urlOrigins';
import { registerPtvNativeRoute } from '../../shell/routeController';
import type { NativeHomeRow } from './hooks';
import {
    useNativeHomeData,
    useNativeHomeVirtualRows
} from './hooks';

import '../../modules/cards/cards.scss';
import '../../modules/cards/card-layout.scss';
import '../../modules/hero/hero.scss';
import './nativeHome.scss';

const POSTER_IMAGE_OPTIONS = {
    fillHeight: 446,
    fillWidth: 297,
    imageType: 'Primary',
    quality: 92
};

const LIBRARY_IMAGE_OPTIONS = {
    fillHeight: 267,
    fillWidth: 474,
    imageType: 'Thumb',
    quality: 92
};

function getItemTitle(item: PtvItem | PtvLibrary) {
    return item.Name || 'Untitled';
}

function getItemMeta(item: PtvItem | PtvLibrary) {
    const parts = [
        item.ProductionYear,
        item.Type,
        item.OfficialRating
    ].filter(Boolean);

    return parts.join(' | ');
}

function getHeroMeta(item: PtvItem | null) {
    if (!item) return PTV_BRANDING.loginDescription;

    return [
        item.ProductionYear,
        item.Type,
        item.CommunityRating ? `Rating ${item.CommunityRating.toFixed(1)}` : ''
    ].filter(Boolean).join('  ');
}

function getDetailsHref(item: PtvItem | PtvLibrary) {
    return item.Id ? `#/details?id=${encodeURIComponent(item.Id)}` : PTV_ROUTES.home;
}

function getNativeHomeRowAnchor(rowId: string) {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-ptv-native-home-row-id]'));

    return nodes.find(node => node.dataset.ptvNativeHomeRowId === rowId) || null;
}

function getNativeHomeRowLayout(rowId: string) {
    const node = getNativeHomeRowAnchor(rowId);
    const scroller = node?.querySelector<HTMLElement>('.ptv-native-home-scroller') || null;
    const placeholder = node?.querySelector<HTMLElement>('.ptv-native-home-row-placeholder') || null;
    const cardCount = node?.querySelectorAll('.ptv-native-card').length || 0;
    const style = node ? window.getComputedStyle(node) : null;
    const rect = node?.getBoundingClientRect();

    return {
        bottom: rect ? Number(rect.bottom.toFixed(1)) : null,
        cardCount,
        display: style?.display || null,
        hasCards: cardCount > 0,
        hasPlaceholder: Boolean(placeholder),
        hasScroller: Boolean(scroller),
        height: rect ? Number(rect.height.toFixed(1)) : null,
        inDom: Boolean(node),
        opacity: style?.opacity || null,
        top: rect ? Number(rect.top.toFixed(1)) : null,
        visibility: style?.visibility || null,
        width: rect ? Number(rect.width.toFixed(1)) : null
    };
}

function isPlayableItem(item: PtvItem | PtvLibrary) {
    return Boolean(item.Id && item.MediaType !== 'Book' && item.CollectionType !== 'books');
}

function NativeHomeHero({ heroItem }: { heroItem: PtvItem | null }) {
    const backdropUrl = useMemo(() => {
        if (!heroItem) {
            return resolvePtvStaticAssetUrl(PTV_ASSETS.backgrounds.page);
        }

        return getPtvItemImageUrl(heroItem, {
            imageIndex: 0,
            imageType: 'Backdrop',
            maxWidth: 1920,
            quality: 92
        }) || getPtvItemImageUrl(heroItem, {
            imageType: 'Primary',
            maxWidth: 1200,
            quality: 92
        });
    }, [heroItem]);
    const logoUrl = useMemo(() => {
        if (!heroItem?.ImageTags?.Logo) {
            return '';
        }

        return getPtvItemImageUrl(heroItem, {
            imageType: 'Logo',
            maxWidth: 800,
            quality: 94
        });
    }, [heroItem]);
    const appLogoUrl = resolvePtvStaticAssetUrl(PTV_ASSETS.logos.bannerLight);

    const handlePlay = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
        if (!heroItem?.Id) return;

        event.preventDefault();
        playPtvItem(heroItem.Id, {
            serverId: heroItem.ServerId,
            startPositionTicks: heroItem.UserData?.PlaybackPositionTicks || 0
        }).catch(() => {
            window.location.hash = getDetailsHref(heroItem).slice(1);
        });
    }, [heroItem]);

    return (
        <section className='ptv-native-home-hero' aria-label='Featured PiggieTV title'>
            {backdropUrl ? (
                <img
                    alt=''
                    aria-hidden='true'
                    className='ptv-native-home-hero-backdrop'
                    src={backdropUrl}
                />
            ) : null}

            <div className='ptv-native-home-hero-vignette' aria-hidden='true' />

            <div className='ptv-native-home-hero-content'>
                <img
                    alt={PTV_BRANDING.appName}
                    className='ptv-native-home-logo'
                    src={appLogoUrl}
                />

                {logoUrl ? (
                    <img
                        alt={getItemTitle(heroItem || {})}
                        className='ptv-native-home-title-logo'
                        src={logoUrl}
                    />
                ) : (
                    <h1>{heroItem ? getItemTitle(heroItem) : PTV_BRANDING.appName}</h1>
                )}

                <p className='ptv-native-home-hero-meta'>{getHeroMeta(heroItem)}</p>

                {heroItem?.Overview ? (
                    <p className='ptv-native-home-overview'>{heroItem.Overview}</p>
                ) : (
                    <p className='ptv-native-home-overview'>
                        Your native PiggieTV home, powered by Jellyfin APIs.
                    </p>
                )}

                <div className='ptv-native-home-hero-actions'>
                    {heroItem?.Id && isPlayableItem(heroItem) ? (
                        <a
                            aria-label={`Play ${getItemTitle(heroItem)}`}
                            className='ptv-native-home-primary-action'
                            href={getDetailsHref(heroItem)}
                            onClick={handlePlay}
                        >
                            Play
                        </a>
                    ) : null}
                    {heroItem?.Id ? (
                        <a className='ptv-native-home-secondary-action' href={getDetailsHref(heroItem)}>
                            Details
                        </a>
                    ) : null}
                </div>
            </div>
        </section>
    );
}

function NativeHomeCard({
    item,
    kind
}: {
    item: PtvItem | PtvLibrary;
    kind: NativeHomeRow['kind'];
}) {
    const imageUrl = useMemo(() => getPtvItemImageUrl(
        item,
        kind === 'libraries' ? LIBRARY_IMAGE_OPTIONS : POSTER_IMAGE_OPTIONS
    ), [item, kind]);
    const title = getItemTitle(item);
    const href = kind === 'libraries'
        ? `#/list?parentId=${encodeURIComponent(item.Id || '')}`
        : getDetailsHref(item);

    const handlePlay = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        if (!item.Id || !isPlayableItem(item)) return;

        event.preventDefault();
        event.stopPropagation();
        playPtvItem(item.Id, {
            serverId: item.ServerId,
            startPositionTicks: item.UserData?.PlaybackPositionTicks || 0
        }).catch(() => {
            window.location.hash = getDetailsHref(item).slice(1);
        });
    }, [item]);

    return (
        <article className={`ptv-native-card ptv-native-card-${kind}`}>
            <a
                aria-label={`Open ${title}`}
                className='ptv-native-card-link'
                href={href}
            >
                <div className='ptv-native-card-image-wrap'>
                    {imageUrl ? (
                        <img
                            alt={title}
                            className='ptv-native-card-image'
                            loading='lazy'
                            src={imageUrl}
                        />
                    ) : (
                        <div className='ptv-native-card-empty' aria-hidden='true'>
                            {title.slice(0, 1)}
                        </div>
                    )}

                    {isPlayableItem(item) ? (
                        <button
                            aria-label={`Play ${title}`}
                            className='ptv-native-card-play'
                            onClick={handlePlay}
                            type='button'
                        >
                            Play
                        </button>
                    ) : null}
                </div>

                <div className='ptv-native-card-copy'>
                    <strong>{title}</strong>
                    <span>{kind === 'libraries' ? item.CollectionType || 'Library' : getItemMeta(item)}</span>
                </div>
            </a>
        </article>
    );
}

function NativeHomeRowView({
    isMounted,
    row
}: {
    isMounted: boolean;
    row: NativeHomeRow;
}) {
    return (
        <section
            aria-label={row.title}
            className={`ptv-native-home-row ptv-native-home-row-${row.id}`}
        >
            <div className='ptv-native-home-row-heading'>
                <div>
                    <span>{row.subtitle}</span>
                    <h2>{row.title}</h2>
                </div>
                <a href={PTV_ROUTES.search} aria-label={`Search more titles like ${row.title}`}>More</a>
            </div>

            {isMounted ? (
                <div className='ptv-native-home-scroller' role='list'>
                    {row.items.map(item => (
                        <div key={`${row.id}-${item.Id || item.Name}`} role='listitem'>
                            <NativeHomeCard item={item} kind={row.kind} />
                        </div>
                    ))}
                </div>
            ) : (
                <div
                    aria-label={`${row.title} is waiting to load`}
                    className='ptv-native-home-row-placeholder'
                    role='status'
                />
            )}
        </section>
    );
}

function NativeHomeFallback({ message }: { message: string }) {
    const openJellyfinHome = useCallback(() => {
        // TODO: once the native route controller can host multiple component variants,
        // replace this redirect with an in-shell fallback component.
        recordPtvEvent('render', 'native-home-fallback-used', {
            target: PTV_ROUTES.homeHtml
        });
        window.location.hash = PTV_ROUTES.homeHtml.slice(1);
    }, []);

    return (
        <section className='ptv-native-home-error' role='alert'>
            <h1>Native Home could not load</h1>
            <p>{message}</p>
            <button type='button' onClick={openJellyfinHome}>
                Open Jellyfin Web Home
            </button>
        </section>
    );
}

function NativeHome() {
    const mountedAt = useRef(performance.now());
    const {
        error,
        heroItem,
        isLoading,
        rows
    } = useNativeHomeData();
    const {
        isRowMounted,
        mountedRowCount,
        registerRowRef
    } = useNativeHomeVirtualRows(rows);

    useEffect(() => {
        if (isLoading || error) return;

        recordPtvEvent('render', 'native-home-render-complete', {
            mountedRows: mountedRowCount,
            renderAgeMs: Number((performance.now() - mountedAt.current).toFixed(1)),
            rowCount: rows.length
        });
    }, [error, isLoading, mountedRowCount, rows.length]);

    useEffect(() => {
        if (isLoading || error) return undefined;

        const animationFrame = window.requestAnimationFrame(() => {
            rows.forEach(row => {
                const mounted = isRowMounted(row.id);

                recordPtvEvent('render', 'native-home-row-details', {
                    itemCount: row.items.length,
                    layout: getNativeHomeRowLayout(row.id),
                    mounted,
                    rowId: row.id,
                    source: row.source,
                    title: row.title
                });
            });
        });

        return () => window.cancelAnimationFrame(animationFrame);
    }, [error, isLoading, isRowMounted, mountedRowCount, rows]);

    return (
        <Page
            id='ptv-native-home-page'
            title={PTV_BRANDING.appName}
            className='ptv-native-home-page'
            isBackButtonEnabled={false}
            isMenuButtonEnabled
            isThemeMediaSupported
            shouldAutoFocus={false}
        >
            <main
                className='ptv-native-home'
                data-ptv-mounted-rows={mountedRowCount}
            >
                {error ? (
                    <NativeHomeFallback message={error} />
                ) : (
                    <>
                        <NativeHomeHero heroItem={heroItem} />

                        {isLoading ? (
                            <section className='ptv-native-home-loading' aria-live='polite'>
                                <span />
                                <p>Loading PiggieTV Home</p>
                            </section>
                        ) : (
                            <div className='ptv-native-home-rows'>
                                {rows.map(row => (
                                    <div
                                        key={row.id}
                                        ref={registerRowRef(row.id)}
                                        className='ptv-native-home-row-anchor'
                                        data-ptv-native-home-row-id={row.id}
                                        data-ptv-native-home-row-mounted={isRowMounted(row.id) ? 'true' : 'false'}
                                        data-ptv-native-home-row-source={row.source}
                                    >
                                        <NativeHomeRowView
                                            isMounted={isRowMounted(row.id)}
                                            row={row}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </main>
        </Page>
    );
}

function registerNativeHomeRoute() {
    const routeController = window.PTV?.routeController as {
        registerRoute?: (path: string, component: unknown, mode: 'native') => unknown;
    } | undefined;

    if (routeController?.registerRoute) {
        routeController.registerRoute('/home', NativeHome, 'native');
        return;
    }

    registerPtvNativeRoute('/home', NativeHome, 'native');
}

registerNativeHomeRoute();

export default NativeHome;
