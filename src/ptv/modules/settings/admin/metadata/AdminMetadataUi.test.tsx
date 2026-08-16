import { ImageResolution } from '@jellyfin/sdk/lib/generated-client/models/image-resolution';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AdminMetadataServiceError,
    type AdminMetadataCatalogOption,
    type AdminMetadataSettings,
    type AdminMetadataSnapshot
} from './adminMetadataModel';

/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/naming-convention */

type HookState = ReturnType<typeof metadataState>;

const uiMocks = vi.hoisted(() => ({
    prompt: vi.fn(),
    state: null as unknown as HookState
}));

vi.mock('../../../../../hooks/useApi', () => ({
    useApi: () => ({
        __legacyApiClient__: { serverId: () => 'server-a' },
        api: {}
    })
}));

vi.mock('./useAdminMetadata', () => ({
    useAdminMetadata: () => uiMocks.state
}));

vi.mock('../../../icons/PtvIcon', () => ({
    default: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
}));

vi.mock('react-router-dom', async importOriginal => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        unstable_usePrompt: uiMocks.prompt
    };
});

import AdminMetadataRoute from './AdminMetadataRoute';
import PtvAdminMetadataPage from './PtvAdminMetadataPage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function settings(overrides: Partial<AdminMetadataSettings> = {}): AdminMetadataSettings {
    return {
        chapterImageResolution: ImageResolution.P720,
        dummyChapterDurationSeconds: 300,
        preferredCountryCode: 'US',
        preferredLanguage: 'en',
        ...overrides
    };
}

function snapshot(value = settings()): AdminMetadataSnapshot {
    return {
        serverConfiguration: {
            ChapterImageResolution: value.chapterImageResolution,
            DummyChapterDuration: value.dummyChapterDurationSeconds,
            MetadataCountryCode: value.preferredCountryCode,
            PreferredMetadataLanguage: value.preferredLanguage
        },
        settings: value
    };
}

const languages: readonly AdminMetadataCatalogOption[] = [
    { available: true, label: 'English', value: 'en' },
    { available: true, label: 'French', value: 'fr' }
];
const countries: readonly AdminMetadataCatalogOption[] = [
    { available: true, label: 'United States', value: 'US' },
    { available: true, label: 'Canada', value: 'CA' }
];

let pendingSaveResolution: ((value: AdminMetadataSnapshot) => void) | undefined;

function pendingSave(edited: AdminMetadataSettings) {
    return new Promise<AdminMetadataSnapshot>(resolve => {
        pendingSaveResolution = () => resolve(snapshot(edited));
    });
}

function metadataState(overrides: Record<string, unknown> = {}) {
    const value = settings();
    const currentSnapshot = snapshot(value);
    return {
        countries,
        countriesError: null,
        countriesLoading: false,
        error: null,
        fetching: false,
        languages,
        languagesError: null,
        languagesLoading: false,
        loading: false,
        refetch: vi.fn(async () => currentSnapshot),
        refetchCountries: vi.fn(async () => undefined),
        refetchLanguages: vi.fn(async () => undefined),
        reset: vi.fn(() => value),
        save: vi.fn(async (edited: AdminMetadataSettings) => snapshot(edited)),
        saving: false,
        settings: value,
        snapshot: currentSnapshot,
        ...overrides
    };
}

function buttonWithText(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('button')).find(button => button.textContent === text);
}

function selectFor(root: ParentNode, id: string) {
    return root.querySelector<HTMLSelectElement>(`#${id}`);
}

function durationInput(root: ParentNode) {
    return root.querySelector<HTMLInputElement>('#ptv-metadata-chapter-duration');
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

async function setSelectValue(select: HTMLSelectElement | null, value: string) {
    if (!select) return;
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
            HTMLSelectElement.prototype,
            'value'
        )?.set;
        setter?.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

async function flushAsync() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('PiggieTV native Metadata UI', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        pendingSaveResolution = undefined;
        uiMocks.state = metadataState();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    function render(children: React.ReactNode = <PtvAdminMetadataPage />) {
        return act(async () => root.render(
            <MemoryRouter initialEntries={[ '/settings/admin/libraries/metadata' ]}>
                {children}
            </MemoryRouter>
        ));
    }

    it('renders all four authoritative values in the native metadata groups', async () => {
        await render();

        expect(container.querySelector('h1')?.textContent).toBe('Metadata');
        expect(Array.from(container.querySelectorAll('h2')).map(heading => heading.textContent)).toEqual([
            'Language & Region', 'Chapters', 'Library Providers'
        ]);
        expect(selectFor(container, 'ptv-metadata-language')?.value).toBe('en');
        expect(selectFor(container, 'ptv-metadata-country')?.value).toBe('US');
        expect(durationInput(container)?.value).toBe('300');
        expect(selectFor(container, 'ptv-metadata-chapter-resolution')?.value).toBe(ImageResolution.P720);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('shows skeletons without fake controls while authoritative settings load', async () => {
        uiMocks.state = metadataState({ loading: true, settings: null, snapshot: null });
        await render();

        expect(container.querySelector('[aria-label="Loading administration settings"]')).not.toBeNull();
        expect(container.querySelectorAll('select')).toHaveLength(0);
        expect(container.querySelectorAll('input')).toHaveLength(0);
        expect(buttonWithText(container, 'Save Changes')).toBeUndefined();
    });

    it('fails closed on a required-source error and retries without fake values', async () => {
        const refetch = vi.fn(async () => null);
        uiMocks.state = metadataState({
            error: new AdminMetadataServiceError('load-unavailable', 'safe'),
            refetch,
            settings: null,
            snapshot: null
        });
        await render();

        expect(container.textContent).toContain("Metadata settings couldn't be loaded.");
        expect(container.querySelectorAll('select')).toHaveLength(0);
        expect(container.querySelectorAll('input')).toHaveLength(0);
        await act(async () => buttonWithText(container, 'Retry')?.click());
        expect(refetch).toHaveBeenCalledOnce();
    });

    it('degrades catalog failures independently and preserves both configured codes on chapter save', async () => {
        const save = vi.fn(async (edited: AdminMetadataSettings) => snapshot(edited));
        uiMocks.state = metadataState({
            countries: [{ available: false, label: 'US', value: 'US' }],
            countriesError: new AdminMetadataServiceError('countries-unavailable', 'safe'),
            languages: [{ available: false, label: 'en', value: 'en' }],
            languagesError: new AdminMetadataServiceError('cultures-unavailable', 'safe'),
            save
        });
        await render();

        expect(container.textContent).toContain('Language choices are temporarily unavailable.');
        expect(container.textContent).toContain('Country choices are temporarily unavailable.');
        expect(selectFor(container, 'ptv-metadata-language')?.disabled).toBe(true);
        expect(selectFor(container, 'ptv-metadata-country')?.disabled).toBe(true);
        expect(durationInput(container)?.disabled).toBe(false);
        expect(selectFor(container, 'ptv-metadata-chapter-resolution')?.disabled).toBe(false);

        await setInputValue(durationInput(container), '600');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);
        await act(async () => buttonWithText(container, 'Save Changes')?.click());
        await flushAsync();

        expect(save).toHaveBeenCalledWith(
            settings({ dummyChapterDurationSeconds: 600 }),
            settings()
        );
    });

    it('requires a non-negative whole number before enabling Save', async () => {
        await render();
        const input = durationInput(container);

        await setInputValue(input, '-1');
        expect(input?.getAttribute('aria-invalid')).toBe('true');
        expect(container.textContent).toContain('Enter a whole number of seconds, 0 or greater.');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);

        await setInputValue(input, '1.5');
        expect(input?.getAttribute('aria-invalid')).toBe('true');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);

        await setInputValue(input, '0');
        expect(input?.getAttribute('aria-invalid')).toBe('false');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);
    });

    it('tracks dirty state, resets values, and protects browser unload only while dirty', async () => {
        await render();
        const resolution = selectFor(container, 'ptv-metadata-chapter-resolution');
        await setSelectValue(resolution, ImageResolution.P1080);

        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);
        expect(buttonWithText(container, 'Reset Changes')?.disabled).toBe(false);
        expect(uiMocks.prompt).toHaveBeenLastCalledWith(expect.objectContaining({ when: true }));
        const dirtyEvent = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(dirtyEvent);
        expect(dirtyEvent.defaultPrevented).toBe(true);

        await act(async () => buttonWithText(container, 'Reset Changes')?.click());
        expect(resolution?.value).toBe(ImageResolution.P720);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
        const cleanEvent = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(cleanEvent);
        expect(cleanEvent.defaultPrevented).toBe(false);
    });

    it('submits only one save flight and adopts the confirmed response', async () => {
        const save = vi.fn(pendingSave);
        uiMocks.state = metadataState({ save });
        await render();
        await setInputValue(durationInput(container), '600');

        const saveButton = buttonWithText(container, 'Save Changes');
        await act(async () => {
            saveButton?.click();
            saveButton?.click();
            await Promise.resolve();
        });
        expect(save).toHaveBeenCalledOnce();
        expect(save).toHaveBeenCalledWith(
            settings({ dummyChapterDurationSeconds: 600 }),
            settings()
        );

        pendingSaveResolution?.(snapshot(settings({ dummyChapterDurationSeconds: 600 })));
        await flushAsync();
        expect(container.textContent).toContain('Metadata settings saved.');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('keeps edits after a save failure and blocks saving after a conflict', async () => {
        const save = vi.fn().mockRejectedValueOnce(
            new AdminMetadataServiceError('save-failed', 'sanitized')
        );
        uiMocks.state = metadataState({ save });
        await render();
        await setInputValue(durationInput(container), '600');
        await act(async () => { buttonWithText(container, 'Save Changes')?.click(); await Promise.resolve(); });
        await flushAsync();

        expect(durationInput(container)?.value).toBe('600');
        expect(container.textContent).toContain("We couldn't save Metadata settings.");
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);

        save.mockRejectedValueOnce(new AdminMetadataServiceError('conflict', 'sanitized'));
        await act(async () => { buttonWithText(container, 'Save Changes')?.click(); await Promise.resolve(); });
        await flushAsync();
        expect(container.textContent).toContain('These settings changed on the server while you were editing.');
        expect(durationInput(container)?.value).toBe('600');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('resets the shared settings scroll container on the native route', async () => {
        const page = document.createElement('div');
        page.id = 'ptvSettingsPage';
        page.scrollTop = 420;
        document.body.append(page);
        await render(<AdminMetadataRoute />);

        expect(page.scrollTop).toBe(0);
        page.remove();
    });
});

/* eslint-enable @stylistic/max-statements-per-line, @typescript-eslint/naming-convention */
