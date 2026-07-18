import { describe, expect, it, vi } from 'vitest';

import {
    appendPtvChunkAssetVersion,
    clearPtvChunkRecoveryQuery,
    installPtvChunkAssetVersioning,
    isPtvChunkLoadError,
    tryRecoverPtvChunkLoadError,
    type PtvWebpackRuntime
} from './chunkLoadRecovery';

function createChunkError(request = 'https://example.test/web/90212.abc.chunk.js') {
    return Object.assign(new Error(`Loading chunk 90212 failed. (${request})`), {
        name: 'ChunkLoadError',
        request
    });
}

describe('chunk load recovery', () => {
    it('versions async JavaScript and CSS assets without changing their emitted filenames', () => {
        expect(appendPtvChunkAssetVersion('90212.abc.chunk.js', 'build 7')).toBe(
            '90212.abc.chunk.js?ptv_asset=build-7'
        );
        expect(appendPtvChunkAssetVersion('row.abc.css?theme=dark', 'build-7')).toBe(
            'row.abc.css?theme=dark&ptv_asset=build-7'
        );
        expect(appendPtvChunkAssetVersion('main.jellyfin.bundle.js', 'build-7')).toBe('main.jellyfin.bundle.js');
    });

    it('wraps the Webpack asset resolvers once', () => {
        const runtime: PtvWebpackRuntime = {
            miniCssF: chunkId => `${chunkId}.css`,
            u: chunkId => `${chunkId}.hash.chunk.js`
        };

        expect(installPtvChunkAssetVersioning(runtime, 'release-1')).toBe(true);
        expect(runtime.u?.(90212)).toBe('90212.hash.chunk.js?ptv_asset=release-1');
        expect(runtime.miniCssF?.(90212)).toBe('90212.css?ptv_asset=release-1');
        expect(installPtvChunkAssetVersioning(runtime, 'release-2')).toBe(false);
        expect(runtime.u?.(90212)).toBe('90212.hash.chunk.js?ptv_asset=release-1');
    });

    it('accepts same-origin chunk failures and rejects ordinary or cross-origin errors', () => {
        expect(isPtvChunkLoadError(createChunkError(), 'https://example.test')).toBe(true);
        expect(isPtvChunkLoadError(new Error('ordinary failure'), 'https://example.test')).toBe(false);
        expect(isPtvChunkLoadError(
            createChunkError('https://untrusted.test/web/90212.abc.chunk.js'),
            'https://example.test'
        )).toBe(false);
    });

    it('performs one build-scoped recovery while preserving the hash route', () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: vi.fn((key: string) => values.get(key) || null),
            setItem: vi.fn((key: string, value: string) => values.set(key, value))
        };
        const location = {
            href: 'https://example.test/web/#/reading/manga',
            origin: 'https://example.test',
            replace: vi.fn()
        };
        const error = createChunkError();

        expect(tryRecoverPtvChunkLoadError(error, { buildId: 'release-1', location, storage })).toBe(true);
        expect(location.replace).toHaveBeenCalledWith(
            'https://example.test/web/?ptv_chunk_recovery=release-1#/reading/manga'
        );
        expect(tryRecoverPtvChunkLoadError(error, { buildId: 'release-1', location, storage })).toBe(false);
        expect(location.replace).toHaveBeenCalledOnce();
    });

    it('removes the visible recovery marker after a successful bootstrap', () => {
        const history = {
            replaceState: vi.fn(),
            state: { route: 'reading' }
        };

        expect(clearPtvChunkRecoveryQuery(
            { href: 'https://example.test/web/?keep=1&ptv_chunk_recovery=release-1#/reading' },
            history
        )).toBe(true);
        expect(history.replaceState).toHaveBeenCalledWith(
            history.state,
            '',
            'https://example.test/web/?keep=1#/reading'
        );
    });
});
