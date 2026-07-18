import { expect, type Locator, type Page, test } from '@playwright/test';

async function expectStandaloneShellSurfaces(page: Page) {
    const header = page.locator('.ptv-shell-header');
    const navigation = page.locator('.ptv-shell-nav-primary');
    const utility = page.locator('.ptv-shell-icon-button').first();
    const search = page.locator('.ptv-shell-search');

    await expect(header).toHaveCount(1);
    await expect(header).toBeVisible();
    await expect(navigation).toBeVisible();
    await expect(utility).toBeVisible();
    await expect(search).toBeVisible();

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
    expect(navigationSurface.backgroundImage).not.toBe('none');
    expect(navigationSurface.borderTopWidth).toBe('1px');
    expect(navigationSurface.backdropFilter).toContain('blur');
    expect(utilitySurface.backgroundImage).not.toBe('none');
    expect(utilitySurface.borderTopWidth).toBe('1px');
    expect(utilitySurface.backdropFilter).toContain('blur');

    const navigationBox = await navigation.boundingBox();
    const utilityBox = await utility.boundingBox();
    const searchBox = await search.boundingBox();

    expect(navigationBox).not.toBeNull();
    expect(utilityBox).not.toBeNull();
    expect(searchBox).not.toBeNull();
    expect(Math.abs(navigationBox!.x + navigationBox!.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(3);
    expect(searchBox!.width).toBeGreaterThanOrEqual(utilityBox!.width);
    expect(searchBox!.height).toBeGreaterThanOrEqual(utilityBox!.height);
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

            await expectStandaloneShellSurfaces(page);
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

    test('keeps the tablet shell as separate floating surfaces', async ({ page }) => {
        await page.setViewportSize({ height: 1366, width: 1024 });
        await page.goto('/#/details?id=fixture-item');

        await expectStandaloneShellSurfaces(page);
        const overflow = await page.evaluate(() => ({
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth
        }));

        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
});
