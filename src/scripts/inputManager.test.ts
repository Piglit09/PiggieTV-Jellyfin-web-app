import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const inputMocks = vi.hoisted(() => ({
    pause: vi.fn(),
    playPause: vi.fn(),
    unpause: vi.fn()
}));

vi.mock('components/apphost', () => ({
    appHost: {
        exit: vi.fn(),
        supports: vi.fn(() => false)
    }
}));

vi.mock('components/focusManager', () => ({
    default: {
        focusableParent: vi.fn((element: Element) => element),
        moveDown: vi.fn(),
        moveLeft: vi.fn(),
        moveRight: vi.fn(),
        moveUp: vi.fn()
    }
}));

vi.mock('components/playback/playbackmanager', () => ({
    playbackManager: {
        pause: inputMocks.pause,
        playPause: inputMocks.playPause,
        unpause: inputMocks.unpause
    }
}));

vi.mock('components/router/appRouter', () => ({
    appRouter: {
        back: vi.fn(),
        canGoBack: vi.fn(() => false)
    }
}));

vi.mock('constants/appFeature', () => ({
    AppFeature: {
        Exit: 'exit'
    }
}));

vi.mock('utils/dom', () => ({
    default: {
        addEventListener: vi.fn((target: EventTarget, name: string, listener: EventListener) => {
            target.addEventListener(name, listener);
        }),
        removeEventListener: vi.fn((target: EventTarget, name: string, listener: EventListener) => {
            target.removeEventListener(name, listener);
        })
    }
}));

import {
    handleCommand,
    registerPlaybackCommandHandler
} from './inputManager';

describe('input manager playback command adapter', () => {
    let unregister: (() => void) | null = null;

    beforeEach(() => {
        inputMocks.pause.mockReset();
        inputMocks.playPause.mockReset();
        inputMocks.unpause.mockReset();
    });

    afterEach(() => {
        unregister?.();
        unregister = null;
        vi.restoreAllMocks();
    });

    it.each([
        ['play', 'unpause'],
        ['pause', 'pause'],
        ['playpause', 'playPause']
    ])('lets one registered owner handle %s exactly once', (command, fallback) => {
        const handler = vi.fn(() => true);

        unregister = registerPlaybackCommandHandler('ptv-global-playback', handler);
        handleCommand(command);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(command);
        expect(inputMocks[fallback as keyof typeof inputMocks]).not.toHaveBeenCalled();
    });

    it('retains Jellyfin playback as the fallback when the adapter declines a command', () => {
        const handler = vi.fn(() => false);

        unregister = registerPlaybackCommandHandler('ptv-global-playback', handler);
        handleCommand('playpause');

        expect(handler).toHaveBeenCalledTimes(1);
        expect(inputMocks.playPause).toHaveBeenCalledTimes(1);
    });

    it('does not replace the active transport owner with a competing registration', () => {
        const first = vi.fn(() => true);
        const second = vi.fn(() => true);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        unregister = registerPlaybackCommandHandler('ptv-global-playback', first);
        const unregisterSecond = registerPlaybackCommandHandler('competing-owner', second);
        handleCommand('pause');
        unregisterSecond();

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
