import { registerModule } from '../../core/lifecycle';
import { runIconEngine } from '../../utils/icons';
import { playbackManager } from '../../../components/playback/playbackmanager';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { isPiggieTvReaderItem, resolveReaderSource } from '../reader/sourceResolver';
import { loadReaderProgress } from '../reader/readerProgressStore';
import { recordPtvEvent, shouldCollectDiagnostics } from '../../core/observability';

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
        image.addEventListener('error', handleDetailImageError);
    });
}

function enhanceDetails() {
    const page = document.querySelector(DETAIL_PAGE_SELECTOR);

    if (!page) return;

    page.classList.add('ptv-detail-page');
    normalizeDetailButtons(page);
    repairDetailImages(page);
    enhanceReaderActions(page);
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

function enhanceReaderActions(page) {
    const params = getHashParams();
    const id = params.get('id') || params.get('itemId');
    const serverId = params.get('serverId') || params.get('server');

    if (!id || page.dataset.ptvReaderActionsItemId === id) return;

    page.dataset.ptvReaderActionsItemId = id;

    const apiClient = getApiClient(serverId);

    if (!apiClient?.getItem || !apiClient?.getCurrentUserId) return;

    apiClient.getItem(apiClient.getCurrentUserId(), id)
        .then(item => {
            if (!isPiggieTvReaderItem(item)) {
                page.querySelector(`.${READER_ACTIONS_CLASS}`)?.remove();
                return;
            }

            return resolveReaderSource(item).then(source => renderReaderActions(page, item, source));
        })
        .catch(error => {
            console.warn('[PiggieTV Reader] Could not inspect detail item', error);
        });
}

function init({ scope } = {}) {
    document.documentElement.classList.add('ptv-route-detail-page');
    enhanceDetails();
    scope?.watchDom(enhanceDetails);
}

function refresh() {
    enhanceDetails();
}

function destroy() {
    document.documentElement.classList.remove('ptv-route-detail-page');
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
        pattern: /#\/(?:details|item)/i,
        surface: 1
    },
    surface: 1,
    init,
    refresh,
    destroy
});
