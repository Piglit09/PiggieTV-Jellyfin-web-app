import { useEffect, useRef, useState } from 'react';

import { getPtvCurrentUser } from '../api/auth';
import { getCurrentPtvApiClient } from '../api/client';
import { getPtvUserViews } from '../api/libraries';
import { usePtvAuthenticatedIdentity } from '../api/usePtvAuthenticatedIdentity';
import { createPtvAbortController } from '../core/abortController';
import {
    getPtvAuthenticatedDisplayIdentityKey,
    getPtvDisplayIdentityKey
} from '../services/displayIdentity';
import { derivePtvNavigationAccess, type PtvNavigationAccess } from './navigationAccess';

export type PtvNavigationAccessState = Readonly<{
    access: PtvNavigationAccess | null;
    identityKey: string;
    status: 'loading' | 'ready' | 'unavailable';
}>;

type ScopedAccessState = PtvNavigationAccessState & Readonly<{
    revision: number;
}>;

// Permission changes made by another session must eventually retire this
// projection, even when the user stays on the same page.
const REVALIDATE_INTERVAL_MS = 60_000;
const ROUTE_REVALIDATE_MIN_AGE_MS = 15_000;

function currentIdentityMatches(identityKey: string): boolean {
    return getPtvAuthenticatedDisplayIdentityKey(getCurrentPtvApiClient()) === identityKey;
}

/**
 * Navigation is a projection of this user's authenticated Jellyfin views.
 * Missing or conflicting identity observations never reveal media links.
 */
export function usePtvNavigationAccess(): PtvNavigationAccessState {
    const identity = usePtvAuthenticatedIdentity();
    const [revision, setRevision] = useState(0);
    const requestedKey = identity.status === 'ready' ?
        getPtvDisplayIdentityKey(identity.serverId, identity.userId) : null;
    const identityIsCurrent = Boolean(requestedKey && currentIdentityMatches(requestedKey));
    const identityKey = identityIsCurrent ? requestedKey || '' : '';
    const lastVerifiedRef = useRef({ at: 0, identityKey: '' });
    const [state, setState] = useState<ScopedAccessState>({
        access: null,
        identityKey: '',
        revision: -1,
        status: 'loading'
    });

    useEffect(() => {
        const refresh = () => setRevision(previous => previous + 1);
        const refreshOnRouteChange = () => {
            const lastVerified = lastVerifiedRef.current;
            if (
                lastVerified.identityKey === identityKey
                && Date.now() - lastVerified.at < ROUTE_REVALIDATE_MIN_AGE_MS
            ) return;
            refresh();
        };
        const refreshWhenVisible = () => {
            if (document.visibilityState === 'visible') refresh();
        };
        const interval = window.setInterval(refreshWhenVisible, REVALIDATE_INTERVAL_MS);

        window.addEventListener('focus', refresh);
        window.addEventListener('hashchange', refreshOnRouteChange);
        window.addEventListener('storage', refresh);
        document.addEventListener('visibilitychange', refreshWhenVisible);

        return () => {
            window.clearInterval(interval);
            window.removeEventListener('focus', refresh);
            window.removeEventListener('hashchange', refreshOnRouteChange);
            window.removeEventListener('storage', refresh);
            document.removeEventListener('visibilitychange', refreshWhenVisible);
        };
    }, [identityKey]);

    useEffect(() => {
        const controller = createPtvAbortController();
        let active = true;

        setState(previous => {
            // A same-user refresh is background validation. Keep the last
            // proven projection visible until the new response replaces or
            // invalidates it; never carry it across an identity change.
            if (
                identityKey
                && previous.identityKey === identityKey
                && previous.status === 'ready'
                && previous.access
            ) return previous;

            return {
                access: null,
                identityKey,
                revision,
                status: identity.status === 'ready' && !identityKey ? 'unavailable' : 'loading'
            };
        });

        if (!identityKey) {
            return () => {
                active = false;
                controller.abort();
            };
        }

        const serverId = identity.serverId;
        const userId = identity.userId;
        void Promise.all([
            getPtvUserViews({ serverId, userId, scope: 'background', signal: controller.signal }),
            getPtvCurrentUser(serverId, controller.signal)
        ]).then(([views, user]) => {
            if (!active || controller.signal.aborted) return;
            const items = views?.Items;
            const userMatches = getPtvDisplayIdentityKey(serverId, user?.Id) === identityKey;
            const responseValid = Array.isArray(items) && userMatches && currentIdentityMatches(identityKey);

            if (responseValid) lastVerifiedRef.current = { at: Date.now(), identityKey };

            setState({
                access: responseValid && user && items ? derivePtvNavigationAccess(items, user) : null,
                identityKey,
                revision,
                status: responseValid ? 'ready' : 'unavailable'
            });
        }).catch(() => {
            if (!active || controller.signal.aborted) return;
            setState({ access: null, identityKey, revision, status: 'unavailable' });
        });

        return () => {
            active = false;
            controller.abort();
        };
    }, [identity.serverId, identity.status, identity.userId, identityKey, revision]);

    if (!identityKey) {
        return {
            access: null,
            identityKey: '',
            status: identity.status === 'ready' ? 'unavailable' : 'loading'
        };
    }

    if (state.identityKey !== identityKey) {
        return { access: null, identityKey, status: 'loading' };
    }

    if (state.revision !== revision) {
        return state.status === 'ready' && state.access ?
            { access: state.access, identityKey, status: 'ready' } :
            { access: null, identityKey, status: 'loading' };
    }

    return { access: state.access, identityKey, status: state.status };
}
