import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const osdStyles = readFileSync(resolve(process.cwd(), 'src/styles/videoosd.scss'), 'utf8');

describe('video OSD glass treatment', () => {
    it('keeps the video visible behind readable purple glass controls', () => {
        expect(osdStyles).toMatch(/\.osdControls\s*\{[^}]*rgb\(65 31 118 \/ 30%\)/);
        expect(osdStyles).toMatch(/\.osdControls\s*\{[^}]*backdrop-filter:\s*blur\(20px\)/);
        expect(osdStyles).toMatch(/\.osdControls\s*\{[^}]*border:\s*1px solid rgb\(210 170 255 \/ 22%\)/);
        expect(osdStyles).not.toMatch(/\.osdControls\s*\{[^}]*rgb\([^)]*\/ (?:7[5-9]|8\d|9\d|100)%\)/);
    });
});
