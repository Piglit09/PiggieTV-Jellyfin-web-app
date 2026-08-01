import { expect, test, type Page } from '@playwright/test';

const FLAGSHIP_VIEWPORTS = [
    { height: 900, name: 'desktop', width: 1440 },
    { height: 1366, name: 'tablet', width: 1024 },
    { height: 844, name: 'phone portrait', width: 390 },
    { height: 390, name: 'phone landscape', width: 844 }
] as const;

function getRenderedHomeRowIds(page: Page) {
    return page.locator('[data-ptv-native-row-id]').evaluateAll(rows => (
        rows.map(row => (row as HTMLElement).dataset.ptvNativeRowId)
    ));
}

async function expectInsideViewport(
    page: Page,
    selector: ReturnType<Page['locator']>
) {
    const box = await selector.boundingBox();
    const viewport = page.viewportSize();

    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.y).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

async function expectNoPageHorizontalOverflow(page: Page) {
    const widths = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth
    }));

    expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
}

test.describe('Phase F1 flagship discovery slice', () => {
    test('customizes Home immediately and persists layout only for the matching server user', async ({ page }) => {
        const originalRoute = '/?e2eServer=fixture-server-a&e2eUser=customizer-a#/home';

        await page.setViewportSize({ height: 900, width: 1440 });
        await page.goto(originalRoute);

        const home = page.locator('.ptv-e2e-native-home');
        const hero = page.locator('[data-ptv-native-home-hero="true"]');
        const customize = page.getByRole('button', { name: 'Customize Home' });

        await expect(home).toHaveAttribute('data-ptv-shelf-density', 'comfortable');
        await expect(home).toHaveAttribute('data-ptv-home-preference-server', 'fixture-server-a');
        await expect(home).toHaveAttribute('data-ptv-home-preference-user', 'customizer-a');
        await expect(hero).toBeVisible();

        await customize.focus();
        await customize.press('Enter');

        let dialog = page.getByRole('dialog', { name: 'Customize Home' });
        const close = page.getByRole('button', { name: 'Close Home customization' });

        await expect(dialog).toBeVisible();
        await expect(close).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(dialog.getByRole('button', { name: 'Done' })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(customize).toBeFocused();

        await customize.click();
        dialog = page.getByRole('dialog', { name: 'Customize Home' });

        await dialog.getByRole('radio', { name: 'Compact' }).check();
        await expect(home).toHaveAttribute('data-ptv-shelf-density', 'compact');
        await expect(home).toHaveClass(/is-density-compact/);

        await dialog.getByRole('checkbox', { name: 'Featured hero' }).uncheck();
        await expect(hero).toBeHidden();
        await expect(home).toHaveClass(/is-hero-disabled/);

        await dialog.getByRole('checkbox', { name: 'Continue Watching' }).uncheck();
        await expect(page.locator('[data-ptv-native-row-id="continue-watching"]')).toHaveCount(0);

        const moveBecauseUp = dialog.getByRole('button', { name: 'Move Because You Watched up' });

        await moveBecauseUp.click();
        await moveBecauseUp.click();
        await expect(moveBecauseUp).toBeDisabled();
        await expect(page.locator('[data-ptv-native-row-id]')).toHaveCount(2);
        await expect.poll(() => getRenderedHomeRowIds(page)).toEqual([
            'because-you-watched',
            'recommended-for-you'
        ]);

        await dialog.getByRole('button', { name: 'Done' }).click();
        await expect(dialog).toHaveCount(0);

        await page.reload();
        await expect(home).toHaveAttribute('data-ptv-shelf-density', 'compact');
        await expect(hero).toBeHidden();
        await expect(page.locator('[data-ptv-native-row-id="continue-watching"]')).toHaveCount(0);
        await expect.poll(() => getRenderedHomeRowIds(page)).toEqual([
            'because-you-watched',
            'recommended-for-you'
        ]);

        await page.goto('/?e2eServer=fixture-server-a&e2eUser=customizer-b#/home');
        await expect(home).toHaveAttribute('data-ptv-shelf-density', 'comfortable');
        await expect(hero).toBeVisible();
        await expect(page.locator('[data-ptv-native-row-id="continue-watching"]')).toBeVisible();

        await page.goto('/?e2eServer=fixture-server-b&e2eUser=customizer-a#/home');
        await expect(home).toHaveAttribute('data-ptv-shelf-density', 'comfortable');
        await expect(hero).toBeVisible();

        await page.goto(originalRoute);
        await expect(home).toHaveAttribute('data-ptv-shelf-density', 'compact');
        await expect(hero).toBeHidden();
        await expect(page.locator('[data-ptv-native-row-id="continue-watching"]')).toHaveCount(0);
    });

    test('uses canonical card actions for reversible recommendation feedback without playback', async ({ page }) => {
        await page.goto('/?e2eServer=fixture-server-a&e2eUser=feedback-a#/home');

        const home = page.locator('.ptv-e2e-native-home');
        const target = page.locator('[data-ptv-home-item-id="fixture-recommendation-target"]');
        const feedbackActions = [
            'Not Interested',
            'Hide From Home',
            'Show Fewer Like This'
        ];

        await expect(target).toBeVisible();
        await expect(home).toHaveAttribute('data-ptv-playback-call-count', '0');

        for (const action of feedbackActions) {
            await target.getByRole('button', { name: 'More Actions for Recommended Pick One' }).click();

            const actions = page.getByRole('dialog', { name: 'Actions for Recommended Pick One' });

            await expect(actions).toBeVisible();
            await expect(actions).toHaveAttribute('data-ptv-item-action-menu', 'canonical');
            await expect(actions.getByRole('button', { name: 'Not Interested' })).toBeVisible();
            await expect(actions.getByRole('button', { name: 'Hide From Home' })).toBeVisible();
            await expect(actions.getByRole('button', { name: 'Show Fewer Like This' })).toBeVisible();

            await actions.getByRole('button', { name: action, exact: true }).click();

            await expect(target).toHaveCount(0);
            await expect(page).toHaveURL(/#\/home$/);
            await expect(home).toHaveAttribute('data-ptv-playback-call-count', '0');
            const undo = page.getByRole('button', { name: 'Undo' });

            await expect(undo).toBeVisible();
            await undo.click();
            await expect(target).toBeVisible();
            await expect(home).toHaveAttribute('data-ptv-playback-call-count', '0');
        }
    });

    test('preserves the grouped Search query and active filter across Details history', async ({ page }) => {
        await page.setViewportSize({ height: 900, width: 1440 });
        await page.goto('/#/search?query=Atlas&filter=all&ptvGrouped=true');

        const searchInput = page.getByRole('searchbox', { name: 'Search PiggieTV' });
        const filters = page.getByRole('navigation', { name: 'Search result filters' });

        await expect(searchInput).toHaveValue('Atlas');
        await expect(searchInput).toBeFocused();
        await expect(filters.getByRole('button')).toHaveCount(8);
        await expect(filters.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('region', { name: 'All search results' })).toHaveAttribute('aria-busy', 'false');
        await expect(page.getByRole('heading', { name: 'Movies', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();

        await filters.getByRole('button', { name: 'People', exact: true }).click();

        await expect(page).toHaveURL(/#\/search\?filter=people&ptvGrouped=true&query=Atlas$/);
        await expect(filters.getByRole('button', { name: 'People', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('region', { name: 'People search results' })).toBeVisible();
        await expect(page.locator('.ptv-search-group')).toHaveCount(1);
        await expect(page.getByRole('heading', { name: 'Movies', exact: true })).toHaveCount(0);

        await page.locator('.ptv-search-card').first().click();
        await expect(page.locator('#itemDetailPage.ptv-details-native-root')).toBeVisible();

        await page.goBack();

        await expect(searchInput).toHaveValue('Atlas');
        await expect(filters.getByRole('button', { name: 'People', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.ptv-search-group')).toHaveCount(1);
        await expect(page.locator('.ptv-search-card')).toHaveCount(2);
    });

    test('offers settled empty, clear, error, and retry states without a stuck busy region', async ({ page }) => {
        await page.goto('/#/search?query=No%20Match&filter=movies&ptvGrouped=true');

        const results = page.getByRole('region', { name: 'Movies search results' });

        await expect(page.getByRole('heading', { name: 'No matches found' })).toBeVisible();
        await expect(page.getByRole('status')).toContainText('No results in Movies');
        await expect(results).toHaveAttribute('aria-busy', 'false');
        await expect(page.locator('.ptv-search-card')).toHaveCount(0);

        await page.getByRole('button', { name: 'Clear search' }).click();
        await expect(page.getByRole('searchbox', { name: 'Search PiggieTV' })).toHaveValue('');
        await expect(page.getByRole('status')).toHaveText('Start typing at least two characters.');
        await expect(page.getByRole('heading', { name: 'No matches found' })).toHaveCount(0);

        await page.goto('/#/search?query=Server%20Error&filter=movies&ptvGrouped=true');
        await expect(page.getByRole('heading', { name: 'Search could not finish' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
        await expect(results).toHaveAttribute('aria-busy', 'false');

        await page.getByRole('button', { name: 'Try again' }).click();

        await expect(page.getByRole('heading', { name: 'Search could not finish' })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Movies', exact: true })).toBeVisible();
        await expect(page.locator('.ptv-search-card')).toHaveCount(2);
        await expect(results).toHaveAttribute('aria-busy', 'false');
    });

    test('lazy-renders semantic Details discovery links and routes them back to Search', async ({ page }) => {
        const apiRequests: string[] = [];

        page.on('request', request => {
            if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr') {
                apiRequests.push(request.url());
            }
        });
        await page.goto('/#/details?id=fixture-item');

        const pageRoot = page.locator('#itemDetailPage');
        const discovery = page.getByRole('region', { name: 'Discover more' });
        const links = page.getByRole('navigation', { name: 'Related discovery searches' });

        await expect(discovery).toBeVisible();
        await expect(pageRoot).toHaveAttribute('data-ptv-details-discovery-item-id', 'fixture-item');
        await expect(pageRoot).not.toHaveAttribute('data-ptv-details-discovery-pending-item-id', /.+/);
        await expect(links.getByRole('link')).toHaveCount(5);
        await expect(links.locator('.ptv-details-discovery-link--franchise')).toHaveCount(1);
        await expect(links.locator('.ptv-details-discovery-link--creator')).toHaveCount(1);
        await expect(links.locator('.ptv-details-discovery-link--studio')).toHaveCount(1);
        await expect(links.locator('.ptv-details-discovery-link--genre')).toHaveCount(2);
        await expect(links.getByRole('link').first()).toHaveAttribute('href', /#\/search\?query=.+&ptvGrouped=true$/);

        const sectionOrder = await page.locator('.detailPageContent').evaluate(container => (
            Array.from(container.children).map(element => element.id || element.className)
        ));

        expect(sectionOrder.indexOf('ptv-details-discovery verticalSection detailVerticalSection ptv-details-glass'))
            .toBeLessThan(sectionOrder.indexOf('similarCollapsible'));
        expect(apiRequests).toEqual([]);

        const firstDiscoveryLink = links.getByRole('link').first();

        await firstDiscoveryLink.focus();
        await expect(firstDiscoveryLink).toBeFocused();
        await firstDiscoveryLink.press('Enter');

        await expect(page.getByRole('searchbox', { name: 'Search PiggieTV' })).toHaveValue('Fixture Collection');
        await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('region', { name: 'All search results' })).toBeVisible();
    });
});

test.describe('Phase F1 responsive and accessible presentation', () => {
    for (const viewport of FLAGSHIP_VIEWPORTS) {
        test(`${viewport.name} keeps Home, Search, and Details usable by keyboard`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.goto(`/?e2eServer=fixture-server-a&e2eUser=responsive-${viewport.name.replace(' ', '-')}#/home`);

            const customize = page.getByRole('button', { name: 'Customize Home' });

            await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
            await expect(page.getByRole('region', { name: 'Featured' })).toBeVisible();
            await expect(page.getByRole('heading', { name: 'Continue Watching', level: 2 })).toBeVisible();
            await expectNoPageHorizontalOverflow(page);
            await expectInsideViewport(page, customize);

            await customize.focus();
            await customize.press('Enter');

            const homeDialog = page.getByRole('dialog', { name: 'Customize Home' });
            const closeHomeDialog = homeDialog.getByRole('button', { name: 'Close Home customization' });
            const done = homeDialog.getByRole('button', { name: 'Done' });

            await expect(homeDialog).toBeVisible();
            await expect(homeDialog).toHaveAttribute('aria-modal', 'true');
            await expect(homeDialog).toHaveAttribute('aria-describedby', /.+/);
            await expect(closeHomeDialog).toBeFocused();
            await expectInsideViewport(page, homeDialog);
            await expectInsideViewport(page, closeHomeDialog);
            await expectInsideViewport(page, done);
            expect(Math.round((await closeHomeDialog.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
            expect(Math.round((await closeHomeDialog.boundingBox())!.width)).toBeGreaterThanOrEqual(44);

            await page.keyboard.press('Tab');
            expect(await homeDialog.evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
            await page.keyboard.press('Escape');
            await expect(homeDialog).toHaveCount(0);
            await expect(customize).toBeFocused();

            await page.goto('/#/search?query=Atlas&filter=all&ptvGrouped=true');

            const search = page.getByRole('searchbox', { name: 'Search PiggieTV' });
            const searchForm = page.getByRole('search');
            const filters = page.getByRole('navigation', { name: 'Search result filters' });
            const allFilter = filters.getByRole('button', { name: 'All', exact: true });
            const moviesFilter = filters.getByRole('button', { name: 'Movies', exact: true });
            const results = page.getByRole('region', { name: 'All search results' });

            await expect(page.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible();
            await expect(results).toHaveAttribute('aria-busy', 'false');
            await expect(results).toHaveAttribute('aria-describedby', 'ptv-search-status');
            await expect(page.getByRole('status')).toHaveAttribute('aria-live', 'polite');
            await expectInsideViewport(page, searchForm);
            await expectInsideViewport(page, filters);
            await expectNoPageHorizontalOverflow(page);
            expect(Math.round((await allFilter.boundingBox())!.height)).toBeGreaterThanOrEqual(44);

            if (viewport.width > 900) {
                await expect(search).toBeFocused();
            } else {
                await expect(search).not.toBeFocused();
            }

            await allFilter.focus();
            await expect(allFilter).toBeFocused();
            await page.keyboard.press('Tab');
            await expect(moviesFilter).toBeFocused();

            await search.focus();
            const focusRing = await searchForm.evaluate(element => {
                const style = getComputedStyle(element);

                return {
                    offset: style.outlineOffset,
                    style: style.outlineStyle,
                    width: style.outlineWidth
                };
            });

            expect(focusRing.style).toBe('solid');
            expect(Number.parseFloat(focusRing.width)).toBeGreaterThanOrEqual(2);
            expect(Number.parseFloat(focusRing.offset)).toBeGreaterThanOrEqual(2);

            const firstCard = page.locator('.ptv-search-card').first();

            expect(await firstCard.evaluate(element => getComputedStyle(element).transitionDuration))
                .toBe('0s');
            await expect(page.locator('a button, button a')).toHaveCount(0);
            await firstCard.focus();
            await expect(firstCard).toBeFocused();
            await firstCard.press('Enter');

            const discovery = page.getByRole('region', { name: 'Discover more' });

            await expect(discovery).toBeVisible();
            await expect(discovery.getByRole('navigation', { name: 'Related discovery searches' }))
                .toBeVisible();
            await expectNoPageHorizontalOverflow(page);
            await discovery.scrollIntoViewIfNeeded();
            await expectInsideViewport(page, discovery);
        });
    }
});
