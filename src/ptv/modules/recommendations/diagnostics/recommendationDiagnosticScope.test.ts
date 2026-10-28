import { beforeEach, describe, expect, it, vi } from 'vitest';
import Events from '../../../../utils/events';
import { ServerConnections } from 'lib/jellyfin-apiclient';

const identity = vi.hoisted(() => ({
    clientPresent: true,
    serverId: 'server-a',
    serverInfoId: 'server-a',
    userId: 'user-a'
}));

vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: {} }));
vi.mock('../../../api/client', () => ({
    getCurrentPtvApiClient: vi.fn(() => identity.clientPresent ? ({
        getCurrentUserId: () => identity.userId,
        serverId: () => identity.serverId,
        serverInfo: () => ({ Id: identity.serverInfoId })
    }) : null)
}));

import {
    capturePtvRecommendationDiagnosticScope,
    retirePtvRecommendationDiagnosticScope,
    subscribePtvRecommendationDiagnosticScope
} from './recommendationDiagnosticScope';

describe('recommendation diagnostic identity scope', () => {
    beforeEach(() => {
        identity.clientPresent = true;
        identity.serverId = 'server-a';
        identity.serverInfoId = 'server-a';
        identity.userId = 'user-a';
        retirePtvRecommendationDiagnosticScope();
    });

    it('retires A→B→A work even when the final server and user match the original pair', () => {
        const first = capturePtvRecommendationDiagnosticScope({ serverId: 'server-a', userId: 'user-a' });
        expect(first).not.toBeNull();
        const scopeA = first?.identityScope;
        const retired = vi.fn();
        const unsubscribe = subscribePtvRecommendationDiagnosticScope(retired);

        identity.serverId = 'server-b';
        identity.serverInfoId = 'server-b';
        identity.userId = 'user-b';
        Events.trigger(ServerConnections, 'localusersignedout');
        Events.trigger(ServerConnections, 'localusersignedin');
        const second = capturePtvRecommendationDiagnosticScope({ serverId: 'server-b', userId: 'user-b' });
        identity.serverId = 'server-a';
        identity.serverInfoId = 'server-a';
        identity.userId = 'user-a';
        Events.trigger(ServerConnections, 'localusersignedout');
        Events.trigger(ServerConnections, 'localusersignedin');
        const third = capturePtvRecommendationDiagnosticScope({ serverId: 'server-a', userId: 'user-a' });

        expect(first?.isCurrent()).toBe(false);
        expect(second?.isCurrent()).toBe(false);
        expect(third?.isCurrent()).toBe(true);
        expect(third?.identityScope).not.toBe(scopeA);
        expect(retired).toHaveBeenCalled();
        expect(JSON.stringify(first)).not.toMatch(/server-a|user-a|ptv-recommendations/);
        unsubscribe();
    });

    it('retires a captured scope immediately at logout intent', () => {
        const scope = capturePtvRecommendationDiagnosticScope({ serverId: 'server-a', userId: 'user-a' });
        retirePtvRecommendationDiagnosticScope();
        expect(scope?.isCurrent()).toBe(false);
    });

    it('fails closed when canonical authentication is missing or conflicting at capture', () => {
        identity.clientPresent = false;
        expect(capturePtvRecommendationDiagnosticScope({ serverId: 'server-a', userId: 'user-a' })).toBeNull();
        identity.clientPresent = true;
        identity.serverInfoId = 'server-b';
        expect(capturePtvRecommendationDiagnosticScope({ serverId: 'server-a', userId: 'user-a' })).toBeNull();
    });

    it('retires an active scope when canonical authentication disappears or conflicts mid-run', () => {
        const missing = capturePtvRecommendationDiagnosticScope({ serverId: 'server-a', userId: 'user-a' });
        const retired = vi.fn();
        const unsubscribe = subscribePtvRecommendationDiagnosticScope(retired);
        identity.clientPresent = false;
        expect(missing?.isCurrent()).toBe(false);
        expect(retired).toHaveBeenCalledTimes(1);

        identity.clientPresent = true;
        const conflicting = capturePtvRecommendationDiagnosticScope({ serverId: 'server-a', userId: 'user-a' });
        expect(conflicting).not.toBeNull();
        identity.serverInfoId = 'server-b';
        expect(conflicting?.isCurrent()).toBe(false);
        expect(retired).toHaveBeenCalledTimes(3);
        unsubscribe();
    });
});
