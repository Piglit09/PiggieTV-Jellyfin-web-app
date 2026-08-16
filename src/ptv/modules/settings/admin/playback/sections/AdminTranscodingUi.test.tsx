import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeAdminTranscodingSettings } from '../adminTranscodingAdapters';
import {
    AdminTranscodingServiceError,
    type AdminTranscodingSettings,
    type AdminTranscodingSnapshot
} from '../adminTranscodingModel';
import { rawTranscodingConfiguration } from '../adminTranscodingTestFixtures';

/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/naming-convention */

type HookState = ReturnType<typeof transcodingState>;

const uiMocks = vi.hoisted(() => ({
    directoryClose: vi.fn(),
    directoryShow: vi.fn(),
    prompt: vi.fn(),
    state: null as unknown as HookState
}));

vi.mock('components/directorybrowser/directorybrowser', () => ({
    default: class MockDirectoryBrowser {
        close() {
            uiMocks.directoryClose();
        }

        show(options: unknown) {
            uiMocks.directoryShow(options);
        }
    }
}));

vi.mock('../../../../../../hooks/useApi', () => ({
    useApi: () => ({
        __legacyApiClient__: { serverId: () => 'server-a' },
        api: {}
    })
}));

vi.mock('../useAdminPlayback', () => ({
    useAdminTranscoding: () => uiMocks.state
}));

vi.mock('../../../../icons/PtvIcon', () => ({
    default: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
}));

vi.mock('react-router-dom', async importOriginal => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        unstable_usePrompt: uiMocks.prompt
    };
});

import AdminTranscodingSection from './AdminTranscodingSection';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function settings(overrides: Partial<AdminTranscodingSettings> = {}): AdminTranscodingSettings {
    return {
        ...normalizeAdminTranscodingSettings(rawTranscodingConfiguration()),
        ...overrides
    };
}

function snapshot(value = settings()): AdminTranscodingSnapshot {
    return {
        configuration: rawTranscodingConfiguration(),
        settings: value
    };
}

function transcodingState(
    value = settings(),
    overrides: Record<string, unknown> = {}
) {
    const currentSnapshot = snapshot(value);
    return {
        error: null,
        fetching: false,
        loading: false,
        refetch: vi.fn(async () => currentSnapshot),
        reset: vi.fn(() => value),
        save: vi.fn(async (edited: AdminTranscodingSettings) => snapshot(edited)),
        saving: false,
        settings: value,
        snapshot: currentSnapshot,
        ...overrides
    };
}

function buttonWithText(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('button')).find(button => button.textContent === text);
}

async function setInputValue(input: HTMLInputElement | null, value: string) {
    if (!input) return;
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function flushAsync() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('PiggieTV native Transcoding UI', () => {
    let container: HTMLDivElement;
    let root: Root;
    const onGuardChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        uiMocks.state = transcodingState();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    function render() {
        return act(async () => root.render(
            <MemoryRouter initialEntries={[ '/settings/admin/playback/transcoding' ]}>
                <AdminTranscodingSection onGuardChange={onGuardChange} />
            </MemoryRouter>
        ));
    }

    it('renders native basic panels and a collapsed advanced group without mutating configuration', async () => {
        const save = vi.fn(async (edited: AdminTranscodingSettings) => snapshot(edited));
        const refetch = vi.fn(async () => snapshot());
        uiMocks.state = transcodingState(settings(), { refetch, save });

        await render();

        expect(container.querySelector('.ptv-admin-playback-section-heading h2')?.textContent)
            .toBe('Transcoding');
        expect(Array.from(container.querySelectorAll('.ptv-admin-configuration-panel h2'))
            .map(heading => heading.textContent)).toEqual([
            'Hardware Acceleration',
            'Encoding',
            'Transcode Storage',
            'Audio & Processing',
            'Throttling & Segments',
            'Tone Mapping'
        ]);
        const advanced = container.querySelector<HTMLDetailsElement>('details');
        expect(advanced?.querySelector('summary')?.textContent).toBe('Advanced Transcoding');
        expect(advanced?.open).toBe(false);
        expect(container.querySelector<HTMLInputElement>('#ptv-transcoding-ffmpeg-path')?.readOnly)
            .toBe(true);
        const summary = container.querySelector('[aria-label="Transcoding summary"]');
        expect(summary?.textContent).toContain('Hardware accelerationNone');
        expect(summary?.textContent).toContain('Transcode pathServer default');
        expect(summary?.textContent).toContain('ThrottleDisabled');
        expect(container.querySelector('#ptv-transcoding-tone-algorithm')).not.toBeNull();
        expect(container.querySelector('#ptv-transcoding-tone-range')).not.toBeNull();
        expect(container.querySelector('#ptv-transcoding-tone-desat')).not.toBeNull();
        expect(container.querySelector('#ptv-transcoding-tone-peak')).not.toBeNull();
        expect(container.querySelector('#ptv-transcoding-tone-param')).not.toBeNull();
        expect(container.querySelector('#ptv-transcoding-tone')).toBeNull();
        expect(container.querySelector('#ptv-transcoding-tone-mode')).toBeNull();
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
        expect(save).not.toHaveBeenCalled();
        expect(refetch).not.toHaveBeenCalled();
    });

    it('uses the shared server directory picker and keeps the selected path as an edit', async () => {
        await render();

        const browse = container.querySelector<HTMLButtonElement>(
            'button[aria-label="Browse for transcoding temporary path"]'
        );
        await act(async () => {
            browse?.click();
            await Promise.resolve();
        });
        await flushAsync();

        expect(uiMocks.directoryShow).toHaveBeenCalledOnce();
        const options = uiMocks.directoryShow.mock.calls[0][0] as {
            callback: (path: string) => void;
            validateWriteable: boolean;
        };
        expect(options.validateWriteable).toBe(true);

        await act(async () => options.callback(String.raw`D:\Piggie Transcodes`));

        expect(container.querySelector<HTMLInputElement>('#ptv-transcoding-temp-path')?.value)
            .toBe(String.raw`D:\Piggie Transcodes`);
        expect(uiMocks.directoryClose).toHaveBeenCalledOnce();
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);
    });

    it('shows the established compatibility warning when hardware acceleration is active', async () => {
        uiMocks.state = transcodingState(settings({ hardwareAccelerationType: 'nvenc' }));

        await render();

        expect(container.textContent).toContain('Verify server drivers before enabling acceleration');
        expect(container.textContent).toContain('can be unstable');
    });

    it('uses skeletons while loading and fails closed with an isolated Retry state', async () => {
        uiMocks.state = transcodingState(settings(), {
            loading: true,
            settings: null,
            snapshot: null
        });
        await render();

        expect(container.querySelector('[aria-label="Loading administration settings"]')).not.toBeNull();
        expect(container.querySelectorAll('input, select')).toHaveLength(0);
        expect(buttonWithText(container, 'Save Changes')).toBeUndefined();

        const refetch = vi.fn(async () => null);
        uiMocks.state = transcodingState(settings(), {
            error: new AdminTranscodingServiceError('load-unavailable', 'safe'),
            loading: false,
            refetch,
            settings: null,
            snapshot: null
        });
        await render();

        expect(container.textContent).toContain("Transcoding settings couldn't be loaded.");
        expect(container.querySelectorAll('input, select')).toHaveLength(0);
        await act(async () => buttonWithText(container, 'Retry')?.click());
        expect(refetch).toHaveBeenCalledOnce();
    });

    it('preserves unknown hardware, preset, and codecs while editing a path and saving', async () => {
        const baseline = settings({
            encoderPreset: 'future-preset',
            hardwareAccelerationType: 'future-hardware',
            hardwareDecodingCodecs: [ 'h264', 'future-codec' ]
        });
        const save = vi.fn(async (edited: AdminTranscodingSettings) => snapshot(edited));
        uiMocks.state = transcodingState(baseline, { save });
        await render();

        const hardware = container.querySelector<HTMLSelectElement>('#ptv-transcoding-hardware');
        const preset = container.querySelector<HTMLSelectElement>('#ptv-transcoding-preset');
        expect(hardware?.value).toBe('future-hardware');
        expect(hardware?.selectedOptions[0]?.textContent).toContain('configured, unavailable');
        expect(preset?.value).toBe('future-preset');
        expect(preset?.selectedOptions[0]?.textContent).toContain('configured');
        const unavailableCodecs = Array.from(container.querySelectorAll<HTMLInputElement>(
            'input[id^="ptv-transcoding-codec-unavailable-"]'
        ));
        expect(unavailableCodecs).toHaveLength(2);
        expect(unavailableCodecs.every(codec => codec.checked && codec.disabled)).toBe(true);

        const tempPath = container.querySelector<HTMLInputElement>('#ptv-transcoding-temp-path');
        await setInputValue(tempPath, String.raw`D:\Piggie Transcodes`);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);
        await act(async () => buttonWithText(container, 'Save Changes')?.click());
        await flushAsync();

        expect(save).toHaveBeenCalledWith(
            expect.objectContaining({
                encoderAppPathDisplay: '/usr/lib/jellyfin-ffmpeg/ffmpeg',
                encoderPreset: 'future-preset',
                hardwareAccelerationType: 'future-hardware',
                hardwareDecodingCodecs: [ 'h264', 'future-codec' ],
                transcodingTempPath: String.raw`D:\Piggie Transcodes`
            }),
            baseline
        );
        expect(container.textContent).toContain('Transcoding settings saved.');
    });

    it('tracks dirty state, resets edits, and retains null path sentinels on unrelated saves', async () => {
        const baseline = settings({ fallbackFontPath: null, transcodingTempPath: null });
        const save = vi.fn(async (edited: AdminTranscodingSettings) => snapshot(edited));
        uiMocks.state = transcodingState(baseline, { save });
        await render();

        const audioVbr = container.querySelector<HTMLInputElement>('#ptv-transcoding-audio-vbr');
        await act(async () => audioVbr?.click());
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);
        expect(uiMocks.prompt).toHaveBeenLastCalledWith(expect.objectContaining({ when: true }));

        await act(async () => buttonWithText(container, 'Save Changes')?.click());
        await flushAsync();
        expect(save).toHaveBeenCalledWith(
            expect.objectContaining({
                enableAudioVbr: true,
                fallbackFontPath: null,
                transcodingTempPath: null
            }),
            baseline
        );

        uiMocks.state = transcodingState(baseline, { save });
        await render();
        await act(async () => container.querySelector<HTMLInputElement>('#ptv-transcoding-audio-vbr')?.click());
        await act(async () => buttonWithText(container, 'Reset Changes')?.click());
        expect(container.querySelector<HTMLInputElement>('#ptv-transcoding-audio-vbr')?.checked)
            .toBe(false);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('keeps edits and locks the form after an authoritative save conflict', async () => {
        const save = vi.fn().mockRejectedValue(
            new AdminTranscodingServiceError('conflict', 'sanitized')
        );
        uiMocks.state = transcodingState(settings(), { save });
        await render();
        await act(async () => container.querySelector<HTMLInputElement>('#ptv-transcoding-audio-vbr')?.click());
        await act(async () => { buttonWithText(container, 'Save Changes')?.click(); await Promise.resolve(); });
        await flushAsync();

        expect(container.textContent).toContain('These settings changed on the server while you were editing.');
        expect(container.querySelector<HTMLInputElement>('#ptv-transcoding-audio-vbr')?.checked)
            .toBe(true);
        expect(container.querySelector<HTMLInputElement>('#ptv-transcoding-audio-vbr')?.disabled)
            .toBe(true);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
        expect(buttonWithText(container, 'Reload server values')).toBeDefined();
    });

    it('blocks Save for invalid numeric ranges and restores the confirmed value on Reset', async () => {
        await render();
        const h264 = container.querySelector<HTMLInputElement>('#ptv-transcoding-h264-crf');
        await setInputValue(h264, '52');

        expect(container.textContent).toContain('Save remains unavailable');
        expect(h264?.getAttribute('aria-invalid')).toBe('true');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);

        await act(async () => buttonWithText(container, 'Reset Changes')?.click());
        expect(container.querySelector<HTMLInputElement>('#ptv-transcoding-h264-crf')?.value)
            .toBe('23');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);

        const h265 = container.querySelector<HTMLInputElement>('#ptv-transcoding-h265-crf');
        await setInputValue(h265, '52');
        expect(h265?.getAttribute('aria-invalid')).toBe('true');
        expect(container.querySelector<HTMLInputElement>('#ptv-transcoding-h264-crf')
            ?.getAttribute('aria-invalid')).toBe('false');
    });

    it('does not treat a read-only FFmpeg runtime-path update as a managed conflict', async () => {
        const baseline = settings();
        await render();
        await act(async () => container.querySelector<HTMLInputElement>('#ptv-transcoding-audio-vbr')?.click());

        uiMocks.state = transcodingState(settings({
            encoderAppPathDisplay: '/fresh/runtime/ffmpeg'
        }));
        await render();

        expect(container.textContent).not.toContain('Reload the latest server values before saving.');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);
        expect(container.querySelector<HTMLInputElement>('#ptv-transcoding-ffmpeg-path')?.readOnly)
            .toBe(true);
        expect(baseline.encoderAppPathDisplay).toBe('/usr/lib/jellyfin-ffmpeg/ffmpeg');
    });
});

/* eslint-enable @stylistic/max-statements-per-line, @typescript-eslint/naming-convention */
