import { describe, expect, it } from 'vitest';

import {
    MAX_PROVIDER_DESCRIPTION_LENGTH,
    normalizeAdminMetadataProviderDescription,
    normalizeAdminMetadataProviderImageUrl,
    normalizeAdminMetadataProviderSourceUrl
} from './adminMetadataProviderPresentation';

describe('admin metadata provider presentation safety', () => {
    it('turns normal and encoded provider markup into readable plain text', () => {
        expect(normalizeAdminMetadataProviderDescription(
            '<p><em>The daring James Bond returns.</em></p><p>Second &amp; final paragraph.</p>'
        )).toBe('The daring James Bond returns.\n\nSecond & final paragraph.');
        expect(normalizeAdminMetadataProviderDescription(
            '&lt;p&gt;First&lt;br&gt;second&lt;/p&gt;&lt;p&gt;Third&lt;/p&gt;'
        )).toBe('First\nsecond\n\nThird');
    });

    it('discards active content, attributes and dangerous URLs without rendering HTML', () => {
        const result = normalizeAdminMetadataProviderDescription(`
            <script>alert('script')</script>
            <style>body { display: none }</style>
            <p onclick="alert('event')">Readable description.</p>
            <img src=x onerror="alert('image')">
            <a href="javascript:alert('url')">Safe link label</a>
            <iframe src="https://untrusted.example/private">frame content</iframe>
        `);

        expect(result).toBe('Readable description.\n\nSafe link label');
        expect(result).not.toMatch(/alert\(|<script|<style|onclick|onerror|javascript:|<iframe/i);
    });

    it('sanitizes multiply encoded active markup and bounds unusually large responses', () => {
        expect(normalizeAdminMetadataProviderDescription(
            '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;&amp;lt;p&amp;gt;Kept&amp;lt;/p&amp;gt;'
        )).toBe('Kept');

        const result = normalizeAdminMetadataProviderDescription(`<p>${'a'.repeat(20_000)}</p>`);
        expect(result).toHaveLength(MAX_PROVIDER_DESCRIPTION_LENGTH);
        expect(result.endsWith('…')).toBe(true);
    });

    it('allows only safe credential-free provider image URLs', () => {
        expect(normalizeAdminMetadataProviderImageUrl('https://images.example/poster.jpg#preview'))
            .toBe('https://images.example/poster.jpg');
        expect(normalizeAdminMetadataProviderImageUrl('http://images.example/poster.jpg'))
            .toBe('http://images.example/poster.jpg');
        expect(normalizeAdminMetadataProviderImageUrl('/Items/item-a/Images/Primary?maxWidth=300'))
            .toBe('/Items/item-a/Images/Primary?maxWidth=300');

        const javascriptUrl = `${[ 'java', 'script' ].join('')}:alert(1)`;
        for (const value of [
            javascriptUrl,
            'data:image/svg+xml,<svg onload=alert(1)>',
            'blob:https://images.example/id',
            '//images.example/poster.jpg',
            'https://user:password@images.example/poster.jpg',
            'https://images.example/poster.jpg?api_key=private',
            '/Items/item-a/Images/Primary?access_token=private',
            'https://images.example/poster.jpg\nInjected: value',
            '/\\images.example/poster.jpg'
        ]) expect(normalizeAdminMetadataProviderImageUrl(value)).toBeNull();
    });

    it('allows public provider pages but rejects credential-bearing or non-HTTP source URLs', () => {
        expect(normalizeAdminMetadataProviderSourceUrl('https://provider.example/item/7#details'))
            .toBe('https://provider.example/item/7');
        expect(normalizeAdminMetadataProviderSourceUrl('https://provider.example/item/7?lang=en'))
            .toBe('https://provider.example/item/7?lang=en');

        const javascriptUrl = `${[ 'java', 'script' ].join('')}:alert(1)`;
        for (const value of [
            javascriptUrl,
            '/relative/provider/item',
            'https://user:password@provider.example/item/7',
            'https://provider.example/item/7?access_token=private',
            'https://provider.example/item/7?auth_token=private',
            'https://provider.example/item/7\\injected'
        ]) expect(normalizeAdminMetadataProviderSourceUrl(value)).toBeNull();
    });
});
