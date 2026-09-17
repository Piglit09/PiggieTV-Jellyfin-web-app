import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(
    process.cwd(),
    'src/ptv/modules/settings/admin/libraryDisplay/adminLibraryDisplay.scss'
), 'utf8');

describe('Library Display responsive contract', () => {
    it('uses a two-column desktop grid without fixed card widths', () => {
        const gridStart = styles.indexOf('.ptv-admin-library-display-grid {');
        const gridEnd = styles.indexOf('}', gridStart);
        const desktopGrid = styles.slice(gridStart, gridEnd + 1);

        expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
        expect(styles).toContain('min-width: 0;');
        expect(gridStart).toBeGreaterThanOrEqual(0);
        expect(desktopGrid).not.toContain('\n    width:');
    });

    it('stacks panels and actions at the established tablet and mobile breakpoints', () => {
        const tabletStart = styles.indexOf('@media (max-width: 900px)');
        const mobileStart = styles.indexOf('@media (max-width: 420px)');
        const tabletStyles = styles.slice(tabletStart, styles.indexOf('@media (max-width: 760px)'));
        const mobileStyles = styles.slice(mobileStart, styles.indexOf('@media (prefers-reduced-motion: reduce)'));

        expect(styles).toContain('@media (max-width: 900px)');
        expect(styles).toContain('@media (max-width: 760px)');
        expect(styles).toContain('@media (max-width: 420px)');
        expect(tabletStyles).toContain('.ptv-admin-library-display-grid');
        expect(tabletStyles).toContain('grid-template-columns: 1fr;');
        expect(mobileStyles).toContain('.ptv-admin-library-display-actions > div');
        expect(mobileStyles).toContain('grid-template-columns: 1fr;');
    });
});
