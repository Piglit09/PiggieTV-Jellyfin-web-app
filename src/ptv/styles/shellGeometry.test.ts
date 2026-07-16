import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const shellSource = readFileSync(resolve(process.cwd(), 'src/ptv/styles/shell.scss'), 'utf8');

describe('PTV shell geometry ownership', () => {
    it('does not convert Jellyfin route containers into normal-flow shell content', () => {
        expect(shellSource).not.toMatch(/\.ptv-app-shell\s+\.mainAnimatedPages\s*,/);
        expect(shellSource).not.toMatch(/\.ptv-app-shell\s+\.page\s*,\s*\.ptv-shell-page/);
        expect(shellSource).not.toMatch(/\.mainAnimatedPage[^{}]*\{[^}]*min-height:\s*0/);
    });

    it('keeps relative positioning scoped to the PTV-owned shell page', () => {
        expect(shellSource).toMatch(/\.ptv-shell-page\s*\{[^}]*position:\s*relative/);
    });
});
