import type { ApiClient } from 'jellyfin-apiclient';
import { describe, expect, it } from 'vitest';

import { getResolvedAdminServerId } from './adminServerIdentity';

describe('administrator active-server identity', () => {
    it('fails closed until a concrete server id is available', () => {
        expect(getResolvedAdminServerId()).toBeNull();
        expect(getResolvedAdminServerId({
            serverId: () => '   '
        } as unknown as ApiClient)).toBeNull();
        expect(getResolvedAdminServerId({
            serverId: () => {
                throw new Error('connection is changing');
            }
        } as unknown as ApiClient)).toBeNull();
    });

    it('keeps server A and server B as distinct trimmed identities', () => {
        expect(getResolvedAdminServerId({
            serverId: () => ' server-a '
        } as unknown as ApiClient)).toBe('server-a');
        expect(getResolvedAdminServerId({
            serverId: () => 'server-b'
        } as unknown as ApiClient)).toBe('server-b');
    });
});
