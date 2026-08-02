import { expect, test, type Page } from '@playwright/test';

async function expectCollectionsReady(page: Page, view: string) {
    const route = page.locator('.ptv-collections').first();

    await expect(route).toBeVisible();
    await expect(route).toHaveAttribute('data-ptv-collections-view', view);
    await expect(route).toHaveAttribute('data-ptv-duplicate-request-keys', '0');
    await expect(route).toHaveAttribute('data-ptv-runtime-count', '1');
    await expect(route).toHaveAttribute('data-ptv-shell-count', '1');
}

test.describe('premium Collections route', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            window.localStorage.removeItem('ptv:e2e:collection-scope');
            window.localStorage.removeItem('ptv:e2e:collections:server-a:user-a');
            window.localStorage.removeItem('ptv:e2e:collections:server-a:user-b');
        });
    });

    test('supports landing, required views, Details, a member, and Back restoration', async ({ page }) => {
        await page.goto('/#/collections');
        await expectCollectionsReady(page, 'landing');
        await expect(page.getByRole('heading', { name: 'Featured Collections' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Your Jellyfin Collections' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Cross-Library Worlds' })).toBeVisible();

        await page.getByRole('link', { name: 'All' }).click();
        await expectCollectionsReady(page, 'all');
        await page.locator('.ptv-collection-card > a').first().click();
        await expectCollectionsReady(page, 'details');
        await expect(page.getByRole('heading', { name: 'The Great Saga' })).toBeVisible();
        await page.locator('.ptv-collection-memberGrid a').first().click();
        await expect(page.locator('body')).toHaveClass(/ptv-e2e-details/);
        await page.goBack();
        await expectCollectionsReady(page, 'details');
        await page.goBack();
        await expectCollectionsReady(page, 'all');

        await page.getByRole('link', { name: 'Genres' }).click();
        await expectCollectionsReady(page, 'genres');
        await page.getByRole('link', { name: 'Animation' }).click();
        await expectCollectionsReady(page, 'genre');
    });

    test('persists pin/hide by profile and resets collection visibility only', async ({ page }) => {
        await page.goto('/#/collections?view=all');
        const firstCard = page.locator('.ptv-collection-card').filter({ hasText: 'The Great Saga' });

        await firstCard.getByRole('button', { name: 'Pin' }).click();
        await page.goto('/#/collections');
        await expect(page.getByRole('heading', { name: 'Pinned Collections' })).toBeVisible();
        await page.locator('.ptv-collection-card').filter({ hasText: 'The Great Saga' }).last().getByRole('button', { name: 'Hide' }).click();
        await expect(page.locator('.ptv-collection-card').filter({ hasText: 'The Great Saga' })).toHaveCount(0);
        await page.reload();
        await expect(page.locator('.ptv-collection-card').filter({ hasText: 'The Great Saga' })).toHaveCount(0);

        await page.evaluate(() => window.localStorage.setItem('ptv:e2e:collection-scope', 'server-a:user-b'));
        await page.reload();
        await expect(page.locator('.ptv-collection-card').filter({ hasText: 'The Great Saga' }).first()).toBeVisible();

        await page.evaluate(() => window.localStorage.setItem('ptv:e2e:collection-scope', 'server-a:user-a'));
        await page.reload();
        await page.getByRole('button', { name: 'Reset hidden collections' }).click();
        await expect(page.locator('.ptv-collection-card').filter({ hasText: 'The Great Saga' }).first()).toBeVisible();
    });

    test('opens Collection Search results and restores Search query and filter on Back', async ({ page }) => {
        await page.goto('/#/search?query=Saga&filter=collections');
        const card = page.locator('[data-ptv-search-item-type="BoxSet"]').first();

        await expect(card).toBeVisible();
        await card.click();
        await expectCollectionsReady(page, 'details');
        await page.goBack();
        await expect(page).toHaveURL(/#\/search\?query=Saga&filter=collections/);
        await expect(page.locator('input[type="search"]')).toHaveValue('Saga');
    });

    test('keeps focus keys and layout usable for TV, phone, and reduced motion', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/#/collections');
        await expectCollectionsReady(page, 'landing');
        await expect(page.locator('[data-ptv-initial-focus="true"]')).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.locator('[data-ptv-initial-focus="true"]').focus();
        await expect(page.locator('[data-ptv-initial-focus="true"]')).toBeFocused();
    });

    test('survives three route cycles and one optional-source failure without DOM growth', async ({ page }) => {
        const counts: number[] = [];

        for (let cycle = 0; cycle < 3; cycle += 1) {
            await page.goto('/#/collections?sourceFailure=1');
            await expectCollectionsReady(page, 'landing');
            await expect(page.getByText('Optional cross-library source unavailable. Jellyfin Collections remain ready.')).toBeVisible();
            counts.push(await page.locator('*').count());
            await page.goto('/#/home');
        }

        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
    });
});
