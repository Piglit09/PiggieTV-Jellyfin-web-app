import { registerModule } from '../../core/lifecycle';
import { recordPtvEvent } from '../../core/observability';

import './music.scss';

type PtvMusicOverlayWindow = Window & {
    __ptvMusicOverlayLoadPromise?: Promise<void> | null;
    __ptvMusicOverlayRoot?: import('react-dom/client').Root | null;
};

function getMusicOverlayWindow() {
    return window as PtvMusicOverlayWindow;
}

recordPtvEvent('render', 'music-style-loaded', {
    module: 'music'
});

function disposeLegacyMusicPlayerOverlay(source = 'module-start') {
    const overlayWindow = getMusicOverlayWindow();
    const host = document.querySelector('[data-ptv-music-player-root="true"]');

    overlayWindow.__ptvMusicOverlayRoot?.unmount();
    overlayWindow.__ptvMusicOverlayRoot = null;
    overlayWindow.__ptvMusicOverlayLoadPromise = null;
    host?.remove();
    recordPtvEvent('render', 'duplicate-music-player-overlay-suppressed', {
        duplicatePlayerSuppressed: true,
        source
    });
}

registerModule({
    density: 'comfortable',
    features: ['music'],
    layout: 'media-home',
    name: 'music',
    nav: {
        item: {
            href: '#/music',
            icon: 'music',
            id: 'music',
            label: 'Music'
        },
        section: 'media',
        sectionTitle: 'Media'
    },
    route: {
        className: 'ptv-route-music',
        density: 'comfortable',
        features: ['music'],
        id: 'music',
        layout: 'media-home',
        navigationItemId: 'music',
        owner: 'music',
        pageType: 'music',
        pattern: ({ hash }: { hash?: string }) => /^#\/music(?:[/?]|$)/i.test(hash || '')
    },
    surface: 1
});

disposeLegacyMusicPlayerOverlay();
