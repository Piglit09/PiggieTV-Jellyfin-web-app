import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findPtvTvDirectionalTarget, syncPtvTvFocusEngine } from './tvFocus';

function setRect(element: HTMLElement, left: number, top: number, width = 100, height = 60) {
    element.getBoundingClientRect = vi.fn(() => ({
        bottom: top + height,
        height,
        left,
        right: left + width,
        toJSON: () => ({}),
        top,
        width,
        x: left,
        y: top
    }));
}

describe('PiggieTV TV focus engine', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        syncPtvTvFocusEngine({ isTv: false });
    });

    afterEach(() => {
        syncPtvTvFocusEngine({ isTv: false });
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('selects the nearest candidate in the requested direction', () => {
        const current = document.createElement('button');
        const right = document.createElement('button');
        const fartherRight = document.createElement('button');
        const down = document.createElement('button');
        setRect(current, 0, 0);
        setRect(right, 130, 4);
        setRect(fartherRight, 280, 0);
        setRect(down, 4, 100);
        document.body.append(current, right, fartherRight, down);

        expect(findPtvTvDirectionalTarget(current, [current, right, fartherRight, down], 'right')).toBe(right);
        expect(findPtvTvDirectionalTarget(current, [current, right, fartherRight, down], 'down')).toBe(down);
        expect(findPtvTvDirectionalTarget(current, [current, right, fartherRight, down], 'left')).toBeNull();
    });

    it('moves focus with remote arrow keys and scrolls the target into view', () => {
        const shell = document.createElement('main');
        const first = document.createElement('button');
        const second = document.createElement('button');
        shell.className = 'ptv-shell-frame';
        first.dataset.ptvFocusKey = 'first';
        second.dataset.ptvFocusKey = 'second';
        first.scrollIntoView = vi.fn();
        second.scrollIntoView = vi.fn();
        setRect(first, 0, 0);
        setRect(second, 140, 0);
        shell.append(first, second);
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });

        first.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }));

        expect(document.activeElement).toBe(second);
        expect(second.classList.contains('ptv-tv-focus-visible')).toBe(true);
        expect(second.scrollIntoView).toHaveBeenCalled();
    });

    it('does not intercept arrow keys after TV mode is disabled', () => {
        const shell = document.createElement('main');
        const first = document.createElement('button');
        const second = document.createElement('button');
        shell.className = 'ptv-shell-frame';
        setRect(first, 0, 0);
        setRect(second, 140, 0);
        shell.append(first, second);
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });
        syncPtvTvFocusEngine({ isTv: false });

        first.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }));

        expect(document.activeElement).toBe(first);
    });
});
