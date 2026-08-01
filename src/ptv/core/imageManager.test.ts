import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./clientProfile', () => ({
    getPtvPerformanceProfile: vi.fn(() => ({
        isLowPower: false,
        isWebOs: false
    }))
}));

vi.mock('./observability', () => ({
    recordPtvEvent: vi.fn()
}));

import {
    loadPtvImage,
    syncPtvManagedPreloads
} from './imageManager';

class ControlledImage {
    static readonly instances: ControlledImage[] = [];

    complete = true;
    decoding = '';
    loading = '';
    naturalHeight = 100;
    naturalWidth = 100;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    private source = '';

    constructor() {
        ControlledImage.instances.push(this);
    }

    get src() {
        return this.source;
    }

    set src(value: string) {
        this.source = value;
    }
}

describe('PTV image manager shared ownership', () => {
    beforeEach(() => {
        ControlledImage.instances.length = 0;
        vi.stubGlobal('Image', ControlledImage);
        document.head.querySelectorAll('[data-ptv-preload-scope]').forEach(node => {
            node.remove();
        });
    });

    it('keeps a deduplicated image alive when its first consumer retires', async () => {
        const url = 'https://images.test/shared-first-owner.jpg';
        const first = loadPtvImage(url, 'hero-current', 'first-surface');
        const second = loadPtvImage(url, 'hero-current', 'second-surface');
        const image = ControlledImage.instances[0];

        expect(ControlledImage.instances).toHaveLength(1);

        first.cancel();

        await expect(first.promise).resolves.toBe(false);
        expect(image.src).toBe(url);

        image.onload?.();

        await expect(second.promise).resolves.toBe(true);
    });

    it('cancels the physical image only after its last consumer retires', async () => {
        const url = 'https://images.test/last-owner.jpg';
        const first = loadPtvImage(url, 'hero-current', 'first-surface');
        const second = loadPtvImage(url, 'hero-current', 'second-surface');
        const image = ControlledImage.instances[0];

        first.cancel();
        expect(image.src).toBe(url);

        second.cancel();

        await expect(Promise.all([ first.promise, second.promise ])).resolves.toEqual([ false, false ]);
        expect(image.src).toBe('');
        expect(image.onload).toBeNull();
        expect(image.onerror).toBeNull();
    });

    it('uses one managed preload task without creating a duplicate preload link', () => {
        const cleanup = syncPtvManagedPreloads(
            'single-owner',
            [ 'https://images.test/managed-preload.jpg' ]
        );

        expect(ControlledImage.instances).toHaveLength(1);
        expect(document.head.querySelector('[data-ptv-preload-scope="single-owner"]')).toBeNull();

        cleanup();
    });
});
