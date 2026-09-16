import { describe, expect, it } from 'vitest';

import { applyPtvArrApiKeyInputs } from './arrSettingsLifecycle';

function createService(enabled: boolean, apiKeyConfigured = true) {
    return {
        apiKey: null,
        apiKeyConfigured,
        enabled,
        externalUrl: '',
        internalUrl: 'https://servarr.internal'
    };
}

describe('Arr settings lifecycle', () => {
    it('preserves an explicit disabled state for a previously configured service', () => {
        const settings = {
            radarr: createService(true),
            sonarr: createService(false)
        };

        const result = applyPtvArrApiKeyInputs(settings, {
            radarr: '',
            sonarr: ''
        });

        expect(result.sonarr.enabled).toBe(false);
        expect(result.sonarr).not.toHaveProperty('apiKey');
        expect(result.radarr.enabled).toBe(true);
        expect(settings.sonarr).toMatchObject({ apiKey: null, enabled: false });
    });

    it('auto-enables only the service receiving a newly entered API key', () => {
        const settings = {
            radarr: createService(false),
            sonarr: createService(false, false)
        };

        const result = applyPtvArrApiKeyInputs(settings, {
            radarr: '',
            sonarr: '  disposable-key  '
        });

        expect(result.sonarr).toMatchObject({
            apiKey: 'disposable-key',
            enabled: true
        });
        expect(result.radarr.enabled).toBe(false);
        expect(result.radarr).not.toHaveProperty('apiKey');
    });
});
