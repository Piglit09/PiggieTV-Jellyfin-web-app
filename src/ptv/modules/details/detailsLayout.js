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
const DETAILS_EPISODE_CLASS = 'ptv-details--episode';
const DETAILS_HERO_ARTWORK_CLASS = 'ptv-details-hero-artwork__image';
const DETAILS_EPISODE_IDENTITY_CLASS = 'ptv-episode-identity';
const DETAILS_EPISODE_METADATA_CLASS = 'ptv-episode-metadata';

const originalLogoLocations = new WeakMap();
const backdropStates = new WeakMap();
const heroArtworkStates = new WeakMap();
const episodePresentationStates = new WeakMap();

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

function rememberElementLocation(element) {
    if (!element?.parentNode) return null;

    return {
        element,
        nextSibling: element.nextSibling,
        parent: element.parentNode
    };
}

function restoreElementLocation(location) {
    if (!location?.parent?.isConnected || !location.element) return;

    if (location.nextSibling?.parentNode === location.parent) {
        location.parent.insertBefore(location.element, location.nextSibling);
    } else {
        location.parent.append(location.element);
    }
}

function releaseHeroArtworkState(page) {
    const state = heroArtworkStates.get(page);

    state?.images.forEach(({ handleError, handleLoad, image }) => {
        image.removeEventListener('error', handleError);
        image.removeEventListener('load', handleLoad);
        image.remove();
    });
    state?.containers.forEach(container => {
        container.classList.remove('ptv-details-hero-artwork--ready');
        delete container.dataset.ptvHeroArtworkSource;
        delete container.dataset.ptvHeroArtworkShape;
    });
    heroArtworkStates.delete(page);
    delete page.dataset.ptvDetailsHeroArtworkItemId;
}

function loadHeroArtworkCandidate(state, imageState, candidateIndex) {
    if (
        heroArtworkStates.get(state.page) !== state
        || (state.itemId && state.page.dataset.ptvDetailsHeroArtworkItemId !== state.itemId)
    ) return;

    const candidate = state.candidates[candidateIndex];

    if (!candidate?.url) {
        imageState.image.removeAttribute('src');
        imageState.container.classList.remove('ptv-details-hero-artwork--ready');
        return;
    }

    imageState.index = candidateIndex;
    imageState.container.classList.remove('ptv-details-hero-artwork--ready');
    imageState.container.dataset.ptvHeroArtworkSource = candidate.requestedType || candidate.imageType || 'image';
    imageState.container.dataset.ptvHeroArtworkShape = ['SeriesPrimary', 'ParentPrimary', 'Primary']
        .includes(candidate.requestedType) ? 'portrait' : 'landscape';
    imageState.image.src = candidate.url;
}

export function resetPtvDetailsHeroArtwork(page) {
    if (!(page instanceof HTMLElement)) return false;

    releaseHeroArtworkState(page);
    return true;
}

export function setPtvDetailsHeroArtworkCandidates(page, candidates = [], itemId = '') {
    if (!(page instanceof HTMLElement)) return false;

    const normalizedCandidates = candidates
        .filter(candidate => candidate?.url)
        .filter((candidate, index, values) => values.findIndex(value => value.url === candidate.url) === index);
    const containers = Array.from(page.querySelectorAll('.detailImageContainer'));
    const signature = normalizedCandidates
        .map(candidate => `${candidate.requestedType || candidate.imageType || 'image'}:${candidate.url}`)
        .join('|');
    const currentState = heroArtworkStates.get(page);

    if (currentState?.signature === `${itemId}|${signature}`) return true;

    releaseHeroArtworkState(page);
    page.dataset.ptvDetailsHeroArtworkItemId = itemId;
    if (!normalizedCandidates.length || !containers.length) return true;

    const state = {
        candidates: normalizedCandidates,
        containers,
        images: [],
        itemId,
        page,
        signature: `${itemId}|${signature}`
    };

    containers.forEach(container => {
        const image = document.createElement('img');
        const imageState = {
            container,
            handleError: null,
            handleLoad: null,
            image,
            index: 0
        };

        image.alt = '';
        image.className = DETAILS_HERO_ARTWORK_CLASS;
        image.decoding = 'async';
        image.fetchPriority = container.classList.contains('hide-mobile') ? 'high' : 'auto';
        imageState.handleLoad = () => {
            if (heroArtworkStates.get(page) !== state) return;

            container.classList.add('ptv-details-hero-artwork--ready');
        };
        imageState.handleError = () => loadHeroArtworkCandidate(state, imageState, imageState.index + 1);
        image.addEventListener('load', imageState.handleLoad);
        image.addEventListener('error', imageState.handleError);
        container.prepend(image);
        state.images.push(imageState);
    });
    heroArtworkStates.set(page, state);
    state.images.forEach(imageState => {
        loadHeroArtworkCandidate(state, imageState, 0);
    });

    return true;
}

function getEpisodeContext(item) {
    const season = Number(item?.ParentIndexNumber);
    const episode = Number(item?.IndexNumber);
    const parts = [];

    if (Number.isFinite(season)) parts.push(`S${season}`);
    if (Number.isFinite(episode)) parts.push(`E${episode}`);

    const indexLabel = parts.length ? `${parts.join(' ')} • ` : '';

    return `${indexLabel}EPISODE`;
}

function getEpisodeYear(item) {
    if (item?.ProductionYear) return String(item.ProductionYear);
    if (!item?.PremiereDate) return '';

    const year = new Date(item.PremiereDate).getFullYear();

    return Number.isFinite(year) ? String(year) : '';
}

function getEpisodeRuntime(runTimeTicks) {
    const totalMinutes = Math.max(0, Math.round(Number(runTimeTicks || 0) / 600000000));

    if (!totalMinutes) return '';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (!hours) return `${minutes}m`;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function createEpisodeIdentity(item, nameContainer) {
    const identity = document.createElement('div');
    const context = document.createElement('span');
    const title = document.createElement('h1');

    identity.className = DETAILS_EPISODE_IDENTITY_CLASS;
    context.className = 'ptv-episode-context';
    context.textContent = getEpisodeContext(item);
    title.className = 'ptv-episode-title';
    title.textContent = String(item?.Name || 'Episode');
    identity.append(context, title);
    nameContainer.append(identity);

    return identity;
}

function createEpisodeMetadata(item) {
    const values = [
        getEpisodeYear(item),
        getEpisodeRuntime(item?.RunTimeTicks),
        String(item?.OfficialRating || ''),
        Number(item?.CommunityRating) > 0 ? `★ ${Number(item.CommunityRating).toFixed(1)}` : ''
    ].filter(Boolean);
    const metadata = document.createElement('div');

    metadata.className = DETAILS_EPISODE_METADATA_CLASS;
    metadata.setAttribute('aria-label', values.join(', '));
    values.forEach(value => {
        const entry = document.createElement('span');

        entry.textContent = value;
        metadata.append(entry);
    });

    return metadata;
}

function addEpisodeActionLabel(button, label) {
    if (!(button instanceof HTMLElement)) return;

    button.setAttribute('aria-label', label);
    let labelElement = button.querySelector('.ptv-detail-action-label');

    if (!labelElement) {
        labelElement = document.createElement('span');
        labelElement.className = 'ptv-detail-action-label';
        button.append(labelElement);
    }
    labelElement.textContent = label;
}

export function resetPtvEpisodeDetailsPresentation(page) {
    if (!(page instanceof HTMLElement)) return false;

    const state = episodePresentationStates.get(page);

    state?.identity?.remove();
    state?.metadata?.remove();
    state?.nativeNames?.forEach(element => {
        element.classList.remove('ptv-episode-native-name');
    });
    state?.actionLabels?.forEach(element => {
        element.remove();
    });
    restoreElementLocation(state?.actionsLocation);
    restoreElementLocation(state?.similarLocation);
    if (state?.genres) {
        state.genres.textContent = state.originalGenresText;
        state.genres.classList.remove('ptv-episode-genres');
        state.genres.classList.toggle('hide', state.originalGenresHidden);
    }
    page.classList.remove(DETAILS_EPISODE_CLASS);
    episodePresentationStates.delete(page);

    return true;
}

export function applyPtvEpisodeDetailsPresentation(page, item) {
    if (!(page instanceof HTMLElement)) return false;
    if (item?.Type !== 'Episode') {
        resetPtvEpisodeDetailsPresentation(page);
        return false;
    }

    const itemId = String(item.Id || '');
    const existingState = episodePresentationStates.get(page);

    if (existingState?.itemId === itemId && existingState.identity?.isConnected) return true;

    resetPtvEpisodeDetailsPresentation(page);
    const nameContainer = page.querySelector('.detailNameContainer, .nameContainer');
    const infoWrapper = page.querySelector('.detailRibbon .infoWrapper');
    const actions = page.querySelector('.mainDetailButtons');
    const actionTarget = page.querySelector('.detailSectionContent');
    const similar = page.querySelector('#similarCollapsible');
    const secondaryContent = page.querySelector('.detailPageSecondaryContainer .detailPageContent');
    const genres = page.querySelector('.itemGenres');

    if (!nameContainer || !infoWrapper) return false;

    page.classList.add(DETAILS_EPISODE_CLASS);
    const nativeNames = Array.from(nameContainer.querySelectorAll('.itemName'));

    nativeNames.forEach(element => {
        element.classList.add('ptv-episode-native-name');
    });
    const identity = createEpisodeIdentity(item, nameContainer);
    const metadata = createEpisodeMetadata(item);

    nameContainer.after(metadata);
    const actionsLocation = rememberElementLocation(actions);
    const similarLocation = rememberElementLocation(similar);

    if (actions && actionTarget) actionTarget.append(actions);
    if (similar && secondaryContent) secondaryContent.prepend(similar);

    const resumable = Number(item?.UserData?.PlaybackPositionTicks) > 0;

    addEpisodeActionLabel(actions?.querySelector('.btnPlay'), resumable ? 'Resume' : 'Play');
    addEpisodeActionLabel(actions?.querySelector('.btnReplay'), 'Restart');
    const originalGenresHidden = genres?.classList.contains('hide') || false;
    const originalGenresText = genres?.textContent || '';
    let episodeGenres = [];

    if (Array.isArray(item.Genres)) {
        episodeGenres = item.Genres;
    } else if (Array.isArray(item.GenreItems)) {
        episodeGenres = item.GenreItems.map(genre => genre?.Name);
    }

    if (genres) {
        genres.textContent = episodeGenres.filter(Boolean).join(' / ');
        genres.classList.toggle('hide', !genres.textContent);
        genres.classList.add('ptv-episode-genres');
    }

    episodePresentationStates.set(page, {
        actionLabels: Array.from(actions?.querySelectorAll('.ptv-detail-action-label') || []),
        actionsLocation,
        genres,
        identity,
        itemId,
        metadata,
        nativeNames,
        originalGenresHidden,
        originalGenresText,
        similarLocation
    });

    return true;
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

    resetPtvEpisodeDetailsPresentation(page);
    releaseHeroArtworkState(page);
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
