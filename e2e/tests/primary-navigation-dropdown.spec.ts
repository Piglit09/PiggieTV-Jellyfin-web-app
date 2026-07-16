import { expect, test, type Page } from '@playwright/test';

test.use({
    hasTouch: true,
    isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36',
    viewport: { height: 844, width: 390 }
});

async function openMenu(page: Page, name: 'Movies' | 'Shows') {
    const trigger = page.getByRole('button', { name: new RegExp(`^${name}`) });

    await trigger.tap();
    const panel = page.locator(`[data-e2e-primary-menu="${name.toLocaleLowerCase('en-US')}"]`);

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    return { panel, trigger };
}

test.describe('Android primary navigation dropdown', () => {
    for (const route of ['home', 'movies', 'shows', 'music', 'reading']) {
        test(`opens a visible portal menu from ${route}`, async ({ page }) => {
            await page.goto(`/?dropdown=1#/${route}`);
            const { panel } = await openMenu(page, 'Movies');
            const box = await panel.boundingBox();

            expect(await panel.evaluate(element => element.parentElement === document.body)).toBe(true);
            expect(box).not.toBeNull();
            expect(box?.x).toBeGreaterThanOrEqual(0);
            expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(390);
            expect(box?.y).toBeGreaterThanOrEqual(0);
            expect((box?.y || 0) + (box?.height || 0)).toBeLessThanOrEqual(844);
        });
    }

    test('keeps only one menu open and navigates exactly once', async ({ page }) => {
        await page.goto('/?dropdown=1#/home');
        await openMenu(page, 'Movies');
        await openMenu(page, 'Shows');

        await expect(page.locator('[data-e2e-primary-menu="movies"]')).toHaveCount(0);
        await page.getByRole('menuitem', { name: 'Anime' }).tap();
        await expect(page).toHaveURL(/#\/shows\?view=anime$/);
        await expect(page.locator('[data-e2e-primary-menu]')).toHaveCount(0);
        await expect(page.locator('html')).toHaveAttribute('data-dropdown-navigation-count', '1');
    });

    test('closes on outside tap, route changes, and Escape with focus restoration', async ({ page }) => {
        await page.goto('/?dropdown=1#/shows');
        await openMenu(page, 'Movies');
        await page.locator('.browse-page').tap({ position: { x: 20, y: 20 } });
        await expect(page.locator('[data-e2e-primary-menu]')).toHaveCount(0);

        await openMenu(page, 'Movies');
        await page.evaluate(() => {
            window.location.hash = '#/reading';
        });
        await expect(page.locator('[data-e2e-primary-menu]')).toHaveCount(0);

        const { trigger } = await openMenu(page, 'Shows');
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-e2e-primary-menu]')).toHaveCount(0);
        await expect(trigger).toBeFocused();
    });

    test('does not convert a horizontal nav swipe into a menu toggle', async ({ browserName, page }) => {
        test.skip(browserName !== 'chromium', 'Raw touch-event simulation requires Chromium CDP.');

        await page.goto('/?dropdown=1#/music');
        const box = await page.getByRole('button', { name: /^Movies/ }).boundingBox();
        const session = await page.context().newCDPSession(page);
        const startX = (box?.x || 0) + (box?.width || 0) / 2;
        const y = (box?.y || 0) + (box?.height || 0) / 2;

        await session.send('Input.dispatchTouchEvent', {
            touchPoints: [{ x: startX, y }],
            type: 'touchStart'
        });
        await session.send('Input.dispatchTouchEvent', {
            touchPoints: [{ x: startX + 80, y }],
            type: 'touchMove'
        });
        await session.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });

        await expect(page.locator('[data-e2e-primary-menu]')).toHaveCount(0);
    });

    test('repositions inside the visual viewport after resize and nav scrolling', async ({ page }) => {
        await page.goto('/?dropdown=1#/reading');
        const { panel } = await openMenu(page, 'Shows');

        await page.locator('.primary-navigation-scroll').evaluate(element => {
            element.scrollLeft = 120;
            element.dispatchEvent(new Event('scroll'));
        });
        await page.setViewportSize({ height: 390, width: 844 });
        const box = await panel.boundingBox();

        expect(box).not.toBeNull();
        expect(box?.x).toBeGreaterThanOrEqual(0);
        expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(844);
        expect(box?.y).toBeGreaterThanOrEqual(0);
        expect((box?.y || 0) + (box?.height || 0)).toBeLessThanOrEqual(390);
    });
});
