import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const detailsSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

describe('details discovery lifecycle', () => {
    it('lazy-loads a metadata-only model and rejects stale commits', () => {
        const renderDiscovery = /function renderDetailsDiscovery[\s\S]*?\n}/
            .exec(detailsSource)?.[0] || '';

        expect(renderDiscovery).toContain("import('./detailsDiscoveryModel')");
        expect(renderDiscovery.match(/isCurrentDetailItem\(page, itemId, owner\)/g)?.length)
            .toBeGreaterThanOrEqual(3);
        expect(renderDiscovery).not.toContain('getPtvItems');
        expect(renderDiscovery).not.toContain('requestPtvJson');
        expect(renderDiscovery).not.toContain('getItem(');
    });

    it('uses native links and text content instead of injecting metadata HTML', () => {
        const createSection = /function createDetailsDiscoverySection[\s\S]*?\n}/
            .exec(detailsSource)?.[0] || '';

        expect(createSection).toContain("document.createElement('a')");
        expect(createSection).toContain('anchor.href = link.href');
        expect(createSection).toContain('anchor.setAttribute(\'aria-label\', link.ariaLabel)');
        expect(createSection).toContain('label.textContent = link.label');
        expect(createSection).toContain('meta.textContent = link.meta');
        expect(createSection).not.toContain('innerHTML');
    });

    it('removes the route-owned strip and its generation state during cleanup', () => {
        const resetState = /function resetDetailEnhancementState[\s\S]*?\n}/
            .exec(detailsSource)?.[0] || '';
        const prepareState = /function prepareDetailItemState[\s\S]*?\n}/
            .exec(detailsSource)?.[0] || '';

        expect(resetState).toContain('ptvDetailsDiscoveryGeneration');
        expect(resetState).toContain('ptvDetailsDiscoveryItemId');
        expect(resetState).toContain('ptvDetailsDiscoveryPendingItemId');
        expect(prepareState).toContain('clearDetailsDiscovery(page)');
    });
});
