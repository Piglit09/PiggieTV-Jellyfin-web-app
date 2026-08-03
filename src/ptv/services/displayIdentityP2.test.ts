import { describe, expect, it } from 'vitest';

import {
    getPtvDisplayIdentityKey,
    normalizePtvDisplayIdentityPart,
    PtvIdentityScopedCache
} from './displayIdentity';

describe('P2 display identity ownership', () => {
    it('canonicalizes equivalent server and user identities', () => {
        expect(normalizePtvDisplayIdentityPart(' User-A ')).toBe('user-a');
        expect(getPtvDisplayIdentityKey(' Server ', ' User-A ')).toBe('server:user-a');
    });

    it('retires one identity without touching another and can clear all state', () => {
        const cache = new PtvIdentityScopedCache<string>(4);
        cache.set('server', 'user-a', 'A');
        cache.set('server', 'user-b', 'B');

        expect(cache.delete('SERVER', 'USER-A')).toBe(true);
        expect(cache.get('server', 'user-a')).toBeUndefined();
        expect(cache.get('server', 'user-b')).toBe('B');
        cache.clear();
        expect(cache.size).toBe(0);
    });
});
