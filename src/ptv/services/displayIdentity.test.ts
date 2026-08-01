import {
    describe,
    expect,
    it
} from 'vitest';

import {
    getPtvDisplayIdentityKey,
    PtvIdentityScopedCache
} from './displayIdentity';

describe('display identity ownership', () => {
    it('requires both server and user identity before a display cache is eligible', () => {
        expect(getPtvDisplayIdentityKey('', 'user-a')).toBeNull();
        expect(getPtvDisplayIdentityKey('server-a', '')).toBeNull();
        expect(getPtvDisplayIdentityKey('server-a', 'user-a')).toBe('server-a:user-a');
    });

    it('never exposes one account snapshot to another account or server', () => {
        const cache = new PtvIdentityScopedCache<{ title: string }>();

        expect(cache.set('server-a', 'user-a', { title: 'User A shelf' })).toBe(true);
        expect(cache.get('server-a', 'user-b')).toBeUndefined();
        expect(cache.get('server-b', 'user-a')).toBeUndefined();
        expect(cache.get('server-a', 'user-a')).toEqual({ title: 'User A shelf' });
    });

    it('bounds retained identity snapshots', () => {
        const cache = new PtvIdentityScopedCache<number>(2);

        cache.set('server', 'user-a', 1);
        cache.set('server', 'user-b', 2);
        cache.set('server', 'user-c', 3);

        expect(cache.size).toBe(2);
        expect(cache.get('server', 'user-a')).toBeUndefined();
        expect(cache.get('server', 'user-b')).toBe(2);
        expect(cache.get('server', 'user-c')).toBe(3);
    });
});
