import { expect, type Locator, type Page, test } from '@playwright/test';

async function expectStandaloneShellSurfaces(page: Page, detailsNavigation = false) {
    const header = page.locator('.ptv-shell-header');
    const navigation = page.locator('.ptv-shell-nav-primary');
    const utility = page.locator('.ptv-shell-icon-button').first();
    const search = page.locator('.ptv-shell-search');

    await expect(header).toHaveCount(1);
    await expect(header).toBeVisible();
    await expect(navigation).toBeVisible();
    await expect(utility).toBeVisible();
    if (detailsNavigation) {
        await expect(search).toHaveCount(0);
        await expect(navigation.getByRole('link', { name: 'Search' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
    } else {
        await expect(search).toBeVisible();
    }

    const readSurface = (locator: Locator) => locator.evaluate(element => {
        const styles = getComputedStyle(element);

        return {
            backdropFilter: styles.backdropFilter || styles.getPropertyValue('-webkit-backdrop-filter'),
            backgroundColor: styles.backgroundColor,
            backgroundImage: styles.backgroundImage,
            borderTopWidth: styles.borderTopWidth,
            boxShadow: styles.boxShadow
        };
    });
    const headerSurface = await readSurface(header);
    const navigationSurface = await readSurface(navigation);
    const utilitySurface = await readSurface(utility);

    expect(headerSurface).toMatchObject({
        backdropFilter: 'none',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        backgroundImage: 'none',
        borderTopWidth: '0px',
        boxShadow: 'none'
    });
    if (detailsNavigation) {
        expect(navigationSurface.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    } else {
        expect(navigationSurface.backgroundImage).not.toBe('none');
    }
    expect(navigationSurface.borderTopWidth).toBe('1px');
    expect(navigationSurface.backdropFilter).toContain('blur');
    expect(utilitySurface.backgroundImage).not.toBe('none');
    expect(utilitySurface.borderTopWidth).toBe('1px');
    expect(utilitySurface.backdropFilter).toContain('blur');

    const navigationBox = await navigation.boundingBox();
    const utilityBox = await utility.boundingBox();
    const searchBox = detailsNavigation ? null : await search.boundingBox();

    expect(navigationBox).not.toBeNull();
    expect(utilityBox).not.toBeNull();
    if (!detailsNavigation) expect(searchBox).not.toBeNull();
    expect(Math.abs(navigationBox!.x + navigationBox!.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(3);
    if (searchBox) {
        expect(searchBox.width).toBeGreaterThanOrEqual(utilityBox!.width);
        expect(searchBox.height).toBeGreaterThanOrEqual(utilityBox!.height);
    }
}

async function readHorizontalOverflow(page: Page) {
    return page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
    }));
}

test.describe('PiggieTV shell surface hierarchy', () => {
    for (const route of [
        '#/home',
        '#/shows?view=latest',
        '#/details?id=fixture-item'
    ]) {
        test(`keeps only standalone glass controls on ${route}`, async ({ page }) => {
            await page.setViewportSize({ height: 1271, width: 2560 });
            await page.goto(`/${route}`);

            await expectStandaloneShellSurfaces(page, route.startsWith('#/details'));
        });
    }

    test('keeps the mobile shell transparent without horizontal overflow', async ({ page }) => {
        await page.setViewportSize({ height: 844, width: 390 });
        await page.goto('/#/shows?view=latest');

        await expectStandaloneShellSurfaces(page);
        const overflow = await page.evaluate(() => ({
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth
        }));

        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });

    test('keeps mobile Admin Libraries content below sticky glass navigation while its settings viewport scrolls', async ({ page }) => {
        await page.setViewportSize({ height: 844, width: 390 });
        await page.goto('/#/e2e/settings-admin-libraries-layout');

        const header = page.locator('.ptv-shell-header');
        const settingsPage = page.locator('#ptvSettingsPage');
        const libraries = page.getByTestId('ptv-admin-libraries-list');
        const rows = page.getByTestId('ptv-admin-library-row');

        await expect(header).toBeVisible();
        await expect(settingsPage).toBeVisible();
        await expect(libraries).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Search libraries' })).toBeVisible();
        await expect(page.getByRole('group', { name: 'Filter libraries' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add Library' })).toBeVisible();
        await expect(rows).toHaveCount(8);

        const initialHeader = await header.boundingBox();
        const initialSettingsPage = await settingsPage.boundingBox();

        expect(initialHeader).not.toBeNull();
        expect(initialSettingsPage).not.toBeNull();
        expect(initialSettingsPage!.y).toBeGreaterThanOrEqual(initialHeader!.y + initialHeader!.height);
        expect(initialSettingsPage!.y + initialSettingsPage!.height).toBeLessThanOrEqual(
            page.viewportSize()!.height + 1
        );

        const scrollState = await settingsPage.evaluate((element: HTMLElement) => {
            element.scrollTop = element.scrollHeight;
            return {
                clientHeight: element.clientHeight,
                scrollHeight: element.scrollHeight,
                scrollTop: element.scrollTop
            };
        });

        expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
        expect(scrollState.scrollTop).toBeGreaterThan(0);
        await expect(rows.last()).toBeVisible();

        const scrolledHeader = await header.boundingBox();
        const scrolledSettingsPage = await settingsPage.boundingBox();
        const lastRow = await rows.last().boundingBox();

        expect(scrolledHeader).not.toBeNull();
        expect(scrolledSettingsPage).not.toBeNull();
        expect(lastRow).not.toBeNull();
        expect(scrolledSettingsPage!.y).toBeGreaterThanOrEqual(scrolledHeader!.y + scrolledHeader!.height);
        expect(scrolledSettingsPage!.y + scrolledSettingsPage!.height).toBeLessThanOrEqual(
            page.viewportSize()!.height + 1
        );
        expect(lastRow!.y).toBeGreaterThanOrEqual(scrolledSettingsPage!.y);
        expect(lastRow!.y + lastRow!.height).toBeLessThanOrEqual(
            scrolledSettingsPage!.y + scrolledSettingsPage!.height + 1
        );

        const overflow = await readHorizontalOverflow(page);
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });

    for (const viewport of [
        { height: 900, name: 'above-mobile-boundary', width: 740 },
        { height: 1366, name: 'tablet', width: 1024 },
        { height: 1271, name: 'desktop', width: 2560 }
    ]) {
        test(`keeps Admin Libraries usable at ${viewport.name} control width`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.goto('/#/e2e/settings-admin-libraries-layout');

            await expect(page.locator('#ptvSettingsPage')).toBeVisible();
            await expect(page.getByTestId('ptv-admin-libraries-list')).toBeVisible();
            await expect(page.getByRole('textbox', { name: 'Search libraries' })).toBeVisible();
            await expect(page.getByRole('group', { name: 'Filter libraries' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Add Library' })).toBeVisible();
            await expect(page.getByTestId('ptv-admin-library-row').first()).toBeVisible();

            const settingsGeometry = await page.locator('#ptvSettingsPage').evaluate((element: HTMLElement) => ({
                marginTop: getComputedStyle(element).marginTop,
                top: element.getBoundingClientRect().top
            }));

            expect(settingsGeometry.marginTop).not.toBe('126px');
            expect(settingsGeometry.top).toBeLessThan(126);

            const overflow = await readHorizontalOverflow(page);
            expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
        });
    }

    test('keeps the tablet shell as separate floating surfaces', async ({ page }) => {
        await page.setViewportSize({ height: 1366, width: 1024 });
        await page.goto('/#/details?id=fixture-item');

        await expectStandaloneShellSurfaces(page, true);
        const overflow = await page.evaluate(() => ({
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth
        }));

        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
});
