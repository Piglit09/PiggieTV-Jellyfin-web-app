import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

const METADATA_MANAGER_ROUTE = '/settings/admin/media/metadata-manager';

export function getNativeMetadataManagerRoute(itemId?: string | null) {
    const normalizedItemId = itemId?.trim();
    return normalizedItemId ?
        `${METADATA_MANAGER_ROUTE}/${encodeURIComponent(normalizedItemId)}` :
        METADATA_MANAGER_ROUTE;
}

/** Preserves the legacy Metadata Manager item deep link while replacing its history entry. */
export default function LegacyMetadataManagerRedirect() {
    const [ searchParams ] = useSearchParams();
    return <Navigate replace to={getNativeMetadataManagerRoute(searchParams.get('id'))} />;
}
