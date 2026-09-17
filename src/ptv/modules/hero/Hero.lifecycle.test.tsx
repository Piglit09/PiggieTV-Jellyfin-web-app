import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const heroMocks = vi.hoisted(() => ({
    play: vi.fn(),
    syncImagePreloads: vi.fn(() => vi.fn()),
    useHeroItems: vi.fn()
}));

vi.mock('../../../components/playback/playbackmanager', () => ({
    playbackManager: {
        play: heroMocks.play
    }
}));

vi.mock('../../api', () => ({
    getPtvItemImageCandidates: vi.fn(() => []),
    getPtvServerId: vi.fn(() => '')
}));

vi.mock('../../core/clientProfile', () => ({
    getPtvPerformanceProfile: vi.fn(() => ({
        enableHeroAutoRotate: false,
        heroBackdropMaxWidth: 1280,
        heroLogoMaxWidth: 640,
        isLowPower: true
    }))
}));

vi.mock('../../core/images', () => ({
    syncPtvImagePreloads: heroMocks.syncImagePreloads
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: vi.fn(() => false)
}));

vi.mock('./useHeroItems', () => ({
    useHeroItems: heroMocks.useHeroItems
}));

import Hero from './Hero';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

type Deferred<T> = {
    promise: Promise<T>;
    reject: (reason: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((_resolve, rejectPromise) => {
        reject = rejectPromise;
    });

    return { promise, reject };
}

describe('PTV Hero playback route ownership', () => {
    let container: HTMLDivElement;
    let root: Root | null;
    let playback: Deferred<void>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        playback = createDeferred<void>();
        heroMocks.play.mockReturnValue(playback.promise);
        heroMocks.useHeroItems.mockReturnValue([{
            Id: 'hero-a',
            Name: 'Hero A',
            ServerId: 'server-a',
            Type: 'Movie'
        }]);
        window.location.hash = '#/home';
    });

    afterEach(() => {
        if (root) {
            act(() => root?.unmount());
        }

        container.remove();
        vi.restoreAllMocks();
    });

    async function renderHero(isCurrent: () => boolean) {
        await act(async () => root?.render(<Hero isCurrent={isCurrent} />));
    }

    async function startPlayback() {
        const watchNow = container.querySelector<HTMLAnchorElement>('.ptv-hero-btn-primary')!;

        await act(async () => {
            watchNow.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true
            }));
        });

        expect(heroMocks.play).toHaveBeenCalledWith({
            ids: [ 'hero-a' ],
            serverId: 'server-a',
            startPositionTicks: 0
        });
    }

    async function rejectPlayback() {
        await act(async () => {
            playback.reject(new Error('playback failed'));
            await Promise.resolve();
        });
    }

    it('does not navigate when playback rejects after the route lifetime retires', async () => {
        let isCurrent = true;

        await renderHero(() => isCurrent);
        await startPlayback();

        isCurrent = false;
        await rejectPlayback();

        expect(window.location.hash).toBe('#/home');
    });

    it('does not navigate when playback rejects after lifetime retirement and unmount', async () => {
        let isCurrent = true;

        await renderHero(() => isCurrent);
        await startPlayback();

        isCurrent = false;
        act(() => root?.unmount());
        root = null;
        await rejectPlayback();

        expect(window.location.hash).toBe('#/home');
    });
});
