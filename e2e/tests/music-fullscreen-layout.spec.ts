import { expect, test, type Page } from '@playwright/test';

const WEBOS_UA = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/68.0 Safari/537.36 WebAppManager';

type Viewport = Readonly<{
    height: number;
    width: number;
}>;

type BrowserQueueProfile = Readonly<{
    count: 50 | 100;
    current: number;
    name: string;
    phone: boolean;
    viewport: Viewport;
}>;

const browserQueueProfiles: BrowserQueueProfile[] = [
    {
        count: 100,
        current: 72,
        name: '2560x1440 desktop',
        phone: false,
        viewport: { height: 1440, width: 2560 }
    },
    {
        count: 100,
        current: 72,
        name: '1920x1080 desktop',
        phone: false,
        viewport: { height: 1080, width: 1920 }
    },
    {
        count: 50,
        current: 36,
        name: '1024x768 tablet landscape',
        phone: false,
        viewport: { height: 768, width: 1024 }
    },
    {
        count: 50,
        current: 36,
        name: '768x1024 tablet portrait',
        phone: false,
        viewport: { height: 1024, width: 768 }
    },
    {
        count: 50,
        current: 36,
        name: '390x844 phone portrait',
        phone: true,
        viewport: { height: 844, width: 390 }
    },
    {
        count: 50,
        current: 36,
        name: '844x390 phone landscape',
        phone: true,
        viewport: { height: 390, width: 844 }
    }
];

async function openQueueFixture(
    page: Page,
    viewport: Viewport,
    options: Readonly<{
        count: number;
        current: number;
        profile: 'browser' | 'tv';
    }>
) {
    await page.setViewportSize(viewport);
    await page.goto(
        `/#/e2e/music-fullscreen-layout?profile=${options.profile}&count=${options.count}&current=${options.current}`
    );
    await expect(page.locator('.ptv-music-fullscreen-player')).toBeVisible();
    await expect(page.locator('.ptv-music-queue-item')).toHaveCount(options.count);
    await expect(page.locator('.ptv-music-queue-item[aria-current="true"]')).toHaveCount(1);
    await expect(page.locator('.ptv-music-queue-item[aria-current="true"]')).toBeInViewport();
    await page.mouse.move(4, Math.floor(viewport.height / 2));
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(20);
}

async function readFullPlayerLayout(page: Page) {
    return page.evaluate(() => {
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
        const overlaps = (
            first: ReturnType<typeof rect>,
            second: ReturnType<typeof rect>
        ) => first.left < second.right
            && first.right > second.left
            && first.top < second.bottom
            && first.bottom > second.top;
        const isVisible = (element: HTMLElement) => {
            const styles = getComputedStyle(element);

            return styles.display !== 'none'
                && styles.visibility !== 'hidden'
                && element.getClientRects().length > 0;
        };
        const player = document.querySelector<HTMLElement>('.ptv-music-fullscreen-player')!;
        const routePage = document.querySelector<HTMLElement>('#ptvMusicPage')!;
        const panel = document.querySelector<HTMLElement>('.ptv-music-player-panel')!;
        const tabs = panel.querySelector<HTMLElement>('.ptv-music-player-tabs')!;
        const tabPanel = panel.querySelector<HTMLElement>('.ptv-music-list-up-next')!;
        const summary = panel.querySelector<HTMLElement>('.ptv-music-player-panel-actions')!;
        const queue = panel.querySelector<HTMLElement>('.ptv-music-queue-list')!;
        const rows = Array.from(queue.querySelectorAll<HTMLElement>('.ptv-music-queue-item'));
        const currentRows = rows.filter(row => row.getAttribute('aria-current') === 'true');
        const current = currentRows[0];
        const currentRect = rect(current);
        const queueRect = rect(queue);
        const scrollOwners = [player, ...Array.from(player.querySelectorAll<HTMLElement>('*'))]
            .filter(element => {
                const overflowY = getComputedStyle(element).overflowY;

                return ['auto', 'scroll'].includes(overflowY)
                    && element.scrollHeight > element.clientHeight + 1;
            })
            .map(element => element.classList.contains('ptv-music-queue-list') ?
                'queue' :
                element.className || element.tagName.toLocaleLowerCase('en-US'));
        let actionOverlapCount = 0;
        let horizontalOverflowRows = 0;
        let minimumActionTarget = Number.POSITIVE_INFINITY;
        const visibleActionCounts: number[] = [];
        const focusableCounts: number[] = [];

        rows.forEach(row => {
            const main = row.querySelector<HTMLElement>('.ptv-music-queue-item-main')!;
            const actions = Array.from(row.querySelectorAll<HTMLElement>(
                '.ptv-music-queue-quick-action, .ptv-music-queue-overflow'
            )).filter(isVisible);
            const actionRects = actions.map(action => rect(action));

            visibleActionCounts.push(actions.length);
            focusableCounts.push(row.querySelectorAll(
                'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
            ).length);
            if (row.scrollWidth > row.clientWidth + 1) horizontalOverflowRows += 1;
            for (const actionRect of actionRects) {
                if (overlaps(rect(main), actionRect)) actionOverlapCount += 1;
                minimumActionTarget = Math.min(
                    minimumActionTarget,
                    actionRect.height,
                    actionRect.width
                );
            }
            for (let index = 0; index < actionRects.length; index += 1) {
                for (let later = index + 1; later < actionRects.length; later += 1) {
                    if (overlaps(actionRects[index], actionRects[later])) actionOverlapCount += 1;
                }
            }
        });

        const focusKeys = Array.from(player.querySelectorAll<HTMLElement>('[data-ptv-focus-key]'))
            .map(element => element.dataset.ptvFocusKey || '');
        const fixedBefore = {
            summary: rect(summary).top,
            tabs: rect(tabs).top,
            tabPanel: rect(tabPanel).top
        };

        queue.scrollTop = Math.max(1, Math.min(queue.scrollTop + 120, queue.scrollHeight - queue.clientHeight));
        const fixedAfter = {
            summary: rect(summary).top,
            tabs: rect(tabs).top,
            tabPanel: rect(tabPanel).top
        };

        const playerStyles = getComputedStyle(player);
        const queueStyles = getComputedStyle(queue);
        const routePageStyles = getComputedStyle(routePage);
        const titleStyles = getComputedStyle(
            current.querySelector<HTMLElement>('.ptv-music-queue-item-main strong')!
        );

        return {
            actionOverlapCount,
            currentCount: currentRows.length,
            currentInsideQueue: currentRect.top >= queueRect.top - 1
                && currentRect.bottom <= queueRect.bottom + 1,
            documentHorizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
            fixedDelta: {
                summary: Math.abs(fixedAfter.summary - fixedBefore.summary),
                tabs: Math.abs(fixedAfter.tabs - fixedBefore.tabs),
                tabPanel: Math.abs(fixedAfter.tabPanel - fixedBefore.tabPanel)
            },
            focusKeysUnique: new Set(focusKeys).size === focusKeys.length,
            focusableMaximum: Math.max(...focusableCounts),
            focusableMinimum: Math.min(...focusableCounts),
            horizontalOverflowRows,
            minimumActionTarget: Number.isFinite(minimumActionTarget) ? minimumActionTarget : null,
            panel: rect(panel),
            playbackSurfaceCount: document.querySelectorAll(
                '.ptv-media-dock[data-ptv-playback-surface], .ptv-music-fullscreen-player[data-ptv-playback-surface]'
            ).length,
            player: rect(player),
            playerClientHeight: player.clientHeight,
            playerClientWidth: player.clientWidth,
            playerOverflow: playerStyles.overflow,
            playerPosition: playerStyles.position,
            playerScrollHeight: player.scrollHeight,
            playerScrollTop: player.scrollTop,
            playerScrollWidth: player.scrollWidth,
            queue: rect(queue),
            queueClientHeight: queue.clientHeight,
            queueOverflowY: queueStyles.overflowY,
            queueScrollBehavior: queueStyles.scrollBehavior,
            queueScrollHeight: queue.scrollHeight,
            routePageOverflow: routePageStyles.overflow,
            routePageScrollTop: routePage.scrollTop,
            rowCount: rows.length,
            scrollOwners,
            titleOverflow: titleStyles.overflow,
            titleTextOverflow: titleStyles.textOverflow,
            titleWhiteSpace: titleStyles.whiteSpace,
            viewport: {
                height: window.innerHeight,
                width: window.innerWidth
            },
            visibleActionMaximum: Math.max(...visibleActionCounts),
            visibleActionMinimum: Math.min(...visibleActionCounts),
            windowScrollY: window.scrollY
        };
    });
}

function expectFullPlayerLayout(
    layout: Awaited<ReturnType<typeof readFullPlayerLayout>>,
    viewport: Viewport,
    options: Readonly<{
        count: number;
        expectedVisibleActions: number;
        tv: boolean;
    }>
) {
    expect(layout.viewport).toEqual(viewport);
    expect(layout.rowCount).toBe(options.count);
    expect(layout.currentCount).toBe(1);
    expect(layout.playerOverflow).toBe('hidden');
    if (options.tv) {
        expect(layout.playerPosition).toBe('fixed');
        expect(layout.player.left).toBeCloseTo(0, 0);
        expect(layout.player.top).toBeCloseTo(0, 0);
        expect(layout.player.right).toBeCloseTo(viewport.width, 0);
        expect(layout.player.bottom).toBeCloseTo(viewport.height, 0);
    } else {
        expect(['fixed', 'relative']).toContain(layout.playerPosition);
        expect(layout.player.left).toBeGreaterThanOrEqual(0);
        expect(layout.player.top).toBeGreaterThanOrEqual(0);
        expect(layout.player.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(layout.player.bottom).toBeLessThanOrEqual(viewport.height + 1);
    }
    if (options.tv) {
        expect(layout.playerScrollWidth).toBeLessThanOrEqual(layout.playerClientWidth + 1);
        expect(layout.playerScrollHeight).toBeLessThanOrEqual(layout.playerClientHeight + 1);
    }
    expect(layout.playerScrollTop).toBe(0);
    expect(layout.routePageOverflow).toBe('hidden');
    expect(layout.routePageScrollTop).toBe(0);
    expect(layout.windowScrollY).toBe(0);
    expect(layout.panel.top).toBeGreaterThanOrEqual(0);
    expect(layout.panel.right).toBeLessThanOrEqual(viewport.width + 1);
    expect(layout.panel.bottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(layout.queue.top).toBeGreaterThanOrEqual(layout.panel.top);
    expect(layout.queue.bottom).toBeLessThanOrEqual(layout.panel.bottom + 1);
    expect(layout.queueClientHeight).toBeGreaterThan(0);
    expect(layout.queueScrollHeight).toBeGreaterThan(layout.queueClientHeight);
    expect(layout.queueOverflowY).toBe('auto');
    expect(layout.scrollOwners).toEqual(['queue']);
    expect(layout.currentInsideQueue).toBe(true);
    expect(layout.fixedDelta.tabs).toBeLessThanOrEqual(0.5);
    expect(layout.fixedDelta.summary).toBeLessThanOrEqual(0.5);
    expect(layout.fixedDelta.tabPanel).toBeLessThanOrEqual(0.5);
    expect(layout.actionOverlapCount).toBe(0);
    expect(layout.horizontalOverflowRows).toBe(0);
    expect(layout.documentHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(layout.focusKeysUnique).toBe(true);
    expect(layout.playbackSurfaceCount).toBe(1);
    expect(layout.visibleActionMinimum).toBe(options.expectedVisibleActions);
    expect(layout.visibleActionMaximum).toBe(options.expectedVisibleActions);
    expect(layout.titleOverflow).toBe('hidden');
    expect(layout.titleTextOverflow).toBe('ellipsis');
    expect(layout.titleWhiteSpace).toBe('nowrap');
    if (options.tv) {
        expect(layout.focusableMinimum).toBe(1);
        expect(layout.focusableMaximum).toBe(1);
        expect(layout.minimumActionTarget).toBeNull();
    } else {
        expect(layout.focusableMinimum).toBeGreaterThanOrEqual(2);
        expect(layout.focusableMaximum).toBeLessThanOrEqual(3);
        expect(layout.minimumActionTarget).toBeGreaterThanOrEqual(44);
    }
}

test.describe('WebOS full-screen Music queue layout', () => {
    test.use({ userAgent: WEBOS_UA });

    for (const viewport of [
        { height: 1080, width: 1920 },
        { height: 720, width: 1280 }
    ]) {
        test(`keeps a 100-item queue bounded with one TV row target at ${viewport.width}x${viewport.height}`, async ({ page }) => {
            await openQueueFixture(page, viewport, {
                count: 100,
                current: 72,
                profile: 'tv'
            });
            const layout = await readFullPlayerLayout(page);

            expectFullPlayerLayout(layout, viewport, {
                count: 100,
                expectedVisibleActions: 0,
                tv: true
            });
        });
    }

    test('opens the existing menu scope from the single TV row target and restores focus on Back', async ({ page }) => {
        await openQueueFixture(page, { height: 1080, width: 1920 }, {
            count: 50,
            current: 36,
            profile: 'tv'
        });
        const origin = page.locator('.ptv-music-queue-item[aria-current="true"] + .ptv-music-queue-item .ptv-music-queue-item-main');

        await origin.focus();
        await origin.press('Enter');
        const menu = page.getByRole('menu', { name: /Queue track .* actions/ });

        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem')).toHaveCount(8);
        await expect(menu.getByRole('menuitem', { name: 'Play this item' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(origin).toBeFocused();
    });
});

test.describe('responsive full-screen Music queue layout', () => {
    for (const profile of browserQueueProfiles) {
        test(`uses the available player height without overlap at ${profile.name}`, async ({ page }) => {
            await openQueueFixture(page, profile.viewport, {
                count: profile.count,
                current: profile.current,
                profile: 'browser'
            });
            const layout = await readFullPlayerLayout(page);

            expectFullPlayerLayout(layout, profile.viewport, {
                count: profile.count,
                expectedVisibleActions: profile.phone ? 1 : 2,
                tv: false
            });
        });
    }

    test('keeps all secondary queue actions in one canonical overflow and restores its trigger', async ({ page }) => {
        await openQueueFixture(page, { height: 844, width: 390 }, {
            count: 50,
            current: 36,
            profile: 'browser'
        });
        const row = page.locator('.ptv-music-queue-item[aria-current="true"] + .ptv-music-queue-item');
        const overflow = row.locator('.ptv-music-queue-overflow');

        await expect(row.locator('.ptv-music-queue-quick-action')).toBeHidden();
        await expect(overflow).toBeVisible();
        await expect(overflow).toHaveAccessibleName(/Open actions for Queue track/);
        await overflow.click();
        const menu = page.getByRole('menu', { name: /Queue track .* actions/ });

        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem')).toHaveCount(7);
        for (const label of [
            'Move earlier',
            'Move later',
            'Move to top',
            'Move to bottom',
            'Play next',
            'Add to playlist',
            'Remove from queue'
        ]) {
            await expect(menu.getByRole('menuitem', { name: label })).toHaveCount(1);
        }
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(overflow).toBeFocused();
    });

    test('keeps a 500-item queue bounded without rendering unrelated route content', async ({ page }) => {
        const viewport = { height: 1080, width: 1920 };

        await openQueueFixture(page, viewport, {
            count: 500,
            current: 360,
            profile: 'browser'
        });
        const layout = await readFullPlayerLayout(page);

        expectFullPlayerLayout(layout, viewport, {
            count: 500,
            expectedVisibleActions: 2,
            tv: false
        });
        await expect(page.locator('.browse-page')).toHaveCount(0);
    });

    test('uses non-animated internal scrolling under reduced motion', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const viewport = { height: 844, width: 390 };

        await openQueueFixture(page, viewport, {
            count: 50,
            current: 36,
            profile: 'browser'
        });
        const layout = await readFullPlayerLayout(page);
        const motion = await page.locator('.ptv-music-queue-item[aria-current="true"]').evaluate(element => {
            const styles = getComputedStyle(element);

            return {
                animationName: styles.animationName,
                transitionDuration: styles.transitionDuration
            };
        });

        expect(layout.queueScrollBehavior).toBe('auto');
        expect(motion.animationName).toBe('none');
        expect(motion.transitionDuration).toBe('0s');
    });
});

test.describe('global Music mini-player dock', () => {
    for (const profile of [
        { name: 'desktop', viewport: { height: 1080, width: 1920 } },
        { name: 'phone portrait', viewport: { height: 844, width: 390 } },
        { name: 'phone landscape', viewport: { height: 390, width: 844 } }
    ]) {
        test(`remains viewport fixed while the ${profile.name} document scrolls`, async ({ page }) => {
            await page.setViewportSize(profile.viewport);
            await page.goto('/#/e2e/music-dock-layout');
            const dock = page.locator('.ptv-media-dock');

            await expect(dock).toBeVisible();
            const before = await dock.boundingBox();

            expect(before).not.toBeNull();
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
            const after = await dock.boundingBox();
            const state = await page.evaluate(() => {
                const element = document.querySelector<HTMLElement>('.ptv-media-dock')!;
                const bounds = element.getBoundingClientRect();

                return {
                    horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
                    playbackSurfaces: document.querySelectorAll(
                        '.ptv-media-dock[data-ptv-playback-surface], .ptv-music-fullscreen-player[data-ptv-playback-surface]'
                    ).length,
                    position: getComputedStyle(element).position,
                    withinViewport: bounds.left >= 0
                        && bounds.right <= window.innerWidth + 1
                        && bounds.top >= 0
                        && bounds.bottom <= window.innerHeight + 1
                };
            });

            expect(after).not.toBeNull();
            expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
            expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
            expect(state.position).toBe('fixed');
            expect(state.withinViewport).toBe(true);
            expect(state.horizontalOverflow).toBeLessThanOrEqual(1);
            expect(state.playbackSurfaces).toBe(1);
        });
    }
});

test.describe('WebOS regular Music header layout', () => {
    test.use({
        userAgent: WEBOS_UA,
        viewport: { height: 1080, width: 1920 }
    });

    test('matches the regular Music header order without overlapping Search or Refresh', async ({ page }) => {
        await page.goto('/#/e2e/music-header-layout');
        await expect(page.locator('.ptv-shell-context-nav')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
        const geometry = await page.evaluate(() => {
            const rect = (element: Element) => {
                const { height, left, top, width } = element.getBoundingClientRect();

                return {
                    bottom: top + height,
                    height,
                    left,
                    right: left + width,
                    top,
                    width
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
            ) => !(
                first.right <= second.left
                || first.left >= second.right
                || first.bottom <= second.top
                || first.top >= second.bottom
            );

            return {
                bodyPaddingTop: getComputedStyle(body).paddingTop,
                context: contextRect,
                contextOverlapsHeader: overlaps(contextRect, headerRect),
                contextPosition: getComputedStyle(context).position,
                header: headerRect,
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
    });
});
