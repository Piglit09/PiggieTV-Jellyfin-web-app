import type { Api } from '@jellyfin/sdk';
import type { LibraryOptionsResultDto } from '@jellyfin/sdk/lib/generated-client/models/library-options-result-dto';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from 'jellyfin-apiclient';

/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/naming-convention */

import type {
    AdminLibraryDetail,
    AdminLibraryOptionsForm,
    AdminLibrarySummary
} from './adminLibrariesModel';

type LibrariesStateMock = ReturnType<typeof librariesState>;
type LibraryStateMock = ReturnType<typeof libraryState>;
type CreationOptionsStateMock = ReturnType<typeof creationOptionsState>;

const uiMocks = vi.hoisted(() => ({
    AdminLibrariesServiceError: class AdminLibrariesServiceError extends Error {
        public readonly code: string;

        public constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
    addAdminLibraryPath: vi.fn(),
    createAdminLibrary: vi.fn(),
    creationOptionsState: null as unknown as CreationOptionsStateMock,
    libraryState: null as unknown as LibraryStateMock,
    librariesState: null as unknown as LibrariesStateMock,
    loadAdminLibraryDirectory: vi.fn(),
    removeAdminLibrary: vi.fn(),
    removeAdminLibraryPath: vi.fn(),
    renameAdminLibrary: vi.fn(),
    startAdminLibrariesScan: vi.fn(),
    startAdminLibraryScan: vi.fn(),
    updateAdminLibraryOptions: vi.fn(),
    validateAdminLibraryPath: vi.fn()
}));

vi.mock('../../../../../hooks/useApi', () => ({
    useApi: () => ({
        __legacyApiClient__: { serverId: () => 'server-a' },
        api: {},
        user: { Id: 'admin-a', Policy: { IsAdministrator: true } }
    })
}));

vi.mock('./useAdminLibraries', () => ({
    useAdminLibraries: () => uiMocks.librariesState,
    useAdminLibrary: () => uiMocks.libraryState,
    useAdminLibraryCreationOptions: () => uiMocks.creationOptionsState
}));

vi.mock('./adminLibrariesService', () => ({
    AdminLibrariesServiceError: uiMocks.AdminLibrariesServiceError,
    addAdminLibraryPath: uiMocks.addAdminLibraryPath,
    createAdminLibrary: uiMocks.createAdminLibrary,
    loadAdminLibraryDirectory: uiMocks.loadAdminLibraryDirectory,
    removeAdminLibrary: uiMocks.removeAdminLibrary,
    removeAdminLibraryPath: uiMocks.removeAdminLibraryPath,
    renameAdminLibrary: uiMocks.renameAdminLibrary,
    startAdminLibrariesScan: uiMocks.startAdminLibrariesScan,
    startAdminLibraryScan: uiMocks.startAdminLibraryScan,
    updateAdminLibraryOptions: uiMocks.updateAdminLibraryOptions,
    validateAdminLibraryPath: uiMocks.validateAdminLibraryPath
}));

vi.mock('../../../icons/PtvIcon', () => ({
    default: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
}));

vi.mock('@mui/material/Dialog/Dialog', () => ({
    default: ({ children, open }: Readonly<{ children: React.ReactNode; open: boolean }>) =>
        open ? <div role='dialog'>{children}</div> : null
}));
vi.mock('@mui/material/DialogActions/DialogActions', () => ({
    default: ({ children }: Readonly<{ children: React.ReactNode }>) => <div>{children}</div>
}));
vi.mock('@mui/material/DialogContent/DialogContent', () => ({
    default: ({ children }: Readonly<{ children: React.ReactNode }>) => <div>{children}</div>
}));
vi.mock('@mui/material/DialogTitle/DialogTitle', () => ({
    default: ({ children, id }: Readonly<{ children: React.ReactNode; id?: string }>) => <h2 id={id}>{children}</h2>
}));

vi.mock('../../../../../components/ConfirmDialog', () => ({
    default: ({
        confirmButtonText,
        onCancel,
        onConfirm,
        open,
        title
    }: Readonly<{
        confirmButtonText: string;
        onCancel: () => void;
        onConfirm: () => void;
        open: boolean;
        title: string;
    }>) => open ? (
        <div role='dialog'>
            <h2>{title}</h2>
            <button onClick={onCancel} type='button'>Cancel confirmation</button>
            <button onClick={onConfirm} type='button'>{confirmButtonText}</button>
        </div>
    ) : null
}));

vi.mock('react-router-dom', async importOriginal => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        unstable_usePrompt: vi.fn()
    };
});

import { readAdminLibraryId } from './AdminLibrariesRoute';
import { AddAdminLibraryDialog } from './AdminLibraryDialogs';
import PtvAdminLibrariesPage from './PtvAdminLibrariesPage';
import PtvAdminLibraryDetail from './PtvAdminLibraryDetail';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const api = {} as Api;
const apiClient = { serverId: () => 'server-a' } as unknown as ApiClient;

function options(overrides: Partial<AdminLibraryOptionsForm> = {}): AdminLibraryOptionsForm {
    return {
        automaticallyAddToCollection: false,
        automaticSeriesGrouping: false,
        chapterImages: false,
        chapterImagesDuringScan: false,
        embeddedEpisodeInfo: false,
        embeddedExtrasTitles: false,
        embeddedTitles: false,
        enabled: true,
        lufsAnalysis: false,
        photos: false,
        realTimeMonitoring: true,
        saveTrickplayWithMedia: false,
        trickplayImages: false,
        trickplayImagesDuringScan: false,
        ...overrides
    };
}

function summary(overrides: Partial<AdminLibrarySummary> = {}): AdminLibrarySummary {
    return {
        collectionType: 'movies',
        displayType: 'Movies',
        folderCount: 1,
        icon: 'movies',
        id: 'library-a',
        kind: 'movies',
        locations: [ '/media/movies' ],
        manageable: true,
        name: 'Movies',
        optionsAvailable: true,
        pathManagementSupported: true,
        refreshProgress: null,
        removable: true,
        scanState: 'idle',
        warning: null,
        ...overrides
    };
}

function detail(overrides: Partial<AdminLibraryDetail> = {}): AdminLibraryDetail {
    return {
        ...summary(),
        options: options(),
        providerSummary: {
            groups: [{
                imageProviders: [ 'TheMovieDb' ],
                mediaType: 'Movie',
                metadataProviders: [ 'TheMovieDb' ]
            }],
            metadataSavers: [ 'Nfo' ]
        },
        rawOptions: { Enabled: true, EnableRealtimeMonitor: true },
        ...overrides
    };
}

function librariesState(overrides: Record<string, unknown> = {}) {
    return {
        globalScanTask: null,
        invalidate: vi.fn(async () => undefined),
        isInitialLoading: false,
        isRefreshing: false,
        libraries: [] as AdminLibrarySummary[],
        listError: false,
        refresh: vi.fn(async () => undefined),
        scanStatusError: false,
        ...overrides
    };
}

function libraryState(overrides: Record<string, unknown> = {}) {
    return {
        adoptLibrary: vi.fn(async () => undefined),
        detail: detail(),
        error: false,
        invalidate: vi.fn(async () => undefined),
        loading: false,
        providerError: false,
        providerLoading: false,
        refetch: vi.fn(async () => undefined),
        refetchProviders: vi.fn(async () => undefined),
        removeCachedDetail: vi.fn(),
        scanStatusError: false,
        ...overrides
    };
}

function creationOptionsState(overrides: Record<string, unknown> = {}) {
    return {
        data: {} as LibraryOptionsResultDto,
        isError: false,
        isPending: false,
        refetch: vi.fn(async () => undefined),
        ...overrides
    };
}

function changeInput(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonWithText(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('button')).find(button => button.textContent === text);
}

async function flushAsync() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('PiggieTV administrator libraries UI', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        uiMocks.creationOptionsState = creationOptionsState();
        uiMocks.librariesState = librariesState();
        uiMocks.libraryState = libraryState();
        uiMocks.loadAdminLibraryDirectory.mockResolvedValue({
            entries: [],
            parentPath: '',
            path: '/media/movies'
        });
        uiMocks.validateAdminLibraryPath.mockResolvedValue('/media/movies');
        uiMocks.createAdminLibrary.mockResolvedValue({ ItemId: 'new-library' });
        uiMocks.renameAdminLibrary.mockImplementation((
            _api: Api,
            _libraryId: string,
            newName: string
        ) => Promise.resolve({
            ItemId: 'library-a',
            LibraryOptions: detail().rawOptions,
            Name: newName.trim()
        }));
        uiMocks.updateAdminLibraryOptions.mockImplementation((
            _api: Api,
            _libraryId: string,
            patch: Partial<AdminLibraryOptionsForm>
        ) => Promise.resolve({
            ItemId: 'library-a',
            LibraryOptions: {
                Enabled: true,
                EnableRealtimeMonitor: patch.realTimeMonitoring ?? true
            },
            Name: 'Movies'
        }));
        uiMocks.addAdminLibraryPath.mockResolvedValue(undefined);
        uiMocks.removeAdminLibraryPath.mockResolvedValue(undefined);
        uiMocks.startAdminLibrariesScan.mockResolvedValue(undefined);
        uiMocks.startAdminLibraryScan.mockResolvedValue(undefined);
        uiMocks.removeAdminLibrary.mockResolvedValue(undefined);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    function render(children: React.ReactNode, initialEntry = '/settings/admin/libraries') {
        return act(async () => root.render(
            <MemoryRouter initialEntries={[ initialEntry ]}>{children}</MemoryRouter>
        ));
    }

    it('renders loading, list-error, and empty states without exposing stale rows', async () => {
        uiMocks.librariesState = librariesState({ isInitialLoading: true });
        await render(<PtvAdminLibrariesPage />);
        expect(container.querySelector('[aria-label="Loading libraries"]')).not.toBeNull();
        expect(container.querySelectorAll('.ptv-admin-library-row.is-skeleton')).toHaveLength(5);

        uiMocks.librariesState = librariesState({ listError: true });
        await render(<PtvAdminLibrariesPage />);
        expect(container.textContent).toContain("We couldn't load your libraries.");
        expect(container.querySelectorAll('.ptv-admin-library-row')).toHaveLength(0);

        uiMocks.librariesState = librariesState();
        await render(<PtvAdminLibrariesPage />);
        expect(container.textContent).toContain('No libraries configured.');
        expect(container.textContent).toContain('Add a library to connect media folders');
    });

    it('renders compact rows and filters locally by search and content type', async () => {
        uiMocks.librariesState = librariesState({
            libraries: [
                summary(),
                summary({
                    collectionType: 'tvshows',
                    displayType: 'Shows',
                    icon: 'shows',
                    id: 'library-b',
                    kind: 'shows',
                    name: 'Family Shows'
                }),
                summary({
                    collectionType: 'music',
                    displayType: 'Music',
                    icon: 'music',
                    id: 'library-c',
                    kind: 'music',
                    name: 'Albums'
                })
            ]
        });

        await render(<PtvAdminLibrariesPage />);

        expect(container.querySelectorAll('.ptv-admin-library-row')).toHaveLength(3);
        expect(container.textContent).toContain('3 libraries');
        const search = container.querySelector<HTMLInputElement>('#ptv-admin-library-search');
        await act(async () => changeInput(search!, 'family'));
        expect(container.querySelectorAll('.ptv-admin-library-row')).toHaveLength(1);
        expect(container.textContent).toContain('Family Shows');
        expect(container.textContent).not.toContain('Albums');

        await act(async () => changeInput(search!, ''));
        await act(async () => buttonWithText(container, 'Music')?.click());
        expect(container.querySelectorAll('.ptv-admin-library-row')).toHaveLength(1);
        expect(container.textContent).toContain('Albums');
        expect(container.textContent).not.toContain('Family Shows');
    });

    it('starts a global scan only on an explicit click and suppresses duplicate requests', async () => {
        let releaseScan: (() => void) | undefined;
        const scan = new Promise<void>(resolve => { releaseScan = resolve; });
        uiMocks.startAdminLibrariesScan.mockReturnValue(scan);
        uiMocks.librariesState = librariesState({ libraries: [ summary() ] });
        await render(<PtvAdminLibrariesPage />);

        expect(uiMocks.startAdminLibrariesScan).not.toHaveBeenCalled();
        const button = buttonWithText(container, 'Scan All Libraries');
        await act(async () => {
            button?.click();
            button?.click();
            await Promise.resolve();
        });
        expect(uiMocks.startAdminLibrariesScan).toHaveBeenCalledOnce();

        releaseScan?.();
        await flushAsync();
        expect(uiMocks.librariesState.refresh).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('Library scan requested.');
    });

    it('validates Add Library, deduplicates exact paths, and prevents duplicate creates', async () => {
        let releaseCreate: (() => void) | undefined;
        const create = new Promise<{ ItemId: string }>(resolve => {
            releaseCreate = () => resolve({ ItemId: 'new-library' });
        });
        uiMocks.createAdminLibrary.mockReturnValue(create);
        const onCreated = vi.fn();
        await render(
            <AddAdminLibraryDialog
                api={api}
                apiClient={apiClient}
                onClose={vi.fn()}
                onCreated={onCreated}
                open
            />
        );

        const form = container.querySelector<HTMLFormElement>('#ptv-add-library-form');
        await act(async () => form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(container.textContent).toContain('Enter a library name.');
        expect(uiMocks.createAdminLibrary).not.toHaveBeenCalled();

        const name = form?.querySelector<HTMLInputElement>('input[autocomplete="off"]');
        await act(async () => changeInput(name!, 'Cinema'));
        await act(async () => form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(container.textContent).toContain('Add at least one media folder.');

        for (let index = 0; index < 2; index += 1) {
            await act(async () => buttonWithText(container, 'Add Folder')?.click());
            await flushAsync();
            await act(async () => buttonWithText(container, 'Use this folder')?.click());
            await flushAsync();
        }
        expect(container.querySelectorAll('.ptv-admin-library-path-row')).toHaveLength(1);
        expect(container.textContent).toContain('/media/movies');

        await act(async () => {
            const activeForm = container.querySelector<HTMLFormElement>('#ptv-add-library-form');
            activeForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            activeForm?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await Promise.resolve();
        });
        expect(uiMocks.createAdminLibrary).toHaveBeenCalledOnce();
        expect(uiMocks.createAdminLibrary).toHaveBeenCalledWith(api, {
            collectionType: 'movies',
            locations: [ '/media/movies' ],
            name: 'Cinema'
        }, uiMocks.creationOptionsState.data);

        releaseCreate?.();
        await flushAsync();
        expect(onCreated).toHaveBeenCalledWith('new-library');
    });

    it('fails Add Library closed when authoritative defaults are unavailable', async () => {
        const refetch = vi.fn(async () => undefined);
        uiMocks.creationOptionsState = creationOptionsState({
            data: undefined,
            isError: true,
            refetch
        });
        await render(
            <AddAdminLibraryDialog
                api={api}
                apiClient={apiClient}
                onClose={vi.fn()}
                onCreated={vi.fn()}
                open
            />
        );

        expect(container.textContent).toContain('Library defaults are unavailable. No library can be created.');
        expect(buttonWithText(container, 'Create Library')?.disabled).toBe(true);
        await act(async () => buttonWithText(container, 'Retry defaults')?.click());
        expect(refetch).toHaveBeenCalledOnce();
        expect(uiMocks.createAdminLibrary).not.toHaveBeenCalled();
    });

    it('keeps general, folder, and behavior controls usable when provider context fails', async () => {
        const refetchProviders = vi.fn(async () => undefined);
        uiMocks.libraryState = libraryState({ providerError: true, refetchProviders });
        await render(<PtvAdminLibraryDetail libraryId='library-a' />, '/settings/admin/libraries/library-a');

        for (const heading of [ 'General', 'Library Behavior', 'Folders', 'Metadata', 'Maintenance', 'Danger Zone' ]) {
            expect(container.textContent).toContain(heading);
        }
        expect(container.textContent).toContain('/media/movies');
        expect(container.textContent).toContain('Metadata provider settings are temporarily unavailable.');
        expect(container.textContent).toContain('Watch folders for new media');
        await act(async () => buttonWithText(container, 'Retry providers')?.click());
        expect(refetchProviders).toHaveBeenCalledOnce();
    });

    it('links related global Metadata and NFO settings to their native routes', async () => {
        await render(<PtvAdminLibraryDetail libraryId='library-a' />);

        expect(container.querySelector('a[href="/settings/admin/libraries/metadata"]')?.textContent)
            .toContain('Metadata Settings');
        expect(container.querySelector('a[href="/settings/admin/libraries/nfo"]')?.textContent)
            .toContain('NFO Settings');
        expect(container.querySelector('a[href="/settings/admin/media/metadata-manager"]')?.textContent)
            .toContain('Metadata Manager');
    });

    it('fails option writes closed when authoritative library options are absent', async () => {
        uiMocks.libraryState = libraryState({
            detail: detail({
                options: null,
                optionsAvailable: false,
                providerSummary: null,
                rawOptions: null
            })
        });
        await render(<PtvAdminLibraryDetail libraryId='library-a' />, '/settings/admin/libraries/library-a');

        expect(container.textContent).toContain('Authoritative library options are unavailable. No options can be saved.');
        expect(container.textContent).toContain('Image options are unavailable. No changes can be saved.');
        expect(Array.from(container.querySelectorAll('button')).filter(button => button.textContent === 'Save changes')).toHaveLength(0);
        expect(uiMocks.updateAdminLibraryOptions).not.toHaveBeenCalled();
    });

    it('writes only an explicitly changed option', async () => {
        await render(<PtvAdminLibraryDetail libraryId='library-a' />, '/settings/admin/libraries/library-a');

        const monitor = Array.from(container.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Watch folders for new media'))
            ?.querySelector<HTMLInputElement>('input');
        expect(monitor?.checked).toBe(true);
        await act(async () => monitor?.click());
        expect(uiMocks.updateAdminLibraryOptions).not.toHaveBeenCalled();
        await act(async () => { buttonWithText(container, 'Save changes')?.click(); await Promise.resolve(); });
        await flushAsync();

        expect(uiMocks.updateAdminLibraryOptions).toHaveBeenCalledOnce();
        expect(uiMocks.updateAdminLibraryOptions).toHaveBeenCalledWith(api, 'library-a', {
            realTimeMonitoring: false
        }, options());
        expect(uiMocks.libraryState.adoptLibrary).toHaveBeenCalledWith(expect.objectContaining({
            LibraryOptions: expect.objectContaining({ EnableRealtimeMonitor: false })
        }));
    });

    it('keeps a managed-field conflict visible and blocks repeated option writes', async () => {
        uiMocks.updateAdminLibraryOptions.mockRejectedValueOnce(
            new uiMocks.AdminLibrariesServiceError('conflict', 'sanitized')
        );
        await render(<PtvAdminLibraryDetail libraryId='library-a' />);

        const monitor = Array.from(container.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Watch folders for new media'))
            ?.querySelector<HTMLInputElement>('input');
        await act(async () => monitor?.click());
        await act(async () => {
            buttonWithText(container, 'Save changes')?.click();
            await Promise.resolve();
        });
        await flushAsync();

        expect(container.textContent).toContain('This library changed on the server. Reload it before saving.');
        expect(buttonWithText(container, 'Save changes')?.disabled).toBe(true);
        const enabled = Array.from(container.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Library enabled'))
            ?.querySelector<HTMLInputElement>('input');
        await act(async () => enabled?.click());
        expect(buttonWithText(container, 'Save changes')?.disabled).toBe(true);
        expect(uiMocks.updateAdminLibraryOptions).toHaveBeenCalledOnce();
    });

    it('requires confirmation for removal, honors cancel, and suppresses duplicate deletes', async () => {
        let releaseRemove: (() => void) | undefined;
        const removal = new Promise<void>(resolve => { releaseRemove = resolve; });
        uiMocks.removeAdminLibrary.mockReturnValue(removal);
        await render(<PtvAdminLibraryDetail libraryId='library-a' />, '/settings/admin/libraries/library-a');

        await act(async () => buttonWithText(container, 'Remove Library')?.click());
        expect(container.textContent).toContain('Remove Movies?');
        expect(uiMocks.removeAdminLibrary).not.toHaveBeenCalled();
        await act(async () => buttonWithText(container, 'Cancel confirmation')?.click());
        expect(container.textContent).not.toContain('Remove Movies?');
        expect(uiMocks.removeAdminLibrary).not.toHaveBeenCalled();

        await act(async () => buttonWithText(container, 'Remove Library')?.click());
        const confirm = buttonWithText(container, 'Remove library');
        await act(async () => {
            confirm?.click();
            confirm?.click();
            await Promise.resolve();
        });
        expect(uiMocks.removeAdminLibrary).toHaveBeenCalledOnce();
        expect(uiMocks.removeAdminLibrary).toHaveBeenCalledWith(api, 'library-a', 'Movies');

        releaseRemove?.();
        await flushAsync();
        expect(uiMocks.libraryState.removeCachedDetail).toHaveBeenCalledOnce();
        expect(uiMocks.libraryState.invalidate).toHaveBeenCalledOnce();
    });
});

describe('administrator library route parsing', () => {
    it('returns only a decoded direct library id and safely rejects malformed routes', () => {
        expect(readAdminLibraryId('/settings/admin/libraries')).toBe('');
        expect(readAdminLibraryId('/settings/admin/libraries/')).toBe('');
        expect(readAdminLibraryId('/settings/admin/libraries/library%20a')).toBe('library a');
        expect(readAdminLibraryId('/settings/admin/libraries/library-a/options')).toBe('');
        expect(readAdminLibraryId('/settings/admin/libraries/library%2Fa')).toBe('');
        expect(readAdminLibraryId('/settings/admin/libraries/library%5Ca')).toBe('');
        expect(readAdminLibraryId('/settings/admin/libraries/library%00a')).toBe('');
        expect(readAdminLibraryId('/settings/admin/libraries/display')).toBe('');
        expect(readAdminLibraryId('/settings/admin/libraries/metadata')).toBe('');
        expect(readAdminLibraryId('/settings/admin/libraries/nfo')).toBe('');
        expect(readAdminLibraryId('/settings/admin/library/library-a')).toBe('');
        expect(readAdminLibraryId('/settings/admin/libraries/%E0%A4%A')).toBe('');
    });
});

/* eslint-enable @stylistic/max-statements-per-line, @typescript-eslint/naming-convention */
