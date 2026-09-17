import React from 'react';
import { Link } from 'react-router-dom';

import PtvIcon from '../../icons/PtvIcon';
import { getPtvAdminDestination } from '../admin/adminNavigation';
import { SettingsGroup, SettingsPageHeader } from '../SettingsPrimitives';

const LIBRARY_DESTINATION_IDS = [ 'libraries', 'library-display' ] as const;
const METADATA_DESTINATION_IDS = [ 'library-metadata', 'nfo-settings', 'metadata-quality', 'metadata-manager' ] as const;

function MediaDestinationLink({ destinationId }: Readonly<{ destinationId: string }>) {
    const destination = getPtvAdminDestination(destinationId);
    if (!destination) return null;

    const content = (
        <>
            <PtvIcon name={destination.icon} size='25px' />
            <span>
                <strong>{destination.label}</strong>
                <small>{destination.description}</small>
            </span>
            <PtvIcon name='right' size='17px' />
        </>
    );

    if (destination.routeKind === 'router') {
        return <Link to={destination.href}>{content}</Link>;
    }

    return <a href={destination.href}>{content}</a>;
}

export default function MediaSettings() {
    return (
        <div className='ptv-settings-section-page'>
            <SettingsPageHeader
                description='Keep the PiggieTV catalog organized and presentation-ready.'
                title='Media Management'
            />

            <SettingsGroup title='Library administration'>
                <div className='ptv-settings-admin-grid'>
                    {LIBRARY_DESTINATION_IDS.map(destinationId => (
                        <MediaDestinationLink destinationId={destinationId} key={destinationId} />
                    ))}
                </div>
            </SettingsGroup>

            <SettingsGroup title='Metadata tools'>
                <div className='ptv-settings-admin-grid'>
                    {METADATA_DESTINATION_IDS.map(destinationId => (
                        <MediaDestinationLink destinationId={destinationId} key={destinationId} />
                    ))}
                </div>
            </SettingsGroup>

            <p className='ptv-settings-platform-note'>Media changes use the installation’s existing library and metadata services.</p>
        </div>
    );
}
