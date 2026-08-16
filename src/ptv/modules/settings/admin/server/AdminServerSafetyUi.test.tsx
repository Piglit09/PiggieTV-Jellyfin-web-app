import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_API_KEY_MASK } from './adminServerOperationsModel';
import type { useAdminServerApiKeys, useAdminServerBackups } from './useAdminServerOperations';

/* eslint-disable @typescript-eslint/naming-convention, sonarjs/no-hardcoded-ip */

const mocks = vi.hoisted(() => ({
    apiKeys: null as ReturnType<typeof useAdminServerApiKeys> | null,
    backups: null as ReturnType<typeof useAdminServerBackups> | null,
    networking: null as Record<string, unknown> | null
}));

vi.mock('../../../../../hooks/useApi', () => ({
    useApi: () => ({ __legacyApiClient__: {}, api: {} })
}));

vi.mock('./useAdminServerOperations', () => ({
    useAdminServerApiKeys: () => mocks.apiKeys,
    useAdminServerBackups: () => mocks.backups
}));

vi.mock('./useAdminServerConfiguration', () => ({
    useAdminServerNetworking: () => mocks.networking
}));

vi.mock('../configuration/useAdminUnsavedChanges', () => ({
    useAdminUnsavedChanges: vi.fn()
}));

vi.mock('../../../icons/PtvIcon', () => ({
    default: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
}));

vi.mock('../../../../../components/ConfirmDialog', () => ({
    default: ({
        onCancel,
        onConfirm,
        open,
        text,
        title
    }: Readonly<{
        onCancel: () => void;
        onConfirm: () => void;
        open: boolean;
        text: string;
        title: string;
    }>) => open ? (
        <div role='dialog'>
            <h2>{title}</h2>
            <p>{text}</p>
            <button onClick={onConfirm} type='button'>Confirm action</button>
            <button onClick={onCancel} type='button'>Cancel action</button>
        </div>
    ) : null
}));

import AdminServerNetworkingPage, {
    isAdminServerConnectionSensitiveChange
} from './sections/AdminServerNetworkingPage';
import AdminServerApiKeysPage from './sections/AdminServerApiKeysPage';
import AdminServerBackupsPage from './sections/AdminServerBackupsPage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type NetworkingForm = Parameters<typeof isAdminServerConnectionSensitiveChange>[0];

const networking: NetworkingForm = {
    autoDiscovery: true,
    baseUrl: '',
    certificatePasswordConfigured: true,
    certificatePath: 'C:\\certs\\server.pfx',
    enableHttps: true,
    enableIPv4: true,
    enableIPv6: false,
    enableRemoteAccess: true,
    internalHttpPort: '8096',
    internalHttpsPort: '8920',
    isRemoteIPFilterBlacklist: true,
    knownProxies: 'proxy.local',
    localNetworkAddresses: '192.168.1.2',
    localNetworkSubnets: '192.168.1.0/24',
    publicHttpPort: '8096',
    publicHttpsPort: '8920',
    publishedServerUriBySubnet: 'all=https://media.example.test',
    remoteIPFilter: '',
    requireHttps: false
};

function setInputValue(input: HTMLInputElement, value: string) {
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function setSelectValue(select: HTMLSelectElement, value: string) {
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function click(element: Element | null) {
    expect(element).toBeTruthy();
    act(() => {
        (element as HTMLElement).click();
    });
}

describe('Server Administration safety UI', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.apiKeys = {
            create: vi.fn(),
            error: null,
            fetching: false,
            loading: false,
            operation: null,
            refetch: vi.fn(),
            revoke: vi.fn(),
            rows: []
        };
        mocks.backups = {
            account: null,
            accountError: null,
            accountLoading: false,
            create: vi.fn(),
            createAccount: vi.fn(),
            dryRunRestoreAccount: vi.fn(),
            error: null,
            fetching: false,
            inspect: vi.fn(),
            loading: false,
            operation: null,
            refetch: vi.fn(),
            refetchAccount: vi.fn(),
            restore: vi.fn(),
            restoreAccount: vi.fn(),
            rows: [],
            verifyAccount: vi.fn()
        };
        mocks.networking = {
            fetching: false,
            loading: false,
            refetch: vi.fn(),
            save: vi.fn(),
            saving: false,
            snapshot: {
                authority: {},
                settings: {
                    ...networking,
                    internalHttpPort: 8096,
                    internalHttpsPort: 8920,
                    knownProxies: [ 'proxy.local' ],
                    localNetworkAddresses: [ '192.168.1.2' ],
                    localNetworkSubnets: [ '192.168.1.0/24' ],
                    publicHttpPort: 8096,
                    publicHttpsPort: 8920,
                    publishedServerUriBySubnet: [ 'all=https://media.example.test' ],
                    remoteIPFilter: []
                }
            }
        };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('warns only when a networking edit can change the active connection', () => {
        expect(isAdminServerConnectionSensitiveChange(networking, networking, 'unchanged')).toBe(false);
        expect(isAdminServerConnectionSensitiveChange(
            { ...networking, knownProxies: 'new-proxy.local' },
            networking,
            'unchanged'
        )).toBe(false);

        const sensitiveChanges: NetworkingForm[] = [
            { ...networking, baseUrl: '/piggie' },
            { ...networking, certificatePath: 'C:\\certs\\replacement.pfx' },
            { ...networking, enableHttps: false },
            { ...networking, enableIPv4: false },
            { ...networking, enableIPv6: true },
            { ...networking, enableRemoteAccess: false },
            { ...networking, internalHttpPort: '18096' },
            { ...networking, internalHttpsPort: '18920' },
            { ...networking, localNetworkAddresses: '192.168.1.3' },
            { ...networking, publicHttpPort: '28096' },
            { ...networking, publicHttpsPort: '28920' },
            { ...networking, requireHttps: true }
        ];
        sensitiveChanges.forEach(candidate => {
            expect(isAdminServerConnectionSensitiveChange(candidate, networking, 'unchanged')).toBe(true);
        });
        expect(isAdminServerConnectionSensitiveChange(networking, networking, 'replace')).toBe(true);
        expect(isAdminServerConnectionSensitiveChange(networking, networking, 'clear')).toBe(true);
    });

    it('keeps the Jellyfin database selected and prevents excluding it from a backup', () => {
        act(() => root.render(<AdminServerBackupsPage />));

        const database = Array.from(container.querySelectorAll('label'))
            .find(label => label.textContent?.trim() === 'Database')
            ?.querySelector('input[type="checkbox"]') as HTMLInputElement | undefined;
        expect(database).toBeTruthy();
        expect(database?.checked).toBe(true);
        expect(database?.disabled).toBe(true);
    });

    it('shows a newly returned API token once, then removes it from the UI when closed', async () => {
        const token = [ 'ptv', 'one', 'time', 'credential' ].join('-');
        vi.mocked(mocks.apiKeys!.create).mockResolvedValue({
            reveal: { appName: 'Home Assistant', token },
            rows: [{
                appName: 'Home Assistant',
                createdAt: null,
                id: 'opaque-key',
                tokenMask: ADMIN_API_KEY_MASK
            }]
        });
        act(() => root.render(<AdminServerApiKeysPage />));

        expect(container.textContent).not.toContain(token);
        const input = container.querySelector('#ptv-api-key-name') as HTMLInputElement;
        setInputValue(input, 'Home Assistant');
        click(Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Create Key') || null);
        await act(async () => {
            await Promise.resolve();
        });

        expect(mocks.apiKeys!.create).toHaveBeenCalledWith('Home Assistant');
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain(token);
        expect(container.textContent).toContain('It will not be shown again.');

        click(Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Confirm action') || null);
        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(container.textContent).not.toContain(token);
    });

    it('clears a certificate replacement password as soon as a failed save owns it', async () => {
        const password = [ 'temporary', 'certificate', 'secret' ].join('-');
        (mocks.networking!.save as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Save failed'));
        act(() => root.render(<AdminServerNetworkingPage />));

        setSelectValue(container.querySelector('#ptv-network-password-mode')!, 'replace');
        const passwordInput = container.querySelector<HTMLInputElement>('#ptv-network-password');
        setInputValue(passwordInput!, password);
        expect(passwordInput?.value).toBe(password);

        click(Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Save Changes') || null);
        click(Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Confirm action') || null);
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.networking!.save).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            { mode: 'replace', value: password }
        );
        expect(container.querySelector<HTMLInputElement>('#ptv-network-password')?.value).toBe('');
        expect(container.textContent).not.toContain(password);
    });
});

/* eslint-enable @typescript-eslint/naming-convention, sonarjs/no-hardcoded-ip */
