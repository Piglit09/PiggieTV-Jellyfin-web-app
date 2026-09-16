import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const quickConnectMocks = vi.hoisted(() => ({
    authorize: vi.fn(),
    useApi: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/quick-connect-api', () => ({
    getQuickConnectApi: () => ({ authorizeQuickConnect: quickConnectMocks.authorize })
}));
vi.mock('components/Page', () => ({
    default: ({ children }: Readonly<{ children: React.ReactNode }>) => <main>{children}</main>
}));
vi.mock('elements/emby-button/Button', () => ({
    default: ({ title, type }: Readonly<{ title: string; type?: 'button' | 'submit' | 'reset' }>) => (
        <button type={type}>{title}</button>
    )
}));
vi.mock('elements/emby-input/Input', () => ({
    default: ({ label: _label, ...props }: Readonly<React.InputHTMLAttributes<HTMLInputElement> & { label?: string }>) => (
        <input {...props} />
    )
}));
vi.mock('hooks/useApi', () => ({
    useApi: quickConnectMocks.useApi
}));
vi.mock('lib/globalize', () => ({
    default: { translate: (key: string) => key }
}));

import QuickConnectPage from './index';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

describe('Quick Connect console safety', () => {
    let container: HTMLDivElement;
    let root: Root;
    let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        quickConnectMocks.authorize.mockResolvedValue({});
        quickConnectMocks.useApi.mockReturnValue({ api: {}, user: { Id: 'fallback-user' } });
        consoleSpies = ([ 'debug', 'error', 'info', 'log', 'warn' ] as const).map(level => (
            vi.spyOn(console, level).mockImplementation(() => undefined)
        ));
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        consoleSpies.forEach(spy => spy.mockRestore());
        vi.clearAllMocks();
    });

    it('authorizes a query-provided code without sending the code or user ID to console output', async () => {
        const codeCanary = '731942';
        const userCanary = [ 'PTV_TEST', 'USER_ID', 'quickconnect' ].join('_');
        const router = createMemoryRouter([{
            element: <QuickConnectPage />,
            path: '/quickconnect'
        }], {
            initialEntries: [ `/quickconnect?code=${codeCanary}&userId=${userCanary}` ]
        });

        await act(async () => {
            root.render(<RouterProvider router={router} />);
            await Promise.resolve();
        });
        const form = container.querySelector('form');
        Object.defineProperty(form, 'checkValidity', { configurable: true, value: () => true });

        await act(async () => {
            form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(quickConnectMocks.authorize).toHaveBeenCalledWith({
            code: codeCanary,
            userId: userCanary
        });
        const consoleOutput = JSON.stringify(consoleSpies.flatMap(spy => spy.mock.calls));
        expect(consoleOutput).not.toContain(codeCanary);
        expect(consoleOutput).not.toContain(userCanary);
    });
});
