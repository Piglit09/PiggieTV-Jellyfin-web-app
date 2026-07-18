import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const shellStyles = fs.readFileSync(path.join(__dirname, 'ptvShell.scss'), 'utf8');
const detailsStyles = fs.readFileSync(path.join(__dirname, '../modules/details/details-shell.scss'), 'utf8');
const iconStyles = fs.readFileSync(path.join(__dirname, '../modules/icons/icons.scss'), 'utf8');

function getRuleBodies(source: string, selector: string) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return Array.from(source.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g')), match => match[1]);
}

describe('PiggieTV shell surface hierarchy', () => {
    it('keeps every shared header root visually transparent', () => {
        const headerRules = getRuleBodies(shellStyles, '.ptv-shell-header');

        expect(headerRules.length).toBeGreaterThan(1);
        headerRules.forEach(rule => {
            if (/background\s*:/.test(rule)) expect(rule).toMatch(/background\s*:\s*transparent/);
            if (/border\s*:/.test(rule)) expect(rule).toMatch(/border\s*:\s*0/);
            if (/box-shadow\s*:/.test(rule)) expect(rule).toMatch(/box-shadow\s*:\s*none/);
            if (/backdrop-filter\s*:/.test(rule)) expect(rule).toMatch(/backdrop-filter\s*:\s*none/);
        });
    });

    it('centers the primary glass pill and gives utility icons their own glass', () => {
        const headerRule = getRuleBodies(shellStyles, '.ptv-shell-header')[0];
        const primaryRule = getRuleBodies(shellStyles, '.ptv-shell-header-primary')[0];
        const navigationRule = getRuleBodies(shellStyles, '.ptv-shell-nav-primary')[0];
        const iconRule = getRuleBodies(shellStyles, '.ptv-shell-icon-button').find(rule => /rgb\(35 18 58/.test(rule));

        expect(headerRule).toContain('grid-template-columns: minmax(0, 1fr) max-content minmax(0, 1fr)');
        expect(primaryRule).toContain('justify-self: center');
        expect(navigationRule).toContain('background: var(--ptv-glass-shell-bg)');
        expect(navigationRule).toContain('backdrop-filter: blur(var(--ptv-glass-blur))');
        expect(iconRule).toBeDefined();
        expect(iconRule).toContain('rgb(35 18 58 / 36%)');
        expect(iconRule).toContain('border-color: rgb(210 170 255 / 22%)');
        expect(iconRule).toContain('backdrop-filter: blur(');
        expect(iconRule).toContain('display: grid');
        expect(iconRule).toContain('line-height: 0');
        expect(iconRule).toContain('place-items: center');
    });

    it('does not let details styles recreate a wide header surface', () => {
        expect(detailsStyles).not.toContain('.ptv-details-shell-root .ptv-shell-header');
        expect(detailsStyles).toContain('.ptv-details-backdrop');
        expect(detailsStyles).toContain('--ptv-details-glass-bg');
        expect(detailsStyles).toContain('.ptv-details-glass');
    });

    it('neutralizes the global icon margin inside every shell utility button', () => {
        expect(iconStyles).toMatch(/\.ptv-shell-icon-button \.ptv-icon,[\s\S]*?margin:\s*0 !important/);
        expect(iconStyles).toContain('.ptv-shell-search-trigger .ptv-icon');
        expect(iconStyles).toContain('.ptv-shell-search-clear .ptv-icon');
    });
});
