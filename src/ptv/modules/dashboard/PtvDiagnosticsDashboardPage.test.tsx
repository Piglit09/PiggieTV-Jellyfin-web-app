import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('components/Page', () => ({
    default: ({ children, title }: { children: React.ReactNode; title: string }) => (
        <main data-page-title={title}>{children}</main>
    )
}));

vi.mock('../../services/diagnostics/webDiagnosticPlatform', () => ({
    refreshPtvWebDiagnosticExternalStatus: vi.fn(() => Promise.resolve())
}));

vi.mock('./RemoteDiagnosticsPanel', () => ({
    default: () => <section>Remote diagnostics</section>,
    RemoteDiagnosticsPanel: () => <section>Remote diagnostics</section>
}));

import {
    resetPtvDiagnosticPreferencesForTests
} from '../../services/diagnostics/diagnosticPreferences';
import {
    getPtvDiagnosticStore,
    resetPtvDiagnosticStoreForTests
} from '../../services/diagnostics/diagnosticStore';
import PtvDiagnosticsDashboardPage from './PtvDiagnosticsDashboardPage';

describe('PTV diagnostics dashboard', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        resetPtvDiagnosticStoreForTests();
        resetPtvDiagnosticPreferencesForTests();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        flushSync(() => root.unmount());
        container.remove();
        resetPtvDiagnosticStoreForTests();
        resetPtvDiagnosticPreferencesForTests();
        vi.useRealTimers();
    });

    it('renders the protected dashboard overview and cleans its store subscription', () => {
        const store = getPtvDiagnosticStore();

        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));

        expect(container.querySelector('[data-testid="ptv-admin-piggietv-diagnostics"]')).not.toBeNull();
        expect(container.querySelector('h1')?.textContent).toBe('PiggieTV Diagnostics');
        expect(container.textContent).toContain('Overall health');
        expect(container.textContent).toContain('Local, bounded observability');
        expect(store.getSnapshot().self.subscriberCount).toBe(1);

        flushSync(() => root.unmount());
        expect(store.getSnapshot().self.subscriberCount).toBe(0);
        root = createRoot(container);
    });

    it('resets retained history from the export section', () => {
        const store = getPtvDiagnosticStore();

        store.startRoute('#/movies');
        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));
        const exportButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Export');

        flushSync(() => exportButton?.click());
        const resetButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent?.includes('Reset session'));

        expect(resetButton).toBeTruthy();
        flushSync(() => resetButton?.click());
        expect(store.getSnapshot().routes).toEqual([]);
        expect(store.getSnapshot().session.resetCount).toBe(1);
    });

    it('removes injected credential canaries from copied diagnostics', async () => {
        const store = getPtvDiagnosticStore();
        const accessCanary = [ 'PTV_TEST', 'ACCESS_TOKEN', 'diagnostics-copy' ].join('_');
        const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        (store.updateContext as (changes: Record<string, unknown>) => void)({
            accessToken: accessCanary,
            request: {
                headers: { Authorization: `Bearer ${accessCanary}` },
                url: `https://server.invalid/socket?api_key=${accessCanary}`
            },
            tokenCount: 8
        });
        store.recordCoordinatorHit({
            endpoint: `https://server.invalid/Items?api_key=${accessCanary}`,
            route: `#/quickconnect?code=${accessCanary}`
        });
        store.startRoute(`#/quickconnect?code=${accessCanary}`);

        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));
        const exportButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Export');
        flushSync(() => exportButton?.click());
        const copyButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Copy diagnostics');

        await act(async () => {
            copyButton?.click();
            await Promise.resolve();
        });

        expect(writeText).toHaveBeenCalledOnce();
        const copied = String(writeText.mock.calls[0]?.[0] || '');
        expect(copied).not.toContain(accessCanary);
        expect(copied).toContain('"privacyClassification": "share-safe"');
    });

    it('renders the passive remote tester, safe graph inspector, and explicit recommendation unknown reason', () => {
        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));

        expect(container.textContent).toContain('Recommendation summary has not been observed.');
        const focusButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Navigation & Focus');

        flushSync(() => focusButton?.click());

        expect(container.textContent).toContain('TV Eligibility');
        expect(container.textContent).toContain('Passive Remote Tester');
        expect(container.textContent).toContain('never emits keys or moves focus');
        expect(container.textContent).toContain('Safe focus graph inspector');
        expect(container.textContent).toContain('Input Timeline');
    });

    it('coalesces a burst of store events into one bounded snapshot refresh', () => {
        vi.useFakeTimers();
        const store = getPtvDiagnosticStore();
        const getSnapshot = vi.spyOn(store, 'getSnapshot');

        flushSync(() => root.render(<PtvDiagnosticsDashboardPage />));
        const baseline = getSnapshot.mock.calls.length;

        for (let index = 0; index < 25; index += 1) {
            store.recordImage({
                cacheClassification: 'browser-managed',
                decodeDurationMs: null,
                durationMs: index,
                fallbackUsed: false,
                occurredAt: new Date().toISOString(),
                role: 'logo',
                routeFamily: 'dashboard/piggietv/diagnostics',
                status: 'loaded'
            });
        }

        expect(getSnapshot.mock.calls.length).toBe(baseline);
        flushSync(() => vi.advanceTimersByTime(1000));
        expect(getSnapshot.mock.calls.length).toBe(baseline + 1);
    });
});
