import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const tvStyles = fs.readFileSync(path.join(__dirname, 'tv.scss'), 'utf8');
const webOsStyles = fs.readFileSync(path.join(__dirname, 'webos.scss'), 'utf8');
const shellStyles = fs.readFileSync(path.join(__dirname, '../../shell/ptvShell.scss'), 'utf8');
const shellSource = fs.readFileSync(path.join(__dirname, '../../shell/PTVShell.tsx'), 'utf8');
const homeSource = fs.readFileSync(path.join(__dirname, '../../pages/home/NativeHome.tsx'), 'utf8');
const renderProfileSource = fs.readFileSync(path.join(__dirname, '../../core/renderProfile.ts'), 'utf8');

describe('PiggieTV TV compatibility profile', () => {
    it('uses fixed ten-foot hero and card geometry instead of fit-all shrinking', () => {
        expect(tvStyles).toContain('--ptv-tv-hero-height: 540px');
        expect(tvStyles).toContain('--ptv-tv-card-width: 172px');
        expect(tvStyles).toContain('--ptv-tv-card-height: 266px');
        expect(tvStyles).toContain('flex: 0 0 var(--ptv-tv-card-outer-width) !important');
        expect(tvStyles).toContain('grid-auto-columns: var(--ptv-tv-card-outer-width) !important');
        expect(tvStyles).toContain('height: var(--ptv-tv-card-height) !important');
    });

    it('suppresses the Jellyfin shell only while a native PTV TV route owns the page', () => {
        expect(tvStyles).toContain("html.ptv-render-tv[data-ptv-route-native='true'] .skinHeader");
        expect(tvStyles).toContain("html.ptv-render-tv[data-ptv-route-native='true'] .mainDrawer");
        expect(tvStyles).toContain('html.ptv-render-tv.ptv-native-shell-mounted .skinHeader');
        expect(tvStyles).toContain('visibility: hidden !important');
    });

    it('provides overscan, details, and remote-focus geometry for 720p, 1080p, and 4K', () => {
        expect(tvStyles).toContain('--ptv-tv-safe-x: 58px');
        expect(tvStyles).toContain('max-width: 1760px');
        expect(tvStyles).toContain('grid-template-columns: 306px minmax(0, 1040px)');
        expect(tvStyles).toContain('.ptv-tv-focus-visible');
        expect(tvStyles).toContain('--ptv-tv-focus-ring-core: rgb(184 116 255 / 98%)');
        expect(tvStyles).toContain('inset 0 1px 0 rgb(255 255 255 / 52%)');
        expect(tvStyles).toContain('transform: scale(1.035)');
        expect(tvStyles).toContain('transition: box-shadow 110ms ease-out');
        expect(tvStyles).toContain('@media (max-width: 1500px), (max-height: 820px)');
        expect(tvStyles).toContain('@media (min-width: 1680px) and (min-height: 950px)');
        expect(tvStyles).toContain('@media (min-width: 3000px) and (min-height: 1700px)');
    });

    it('uses a static webOS glass fallback without depending on backdrop-filter', () => {
        expect(webOsStyles).toContain('html.ptv-platform-webos');
        expect(webOsStyles).toContain('--ptv-webos-glass: rgb(39 21 62 / 76%)');
        expect(webOsStyles).toContain('--ptv-webos-glass-strong: rgb(48 25 76 / 86%)');
        expect(webOsStyles).toContain('lowering fill opacity gives the glass more depth');
        expect(webOsStyles).toContain('backdrop-filter: none !important');
        expect(webOsStyles).toContain('-webkit-backdrop-filter: none !important');
        expect(webOsStyles).toContain('animation: none !important');
        expect(webOsStyles).toContain('transition: opacity 180ms linear !important');
        expect(webOsStyles).toContain('transition: box-shadow 90ms linear');
    });

    it('prevents the shell brand intrinsic image size from owning the header track', () => {
        expect(shellStyles).toContain('grid-template-rows: minmax(0, auto)');
        expect(shellStyles).toContain('height: clamp(34px, 4vw, 58px)');
        expect(shellStyles).toContain('overflow: hidden');
        expect(shellStyles).toContain('width: 100%');
        expect(tvStyles).toContain('grid-template-rows: minmax(0, var(--ptv-tv-header-height))');
        expect(tvStyles).toContain('height: var(--ptv-tv-header-height)');
        expect(tvStyles).toContain('flex: 0 0 196px');
    });

    it('centers native WebOS shell buttons without relying on Grid item placement', () => {
        expect(webOsStyles).toMatch(
            /html\.ptv-render-tv\.ptv-platform-webos \.ptv-shell-icon-button\s*\{[^}]*align-items:\s*center;[^}]*display:\s*inline-flex;[^}]*justify-content:\s*center;/
        );
        expect(webOsStyles).toMatch(
            /html\.ptv-render-tv\.ptv-platform-webos \.ptv-shell-icon-button > \.ptv-icon\s*\{[^}]*margin:\s*0 !important;[^}]*position:\s*static !important;[^}]*top:\s*auto !important;/
        );
    });

    it('centers native WebOS video OSD buttons without changing their geometry', () => {
        const nativeVideoButtonRule = /html\.ptv-render-tv\.ptv-platform-webos \.videoOsdBottom \.paper-icon-button-light,\s*html\.ptv-render-tv\.ptv-platform-webos \.videoOsdBottom button\[is='paper-icon-button-light'\]\s*\{([^}]*)\}/
            .exec(webOsStyles)?.[1] || '';

        expect(nativeVideoButtonRule).toContain('align-items: center !important');
        expect(nativeVideoButtonRule).toContain('display: inline-flex !important');
        expect(nativeVideoButtonRule).toContain('justify-content: center !important');
        expect(nativeVideoButtonRule).toContain('line-height: 0 !important');
        expect(nativeVideoButtonRule).toContain('padding: 0 !important');
        expect(nativeVideoButtonRule).not.toMatch(/(?:^|\s)(?:height|margin|width)\s*:/);
    });

    it('gives mini-player artwork literal Chrome 68-safe WebOS dimensions', () => {
        expect(webOsStyles).toMatch(
            /html\.ptv-render-tv\.ptv-platform-webos \.ptv-media-dock-art\s*\{[^}]*aspect-ratio:\s*auto;[^}]*box-sizing:\s*border-box;[^}]*height:\s*4\.875rem;[^}]*min-height:\s*4\.875rem;[^}]*width:\s*3\.25rem;/
        );
    });

    it('uses literal Chrome 68-safe webOS geometry at 720p, 1080p, and 4K', () => {
        expect(webOsStyles).toContain('grid-template-columns: minmax(220px, 1fr) max-content minmax(220px, 1fr)');
        expect(webOsStyles).toContain('grid-template-rows: 80px');
        expect(webOsStyles).toContain('flex: 0 0 220px');
        expect(webOsStyles).toContain('height: 64px');
        expect(webOsStyles).toContain('max-width: 220px');
        expect(webOsStyles).toContain('left: 66px');
        expect(webOsStyles).toContain('right: 66px');
        expect(webOsStyles).toContain('top: 36px');
        expect(webOsStyles).toContain('grid-template-rows: 64px');
        expect(webOsStyles).toContain('grid-template-rows: 120px');
        expect(webOsStyles).toContain('max-width: 240px');
        expect(webOsStyles).not.toContain('1077px');
        expect(webOsStyles).not.toMatch(/(^|[^\d])500px/);
    });

    it('keeps physical layout markers stable without adding another layout owner', () => {
        expect(shellSource).toContain("className='ptv-shell-main ptv-shell-page-content'");
        expect(shellSource).toContain("data-ptv-layout-node='shell-main'");
        expect(homeSource).toContain("data-ptv-layout-node='home-root'");
        expect(homeSource).toContain("data-ptv-layout-node='home-hero'");
        expect(homeSource).toContain("data-ptv-layout-node='home-shelf'");
        expect(homeSource).toContain("data-ptv-layout-node='home-shelf-scroller'");
    });

    it('keeps the authoritative TV geometry class on webOS TV-tier profiles', () => {
        expect(renderProfileSource).toContain("root.classList.toggle('ptv-render-tv', renderProfile.tier === 'tv')");
        expect(renderProfileSource).toContain("className: 'ptv-render-webos'");
    });

    it('uses a static webOS focus ring that does not depend on scaling or blur', () => {
        expect(webOsStyles).toContain('outline: 3px solid rgb(244 228 255 / 98%) !important');
        expect(webOsStyles).toContain('border-color: rgb(232 204 255 / 94%) !important');
        expect(webOsStyles).toContain('transform: none !important');
    });

    it('keeps the WebOS Music tree free of compositor transitions and animations', () => {
        expect(webOsStyles).toContain('html.ptv-platform-webos .ptv-music-page *');
        expect(webOsStyles).toContain("html.ptv-platform-webos [data-ptv-music-player-root='true'] *");
        expect(webOsStyles).toContain('animation: none !important');
        expect(webOsStyles).toContain('transition: none !important');
    });

    it('anchors the persistent playback dock host to the viewport', () => {
        expect(shellStyles).toContain("[data-ptv-runtime-root-host='true']");
        expect(shellStyles).toMatch(
            /\[data-ptv-runtime-root-host='true'\]\s*\{[^}]*inset:\s*0;[^}]*position:\s*fixed;/
        );
        expect(shellStyles).toMatch(
            /\.ptv-shell-frame\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*2;/
        );
        expect(shellStyles).toMatch(
            /html\.ptv-render-tv\.ptv-platform-webos \[data-ptv-runtime-root-host='true'\]\s*\{[^}]*bottom:\s*0;[^}]*left:\s*0;[^}]*right:\s*0;[^}]*top:\s*0;[^}]*z-index:\s*3;/
        );
        expect(shellStyles).toMatch(
            /html\.ptv-render-tv\.ptv-platform-webos\.ptv-runtime-overlay-occluded \[data-ptv-runtime-root-host='true'\]\s*\{[^}]*z-index:\s*1;/
        );
        expect(shellStyles).toMatch(
            /\.ptv-runtime-root,\s*\.ptv-runtime-media-dock-slot\s*\{[^}]*inset:\s*0;[^}]*position:\s*absolute;/
        );
        expect(shellStyles).toMatch(
            /\.ptv-runtime-media-dock-slot \.ptv-media-dock\s*\{[^}]*position:\s*absolute;/
        );
        expect(webOsStyles).toMatch(
            /html\.ptv-platform-webos \.ptv-media-dock\s*\{[^}]*bottom:\s*36px;[^}]*right:\s*66px;[^}]*width:\s*560px;/
        );
    });
});
