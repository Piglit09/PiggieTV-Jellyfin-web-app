import { describe, expect, it } from 'vitest';

import {
    classifyPtvBuildCompatibility,
    formatPtvBuildInfoCompact,
    getPtvBuildInfo
} from './buildInfo';

const OLD_PLUGIN_VERSION = ['0', '4', '0', '0'].join('.');
const CURRENT_PLUGIN_VERSION = ['0', '5', '0', '0'].join('.');

const READING_OVERRIDES_FEATURE = {
    featureFlags: { readingSeriesOverrides: true },
    features: ['status', 'readingSeriesOverrides']
};

describe('PiggieTV build information', () => {
    it('uses explicit provenance fallbacks for direct module imports', () => {
        const info = getPtvBuildInfo();

        expect(info.compatibility).toBe('unknown');
        expect(info.pluginVersion).toBe('unknown');
        expect(info.cacheSchemaVersion).toBe(7);
        expect(info.frontendBuildDate).not.toBe('unknown');
        expect(info.frontendBuildId).not.toBe('unknown');
        expect(info.ptvWebVersion).not.toBe('unknown');
    });

    it('reports development and production overrides', () => {
        const development = getPtvBuildInfo(undefined, {
            environment: 'development',
            frontendBuildDate: '2026-07-14T12:00:00.000Z',
            frontendBuildId: 'dev-build',
            frontendCommitSha: 'abc123',
            jellyfinWebVersion: '10.11.11',
            ptvWebVersion: '0.5.0'
        });
        const production = getPtvBuildInfo(undefined, {
            environment: 'production',
            frontendBuildId: 'release-10.11.11'
        });

        expect(development.environment).toBe('development');
        expect(development.frontendBuildDate).toBe('2026-07-14T12:00:00.000Z');
        expect(development.jellyfinWebVersion).toBe('10.11.11');
        expect(development.ptvWebVersion).toBe('0.5.0');
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

    it('keeps the old plugin connected but requires an upgrade for Reading persistence', () => {
        const result = classifyPtvBuildCompatibility({
            apiVersion: 1,
            cacheVersion: 7,
            pluginVersion: OLD_PLUGIN_VERSION,
            features: ['status', 'featuredContent']
        }, {
            pluginConnected: true
        });

        expect(result.compatibility).toBe('capability-upgrade-required');
        expect(result.compatibilityMessage).toContain('Reading persistence support');
        expect(result.compatibilityMessage).toContain('server-persisted Reading corrections');
    });

    it('accepts independently versioned plugin 0.5.0.0 when API, cache, and capabilities match', () => {
        const result = classifyPtvBuildCompatibility({
            apiVersion: 1,
            cacheVersion: 7,
            pluginVersion: CURRENT_PLUGIN_VERSION,
            ...READING_OVERRIDES_FEATURE
        }, {
            pluginConnected: true
        });

        expect(result.compatibility).toBe('compatible');
    });

    it('formats a compact diagnostics representation without runtime locations', () => {
        const info = getPtvBuildInfo({
            apiVersion: 1,
            cacheVersion: 7,
            pluginVersion: CURRENT_PLUGIN_VERSION,
            ...READING_OVERRIDES_FEATURE
        }, {
            environment: 'production',
            frontendBuildId: '10.11.11',
            frontendCommitSha: 'abc123',
            jellyfinWebVersion: '10.11.11',
            ptvWebVersion: '0.5.0',
            pluginConnected: true
        });
        const compact = formatPtvBuildInfoCompact(info);

        expect(compact).toContain('commit=abc123');
        expect(compact).toContain('ptvWeb=0.5.0');
        expect(compact).toContain('readingOverrides=available');
        expect(compact).toContain('compatibility=compatible');
        expect(compact).not.toContain('http');
        expect(compact).not.toContain('\\');
    });
});
