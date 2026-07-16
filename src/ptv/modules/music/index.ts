import { ready } from '../../core/events';
import { registerModule } from '../../core/lifecycle';
import { recordPtvEvent } from '../../core/observability';

import './music.scss';

const MUSIC_QUEUE_ACTIVITY_EVENT = 'ptv:music-queue-activity';

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

function isPtvMusicRouteHash(hash = window.location.hash) {
    return /^#\/music(?:[/?]|$)/i.test(hash);
}

function ensureMusicPlayerOverlay(source = 'unknown') {
    const overlayWindow = getMusicOverlayWindow();

    if (overlayWindow.__ptvMusicOverlayRoot) return Promise.resolve();
    if (overlayWindow.__ptvMusicOverlayLoadPromise) return overlayWindow.__ptvMusicOverlayLoadPromise;

    let host = document.querySelector('[data-ptv-music-player-root="true"]');

    if (!host) {
        host = document.createElement('div');
        host.setAttribute('data-ptv-music-player-root', 'true');
        document.body.append(host);
    }

    overlayWindow.__ptvMusicOverlayLoadPromise = Promise.all([
        import('react'),
        import('react-dom/client'),
        import('./musicPlayer')
    ]).then(([React, { createRoot }, { default: PtvMusicOverlayHost }]) => {
        if (overlayWindow.__ptvMusicOverlayRoot) return;

        overlayWindow.__ptvMusicOverlayRoot = createRoot(host);
        overlayWindow.__ptvMusicOverlayRoot.render(React.createElement(PtvMusicOverlayHost));
        recordPtvEvent('render', 'music-player-overlay-ready', {
            persistent: true,
            source
        });
    }).catch(error => {
        overlayWindow.__ptvMusicOverlayLoadPromise = null;
        recordPtvEvent('render', 'music-player-overlay-load-failed', {
            error: error instanceof Error ? error.message : String(error),
            source
        });
        console.warn('[PTV Music] Failed to load music player overlay', error);
    });

    return overlayWindow.__ptvMusicOverlayLoadPromise;
}

function registerMusicPlayerActivationListeners() {
    const loadForRoute = () => {
        if (isPtvMusicRouteHash()) {
            void ensureMusicPlayerOverlay('music-route');
        }
    };
    const loadForQueue = () => {
        void ensureMusicPlayerOverlay('queue-activity');
    };

    loadForRoute();
    window.addEventListener('hashchange', loadForRoute);
    window.addEventListener('popstate', loadForRoute);
    window.addEventListener(MUSIC_QUEUE_ACTIVITY_EVENT, loadForQueue);
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

ready(registerMusicPlayerActivationListeners);
