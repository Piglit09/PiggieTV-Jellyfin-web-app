import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const playbackMocks = vi.hoisted(() => ({
    state: {
        active: true,
        canSeek: true,
        durationTicks: 100,
        itemId: 'music-item',
        lastUpdatedAt: 1,
        name: 'Test track',
        paused: false,
        positionTicks: 50,
        queueLength: 2,
        source: 'ptv-music' as const
    }
}));

vi.mock('../modules/icons', () => ({
    PtvIcon: ({ name }: { name: string }) => <span data-icon={name} />
}));

vi.mock('../services/playbackStateService', () => ({
    getPtvGlobalPlaybackState: () => playbackMocks.state,
    nextPtvGlobalPlaybackTrack: vi.fn(),
    openPtvGlobalPlaybackDetails: vi.fn(),
    openPtvGlobalPlaybackPrimary: vi.fn(async () => undefined),
    previousPtvGlobalPlaybackTrack: vi.fn(),
    stopPtvGlobalPlayback: vi.fn(),
    subscribeToPtvGlobalPlaybackState: () => () => undefined
}));

vi.mock('../services/performanceMonitor', () => ({
    incrementPtvPerformanceCounter: vi.fn(),
    recordPtvPerformanceEntry: vi.fn()
}));

import PTVMediaDock from './PTVMediaDock';

describe('PTV global media dock ownership', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        flushSync(() => root.unmount());
        container.remove();
        document.documentElement.classList.remove('ptv-playback-presentation-owned');
        document.body.classList.remove('ptv-playback-presentation-owned');
    });

    it('owns the only compact playback presentation and releases native-bar suppression', () => {
        flushSync(() => root.render(<PTVMediaDock />));

        expect(container.querySelectorAll('.ptv-media-dock')).toHaveLength(1);
        expect(document.querySelector('.ptv-music-mini-player')).toBeNull();
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(true);
        expect(document.body.classList.contains('ptv-playback-presentation-owned')).toBe(true);

        flushSync(() => root.unmount());
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(false);
        expect(document.body.classList.contains('ptv-playback-presentation-owned')).toBe(false);
        root = createRoot(container);
    });
});
