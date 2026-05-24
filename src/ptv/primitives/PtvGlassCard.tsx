import React, { HTMLAttributes, ReactNode } from 'react';

import { classNames } from './classNames';
import { getPtvElevationClass, type PtvPrimitiveElevation } from './PtvPrimitiveContract';

type PtvGlassCardElement = 'div' | 'article' | 'section' | 'li';
type PtvGlassCardTone = 'default' | 'quiet' | 'interactive' | 'elevated';

export type PtvGlassCardProps = HTMLAttributes<HTMLElement> & {
    as?: PtvGlassCardElement;
    children?: ReactNode;
    elevation?: PtvPrimitiveElevation;
    tone?: PtvGlassCardTone;
};

export default function PtvGlassCard({
    as: Element = 'div',
    children,
    className,
    elevation,
    tone = 'default',
    ...props
}: PtvGlassCardProps) {
    return React.createElement(
        Element,
        {
            ...props,
            className: classNames(
                'ptv-glass-card',
                `ptv-glass-card-${tone}`,
                typeof elevation === 'number' && getPtvElevationClass(elevation),
                className
            )
        },
        children
    );
}
