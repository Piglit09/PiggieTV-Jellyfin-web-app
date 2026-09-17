import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/naming-convention
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const uiMocks = vi.hoisted(() => ({
    cancel: vi.fn(),
    refresh: vi.fn(() => Promise.resolve(null)),
    request: vi.fn(),
    resetConfirm: vi.fn(),
    resetRequest: vi.fn(),
    resend: vi.fn(),
    snapshot: {
        error: '',
        identityKey: '',
        profile: null as null | {
            email?: string | null;
            emailVerified: boolean;
            emailVerifiedAt?: string | null;
            enrollmentPromptEligible: boolean;
            jellyfinUserId: string;
            ok: boolean;
            pendingEmail?: string | null;
            pendingEmailExpiresAt?: string | null;
            pendingEmailStatus?: string | null;
            recoveryEmail?: string | null;
            username: string;
        },
        status: 'anonymous' as 'anonymous' | 'loading' | 'ready' | 'error'
    },
    start: vi.fn(() => () => undefined),
    verify: vi.fn()
}));

vi.mock('components/Page', () => ({
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));
vi.mock('./AccountApi', () => ({
    confirmPtvAccountPasswordReset: uiMocks.resetConfirm,
    getAccountErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
    requestPtvAccountPasswordReset: uiMocks.resetRequest,
    verifyPtvAccountEmail: uiMocks.verify
}));
vi.mock('./accountProfileStore', () => ({
    cancelPtvAccountEmail: uiMocks.cancel,
    refreshPtvAccountProfile: uiMocks.refresh,
    requestPtvAccountEmail: uiMocks.request,
    resendPtvAccountEmail: uiMocks.resend,
    startPtvAccountProfileService: uiMocks.start,
    usePtvAccountProfile: () => uiMocks.snapshot
}));

import AccountEmailEnrollmentPrompt from './AccountEmailEnrollmentPrompt';
import ProfilePage from './ProfilePage';

function profile(patch: Partial<NonNullable<typeof uiMocks.snapshot.profile>> = {}) {
    return {
        emailVerified: false,
        enrollmentPromptEligible: true,
        jellyfinUserId: 'user-a',
        ok: true,
        username: 'Alex',
        ...patch
    };
}

function buttonWithText(container: HTMLElement, text: string) {
    return Array.from(container.querySelectorAll('button')).find(button => button.textContent === text);
}

function changeInput(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('PiggieTV account UI', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        sessionStorage.clear();
        uiMocks.snapshot = { error: '', identityKey: '', profile: null, status: 'anonymous' };
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.clearAllMocks();
        window.location.hash = '';
    });

    it('waits for authentication, opens once for a missing email, and Not now dismisses it', async () => {
        await act(async () => root.render(<AccountEmailEnrollmentPrompt />));
        expect(container.querySelector('[role="dialog"]')).toBeNull();

        uiMocks.snapshot = {
            error: '',
            identityKey: 'server-a:user-a',
            profile: profile(),
            status: 'ready'
        };
        await act(async () => root.render(<AccountEmailEnrollmentPrompt />));
        expect(container.querySelector('[role="dialog"]')).not.toBeNull();

        const dismiss = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Not now');
        await act(async () => dismiss?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(container.querySelector('[role="dialog"]')).toBeNull();

        await act(async () => root.render(<AccountEmailEnrollmentPrompt />));
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('restores pointer input for the prompt inside the click-through runtime root', () => {
        const accountStyles = readFileSync(resolve(process.cwd(), 'src/ptv/modules/account/account.scss'), 'utf8');

        expect(accountStyles).toMatch(/\.ptv-account-prompt-backdrop\s*\{[\s\S]*?pointer-events:\s*auto\s*;/);
    });

    it('does not open enrollment for verified or pending profiles', async () => {
        uiMocks.snapshot = { error: '', identityKey: 'server-a:user-a', profile: profile({ email: 'a@example.com', emailVerified: true }), status: 'ready' };
        await act(async () => root.render(<AccountEmailEnrollmentPrompt />));
        expect(container.querySelector('[role="dialog"]')).toBeNull();

        sessionStorage.clear();
        uiMocks.snapshot = { error: '', identityKey: 'server-a:user-b', profile: profile({ pendingEmail: 'b@example.com' }), status: 'ready' };
        await act(async () => root.render(<AccountEmailEnrollmentPrompt />));
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('shows verified canonical email while a different address remains pending', async () => {
        uiMocks.snapshot = {
            error: '',
            identityKey: 'server-a:user-a',
            profile: profile({
                email: 'old@example.com',
                emailVerified: true,
                emailVerifiedAt: '2026-08-11T12:00:00Z',
                pendingEmail: 'new@example.com',
                pendingEmailExpiresAt: '2026-08-12T12:00:00Z',
                pendingEmailStatus: 'sent'
            }),
            status: 'ready'
        };
        await act(async () => root.render(<ProfilePage />));

        expect(container.textContent).toContain('old@example.com');
        expect(container.textContent).toContain('new@example.com');
        expect(container.textContent).toContain('Verified');
        expect(container.textContent).toContain('Cancel pending change');
    });

    it('requests and confirms a password reset using only the verified profile email', async () => {
        uiMocks.resetRequest.mockResolvedValue({
            message: 'If that email belongs to a PiggieTV account, a reset code has been sent.',
            ok: true
        });
        uiMocks.resetConfirm.mockResolvedValue({
            message: 'Password reset. You can sign in with the new password.',
            ok: true
        });
        uiMocks.snapshot = {
            error: '',
            identityKey: 'server-a:user-a',
            profile: profile({ email: 'verified@example.com', emailVerified: true }),
            status: 'ready'
        };
        await act(async () => root.render(<ProfilePage />));

        await act(async () => buttonWithText(container, 'Reset password')?.click());
        expect(buttonWithText(container, 'Send reset code')).toBeTruthy();

        await act(async () => {
            buttonWithText(container, 'Send reset code')?.click();
            await Promise.resolve();
        });
        expect(uiMocks.resetRequest).toHaveBeenCalledWith('verified@example.com');
        expect(container.textContent).toContain('reset code has been sent');

        const code = container.querySelector<HTMLInputElement>('#ptv-account-reset-code');
        const password = container.querySelector<HTMLInputElement>('#ptv-account-new-password');
        const confirmPassword = container.querySelector<HTMLInputElement>('#ptv-account-confirm-password');
        expect(code).toBeTruthy();
        expect(password).toBeTruthy();
        expect(confirmPassword).toBeTruthy();

        await act(async () => {
            changeInput(code!, '12345678');
            changeInput(password!, 'PiggiePass9');
            changeInput(confirmPassword!, 'PiggiePass9');
        });
        await act(async () => {
            code?.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await Promise.resolve();
        });

        expect(uiMocks.resetConfirm).toHaveBeenCalledOnce();
        const resetRequest = uiMocks.resetConfirm.mock.calls[0][0];
        expect(resetRequest.code).toBe('12345678');
        expect(resetRequest.email).toBe('verified@example.com');
        expect(resetRequest.password).toBe(resetRequest.confirmPassword);
        expect(resetRequest.password).toHaveLength(11);
        expect(container.textContent).toContain('Password reset. You can sign in with the new password.');
    });

    it('keeps password reset unavailable until the profile email is verified', async () => {
        uiMocks.snapshot = {
            error: '',
            identityKey: 'server-a:user-a',
            profile: profile(),
            status: 'ready'
        };
        await act(async () => root.render(<ProfilePage />));

        expect(container.textContent).toContain('Add and verify a recovery email before using password reset.');
        expect(buttonWithText(container, 'Reset password')).toBeUndefined();
    });

    it('routes Settings and shared user-menu Profile actions to the PTV profile', () => {
        const settingsSource = readFileSync(resolve(process.cwd(), 'src/apps/stable/routes/asyncRoutes/user.ts'), 'utf8');
        const userMenuSource = readFileSync(resolve(process.cwd(), 'src/components/toolbar/AppUserMenu.tsx'), 'utf8');

        expect(settingsSource).toContain("{ path: 'settings/*', page: 'settings' }");
        expect(settingsSource).toContain("{ path: 'profile', page: 'settings-legacy' }");
        expect(userMenuSource).toContain("to='/settings/profile'");
        expect(userMenuSource).not.toContain('to={`/userprofile?userId=${user?.Id}`}');
    });
});
