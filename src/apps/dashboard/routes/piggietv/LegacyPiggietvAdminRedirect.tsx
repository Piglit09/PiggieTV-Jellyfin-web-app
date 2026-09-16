import React from 'react';
import { Navigate } from 'react-router-dom';

export const LegacyPiggietvConfigurationRedirect = () => (
    <Navigate replace to='/settings/admin/piggietv' />
);

export const LegacyPiggietvRowsRedirect = () => (
    <Navigate replace to='/settings/admin/piggietv/rows' />
);

export const LegacyPiggietvDiagnosticsRedirect = () => (
    <Navigate replace to='/settings/admin/piggietv/diagnostics' />
);

export const LegacyPiggietvRecommendationsRedirect = LegacyPiggietvRowsRedirect;
