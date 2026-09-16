import React, { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PtvMusicArtwork from './musicArtwork';
import { resetPtvMusicArtworkSourceCoordinatorForTests } from './musicArtworkSourceCoordinator';

class TestImage {
    static readonly requested: string[] = [];
    static readonly pending = new Map<string, TestImage[]>();

    decoding = '';
    onerror: null | (() => void) = null;
    onload: null | (() => void) = null;
    private source = '';

    set src(value: string) {
        this.source = value;
        TestImage.requested.push(value);
        const pending = TestImage.pending.get(value) || [];

        pending.push(this);
        TestImage.pending.set(value, pending);
    }

    get src() {
        return this.source;
    }

    static settle(url: string, loaded: boolean) {
        const pending = TestImage.pending.get(url) || [];

        TestImage.pending.delete(url);
        pending.forEach(image => {
            if (loaded) image.onload?.();
            else image.onerror?.();
        });
    }
}

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
        TestImage.requested.length = 0;
        TestImage.pending.clear();
        resetPtvMusicArtworkSourceCoordinatorForTests();
        vi.stubGlobal('Image', TestImage);
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

    it('keeps a CSS placeholder without creating an image request until a deferred card approaches the viewport', async () => {
        flushSync(() => root.render(
            <PtvMusicArtwork
                imageUrl='https://example.test/album.jpg'
                placeholderUrl='data:image/svg+xml,stable-card'
                rootMargin='360px'
            />
        ));

        const image = container.querySelector('img')!;
        const observer = TestIntersectionObserver.instances[0];

        expect(image.hasAttribute('src')).toBe(false);
        expect(image.style.backgroundImage).toContain('stable-card');
        expect(observer.rootMargin).toBe('360px');

        flushSync(() => observer.trigger());
        expect(TestImage.requested).toEqual([ 'https://example.test/album.jpg' ]);

        await act(async () => {
            TestImage.settle('https://example.test/album.jpg', true);
            await Promise.resolve();
        });

        expect(image.getAttribute('src')).toBe('https://example.test/album.jpg');
        expect(observer.disconnected).toBe(true);
    });

    it('disconnects a retired card observer and rejects its late callback', async () => {
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
        expect(image.hasAttribute('src')).toBe(false);

        flushSync(() => currentObserver.trigger());
        await act(async () => {
            TestImage.settle('https://example.test/current.jpg', true);
            await Promise.resolve();
        });
        expect(image.getAttribute('src')).toBe('https://example.test/current.jpg');
    });

    it('coalesces first-screen ownership and assigns the real source after one shared preload', async () => {
        flushSync(() => root.render(
            <>
                <PtvMusicArtwork
                    eager
                    imageUrl='https://example.test/first-screen.jpg'
                    placeholderUrl='data:image/svg+xml,stable-card'
                />
                <PtvMusicArtwork
                    eager
                    imageUrl='https://example.test/first-screen.jpg'
                    placeholderUrl='data:image/svg+xml,stable-card'
                />
            </>
        ));

        expect(TestImage.requested).toEqual([ 'https://example.test/first-screen.jpg' ]);
        await act(async () => {
            TestImage.settle('https://example.test/first-screen.jpg', true);
            await Promise.resolve();
        });

        expect(Array.from(container.querySelectorAll('img')).map(image => image.getAttribute('src')))
            .toEqual([ 'https://example.test/first-screen.jpg', 'https://example.test/first-screen.jpg' ]);
        expect(TestIntersectionObserver.instances).toHaveLength(0);
    });

    it('reports one known-bad source and never assigns it to duplicate card DOM', async () => {
        const onSourceFailure = vi.fn();

        flushSync(() => root.render(
            <>
                <PtvMusicArtwork eager imageUrl='https://example.test/bad.jpg' onSourceFailure={onSourceFailure} placeholderUrl='data:image/svg+xml,stable-card' />
                <PtvMusicArtwork eager imageUrl='https://example.test/bad.jpg' onSourceFailure={onSourceFailure} placeholderUrl='data:image/svg+xml,stable-card' />
            </>
        ));

        expect(TestImage.requested).toEqual([ 'https://example.test/bad.jpg' ]);
        await act(async () => {
            TestImage.settle('https://example.test/bad.jpg', false);
            await Promise.resolve();
        });

        expect(onSourceFailure).toHaveBeenCalledTimes(1);
        expect(Array.from(container.querySelectorAll('img')).every(image => !image.hasAttribute('src'))).toBe(true);
    });
});
