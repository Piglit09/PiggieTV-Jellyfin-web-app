import React, { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';

import { useApi } from '../../../../../hooks/useApi';
import PtvIcon from '../../../icons/PtvIcon';
import { selectAdminDevices } from './adminPeopleAdapters';
import type {
    AdminPeopleDevice,
    AdminPeopleDeviceFilter
} from './adminPeopleModel';
import type { AdminDeviceRemovalSnapshot } from './adminPeopleService';
import { AdminDeviceRow } from './AdminPeoplePresentation';
import { useAdminDevices } from './useAdminPeople';

const ConfirmDialog = lazy(() => import('../../../../../components/ConfirmDialog'));

const DEVICE_FILTER_LABELS: Readonly<Record<AdminPeopleDeviceFilter, string>> = {
    all: 'All',
    active: 'Active',
    playing: 'Playing',
    inactive: 'Not active'
};

const DEVICE_FILTERS: readonly AdminPeopleDeviceFilter[] = [
    'all',
    'active',
    'playing',
    'inactive'
];
const DEVICE_RENDER_BATCH_SIZE = 50;

type PendingRemoval = Readonly<{
    device: AdminPeopleDevice;
    snapshot: AdminDeviceRemovalSnapshot;
}>;

/* eslint-disable react/jsx-no-bind, no-void, no-nested-ternary, sonarjs/no-nested-conditional, sonarjs/cognitive-complexity */

function DeviceListSkeleton() {
    return (
        <div aria-label='Loading registered devices' className='ptv-admin-device-list' role='status'>
            {Array.from({ length: 5 }, (_, index) => (
                <div className='ptv-admin-people-skeleton-row' key={index} />
            ))}
        </div>
    );
}

function removalCopy(pending: PendingRemoval) {
    const sessionUnit = pending.snapshot.activeSessionCount === 1 ? 'session' : 'sessions';
    const sessionWarning = pending.snapshot.hasActiveSessions ?
        ` This device currently has ${pending.snapshot.activeSessionCount} active ${sessionUnit}, which will end.` :
        ' No active sessions were reported during the latest check.';
    return `Removing this device revokes saved server access for every user on it and ends all matching sessions. It can register again after a future sign-in.${sessionWarning}`;
}

export default function PtvAdminDevicesPage() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const currentDeviceId = api?.deviceInfo?.id;
    const state = useAdminDevices(api, apiClient, currentDeviceId);
    const [ query, setQuery ] = useState('');
    const [ filter, setFilter ] = useState<AdminPeopleDeviceFilter>('all');
    const [ visibleDeviceCount, setVisibleDeviceCount ] = useState(DEVICE_RENDER_BATCH_SIZE);
    const [ pendingRemoval, setPendingRemoval ] = useState<PendingRemoval | null>(null);
    const [ feedback, setFeedback ] = useState('');
    const confirmRemovalFlightRef = useRef(false);
    const focusedActionRef = useRef<HTMLElement | null>(null);
    const visibleDevices = useMemo(() => selectAdminDevices(state.devices, {
        filter,
        query
    }), [filter, query, state.devices]);
    const renderedDevices = useMemo(
        () => visibleDevices.slice(0, visibleDeviceCount),
        [visibleDeviceCount, visibleDevices]
    );
    const updateQuery = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(event.currentTarget.value);
        setVisibleDeviceCount(DEVICE_RENDER_BATCH_SIZE);
    }, []);
    const selectFilter = useCallback((value: AdminPeopleDeviceFilter) => {
        setFilter(value);
        setVisibleDeviceCount(DEVICE_RENDER_BATCH_SIZE);
    }, []);
    const showMoreDevices = useCallback(() => {
        setVisibleDeviceCount(count => count + DEVICE_RENDER_BATCH_SIZE);
    }, []);
    const requestRemoval = useCallback(async (device: AdminPeopleDevice) => {
        focusedActionRef.current = document.activeElement as HTMLElement | null;
        setFeedback('');
        try {
            const snapshot = await state.prepareRemoval(device.id);
            setPendingRemoval({ device, snapshot });
        } catch {
            // The hook owns the safe, user-facing error message.
        }
    }, [state]);
    const closeRemoval = useCallback(() => {
        setPendingRemoval(null);
        requestAnimationFrame(() => focusedActionRef.current?.focus());
    }, []);
    const confirmRemoval = useCallback(async () => {
        if (!pendingRemoval || confirmRemovalFlightRef.current) return;
        confirmRemovalFlightRef.current = true;
        const name = pendingRemoval.device.name;
        try {
            const removed = await state.removeDevice(pendingRemoval.device.id);
            setPendingRemoval(null);
            if (removed) setFeedback(`${name} was removed and its saved server access was revoked.`);
            requestAnimationFrame(() => focusedActionRef.current?.focus());
        } finally {
            confirmRemovalFlightRef.current = false;
        }
    }, [pendingRemoval, state]);

    return (
        <section className='ptv-admin-people' data-testid='ptv-admin-devices'>
            <header className='ptv-admin-people-header'>
                <div>
                    <h1>Devices</h1>
                    <p>Review PiggieTV clients, active sessions and registered devices.</p>
                </div>
                <button
                    aria-busy={state.refreshing}
                    disabled={state.refreshing}
                    onClick={() => void state.refresh()}
                    type='button'
                >
                    <PtvIcon name='refresh' size='17px' />
                    {state.refreshing ? 'Refreshing…' : 'Refresh'}
                </button>
            </header>

            <div className='ptv-admin-people-toolbar'>
                <label className='ptv-admin-people-search' htmlFor='ptv-admin-device-search'>
                    <PtvIcon name='search' size='18px' />
                    <input
                        aria-label='Search registered devices'
                        id='ptv-admin-device-search'
                        onChange={updateQuery}
                        placeholder='Search device, client or user…'
                        type='search'
                        value={query}
                    />
                </label>
                <div aria-label='Filter registered devices' className='ptv-admin-people-filters' role='group'>
                    {DEVICE_FILTERS.map(value => (
                        <button
                            aria-pressed={filter === value}
                            className='ptv-admin-people-filter'
                            key={value}
                            onClick={() => selectFilter(value)}
                            type='button'
                        >
                            {DEVICE_FILTER_LABELS[value]}
                        </button>
                    ))}
                </div>
                <span aria-live='polite' className='ptv-admin-people-result-count'>
                    {state.initialLoading ? 'Loading devices…' : (
                        `${visibleDevices.length} ${visibleDevices.length === 1 ? 'device' : 'devices'}`
                    )}
                </span>
            </div>

            {state.sessionsError && !state.registryError ? (
                <aside className='ptv-admin-people-notice' role='status'>
                    <PtvIcon name='alerts' size='21px' />
                    <div>
                        <strong>Session state is unavailable</strong>
                        <p>Registered devices remain visible. PiggieTV will not label them inactive while session status is unknown.</p>
                    </div>
                </aside>
            ) : null}
            {state.usersError && !state.registryError ? (
                <aside className='ptv-admin-people-notice' role='status'>
                    <PtvIcon name='users' size='21px' />
                    <div><strong>User mapping is unavailable</strong><p>Device and session data remains usable without current account enrichment.</p></div>
                </aside>
            ) : null}
            {state.removalError ? <p aria-live='assertive' className='ptv-admin-people-notice' role='alert'>{state.removalError}</p> : null}
            {feedback ? <p aria-live='polite' className='ptv-admin-people-notice' role='status'>{feedback}</p> : null}

            {state.initialLoading ? <DeviceListSkeleton /> : state.registryError ? (
                <div className='ptv-admin-people-error' role='alert'>
                    <PtvIcon name='alerts' size='31px' />
                    <h2>Devices couldn&apos;t be loaded.</h2>
                    <p>Administration navigation remains available while you retry.</p>
                    <button onClick={() => void state.refresh()} type='button'>Retry devices</button>
                </div>
            ) : visibleDevices.length > 0 ? (
                <div className='ptv-admin-device-list'>
                    {renderedDevices.map(device => (
                        <AdminDeviceRow
                            busy={state.removalBusy}
                            device={device}
                            key={device.id.toLocaleLowerCase()}
                            onRemove={requestRemoval}
                        />
                    ))}
                    {renderedDevices.length < visibleDevices.length ? (
                        <div className='ptv-admin-device-more'>
                            <span>Showing {renderedDevices.length} of {visibleDevices.length} devices</span>
                            <button onClick={showMoreDevices} type='button'>Show 50 more</button>
                        </div>
                    ) : null}
                </div>
            ) : (
                <div className='ptv-admin-people-empty'>
                    <PtvIcon name='devices' size='31px' />
                    <h2>{query || filter !== 'all' ? 'No devices match this view.' : 'No registered devices found.'}</h2>
                    <p>{query || filter !== 'all' ? 'Try another search or filter.' : 'Devices appear after a client signs in to this server.'}</p>
                </div>
            )}

            {pendingRemoval ? (
                <Suspense fallback={null}>
                    <ConfirmDialog
                        className='ptv-admin-device-dialog'
                        confirmButtonColor='error'
                        confirmButtonText={state.removalBusy ? 'Removing…' : 'Remove Device'}
                        onCancel={closeRemoval}
                        onConfirm={() => void confirmRemoval()}
                        open
                        text={removalCopy(pendingRemoval)}
                        title={`Remove ${pendingRemoval.device.name}?`}
                    />
                </Suspense>
            ) : null}
        </section>
    );
}

/* eslint-enable react/jsx-no-bind, no-void, no-nested-ternary, sonarjs/no-nested-conditional, sonarjs/cognitive-complexity */
