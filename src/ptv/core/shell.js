import { on, ready } from './events';
import { getRoute } from './router';
import { getPtvDensityClass, getPtvElevationClass } from '../primitives/PtvPrimitiveContract';
import { getPtvRouteClassNames } from '../shell/routes';

const SHELL_ROUTE_CLASSES = getPtvRouteClassNames()
    .map(className => className.replace('ptv-route-', 'ptv-shell-'));
const SHELL_OWNERSHIP_CLASSES = [
    ...SHELL_ROUTE_CLASSES,
    'ptv-shell-density-compact',
    'ptv-shell-density-dense',
    'ptv-shell-density-comfortable',
    'ptv-shell-density-expanded',
    'ptv-shell-density-spacious',
    'ptv-shell-elevation-0',
    'ptv-shell-elevation-1',
    'ptv-shell-elevation-2',
    'ptv-shell-elevation-3',
    'ptv-shell-elevation-4',
    'ptv-shell-elevation-5'
];

function getBody() {
    return document.body;
}

function applyShellBase() {
    document.documentElement.classList.add('ptv-shell-root');
    getBody()?.classList.add('ptv-app-shell');
}

function applyShellRoute(route = {}) {
    const root = document.documentElement;
    const body = getBody();

    root.classList.remove(...SHELL_OWNERSHIP_CLASSES);
    root.classList.add(route.className?.replace('ptv-route-', 'ptv-shell-') || 'ptv-shell-generic');
    root.classList.add(`ptv-shell-density-${route.density || 'comfortable'}`);
    root.classList.add(`ptv-shell-elevation-${route.elevation ?? 1}`);

    if (body) {
        body.classList.remove(
            'ptv-density-compact',
            'ptv-density-dense',
            'ptv-density-comfortable',
            'ptv-density-expanded',
            'ptv-density-spacious',
            'ptv-elevation-0',
            'ptv-elevation-1',
            'ptv-elevation-2',
            'ptv-elevation-3',
            'ptv-elevation-4',
            'ptv-elevation-5'
        );
        body.classList.add(getPtvDensityClass(route.density || 'comfortable'));
        body.classList.add(getPtvElevationClass(route.elevation ?? 1));
    }

    root.style.setProperty('--ptv-shell-route-surface', `var(--ptv-elevation-${route.elevation ?? 1}-surface)`);
    root.style.setProperty('--ptv-shell-route-density', route.density || 'comfortable');
}

export function setDebugLayout(enabled = true) {
    document.documentElement.classList.toggle('ptv-debug-layout', Boolean(enabled));
}

function installShellApi() {
    const ptv = window.PTV || (window.PTV = {});

    ptv.shell = {
        ...ptv.shell,
        apply: applyShellBase,
        route: () => ({
            density: document.documentElement.dataset.ptvRouteDensity,
            elevation: document.documentElement.dataset.ptvRouteElevation,
            layout: document.documentElement.dataset.ptvRouteLayout,
            navigationItem: document.documentElement.dataset.ptvNavItem,
            navigationSection: document.documentElement.dataset.ptvNavSection,
            owner: document.documentElement.dataset.ptvRouteOwner,
            pageType: document.documentElement.dataset.ptvRoutePageType
        }),
        setDebugLayout
    };

    ptv.debugLayout = setDebugLayout;
}

ready(() => {
    applyShellBase();
    applyShellRoute(getRoute());
    installShellApi();
});

on('routechange', ({ detail }) => {
    applyShellBase();
    applyShellRoute(detail);
});
