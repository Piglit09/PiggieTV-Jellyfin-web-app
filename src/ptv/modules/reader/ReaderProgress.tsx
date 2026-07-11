/* eslint-disable sonarjs/prefer-read-only-props */
import React from 'react';

interface ReaderProgressProps {
    percent: number;
    label?: string;
}

export function ReaderProgress({ percent, label }: ReaderProgressProps) {
    const normalized = Math.max(0, Math.min(100, percent || 0));

    return (
        <div className='ptv-reader-progress' aria-label='Reading progress'>
            <div className='ptv-reader-progress__track'>
                <div className='ptv-reader-progress__bar' style={{ width: `${normalized}%` }} />
            </div>
            <span className='ptv-reader-progress__label'>{label || `${Math.round(normalized)}%`}</span>
        </div>
    );
}

/* eslint-enable sonarjs/prefer-read-only-props */
