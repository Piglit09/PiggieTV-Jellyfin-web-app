import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PtvMusicArtwork from './musicArtwork';

class TestIntersectionObserver {
    static readonly instances: TestIntersectionObserver[] = [];

    readonly root = null;
    readonly rootMargin: string;
    readonly thresholds = [0];
    private readonly callback: IntersectionObserverCallback;
    disconnected = false;
    observedElement: Element | null = null;

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.callback = callback;
        this.rootMargin = options?.rootMargin || '0px';
        TestIntersectionObserver.instances.push(this);
    }

    disconnect() {
        this.disconnected = true;
    }

    observe(element: Element) {
        this.observedElement = element;
    }

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }

    unobserve() {
        this.observedElement = null;
    }

    trigger(isIntersecting = true) {
        this.callback([{
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRatio: isIntersecting ? 1 : 0,
            intersectionRect: {} as DOMRectReadOnly,
            isIntersecting,
            rootBounds: null,
            target: this.observedElement!,
            time: 0
        }], this as unknown as IntersectionObserver);
    }
}

describe('viewport-staged Music artwork', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        TestIntersectionObserver.instances.length = 0;
        vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        flushSync(() => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
    });

    it('keeps the stable placeholder until a deferred card approaches the viewport', () => {
        flushSync(() => root.render(
            <PtvMusicArtwork
                imageUrl='https://example.test/album.jpg'
                placeholderUrl='data:image/svg+xml,stable-card'
                rootMargin='360px'
            />
        ));

        const image = container.querySelector('img')!;
        const observer = TestIntersectionObserver.instances[0];

        expect(image.getAttribute('src')).toBe('data:image/svg+xml,stable-card');
        expect(observer.rootMargin).toBe('360px');

        flushSync(() => observer.trigger());

        expect(image.getAttribute('src')).toBe('https://example.test/album.jpg');
        expect(observer.disconnected).toBe(true);
    });

    it('disconnects a retired card observer and rejects its late callback', () => {
        flushSync(() => root.render(
            <PtvMusicArtwork
                imageUrl='https://example.test/old.jpg'
                placeholderUrl='data:image/svg+xml,stable-card'
            />
        ));
        const retiredObserver = TestIntersectionObserver.instances[0];

        flushSync(() => root.render(
            <PtvMusicArtwork
                imageUrl='https://example.test/current.jpg'
                placeholderUrl='data:image/svg+xml,stable-card'
            />
        ));
        const currentObserver = TestIntersectionObserver.instances[1];
        const image = container.querySelector('img')!;

        expect(retiredObserver.disconnected).toBe(true);
        flushSync(() => retiredObserver.trigger());
        expect(image.getAttribute('src')).toBe('data:image/svg+xml,stable-card');

        flushSync(() => currentObserver.trigger());
        expect(image.getAttribute('src')).toBe('https://example.test/current.jpg');
    });

    it('loads first-screen artwork immediately without creating an observer', () => {
        flushSync(() => root.render(
            <PtvMusicArtwork
                eager
                imageUrl='https://example.test/first-screen.jpg'
                placeholderUrl='data:image/svg+xml,stable-card'
            />
        ));

        expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.test/first-screen.jpg');
        expect(TestIntersectionObserver.instances).toHaveLength(0);
    });
});
