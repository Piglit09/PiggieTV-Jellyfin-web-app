/* eslint-disable compat/compat -- Live-runtime checks execute only in current Playwright browsers. */
import { devices, expect, test } from '@playwright/test';

function trimTrailingSlashes(value: string) {
    let nextValue = value;

    while (nextValue.endsWith('/')) nextValue = nextValue.slice(0, -1);

    return nextValue;
}

const liveDevUrl = trimTrailingSlashes(String(process.env.PTV_LIVE_DEV_URL || ''));
const liveDevHost = liveDevUrl ? new URL(liveDevUrl).hostname : '';
const liveJellyfinUrl = trimTrailingSlashes(String(process.env.PTV_LIVE_JELLYFIN_URL || ''));
const expectedLiveCommit = String(process.env.PTV_EXPECTED_LIVE_COMMIT || '').trim();

test.describe('live PiggieTV development runtime', () => {
    test.skip(!liveDevUrl, 'Set PTV_LIVE_DEV_URL to verify the real development bundle.');

    for (const profile of [
        { name: 'desktop', options: { viewport: { height: 1271, width: 2560 } } },
        { name: 'android', options: devices['Pixel 7'] },
        { name: 'tablet', options: devices['iPad Pro 11'] }
    ]) {
        test(`${profile.name} login owns the viewport without authenticated chrome`, async ({ browser }) => {
            const context = await browser.newContext(profile.options);
            const page = await context.newPage();
            const consoleErrors: string[] = [];
            const pageErrors: string[] = [];

            page.on('console', message => {
                if (message.type() === 'error') consoleErrors.push(message.text());
            });
            page.on('pageerror', error => pageErrors.push(error.message));
            await page.goto(`${liveDevUrl}/#/login?ptv-layout-check=1`, {
                waitUntil: 'domcontentloaded'
            });

            const loginPage = page.locator('#loginPage');
            const loginShell = page.locator('#loginPage .ptv-login-shell');

            await expect(loginPage).toBeVisible();
            await expect(loginShell).toBeVisible();
            await expect(page.locator('webpack-dev-server-client-overlay')).toHaveCount(0);
            await expect.poll(() => loginPage.evaluate(element => element.getBoundingClientRect().height))
                .toBeGreaterThanOrEqual(profile.options.viewport?.height || 800);

            const bounds = await page.evaluate(() => {
                const login = document.querySelector<HTMLElement>('#loginPage');
                const shell = document.querySelector<HTMLElement>('#loginPage .ptv-login-shell');
                const visibleHeaderCount = [
                    '.skinHeader',
                    '.ptv-app-header',
                    '.ptv-shell-header',
                    '.headerTop'
                ].flatMap(selector => Array.from(document.querySelectorAll<HTMLElement>(selector)))
                    .filter(element => {
                        const style = window.getComputedStyle(element);
                        const rect = element.getBoundingClientRect();

                        return style.display !== 'none'
                            && style.visibility !== 'hidden'
                            && rect.width > 0
                            && rect.height > 0;
                    }).length;

                return {
                    login: login?.getBoundingClientRect().toJSON(),
                    shell: shell?.getBoundingClientRect().toJSON(),
                    visibleHeaderCount
                };
            });

            expect(bounds.login?.top).toBeGreaterThanOrEqual(-1);
            expect(bounds.login?.bottom).toBeGreaterThanOrEqual(profile.options.viewport?.height || 800);
            expect(bounds.shell?.bottom).toBeGreaterThan(0);
            expect(bounds.visibleHeaderCount).toBe(0);

            for (const selector of ['#txtManualName', '#txtManualPassword']) {
                const input = page.locator(selector);

                if (await input.count()) {
                    await input.focus();
                    await expect(input).toBeFocused();
                    await expect(loginShell).toBeVisible();
                }
            }

            const viewport = profile.options.viewport;

            if (viewport && viewport.height > 720) {
                await page.setViewportSize({
                    height: Math.max(600, viewport.height - 280),
                    width: viewport.width
                });
                await expect(loginPage).toBeVisible();
                await expect(loginShell).toBeVisible();
                expect(await loginPage.evaluate(element => element.scrollHeight >= element.clientHeight))
                    .toBe(true);
            }

            expect({ consoleErrors, pageErrors }).toEqual({ consoleErrors: [], pageErrors: [] });

            await context.close();
        });
    }

    test('split-origin clients use the explicit Jellyfin backend without rebasing it', async ({ browser }) => {
        test.skip(!liveDevUrl || !liveJellyfinUrl,
            'Set PTV_LIVE_DEV_URL and PTV_LIVE_JELLYFIN_URL for split-origin verification.');

        const context = await browser.newContext(devices['Pixel 7']);

        await context.addInitScript(() => {
            window.localStorage.setItem('ptv:dev:jellyfinServerUrl', 'http://localhost:8096');
            window.localStorage.setItem('ptv:jellyfinServerUrl', 'http://127.0.0.1:8096');
        });

        const page = await context.newPage();
        const discoveryHosts: string[] = [];

        page.on('request', request => {
            const url = new URL(request.url());

            if (url.pathname.toLowerCase().endsWith('/system/info/public')) {
                discoveryHosts.push(url.hostname);
            }
        });

        await page.goto(`${liveDevUrl}/#/login`, { waitUntil: 'networkidle' });
        await expect(page.locator('#loginPage .ptv-login-shell')).toBeVisible();
        expect(discoveryHosts.length).toBeGreaterThan(0);
        expect(discoveryHosts[0]).toBe(new URL(liveJellyfinUrl).hostname);
        expect(discoveryHosts).not.toContain(liveDevHost);
        expect(await page.evaluate(() => ({
            controlled: Boolean(navigator.serviceWorker?.controller)
        }))).toEqual({ controlled: false });

        await context.close();
    });

    test('served bundle contains the current NavDrawer lifecycle fix and development provenance', async ({ page }) => {
        await page.goto(`${liveDevUrl}/#/login`, { waitUntil: 'networkidle' });

        const resources = await page.evaluate(() => performance.getEntriesByType('resource')
            .map(entry => entry.name));
        const navDrawerUrl = resources.find(url => url.includes('lib_navdrawer_navdrawer_js'));

        expect(navDrawerUrl).toBeTruthy();
        const [navDrawerSource, mainSource] = await Promise.all([
            page.evaluate(url => fetch(url).then(response => response.text()), navDrawerUrl!),
            page.evaluate(url => fetch(url).then(response => response.text()), `${liveDevUrl}/main.jellyfin.bundle.js`)
        ]);

        expect(navDrawerSource).toContain('removeEdgeSwipeListeners');
        expect(navDrawerSource).not.toMatch(/edgeSwipeTarget\s*=\s*document\.querySelector/);
        expect(mainSource).toContain('Dev Server');
        expect(mainSource).toContain(expectedLiveCommit || 'commit: ');
    });

    test('unauthenticated Home navigation remains populated by the login experience', async ({ page }) => {
        await page.goto(`${liveDevUrl}/#/home`, { waitUntil: 'networkidle' });
        await expect(page.locator('#loginPage .ptv-login-shell')).toBeVisible();
        await page.reload({ waitUntil: 'networkidle' });
        await expect(page.locator('#loginPage .ptv-login-shell')).toBeVisible();
        expect(await page.locator('.mainAnimatedPages').evaluate(element => element.childElementCount))
            .toBeGreaterThan(0);
    });
});
/* eslint-enable compat/compat */
