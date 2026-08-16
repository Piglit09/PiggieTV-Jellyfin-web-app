import { describe, expect, it } from 'vitest';

import { LegacyPiggietvDiagnosticsRedirect } from './LegacyPiggietvAdminRedirect';
import { Component } from './diagnostics';

describe('PiggieTV diagnostics admin route', () => {
    it('keeps the protected legacy route as a replacement redirect', () => {
        expect(Component).toBe(LegacyPiggietvDiagnosticsRedirect);
    });
});
