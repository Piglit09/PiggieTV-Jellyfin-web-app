import { expect, test } from '@playwright/test';

test.describe('PiggieTV episode details layout', () => {
    test('presents a cinematic episode hero with recommendations in the first TV viewport', async ({ page }) => {
        await page.setViewportSize({ height: 1271, width: 2560 });
        await page.goto('/#/details?id=fixture-item');

        const detailPage = page.locator('#itemDetailPage.ptv-details-native-root.ptv-details--episode');

        await expect(detailPage).toBeVisible();
        await expect(page.locator('.skinHeader:not([hidden])')).toHaveCount(0);
        await expect(page.locator('.ptv-shell-nav-button')).toHaveText([
            'Home',
            'Movies',
            'Shows',
            'Music',
            'Reading',
            'Search'
        ]);
        await expect(page.locator('.ptv-shell-nav-button.is-active')).toHaveText('Shows');
        await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
        await expect(page.locator('.detailLogo.ptv-detail-native-logo')).toBeVisible();
        await expect(page.locator('.ptv-episode-context')).toHaveText('S1 E1 • EPISODE');
        await expect(page.locator('.ptv-episode-title')).toHaveText('Romance Dawn');
        await expect(page.locator('.ptv-episode-metadata')).toHaveText(/2023.*1h 4m.*TV-14.*★ 8\.3/);
        await expect(page.locator('.ptv-episode-genres')).toHaveText('Action / Adventure / Comedy');
        await expect(page.locator('.btnPlay .ptv-detail-action-label')).toHaveText('Resume');
        await expect(page.locator('.btnReplay .ptv-detail-action-label')).toHaveText('Restart');
        await expect(page.locator('.btnMoreCommands')).toBeHidden();
        await expect(page.locator('.ptv-episode-native-name')).toBeHidden();
        await expect(page.locator('.itemMiscInfo-primary')).toBeHidden();

        const geometry = await page.evaluate(() => {
            const bounds = (selector: string) => {
                const rect = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();

                return rect ? {
                    bottom: rect.bottom,
                    height: rect.height,
                    width: rect.width,
                    x: rect.x,
                    y: rect.y
                } : null;
            };

            return {
                firstRecommendation: bounds('#similarCollapsible .card'),
                heroArtwork: bounds('.detailImageContainer.hide-mobile'),
                innerHeight: window.innerHeight,
                primary: bounds('.ptv-details-native-primary'),
                secondary: bounds('.ptv-details-native-secondary')
            };
        });

        expect(geometry.heroArtwork).not.toBeNull();
        expect(geometry.firstRecommendation).not.toBeNull();
        expect(geometry.primary).not.toBeNull();
        expect(geometry.secondary).not.toBeNull();
        expect(geometry.heroArtwork!.width / geometry.heroArtwork!.height).toBeCloseTo(16 / 9, 1);
        expect(geometry.firstRecommendation!.y).toBeLessThan(geometry.innerHeight);
        expect((geometry.innerHeight - geometry.firstRecommendation!.y) / geometry.firstRecommendation!.height)
            .toBeGreaterThan(0.2);
        expect(Math.abs(geometry.primary!.x - geometry.secondary!.x)).toBeLessThanOrEqual(2);

        const visualState = await page.evaluate(() => {
            const backdrop = document.querySelector<HTMLElement>('.ptv-details-backdrop')!;
            const backdropImage = backdrop.querySelector<HTMLImageElement>('.ptv-details-backdrop__image');
            const ribbonStyles = getComputedStyle(document.querySelector<HTMLElement>('.detailRibbon')!);
            const focusedCardStyles = getComputedStyle(document.querySelector<HTMLElement>('#similarCollapsible .show-focus .cardBox')!);
            const activeNavStyles = getComputedStyle(document.querySelector<HTMLElement>('.ptv-shell-nav-button.is-active')!);

            return {
                activeNavBorder: activeNavStyles.borderTopWidth,
                activeNavShadow: activeNavStyles.boxShadow,
                backdropSource: backdrop.dataset.ptvBackdropSource || '',
                backdropUrl: backdropImage?.currentSrc || backdropImage?.src || '',
                focusedCardShadow: focusedCardStyles.boxShadow,
                ribbonBackdropFilter: ribbonStyles.backdropFilter || ribbonStyles.getPropertyValue('-webkit-backdrop-filter'),
                ribbonBackground: ribbonStyles.backgroundColor,
                ribbonBorder: ribbonStyles.borderTopWidth
            };
        });

        expect(visualState.backdropUrl).not.toBe('');
        expect(visualState.backdropSource).toBe('Backdrop');
        expect(visualState.ribbonBackdropFilter).toBe('none');
        expect(visualState.ribbonBackground).toBe('rgba(0, 0, 0, 0)');
        expect(visualState.ribbonBorder).toBe('0px');
        expect(visualState.activeNavBorder).toBe('1px');
        expect(visualState.activeNavShadow).not.toBe('none');
        expect(visualState.focusedCardShadow).not.toBe('none');
    });

    test('stacks cleanly without horizontal overflow on a compact screen', async ({ page }) => {
        await page.setViewportSize({ height: 844, width: 390 });
        await page.goto('/#/details?id=fixture-item');

        await expect(page.locator('#itemDetailPage.ptv-details--episode')).toBeVisible();
        await expect(page.locator('.detailImageContainer.hide-desktop')).toBeVisible();
        await expect(page.locator('.detailImageContainer.hide-mobile')).toBeHidden();
        await expect(page.locator('.itemTags')).toBeHidden();
        await expect(page.locator('.ptv-shell-nav-primary')).toBeVisible();
        await expect(page.locator('.ptv-shell-nav-primary').getByRole('link', { exact: true, name: 'Search' })).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();

        const geometry = await page.evaluate(() => ({
            artworkRatio: (() => {
                const rect = document.querySelector<HTMLElement>('.detailImageContainer.hide-desktop')!.getBoundingClientRect();

                return rect.width / rect.height;
            })(),
            contentWidth: document.querySelector<HTMLElement>('.detailPagePrimaryContent')?.getBoundingClientRect().width || 0,
            innerWidth: window.innerWidth,
            recommendationsTop: document.querySelector<HTMLElement>('#similarCollapsible')?.getBoundingClientRect().top || 0,
            scrollWidth: document.documentElement.scrollWidth
        }));

        expect(geometry.contentWidth).toBeGreaterThan(330);
        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);
        expect(geometry.artworkRatio).toBeCloseTo(16 / 9, 1);
        expect(geometry.recommendationsTop).toBeLessThan(844);
    });
});
