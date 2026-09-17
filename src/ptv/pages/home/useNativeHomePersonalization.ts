import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createPtvAbortController } from '../../core/abortController';
import { getPtvPerformanceProfile } from '../../core/clientProfile';
import type { NativeHomeRow } from './hooks';
import { createNativeHomePersonalizedRows } from './personalizedHomeRows';
import type { PtvRecommendationFeedbackState } from '../../modules/recommendations/types/recommendationTypes';
import { getPtvDisplayIdentityKey } from '../../services/displayIdentity';

export type NativeHomePersonalizationStatus =
    | 'disabled'
    | 'empty'
    | 'error'
    | 'idle'
    | 'loading'
    | 'ready';

type NativeHomePersonalizationState = Readonly<{
    error: string;
    rows: NativeHomeRow[];
    status: NativeHomePersonalizationStatus;
}>;

type UseNativeHomePersonalizationOptions = Readonly<{
    enabled: boolean;
    feedback?: PtvRecommendationFeedbackState;
    isPrimaryHomeLoading: boolean;
    serverId: string;
    userId: string;
}>;

const INITIAL_STATE: NativeHomePersonalizationState = {
    error: '',
    rows: [],
    status: 'idle'
};
const PERSONALIZATION_QUIET_WINDOW_MS = 4_000;

export function useNativeHomePersonalization({
    enabled,
    feedback,
    isPrimaryHomeLoading,
    serverId,
    userId
}: UseNativeHomePersonalizationOptions) {
    const generationRef = useRef(0);
    const scopeKey = useMemo(
        () => getPtvDisplayIdentityKey(serverId, userId),
        [serverId, userId]
    );
    const activeScopeRef = useRef(scopeKey);
    const feedbackRef = useRef(feedback);
    const [retryRevision, setRetryRevision] = useState(0);
    const [state, setState] = useState<NativeHomePersonalizationState>(INITIAL_STATE);
    const feedbackKey = useMemo(() => JSON.stringify(feedback || null), [feedback]);

    feedbackRef.current = feedback;

    useEffect(() => {
        const scopeChanged = activeScopeRef.current !== scopeKey;
        activeScopeRef.current = scopeKey;
        const generation = generationRef.current + 1;

        generationRef.current = generation;

        if (!enabled || !serverId || !userId) {
            setState({
                error: '',
                rows: [],
                status: 'disabled'
            });
            return undefined;
        }

        if (isPrimaryHomeLoading) {
            setState(previous => previous.status === 'ready' ? previous : INITIAL_STATE);
            return undefined;
        }

        const performanceProfile = getPtvPerformanceProfile();

        if (performanceProfile.isFireTv || performanceProfile.isLowPower) {
            setState({
                error: '',
                rows: [],
                status: 'disabled'
            });
            return undefined;
        }

        const controller = createPtvAbortController();
        let retired = false;

        setState(previous => ({
            error: '',
            rows: scopeChanged ? [] : previous.rows,
            status: 'loading'
        }));

        const timer = window.setTimeout(() => {
            void import('../../modules/recommendations')
                .then(({ getPtvRecommendationHomeData }) => (
                    getPtvRecommendationHomeData({
                        feedback: feedbackRef.current,
                        forceRefresh: retryRevision > 0,
                        serverId,
                        signal: controller.signal,
                        userId
                    })
                ))
                .then(data => {
                    if (
                        retired
                        || controller.signal.aborted
                        || generationRef.current !== generation
                        || activeScopeRef.current !== scopeKey
                    ) return;

                    const rows = createNativeHomePersonalizedRows(data);

                    setState({
                        error: '',
                        rows,
                        status: rows.length ? 'ready' : 'empty'
                    });
                })
                .catch(error => {
                    if (
                        retired
                        || controller.signal.aborted
                        || generationRef.current !== generation
                        || activeScopeRef.current !== scopeKey
                        || (error instanceof Error && error.name === 'AbortError')
                    ) return;

                    setState({
                        error: 'Personalized recommendations are temporarily unavailable.',
                        rows: [],
                        status: 'error'
                    });
                });
        }, PERSONALIZATION_QUIET_WINDOW_MS);

        return () => {
            retired = true;
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [enabled, feedbackKey, isPrimaryHomeLoading, retryRevision, scopeKey, serverId, userId]);

    const retry = useCallback(() => {
        setRetryRevision(previous => previous + 1);
    }, []);

    return {
        ...state,
        retry
    };
}
