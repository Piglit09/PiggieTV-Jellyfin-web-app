import React, { HTMLAttributes, ReactNode } from 'react';

import { classNames } from './classNames';

export type PtvOverlayProps = HTMLAttributes<HTMLDivElement> & {
    children?: ReactNode;
    open?: boolean;
};

export default function PtvOverlay({
    children,
    className,
    open = true,
    ...props
}: PtvOverlayProps) {
    if (!open) return null;

    return (
        <div
            {...props}
            className={classNames('ptv-overlay', className)}
        >
            {children}
        </div>
    );
}
