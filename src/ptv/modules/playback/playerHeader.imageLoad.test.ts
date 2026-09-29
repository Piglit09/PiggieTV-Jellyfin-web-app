import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/clientProfile', () => ({
    getPtvPerformanceProfile: () => ({ isLowPower: false, isWebOs: false })
}));

vi.mock('../../core/observability', () => ({ recordPtvEvent: vi.fn() }));

import { ensurePlayerHeader, removePlayerHeader, updatePlayerHeader } from './playerHeader';

class DetachedImage {
    static readonly instances: DetachedImage[] = [];

    complete = true;
    decoding = '';
    loading = '';
    naturalHeight = 100;
    naturalWidth = 200;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    private source = '';

    constructor() {
        DetachedImage.instances.push(this);
    }

    get src() {
        return this.source;
    }

    set src(value: string) {
        this.source = value;
        // Detached lazy images do not start loading in Chrome. Model only the
        // load-completion boundary; the real PTV image manager remains in use.
        if (value && this.loading === 'eager') {
            queueMicrotask(() => this.onload?.());
        }
    }
}

describe('player header image loading', () => {
    beforeEach(() => {
        DetachedImage.instances.length = 0;
        vi.stubGlobal('Image', DetachedImage);
        document.body.innerHTML = '<div id="player-chrome"></div>';
    });

    afterEach(() => {
        const root = document.getElementById('player-chrome');
        if (root) removePlayerHeader(root);
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('shows an available logo when the managed detached preload must be eager', async () => {
        const root = document.getElementById('player-chrome') as HTMLElement;
        const header = ensurePlayerHeader(root, () => undefined);
        updatePlayerHeader(header, 'Movie title', 'http://127.0.0.1:8097/Items/movie/Images/Logo?tag=known-logo');

        expect(DetachedImage.instances).toHaveLength(1);
        expect(DetachedImage.instances[0].loading).toBe('eager');
        await vi.waitFor(() => expect(header.classList.contains('ptv-player-topbar-has-logo')).toBe(true));
        expect(header.querySelector('.ptv-player-top-title')?.textContent).toBe('Movie title');
    });
});
