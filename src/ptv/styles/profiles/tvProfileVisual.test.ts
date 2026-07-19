import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const tvStyles = fs.readFileSync(path.join(__dirname, 'tv.scss'), 'utf8');
const webOsStyles = fs.readFileSync(path.join(__dirname, 'webos.scss'), 'utf8');

describe('PiggieTV TV compatibility profile', () => {
    it('uses fixed ten-foot hero and card geometry instead of fit-all shrinking', () => {
        expect(tvStyles).toContain('--ptv-tv-hero-height: 580px');
        expect(tvStyles).toContain('--ptv-tv-card-width: 190px');
        expect(tvStyles).toContain('--ptv-tv-card-height: 285px');
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
        expect(tvStyles).toContain('--ptv-tv-safe-x: 64px');
        expect(tvStyles).toContain('max-width: 1780px');
        expect(tvStyles).toContain('grid-template-columns: 320px minmax(0, 1040px)');
        expect(tvStyles).toContain('.ptv-tv-focus-visible');
        expect(tvStyles).toContain('@media (max-width: 1500px), (max-height: 820px)');
        expect(tvStyles).toContain('@media (min-width: 3000px) and (min-height: 1800px)');
    });

    it('uses a static webOS glass fallback without depending on backdrop-filter', () => {
        expect(webOsStyles).toContain('html.ptv-platform-webos');
        expect(webOsStyles).toContain('backdrop-filter: none !important');
        expect(webOsStyles).toContain('-webkit-backdrop-filter: none !important');
        expect(webOsStyles).toContain('animation: none !important');
        expect(webOsStyles).toContain('transition: opacity 180ms linear !important');
    });
});
