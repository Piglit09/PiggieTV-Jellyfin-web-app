import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const shellSource = readFileSync(resolve(process.cwd(), 'src/ptv/styles/shell.scss'), 'utf8');
const homeSource = readFileSync(resolve(process.cwd(), 'src/ptv/pages/home/nativeHome.scss'), 'utf8');
const browseSource = readFileSync(resolve(process.cwd(), 'src/ptv/pages/browse/nativeBrowse.scss'), 'utf8');
const searchSource = readFileSync(resolve(process.cwd(), 'src/ptv/pages/search/nativeSearch.scss'), 'utf8');
const musicSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/music/music.scss'), 'utf8');
const booksSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/books/books.scss'), 'utf8');
const collectionsSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/collections/collections.scss'), 'utf8');
const detailsSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/details/details-shell.scss'), 'utf8');
const settingsSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/settings/settings.scss'), 'utf8');

function readScssBlock(source: string, selector: string) {
    const selectorStart = source.indexOf(selector);
    if (selectorStart < 0) throw new Error(`Missing SCSS selector ${selector}`);
    const blockStart = source.indexOf('{', selectorStart);

    if (blockStart < 0) throw new Error(`Missing SCSS block for ${selector}`);
    let depth = 0;
    for (let index = blockStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(blockStart + 1, index);
    }
    throw new Error(`Unclosed SCSS block for ${selector}`);
}

describe('PTV shell geometry ownership', () => {
    it('does not convert Jellyfin route containers into normal-flow shell content', () => {
        expect(shellSource).not.toMatch(/\.ptv-app-shell\s+\.mainAnimatedPages\s*,/);
        expect(shellSource).not.toMatch(/\.ptv-app-shell\s+\.page\s*,\s*\.ptv-shell-page/);
        expect(shellSource).not.toMatch(/\.mainAnimatedPage[^{}]*\{[^}]*min-height:\s*0/);
    });

    it('keeps relative positioning scoped to the PTV-owned shell page', () => {
        expect(shellSource).toMatch(/\.ptv-shell-page\s*\{[^}]*position:\s*relative/);
    });

    it('shares one near-edge content-width contract across product routes', () => {
        expect(shellSource).toContain('--ptv-content-edge:');
        [homeSource, browseSource, searchSource, musicSource, booksSource, collectionsSource, detailsSource]
            .forEach(source => {
                expect(source).toContain('--ptv-content-edge');
            });
        expect(musicSource).not.toContain('width: min(100%, 1760px)');
        expect(booksSource).not.toContain('width: min(100%, 1800px)');
        expect(collectionsSource).not.toContain('width: calc(100% - clamp(2rem, 7vw, 8rem))');
    });

    it('places Home utilities below the shared shell header clearance', () => {
        expect(shellSource).toMatch(/--ptv-utility-safe-top:\s*calc\(var\(--ptv-shell-header-clearance,/);
        expect(shellSource).not.toContain('--ptv-shell-header-clearance-height: 126px');
        expect(homeSource).toMatch(/\.ptv-native-home-controls\s*\{[^}]*top:\s*var\(--ptv-utility-safe-top/);
        expect(browseSource).toMatch(/\.ptv-browse-directory-tools\s*\{[^}]*top:\s*calc\(var\(--ptv-shell-header-clearance,/);
        expect(browseSource).toMatch(/\.ptv-browse-directory-section\s*\{[^}]*scroll-margin-top:\s*calc\(var\(--ptv-shell-header-clearance,/);
    });

    it('keeps the mobile settings scrollport inset scoped to the settings page', () => {
        const mobileBlock = readScssBlock(settingsSource, '@media (max-width: 720px)');
        const settingsPageBlock = readScssBlock(mobileBlock, '#ptvSettingsPage.ptv-settings-page');

        expect(settingsPageBlock).toMatch(/margin-top:\s*126px/);
        expect(settingsPageBlock).toMatch(/height:\s*calc\(100% - 126px\)/);
        expect(settingsPageBlock).toMatch(/min-height:\s*0/);
        expect(settingsPageBlock).toMatch(/overflow-y:\s*auto/);
        expect(mobileBlock).not.toMatch(/\.ptv-admin-library-row\s*\{[^}]*margin-top:\s*126px/);
    });
});
