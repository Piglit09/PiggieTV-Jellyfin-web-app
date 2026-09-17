import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const osdStyles = readFileSync(resolve(process.cwd(), 'src/styles/videoosd.scss'), 'utf8');

describe('video OSD glass treatment', () => {
    it('keeps one shared glass surface over the visible video', () => {
        expect(osdStyles).toMatch(/\.osdControls\s*\{[^}]*var\(--ptv-glass-bg-strong/);
        expect(osdStyles).toMatch(/\.osdControls\s*\{[^}]*backdrop-filter:\s*blur\(20px\)/);
        expect(osdStyles).toMatch(/\.osdControls\s*\{[^}]*border:\s*1px solid var\(--ptv-glass-border/);
        expect(osdStyles).toMatch(/\.osdControls\s*\{[^}]*rgb\(25 12 58 \/ 72%\)/);
        expect(osdStyles).not.toMatch(/\.osdControls\s*\{[^}]*rgb\([^)]*\/ (?:7[5-9]|8\d|9\d|100)%\)/);
        expect(osdStyles).not.toMatch(/\.videoOsdBottom\s*\{[^}]*backdrop-filter/);
    });
});
