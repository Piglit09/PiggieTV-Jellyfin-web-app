import React, { useCallback, useEffect, useState } from 'react';

import { getPtvUpdateService, type PtvUpdateSnapshot } from '../services/updateService';

const HIDDEN_STATES = new Set(['dismissed', 'error', 'idle']);

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

    if (HIDDEN_STATES.has(snapshot.state)) return null;

    const isDeferred = snapshot.state === 'deferred';
    const isApplying = snapshot.state === 'applying';

    return (
        <aside className='ptv-update-notice' role='status' aria-live='polite'>
            <div className='ptv-update-notice-copy'>
                <strong>PiggieTV update available</strong>
                <span>{isDeferred ? `${snapshot.activityReason} The update will be applied when it is safe.` : 'Reload to use the latest PiggieTV frontend.'}</span>
            </div>
            <div className='ptv-update-notice-actions'>
                <button type='button' disabled={isApplying} onClick={handleApply}>
                    {isApplying ? 'Updating...' : 'Reload'}
                </button>
                <button type='button' disabled={isApplying} onClick={handleDismiss}>
                    Later
                </button>
            </div>
        </aside>
    );
}
