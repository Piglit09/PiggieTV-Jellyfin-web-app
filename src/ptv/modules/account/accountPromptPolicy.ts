import type { PtvAccountProfile } from './AccountApi';

const SESSION_KEY_PREFIX = 'ptv:account-email-prompt:v1:';

export function shouldOfferPtvAccountEmail(profile: PtvAccountProfile | null) {
    return Boolean(profile
        && profile.enrollmentPromptEligible
        && !profile.emailVerified
        && !profile.pendingEmail);
}

export function getPtvAccountPromptSessionKey(identityKey: string) {
    return `${SESSION_KEY_PREFIX}${identityKey.replace(/[^A-Za-z0-9:._-]/g, '')}`;
}

export function wasPtvAccountPromptShown(identityKey: string, storage: Storage = window.sessionStorage) {
    if (!identityKey) return true;
    try {
        return storage.getItem(getPtvAccountPromptSessionKey(identityKey)) === 'shown';
    } catch {
        return false;
    }
}

export function markPtvAccountPromptShown(identityKey: string, storage: Storage = window.sessionStorage) {
    if (!identityKey) return;
    try {
        storage.setItem(getPtvAccountPromptSessionKey(identityKey), 'shown');
    } catch {
        // The prompt remains safely dismissible when session storage is unavailable.
    }
}
