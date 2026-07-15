import { expect, test, type Page } from '@playwright/test';

async function waitForBrowse(page: Page, filter: string) {
    await expect(page.locator('#browse-items')).toHaveAttribute('data-loading', 'false');
    await expect(page.locator('#browse-items')).toHaveAttribute('data-active-filter', filter);
}

test.describe('focused browse lifecycle', () => {
    test('distinguishes landing and latest pages for movies and shows', async ({ page }) => {
        for (const kind of ['movies', 'shows']) {
            await page.goto(`/#/${kind}`);
            await waitForBrowse(page, `${kind} landing`);
            const landingRoute = await page.locator('.browse-page').getAttribute('data-canonical-route');

            await page.goto(`/#/${kind}?view=latest`);
            await waitForBrowse(page, `${kind} latest`);
            await expect(page.locator('.browse-page')).not.toHaveAttribute('data-canonical-route', landingRoute || '');
        }
    });

    test('preserves exact genre, studio, and network filter identity', async ({ page }) => {
        const routes = [
            ['movies', 'view=genre&genre=Crime', 'Crime'],
            ['movies', 'view=studio&studio=Universal%20Pictures', 'Universal Pictures'],
            ['shows', 'view=network&network=4Kids%20Entertainment', '4Kids Entertainment']
        ];

        for (const [kind, query, expected] of routes) {
            await page.goto(`/#/${kind}?${query}`);
            await waitForBrowse(page, expected);
            await expect(page.getByRole('heading', { name: expected })).toBeVisible();
        }
    });

    test('suppresses a late response during rapid filter changes', async ({ page }) => {
        await page.goto('/#/movies?view=genre&genre=Crime');
        await page.evaluate(() => {
            window.location.hash = '#/movies?view=genre&genre=Horror';
        });

        await waitForBrowse(page, 'Horror');
        await expect(page.locator('#browse-items')).toContainText('Horror 1');
        await expect.poll(async () => Number(
            await page.locator('#app').getAttribute('data-stale-suppression-count') || 0
        )).toBeGreaterThan(0);
        await expect(page.locator('#browse-items')).not.toContainText('Crime');
    });

    test('appends unique Load More results', async ({ page }) => {
        await page.goto('/#/movies?view=genre&genre=Horror');
        await waitForBrowse(page, 'Horror');
        await page.getByRole('button', { name: 'Load More' }).click();

        const ids = await page.locator('.browse-card').evaluateAll(cards => cards.map(card => (
            (card as HTMLElement).dataset.itemId
        )));

        expect(ids).toHaveLength(8);
        expect(new Set(ids).size).toBe(8);
    });

    test('restores route content and scroll position with browser history', async ({ page }) => {
        await page.goto('/#/movies?view=genre&genre=Crime');
        await waitForBrowse(page, 'Crime');
        await page.evaluate(() => window.scrollTo(0, 300));
        await page.evaluate(() => {
            window.location.hash = '#/movies?view=genre&genre=Horror';
        });
        await waitForBrowse(page, 'Horror');

        await page.goBack();
        await waitForBrowse(page, 'Crime');
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    });

    test('persists Curated and All metadata genre modes', async ({ page }) => {
        await page.goto('/#/movies?view=genres');
        await expect(page.getByRole('button', { name: 'Curated' })).toHaveClass(/is-active/);
        await page.getByRole('button', { name: 'All metadata genres' }).click();
        await expect(page.getByRole('button', { name: 'All metadata genres' })).toHaveClass(/is-active/);

        await page.reload();
        await expect(page.getByRole('button', { name: 'All metadata genres' })).toHaveClass(/is-active/);
    });

    test('shows diagnostics only for debug-enabled administrators', async ({ page }) => {
        for (const query of ['', '?admin=1', '?debug=1']) {
            await page.goto(`/${query}#/movies`);
            await expect(page.locator('#diagnostics')).toHaveCount(0);
        }

        await page.goto('/?admin=1&debug=1#/movies');
        await expect(page.locator('#diagnostics')).toBeVisible();
    });
});
