import React from 'react';
import { Navigate } from 'react-router-dom';

const LIBRARIES_ROUTE = '/settings/admin/libraries';
const LIBRARY_DISPLAY_ROUTE = '/settings/admin/libraries/display';
const LIBRARY_METADATA_ROUTE = '/settings/admin/libraries/metadata';
const LIBRARY_NFO_ROUTE = '/settings/admin/libraries/nfo';

/** Redirects only the migrated legacy Libraries landing route. */
export function LegacyLibrariesRedirect() {
    return <Navigate replace to={LIBRARIES_ROUTE} />;
}

/** Redirects only the migrated legacy Library Display route. */
export function LegacyLibraryDisplayRedirect() {
    return <Navigate replace to={LIBRARY_DISPLAY_ROUTE} />;
}

/** Redirects only the migrated legacy Metadata settings route. */
export function LegacyLibraryMetadataRedirect() {
    return <Navigate replace to={LIBRARY_METADATA_ROUTE} />;
}

/** Redirects only the migrated legacy NFO settings route. */
export function LegacyLibraryNfoRedirect() {
    return <Navigate replace to={LIBRARY_NFO_ROUTE} />;
}
