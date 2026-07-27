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
        window.location.hash = '#/home';
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

    it('activates one mini-player scope and keeps horizontal focus inside its controls', () => {
        const shell = document.createElement('main');
        const returnTarget = document.createElement('button');
        const dock = document.createElement('aside');
        const primary = document.createElement('button');
        const next = document.createElement('button');
        const player = document.createElement('button');
        shell.className = 'ptv-shell-frame';
        dock.className = 'ptv-media-dock';
        dock.dataset.ptvPlaybackSurface = 'mini-player';
        primary.dataset.ptvFocusKey = 'mini-player:primary';
        primary.dataset.ptvInitialFocus = 'mini-player-primary';
        next.dataset.ptvFocusKey = 'mini-player:next';
        player.dataset.ptvFocusKey = 'mini-player:player';
        setRect(returnTarget, 100, 300);
        setRect(primary, 100, 100);
        setRect(next, 240, 100);
        setRect(player, 380, 100);
        shell.append(returnTarget);
        dock.append(primary, next, player);
        document.body.append(shell, dock);
        syncPtvTvFocusEngine({ isTv: true });
        returnTarget.focus();

        expect(notifyPtvTvPlaybackSurfaceReady(dock, 'mini-player')).toBe(true);
        expect(document.activeElement).toBe(primary);

        dispatchRemoteKey(primary, 'ArrowRight');
        expect(document.activeElement).toBe(next);
        dispatchRemoteKey(next, 'ArrowRight');
        expect(document.activeElement).toBe(player);

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
        const event = dispatchRemoteKey(primary, 'Escape');

        expect(event.defaultPrevented).toBe(true);
        expect(historyBack).toHaveBeenCalledTimes(1);
        expect(downstreamBack).not.toHaveBeenCalled();

        document.removeEventListener('keydown', downstreamBack);
        notifyPtvTvPlaybackSurfaceDisposed(player, 'full-screen-player');
    });

    it('restores the mini-player Player control after closing full-screen music', () => {
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
        restoredDock.dataset.ptvPlaybackSurface = 'mini-player';
        restoredPrimary.dataset.ptvFocusKey = 'mini-player:primary';
        restoredPrimary.dataset.ptvInitialFocus = 'mini-player-primary';
        restoredPlayer.dataset.ptvFocusKey = 'mini-player:player';
        setRect(restoredPrimary, 100, 100);
        setRect(restoredPlayer, 240, 100);
        restoredDock.append(restoredPrimary, restoredPlayer);
        document.body.append(restoredDock);

        expect(notifyPtvTvPlaybackSurfaceReady(restoredDock, 'mini-player')).toBe(true);
        expect(document.activeElement).toBe(restoredPlayer);

        notifyPtvTvPlaybackSurfaceDisposed(restoredDock, 'mini-player');
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
