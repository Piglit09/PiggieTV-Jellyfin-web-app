import { on } from '../../core/events';
import { registerModule } from '../../core/lifecycle';
import { runIconEngine } from '../../utils/icons';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { isPiggieTvReaderItem, resolveReaderSource } from '../reader/sourceResolver';
import { loadReaderProgress } from '../reader/readerProgressStore';
import { playPtvReaderItem } from '../reader/readerLoader';
import { recordPtvEvent, shouldCollectDiagnostics } from '../../core/observability';
import { getPtvItemImageCandidates } from '../../api';
import { getPtvPerformanceProfile } from '../../core/clientProfile';
import { createPtvAbortController } from '../../core/abortController';
import { getCoordinatedLegacyItemDetail } from '../../services/coordinatedLegacyItemDetail';
import {
    getPtvDetailsShellSection,
    mountPtvDetailsShell,
    setPtvDetailsShellSection
} from './detailsShell';
import {
    preparePtvDetailsLayout,
    releasePtvDetailsLayout,
    resetPtvDetailsBackdrop,
    setPtvDetailsBackdropCandidates
} from './detailsLayout';
import {
    claimPtvDetailImageRepair,
    clearPtvDetailImageRepairAttempts
} from './detailImageRepairState';

import './details.scss';

const DETAIL_PAGE_SELECTOR = '#itemDetailPage, .itemDetailPage';
const DETAILS_DISCOVERY_CLASS = 'ptv-details-discovery';
const READER_ACTIONS_CLASS = 'ptv-reader-detail-actions';
let detailsEnhancementActive = false;
let detailsEnhancementController = null;
let detailsEnhancementGeneration = 0;
let releasePendingInspection = null;

function beginDetailsEnhancementGeneration() {
    releasePendingInspection?.();
    releasePendingInspection = null;
    detailsEnhancementController?.abort();
    detailsEnhancementController = createPtvAbortController();
    detailsEnhancementGeneration += 1;

    return {
        controller: detailsEnhancementController,
        generation: detailsEnhancementGeneration
    };
}

function captureDetailsEnhancementGeneration() {
    if (!detailsEnhancementActive || !detailsEnhancementController) return null;

    return {
        controller: detailsEnhancementController,
        generation: detailsEnhancementGeneration
    };
}

function isDetailsEnhancementGenerationCurrent(owner) {
    return Boolean(
        detailsEnhancementActive
        && owner
        && owner.controller === detailsEnhancementController
        && owner.generation === detailsEnhancementGeneration
        && !owner.controller.signal.aborted
    );
}

function retireDetailsEnhancementGeneration() {
    releasePendingInspection?.();
    releasePendingInspection = null;
    detailsEnhancementController?.abort();
    detailsEnhancementController = null;
    detailsEnhancementGeneration += 1;
}

function getHashParams() {
    const hash = window.location.hash || '';
    const queryIndex = hash.indexOf('?');
    const values = new Map();

    if (queryIndex === -1) {
        return {
            get: () => ''
        };
    }

    hash.slice(queryIndex + 1).split('&').forEach(pair => {
        const [rawKey, ...rawValueParts] = pair.split('=');
        const key = decodeURIComponent((rawKey || '').replace(/\+/g, ' '));
        const value = decodeURIComponent(rawValueParts.join('=').replace(/\+/g, ' '));

        if (key) values.set(key, value);
    });

    return {
        get: key => values.get(key) || ''
    };
}

function getApiClient(serverId) {
    if (serverId) return ServerConnections.getApiClient(serverId);

    return window.ApiClient;
}

function isFilenameCharacter(value) {
    const code = value.charCodeAt(0);

    return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

function getSafeFilenameBase(value) {
    let result = '';
    let previousDash = false;

    String(value || 'book').toLowerCase().split('').forEach(character => {
        if (isFilenameCharacter(character)) {
            result += character;
            previousDash = false;
            return;
        }

        if (!previousDash && result) {
            result += '-';
            previousDash = true;
        }
    });

    return result.endsWith('-') ? result.slice(0, -1) : result || 'book';
}

function getFilename(item, source) {
    const extension = source.extension || source.metadata.fileExtension || 'book';
    return `${getSafeFilenameBase(source.metadata.title || item.Name)}.${extension}`;
}

function normalizeDetailButtons(page) {
    page.querySelectorAll('.detailButton').forEach((button) => {
        button.classList.add('ptv-detail-action');
        const actionName = Array.from(button.classList)
            .find(className => className.startsWith('btn') && className !== 'button-flat') || 'detail-action';

        button.dataset.ptvFocusKey = `details:${actionName}`;

        if (button.matches('.btnPlay, .btnReplay')) {
            button.dataset.ptvInitialFocus = 'details-play';
        }
    });

    page.querySelectorAll('.detailButton[title]').forEach((button) => {
        const title = button.getAttribute('title');

        if (title) {
            button.setAttribute('aria-label', title);
            button.removeAttribute('title');
        }
    });
}

function createDetailImageAnchor(source) {
    const anchor = document.createElement('a');
    anchor.href = source;

    return anchor;
}

function getDetailImageParts(pathname) {
    const segments = pathname.split('/').filter(Boolean);
    const itemsIndex = segments.findIndex(segment => segment.toLowerCase() === 'items');
    const imagesIndex = segments.findIndex((segment, index) => index > itemsIndex && segment.toLowerCase() === 'images');

    if (itemsIndex === -1 || imagesIndex === -1) return null;

    const itemId = segments[itemsIndex + 1];
    const imageType = segments[imagesIndex + 1];

    if (!itemId || !imageType) return null;

    return {
        imageType,
        imagesIndex,
        itemId,
        segments
    };
}

function removeQueryParameter(search, keyToRemove) {
    const normalizedKey = keyToRemove.toLowerCase();
    const query = search.startsWith('?') ? search.slice(1) : search;
    const nextPairs = query
        .split('&')
        .filter(pair => {
            const [rawKey] = pair.split('=');
            return decodeURIComponent((rawKey || '').replace(/\+/g, ' ')).toLowerCase() !== normalizedKey;
        });

    return nextPairs.length ? `?${nextPairs.join('&')}` : '';
}

function replaceDetailImageType(anchor, parts, nextType) {
    const nextSegments = [...parts.segments];
    nextSegments[parts.imagesIndex + 1] = nextType;

    if (nextType !== 'Backdrop') {
        nextSegments.splice(parts.imagesIndex + 2);
    } else {
        nextSegments[parts.imagesIndex + 2] = '0';
    }

    anchor.pathname = `/${nextSegments.join('/')}`;

    return anchor.href;
}

function getDetailImageRepairTarget(image) {
    const source = image.currentSrc || image.src;

    if (!source || !source.toLowerCase().includes('/items/') || !source.toLowerCase().includes('/images/')) return null;

    const anchor = createDetailImageAnchor(source);
    const parts = getDetailImageParts(anchor.pathname);

    if (!parts) return null;

    const { imageType, itemId } = parts;
    const normalizedType = imageType.toLowerCase();
    const currentStep = Number(image.dataset.ptvImageRepairStep || 0);

    if (anchor.search.toLowerCase().includes('tag=')) {
        anchor.search = removeQueryParameter(anchor.search, 'tag');
        return {
            attemptedUrl: source,
            itemId,
            nextImageType: imageType,
            nextStep: currentStep + 1,
            nextUrl: anchor.href,
            staleTagDetected: true
        };
    }

    if (normalizedType === 'primary') {
        return {
            attemptedUrl: source,
            itemId,
            nextImageType: 'Thumb',
            nextStep: currentStep + 1,
            nextUrl: replaceDetailImageType(anchor, parts, 'Thumb'),
            staleTagDetected: false
        };
    }

    if (normalizedType === 'thumb') {
        return {
            attemptedUrl: source,
            itemId,
            nextImageType: 'Backdrop',
            nextStep: currentStep + 1,
            nextUrl: replaceDetailImageType(anchor, parts, 'Backdrop'),
            staleTagDetected: false
        };
    }

    return null;
}

function handleDetailImageError(event) {
    const image = event.currentTarget;

    if (!(image instanceof HTMLImageElement)) return;

    const target = getDetailImageRepairTarget(image);

    if (!target || !claimPtvDetailImageRepair(image, target.itemId, target.nextUrl)) return;

    image.dataset.ptvImageRepairStep = String(target.nextStep);

    if (shouldCollectDiagnostics()) {
        recordPtvEvent('image', 'details-image-repair', {
            attemptedUrl: target.attemptedUrl,
            itemId: target.itemId,
            nextImageType: target.nextImageType,
            nextUrl: target.nextUrl,
            staleTagDetected: target.staleTagDetected
        });
    }

    image.src = target.nextUrl;
}

function handleDetailImageLoad(event) {
    const image = event.currentTarget;

    if (!(image instanceof HTMLImageElement)) return;

    clearPtvDetailImageRepairAttempts(image);
    image.classList.add('ptv-detail-artwork-ready');
    image.closest('.detailImageContainer')?.classList.remove('ptv-detail-artwork-pending');
}

function repairDetailImages(page) {
    page.querySelectorAll('img').forEach(image => {
        if (image.dataset.ptvImageRepairInstalled === 'true') return;

        image.dataset.ptvImageRepairInstalled = 'true';
        image.classList.add('ptv-detail-artwork-image');
        image.closest('.detailImageContainer')?.classList.add('ptv-detail-artwork-pending');
        image.addEventListener('load', handleDetailImageLoad);
        image.addEventListener('error', handleDetailImageError);

        if (image.complete && image.naturalWidth > 0) {
            image.classList.add('ptv-detail-artwork-ready');
            image.closest('.detailImageContainer')?.classList.remove('ptv-detail-artwork-pending');
        }
    });
}

function releaseDetailImages(page) {
    page.querySelectorAll('img[data-ptv-image-repair-installed="true"]').forEach(image => {
        image.removeEventListener('load', handleDetailImageLoad);
        image.removeEventListener('error', handleDetailImageError);
        clearPtvDetailImageRepairAttempts(image);
        delete image.dataset.ptvImageRepairInstalled;
        delete image.dataset.ptvImageRepairStep;
        image.classList.remove('ptv-detail-artwork-image', 'ptv-detail-artwork-ready');
        image.closest('.detailImageContainer')?.classList.remove('ptv-detail-artwork-pending');
    });
}

function resetDetailEnhancementState(page) {
    releaseDetailImages(page);
    page.querySelector(`.${READER_ACTIONS_CLASS}`)?.remove();
    page.querySelector(`.${DETAILS_DISCOVERY_CLASS}`)?.remove();
    delete page.dataset.ptvDetailsDiscoveryGeneration;
    delete page.dataset.ptvDetailsDiscoveryItemId;
    delete page.dataset.ptvDetailsDiscoveryPendingItemId;
    delete page.dataset.ptvDetailsEnhancementGeneration;
    delete page.dataset.ptvDetailsHydratedItemId;
    delete page.dataset.ptvDetailsItemId;
    delete page.dataset.ptvDetailsPendingItemId;
    delete page.dataset.ptvDetailsReaderItemId;
    delete page.dataset.ptvDetailsRelatedArtworkItemId;
    delete page.dataset.ptvDetailsBackdropItemId;
}

function enhanceDetails(pageHint, item, owner = captureDetailsEnhancementGeneration()) {
    const page = pageHint instanceof Element && pageHint.matches(DETAIL_PAGE_SELECTOR) ?
        pageHint :
        document.querySelector(DETAIL_PAGE_SELECTOR);

    if (!page) return;

    preparePtvDetailsLayout(page);
    normalizeDetailButtons(page);
    repairDetailImages(page);
    if (item) enhanceDetailItem(page, item, owner);
    runIconEngine(page);
}

function renderReaderActions(page, item, source) {
    const buttons = page.querySelector('.mainDetailButtons');

    if (!buttons) return;

    let container = buttons.querySelector(`.${READER_ACTIONS_CLASS}`);

    if (!container) {
        container = document.createElement('div');
        container.className = READER_ACTIONS_CLASS;
        buttons.prepend(container);
    }

    const progress = loadReaderProgress(source.metadata.stableId);
    const resumeLabel = progress?.percent > 1 ? `Resume ${Math.round(progress.percent)}%` : 'Read Now';
    const format = (source.extension || source.format || 'book').toUpperCase();

    container.innerHTML = `
        <button type="button" class="ptv-reader-detail-button ptv-reader-detail-button--primary" data-ptv-reader-action="read">
            <span class="material-icons" aria-hidden="true">menu_book</span>
            <span>${resumeLabel}</span>
        </button>
        <button type="button" class="ptv-reader-detail-button" data-ptv-reader-action="download">
            <span class="material-icons" aria-hidden="true">download</span>
            <span>Download</span>
        </button>
        <button type="button" class="ptv-reader-detail-button" data-ptv-reader-action="external">
            <span class="material-icons" aria-hidden="true">open_in_new</span>
            <span>Open externally</span>
        </button>
        <span class="ptv-reader-detail-badge">${format}</span>
        <span class="ptv-reader-detail-source">${source.metadata.sourceLabel}</span>
    `;

    container.querySelector('[data-ptv-reader-action="read"]').addEventListener('click', () => {
        void playPtvReaderItem({
            items: [item],
            startPositionTicks: progress ? Math.round((progress.percent / 100) * 10000000) : 0
        }).catch(() => {
            console.warn('[PiggieTV Reader] Unable to open this item');
        });
    });

    container.querySelector('[data-ptv-reader-action="download"]').addEventListener('click', () => {
        import('../../../scripts/fileDownloader').then(({ download }) => {
            download([{
                filename: getFilename(item, source),
                item,
                itemId: item.Id,
                serverId: item.ServerId,
                title: item.Name,
                url: source.downloadUrl
            }]);
        });
    });

    container.querySelector('[data-ptv-reader-action="external"]').addEventListener('click', () => {
        window.open(source.externalUrl || source.downloadUrl, '_blank', 'noopener,noreferrer');
    });
}

function clearDetailsDiscovery(page) {
    page.querySelector(`.${DETAILS_DISCOVERY_CLASS}`)?.remove();
    delete page.dataset.ptvDetailsDiscoveryGeneration;
    delete page.dataset.ptvDetailsDiscoveryItemId;
    delete page.dataset.ptvDetailsDiscoveryPendingItemId;
}

function createDetailsDiscoverySection(links) {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    const description = document.createElement('p');
    const linkStrip = document.createElement('nav');
    const headingId = 'ptv-details-discovery-heading';

    section.className = `${DETAILS_DISCOVERY_CLASS} verticalSection detailVerticalSection ptv-details-glass`;
    section.setAttribute('aria-labelledby', headingId);
    heading.id = headingId;
    heading.className = 'sectionTitle sectionTitle-cards';
    heading.textContent = 'Discover more';
    description.className = 'ptv-details-discovery-description';
    description.textContent = 'Explore the people, places, and themes connected to this title.';
    linkStrip.className = 'ptv-details-discovery-links';
    linkStrip.setAttribute('aria-label', 'Related discovery searches');

    links.forEach((link, index) => {
        const anchor = document.createElement('a');
        const label = document.createElement('strong');
        const meta = document.createElement('span');

        anchor.className = `ptv-details-discovery-link ptv-details-discovery-link--${link.kind}`;
        anchor.dataset.ptvFocusKey = `details:discover:${index}`;
        anchor.href = link.href;
        anchor.setAttribute('aria-label', link.ariaLabel);
        label.textContent = link.label;
        meta.textContent = link.meta;
        anchor.append(label, meta);
        linkStrip.append(anchor);
    });

    section.append(heading, description, linkStrip);
    return section;
}

function renderDetailsDiscovery(page, itemId, item, owner) {
    const generation = String(owner.generation);

    if (
        page.dataset.ptvDetailsDiscoveryItemId === itemId
        && page.dataset.ptvDetailsDiscoveryGeneration === generation
    ) return;
    if (
        page.dataset.ptvDetailsDiscoveryPendingItemId === itemId
        && page.dataset.ptvDetailsDiscoveryGeneration === generation
    ) return;

    page.dataset.ptvDetailsDiscoveryGeneration = generation;
    page.dataset.ptvDetailsDiscoveryPendingItemId = itemId;

    void import('./detailsDiscoveryModel')
        .then(({ getPtvDetailsDiscoveryLinks }) => {
            if (!isCurrentDetailItem(page, itemId, owner)) return;

            const links = getPtvDetailsDiscoveryLinks(item);

            page.querySelector(`.${DETAILS_DISCOVERY_CLASS}`)?.remove();
            delete page.dataset.ptvDetailsDiscoveryPendingItemId;
            page.dataset.ptvDetailsDiscoveryGeneration = generation;
            page.dataset.ptvDetailsDiscoveryItemId = itemId;

            if (!links.length) return;

            const section = createDetailsDiscoverySection(links);
            const similarSection = page.querySelector('#similarCollapsible');
            const host = similarSection?.parentElement || page.querySelector('.detailPageContent');

            if (!host || !isCurrentDetailItem(page, itemId, owner)) return;

            if (similarSection?.parentElement === host) {
                host.insertBefore(section, similarSection);
            } else {
                host.append(section);
            }

            runIconEngine(section);
        })
        .catch(() => {
            if (!isCurrentDetailItem(page, itemId, owner)) return;

            delete page.dataset.ptvDetailsDiscoveryPendingItemId;
            page.dataset.ptvDetailsDiscoveryGeneration = generation;
            page.dataset.ptvDetailsDiscoveryItemId = itemId;
        });
}

function getRelatedArtworkIds(item) {
    if (item.Type !== 'Season' && item.Type !== 'Episode') return [];

    return [item.ParentId, item.SeasonId, item.SeriesId]
        .filter((id, index, values) => id && id !== item.Id && values.indexOf(id) === index);
}

function isCurrentDetailItem(page, itemId, owner) {
    if (!isDetailsEnhancementGenerationCurrent(owner)) return false;

    const params = getHashParams();
    const routeItemId = params.get('id') || params.get('itemId');

    return page.isConnected
        && page.dataset.ptvDetailsItemId === itemId
        && page.dataset.ptvDetailsEnhancementGeneration === String(owner.generation)
        && routeItemId === itemId;
}

function getBackdropCandidates(item, relatedItems) {
    const { heroBackdropMaxWidth } = getPtvPerformanceProfile();
    const baseOptions = {
        maxWidth: heroBackdropMaxWidth,
        quality: 90
    };
    const backdropOptions = {
        baseOptions,
        includeParentPrimary: false,
        includePrimary: false,
        includeSeriesPrimary: false,
        includeThumb: false,
        order: ['Backdrop']
    };

    return [
        ...getPtvItemImageCandidates(item, backdropOptions),
        ...relatedItems.flatMap(relatedItem => getPtvItemImageCandidates(relatedItem, backdropOptions)),
        ...getPtvItemImageCandidates(item, {
            baseOptions,
            includeBackdrop: false,
            includeParentPrimary: false,
            includeSeriesPrimary: false,
            order: ['Thumb', 'Primary']
        })
    ];
}

function prepareDetailItemState(page, itemId, owner) {
    const generation = String(owner.generation);

    if (
        page.dataset.ptvDetailsItemId === itemId
        && page.dataset.ptvDetailsEnhancementGeneration === generation
    ) return;

    page.dataset.ptvDetailsItemId = itemId;
    page.dataset.ptvDetailsEnhancementGeneration = generation;
    delete page.dataset.ptvDetailsHydratedItemId;
    delete page.dataset.ptvDetailsPendingItemId;
    delete page.dataset.ptvDetailsRelatedArtworkItemId;
    delete page.dataset.ptvDetailsReaderItemId;
    page.querySelector(`.${READER_ACTIONS_CLASS}`)?.remove();
    clearDetailsDiscovery(page);
    resetPtvDetailsBackdrop(page, itemId);
}

function applyDetailItem(page, itemId, item, apiClient, owner) {
    if (!isCurrentDetailItem(page, itemId, owner)) return;

    setPtvDetailsShellSection(getPtvDetailsShellSection(item));
    setPtvDetailsBackdropCandidates(page, getBackdropCandidates(item, []), itemId);

    const relatedArtworkIds = getRelatedArtworkIds(item);

    if (
        relatedArtworkIds.length
        && page.dataset.ptvDetailsRelatedArtworkItemId !== itemId
    ) {
        page.dataset.ptvDetailsRelatedArtworkItemId = itemId;
        void Promise.all(relatedArtworkIds.map(relatedId => (
            getCoordinatedLegacyItemDetail(apiClient, relatedId, {
                signal: owner.controller.signal
            }).catch(() => null)
        ))).then(relatedItems => {
            if (!isCurrentDetailItem(page, itemId, owner)) return;

            setPtvDetailsBackdropCandidates(
                page,
                getBackdropCandidates(item, relatedItems.filter(Boolean)),
                itemId
            );
        });
    }

    renderDetailsDiscovery(page, itemId, item, owner);

    if (!isPiggieTvReaderItem(item) || page.dataset.ptvDetailsReaderItemId === itemId) return;

    page.dataset.ptvDetailsReaderItemId = itemId;
    void resolveReaderSource(item)
        .then(source => {
            if (isCurrentDetailItem(page, itemId, owner)) {
                renderReaderActions(page, item, source);
            }
        })
        .catch(error => {
            if (isCurrentDetailItem(page, itemId, owner)) {
                delete page.dataset.ptvDetailsReaderItemId;
            }

            if (owner.controller.signal.aborted) return;
            console.warn('[PiggieTV Reader] Could not resolve detail source', error);
        });
}

function enhanceDetailItem(page, renderedItem, owner = captureDetailsEnhancementGeneration()) {
    const params = getHashParams();
    const id = params.get('id') || params.get('itemId');
    const serverId = params.get('serverId') || params.get('server');

    if (!id || !isDetailsEnhancementGenerationCurrent(owner)) return;

    const apiClient = getApiClient(serverId);

    if (!apiClient?.getItem || !apiClient?.getCurrentUserId) return;

    prepareDetailItemState(page, id, owner);

    if (String(renderedItem?.Id || '') === id) {
        page.dataset.ptvDetailsHydratedItemId = id;
        delete page.dataset.ptvDetailsPendingItemId;
        applyDetailItem(page, id, renderedItem, apiClient, owner);
        return;
    }

    if (
        page.dataset.ptvDetailsHydratedItemId === id
        || page.dataset.ptvDetailsPendingItemId === id
    ) return;

    page.dataset.ptvDetailsPendingItemId = id;

    getCoordinatedLegacyItemDetail(apiClient, id, {
        signal: owner.controller.signal
    })
        .then(item => {
            if (!isCurrentDetailItem(page, id, owner)) return;

            page.dataset.ptvDetailsHydratedItemId = id;
            delete page.dataset.ptvDetailsPendingItemId;
            applyDetailItem(page, id, item, apiClient, owner);
        })
        .catch(error => {
            if (isCurrentDetailItem(page, id, owner)) {
                delete page.dataset.ptvDetailsPendingItemId;
            }

            if (error?.name === 'AbortError' || owner.controller.signal.aborted) return;
            console.warn('[PiggieTV Details] Could not inspect detail item', error);
        });
}

function inspectCurrentDetailItem(owner = captureDetailsEnhancementGeneration()) {
    if (!isDetailsEnhancementGenerationCurrent(owner)) return;

    const page = document.querySelector(DETAIL_PAGE_SELECTOR);

    if (page) enhanceDetailItem(page, undefined, owner);
}

function isRenderedDetailEventCurrent(page, item) {
    const params = getHashParams();
    const routeItemId = params.get('id') || params.get('itemId');
    const routeServerId = params.get('serverId') || params.get('server');
    const itemId = String(item?.Id || '');
    const itemServerId = String(item?.ServerId || '');

    return page.matches(DETAIL_PAGE_SELECTOR)
        && page.isConnected
        && routeItemId === itemId
        && (!routeServerId || routeServerId === itemServerId);
}

function handleDetailsRendered(event) {
    const { item, page } = event.detail || {};

    if (
        !detailsEnhancementActive
        || !item
        || !(page instanceof Element)
        || !isRenderedDetailEventCurrent(page, item)
    ) return;

    const owner = beginDetailsEnhancementGeneration();

    enhanceDetails(page, item, owner);
}

function scheduleDetailInspection(scope, owner) {
    if (!scope?.timeout || !isDetailsEnhancementGenerationCurrent(owner)) return;

    releasePendingInspection = scope.timeout(() => {
        releasePendingInspection = null;
        inspectCurrentDetailItem(owner);
    }, 900);
}

function init({ scope } = {}) {
    detailsEnhancementActive = true;
    const owner = beginDetailsEnhancementGeneration();

    document.documentElement.classList.add('ptv-route-detail-page');
    scope?.add(mountPtvDetailsShell());
    enhanceDetails();
    scope?.add(on('detailsrendered', handleDetailsRendered));
    scope?.watchDom(() => enhanceDetails());
    scheduleDetailInspection(scope, owner);
}

function refresh({ scope } = {}) {
    if (!detailsEnhancementActive) return;

    const owner = beginDetailsEnhancementGeneration();

    enhanceDetails();
    scheduleDetailInspection(scope, owner);
}

function destroy() {
    detailsEnhancementActive = false;
    retireDetailsEnhancementGeneration();
    document.documentElement.classList.remove('ptv-route-detail-page');
    document.querySelectorAll(DETAIL_PAGE_SELECTOR).forEach(page => {
        resetDetailEnhancementState(page);
        releasePtvDetailsLayout(page);
    });
}

registerModule({
    density: 'comfortable',
    features: ['details', 'media-detail'],
    layout: 'media-detail',
    name: 'details',
    route: {
        density: 'comfortable',
        id: 'details',
        layout: 'media-detail',
        pageType: 'details',
        pattern: /#\/(?:details|item)(?:[/?]|$)/i,
        surface: 1
    },
    surface: 1,
    init,
    refresh,
    destroy
});
