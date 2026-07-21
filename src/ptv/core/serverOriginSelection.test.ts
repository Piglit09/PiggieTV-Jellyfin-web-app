/* eslint-disable sonarjs/no-clear-text-protocols -- Reserved addresses model split-origin development. */
import { describe, expect, it } from 'vitest';

import {
    buildPtvServerOriginCandidates,
    getRequestedPtvServerId,
    getRequestedPtvServerUrl,
    getSavedPtvServerAddresses
} from './serverOriginSelection';

describe('PiggieTV server origin selection', () => {
    it('prioritizes the explicit development backend without deriving it from the frontend', () => {
        expect(buildPtvServerOriginCandidates({
            development: true,
            explicitDevelopmentUrl: 'http://192.0.2.50:8096',
            fallbackOrigin: 'http://192.0.2.125:8080',
            runtimeUrls: [ 'http://localhost:8096' ]
        })).toEqual([
            'http://192.0.2.50:8096',
            'http://localhost:8096'
        ]);
    });

    it('selects the stored server matching the login serverid before stale runtime roots', () => {
        const serverId = getRequestedPtvServerId('?url=%2Fhome&serverid=selected-server');
        const requestedServer = serverId === 'selected-server' ? {
            LastConnectionMode: 'Manual',
            ManualAddress: 'http://192.0.2.60:8096'
        } : null;

        expect(buildPtvServerOriginCandidates({
            development: true,
            requestedServer,
            runtimeUrls: [ 'http://localhost:8096' ]
        })[0]).toBe('http://192.0.2.60:8096');
    });

    it('reads an explicit backend URL from wrapper query parameters', () => {
        expect(getRequestedPtvServerUrl('?jellyfinUrl=http%3A%2F%2F10.16.0.50%3A8096')).toBe(
            'http://10.16.0.50:8096'
        );
        expect(getRequestedPtvServerUrl('?server=http%3A%2F%2F10.16.0.50%3A8096&serverid=legacy')).toBe(
            'http://10.16.0.50:8096'
        );
    });

    it('places explicit server overrides ahead of other discovery candidates', () => {
        expect(buildPtvServerOriginCandidates({
            development: true,
            requestedServerUrl: 'http://10.16.0.50:8096',
            explicitDevelopmentUrl: 'http://192.0.2.50:8096',
            runtimeUrls: [ 'http://localhost:8096' ]
        })[0]).toBe('http://10.16.0.50:8096');
    });

    it('uses an authenticated API client ahead of controlled fallback candidates', () => {
        expect(buildPtvServerOriginCandidates({
            apiClient: {
                accessToken: () => 'test-token',
                getCurrentUserId: () => 'test-user',
                serverAddress: () => 'http://192.0.2.70:8096'
            },
            configuredUrls: [ 'http://localhost:8096' ],
            development: true
        })).toEqual([
            'http://192.0.2.70:8096',
            'http://localhost:8096'
        ]);
    });

    it('orders saved addresses by the last successful connection mode and deduplicates them', () => {
        expect(getSavedPtvServerAddresses({
            LastConnectionMode: 1,
            LocalAddress: 'http://192.0.2.80:8096',
            ManualAddress: 'http://192.0.2.80:8096',
            RemoteAddress: 'https://media.example.test'
        })).toEqual([
            'https://media.example.test',
            'http://192.0.2.80:8096'
        ]);
    });

    it('does not use the development frontend origin as a backend fallback', () => {
        expect(buildPtvServerOriginCandidates({
            development: true,
            fallbackOrigin: 'http://192.0.2.125:8080'
        })).toEqual([]);
    });
});
/* eslint-enable sonarjs/no-clear-text-protocols */
