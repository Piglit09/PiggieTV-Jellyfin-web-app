import { ServerConnections } from 'lib/jellyfin-apiclient';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Events from '../../../utils/events';

const accountMocks = vi.hoisted(() => ({
    cancel: vi.fn(),
    getIdentity: vi.fn(),
    getProfile: vi.fn(),
    resend: vi.fn(),
    startEmail: vi.fn()
}));

vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: {} }));
vi.mock('./AccountApi', () => ({
    cancelPtvAccountEmailVerification: accountMocks.cancel,
    getAccountErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
    getPtvAccountIdentityKey: accountMocks.getIdentity,
    getPtvAccountProfile: accountMocks.getProfile,
    resendPtvAccountEmailVerification: accountMocks.resend,
    startPtvAccountEmailVerification: accountMocks.startEmail
}));

import {
    getPtvAccountProfileSnapshot,
    resetPtvAccountProfileStoreForTests,
    startPtvAccountProfileService
} from './accountProfileStore';

function profile(userId: string) {
    return {
        emailVerified: false,
        enrollmentPromptEligible: true,
        jellyfinUserId: userId,
        ok: true,
        username: userId
    };
}

describe('PiggieTV account profile store', () => {
    let stop: (() => void) | undefined;

    afterEach(() => {
        stop?.();
        stop = undefined;
        resetPtvAccountProfileStoreForTests();
        vi.clearAllMocks();
    });

    it('loads once per identity and clears owner data at sign out', async () => {
        accountMocks.getIdentity.mockReturnValue('server-a:user-a');
        accountMocks.getProfile.mockResolvedValue(profile('user-a'));
        stop = startPtvAccountProfileService();
        await vi.waitFor(() => expect(getPtvAccountProfileSnapshot().status).toBe('ready'));
        expect(accountMocks.getProfile).toHaveBeenCalledTimes(1);

        Events.trigger(ServerConnections, 'localusersignedin');
        await Promise.resolve();
        expect(accountMocks.getProfile).toHaveBeenCalledTimes(1);

        Events.trigger(ServerConnections, 'localusersignedout');
        expect(getPtvAccountProfileSnapshot()).toMatchObject({ identityKey: '', profile: null, status: 'anonymous' });
    });

    it('does not reuse one user profile after the authenticated identity changes', async () => {
        let identity = 'server-a:user-a';
        accountMocks.getIdentity.mockImplementation(() => identity);
        accountMocks.getProfile.mockImplementation(() => Promise.resolve(profile(identity.endsWith('user-a') ? 'user-a' : 'user-b')));
        stop = startPtvAccountProfileService();
        await vi.waitFor(() => expect(getPtvAccountProfileSnapshot().profile?.jellyfinUserId).toBe('user-a'));

        Events.trigger(ServerConnections, 'localusersignedout');
        identity = 'server-a:user-b';
        Events.trigger(ServerConnections, 'localusersignedin');
        await vi.waitFor(() => expect(getPtvAccountProfileSnapshot().profile?.jellyfinUserId).toBe('user-b'));
        expect(getPtvAccountProfileSnapshot().identityKey).toBe('server-a:user-b');
    });
});
