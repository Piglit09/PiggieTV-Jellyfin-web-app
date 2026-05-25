import mountPtvHomeHero, {
    cleanupDisconnectedPtvHomeHeroes,
    unmountPtvHomeHero
} from 'ptv/pages/home/mountHero';
import {
    cancelPtvImageScope,
    trimPtvImageManagerMemory
} from 'ptv/core/imageManager';
import { enhancePtvCards } from 'ptv/modules/cards/CardEnhancer';
import {
    FEATURED_CACHE_UPDATED_EVENT,
    getFeaturedContent
} from 'ptv/modules/cache/featuredContentCache';
import { getPtvPerformanceProfile } from 'ptv/core/clientProfile';
import { getPtvFeatureSettings } from 'ptv/core/featureSettings';
import { timePtvAsync } from 'ptv/core/observability';
import { getUserViewsQuery } from 'hooks/useUserViews';
import globalize from 'lib/globalize';
import { DEFAULT_SECTIONS } from 'types/homeSectionType';
import Dashboard from 'utils/dashboard';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { queryClient } from 'utils/query/queryClient';

import {
    createFeaturedContentFetcher,
    loadGenreMap,
    loadStudioMap,
    PTV_HOME_ROWS,
    cleanupPtvRowBackdrops,
    renderLibraryRow,
    renderMediaRow
} from './ptvRows';

import 'elements/emby-button/paper-icon-button-light';
import 'elements/emby-itemscontainer/emby-itemscontainer';
import 'elements/emby-scroller/emby-scroller';
import 'elements/emby-button/emby-button';

import 'components/homesections/homesections.scss';

export function getDefaultSection(index) {
    if (index < 0 || index > DEFAULT_SECTIONS.length) return '';
    return DEFAULT_SECTIONS[index];
}

function shuffleRows(rows) {
    const shuffled = [...rows];
    let seed = Date.now() + (shuffled.length * 7919);

    for (let i = shuffled.length - 1; i > 0; i--) {
        seed = ((seed * 1664525) + 1013904223) % 4294967296;
        const j = seed % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
}

function limitRowsForPerformance(rows, performanceProfile) {
    const limit = performanceProfile.homeRowLimit;

    if (!limit || limit >= rows.length) return rows;

    const pinnedRows = rows.filter(row => row.id === 'my-media' || row.id === 'continue-watching');
    const remainingRows = rows.filter(row => row.id !== 'my-media' && row.id !== 'continue-watching');

    return [
        ...pinnedRows,
        ...remainingRows
    ].slice(0, limit);
}

function getSharedFeaturedContent(fetchFeaturedContent) {
    return getFeaturedContent(fetchFeaturedContent);
}

function cleanupFeaturedCacheListener(elem) {
    if (typeof elem.ptvFeaturedCacheCleanup === 'function') {
        elem.ptvFeaturedCacheCleanup();
        elem.ptvFeaturedCacheCleanup = null;
    }
}

function delay(ms) {
    if (!ms) return Promise.resolve();

    return new Promise(resolve => window.setTimeout(resolve, ms));
}

function createLookupMaps() {
    return {
        genresByName: new Map(),
        studiosByName: new Map()
    };
}

function hydrateLookupMaps(lookupMaps, apiClient, userId) {
    return Promise.all([
        loadGenreMap(apiClient, userId),
        loadStudioMap(apiClient, userId)
    ])
        .then(([genresByName, studiosByName]) => {
            lookupMaps.genresByName = genresByName;
            lookupMaps.studiosByName = studiosByName;

            return lookupMaps;
        });
}

function clearDeferredResumeTimers(elem) {
    if (!elem?.ptvDeferredResumeTimers) return;

    for (const timer of elem.ptvDeferredResumeTimers) {
        window.clearTimeout(timer);
    }

    elem.ptvDeferredResumeTimers.clear();
}

function scheduleDeferredResume(elem, sections, options) {
    if (!sections.length) return;

    if (!elem.ptvDeferredResumeTimers) {
        elem.ptvDeferredResumeTimers = new Set();
    }

    const timer = window.setTimeout(() => {
        elem.ptvDeferredResumeTimers?.delete(timer);

        const connectedSections = sections.filter(section => section.isConnected);
        if (!connectedSections.length) return;

        void timePtvAsync(
            'render',
            'home-sections-resume-deferred',
            () => Promise.all(connectedSections.map(section => section.resume(options))),
            {
                sections: connectedSections.length
            }
        )
            .then(() => {
                enhancePtvCards(elem);
            })
            .catch(err => {
                console.warn('[PTV Home] Failed resuming deferred sections', err);
            });
    }, 450);

    elem.ptvDeferredResumeTimers.add(timer);
}

export function loadSections(elem, apiClient, user) {
    window.__PTV_HOME_INITIALIZED__ = true;
    unmountPtvHomeHero(elem);
    cleanupPtvRowBackdrops(elem);
    cleanupFeaturedCacheListener(elem);
    clearDeferredResumeTimers(elem);
    trimPtvImageManagerMemory();

    const userId = user.Id || apiClient.getCurrentUserId();
    return timePtvAsync('render', 'home-sections-load', () => queryClient
        .fetchQuery(getUserViewsQuery(toApi(apiClient), userId))
        .then(result => result.Items || [])
        .then(function (userViews) {
            let html = '';
            const performanceProfile = getPtvPerformanceProfile();
            const featureSettings = getPtvFeatureSettings();

            if (featureSettings.heroEnabled) {
                html += '<div class="ptvHeroMount"></div>';
            }

            if (userViews.length) {
                const rows = featureSettings.homeRowsEnabled ?
                    limitRowsForPerformance(shuffleRows(PTV_HOME_ROWS), performanceProfile) :
                    [];

                for (let i = 0; i < rows.length; i++) {
                    html += '<div class="verticalSection section' + i + '"></div>';
                }

                elem.innerHTML = html;
                elem.classList.add('homeSectionsContainer');
                elem.classList.toggle('ptv-home-low-power', performanceProfile.isLowPower);
                elem.dataset.ptvClientProfile = performanceProfile.clientKind;
                elem.dataset.ptvRenderProfile = performanceProfile.renderProfile.id;
                elem.dataset.ptvRenderTier = performanceProfile.renderProfile.tier;

                if (!rows.length) {
                    mountPtvHomeHero(elem, {
                        apiClient,
                        user
                    });

                    return Promise.resolve();
                }

                const lookupMaps = createLookupMaps();
                const lookupMapsPromise = hydrateLookupMaps(lookupMaps, apiClient, userId)
                    .catch(() => lookupMaps);
                const fetchFeaturedContent = () => lookupMapsPromise.then(() => createFeaturedContentFetcher(
                    apiClient,
                    userId,
                    rows,
                    lookupMaps,
                    userViews,
                    {
                        performanceProfile
                    }
                )());
                let featuredContentPromise = getSharedFeaturedContent(fetchFeaturedContent);
                const featuredContentSource = {
                    get: () => featuredContentPromise
                };
                const handleFeaturedCacheUpdated = () => {
                    featuredContentPromise = getFeaturedContent(fetchFeaturedContent);

                    void resume(elem, {
                        deferContinue: true,
                        refresh: true
                    })
                        .then(() => {
                            enhancePtvCards(elem);
                        })
                        .catch(err => {
                            console.warn('[PTV Home] Failed refreshing featured cache content', err);
                        });
                };

                cleanupFeaturedCacheListener(elem);
                window.addEventListener(FEATURED_CACHE_UPDATED_EVENT, handleFeaturedCacheUpdated);
                elem.ptvFeaturedCacheCleanup = () => {
                    window.removeEventListener(FEATURED_CACHE_UPDATED_EVENT, handleFeaturedCacheUpdated);
                };

                mountPtvHomeHero(elem, {
                    apiClient,
                    user,
                    featuredContentPromise
                });

                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const sectionElem = elem.querySelector('.section' + i);
                    const options = {
                        enableOverflow: enableScrollX(),
                        featuredContentSource,
                        performanceProfile
                    };

                    if (row.type === 'libraries') {
                        renderLibraryRow(sectionElem, apiClient, userViews, options);
                    } else {
                        renderMediaRow(sectionElem, apiClient, userId, row, lookupMaps, userViews, options);
                    }
                }

                // Timeout for polyfilled CustomElements (webOS 1.2)
                return new Promise(resolve => window.setTimeout(resolve, 0))
                    .then(() => {
                        enhancePtvCards(elem);

                        void resume(elem, {
                            deferContinue: true,
                            refresh: true
                        }).catch(err => {
                            console.warn('[PTV Home] Failed resuming background sections', err);
                        });
                    });
            } else {
                let noLibDescription;
                if (user.Policy?.IsAdministrator) {
                    noLibDescription = globalize.translate('NoCreatedLibraries', '<br><a id="button-createLibrary" class="button-link">', '</a>');
                } else {
                    noLibDescription = globalize.translate('AskAdminToCreateLibrary');
                }

                html += '<div class="centerMessage padded-left padded-right">';
                html += '<h2>' + globalize.translate('MessageNothingHere') + '</h2>';
                html += '<p>' + noLibDescription + '</p>';
                html += '</div>';
                elem.innerHTML = html;

                const createNowLink = elem.querySelector('#button-createLibrary');
                if (createNowLink) {
                    createNowLink.addEventListener('click', function () {
                        Dashboard.navigate('dashboard/libraries');
                    });
                }
            }
        }));
}

export function destroySections(elem) {
    clearDeferredResumeTimers(elem);
    cleanupFeaturedCacheListener(elem);
    unmountPtvHomeHero(elem);
    cleanupPtvRowBackdrops(elem);
    cancelPtvImageScope('hero-backdrop');
    cancelPtvImageScope('row-backdrop');
    cancelPtvImageScope('viewport');
    cancelPtvImageScope('viewport-fallback');
    cleanupDisconnectedPtvHomeHeroes();
    trimPtvImageManagerMemory();

    const elems = elem.querySelectorAll('.itemsContainer');
    for (const e of elems) {
        e.fetchData = null;
        e.parentContainer = null;
        e.getItemsHtml = null;
    }

    elem.innerHTML = '';
}

export function pause(elem) {
    clearDeferredResumeTimers(elem);

    const elems = elem.querySelectorAll('.itemsContainer');
    for (const e of elems) {
        e.pause();
    }
}

function getImmediateResumeSections(sections, options) {
    if (options?.deferContinue === false) return sections;

    return sections.filter(section => section.dataset.ptvRowType !== 'continue');
}

function getDeferredResumeSections(sections, options) {
    if (options?.deferContinue === false) return [];

    return sections.filter(section => section.dataset.ptvRowType === 'continue');
}

export function resume(elem, options) {
    clearDeferredResumeTimers(elem);

    const sections = Array.from(elem.querySelectorAll('.itemsContainer'))
        .filter(section => typeof section.resume === 'function');
    const immediateSections = getImmediateResumeSections(sections, options);
    const deferredSections = getDeferredResumeSections(sections, options);
    const performanceProfile = getPtvPerformanceProfile();
    const batchSize = options?.batchSize || performanceProfile.sectionResumeBatchSize;
    const batchDelay = options?.batchDelayMs ?? performanceProfile.sectionResumeBatchDelayMs;

    scheduleDeferredResume(elem, deferredSections, options);

    if (!batchSize || batchSize <= 0) {
        return timePtvAsync(
            'render',
            'home-sections-resume',
            () => Promise.all(immediateSections.map(section => section.resume(options))),
            {
                deferredSections: deferredSections.length,
                sections: immediateSections.length
            }
        );
    }

    const results = [];
    const batches = [];

    for (let i = 0; i < immediateSections.length; i += batchSize) {
        batches.push(immediateSections.slice(i, i + batchSize));
    }

    return timePtvAsync('render', 'home-sections-resume-batched', () => batches.reduce((chain, batch, index) => chain
        .then(() => Promise.all(batch.map(section => section.resume(options))))
        .then(batchResults => {
            results.push(...batchResults);

            if (index < batches.length - 1) {
                return delay(batchDelay);
            }

            return null;
        }), Promise.resolve())
        .then(() => results), {
        batches: batches.length,
        deferredSections: deferredSections.length,
        sections: immediateSections.length
    });
}

function enableScrollX() {
    return true;
}

export default {
    getDefaultSection,
    loadSections,
    destroySections,
    pause,
    resume
};
