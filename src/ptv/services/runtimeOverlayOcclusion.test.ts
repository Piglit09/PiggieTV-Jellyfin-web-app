import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    acquirePtvRuntimeOverlayOcclusion,
    getPtvRuntimeOverlayOcclusionCount,
    resetPtvRuntimeOverlayOcclusionsForTests
} from './runtimeOverlayOcclusion';

describe('persistent runtime overlay occlusion', () => {
    afterEach(() => {
        resetPtvRuntimeOverlayOcclusionsForTests();
    });

    it('keeps the runtime host demoted until every modal owner releases', () => {
        const releaseShellPanel = acquirePtvRuntimeOverlayOcclusion('shell-panel');
        const releaseMusicDialog = acquirePtvRuntimeOverlayOcclusion('music-dialog');

        expect(getPtvRuntimeOverlayOcclusionCount()).toBe(2);
        expect(document.documentElement.classList.contains('ptv-runtime-overlay-occluded')).toBe(true);

        releaseShellPanel();
        expect(getPtvRuntimeOverlayOcclusionCount()).toBe(1);
        expect(document.documentElement.classList.contains('ptv-runtime-overlay-occluded')).toBe(true);

        releaseMusicDialog();
        expect(getPtvRuntimeOverlayOcclusionCount()).toBe(0);
        expect(document.documentElement.classList.contains('ptv-runtime-overlay-occluded')).toBe(false);
    });

    it('makes each release idempotent', () => {
        const release = acquirePtvRuntimeOverlayOcclusion('strict-mode-safe-owner');

        release();
        release();

        expect(getPtvRuntimeOverlayOcclusionCount()).toBe(0);
        expect(document.documentElement.classList.contains('ptv-runtime-overlay-occluded')).toBe(false);
    });

    it.each([
        ['shell panels', 'src/ptv/shell/PTVShell.tsx', 'ptv-shell-panel'],
        ['track menus', 'src/ptv/modules/music/musicPage.tsx', 'ptv-music-item-menu'],
        ['metadata dialogs', 'src/ptv/modules/music/musicPage.tsx', 'ptv-music-metadata-dialog'],
        ['playlist dialogs', 'src/ptv/modules/music/musicPlaylistModal.tsx', 'ptv-music-playlist-modal']
    ])('keeps %s registered with the shared occlusion owner', (_label, file, owner) => {
        const source = readFileSync(resolve(process.cwd(), file), 'utf8');

        expect(source).toContain(`acquirePtvRuntimeOverlayOcclusion('${owner}')`);
    });
});
