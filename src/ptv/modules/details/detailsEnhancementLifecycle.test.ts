import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const controllerSource = fs.readFileSync(
    path.join(__dirname, '../../../controllers/itemDetails/index.js'),
    'utf8'
);
const enhancementSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

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

    it('paints direct item artwork before optional parent artwork resolves', () => {
        const applyDetailItem = /function applyDetailItem[\s\S]*?\n}\n\nfunction enhanceDetailItem/
            .exec(enhancementSource)?.[0] || '';
        const directArtworkIndex = applyDetailItem.indexOf('getBackdropCandidates(item, [])');
        const relatedArtworkIndex = applyDetailItem.indexOf('Promise.all(relatedArtworkIds');

        expect(directArtworkIndex).toBeGreaterThan(-1);
        expect(relatedArtworkIndex).toBeGreaterThan(directArtworkIndex);
    });
});
