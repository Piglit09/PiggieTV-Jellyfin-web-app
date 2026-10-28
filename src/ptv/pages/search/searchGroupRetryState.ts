import type { PtvSearchGroupId, PtvSearchGroupStatus, PtvSearchPresentation } from './nativeSearchState';

const FAILED_SEARCH_STATUSES = new Set<PtvSearchGroupStatus>(['error', 'timeout', 'cancelled']);

export function shouldRenderPtvSearchGroups(queryReady: boolean, presentation: PtvSearchPresentation): boolean {
    return queryReady && (!presentation.isSettled || presentation.itemCount > 0 || presentation.failedGroupCount > 0);
}

export function getRetryablePtvSearchGroupIds(
    visibleGroups: readonly Readonly<{ id: PtvSearchGroupId; status: PtvSearchGroupStatus }>[],
    targetGroupId?: PtvSearchGroupId
): PtvSearchGroupId[] {
    return visibleGroups
        .filter(group => (!targetGroupId || group.id === targetGroupId) && FAILED_SEARCH_STATUSES.has(group.status))
        .map(group => group.id);
}

export function canRetryPtvSearch(settledKey: string | null, currentKey: string | null): boolean {
    return Boolean(settledKey && settledKey === currentKey);
}

export function restorePtvSearchRetryScope(
    settledKeyRef: { current: string | null },
    requestIdRef: { current: number },
    scopeRef: { current: string },
    retry: Readonly<{ key: string; requestId: number; scope: string; signalAborted: boolean }>
): boolean {
    if (retry.signalAborted || requestIdRef.current !== retry.requestId || scopeRef.current !== retry.scope) {
        return false;
    }

    settledKeyRef.current = retry.key;
    return true;
}

export function mergePtvFailedGroupRetry<K extends PtvSearchGroupId, I, T>(
    current: Record<K, T>,
    result: {
        groups: Partial<Record<K, I[]>>;
        failedGroupStatuses: Partial<Record<K, 'error' | 'timeout'>>;
    },
    makeGroup: (groupId: K, items: I[], status: PtvSearchGroupStatus) => T
): Record<K, T> {
    const next = { ...current };

    for (const [groupId, items] of Object.entries(result.groups) as [K, I[]][]) {
        next[groupId] = makeGroup(groupId, items, items.length ? 'success' : 'empty');
    }

    for (const [groupId, status] of Object.entries(result.failedGroupStatuses) as [K, 'error' | 'timeout'][]) {
        next[groupId] = makeGroup(groupId, [], status);
    }

    return next;
}
