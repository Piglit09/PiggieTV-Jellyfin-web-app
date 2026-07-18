const DETAILS_NATIVE_ROOT_CLASS = 'ptv-details-native-root';
const DETAILS_NATIVE_CONTENT_CLASS = 'ptv-details-native-content';
const DETAILS_NATIVE_PRIMARY_CLASS = 'ptv-details-native-primary';
const DETAILS_NATIVE_SECONDARY_CLASS = 'ptv-details-native-secondary';
const DETAILS_NATIVE_LOGO_CLASS = 'ptv-detail-native-logo';
const DETAILS_BACKDROP_CLASS = 'ptv-details-backdrop';
const DETAILS_BACKDROP_IMAGE_CLASS = 'ptv-details-backdrop__image';
const DETAILS_GLASS_CLASS = 'ptv-details-glass';
const DETAILS_GLASS_STRONG_CLASS = 'ptv-details-glass--strong';
const DETAILS_GLASS_ACTIONS_CLASS = 'ptv-details-glass-actions';

const originalLogoLocations = new WeakMap();
const backdropStates = new WeakMap();

const GLASS_SECTION_SELECTOR = [
    '.detailPagePrimaryContent > .detailSection',
    '.detailVerticalSection',
    '.verticalSection'
].join(', ');

function getCssBackgroundUrl(element) {
    if (!(element instanceof HTMLElement)) return '';

    const value = element.style.backgroundImage || element.dataset.src || '';
    const match = /url\(["']?(.+?)["']?\)/i.exec(value);

    return match?.[1] || '';
}

function getLegacyBackdropCandidate(page) {
    const localBackdrop = page.querySelector('.itemBackdrop');
    const localUrl = getCssBackgroundUrl(localBackdrop);

    if (localUrl) return { requestedType: 'Backdrop', url: localUrl };

    const globalBackdrop = document.querySelector('.backdropImage[data-url], .displayingBackdropImage[data-url]');
    const globalUrl = globalBackdrop?.getAttribute('data-url') || getCssBackgroundUrl(globalBackdrop);

    return globalUrl ? { requestedType: 'Backdrop', url: globalUrl } : null;
}

function ensureDetailsBackdrop(page) {
    let backdrop = page.querySelector(`:scope > .${DETAILS_BACKDROP_CLASS}`);

    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = `${DETAILS_BACKDROP_CLASS} ${DETAILS_BACKDROP_CLASS}--fallback`;
        backdrop.setAttribute('aria-hidden', 'true');

        const image = document.createElement('img');
        image.className = DETAILS_BACKDROP_IMAGE_CLASS;
        image.alt = '';
        image.decoding = 'async';
        image.fetchPriority = 'high';
        backdrop.append(image);
        page.prepend(backdrop);
    }

    return backdrop;
}

function setBackdropFallback(backdrop) {
    backdrop.classList.remove(`${DETAILS_BACKDROP_CLASS}--image`, `${DETAILS_BACKDROP_CLASS}--loading`);
    backdrop.classList.add(`${DETAILS_BACKDROP_CLASS}--fallback`);
    backdrop.dataset.ptvBackdropSource = 'fallback';
}

function loadBackdropCandidate(page, state, candidateIndex) {
    if (backdropStates.get(page) !== state || (state.itemId && page.dataset.ptvDetailsBackdropItemId !== state.itemId)) return;

    const candidate = state.candidates[candidateIndex];

    if (!candidate?.url) {
        state.image.removeAttribute('src');
        setBackdropFallback(state.backdrop);
        return;
    }

    state.index = candidateIndex;
    state.backdrop.classList.remove(`${DETAILS_BACKDROP_CLASS}--fallback`, `${DETAILS_BACKDROP_CLASS}--image`);
    state.backdrop.classList.add(`${DETAILS_BACKDROP_CLASS}--loading`);
    state.backdrop.dataset.ptvBackdropSource = candidate.requestedType || 'image';
    state.image.src = candidate.url;
}

export function resetPtvDetailsBackdrop(page, itemId = '') {
    if (!(page instanceof HTMLElement)) return false;

    const currentState = backdropStates.get(page);
    currentState?.image.removeEventListener('load', currentState.handleLoad);
    currentState?.image.removeEventListener('error', currentState.handleError);
    backdropStates.delete(page);

    const backdrop = ensureDetailsBackdrop(page);
    const image = backdrop.querySelector(`.${DETAILS_BACKDROP_IMAGE_CLASS}`);
    image.removeAttribute('src');
    page.dataset.ptvDetailsBackdropItemId = itemId;
    setBackdropFallback(backdrop);

    return true;
}

export function setPtvDetailsBackdropCandidates(page, candidates = [], itemId = page?.dataset?.ptvDetailsBackdropItemId || '') {
    if (!(page instanceof HTMLElement)) return false;

    page.dataset.ptvDetailsBackdropItemId = itemId;
    const backdrop = ensureDetailsBackdrop(page);
    const image = backdrop.querySelector(`.${DETAILS_BACKDROP_IMAGE_CLASS}`);
    const normalizedCandidates = candidates
        .filter(candidate => candidate?.url)
        .filter((candidate, index, values) => values.findIndex(value => value.url === candidate.url) === index);
    const candidateSignature = normalizedCandidates
        .map(candidate => `${candidate.requestedType || 'image'}:${candidate.url}`)
        .join('|');
    const signature = `${itemId}|${candidateSignature}`;
    const currentState = backdropStates.get(page);

    if (currentState?.signature === signature) return true;

    currentState?.image.removeEventListener('load', currentState.handleLoad);
    currentState?.image.removeEventListener('error', currentState.handleError);

    const state = {
        backdrop,
        candidates: normalizedCandidates,
        handleError: null,
        handleLoad: null,
        image,
        itemId,
        index: 0,
        signature
    };

    state.handleLoad = () => {
        if (backdropStates.get(page) !== state || (state.itemId && page.dataset.ptvDetailsBackdropItemId !== state.itemId)) return;

        backdrop.classList.remove(`${DETAILS_BACKDROP_CLASS}--fallback`, `${DETAILS_BACKDROP_CLASS}--loading`);
        backdrop.classList.add(`${DETAILS_BACKDROP_CLASS}--image`);
    };
    state.handleError = () => loadBackdropCandidate(page, state, state.index + 1);
    image.addEventListener('load', state.handleLoad);
    image.addEventListener('error', state.handleError);
    backdropStates.set(page, state);

    if (normalizedCandidates.length) {
        loadBackdropCandidate(page, state, 0);
    } else {
        image.removeAttribute('src');
        setBackdropFallback(backdrop);
    }

    return true;
}

function applyGlassClasses(page) {
    page.querySelector('.detailRibbon')?.classList.add(DETAILS_GLASS_CLASS, DETAILS_GLASS_STRONG_CLASS);
    page.querySelector('.mainDetailButtons')?.classList.add(DETAILS_GLASS_ACTIONS_CLASS);
    page.querySelectorAll('.detailImageContainer').forEach(element => {
        element.classList.add('ptv-details-glass-poster');
    });
    page.querySelectorAll(GLASS_SECTION_SELECTOR).forEach(element => {
        element.classList.add(DETAILS_GLASS_CLASS);
    });
}

function moveDetailLogo(page) {
    const logo = page.querySelector('.detailLogo');
    const info = page.querySelector('.detailRibbon .infoWrapper');

    if (!logo || !info) return;

    if (!originalLogoLocations.has(logo)) {
        originalLogoLocations.set(logo, {
            nextSibling: logo.nextSibling,
            parent: logo.parentNode
        });
    }

    logo.classList.add(DETAILS_NATIVE_LOGO_CLASS);

    if (logo.parentNode !== info) info.prepend(logo);
}

function restoreDetailLogo(logo) {
    const location = originalLogoLocations.get(logo);

    logo.classList.remove(DETAILS_NATIVE_LOGO_CLASS);
    if (!location?.parent?.isConnected) return;

    if (location.nextSibling?.parentNode === location.parent) {
        location.parent.insertBefore(logo, location.nextSibling);
    } else {
        location.parent.append(logo);
    }

    originalLogoLocations.delete(logo);
}

export function preparePtvDetailsLayout(page) {
    if (!(page instanceof HTMLElement)) return false;

    page.classList.add('ptv-detail-page', DETAILS_NATIVE_ROOT_CLASS);
    page.querySelector('.detailPageWrapperContainer')?.classList.add(DETAILS_NATIVE_CONTENT_CLASS);
    page.querySelector('.detailPagePrimaryContainer')?.classList.add(DETAILS_NATIVE_PRIMARY_CLASS);
    page.querySelector('.detailPageSecondaryContainer')?.classList.add(DETAILS_NATIVE_SECONDARY_CLASS);
    ensureDetailsBackdrop(page);
    applyGlassClasses(page);
    moveDetailLogo(page);

    const legacyCandidate = getLegacyBackdropCandidate(page);

    if (legacyCandidate && !backdropStates.has(page)) {
        setPtvDetailsBackdropCandidates(page, [legacyCandidate]);
    }

    return true;
}

export function releasePtvDetailsLayout(page) {
    if (!(page instanceof HTMLElement)) return;

    page.querySelectorAll(`.${DETAILS_NATIVE_LOGO_CLASS}`).forEach(restoreDetailLogo);
    const backdropState = backdropStates.get(page);

    backdropState?.image.removeEventListener('load', backdropState.handleLoad);
    backdropState?.image.removeEventListener('error', backdropState.handleError);
    backdropStates.delete(page);
    page.querySelector(`:scope > .${DETAILS_BACKDROP_CLASS}`)?.remove();
    page.querySelectorAll(`.${DETAILS_GLASS_CLASS}`).forEach(element => {
        element.classList.remove(DETAILS_GLASS_CLASS, DETAILS_GLASS_STRONG_CLASS);
    });
    page.querySelectorAll(`.${DETAILS_GLASS_ACTIONS_CLASS}`).forEach(element => {
        element.classList.remove(DETAILS_GLASS_ACTIONS_CLASS);
    });
    page.querySelectorAll('.ptv-details-glass-poster').forEach(element => {
        element.classList.remove('ptv-details-glass-poster');
    });
    page.classList.remove('ptv-detail-page', DETAILS_NATIVE_ROOT_CLASS);
    page.querySelector('.detailPageWrapperContainer')?.classList.remove(DETAILS_NATIVE_CONTENT_CLASS);
    page.querySelector('.detailPagePrimaryContainer')?.classList.remove(DETAILS_NATIVE_PRIMARY_CLASS);
    page.querySelector('.detailPageSecondaryContainer')?.classList.remove(DETAILS_NATIVE_SECONDARY_CLASS);
}
