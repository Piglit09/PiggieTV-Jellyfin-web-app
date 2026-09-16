import { describe, expect, it, vi } from 'vitest';

vi.mock('./pluginApi', () => ({
    getPtvPluginApiDiagnostics: vi.fn(() => null),
    getPtvPluginApiResolvedRoot: vi.fn(() => '')
}));

import {
    recordPtvEvent,
    recordPtvTiming,
    subscribePtvObservability
} from './observability';

const ACCESS_CANARY = [ 'PTV_TEST', 'ACCESS_TOKEN', 'observability' ].join('_');
const JELLYFIN_TOKEN_FIELD = [ 'To', 'ken' ].join('');

describe('PTV observability credential safety', () => {
    it('sanitizes names and nested details before notifying subscribers', () => {
        const observed: unknown[] = [];
        const unsubscribe = subscribePtvObservability(event => observed.push(event));

        recordPtvEvent('api', `request?api_key=${ACCESS_CANARY}`, {
            config: {
                headers: {
                    Authorization: `MediaBrowser ${JELLYFIN_TOKEN_FIELD}="${ACCESS_CANARY}"`
                }
            }
        });
        recordPtvTiming('api', `request?token=${ACCESS_CANARY}`, 12.3, {
            response: {
                config: {
                    headers: {
                        'X-Emby-Token': ACCESS_CANARY
                    }
                }
            }
        });
        unsubscribe();

        const serialized = JSON.stringify(observed);

        expect(observed).toHaveLength(2);
        expect(serialized).not.toContain(ACCESS_CANARY);
        expect(serialized).toContain('[REDACTED]');
    });
});
