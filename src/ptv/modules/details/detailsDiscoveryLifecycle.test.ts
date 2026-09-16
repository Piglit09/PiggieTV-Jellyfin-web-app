import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const detailsSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/details/index.js'), 'utf8');
const cinematicSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/details/detailsCinematicExperience.ts'), 'utf8');

describe('details discovery consolidation', () => {
    it('retires the plain-text metadata strip in favor of the route-lazy cinematic owner', () => {
        expect(detailsSource).not.toContain("import('./detailsDiscoveryModel')");
        expect(detailsSource).not.toContain('DETAILS_DISCOVERY_CLASS');
        expect(detailsSource).toContain("import('./detailsCinematicExperience')");
        expect(detailsSource).toContain('isCurrentDetailItem(page, itemId, owner)');
        expect(cinematicSource).toContain('getPtvDetailsDiscoveryLinks');
    });

    it('uses canonical anchors and text content for visual entity and media cards', () => {
        expect(cinematicSource).toContain("createElement('a', `ptv-cinematic-card");
        expect(cinematicSource).toContain('resolvePtvItemRoute(card.item');
        expect(cinematicSource).toContain('element.textContent = text');
        expect(cinematicSource).not.toContain('innerHTML');
    });

    it('retires pending and rendered universe work through the existing Details generation', () => {
        expect(detailsSource).toContain('clearDetailsCinematicExperience(page)');
        expect(detailsSource).toContain('delete page.dataset.ptvDetailsCinematicPendingItemId');
        expect(detailsSource).toContain('owner.controller.signal');
        expect(detailsSource).not.toContain('ptvDetailsDiscoveryGeneration');
    });
});
