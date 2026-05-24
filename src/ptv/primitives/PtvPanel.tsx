import React, { HTMLAttributes, ReactNode } from 'react';

import { classNames } from './classNames';
import {
    getPtvDensityClass,
    getPtvElevationClass,
    type PtvPrimitiveDensity,
    type PtvPrimitiveElevation
} from './PtvPrimitiveContract';

type PtvPanelElement = 'section' | 'div' | 'article' | 'aside';
type PtvPanelVariant = 'default' | 'subtle' | 'strong' | 'flat';

export type PtvPanelProps = HTMLAttributes<HTMLElement> & {
    as?: PtvPanelElement;
    children?: ReactNode;
    density?: PtvPrimitiveDensity;
    elevation?: PtvPrimitiveElevation;
    variant?: PtvPanelVariant;
};

export default function PtvPanel({
    as: Element = 'section',
    children,
    className,
    density = 'comfortable',
    elevation,
    variant = 'default',
    ...props
}: PtvPanelProps) {
    return React.createElement(
        Element,
        {
            ...props,
            className: classNames(
                'ptv-panel',
                `ptv-panel-${variant}`,
                getPtvDensityClass(density),
                typeof elevation === 'number' && getPtvElevationClass(elevation),
                className
            )
        },
        children
    );
}
