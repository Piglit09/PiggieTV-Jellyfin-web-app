import { useEffect, useState } from 'react';

import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from '../../utils/events';

import { getPtvCurrentUser, isPtvAdminUser } from '../api';
import { PTV_EVENTS } from '../core/config';
import { isPtvDebugEnabled, recordPtvEvent, setPtvDebugAdminAccess } from '../core/observability';

type PtvDebugChangeDetail = Readonly<{
    enabled?: boolean;
}>;

let adminDebugAccess: boolean | null = null;
let adminDebugAccessPromise: Promise<boolean> | null = null;

export function invalidatePtvAdminDebugAccess() {
    adminDebugAccess = null;
    adminDebugAccessPromise = null;
}

function getDebugEnabledFromEvent(event: Event) {
    const detail = (event as CustomEvent<PtvDebugChangeDetail>).detail;

    return typeof detail?.enabled === 'boolean' ? detail.enabled : isPtvDebugEnabled();
}

function getPtvAdminDebugAccess() {
    if (adminDebugAccess !== null) {
        return Promise.resolve(adminDebugAccess);
    }

    if (!adminDebugAccessPromise) {
        adminDebugAccessPromise = getPtvCurrentUser()
            .then(user => {
                const isAdmin = isPtvAdminUser(user);

                // Authentication can settle after the shell mounts. Do not cache
                // an unauthenticated result across the later sign-in event.
                if (user?.Id) {
                    adminDebugAccess = isAdmin;
                } else {
                    adminDebugAccessPromise = null;
                }

                return isAdmin;
            })
            .catch(error => {
                adminDebugAccessPromise = null;
                throw error;
            });
    }

    return adminDebugAccessPromise;
}

export function usePtvAdminDebugVisibility() {
    const [isAdmin, setAdmin] = useState(false);
    const [debugEnabled, setDebugEnabled] = useState(() => isPtvDebugEnabled());

    useEffect(() => {
        let isMounted = true;

        const updateAdminAccess = () => {
            void getPtvAdminDebugAccess()
                .then(isAdminUser => {
                    setPtvDebugAdminAccess(isAdminUser);

                    if (isMounted) {
                        setAdmin(isAdminUser);
                    }
                })
                .catch(error => {
                    setPtvDebugAdminAccess(false);
                    recordPtvEvent('api', 'admin-debug-user-policy-failed', {
                        error: error instanceof Error ? error.message : String(error)
                    });

                    if (isMounted) {
                        setAdmin(false);
                    }
                });
        };

        const handleLocalUserSignedIn = () => {
            invalidatePtvAdminDebugAccess();
            updateAdminAccess();
        };

        const handleLocalUserSignedOut = () => {
            invalidatePtvAdminDebugAccess();
            setPtvDebugAdminAccess(false);

            if (isMounted) {
                setAdmin(false);
            }
        };

        Events.on(ServerConnections, 'localusersignedin', handleLocalUserSignedIn);
        Events.on(ServerConnections, 'localusersignedout', handleLocalUserSignedOut);
        updateAdminAccess();

        return () => {
            isMounted = false;
            Events.off(ServerConnections, 'localusersignedin', handleLocalUserSignedIn);
            Events.off(ServerConnections, 'localusersignedout', handleLocalUserSignedOut);
        };
    }, []);

    useEffect(() => {
        const onDebugChange = (event: Event) => {
            setDebugEnabled(getDebugEnabledFromEvent(event));
        };

        window.addEventListener(PTV_EVENTS.debugChange, onDebugChange);

        return () => {
            window.removeEventListener(PTV_EVENTS.debugChange, onDebugChange);
        };
    }, []);

    return {
        canShowDebug: isAdmin && debugEnabled,
        debugEnabled,
        isAdmin
    };
}
