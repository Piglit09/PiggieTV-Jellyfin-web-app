import { expect, test } from '@playwright/test';

const HOME_WIDTHS = [360, 390, 430, 600, 769, 820, 1024, 1366, 1440];

test('Home Hero and shelf CSS keep content usable across a live viewport resize', async ({ page }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto('/#/home');
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();

    // The E2E Home route models data behavior with a simplified DOM. This specimen
    // uses the shipped NativeHome class structure to cover its responsive CSS.
    await page.locator('#app').evaluate(root => {
        root.innerHTML = `
            <main class="ptv-native-home-page">
                <div class="ptv-native-home">
                    <section class="ptv-cinematic-hero ptv-native-home-hero" data-ptv-layout-node="home-hero">
                        <div class="ptv-native-home-hero-content">
                            <h1>Featured Story</h1>
                            <div class="ptv-native-home-hero-meta">2026 • Drama • 4K</div>
                            <p class="ptv-native-home-overview">A cinematic story with a readable summary across phone, tablet, and desktop widths.</p>
                            <div class="ptv-native-home-hero-actions">
                                <a class="ptv-native-home-primary-action" href="#/details?id=fixture-item">Play Now</a>
                                <a class="ptv-native-home-secondary-action" href="#/details?id=fixture-item">Details</a>
                            </div>
                        </div>
                    </section>
                    <div class="ptv-native-home-rows" data-ptv-layout-node="home-rows">
                        <div class="ptv-native-home-row-group">
                            <div class="ptv-native-home-row-anchor">
                                <section class="ptv-native-home-row">
                                    <div class="ptv-native-home-row-heading"><h2>Continue Watching</h2></div>
                                    <div class="ptv-native-home-row-rail">
                                        <div class="ptv-native-home-scroller" aria-label="Continue Watching titles">
                                            ${Array.from({ length: 12 }, (_, index) => `
                                                <div class="ptv-native-home-card-cell"><article class="ptv-native-card">Story ${index + 1}</article></div>
                                            `).join('')}
                                        </div>
                                    </div>
                                </section>
                            </div>
                        </div>
                    </div>
                </div>
            </main>`;
    });

    const hero = page.locator('.ptv-native-home-hero-content');
    const actions = page.locator('.ptv-native-home-hero-actions a');
    const scroller = page.locator('.ptv-native-home-scroller');
    const cards = page.locator('.ptv-native-home-card-cell');

    for (const width of HOME_WIDTHS) {
        await page.setViewportSize({ height: width <= 430 ? 780 : 900, width });

        const geometry = await page.evaluate(() => {
            const bounds = (element: Element) => element.getBoundingClientRect();
            const heroContent = bounds(document.querySelector('.ptv-native-home-hero-content')!);
            const buttons = Array.from(document.querySelectorAll('.ptv-native-home-hero-actions a'))
                .map(bounds);
            const cardWidths = Array.from(document.querySelectorAll('.ptv-native-home-card-cell'))
                .slice(0, 3).map(card => bounds(card).width);
            const rail = document.querySelector<HTMLElement>('.ptv-native-home-scroller')!;

            return {
                buttonBounds: buttons.map(rect => ({ left: rect.left, right: rect.right })),
                cardWidths,
                documentWidth: document.documentElement.scrollWidth,
                heroLeft: heroContent.left,
                heroRight: heroContent.right,
                railClientWidth: rail.clientWidth,
                railScrollWidth: rail.scrollWidth,
                viewportWidth: document.documentElement.clientWidth
            };
        });

        expect(geometry.documentWidth, `page overflow at ${width}px`)
            .toBeLessThanOrEqual(geometry.viewportWidth + 1);
        expect(geometry.heroLeft, `Hero left edge at ${width}px`).toBeGreaterThanOrEqual(-1);
        expect(geometry.heroRight, `Hero right edge at ${width}px`)
            .toBeLessThanOrEqual(geometry.viewportWidth + 1);
        expect(geometry.buttonBounds.length).toBe(2);
        for (const button of geometry.buttonBounds) {
            expect(button.left, `action left edge at ${width}px`).toBeGreaterThanOrEqual(-1);
            expect(button.right, `action right edge at ${width}px`)
                .toBeLessThanOrEqual(geometry.viewportWidth + 1);
        }
        expect(new Set(geometry.cardWidths.map(Math.round)).size).toBe(1);
        expect(geometry.railScrollWidth).toBeGreaterThan(geometry.railClientWidth);
        await expect(hero).toBeVisible();
        await expect(actions).toHaveCount(2);
        await expect(cards).toHaveCount(12);
    }

    await page.setViewportSize({ height: 780, width: 390 });
    await scroller.evaluate(element => {
        element.scrollLeft = 210;
    });
    await expect.poll(() => scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await page.setViewportSize({ height: 900, width: 820 });
    await expect.poll(() => scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollLeft)).toBe(0);
});
