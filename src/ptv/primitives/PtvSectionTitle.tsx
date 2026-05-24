import React, { HTMLAttributes, ReactNode } from 'react';

import { classNames } from './classNames';
import type { PtvPrimitiveSize } from './PtvPrimitiveContract';

type PtvSectionTitleElement = 'h1' | 'h2' | 'h3' | 'h4';

export type PtvSectionTitleProps = HTMLAttributes<HTMLHeadingElement> & {
    action?: ReactNode;
    as?: PtvSectionTitleElement;
    children?: ReactNode;
    eyebrow?: ReactNode;
    size?: PtvPrimitiveSize;
};

export default function PtvSectionTitle({
    action,
    as: Element = 'h2',
    children,
    className,
    eyebrow,
    size = 'md',
    ...props
}: PtvSectionTitleProps) {
    return (
        <div className={classNames('ptv-section-title-row', `ptv-section-title-${size}`)}>
            <div className='ptv-section-title-copy'>
                {eyebrow ? (
                    <div className='ptv-section-eyebrow'>
                        {eyebrow}
                    </div>
                ) : null}

                <Element
                    {...props}
                    className={classNames('ptv-section-title', className)}
                >
                    {children}
                </Element>
            </div>

            {action ? (
                <div className='ptv-section-title-action'>
                    {action}
                </div>
            ) : null}
        </div>
    );
}
