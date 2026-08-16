import imageLoader from '../../../components/images/imageLoader';
import { getPtvItemImageCandidates, type PtvItemImageCandidate } from '../../api';
import { recordPtvItemRouteClick, resolvePtvItemRoute } from '../../core/itemRoutes';
import { focusPtvTvElement } from '../../core/tvFocus';
import { getPtvRecommendationHomeData } from '../recommendations/engine/recommendationEngine';
import type {
    PtvRecommendationHomeData,
    PtvRecommendationItem,
    PtvRecommendationMediaType,
    PtvRecommendationScore
} from '../recommendations/types/recommendationTypes';
import {
    buildPtvCinematicDetailsModel,
    getPtvCinematicMediaFamily,
    type PtvCinematicCard,
    type PtvCinematicDetailsItem,
    type PtvCinematicDetailsModel,
    type PtvCinematicGateway,
    type PtvCinematicMediaFamily,
    type PtvCinematicShelf
} from './detailsCinematicModel';
import { getPtvAuthoritativeRelationships } from './detailsAuthoritativeRelationships';
import {
    getPtvDetailsDiscoveryLinks,
    type PtvDetailsDiscoveryItem
} from './detailsDiscoveryModel';
import {
    rankPtvRelatedVideoItems,
    type PtvRelatedVideoItem
} from './detailsRelatedRecommendations';
import { loadPtvDetailRelatedItems } from './detailsRelatedSource';

type PtvCinematicLoadOptions = Readonly<{
    signal?: AbortSignal;
}>;

type PtvCinematicRenderOptions = Readonly<{
    progressive?: boolean;
    signal?: AbortSignal;
    sourceSettled?: boolean;
}>;

const CINEMATIC_HEADING_ID = 'ptv-cinematic-details-heading';
const CINEMATIC_ENRICHMENT_TIMEOUT_MS = 8000;

function getRelatedMediaType(item: PtvRelatedVideoItem): PtvRecommendationMediaType {
    const type = String(item.Type || '').toLocaleLowerCase();

    if (type === 'audio' || type === 'musicalbum' || type === 'musicartist') return 'music';
    if (type === 'book' || type === 'audiobook' || type === 'comic' || type === 'manga') return 'book';
    if (type === 'series' || type === 'season' || type === 'episode') return 'show';

    return 'movie';
}

function mergeRelatedRecommendationData(
    data: PtvRecommendationHomeData,
    items: readonly PtvRelatedVideoItem[]
): PtvRecommendationHomeData {
    const relatedScores: PtvRecommendationScore[] = items.map((item, index) => ({
        affinityScore: Math.max(1, 1000 - index),
        discoveryWeight: 0,
        item: item as PtvRecommendationItem,
        mediaType: getRelatedMediaType(item),
        reasons: [{
            category: 'studios',
            label: 'Related library metadata',
            score: Math.max(1, 1000 - index)
        }],
        score: Math.max(1, 1000 - index),
        source: 'details-related-library'
    }));

    return {
        ...data,
        candidates: [ ...relatedScores, ...data.candidates ]
    };
}

function createElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    className: string,
    text = ''
) {
    const element = document.createElement(tagName);

    element.className = className;
    if (text) element.textContent = text;

    return element;
}

function getImageBlurHash(item: Record<string, unknown>, candidate: PtvItemImageCandidate) {
    const blurHashes = item.ImageBlurHashes;

    if (!blurHashes || typeof blurHashes !== 'object') return '';

    const imageTypeKey = Object.keys(blurHashes).find(key => key.toLowerCase() === candidate.imageType.toLowerCase());
    const hashesForType = imageTypeKey ? (blurHashes as Record<string, unknown>)[imageTypeKey] : null;

    if (!hashesForType || typeof hashesForType !== 'object') return '';

    const values = hashesForType as Record<string, unknown>;
    const exactHash = candidate.tag ? values[candidate.tag] : '';

    if (typeof exactHash === 'string') return exactHash;

    return Object.values(values).find(value => typeof value === 'string') as string || '';
}

function getArtworkCandidate(card: PtvCinematicCard, family: PtvCinematicMediaFamily) {
    const entity = card.kind === 'entity';
    const landscape = !entity && (family === 'series' || family === 'video');
    let order: ('Backdrop' | 'Primary' | 'Thumb')[];

    if (entity) {
        order = ['Primary', 'Thumb', 'Backdrop'];
    } else if (landscape) {
        order = ['Thumb', 'Backdrop', 'Primary'];
    } else {
        order = ['Primary', 'Thumb', 'Backdrop'];
    }

    return getPtvItemImageCandidates(card.item, {
        baseOptions: {
            maxHeight: landscape ? 360 : 520,
            maxWidth: landscape ? 640 : 420,
            quality: 86
        },
        includeUntagged: true,
        order
    })[0] || null;
}

function createReasonChips(card: PtvCinematicCard) {
    const container = createElement('span', 'ptv-cinematic-card__reasons');

    (card.reasonChips || [card.reason]).slice(0, 3).forEach(reason => {
        container.append(createElement('span', 'ptv-cinematic-card__reason', reason));
    });

    return container;
}

function createCard(card: PtvCinematicCard, shelf: PtvCinematicShelf, family: PtvCinematicMediaFamily) {
    const targetFamily = getPtvCinematicMediaFamily(card.item);
    let mediaType: string | undefined;

    if (targetFamily === 'music') mediaType = 'music';
    if (targetFamily === 'reading') mediaType = 'book';

    const route = card.href ? null : resolvePtvItemRoute(card.item, {
        mediaType,
        privacySafeDiagnostics: true,
        source: 'details-cinematic'
    });
    const kind = card.kind || 'media';
    const anchor = createElement('a', `ptv-cinematic-card ptv-cinematic-card--${kind}`);
    const artworkFrame = createElement('span', 'ptv-cinematic-card__artwork-frame');
    const artwork = createElement('span', 'ptv-cinematic-card__artwork lazy');
    const copy = createElement('span', 'ptv-cinematic-card__copy');
    const title = createElement('strong', 'ptv-cinematic-card__title', card.title);
    const subtitle = createElement('span', 'ptv-cinematic-card__subtitle', card.subtitle);
    const candidate = card.href ? null : getArtworkCandidate(card, targetFamily || family);

    anchor.href = card.href || route?.href || '#/home';
    anchor.dataset.ptvFocusKey = `details:cinematic:${shelf.id}:${card.itemId}`;
    anchor.setAttribute('aria-label', `${card.title}. ${card.subtitle}. ${card.reason}`);
    if (card.entityType) anchor.dataset.ptvEntityType = card.entityType;
    artwork.setAttribute('aria-hidden', 'true');

    if (candidate) {
        const blurHash = getImageBlurHash(card.item as Record<string, unknown>, candidate);

        artwork.dataset.src = candidate.url;
        artwork.dataset.ptvArtwork = 'image';
        if (blurHash) artwork.dataset.blurhash = blurHash;
    } else {
        artwork.classList.remove('lazy');
        artwork.dataset.ptvArtwork = 'placeholder';
        artwork.textContent = card.title.slice(0, 1).toLocaleUpperCase('en-US');
    }

    artworkFrame.append(artwork);
    if (card.sequence) {
        const sequence = createElement('span', 'ptv-cinematic-card__sequence', String(card.sequence));

        sequence.setAttribute('aria-label', `Position ${card.sequence}`);
        artworkFrame.append(sequence);
    }

    copy.append(title, subtitle, createReasonChips(card));
    anchor.append(artworkFrame, copy);
    if (route) {
        anchor.addEventListener('click', () => recordPtvItemRouteClick(card.item, route, {
            action: kind === 'entity' ? 'open-cinematic-entity' : 'open-cinematic-card',
            privacySafeDiagnostics: true,
            rowId: shelf.id,
            source: 'details-cinematic'
        }));
    }

    return anchor;
}

function createShelf(shelf: PtvCinematicShelf, family: PtvCinematicMediaFamily, shelfIndex: number) {
    const presentation = shelf.presentation || 'cards';
    const section = createElement('section', `ptv-cinematic-shelf ptv-cinematic-shelf--${presentation}`);
    const headingRow = createElement('div', 'ptv-cinematic-shelf__heading');
    const headingCopy = createElement('div', 'ptv-cinematic-shelf__heading-copy');
    const title = createElement('h3', 'ptv-cinematic-shelf__title', shelf.title);
    const description = createElement('p', 'ptv-cinematic-shelf__description', shelf.description);
    const order = createElement('span', 'ptv-cinematic-shelf__order', shelf.orderLabel);
    const rail = createElement('div', 'ptv-cinematic-shelf__rail');
    const headingId = `ptv-cinematic-shelf-heading-${shelfIndex}`;

    section.dataset.ptvRelationship = shelf.relationship;
    section.dataset.ptvShelfId = shelf.id;
    section.setAttribute('aria-labelledby', headingId);
    if (shelf.orderSource) section.dataset.ptvOrderSource = shelf.orderSource;
    title.id = headingId;
    order.setAttribute('aria-label', `Ordering: ${shelf.orderLabel}`);
    rail.setAttribute('role', 'list');
    rail.setAttribute('aria-label', shelf.title);

    shelf.items.forEach(card => {
        const wrapper = createElement('div', 'ptv-cinematic-shelf__item');

        wrapper.setAttribute('role', 'listitem');
        wrapper.append(createCard(card, shelf, family));
        rail.append(wrapper);
    });

    headingCopy.append(title, description);
    if (shelf.orderExplanation && shelf.orderExplanation !== shelf.description) {
        headingCopy.append(createElement('p', 'ptv-cinematic-shelf__explanation', shelf.orderExplanation));
    }
    headingRow.append(headingCopy, order);
    section.append(headingRow, rail);

    return section;
}

function getGatewayFallback(model: PtvCinematicDetailsModel): PtvCinematicGateway {
    return {
        actions: model.shelves.slice(0, 2).map(shelf => ({ label: 'Explore', shelfId: shelf.id })),
        description: model.summary,
        metadata: [],
        stats: [],
        title: `Beyond ${model.title}`
    };
}

function createGateway(model: PtvCinematicDetailsModel, section: HTMLElement) {
    const gateway = model.gateway || getGatewayFallback(model);
    const intro = createElement('div', 'ptv-cinematic-details__intro ptv-details-glass');
    const introCopy = createElement('div', 'ptv-cinematic-details__intro-copy');
    const kicker = createElement('span', 'ptv-cinematic-details__kicker', model.kicker);
    const title = createElement('h2', 'ptv-cinematic-details__title', gateway.title);
    const summary = createElement('p', 'ptv-cinematic-details__summary', gateway.description);
    const metadata = createElement('ul', 'ptv-cinematic-details__metadata');
    const gatewayPanel = createElement('div', 'ptv-cinematic-details__gateway-panel');
    const stats = createElement('ul', 'ptv-cinematic-details__stats');
    const actions = createElement('div', 'ptv-cinematic-details__actions');
    const monogram = createElement('span', 'ptv-cinematic-details__monogram', gateway.title.slice(0, 1).toLocaleUpperCase('en-US'));

    title.id = CINEMATIC_HEADING_ID;
    gateway.metadata.forEach(value => {
        metadata.append(createElement('li', 'ptv-cinematic-details__metadata-item', value));
    });
    gateway.stats.forEach(value => {
        stats.append(createElement('li', 'ptv-cinematic-details__stat', value));
    });
    gateway.actions.forEach(action => {
        const button = createElement('button', 'ptv-cinematic-details__action', action.label);

        button.type = 'button';
        button.dataset.ptvFocusKey = `details:cinematic:gateway:${action.shelfId}`;
        button.addEventListener('click', () => {
            const target = section.querySelector<HTMLElement>(`[data-ptv-shelf-id="${action.shelfId}"]`);
            const focusTarget = target?.querySelector<HTMLElement>('[data-ptv-focus-key]');
            const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

            target?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
            if (focusTarget) focusPtvTvElement(focusTarget, 'details-cinematic-gateway');
        });
        actions.append(button);
    });

    introCopy.append(kicker, title, summary);
    if (gateway.metadata.length) introCopy.append(metadata);
    gatewayPanel.append(monogram);
    if (gateway.stats.length) gatewayPanel.append(stats);
    if (gateway.actions.length) gatewayPanel.append(actions);
    intro.append(introCopy, gatewayPanel);

    return intro;
}

export function createPtvCinematicDetailsSkeleton(item: PtvCinematicDetailsItem) {
    const section = createElement('section', 'ptv-cinematic-details ptv-cinematic-details--loading');
    const intro = createElement('div', 'ptv-cinematic-details__intro ptv-details-glass');
    const introCopy = createElement('div', 'ptv-cinematic-details__intro-copy');
    const kicker = createElement('span', 'ptv-cinematic-details__kicker', 'Explore this universe');
    const title = createElement('h2', 'ptv-cinematic-details__title', String(item.Name || 'Media universe'));
    const status = createElement('p', 'ptv-cinematic-details__status', 'Finding strong connections in your library...');
    const rail = createElement('div', 'ptv-cinematic-skeleton-rail');

    section.setAttribute('aria-busy', 'true');
    section.setAttribute('aria-live', 'polite');
    section.dataset.ptvCinematicDetailsItemId = String(item.Id || '');
    status.setAttribute('role', 'status');

    for (let index = 0; index < 4; index += 1) {
        rail.append(createElement('span', 'ptv-cinematic-skeleton-card'));
    }

    introCopy.append(kicker, title, status);
    intro.append(introCopy);
    section.append(intro, rail);

    return section;
}

export function createPtvCinematicDetailsElement(
    model: PtvCinematicDetailsModel,
    options: PtvCinematicRenderOptions = {}
) {
    const section = createElement('section', `ptv-cinematic-details ptv-cinematic-details--${model.family}`);
    const shelves = createElement('div', 'ptv-cinematic-details__shelves');
    const appendShelf = (shelf: PtvCinematicShelf, shelfIndex: number) => {
        if (options.signal?.aborted) return;

        try {
            shelves.append(createShelf(shelf, model.family, shelfIndex));
            section.dataset.ptvSettledShelfCount = String(shelves.children.length);
        } catch {
            section.dataset.ptvFailedShelfCount = String(Number(section.dataset.ptvFailedShelfCount || 0) + 1);
        }
    };

    section.setAttribute('aria-labelledby', CINEMATIC_HEADING_ID);
    section.dataset.ptvCandidateCount = String(model.candidateCount);
    section.dataset.ptvDedupedCandidateCount = String(model.dedupedCandidateCount);
    section.dataset.ptvMediaFamily = model.family;
    section.dataset.ptvRequestedShelfCount = String(model.shelves.length);
    section.dataset.ptvSourceSettled = options.sourceSettled === false ? 'false' : 'true';
    section.append(createGateway(model, section), shelves);

    if (!options.progressive) {
        model.shelves.forEach(appendShelf);
        return section;
    }

    if (model.shelves[0]) appendShelf(model.shelves[0], 0);
    model.shelves.slice(1).forEach((shelf, index) => {
        window.setTimeout(() => appendShelf(shelf, index + 1), (index + 1) * 16);
    });

    return section;
}

export async function loadPtvCinematicDetailsElement(
    item: PtvCinematicDetailsItem,
    options: PtvCinematicLoadOptions = {}
) {
    if (options.signal?.aborted) return null;

    // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
    const enrichmentController = new AbortController();
    // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill before PTV starts.
    const relatedController = new AbortController();
    const requestSignal = enrichmentController.signal;
    const relatedSignal = relatedController.signal;
    const discoveryLinks = getPtvDetailsDiscoveryLinks(item as PtvDetailsDiscoveryItem);
    const relationshipPromise = getPtvAuthoritativeRelationships(String(item.Id || ''), {
        serverId: String(item.ServerId || '') || null,
        signal: requestSignal
    }).catch(error => {
        if (requestSignal.aborted || error?.name === 'AbortError') throw error;

        return [];
    });
    const sourcePromise = getPtvRecommendationHomeData({
        includeHomeScans: true,
        serverId: String(item.ServerId || '') || null,
        signal: requestSignal
    });
    const relatedPromise = loadPtvDetailRelatedItems(item as PtvRelatedVideoItem, {
        includeSimilar: false,
        includeStudios: false,
        serverId: String(item.ServerId || '') || null,
        signal: relatedSignal
    }).then(items => rankPtvRelatedVideoItems(item as PtvRelatedVideoItem, items, items.length));
    const emptyData: PtvRecommendationHomeData = {
        candidates: [],
        generatedAt: 0,
        mixes: [],
        profileUpdatedAt: 0,
        quality: {
            duplicateItemsRemoved: 0,
            rowOverlapPercentage: 0,
            scoreDistribution: { buckets: [], max: 0, median: 0, min: 0, p25: 0, p75: 0, p90: 0 },
            unresolvedArtistCount: 0
        },
        rows: []
    };
    const initialModel = buildPtvCinematicDetailsModel(item, emptyData, discoveryLinks);
    const initialSection = initialModel.shelves.length ? createPtvCinematicDetailsElement(initialModel, {
        progressive: true,
        signal: options.signal,
        sourceSettled: false
    }) : createPtvCinematicDetailsSkeleton(item);

    initialSection.dataset.ptvSourceSettled = 'false';
    let sourceRetired = false;
    let timeoutId: number | null = null;
    let abortEnrichment = () => undefined;
    let pendingEnrichments = 3;
    let currentData = emptyData;
    let currentRelatedItems: PtvRelatedVideoItem[] = [];
    let currentRelationships: Awaited<typeof relationshipPromise> = [];
    let sourceState: 'failed' | 'pending' | 'settled' = 'pending';
    const discardEmptySection = () => {
        if (initialSection.querySelector('[data-ptv-shelf-id]')) return;

        initialSection.hidden = true;
        initialSection.setAttribute('aria-busy', 'false');
        window.setTimeout(() => initialSection.remove(), 0);
    };
    const releaseSource = () => {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        timeoutId = null;
        options.signal?.removeEventListener('abort', abortEnrichment);
    };
    const finishEnrichment = () => {
        pendingEnrichments = Math.max(0, pendingEnrichments - 1);
        if (pendingEnrichments) return;

        releaseSource();
        discardEmptySection();
    };
    const renderEnrichment = () => {
        if (options.signal?.aborted) return;

        const enrichedModel = buildPtvCinematicDetailsModel(
            item,
            mergeRelatedRecommendationData(currentData, currentRelatedItems),
            discoveryLinks,
            currentRelationships
        );

        if (!enrichedModel.shelves.length) return;

        const enrichedSection = createPtvCinematicDetailsElement(enrichedModel, {
            signal: options.signal,
            sourceSettled: sourceState === 'settled'
        });
        const activeElement = initialSection.ownerDocument.activeElement;
        const activeFocusKey = activeElement instanceof HTMLElement && initialSection.contains(activeElement) ?
            activeElement.dataset.ptvFocusKey || '' :
            '';
        const railOffsets = new Map(Array.from(initialSection.querySelectorAll<HTMLElement>('[data-ptv-shelf-id]'))
            .map(shelf => [
                shelf.dataset.ptvShelfId || '',
                shelf.querySelector<HTMLElement>('.ptv-cinematic-shelf__rail')?.scrollLeft || 0
            ]));

        Array.from(initialSection.attributes).forEach(attribute => {
            initialSection.removeAttribute(attribute.name);
        });
        Array.from(enrichedSection.attributes).forEach(attribute => {
            initialSection.setAttribute(attribute.name, attribute.value);
        });
        if (sourceRetired) initialSection.dataset.ptvSourceSettled = 'retired';
        else if (sourceState === 'failed') initialSection.dataset.ptvSourceSettled = 'failed';
        initialSection.replaceChildren(...enrichedSection.childNodes);
        railOffsets.forEach((scrollLeft, shelfId) => {
            const rail = Array.from(initialSection.querySelectorAll<HTMLElement>('[data-ptv-shelf-id]'))
                .find(shelf => shelf.dataset.ptvShelfId === shelfId)
                ?.querySelector<HTMLElement>('.ptv-cinematic-shelf__rail');

            if (rail) rail.scrollLeft = scrollLeft;
        });
        imageLoader.lazyChildren(initialSection);

        if (activeFocusKey && initialSection.isConnected) {
            const focusTarget = Array.from(initialSection.querySelectorAll<HTMLElement>('[data-ptv-focus-key]'))
                .find(element => element.dataset.ptvFocusKey === activeFocusKey);

            if (focusTarget) focusPtvTvElement(focusTarget, 'details-cinematic-enrichment');
        }
    };

    const retireSource = () => {
        sourceRetired = true;
        initialSection.dataset.ptvSourceSettled = 'retired';
        if (!requestSignal.aborted) enrichmentController.abort();
        discardEmptySection();
        timeoutId = null;
    };
    abortEnrichment = () => {
        sourceRetired = true;
        initialSection.dataset.ptvSourceSettled = 'retired';
        if (!requestSignal.aborted) enrichmentController.abort();
        if (!relatedSignal.aborted) relatedController.abort();
        discardEmptySection();
        releaseSource();
    };

    timeoutId = window.setTimeout(retireSource, CINEMATIC_ENRICHMENT_TIMEOUT_MS);
    options.signal?.addEventListener('abort', abortEnrichment, { once: true });

    void relationshipPromise.then(relationships => {
        currentRelationships = relationships;
        renderEnrichment();
    }).catch(() => undefined).finally(finishEnrichment);

    void relatedPromise.then(items => {
        currentRelatedItems = items;
        renderEnrichment();
    }).catch(error => {
        if (relatedSignal.aborted || error?.name === 'AbortError') return;
    }).finally(finishEnrichment);

    void sourcePromise.then(data => {
        if (sourceRetired) return;

        currentData = data;
        sourceState = 'settled';
        renderEnrichment();
    }).catch(error => {
        if (requestSignal.aborted || error?.name === 'AbortError') return;
        if (sourceRetired) return;

        sourceState = 'failed';
        renderEnrichment();
    }).finally(finishEnrichment);

    return initialSection;
}

export function activatePtvCinematicDetailsArtwork(section: HTMLElement) {
    imageLoader.lazyChildren(section);
}
