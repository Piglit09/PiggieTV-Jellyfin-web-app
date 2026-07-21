import { ready, emit } from './events';
import { once } from '../utils/guards';
import './compatibility';
import { initPtvObservability, recordPtvStartupEvent } from './observability';
import { initPtvLogging, ptvLogger } from './logger';
import './lifecycle';
import { scheduleRouteCheck, startRouter } from './router';
import {
    createPtvRuntime,
    markPtvRuntimeReady,
    registerPtvRuntimeFeature
} from './runtime';

import './observer';
import './lifecycleSafety';
import './jellyfin-hooks';
import './theme';
import './shell';
import '../api';
import { startPtvRouteController } from '../shell/routeController';
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
    registerPtvRuntimeFeature('route-controller', startPtvRouteController);
    registerPtvRuntimeFeature('shell-foundation', startPtvShellFoundation);
    registerPtvRuntimeFeature('runtime-root', startPtvRuntimeRoot);
    registerPtvRuntimeFeature('startup-readiness', startPtvStartupReadiness);
    markPtvRuntimeReady();
}

ready(() => {
    once('ptv-app', () => {
        startPtvRuntimeServices();
        document.documentElement.classList.add('ptv-ready');
        emit('ready');
        scheduleRouteCheck(true);
        recordPtvStartupEvent('core-app-ready');

        ptvLogger.info('Runtime started', {
            hash: window.location.hash,
            pathname: window.location.pathname
        }, 'Runtime');
    });
});
