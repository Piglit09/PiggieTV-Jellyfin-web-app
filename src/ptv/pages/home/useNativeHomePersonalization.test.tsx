import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNativeHomePersonalization } from './useNativeHomePersonalization';

const recommendationState = vi.hoisted(() => ({
    getHome: vi.fn()
}));
function setReactActEnvironment(value: boolean) {
    const environment = globalThis as typeof globalThis & Record<string, unknown>;

    environment['IS_REACT_ACT_ENVIRONMENT'] = value;
}

vi.mock('../../modules/recommendations', () => ({
    getPtvRecommendationHomeData: recommendationState.getHome
}));

vi.mock('../../core/clientProfile', () => ({
    getPtvPerformanceProfile: () => ({
        isFireTv: false,
        isLowPower: false
    })
}));

function Harness({
    enabled = true,
    loading = false,
    userId = 'user-a'
}: Readonly<{
    enabled?: boolean;
    loading?: boolean;
    userId?: string;
}>) {
    const state = useNativeHomePersonalization({
        enabled,
        isPrimaryHomeLoading: loading,
        userId
    });

    return (
        <div
            data-error={state.error}
            data-rows={state.rows.map(row => row.id).join(',')}
            data-status={state.status}
        />
    );
}

describe('useNativeHomePersonalization', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        setReactActEnvironment(true);
        vi.useFakeTimers();
        recommendationState.getHome.mockReset();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        setReactActEnvironment(false);
        vi.useRealTimers();
    });

    async function settle() {
        await act(async () => {
            await vi.runAllTimersAsync();
            await Promise.resolve();
        });
    }

    it('loads recommendations only after primary Home is ready', async () => {
        recommendationState.getHome.mockResolvedValue({
            rows: [{
                explanation: 'For you',
                id: 'recommended-for-you',
                items: [{
                    affinityScore: 80,
                    discoveryWeight: 20,
                    item: { Id: 'item-a', Name: 'A', Type: 'Movie' },
                    mediaType: 'movie',
                    reasons: [],
                    score: 80
                }],
                mediaType: 'movie',
                title: 'Recommended For You'
            }]
        });

        await act(async () => root.render(<Harness loading />));
        await settle();
        expect(recommendationState.getHome).not.toHaveBeenCalled();

        await act(async () => root.render(<Harness />));
        await settle();

        expect(container.firstElementChild?.getAttribute('data-status')).toBe('ready');
        expect(container.firstElementChild?.getAttribute('data-rows')).toBe('personalized-recommended-for-you');
    });

    it('waits for the post-readiness quiet window before starting recommendation work', async () => {
        recommendationState.getHome.mockResolvedValue({ rows: [] });

        await act(async () => root.render(<Harness />));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3_999);
        });

        expect(recommendationState.getHome).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
            await Promise.resolve();
        });

        expect(recommendationState.getHome).toHaveBeenCalledTimes(1);
    });

    it('cancels the quiet-window start when personalization retires', async () => {
        recommendationState.getHome.mockResolvedValue({ rows: [] });

        await act(async () => root.render(<Harness />));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2_000);
        });
        await act(async () => {
            root.render(<Harness enabled={false} />);
        });
        await act(async () => {
            await vi.runAllTimersAsync();
        });

        expect(recommendationState.getHome).not.toHaveBeenCalled();
        expect(container.firstElementChild?.getAttribute('data-status')).toBe('disabled');
    });

    it('aborts retired work and rejects its stale completion', async () => {
        let resolveFirst: ((value: { rows: [] }) => void) | undefined;
        recommendationState.getHome.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => (
            new Promise(resolve => {
                resolveFirst = resolve;
                signal.addEventListener('abort', vi.fn());
            })
        ));

        await act(async () => root.render(<Harness userId='user-a' />));
        await act(async () => {
            await vi.runAllTimersAsync();
        });
        const signal = recommendationState.getHome.mock.calls[0][0].signal as AbortSignal;

        await act(async () => root.render(<Harness userId='user-b' enabled={false} />));
        resolveFirst?.({ rows: [] });
        await settle();

        expect(signal.aborted).toBe(true);
        expect(container.firstElementChild?.getAttribute('data-status')).toBe('disabled');
    });

    it('surfaces a retryable non-blocking error', async () => {
        recommendationState.getHome.mockRejectedValue(new Error('offline'));

        await act(async () => root.render(<Harness />));
        await settle();

        expect(container.firstElementChild?.getAttribute('data-status')).toBe('error');
        expect(container.firstElementChild?.getAttribute('data-error')).toContain('temporarily unavailable');
    });
});
