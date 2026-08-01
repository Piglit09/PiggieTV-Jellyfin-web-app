/* eslint-disable @stylistic/operator-linebreak, @typescript-eslint/no-unused-vars, compat/compat, no-var, sonarjs/no-ignored-exceptions -- This response-injected observer intentionally stays ES5/Chrome-68 compatible and treats every telemetry transport failure as non-invasive. */
(function installPtvWebOsAttributionObserver(window, document) {
    'use strict';

    var bootstrap = window.__PTV_ATTRIBUTION_BOOTSTRAP__;
    if (!bootstrap || bootstrap.enabled !== true || window.__PTV_ATTRIBUTION_OBSERVER_ACTIVE__ === true) {
        return;
    }

    window.__PTV_ATTRIBUTION_OBSERVER_ACTIVE__ = true;

    var endpoint = String(bootstrap.endpoint || '');
    var validationSession = String(bootstrap.validationSession || '');
    var documentGeneration = Number(bootstrap.documentGeneration || 0);
    var documentSequence = 0;
    var startedAt = Date.now();
    var ordinaryQueue = [];
    var ordinaryInFlight = false;
    var stockEventsAttached = false;
    var lastControlsVisible = null;
    var lastHideRequestAt = {
        'ptv-focus-owner': -1000,
        'show-video-osd': -1000
    };
    var routeFamily = 'unknown';
    var routeGeneration = 0;
    var MAX_ORDINARY_QUEUE = 32;
    var CRITICAL_CATEGORIES = {
        'back-owner': true,
        'back-received': true,
        'beforeunload': true,
        'controls-hide-requested': true,
        'error-category': true,
        'pagehide': true,
        'playback-exit-requested': true,
        'unhandled-rejection-category': true,
        'unload': true
    };

    function documentNow() {
        var performanceObject = window.performance;
        var value = performanceObject && typeof performanceObject.now === 'function'
            ? performanceObject.now()
            : Date.now() - startedAt;

        value = Math.round(Number(value || 0));
        return value >= 0 && value <= 86400000 ? value : 0;
    }

    function visibilityState() {
        var value = String(document.visibilityState || 'unknown').toLowerCase();
        return value === 'visible' || value === 'hidden' || value === 'prerender'
            ? value
            : 'unknown';
    }

    function readyState() {
        var value = String(document.readyState || 'unknown').toLowerCase();
        return value === 'loading' || value === 'interactive' || value === 'complete'
            ? value
            : 'unknown';
    }

    function safeInteger(value, maximum) {
        var number = Number(value);
        if (!isFinite(number) || number < 0) return 0;
        return Math.min(maximum, Math.floor(number));
    }

    function createEnvelope(category, state, data) {
        documentSequence += 1;
        return {
            category: category,
            data: data,
            documentGeneration: documentGeneration,
            documentMs: documentNow(),
            documentSeq: documentSequence,
            schemaVersion: 1,
            state: state,
            validationSession: validationSession
        };
    }

    function sendBeaconBody(body) {
        try {
            if (!window.navigator || typeof window.navigator.sendBeacon !== 'function') return false;

            var payload = body;
            if (typeof window.Blob === 'function') {
                payload = new window.Blob([body], { type: 'text/plain;charset=UTF-8' });
            }
            return window.navigator.sendBeacon(endpoint, payload) === true;
        } catch (_error) {
            return false;
        }
    }

    function sendOrdinaryBody(body) {
        ordinaryQueue.push(body);
        if (ordinaryQueue.length > MAX_ORDINARY_QUEUE) ordinaryQueue.shift();
        flushOrdinaryQueue();
    }

    function flushOrdinaryQueue() {
        if (ordinaryInFlight || ordinaryQueue.length === 0) return;

        ordinaryInFlight = true;
        var body = ordinaryQueue.shift();

        try {
            var request = new window.XMLHttpRequest();
            request.open('POST', endpoint, true);
            request.timeout = 800;
            request.setRequestHeader('Content-Type', 'application/json');
            request.onload = completeOrdinaryRequest;
            request.onerror = completeOrdinaryRequest;
            request.ontimeout = completeOrdinaryRequest;
            request.onabort = completeOrdinaryRequest;
            request.send(body);
        } catch (_error) {
            completeOrdinaryRequest();
        }
    }

    function completeOrdinaryRequest() {
        ordinaryInFlight = false;
        flushOrdinaryQueue();
    }

    function record(category, state, data, forceCritical) {
        var body;
        try {
            body = JSON.stringify(createEnvelope(category, state, data));
        } catch (_error) {
            return;
        }

        if ((forceCritical === true || CRITICAL_CATEGORIES[category] === true) && sendBeaconBody(body)) {
            return;
        }
        sendOrdinaryBody(body);
    }

    function routeFamilyFromValue(value) {
        var raw = String(value || '').toLowerCase();
        var normalized = raw.replace(/[^a-z-]/g, '');
        var allowed = {
            details: true,
            home: true,
            login: true,
            movies: true,
            music: true,
            playback: true,
            settings: true,
            shows: true
        };
        if (allowed[normalized]) return normalized;
        if (raw.indexOf('playback') >= 0 || raw.indexOf('videoosd') >= 0) return 'playback';
        if (raw.indexOf('music') >= 0) return 'music';
        if (raw.indexOf('movies') >= 0) return 'movies';
        if (raw.indexOf('shows') >= 0 || raw.indexOf('tv.html') >= 0) return 'shows';
        if (raw.indexOf('settings') >= 0 || raw.indexOf('dashboard') >= 0) return 'settings';
        if (raw.indexOf('details') >= 0 || raw.indexOf('item') >= 0) return 'details';
        if (raw.indexOf('login') >= 0 || raw.indexOf('selectserver') >= 0) return 'login';
        if (raw.indexOf('home') >= 0 || raw === '#' || raw === '#/') return 'home';
        return normalized ? 'other' : 'unknown';
    }

    function readRouteFamily() {
        var root = document.documentElement;
        var value = root && root.dataset ? root.dataset.ptvRoutePageType : '';
        var fromDataset = routeFamilyFromValue(value);
        return fromDataset === 'unknown'
            ? routeFamilyFromValue(window.location && window.location.hash)
            : fromDataset;
    }

    function runtimeSnapshot() {
        var appState = window.__PTV_RUNTIME_APP_STATE__ || {};
        var runtime = window.PTV && window.PTV.runtime;
        var report = {};

        try {
            report = runtime && typeof runtime.report === 'function' ? runtime.report() || {} : {};
        } catch (_error) {
            report = {};
        }

        return {
            appCreateCount: safeInteger(appState.createCount, 1000),
            listenerRegistrationCount: safeInteger(report.listenerRegistrationCount, 10000),
            runtimeCreateCount: safeInteger(report.runtimeCreateCount, 1000),
            runtimeReady: report.ready === true
        };
    }

    function controlsVisible() {
        var root = document.documentElement;
        return Boolean(root && root.classList && root.classList.contains('ptv-player-osd-visible'));
    }

    function videoActive() {
        var root = document.documentElement;
        return Boolean(root && root.classList && root.classList.contains('ptv-playing'));
    }

    function historyClass() {
        try {
            var length = Number(window.history && window.history.length);
            if (!isFinite(length) || length < 1) return 'unknown';
            return length === 1 ? 'single' : 'multiple';
        } catch (_error) {
            return 'unknown';
        }
    }

    function hasClass(element, className) {
        return Boolean(element && element.classList && element.classList.contains(className));
    }

    function closestVideoControl(element) {
        var current = element;
        while (current && current !== document.documentElement) {
            if (
                hasClass(current, 'videoOsdBottom')
                || hasClass(current, 'videoOsdTop')
                || hasClass(current, 'videoOsd')
                || hasClass(current, 'ptv-player-chrome-root')
            ) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    function activeFocusCategory() {
        var active = document.activeElement;
        if (!active) return 'none';
        if (active === document.body) return 'body';
        if (!closestVideoControl(active)) return 'outside-video';

        var type = String(active.getAttribute && active.getAttribute('type') || '').toLowerCase();
        if (type === 'range' || hasClass(active, 'nowPlayingPositionSlider')) return 'video-seek';
        if (
            hasClass(active, 'btnPause')
            || hasClass(active, 'buttonPause')
            || hasClass(active, 'btnPlay')
        ) {
            return 'video-play-pause';
        }
        if (
            hasClass(active, 'btnClose')
            || hasClass(active, 'buttonBack')
            || hasClass(active, 'btnBack')
        ) {
            return 'video-back';
        }
        return 'video-other';
    }

    function presentationCategory(video) {
        if (document.querySelector(
            '.ptv-music-fullscreen-player, '
            + '.ptv-music-now-playing-view[data-ptv-playback-surface="full-screen-player"]'
        )) {
            return 'audio-fullscreen';
        }
        if (document.querySelector('.ptv-media-dock[data-ptv-playback-surface="mini-player"]')) {
            return 'audio-mini';
        }
        if (video && videoActive()) {
            if (controlsVisible()) {
                return video.paused === true
                    ? 'video-paused-controls-visible'
                    : 'video-playing-controls-visible';
            }
            return video.paused === false
                ? 'video-playing-controls-hidden'
                : 'transitioning';
        }
        return video ? 'unavailable' : 'idle';
    }

    function heartbeatData() {
        var runtime = runtimeSnapshot();
        var video = document.querySelector('video');
        routeFamily = routeFamily === 'unknown' ? readRouteFamily() : routeFamily;

        return {
            activeFocus: activeFocusCategory(),
            appCreateCount: runtime.appCreateCount,
            controlsVisible: controlsVisible(),
            listenerRegistrationCount: runtime.listenerRegistrationCount,
            presentationCategory: presentationCategory(video),
            readyState: readyState(),
            routeFamily: routeFamily,
            routeGeneration: routeGeneration,
            runtimeCreateCount: runtime.runtimeCreateCount,
            runtimePresent: Boolean(window.PTV && window.PTV.runtime),
            runtimeReady: runtime.runtimeReady,
            videoPaused: video ? Boolean(video.paused) : null,
            videoPresent: Boolean(video),
            visibilityState: visibilityState()
        };
    }

    function errorCategoryFromName(value) {
        var name = String(value || '').toLowerCase();
        if (name === 'typeerror') return 'type-error';
        if (name === 'rangeerror') return 'range-error';
        if (name === 'referenceerror') return 'reference-error';
        if (name === 'syntaxerror') return 'syntax-error';
        if (name === 'error') return 'error';
        return 'unknown';
    }

    function isVideoElement(value) {
        return Boolean(value && String(value.tagName || '').toLowerCase() === 'video');
    }

    function isBackKey(event) {
        var key = String(event.key || event.code || '');
        var legacyCode = Number(event.keyCode || event.which || 0);
        return key === 'Escape'
            || key === 'Back'
            || key === 'BrowserBack'
            || legacyCode === 461;
    }

    function safeInputSource(value) {
        var normalized = String(value || '').toLowerCase();
        var allowed = {
            'android-tv-profile': true,
            'fire-tv-profile': true,
            'input-manager': true,
            'keyboard': true,
            'synthetic-test': true,
            'webos-remote': true
        };
        return allowed[normalized] ? normalized : 'unknown';
    }

    function safeBackStage(value) {
        var normalized = String(value || '').toLowerCase();
        var allowed = {
            'action-resolved': true,
            'browser-event-received': true,
            'capture': true,
            'command': true,
            'completed': true,
            'current-candidate-resolved': true,
            'event-classified': true,
            'final': true,
            'focus-event-observed': true,
            'focus-handler-reached': true,
            'focus-movement-requested': true,
            'handler-rejected': true,
            'key-normalized': true,
            'movement-confirmed': true,
            'movement-timed-out': true,
            'platform-mapping-applied': true,
            'target-found': true,
            'target-rejected': true,
            'target-search-started': true
        };
        return allowed[normalized] ? normalized : '';
    }

    function backData(event, stage, overrides) {
        var currentRoute = routeFamily === 'unknown' ? readRouteFamily() : routeFamily;
        var data = {
            controlsVisible: controlsVisible(),
            defaultPrevented: event && event.defaultPrevented === true,
            duplicate: false,
            handlerReached: false,
            historyClass: historyClass(),
            inputSource: event && event.isTrusted === true ? 'webos-remote' : 'synthetic-test',
            propagationStopped: event && event.cancelBubble === true,
            repeat: event && event.repeat === true,
            routeFamily: currentRoute,
            stage: stage,
            trusted: event && event.isTrusted === true
        };
        var values = overrides || {};
        Object.keys(values).forEach(function applyOverride(key) {
            if (Object.prototype.hasOwnProperty.call(data, key)) data[key] = values[key];
        });
        return data;
    }

    function addPassiveListener(target, type, listener, capture) {
        try {
            target.addEventListener(type, listener, {
                capture: capture === true,
                passive: true
            });
        } catch (_error) {
            target.addEventListener(type, listener, capture === true);
        }
    }

    function recordControlsVisibility(value) {
        var visible = value === true;
        lastControlsVisible = visible;
        record('controls-visible', visible ? 'visible' : 'hidden', {}, visible === false);
    }

    function recordControlsHideRequest(source) {
        var now = documentNow();
        if (now - lastHideRequestAt[source] < 100) return;
        lastHideRequestAt[source] = now;
        record('controls-hide-requested', 'observed', { source: source }, true);
    }

    function attachStockEvents() {
        if (stockEventsAttached) return;
        var events = window.Events;
        if (!events || typeof events.on !== 'function') return;

        try {
            events.on(document, 'SHOW_VIDEO_OSD', function onShowVideoOsd(_event, visible) {
                if (visible === false) recordControlsHideRequest('show-video-osd');
                recordControlsVisibility(visible === true);
            });
            stockEventsAttached = true;
        } catch (_error) {
            stockEventsAttached = false;
        }
    }

    function onKeyDown(event) {
        if (!isBackKey(event)) return;
        record('back-received', 'capture', backData(event, 'capture'), true);

        var recordFinal = function recordFinalBackState() {
            record('back-received', 'final', backData(event, 'final'), true);
        };
        // A microtask can run between DOM listener targets on legacy WebOS.
        // A zero-delay task guarantees this observation occurs after dispatch.
        window.setTimeout(recordFinal, 0);
    }

    function onKeyDownBubble(event) {
        if (!isBackKey(event)) return;
        record('back-received', 'bubble', backData(event, 'bubble'), true);
    }

    function onCommand(event) {
        var detail = event && event.detail;
        if (!detail || String(detail.command || '').toLowerCase() !== 'back') return;

        record('back-received', 'command', backData(event, 'command', {
            inputSource: 'input-manager'
        }), true);
    }

    function onFocusDiagnostic(event) {
        var payload = event && event.detail;
        var detail = payload && payload.detail;
        if (!payload || !detail) return;

        if (payload.name === 'ptv-tv-input-pipeline') {
            if (String(detail.keyCategory || '').toLowerCase() !== 'back') return;
            var pipelineStage = safeBackStage(detail.inputStage);
            if (!pipelineStage) return;
            var inputSource = safeInputSource(detail.inputSource);

            record('back-received', 'focus-pipeline', backData(null, pipelineStage, {
                defaultPrevented: pipelineStage === 'completed'
                    ? detail.defaultPreventedAfter === true
                    : detail.defaultPreventedBefore === true,
                duplicate: detail.duplicate === true,
                handlerReached: detail.handlerReached === true,
                inputSource: inputSource,
                propagationStopped: detail.propagationStopped === true,
                repeat: detail.repeat === true,
                trusted: inputSource !== 'synthetic-test' && inputSource !== 'unknown'
            }), true);
            return;
        }

        if (payload.name !== 'ptv-tv-focus-back') return;

        var owner = String(detail.backOwner || '').toLowerCase();
        var allowed = {
            'full-screen-music': true,
            'input-manager': true,
            'route-history': true,
            'transient-layer': true,
            'video-controls': true,
            'video-playback': true
        };
        owner = allowed[owner] ? owner : 'unknown';
        record('back-owner', owner, {}, true);

        if (owner === 'video-controls') recordControlsHideRequest('ptv-focus-owner');
        if (owner === 'video-playback') {
            record('playback-exit-requested', 'observed', {}, true);
        }
    }

    function onRouteFamily(event) {
        var detail = event && event.detail || {};
        routeFamily = routeFamilyFromValue(detail.pageType || detail.owner);
        routeGeneration = safeInteger(detail.routeGeneration, 1000000);
        record('route-family', routeFamily, {
            routeFamily: routeFamily,
            routeGeneration: routeGeneration,
            source: 'controller'
        });
    }

    function onBrowserRoute(event) {
        routeFamily = readRouteFamily();
        routeGeneration = Math.min(1000000, routeGeneration + 1);
        record('route-family', routeFamily, {
            routeFamily: routeFamily,
            routeGeneration: routeGeneration,
            source: event && event.type === 'popstate' ? 'popstate' : 'hashchange'
        });
    }

    function onRuntimeCreated() {
        var runtime = runtimeSnapshot();
        record('runtime-created', runtime.runtimeReady ? 'ready' : 'not-ready', runtime);
    }

    function onVideoStarted(event) {
        if (!isVideoElement(event.target)) return;
        var state = event.type === 'playing' ? 'playing' : 'play';
        record('video-started', state, {});
    }

    function onWindowError(event) {
        var category;
        if (isVideoElement(event.target)) {
            category = 'media-error';
        } else if (event.target && event.target !== window) {
            category = 'resource-error';
        } else {
            category = errorCategoryFromName(event.error && event.error.name);
        }
        record('error-category', category, {}, true);
    }

    function onUnhandledRejection(event) {
        var category = errorCategoryFromName(event.reason && event.reason.name);
        record('unhandled-rejection-category', category, {}, true);
    }

    function onVisibilityChange() {
        var state = visibilityState();
        record('visibilitychange', state, { visibilityState: state });
    }

    function onBeforeUnload() {
        record('beforeunload', 'observed', { visibilityState: visibilityState() }, true);
    }

    function onPageHide(event) {
        record('pagehide', event.persisted === true ? 'persisted' : 'non-persisted', {
            persisted: event.persisted === true,
            visibilityState: visibilityState()
        }, true);
    }

    function onUnload() {
        record('unload', 'observed', { visibilityState: 'unloaded' }, true);
    }

    function onHeartbeat() {
        attachStockEvents();
        var visible = controlsVisible();
        if (visible !== lastControlsVisible) recordControlsVisibility(visible);
        record('heartbeat', 'alive', heartbeatData());
    }

    addPassiveListener(window, 'keydown', onKeyDown, true);
    addPassiveListener(document, 'keydown', onKeyDownBubble, false);
    addPassiveListener(window, 'command', onCommand, true);
    addPassiveListener(window, 'ptv:focus-diagnostic', onFocusDiagnostic, false);
    addPassiveListener(window, 'ptv:routecontrollerchange', onRouteFamily, false);
    addPassiveListener(window, 'hashchange', onBrowserRoute, false);
    addPassiveListener(window, 'popstate', onBrowserRoute, false);
    addPassiveListener(window, 'ptv:runtimecreated', onRuntimeCreated, false);
    addPassiveListener(window, 'error', onWindowError, true);
    addPassiveListener(window, 'unhandledrejection', onUnhandledRejection, false);
    addPassiveListener(window, 'beforeunload', onBeforeUnload, false);
    addPassiveListener(window, 'pagehide', onPageHide, false);
    addPassiveListener(document, 'visibilitychange', onVisibilityChange, false);
    addPassiveListener(window, 'unload', onUnload, false);
    addPassiveListener(document, 'play', onVideoStarted, true);
    addPassiveListener(document, 'playing', onVideoStarted, true);

    attachStockEvents();
    routeFamily = readRouteFamily();
    lastControlsVisible = controlsVisible();
    record(
        documentGeneration === 1 ? 'document-start' : 'document-recreated',
        'observer-installed',
        {},
        true
    );
    record('route-family', routeFamily, {
        routeFamily: routeFamily,
        routeGeneration: routeGeneration,
        source: 'initial'
    });
    onHeartbeat();
    window.setInterval(onHeartbeat, 1000);
}(window, document));
/* eslint-enable @stylistic/operator-linebreak, @typescript-eslint/no-unused-vars, compat/compat, no-var, sonarjs/no-ignored-exceptions */
