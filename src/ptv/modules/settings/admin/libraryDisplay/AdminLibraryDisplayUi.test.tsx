import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AdminLibraryDisplayServiceError,
    type AdminLibraryDisplaySettings,
    type AdminLibraryDisplaySnapshot
} from './adminLibraryDisplayModel';

/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/naming-convention */

type HookState = ReturnType<typeof libraryDisplayState>;

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

vi.mock('./useAdminLibraryDisplay', () => ({
    useAdminLibraryDisplay: () => uiMocks.state
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

import AdminLibraryDisplayRoute from './AdminLibraryDisplayRoute';
import PtvAdminLibraryDisplayPage from './PtvAdminLibraryDisplayPage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function settings(overrides: Partial<AdminLibraryDisplaySettings> = {}): AdminLibraryDisplaySettings {
    return {
        displayFolderView: false,
        displaySpecialsWithinSeasons: true,
        groupMoviesIntoCollections: true,
        groupSeriesIntoCollections: false,
        includeExternalContentInSuggestions: true,
        useFileCreationTimeForDateAdded: false,
        ...overrides
    };
}

function snapshot(value = settings()): AdminLibraryDisplaySnapshot {
    return {
        metadataConfiguration: {
            UseFileCreationTimeForDateAdded: value.useFileCreationTimeForDateAdded
        },
        serverConfiguration: {},
        settings: value
    };
}

let pendingSaveResolution: ((value: AdminLibraryDisplaySnapshot) => void) | undefined;

function pendingSave(edited: AdminLibraryDisplaySettings) {
    return new Promise<AdminLibraryDisplaySnapshot>(resolve => {
        pendingSaveResolution = () => resolve(snapshot(edited));
    });
}

function libraryDisplayState(overrides: Record<string, unknown> = {}) {
    const value = settings();
    const currentSnapshot = snapshot(value);
    return {
        error: null,
        fetching: false,
        loading: false,
        refetch: vi.fn(async () => currentSnapshot),
        reset: vi.fn(() => value),
        save: vi.fn(async (edited: AdminLibraryDisplaySettings) => snapshot(edited)),
        saving: false,
        settings: value,
        snapshot: currentSnapshot,
        ...overrides
    };
}

function buttonWithText(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('button')).find(button => button.textContent === text);
}

function switchFor(root: ParentNode, label: string) {
    return Array.from(root.querySelectorAll<HTMLInputElement>('input[role="switch"]'))
        .find(input => input.closest('.ptv-admin-library-display-toggle')?.querySelector('strong')?.textContent === label);
}

async function flushAsync() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('PiggieTV native Library Display UI', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        pendingSaveResolution = undefined;
        uiMocks.state = libraryDisplayState();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    function render(children: React.ReactNode = <PtvAdminLibraryDisplayPage />) {
        return act(async () => root.render(
            <MemoryRouter initialEntries={[ '/settings/admin/libraries/display' ]}>
                {children}
            </MemoryRouter>
        ));
    }

    it('renders all six authoritative values in four native sections', async () => {
        await render();

        expect(container.querySelector('h1')?.textContent).toBe('Library Display');
        expect(Array.from(container.querySelectorAll('h2')).map(heading => heading.textContent)).toEqual([
            'Recent & Library Views', 'Episodes', 'Collections', 'Recommendations'
        ]);
        const switches = Array.from(container.querySelectorAll<HTMLInputElement>('input[role="switch"]'));
        expect(switches).toHaveLength(6);
        expect(switches.map(input => input.checked)).toEqual([ false, false, true, true, false, true ]);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('shows restrained skeletons without rendering unchecked controls while loading', async () => {
        uiMocks.state = libraryDisplayState({ loading: true, settings: null, snapshot: null });
        await render();

        expect(container.querySelector('[aria-label="Loading Library Display settings"]')).not.toBeNull();
        expect(container.querySelectorAll('.ptv-admin-library-display-section.is-skeleton')).toHaveLength(4);
        expect(container.querySelectorAll('input[role="switch"]')).toHaveLength(0);
        expect(buttonWithText(container, 'Save Changes')).toBeUndefined();
    });

    it('fails closed on a read error and retries without exposing fake values', async () => {
        const refetch = vi.fn(async () => null);
        uiMocks.state = libraryDisplayState({
            error: new AdminLibraryDisplayServiceError('load-unavailable', 'safe'),
            refetch,
            settings: null,
            snapshot: null
        });
        await render();

        expect(container.textContent).toContain("Library Display settings couldn't be loaded.");
        expect(container.querySelectorAll('input[role="switch"]')).toHaveLength(0);
        expect(buttonWithText(container, 'Save Changes')).toBeUndefined();
        await act(async () => buttonWithText(container, 'Retry')?.click());
        expect(refetch).toHaveBeenCalledOnce();
    });

    it('tracks dirty state, resets edits, and disables Save when a value returns to baseline', async () => {
        await render();
        const folderView = switchFor(container, 'Display a folder view');

        await act(async () => folderView?.click());
        expect(folderView?.checked).toBe(true);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);
        expect(buttonWithText(container, 'Reset Changes')?.disabled).toBe(false);
        expect(uiMocks.prompt).toHaveBeenLastCalledWith(expect.objectContaining({ when: true }));

        await act(async () => folderView?.click());
        expect(folderView?.checked).toBe(false);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);

        await act(async () => folderView?.click());
        await act(async () => buttonWithText(container, 'Reset Changes')?.click());
        expect(folderView?.checked).toBe(false);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('protects browser unload while dirty and removes the listener after reset', async () => {
        await render();
        const folderView = switchFor(container, 'Display a folder view');
        await act(async () => folderView?.click());

        const dirtyEvent = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(dirtyEvent);
        expect(dirtyEvent.defaultPrevented).toBe(true);

        await act(async () => buttonWithText(container, 'Reset Changes')?.click());
        const cleanEvent = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(cleanEvent);
        expect(cleanEvent.defaultPrevented).toBe(false);
    });

    it('keeps unsaved edits when background data changes and blocks save until reload', async () => {
        await render();
        const folderView = switchFor(container, 'Display a folder view');
        await act(async () => folderView?.click());

        uiMocks.state = libraryDisplayState({ settings: settings({ groupSeriesIntoCollections: true }) });
        await render();

        expect(switchFor(container, 'Display a folder view')?.checked).toBe(true);
        expect(container.textContent).toContain('These settings changed on the server while you were editing.');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('ignores equivalent cache recreation and adopts its own saved publication without conflict', async () => {
        await render();
        await act(async () => switchFor(container, 'Display a folder view')?.click());

        uiMocks.state = libraryDisplayState({ settings: settings() });
        await render();
        expect(switchFor(container, 'Display a folder view')?.checked).toBe(true);
        expect(container.textContent).not.toContain(
            'These settings changed on the server while you were editing.'
        );

        uiMocks.state = libraryDisplayState({
            settings: settings({ displayFolderView: true })
        });
        await render();
        expect(switchFor(container, 'Display a folder view')?.checked).toBe(true);
        expect(container.textContent).not.toContain(
            'These settings changed on the server while you were editing.'
        );
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('saves once with the edited and confirmed snapshots, then clears dirty state', async () => {
        const save = vi.fn(pendingSave);
        uiMocks.state = libraryDisplayState({ save });
        await render();
        await act(async () => switchFor(container, 'Display a folder view')?.click());

        const saveButton = buttonWithText(container, 'Save Changes');
        await act(async () => {
            saveButton?.click();
            saveButton?.click();
            await Promise.resolve();
        });
        expect(save).toHaveBeenCalledOnce();
        expect(save).toHaveBeenCalledWith(
            settings({ displayFolderView: true }),
            settings()
        );

        pendingSaveResolution?.(snapshot(settings({ displayFolderView: true })));
        await flushAsync();
        expect(container.textContent).toContain('Library display settings saved.');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('keeps edits visible after save failure and requires reload after a conflict', async () => {
        const save = vi.fn().mockRejectedValueOnce(
            new AdminLibraryDisplayServiceError('save-failed', 'sanitized')
        );
        uiMocks.state = libraryDisplayState({ save });
        await render();
        await act(async () => switchFor(container, 'Display a folder view')?.click());
        await act(async () => { buttonWithText(container, 'Save Changes')?.click(); await Promise.resolve(); });
        await flushAsync();

        expect(switchFor(container, 'Display a folder view')?.checked).toBe(true);
        expect(container.textContent).toContain("We couldn't save Library Display settings.");
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);

        save.mockRejectedValueOnce(new AdminLibraryDisplayServiceError('conflict', 'sanitized'));
        await act(async () => { buttonWithText(container, 'Save Changes')?.click(); await Promise.resolve(); });
        await flushAsync();
        expect(container.textContent).toContain('These settings changed on the server while you were editing.');
        expect(switchFor(container, 'Display a folder view')?.checked).toBe(true);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('reports uncertain successful writes accurately and keeps the page usable', async () => {
        const save = vi.fn().mockRejectedValue(
            new AdminLibraryDisplayServiceError(
                'save-unverified',
                'Library Display settings were saved, but the latest server values could not be verified. Reload before saving again.'
            )
        );
        uiMocks.state = libraryDisplayState({ save });
        await render();
        await act(async () => switchFor(container, 'Display a folder view')?.click());
        await act(async () => {
            buttonWithText(container, 'Save Changes')?.click();
            await Promise.resolve();
        });
        await flushAsync();

        expect(container.textContent).toContain(
            'Library Display settings were saved, but the latest server values could not be verified.'
        );
        expect(switchFor(container, 'Display a folder view')?.checked).toBe(true);
        expect(switchFor(container, 'Display a folder view')?.disabled).toBe(false);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);
    });

    it('resets the shared settings scroll container on a direct native route', async () => {
        const page = document.createElement('div');
        page.id = 'ptvSettingsPage';
        page.scrollTop = 420;
        document.body.append(page);
        await render(<AdminLibraryDisplayRoute />);

        expect(page.scrollTop).toBe(0);
        page.remove();
    });
});

/* eslint-enable @stylistic/max-statements-per-line, @typescript-eslint/naming-convention */
