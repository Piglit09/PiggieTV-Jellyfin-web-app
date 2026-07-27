import { on } from '../../core/events';
import { registerModule } from '../../core/lifecycle';
import { runIconEngine } from '../../utils/icons';
import { playbackManager } from '../../../components/playback/playbackmanager';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { isPiggieTvReaderItem, resolveReaderSource } from '../reader/sourceResolver';
import { loadReaderProgress } from '../reader/readerProgressStore';
import { recordPtvEvent, shouldCollectDiagnostics } from '../../core/observability';
import { getPtvItemImageCandidates } from '../../api';
import { getPtvPerformanceProfile } from '../../core/clientProfile';
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

import './details.scss';

const DETAIL_PAGE_SELECTOR = '#itemDetailPage, .itemDetailPage';
const READER_ACTIONS_CLASS = 'ptv-reader-detail-actions';
const repairedDetailImageUrls = new Set();

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

    if (!target || repairedDetailImageUrls.has(target.nextUrl)) return;

    repairedDetailImageUrls.add(target.nextUrl);
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

function repairDetailImages(page) {
    page.querySelectorAll('img').forEach(image => {
        if (image.dataset.ptvImageRepairInstalled === 'true') return;

        image.dataset.ptvImageRepairInstalled = 'true';
        image.classList.add('ptv-detail-artwork-image');
        image.closest('.detailImageContainer')?.classList.add('ptv-detail-artwork-pending');
        image.addEventListener('load', () => {
            image.classList.add('ptv-detail-artwork-ready');
            image.closest('.detailImageContainer')?.classList.remove('ptv-detail-artwork-pending');
        });
        image.addEventListener('error', handleDetailImageError);

        if (image.complete && image.naturalWidth > 0) {
            image.classList.add('ptv-detail-artwork-ready');
            image.closest('.detailImageContainer')?.classList.remove('ptv-detail-artwork-pending');
        }
    });
}

function enhanceDetails(pageHint, item) {
    const page = pageHint instanceof Element && pageHint.matches(DETAIL_PAGE_SELECTOR) ?
        pageHint :
        document.querySelector(DETAIL_PAGE_SELECTOR);

    if (!page) return;

    preparePtvDetailsLayout(page);
    normalizeDetailButtons(page);
    repairDetailImages(page);
    if (item) enhanceDetailItem(page, item);
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
        playbackManager.play({
            items: [item],
            startPositionTicks: progress ? Math.round((progress.percent / 100) * 10000000) : 0
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

function getRelatedArtworkIds(item) {
    if (item.Type !== 'Season' && item.Type !== 'Episode') return [];

    return [item.ParentId, item.SeasonId, item.SeriesId]
        .filter((id, index, values) => id && id !== item.Id && values.indexOf(id) === index);
}

function isCurrentDetailItem(page, itemId) {
    const params = getHashParams();
    const routeItemId = params.get('id') || params.get('itemId');

    return page.isConnected
        && page.dataset.ptvDetailsItemId === itemId
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

function prepareDetailItemState(page, itemId) {
    if (page.dataset.ptvDetailsItemId === itemId) return;

    page.dataset.ptvDetailsItemId = itemId;
    delete page.dataset.ptvDetailsHydratedItemId;
    delete page.dataset.ptvDetailsPendingItemId;
    delete page.dataset.ptvDetailsRelatedArtworkItemId;
    delete page.dataset.ptvDetailsReaderItemId;
    page.querySelector(`.${READER_ACTIONS_CLASS}`)?.remove();
    resetPtvDetailsBackdrop(page, itemId);
}

function applyDetailItem(page, itemId, item, apiClient) {
    if (!isCurrentDetailItem(page, itemId)) return;

    setPtvDetailsShellSection(getPtvDetailsShellSection(item));
    setPtvDetailsBackdropCandidates(page, getBackdropCandidates(item, []), itemId);

    const relatedArtworkIds = getRelatedArtworkIds(item);

    if (
        relatedArtworkIds.length
        && page.dataset.ptvDetailsRelatedArtworkItemId !== itemId
    ) {
        page.dataset.ptvDetailsRelatedArtworkItemId = itemId;
        void Promise.all(relatedArtworkIds.map(relatedId => (
            apiClient.getItem(apiClient.getCurrentUserId(), relatedId).catch(() => null)
        ))).then(relatedItems => {
            if (!isCurrentDetailItem(page, itemId)) return;

            setPtvDetailsBackdropCandidates(
                page,
                getBackdropCandidates(item, relatedItems.filter(Boolean)),
                itemId
            );
        });
    }

    if (!isPiggieTvReaderItem(item) || page.dataset.ptvDetailsReaderItemId === itemId) return;

    page.dataset.ptvDetailsReaderItemId = itemId;
    void resolveReaderSource(item)
        .then(source => {
            if (isCurrentDetailItem(page, itemId)) {
                renderReaderActions(page, item, source);
            }
        })
        .catch(error => {
            if (isCurrentDetailItem(page, itemId)) {
                delete page.dataset.ptvDetailsReaderItemId;
            }

            console.warn('[PiggieTV Reader] Could not resolve detail source', error);
        });
}

function enhanceDetailItem(page, renderedItem) {
    const params = getHashParams();
    const id = params.get('id') || params.get('itemId');
    const serverId = params.get('serverId') || params.get('server');

    if (!id) return;

    const apiClient = getApiClient(serverId);

    if (!apiClient?.getItem || !apiClient?.getCurrentUserId) return;

    prepareDetailItemState(page, id);

    if (String(renderedItem?.Id || '') === id) {
        page.dataset.ptvDetailsHydratedItemId = id;
        delete page.dataset.ptvDetailsPendingItemId;
        applyDetailItem(page, id, renderedItem, apiClient);
        return;
    }

    if (
        page.dataset.ptvDetailsHydratedItemId === id
        || page.dataset.ptvDetailsPendingItemId === id
    ) return;

    page.dataset.ptvDetailsPendingItemId = id;

    getCoordinatedLegacyItemDetail(apiClient, id)
        .then(item => {
            if (!isCurrentDetailItem(page, id)) return;

            page.dataset.ptvDetailsHydratedItemId = id;
            delete page.dataset.ptvDetailsPendingItemId;
            applyDetailItem(page, id, item, apiClient);
        })
        .catch(error => {
            if (isCurrentDetailItem(page, id)) {
                delete page.dataset.ptvDetailsPendingItemId;
            }

            console.warn('[PiggieTV Details] Could not inspect detail item', error);
        });
}

function inspectCurrentDetailItem() {
    const page = document.querySelector(DETAIL_PAGE_SELECTOR);

    if (page) enhanceDetailItem(page);
}

function handleDetailsRendered(event) {
    const { item, page } = event.detail || {};

    if (!item || !(page instanceof Element)) return;
    enhanceDetails(page, item);
}

function init({ scope } = {}) {
    document.documentElement.classList.add('ptv-route-detail-page');
    scope?.add(mountPtvDetailsShell());
    enhanceDetails();
    scope?.add(on('detailsrendered', handleDetailsRendered));
    scope?.watchDom(() => enhanceDetails());
    scope?.timeout(inspectCurrentDetailItem, 900);
}

function refresh({ scope } = {}) {
    enhanceDetails();
    scope?.timeout(inspectCurrentDetailItem, 900);
}

function destroy() {
    document.documentElement.classList.remove('ptv-route-detail-page');
    document.querySelectorAll(DETAIL_PAGE_SELECTOR).forEach(page => {
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
