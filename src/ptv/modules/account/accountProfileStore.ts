import { useSyncExternalStore } from 'react';
import { ServerConnections } from 'lib/jellyfin-apiclient';

import Events from '../../../utils/events';
import {
    cancelPtvAccountEmailVerification,
    getAccountErrorMessage,
    getPtvAccountIdentityKey,
    getPtvAccountProfile,
    resendPtvAccountEmailVerification,
    startPtvAccountEmailVerification,
    type PtvAccountOperation,
    type PtvAccountProfile
} from './AccountApi';

export type PtvAccountProfileSnapshot = {
    error: string;
    identityKey: string;
    profile: PtvAccountProfile | null;
    status: 'anonymous' | 'loading' | 'ready' | 'error';
};

const listeners = new Set<() => void>();
let snapshot: PtvAccountProfileSnapshot = {
    error: '',
    identityKey: '',
    profile: null,
    status: 'anonymous'
};
let generation = 0;
let started = false;
let stopService = () => undefined;

function publish(next: PtvAccountProfileSnapshot) {
    snapshot = next;
    listeners.forEach(listener => {
        listener();
    });
}

function currentIdentityKey() {
    try {
        return getPtvAccountIdentityKey();
    } catch {
        return '';
    }
}

export async function refreshPtvAccountProfile(force = true) {
    const identityKey = currentIdentityKey();
    const requestGeneration = ++generation;
    if (!identityKey) {
        publish({ error: '', identityKey: '', profile: null, status: 'anonymous' });
        return null;
    }

    if (!force && snapshot.status === 'ready' && snapshot.identityKey === identityKey) {
        return snapshot.profile;
    }

    publish({
        error: '',
        identityKey,
        profile: snapshot.identityKey === identityKey ? snapshot.profile : null,
        status: 'loading'
    });

    try {
        const profile = await getPtvAccountProfile();
        if (requestGeneration !== generation || identityKey !== currentIdentityKey()) return null;
        publish({ error: '', identityKey, profile, status: 'ready' });
        return profile;
    } catch (error) {
        if (requestGeneration !== generation || identityKey !== currentIdentityKey()) return null;
        publish({
            error: getAccountErrorMessage(error),
            identityKey,
            profile: null,
            status: 'error'
        });
        return null;
    }
}

export function startPtvAccountProfileService() {
    if (started) return stopService;
    started = true;

    const handleSignedIn = () => {
        void refreshPtvAccountProfile(false);
    };
    const handleSignedOut = () => {
        generation += 1;
        publish({ error: '', identityKey: '', profile: null, status: 'anonymous' });
    };

    Events.on(ServerConnections, 'localusersignedin', handleSignedIn);
    Events.on(ServerConnections, 'localusersignedout', handleSignedOut);
    void refreshPtvAccountProfile(false);

    stopService = () => {
        if (!started) return;
        started = false;
        generation += 1;
        Events.off(ServerConnections, 'localusersignedin', handleSignedIn);
        Events.off(ServerConnections, 'localusersignedout', handleSignedOut);
    };
    return stopService;
}

function adoptOperation(operation: PtvAccountOperation) {
    if (operation.profile && snapshot.identityKey) {
        publish({ error: '', identityKey: snapshot.identityKey, profile: operation.profile, status: 'ready' });
    }
    return operation;
}

export async function requestPtvAccountEmail(email: string) {
    return adoptOperation(await startPtvAccountEmailVerification(email));
}

export async function resendPtvAccountEmail() {
    return adoptOperation(await resendPtvAccountEmailVerification());
}

export async function cancelPtvAccountEmail() {
    return adoptOperation(await cancelPtvAccountEmailVerification());
}

export function subscribePtvAccountProfile(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getPtvAccountProfileSnapshot() {
    return snapshot;
}

export function usePtvAccountProfile() {
    return useSyncExternalStore(
        subscribePtvAccountProfile,
        getPtvAccountProfileSnapshot,
        getPtvAccountProfileSnapshot
    );
}

export function resetPtvAccountProfileStoreForTests() {
    generation += 1;
    publish({ error: '', identityKey: '', profile: null, status: 'anonymous' });
}
