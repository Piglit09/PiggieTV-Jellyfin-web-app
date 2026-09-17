import { describe, expect, it } from 'vitest';

import {
    ADMIN_METADATA_QUALITY_PATH,
    readAdminMetadataQualityRoute
} from './adminMetadataQualityRouting';

describe('Metadata Quality route', () => {
    it('recognizes the canonical queue and immutable item detail routes', () => {
        expect(readAdminMetadataQualityRoute(ADMIN_METADATA_QUALITY_PATH)).toEqual({ section: 'queue' });
        expect(readAdminMetadataQualityRoute(`${ADMIN_METADATA_QUALITY_PATH}/item%20a/`)).toEqual({
            itemId: 'item a',
            section: 'detail'
        });
    });

    it.each([
        '/settings/admin/media/metadata-quality/item-a/extra',
        '/settings/admin/media/metadata-quality/item%2Fa',
        '/settings/admin/media/metadata-quality/item%5Ca',
        '/settings/admin/media/metadata-quality/%E0%A4%A',
        '/settings/admin/media/not-quality'
    ])('rejects an unsafe or unrelated route: %s', pathname => {
        expect(readAdminMetadataQualityRoute(pathname)).toEqual({ section: 'invalid' });
    });
});
