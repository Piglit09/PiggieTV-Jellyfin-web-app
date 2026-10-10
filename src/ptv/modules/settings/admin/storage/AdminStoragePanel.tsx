import type { Api } from '@jellyfin/sdk';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { useCallback } from 'react';

import { getReadableSize } from 'utils/file';

import { projectAdminStorage, type AdminStorageRow } from './adminStorageModel';
import { getAdminStorageAuthority, useAdminStorage } from './useAdminStorage';

import './adminStorage.scss';

type AdminStorageViewProps = Readonly<{
    error?: boolean;
    loading?: boolean;
    onRetry?: () => void;
    rows: readonly AdminStorageRow[];
}>;

function readable(bytes: number | null) {
    return bytes === null ? 'Unavailable' : getReadableSize(bytes);
}

function StorageRow({ row }: Readonly<{ row: AdminStorageRow }>) {
    const percentage = row.usedPercent === null ? null : Math.round(row.usedPercent * 10) / 10;
    return (
        <li className='ptv-admin-storage-row'>
            <div className='ptv-admin-storage-identity'>
                <strong>{row.name}</strong>
                <ul aria-label={`Paths on ${row.name}`}>
                    {row.paths.map(path => <li key={path}>{path}</li>)}
                </ul>
            </div>
            <dl className='ptv-admin-storage-metrics'>
                <div><dt>Total</dt><dd>{readable(row.totalBytes)}</dd></div>
                <div><dt>Used</dt><dd>{readable(row.usedBytes)}</dd></div>
                <div><dt>Free</dt><dd>{readable(row.freeBytes)}</dd></div>
            </dl>
            <div className='ptv-admin-storage-usage'>
                {percentage === null ? (
                    <span>Usage unavailable</span>
                ) : (
                    <>
                        <span>{percentage}% used</span>
                        <progress aria-label={`${row.name} used capacity`} max='100' value={percentage} />
                    </>
                )}
            </div>
        </li>
    );
}

export function AdminStorageView({ error = false, loading = false, onRetry, rows }: AdminStorageViewProps) {
    let content: React.ReactNode;
    if (loading) {
        content = <p role='status'>Loading storage information...</p>;
    } else if (error || rows.length === 0) {
        content = (
            <div className='ptv-admin-storage-unavailable'>
                <p>Storage information unavailable.</p>
                {error && onRetry ? <button onClick={onRetry} type='button'>Retry storage</button> : null}
            </div>
        );
    } else {
        content = <ul className='ptv-admin-storage-list'>{rows.map(row => (
            <StorageRow key={JSON.stringify([ row.name, row.paths[0], row.usedBytes, row.freeBytes ])} row={row} />
        ))}</ul>;
    }

    return (
        <section aria-label='Storage utilization' className='ptv-admin-storage-panel ptv-glass-card'>
            <header>
                <h2>Storage utilization</h2>
                <p>Jellyfin-reported mounts and paths. Capacities are not summed because paths may share a filesystem.</p>
            </header>
            {content}
        </section>
    );
}

export default function AdminStoragePanel({ api, apiClient }: Readonly<{ api?: Api; apiClient?: ApiClient }>) {
    const storage = useAdminStorage(api, apiClient);
    const authorityReady = Boolean(getAdminStorageAuthority(api, apiClient));
    const rows = projectAdminStorage(storage.data);
    const refetch = storage.refetch;
    const onRetry = useCallback(() => {
        refetch().catch(() => undefined);
    }, [refetch]);
    return (
        <AdminStorageView
            error={!authorityReady || storage.isError}
            loading={authorityReady && storage.isPending && !storage.data}
            onRetry={authorityReady ? onRetry : undefined}
            rows={rows}
        />
    );
}
