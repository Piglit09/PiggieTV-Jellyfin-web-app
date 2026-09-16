import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const musicStyles = readFileSync(
    resolve(process.cwd(), 'src/ptv/modules/music/music.scss'),
    'utf8'
).replace(/\r\n?/g, '\n');
const WEBOS_PLAYER_SELECTOR = 'html.ptv-render-tv.ptv-platform-webos .ptv-music-fullscreen-player';
const WEBOS_SHELL_SELECTOR = 'html.ptv-render-tv.ptv-platform-webos .ptv-shell-frame-fullscreen-music';
const WEBOS_REGULAR_MUSIC_SELECTOR = 'html.ptv-render-tv.ptv-platform-webos .ptv-music-shell:not(.ptv-shell-frame-fullscreen-music)';
const WEBOS_MUSIC_SHELL_SELECTOR = 'html.ptv-render-tv.ptv-platform-webos .ptv-music-shell';
const FULL_PLAYER_SELECTOR = "html[data-ptv-playback-surface='full-screen-player'] .ptv-music-fullscreen-player";
const FULL_PLAYER_PAGE_SELECTOR = "html[data-ptv-playback-surface='full-screen-player'] #ptvMusicPage";

function escapePattern(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getRuleBody(selector: string) {
    const match = new RegExp(`${escapePattern(selector)}\\s*\\{([^}]*)\\}`).exec(musicStyles);

    expect(match, `Expected a style rule for ${selector}`).not.toBeNull();

    return match?.[1] || '';
}

function getLastRuleBody(selector: string) {
    const matches = Array.from(
        musicStyles.matchAll(new RegExp(`${escapePattern(selector)}\\s*\\{([^}]*)\\}`, 'g'))
    );
    const match = matches[matches.length - 1];

    expect(match, `Expected a style rule for ${selector}`).not.toBeUndefined();

    return match?.[1] || '';
}

function getStandaloneRuleBody(selector: string) {
    const match = new RegExp(`(?:^|\\n)${escapePattern(selector)}\\s*\\{([^}]*)\\}`).exec(musicStyles);

    expect(match, `Expected a standalone style rule for ${selector}`).not.toBeNull();

    return match?.[1] || '';
}

describe('WebOS full-screen Music layout', () => {
    it('bounds the mounted player to the 1920x1080 viewport without relying on inset', () => {
        const playerRule = getRuleBody(WEBOS_PLAYER_SELECTOR);

        expect(playerRule).toMatch(/position:\s*fixed/);
        expect(playerRule).toMatch(/top:\s*0/);
        expect(playerRule).toMatch(/right:\s*0/);
        expect(playerRule).toMatch(/bottom:\s*0/);
        expect(playerRule).toMatch(/left:\s*0/);
        expect(playerRule).toMatch(/width:\s*100vw/);
        expect(playerRule).toMatch(/height:\s*100vh/);
        expect(playerRule).toMatch(/overflow:\s*hidden/);
        expect(playerRule).toMatch(/padding:\s*172px 66px 36px/);
        expect(playerRule).toMatch(/font-size:\s*18px/);
        expect(playerRule).not.toMatch(/\binset\s*:/);
    });

    it('keeps artwork square when Chrome 68 ignores aspect-ratio', () => {
        const artRule = getRuleBody(`${WEBOS_PLAYER_SELECTOR} .ptv-music-now-playing-art`);
        const viewportHeight = 1080;
        const renderedWidth = Math.min(viewportHeight * 0.36, 400);
        const renderedHeight = Math.min(viewportHeight * 0.36, 400);

        expect(artRule).toMatch(/width:\s*36vh/);
        expect(artRule).toMatch(/height:\s*36vh/);
        expect(artRule).toMatch(/max-width:\s*400px/);
        expect(artRule).toMatch(/max-height:\s*400px/);
        expect(artRule).not.toMatch(/aspect-ratio|min\(|clamp\(/);
        expect(renderedWidth).toBe(renderedHeight);
        expect(renderedWidth).toBeLessThanOrEqual(400);
    });

    it('lets a long queue consume the bounded remainder through one scrolling region', () => {
        const panelRule = getRuleBody(`${WEBOS_PLAYER_SELECTOR} .ptv-music-player-panel`);
        const listRule = getRuleBody(`${WEBOS_PLAYER_SELECTOR} .ptv-music-queue-list`);
        const viewportHeight = 1080;
        const queueViewportHeight = viewportHeight * 0.56;
        const longQueueContentHeight = (24 * 76) + (23 * 6);

        expect(panelRule).toMatch(/max-height:\s*100%/);
        expect(panelRule).toMatch(/overflow:\s*hidden/);
        expect(listRule).toMatch(/flex:\s*1 1 auto/);
        expect(listRule).toMatch(/gap:\s*6px/);
        expect(listRule).toMatch(/min-height:\s*0/);
        expect(listRule).toMatch(/max-height:\s*none/);
        expect(listRule).toMatch(/overflow-y:\s*auto/);
        expect(longQueueContentHeight).toBeGreaterThan(queueViewportHeight);
    });

    it('uses literal progress width and a Chrome 68-safe production queue row', () => {
        const progressRule = getRuleBody(
            `${WEBOS_PLAYER_SELECTOR} .ptv-music-now-playing-progress,\n${WEBOS_PLAYER_SELECTOR} .ptv-music-volume-strip`
        );
        const itemRule = getRuleBody(`${WEBOS_PLAYER_SELECTOR} .ptv-music-queue-item`);
        const mainRule = getRuleBody(`${WEBOS_PLAYER_SELECTOR} .ptv-music-queue-item-main`);
        const copyRule = getRuleBody(
            `${WEBOS_PLAYER_SELECTOR} .ptv-music-queue-item-main > span:nth-child(2)`
        );

        expect(progressRule).toMatch(/width:\s*420px/);
        expect(progressRule).toMatch(/max-width:\s*100%/);
        expect(itemRule).toMatch(/display:\s*flex/);
        expect(itemRule).toMatch(/gap:\s*0/);
        expect(itemRule).toMatch(/height:\s*76px/);
        expect(itemRule).toMatch(/min-height:\s*76px/);
        expect(itemRule).toMatch(/max-height:\s*76px/);
        expect(mainRule).toMatch(/display:\s*flex/);
        expect(mainRule).toMatch(/flex:\s*1 1 auto/);
        expect(mainRule).toMatch(/width:\s*0/);
        expect(copyRule).toMatch(/flex:\s*1 1 auto/);
        expect(copyRule).toMatch(/width:\s*0/);
        expect(copyRule).toMatch(/overflow:\s*hidden/);
    });

    it('pins both shell navigation rows above the full-screen player', () => {
        const headerRule = getRuleBody(`${WEBOS_SHELL_SELECTOR} .ptv-shell-header`);
        const contextRule = getRuleBody(`${WEBOS_SHELL_SELECTOR} .ptv-shell-context-nav`);

        expect(headerRule).toMatch(/position:\s*fixed/);
        expect(headerRule).toMatch(/top:\s*36px/);
        expect(contextRule).toMatch(/position:\s*fixed/);
        expect(contextRule).toMatch(/top:\s*124px/);
    });

    it('centers full-screen transport buttons with a Chrome 68-safe Flex fallback', () => {
        const actionRule = getRuleBody(
            `${WEBOS_PLAYER_SELECTOR} .ptv-music-action,\n${WEBOS_PLAYER_SELECTOR} .ptv-music-volume-strip > button`
        );

        expect(actionRule).toMatch(/display:\s*inline-flex/);
        expect(actionRule).toMatch(/align-items:\s*center/);
        expect(actionRule).toMatch(/justify-content:\s*center/);
    });
});

describe('Browser full-screen Music layout', () => {
    it('fixes the player to the viewport and clips every outer route surface', () => {
        const playerRule = getRuleBody(FULL_PLAYER_SELECTOR);
        const pageRule = getRuleBody(FULL_PLAYER_PAGE_SELECTOR);

        expect(playerRule).toMatch(/position:\s*fixed/);
        expect(playerRule).toMatch(/top:\s*0/);
        expect(playerRule).toMatch(/right:\s*0/);
        expect(playerRule).toMatch(/bottom:\s*0/);
        expect(playerRule).toMatch(/left:\s*0/);
        expect(playerRule).toMatch(/height:\s*100%/);
        expect(playerRule).toMatch(/max-height:\s*100vh/);
        expect(playerRule).toMatch(/overflow:\s*hidden/);
        expect(pageRule).toMatch(/height:\s*100vh/);
        expect(pageRule).toMatch(/overflow:\s*hidden !important/);
    });

    it('uses the panel remainder as the only full-player queue scroll owner', () => {
        const panelRule = getStandaloneRuleBody('.ptv-music-player-panel');
        const tabPanelRule = getRuleBody('.ptv-music-list-up-next');
        const queueRule = getRuleBody('.ptv-music-player-panel .ptv-music-queue-list');

        expect(panelRule).toMatch(/display:\s*flex/);
        expect(panelRule).toMatch(/flex-direction:\s*column/);
        expect(panelRule).toMatch(/height:\s*100%/);
        expect(panelRule).toMatch(/min-height:\s*0/);
        expect(panelRule).toMatch(/overflow:\s*hidden/);
        expect(tabPanelRule).toMatch(/flex:\s*1 1 auto/);
        expect(tabPanelRule).toMatch(/overflow:\s*hidden/);
        expect(queueRule).toMatch(/flex:\s*1 1 auto/);
        expect(queueRule).toMatch(/max-height:\s*none/);
        expect(queueRule).toMatch(/overflow-y:\s*auto/);
    });

    it('keeps row actions at the shared target size and hides quick mutations on phones', () => {
        const actionRule = getLastRuleBody('.ptv-music-queue-item-actions button');

        expect(actionRule).toMatch(/width:\s*44px/);
        expect(actionRule).toMatch(/min-width:\s*44px/);
        expect(actionRule).toMatch(/height:\s*44px/);
        expect(actionRule).toMatch(/min-height:\s*44px/);
        expect(musicStyles).toMatch(
            /html\[data-ptv-playback-surface='full-screen-player'\] \.ptv-music-queue-quick-action\s*\{\s*display:\s*none;/
        );
    });

    it('keeps queue, panel, and menu controls at or above the shared touch target', () => {
        const queuePrimaryRule = getRuleBody('.ptv-music-player-panel .ptv-music-queue-item-main');
        const panelActionRule = getRuleBody('.ptv-music-player-panel-actions button');
        const menuItemRule = getRuleBody(
            '.ptv-music-item-menu-popover button,\n.ptv-music-item-menu-popover a'
        );
        const nestedMenuItemRule = getRuleBody(
            '.ptv-music-card-actions .ptv-music-item-menu-popover button,\n.ptv-music-track-actions .ptv-music-item-menu-popover button'
        );

        expect(queuePrimaryRule).toMatch(/min-height:\s*48px/);
        expect(panelActionRule).toMatch(/min-height:\s*var\(--ptv-touch-target-min\)/);
        expect(menuItemRule).toMatch(/min-height:\s*var\(--ptv-touch-target-min\)/);
        expect(nestedMenuItemRule).toMatch(/min-height:\s*var\(--ptv-touch-target-min\)/);
    });
});

describe('WebOS regular Music header layout', () => {
    it('restores the intended context row, page reserve, and bounded content width', () => {
        const contextRule = getRuleBody(`${WEBOS_REGULAR_MUSIC_SELECTOR} > .ptv-shell-context-nav`);
        const bodyRule = getRuleBody(`${WEBOS_REGULAR_MUSIC_SELECTOR} .ptv-music-body`);
        const scrollRule = getRuleBody(`${WEBOS_REGULAR_MUSIC_SELECTOR} .ptv-music-main-scroll`);

        expect(contextRule).toMatch(/top:\s*124px/);
        expect(contextRule).toMatch(/right:\s*66px/);
        expect(contextRule).toMatch(/left:\s*66px/);
        expect(bodyRule).toMatch(/padding-top:\s*164px/);
        expect(scrollRule).toMatch(/width:\s*100%/);
        expect(scrollRule).toMatch(/max-width:\s*none/);
        expect(scrollRule).toMatch(/padding:\s*28px var\(--ptv-content-edge[^;]*120px/);
        expect(contextRule).not.toMatch(/clamp\(|min\(/);
        expect(bodyRule).not.toMatch(/clamp\(|min\(/);
        expect(scrollRule).not.toMatch(/clamp\(|min\(/);
    });

    it('uses explicit link and icon margins because WebOS does not apply Flex gap', () => {
        const navRule = getRuleBody(`${WEBOS_MUSIC_SHELL_SELECTOR} > .ptv-shell-context-nav`);
        const linkRule = getRuleBody(`${WEBOS_MUSIC_SHELL_SELECTOR} > .ptv-shell-context-nav > .ptv-shell-context-link`);
        const siblingRule = getRuleBody(
            `${WEBOS_MUSIC_SHELL_SELECTOR} > .ptv-shell-context-nav > .ptv-shell-context-link + .ptv-shell-context-link`
        );
        const iconRule = getRuleBody(
            `${WEBOS_MUSIC_SHELL_SELECTOR} > .ptv-shell-context-nav > .ptv-shell-context-link > .ptv-icon + span`
        );

        expect(navRule).toMatch(/gap:\s*0/);
        expect(navRule).toMatch(/padding-right:\s*0/);
        expect(navRule).toMatch(/padding-left:\s*0/);
        expect(linkRule).toMatch(/gap:\s*0/);
        expect(siblingRule).toMatch(/margin-left:\s*8px/);
        expect(iconRule).toMatch(/margin-left:\s*8px/);
    });
});

describe('Music item menu overlay', () => {
    it('uses a Chrome 68-safe fixed body overlay instead of ancestor-relative placement', () => {
        const overlayRule = getLastRuleBody('.ptv-music-item-menu-overlay');

        expect(overlayRule).toMatch(/position:\s*fixed/);
        expect(overlayRule).toMatch(/right:\s*auto/);
        expect(overlayRule).toMatch(/bottom:\s*auto/);
        expect(overlayRule).toMatch(/z-index:\s*10060/);
        expect(overlayRule).toMatch(/max-width:\s*calc\(100vw - 28px\)/);
        expect(overlayRule).toMatch(/overflow-y:\s*auto/);
        expect(overlayRule).not.toMatch(/clamp\(|\bmin\(/);
    });
});
