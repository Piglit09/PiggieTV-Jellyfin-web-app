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
import '../instrumentation';
import '../primitives/stockPatterns';
import '../shell/overlays';
import '../modules';

initPtvLogging();
initPtvObservability();

function startPtvRuntimeServices() {
    createPtvRuntime('core-app');
    registerPtvRuntimeFeature('router', startRouter);
    registerPtvRuntimeFeature('performance-monitor', startPtvPerformanceMonitor);
    registerPtvRuntimeFeature('remote-diagnostics', startPtvPluginRemoteDiagnosticsTransport);
    registerPtvRuntimeFeature('route-controller', startPtvRouteController);
    registerPtvRuntimeFeature('shell-foundation', startPtvShellFoundation);
    registerPtvRuntimeFeature('runtime-root', startPtvRuntimeRoot);
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
