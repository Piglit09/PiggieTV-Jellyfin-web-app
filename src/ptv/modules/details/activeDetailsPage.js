export const DETAIL_PAGE_SELECTOR = '#itemDetailPage, .itemDetailPage';

function isVisibleDetailsPage(page) {
    return !page.hidden
        && !page.classList.contains('hide')
        && page.getAttribute('aria-hidden') !== 'true';
}

export function getActiveDetailsPage(root = document) {
    const pages = root.querySelectorAll(DETAIL_PAGE_SELECTOR);

    for (let index = pages.length - 1; index >= 0; index -= 1) {
        if (isVisibleDetailsPage(pages[index])) {
            return pages[index];
        }
    }

    return null;
}
