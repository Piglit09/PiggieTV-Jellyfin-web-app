import React, { HTMLAttributes } from 'react';

import { classNames } from './classNames';
import PtvButton from './PtvButton';

export type PtvPaginationProps = Omit<HTMLAttributes<HTMLElement>, 'onChange'> & {
    currentPage: number;
    onPageChange?: (page: number) => void;
    pageCount: number;
};

function getVisiblePages(currentPage: number, pageCount: number): number[] {
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(pageCount, start + 4);
    const adjustedStart = Math.max(1, end - 4);

    return Array.from({ length: end - adjustedStart + 1 }, (_, index) => adjustedStart + index);
}

export default function PtvPagination({
    className,
    currentPage,
    onPageChange,
    pageCount,
    ...props
}: PtvPaginationProps) {
    const clampedPage = Math.min(Math.max(currentPage, 1), Math.max(pageCount, 1));
    const pages = getVisiblePages(clampedPage, Math.max(pageCount, 1));

    function handlePreviousPage() {
        onPageChange?.(clampedPage - 1);
    }

    function handleNextPage() {
        onPageChange?.(clampedPage + 1);
    }

    function handlePageClick(event: React.MouseEvent<HTMLButtonElement>) {
        const page = Number(event.currentTarget.dataset.page);

        if (Number.isFinite(page)) {
            onPageChange?.(page);
        }
    }

    return (
        <nav
            {...props}
            aria-label='Pagination'
            className={classNames('ptv-pagination', className)}
        >
            <PtvButton
                className='ptv-pagination-item'
                disabled={clampedPage <= 1}
                // eslint-disable-next-line react/jsx-no-bind
                onClick={handlePreviousPage}
                size='sm'
                variant='ghost'
            >
                Previous
            </PtvButton>

            {pages.map((page) => (
                <PtvButton
                    aria-current={page === clampedPage ? 'page' : undefined}
                    className='ptv-pagination-item'
                    data-page={page}
                    isActive={page === clampedPage}
                    key={page}
                    // eslint-disable-next-line react/jsx-no-bind
                    onClick={handlePageClick}
                    size='sm'
                    variant={page === clampedPage ? 'primary' : 'ghost'}
                >
                    {page}
                </PtvButton>
            ))}

            <PtvButton
                className='ptv-pagination-item'
                disabled={clampedPage >= pageCount}
                // eslint-disable-next-line react/jsx-no-bind
                onClick={handleNextPage}
                size='sm'
                variant='ghost'
            >
                Next
            </PtvButton>
        </nav>
    );
}
