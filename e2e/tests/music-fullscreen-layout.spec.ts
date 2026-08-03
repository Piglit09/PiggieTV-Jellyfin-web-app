import { expect, test } from '@playwright/test';

const WEBOS_UA = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/68.0 Safari/537.36 WebAppManager';

test.describe('WebOS full-screen Music layout', () => {
    test.use({
        userAgent: WEBOS_UA,
        viewport: { height: 1080, width: 1920 }
    });

    test('keeps physical-profile navigation, controls, and compact queue rows inside the viewport', async ({ page }) => {
        await page.goto('/#/e2e/music-fullscreen-layout');
        await page.addStyleTag({
            content: 'html.ptv-platform-webos .ptv-music-now-playing-art { aspect-ratio: auto !important; }'
        });
        const player = page.locator('.ptv-music-fullscreen-player');
        const initialControl = page.getByRole('button', { name: 'Pause' });

        await expect(player).toBeVisible();
        await expect(page.locator('.ptv-music-queue-item')).toHaveCount(24);
        await initialControl.focus();
        await initialControl.evaluate(element => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
        await page.evaluate(() => {
            document.querySelector<HTMLElement>('#ptvMusicPage')!.scrollTop = 105;
        });
        const geometry = await page.evaluate(() => {
            const getRect = (selector: string) => {
                const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();

                return {
                    bottom: rect.bottom,
                    height: rect.height,
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    width: rect.width
                };
            };
            const playerElement = document.querySelector<HTMLElement>('.ptv-music-fullscreen-player')!;
            const artElement = document.querySelector<HTMLElement>('.ptv-music-now-playing-art')!;
            const queueElement = document.querySelector<HTMLElement>('.ptv-music-queue-list')!;
            const cardElement = document.querySelector<HTMLElement>('.ptv-music-queue-item:nth-child(2)')!;
            const cardMainElement = cardElement.querySelector<HTMLElement>('.ptv-music-queue-item-main')!;
            const headerElement = document.querySelector<HTMLElement>(
                '.ptv-shell-frame-fullscreen-music .ptv-shell-header'
            )!;
            const contextNavElement = document.querySelector<HTMLElement>(
                '.ptv-shell-frame-fullscreen-music .ptv-shell-context-nav'
            )!;
            const musicPageElement = document.querySelector<HTMLElement>('#ptvMusicPage')!;
            const playerStyles = getComputedStyle(playerElement);
            const artStyles = getComputedStyle(artElement);
            const queueStyles = getComputedStyle(queueElement);
            const cardStyles = getComputedStyle(cardElement);
            const cardMainStyles = getComputedStyle(cardMainElement);
            const getIconCenter = (controlSelector: string) => {
                const control = document.querySelector<HTMLElement>(controlSelector)!;
                const icon = control.querySelector<HTMLElement>('.ptv-icon')!;
                const controlRect = control.getBoundingClientRect();
                const iconRect = icon.getBoundingClientRect();

                return {
                    display: getComputedStyle(control).display,
                    height: iconRect.height,
                    width: iconRect.width,
                    x: (iconRect.left + (iconRect.width / 2)) - (controlRect.left + (controlRect.width / 2)),
                    y: (iconRect.top + (iconRect.height / 2)) - (controlRect.top + (controlRect.height / 2))
                };
            };

            return {
                art: getRect('.ptv-music-now-playing-art'),
                artAspectRatio: artStyles.aspectRatio,
                card: getRect('.ptv-music-queue-item:nth-child(2)'),
                cardActions: getRect('.ptv-music-queue-item:nth-child(2) .ptv-music-queue-item-actions'),
                cardCopy: getRect('.ptv-music-queue-item:nth-child(2) .ptv-music-queue-item-main > span:nth-child(2)'),
                cardDisplay: cardStyles.display,
                cardIndex: getRect('.ptv-music-queue-item:nth-child(2) .ptv-music-queue-item-main > span:first-child'),
                cardMain: getRect('.ptv-music-queue-item:nth-child(2) .ptv-music-queue-item-main'),
                cardMainDisplay: cardMainStyles.display,
                contextNav: getRect('.ptv-shell-frame-fullscreen-music .ptv-shell-context-nav'),
                contextNavPosition: getComputedStyle(contextNavElement).position,
                header: getRect('.ptv-shell-frame-fullscreen-music .ptv-shell-header'),
                headerPosition: getComputedStyle(headerElement).position,
                iconCenters: {
                    mute: getIconCenter('.ptv-music-volume-strip button[aria-label="Mute"]'),
                    notifications: getIconCenter('.ptv-shell-icon-button[aria-label="Notifications"]'),
                    pause: getIconCenter('.ptv-music-action[aria-label="Pause"]'),
                    profile: getIconCenter('.ptv-shell-icon-button[aria-label="User menu"]'),
                    shuffle: getIconCenter('.ptv-music-action[aria-label="Shuffle"]')
                },
                musicPageScrollTop: musicPageElement.scrollTop,
                panel: getRect('.ptv-music-player-panel'),
                player: getRect('.ptv-music-fullscreen-player'),
                playerFontSize: playerStyles.fontSize,
                playerOverflow: playerStyles.overflow,
                playerPosition: playerStyles.position,
                playerScrollHeight: playerElement.scrollHeight,
                playerScrollWidth: playerElement.scrollWidth,
                progress: getRect('.ptv-music-now-playing-progress'),
                pageScrollY: window.scrollY,
                queue: getRect('.ptv-music-queue-list'),
                queueClientHeight: queueElement.clientHeight,
                queueOverflowY: queueStyles.overflowY,
                queueScrollHeight: queueElement.scrollHeight,
                rootFontSize: getComputedStyle(document.documentElement).fontSize,
                volume: getRect('.ptv-music-volume-strip'),
                viewport: {
                    height: window.innerHeight,
                    width: window.innerWidth
                }
            };
        });

        expect(geometry.viewport).toEqual({ height: 1080, width: 1920 });
        expect(geometry.playerPosition).toBe('fixed');
        expect(geometry.playerOverflow).toBe('hidden');
        expect(geometry.player).toEqual({
            bottom: 1080,
            height: 1080,
            left: 0,
            right: 1920,
            top: 0,
            width: 1920
        });
        expect(geometry.playerScrollWidth).toBeLessThanOrEqual(geometry.player.width + 1);
        expect(geometry.playerScrollHeight).toBeLessThanOrEqual(geometry.player.height + 1);
        expect(geometry.pageScrollY).toBe(0);
        expect(geometry.musicPageScrollTop).toBe(105);
        expect(geometry.rootFontSize).toBe('21px');
        expect(geometry.playerFontSize).toBe('18px');
        await expect(initialControl).toBeFocused();
        expect(Math.abs(geometry.art.width - geometry.art.height)).toBeLessThanOrEqual(1);
        expect(geometry.art.width).toBeLessThanOrEqual(400);
        expect(geometry.art.height).toBeLessThanOrEqual(400);
        expect(geometry.artAspectRatio).toBe('auto');
        expect(geometry.progress.width).toBe(420);
        expect(geometry.volume.width).toBe(420);
        expect(geometry.cardDisplay).toBe('flex');
        expect(geometry.cardMainDisplay).toBe('flex');
        expect(geometry.card.height).toBe(76);
        expect(geometry.cardIndex.right).toBeLessThanOrEqual(geometry.cardCopy.left);
        expect(geometry.cardMain.right).toBeLessThanOrEqual(geometry.cardActions.left);
        expect(geometry.cardActions.right).toBeLessThanOrEqual(geometry.card.right);
        expect(geometry.headerPosition).toBe('fixed');
        expect(geometry.header.top).toBe(36);
        expect(geometry.contextNavPosition).toBe('fixed');
        expect(geometry.contextNav.top).toBe(124);
        for (const center of Object.values(geometry.iconCenters)) {
            expect(center.display).toContain('flex');
            expect(center.height).toBeGreaterThan(0);
            expect(center.width).toBeGreaterThan(0);
            expect(Math.abs(center.x)).toBeLessThanOrEqual(0.5);
            expect(Math.abs(center.y)).toBeLessThanOrEqual(0.5);
        }
        expect(geometry.panel.top).toBeGreaterThanOrEqual(0);
        expect(geometry.panel.right).toBeLessThanOrEqual(1920);
        expect(geometry.panel.bottom).toBeLessThanOrEqual(1080);
        expect(geometry.queue.top).toBeGreaterThanOrEqual(geometry.panel.top);
        expect(geometry.queue.bottom).toBeLessThanOrEqual(geometry.panel.bottom + 1);
        expect(geometry.queueOverflowY).toBe('auto');
        expect(geometry.queueScrollHeight).toBeGreaterThan(geometry.queueClientHeight);
    });

    test('matches the desktop Music header order without overlapping Search or Refresh', async ({ page }) => {
        await page.goto('/#/e2e/music-header-layout');
        await expect(page.locator('.ptv-shell-context-nav')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
        const geometry = await page.evaluate(() => {
            const rect = (element: Element) => {
                const value = element.getBoundingClientRect();

                return {
                    bottom: value.bottom,
                    height: value.height,
                    left: value.left,
                    right: value.right,
                    top: value.top,
                    width: value.width
                };
            };
            const centerDelta = (selector: string) => {
                const control = document.querySelector<HTMLElement>(selector)!;
                const icon = control.querySelector<HTMLElement>('.ptv-icon')!;
                const controlRect = rect(control);
                const iconRect = rect(icon);

                return {
                    display: getComputedStyle(control).display,
                    height: iconRect.height,
                    width: iconRect.width,
                    x: (iconRect.left + (iconRect.width / 2)) - (controlRect.left + (controlRect.width / 2)),
                    y: (iconRect.top + (iconRect.height / 2)) - (controlRect.top + (controlRect.height / 2))
                };
            };
            const header = document.querySelector<HTMLElement>('.ptv-shell-header')!;
            const context = document.querySelector<HTMLElement>('.ptv-shell-context-nav')!;
            const links = Array.from(context.querySelectorAll<HTMLElement>('.ptv-shell-context-link'));
            const body = document.querySelector<HTMLElement>('.ptv-music-body')!;
            const scroll = document.querySelector<HTMLElement>('.ptv-music-main-scroll')!;
            const refresh = document.querySelector<HTMLElement>('.ptv-music-main-toolbar button')!;
            const search = document.querySelector<HTMLElement>('.ptv-shell-search')!;
            const headerRect = rect(header);
            const contextRect = rect(context);
            const refreshRect = rect(refresh);
            const searchRect = rect(search);
            const overlaps = (
                first: ReturnType<typeof rect>,
                second: ReturnType<typeof rect>
            ) => first.left < second.right
                && first.right > second.left
                && first.top < second.bottom
                && first.bottom > second.top;

            return {
                bodyPaddingTop: getComputedStyle(body).paddingTop,
                context: contextRect,
                contextOverlapsHeader: overlaps(contextRect, headerRect),
                contextPosition: getComputedStyle(context).position,
                header: headerRect,
                iconCenters: {
                    notifications: centerDelta('.ptv-shell-icon-button[aria-label="Notifications"]'),
                    profile: centerDelta('.ptv-shell-icon-button[aria-label="User menu"]'),
                    search: centerDelta('.ptv-shell-search-trigger')
                },
                iconLabelGap: (() => {
                    const firstIcon = links[0].querySelector<HTMLElement>('.ptv-icon')!;
                    const firstLabel = links[0].querySelector<HTMLElement>('.ptv-icon + span')!;

                    return rect(firstLabel).left - rect(firstIcon).right;
                })(),
                interLinkGaps: links.slice(1).map((link, index) => rect(link).left - rect(links[index]).right),
                lastLink: rect(links[links.length - 1]),
                mainScroll: rect(scroll),
                mainScrollPaddingTop: getComputedStyle(scroll).paddingTop,
                refresh: refreshRect,
                refreshOverlapsSearch: overlaps(refreshRect, searchRect),
                search: searchRect
            };
        });

        expect(geometry.contextPosition).toBe('absolute');
        expect(geometry.header.top).toBe(36);
        expect(geometry.context.top).toBe(124);
        expect(geometry.context.top).toBeGreaterThanOrEqual(geometry.header.bottom + 8);
        expect(geometry.bodyPaddingTop).toBe('164px');
        expect(geometry.mainScroll.width).toBe(1920);
        expect(geometry.mainScrollPaddingTop).toBe('28px');
        expect(geometry.refresh.top).toBeGreaterThan(geometry.context.bottom);
        expect(geometry.contextOverlapsHeader).toBe(false);
        expect(geometry.refreshOverlapsSearch).toBe(false);
        expect(Math.abs(geometry.lastLink.right - geometry.search.right)).toBeLessThanOrEqual(1);
        expect(geometry.iconLabelGap).toBeGreaterThanOrEqual(7.5);
        geometry.interLinkGaps.forEach(gap => {
            expect(gap).toBeGreaterThanOrEqual(7.5);
        });
        for (const center of Object.values(geometry.iconCenters)) {
            expect(center.display).toContain('flex');
            expect(center.height).toBeGreaterThan(0);
            expect(center.width).toBeGreaterThan(0);
            expect(Math.abs(center.x)).toBeLessThanOrEqual(0.5);
            expect(Math.abs(center.y)).toBeLessThanOrEqual(0.5);
        }
    });
});
