import React, { ReactNode } from 'react';

import { classNames } from '../primitives/classNames';
import { PtvPanel, PtvTable } from '../primitives';
import PtvAdminPage, { PtvAdminPageProps } from './PtvAdminPage';

export type PtvDataTablePageProps = PtvAdminPageProps & {
    tableCaption?: ReactNode;
    toolbar?: ReactNode;
};

export default function PtvDataTablePage({
    children,
    className,
    density = 'comfortable',
    tableCaption,
    toolbar,
    width = 'wide',
    ...props
}: PtvDataTablePageProps) {
    return (
        <PtvAdminPage
            {...props}
            className={classNames('ptv-data-table-layout', className)}
            density={density}
            width={width}
        >
            <PtvPanel
                className='ptv-data-table-panel'
                density={density}
                variant='default'
            >
                {toolbar ? (
                    <div className='ptv-data-table-toolbar'>
                        {toolbar}
                    </div>
                ) : null}

                <PtvTable
                    caption={tableCaption}
                    density={density}
                >
                    {children}
                </PtvTable>
            </PtvPanel>
        </PtvAdminPage>
    );
}
