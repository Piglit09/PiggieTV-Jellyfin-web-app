import React, { ReactNode } from 'react';

import { classNames } from '../primitives/classNames';
import PtvAdminPage, { PtvAdminPageProps } from './PtvAdminPage';

export type PtvMediaGridPageProps = PtvAdminPageProps & {
    filters?: ReactNode;
};

export default function PtvMediaGridPage({
    children,
    className,
    density = 'comfortable',
    filters,
    width = 'fluid',
    ...props
}: PtvMediaGridPageProps) {
    return (
        <PtvAdminPage
            {...props}
            className={classNames('ptv-media-grid-layout', className)}
            density={density}
            width={width}
        >
            {filters ? (
                <div className='ptv-media-grid-filters'>
                    {filters}
                </div>
            ) : null}

            <div className='ptv-media-grid'>
                {children}
            </div>
        </PtvAdminPage>
    );
}
