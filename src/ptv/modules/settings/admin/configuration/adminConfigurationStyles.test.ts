import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(
    process.cwd(),
    'src/ptv/modules/settings/admin/configuration/adminConfiguration.scss'
), 'utf8');

describe('shared administration configuration responsive contract', () => {
    it('uses a fluid two-column desktop grid with zero-minimum tracks', () => {
        const gridStart = styles.indexOf('.ptv-admin-configuration-grid {');
        const gridEnd = styles.indexOf('}', gridStart);
        const desktopGrid = styles.slice(gridStart, gridEnd + 1);

        expect(gridStart).toBeGreaterThanOrEqual(0);
        expect(desktopGrid).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
        expect(desktopGrid).not.toContain('\n    width:');
        expect(styles).toContain('min-width: 0;');
    });

    it('stacks panels and controls across the established responsive breakpoints', () => {
        const tabletStart = styles.indexOf('@media (max-width: 900px)');
        const compactStart = styles.indexOf('@media (max-width: 760px)');
        const mobileStart = styles.indexOf('@media (max-width: 420px)');
        const tabletStyles = styles.slice(tabletStart, compactStart);
        const compactStyles = styles.slice(compactStart, styles.indexOf('@media (max-width: 520px)'));
        const mobileStyles = styles.slice(mobileStart, styles.indexOf('@media (prefers-reduced-motion: reduce)'));

        expect(tabletStyles).toContain('.ptv-admin-configuration-grid');
        expect(tabletStyles).toContain('grid-template-columns: 1fr;');
        expect(compactStyles).toContain('.ptv-admin-configuration-field');
        expect(compactStyles).toContain('grid-template-columns: 1fr;');
        expect(mobileStyles).toContain('.ptv-admin-configuration-actions > div');
        expect(mobileStyles).toContain('grid-template-columns: 1fr;');
    });

    it('keeps controls at the shared minimum touch target and visible focus contract', () => {
        expect(styles).toContain('min-height: var(--ptv-touch-target-min, 44px);');
        expect(styles).toContain('height: var(--ptv-touch-target-min, 44px);');
        expect(styles).toContain('.ptv-admin-configuration-switch input:focus-visible + span');
        expect(styles).toContain('outline: var(--ptv-a11y-focus-outline);');
        expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    });
});
