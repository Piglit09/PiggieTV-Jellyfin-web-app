import React, { useCallback, useEffect, useState } from 'react';

import { getPtvUpdateService, type PtvUpdateSnapshot } from '../services/updateService';

const HIDDEN_STATES = new Set(['dismissed', 'idle']);

export default function PTVUpdateNotice() {
    const updateService = getPtvUpdateService();
    const [snapshot, setSnapshot] = useState<PtvUpdateSnapshot>(() => updateService.getSnapshot());

    useEffect(() => {
        const unsubscribe = updateService.subscribe(setSnapshot);
        void updateService.start();
        const timer = window.setInterval(() => updateService.retryDeferredUpdate(), 5000);

        return () => {
            window.clearInterval(timer);
            unsubscribe();
        };
    }, [updateService]);

    const handleApply = useCallback(() => {
        updateService.applyWhenSafe();
    }, [updateService]);
    const handleDismiss = useCallback(() => {
        updateService.dismiss();
    }, [updateService]);
    const handleRetry = useCallback(() => {
        void updateService.retryFailedUpdate();
    }, [updateService]);

    if (HIDDEN_STATES.has(snapshot.state)) return null;

    const isDeferred = snapshot.state === 'deferred';
    const isApplying = snapshot.state === 'applying';
    const isError = snapshot.state === 'error';
    let message = 'Reload to use the latest PiggieTV frontend.';
    let actionLabel = 'Reload';
    if (isDeferred) message = `${snapshot.activityReason} The update will be applied when it is safe.`;
    if (isApplying) actionLabel = 'Updating...';
    if (isError) {
        message = snapshot.error;
        actionLabel = 'Try again';
    }

    return (
        <aside className='ptv-update-notice' role='status' aria-live='polite'>
            <div className='ptv-update-notice-copy'>
                <strong>{isError ? 'PiggieTV update needs attention' : 'PiggieTV update available'}</strong>
                <span>{message}</span>
            </div>
            <div className='ptv-update-notice-actions'>
                <button type='button' disabled={isApplying} onClick={isError ? handleRetry : handleApply}>
                    {actionLabel}
                </button>
                <button type='button' disabled={isApplying} onClick={handleDismiss}>
                    Later
                </button>
            </div>
        </aside>
    );
}
