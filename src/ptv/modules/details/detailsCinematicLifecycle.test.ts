import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/ptv/modules/details/index.js'), 'utf8');

describe('cinematic Details lifecycle ownership', () => {
    it('keeps the experience route-lazy and under the existing Details generation', () => {
        expect(source).toContain("import('./detailsCinematicExperience')");
        expect(source).not.toContain("from './detailsCinematicExperience'");
        expect(source).toContain('owner.controller.signal');
        expect(source).toContain('isCurrentDetailItem(page, itemId, owner)');
        expect(source).toContain('recordPtvRequestLedgerStaleRejected();');
        expect(source).toContain('rejectStaleDetailCompletion(page, itemId, owner)');
    });

    it('allows the existing recommendation owner to populate a direct Details entry', () => {
        const experience = readFileSync(resolve(process.cwd(), 'src/ptv/modules/details/detailsCinematicExperience.ts'), 'utf8');

        expect(experience).toContain('includeHomeScans: true');
        expect(experience).toContain('signal: requestSignal');
        expect(experience).toContain("options.signal?.addEventListener('abort', retireSource, { once: true })");
        expect(experience).toContain('enrichmentController.abort()');
        expect(experience).toContain('getPtvRecommendationHomeData');
        expect(experience).toContain('getPtvAuthoritativeRelationships');
    });

    it('retires pending and rendered cinematic work with the existing page owner', () => {
        expect(source).toContain('clearDetailsCinematicExperience(page)');
        expect(source).toContain('delete page.dataset.ptvDetailsCinematicPendingItemId');
        expect(source).toContain('renderDetailsCinematicExperience(page, itemId, item, owner)');
    });
});
