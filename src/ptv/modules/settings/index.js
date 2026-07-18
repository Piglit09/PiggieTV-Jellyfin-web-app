import { on } from '../../core/events';
import { registerModule } from '../../core/lifecycle';
import { runIconEngine, scheduleIconEngine } from '../../utils/icons';
import { mountPtvSettingsShell } from './settingsShell';

import './settings.scss';

const SETTINGS_ROOT_SELECTOR = [
    '#myPreferencesMenuPage',
    '#userProfilePage',
    '.userPreferencesPage',
    '.userProfilePage',
    '.settingsPage',
    '.userSettingsPage'
].join(', ');

const SETTINGS_SCOPE_SELECTOR = `:is(${SETTINGS_ROOT_SELECTOR})`;
const SETTINGS_ICON_SELECTOR = [
    `${SETTINGS_SCOPE_SELECTOR} span.material-icons`,
    `${SETTINGS_SCOPE_SELECTOR} span.material-icons-round`,
    `${SETTINGS_SCOPE_SELECTOR} span.material-icons-outlined`
].join(', ');

let settingsHydrationPending = false;

function isSettingsRoute() {
    return /userprofile|preferences|mypreferences|settings|quickconnect|display|playback|subtitles|controls/i.test(window.location.hash);
}

function scheduleSettingsHydration() {
    if (settingsHydrationPending) return;

    settingsHydrationPending = true;

    window.requestAnimationFrame(() => {
        settingsHydrationPending = false;
        enhanceSettingsIcons();
        scheduleIconEngine(document);
    });
}

function runDocumentHydrationPass() {
    enhanceSettingsIcons();
    runIconEngine(document);
}

function runDelayedHydrationPasses(scope) {
    scheduleSettingsHydration();

    [50, 250, 750].forEach(delay => {
        if (scope) {
            scope.timeout(runDocumentHydrationPass, delay);
            return;
        }

        window.setTimeout(runDocumentHydrationPass, delay);
    });
}

function enhanceSettingsIcons() {
    const roots = document.querySelectorAll(SETTINGS_ROOT_SELECTOR);

    roots.forEach((root) => {
        root.classList.add('ptv-settings-page');
    });

    const rows = document.querySelectorAll(`${SETTINGS_ROOT_SELECTOR} a, ${SETTINGS_ROOT_SELECTOR} button`);

    rows.forEach((row) => {
        const target = row.querySelector('.listItem') || row;

        row.classList.add('ptv-settings-row');
        target.classList.add('ptv-settings-list-item');
    });

    roots.forEach(root => {
        runIconEngine(root);
    });

    document.querySelectorAll(SETTINGS_ICON_SELECTOR).forEach(icon => {
        runIconEngine(icon);
    });
}

function init({ scope }) {
    document.documentElement.classList.add('ptv-route-settings-page');
    scope.add(mountPtvSettingsShell());
    const runScopedHydrationPasses = () => runDelayedHydrationPasses(scope);
    scope.mutationObserver((mutations) => {
        if (!isSettingsRoute()) return;

        const shouldHydrate = mutations.some(({ addedNodes, target }) => {
            if (!(target instanceof Element)) return false;

            if (
                target.matches(SETTINGS_SCOPE_SELECTOR)
                || target.closest(SETTINGS_SCOPE_SELECTOR)
                || target.matches('span.material-icons, span.material-icons-round, span.material-icons-outlined')
            ) {
                return true;
            }

            return Array.from(addedNodes).some(node => (
                node instanceof Element
                && (
                    node.matches(SETTINGS_SCOPE_SELECTOR)
                    || node.closest(SETTINGS_SCOPE_SELECTOR)
                    || node.matches('span.material-icons, span.material-icons-round, span.material-icons-outlined')
                    || Boolean(node.querySelector('span.material-icons, span.material-icons-round, span.material-icons-outlined'))
                )
            ));
        });

        if (shouldHydrate) scheduleSettingsHydration();
    }, document.body, {
        childList: true,
        subtree: true
    });

    scope.watchDom(enhanceSettingsIcons);
    scope.watchElement(SETTINGS_ROOT_SELECTOR, enhanceSettingsIcons);
    scope.add(on('routechange', runScopedHydrationPasses));
    scope.listen(window, 'hashchange', runScopedHydrationPasses);
    scope.listen(window, 'popstate', runScopedHydrationPasses);
    runDocumentHydrationPass();
}

function refresh({ scope }) {
    runDelayedHydrationPasses(scope);
}

function destroy() {
    document.documentElement.classList.remove('ptv-route-settings-page');
}

registerModule({
    density: 'dense',
    features: ['settings', 'preferences'],
    layout: 'settings',
    name: 'settings',
    permissions: ['authenticated'],
    route: {
        density: 'dense',
        id: 'settings',
        layout: 'settings',
        navigationItemId: 'settings',
        pageType: 'settings',
        pattern: ({ full }) => /(?:settings|mypreferences|preferences|userprofile|quickconnect|display|subtitles|controls)/i.test(full),
        surface: 1
    },
    surface: 1,
    widgets: [
        {
            density: 'dense',
            id: 'settings-list',
            surface: 2,
            type: 'settings-list'
        }
    ],
    destroy,
    init,
    refresh
});
