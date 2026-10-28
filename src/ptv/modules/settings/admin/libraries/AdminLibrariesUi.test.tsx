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
    AdminLibraryProviderSummary,
    AdminLibrarySummary
} from './adminLibrariesModel';
import { patchAdminLibraryProviders } from './adminLibrariesAdapters';

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
    loadAdminLibraryTransition: vi.fn(),
    loadAdminLibraryDirectory: vi.fn(),
    rebindAdminLibraryTransition: vi.fn(),
    retryAdminLibraryTransitionGeneration: vi.fn(),
    removeAdminLibrary: vi.fn(),
    removeAdminLibraryPath: vi.fn(),
    renameAdminLibrary: vi.fn(),
    startAdminLibrariesScan: vi.fn(),
    startAdminLibraryScan: vi.fn(),
    updateAdminLibraryOptions: vi.fn(),
    updateAdminLibraryProviders: vi.fn(),
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
    ADMIN_LIBRARY_SCAN_OBSERVATION_MS: 20_000,
    useAdminLibraries: () => uiMocks.librariesState,
    useAdminLibrary: () => uiMocks.libraryState,
    useAdminLibraryCreationOptions: () => uiMocks.creationOptionsState
}));

vi.mock('./adminLibrariesService', () => ({
    AdminLibrariesServiceError: uiMocks.AdminLibrariesServiceError,
    addAdminLibraryPath: uiMocks.addAdminLibraryPath,
    createAdminLibrary: uiMocks.createAdminLibrary,
    loadAdminLibraryTransition: uiMocks.loadAdminLibraryTransition,
    loadAdminLibraryDirectory: uiMocks.loadAdminLibraryDirectory,
    rebindAdminLibraryTransition: uiMocks.rebindAdminLibraryTransition,
    retryAdminLibraryTransitionGeneration: uiMocks.retryAdminLibraryTransitionGeneration,
    removeAdminLibrary: uiMocks.removeAdminLibrary,
    removeAdminLibraryPath: uiMocks.removeAdminLibraryPath,
    renameAdminLibrary: uiMocks.renameAdminLibrary,
    startAdminLibrariesScan: uiMocks.startAdminLibrariesScan,
    startAdminLibraryScan: uiMocks.startAdminLibraryScan,
    updateAdminLibraryOptions: uiMocks.updateAdminLibraryOptions,
    updateAdminLibraryProviders: uiMocks.updateAdminLibraryProviders,
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

import AdminLibrariesRoute, { readAdminLibraryId } from './AdminLibrariesRoute';
import { AddAdminLibraryDialog, AdminLibraryFolderPicker } from './AdminLibraryDialogs';
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
        saveLocalMetadata: false,
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
                imageProviders: [
                    { available: true, enabled: true, name: 'TheMovieDb' },
                    { available: true, enabled: false, name: 'Fanart' }
                ],
                mediaType: 'Movie',
                metadataProviders: [
                    { available: true, enabled: true, name: 'TheMovieDb' },
                    { available: true, enabled: false, name: 'Open Movie Database' }
                ]
            }],
            metadataSavers: [{ available: true, enabled: true, name: 'Nfo' }]
        },
        rawOptions: {
            Enabled: true,
            EnableRealtimeMonitor: true,
            MetadataSavers: [ 'Nfo' ],
            SaveLocalMetadata: false,
            TypeOptions: [{
                ImageFetcherOrder: [ 'TheMovieDb', 'Fanart' ],
                ImageFetchers: [ 'TheMovieDb' ],
                MetadataFetcherOrder: [ 'TheMovieDb', 'Open Movie Database' ],
                MetadataFetchers: [ 'TheMovieDb' ],
                Type: 'Movie'
            }]
        },
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
        refreshTransition: vi.fn(async () => undefined),
        scanStatusError: false,
        ...overrides
    };
}

function libraryState(overrides: Record<string, unknown> = {}) {
    return {
        adoptLibrary: vi.fn(async () => undefined),
        beginScanObservation: vi.fn(),
        configuredLocations: [ '/media/movies' ],
        detail: detail(),
        error: false,
        invalidate: vi.fn(async () => undefined),
        loading: false,
        providerError: false,
        providerLoading: false,
        providerOptions: {
            MetadataSavers: [{ DefaultEnabled: true, Name: 'Nfo' }],
            TypeOptions: [{
                ImageFetchers: [
                    { DefaultEnabled: true, Name: 'TheMovieDb' },
                    { DefaultEnabled: false, Name: 'Fanart' }
                ],
                MetadataFetchers: [
                    { DefaultEnabled: true, Name: 'TheMovieDb' },
                    { DefaultEnabled: false, Name: 'Open Movie Database' }
                ],
                Type: 'Movie'
            }]
        } as LibraryOptionsResultDto,
        refetch: vi.fn(async () => undefined),
        refreshTransition: vi.fn(async () => undefined),
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

function buttonContainingText(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('button')).find(button => button.textContent?.includes(text));
}

function sectionWithHeading(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('section')).find(section => (
        section.querySelector(':scope > header h2')?.textContent === text
    ));
}

async function flushAsync() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(promiseResolve => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
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
                ...detail().rawOptions,
                Enabled: true,
                EnableRealtimeMonitor: patch.realTimeMonitoring ?? true,
                SaveLocalMetadata: patch.saveLocalMetadata ?? false
            },
            Name: 'Movies'
        }));
        uiMocks.updateAdminLibraryProviders.mockImplementation((
            _api: Api,
            _libraryId: string,
            providers: AdminLibraryProviderSummary
        ) => Promise.resolve({
            ItemId: 'library-a',
            LibraryOptions: patchAdminLibraryProviders(
                detail().rawOptions!,
                providers,
                detail().providerSummary!
            ),
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
        expect(uiMocks.startAdminLibraryScan).not.toHaveBeenCalled();

        releaseScan?.();
        await flushAsync();
        expect(uiMocks.librariesState.refresh).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('Library scan requested.');
    });

    it('starts exactly the selected library, suppresses duplicate clicks, and reports async acceptance', async () => {
        const pending = deferred<void>();
        uiMocks.startAdminLibraryScan.mockReturnValueOnce(pending.promise);
        await render(<PtvAdminLibraryDetail libraryId='library-a' />, '/settings/admin/libraries/library-a');

        const scan = buttonContainingText(container, 'Scan Library');
        await act(async () => {
            scan?.click();
            scan?.click();
            await Promise.resolve();
        });

        expect(uiMocks.startAdminLibraryScan).toHaveBeenCalledOnce();
        expect(uiMocks.startAdminLibraryScan).toHaveBeenCalledWith(
            expect.anything(),
            'library-a',
            expect.any(AbortSignal)
        );
        expect(buttonContainingText(container, 'Starting…')?.disabled).toBe(true);
        expect(uiMocks.startAdminLibrariesScan).not.toHaveBeenCalled();

        pending.resolve(undefined);
        await flushAsync();

        expect(container.textContent).toContain('Library scan started.');
        expect(container.textContent).toContain('Scan requested');
        expect(buttonContainingText(container, 'Scanning…')?.disabled).toBe(true);
        expect(uiMocks.libraryState.beginScanObservation).toHaveBeenCalledOnce();
        expect(uiMocks.libraryState.invalidate).not.toHaveBeenCalled();

        uiMocks.libraryState = {
            ...uiMocks.libraryState,
            detail: detail({ refreshProgress: 47.4, scanState: 'running' })
        };
        await render(<PtvAdminLibraryDetail libraryId='library-a' />, '/settings/admin/libraries/library-a');
        await flushAsync();
        expect(container.textContent).toContain('Scanning 47%');

        uiMocks.libraryState = {
            ...uiMocks.libraryState,
            detail: detail({ refreshProgress: 100, scanState: 'idle' })
        };
        await render(<PtvAdminLibraryDetail libraryId='library-a' />, '/settings/admin/libraries/library-a');
        await flushAsync();
        expect(container.textContent).not.toContain('Scan requested');
        expect(buttonContainingText(container, 'Scan Library')?.disabled).toBe(false);
    });

    it.each([
        [ 'scan-invalid-request', 'Jellyfin rejected the library identity.', false ],
        [ 'scan-authentication', 'Administrator access is required.', false ],
        [ 'scan-not-found', 'This library no longer exists.', true ],
        [ 'scan-conflict', 'Jellyfin reported a conflicting operation.', false ],
        [ 'scan-server-error', 'Jellyfin returned a server error.', false ],
        [ 'scan-network', 'Jellyfin could not be reached.', false ],
        [ 'scan-timeout', 'Jellyfin did not respond in time.', false ],
        [ 'scan-cancelled', 'The request was cancelled.', false ]
    ])('returns the individual action to a usable %s error state', async (
        code,
        reason,
        shouldInvalidate
    ) => {
        uiMocks.startAdminLibraryScan.mockRejectedValueOnce(
            new uiMocks.AdminLibrariesServiceError(
                code,
                `The library scan could not start. ${reason}`
            )
        );
        await render(<PtvAdminLibraryDetail libraryId='library-a' />, '/settings/admin/libraries/library-a');

        await act(async () => {
            buttonContainingText(container, 'Scan Library')?.click();
            await Promise.resolve();
        });
        await flushAsync();

        expect(container.textContent).toContain(reason);
        expect(container.querySelector('.ptv-admin-library-status-message.is-error')).not.toBeNull();
        expect(container.textContent).not.toContain('Library scan started.');
        expect(buttonContainingText(container, 'Scan Library')?.disabled).toBe(false);
        expect(uiMocks.libraryState.invalidate).toHaveBeenCalledTimes(shouldInvalidate ? 1 : 0);
        expect(uiMocks.libraryState.beginScanObservation).not.toHaveBeenCalled();
        expect(uiMocks.startAdminLibrariesScan).not.toHaveBeenCalled();
    });

    it('bounds a polling failure, marks status unavailable, and keeps the page actionable', async () => {
        uiMocks.libraryState = libraryState({
            detail: detail({ scanState: 'running' }),
            scanStatusError: true
        });
        await render(<PtvAdminLibraryDetail libraryId='library-a' />, '/settings/admin/libraries/library-a');

        expect(container.textContent).toContain('Status unavailable');
        expect(container.textContent).toContain('Current scan status is temporarily unavailable.');
        expect(buttonContainingText(container, 'Scan Library')?.disabled).toBe(false);
    });

    it('disposes the previous library action lifecycle when identity-based navigation changes routes', async () => {
        uiMocks.librariesState = librariesState({
            libraries: [
                summary(),
                summary({ id: 'library-b', name: 'Family Shows' })
            ]
        });
        await render(<AdminLibrariesRoute />, '/settings/admin/libraries/library-a');
        await flushAsync();

        await act(async () => {
            buttonContainingText(container, 'Scan Library')?.click();
            await Promise.resolve();
        });
        await flushAsync();
        expect(container.textContent).toContain('Library scan started.');

        await act(async () => {
            container.querySelector<HTMLAnchorElement>('.ptv-admin-library-detail-back')?.click();
            await Promise.resolve();
        });
        await flushAsync();
        await act(async () => {
            container.querySelector<HTMLAnchorElement>('[aria-label="Manage Family Shows"]')?.click();
            await Promise.resolve();
        });
        await flushAsync();

        expect(container.textContent).not.toContain('Library scan started.');
        expect(uiMocks.startAdminLibraryScan).toHaveBeenCalledOnce();
    });

    it('aborts a pending folder browse when the picker closes', async () => {
        const pending = deferred<{
            entries: [];
            parentPath: string;
            path: string;
        }>();
        uiMocks.loadAdminLibraryDirectory.mockReturnValue(pending.promise);

        await render(
            <AdminLibraryFolderPicker api={api} onCancel={vi.fn()} onSelect={vi.fn()} open />
        );

        expect(container.textContent).toContain('Loading server folders…');
        const signal = uiMocks.loadAdminLibraryDirectory.mock.calls[0][2] as AbortSignal;
        expect(signal.aborted).toBe(false);

        await render(
            <AdminLibraryFolderPicker api={api} onCancel={vi.fn()} onSelect={vi.fn()} open={false} />
        );

        expect(signal.aborted).toBe(true);
        expect(container.textContent).not.toContain('Loading server folders…');
    });

    it('keeps Retry after validation fails and navigates between server drives and a drive root', async () => {
        uiMocks.loadAdminLibraryDirectory
            .mockRejectedValueOnce(new uiMocks.AdminLibrariesServiceError(
                'directory-unavailable',
                'Server folders took too long to load. Try again.'
            ))
            .mockResolvedValueOnce({
                entries: [{ IsDirectory: true, Name: 'Data', Path: 'D:\\' }],
                parentPath: '',
                path: ''
            })
            .mockResolvedValueOnce({
                entries: [],
                parentPath: '',
                path: 'D:\\'
            })
            .mockResolvedValueOnce({
                entries: [{ IsDirectory: true, Name: 'Data', Path: 'D:\\' }],
                parentPath: '',
                path: ''
            });
        uiMocks.validateAdminLibraryPath.mockRejectedValueOnce(new uiMocks.AdminLibrariesServiceError(
            'invalid-path',
            'That server path could not be validated.'
        ));

        await render(
            <AdminLibraryFolderPicker api={api} onCancel={vi.fn()} onSelect={vi.fn()} open />
        );
        await flushAsync();

        expect(container.textContent).toContain('Server folders took too long to load. Try again.');
        expect(container.textContent).not.toContain('No server folders are available.');
        const retry = buttonWithText(container, 'Retry server folders');
        expect(retry).toBeDefined();

        const path = container.querySelector<HTMLInputElement>('input');
        await act(async () => changeInput(path!, 'D:\\Missing'));
        await act(async () => buttonWithText(container, 'Use this folder')?.click());
        await flushAsync();
        expect(container.textContent).toContain('That server path could not be validated.');
        expect(buttonWithText(container, 'Retry server folders')).toBeDefined();

        await act(async () => retry?.click());
        await flushAsync();

        expect(uiMocks.loadAdminLibraryDirectory).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('Data');
        expect(container.textContent).not.toContain('Retry server folders');

        await act(async () => buttonWithText(container, 'Data')?.click());
        await flushAsync();
        expect(container.textContent).toContain('Server drives');

        await act(async () => buttonWithText(container, 'Server drives')?.click());
        await flushAsync();
        expect(uiMocks.loadAdminLibraryDirectory).toHaveBeenLastCalledWith(api, undefined, expect.any(AbortSignal));
        expect(container.textContent).toContain('Data');
    });

    it('uses configured folders immediately when drive browsing is unavailable', async () => {
        uiMocks.loadAdminLibraryDirectory.mockRejectedValue(new uiMocks.AdminLibrariesServiceError(
            'directory-unavailable',
            'Server folders took too long to load. Try again.'
        ));
        const onSelect = vi.fn();

        await render(
            <AdminLibraryFolderPicker
                api={api}
                onCancel={vi.fn()}
                onSelect={onSelect}
                open
                suggestedPaths={[ ' /media/movies ', '/media/movies', '/media/shows' ]}
            />
        );

        expect(uiMocks.loadAdminLibraryDirectory).not.toHaveBeenCalled();
        expect(container.textContent).toContain('Configured library folders');
        expect(container.querySelectorAll('.ptv-admin-library-directory-suggestion')).toHaveLength(2);

        await act(async () => buttonWithText(container, 'Browse all server folders')?.click());
        await flushAsync();

        expect(container.textContent).toContain('Server folders took too long to load. Try again.');
        expect(buttonWithText(container, 'Retry server folders')?.classList.contains(
            'ptv-admin-library-directory-action'
        )).toBe(true);
        expect(buttonWithText(container, '/media/movies')).toBeDefined();

        await act(async () => buttonWithText(container, '/media/movies')?.click());
        const path = container.querySelector<HTMLInputElement>('input');
        expect(path?.value).toBe('/media/movies');
        expect(buttonWithText(container, 'Use this folder')?.disabled).toBe(false);

        await act(async () => buttonWithText(container, 'Use this folder')?.click());
        await flushAsync();
        expect(uiMocks.validateAdminLibraryPath).toHaveBeenCalledWith(api, '/media/movies');
        expect(onSelect).toHaveBeenCalledWith('/media/movies');
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

    it('locks Add Library after an uncertain create outcome even when the form is submitted again', async () => {
        uiMocks.createAdminLibrary.mockRejectedValueOnce(
            new uiMocks.AdminLibrariesServiceError(
                'creation-outcome-uncertain',
                'sensitive backend detail'
            )
        );
        await render(
            <AddAdminLibraryDialog
                api={api}
                apiClient={apiClient}
                onClose={vi.fn()}
                onCreated={vi.fn()}
                open
                suggestedPaths={[ '/media/movies' ]}
            />
        );

        const form = container.querySelector<HTMLFormElement>('#ptv-add-library-form')!;
        const name = form.querySelector<HTMLInputElement>('input[autocomplete="off"]')!;
        await act(async () => changeInput(name, 'Cinema'));
        await act(async () => buttonWithText(container, 'Add Folder')?.click());
        await act(async () => buttonWithText(container, '/media/movies')?.click());
        await act(async () => buttonWithText(container, 'Use this folder')?.click());
        await flushAsync();

        const activeForm = container.querySelector<HTMLFormElement>('#ptv-add-library-form')!;
        await act(async () => activeForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        await flushAsync();

        expect(container.textContent).toContain(
            'Jellyfin may have created this library, but the result could not be confirmed. Review the Libraries list before trying again.'
        );
        expect(buttonWithText(container, 'Create Library')?.disabled).toBe(true);
        await act(async () => activeForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        await flushAsync();
        expect(uiMocks.createAdminLibrary).toHaveBeenCalledOnce();
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

    it('shows unresolved rename authority without adopting the old identity', async () => {
        uiMocks.renameAdminLibrary.mockResolvedValueOnce(null);
        await render(<PtvAdminLibraryDetail libraryId='library-a' />);
        const general = sectionWithHeading(container, 'General')!;
        await act(async () => changeInput(general.querySelector('input')!, 'Films'));
        await act(async () => buttonWithText(general, 'Save name')?.click());
        expect(uiMocks.renameAdminLibrary).toHaveBeenCalledOnce();
        expect(uiMocks.libraryState.adoptLibrary).not.toHaveBeenCalled();
        expect(container.textContent).toContain('Library authority is unresolved');
    });

    it('shows a pending transition on the library list after restart', async () => {
        uiMocks.librariesState = { ...librariesState(), transition: { held: true, operationId: 'operation-a', affectedRuleIds: ['anime'] } } as LibrariesStateMock;
        await render(<PtvAdminLibrariesPage />);
        expect(container.textContent).toContain('Home library rows are held');
        expect(container.textContent).toContain('operation-a');
    });

    it('shows a restored pending transition and affected rules', async () => {
        uiMocks.libraryState = { ...libraryState(), transition: { operationId: 'operation-a', epoch: 'epoch-a', held: true, state: 'pending', affectedRuleIds: ['anime'] } } as LibraryStateMock;
        await render(<PtvAdminLibraryDetail libraryId='library-a' />);
        expect(container.textContent).toContain('Home library rows are held');
        expect(container.textContent).toContain('operation-a');
        expect(container.textContent).toContain('anime');
    });

    it('offers explicit affected-rule and current-folder selection from the libraries list after the old detail disappears', async () => {
        const folderId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        const diagnostic = {
            operationId: 'operation-a', epoch: 'a'.repeat(64), held: true, state: 'pending',
            affectedRuleIds: ['anime', 'movies'], authority: 'binding-required',
            library: { ItemId: folderId, Name: 'Current Movies', CollectionType: 'movies', Locations: ['/local', '/das'] }
        };
        uiMocks.librariesState = librariesState({ libraries: [], transition: diagnostic });
        uiMocks.rebindAdminLibraryTransition.mockResolvedValueOnce({
            ...diagnostic, epoch: 'b'.repeat(64), held: false, state: 'complete',
            authority: 'bound', affectedRuleIds: []
        });
        await render(<PtvAdminLibrariesPage />);

        expect(container.textContent).toContain('Rebind Home rows');
        expect(container.textContent).toContain(folderId);
        expect(container.textContent).toContain('No libraries configured.');
        const submit = buttonWithText(container, 'Confirm Home binding')!;
        expect(submit.disabled).toBe(true);
        const rules = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
            .filter(input => ['anime', 'movies'].includes(input.value));
        const folder = container.querySelector<HTMLInputElement>(`input[type="radio"][value="${folderId}"]`)!;
        expect(rules).toHaveLength(2);
        expect(rules.every(input => !input.checked)).toBe(true);
        expect(folder.checked).toBe(false);
        await act(async () => { rules[0].click(); rules[1].click(); folder.click(); });
        expect(submit.disabled).toBe(false);
        await act(async () => { submit.click(); await Promise.resolve(); });
        await flushAsync();
        expect(uiMocks.rebindAdminLibraryTransition).toHaveBeenCalledWith(expect.anything(), diagnostic, [
            { ruleId: 'anime', libraryId: folderId }, { ruleId: 'movies', libraryId: folderId }
        ]);
        expect(uiMocks.librariesState.refreshTransition).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('Home transition completed');
    });

    it('keeps the rebind entry visible when the old detail route is unavailable', async () => {
        const diagnostic = {
            operationId: 'operation-a', epoch: 'a'.repeat(64), held: true, state: 'pending',
            affectedRuleIds: ['anime'], authority: 'unresolved', library: null
        };
        uiMocks.libraryState = libraryState({ detail: null, error: true, transition: diagnostic });
        await render(<PtvAdminLibraryDetail libraryId='old-folder' />, '/settings/admin/libraries/old-folder');
        expect(container.textContent).toContain('Library unavailable');
        expect(container.textContent).toContain('Rebind Home rows');
        expect(container.textContent).toContain('Current library identity is not verified');
        expect(buttonWithText(container, 'Confirm Home binding')).toBeUndefined();
    });

    it('shows a completed operation that still needs rule binding on the libraries list', async () => {
        const folderId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        const current = {
            operationId: 'operation-a', epoch: 'a'.repeat(64), held: false, state: 'complete',
            affectedRuleIds: ['old-tombstone', 'fresh-rule'], authority: 'binding-required', writeAllowed: false,
            library: { ItemId: folderId, Name: 'Current Anime' }
        };
        uiMocks.librariesState = librariesState({ transition: current });
        uiMocks.rebindAdminLibraryTransition.mockResolvedValueOnce({
            ...current, epoch: 'b'.repeat(64), authority: 'bound', affectedRuleIds: []
        });
        await render(<PtvAdminLibrariesPage />);
        expect(container.textContent).toContain('Rebind Home rows');
        expect(container.querySelector<HTMLInputElement>(`input[value="${folderId}"]`)?.checked).toBe(false);
        const submit = buttonWithText(container, 'Confirm Home binding')!;
        expect(submit.disabled).toBe(true);
        const rules = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
            .filter(input => current.affectedRuleIds.includes(input.value));
        expect(rules.map(rule => rule.value)).toEqual(['old-tombstone', 'fresh-rule']);
        await act(async () => {
            rules[0].click(); rules[1].click();
            container.querySelector<HTMLInputElement>(`input[value="${folderId}"]`)?.click();
        });
        await act(async () => { submit.click(); await Promise.resolve(); });
        expect(uiMocks.rebindAdminLibraryTransition).toHaveBeenCalledWith(expect.anything(), current, [
            { ruleId: 'old-tombstone', libraryId: folderId },
            { ruleId: 'fresh-rule', libraryId: folderId }
        ]);
    });

    it('keeps generation retry reachable from the libraries list when no rule binding is pending', async () => {
        const current = {
            operationId: 'operation-a', epoch: 'a'.repeat(64), held: false, state: 'complete',
            affectedRuleIds: [], authority: 'generation-pending', writeAllowed: false, library: null
        };
        uiMocks.librariesState = librariesState({ libraries: [], transition: current });
        await render(<PtvAdminLibrariesPage />);
        expect(container.textContent).toContain('No libraries configured.');
        expect(container.textContent).toContain('Home generation is pending');
        expect(buttonWithText(container, 'Retry Home generation')).toBeDefined();
        expect(buttonWithText(container, 'Confirm Home binding')).toBeUndefined();
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

    it('lets an administrator choose per-library metadata and image providers', async () => {
        await render(<PtvAdminLibraryDetail libraryId='library-a' />);

        const metadataSection = sectionWithHeading(container, 'Metadata')!;
        const category = (label: string) => Array.from(
            metadataSection.querySelectorAll<HTMLElement>('.ptv-admin-library-provider-category')
        ).find(value => value.querySelector('h3')?.textContent === label)!;
        const provider = (categoryLabel: string, name: string) => Array.from(
            category(categoryLabel).querySelectorAll('label')
        ).find(label => label.textContent?.includes(name))?.querySelector<HTMLInputElement>('input');
        const metadataProvider = provider('Metadata downloaders', 'TheMovieDb');
        const imageProvider = provider('Image providers', 'Fanart');
        const metadataWriter = provider('Metadata writers', 'Nfo');

        expect(metadataProvider?.checked).toBe(true);
        expect(imageProvider?.checked).toBe(false);
        expect(metadataWriter?.checked).toBe(true);
        await act(async () => metadataProvider?.click());
        await act(async () => imageProvider?.click());
        expect(buttonWithText(metadataSection, 'Save providers')?.disabled).toBe(false);
        await act(async () => {
            buttonWithText(metadataSection, 'Save providers')?.click();
            await Promise.resolve();
        });
        await flushAsync();

        expect(uiMocks.updateAdminLibraryProviders).toHaveBeenCalledOnce();
        const [ calledApi, calledId, savedProviders, confirmedProviderBaseline, confirmedOptions ] =
            uiMocks.updateAdminLibraryProviders.mock.calls[0];
        expect(calledApi).toEqual(api);
        expect(calledId).toBe('library-a');
        expect(confirmedProviderBaseline).toEqual(detail().providerSummary);
        expect(confirmedOptions).toEqual(detail().rawOptions);
        expect(savedProviders).toMatchObject({
            groups: [{
                imageProviders: [
                    { enabled: true, name: 'TheMovieDb' },
                    { enabled: true, name: 'Fanart' }
                ],
                mediaType: 'Movie',
                metadataProviders: [
                    { enabled: false, name: 'TheMovieDb' },
                    { enabled: false, name: 'Open Movie Database' }
                ]
            }],
            metadataSavers: [{ enabled: true, name: 'Nfo' }]
        });
        expect(uiMocks.libraryState.adoptLibrary).toHaveBeenCalledOnce();
    });

    it('keeps a configured unavailable provider reversible before saving', async () => {
        const libraryDetail = detail();
        const providerGroup = libraryDetail.providerSummary!.groups[0];
        uiMocks.libraryState = libraryState({
            detail: {
                ...libraryDetail,
                providerSummary: {
                    ...libraryDetail.providerSummary!,
                    groups: [{
                        ...providerGroup,
                        imageProviders: [
                            ...providerGroup.imageProviders,
                            { available: false, enabled: true, name: 'Legacy Artwork' },
                            { available: false, enabled: false, name: 'Removed Artwork' }
                        ]
                    }]
                }
            }
        });
        await render(<PtvAdminLibraryDetail libraryId='library-a' />);

        const metadataSection = sectionWithHeading(container, 'Metadata')!;
        const configuredUnavailable = Array.from(metadataSection.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Legacy Artwork'))
            ?.querySelector<HTMLInputElement>('input');
        const neverConfiguredUnavailable = Array.from(metadataSection.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Removed Artwork'))
            ?.querySelector<HTMLInputElement>('input');

        expect(configuredUnavailable?.checked).toBe(true);
        expect(configuredUnavailable?.disabled).toBe(false);
        expect(neverConfiguredUnavailable?.checked).toBe(false);
        expect(neverConfiguredUnavailable?.disabled).toBe(true);
        await act(async () => configuredUnavailable?.click());
        expect(configuredUnavailable?.checked).toBe(false);
        expect(configuredUnavailable?.disabled).toBe(false);
        await act(async () => configuredUnavailable?.click());
        expect(configuredUnavailable?.checked).toBe(true);
        expect(buttonWithText(metadataSection, 'Save providers')?.disabled).toBe(true);
    });

    it('locks provider edits while an option save is in flight', async () => {
        const pendingSave = deferred<{
            ItemId: string;
            LibraryOptions: NonNullable<AdminLibraryDetail['rawOptions']>;
            Name: string;
        }>();
        uiMocks.updateAdminLibraryOptions.mockReturnValueOnce(pendingSave.promise);
        await render(<PtvAdminLibraryDetail libraryId='library-a' />);

        const behaviorSection = sectionWithHeading(container, 'Library Behavior')!;
        const metadataSection = sectionWithHeading(container, 'Metadata')!;
        const imageSection = sectionWithHeading(container, 'Images & Extraction')!;
        const monitor = Array.from(behaviorSection.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Watch folders for new media'))
            ?.querySelector<HTMLInputElement>('input');
        const imageProvider = Array.from(metadataSection.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Fanart'))
            ?.querySelector<HTMLInputElement>('input');
        const mediaFolders = Array.from(imageSection.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Media folders'))
            ?.querySelector<HTMLInputElement>('input');

        await act(async () => monitor?.click());
        await act(async () => {
            buttonWithText(behaviorSection, 'Save changes')?.click();
            await Promise.resolve();
        });

        expect(uiMocks.updateAdminLibraryOptions).toHaveBeenCalledOnce();
        expect(monitor?.matches(':disabled')).toBe(true);
        expect(imageProvider?.matches(':disabled')).toBe(true);
        expect(mediaFolders?.matches(':disabled')).toBe(true);
        await act(async () => imageProvider?.click());
        expect(imageProvider?.checked).toBe(false);

        pendingSave.resolve({
            ItemId: 'library-a',
            LibraryOptions: {
                ...detail().rawOptions!,
                EnableRealtimeMonitor: false
            },
            Name: 'Movies'
        });
        await flushAsync();

        expect(imageProvider?.matches(':disabled')).toBe(false);
        await act(async () => imageProvider?.click());
        expect(imageProvider?.checked).toBe(true);
        expect(buttonWithText(metadataSection, 'Save providers')?.disabled).toBe(false);
    });

    it('locks option edits while a provider save is in flight', async () => {
        const pendingSave = deferred<{
            ItemId: string;
            LibraryOptions: NonNullable<AdminLibraryDetail['rawOptions']>;
            Name: string;
        }>();
        uiMocks.updateAdminLibraryProviders.mockReturnValueOnce(pendingSave.promise);
        await render(<PtvAdminLibraryDetail libraryId='library-a' />);

        const behaviorSection = sectionWithHeading(container, 'Library Behavior')!;
        const metadataSection = sectionWithHeading(container, 'Metadata')!;
        const imageSection = sectionWithHeading(container, 'Images & Extraction')!;
        const monitor = Array.from(behaviorSection.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Watch folders for new media'))
            ?.querySelector<HTMLInputElement>('input');
        const imageProvider = Array.from(metadataSection.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Fanart'))
            ?.querySelector<HTMLInputElement>('input');
        const mediaFolders = Array.from(imageSection.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Media folders'))
            ?.querySelector<HTMLInputElement>('input');

        await act(async () => imageProvider?.click());
        await act(async () => {
            buttonWithText(metadataSection, 'Save providers')?.click();
            await Promise.resolve();
        });

        expect(uiMocks.updateAdminLibraryProviders).toHaveBeenCalledOnce();
        expect(imageProvider?.matches(':disabled')).toBe(true);
        expect(monitor?.matches(':disabled')).toBe(true);
        expect(mediaFolders?.matches(':disabled')).toBe(true);
        await act(async () => monitor?.click());
        expect(monitor?.checked).toBe(true);

        const submittedProviders = uiMocks.updateAdminLibraryProviders.mock.calls[0][2] as AdminLibraryProviderSummary;
        pendingSave.resolve({
            ItemId: 'library-a',
            LibraryOptions: patchAdminLibraryProviders(
                detail().rawOptions!,
                submittedProviders,
                detail().providerSummary!
            ),
            Name: 'Movies'
        });
        await flushAsync();

        expect(monitor?.matches(':disabled')).toBe(false);
        await act(async () => monitor?.click());
        expect(monitor?.checked).toBe(false);
        expect(buttonWithText(behaviorSection, 'Save changes')?.disabled).toBe(false);
    });

    it('offers Jellyfin-managed or media-folder artwork storage', async () => {
        await render(<PtvAdminLibraryDetail libraryId='library-a' />);

        const imageSection = sectionWithHeading(container, 'Images & Extraction')!;
        const mediaFolders = Array.from(imageSection.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Media folders'))
            ?.querySelector<HTMLInputElement>('input[type="radio"]');
        expect(mediaFolders?.checked).toBe(false);
        expect(imageSection.textContent).toContain('mounted ZFS dataset');
        await act(async () => mediaFolders?.click());
        expect(buttonWithText(imageSection, 'Save changes')?.disabled).toBe(false);
        await act(async () => {
            buttonWithText(imageSection, 'Save changes')?.click();
            await Promise.resolve();
        });
        await flushAsync();

        expect(uiMocks.updateAdminLibraryOptions).toHaveBeenCalledWith(api, 'library-a', {
            saveLocalMetadata: true
        }, options());
        expect(uiMocks.libraryState.adoptLibrary).toHaveBeenCalledWith(expect.objectContaining({
            LibraryOptions: expect.objectContaining({ SaveLocalMetadata: true })
        }));
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
