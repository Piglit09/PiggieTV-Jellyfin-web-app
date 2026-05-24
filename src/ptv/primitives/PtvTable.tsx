import React, { ReactNode, TableHTMLAttributes } from 'react';

import { classNames } from './classNames';
import { getPtvDensityClass, type PtvPrimitiveDensity } from './PtvPrimitiveContract';

export type PtvTableProps = TableHTMLAttributes<HTMLTableElement> & {
    caption?: ReactNode;
    children?: ReactNode;
    density?: PtvPrimitiveDensity;
    shellClassName?: string;
};

export default function PtvTable({
    caption,
    children,
    className,
    density = 'comfortable',
    shellClassName,
    ...props
}: PtvTableProps) {
    return (
        <div className={classNames('ptv-table-shell', getPtvDensityClass(density), shellClassName)}>
            <table
                {...props}
                className={classNames('ptv-table', className)}
            >
                {caption ? (
                    <caption className='ptv-table-caption'>
                        {caption}
                    </caption>
                ) : null}
                {children}
            </table>
        </div>
    );
}
