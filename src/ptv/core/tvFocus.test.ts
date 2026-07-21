import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    findPtvTvDirectionalTarget,
    getPtvTvNavigationSnapshot,
    notifyPtvTvFocusContentReady,
    notifyPtvTvPlaybackFocus,
    syncPtvTvFocusEngine
} from './tvFocus';

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

    it('supports native Android TV D-pad key codes', () => {
        const shell = document.createElement('main');
        const first = document.createElement('button');
        const second = document.createElement('button');
        shell.className = 'ptv-shell-frame';
        setRect(first, 0, 0);
        setRect(second, 140, 0);
        shell.append(first, second);
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });

        first.focus();
        const event = dispatchRemoteKey(document, 'Unidentified', 22);

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(second);
    });

    it.each([
        ['Enter', 0],
        ['OK', 0],
        ['Select', 0],
        [' ', 0],
        ['Space', 32],
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

    it('activates checkbox controls with OK while leaving native select arrows to the platform', () => {
        const shell = document.createElement('main');
        const checkbox = document.createElement('input');
        const select = document.createElement('select');
        const optionOne = document.createElement('option');
        const optionTwo = document.createElement('option');
        const checkboxClick = vi.fn();
        shell.className = 'ptv-shell-frame';
        checkbox.type = 'checkbox';
        checkbox.addEventListener('click', checkboxClick);
        optionOne.value = 'one';
        optionTwo.value = 'two';
        select.append(optionOne, optionTwo);
        setRect(checkbox, 0, 0);
        setRect(select, 0, 100);
        shell.append(checkbox, select);
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });

        checkbox.focus();
        const selectEvent = dispatchRemoteKey(checkbox, 'OK');
        expect(selectEvent.defaultPrevented).toBe(true);
        expect(checkboxClick).toHaveBeenCalledTimes(1);

        select.focus();
        const arrowEvent = dispatchRemoteKey(select, 'ArrowDown');
        expect(arrowEvent.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(select);
    });

    it.each([
        ['Backspace', 8],
        ['GoBack', 0],
        ['Back', 0],
        ['Escape', 0],
        ['Unidentified', 461]
    ])('navigates back for alternate remote signature %s/%s', (key, keyCode) => {
        const shell = document.createElement('main');
        const item = document.createElement('button');
        shell.className = 'ptv-shell-frame';
        item.style.opacity = '1';
        setRect(item, 0, 0);
        shell.append(item);
        item.focus();
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });

        const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
        const event = dispatchRemoteKey(document, key, keyCode);

        expect(event.defaultPrevented).toBe(true);
        expect(historyBack).toHaveBeenCalledTimes(1);
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
        trigger.setAttribute('aria-controls', 'remote-menu');
        trigger.setAttribute('aria-expanded', 'true');
        trigger.addEventListener('click', () => menu.remove());
        menu.id = 'remote-menu';
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

    it('restores focus to visible candidates first when route memory points to hidden controls', () => {
        const shell = document.createElement('main');
        const visible = document.createElement('button');
        const hidden = document.createElement('button');

        shell.className = 'ptv-shell-frame';
        visible.dataset.ptvFocusKey = 'visible';
        hidden.dataset.ptvFocusKey = 'hidden';
        visible.style.opacity = '1';
        hidden.style.opacity = '1';
        hidden.style.display = 'none';
        setRect(visible, 0, 0);
        setRect(hidden, 0, 0);
        shell.append(visible, hidden);
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });
        window.dispatchEvent(new CustomEvent('routecontrollerchange', {
            detail: { routeKey: 'route-hidden-memory' }
        }));

        hidden.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        window.dispatchEvent(new CustomEvent('routecontrollerchange', {
            detail: { routeKey: 'route-hidden-memory' }
        }));

        expect(document.activeElement).toBe(visible);
    });

    it('restores focus from route-specific memory on route changes', () => {
        const shellA = document.createElement('main');
        const shellB = document.createElement('main');
        const routeAButton = document.createElement('button');
        const routeBButton = document.createElement('button');

        shellA.className = 'ptv-shell-frame';
        shellB.className = 'ptv-shell-frame';
        routeAButton.dataset.ptvFocusKey = 'shared';
        routeBButton.dataset.ptvFocusKey = 'route-b-button';
        setRect(routeAButton, 0, 0);
        setRect(routeBButton, 0, 0);
        shellA.append(routeAButton);
        shellB.append(routeBButton);
        document.body.append(shellA, shellB);
        syncPtvTvFocusEngine({ isTv: true });
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });

        window.dispatchEvent(new CustomEvent('routecontrollerchange', {
            detail: { routeKey: 'route-A' }
        }));
        routeAButton.focus();
        shellA.remove();
        window.dispatchEvent(new CustomEvent('routecontrollerchange', {
            detail: { routeKey: 'route-B' }
        }));

        expect(document.activeElement).toBe(routeBButton);
    });

    it('uses the real prefixed route event and applies the Home initial-focus rule', () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });
        const shell = document.createElement('main');
        const navigationButton = document.createElement('button');
        const heroPlay = document.createElement('a');
        shell.className = 'ptv-shell-frame';
        heroPlay.className = 'ptv-native-home-primary-action';
        heroPlay.dataset.ptvInitialFocus = 'home-primary';
        heroPlay.href = '#/playback';
        setRect(navigationButton, 0, 0);
        setRect(heroPlay, 0, 150);
        shell.append(navigationButton, heroPlay);
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });

        window.dispatchEvent(new CustomEvent('ptv:routecontrollerchange', {
            detail: { pageType: 'home', routeKey: 'home-route' }
        }));

        expect(document.activeElement).toBe(heroPlay);
    });

    it('keeps a focus sentinel during loading and focuses a row target when content becomes ready', () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });
        const shell = document.createElement('main');
        shell.className = 'ptv-shell-frame';
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });
        window.dispatchEvent(new CustomEvent('ptv:routecontrollerchange', {
            detail: { pageType: 'home', routeKey: 'dynamic-home' }
        }));

        expect(document.activeElement).toBe(shell);
        expect(shell.dataset.ptvFocusSentinel).toBe('true');

        const poster = document.createElement('a');
        poster.className = 'ptv-native-home-card-media-link';
        poster.dataset.ptvFocusKey = 'dynamic-poster';
        poster.href = '#/details?id=poster';
        setRect(poster, 0, 100);
        shell.append(poster);
        notifyPtvTvFocusContentReady('home-row-loaded');

        expect(document.activeElement).toBe(poster);
    });

    it('falls back from body scope to the first visible control when startup has no measured candidates', () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });
        const wrapper = document.createElement('div');
        const button = document.createElement('button');
        setRect(button, 0, 0, 0, 0);
        button.dataset.ptvInitialFocus = 'home-primary';
        wrapper.append(button);
        document.body.append(wrapper);
        syncPtvTvFocusEngine({ isTv: true });

        expect(document.activeElement).toBe(button);
    });

    it('traps dialog navigation, wraps Tab, closes with Back, and restores the opener', () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });
        const shell = document.createElement('main');
        const opener = document.createElement('button');
        const dialog = document.createElement('section');
        const first = document.createElement('button');
        const second = document.createElement('button');
        shell.className = 'ptv-shell-frame';
        opener.id = 'dialog-opener';
        opener.setAttribute('aria-controls', 'focus-dialog');
        opener.setAttribute('aria-expanded', 'true');
        dialog.id = 'focus-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', opener.id);
        setRect(opener, 0, 0);
        setRect(first, 0, 100);
        setRect(second, 140, 100);
        dialog.append(first, second);
        shell.append(opener);
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });
        opener.focus();
        opener.addEventListener('click', () => dialog.remove());
        document.body.append(dialog);
        notifyPtvTvFocusContentReady('dialog-open');

        expect(document.activeElement).toBe(first);
        dispatchRemoteKey(document, 'ArrowRight');
        expect(document.activeElement).toBe(second);
        dispatchRemoteKey(document, 'Tab');
        expect(document.activeElement).toBe(first);
        dispatchRemoteKey(document, 'Unidentified', 461);
        expect(dialog.isConnected).toBe(false);
        expect(document.activeElement).toBe(opener);
    });

    it('does not mistake a dialog title for its opener and uses the Cancel control for Back', () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });
        const shell = document.createElement('main');
        const opener = document.createElement('button');
        const dialog = document.createElement('section');
        const title = document.createElement('h2');
        const cancel = document.createElement('button');
        const titleClick = vi.fn();
        const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
        shell.className = 'ptv-shell-frame';
        title.id = 'dialog-title';
        title.textContent = 'Filters';
        title.addEventListener('click', titleClick);
        cancel.textContent = 'Cancel';
        dialog.setAttribute('aria-labelledby', title.id);
        dialog.setAttribute('role', 'dialog');
        setRect(opener, 0, 0);
        setRect(cancel, 0, 100);
        dialog.append(title, cancel);
        shell.append(opener);
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });
        opener.focus();
        cancel.addEventListener('click', () => dialog.remove());
        document.body.append(dialog);
        notifyPtvTvFocusContentReady('dialog-open');

        const event = dispatchRemoteKey(document, 'Escape');

        expect(event.defaultPrevented).toBe(true);
        expect(titleClick).not.toHaveBeenCalled();
        expect(dialog.isConnected).toBe(false);
        expect(document.activeElement).toBe(opener);
        expect(historyBack).not.toHaveBeenCalled();
    });

    it('restores the exact focused poster after playback stops', () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });
        const shell = document.createElement('main');
        const firstPoster = document.createElement('a');
        const selectedPoster = document.createElement('a');
        shell.className = 'ptv-shell-frame';
        firstPoster.href = '#/details?id=first';
        selectedPoster.href = '#/details?id=selected';
        firstPoster.dataset.ptvFocusKey = 'poster:first';
        selectedPoster.dataset.ptvFocusKey = 'poster:selected';
        setRect(firstPoster, 0, 0);
        setRect(selectedPoster, 140, 0);
        shell.append(firstPoster, selectedPoster);
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });
        window.dispatchEvent(new CustomEvent('ptv:routecontrollerchange', {
            detail: { pageType: 'browse', routeKey: 'browse-route' }
        }));
        selectedPoster.focus();

        notifyPtvTvPlaybackFocus(true);
        selectedPoster.blur();
        notifyPtvTvPlaybackFocus(false);

        expect(document.activeElement).toBe(selectedPoster);
    });

    it('reports focus history, graph edges, counts, and missing focus semantics', () => {
        const shell = document.createElement('main');
        const first = document.createElement('button');
        const second = document.createElement('button');
        const broken = document.createElement('div');
        shell.className = 'ptv-shell-frame';
        first.dataset.ptvFocusKey = 'diagnostic-first';
        second.dataset.ptvFocusKey = 'diagnostic-second';
        broken.setAttribute('data-action', 'open');
        setRect(first, 0, 0);
        setRect(second, 140, 0);
        setRect(broken, 0, 100);
        shell.append(first, second, broken);
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });
        first.focus();
        dispatchRemoteKey(document, 'ArrowRight');

        const snapshot = getPtvTvNavigationSnapshot();

        expect(snapshot.focusableElementCount).toBe(2);
        expect(snapshot.lastKeyPressed).toBe('ArrowRight');
        expect(snapshot.focusHistory.some(entry => entry.key === 'diagnostic-second')).toBe(true);
        expect(snapshot.navigationGraph.find(node => node.key === 'diagnostic-first')?.right).toBe('diagnostic-second');
        expect(snapshot.missingFocusableElements.some(entry => entry.includes('div'))).toBe(true);
    });

    it('uses the cached focus graph without querying the DOM on each arrow press', () => {
        const shell = document.createElement('main');
        const first = document.createElement('button');
        const second = document.createElement('button');
        shell.className = 'ptv-shell-frame';
        setRect(first, 0, 0);
        setRect(second, 140, 0);
        shell.append(first, second);
        document.body.append(shell);
        syncPtvTvFocusEngine({ isTv: true });
        first.focus();
        getPtvTvNavigationSnapshot();
        const queryAll = vi.spyOn(document, 'querySelectorAll');

        dispatchRemoteKey(document, 'ArrowRight');

        expect(document.activeElement).toBe(second);
        expect(queryAll).not.toHaveBeenCalled();
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
