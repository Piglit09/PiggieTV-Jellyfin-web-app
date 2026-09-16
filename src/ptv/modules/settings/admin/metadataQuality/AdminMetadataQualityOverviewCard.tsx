import type { ApiClient } from 'jellyfin-apiclient';
import React, { useCallback } from 'react';
import { Link } from 'react-router-dom';

import PtvIcon from '../../../icons/PtvIcon';
import AdminStatusBadge from '../AdminStatusBadge';
import { ADMIN_METADATA_QUALITY_PATH } from './adminMetadataQualityRouting';
import { useAdminMetadataQualitySummary } from './useAdminMetadataQuality';

import './adminMetadataQuality.scss';

function countLabel(count: number | null) {
    return count === null ? 'Unavailable' : count.toLocaleString();
}

export default function AdminMetadataQualityOverviewCard({
    apiClient
}: Readonly<{ apiClient?: ApiClient }>) {
    const state = useAdminMetadataQualitySummary(apiClient, true);
    const retry = state.refetch;
    const handleRetry = useCallback(() => {
        retry().catch(() => undefined);
    }, [ retry ]);
    const counts = state.summary?.counts;
    const unavailable = !state.loading && (!state.enabled || Boolean(state.error) || !counts);
    const likelyIncorrect = counts?.likelyIncorrect ?? null;
    const needsReview = counts?.needsReview ?? null;
    let severity: 'healthy' | 'unknown' | 'warning' = 'healthy';
    let status = 'Available';
    if (unavailable) {
        severity = 'unknown';
        status = 'Unavailable';
    } else if ((likelyIncorrect || 0) > 0) {
        severity = 'warning';
        status = 'Review recommended';
    }

    let body: React.ReactNode;
    if (state.loading) {
        body = (
            <div aria-label='Loading Metadata Quality summary' className='ptv-metadata-quality-overview-loading' role='status'>
                <span />
                <span />
            </div>
        );
    } else if (unavailable) {
        body = (
            <div className='ptv-admin-empty-state'>
                <div>
                    <strong>Metadata Quality is unavailable.</strong>
                    <p>The rest of Administration remains available.</p>
                    {state.enabled && <button className='ptv-admin-retry' onClick={handleRetry} type='button'>Retry summary</button>}
                </div>
            </div>
        );
    } else {
        body = (
            <dl className='ptv-metadata-quality-overview-counts'>
                <div>
                    <dt>Likely incorrect</dt>
                    <dd>{countLabel(likelyIncorrect)}</dd>
                </div>
                <div>
                    <dt>Needs review</dt>
                    <dd>{countLabel(needsReview)}</dd>
                </div>
            </dl>
        );
    }

    return (
        <section
            aria-labelledby='ptv-admin-metadata-quality-overview-title'
            className='ptv-admin-panel ptv-glass-card ptv-metadata-quality-overview-card'
        >
            <header className='ptv-admin-panel-header'>
                <div className='ptv-admin-panel-heading'>
                    <PtvIcon name='quality' size='21px' />
                    <h2 id='ptv-admin-metadata-quality-overview-title'>Metadata Quality</h2>
                </div>
                {!state.loading && <AdminStatusBadge label={status} severity={severity} />}
            </header>

            {body}

            <footer className='ptv-metadata-quality-overview-footer'>
                <Link className='ptv-admin-panel-action' to={ADMIN_METADATA_QUALITY_PATH}>
                    Review metadata <PtvIcon name='right' size='14px' />
                </Link>
            </footer>
        </section>
    );
}
