import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./blurhash.worker.ts', () => ({
    default: class BlurhashWorkerMock {
        addEventListener() {
            return undefined;
        }
        postMessage() {
            return undefined;
        }
    }
}));

vi.mock('../lazyLoader/lazyLoaderIntersectionObserver', () => ({
    lazyChildren: vi.fn()
}));

vi.mock('../../scripts/settings/userSettings', () => ({
    enableBlurhash: vi.fn(() => false),
    enableFastFadein: vi.fn(() => true)
}));

import { fillImage, fillImages } from './imageLoader';

class ImageMock {
    static readonly instances: ImageMock[] = [];
    private listeners = new Map<string, EventListener>();
    src = '';

    constructor() {
        ImageMock.instances.push(this);
    }

    addEventListener(type: string, listener: EventListener) {
        this.listeners.set(type, listener);
    }

    dispatch(type: string) {
        this.listeners.get(type)?.(new Event(type));
    }
}

function createLazyEntry(id: string) {
    const target = document.createElement('img');

    target.id = id;
    target.setAttribute('data-src', `https://images.example.test/${id}.jpg`);
    document.body.append(target);

    return {
        isIntersecting: true,
        target
    };
}

describe('imageLoader batching and observer lifecycle', () => {
    beforeEach(() => {
        ImageMock.instances.length = 0;
        vi.stubGlobal('Image', ImageMock);
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.unstubAllGlobals();
    });

    it('starts every image in a batch instead of repeatedly starting the first image', () => {
        const first = createLazyEntry('first');
        const second = createLazyEntry('second');

        fillImages([ first, second ]);

        expect(first.target.classList.contains('lazy-hidden')).toBe(true);
        expect(second.target.classList.contains('lazy-hidden')).toBe(true);
        expect(ImageMock.instances).toHaveLength(2);
    });

    it('releases an observed element after its image has loaded', () => {
        const entry = createLazyEntry('observed');
        const observer = {
            unobserve: vi.fn()
        };

        fillImage(entry, observer);
        ImageMock.instances[0].dispatch('load');

        expect(entry.target.getAttribute('src')).toBe('https://images.example.test/observed.jpg');
        expect(entry.target.hasAttribute('data-src')).toBe(false);
        expect(observer.unobserve).toHaveBeenCalledWith(entry.target);
    });
});
