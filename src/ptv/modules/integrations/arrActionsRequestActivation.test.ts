import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
    openRequest: vi.fn(),
    registerModule: vi.fn()
}));

vi.mock('../../../lib/jellyfin-apiclient', () => ({
    ServerConnections: {}
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
    getCoordinatedLegacyItemDetail: vi.fn()
}));

vi.mock('../request/requestLoader', () => ({
    openPtvRequestPortal: actionMocks.openRequest
}));

vi.mock('./arrLinks', () => ({
    getPtvIntegrationActions: vi.fn(() => [])
}));

vi.mock('./integrationsConfig', () => ({
    getPtvIntegrationSettings: vi.fn()
}));

import { createRequestButton } from './arrActions';

describe('integration Request action', () => {
    beforeEach(() => {
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
});
