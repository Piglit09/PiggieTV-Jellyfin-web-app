import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PtvGlobalPlaybackState } from '../services/playbackStateService';

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
        source: 'ptv-music',
        itemType: 'Audio',
        mediaType: 'Audio'
    } as PtvGlobalPlaybackState
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
        window.location.hash = '#/music';
        playbackMocks.state = {
            active: true,
            canSeek: true,
            durationTicks: 100,
            itemId: 'music-item',
            itemType: 'Audio',
            lastUpdatedAt: 1,
            mediaType: 'Audio',
            name: 'Test track',
            paused: false,
            positionTicks: 50,
            queueLength: 2,
            source: 'ptv-music'
        };
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

    function renderDock() {
        flushSync(() => root.render(<PTVMediaDock />));
    }

    it('renders exactly one compact dock for PTV-owned audio playback', () => {
        renderDock();

        expect(container.querySelectorAll('.ptv-media-dock')).toHaveLength(1);
        expect(document.querySelector('.ptv-music-mini-player')).toBeNull();
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(true);
        expect(document.body.classList.contains('ptv-playback-presentation-owned')).toBe(true);

        flushSync(() => root.unmount());
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(false);
        expect(document.body.classList.contains('ptv-playback-presentation-owned')).toBe(false);
        root = createRoot(container);
    });

    it.each([
        ['Movie', 'Video'],
        ['Episode', 'Video'],
        ['Series', 'Video'],
        ['Trailer', 'Video']
    ])('does not render for %s playback', (itemType, mediaType) => {
        playbackMocks.state = {
            ...playbackMocks.state,
            itemId: `video-${itemType}`,
            itemType,
            mediaType,
            source: 'jellyfin-player'
        };

        renderDock();

        expect(container.querySelector('.ptv-media-dock')).toBeNull();
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(false);
    });

    it('hides immediately on a video route even before the music snapshot retires', () => {
        renderDock();
        expect(container.querySelector('.ptv-media-dock')).not.toBeNull();

        window.location.hash = '#/video';
        renderDock();

        expect(container.querySelector('.ptv-media-dock')).toBeNull();
        expect(document.body.classList.contains('ptv-playback-presentation-owned')).toBe(false);
    });

    it('restores the Music dock after video playback hands back to PTV audio', () => {
        window.location.hash = '#/video';
        playbackMocks.state = {
            ...playbackMocks.state,
            itemId: 'episode-item',
            itemType: 'Episode',
            mediaType: 'Video',
            source: 'jellyfin-player'
        };
        renderDock();
        expect(container.querySelector('.ptv-media-dock')).toBeNull();

        window.location.hash = '#/music';
        playbackMocks.state = {
            ...playbackMocks.state,
            itemId: 'music-item',
            itemType: 'Audio',
            mediaType: 'Audio',
            source: 'ptv-music'
        };
        renderDock();

        expect(container.querySelectorAll('.ptv-media-dock')).toHaveLength(1);
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(true);
    });
});
