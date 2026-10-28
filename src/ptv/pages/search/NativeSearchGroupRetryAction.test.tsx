import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { NativeSearchGroupRetryAction } from './NativeSearchGroupRetryAction';

const reactActEnvironment = globalThis as typeof globalThis & {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe('Search group retry action', () => {
    it('offers retry on a failed group and passes only that group ID', () => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        const root = createRoot(container);
        const retry = vi.fn();

        try {
            act(() => root.render(<NativeSearchGroupRetryAction
                groupId='shows'
                groupTitle='Shows'
                onRetry={retry}
                status='error'
            />));
            const button = container.querySelector('button');

            expect(button?.getAttribute('aria-label')).toBe('Retry Shows results');
            act(() => button?.click());
            expect(retry).toHaveBeenCalledWith('shows');
            expect(retry).toHaveBeenCalledTimes(1);
        } finally {
            act(() => root.unmount());
            reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
        }
    });

    it('does not offer retry on a successful group', () => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        const root = createRoot(container);

        try {
            act(() => root.render(<NativeSearchGroupRetryAction
                groupId='shows'
                groupTitle='Shows'
                onRetry={vi.fn()}
                status='success'
            />));
            expect(container.querySelector('button')).toBeNull();
        } finally {
            act(() => root.unmount());
            reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
        }
    });
});
