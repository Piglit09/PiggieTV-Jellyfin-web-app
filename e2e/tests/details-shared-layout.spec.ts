import { expect, test } from '@playwright/test';

const kinds = ['Movie', 'Series', 'Season', 'Book', 'Anime', 'Cartoons'] as const;
const viewports = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 600, height: 900 },
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1366, height: 900 },
    { width: 1440, height: 900 }
];

for (const kind of kinds) {
    test(`${kind} shared Details keeps poster, actions, and rails within the viewport after live resize`, async ({ page }) => {
        await page.setViewportSize(viewports[0]);
        await page.goto(`/#/details?id=fixture-item&fixtureKind=${kind}`);

        const detail = page.locator(`#itemDetailPage[data-ptv-details-fixture-kind="${kind}"]`);
        await expect(detail).toBeVisible();
        const backdropSource = await page.locator('.ptv-details-backdrop__image').getAttribute('src');

        for (const viewport of viewports) {
            await page.setViewportSize(viewport);
            const geometry = await page.evaluate(() => {
                const bounds = (selector: string) => {
                    const element = document.querySelector<HTMLElement>(selector);
                    const rect = element?.getBoundingClientRect();

                    return rect && element && getComputedStyle(element).display !== 'none' ? {
                        bottom: rect.bottom,
                        left: rect.left,
                        right: rect.right,
                        top: rect.top,
                        width: rect.width
                    } : null;
                };

                return {
                    actions: bounds('.mainDetailButtons'),
                    actionButtons: Array.from(document.querySelectorAll<HTMLElement>('.mainDetailButtons .detailButton')).map(button => {
                        const rect = button.getBoundingClientRect();

                        return { left: rect.left, right: rect.right, width: rect.width };
                    }),
                    castScroll: (() => {
                        const rail = document.querySelector<HTMLElement>('#castCollapsible .detail-shelf-fixture');

                        if (!rail) return null;
                        const before = rail.scrollLeft;
                        rail.scrollLeft = 96;
                        const after = rail.scrollLeft;
                        rail.scrollLeft = before;

                        return { after, clientWidth: rail.clientWidth, scrollWidth: rail.scrollWidth };
                    })(),
                    desktopPoster: bounds('.detailImageContainer.hide-mobile'),
                    documentWidth: document.documentElement.scrollWidth,
                    mobilePoster: bounds('.detailImageContainer.hide-desktop'),
                    primary: bounds('.detailPagePrimaryContainer'),
                    ribbon: bounds('.detailRibbon'),
                    shelf: bounds('#similarCollapsible'),
                    title: bounds('.itemName'),
                    viewportWidth: window.innerWidth
                };
            });

            expect(geometry.documentWidth, `${kind} at ${viewport.width}px: page overflow`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
            expect(geometry.primary).not.toBeNull();
            expect(geometry.ribbon).not.toBeNull();
            expect(geometry.actions).not.toBeNull();
            expect(geometry.title).not.toBeNull();
            expect(geometry.shelf).not.toBeNull();

            for (const name of ['primary', 'ribbon', 'actions', 'title', 'shelf'] as const) {
                const rect = geometry[name]!;
                expect(rect.left, `${kind} at ${viewport.width}px: ${name} left edge`).toBeGreaterThanOrEqual(-1);
                expect(rect.right, `${kind} at ${viewport.width}px: ${name} right edge`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
            }
            for (const button of geometry.actionButtons) {
                expect(button.width, `${kind} at ${viewport.width}px: action touch width`).toBeGreaterThanOrEqual(44);
                expect(button.left, `${kind} at ${viewport.width}px: action left edge`).toBeGreaterThanOrEqual(-1);
                expect(button.right, `${kind} at ${viewport.width}px: action right edge`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
            }
            expect(geometry.castScroll).not.toBeNull();
            if (viewport.width <= 390) {
                expect(geometry.castScroll!.scrollWidth).toBeGreaterThan(geometry.castScroll!.clientWidth);
                expect(geometry.castScroll!.after).toBeGreaterThan(0);
            }

            if (viewport.width <= 900) {
                expect(geometry.mobilePoster).not.toBeNull();
                expect(geometry.desktopPoster).toBeNull();
                expect(geometry.mobilePoster!.bottom).toBeLessThanOrEqual(geometry.title!.top + 1);
                expect(geometry.title!.bottom).toBeLessThanOrEqual(geometry.actions!.top + 1);
            } else {
                expect(geometry.desktopPoster).not.toBeNull();
                expect(geometry.mobilePoster).toBeNull();
                expect(geometry.desktopPoster!.right).toBeLessThan(geometry.ribbon!.left);
            }

            expect(await page.locator('.ptv-details-backdrop__image').getAttribute('src')).toBe(backdropSource);
        }
    });
}
