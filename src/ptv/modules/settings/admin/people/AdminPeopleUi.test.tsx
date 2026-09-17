import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
    MemoryRouter,
    useLocation
} from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    AdminPeopleActivityEntry,
    AdminPeopleDevice,
    AdminPeopleSession
} from './adminPeopleModel';

/* eslint-disable @typescript-eslint/naming-convention */

const uiMocks = vi.hoisted(() => ({
    activityState: null as unknown,
    devicesState: null as unknown,
    useAdminActivity: vi.fn(),
    useAdminDevices: vi.fn()
}));

vi.mock('../../../../../hooks/useApi', () => ({
    useApi: () => ({
        __legacyApiClient__: { serverId: () => 'server-a' },
        api: { deviceInfo: { id: 'current-device' } },
        user: { Id: 'admin-a', Policy: { IsAdministrator: true } }
    })
}));

vi.mock('./useAdminPeople', () => ({
    useAdminActivity: uiMocks.useAdminActivity,
    useAdminDevices: uiMocks.useAdminDevices
}));

vi.mock('../../../icons/PtvIcon', () => ({
    default: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
}));

vi.mock('../../../../../components/ConfirmDialog', () => ({
    default: ({
        confirmButtonText,
        onCancel,
        onConfirm,
        open,
        text,
        title
    }: Readonly<{
        confirmButtonText: string;
        onCancel: () => void;
        onConfirm: () => void;
        open: boolean;
        text: string;
        title: string;
    }>) => open ? (
        <div role='dialog'>
            <h2>{title}</h2>
            <p>{text}</p>
            <button onClick={onCancel} type='button'>Cancel confirmation</button>
            <button onClick={onConfirm} type='button'>{confirmButtonText}</button>
        </div>
    ) : null
}));

import PtvAdminActivityPage from './PtvAdminActivityPage';
import PtvAdminDevicesPage from './PtvAdminDevicesPage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function adminSession(overrides: Partial<AdminPeopleSession> = {}): AdminPeopleSession {
    return {
        active: true,
        clientName: 'PiggieTV Web',
        clientVersion: '0.5.20',
        deviceId: 'living-room',
        deviceName: 'Living Room TV',
        deviceType: 'Browser',
        lastActivityAt: '2026-08-12T12:00:00.000Z',
        mediaSubtitle: null,
        mediaTitle: null,
        mediaType: null,
        paused: false,
        playbackMethod: 'unknown',
        playbackMethodLabel: 'Unknown',
        playing: false,
        sessionId: 'session-a',
        status: 'active',
        statusLabel: 'Active',
        user: { id: 'user-a', isCurrentUser: true, username: 'Piggie' },
        ...overrides
    };
}

function adminDevice(overrides: Partial<AdminPeopleDevice> = {}): AdminPeopleDevice {
    return {
        activeSessionCount: 1,
        appName: 'PiggieTV Web',
        appVersion: '0.5.20',
        canRemove: true,
        current: false,
        id: 'living-room',
        lastSeenAt: '2026-08-12T12:00:00.000Z',
        name: 'Living Room TV',
        pausedSessionCount: 0,
        playingSessionCount: 0,
        registered: true,
        registrationIds: [ 'living-room' ],
        registryEntryCount: 1,
        sessionSourceState: 'ready',
        sessions: [ adminSession() ],
        status: 'active',
        statusLabel: 'Active',
        userSourceState: 'ready',
        users: [ { id: 'user-a', isCurrentUser: true, username: 'Piggie' } ],
        ...overrides
    };
}

function activityEntry(overrides: Partial<AdminPeopleActivityEntry> = {}): AdminPeopleActivityEntry {
    return {
        category: 'user',
        categoryLabel: 'User',
        createdAt: '2026-08-12T12:00:00.000Z',
        description: 'Piggie signed in.',
        id: '1',
        itemId: null,
        name: 'Signed in',
        severity: 'info',
        severityLabel: 'Info',
        type: 'AuthenticationSucceeded',
        user: { id: 'user-a', isCurrentUser: true, username: 'Piggie' },
        ...overrides
    };
}

function devicesState(overrides: Record<string, unknown> = {}) {
    return {
        devices: [ adminDevice() ],
        initialLoading: false,
        prepareRemoval: vi.fn(async () => ({
            activeSessionCount: 1,
            deviceId: 'living-room',
            deviceName: 'Living Room TV',
            hasActiveSessions: true
        })),
        refresh: vi.fn(async () => undefined),
        refreshing: false,
        registryError: false,
        removalBusy: false,
        removalError: null,
        removeDevice: vi.fn(async () => true),
        sessionsError: false,
        usersError: false,
        ...overrides
    };
}

function activityState(overrides: Record<string, unknown> = {}) {
    return {
        entries: [ activityEntry() ],
        error: false,
        initialLoading: false,
        pageSize: 50,
        refresh: vi.fn(async () => undefined),
        refreshing: false,
        startIndex: 0,
        totalCount: 1,
        usersError: false,
        ...overrides
    };
}

function changeInput(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonWithText(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('button')).find(button => button.textContent === text);
}

function LocationProbe() {
    const location = useLocation();
    return <output data-testid='location'>{`${location.pathname}${location.search}`}</output>;
}

async function flushAsync() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('PiggieTV administrator Devices and Activity UI', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        uiMocks.devicesState = devicesState();
        uiMocks.activityState = activityState();
        uiMocks.useAdminDevices.mockImplementation(() => uiMocks.devicesState);
        uiMocks.useAdminActivity.mockImplementation(() => uiMocks.activityState);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    function renderDevices() {
        return act(async () => root.render(
            <MemoryRouter><PtvAdminDevicesPage /></MemoryRouter>
        ));
    }

    function renderActivity(initialEntry = '/settings/admin/activity') {
        return act(async () => root.render(
            <MemoryRouter initialEntries={[ initialEntry ]}>
                <PtvAdminActivityPage />
                <LocationProbe />
            </MemoryRouter>
        ));
    }

    it('renders device/session data and supports local search and status filters', async () => {
        uiMocks.devicesState = devicesState({
            devices: [
                adminDevice(),
                adminDevice({
                    activeSessionCount: 0,
                    appName: 'Android TV',
                    canRemove: false,
                    current: true,
                    id: 'current-device',
                    name: 'Bedroom Shield',
                    sessions: [],
                    status: 'not-active',
                    statusLabel: 'Not active',
                    users: [ { id: 'user-b', isCurrentUser: true, username: 'Alex' } ]
                })
            ]
        });
        await renderDevices();

        expect(container.querySelectorAll('.ptv-admin-device-row')).toHaveLength(2);
        expect(container.textContent).toContain('PiggieTV Web 0.5.20');
        expect(container.textContent).toContain('1 active session');
        expect(container.textContent).toContain('Current device');
        const search = container.querySelector<HTMLInputElement>('#ptv-admin-device-search')!;
        await act(async () => changeInput(search, 'shield'));
        expect(container.querySelectorAll('.ptv-admin-device-row')).toHaveLength(1);
        expect(container.textContent).toContain('Bedroom Shield');

        await act(async () => changeInput(search, ''));
        await act(async () => buttonWithText(container, 'Playing')?.click());
        expect(container.textContent).toContain('No devices match this view.');
        await act(async () => buttonWithText(container, 'Not active')?.click());
        expect(container.querySelectorAll('.ptv-admin-device-row')).toHaveLength(1);
        expect(container.textContent).toContain('Bedroom Shield');
    });

    it('progressively renders large registered-device inventories without limiting search scope', async () => {
        uiMocks.devicesState = devicesState({
            devices: Array.from({ length: 55 }, (_, index) => adminDevice({
                id: `device-${index}`,
                name: `Device ${index}`,
                registrationIds: [ `device-${index}` ],
                sessions: []
            }))
        });
        await renderDevices();

        expect(container.querySelectorAll('.ptv-admin-device-row')).toHaveLength(50);
        expect(container.textContent).toContain('Showing 50 of 55 devices');
        await act(async () => buttonWithText(container, 'Show 50 more')?.click());
        expect(container.querySelectorAll('.ptv-admin-device-row')).toHaveLength(55);

        const search = container.querySelector<HTMLInputElement>('#ptv-admin-device-search')!;
        await act(async () => changeInput(search, 'Device 54'));
        expect(container.querySelectorAll('.ptv-admin-device-row')).toHaveLength(1);
        expect(container.textContent).toContain('Device 54');
    });

    it('distinguishes loading, authoritative empty, and registry failure with Retry', async () => {
        uiMocks.devicesState = devicesState({ initialLoading: true });
        await renderDevices();
        expect(container.querySelector('[aria-label="Loading registered devices"]')).not.toBeNull();

        uiMocks.devicesState = devicesState({ devices: [] });
        await renderDevices();
        expect(container.textContent).toContain('No registered devices found.');

        const refresh = vi.fn(async () => undefined);
        uiMocks.devicesState = devicesState({ devices: [], refresh, registryError: true });
        await renderDevices();
        expect(container.textContent).toContain("Devices couldn't be loaded.");
        await act(async () => buttonWithText(container, 'Retry devices')?.click());
        expect(refresh).toHaveBeenCalledOnce();
    });

    it('keeps registered devices visible through independent session and user failures', async () => {
        uiMocks.devicesState = devicesState({ sessionsError: true, usersError: true });
        await renderDevices();

        expect(container.querySelectorAll('.ptv-admin-device-row')).toHaveLength(1);
        expect(container.textContent).toContain('Session state is unavailable');
        expect(container.textContent).toContain('PiggieTV will not label them inactive');
        expect(container.textContent).toContain('User mapping is unavailable');
    });

    it('prepares removal, shows the active-session warning, and supports Cancel', async () => {
        const prepareRemoval = vi.fn(async () => ({
            activeSessionCount: 1,
            deviceId: 'living-room',
            deviceName: 'Living Room TV',
            hasActiveSessions: true
        }));
        uiMocks.devicesState = devicesState({ prepareRemoval });
        await renderDevices();
        await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove Living Room TV"]')?.click());
        await flushAsync();

        expect(prepareRemoval).toHaveBeenCalledWith('living-room');
        const dialog = container.querySelector('[role="dialog"]');
        expect(dialog?.textContent).toContain('Remove Living Room TV?');
        expect(dialog?.textContent).toContain('1 active session, which will end');
        expect(dialog?.textContent).toContain('revokes saved server access for every user');
        await act(async () => buttonWithText(container, 'Cancel confirmation')?.click());
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('does not optimistically hide a device and ignores duplicate confirmation submits', async () => {
        const pending = deferred<boolean>();
        const removeDevice = vi.fn(() => pending.promise);
        uiMocks.devicesState = devicesState({ removeDevice });
        await renderDevices();
        await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove Living Room TV"]')?.click());
        await flushAsync();
        const confirm = buttonWithText(container, 'Remove Device')!;
        act(() => {
            confirm.click();
            confirm.click();
        });

        expect(removeDevice).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('Living Room TV');
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        pending.resolve(true);
        await flushAsync();
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(container.textContent).toContain('saved server access was revoked');
    });

    it('keeps the device visible, closes stale confirmation, and renders the hook-safe error when removal fails', async () => {
        const removeDevice = vi.fn(async () => false);
        uiMocks.devicesState = devicesState({ removeDevice });
        await renderDevices();
        await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove Living Room TV"]')?.click());
        await flushAsync();
        await act(async () => buttonWithText(container, 'Remove Device')?.click());
        await flushAsync();
        uiMocks.devicesState = devicesState({
            removeDevice,
            removalError: 'This device session state changed. Review it again before removing the device.'
        });
        await renderDevices();

        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(container.querySelectorAll('.ptv-admin-device-row')).toHaveLength(1);
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('session state changed');
    });

    it('renders Activity rows, unknown events, and safe user/item links', async () => {
        uiMocks.activityState = activityState({
            entries: [
                activityEntry({
                    category: 'playback',
                    categoryLabel: 'Playback',
                    itemId: 'item/a',
                    name: 'Playback started'
                }),
                activityEntry({
                    category: 'other',
                    categoryLabel: 'Other',
                    description: null,
                    id: '2',
                    name: 'Unrecognized server event',
                    severity: 'unknown',
                    severityLabel: 'Unknown',
                    type: 'FuturePluginEvent',
                    user: null
                })
            ],
            totalCount: 2
        });
        await renderActivity();

        expect(container.querySelectorAll('.ptv-admin-activity-row')).toHaveLength(2);
        expect(container.querySelector('input[aria-label="Search loaded activity entries"]')).not.toBeNull();
        expect(container.textContent).toContain('Unrecognized server event');
        expect(container.textContent).toContain('Unknown');
        expect(container.querySelector<HTMLAnchorElement>('a[href="/settings/admin/users/user-a"]')).not.toBeNull();
        expect(container.querySelector<HTMLAnchorElement>('a[href="/settings/admin/media/metadata-manager/item%2Fa"]')).not.toBeNull();
    });

    it('writes canonical All/User/System query state and resets pagination on view change', async () => {
        await renderActivity('/settings/admin/activity?page=3');
        expect(uiMocks.useAdminActivity).toHaveBeenLastCalledWith(
            expect.anything(), expect.anything(), { pageIndex: 2, view: 'all' }
        );
        await act(async () => buttonWithText(container, 'User')?.click());
        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/activity?view=user');
        expect(uiMocks.useAdminActivity).toHaveBeenLastCalledWith(
            expect.anything(), expect.anything(), { pageIndex: 0, view: 'user' }
        );
        await act(async () => buttonWithText(container, 'System')?.click());
        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/activity?view=system');
        await act(async () => buttonWithText(container, 'All')?.click());
        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/activity');
    });

    it('paginates through server pages without turning local search into a global claim', async () => {
        uiMocks.activityState = activityState({
            entries: [ activityEntry(), activityEntry({ id: '2', name: 'Library scan completed' }) ],
            totalCount: 120
        });
        await renderActivity('/settings/admin/activity?view=user');
        expect(container.textContent).toContain('Page 1 of 3');
        expect(container.textContent).toContain('Search filters only the 50 or fewer entries loaded on this page');
        const search = container.querySelector<HTMLInputElement>('#ptv-admin-activity-search')!;
        await act(async () => changeInput(search, 'library'));
        expect(container.querySelectorAll('.ptv-admin-activity-row')).toHaveLength(1);
        expect(container.textContent).toContain('1 shown');

        await act(async () => buttonWithText(container, 'Next')?.click());
        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/activity?view=user&page=2');
        expect(uiMocks.useAdminActivity).toHaveBeenLastCalledWith(
            expect.anything(), expect.anything(), { pageIndex: 1, view: 'user' }
        );
        await act(async () => buttonWithText(container, 'Previous')?.click());
        expect(container.querySelector('[data-testid="location"]')?.textContent)
            .toBe('/settings/admin/activity?view=user');
    });

    it('retains Activity events when optional current-user mapping fails', async () => {
        uiMocks.activityState = activityState({ usersError: true });
        await renderActivity();

        expect(container.querySelectorAll('.ptv-admin-activity-row')).toHaveLength(1);
        expect(container.textContent).toContain('Current user names are unavailable');
        expect(container.textContent).toContain('Authoritative event text and paging remain available');
    });

    it('distinguishes authoritative Activity empty and local-search empty states', async () => {
        uiMocks.activityState = activityState({ entries: [], totalCount: 0 });
        await renderActivity();
        expect(container.textContent).toContain('No activity entries found.');

        uiMocks.activityState = activityState();
        await renderActivity();
        const search = container.querySelector<HTMLInputElement>('#ptv-admin-activity-search')!;
        await act(async () => changeInput(search, 'does-not-match'));
        expect(container.textContent).toContain('No activity matches this page search.');
    });

    it('distinguishes Activity loading and failure, and retries without reloading the app', async () => {
        uiMocks.activityState = activityState({ initialLoading: true });
        await renderActivity();
        expect(container.querySelector('[aria-label="Loading recent activity"]')).not.toBeNull();
        expect(container.querySelector('[aria-label="Activity pages"]')).toBeNull();

        const refresh = vi.fn(async () => undefined);
        uiMocks.activityState = activityState({ entries: [], error: true, refresh });
        await renderActivity();
        expect(container.textContent).toContain("Activity couldn't be loaded.");
        await act(async () => buttonWithText(container, 'Retry activity')?.click());
        expect(refresh).toHaveBeenCalledOnce();
    });
});

/* eslint-enable @typescript-eslint/naming-convention */
