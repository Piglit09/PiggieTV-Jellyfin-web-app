import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AdminNfoServiceError,
    type AdminNfoSettings,
    type AdminNfoSnapshot
} from './adminNfoModel';

/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/naming-convention */

type HookState = ReturnType<typeof nfoState>;

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

vi.mock('./useAdminNfo', () => ({
    useAdminNfo: () => uiMocks.state
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

import AdminNfoRoute from './AdminNfoRoute';
import PtvAdminNfoPage from './PtvAdminNfoPage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function settings(overrides: Partial<AdminNfoSettings> = {}): AdminNfoSettings {
    return {
        enableExtraThumbsDuplication: true,
        enablePathSubstitution: false,
        saveImagePathsInNfo: true,
        userId: 'user-a',
        ...overrides
    };
}

function snapshot(value = settings()): AdminNfoSnapshot {
    return {
        configuration: {
            EnableExtraThumbsDuplication: value.enableExtraThumbsDuplication,
            EnablePathSubstitution: value.enablePathSubstitution,
            ReleaseDateFormat: 'yyyy-MM-dd',
            SaveImagePathsInNfo: value.saveImagePathsInNfo,
            UserId: value.userId
        },
        settings: value
    };
}

function nfoState(overrides: Record<string, unknown> = {}) {
    const value = settings();
    const currentSnapshot = snapshot(value);
    return {
        error: null,
        fetching: false,
        loading: false,
        refetch: vi.fn(async () => currentSnapshot),
        refetchUsers: vi.fn(async () => [
            { id: 'user-a', label: 'Piggie', unavailable: false }
        ]),
        reset: vi.fn(() => value),
        save: vi.fn(async (edited: AdminNfoSettings) => snapshot(edited)),
        saving: false,
        settings: value,
        snapshot: currentSnapshot,
        users: [
            { id: 'user-a', label: 'Piggie', unavailable: false },
            { id: 'user-b', label: 'Reader', unavailable: false }
        ],
        usersError: null,
        usersLoading: false,
        ...overrides
    };
}

function buttonWithText(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('button')).find(button => button.textContent === text);
}

function switchWithId(root: ParentNode, id: string) {
    return root.querySelector<HTMLInputElement>(`input#${id}[role="switch"]`);
}

async function flushAsync() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('PiggieTV native NFO Settings UI', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        uiMocks.state = nfoState();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    function render(children: React.ReactNode = <PtvAdminNfoPage />) {
        return act(async () => root.render(
            <MemoryRouter initialEntries={[ '/settings/admin/libraries/nfo' ]}>
                {children}
            </MemoryRouter>
        ));
    }

    it('renders all four authoritative values in four native groups', async () => {
        await render();

        expect(container.querySelector('h1')?.textContent).toBe('NFO Settings');
        expect(Array.from(container.querySelectorAll('h2')).map(heading => heading.textContent)).toEqual([
            'Watch Data', 'Image References', 'Kodi Compatibility', 'Library Enablement'
        ]);
        expect(container.querySelector<HTMLSelectElement>('#ptv-nfo-user')?.value).toBe('user-a');
        expect(switchWithId(container, 'ptv-nfo-image-paths')?.checked).toBe(true);
        expect(switchWithId(container, 'ptv-nfo-path-substitution')?.checked).toBe(false);
        expect(switchWithId(container, 'ptv-nfo-extra-thumbs')?.checked).toBe(true);
        expect(container.querySelector('a[href="/settings/admin/libraries"]')?.textContent).toContain('Manage Libraries');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('shows restrained skeletons without rendering guessed controls while loading', async () => {
        uiMocks.state = nfoState({ loading: true, settings: null, snapshot: null });
        await render();

        expect(container.querySelector('[aria-label="Loading administration settings"]')).not.toBeNull();
        expect(container.querySelectorAll('select, input[role="switch"]')).toHaveLength(0);
        expect(buttonWithText(container, 'Save Changes')).toBeUndefined();
    });

    it('fails closed on a required read error and retries without exposing fake values', async () => {
        const refetch = vi.fn(async () => null);
        uiMocks.state = nfoState({
            error: new AdminNfoServiceError('load-unavailable', 'safe'),
            refetch,
            settings: null,
            snapshot: null
        });
        await render();

        expect(container.textContent).toContain("NFO settings couldn't be loaded.");
        expect(container.querySelectorAll('select, input[role="switch"]')).toHaveLength(0);
        expect(buttonWithText(container, 'Save Changes')).toBeUndefined();
        await act(async () => buttonWithText(container, 'Retry')?.click());
        expect(refetch).toHaveBeenCalledOnce();
    });

    it('preserves an unavailable user privately while optional-user failure still permits writer saves', async () => {
        const unavailableUserId = 'deleted-user-secret-id';
        const value = settings({ userId: unavailableUserId });
        const save = vi.fn(async (edited: AdminNfoSettings) => snapshot(edited));
        uiMocks.state = nfoState({
            save,
            settings: value,
            snapshot: snapshot(value),
            users: [{ id: unavailableUserId, label: 'Unavailable user', unavailable: true }],
            usersError: new AdminNfoServiceError('users-unavailable', 'safe')
        });
        await render();

        const userSelect = container.querySelector<HTMLSelectElement>('#ptv-nfo-user');
        expect(userSelect?.disabled).toBe(true);
        expect(userSelect?.selectedOptions[0]?.textContent).toBe('Unavailable user (unavailable)');
        expect(container.textContent).not.toContain(unavailableUserId);
        expect(container.textContent).toContain('Writer options can still be saved safely.');

        await act(async () => switchWithId(container, 'ptv-nfo-image-paths')?.click());
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);
        await act(async () => buttonWithText(container, 'Save Changes')?.click());
        await flushAsync();

        expect(save).toHaveBeenCalledWith(
            settings({ saveImagePathsInNfo: false, userId: unavailableUserId }),
            value
        );
        expect(container.textContent).toContain('NFO settings saved.');
    });

    it('tracks dirty state, resets edits, and protects browser unload only while dirty', async () => {
        await render();
        const pathSubstitution = switchWithId(container, 'ptv-nfo-path-substitution');
        await act(async () => pathSubstitution?.click());

        expect(pathSubstitution?.checked).toBe(true);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);
        expect(buttonWithText(container, 'Reset Changes')?.disabled).toBe(false);
        expect(uiMocks.prompt).toHaveBeenLastCalledWith(expect.objectContaining({ when: true }));
        const dirtyEvent = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(dirtyEvent);
        expect(dirtyEvent.defaultPrevented).toBe(true);

        await act(async () => buttonWithText(container, 'Reset Changes')?.click());
        expect(pathSubstitution?.checked).toBe(false);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
        const cleanEvent = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(cleanEvent);
        expect(cleanEvent.defaultPrevented).toBe(false);
    });

    it('single-flights duplicate saves and clears dirty state only after success', async () => {
        let resolveSave: ((value: AdminNfoSnapshot) => void) | undefined;
        const edited = settings({ enablePathSubstitution: true });
        const save = vi.fn(() => new Promise<AdminNfoSnapshot>(resolve => {
            resolveSave = resolve;
        }));
        uiMocks.state = nfoState({ save });
        await render();
        await act(async () => switchWithId(container, 'ptv-nfo-path-substitution')?.click());

        const saveButton = buttonWithText(container, 'Save Changes');
        await act(async () => {
            saveButton?.click();
            saveButton?.click();
            await Promise.resolve();
        });
        expect(save).toHaveBeenCalledOnce();
        expect(save).toHaveBeenCalledWith(edited, settings());

        resolveSave?.(snapshot(edited));
        await flushAsync();
        expect(container.textContent).toContain('NFO settings saved.');
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
    });

    it('keeps edits after failure and requires server reload after conflict', async () => {
        const save = vi.fn().mockRejectedValueOnce(
            new AdminNfoServiceError('save-failed', 'sanitized')
        );
        uiMocks.state = nfoState({ save });
        await render();
        await act(async () => switchWithId(container, 'ptv-nfo-path-substitution')?.click());
        await act(async () => { buttonWithText(container, 'Save Changes')?.click(); await Promise.resolve(); });
        await flushAsync();

        expect(switchWithId(container, 'ptv-nfo-path-substitution')?.checked).toBe(true);
        expect(container.textContent).toContain("We couldn't save NFO settings.");
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(false);

        save.mockRejectedValueOnce(new AdminNfoServiceError('conflict', 'sanitized'));
        await act(async () => { buttonWithText(container, 'Save Changes')?.click(); await Promise.resolve(); });
        await flushAsync();
        expect(container.textContent).toContain('These settings changed on the server while you were editing.');
        expect(switchWithId(container, 'ptv-nfo-path-substitution')?.checked).toBe(true);
        expect(switchWithId(container, 'ptv-nfo-path-substitution')?.disabled).toBe(true);
        expect(buttonWithText(container, 'Save Changes')?.disabled).toBe(true);
        expect(buttonWithText(container, 'Reload server values')).toBeDefined();
    });

    it('resets the shared settings scroll container on a direct native route', async () => {
        const page = document.createElement('div');
        page.id = 'ptvSettingsPage';
        page.scrollTop = 420;
        document.body.append(page);
        await render(<AdminNfoRoute />);

        expect(page.scrollTop).toBe(0);
        page.remove();
    });
});

/* eslint-enable @stylistic/max-statements-per-line, @typescript-eslint/naming-convention */
