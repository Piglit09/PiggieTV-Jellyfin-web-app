import { expect, test } from '@playwright/test';

const AUTHENTICATION_ROUTES = [
    '#/login',
    '#/login?serverid=server-fixture&url=http%3A%2F%2Fexample.invalid',
    '#/signup',
    '#/forgotpassword',
    '#/quickconnect',
    '#/selectserver'
];

test.describe('authentication shell ownership', () => {
    for (const route of AUTHENTICATION_ROUTES) {
        test(`keeps authenticated navigation hidden on ${route}`, async ({ page }) => {
            await page.goto(`/${route}`);

            await expect(page.locator('.auth-card')).toBeVisible();
            await expect(page.locator('.authenticated-header')).toHaveCount(0);
            await expect(page.locator('.mainDrawer[data-ptv-compatibility-anchor="true"]')).toBeHidden();
            await expect(page.locator('.skinHeader[data-ptv-compatibility-anchor="true"]')).toBeHidden();
        });
    }

    test('restores authenticated navigation after successful login', async ({ page }) => {
        await page.goto('/#/login?serverid=server-fixture');
        await page.getByRole('button', { name: 'Sign in' }).click();

        await expect(page).toHaveURL(/#\/home$/);
        await expect(page.locator('.authenticated-header')).toBeVisible();
        await expect(page.locator('.auth-card')).toHaveCount(0);
    });

    test('restores the correct shell across browser history', async ({ page }) => {
        await page.goto('/#/home');
        await page.evaluate(() => {
            window.location.hash = '#/login';
        });
        await expect(page.locator('.auth-card')).toBeVisible();

        await page.goBack();
        await expect(page.locator('.authenticated-header')).toBeVisible();
    });

    for (const viewport of [
        { height: 1271, name: 'desktop', width: 2560 },
        { height: 1366, name: 'tablet', width: 1024 },
        { height: 844, name: 'mobile', width: 390 },
        { height: 1080, name: 'TV', width: 1920 }
    ]) {
        test(`${viewport.name} login keeps authenticated chrome hidden`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.goto('/#/login?serverid=server-fixture&url=http%3A%2F%2Fexample.invalid');

            await expect(page.locator('.auth-card')).toBeVisible();
            await expect(page.locator('.authenticated-header')).toHaveCount(0);
            await expect(page.locator('.mainDrawer[data-ptv-compatibility-anchor="true"]')).toBeHidden();
            await expect(page.locator('.skinHeader[data-ptv-compatibility-anchor="true"]')).toBeHidden();
        });
    }
});
