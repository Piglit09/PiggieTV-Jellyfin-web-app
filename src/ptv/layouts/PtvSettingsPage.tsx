import React from 'react';

import { classNames } from '../primitives/classNames';
import { PtvPanel } from '../primitives';
import PtvAdminPage, { PtvAdminPageProps } from './PtvAdminPage';

export type PtvSettingsPageProps = PtvAdminPageProps & {
    panel?: boolean;
};

export default function PtvSettingsPage({
    children,
    className,
    density = 'dense',
    panel = true,
    width = 'narrow',
    ...props
}: PtvSettingsPageProps) {
    return (
        <PtvAdminPage
            {...props}
            className={classNames('ptv-settings-layout', className)}
            density={density}
            width={width}
        >
            {panel ? (
                <PtvPanel
                    className='ptv-settings-layout-panel'
                    density={density}
                    variant='default'
                >
                    {children}
                </PtvPanel>
            ) : children}
        </PtvAdminPage>
    );
}
