import { registerModule } from '../../core/lifecycle';
import { recordPtvEvent } from '../../core/observability';

recordPtvEvent('render', 'reading-module-loaded', {
    module: 'books'
});

registerModule({
    density: 'comfortable',
    features: ['books', 'comics', 'library', 'manga', 'reading'],
    layout: 'media-home',
    name: 'books',
    route: [
        {
            className: 'ptv-route-books',
            density: 'comfortable',
            features: ['books', 'library', 'reading'],
            id: 'books',
            layout: 'media-home',
            navigationItemId: 'books',
            owner: 'books',
            pageType: 'books',
            pattern: ({ hash }: { hash?: string }) => /^#\/books(?:[/?]|$)/i.test(hash || '')
        },
        {
            className: 'ptv-route-comics',
            density: 'comfortable',
            features: ['comics', 'library', 'reading'],
            id: 'comics',
            layout: 'media-home',
            navigationItemId: 'comics',
            owner: 'books',
            pageType: 'comics',
            pattern: ({ hash }: { hash?: string }) => /^#\/comics(?:[/?]|$)/i.test(hash || '')
        },
        {
            className: 'ptv-route-manga',
            density: 'comfortable',
            features: ['library', 'manga', 'reading'],
            id: 'manga',
            layout: 'media-home',
            navigationItemId: 'manga',
            owner: 'books',
            pageType: 'manga',
            pattern: ({ hash }: { hash?: string }) => /^#\/(?:manga|maga)(?:[/?]|$)/i.test(hash || '')
        }
    ],
    surface: 1
});
