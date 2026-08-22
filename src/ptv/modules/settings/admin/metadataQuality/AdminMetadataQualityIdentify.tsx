import React, { useCallback, useMemo } from 'react';

import { useApi } from '../../../../../hooks/useApi';
import {
    createAdminMetadataManagerIdentifyHandoff,
    readAdminMetadataManagerIdentifyHandoff,
    type AdminMetadataManagerIdentifyPrefill
} from '../metadataManager/adminMetadataManagerIdentifyHandoff';
import AdminMetadataIdentifyPanel from '../metadataManager/AdminMetadataIdentifyPanel';
import type { AdminMetadataItemBundle } from '../metadataManager/adminMetadataManagerModel';
import { useAdminMetadataManager } from '../metadataManager/useAdminMetadataManager';
import type { AdminMetadataQualityDetail } from './adminMetadataQualityModel';

import '../metadataManager/adminMetadataManager.scss';

export function createAdminMetadataQualityIdentifyPrefill(
    detail: AdminMetadataQualityDetail
): AdminMetadataManagerIdentifyPrefill | null {
    const match = detail.providerVerified ? detail.suggestedMatch : null;
    if (!match) return null;

    const state = createAdminMetadataManagerIdentifyHandoff({
        issueNumber: match.issueNumber,
        itemId: detail.itemId,
        mediaClass: match.mediaClass,
        name: match.seriesTitle || match.title,
        provider: match.provider,
        providerIds: match.providerIds,
        seriesStartYear: match.seriesStartYear,
        seriesTitle: match.seriesTitle,
        year: match.year
    });
    return state ? readAdminMetadataManagerIdentifyHandoff(state, detail.itemId) : null;
}

export default function AdminMetadataQualityIdentify({
    detail,
    onApplied
}: Readonly<{
    detail: AdminMetadataQualityDetail;
    onApplied?: (bundle: AdminMetadataItemBundle) => void;
}>) {
    const { __legacyApiClient__: apiClient, api, user } = useApi();
    const state = useAdminMetadataManager({
        api,
        apiClient,
        itemId: detail.itemId,
        userId: user?.Id,
        workspaceEnabled: false
    });
    const identifyPrefill = useMemo(
        () => createAdminMetadataQualityIdentifyPrefill(detail),
        [ detail ]
    );
    const { refetchItem } = state;
    const retryItem = useCallback(() => refetchItem(), [ refetchItem ]);

    if (state.itemLoading && !state.itemBundle) {
        return <p aria-live='polite' className='ptv-metadata-quality-identify-state' role='status'>Loading Identify tools...</p>;
    }

    if (state.itemError || !state.itemBundle) {
        return (
            <div className='ptv-metadata-quality-identify-state is-error' role='alert'>
                <strong>Identify tools couldn&apos;t be loaded.</strong>
                <button onClick={retryItem} type='button'>Retry Identify</button>
            </div>
        );
    }

    return (
        <div className='ptv-metadata-manager ptv-metadata-quality-identify-workspace' data-testid='ptv-metadata-quality-identify'>
            {identifyPrefill ? (
                <p className='ptv-metadata-workflow-message' role='status'>
                    The verified Metadata Quality suggestion is prefilled. Search providers and confirm the exact result before applying it.
                </p>
            ) : null}
            <AdminMetadataIdentifyPanel
                bundle={state.itemBundle}
                identifyPrefill={identifyPrefill}
                onApplied={onApplied}
                operations={state}
            />
        </div>
    );
}
