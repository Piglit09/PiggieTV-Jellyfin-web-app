import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import actionSheet from '../../../components/actionSheet/actionSheet';
import { createVideoFetchingDataState } from '../../../controllers/playback/video/fetchingDataState';
import { createVideoTransientMenuLifecycle, isVideoTransientMenuCancellation } from '../../../controllers/playback/video/videoTransientMenuLifecycle';
import { runPtvIconEngine } from '../icons/ptvIconEngine';
import * as videoInputOwnership from './videoInputOwnership';
import Events from '../../../utils/events';

vi.mock('../../../components/dialogHelper/dialogHelper', () => ({
    default: {
        createDialog: () => {
            const dialog = document.createElement('div');
            dialog.className = 'dialog';
            document.querySelector('.dialogContainer')!.append(dialog);
            return dialog;
        },
        open: async (dialog: HTMLElement) => { dialog.classList.add('opened'); },
        close: (dialog: HTMLElement) => {
            dialog.classList.remove('opened');
            dialog.dispatchEvent(new Event('close'));
            dialog.remove();
        }
    }
}));
vi.mock('../../../components/layoutManager', () => ({ default: { tv: false, mobile: false } }));
vi.mock('../../../lib/globalize', () => ({ default: { translate: (key: string) => key } }));
vi.mock('../../../elements/emby-button/emby-button', () => ({}));
vi.mock('../../../utils/dom', () => ({
    default: {
        getWindowSize: () => ({ innerWidth: 1280, innerHeight: 720 }),
        parentWithClass: (element: Element, name: string) => element.closest('.' + name)
    }
}));

function deferred<T>() {
    let resolvePromise!: (value: T) => void;
    const promise = new Promise<T>(resolveValue => {
        resolvePromise = resolveValue;
    });
    return { promise, resolve: resolvePromise };
}

async function flush() {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}

// Execute the real controller and its real event registration. Only imports and
// a test-local observation seam are substituted; menu/hide/release code is intact.
function createController() {
    const source = readFileSync(resolve(process.cwd(), 'src/controllers/playback/video/index.js'), 'utf8')
        .replace(/^import[\s\S]*?;\r?\n/gm, '')
        .replace(/\bimport\(/g, 'loadModule(')
        .replace('export default function (view)', 'return function (view)');
    document.body.innerHTML = '<header class="skinHeader"></header><div class="dialogContainer"></div>'
        + readFileSync(resolve(process.cwd(), 'src/controllers/playback/video/index.html'), 'utf8');
    const view = document.querySelector('#videoOsdPage') as HTMLElement;
    view.querySelectorAll('.osdVolumeSlider, .osdPositionSlider').forEach(slider => {
        Object.assign(slider, { enableKeyboardDragging: () => undefined });
    });
    const firstPlayer = { id: 'first' };
    const item = { Id: 'movie-a', ServerId: 'server-a' };
    let player: object = firstPlayer;
    let currentItem = item;
    let audioIndex = 0;
    let subtitleIndex = 2;
    const audioSelection = vi.fn((index: number) => {
        audioIndex = index;
    });
    const subtitleSelection = vi.fn((index: number) => {
        subtitleIndex = index;
    });
    const secondarySelection = vi.fn();
    const settingsShow = vi.fn<(options: { onOption: (option: string) => Promise<unknown> | undefined }) => Promise<unknown>>(() => Promise.resolve());
    const actionImport = deferred<{ default: typeof actionSheet }>();
    const settingsImport = deferred<{ show: typeof settingsShow }>();
    const statsImport = deferred<{ default: new (options: unknown) => object }>();
    const statsCreated = vi.fn();
    const subtitleSyncCreated = vi.fn();
    const manager = {
        getCurrentPlayer: () => player,
        currentItem: () => currentItem,
        getPlayerState: () => ({ MediaSource: { SupportsTranscoding: true } }),
        audioTracks: () => [{ Index: 0, DisplayTitle: 'English' }, { Index: 1, DisplayTitle: 'French' }],
        getAudioStreamIndex: () => audioIndex,
        setAudioStreamIndex: audioSelection,
        subtitleTracks: () => [{ Index: 2, DisplayTitle: 'English' }, { Index: 4, DisplayTitle: 'Spanish' }],
        secondarySubtitleTracks: () => [{ Index: 3, DisplayTitle: 'French' }],
        getSubtitleStreamIndex: () => subtitleIndex,
        getSecondarySubtitleStreamIndex: () => -1,
        playerHasSecondarySubtitleSupport: () => true,
        trackHasSecondarySubtitleSupport: () => true,
        getSubtitleStream: () => ({}),
        setSubtitleStreamIndex: subtitleSelection,
        setSecondarySubtitleStreamIndex: secondarySelection,
        supportSubtitleOffset: () => false,
        isPlayingVideo: () => false
    };
    let observation!: {
        audio: () => Promise<unknown>;
        subtitles: () => Promise<unknown>;
        settings: () => Promise<unknown>;
        hide: () => void;
        replace: (next: object) => void;
        release: () => void;
        resetIdle: () => void;
        startTimer: () => void;
    };
    const deps = {
        playbackManager: manager,
        createVideoFetchingDataState,
        createVideoTransientMenuLifecycle,
        isVideoTransientMenuCancellation,
        ...videoInputOwnership,
        Events,
        EventType: { ['SHOW_VIDEO_OSD']: 'showVideoOsd' },
        PlayerEvent: { PromptSkip: 'promptSkip' },
        dom: {
            whichTransitionEvent: () => 'transitionend',
            addEventListener: (target: EventTarget, event: string, handler: EventListener, options: AddEventListenerOptions) => target.addEventListener(event, handler, options),
            removeEventListener: (target: EventTarget, event: string, handler: EventListener, options: EventListenerOptions) => target.removeEventListener(event, handler, options)
        },
        shell: { enableFullscreen: () => undefined },
        mouseManager: { hideCursor: () => undefined },
        focusManager: { isCurrentlyFocusable: () => true, focus: () => undefined },
        shouldFocusVideoOsdOnReveal: () => false,
        layoutManager: { tv: false, mobile: false },
        browser: {},
        inputManager: { on: () => undefined, off: () => undefined },
        keyboardnavigation: {
            getKeyName: (event: KeyboardEvent) => event.key,
            isNavigationKey: (key: string) => ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'BrowserHome', 'Find'].includes(key)
        },
        globalize: { translate: (key: string) => key },
        SubtitleSync: class {
            constructor(owner: unknown) { subtitleSyncCreated(owner); }
            toggle() { return undefined; }
            destroy() { return undefined; }
        },
        setBackdropTransparency: () => undefined,
        ['TRANSPARENCY_LEVEL']: { Full: 1, None: 0 },
        pluginManager: { firstOfType: () => null },
        PluginType: { SyncPlay: 'syncplay' },
        loadModule: (path: string) => {
            if (path.includes('playersettingsmenu')) return settingsImport.promise;
            if (path.includes('playerstats')) return statsImport.promise;
            return actionImport.promise;
        },
        expose: (value: typeof observation) => { observation = value; }
    };
    const observedSource = source.slice(0, source.lastIndexOf('}')) + `
        expose({
            audio: () => showAudioTrackSelection.call(view.querySelector('.btnAudio')),
            subtitles: () => showSubtitleTrackSelection.call(view.querySelector('.btnSubtitles')),
            settings: () => onSettingsButtonClick.call(view.querySelector('.btnVideoOsdSettings')),
            hide: hideOsd,
            replace: bindToPlayer,
            release: releaseCurrentPlayer,
            resetIdle,
            startTimer: startOsdHideTimer
        });
    }`;
    // The evaluated source is this checked-out controller, never external data.
    // eslint-disable-next-line sonarjs/code-eval
    const build = new Function(...Object.keys(deps), observedSource);
    build(...Object.values(deps)).call({}, view);
    view.dispatchEvent(new Event('viewshow'));
    return {
        view, firstPlayer, observation, actionImport, settingsImport, settingsShow, statsImport, statsCreated, subtitleSyncCreated,
        audioSelection, subtitleSelection, secondarySelection,
        setCurrentAudioIndex: (index: number) => { audioIndex = index; },
        setCurrentSubtitleIndex: (index: number) => { subtitleIndex = index; },
        changeItem: () => { currentItem = { Id: 'movie-b', ServerId: 'server-a' }; },
        playbackError: () => Events.trigger(manager, 'playbackerror', ['NoCompatibleStream']),
        replace: () => {
            player = { id: 'replacement' };
            observation.replace(player);
        }
    };
}

function selectedMenuIds() {
    const sheet = document.querySelector('.actionSheet.opened');
    expect(sheet).not.toBeNull();
    runPtvIconEngine(sheet!);
    const icons = Array.from(sheet!.querySelectorAll('.actionSheetMenuItem .ptv-icon'));
    expect(icons.every(icon => icon.getAttribute('class') === 'ptv-icon')).toBe(true);
    return icons
        .filter(icon => (icon as HTMLElement).style.visibility !== 'hidden')
        .map(icon => icon.closest('[data-id]')!.getAttribute('data-id'));
}

describe('native video transient menu callers', () => {
    let controller: ReturnType<typeof createController>;
    beforeEach(() => {
        vi.useFakeTimers();
        controller = createController();
    });
    afterEach(() => {
        controller.view.dispatchEvent(new Event('viewbeforehide'));
        controller.view.dispatchEvent(new Event('viewdestroy'));
        document.documentElement.classList.remove('ptv-playing', 'ptv-player-osd-visible');
        document.body.innerHTML = '';
        vi.useRealTimers();
    });

    it.each(['audio', 'subtitles'] as const)('does not reopen %s after hide during its import', async menu => {
        void controller.observation[menu]();
        controller.observation.hide();
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        expect(document.querySelector('.actionSheet.opened')).toBeNull();
    });

    it('captures settings player before import and refuses a replacement player', async () => {
        void controller.observation.settings();
        controller.replace();
        controller.settingsImport.resolve({ show: controller.settingsShow });
        await flush();
        expect(controller.settingsShow).not.toHaveBeenCalled();
    });

    it('retires pending menus even when the viewhide event arrives without viewbeforehide', async () => {
        void controller.observation.audio();
        controller.view.dispatchEvent(new Event('viewhide'));
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        expect(document.querySelector('.actionSheet.opened')).toBeNull();
    });

    it('rejects a cached view import after a replacement visibility owner takes over', async () => {
        void controller.observation.audio();
        const replacement = videoInputOwnership.registerPtvVideoControlsVisibilityHandler('jellyfin-video-controller', vi.fn());
        try {
            controller.actionImport.resolve({ default: actionSheet });
            await flush();
            expect(document.querySelector('.actionSheet.opened')).toBeNull();
        } finally {
            replacement.release();
        }
    });

    it('closes an existing cached-view sheet immediately when the visibility owner is replaced', async () => {
        void controller.observation.audio();
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        const replacement = videoInputOwnership.registerPtvVideoControlsVisibilityHandler('jellyfin-video-controller', vi.fn());
        try {
            expect(document.querySelector('.actionSheet.opened')).toBeNull();
        } finally {
            replacement.release();
        }
    });

    it('does not revive an old operation when a cached view is shown again without hide', async () => {
        void controller.observation.audio();
        controller.view.dispatchEvent(new Event('viewshow'));
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        expect(document.querySelector('.actionSheet.opened')).toBeNull();
    });

    it('rejects a pending import when PTV presentation has already hidden the controls', async () => {
        void controller.observation.audio();
        document.documentElement.classList.add('ptv-playing');
        document.documentElement.classList.remove('ptv-player-osd-visible');
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        expect(document.querySelector('.actionSheet.opened')).toBeNull();
    });

    it.each(['pending', 'open'])('retires a %s menu on the actual playback-error event before stop', async state => {
        void controller.observation.audio();
        if (state === 'open') {
            controller.actionImport.resolve({ default: actionSheet });
            await flush();
        }
        controller.playbackError();
        if (state === 'pending') controller.actionImport.resolve({ default: actionSheet });
        await flush();
        expect(document.querySelector('.actionSheet.opened')).toBeNull();
    });

    it.each(['hide', 'release', 'destroy'] as const)('closes only its owned audio sheet on %s', async retire => {
        void controller.observation.audio();
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        const owned = document.querySelector('.actionSheet.opened');
        expect(owned).not.toBeNull();
        const unrelated = document.createElement('div');
        unrelated.className = 'dialog opened unrelated';
        document.querySelector('.dialogContainer')!.append(unrelated);
        if (retire === 'destroy') controller.view.dispatchEvent(new Event('viewdestroy'));
        else controller.observation[retire]();
        await flush();
        expect(owned!.isConnected).toBe(false);
        expect(unrelated.isConnected).toBe(true);
        expect(controller.audioSelection).not.toHaveBeenCalled();
    });

    it('rejects selection after the same player changes item', async () => {
        void controller.observation.audio();
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        controller.changeItem();
        (document.querySelector('.actionSheet [data-id="1"]') as HTMLElement).click();
        await flush();
        expect(controller.audioSelection).not.toHaveBeenCalled();
    });

    it('does not let the retired audio finally postpone the replacement settings timer', async () => {
        void controller.observation.audio();
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        await vi.advanceTimersByTimeAsync(1000);
        void controller.observation.settings();
        await flush();
        await vi.advanceTimersByTimeAsync(2000);
        expect(controller.view.querySelector('.videoOsdBottom')!.classList.contains('videoOsdBottom-hidden')).toBe(true);
        controller.settingsImport.resolve({ show: controller.settingsShow });
        await flush();
        expect(controller.settingsShow).not.toHaveBeenCalled();
    });

    it('keeps the settings lease through its async stats child and rejects its late import', async () => {
        controller.settingsShow.mockImplementationOnce(options => Promise.resolve(options.onOption('stats')));
        const task = controller.observation.settings();
        controller.settingsImport.resolve({ show: controller.settingsShow });
        await flush();
        controller.replace();
        controller.statsImport.resolve({ default: class {
            constructor(options: unknown) { controller.statsCreated(options); }
        } });
        await task;
        expect(controller.statsCreated).not.toHaveBeenCalled();
    });

    it.each(['audio', 'subtitles'] as const)('preserves a current %s selection for the captured player', async menu => {
        const task = controller.observation[menu]();
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        const selected = menu === 'audio' ? '1' : '-1';
        (document.querySelector('[data-id="' + selected + '"]') as HTMLElement).click();
        await task;
        const setter = menu === 'audio' ? controller.audioSelection : controller.subtitleSelection;
        expect(setter).toHaveBeenCalledExactlyOnceWith(menu === 'audio' ? 1 : -1, controller.firstPlayer);
    });

    it('tracks exactly one subtitle choice through Off, A, B, Off and menu reopen', async () => {
        controller.setCurrentSubtitleIndex(-1);
        controller.actionImport.resolve({ default: actionSheet });

        const offTask = controller.observation.subtitles();
        await flush();
        expect(selectedMenuIds()).toEqual(['-1']);
        (document.querySelector('.actionSheet [data-id="2"]') as HTMLElement).click();
        await offTask;
        expect(controller.subtitleSelection).toHaveBeenLastCalledWith(2, controller.firstPlayer);

        const aTask = controller.observation.subtitles();
        await flush();
        expect(selectedMenuIds()).toEqual(['2']);
        (document.querySelector('.actionSheet [data-id="4"]') as HTMLElement).click();
        await aTask;
        expect(controller.subtitleSelection).toHaveBeenLastCalledWith(4, controller.firstPlayer);

        const bTask = controller.observation.subtitles();
        await flush();
        expect(selectedMenuIds()).toEqual(['4']);
        (document.querySelector('.actionSheet [data-id="-1"]') as HTMLElement).click();
        await bTask;
        expect(controller.subtitleSelection).toHaveBeenLastCalledWith(-1, controller.firstPlayer);

        void controller.observation.subtitles();
        await flush();
        expect(selectedMenuIds()).toEqual(['-1']);
    });

    it('tracks the actual audio index through A, B and reopen without selecting unavailable tracks', async () => {
        controller.actionImport.resolve({ default: actionSheet });
        const firstTask = controller.observation.audio();
        await flush();
        expect(selectedMenuIds()).toEqual(['0']);
        (document.querySelector('.actionSheet [data-id="1"]') as HTMLElement).click();
        await firstTask;
        expect(controller.audioSelection).toHaveBeenLastCalledWith(1, controller.firstPlayer);

        const reopenTask = controller.observation.audio();
        await flush();
        expect(selectedMenuIds()).toEqual(['1']);

        (document.querySelector('.actionSheet [data-id="1"]') as HTMLElement).click();
        await reopenTask;
        controller.setCurrentAudioIndex(99);
        void controller.observation.audio();
        await flush();
        expect(selectedMenuIds()).toEqual([]);
    });

    it('does not toggle a replacement subtitle overlay when selecting a track replaces the player', async () => {
        const task = controller.observation.subtitles();
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        controller.subtitleSyncCreated.mockClear();
        controller.subtitleSelection.mockImplementationOnce(() => controller.replace());
        (document.querySelector('[data-id="-1"]') as HTMLElement).click();
        await task;
        expect(controller.subtitleSyncCreated).not.toHaveBeenCalled();
    });

    it('keeps the parent subtitle operation pending until the secondary sheet settles', async () => {
        let settled = false;
        const task = controller.observation.subtitles();
        void Promise.resolve(task).then(() => {
            settled = true;
        });
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        (document.querySelector('[data-id="secondarysubtitle"]') as HTMLElement).click();
        await flush();
        expect(document.querySelector('.actionSheet.opened')).not.toBeNull();
        expect(settled).toBe(false);
        controller.observation.hide();
        await flush();
        expect(document.querySelector('.actionSheet.opened')).toBeNull();
        expect(settled).toBe(true);
        expect(controller.secondarySelection).not.toHaveBeenCalled();
    });

    it('lets an idle sheet hide but defers the existing timer while pointer interaction is held', async () => {
        void controller.observation.audio();
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        const button = document.querySelector('.actionSheet [data-id="1"]') as HTMLElement;
        button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(videoInputOwnership.isPtvVideoControlsInteractionActive()).toBe(true);
        controller.observation.startTimer();
        await vi.advanceTimersByTimeAsync(3000);
        expect(document.querySelector('.actionSheet.opened')).not.toBeNull();
        button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        expect(videoInputOwnership.isPtvVideoControlsInteractionActive()).toBe(false);
        controller.observation.resetIdle();
        await vi.advanceTimersByTimeAsync(3000);
        expect(document.querySelector('.actionSheet.opened')).toBeNull();
    });

    it.each(['ArrowDown', 'Enter', 'Tab'])('defers for held menu %s, then returns to the existing idle timer on keyup', async keyName => {
        void controller.observation.audio();
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        const button = document.querySelector('.actionSheet [data-id="1"]') as HTMLElement;
        button.focus();
        const key = new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true });
        // The focus owner may already have handled the key; controller capture
        // still owns the interaction lifetime without stealing its action.
        key.preventDefault();
        button.dispatchEvent(key);
        expect(videoInputOwnership.isPtvVideoControlsInteractionActive()).toBe(true);
        controller.observation.startTimer();
        await vi.advanceTimersByTimeAsync(3000);
        expect(document.querySelector('.actionSheet.opened')).not.toBeNull();
        button.dispatchEvent(new KeyboardEvent('keyup', { key: keyName, bubbles: true }));
        expect(videoInputOwnership.isPtvVideoControlsInteractionActive()).toBe(false);
        await vi.advanceTimersByTimeAsync(3000);
        expect(document.querySelector('.actionSheet.opened')).toBeNull();
    });

    it.each(['keyboard', 'pointer'] as const)('releases lost %s input on window blur and lets the existing timer hide the idle sheet', async input => {
        void controller.observation.audio();
        controller.actionImport.resolve({ default: actionSheet });
        await flush();
        const button = document.querySelector('.actionSheet [data-id="1"]') as HTMLElement;
        button.focus();
        if (input === 'keyboard') {
            const key = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
            key.preventDefault();
            button.dispatchEvent(key);
        } else {
            button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
        expect(videoInputOwnership.isPtvVideoControlsInteractionActive()).toBe(true);
        window.dispatchEvent(new Event('blur'));
        expect(videoInputOwnership.isPtvVideoControlsInteractionActive()).toBe(false);
        await vi.advanceTimersByTimeAsync(3000);
        expect(document.querySelector('.actionSheet.opened')).toBeNull();
    });

    it.each(['touchend', 'touchcancel', 'dragend'])('releases actual outside-view menu interaction on %s', event => {
        const container = document.querySelector('.dialogContainer') as HTMLElement;
        container.dispatchEvent(new Event('touchstart', { bubbles: true }));
        expect(videoInputOwnership.isPtvVideoControlsInteractionActive()).toBe(true);
        container.dispatchEvent(new Event(event, { bubbles: true }));
        expect(videoInputOwnership.isPtvVideoControlsInteractionActive()).toBe(false);
    });
});
