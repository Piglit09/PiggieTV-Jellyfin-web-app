import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    autoFocus: vi.fn(),
    focus: vi.fn(),
    hideLoading: vi.fn(),
    inputOff: vi.fn(),
    inputOn: vi.fn(),
    popScope: vi.fn(),
    pushScope: vi.fn()
}));

vi.mock('../focusManager', () => ({
    default: {
        autoFocus: mocks.autoFocus,
        focus: mocks.focus,
        popScope: mocks.popScope,
        pushScope: mocks.pushScope
    }
}));

vi.mock('../../scripts/browser', () => ({
    default: {
        supportsCssAnimation: () => true,
        touch: false,
        tv: false
    }
}));

vi.mock('../layoutManager', () => ({
    default: {
        mobile: false,
        tv: false
    }
}));

vi.mock('../../scripts/inputManager', () => ({
    default: {
        off: mocks.inputOff,
        on: mocks.inputOn
    }
}));

vi.mock('../loading/loading.ts', () => ({
    hide: mocks.hideLoading
}));

vi.mock('../../utils/dom', () => ({
    default: {
        addEventListener: (
            target: EventTarget,
            type: string,
            listener: EventListener,
            options?: AddEventListenerOptions
        ) => target.addEventListener(type, listener, options),
        removeEventListener: (
            target: EventTarget,
            type: string,
            listener: EventListener,
            options?: EventListenerOptions
        ) => target.removeEventListener(type, listener, options),
        whichAnimationEvent: () => 'animationend'
    }
}));

vi.mock('RootAppRouter', () => ({
    history: {
        location: {
            state: {}
        }
    }
}));

import {
    close,
    createDialog,
    open
} from './dialogHelper';

describe('dialogHelper reduced-motion lifecycle', () => {
    beforeEach(() => {
        vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
            addEventListener: vi.fn(),
            matches: true,
            media: '(prefers-reduced-motion: reduce)',
            removeEventListener: vi.fn()
        }));
    });

    afterEach(() => {
        document.body.replaceChildren();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('closes through the existing dialog owner without waiting for animationend', async () => {
        const dialog = createDialog({
            autoFocus: false,
            enableHistory: false,
            modal: false,
            removeOnClose: false,
            scrollY: false
        });
        const closed = open(dialog);

        expect(dialog.classList.contains('hide')).toBe(false);

        close(dialog);
        await closed;

        expect(dialog.classList.contains('hide')).toBe(true);
        expect(mocks.popScope).toHaveBeenCalledWith(dialog);
        expect(mocks.hideLoading).toHaveBeenCalledOnce();
    });
});
