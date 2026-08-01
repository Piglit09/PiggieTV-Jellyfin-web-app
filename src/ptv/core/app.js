import { ready, emit } from './events';
import { once } from '../utils/guards';
import './compatibility';
import { initPtvObservability, recordPtvEvent, recordPtvStartupEvent } from './observability';
import { initPtvLogging, ptvLogger } from './logger';
import './lifecycle';
import { startRouter } from './router';
import {
    createPtvRuntime,
    markPtvRuntimeReady,
    registerPtvRuntimeFeature
} from './runtime';
import { initializePtvWebCoreRuntime } from './initialization/webCoreRuntime';

import './observer';
import './lifecycleSafety';
import './jellyfin-hooks';
import './theme';
import './shell';
import '../api';
import { startPtvShellFoundation } from '../shell/foundation';
import { startPtvRuntimeRoot } from '../shell/PTVRuntimeRoot';
import { startPtvPerformanceMonitor } from '../services/performanceMonitor';
import { startPtvPluginRemoteDiagnosticsTransport } from '../services/pluginRemoteDiagnosticsTransport';
import { startPtvStartupReadiness } from './startupReadiness';
import '../instrumentation';
import '../primitives/stockPatterns';
import '../shell/overlays';
import '../modules';

initPtvLogging();
initPtvObservability();

function startPtvRuntimeServices() {
    const runtimeState = window.__PTV_RUNTIME_APP_STATE__ ||= {
        createCount: 0,
        duplicateInitializationSuppressed: 0,
        reuseCount: 0,
        started: false
    };

    if (runtimeState.started) {
        runtimeState.reuseCount += 1;
        runtimeState.duplicateInitializationSuppressed += 1;
        return;
    }

    runtimeState.started = true;
    runtimeState.createCount += 1;
    createPtvRuntime('core-app');
    registerPtvRuntimeFeature('router', startRouter);
    registerPtvRuntimeFeature('performance-monitor', startPtvPerformanceMonitor);
    registerPtvRuntimeFeature('remote-diagnostics', startPtvPluginRemoteDiagnosticsTransport);
    registerPtvRuntimeFeature('shell-foundation', startPtvShellFoundation);
    registerPtvRuntimeFeature('runtime-root', startPtvRuntimeRoot);
    registerPtvRuntimeFeature('startup-readiness', startPtvStartupReadiness);
    void initializePtvWebCoreRuntime()
        .then(result => {
            recordPtvEvent('profile', result.degraded ? 'core-app-ready-degraded' : 'core-app-ready', {
                action: result.action,
                steps: result.steps.map(step => ({
                    name: step.name,
                    status: step.status
                }))
            });
            if (result.ready || result.action === 'route-to-login') {
                // Login remains a valid authoritative application destination.
                markPtvRuntimeReady();
            }
        })
        .catch(error => {
            recordPtvEvent('profile', 'core-app-initialization-failed', {
                error: error instanceof Error ? error.message : String(error)
            });
        });
}

ready(() => {
    once('ptv-app', () => {
        startPtvRuntimeServices();
        document.documentElement.classList.add('ptv-ready');
        emit('ready');
        recordPtvStartupEvent('core-app-ready');

        ptvLogger.info('Runtime started', {
            hash: window.location.hash,
            pathname: window.location.pathname
        }, 'Runtime');
    });
});
