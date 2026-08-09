import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string) {
    return fs.readFileSync(path.join(__dirname, relativePath), 'utf8')
        .replace(/\r\n?/g, '\n');
}

const controllerSource = readSource('../../../controllers/itemDetails/index.js');
const enhancementSource = readSource('index.js');
const itemsByNameSource = readSource('../../../scripts/itemsByName.js');
const playlistViewerSource = readSource('../../../scripts/playlistViewer.js');
const itemContextMenuSource = readSource('../../../components/itemContextMenu.js');
const itemHelperSource = readSource('../../../components/itemHelper.js');
const integrationSource = readSource('../integrations/arrActions.js');

describe('PTV details render lifecycle', () => {
    it('hands the current rendered item to PTV after Jellyfin finishes the page DOM', () => {
        const renderIndex = controllerSource.indexOf('reloadFromItem(instance, page, pageParams, normalizedItem, user)');
        const eventIndex = controllerSource.indexOf("emitPtvEvent('detailsrendered'");

        expect(renderIndex).toBeGreaterThan(-1);
        expect(eventIndex).toBeGreaterThan(renderIndex);
        expect(enhancementSource).toContain("on('detailsrendered', handleDetailsRendered)");
        expect(enhancementSource).toContain('enhanceDetails(page, item, owner)');
        expect(enhancementSource).toContain(
            'applyDetailItem(page, id, renderedItem, apiClient, owner)'
        );
    });

    it('does not block the poster DOM on a redundant image preload', () => {
        const renderDetailImage = /function renderDetailImage[\s\S]*?\n}\n\nfunction renderImage/
            .exec(controllerSource)?.[0] || '';

        expect(renderDetailImage).toContain('loader.lazyChildren(elem)');
        expect(renderDetailImage).not.toContain('preloadImage(');
    });

    it('routes only the series-details season list through the Core metadata facade', () => {
        expect(controllerSource).toContain("import { getPtvSeriesSeasons } from '../../ptv/api/seriesSeasons'");
        expect(controllerSource).toContain('getPtvSeriesSeasons(apiClient, item.Id, {');
        expect(controllerSource).not.toContain('apiClient.getSeasons(item.Id, {');
    });

    it('routes only the season-details episode list through its Core metadata facade', () => {
        const renderChildren = /function renderChildren[\s\S]*?\n}\n\nfunction renderItemsByName/
            .exec(controllerSource)?.[0] || '';

        expect(controllerSource).toContain("import { getPtvSeasonEpisodes } from '../../ptv/api/seasonEpisodes'");
        expect(renderChildren).toContain('getPtvSeasonEpisodes(apiClient, item.SeriesId, item.Id, {');
        expect(renderChildren).toContain("fields += ',Overview,MediaSources'");
        expect(renderChildren).toContain('seasonId: item.Id');
        expect(renderChildren).toContain('userId: userId');
        expect(renderChildren).toContain('Fields: fields');
        expect(renderChildren).not.toContain('apiClient.getEpisodes(');
        expect(controllerSource).not.toContain('apiClient.getEpisodes(item.SeriesId, {');
        expect(renderChildren).toContain('result.Items = result.Items.map(normalizeItemMediaSources)');
        expect(renderChildren).toContain('html = listView.getListViewHtml({');
    });

    it('paints direct item artwork before optional parent artwork resolves', () => {
        const applyDetailItem = /function applyDetailItem[\s\S]*?\n}\n\nfunction enhanceDetailItem/
            .exec(enhancementSource)?.[0] || '';
        const directArtworkIndex = applyDetailItem.indexOf('getBackdropCandidates(item, [])');
        const relatedArtworkIndex = applyDetailItem.indexOf('Promise.all(relatedArtworkIds');

        expect(directArtworkIndex).toBeGreaterThan(-1);
        expect(relatedArtworkIndex).toBeGreaterThan(directArtworkIndex);
    });

    it('shares exact in-flight detail reads without changing their legacy consumers', () => {
        expect(controllerSource).toContain(
            "import { getCoordinatedLegacyItemDetail } from '../../ptv/services/coordinatedLegacyItemDetail'"
        );
        expect(controllerSource).toContain('return getCoordinatedLegacyItemDetail(apiClient, id, { signal })');
        expect(enhancementSource).toContain(
            "import { getCoordinatedLegacyItemDetail } from '../../services/coordinatedLegacyItemDetail'"
        );
        expect(enhancementSource).toContain('getCoordinatedLegacyItemDetail(apiClient, id, {');
        expect(enhancementSource).toContain('signal: owner.controller.signal');
        expect(integrationSource).toContain(
            "import { getCoordinatedLegacyItemDetail } from '../../services/coordinatedLegacyItemDetail'"
        );
        expect(integrationSource).toContain('getCoordinatedLegacyItemDetail(apiClient, itemId)');
        expect(integrationSource).toContain('getCacheKey(serverId, userId, itemId)');
        expect(integrationSource).toContain('getApiClient(serverId)?.getCurrentUserId?.() !== userId');
    });

    it('retires enhancement work and item-local state when the details module exits', () => {
        const destroy = /function destroy\(\)[\s\S]*?\n}\n\nregisterModule/
            .exec(enhancementSource)?.[0] || '';

        expect(enhancementSource).toContain('beginDetailsEnhancementGeneration()');
        expect(enhancementSource).toContain('isDetailsEnhancementGenerationCurrent(owner)');
        expect(destroy).toContain('retireDetailsEnhancementGeneration()');
        expect(destroy).toContain('resetDetailEnhancementState(page)');
        expect(enhancementSource).toContain("image.removeEventListener('load', handleDetailImageLoad)");
        expect(enhancementSource).toContain("image.removeEventListener('error', handleDetailImageError)");
        expect(integrationSource).toContain('itemCache.clear()');
    });

    it('rehydrates the same type-specific progressive pipeline on restore without resetting primary content', () => {
        const restoredBranch = /if \(e\.detail\.isRestored\)[\s\S]*?\n {12}} else \{/
            .exec(controllerSource)?.[0] || '';
        const childPipeline = /function renderDetailChildPipeline[\s\S]*?\n}/
            .exec(controllerSource)?.[0] || '';
        const renderOverview = /function renderOverview[\s\S]*?\n}/
            .exec(controllerSource)?.[0] || '';

        expect(restoredBranch).toContain('resumePtvDetailPageGeneration(page, currentItem');
        expect(restoredBranch).toContain(
            'renderDetails(page, currentItem, apiClient, params.context, childLoadController)'
        );
        expect(restoredBranch).toContain('const childLoadController = beginPtvDetailChildLoad(page)');
        expect(restoredBranch).toContain('renderDetailChildPipeline(');
        expect(restoredBranch).toContain('childLoadController');
        expect(restoredBranch).toContain("emitPtvEvent('detailsrendered'");
        expect(restoredBranch).not.toContain('resetDetailPageForItem');
        expect(childPipeline).toContain('setInitialCollapsibleState(');
        expect(childPipeline).toContain('childLoadController');
        expect(renderOverview).toContain(
            'expandButton.onclick = toggleLineClamp.bind(null, overviewElemnt)'
        );
        expect(renderOverview).not.toContain("expandButton.addEventListener('click'");
    });

    it('releases the primary loading surface when an owned load is aborted or its view exits', () => {
        const reload = /function reload\(instance, page, pageParams\)[\s\S]*?\n {4}}\n\n {4}function retireActiveDetailLoad/
            .exec(controllerSource)?.[0] || '';
        const retire = /function retireActiveDetailLoad\(page\)[\s\S]*?\n {4}}/
            .exec(controllerSource)?.[0] || '';
        const renderSeriesSchedule = /function renderSeriesSchedule[\s\S]*?\n}/
            .exec(controllerSource)?.[0] || '';

        expect(reload).toContain("if (error?.name === 'AbortError')");
        expect(reload).toContain("page.classList.remove('ptv-detail-data-loading')");
        expect(reload).toContain('loading.hide()');
        expect(retire).toContain('activeDetailLoadController?.abort()');
        expect(retire).toContain("page.classList.remove('ptv-detail-data-loading')");
        expect(retire).toContain('loading.hide()');
        expect(controllerSource).toContain("view.addEventListener('viewbeforehide', function () {\n            retireActiveDetailLoad(view);");
        expect(controllerSource).toContain("view.addEventListener('viewdestroy', function () {\n            retireActiveDetailLoad(view);");
        expect(renderSeriesSchedule).not.toContain('loading.hide()');
    });

    it('generation-gates legacy items-by-name commits for artist-style details', () => {
        const renderItemsByName = /function renderItemsByName[\s\S]*?\n}/
            .exec(controllerSource)?.[0] || '';
        const loadItems = /function loadItems[\s\S]*?\n}/
            .exec(itemsByNameSource)?.[0] || '';

        expect(renderItemsByName).toContain('if (!isDetailItemCurrent(page, item)) return');
        expect(renderItemsByName).toContain(
            'isCurrent: () => isDetailItemCurrent(page, item)'
        );
        expect(itemsByNameSource).toContain('function isItemsByNameRenderCurrent(options)');
        expect(loadItems).toContain('if (!isItemsByNameRenderCurrent(options)) return');
    });

    it('routes playlist and items-by-name reads through one abortable detail owner', () => {
        const reloadFromItem = /function reloadFromItem[\s\S]*?\n}/
            .exec(controllerSource)?.[0] || '';

        expect(reloadFromItem).toContain('const childLoadController = beginPtvDetailChildLoad(page)');
        expect(reloadFromItem).toContain('childLoadController.signal');
        expect(reloadFromItem).toContain('const playlistEditabilityPromise');
        expect(reloadFromItem).toContain('playlistEditabilityPromise');
        expect(playlistViewerSource).toContain(
            '`Playlists/${item.Id}/Users/${userId}`'
        );
        expect(itemHelperSource).toContain(
            '`Playlists/${item.Id}/Users/${user.Id}`'
        );
        expect(itemContextMenuSource).toContain('signal: options.signal');
        expect(itemContextMenuSource).toContain('options.playlistEditabilityPromise');
        expect(playlistViewerSource).toContain('options.editabilityPromise');
        expect(playlistViewerSource).toContain('requestPtvJson(`Playlists/${item.Id}/Items`');
        expect(itemsByNameSource).toContain('return requestPtvJson(path, {');
        expect(playlistViewerSource).not.toContain('getPlaylistsApi');
        expect(playlistViewerSource).not.toContain('apiClient.getJSON');
        expect(playlistViewerSource).not.toContain('playlistInit');
        expect(itemsByNameSource).not.toContain('apiClient.getAlbumArtists');
        expect(itemsByNameSource).not.toContain('apiClient.getItems');
    });

    it('coordinates named-item and SeriesTimer reads with complete route ownership', () => {
        const getPromise = /function getPromise[\s\S]*?\n}/
            .exec(controllerSource)?.[0] || '';
        const timerSchedule = /function renderSeriesTimerSchedule[\s\S]*?\n}/
            .exec(controllerSource)?.[0] || '';

        expect(getPromise).toContain('`LiveTv/SeriesTimers/${encodeURIComponent(params.seriesTimerId)}`');
        expect(getPromise).toContain('`Genres/${encodeURIComponent(params.genre)}`');
        expect(getPromise).toContain('`MusicGenres/${encodeURIComponent(params.musicgenre)}`');
        expect(getPromise).toContain('`Artists/${encodeURIComponent(params.musicartist)}`');
        expect(getPromise.match(/signal/g)?.length).toBeGreaterThanOrEqual(5);
        expect(getPromise).not.toContain('apiClient.getLiveTvSeriesTimer');
        expect(getPromise).not.toContain('apiClient.getGenre');
        expect(getPromise).not.toContain('apiClient.getMusicGenre');
        expect(getPromise).not.toContain('apiClient.getArtist');
        expect(timerSchedule).toContain("requestPtvJson('LiveTv/Timers'");
        expect(timerSchedule).toContain('serverId: item.ServerId');
        expect(timerSchedule).toContain('signal');
        expect(timerSchedule).toContain('!isDetailItemCurrent(page, item)');
        expect(timerSchedule).not.toContain('apiClient.getLiveTvTimers');
    });

    it('bounds and aborts the more-from-artist shelf through the shared request coordinator', () => {
        const moreFromArtist = /function renderMoreFromArtist[\s\S]*?\n}/
            .exec(controllerSource)?.[0] || '';

        expect(moreFromArtist).toContain('Limit: 24');
        expect(moreFromArtist).toContain('EnableTotalRecordCount: false');
        expect(moreFromArtist).toContain('getPtvItems(query, {');
        expect(moreFromArtist).toContain('serverId: item.ServerId');
        expect(moreFromArtist).toContain('signal');
        expect(moreFromArtist).not.toContain('apiClient.getItems');
    });

    it('coordinates optional lyrics, season, and similar shelves with the detail route owner', () => {
        const renderDetails = /function renderDetails[\s\S]*?\n}/
            .exec(controllerSource)?.[0] || '';
        const lyrics = /function renderLyricsContainer[\s\S]*?\n}/
            .exec(controllerSource)?.[0] || '';
        const moreFromSeason = /function renderMoreFromSeason[\s\S]*?\n}/
            .exec(controllerSource)?.[0] || '';
        const similar = /function renderSimilarItems[\s\S]*?\n}/
            .exec(controllerSource)?.[0] || '';

        expect(renderDetails.match(/childLoadController\.signal/g)?.length).toBeGreaterThanOrEqual(4);
        expect(lyrics).toContain('requestPtvJson(`Audio/${encodeURIComponent(item.Id)}/Lyrics`');
        expect(lyrics).toContain('signal');
        expect(lyrics).not.toContain('apiClient.ajax');
        expect(moreFromSeason).toContain('getPtvSeasonEpisodes(apiClient, item.SeriesId, item.SeasonId');
        expect(moreFromSeason).toContain('Limit: 100');
        expect(moreFromSeason).toContain('signal');
        expect(moreFromSeason).not.toContain('apiClient.getEpisodes');
        expect(similar).toContain('requestPtvJson(`Items/${encodeURIComponent(item.Id)}/Similar`');
        expect(similar).toContain('signal');
        expect(similar).not.toContain('apiClient.getSimilarItems');
    });
});
