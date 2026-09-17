import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('P2 shared presentation policy', () => {
    it('owns responsive route width and touch sizing through shared tokens', () => {
        const tokens = read('src/ptv/styles/tokens.scss');
        const shell = read('src/ptv/styles/shell.scss');
        const userMenu = read('src/ptv/shell/ptvShell.scss');

        expect(tokens).toContain('--ptv-layout-content-edge: 1.5rem');
        expect(tokens).toContain('--ptv-touch-target-min: 44px');
        expect(shell).toContain('--ptv-content-edge: var(--ptv-layout-content-edge)');
        expect(shell).toContain('.ptv-music-page');
        expect(shell).toContain('max-width: none');
        expect(userMenu).toContain('min-block-size: var(--ptv-touch-target-min)');
    });

    it('uses the shared panel elevation instead of page-local 32px row blur', () => {
        const home = read('src/ptv/pages/home/nativeHome.scss');
        const browse = read('src/ptv/pages/browse/nativeBrowse.scss');

        expect(home).not.toContain('backdrop-filter: blur(32px)');
        expect(browse).not.toContain('backdrop-filter: blur(32px)');
        expect(home).toContain('var(--ptv-elevation-2-blur)');
        expect(browse).toContain('var(--ptv-elevation-2-blur)');
    });
});
