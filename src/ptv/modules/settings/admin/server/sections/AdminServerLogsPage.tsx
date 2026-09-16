import React, { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useApi } from '../../../../../../hooks/useApi';
import PtvIcon from '../../../../icons/PtvIcon';
import { AdminConfigurationError, AdminConfigurationSkeleton } from '../../configuration/AdminConfigurationPrimitives';
import { ADMIN_SERVER_BASE_PATH } from '../AdminServerRoute';
import { useAdminServerLogs } from '../useAdminServerOperations';

function formatDate(value: string | null) {
    if (!value) return 'Unknown';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function formatBytes(value: number | null) {
    if (value === null) return 'Unknown size';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function saveDownload(content: string, fileName: string, mimeType: string) {
    // eslint-disable-next-line compat/compat -- supported by the shipped browser targets.
    const url = URL.createObjectURL(new Blob([ content ], { type: mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    // eslint-disable-next-line compat/compat -- supported by the shipped browser targets.
    URL.revokeObjectURL(url);
}

function LogPreview({
    downloading,
    onDownload,
    onMissing,
    state
}: Readonly<{
    downloading: boolean;
    onDownload: () => void;
    onMissing: () => void;
    state: ReturnType<typeof useAdminServerLogs>;
}>) {
    const retryDetail = useCallback(() => {
        state.refetchDetail().catch(() => undefined);
    }, [ state ]);
    let description = 'Choose a log to inspect.';
    if (state.selected) description = 'Bounded authoritative preview.';
    if (state.detail?.truncated) {
        description = `Showing the first 512 KiB of ${formatBytes(state.detail.totalBytes)}.`;
    }
    let content = (
        <div className='ptv-admin-server-empty'><PtvIcon name='logs' size='30px' /><strong>Select a server log</strong><span>Nothing is read until a file from the authoritative list is selected.</span></div>
    );
    if (state.routeNotFound) {
        content = <div className='ptv-admin-server-empty' role='alert'><PtvIcon name='alerts' size='30px' /><strong>Log not found</strong><span>The requested filename is not present in the current authoritative log list.</span><button onClick={onMissing} type='button'>Back to Logs</button></div>;
    } else if (state.detailLoading) {
        content = <div className='ptv-admin-server-log-loading' role='status'>Loading bounded log preview...</div>;
    } else if (state.detailError) {
        content = <div className='ptv-admin-server-empty' role='alert'><PtvIcon name='alerts' size='30px' /><strong>Log content unavailable</strong><button onClick={retryDetail} type='button'>Retry</button></div>;
    } else if (state.detail) {
        content = <pre>{state.detail.renderedText}</pre>;
    }

    return (
        <section className='ptv-admin-server-operation-panel is-log-viewer'>
            <header><div><h3>{state.selected?.name || 'Log Preview'}</h3><p>{description}</p></div>{state.selected ? <button disabled={downloading} onClick={onDownload} type='button'><PtvIcon name='download' size='16px' />{downloading ? 'Preparing...' : 'Download'}</button> : null}</header>
            {content}
        </section>
    );
}

/* eslint-disable no-void, react/jsx-no-bind */
export default function AdminServerLogsPage({ routeFileName }: Readonly<{ routeFileName: string | null }>) {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminServerLogs(routeFileName, api, apiClient);
    const navigate = useNavigate();
    const [ downloading, setDownloading ] = useState(false);
    const [ feedback, setFeedback ] = useState('');
    const download = useCallback(async () => {
        if (downloading) return;
        setDownloading(true);
        try {
            const result = await state.download();
            saveDownload(result.content, result.fileName, result.mimeType);
            setFeedback('Log download prepared.');
        } catch (error) {
            setFeedback(error instanceof Error ? error.message : 'The server log could not be downloaded.');
        } finally {
            setDownloading(false);
        }
    }, [ downloading, state ]);

    if (state.listLoading) return <AdminConfigurationSkeleton />;
    if (state.listError) return <AdminConfigurationError loading={false} message="Server logs couldn't be loaded." onRetry={() => void state.refetchList()} retrying={state.listFetching} />;

    return (
        <section aria-labelledby='ptv-server-logs-title' className='ptv-admin-server-section'>
            <header className='ptv-admin-server-section-heading'>
                <div><h2 id='ptv-server-logs-title'>Logs</h2><p>Inspect a bounded preview or explicitly download one authoritative server log.</p></div>
                <button disabled={state.listFetching} onClick={() => void state.refetchList()} type='button'><PtvIcon name='refresh' size='16px' />Refresh</button>
            </header>

            <aside className='ptv-admin-server-security-note' role='status'><PtvIcon name='logs' size='22px' /><div><strong>Bounded diagnostic access</strong><p>Preview text is capped at 512 KiB. Full content is fetched only when you choose Download and is not cached.</p></div></aside>
            {feedback ? <p aria-live='polite' className='ptv-admin-server-feedback' role='status'>{feedback}</p> : null}

            <div className='ptv-admin-server-logs-grid'>
                <section className='ptv-admin-server-operation-panel'>
                    <header><div><h3>Server Logs</h3><p>{state.rows.length} available {state.rows.length === 1 ? 'file' : 'files'}</p></div></header>
                    {state.rows.length ? <nav aria-label='Available server logs' className='ptv-admin-server-log-list'>{state.rows.map(row => (
                        <Link aria-current={state.selected?.id === row.id ? 'page' : undefined} key={row.id} to={`${ADMIN_SERVER_BASE_PATH}/logs/${encodeURIComponent(row.name)}`}>
                            <PtvIcon name='logs' size='18px' /><span><strong>{row.name}</strong><small>{formatDate(row.modifiedAt || row.createdAt)} / {formatBytes(row.sizeBytes)}</small></span><PtvIcon name='right' size='15px' />
                        </Link>
                    ))}</nav> : <div className='ptv-admin-server-empty'><PtvIcon name='logs' size='30px' /><strong>No logs reported</strong><span>The server did not return any log files.</span></div>}
                </section>

                <LogPreview downloading={downloading} onDownload={() => void download()} onMissing={() => navigate(`${ADMIN_SERVER_BASE_PATH}/logs`, { replace: true })} state={state} />
            </div>
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind */
