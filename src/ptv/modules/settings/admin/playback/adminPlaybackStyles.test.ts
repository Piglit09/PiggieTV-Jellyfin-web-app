import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(
    process.cwd(),
    'src/ptv/modules/settings/admin/playback/adminPlayback.scss'
), 'utf8');

describe('native Playback responsive style contract', () => {
    it('keeps route tabs usable without widening the page', () => {
        expect(styles).toContain('.ptv-admin-playback-tabs');
        expect(styles).toContain('max-width: 100%;');
        expect(styles).toContain('overflow-x: auto;');
        expect(styles).toContain('min-width: max-content;');
    });

    it('uses fluid zero-minimum grids that stack for tablet and mobile', () => {
        expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
        expect(styles).toContain('@media (max-width: 900px)');
        expect(styles).toContain('@media (max-width: 760px)');
        expect(styles).toContain('@media (max-width: 420px)');
        expect(styles).toContain('grid-template-columns: 1fr;');
    });

    it('retains touch, focus, and reduced-motion behavior', () => {
        expect(styles).toContain('min-height: var(--ptv-touch-target-min, 44px);');
        expect(styles).toContain('outline: var(--ptv-a11y-focus-outline);');
        expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    });
});
