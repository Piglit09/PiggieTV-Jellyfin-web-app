import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
    openRequest: vi.fn(),
    registerModule: vi.fn()
}));
const connectionMocks = vi.hoisted(() => {
    const state = { userId: 'user-a' };
    const apiClient = {
        getCurrentUserId: vi.fn(() => state.userId)
    };

    return {
        apiClient,
        getApiClient: vi.fn(() => apiClient),
        state
    };
});
const detailMocks = vi.hoisted(() => ({
    getItem: vi.fn()
}));
const settingsMocks = vi.hoisted(() => ({
    getSettings: vi.fn()
}));

vi.mock('../../../lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: vi.fn(() => connectionMocks.apiClient),
        getApiClient: connectionMocks.getApiClient
    }
}));

vi.mock('../../core/lifecycle', () => ({
    registerModule: actionMocks.registerModule
}));

vi.mock('../../core/scope', () => ({
    resetRuntimeScope: vi.fn(() => ({
        listen: vi.fn(),
        watchDom: vi.fn()
    }))
}));

vi.mock('../../services/coordinatedLegacyItemDetail', () => ({
    getCoordinatedLegacyItemDetail: detailMocks.getItem
}));

vi.mock('../request/requestLoader', () => ({
    openPtvRequestPortal: actionMocks.openRequest
}));

vi.mock('./arrLinks', () => ({
    getPtvIntegrationActions: vi.fn(() => [])
}));

vi.mock('./integrationsConfig', () => ({
    getPtvIntegrationSettings: settingsMocks.getSettings
}));

import { createRequestButton, shouldShowRequest } from './arrActions';

type IntegrationModule = Readonly<{
    destroy: () => void;
    refresh: () => void;
}>;

const integrationModule = actionMocks.registerModule.mock.calls[0]?.[0] as IntegrationModule;

describe('integration Request action', () => {
    beforeEach(() => {
        integrationModule.destroy();
        document.body.innerHTML = '<main class="itemDetailPage"><div class="mainDetailButtons"></div></main>';
        window.location.hash = '#/details?id=identity-fixture&serverId=server';
        connectionMocks.state.userId = 'user-a';
        connectionMocks.apiClient.getCurrentUserId.mockClear();
        connectionMocks.getApiClient.mockClear();
        detailMocks.getItem.mockReset();
        settingsMocks.getSettings.mockReset();
        settingsMocks.getSettings.mockResolvedValue({
            seerr: {
                enabled: false,
                enableRequestsPage: false
            }
        });
        actionMocks.openRequest.mockReset();
        actionMocks.openRequest.mockResolvedValue(true);
    });

    it('uses the shared activation boundary exactly once with the item query', () => {
        const button = createRequestButton({
            Name: 'Anonymous Series',
            ProductionYear: 2026
        });

        button.click();

        expect(actionMocks.openRequest).toHaveBeenCalledTimes(1);
        expect(actionMocks.openRequest).toHaveBeenCalledWith({
            query: 'Anonymous Series 2026'
        });
    });

    it.each(['Movie', 'Series'])('does not offer Request on %s details', Type => {
        expect(shouldShowRequest({
            seerr: {
                enabled: true,
                enableRequestsPage: true
            }
        }, { Type })).toBe(false);
    });

    it('preserves Request eligibility for other supported detail types', () => {
        expect(shouldShowRequest({
            seerr: {
                enabled: true,
                enableRequestsPage: true
            }
        }, { Type: 'Book' })).toBe(true);
    });

    it('does not reuse the existing detail cache across authorization identities', async () => {
        detailMocks.getItem
            .mockResolvedValueOnce({ Id: 'identity-fixture', Name: 'Account A item', Type: 'Book' })
            .mockResolvedValueOnce({ Id: 'identity-fixture', Name: 'Account B item', Type: 'Book' });

        integrationModule.refresh();
        await vi.waitFor(() => expect(detailMocks.getItem).toHaveBeenCalledTimes(1));

        connectionMocks.state.userId = 'user-b';
        integrationModule.refresh();

        await vi.waitFor(() => expect(detailMocks.getItem).toHaveBeenCalledTimes(2));
        expect(connectionMocks.apiClient.getCurrentUserId).toHaveReturnedWith('user-b');
    });

    it('rejects a stale completion after identity change and clears cached items on destroy', async () => {
        let resolveAccountA!: (item: Record<string, unknown>) => void;
        const accountAItem = new Promise<Record<string, unknown>>(resolve => {
            resolveAccountA = resolve;
        });

        detailMocks.getItem
            .mockReturnValueOnce(accountAItem)
            .mockResolvedValue({ Id: 'identity-fixture', Name: 'Current item', Type: 'Book' });

        integrationModule.refresh();
        await vi.waitFor(() => expect(detailMocks.getItem).toHaveBeenCalledTimes(1));

        connectionMocks.state.userId = 'user-b';
        resolveAccountA({ Id: 'identity-fixture', Name: 'Stale Account A item', Type: 'Book' });
        await Promise.resolve();
        await Promise.resolve();

        integrationModule.refresh();
        await vi.waitFor(() => expect(detailMocks.getItem).toHaveBeenCalledTimes(2));

        integrationModule.destroy();
        integrationModule.refresh();

        await vi.waitFor(() => expect(detailMocks.getItem).toHaveBeenCalledTimes(3));
    });

    it('renders actions on the visible restored details page only', async () => {
        document.body.innerHTML = `
            <main class="itemDetailPage hide" data-page="stale">
                <div class="mainDetailButtons"></div>
            </main>
            <main class="itemDetailPage" data-page="current">
                <div class="mainDetailButtons"></div>
            </main>
        `;
        detailMocks.getItem.mockResolvedValue({
            Id: 'identity-fixture',
            Name: 'Current item',
            Type: 'Book'
        });
        settingsMocks.getSettings.mockResolvedValue({
            seerr: {
                enabled: true,
                enableRequestsPage: true
            }
        });

        integrationModule.refresh();

        await vi.waitFor(() => {
            expect(document.querySelector('[data-page="current"] .ptv-integration-action-request')).not.toBeNull();
        });
        expect(document.querySelector('[data-page="stale"] .ptv-integration-action-request')).toBeNull();
    });
});
