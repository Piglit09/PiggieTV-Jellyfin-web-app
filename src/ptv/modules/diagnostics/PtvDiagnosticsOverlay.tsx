import React, { useEffect, useState } from 'react';

import {
    getPtvDiagnosticPreferences,
    subscribePtvDiagnosticPreferences
} from '../../services/diagnostics/diagnosticPreferences';
import { getPtvDiagnosticStore } from '../../services/diagnostics/diagnosticStore';

import './ptvDiagnosticsOverlay.scss';

export default function PtvDiagnosticsOverlay() {
    const [ enabled, setEnabled ] = useState(() => getPtvDiagnosticPreferences().overlayEnabled);
    const [ snapshot, setSnapshot ] = useState(() => getPtvDiagnosticStore().getSnapshot());

    useEffect(() => subscribePtvDiagnosticPreferences(preferences => {
        setEnabled(preferences.overlayEnabled);
    }), []);

    useEffect(() => {
        if (!enabled) return undefined;

        setSnapshot(getPtvDiagnosticStore().getSnapshot());
        const timer = window.setInterval(() => {
            setSnapshot(getPtvDiagnosticStore().getSnapshot());
        }, 1000);

        return () => window.clearInterval(timer);
    }, [ enabled ]);

    if (!enabled) return null;

    const frame = snapshot.frames.at(-1);
    const requests = getPtvDiagnosticStore().getRequestSummary();
    const route = snapshot.routes.at(-1)?.routeFamily || 'unknown';
    const latestInput = [...snapshot.inputs].reverse().find(input => input.stage === 'completed')
        || snapshot.inputs.at(-1);
    const latestMovement = [...snapshot.inputs].reverse().find(input => (
        input.stage === 'movement-confirmed'
        || input.stage === 'movement-timed-out'
        || input.stage === 'target-rejected'
    ));

    return (
        <aside
            aria-hidden='true'
            className='ptv-diagnostics-overlay'
            data-ptv-diagnostics-overlay='true'
        >
            {snapshot.latestFocus.isTv && <span>TV {snapshot.platform.userAgentClassification} · engine {snapshot.latestFocus.engineEnabled ? 'on' : 'off'}</span>}
            <span>FPS {frame?.approximateFps ?? '—'}</span>
            <span>Frame p95 {frame?.p95FrameMs ?? '—'} ms</span>
            <span>Requests {requests.active} · p95 {requests.p95Ms} ms</span>
            <span>Route {route}</span>
            <span>Focus {snapshot.latestFocus.currentCategory} · {snapshot.latestFocus.candidateCount} candidates</span>
            {snapshot.latestFocus.isTv && <span>Input {latestInput?.safeAction || 'none'} · {latestMovement?.movementResult || 'not observed'} · {latestInput?.elapsedMs ?? '—'} ms</span>}
        </aside>
    );
}
