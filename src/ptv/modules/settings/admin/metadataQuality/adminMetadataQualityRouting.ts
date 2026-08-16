import { decodeAdminRouteSegment } from '../adminRouteSegments';

export const ADMIN_METADATA_QUALITY_PATH = '/settings/admin/media/metadata-quality';

export type AdminMetadataQualityRouteState =
    | Readonly<{ itemId: string; section: 'detail' }>
    | Readonly<{ section: 'queue' }>
    | Readonly<{ section: 'invalid' }>;

function trimTrailingSlashes(pathname: string) {
    let normalized = pathname;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized;
}

export function readAdminMetadataQualityRoute(pathname: string): AdminMetadataQualityRouteState {
    const normalized = trimTrailingSlashes(pathname);
    const lowerPath = normalized.toLowerCase();
    if (lowerPath === ADMIN_METADATA_QUALITY_PATH) return { section: 'queue' };
    if (!lowerPath.startsWith(`${ADMIN_METADATA_QUALITY_PATH}/`)) return { section: 'invalid' };

    const encodedId = normalized.slice(ADMIN_METADATA_QUALITY_PATH.length + 1);
    if (!encodedId || encodedId.includes('/')) return { section: 'invalid' };
    const itemId = decodeAdminRouteSegment(encodedId);
    return itemId ? { itemId, section: 'detail' } : { section: 'invalid' };
}
