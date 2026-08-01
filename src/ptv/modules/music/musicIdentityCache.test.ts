import { describe, expect, it } from 'vitest';

import { PtvMusicIdentityResourceCache } from './musicIdentityCache';

describe('PiggieTV Music identity resource cache', () => {
    it('does not expose an artist or image value after an A to B identity switch', () => {
        const cache = new PtvMusicIdentityResourceCache<string>(4);

        cache.set('server-a:user-a', 'shared-resource', 'server-a-value');

        expect(cache.get('server-a:user-a', 'shared-resource')).toBe('server-a-value');
        expect(cache.get('server-b:user-b', 'shared-resource')).toBeUndefined();
    });

    it('does not retain data when server and user identity is incomplete', () => {
        const cache = new PtvMusicIdentityResourceCache<string>(4);

        expect(cache.set(null, 'artist-1', 'value')).toBe(false);
        expect(cache.size).toBe(0);
    });

    it('uses a bounded least-recently-used retention policy', () => {
        const cache = new PtvMusicIdentityResourceCache<string>(2);

        cache.set('server:user', 'artist-1', 'one');
        cache.set('server:user', 'artist-2', 'two');
        expect(cache.get('server:user', 'artist-1')).toBe('one');

        cache.set('server:user', 'artist-3', 'three');

        expect(cache.size).toBe(2);
        expect(cache.get('server:user', 'artist-2')).toBeUndefined();
        expect(cache.get('server:user', 'artist-1')).toBe('one');
        expect(cache.get('server:user', 'artist-3')).toBe('three');
    });
});
