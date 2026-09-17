import React from 'react';

function SkeletonLine({ width }: Readonly<{ width: string }>) {
    return <span className='ptv-admin-skeleton-line' style={{ width }} />;
}

export function AdminStatusCardSkeleton({ label }: Readonly<{ label: string }>) {
    return (
        <article aria-busy='true' aria-label={`Loading ${label}`} className='ptv-admin-status-card is-loading ptv-glass-card'>
            <div className='ptv-admin-skeleton-heading'>
                <span className='ptv-admin-skeleton-icon' />
                <div>
                    <SkeletonLine width='7.5rem' />
                    <SkeletonLine width='4.8rem' />
                </div>
            </div>
            <SkeletonLine width='78%' />
            <SkeletonLine width='62%' />
        </article>
    );
}

export function AdminPanelSkeleton({ label }: Readonly<{ label: string }>) {
    return (
        <section aria-busy='true' aria-label={`Loading ${label}`} className='ptv-admin-panel is-loading ptv-glass-card'>
            <SkeletonLine width='10rem' />
            <div className='ptv-admin-skeleton-row'><SkeletonLine width='82%' /><SkeletonLine width='18%' /></div>
            <div className='ptv-admin-skeleton-row'><SkeletonLine width='70%' /><SkeletonLine width='24%' /></div>
        </section>
    );
}
