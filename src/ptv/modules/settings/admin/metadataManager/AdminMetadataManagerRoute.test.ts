import { describe, expect, it } from 'vitest';

import { readAdminMetadataManagerItemId } from './AdminMetadataManagerRoute';

describe('native Metadata Manager route identity', () => {
    it('distinguishes the catalog from immutable item detail routes', () => {
        expect(readAdminMetadataManagerItemId('/settings/admin/media/metadata-manager')).toBe('');
        expect(readAdminMetadataManagerItemId('/settings/admin/media/metadata-manager/item-a/')).toBe('item-a');
        expect(readAdminMetadataManagerItemId('/settings/admin/media/metadata-manager/item%20a')).toBe('item a');
    });

    it('fails safely for unrelated and malformed route segments', () => {
        expect(readAdminMetadataManagerItemId('/settings/admin/media')).toBe('');
        expect(readAdminMetadataManagerItemId('/settings/admin/media/metadata-manager/%E0%A4%A')).toBe('');
        expect(readAdminMetadataManagerItemId('/settings/admin/media/metadata-manager/item-a/extra')).toBe('');
        expect(readAdminMetadataManagerItemId('/settings/admin/media/metadata-manager/item%2Fa')).toBe('');
        expect(readAdminMetadataManagerItemId('/settings/admin/media/metadata-manager/item%5Ca')).toBe('');
        expect(readAdminMetadataManagerItemId('/settings/admin/media/metadata-manager/item%00a')).toBe('');
    });
});
