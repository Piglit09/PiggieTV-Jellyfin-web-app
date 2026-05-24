import type { HTMLAttributes, ReactNode } from 'react';
import type { PtvPrimitiveDensity } from '../primitives/PtvPrimitiveContract';

export type PtvLayoutDensity = PtvPrimitiveDensity;
export type PtvLayoutWidth = 'narrow' | 'medium' | 'wide' | 'fluid';

export type PtvLayoutBaseProps = HTMLAttributes<HTMLElement> & {
    action?: ReactNode;
    children?: ReactNode;
    density?: PtvLayoutDensity;
    description?: ReactNode;
    eyebrow?: ReactNode;
    title?: ReactNode;
    width?: PtvLayoutWidth;
};
