import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createPtvAbortController } from '../../core/abortController';
import { getPtvPerformanceProfile } from '../../core/clientProfile';
import type { NativeHomeRow } from './hooks';
import { createNativeHomePersonalizedRows } from './personalizedHomeRows';
import type { PtvRecommendationFeedbackState } from '../../modules/recommendations/types/recommendationTypes';

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
    userId
}: UseNativeHomePersonalizationOptions) {
    const generationRef = useRef(0);
    const feedbackRef = useRef(feedback);
    const [retryRevision, setRetryRevision] = useState(0);
    const [state, setState] = useState<NativeHomePersonalizationState>(INITIAL_STATE);
    const feedbackKey = useMemo(() => JSON.stringify(feedback || null), [feedback]);

    feedbackRef.current = feedback;

    useEffect(() => {
        const generation = generationRef.current + 1;

        generationRef.current = generation;

        if (!enabled || !userId) {
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
            rows: previous.rows,
            status: 'loading'
        }));

        const timer = window.setTimeout(() => {
            void import('../../modules/recommendations')
                .then(({ getPtvRecommendationHomeData }) => (
                    getPtvRecommendationHomeData({
                        feedback: feedbackRef.current,
                        forceRefresh: retryRevision > 0,
                        signal: controller.signal
                    })
                ))
                .then(data => {
                    if (retired || controller.signal.aborted || generationRef.current !== generation) return;

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
    }, [enabled, feedbackKey, isPrimaryHomeLoading, retryRevision, userId]);

    const retry = useCallback(() => {
        setRetryRevision(previous => previous + 1);
    }, []);

    return {
        ...state,
        retry
    };
}
