import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pluginApiState = vi.hoisted(() => ({
    client: null as Record<string, ReturnType<typeof vi.fn>> | null
}));
const libraryState = vi.hoisted(() => ({
    folders: [
        {
            CollectionType: 'movies',
            Id: '6b4a947ebdc043789a544c95be2b0e19',
            IsHidden: false,
            Name: 'Renamed Movies'
        },
        {
            CollectionType: 'movies',
            Id: 'db3a60715fb542e790c4efa0e8ab49b5',
            IsHidden: true,
            Name: 'Hidden Movies'
        }
    ]
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => pluginApiState.client,
    getPtvPluginApiDiagnostics: vi.fn(() => ({})),
    getPtvPluginApiResolvedUrl: vi.fn(() => ''),
    normalizePtvApiError: vi.fn((error: unknown) => ({
        code: null,
        kind: 'unknown',
        message: error instanceof Error ? error.message : String(error),
        status: null
    }))
}));
vi.mock('../../api/libraries', () => ({
    getPtvMediaFolders: vi.fn(async (options?: { includeHidden?: boolean }) => {
        const folders = libraryState.folders.filter(folder => options?.includeHidden || !folder.IsHidden);
        return { Items: folders, TotalRecordCount: folders.length };
    })
}));
vi.mock('../settings/admin/configuration/useAdminUnsavedChanges', () => ({ useAdminUnsavedChanges: vi.fn() }));
vi.mock('../cache/featuredContentCache', () => ({
    createFeaturedContentCacheDocumentHydrator: vi.fn(() => vi.fn()),
    createFeaturedContentCacheIdentityGuard: vi.fn(() => () => true),
    getFeaturedContentCacheStatus: vi.fn(() => ({ heroCount: 0, isFresh: false, itemCount: 0, sectionCount: 0, storage: 'none' })),
    getPtvFeaturedRowConfigHash: vi.fn(() => 'test-hash'),
    invalidateFeaturedContentMemoryCache: vi.fn(),
    primeFeaturedContentCacheStatus: vi.fn()
}));
vi.mock('../../api', () => ({
    getPtvCurrentUserId: vi.fn(() => 'test-user'),
    getPtvServerId: vi.fn(() => 'test-server')
}));
vi.mock('../../core/clientProfile', () => ({
    getPtvPerformanceProfile: vi.fn(() => ({ isFireTv: false, isLowPower: false }))
}));
vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: vi.fn(() => false)
}));

import PiggieTvRowsPage from './PiggieTvRowsPage';

const PINNED_ID = '6b4a947ebdc043789a544c95be2b0e19';

function rule(overrides: Record<string, unknown> = {}) {
    return {
        enabled: true,
        generationMode: 'latest',
        id: 'custom-movies',
        itemLimit: 16,
        mediaType: 'movies',
        name: 'Movie shelf',
        rowCount: 1,
        sourceType: 'latest',
        sourceValue: 'movies',
        ...overrides
    };
}

async function flushAsyncWork() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await new Promise(resolve => window.setTimeout(resolve, 0));
    });
}

describe('PiggieTV Home Rows library scope editor', () => {
    let container: HTMLDivElement;
    let root: Root;

    async function mount(settings: Record<string, unknown>) {
        const getRows = vi.fn(async () => settings);
        const saveRows = vi.fn(async (submitted: unknown) => submitted);
        pluginApiState.client = {
            getRows,
            getSettings: vi.fn(async () => ({ rows: settings })),
            saveRows,
            saveSettings: vi.fn(),
            refreshFeaturedContentCacheDocument: vi.fn()
        };
        await act(async () => root.render(<PiggieTvRowsPage />));
        await flushAsyncWork();
        return { saveRows };
    }

    function renameRow(name: string) {
        const label = [...container.querySelectorAll('label')].find(element => element.textContent === 'Row Name');
        const input = document.getElementById(label?.htmlFor || '') as HTMLInputElement;
        expect(input).toBeTruthy();
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, name);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    async function chooseOption(labelText: string, optionText: string, absentOptionText?: string) {
        const label = [...container.querySelectorAll('label')].find(element => element.textContent === labelText);
        const select = document.getElementById(label?.htmlFor || '') as HTMLElement;
        expect(select).toBeTruthy();
        await act(async () => select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
        if (absentOptionText) {
            expect([...document.querySelectorAll('[role="option"]')].some(element => element.textContent === absentOptionText)).toBe(false);
        }
        const option = [...document.querySelectorAll('[role="option"]')].find(element => element.textContent?.includes(optionText)) as HTMLElement;
        expect(option).toBeTruthy();
        await act(async () => option.click());
    }

    async function save() {
        const button = [...container.querySelectorAll('button')].find(element => element.textContent === 'Save Changes');
        expect(button).toBeTruthy();
        await act(async () => button?.click());
        await flushAsyncWork();
    }

    beforeEach(() => {
        Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false);
        pluginApiState.client = null;
        vi.restoreAllMocks();
    });

    it('keeps a built-in row pinned to the same VirtualFolder ID after renaming', async () => {
        const { saveRows } = await mount({
            enabled: true,
            rules: [ rule({
                id: 'latest-movies',
                libraryScope: { mode: 'defaultLibrary', defaultKey: 'movies', virtualFolderId: PINNED_ID }
            }) ],
            schemaVersion: 3
        });

        renameRow('Renamed shelf');
        await save();

        expect(saveRows).toHaveBeenCalledWith(expect.objectContaining({
            schemaVersion: 3,
            rules: [ expect.objectContaining({
                name: 'Renamed shelf',
                libraryScope: { mode: 'defaultLibrary', defaultKey: 'movies', virtualFolderId: PINNED_ID }
            }) ]
        }));
        expect(container.textContent).toContain('Jellyfin library');
        expect(container.textContent).toContain(PINNED_ID);
    });

    it('exports schema-3 scope with the same pinned ID', async () => {
        await mount({
            enabled: true,
            rules: [ rule({ libraryScope: { mode: 'virtualFolder', virtualFolderId: PINNED_ID } }) ],
            schemaVersion: 3
        });
        const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
        const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
        let exported: Blob | null = null;
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (blob: Blob) => {
            exported = blob;
            return 'blob:rows';
        } });
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

        try {
            const button = [...container.querySelectorAll('button')].find(element => element.textContent === 'Export Config');
            await act(async () => button?.click());
            expect(exported).toBeInstanceOf(Blob);
            const text = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsText(exported as Blob);
            });
            expect(JSON.parse(text)).toEqual(expect.objectContaining({
                schemaVersion: 3,
                rules: [ expect.objectContaining({
                    libraryScope: { mode: 'virtualFolder', virtualFolderId: PINNED_ID }
                }) ]
            }));
        } finally {
            if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
            else Reflect.deleteProperty(URL, 'createObjectURL');
            if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
            else Reflect.deleteProperty(URL, 'revokeObjectURL');
        }
    });

    it('migrates a renamed schema-2 built-in by ID and media/source tuple', async () => {
        const { saveRows } = await mount({
            enabled: true,
            rules: [ rule({ id: 'latest-anime', mediaType: 'anime', name: 'My animation shelf', sourceValue: 'anime' }) ],
            schemaVersion: 2
        });

        renameRow('Second title');
        await save();

        expect(saveRows).toHaveBeenCalledWith(expect.objectContaining({
            schemaVersion: 3,
            rules: [ expect.objectContaining({
                libraryScope: { mode: 'defaultLibrary', defaultKey: 'anime' },
                name: 'Second title'
            }) ]
        }));
    });

    it('offers current library IDs for a custom owned row and saves the chosen ID', async () => {
        const { saveRows } = await mount({
            enabled: true,
            rules: [ rule({ libraryScope: { mode: 'global' } }) ],
            schemaVersion: 3
        });

        await chooseOption('Library scope', 'Specific library');
        expect(container.textContent).toMatch(/valid library scope/i);
        await chooseOption('Jellyfin library', `Renamed Movies (movies) — ${PINNED_ID}`);
        await save();

        expect(saveRows).toHaveBeenCalledWith(expect.objectContaining({
            rules: [ expect.objectContaining({ libraryScope: { mode: 'virtualFolder', virtualFolderId: PINNED_ID } }) ]
        }));
    });

    it('offers an exact current ID for a hidden library', async () => {
        const { saveRows } = await mount({
            enabled: true,
            rules: [ rule({ libraryScope: { mode: 'global' } }) ],
            schemaVersion: 3
        });

        await chooseOption('Library scope', 'Specific library');
        await chooseOption('Jellyfin library', 'Hidden Movies (movies) — db3a60715fb542e790c4efa0e8ab49b5');
        await save();

        expect(saveRows).toHaveBeenCalledWith(expect.objectContaining({
            rules: [ expect.objectContaining({
                libraryScope: { mode: 'virtualFolder', virtualFolderId: 'db3a60715fb542e790c4efa0e8ab49b5' }
            }) ]
        }));
    });

    it('blocks saving a schema-3 row with missing ownership instead of treating it as global', async () => {
        const { saveRows } = await mount({
            enabled: true,
            rules: [ rule() ],
            schemaVersion: 3
        });

        renameRow('Unsafe shelf');
        await save();

        expect(container.textContent).toMatch(/library scope/i);
        expect(saveRows).not.toHaveBeenCalled();
    });

    it('blocks a custom owned row whose mixed media type cannot establish library ownership', async () => {
        const { saveRows } = await mount({
            enabled: true,
            rules: [ rule({
                libraryScope: { mode: 'virtualFolder', virtualFolderId: PINNED_ID },
                mediaType: 'mixed'
            }) ],
            schemaVersion: 3
        });

        renameRow('Unsafe mixed shelf');
        await save();

        expect(container.textContent).toMatch(/library scope requires movies, shows, cartoons, anime, or music/i);
        expect(saveRows).not.toHaveBeenCalled();
    });

    it.each([
        [ 'custom rule', { id: 'custom-movies' } ],
        [ 'semantically altered built-in', { id: 'latest-movies', sourceType: 'genre', sourceValue: 'Action' } ]
    ])('withholds pinned defaultLibrary on a %s until explicit VirtualFolder selection', async (_label, overrides) => {
        const { saveRows } = await mount({
            enabled: true,
            rules: [ rule({
                ...overrides,
                libraryScope: { mode: 'defaultLibrary', defaultKey: 'movies', virtualFolderId: PINNED_ID }
            }) ],
            schemaVersion: 3
        });

        renameRow('Reconfigured shelf');
        await save();
        expect(container.textContent).toMatch(/needs a valid library scope/i);
        expect(saveRows).not.toHaveBeenCalled();

        await chooseOption('Library scope', 'Specific library', 'Built-in library');
        await chooseOption('Jellyfin library', `Renamed Movies (movies) — ${PINNED_ID}`);
        await save();
        expect(saveRows).toHaveBeenCalledWith(expect.objectContaining({
            rules: [ expect.objectContaining({
                libraryScope: { mode: 'virtualFolder', virtualFolderId: PINNED_ID }
            }) ]
        }));
    });
});
