import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    resetPtvDiagnosticPreferencesForTests,
    setPtvDiagnosticPreferences
} from '../../services/diagnostics/diagnosticPreferences';
import {
    getPtvDiagnosticStore,
    resetPtvDiagnosticStoreForTests
} from '../../services/diagnostics/diagnosticStore';
import PtvDiagnosticsOverlay from './PtvDiagnosticsOverlay';

describe('PTV diagnostics overlay', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        resetPtvDiagnosticPreferencesForTests();
        resetPtvDiagnosticStoreForTests();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        flushSync(() => root.unmount());
        container.remove();
        resetPtvDiagnosticPreferencesForTests();
        resetPtvDiagnosticStoreForTests();
    });

    it('is disabled by default and has no focusable controls when enabled', () => {
        flushSync(() => root.render(<PtvDiagnosticsOverlay />));
        expect(container.querySelector('[data-ptv-diagnostics-overlay]')).toBeNull();

        flushSync(() => setPtvDiagnosticPreferences({ overlayEnabled: true }));

        const overlay = container.querySelector('[data-ptv-diagnostics-overlay]');

        expect(overlay).not.toBeNull();
        expect(overlay?.querySelector('button, a, input, [tabindex]')).toBeNull();
        expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    });

    it('shows bounded TV focus and remote status without becoming focusable', () => {
        const store = getPtvDiagnosticStore();
        const snapshot = store.getSnapshot();

        store.updateContext({
            focus: {
                ...snapshot.latestFocus,
                candidateCount: 12,
                engineEnabled: true,
                engineRequested: true,
                isTv: true
            },
            platform: {
                ...snapshot.platform,
                isTv: true,
                userAgentClassification: 'webos'
            }
        });
        setPtvDiagnosticPreferences({ overlayEnabled: true });
        flushSync(() => root.render(<PtvDiagnosticsOverlay />));

        const overlay = container.querySelector('[data-ptv-diagnostics-overlay]');

        expect(overlay?.textContent).toContain('TV webos');
        expect(overlay?.textContent).toContain('12 candidates');
        expect(overlay?.querySelector('button, a, input, [tabindex]')).toBeNull();
    });
});
