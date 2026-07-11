import { ready } from '../../core/events';
import { registerModule } from '../../core/lifecycle';
import { recordPtvEvent } from '../../core/observability';

import './music.scss';

const MUSIC_QUEUE_ACTIVITY_EVENT = 'ptv:music-queue-activity';

let musicPlayerRoot: import('react-dom/client').Root | null = null;
let musicPlayerLoadPromise: Promise<void> | null = null;

recordPtvEvent('render', 'music-style-loaded', {
    module: 'music'
});

function isPtvMusicRouteHash(hash = window.location.hash) {
    return /^#\/music(?:[/?]|$)/i.test(hash);
}

function ensureMusicPlayerDock(source = 'unknown') {
    if (musicPlayerRoot) return Promise.resolve();
    if (musicPlayerLoadPromise) return musicPlayerLoadPromise;

    let host = document.querySelector('[data-ptv-music-player-root="true"]');

    if (!host) {
        host = document.createElement('div');
        host.setAttribute('data-ptv-music-player-root', 'true');
        document.body.append(host);
    }

    musicPlayerLoadPromise = Promise.all([
        import('react'),
        import('react-dom/client'),
        import('./musicPlayer')
    ]).then(([React, { createRoot }, { default: PtvMusicPlayerDock }]) => {
        if (musicPlayerRoot) return;

        musicPlayerRoot = createRoot(host);
        musicPlayerRoot.render(React.createElement(PtvMusicPlayerDock));
        recordPtvEvent('render', 'music-player-ready', {
            persistent: true,
            source
        });
    }).catch(error => {
        musicPlayerLoadPromise = null;
        recordPtvEvent('render', 'music-player-load-failed', {
            error: error instanceof Error ? error.message : String(error),
            source
        });
        console.warn('[PTV Music] Failed to load music player dock', error);
    });

    return musicPlayerLoadPromise;
}

function registerMusicPlayerActivationListeners() {
    const loadForRoute = () => {
        if (isPtvMusicRouteHash()) {
            void ensureMusicPlayerDock('music-route');
        }
    };
    const loadForQueue = () => {
        void ensureMusicPlayerDock('queue-activity');
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
