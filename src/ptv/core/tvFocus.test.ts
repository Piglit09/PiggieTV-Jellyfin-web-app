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

function dispatchRemoteKey(target: EventTarget, key: string, keyCode = 0) {
    const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key
    });

    if (keyCode) {
        Object.defineProperties(event, {
            keyCode: { value: keyCode },
            which: { value: keyCode }
        });
    }

    target.dispatchEvent(event);
    return event;
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

    it('supports legacy webOS D-pad codes when the browser reports an unidentified key', () => {
        const shell = document.createElement('main');
        const first = document.createElement('button');
        const second = document.createElement('button');
        shell.className = 'ptv-shell-frame';
        first.scrollIntoView = vi.fn();
        second.scrollIntoView = vi.fn();
        setRect(first, 0, 0);
        setRect(second, 140, 0);
        shell.append(first, second);
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });

        first.focus();
        const event = dispatchRemoteKey(document, 'Unidentified', 39);

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(second);
    });

    it.each([
        ['Enter', 0],
        ['Select', 0],
        ['Unidentified', 13]
    ])('activates a focused control once for remote select %s/%s', (key, keyCode) => {
        const shell = document.createElement('main');
        const button = document.createElement('button');
        const handleClick = vi.fn();
        shell.className = 'ptv-shell-frame';
        setRect(button, 0, 0);
        button.addEventListener('click', handleClick);
        shell.append(button);
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });

        button.focus();
        const event = dispatchRemoteKey(button, key, keyCode);

        expect(event.defaultPrevented).toBe(true);
        expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('uses the webOS Back code to close a menu and restore its trigger', () => {
        const shell = document.createElement('main');
        const trigger = document.createElement('button');
        const menu = document.createElement('div');
        const item = document.createElement('a');
        const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });
        shell.className = 'ptv-shell-frame';
        trigger.id = 'menu-trigger';
        trigger.addEventListener('click', () => menu.remove());
        menu.className = 'ptv-shell-dropdown-panel';
        menu.setAttribute('aria-labelledby', trigger.id);
        menu.setAttribute('role', 'menu');
        item.href = '#/movies';
        menu.append(item);
        shell.append(trigger);
        document.body.append(shell, menu);
        syncPtvTvFocusEngine({ isTv: true });

        item.focus();
        const event = dispatchRemoteKey(item, 'Unidentified', 461);

        expect(event.defaultPrevented).toBe(true);
        expect(document.body.contains(menu)).toBe(false);
        expect(document.activeElement).toBe(trigger);
        expect(historyBack).not.toHaveBeenCalled();
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
