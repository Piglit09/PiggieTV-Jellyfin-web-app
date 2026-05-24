import { registerModule } from '../../core/lifecycle';
import { runIconEngine } from '../../utils/icons';

import './details.scss';

const DETAIL_PAGE_SELECTOR = '#itemDetailPage, .itemDetailPage';

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
    runIconEngine(page);
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
