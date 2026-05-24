import React, { HTMLAttributes, ReactNode } from 'react';

import { classNames } from './classNames';
import type { PtvPrimitiveSize } from './PtvPrimitiveContract';

export type PtvDialogProps = HTMLAttributes<HTMLDivElement> & {
    children?: ReactNode;
    describedBy?: string;
    labelledBy?: string;
    open?: boolean;
    size?: PtvPrimitiveSize;
};

export default function PtvDialog({
    children,
    className,
    describedBy,
    labelledBy,
    open = true,
    role = 'dialog',
    size = 'md',
    ...props
}: PtvDialogProps) {
    if (!open) return null;

    return (
        <div
            {...props}
            aria-describedby={describedBy}
            aria-labelledby={labelledBy}
            aria-modal='true'
            className={classNames('ptv-dialog', `ptv-dialog-${size}`, className)}
            role={role}
        >
            {children}
        </div>
    );
}
