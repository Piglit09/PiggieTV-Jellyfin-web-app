import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../scripts/browser', () => ({
    default: {
        edge: false,
        touch: true
    }
}));

vi.mock('../globalize', () => ({
    default: {
        getIsRTL: () => false
    }
}));

import NavDrawer from './navdrawer';

function createDrawer() {
    const target = document.createElement('div');
    const scrollContainer = document.createElement('div');

    scrollContainer.className = 'mainDrawer-scrollContainer';
    target.appendChild(scrollContainer);
    document.body.appendChild(target);

    return new NavDrawer({ target });
}

function createHandle() {
    const handle = document.createElement('div');

    handle.className = 'mainDrawerHandle';
    document.body.appendChild(handle);
    return handle;
}

describe('NavDrawer edge-swipe lifecycle', () => {
    afterEach(() => {
        document.body.replaceChildren();
        vi.restoreAllMocks();
    });

    it('fails closed when the authentication route has no edge target', () => {
        const drawer = createDrawer();

        expect(() => drawer.setEdgeSwipeEnabled(true)).not.toThrow();
        expect(drawer._edgeSwipeEnabled).toBe(false);
        expect(drawer._edgeSwipeTarget).toBeFalsy();
    });

    it('resolves a handle that mounts after the drawer and binds only once', () => {
        const drawer = createDrawer();

        drawer.setEdgeSwipeEnabled(true);
        const handle = createHandle();
        const addEventListener = vi.spyOn(handle, 'addEventListener');

        drawer.setEdgeSwipeEnabled(true);
        expect(drawer._edgeSwipeTarget).toBe(handle);
        expect(drawer._edgeSwipeEnabled).toBe(true);
        expect(addEventListener).toHaveBeenCalledTimes(3);

        drawer.setEdgeSwipeEnabled(true);
        expect(addEventListener).toHaveBeenCalledTimes(3);
    });

    it('removes listeners from the exact target that was enabled', () => {
        const handle = createHandle();
        const addEventListener = vi.spyOn(handle, 'addEventListener');
        const removeEventListener = vi.spyOn(handle, 'removeEventListener');
        const drawer = createDrawer();

        drawer.setEdgeSwipeEnabled(true);
        drawer.setEdgeSwipeEnabled(false);
        drawer.setEdgeSwipeEnabled(true);
        drawer.setEdgeSwipeEnabled(false);

        expect(addEventListener).toHaveBeenCalledTimes(6);
        expect(removeEventListener).toHaveBeenCalledTimes(8);
        expect(drawer._edgeSwipeTarget).toBeFalsy();
        expect(drawer._edgeSwipeEnabled).toBe(false);
    });

    it('retires a replaced target before binding its replacement', () => {
        const firstHandle = createHandle();
        const firstRemoveEventListener = vi.spyOn(firstHandle, 'removeEventListener');
        const drawer = createDrawer();

        drawer.setEdgeSwipeEnabled(true);
        firstHandle.remove();

        const replacementHandle = createHandle();
        const replacementAddEventListener = vi.spyOn(replacementHandle, 'addEventListener');
        const replacementRemoveEventListener = vi.spyOn(replacementHandle, 'removeEventListener');

        drawer.setEdgeSwipeEnabled(true);

        expect(firstRemoveEventListener).toHaveBeenCalledTimes(4);
        expect(replacementAddEventListener).toHaveBeenCalledTimes(3);
        expect(drawer._edgeSwipeTarget).toBe(replacementHandle);

        drawer.setEdgeSwipeEnabled(false);
        expect(replacementRemoveEventListener).toHaveBeenCalledTimes(4);
    });
});
