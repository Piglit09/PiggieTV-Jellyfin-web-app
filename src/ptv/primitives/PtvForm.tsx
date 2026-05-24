import React, { FormHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

import { classNames } from './classNames';
import { getPtvDensityClass, type PtvPrimitiveDensity } from './PtvPrimitiveContract';

type PtvFormElement = 'form' | 'section' | 'div';

type PtvFormBaseProps = {
    as?: PtvFormElement;
    children?: ReactNode;
    className?: string;
    density?: PtvPrimitiveDensity;
};

export type PtvFormProps = PtvFormBaseProps
    & (
        FormHTMLAttributes<HTMLFormElement>
        | HTMLAttributes<HTMLElement>
    );

export default function PtvForm({
    as: Element = 'form',
    children,
    className,
    density = 'comfortable',
    ...props
}: PtvFormProps) {
    return React.createElement(
        Element,
        {
            ...props,
            className: classNames(
                'ptv-form',
                getPtvDensityClass(density),
                className
            )
        },
        children
    );
}
