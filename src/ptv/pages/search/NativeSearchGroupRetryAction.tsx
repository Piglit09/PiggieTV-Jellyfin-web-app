import React, { useCallback } from 'react';
import type { PtvSearchGroupId, PtvSearchGroupStatus } from './nativeSearchState';

export function NativeSearchGroupRetryAction({
    groupId,
    groupTitle,
    onRetry,
    status
}: Readonly<{
    groupId: PtvSearchGroupId;
    groupTitle: string;
    onRetry: (groupId: PtvSearchGroupId) => void;
    status: PtvSearchGroupStatus;
}>) {
    const handleRetry = useCallback(() => onRetry(groupId), [groupId, onRetry]);

    if (status !== 'error' && status !== 'timeout' && status !== 'cancelled') return null;

    return (
        <div className='ptv-search-result-state-actions'>
            <button
                aria-label={`Retry ${groupTitle} results`}
                onClick={handleRetry}
                type='button'
            >
                Retry group
            </button>
        </div>
    );
}
