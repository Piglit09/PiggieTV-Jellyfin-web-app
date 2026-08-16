import { ProcessPriorityClass } from '@jellyfin/sdk/lib/generated-client/models/process-priority-class';
import { TrickplayScanBehavior } from '@jellyfin/sdk/lib/generated-client/models/trickplay-scan-behavior';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminPlaybackSection } from './AdminPlaybackRoute';
import {
    AdminPlaybackServiceError,
    type AdminResumeSettings,
    type AdminStreamingSettings,
    type AdminTrickplaySettings
} from './adminPlaybackSettingsModel';

/* eslint-disable @typescript-eslint/naming-convention */

const uiMocks = vi.hoisted(() => ({
    prompt: vi.fn(),
    resume: {} as Record<string, unknown>,
    streaming: {} as Record<string, unknown>,
    trickplay: {} as Record<string, unknown>
}));

vi.mock('../../../../../hooks/useApi', () => ({
    useApi: () => ({
        __legacyApiClient__: { serverId: () => 'server-a' },
        api: {}
    })
}));

vi.mock('./useAdminPlayback', () => ({
    useAdminResume: () => uiMocks.resume,
    useAdminStreaming: () => uiMocks.streaming,
    useAdminTrickplay: () => uiMocks.trickplay
}));

vi.mock('./sections/AdminTranscodingSection', () => ({
    default: () => <section data-testid='transcoding-stub'>Transcoding</section>
}));

vi.mock('../../../icons/PtvIcon', () => ({
    default: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
}));

vi.mock('@mui/material/Dialog/Dialog', () => ({
    default: ({ children, open }: Readonly<{ children: React.ReactNode; open: boolean }>) => (
        open ? <div role='dialog'>{children}</div> : null
    )
}));
vi.mock('@mui/material/DialogActions/DialogActions', () => ({
    default: ({ children }: Readonly<{ children: React.ReactNode }>) => <div>{children}</div>
}));
vi.mock('@mui/material/DialogContent/DialogContent', () => ({
    default: ({ children }: Readonly<{ children: React.ReactNode }>) => <div>{children}</div>
}));
vi.mock('@mui/material/DialogContentText/DialogContentText', () => ({
    default: ({ children }: Readonly<{ children: React.ReactNode }>) => <p>{children}</p>
}));
vi.mock('@mui/material/DialogTitle/DialogTitle', () => ({
    default: ({ children }: Readonly<{ children: React.ReactNode }>) => <h2>{children}</h2>
}));

vi.mock('react-router-dom', async importOriginal => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        unstable_usePrompt: uiMocks.prompt
    };
});

import PtvAdminPlaybackPage from './PtvAdminPlaybackPage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function streamingSettings(
    overrides: Partial<AdminStreamingSettings> = {}
): AdminStreamingSettings {
    return {
        remoteBitrateLimitBitsPerSecond: 10_000_000,
        ...overrides
    };
}

function resumeSettings(
    overrides: Partial<AdminResumeSettings> = {}
): AdminResumeSettings {
    return {
        audiobookCompletionRemainingMinutes: 5,
        audiobookMinimumElapsedMinutes: 5,
        maximumResumePercentage: 90,
        minimumEligibleDurationSeconds: 300,
        minimumResumePercentage: 5,
        ...overrides
    };
}

function trickplaySettings(
    overrides: Partial<AdminTrickplaySettings> = {}
): AdminTrickplaySettings {
    return {
        enableHardwareDecoding: false,
        enableHardwareEncoding: false,
        enableKeyFrameOnlyExtraction: false,
        imageIntervalMilliseconds: 10_000,
        jpegQuality: 90,
        processPriority: ProcessPriorityClass.BelowNormal,
        processThreads: 1,
        qscale: 4,
        scanBehavior: TrickplayScanBehavior.NonBlocking,
        tileHeight: 10,
        tileWidth: 10,
        widthResolutionsPixels: [ 320 ],
        ...overrides
    };
}

function playbackState<TSettings extends object>(
    value: TSettings,
    overrides: Record<string, unknown> = {}
) {
    const currentSnapshot = { serverConfiguration: {}, settings: value };
    return {
        error: null,
        fetching: false,
        loading: false,
        refetch: vi.fn(async () => currentSnapshot),
        reset: vi.fn(() => value),
        save: vi.fn(async (edited: TSettings) => ({
            serverConfiguration: {},
            settings: edited
        })),
        saving: false,
        settings: value,
        snapshot: currentSnapshot,
        ...overrides
    };
}

function LocationProbe() {
    const location = useLocation();
    return <output data-testid='location'>{location.pathname}</output>;
}

function buttonWithText(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('button'))
        .find(button => button.textContent === text);
}

function tabWithText(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll<HTMLAnchorElement>('[role="tab"]'))
        .find(tab => tab.textContent === text);
}

function input(root: ParentNode, id: string) {
    return root.querySelector<HTMLInputElement>(`#${id}`);
}

function select(root: ParentNode, id: string) {
    return root.querySelector<HTMLSelectElement>(`#${id}`);
}

async function setInputValue(target: HTMLInputElement | null, value: string) {
    if (!target) return;
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        )?.set;
        setter?.call(target, value);
        target.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function flushAsync() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => window.setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

async function pressKey(target: HTMLElement | undefined, key: string) {
    const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key
    });
    await act(async () => target?.dispatchEvent(event));
    return event;
}

describe('PiggieTV native Playback administration UI', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        uiMocks.streaming = playbackState(streamingSettings());
        uiMocks.resume = playbackState(resumeSettings());
        uiMocks.trickplay = playbackState(trickplaySettings());
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    function render(section: AdminPlaybackSection, path = `/settings/admin/playback/${section}`) {
        return act(async () => root.render(
            <MemoryRouter initialEntries={[ path ]}>
                <PtvAdminPlaybackPage section={section} />
                <LocationProbe />
            </MemoryRouter>
        ));
    }

    it.each([
        [ 'streaming', 'streaming' ],
        [ 'resume', 'resume' ],
        [ 'trickplay', 'trickplay' ]
    ] as const)('shows a %s skeleton without fake default controls', async (section, stateKey) => {
        uiMocks[stateKey] = playbackState({}, {
            loading: true,
            settings: null,
            snapshot: null
        });

        await render(section);

        expect(container.querySelector('[aria-label="Loading administration settings"]')).not.toBeNull();
        expect(container.querySelectorAll('input')).toHaveLength(0);
        expect(container.querySelectorAll('select')).toHaveLength(0);
        expect(buttonWithText(container, 'Save Changes')).toBeUndefined();
    });

    it.each([
        [ 'streaming', 'streaming', "Streaming settings couldn't be loaded." ],
        [ 'resume', 'resume', "Resume settings couldn't be loaded." ],
        [ 'trickplay', 'trickplay', "Trickplay settings couldn't be loaded." ]
    ] as const)('shows a friendly %s error and retries without fake controls', async (
        section,
        stateKey,
        message
    ) => {
        const refetch = vi.fn(async () => null);
        uiMocks[stateKey] = playbackState({}, {
            error: new AdminPlaybackServiceError('load-unavailable', 'raw details hidden'),
            refetch,
            settings: null,
            snapshot: null
        });

        await render(section);

        expect(container.textContent).toContain(message);
        expect(container.querySelectorAll('input')).toHaveLength(0);
        expect(container.querySelectorAll('select')).toHaveLength(0);
        await act(async () => buttonWithText(container, 'Retry')?.click());
        expect(refetch).toHaveBeenCalledOnce();
    });

    it('renders the authoritative Streaming limit and Unlimited sentinel wording', async () => {
        await render('streaming');

        expect(input(container, 'ptv-admin-streaming-bitrate')?.value).toBe('10');
        expect(container.textContent).toContain('Enter 0 for unlimited bandwidth.');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('renders every Resume threshold with its authoritative unit', async () => {
        await render('resume');

        expect(input(container, 'ptv-resume-minimum-percent')?.value).toBe('5');
        expect(input(container, 'ptv-resume-maximum-percent')?.value).toBe('90');
        expect(input(container, 'ptv-resume-minimum-duration')?.value).toBe('300');
        expect(input(container, 'ptv-resume-audio-minimum')?.value).toBe('5');
        expect(input(container, 'ptv-resume-audio-completion')?.value).toBe('5');
        expect(container.textContent).toContain('seconds');
        expect(container.textContent).toContain('minutes elapsed');
        expect(container.textContent).toContain('minutes remaining');
    });

    it('renders global Trickplay controls without per-library enablement', async () => {
        await render('trickplay');

        expect(input(container, 'ptv-trickplay-hw-decode')?.checked).toBe(false);
        expect(input(container, 'ptv-trickplay-hw-encode')?.checked).toBe(false);
        expect(select(container, 'ptv-trickplay-scan')?.value).toBe(TrickplayScanBehavior.NonBlocking);
        expect(select(container, 'ptv-trickplay-priority')?.value).toBe(ProcessPriorityClass.BelowNormal);
        expect(input(container, 'ptv-trickplay-interval')?.value).toBe('10000');
        expect(input(container, 'ptv-trickplay-widths')?.value).toBe('320');
        expect(container.textContent).toContain('It does not generate images, scan libraries, or alter per-library enablement.');
    });

    it('tracks and resets a dirty Streaming form without saving', async () => {
        const save = uiMocks.streaming.save as ReturnType<typeof vi.fn>;
        await render('streaming');

        await setInputValue(input(container, 'ptv-admin-streaming-bitrate'), '12.5');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);
        expect(buttonWithText(container, 'Reset Changes')?.disabled).toBe(false);
        expect(uiMocks.prompt).toHaveBeenLastCalledWith(expect.objectContaining({ when: true }));

        await act(async () => buttonWithText(container, 'Reset Changes')?.click());
        expect(input(container, 'ptv-admin-streaming-bitrate')?.value).toBe('10');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
        expect(save).not.toHaveBeenCalled();
    });

    it('saves Resume once with edited and confirmed section models', async () => {
        const save = uiMocks.resume.save as ReturnType<typeof vi.fn>;
        await render('resume');
        await setInputValue(input(container, 'ptv-resume-minimum-duration'), '600');

        await act(async () => {
            buttonWithText(container, 'Save Changes')?.click();
            await Promise.resolve();
        });
        await flushAsync();

        expect(save).toHaveBeenCalledOnce();
        expect(save).toHaveBeenCalledWith(
            resumeSettings({ minimumEligibleDurationSeconds: 600 }),
            resumeSettings()
        );
        expect(container.textContent).toContain('Resume settings saved.');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('rejects impossible Resume min/max values before save', async () => {
        const save = uiMocks.resume.save as ReturnType<typeof vi.fn>;
        await render('resume');

        await setInputValue(input(container, 'ptv-resume-minimum-percent'), '90');

        expect(input(container, 'ptv-resume-maximum-percent')?.getAttribute('aria-invalid')).toBe('true');
        expect(container.textContent).toContain('keep the minimum below the completion point');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
        expect(save).not.toHaveBeenCalled();
    });

    it('rejects out-of-range Trickplay values before save', async () => {
        const save = uiMocks.trickplay.save as ReturnType<typeof vi.fn>;
        await render('trickplay');

        await setInputValue(input(container, 'ptv-trickplay-interval'), '999');

        expect(input(container, 'ptv-trickplay-interval')?.getAttribute('aria-invalid')).toBe('true');
        expect(container.textContent).toContain('Enter a whole number of milliseconds, at least 1,000.');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
        expect(save).not.toHaveBeenCalled();
    });

    it('keeps Trickplay edits visible and blocks Save after a conflict', async () => {
        const save = vi.fn().mockRejectedValue(
            new AdminPlaybackServiceError('conflict', 'sanitized')
        );
        uiMocks.trickplay = playbackState(trickplaySettings(), { save });
        await render('trickplay');
        await setInputValue(input(container, 'ptv-trickplay-interval'), '20000');

        await act(async () => {
            buttonWithText(container, 'Save Changes')?.click();
            await Promise.resolve();
        });
        await flushAsync();

        expect(input(container, 'ptv-trickplay-interval')?.value).toBe('20000');
        expect(container.textContent).toContain('These settings changed on the server while you were editing.');
        expect(buttonWithText(container, 'Reload server values')).not.toBeUndefined();
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('uses route-backed tabs and protects a dirty tab with Keep Editing or Discard', async () => {
        await render('streaming');
        const tabs = Array.from(container.querySelectorAll<HTMLAnchorElement>('[role="tab"]'));
        const tablist = container.querySelector('[role="tablist"]');

        expect(tabs.map(tab => tab.textContent)).toEqual([
            'Streaming', 'Transcoding', 'Resume', 'Trickplay'
        ]);
        expect(tabs.map(tab => tab.getAttribute('href'))).toEqual([
            '/settings/admin/playback/streaming',
            '/settings/admin/playback/transcoding',
            '/settings/admin/playback/resume',
            '/settings/admin/playback/trickplay'
        ]);
        expect(tablist?.getAttribute('aria-label')).toBe('Playback settings');
        expect(tablist?.getAttribute('aria-orientation')).toBe('horizontal');
        expect(tabs.every(tab => Boolean(document.getElementById(
            tab.getAttribute('aria-controls') || ''
        )))).toBe(true);
        expect(tabWithText(container, 'Streaming')?.getAttribute('aria-selected')).toBe('true');
        expect(tabWithText(container, 'Streaming')?.tabIndex).toBe(0);
        expect(tabWithText(container, 'Resume')?.tabIndex).toBe(-1);

        await setInputValue(input(container, 'ptv-admin-streaming-bitrate'), '12.5');
        await act(async () => tabWithText(container, 'Transcoding')?.click());

        let dialog = container.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog?.textContent).toContain('Discard unsaved changes?');
        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/playback/streaming');

        await act(async () => buttonWithText(dialog!, 'Keep Editing')?.click());
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(input(container, 'ptv-admin-streaming-bitrate')?.value).toBe('12.5');

        await act(async () => tabWithText(container, 'Transcoding')?.click());
        dialog = container.querySelector<HTMLElement>('[role="dialog"]');
        await act(async () => buttonWithText(dialog!, 'Discard Changes')?.click());
        await flushAsync();

        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/playback/transcoding');
    });

    it.each([
        [ 'streaming', 'ArrowRight', 'Transcoding', '/settings/admin/playback/transcoding' ],
        [ 'streaming', 'ArrowLeft', 'Trickplay', '/settings/admin/playback/trickplay' ],
        [ 'resume', 'Home', 'Streaming', '/settings/admin/playback/streaming' ],
        [ 'resume', 'End', 'Trickplay', '/settings/admin/playback/trickplay' ]
    ] as const)('uses %s %s navigation to activate the %s route', async (
        section,
        key,
        targetLabel,
        targetPath
    ) => {
        await render(section);
        const activeTab = tabWithText(
            container,
            section[0].toUpperCase() + section.slice(1)
        );
        activeTab?.focus();

        const event = await pressKey(activeTab, key);

        expect(event.defaultPrevented).toBe(true);
        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(targetPath);
        expect(document.activeElement).toBe(tabWithText(container, targetLabel));
    });

    it.each([ 'Enter', ' ' ])('activates a focused route-backed tab with %s', async key => {
        await render('streaming');
        const resumeTab = tabWithText(container, 'Resume');
        resumeTab?.focus();

        const event = await pressKey(resumeTab, key);

        expect(event.defaultPrevented).toBe(true);
        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/playback/resume');
    });

    it('sends keyboard tab navigation through the dirty-section guard', async () => {
        await render('streaming');
        await setInputValue(input(container, 'ptv-admin-streaming-bitrate'), '12.5');
        const streamingTab = tabWithText(container, 'Streaming');
        streamingTab?.focus();

        await pressKey(streamingTab, 'ArrowRight');

        let dialog = container.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog?.textContent).toContain('Discard unsaved changes?');
        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/playback/streaming');
        expect(document.activeElement).toBe(streamingTab);

        await act(async () => buttonWithText(dialog!, 'Keep Editing')?.click());
        expect(input(container, 'ptv-admin-streaming-bitrate')?.value).toBe('12.5');

        await pressKey(streamingTab, 'ArrowRight');
        dialog = container.querySelector<HTMLElement>('[role="dialog"]');
        await act(async () => buttonWithText(dialog!, 'Discard Changes')?.click());
        await flushAsync();

        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/playback/transcoding');
    });

    it('blocks tab discard and navigation while a section save is in flight', async () => {
        let finishSave: ((value: {
            serverConfiguration: Record<string, never>;
            settings: AdminStreamingSettings;
        }) => void) | undefined;
        const save = vi.fn(() => new Promise<{
            serverConfiguration: Record<string, never>;
            settings: AdminStreamingSettings;
        }>(resolve => {
            finishSave = resolve;
        }));
        uiMocks.streaming = playbackState(streamingSettings(), { save });
        await render('streaming');
        await setInputValue(input(container, 'ptv-admin-streaming-bitrate'), '12.5');

        await act(async () => buttonWithText(container, 'Save Changes')?.click());
        await act(async () => tabWithText(container, 'Transcoding')?.click());

        expect(save).toHaveBeenCalledOnce();
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/playback/streaming');

        await act(async () => finishSave?.({
            serverConfiguration: {},
            settings: streamingSettings({ remoteBitrateLimitBitsPerSecond: 12_500_000 })
        }));
        await flushAsync();
        await act(async () => tabWithText(container, 'Transcoding')?.click());

        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/playback/transcoding');
    });
});

/* eslint-enable @typescript-eslint/naming-convention */
