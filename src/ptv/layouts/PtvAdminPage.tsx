import React from 'react';

import { classNames } from '../primitives/classNames';
import { getPtvDensityClass } from '../primitives/PtvPrimitiveContract';
import { PtvSectionTitle } from '../primitives';
import PTVShell, { type PtvShellSection } from '../shell/PTVShell';
import type { PtvLayoutBaseProps } from './layout.types';

export type PtvAdminPageProps = PtvLayoutBaseProps & {
    shell?: boolean;
    shellSection?: PtvShellSection;
};

export default function PtvAdminPage({
    action,
    children,
    className,
    density = 'comfortable',
    description,
    eyebrow,
    shell = true,
    shellSection = 'dashboard',
    title,
    width = 'medium',
    ...props
}: PtvAdminPageProps) {
    const hasHeader = Boolean(title || description || action);
    const titleContent = title ? (
        <PtvSectionTitle
            as='h1'
            size='lg'
            eyebrow={eyebrow}
            action={action}
        >
            {title}
        </PtvSectionTitle>
    ) : null;
    const standaloneAction = !title && action ? (
        <div className='ptv-layout-header-action'>
            {action}
        </div>
    ) : null;

    const content = (
        <section
            {...props}
            className={classNames(
                'ptv-layout',
                'ptv-admin-layout',
                `ptv-layout-${width}`,
                getPtvDensityClass(density),
                className
            )}
        >
            {hasHeader ? (
                <header className='ptv-layout-header'>
                    {titleContent}
                    {standaloneAction}

                    {description ? (
                        <p className='ptv-layout-description'>
                            {description}
                        </p>
                    ) : null}
                </header>
            ) : null}

            <div className='ptv-layout-body'>
                {children}
            </div>
        </section>
    );

    if (!shell) return content;

    return (
        <PTVShell
            className='ptv-admin-shell'
            section={shellSection}
            title={typeof title === 'string' ? title : 'Dashboard'}
        >
            {content}
        </PTVShell>
    );
}
