import { Navigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import {
    LegacyPiggietvConfigurationRedirect,
    LegacyPiggietvDiagnosticsRedirect,
    LegacyPiggietvRecommendationsRedirect,
    LegacyPiggietvRowsRedirect
} from './LegacyPiggietvAdminRedirect';

describe('legacy PiggieTV administration redirects', () => {
    it.each([
        [ LegacyPiggietvConfigurationRedirect, '/settings/admin/piggietv' ],
        [ LegacyPiggietvRowsRedirect, '/settings/admin/piggietv/rows' ],
        [ LegacyPiggietvRecommendationsRedirect, '/settings/admin/piggietv/rows' ],
        [ LegacyPiggietvDiagnosticsRedirect, '/settings/admin/piggietv/diagnostics' ]
    ])('replaces history with the canonical native route', (Redirect, destination) => {
        const renderRedirect = Redirect;
        const navigate = renderRedirect();

        expect(navigate.type).toBe(Navigate);
        expect(navigate.props).toMatchObject({
            replace: true,
            to: destination
        });
    });
});
