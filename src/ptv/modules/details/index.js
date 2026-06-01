import { registerModule } from '../../core/lifecycle';
import { runIconEngine } from '../../utils/icons';
import { playbackManager } from '../../../components/playback/playbackmanager';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { isPiggieTvReaderItem, resolveReaderSource } from '../reader/sourceResolver';
import { loadReaderProgress } from '../reader/readerProgressStore';

import './details.scss';

const DETAIL_PAGE_SELECTOR = '#itemDetailPage, .itemDetailPage';
const READER_ACTIONS_CLASS = 'ptv-reader-detail-actions';

function getHashParams() {
    const hash = window.location.hash || '';
    const queryIndex = hash.indexOf('?');

    if (queryIndex === -1) return new URLSearchParams();

    return new URLSearchParams(hash.slice(queryIndex + 1));
}

function getApiClient(serverId) {
    if (serverId) return ServerConnections.getApiClient(serverId);

    return window.ApiClient;
}

function getFilename(item, source) {
    const extension = source.extension || source.metadata.fileExtension || 'book';
    return `${source.metadata.title || item.Name || 'book'}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') + `.${extension}`;
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

function enhanceDetails() {
    const page = document.querySelector(DETAIL_PAGE_SELECTOR);

    if (!page) return;

    page.classList.add('ptv-detail-page');
    normalizeDetailButtons(page);
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
