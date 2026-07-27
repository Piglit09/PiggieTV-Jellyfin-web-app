import { describe, expect, it } from 'vitest';

import {
    createPtvClientCapabilityReport,
    hasAllPtvClientCapabilities,
    hasPtvClientCapability
} from '../capabilities/clientCapabilities';
import {
    createPtvFeatureFlagDocument,
    getPtvFeatureFlag,
    setPtvFeatureFlag
} from '../featureFlags/featureFlagContracts';
import {
    jellyfinTicksToMilliseconds,
    millisecondsToJellyfinTicks,
    normalizePtvCoreMediaType
} from '../media/mediaContracts';

describe('PTV Core shared contracts', () => {
    it('normalizes media types and Jellyfin playback units', () => {
        expect(normalizePtvCoreMediaType('Series')).toBe('show');
        expect(normalizePtvCoreMediaType('AudioAlbum')).toBe('album');
        expect(normalizePtvCoreMediaType('not-new-yet')).toBe('unknown');
        expect(jellyfinTicksToMilliseconds(50_000)).toBe(5);
        expect(millisecondsToJellyfinTicks(5)).toBe(50_000);
    });

    it('provides defaulted, immutable-style feature flag access while preserving unknown flags', () => {
        const document = createPtvFeatureFlagDocument({
            scope: { kind: 'user', serverId: 'server-1', userId: 'user-1' },
            values: { futureFlag: true, recommendations: false }
        });

        expect(getPtvFeatureFlag(document, 'recommendations', { recommendations: true })).toBe(false);
        expect(getPtvFeatureFlag(document, 'missing', { missing: true })).toBe(true);
        const updated = setPtvFeatureFlag(document, 'recommendations', true, '2026-07-22T12:00:00.000Z');
        expect(updated.values).toEqual({ futureFlag: true, recommendations: true });
        expect(document.values.recommendations).toBe(false);
    });

    it('declares capabilities without removing existing detection fallbacks', () => {
        const report = createPtvClientCapabilityReport({
            capabilities: {
                audioPlayback: true,
                futureCapability: true,
                remoteInput: false,
                videoPlayback: true
            },
            deviceClass: 'tv',
            platform: 'android-tv'
        });

        expect(hasPtvClientCapability(report, 'videoPlayback')).toBe(true);
        expect(hasPtvClientCapability(report, 'remoteInput')).toBe(false);
        expect(hasPtvClientCapability(report, 'futureCapability')).toBe(true);
        expect(hasAllPtvClientCapabilities(report, ['audioPlayback', 'videoPlayback'])).toBe(true);
    });
});
