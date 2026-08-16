import { describe, expect, it } from 'vitest';

import {
    ADMIN_PLAYBACK_PATH,
    readAdminPlaybackSection
} from './AdminPlaybackRoute';

describe('native Playback administration route', () => {
    it('uses Streaming for the workspace root and parses every route-backed section', () => {
        expect(ADMIN_PLAYBACK_PATH).toBe('/settings/admin/playback');
        expect(readAdminPlaybackSection('/settings/admin/playback')).toBe('streaming');
        expect(readAdminPlaybackSection('/settings/admin/playback/')).toBe('streaming');
        expect(readAdminPlaybackSection('/settings/admin/playback/streaming')).toBe('streaming');
        expect(readAdminPlaybackSection('/settings/admin/playback/transcoding/')).toBe('transcoding');
        expect(readAdminPlaybackSection('/settings/admin/playback/resume')).toBe('resume');
        expect(readAdminPlaybackSection('/settings/admin/playback/trickplay')).toBe('trickplay');
    });

    it('rejects unrelated, nested, and unknown sections', () => {
        expect(readAdminPlaybackSection('/settings/playback')).toBeNull();
        expect(readAdminPlaybackSection('/settings/admin/playback/unknown')).toBeNull();
        expect(readAdminPlaybackSection('/settings/admin/playback/trickplay/extra')).toBeNull();
    });
});
