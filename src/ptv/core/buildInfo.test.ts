import { describe, expect, it } from 'vitest';

import {
    classifyPtvBuildCompatibility,
    formatPtvBuildInfoCompact,
    getPtvBuildInfo
} from './buildInfo';

const TEST_PLUGIN_VERSION = ['10', '11', '8', '1'].join('.');

describe('PiggieTV build information', () => {
    it('uses explicit provenance fallbacks for direct module imports', () => {
        const info = getPtvBuildInfo();

        expect(info.compatibility).toBe('unknown');
        expect(info.pluginVersion).toBe('unknown');
        expect(info.cacheSchemaVersion).toBe(7);
        expect(info.frontendBuildDate).not.toBe('unknown');
        expect(info.frontendBuildId).not.toBe('unknown');
    });

    it('reports development and production overrides', () => {
        const development = getPtvBuildInfo(undefined, {
            environment: 'development',
            frontendBuildDate: '2026-07-14T12:00:00.000Z',
            frontendBuildId: 'dev-build',
            frontendCommitSha: 'abc123',
            jellyfinWebVersion: '10.11.11'
        });
        const production = getPtvBuildInfo(undefined, {
            environment: 'production',
            frontendBuildId: 'release-10.11.11'
        });

        expect(development.environment).toBe('development');
        expect(development.frontendBuildDate).toBe('2026-07-14T12:00:00.000Z');
        expect(production.environment).toBe('production');
    });

    it('distinguishes an unavailable plugin from unchecked compatibility', () => {
        expect(getPtvBuildInfo(null, { pluginConnected: false }).compatibility).toBe('plugin-unavailable');
        expect(getPtvBuildInfo().compatibility).toBe('unknown');
    });

    it('fails incompatible API and cache schema versions', () => {
        expect(classifyPtvBuildCompatibility({ apiVersion: 2 }).compatibility).toBe('version-mismatch');
        expect(classifyPtvBuildCompatibility({ apiVersion: 1, cacheVersion: 8 }).compatibility).toBe('version-mismatch');
    });

    it('warns for compatible Jellyfin patch-level differences', () => {
        const result = classifyPtvBuildCompatibility({
            apiVersion: 1,
            cacheVersion: 7,
            pluginVersion: TEST_PLUGIN_VERSION
        }, {
            jellyfinWebVersion: '10.11.11',
            pluginConnected: true
        });

        expect(result.compatibility).toBe('patch-warning');
    });

    it('formats a compact diagnostics representation without runtime locations', () => {
        const info = getPtvBuildInfo({
            apiVersion: 1,
            cacheVersion: 7,
            pluginVersion: TEST_PLUGIN_VERSION
        }, {
            environment: 'production',
            frontendBuildId: '10.11.11',
            frontendCommitSha: 'abc123',
            jellyfinWebVersion: '10.11.11',
            pluginConnected: true
        });
        const compact = formatPtvBuildInfoCompact(info);

        expect(compact).toContain('commit=abc123');
        expect(compact).toContain('compatibility=patch-warning');
        expect(compact).not.toContain('http');
        expect(compact).not.toContain('\\');
    });
});
