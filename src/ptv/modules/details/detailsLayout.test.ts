import { describe, expect, it } from 'vitest';

import {
    preparePtvDetailsLayout,
    releasePtvDetailsLayout,
    setPtvDetailsBackdropCandidates
} from './detailsLayout';

function createDetailsPage() {
    const page = document.createElement('div');

    page.id = 'itemDetailPage';
    page.className = 'itemDetailPage';
    page.innerHTML = `
        <div class="itemBackdrop" style="background-image: url('https://example.test/legacy-backdrop.jpg')"></div>
        <div class="detailLogo"></div>
        <div class="detailPageWrapperContainer">
            <div class="detailPagePrimaryContainer">
                <div class="detailImageContainer hide-mobile"></div>
                <div class="detailRibbon">
                    <div class="infoWrapper">
                        <div class="detailNameContainer"></div>
                    </div>
                    <div class="mainDetailButtons"></div>
                </div>
                <div class="detailPagePrimaryContent padded-right">
                    <div class="detailSection"></div>
                </div>
            </div>
            <div class="detailVerticalSection" id="castCollapsible"></div>
            <div class="verticalSection" id="similarCollapsible"></div>
        </div>
        <div class="detailPageSecondaryContainer"></div>
    `;
    document.body.append(page);
    return page;
}

describe('native PTV details layout ownership', () => {
    it('marks every layout region and moves the logo into the native information ribbon', () => {
        const page = createDetailsPage();
        const logo = page.querySelector('.detailLogo');
        const originalNextSibling = logo?.nextSibling;

        expect(preparePtvDetailsLayout(page)).toBe(true);
        expect(page.classList.contains('ptv-details-native-root')).toBe(true);
        expect(page.querySelector('.detailPageWrapperContainer')?.classList.contains('ptv-details-native-content')).toBe(true);
        expect(page.querySelector('.detailPagePrimaryContainer')?.classList.contains('ptv-details-native-primary')).toBe(true);
        expect(page.querySelector('.detailPageSecondaryContainer')?.classList.contains('ptv-details-native-secondary')).toBe(true);
        expect(page.querySelector('.ptv-details-backdrop')).not.toBeNull();
        expect(page.querySelector('.ptv-details-backdrop')?.getAttribute('data-ptv-backdrop-source')).toBe('Backdrop');
        expect(page.querySelector('.detailRibbon')?.classList.contains('ptv-details-glass--strong')).toBe(true);
        expect(page.querySelector('.detailSection')?.classList.contains('ptv-details-glass')).toBe(true);
        expect(page.querySelector('#castCollapsible')?.classList.contains('ptv-details-glass')).toBe(true);
        expect(page.querySelector('#similarCollapsible')?.classList.contains('ptv-details-glass')).toBe(true);
        expect(page.querySelector('.mainDetailButtons')?.classList.contains('ptv-details-glass-actions')).toBe(true);
        expect(page.querySelector('.detailRibbon .infoWrapper')?.firstElementChild).toBe(logo);
        expect(logo?.classList.contains('ptv-detail-native-logo')).toBe(true);

        releasePtvDetailsLayout(page);

        expect(page.classList.contains('ptv-details-native-root')).toBe(false);
        expect(page.querySelector('.ptv-details-backdrop')).toBeNull();
        expect(page.querySelector('.detailSection')?.classList.contains('ptv-details-glass')).toBe(false);
        expect(logo?.parentElement).toBe(page);
        expect(logo?.nextSibling).toBe(originalNextSibling);
        expect(logo?.classList.contains('ptv-detail-native-logo')).toBe(false);
        page.remove();
    });

    it('is idempotent while Jellyfin mutates the active details DOM', () => {
        const page = createDetailsPage();
        const logo = page.querySelector('.detailLogo');

        preparePtvDetailsLayout(page);
        preparePtvDetailsLayout(page);

        expect(page.querySelectorAll('.detailLogo')).toHaveLength(1);
        expect(page.querySelector('.detailRibbon .infoWrapper')?.firstElementChild).toBe(logo);
        releasePtvDetailsLayout(page);
        page.remove();
    });

    it('uses the ordered item-art fallback chain and retains it across DOM refreshes', () => {
        const page = createDetailsPage();

        preparePtvDetailsLayout(page);
        const image = page.querySelector<HTMLImageElement>('.ptv-details-backdrop__image');
        const backdrop = page.querySelector<HTMLElement>('.ptv-details-backdrop');

        setPtvDetailsBackdropCandidates(page, [
            { requestedType: 'Backdrop', url: 'https://example.test/backdrop.jpg' },
            { requestedType: 'Thumb', url: 'https://example.test/thumb.jpg' },
            { requestedType: 'Primary', url: 'https://example.test/primary.jpg' }
        ]);

        expect(image?.src).toBe('https://example.test/backdrop.jpg');
        expect(backdrop?.dataset.ptvBackdropSource).toBe('Backdrop');

        image?.dispatchEvent(new Event('error'));
        expect(image?.src).toBe('https://example.test/thumb.jpg');
        expect(backdrop?.dataset.ptvBackdropSource).toBe('Thumb');

        preparePtvDetailsLayout(page);
        expect(image?.src).toBe('https://example.test/thumb.jpg');

        image?.dispatchEvent(new Event('error'));
        expect(image?.src).toBe('https://example.test/primary.jpg');
        expect(backdrop?.dataset.ptvBackdropSource).toBe('Primary');

        image?.dispatchEvent(new Event('load'));
        expect(backdrop?.classList.contains('ptv-details-backdrop--image')).toBe(true);

        releasePtvDetailsLayout(page);
        page.remove();
    });

    it('keeps a themed fallback when the item has no usable artwork', () => {
        const page = createDetailsPage();
        const legacyBackdrop = page.querySelector<HTMLElement>('.itemBackdrop');

        legacyBackdrop?.style.removeProperty('background-image');
        preparePtvDetailsLayout(page);
        setPtvDetailsBackdropCandidates(page, []);

        expect(page.querySelector('.ptv-details-backdrop')?.classList.contains('ptv-details-backdrop--fallback')).toBe(true);
        expect(page.querySelector('.ptv-details-backdrop')?.getAttribute('data-ptv-backdrop-source')).toBe('fallback');

        releasePtvDetailsLayout(page);
        page.remove();
    });
});
