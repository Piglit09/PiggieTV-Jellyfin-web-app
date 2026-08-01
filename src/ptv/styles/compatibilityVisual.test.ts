import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const compatibilityStyles = readFileSync(
    resolve(process.cwd(), 'src/ptv/styles/compatibility.scss'),
    'utf8'
);

const getRule = (selector: string) => {
    const start = compatibilityStyles.indexOf(`${selector} {`);
    const end = compatibilityStyles.indexOf('}', start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    return compatibilityStyles.slice(start, end + 1);
};

describe('WebOS compatibility cascade', () => {
    it('keeps the sidebar out of the blanket transform reset', () => {
        const blanketStart = compatibilityStyles.indexOf('.ptv-client-webos .ptv-hero-bg,');
        const blanketEnd = compatibilityStyles.indexOf('}', blanketStart);
        const blanketRule = compatibilityStyles.slice(blanketStart, blanketEnd + 1);

        expect(blanketStart).toBeGreaterThanOrEqual(0);
        expect(blanketEnd).toBeGreaterThan(blanketStart);
        expect(blanketRule).toContain('transform: none !important');
        expect(blanketRule).not.toContain('.ptv-client-webos .ptv-sidebar');
    });

    it('retains low-motion sidebar compatibility without owning its transform', () => {
        const sidebarCompatibilityRule = getRule('.ptv-client-webos .ptv-sidebar');

        expect(sidebarCompatibilityRule).toContain('animation: none !important');
        expect(sidebarCompatibilityRule).toContain('filter: none !important');
        expect(sidebarCompatibilityRule).toContain('transition: none !important');
        expect(sidebarCompatibilityRule).toContain('will-change: auto !important');
        expect(sidebarCompatibilityRule).not.toContain('transform:');
    });

    it('keeps the closed sidebar off-screen and out of hit testing', () => {
        const closedRule = getRule(
            '.ptv-client-webos .ptv-sidebar:not(.ptv-sidebar-open)'
        );

        expect(closedRule).toContain('transform: translateX(-105%) !important');
        expect(closedRule).toContain('pointer-events: none !important');
    });

    it('restores identity geometry and hit testing only for the open sidebar', () => {
        const openRule = getRule(
            '.ptv-client-webos .ptv-sidebar.ptv-sidebar-open'
        );

        expect(openRule).toContain('transform: translateX(0) !important');
        expect(openRule).toContain('pointer-events: auto !important');
    });
});
