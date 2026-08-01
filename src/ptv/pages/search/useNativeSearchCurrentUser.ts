import { useEffect, useMemo, useState } from 'react';

import {
    getPtvCurrentUser,
    getPtvCurrentUserId,
    getPtvServerId,
    type PtvUser
} from '../../api';
import { createPtvAbortController } from '../../core/abortController';

export type NativeSearchCurrentUserState = Readonly<{
    status: 'idle' | 'loading' | 'ready' | 'unavailable';
    user: PtvUser | null;
}>;

type ScopedUserState = NativeSearchCurrentUserState & Readonly<{
    identityKey: string;
}>;

function getIdentityKey(serverId: string, userId: string) {
    return `${serverId}\u001f${userId}`;
}

export function useNativeSearchCurrentUser(
    serverId: string,
    userId: string
): NativeSearchCurrentUserState {
    const identityKey = useMemo(() => getIdentityKey(serverId, userId), [serverId, userId]);
    const [state, setState] = useState<ScopedUserState>(() => ({
        identityKey,
        status: userId ? 'loading' : 'idle',
        user: null
    }));

    useEffect(() => {
        const abortController = createPtvAbortController();
        let active = true;

        setState({
            identityKey,
            status: userId ? 'loading' : 'idle',
            user: null
        });

        if (!userId) {
            return () => {
                active = false;
                abortController.abort();
            };
        }

        void getPtvCurrentUser(serverId, abortController.signal)
            .then(user => {
                if (!active || abortController.signal.aborted) return;

                const identityIsCurrent = getPtvServerId() === serverId
                    && getPtvCurrentUserId(serverId) === userId;

                if (!identityIsCurrent || user?.Id !== userId) return;

                setState({
                    identityKey,
                    status: 'ready',
                    user
                });
            })
            .catch(() => {
                if (!active || abortController.signal.aborted) return;

                setState({
                    identityKey,
                    status: 'unavailable',
                    user: null
                });
            });

        return () => {
            active = false;
            abortController.abort();
        };
    }, [identityKey, serverId, userId]);

    if (state.identityKey !== identityKey) {
        return {
            status: userId ? 'loading' : 'idle',
            user: null
        };
    }

    return {
        status: state.status,
        user: state.user
    };
}
