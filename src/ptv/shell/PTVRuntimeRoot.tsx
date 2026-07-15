import React, { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { startPtvPlaybackStateService } from '../services/playbackStateService';
import { registerPtvPersistentRuntimeRoot } from '../services/runtimeStability';
import PTVMediaDock from './PTVMediaDock';
import PTVUpdateNotice from './PTVUpdateNotice';

import './ptvShell.scss';

type PtvRuntimeWindow = Window & {
    __ptvRuntimeRootStarted?: boolean;
};

let runtimeRoot: Root | null = null;

function PTVRuntimeRoot() {
    useEffect(() => {
        const unregisterRuntimeRoot = registerPtvPersistentRuntimeRoot('ptv-runtime-root');

        startPtvPlaybackStateService();

        return unregisterRuntimeRoot;
    }, []);

    return (
        <div className='ptv-runtime-root' data-ptv-runtime-root='true'>
            <div className='ptv-runtime-media-dock-slot'>
                <PTVMediaDock />
            </div>
            <PTVUpdateNotice />
        </div>
    );
}

export function startPtvRuntimeRoot() {
    const runtimeWindow = window as PtvRuntimeWindow;

    if (runtimeWindow.__ptvRuntimeRootStarted) return;
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', startPtvRuntimeRoot, { once: true });
        return;
    }

    runtimeWindow.__ptvRuntimeRootStarted = true;

    const host = document.getElementById('ptv-runtime-root') || document.createElement('div');

    host.id = 'ptv-runtime-root';
    host.dataset.ptvRuntimeRootHost = 'true';

    if (!host.parentElement) {
        document.body.appendChild(host);
    }

    runtimeRoot = createRoot(host);
    runtimeRoot.render(<PTVRuntimeRoot />);
}

export function disposePtvRuntimeRootForTests() {
    runtimeRoot?.unmount();
    runtimeRoot = null;
    (window as PtvRuntimeWindow).__ptvRuntimeRootStarted = false;
    document.getElementById('ptv-runtime-root')?.remove();
}
