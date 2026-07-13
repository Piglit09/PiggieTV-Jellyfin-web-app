import { useEffect, useState } from 'react';

import { getPtvCurrentUser, isPtvAdminUser } from '../api';
import { PTV_EVENTS } from '../core/config';
import { isPtvDebugEnabled, recordPtvEvent, setPtvDebugAdminAccess } from '../core/observability';

type PtvDebugChangeDetail = Readonly<{
    enabled?: boolean;
}>;

let adminDebugAccess: boolean | null = null;
let adminDebugAccessPromise: Promise<boolean> | null = null;

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
                adminDebugAccess = isPtvAdminUser(user);
                return adminDebugAccess;
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

        return () => {
            isMounted = false;
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
