import React, { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PtvMusicItemMenuOverlay, {
    getPtvMusicItemMenuPosition,
    type PtvMusicItemMenuRect
} from './musicItemMenuOverlay';

const ORIGINAL_INNER_HEIGHT = window.innerHeight;
const ORIGINAL_INNER_WIDTH = window.innerWidth;

function getRect(left: number, top: number, width = 36, height = 36): PtvMusicItemMenuRect {
    return {
        bottom: top + height,
        height,
        left,
        right: left + width,
        top,
        width
    };
}

function OverlayFixture({
    onClose = () => undefined,
    open = true
}: Readonly<{
    onClose?: () => void;
    open?: boolean;
}>) {
    const triggerRef = useRef<HTMLButtonElement>(null);

    return (
        <div className='ptv-music-row' data-testid='clipped-row'>
            <button
                ref={triggerRef}
                id='music-menu-trigger'
                type='button'
                aria-controls='music-menu'
                aria-expanded={open}
                aria-haspopup='menu'
            >
                Actions
            </button>
            {open ? (
                <PtvMusicItemMenuOverlay
                    id='music-menu'
                    labelledBy='music-menu-trigger'
                    onClose={onClose}
                    triggerRef={triggerRef}
                >
                    <button type='button' role='menuitem' disabled>Unavailable</button>
                    <button type='button' role='menuitem'>Start mix</button>
                    <button type='button' role='menuitem'>Add to queue</button>
                </PtvMusicItemMenuOverlay>
            ) : null}
        </div>
    );
}

function OwnedOverlayFixture({ onClose }: Readonly<{ onClose: () => void }>) {
    const [open, setOpen] = useState(true);
    const closeOverlay = useCallback(() => {
        onClose();
        setOpen(false);
    }, [onClose]);

    return (
        <OverlayFixture
            open={open}
            onClose={closeOverlay}
        />
    );
}

describe('Music item menu overlay positioning', () => {
    const viewport = {
        height: 1080,
        left: 0,
        top: 0,
        width: 1920
    };

    it.each([
        ['first shelf card', getRect(120, 929), 14],
        ['last shelf card', getRect(1752, 929), 1600],
        ['partly off-screen scrolled card', getRect(-80, 929), 14]
    ])('keeps the %s menu inside horizontal viewport bounds', (_label, trigger, expectedLeft) => {
        const position = getPtvMusicItemMenuPosition(trigger, viewport, {
            height: 410,
            width: 188
        });

        expect(position.left).toBe(expectedLeft);
        expect(position.left).toBeGreaterThanOrEqual(14);
        expect(position.left + position.width).toBeLessThanOrEqual(1906);
        expect(position.top).toBe(511);
        expect(position.top + position.maxHeight).toBeLessThanOrEqual(trigger.top - 8);
    });

    it('keeps a lower player-list menu above its trigger and inside the viewport', () => {
        const trigger = getRect(1660, 1018);
        const position = getPtvMusicItemMenuPosition(trigger, viewport, {
            height: 410,
            width: 188
        });

        expect(position.top).toBe(600);
        expect(position.top + position.maxHeight).toBe(1010);
        expect(position.left + position.width).toBe(trigger.right);
    });

    it('uses the larger side and constrains a menu taller than the viewport', () => {
        const trigger = getRect(900, 520);
        const position = getPtvMusicItemMenuPosition(trigger, viewport, {
            height: 1400,
            width: 320
        });

        expect(position.width).toBe(260);
        expect(position.top).toBe(564);
        expect(position.maxHeight).toBe(502);
        expect(position.top).toBeGreaterThanOrEqual(14);
        expect(position.top + position.maxHeight).toBeLessThanOrEqual(1066);
    });

    it('respects a visual viewport offset instead of assuming document origin', () => {
        const position = getPtvMusicItemMenuPosition(getRect(36, 110), {
            height: 720,
            left: 24,
            top: 40,
            width: 390
        }, {
            height: 360,
            width: 188
        });

        expect(position.left).toBe(38);
        expect(position.top).toBe(154);
        expect(position.top + position.maxHeight).toBeLessThanOrEqual(746);
    });
});

describe('PtvMusicItemMenuOverlay lifecycle', () => {
    let animationFrames: FrameRequestCallback[];
    let container: HTMLDivElement;
    let root: Root;
    let triggerRect: PtvMusicItemMenuRect;

    const flushAnimationFrames = () => {
        const callbacks = animationFrames.splice(0);

        flushSync(() => callbacks.forEach(callback => {
            callback(performance.now());
        }));
    };

    beforeEach(() => {
        animationFrames = [];
        triggerRect = getRect(194, 929);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            animationFrames.push(callback);
            return animationFrames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            if (this.classList.contains('ptv-music-item-menu-overlay')) {
                return getRect(-10000, -10000, 188, 410) as DOMRect;
            }

            if (this.id === 'music-menu-trigger') return triggerRect as DOMRect;

            return getRect(120, 605, 1668, 396) as DOMRect;
        });
        vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
            return this.classList.contains('ptv-music-item-menu-overlay') ? 410 : 0;
        });
        vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
            return this.classList.contains('ptv-music-item-menu-overlay') ? 188 : 0;
        });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 });
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
    });

    afterEach(() => {
        flushSync(() => root.unmount());
        container.remove();
        document.querySelectorAll('[data-ptv-music-item-menu-overlay]').forEach(element => {
            element.remove();
        });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: ORIGINAL_INNER_HEIGHT });
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: ORIGINAL_INNER_WIDTH });
        vi.restoreAllMocks();
    });

    it('portals outside the clipping row and reproduces the physical trigger placement', () => {
        flushSync(() => root.render(<OverlayFixture />));
        flushAnimationFrames();

        const clippedRow = container.querySelector<HTMLElement>('[data-testid="clipped-row"]')!;
        const trigger = container.querySelector<HTMLButtonElement>('#music-menu-trigger')!;
        const menu = document.querySelector<HTMLElement>('[data-ptv-music-item-menu-overlay]')!;

        expect(menu.parentElement).toBe(document.body);
        expect(clippedRow.contains(menu)).toBe(false);
        expect(menu.getAttribute('aria-labelledby')).toBe(trigger.id);
        expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
        expect(menu.style.left).toBe('42px');
        expect(menu.style.top).toBe('511px');
        expect(menu.style.width).toBe('188px');
        expect(menu.style.maxHeight).toBe('410px');
        expect(menu.style.visibility).toBe('visible');
    });

    it('focuses the first enabled menu item and wraps keyboard navigation across enabled items', () => {
        flushSync(() => root.render(<OverlayFixture />));

        const menu = document.querySelector<HTMLElement>('[data-ptv-music-item-menu-overlay]')!;
        const trigger = container.querySelector<HTMLButtonElement>('#music-menu-trigger')!;
        const disabledItem = menu.querySelector<HTMLButtonElement>('[disabled]')!;
        const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));

        expect(document.activeElement).toBe(items[0]);
        expect(disabledItem.tabIndex).toBe(-1);
        expect(items.map(item => item.tabIndex)).toEqual([0, -1]);

        trigger.focus();
        flushAnimationFrames();

        expect(document.activeElement).toBe(items[0]);

        items[0].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
        expect(document.activeElement).toBe(items[1]);

        items[1].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
        expect(document.activeElement).toBe(items[0]);

        items[0].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
        expect(document.activeElement).toBe(items[1]);

        items[1].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }));
        expect(document.activeElement).toBe(items[0]);

        items[0].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
        expect(document.activeElement).toBe(items[1]);
    });

    it('closes through its owner on Escape and restores focus to the trigger', () => {
        const onClose = vi.fn();

        flushSync(() => root.render(<OwnedOverlayFixture onClose={onClose} />));
        flushAnimationFrames();

        const trigger = container.querySelector<HTMLButtonElement>('#music-menu-trigger')!;
        const activeItem = document.activeElement as HTMLElement;

        flushSync(() => {
            activeItem.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
        });

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-ptv-music-item-menu-overlay]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('restores trigger focus when an open menu is normally unmounted', () => {
        flushSync(() => root.render(<OverlayFixture />));
        flushAnimationFrames();

        const trigger = container.querySelector<HTMLButtonElement>('#music-menu-trigger')!;

        expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
        flushSync(() => root.render(<OverlayFixture open={false} />));

        expect(document.activeElement).toBe(trigger);
    });

    it('repositions after an ancestor scroll without adding another listener', () => {
        const addWindowListener = vi.spyOn(window, 'addEventListener');

        flushSync(() => root.render(<OverlayFixture />));
        flushAnimationFrames();
        flushSync(() => root.render(<OverlayFixture />));
        triggerRect = getRect(1700, 929);
        container.dispatchEvent(new Event('scroll'));
        flushAnimationFrames();

        const menu = document.querySelector<HTMLElement>('[data-ptv-music-item-menu-overlay]')!;
        const scrollListeners = addWindowListener.mock.calls.filter(([name]) => name === 'scroll');

        expect(scrollListeners).toHaveLength(1);
        expect(menu.style.left).toBe('1548px');
        expect(menu.style.top).toBe('511px');
    });

    it('removes viewport listeners and cancels pending work when it closes', () => {
        const addWindowListener = vi.spyOn(window, 'addEventListener');
        const removeWindowListener = vi.spyOn(window, 'removeEventListener');

        flushSync(() => root.render(<OverlayFixture />));
        flushSync(() => root.render(<OverlayFixture open={false} />));

        expect(addWindowListener).toHaveBeenCalledWith('orientationchange', expect.any(Function));
        expect(addWindowListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
        expect(removeWindowListener).toHaveBeenCalledWith('orientationchange', expect.any(Function));
        expect(removeWindowListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
        expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-ptv-music-item-menu-overlay]')).toBeNull();
    });
});
