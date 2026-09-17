import { beforeEach, describe, expect, it } from 'vitest';

import {
    getPtvAccountPromptSessionKey,
    markPtvAccountPromptShown,
    shouldOfferPtvAccountEmail,
    wasPtvAccountPromptShown
} from './accountPromptPolicy';
import type { PtvAccountProfile } from './AccountApi';

function profile(patch: Partial<PtvAccountProfile> = {}): PtvAccountProfile {
    return {
        emailVerified: false,
        enrollmentPromptEligible: true,
        jellyfinUserId: 'user-a',
        ok: true,
        username: 'Alex',
        ...patch
    };
}

describe('PiggieTV account email prompt policy', () => {
    beforeEach(() => sessionStorage.clear());

    it('offers only eligible profiles without verified or pending email', () => {
        expect(shouldOfferPtvAccountEmail(profile())).toBe(true);
        expect(shouldOfferPtvAccountEmail(profile({ emailVerified: true }))).toBe(false);
        expect(shouldOfferPtvAccountEmail(profile({ pendingEmail: 'pending@example.com' }))).toBe(false);
        expect(shouldOfferPtvAccountEmail(profile({ enrollmentPromptEligible: false }))).toBe(false);
        expect(shouldOfferPtvAccountEmail(null)).toBe(false);
    });

    it('records one prompt per session and isolates users and servers', () => {
        const first = 'server-a:user-a';
        const second = 'server-a:user-b';
        expect(wasPtvAccountPromptShown(first)).toBe(false);
        markPtvAccountPromptShown(first);
        expect(wasPtvAccountPromptShown(first)).toBe(true);
        expect(wasPtvAccountPromptShown(second)).toBe(false);
        expect(getPtvAccountPromptSessionKey(first)).toBe('ptv:account-email-prompt:v1:server-a:user-a');
    });
});
