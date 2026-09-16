import React from 'react';

import PtvIcon from '../../../../icons/PtvIcon';

export function AdminPlaybackSectionHeading({
    description,
    fetching,
    title
}: Readonly<{
    description: string;
    fetching: boolean;
    title: string;
}>) {
    return (
        <header className='ptv-admin-playback-section-heading'>
            <div>
                <h2>{title}</h2>
                <p>{description}</p>
            </div>
            {fetching ? (
                <span aria-live='polite' className='ptv-admin-configuration-refreshing' role='status'>
                    <PtvIcon name='refresh' size='16px' />
                    Refreshing
                </span>
            ) : null}
        </header>
    );
}

export function parseWholeNumber(value: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (!/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function isConflictError(error: unknown) {
    return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'conflict';
}

/** Only exposes bounded, deliberately user-safe save outcomes from the service layer. */
export function getAdminPlaybackSaveErrorMessage(error: unknown, fallback: string) {
    if (typeof error !== 'object' || error === null) return fallback;
    const code = Reflect.get(error, 'code');
    const message = Reflect.get(error, 'message');
    return (
        (code === 'save-timeout' || code === 'save-unverified')
        && typeof message === 'string'
    ) ? message : fallback;
}
