import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ThemeItem = { Id: string; ServerId: string; MediaType: string; playOptions?: Record<string, unknown> };
type PlayOptions = { items: ThemeItem[]; playbackStartGuard?: () => boolean };

const fixture = vi.hoisted(() => {
    const state = {
        currentItem: null as ThemeItem | null,
        deferPlay: false,
        finishPlay: null as (() => void) | null
    };
    const player = { paused: () => !state.currentItem };
    const playbackManager = {
        currentItem: () => state.currentItem,
        getCurrentPlayer: () => state.currentItem ? player : null,
        isPlaying: () => Boolean(state.currentItem),
        play: ({ items, playbackStartGuard }: PlayOptions) => {
            const commit = () => {
                if (playbackStartGuard?.() !== false) state.currentItem = items[0] || null;
            };
            if (state.deferPlay) {
                state.deferPlay = false;
                return new Promise<void>(resolve => {
                    state.finishPlay = () => {
                        commit();
                        state.finishPlay = null;
                        resolve();
                    };
                });
            }
            commit();
            return Promise.resolve();
        },
        stop: () => {
            state.currentItem = null;
            return Promise.resolve();
        }
    };
    return {
        getThemeMedia: vi.fn(),
        playbackManager,
        queryItem: vi.fn(),
        state,
        userSettings: { enableThemeSongs: () => true, enableThemeVideos: () => false }
    };
});

// Keep NativeHome, Page and the automatic theme owner real. Only the remote
// reads, media transport, and unrelated Home content are fixture boundaries.
vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: { getApiClient: () => ({ getCurrentUserId: () => 'user-a' }) }
}));
vi.mock('@jellyfin/sdk/lib/utils/api/library-api', () => ({
    getLibraryApi: () => ({ getThemeMedia: fixture.getThemeMedia })
}));
vi.mock('hooks/useItem', () => ({ getItemQuery: (_api: unknown, itemId: string) => ({ itemId }) }));
vi.mock('utils/query/queryClient', () => ({ queryClient: { fetchQuery: fixture.queryItem } }));
vi.mock('utils/jellyfin-apiclient/compat', () => ({ toApi: () => ({}) }));
vi.mock('scripts/settings/userSettings', () => ({ currentSettings: fixture.userSettings }));
vi.mock('components/playback/playbackmanager', () => ({ playbackManager: fixture.playbackManager }));
vi.mock('components/viewManager/viewManager', () => ({ default: { hideView: () => undefined } }));
vi.mock('components/autoFocuser', () => ({ default: { autoFocus: () => undefined } }));
vi.mock('../../api', () => ({
    getPtvCurrentUserId: () => 'user-a',
    getPtvServerId: () => 'server-a'
}));
vi.mock('../../core/clientProfile', () => ({ getPtvPerformanceProfile: () => ({ clientKind: 'desktop' }) }));
vi.mock('../../core/observability', () => ({ recordPtvEvent: () => undefined, shouldCollectDiagnostics: () => false }));
vi.mock('../../core/tvFocus', () => ({ notifyPtvTvFocusContentReady: () => undefined }));
vi.mock('../../shell/PTVShell', () => ({ default: ({ children }: React.PropsWithChildren) => children }));
vi.mock('../../shell/routeController', () => ({ registerPtvNativeRoute: () => undefined }));
vi.mock('../../utils/usePtvAdminDebugVisibility', () => ({ usePtvAdminDebugVisibility: () => ({ canShowDebug: false }) }));
vi.mock('../../modules/cards/itemActionMenu', () => ({ showPtvItemActionMenu: () => undefined }));
vi.mock('../../modules/icons', () => ({ PtvIcon: () => null }));
vi.mock('./hooks', () => ({
    useNativeHomeData: () => ({
        debug: { home: {} }, heroItem: null, heroItems: [], identityKey: null,
        isLoading: true, rows: [], user: null
    }),
    useNativeHomeVirtualRows: () => ({
        getRowMountReason: () => '', isRowMounted: () => false, mountedRowCount: 0,
        registerRowRef: () => () => undefined
    })
}));
vi.mock('./services/homeLayoutService', () => ({
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Mirrors the production module export.
    DEFAULT_NATIVE_HOME_PERSONALIZATION_SETTINGS: { density: 'comfortable', heroEnabled: false, experimentalRecommendations: false },
    decorateNativeHomeRowsForCurrentLayout: () => []
}));
vi.mock('./services/homePreferenceService', () => ({ getCurrentNativeHomePreferenceScope: () => null }));
vi.mock('./nativeHomeDetailsNavigation', () => ({ openNativeHomeDetails: () => undefined }));
vi.mock('./useNativeHomePersonalization', () => ({
    useNativeHomePersonalization: () => ({ rows: [], status: 'idle', retry: () => undefined })
}));
vi.mock('./useConfiguredHomePreview', () => ({
    useConfiguredHomePreview: () => ({
        activeBackdropItem: null, backdropPresentationKey: 'home-fixture',
        capturePreview: () => null, focusedHeroItem: null, hasRetiredConfiguredFocus: false,
        isPreviewCurrent: () => false, pendingHeroItem: null,
        setActiveBackdropItem: () => undefined, setActiveBackdropPreview: () => undefined,
        setFocusedHeroPreview: () => undefined, setPendingHeroPreview: () => undefined
    })
}));

import 'components/themeMediaPlayer';
import NativeHome from './NativeHome';

async function settle() {
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

describe('NativeHome automatic theme retirement', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
    afterAll(() => vi.unstubAllGlobals());

    beforeEach(() => {
        document.dispatchEvent(new CustomEvent('viewshow', { detail: { options: {} } }));
        fixture.state.currentItem = null;
        fixture.state.deferPlay = false;
        fixture.state.finishPlay = null;
        fixture.queryItem.mockImplementation(async ({ itemId }: { itemId: string }) => ({
            Id: itemId, Type: itemId.startsWith('episode') ? 'Episode' : 'Series'
        }));
        fixture.getThemeMedia.mockResolvedValue({ data: { ThemeSongsResult: {
            Items: [{ Id: 'theme-song', ServerId: 'server-a', MediaType: 'Audio' }], OwnerId: 'series-a'
        } } });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        document.dispatchEvent(new CustomEvent('viewshow', { detail: { options: {} } }));
        await settle();
    });

    async function enterDetails(itemId: string) {
        window.history.replaceState(null, '', `#/details?id=${itemId}&serverId=server-a`);
        document.dispatchEvent(new CustomEvent('viewshow', { detail: {
            params: { id: itemId, serverId: 'server-a' }
        } }));
        await settle();
    }

    async function openHome() {
        window.history.replaceState(null, '', '#/home');
        await act(async () => {
            root.render(<NativeHome />);
            await settle();
        });
        expect(container.querySelector('#ptv-native-home-page')).not.toBeNull();
        expect(container.textContent).toContain('Loading PiggieTV Home');
    }

    it.each(['series-a', 'episode-a'])('stops the automatic theme when Home replaces %s Details', async itemId => {
        await enterDetails(itemId);
        expect(fixture.state.currentItem?.Id).toBe('theme-song');

        await openHome();

        expect(fixture.state.currentItem).toBeNull();
    });

    it('rejects an automatic start that settles after the actual Home page mounts', async () => {
        fixture.state.deferPlay = true;
        await enterDetails('series-deferred');
        expect(fixture.state.finishPlay).not.toBeNull();

        await openHome();
        fixture.state.finishPlay?.();
        await settle();

        expect(fixture.state.currentItem).toBeNull();
    });

    it('keeps user-selected audio playing when Home mounts', async () => {
        fixture.state.currentItem = { Id: 'selected-track', ServerId: 'server-a', MediaType: 'Audio' };

        await openHome();

        expect(fixture.state.currentItem?.Id).toBe('selected-track');
    });
});
