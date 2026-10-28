import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { compile } from 'sass';

const source = readFileSync(resolve(process.cwd(), 'src/controllers/playback/video/index.html'), 'utf8');
const styles = [
    compile(resolve(process.cwd(), 'src/elements/emby-slider/emby-slider.scss')).css,
    compile(resolve(process.cwd(), 'src/styles/videoosd.scss')).css,
    compile(resolve(process.cwd(), 'src/ptv/modules/playback/playback.scss')).css
].join('\n');

test.use({ hasTouch: true });

async function showPlayerFixture(page: import('@playwright/test').Page) {
    await page.setContent(`<!doctype html><html class="ptv-player-page ptv-player-osd-visible ptv-player-chrome-visible">
        <head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
            * { box-sizing: border-box; }
            html, body { margin: 0; font: 16px sans-serif; }
            .hide { display: none !important; }
            .flex { display: flex; }
            .flex-grow { flex-grow: 1; min-width: 0; }
            .sliderContainer { min-width: 0; }
            ${styles}
        </style></head><body class="ptv-player-page">${source}</body></html>`);

    await page.evaluate(() => {
        const osd = document.querySelector('#videoOsdPage');
        osd?.classList.add('ptv-player-page');
        const progress = osd?.querySelector('.osdPositionSlider');
        progress?.classList.add('mdl-slider');
        const progressContainer = progress?.closest('.sliderContainer');
        progressContainer?.classList.add('mdl-slider-container');
        progressContainer?.insertAdjacentHTML('beforeend', '<div class="mdl-slider-background-flex-container"><div class="mdl-slider-background-flex"><div class="mdl-slider-background-flex-inner"><div class="mdl-slider-background-upper"></div><div class="mdl-slider-background-lower"></div></div></div></div>');
        const topbar = document.createElement('div');
        topbar.className = 'ptv-player-topbar';
        topbar.innerHTML = '<button class="ptv-player-top-button ptv-player-top-back">Back</button><span class="ptv-player-top-title">Series episode</span>';
        osd?.append(topbar);
        document.documentElement.classList.add('ptv-player-chrome-visible');
        for (const selector of [
            '.btnPreviousTrack', '.btnPreviousChapter', '.btnNextChapter', '.btnNextTrack',
            '.btnSubtitles', '.btnAudio', '.btnAirPlay', '.btnPip', '.btnFullscreen'
        ]) {
            osd?.querySelector(selector)?.classList.remove('hide');
        }
    });
}

test('compact player controls keep 44px touch targets within the panel across resizing', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await showPlayerFixture(page);
    await page.evaluate(() => {
        const pause = document.querySelector<HTMLButtonElement>('.btnPause')!;
        pause.addEventListener('click', () => {
            pause.dataset.tapCount = String(Number(pause.dataset.tapCount || 0) + 1);
        });
    });

    for (const [index, viewport] of [{ width: 390, height: 844 }, { width: 280, height: 650 }, { width: 800, height: 600 }].entries()) {
        await page.setViewportSize(viewport);
        const bounds = await page.evaluate(() => {
            const panel = document.querySelector('.osdControls')!.getBoundingClientRect();
            const buttons = [...document.querySelectorAll<HTMLButtonElement>('.osdControls .buttons button')]
                .filter(button => button.getClientRects().length > 0)
                .map(button => {
                    const rect = button.getBoundingClientRect();
                    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);

                    return {
                        hittable: target === button || button.contains(target),
                        name: button.className,
                        rect: rect.toJSON()
                    };
                });
            const transportButtons = [...document.querySelectorAll<HTMLButtonElement>('.osdControls .buttons > [dir="ltr"] button')]
                .filter(button => button.getClientRects().length > 0)
                .map(button => button.getBoundingClientRect().toJSON());

            return {
                buttons,
                transportButtons,
                panel: panel.toJSON(),
                panelPadding: {
                    left: Number.parseFloat(getComputedStyle(document.querySelector('.osdControls')!).paddingLeft),
                    right: Number.parseFloat(getComputedStyle(document.querySelector('.osdControls')!).paddingRight)
                },
                progress: document.querySelector('.osdPositionSlider')!.getBoundingClientRect().toJSON(),
                progressContainer: document.querySelector('.osdPositionSlider')!.closest('.sliderContainer')!.getBoundingClientRect().toJSON(),
                volumeDisplay: getComputedStyle(document.querySelector('.volumeButtons')!).display,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                scrollWidth: document.documentElement.scrollWidth
            };
        });

        expect(bounds.buttons.length).toBeGreaterThan(4);
        expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.viewportWidth);
        expect(bounds.panel.left).toBeGreaterThanOrEqual(0);
        expect(bounds.panel.right).toBeLessThanOrEqual(bounds.viewportWidth);
        expect(bounds.panel.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
        expect(bounds.progress.height, `${viewport.width}px progress touch height`).toBeGreaterThanOrEqual(44);
        expect(bounds.progressContainer.height, `${viewport.width}px progress row height`).toBeGreaterThanOrEqual(44);
        expect(bounds.volumeDisplay === 'none', `${viewport.width}px volume visibility`).toBe(viewport.width <= 688);
        for (const button of bounds.buttons) {
            expect(button.hittable, `${viewport.width}px ${button.name} pointer target`).toBe(true);
            expect(button.rect.width, `${viewport.width}px ${button.name} width`).toBeGreaterThanOrEqual(44);
            expect(button.rect.height, `${viewport.width}px ${button.name} height`).toBeGreaterThanOrEqual(44);
            expect(button.rect.left, `${viewport.width}px ${button.name} left`).toBeGreaterThanOrEqual(bounds.panel.left + bounds.panelPadding.left);
            expect(button.rect.right, `${viewport.width}px ${button.name} right`).toBeLessThanOrEqual(bounds.panel.right - bounds.panelPadding.right);
        }
        for (const [transportIndex, button] of bounds.transportButtons.entries()) {
            const next = bounds.transportButtons[transportIndex + 1];
            if (next && Math.abs(button.top - next.top) < 2) {
                expect(next.left - button.right, `${viewport.width}px transport spacing`).toBeGreaterThanOrEqual(4);
            }
        }
        await page.locator('.btnPause').tap();
        await expect(page.locator('.btnPause')).toHaveAttribute('data-tap-count', String(index + 1));
        if (viewport.width <= 390) {
            await page.screenshot({ path: testInfo.outputPath(`player-controls-${viewport.width}.png`) });
        }
    }
});

test('player chrome keeps viewport insets after portrait to landscape resize', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await showPlayerFixture(page);
    await page.evaluate(() => {
        document.documentElement.style.setProperty('--ptv-player-safe-top', '32px');
        document.documentElement.style.setProperty('--ptv-player-safe-right', '28px');
        document.documentElement.style.setProperty('--ptv-player-safe-bottom', '30px');
        document.documentElement.style.setProperty('--ptv-player-safe-left', '26px');
    });

    for (const viewport of [
        { width: 390, height: 844 },
        { width: 844, height: 390 },
        { width: 1440, height: 900 }
    ]) {
        await page.setViewportSize(viewport);
        const bounds = await page.evaluate(() => {
            const bottom = document.querySelector('.videoOsdBottom')!.getBoundingClientRect();
            const topbar = document.querySelector('.ptv-player-topbar')!.getBoundingClientRect();
            const back = document.querySelector('.ptv-player-top-back')!.getBoundingClientRect();

            return {
                bottom: bottom.toJSON(),
                topbar: topbar.toJSON(),
                back: back.toJSON(),
                height: window.innerHeight,
                width: window.innerWidth
            };
        });

        expect(bounds.topbar.top).toBeGreaterThanOrEqual(32);
        expect(bounds.topbar.left).toBeGreaterThanOrEqual(viewport.width > 900 ? 36 : 26);
        expect(bounds.width - bounds.topbar.right).toBeGreaterThanOrEqual(viewport.width > 900 ? 36 : 28);
        expect(bounds.back.width).toBeGreaterThanOrEqual(44);
        expect(bounds.back.height).toBeGreaterThanOrEqual(44);
        expect(bounds.bottom.left).toBeGreaterThanOrEqual(26);
        expect(bounds.width - bounds.bottom.right).toBeGreaterThanOrEqual(28);
        expect(bounds.height - bounds.bottom.bottom).toBeGreaterThanOrEqual(30);
        if (viewport.width > viewport.height && viewport.width < 900) {
            await page.screenshot({ path: testInfo.outputPath('player-controls-landscape.png') });
        }
    }
});
