import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const controllerSource = fs.readFileSync(
    path.join(__dirname, '../../../controllers/itemDetails/index.js'),
    'utf8'
);
const enhancementSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const integrationSource = fs.readFileSync(
    path.join(__dirname, '../integrations/arrActions.js'),
    'utf8'
);

describe('PTV details render lifecycle', () => {
    it('hands the current rendered item to PTV after Jellyfin finishes the page DOM', () => {
        const renderIndex = controllerSource.indexOf('reloadFromItem(instance, page, pageParams, normalizedItem, user)');
        const eventIndex = controllerSource.indexOf("emitPtvEvent('detailsrendered'");

        expect(renderIndex).toBeGreaterThan(-1);
        expect(eventIndex).toBeGreaterThan(renderIndex);
        expect(enhancementSource).toContain("on('detailsrendered', handleDetailsRendered)");
        expect(enhancementSource).toContain('enhanceDetails(page, item)');
        expect(enhancementSource).toContain('applyDetailItem(page, id, renderedItem, apiClient)');
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
        expect(controllerSource).toContain('apiClient.getEpisodes(item.SeriesId, {');
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
        expect(controllerSource).toContain('apiClient.getEpisodes(item.SeriesId, {');
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
        expect(controllerSource).toContain('return getCoordinatedLegacyItemDetail(apiClient, id)');
        expect(enhancementSource).toContain(
            "import { getCoordinatedLegacyItemDetail } from '../../services/coordinatedLegacyItemDetail'"
        );
        expect(enhancementSource).toContain('getCoordinatedLegacyItemDetail(apiClient, id)');
        expect(integrationSource).toContain(
            "import { getCoordinatedLegacyItemDetail } from '../../services/coordinatedLegacyItemDetail'"
        );
        expect(integrationSource).toContain('getCoordinatedLegacyItemDetail(apiClient, itemId)');
    });
});
