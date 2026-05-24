import { ready, emit } from './events';
import { once } from '../utils/guards';
import './observability';
import './compatibility';
import { initPtvLogging, ptvLogger } from './logger';
import './lifecycle';
import { scheduleRouteCheck } from './router';

import './observer';
import './jellyfin-hooks';
import './theme';
import './shell';
import '../instrumentation';
import '../primitives/stockPatterns';
import '../shell/overlays';
import '../modules';

initPtvLogging();

ready(() => {
    once('ptv-app', () => {
        document.documentElement.classList.add('ptv-ready');
        emit('ready');
        scheduleRouteCheck(true);

        ptvLogger.info('Runtime started', {
            hash: window.location.hash,
            pathname: window.location.pathname
        }, 'Runtime');
    });
});
