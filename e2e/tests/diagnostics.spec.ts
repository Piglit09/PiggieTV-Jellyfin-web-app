import { expect, test, type Browser, type Page } from '@playwright/test';

const ANDROID_TV_UA = 'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const WEBOS_UA = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/87.0 Safari/537.36 WebAppManager';
const FIRE_TV_UA = 'Mozilla/5.0 (Linux; U; Android 9; en-us; AFTMM) AppleWebKit/537.36 Silk/112.3 like Chrome Safari/537.36';

async function openTvDiagnostics(browser: Browser, userAgent = ANDROID_TV_UA) {
    const context = await browser.newContext({ userAgent });
    const page = await context.newPage();

    await page.goto('/#/dashboard/piggietv/diagnostics');
    await expect(page.locator('#diagnostics-focus-status')).toContainText('TV focus: healthy; isTv=true');

    return { context, page };
}

async function exportDiagnostics(page: Page) {
    await page.getByRole('button', { name: 'Export diagnostics' }).click();

    return JSON.parse(await page.locator('#diagnostics-export').textContent() || '{}');
}

test.describe('PiggieTV diagnostics browser integration', () => {
    test('updates real bounded route/request metrics, exports safely, resets, and cleans up', async ({ page }) => {
        await page.goto('/#/dashboard/piggietv/diagnostics');

        await expect(page.getByRole('heading', { name: 'PiggieTV Diagnostics' })).toBeVisible();
        await expect(page.locator('#diagnostics-health')).toContainText('Overall health');
        await expect(page.locator('#diagnostics-route-count')).toContainText('Routes: 1');
        await expect(page.locator('#diagnostics-request-count')).toContainText('Requests: 0');

        await page.getByRole('button', { name: 'Generate request metric' }).click();
        await expect(page.locator('#diagnostics-request-count')).toContainText('Requests: 1');

        await page.getByRole('button', { name: 'Export diagnostics' }).click();
        const serialized = await page.locator('#diagnostics-export').textContent() || '';
        const exported = JSON.parse(serialized);
        const privateHost = [ '192', '168', '1', '50' ].join('.');

        expect(exported.schemaVersion).toBe(1);
        expect(exported.privacyClassification).toBe('share-safe');
        expect(serialized).not.toContain(privateHost);
        expect(serialized).not.toContain('private-user');
        expect(serialized).not.toContain('private-item');
        expect(serialized).not.toContain('api_key=secret');
        expect(serialized).not.toContain('http://');

        await page.getByRole('button', { name: 'Reset diagnostic session' }).click();
        await expect(page.locator('#diagnostics-request-count')).toContainText('Requests: 0');
        await expect(page.locator('#diagnostics-route-count')).toContainText('Routes: 0');

        await page.evaluate(() => {
            window.location.hash = '#/home';
        });
        await expect(page.locator('#app')).toHaveAttribute('data-diagnostics-subscribers', '0');
    });

    test('toggles the overlay without creating a focus target or stealing focus', async ({ page }) => {
        await page.goto('/#/dashboard/piggietv/diagnostics');
        const toggle = page.getByRole('button', { name: 'Toggle diagnostics overlay' });

        await toggle.focus();
        await toggle.click();
        const overlay = page.locator('[data-ptv-diagnostics-overlay="true"]');

        await expect(overlay).toBeVisible();
        await expect(toggle).toBeFocused();
        await expect(overlay.locator('button, a, input, [tabindex]')).toHaveCount(0);
    });

    test('reports non-TV focus as unsupported rather than failing', async ({ page }) => {
        await page.goto('/#/dashboard/piggietv/diagnostics');

        await expect(page.locator('#diagnostics-focus-status')).toContainText('TV focus: unsupported; isTv=false');
    });

    test('activates focus diagnostics only after an actual TV user-agent profile is established', async ({ browser }) => {
        const context = await browser.newContext({
            userAgent: ANDROID_TV_UA
        });
        const page = await context.newPage();

        await page.goto('/#/dashboard/piggietv/diagnostics');
        await expect.poll(() => page.evaluate(() => /android tv/i.test(navigator.userAgent))).toBe(true);
        await expect(page.locator('#diagnostics-focus-status')).toContainText('TV focus: healthy; isTv=true');
        await context.close();
    });

    test('records every successful directional pipeline stage from the existing TV owner', async ({ browser }) => {
        const { context, page } = await openTvDiagnostics(browser);
        const origin = page.getByRole('button', { name: 'TV focus origin' });
        const target = page.getByRole('button', { name: 'TV focus right target' });

        await origin.focus();
        await page.keyboard.press('ArrowRight');
        await expect(target).toBeFocused();
        const exported = await exportDiagnostics(page);
        const completed = [...exported.inputs].reverse().find((input: { stage: string }) => input.stage === 'completed');
        const stages = exported.inputs
            .filter((input: { inputId: string }) => input.inputId === completed.inputId)
            .map((input: { stage: string }) => input.stage);

        expect(stages).toEqual(expect.arrayContaining([
            'browser-event-received',
            'key-normalized',
            'focus-handler-reached',
            'target-search-started',
            'target-found',
            'focus-movement-requested',
            'focus-event-observed',
            'movement-confirmed',
            'completed'
        ]));
        expect(completed.source).toBe('android-tv-profile');
        await context.close();
    });

    test('localizes no-target failure inside a modal scope and records Back restoration', async ({ browser }) => {
        const { context, page } = await openTvDiagnostics(browser, WEBOS_UA);
        const trigger = page.getByRole('button', { name: 'Open TV focus modal' });

        await trigger.click();
        const only = page.getByRole('button', { name: 'Only modal focus target' });

        await expect(only).toBeFocused();
        await page.keyboard.press('ArrowRight');
        let exported = await exportDiagnostics(page);

        expect(exported.inputs.some((input: { failureReason: string; stage: string }) => (
            input.stage === 'target-rejected' && input.failureReason === 'no-directional-target'
        ))).toBe(true);
        expect(exported.focusGraphs.at(-1).rejectedByReason.blockedByModal).toBeGreaterThan(0);

        await only.focus();
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        exported = await exportDiagnostics(page);
        expect(exported.focusScopes.some((scope: { previousFocusRestored: boolean }) => (
            scope.previousFocusRestored === true
        ))).toBe(true);
        expect(exported.platform.userAgentClassification).toBe('webos');
        await context.close();
    });

    test('diagnoses duplicate repeat input without installing another key owner', async ({ browser }) => {
        const { context, page } = await openTvDiagnostics(browser, FIRE_TV_UA);
        const origin = page.getByRole('button', { name: 'TV focus origin' });

        await origin.focus();
        await page.evaluate(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'ArrowRight',
                repeat: true
            }));
            document.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'ArrowRight',
                repeat: true
            }));
        });
        const exported = await exportDiagnostics(page);

        expect(exported.inputs.some((input: { failureReason: string }) => (
            input.failureReason === 'duplicate-suppressed-by-existing-owner'
        ))).toBe(true);
        expect(exported.latestFocus.duplicateListenerCount).toBe(0);
        expect(exported.platform.userAgentClassification).toBe('fire-tv');
        await context.close();
    });

    test('observes off-screen focus, graph rebuilds, route cleanup, and listener idempotency', async ({ browser }) => {
        const { context, page } = await openTvDiagnostics(browser);
        const initial = await exportDiagnostics(page);

        await page.locator('#diagnostics-focus-fixture').evaluate(element => {
            element.append(document.createElement('button'));
        });
        await expect.poll(async () => (await exportDiagnostics(page)).focusGraphs.at(-1)?.generation || 0)
            .toBeGreaterThan(initial.focusGraphs.at(-1)?.generation || 0);
        await page.getByRole('button', { name: 'Off-screen TV focus target' }).evaluate(element => {
            (element as HTMLElement).focus({ preventScroll: true });
        });
        let exported = await exportDiagnostics(page);

        expect(exported.focusVisibility.some((entry: { status: string; visible: boolean }) => (
            entry.status === 'focus-observed' && entry.visible === false
        ))).toBe(true);

        await page.evaluate(() => {
            window.location.hash = '#/home';
        });
        await page.evaluate(() => {
            window.location.hash = '#/dashboard/piggietv/diagnostics';
        });
        await expect(page.getByRole('heading', { name: 'PiggieTV Diagnostics' })).toBeVisible();
        exported = await exportDiagnostics(page);

        expect(exported.latestFocus.duplicateListenerCount).toBe(0);
        expect(exported.focusGraphs.at(-1).activeScope).not.toBe('modal-dialog');
        await context.close();
    });

    test('retains mini-player and visible video-control scopes on a webOS profile', async ({ browser }) => {
        const { context, page } = await openTvDiagnostics(browser, WEBOS_UA);

        await page.evaluate(() => {
            const dock = document.createElement('aside');

            dock.className = 'ptv-media-dock';
            dock.dataset.ptvPlaybackSurface = 'mini-player';
            dock.style.cssText = 'position:fixed;left:40px;top:40px;display:flex;gap:20px;';
            ['primary', 'next', 'player'].forEach((name, index) => {
                const button = document.createElement('button');

                button.dataset.ptvFocusKey = `mini-player:${name}`;
                button.textContent = name;
                button.style.cssText = `position:absolute;left:${index * 140}px;top:0;width:100px;height:50px;`;
                dock.append(button);
            });
            document.body.append(dock);
            dock.querySelector<HTMLElement>('[data-ptv-focus-key="mini-player:primary"]')?.focus();
        });

        await page.keyboard.press('ArrowRight');
        await expect(page.locator('[data-ptv-focus-key="mini-player:next"]')).toBeFocused();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('[data-ptv-focus-key="mini-player:player"]')).toBeFocused();

        await page.evaluate(() => {
            document.querySelector('.ptv-media-dock')?.remove();
            const videoPage = document.createElement('section');
            const controls = document.createElement('div');

            videoPage.id = 'videoOsdPage';
            controls.className = 'videoOsdBottom';
            controls.style.cssText = 'position:fixed;left:40px;bottom:40px;display:flex;gap:20px;';
            ['back', 'pause'].forEach((name, index) => {
                const button = document.createElement('button');

                button.dataset.ptvFocusKey = `video:${name}`;
                button.textContent = name;
                button.style.cssText = `position:absolute;left:${index * 140}px;top:0;width:100px;height:50px;`;
                controls.append(button);
            });
            videoPage.append(controls);
            document.body.append(videoPage);
            document.documentElement.classList.add('ptv-player-osd-visible');
            window.dispatchEvent(new CustomEvent('ptv:playback-focus', {
                detail: { active: true }
            }));
            controls.querySelector<HTMLElement>('[data-ptv-focus-key="video:back"]')?.focus();
        });

        await page.keyboard.press('ArrowRight');
        await expect(page.locator('[data-ptv-focus-key="video:pause"]')).toBeFocused();
        const exported = await exportDiagnostics(page);

        expect(exported.latestFocus.currentScope).toBe('player-controls');
        expect(exported.latestFocus.duplicateListenerCount).toBe(0);

        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent('ptv:playback-focus', {
                detail: { active: false }
            }));
            document.documentElement.classList.remove('ptv-player-osd-visible');
            document.querySelector('#videoOsdPage')?.remove();
        });
        await context.close();
    });
});
