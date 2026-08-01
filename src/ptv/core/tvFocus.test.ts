import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shell/routeController', () => ({
    getPtvRouteControllerState: () => ({
        owner: 'native',
        pageType: 'test',
        routeKey: 'test-route'
    })
}));

import {
    findPtvTvDirectionalTarget,
    getPtvTvNavigationSnapshot,
    normalizePtvRemoteDiagnosticAction,
    notifyPtvTvFocusContentReady,
    notifyPtvTvPlaybackFocus,
    notifyPtvTvPlaybackSurfaceDisposed,
    notifyPtvTvPlaybackSurfaceReady,
    registerPtvTvPlaybackBackHandler,
    syncPtvTvFocusEngine
} from './tvFocus';
import {
    executePtvHiddenVideoDirectionalGestureKey,
    resetPtvHiddenVideoDirectionalGesture
} from '../modules/playback/videoInputOwnership';

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

function dispatchRemoteKey(target: EventTarget, key: string, keyCode = 0, repeat = false) {
    const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
        repeat
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

function createMusicTrackMenuFixture({ deferClose = false }: Readonly<{ deferClose?: boolean }> = {}) {
    const shell = document.createElement('main');
    const upperTarget = document.createElement('button');
    const menuHost = document.createElement('div');
    const trigger = document.createElement('button');
    let closeCount = 0;
    let menu: HTMLDivElement | null = null;
    let openCount = 0;

    shell.className = 'ptv-shell-frame';
    upperTarget.dataset.ptvFocusKey = 'music-upper-track';
    trigger.id = 'music-track-menu-trigger';
    trigger.className = 'ptv-music-item-menu-button';
    trigger.dataset.ptvFocusKey = 'music-track-menu';
    trigger.setAttribute('aria-controls', 'music-track-menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'menu');
    setRect(upperTarget, 0, 0);
    setRect(trigger, 0, 120);
    trigger.addEventListener('click', () => {
        if (menu?.isConnected) {
            closeCount += 1;
            const removeMenu = () => {
                menu?.remove();
                menu = null;
                trigger.setAttribute('aria-expanded', 'false');
            };

            if (deferClose) {
                void Promise.resolve().then(removeMenu);
            } else {
                removeMenu();
            }
            return;
        }

        openCount += 1;
        menu = document.createElement('div');
        const first = document.createElement('button');
        const second = document.createElement('button');

        menu.id = 'music-track-menu';
        menu.className = 'ptv-music-item-menu-popover';
        menu.setAttribute('aria-labelledby', trigger.id);
        menu.setAttribute('role', 'menu');
        first.dataset.ptvFocusKey = 'music-menu-first';
        first.setAttribute('role', 'menuitem');
        second.dataset.ptvFocusKey = 'music-menu-second';
        second.setAttribute('role', 'menuitem');
        setRect(first, 0, 60);
        setRect(second, 0, 100);
        menu.append(first, second);
        document.body.append(menu);
        trigger.setAttribute('aria-expanded', 'true');
    });
    menuHost.className = 'ptv-music-item-menu';
    menuHost.append(trigger);
    shell.append(upperTarget, menuHost);
    document.body.append(shell);

    return {
        getCloseCount: () => closeCount,
        getFirstItem: () => menu?.querySelector<HTMLButtonElement>('[data-ptv-focus-key="music-menu-first"]') || null,
        getMenu: () => menu,
        getOpenCount: () => openCount,
        trigger,
        upperTarget
    };
}

describe('PiggieTV TV focus engine', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.location.hash = '#/home';
        resetPtvHiddenVideoDirectionalGesture();
        syncPtvTvFocusEngine({ isTv: false });
    });

    afterEach(() => {
        resetPtvHiddenVideoDirectionalGesture();
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

    it('moves away from a Music track menu trigger without opening it on a directional key', () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });
        const fixture = createMusicTrackMenuFixture();

        window.location.hash = '#/music';
        syncPtvTvFocusEngine({ isTv: true });
        fixture.trigger.focus();
        const event = dispatchRemoteKey(fixture.trigger, 'ArrowUp');

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(fixture.upperTarget);
        expect(fixture.getMenu()).toBeNull();
        expect(fixture.getOpenCount()).toBe(0);
    });

    it('opens a Music track menu intentionally with OK and focuses its first action', async () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });
        const fixture = createMusicTrackMenuFixture();

        window.location.hash = '#/music';
        syncPtvTvFocusEngine({ isTv: true });
        fixture.trigger.focus();
        const event = dispatchRemoteKey(fixture.trigger, 'OK');

        expect(event.defaultPrevented).toBe(true);
        expect(fixture.getOpenCount()).toBe(1);
        expect(fixture.getMenu()).not.toBeNull();
        await vi.waitFor(() => {
            expect(document.activeElement).toBe(fixture.getFirstItem());
        });
    });

    it('closes an immediately opened Music menu with webOS Back without leaving Music', () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });
        const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
        const fixture = createMusicTrackMenuFixture();

        window.location.hash = '#/music';
        syncPtvTvFocusEngine({ isTv: true });
        fixture.trigger.focus();
        dispatchRemoteKey(fixture.trigger, 'OK');
        const event = dispatchRemoteKey(fixture.trigger, 'Unidentified', 461);

        expect(event.defaultPrevented).toBe(true);
        expect(fixture.getMenu()).toBeNull();
        expect(fixture.getCloseCount()).toBe(1);
        expect(document.activeElement).toBe(fixture.trigger);
        expect(window.location.hash).toBe('#/music');
        expect(historyBack).not.toHaveBeenCalled();
    });

    it('closes a settled Music menu once with webOS Back and restores its exact trigger', async () => {
        const animationFrames: FrameRequestCallback[] = [];
        const flushAnimationFrames = () => {
            const callbacks = animationFrames.splice(0);

            callbacks.forEach(callback => {
                callback(performance.now());
            });
        };
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            animationFrames.push(callback);
            return animationFrames.length;
        });
        const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
        const fixture = createMusicTrackMenuFixture({ deferClose: true });

        window.location.hash = '#/music';
        syncPtvTvFocusEngine({ isTv: true });
        flushAnimationFrames();
        fixture.trigger.focus();
        dispatchRemoteKey(fixture.trigger, 'OK');
        await vi.waitFor(() => {
            flushAnimationFrames();
            expect(document.activeElement).toBe(fixture.getFirstItem());
        });

        const event = dispatchRemoteKey(document.activeElement || document, 'Unidentified', 461);

        expect(event.defaultPrevented).toBe(true);
        expect(fixture.getCloseCount()).toBe(1);
        expect(window.location.hash).toBe('#/music');
        expect(historyBack).not.toHaveBeenCalled();
        await vi.waitFor(() => {
            flushAnimationFrames();
            expect(fixture.getMenu()).toBeNull();
            expect(document.activeElement).toBe(fixture.trigger);
        });
    });

    it('reconciles a visible Music menu whose layer stack has not refreshed before Back', () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });
        const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
        const fixture = createMusicTrackMenuFixture();

        window.location.hash = '#/music';
        syncPtvTvFocusEngine({ isTv: true });
        fixture.trigger.focus();
        fixture.trigger.click();
        const event = dispatchRemoteKey(fixture.trigger, 'Unidentified', 461);

        expect(event.defaultPrevented).toBe(true);
        expect(fixture.getMenu()).toBeNull();
        expect(fixture.getCloseCount()).toBe(1);
        expect(document.activeElement).toBe(fixture.trigger);
        expect(window.location.hash).toBe('#/music');
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
        const frameCallbacks: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            frameCallbacks.push(callback);
            return frameCallbacks.length;
        });
        const flushFrames = () => {
            let flushCount = 0;

            while (frameCallbacks.length && flushCount < 20) {
                const callbacks = frameCallbacks.splice(0);
                callbacks.forEach(callback => {
                    callback(performance.now());
                });
                flushCount += 1;
            }
        };
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
        first.setAttribute('aria-label', 'First dialog action');
        first.dataset.ptvFocusKey = 'dialog-first';
        second.setAttribute('aria-label', 'Second dialog action');
        second.dataset.ptvFocusKey = 'dialog-second';
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
        flushFrames();

        expect(document.activeElement).toBe(first);
        dispatchRemoteKey(document, 'ArrowRight');
        expect(document.activeElement).toBe(second);
        flushFrames();
        dispatchRemoteKey(document, 'Tab');
        expect(document.activeElement).toBe(first);
        flushFrames();
        dispatchRemoteKey(document, 'Unidentified', 461);
        flushFrames();
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

    it('keeps horizontal focus inside the mini-player and lets Up return to the page', () => {
        const shell = document.createElement('main');
        const navigation = document.createElement('nav');
        const returnTarget = document.createElement('button');
        const nearerGeometryTarget = document.createElement('button');
        const dock = document.createElement('aside');
        const primary = document.createElement('button');
        const next = document.createElement('button');
        const player = document.createElement('button');
        shell.className = 'ptv-shell-frame';
        dock.className = 'ptv-media-dock';
        dock.dataset.ptvFocusEscapeUp = 'page';
        dock.dataset.ptvPlaybackPaused = 'false';
        dock.dataset.ptvPlaybackSurface = 'mini-player';
        primary.dataset.ptvFocusKey = 'mini-player:primary';
        primary.dataset.ptvInitialFocus = 'mini-player-primary';
        next.dataset.ptvFocusKey = 'mini-player:next';
        player.dataset.ptvFocusKey = 'mini-player:player';
        setRect(returnTarget, 380, 100);
        setRect(nearerGeometryTarget, 380, 700);
        setRect(primary, 100, 900);
        setRect(next, 240, 900);
        setRect(player, 380, 900);
        navigation.append(returnTarget);
        shell.append(navigation, nearerGeometryTarget);
        dock.append(primary, next, player);
        document.body.append(shell, dock);
        syncPtvTvFocusEngine({ isTv: true });
        returnTarget.focus();

        expect(notifyPtvTvPlaybackSurfaceReady(dock, 'mini-player')).toBe(true);
        expect(document.activeElement).toBe(primary);
        dispatchRemoteKey(primary, 'ArrowUp');
        expect(document.activeElement).toBe(returnTarget);

        expect(notifyPtvTvPlaybackSurfaceReady(dock, 'mini-player')).toBe(true);
        expect(document.activeElement).toBe(primary);
        dispatchRemoteKey(primary, 'ArrowRight');
        expect(document.activeElement).toBe(next);
        dispatchRemoteKey(next, 'ArrowRight');
        expect(document.activeElement).toBe(player);
        dock.dataset.ptvPlaybackPaused = 'true';
        expect(getPtvTvNavigationSnapshot().focusGraphSummary.activeScope).toBe('player-controls');
        const upEvent = dispatchRemoteKey(player, 'ArrowUp');

        expect(upEvent.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(returnTarget);
        expect(getPtvTvNavigationSnapshot().focusGraphSummary.activeScope).toBe('main-content');

        notifyPtvTvPlaybackSurfaceDisposed(dock, 'mini-player');
    });

    it('preserves originating page focus when paused Music remounts after video playback', () => {
        const shell = document.createElement('main');
        const heroPlay = document.createElement('button');
        const dock = document.createElement('aside');
        const art = document.createElement('button');
        const primary = document.createElement('button');
        shell.className = 'ptv-shell-frame';
        heroPlay.dataset.ptvFocusKey = 'home:hero:play';
        heroPlay.dataset.ptvInitialFocus = 'hero-primary';
        dock.className = 'ptv-media-dock';
        dock.dataset.ptvPlaybackPaused = 'true';
        dock.dataset.ptvPlaybackSurface = 'mini-player';
        art.dataset.ptvFocusKey = 'mini-player:art';
        primary.dataset.ptvFocusKey = 'mini-player:primary';
        primary.dataset.ptvInitialFocus = 'mini-player-primary';
        setRect(heroPlay, 100, 100);
        setRect(art, 100, 900);
        setRect(primary, 240, 900);
        shell.append(heroPlay);
        dock.append(art, primary);
        document.body.append(shell, dock);
        syncPtvTvFocusEngine({ isTv: true });
        heroPlay.focus();

        expect(notifyPtvTvPlaybackSurfaceReady(dock, 'mini-player')).toBe(true);
        expect(document.activeElement).toBe(heroPlay);
        expect(getPtvTvNavigationSnapshot().focusGraphSummary.activeScope).toBe('main-content');
        expect(getPtvTvNavigationSnapshot().focusGraphSummary.currentCandidatePresent).toBe(true);

        dock.dataset.ptvPlaybackPaused = 'false';
        primary.focus();
        dock.dataset.ptvPlaybackPaused = 'true';
        expect(document.activeElement).toBe(primary);
        expect(getPtvTvNavigationSnapshot().focusGraphSummary.activeScope).toBe('player-controls');

        notifyPtvTvPlaybackSurfaceDisposed(dock, 'mini-player');
    });

    it('keeps Settings route focus authoritative through lifecycle races with a passive mini-player', () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            callback(performance.now());
            return 1;
        });
        const shell = document.createElement('main');
        const heroDetails = document.createElement('button');
        const dock = document.createElement('aside');
        const miniPrimary = document.createElement('button');
        shell.className = 'ptv-shell-frame';
        heroDetails.dataset.ptvFocusKey = 'home:hero:details';
        dock.className = 'ptv-media-dock';
        dock.dataset.ptvPlaybackPaused = 'true';
        dock.dataset.ptvPlaybackSurface = 'mini-player';
        miniPrimary.dataset.ptvFocusKey = 'mini-player:primary';
        miniPrimary.dataset.ptvInitialFocus = 'mini-player-primary';
        setRect(heroDetails, 100, 100);
        setRect(miniPrimary, 240, 900);
        shell.append(heroDetails);
        dock.append(miniPrimary);
        document.body.append(shell, dock);
        syncPtvTvFocusEngine({ isTv: true });
        heroDetails.focus();
        notifyPtvTvPlaybackSurfaceReady(dock, 'mini-player');

        const queuedFrames: FrameRequestCallback[] = [];

        vi.mocked(window.requestAnimationFrame).mockImplementation(callback => {
            queuedFrames.push(callback);
            return queuedFrames.length + 1;
        });

        window.dispatchEvent(new CustomEvent('ptv:routecontrollerchange', {
            detail: { owner: 'settings', pageType: 'settings', routeKey: 'settings-route' }
        }));
        shell.remove();
        window.dispatchEvent(new Event('pageshow'));
        window.dispatchEvent(new CustomEvent('ptv:focus-content-ready'));
        document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

        miniPrimary.focus();
        const bodyPhaseFrames = queuedFrames.splice(0);

        bodyPhaseFrames.forEach(callback => {
            callback(performance.now());
        });
        expect(getPtvTvNavigationSnapshot().focusGraphSummary.activeScope).not.toBe('player-controls');
        expect(getPtvTvNavigationSnapshot().focusGraphSummary.currentCandidatePresent).toBe(false);

        const settings = document.createElement('section');
        const profile = document.createElement('button');
        settings.id = 'myPreferencesMenuPage';
        settings.className = 'mainAnimatedPage';
        profile.className = 'listItem-border';
        setRect(profile, 100, 100);
        settings.append(profile);
        document.body.prepend(settings);
        window.dispatchEvent(new CustomEvent('ptv:focus-content-ready'));
        while (queuedFrames.length) queuedFrames.shift()?.(performance.now());

        expect(document.activeElement).toBe(profile);
        expect(getPtvTvNavigationSnapshot().focusGraphSummary.activeScope).toBe('settings-panel');
        expect(getPtvTvNavigationSnapshot().focusGraphSummary.currentCandidatePresent).toBe(true);

        miniPrimary.focus();
        while (queuedFrames.length) queuedFrames.shift()?.(performance.now());
        expect(document.activeElement).toBe(profile);
        expect(getPtvTvNavigationSnapshot().focusGraphSummary.activeScope).toBe('settings-panel');

        notifyPtvTvPlaybackSurfaceDisposed(dock, 'mini-player');
    });

    it('gives full-screen music initial focus and owns one Back decision', () => {
        const player = document.createElement('section');
        const primary = document.createElement('button');
        const downstreamBack = vi.fn();
        const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
        player.className = 'ptv-music-now-playing-view ptv-music-fullscreen-player';
        player.dataset.ptvPlaybackSurface = 'full-screen-player';
        primary.dataset.ptvFocusKey = 'full-screen-player:primary';
        primary.dataset.ptvInitialFocus = 'full-screen-player-primary';
        setRect(primary, 100, 100);
        player.append(primary);
        document.body.append(player);
        window.location.hash = '#/music/player';
        syncPtvTvFocusEngine({ isTv: true });
        document.addEventListener('keydown', downstreamBack);

        expect(notifyPtvTvPlaybackSurfaceReady(player, 'full-screen-player')).toBe(true);
        expect(document.activeElement).toBe(primary);
        const upEvent = dispatchRemoteKey(primary, 'ArrowUp');

        expect(upEvent.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(primary);
        expect(getPtvTvNavigationSnapshot().focusGraphSummary.activeScope).toBe('full-screen-music-player');
        downstreamBack.mockClear();
        const event = dispatchRemoteKey(primary, 'Escape');

        expect(event.defaultPrevented).toBe(true);
        expect(historyBack).toHaveBeenCalledTimes(1);
        expect(downstreamBack).not.toHaveBeenCalled();

        document.removeEventListener('keydown', downstreamBack);
        notifyPtvTvPlaybackSurfaceDisposed(player, 'full-screen-player');
    });

    it('restores the mini-player Player control after closing full-screen music', () => {
        const shell = document.createElement('main');
        const navigation = document.createElement('nav');
        const musicNavigation = document.createElement('button');
        const firstDock = document.createElement('aside');
        const firstPrimary = document.createElement('button');
        const firstPlayer = document.createElement('button');
        firstDock.className = 'ptv-media-dock';
        firstDock.dataset.ptvPlaybackSurface = 'mini-player';
        firstPrimary.dataset.ptvFocusKey = 'mini-player:primary';
        firstPrimary.dataset.ptvInitialFocus = 'mini-player-primary';
        firstPlayer.dataset.ptvFocusKey = 'mini-player:player';
        setRect(firstPrimary, 100, 100);
        setRect(firstPlayer, 240, 100);
        firstDock.append(firstPrimary, firstPlayer);
        document.body.append(firstDock);
        syncPtvTvFocusEngine({ isTv: true });
        notifyPtvTvPlaybackSurfaceReady(firstDock, 'mini-player');
        firstPlayer.focus();

        window.dispatchEvent(new CustomEvent('ptv:routecontrollerchange', {
            detail: { owner: 'music', pageType: 'music', routeKey: 'full-screen-route' }
        }));
        notifyPtvTvPlaybackSurfaceDisposed(firstDock, 'mini-player');
        firstDock.remove();

        const fullScreen = document.createElement('section');
        const fullScreenPrimary = document.createElement('button');
        fullScreen.className = 'ptv-music-fullscreen-player';
        fullScreen.dataset.ptvPlaybackSurface = 'full-screen-player';
        fullScreenPrimary.dataset.ptvInitialFocus = 'full-screen-player-primary';
        setRect(fullScreenPrimary, 100, 100);
        fullScreen.append(fullScreenPrimary);
        document.body.append(fullScreen);
        notifyPtvTvPlaybackSurfaceReady(fullScreen, 'full-screen-player');

        window.dispatchEvent(new CustomEvent('ptv:routecontrollerchange', {
            detail: { owner: 'native', pageType: 'test', routeKey: 'test-route' }
        }));
        notifyPtvTvPlaybackSurfaceDisposed(fullScreen, 'full-screen-player');
        fullScreen.remove();

        const restoredDock = document.createElement('aside');
        const restoredPrimary = document.createElement('button');
        const restoredPlayer = document.createElement('button');
        restoredDock.className = 'ptv-media-dock';
        restoredDock.dataset.ptvFocusEscapeUp = 'page';
        restoredDock.dataset.ptvPlaybackSurface = 'mini-player';
        restoredPrimary.dataset.ptvFocusKey = 'mini-player:primary';
        restoredPrimary.dataset.ptvInitialFocus = 'mini-player-primary';
        restoredPlayer.dataset.ptvFocusKey = 'mini-player:player';
        shell.className = 'ptv-shell-frame';
        musicNavigation.dataset.ptvFocusKey = 'navigation:music';
        setRect(musicNavigation, 240, 100);
        setRect(restoredPrimary, 100, 900);
        setRect(restoredPlayer, 240, 900);
        navigation.append(musicNavigation);
        shell.append(navigation);
        restoredDock.append(restoredPrimary, restoredPlayer);
        document.body.append(shell, restoredDock);

        expect(notifyPtvTvPlaybackSurfaceReady(restoredDock, 'mini-player')).toBe(true);
        expect(document.activeElement).toBe(restoredPlayer);
        dispatchRemoteKey(restoredPlayer, 'ArrowUp');
        expect(document.activeElement).toBe(musicNavigation);

        notifyPtvTvPlaybackSurfaceDisposed(restoredDock, 'mini-player');
    });

    it('keeps Up inside visible video player controls', () => {
        const page = document.createElement('section');
        const controls = document.createElement('div');
        const pause = document.createElement('button');
        page.id = 'videoOsdPage';
        page.className = 'videoOsdPage';
        controls.className = 'videoOsdBottom';
        pause.dataset.ptvFocusKey = 'video:pause';
        setRect(pause, 100, 900);
        controls.append(pause);
        page.append(controls);
        document.body.append(page);
        document.documentElement.classList.add('ptv-player-osd-visible');
        syncPtvTvFocusEngine({ isTv: true });
        notifyPtvTvPlaybackFocus(true);
        pause.focus();

        const event = dispatchRemoteKey(pause, 'ArrowUp');

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(pause);
        expect(getPtvTvNavigationSnapshot().focusGraphSummary.activeScope).toBe('player-controls');

        document.documentElement.classList.remove('ptv-player-osd-visible');
        notifyPtvTvPlaybackFocus(false);
    });

    it('uses visible video controls as the only active scope and yields handled keys once', () => {
        const page = document.createElement('section');
        const controls = document.createElement('div');
        const first = document.createElement('button');
        const second = document.createElement('button');
        const legacyListener = vi.fn();
        page.id = 'videoOsdPage';
        page.className = 'videoOsdPage';
        controls.className = 'videoOsdBottom';
        setRect(first, 100, 100);
        setRect(second, 240, 100);
        controls.append(first, second);
        page.append(controls);
        document.body.append(page);
        document.documentElement.classList.add('ptv-player-osd-visible');
        syncPtvTvFocusEngine({ isTv: true });
        notifyPtvTvPlaybackFocus(true);
        first.focus();
        document.addEventListener('keydown', legacyListener);

        const event = dispatchRemoteKey(first, 'ArrowRight');

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(second);
        expect(legacyListener).toHaveBeenCalledTimes(1);
        expect((legacyListener.mock.calls[0][0] as KeyboardEvent).defaultPrevented).toBe(true);
        expect(getPtvTvNavigationSnapshot().focusGraphSummary.activeScope).toBe('player-controls');

        document.removeEventListener('keydown', legacyListener);
        document.documentElement.classList.remove('ptv-player-osd-visible');
        notifyPtvTvPlaybackFocus(false);
    });

    it('leaves hidden video directional input to the established video controller', () => {
        const page = document.createElement('section');
        const first = document.createElement('button');
        const second = document.createElement('button');
        const legacyListener = vi.fn();
        page.id = 'videoOsdPage';
        setRect(first, 100, 100);
        setRect(second, 240, 100);
        page.append(first, second);
        document.body.append(page);
        syncPtvTvFocusEngine({ isTv: true });
        notifyPtvTvPlaybackFocus(true);
        first.focus();
        document.addEventListener('keydown', legacyListener);

        const event = dispatchRemoteKey(first, 'ArrowRight');

        expect(event.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(first);
        expect(legacyListener).toHaveBeenCalledTimes(1);

        document.removeEventListener('keydown', legacyListener);
        notifyPtvTvPlaybackFocus(false);
    });

    it('keeps a hidden Right plus six repeats with the stock controller until release', () => {
        const page = document.createElement('section');
        const controls = document.createElement('div');
        const surface = document.createElement('button');
        const slider = document.createElement('input');
        const first = document.createElement('button');
        const second = document.createElement('button');
        const sliderListener = vi.fn();
        const downstreamCommand = vi.fn();
        const seekBack = vi.fn();
        const seekForward = vi.fn();
        page.id = 'videoOsdPage';
        controls.className = 'videoOsdBottom';
        slider.type = 'range';
        setRect(surface, 100, 700);
        setRect(slider, 100, 900);
        setRect(first, 100, 100);
        setRect(second, 240, 100);
        controls.append(first, second, slider);
        page.append(surface, controls);
        document.body.append(page);
        syncPtvTvFocusEngine({ isTv: true });
        notifyPtvTvPlaybackFocus(true);
        surface.focus();
        const navigationMovesBefore = getPtvTvNavigationSnapshot().navigationMoves;
        const stockVideoCapture = (event: KeyboardEvent) => {
            const handled = executePtvHiddenVideoDirectionalGestureKey({
                controlsHidden: !document.documentElement.classList.contains('ptv-player-osd-visible'),
                key: event.key,
                repeat: event.repeat
            }, {
                seekBack,
                seekForward
            });

            if (!handled) return;

            event.preventDefault();
            document.documentElement.classList.add('ptv-player-osd-visible');
            slider.focus();
            event.stopImmediatePropagation();
        };
        document.addEventListener('keydown', stockVideoCapture, true);
        slider.addEventListener('keydown', sliderListener);
        window.addEventListener('keydown', downstreamCommand);

        const events = [
            dispatchRemoteKey(surface, 'ArrowRight'),
            ...Array.from({ length: 6 }, () => dispatchRemoteKey(slider, 'ArrowRight', 0, true))
        ];

        expect(events.every(event => event.defaultPrevented)).toBe(true);
        expect(seekBack).not.toHaveBeenCalled();
        expect(seekForward).toHaveBeenCalledTimes(7);
        expect(sliderListener).not.toHaveBeenCalled();
        expect(downstreamCommand).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(slider);
        expect(getPtvTvNavigationSnapshot().navigationMoves).toBe(navigationMovesBefore);

        first.focus();
        const releasedPress = dispatchRemoteKey(first, 'ArrowRight');

        expect(releasedPress.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(second);
        expect(seekForward).toHaveBeenCalledTimes(7);

        document.removeEventListener('keydown', stockVideoCapture, true);
        slider.removeEventListener('keydown', sliderListener);
        window.removeEventListener('keydown', downstreamCommand);
        document.documentElement.classList.remove('ptv-player-osd-visible');
        notifyPtvTvPlaybackFocus(false);
    });

    it('closes visible video controls before exiting playback and stops later Back listeners', () => {
        const page = document.createElement('section');
        const controls = document.createElement('div');
        const back = document.createElement('button');
        const handler = vi.fn(() => true);
        const downstreamBack = vi.fn();
        const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
        page.id = 'videoOsdPage';
        controls.className = 'videoOsdBottom';
        setRect(back, 100, 100);
        controls.append(back);
        page.append(controls);
        document.body.append(page);
        document.documentElement.classList.add('ptv-player-osd-visible');
        syncPtvTvFocusEngine({ isTv: true });
        notifyPtvTvPlaybackFocus(true);
        const unregister = registerPtvTvPlaybackBackHandler(handler);
        back.focus();
        document.addEventListener('keydown', downstreamBack);

        const event = dispatchRemoteKey(back, 'Escape');

        expect(event.defaultPrevented).toBe(true);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith('controls');
        expect(historyBack).not.toHaveBeenCalled();
        expect(downstreamBack).not.toHaveBeenCalled();

        document.removeEventListener('keydown', downstreamBack);
        unregister();
        document.documentElement.classList.remove('ptv-player-osd-visible');
        notifyPtvTvPlaybackFocus(false);
    });

    it('exits video through the registered Back owner only after controls are hidden', () => {
        const page = document.createElement('section');
        const surface = document.createElement('button');
        const handler = vi.fn(() => true);
        const downstreamBack = vi.fn();
        const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
        page.id = 'videoOsdPage';
        setRect(surface, 100, 100);
        page.append(surface);
        document.body.append(page);
        syncPtvTvFocusEngine({ isTv: true });
        notifyPtvTvPlaybackFocus(true);
        const unregister = registerPtvTvPlaybackBackHandler(handler);
        surface.focus();
        document.addEventListener('keydown', downstreamBack);

        const event = dispatchRemoteKey(surface, 'Escape');

        expect(event.defaultPrevented).toBe(true);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith('video');
        expect(historyBack).not.toHaveBeenCalled();
        expect(downstreamBack).not.toHaveBeenCalled();

        document.removeEventListener('keydown', downstreamBack);
        unregister();
        notifyPtvTvPlaybackFocus(false);
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

    it('keeps Details cards in the focus graph when its header-only shell mounts last', () => {
        const detailsPage = document.createElement('section');
        const detailsAction = document.createElement('button');
        const seasonCard = document.createElement('button');
        const shellHost = document.createElement('div');
        const headerOnlyShell = document.createElement('div');
        const navigation = document.createElement('nav');
        const brand = document.createElement('a');
        const activateSeason = vi.fn();

        detailsPage.className = 'page ptv-detail-page';
        detailsPage.dataset.role = 'page';
        detailsAction.className = 'detailButton';
        detailsAction.dataset.ptvFocusKey = 'details:action';
        seasonCard.className = 'card ptv-card';
        seasonCard.dataset.ptvFocusKey = 'details:season';
        seasonCard.addEventListener('click', activateSeason);
        headerOnlyShell.className = 'ptv-shell-frame ptv-shell-frame-header-only';
        brand.href = '#/home';
        setRect(brand, 0, 0);
        setRect(detailsAction, 200, 180);
        setRect(seasonCard, 200, 900);
        detailsPage.append(detailsAction, seasonCard);
        navigation.append(brand);
        headerOnlyShell.append(navigation);
        shellHost.append(headerOnlyShell);
        document.body.append(detailsPage, shellHost);
        syncPtvTvFocusEngine({ isTv: true });

        detailsAction.focus();
        const graph = getPtvTvNavigationSnapshot().focusGraphSummary;

        expect(graph.candidateCountByCategory['media-card']).toBe(1);
        expect(graph.candidateCountByCategory['nav-item']).toBe(1);
        expect(graph.currentCandidatePresent).toBe(true);

        dispatchRemoteKey(detailsAction, 'ArrowDown');
        expect(document.activeElement).toBe(seasonCard);
        dispatchRemoteKey(seasonCard, 'OK');
        expect(activateSeason).toHaveBeenCalledTimes(1);
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

    it('normalizes remote keys into privacy-safe action categories', () => {
        expect(normalizePtvRemoteDiagnosticAction({ key: 'ArrowUp' })).toBe('up');
        expect(normalizePtvRemoteDiagnosticAction({ key: 'Enter' })).toBe('enter');
        expect(normalizePtvRemoteDiagnosticAction({ key: 'Unidentified', keyCode: 461 })).toBe('back');
        expect(normalizePtvRemoteDiagnosticAction({ key: 'MediaPlayPause' })).toBe('play-pause');
        expect(normalizePtvRemoteDiagnosticAction({ key: 'ColorF0Red' })).toBe('color-key');
        expect(normalizePtvRemoteDiagnosticAction({ key: 'private-device-button-9384' })).toBe('unknown');
    });

    it('emits the ordered passive input pipeline and safe graph summary without changing movement', () => {
        const shell = document.createElement('main');
        const first = document.createElement('button');
        const second = document.createElement('button');
        const events: Array<{ detail: Record<string, unknown>; name: string }> = [];
        const listener = (event: Event) => {
            events.push((event as CustomEvent).detail);
        };

        shell.className = 'ptv-shell-frame';
        first.id = 'private-dom-id';
        first.textContent = 'Private media title';
        first.dataset.ptvFocusKey = 'private-media-id';
        second.dataset.ptvFocusKey = 'private-next-id';
        setRect(first, 0, 0);
        setRect(second, 140, 0);
        shell.append(first, second);
        document.body.append(shell);
        window.addEventListener('ptv:focus-diagnostic', listener);
        syncPtvTvFocusEngine({
            isAndroidTv: true,
            isFireTv: false,
            isTv: true,
            isWebOs: false,
            tvDetectionReason: 'android-tv-user-agent'
        });
        first.focus();
        dispatchRemoteKey(document, 'ArrowRight');

        const pipeline = events
            .filter(event => event.name === 'ptv-tv-input-pipeline')
            .map(event => String(event.detail.inputStage));
        const graph = getPtvTvNavigationSnapshot().focusGraphSummary;
        const serializedGraph = JSON.stringify(graph);

        expect(document.activeElement).toBe(second);
        expect(pipeline).toEqual(expect.arrayContaining([
            'browser-event-received',
            'key-normalized',
            'focus-handler-reached',
            'target-search-started',
            'target-found',
            'focus-movement-requested',
            'focus-event-observed',
            'movement-confirmed',
            'completed'
        ]));
        expect(pipeline.indexOf('browser-event-received')).toBeLessThan(pipeline.indexOf('movement-confirmed'));
        expect(graph.generation).toBeGreaterThan(0);
        expect(graph.candidateCountByCategory.button).toBe(2);
        expect(graph.nearestCandidateFingerprints.left).toMatch(/^focus-[a-z0-9]+$/);
        expect(serializedGraph).not.toContain('private-dom-id');
        expect(serializedGraph).not.toContain('Private media title');
        expect(serializedGraph).not.toContain('private-media-id');
        window.removeEventListener('ptv:focus-diagnostic', listener);
    });

    it('localizes a missing directional target and prevents duplicate listener installation', () => {
        const shell = document.createElement('main');
        const only = document.createElement('button');
        const events: Array<{ detail: Record<string, unknown>; name: string }> = [];
        const listener = (event: Event) => {
            events.push((event as CustomEvent).detail);
        };

        shell.className = 'ptv-shell-frame';
        setRect(only, 0, 0);
        shell.append(only);
        document.body.append(shell);
        window.addEventListener('ptv:focus-diagnostic', listener);
        syncPtvTvFocusEngine({ isTv: true });
        const initialized = getPtvTvNavigationSnapshot();

        syncPtvTvFocusEngine({ isTv: true });
        only.focus();
        dispatchRemoteKey(document, 'ArrowRight');
        const after = getPtvTvNavigationSnapshot();
        const rejected = events.find(event => (
            event.name === 'ptv-tv-input-pipeline'
            && event.detail.inputStage === 'target-rejected'
        ));

        expect(rejected?.detail.failureReason).toBe('no-directional-target');
        expect(after.focusEngineListenerInstallCount).toBe(initialized.focusEngineListenerInstallCount);
        expect(after.focusEngineDuplicateListenerCount).toBe(0);
        window.removeEventListener('ptv:focus-diagnostic', listener);
    });

    it('reports a browser focus confirmation timeout without repairing focus', () => {
        vi.useFakeTimers();
        const shell = document.createElement('main');
        const first = document.createElement('button');
        const second = document.createElement('button');
        const events: Array<{ detail: Record<string, unknown>; name: string }> = [];
        const listener = (event: Event) => {
            events.push((event as CustomEvent).detail);
        };

        shell.className = 'ptv-shell-frame';
        setRect(first, 0, 0);
        setRect(second, 140, 0);
        second.focus = vi.fn();
        shell.append(first, second);
        document.body.append(shell);
        window.addEventListener('ptv:focus-diagnostic', listener);
        syncPtvTvFocusEngine({ isTv: true });
        first.focus();
        dispatchRemoteKey(document, 'ArrowRight');
        vi.advanceTimersByTime(200);

        expect(document.activeElement).toBe(first);
        expect(events.some(event => (
            event.name === 'ptv-tv-input-pipeline'
            && event.detail.inputStage === 'movement-timed-out'
            && event.detail.failureReason === 'browser-focus-confirmation-timeout'
        ))).toBe(true);
        window.removeEventListener('ptv:focus-diagnostic', listener);
        vi.useRealTimers();
    });
});
