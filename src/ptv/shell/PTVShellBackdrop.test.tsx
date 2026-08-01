import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backdropMocks = vi.hoisted(() => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('../core/observability', () => ({
    recordPtvEvent: backdropMocks.recordPtvEvent
}));

import PTVShellBackdrop from './PTVShellBackdrop';

type MockImage = {
    decoding: string;
    onerror: ((event: Event) => void) | null;
    onload: ((event: Event) => void) | null;
    src: string;
};

describe('PTVShellBackdrop lifecycle', () => {
    let animationFrames: Map<number, FrameRequestCallback>;
    let container: HTMLDivElement;
    let images: MockImage[];
    let nextAnimationFrameId: number;
    let root: Root | null;

    beforeEach(() => {
        vi.useFakeTimers();
        backdropMocks.recordPtvEvent.mockReset();
        animationFrames = new Map();
        images = [];
        nextAnimationFrameId = 1;

        class TestImage implements MockImage {
            decoding = '';
            onerror: MockImage['onerror'] = null;
            onload: MockImage['onload'] = null;
            src = '';

            constructor() {
                images.push(this);
            }
        }

        vi.stubGlobal('Image', TestImage);
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            const frameId = nextAnimationFrameId;

            nextAnimationFrameId += 1;
            animationFrames.set(frameId, callback);
            return frameId;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(frameId => {
            animationFrames.delete(frameId);
        });

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        if (root) {
            flushSync(() => root?.unmount());
        }
        container.remove();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('cancels onload transition work before unmount callbacks can update state', () => {
        flushSync(() => root?.render(
            <PTVShellBackdrop source='initial' url='/initial.jpg' />
        ));
        flushSync(() => root?.render(
            <PTVShellBackdrop source='details' url='/details.jpg' />
        ));

        const image = images[0];

        expect(image).toBeDefined();
        flushSync(() => image?.onload?.(new Event('load')));

        expect(animationFrames.size).toBe(1);
        expect(vi.getTimerCount()).toBe(2);

        flushSync(() => root?.unmount());
        root = null;

        expect(image?.onload).toBeNull();
        expect(image?.onerror).toBeNull();
        expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
        expect(animationFrames.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);

        vi.runAllTimers();

        expect(animationFrames.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('detaches an unsettled image so a late load cannot schedule transition work', () => {
        flushSync(() => root?.render(
            <PTVShellBackdrop source='initial' url='/initial.jpg' />
        ));
        flushSync(() => root?.render(
            <PTVShellBackdrop source='details' url='/details.jpg' />
        ));

        const image = images[0];
        const lateOnload = image?.onload;

        flushSync(() => root?.unmount());
        root = null;

        expect(image?.onload).toBeNull();
        expect(image?.onerror).toBeNull();

        lateOnload?.(new Event('load'));

        expect(animationFrames.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(backdropMocks.recordPtvEvent).not.toHaveBeenCalledWith(
            'render',
            'ptv-shell-backdrop-loaded',
            expect.anything()
        );
    });

    it('allows a mounted backdrop transition to finish and release its previous image', () => {
        flushSync(() => root?.render(
            <PTVShellBackdrop source='initial' url='/initial.jpg' />
        ));
        flushSync(() => root?.render(
            <PTVShellBackdrop source='details' url='/details.jpg' />
        ));
        flushSync(() => images[0]?.onload?.(new Event('load')));

        const [frameId, frameCallback] = Array.from(animationFrames.entries())[0] || [];
        const previousBeforeFrame = container.querySelector('.ptv-shell-backdrop-image-previous');
        const currentBeforeFrame = container.querySelector('.ptv-shell-backdrop-image-current');

        expect(previousBeforeFrame?.classList.contains('is-visible')).toBe(true);
        expect(currentBeforeFrame?.classList.contains('is-visible')).toBe(false);
        expect(frameCallback).toBeDefined();

        animationFrames.delete(frameId!);
        flushSync(() => frameCallback?.(performance.now()));

        expect(previousBeforeFrame?.classList.contains('is-visible')).toBe(false);
        expect(currentBeforeFrame?.classList.contains('is-visible')).toBe(true);

        flushSync(() => vi.advanceTimersByTime(900));

        expect(container.querySelector('.ptv-shell-backdrop-image-previous')).toBeNull();
    });
});
