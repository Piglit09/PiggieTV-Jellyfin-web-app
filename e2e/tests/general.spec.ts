import { expect, test } from '@playwright/test';

test.describe('general runtime integration', () => {
    test('offers a waiting service-worker update and requests activation', async ({ page }) => {
        await page.goto('/?update=waiting#/home');
        await expect(page.locator('#update-notice')).toContainText('PiggieTV update available');
        await page.getByRole('button', { name: 'Reload' }).click();
        await expect(page.locator('html')).toHaveAttribute('data-skip-waiting-requested', 'true');
    });

    test('defers an update while playback is active', async ({ page }) => {
        await page.goto('/?update=waiting&active=1#/home');
        await page.getByRole('button', { name: 'Reload' }).click();

        await expect(page.locator('#update-notice')).toContainText('Playback is active.');
        await expect(page.locator('html')).not.toHaveAttribute('data-skip-waiting-requested', 'true');
    });

    test('supports keyboard focus through authenticated navigation', async ({ page }) => {
        await page.goto('/#/home');
        await page.keyboard.press('Tab');

        await expect(page.getByRole('link', { name: 'Home' })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.getByRole('link', { name: 'Movies' })).toBeFocused();
    });

    for (const viewport of [
        { height: 1271, name: 'desktop', width: 2560 },
        { height: 844, name: 'mobile', width: 390 },
        { height: 1366, name: 'tablet', width: 1024 },
        { height: 1080, name: 'TV', width: 1920 }
    ]) {
        test(`${viewport.name} viewport has usable content and no runtime overlay`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.goto('/#/shows?view=latest');

            await expect(page.locator('.browse-page')).toBeVisible();
            await expect(page.locator('webpack-dev-server-client-overlay')).toHaveCount(0);
            await expect(page.locator('.authenticated-header')).toBeVisible();
        });
    }
});
