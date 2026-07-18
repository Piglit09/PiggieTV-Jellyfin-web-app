import { expect, test } from '@playwright/test';

test.describe('native PiggieTV details layout', () => {
    test('keeps the desktop content near the header and aligned to one centered container', async ({ page }) => {
        await page.setViewportSize({ height: 1271, width: 2560 });
        await page.goto('/#/details?id=fixture-item');

        await expect(page.locator('#itemDetailPage.ptv-details-native-root')).toBeVisible();
        await expect(page.locator('.ptv-shell-header')).toHaveCount(1);
        await expect(page.locator('.skinHeader:not([hidden])')).toHaveCount(0);
        await expect(page.locator('.ptv-details-backdrop')).toHaveCount(1);
        await expect(page.locator('.detailRibbon.ptv-details-glass--strong')).toBeVisible();
        await expect(page.locator('.detailPagePrimaryContent > .detailSection.ptv-details-glass')).toBeVisible();
        await expect(page.locator('#castCollapsible.ptv-details-glass')).toBeVisible();
        await expect(page.locator('#similarCollapsible.ptv-details-glass')).toBeVisible();

        const header = await page.locator('.ptv-shell-header').boundingBox();
        const wrapper = await page.locator('.ptv-details-native-content').boundingBox();
        const poster = await page.locator('.detailImageContainer.hide-mobile').boundingBox();
        const overview = await page.locator('.overview').boundingBox();
        const primary = await page.locator('.ptv-details-native-primary').boundingBox();
        const secondary = await page.locator('.ptv-details-native-secondary').boundingBox();

        expect(wrapper).not.toBeNull();
        expect(header).not.toBeNull();
        expect(poster).not.toBeNull();
        expect(overview).not.toBeNull();
        expect(primary).not.toBeNull();
        expect(secondary).not.toBeNull();
        expect(wrapper!.y).toBeLessThan(180);
        expect(poster!.y).toBeGreaterThanOrEqual(header!.y + header!.height + 12);
        expect(poster!.y).toBeGreaterThanOrEqual(80);
        expect(poster!.y).toBeLessThan(200);
        expect(overview!.width).toBeGreaterThan(500);
        expect(Math.abs(primary!.x - secondary!.x)).toBeLessThanOrEqual(2);
        expect(Math.abs((2560 - wrapper!.width) / 2 - wrapper!.x)).toBeLessThanOrEqual(2);

        const backdropState = await page.locator('.ptv-details-backdrop').evaluate(element => ({
            hasFallback: element.classList.contains('ptv-details-backdrop--fallback'),
            imageUrl: element.querySelector<HTMLImageElement>('.ptv-details-backdrop__image')?.currentSrc
                || element.querySelector<HTMLImageElement>('.ptv-details-backdrop__image')?.src
                || '',
            source: (element as HTMLElement).dataset.ptvBackdropSource || ''
        }));
        const glassStyles = await page.locator('.detailRibbon').evaluate(element => {
            const styles = getComputedStyle(element);

            return {
                backdropFilter: styles.backdropFilter || styles.getPropertyValue('-webkit-backdrop-filter'),
                glassBackground: styles.getPropertyValue('--ptv-details-glass-bg').trim(),
                glassBorder: styles.getPropertyValue('--ptv-details-glass-border').trim()
            };
        });

        expect(backdropState.imageUrl || backdropState.hasFallback).toBeTruthy();
        expect(backdropState.source).not.toBe('');
        expect(glassStyles.glassBackground).toContain('rgba');
        expect(glassStyles.glassBorder).toContain('rgba');
        expect(glassStyles.backdropFilter).toContain('blur');

        const shellStyles = await page.locator('.ptv-shell-header').evaluate(element => {
            const styles = getComputedStyle(element);

            return {
                backdropFilter: styles.backdropFilter || styles.getPropertyValue('-webkit-backdrop-filter'),
                backgroundColor: styles.backgroundColor,
                backgroundImage: styles.backgroundImage,
                borderTopWidth: styles.borderTopWidth,
                boxShadow: styles.boxShadow
            };
        });
        const navigationStyles = await page.locator('.ptv-shell-nav-primary').evaluate(element => {
            const styles = getComputedStyle(element);

            return {
                backdropFilter: styles.backdropFilter || styles.getPropertyValue('-webkit-backdrop-filter'),
                backgroundImage: styles.backgroundImage,
                borderTopWidth: styles.borderTopWidth
            };
        });
        const utilityStyles = await page.locator('.ptv-shell-icon-button').first().evaluate(element => {
            const styles = getComputedStyle(element);

            return {
                backdropFilter: styles.backdropFilter || styles.getPropertyValue('-webkit-backdrop-filter'),
                backgroundImage: styles.backgroundImage,
                borderTopWidth: styles.borderTopWidth
            };
        });

        expect(shellStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(shellStyles.backgroundImage).toBe('none');
        expect(shellStyles.borderTopWidth).toBe('0px');
        expect(shellStyles.boxShadow).toBe('none');
        expect(shellStyles.backdropFilter).toBe('none');
        expect(navigationStyles.backgroundImage).not.toBe('none');
        expect(navigationStyles.borderTopWidth).toBe('1px');
        expect(navigationStyles.backdropFilter).toContain('blur');
        expect(utilityStyles.backgroundImage).not.toBe('none');
        expect(utilityStyles.borderTopWidth).toBe('1px');
        expect(utilityStyles.backdropFilter).toContain('blur');

        await expect(page.locator('.detailLogo.ptv-detail-native-logo')).toBeVisible();
        await expect(page.locator('.detailsGroupItem .content').first()).toHaveCSS('display', 'flex');
    });

    test('stacks cleanly and wraps metadata without horizontal overflow on mobile', async ({ page }) => {
        await page.setViewportSize({ height: 844, width: 390 });
        await page.goto('/#/details?id=fixture-item');

        await expect(page.locator('#itemDetailPage.ptv-details-native-root')).toBeVisible();
        await expect(page.locator('.detailImageContainer.hide-desktop')).toBeVisible();
        await expect(page.locator('.detailImageContainer.hide-mobile')).toBeHidden();
        await expect(page.locator('.ptv-details-backdrop')).toHaveCount(1);

        const geometry = await page.evaluate(() => ({
            contentWidth: document.querySelector<HTMLElement>('.detailPagePrimaryContent')?.getBoundingClientRect().width || 0,
            innerWidth: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            tagsDisplay: getComputedStyle(document.querySelector<HTMLElement>('.itemTags')!).display,
            tagsWrap: getComputedStyle(document.querySelector<HTMLElement>('.itemTags')!).flexWrap
        }));

        expect(geometry.contentWidth).toBeGreaterThan(330);
        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);
        expect(geometry.tagsDisplay).toBe('flex');
        expect(geometry.tagsWrap).toBe('wrap');

        const header = page.locator('.ptv-shell-header');
        const navigation = page.locator('.ptv-shell-nav-primary');
        const utility = page.locator('.ptv-shell-icon-button').first();
        const search = page.locator('.ptv-shell-search');

        await expect(header).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(header).toHaveCSS('box-shadow', 'none');
        await expect(navigation).toBeVisible();
        await expect(utility).toBeVisible();
        const utilityBox = await utility.boundingBox();
        const searchBox = await search.boundingBox();

        expect(utilityBox).not.toBeNull();
        expect(searchBox).not.toBeNull();
        expect(searchBox!.width).toBeGreaterThanOrEqual(utilityBox!.width);
        expect(searchBox!.height).toBeGreaterThanOrEqual(utilityBox!.height);
    });
});
