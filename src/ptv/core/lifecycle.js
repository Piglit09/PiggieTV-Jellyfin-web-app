import { on, emit } from './events';
import { createRuntimeScope, disposeRuntimeScope, getRuntimeDiagnostics, getRuntimeScopeNames } from './scope';

const modules = new Map();
let activeRoute = null;

function asArray(value) {
    if (value == null) return [];

    return Array.isArray(value) ? value : [value];
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function getRouteNames(routeDescriptors) {
    const routeNames = [];

    routeDescriptors.forEach(route => {
        routeNames.push(route.id, route.pageType, route.owner, ...(route.features || []));
    });

    return routeNames;
}

function getModuleRouteDescriptors() {
    const routeDescriptors = [];

    modules.forEach(module => {
        routeDescriptors.push(...(module.routeDescriptors || []));
    });

    return routeDescriptors;
}

function getModuleWidgets() {
    const widgets = [];

    modules.forEach(module => {
        (module.widgets || []).forEach(widget => {
            widgets.push({
                module: module.name,
                ...widget
            });
        });
    });

    return widgets;
}

function toKebab(value) {
    let normalized = String(value || '')
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .toLowerCase();

    while (normalized.startsWith('-')) {
        normalized = normalized.slice(1);
    }

    while (normalized.endsWith('-')) {
        normalized = normalized.slice(0, -1);
    }

    return normalized;
}

function compileRoutePattern(pattern) {
    if (typeof pattern === 'function') {
        return pattern;
    }

    if (pattern instanceof RegExp) {
        return context => pattern.test(`${context.path} ${context.hash} ${context.full}`);
    }

    if (typeof pattern === 'string' && pattern) {
        return context => context.full.includes(pattern) || context.hash.includes(pattern) || context.path.includes(pattern);
    }

    return null;
}

function normalizeRouteDescriptor(moduleName, descriptor, module) {
    if (typeof descriptor === 'string') {
        return {
            id: descriptor,
            legacy: true,
            name: descriptor
        };
    }

    if (!descriptor || typeof descriptor !== 'object') return null;

    const id = toKebab(descriptor.id || descriptor.pageType || moduleName);
    const pageType = toKebab(descriptor.pageType || id);
    const owner = toKebab(descriptor.owner || moduleName);
    const pattern = compileRoutePattern(descriptor.pattern || descriptor.match || descriptor.href);
    const elevation = descriptor.elevation ?? descriptor.surface ?? module.elevation ?? module.surface ?? 1;
    const density = descriptor.density || module.density || 'comfortable';
    const navigationItemId = descriptor.navigationItemId || descriptor.nav?.id || module.nav?.id || '';
    const features = unique([
        owner,
        pageType,
        id,
        ...asArray(module.features),
        ...asArray(descriptor.features)
    ]);

    return {
        className: descriptor.className || `ptv-route-${pageType}`,
        density,
        elevation,
        features,
        id,
        layout: descriptor.layout || module.layout || 'standard',
        navigationItemId,
        owner,
        pageType,
        pattern,
        permissions: descriptor.permissions || module.permissions || [],
        widgets: descriptor.widgets || module.widgets || []
    };
}

function normalizeNavigationItem(moduleName, nav) {
    if (!nav || typeof nav !== 'object') return null;

    const item = nav.item || nav;
    const id = toKebab(item.id || moduleName);

    if (!item.href || !item.label || !item.icon) return null;

    return {
        item: {
            href: item.href,
            icon: item.icon,
            id,
            isExternal: Boolean(item.isExternal),
            label: item.label,
            permission: item.permission
        },
        section: {
            id: toKebab(nav.sectionId || nav.section || 'modules'),
            title: nav.sectionTitle || nav.title || 'Modules'
        }
    };
}

function normalizeModule(module) {
    const name = toKebab(module.name || module.id);
    const routeDescriptors = [
        ...asArray(module.route),
        ...asArray(module.routes)
    ]
        .map(descriptor => normalizeRouteDescriptor(name, descriptor, module))
        .filter(Boolean);
    const routeNames = unique([
        ...asArray(module.routes).filter(route => typeof route === 'string'),
        ...getRouteNames(routeDescriptors)
    ]);
    const navItems = asArray(module.nav)
        .map(nav => normalizeNavigationItem(name, nav))
        .filter(Boolean);

    return {
        ...module,
        active: false,
        density: module.density || 'comfortable',
        elevation: module.elevation ?? module.surface ?? 1,
        features: unique([name, ...asArray(module.features)]),
        layout: module.layout,
        name,
        navItems,
        permissions: asArray(module.permissions),
        routeDescriptors,
        routes: routeNames,
        surface: module.surface,
        widgets: asArray(module.widgets),
        scope: null
    };
}

function snapshotModule(module) {
    return {
        active: Boolean(module.active),
        contract: {
            hasDestroy: typeof module.destroy === 'function',
            hasMount: typeof module.mount === 'function',
            hasRefresh: typeof module.refresh === 'function',
            usesLegacyInit: !module.mount && typeof module.init === 'function'
        },
        density: module.density,
        elevation: module.elevation,
        features: module.features,
        layout: module.layout,
        name: module.name,
        navItems: module.navItems,
        permissions: module.permissions,
        routes: module.routes,
        surface: module.surface,
        widgets: module.widgets
    };
}

function isDebugEnabled() {
    return window['PTV_DEBUG'] === true;
}

function warnDebug(message, detail) {
    if (!isDebugEnabled()) return;

    console.warn(`[PiggieTV Lifecycle] ${message}`, detail);
}

export function registerModule(module) {
    if (!module?.name && !module?.id) {
        console.warn('[PiggieTV] Module missing name:', module);
        return null;
    }

    const normalizedModule = normalizeModule(module);

    if (modules.has(normalizedModule.name)) {
        console.warn(`[PiggieTV] Module already registered: ${normalizedModule.name}`);
        return modules.get(normalizedModule.name);
    }

    if (!normalizedModule.mount && !normalizedModule.init) {
        warnDebug(`module "${normalizedModule.name}" registered without a mount/init hook`, snapshotModule(normalizedModule));
    }

    modules.set(normalizedModule.name, normalizedModule);
    emit('moduleregistered', {
        module: snapshotModule(normalizedModule),
        registry: getFeatureRegistry()
    });

    return normalizedModule;
}

function routeMatches(module, route) {
    if (!module.routes?.length) return true;

    return module.routes.some((name) => {
        if (route.features?.includes(name)) return true;
        if (route.owner === name) return true;
        if (route.pageType === name) return true;

        if (name === 'home') return route.isHome;
        if (name === 'login') return route.isLogin;
        if (name === 'dashboard') return route.isDashboard;
        if (name === 'settings') return route.isSettings;
        if (name === 'details') return route.isDetails;
        if (name === 'playback') return route.isPlayback;

        return false;
    });
}

export function refreshModules(reason = 'manual') {
    for (const module of modules.values()) {
        if (!module.active || typeof module.refresh !== 'function') continue;

        try {
            module.refresh({ reason, route: activeRoute, scope: module.scope });
        } catch (err) {
            console.error(`[PiggieTV] Module refresh failed: ${module.name}`, err);
        }
    }
}

function activateModule(module, route) {
    if (module.active || module.scope) {
        warnDebug(`duplicate mount attempt for module "${module.name}"`, snapshotModule(module));
    }

    module.scope = module.scope || createRuntimeScope(module.name);
    module.active = true;

    try {
        if (typeof module.mount === 'function') {
            module.mount(module.scope, { route });
        } else {
            module.init?.({ route, scope: module.scope });
        }
    } catch (err) {
        console.error(`[PiggieTV] Module init failed: ${module.name}`, err);
    }
}

function refreshModule(module, route) {
    try {
        module.refresh?.({ reason: 'routechange', route, scope: module.scope });
    } catch (err) {
        console.error(`[PiggieTV] Module refresh failed: ${module.name}`, err);
    }
}

function deactivateModule(module, route) {
    try {
        module.destroy?.({ route, scope: module.scope });
    } catch (err) {
        console.error(`[PiggieTV] Module destroy failed: ${module.name}`, err);
    }

    module.scope?.dispose();
    module.scope = null;
    disposeRuntimeScope(module.name);
    module.active = false;
}

export function getModuleDiagnostics() {
    const runtimeDiagnostics = getRuntimeDiagnostics();
    const scopeMap = new Map(runtimeDiagnostics.scopes.map(scope => [scope.name, scope]));
    const moduleSnapshots = Array.from(modules.values()).map(module => {
        const scope = scopeMap.get(module.name);

        return {
            ...snapshotModule(module),
            hasScope: Boolean(module.scope),
            resourceTotals: scope?.totals || null
        };
    });

    return {
        modules: moduleSnapshots,
        staleModules: moduleSnapshots.filter(module => (
            (module.active && !module.hasScope)
            || (!module.active && module.hasScope)
        ))
    };
}

export function getRegisteredModules() {
    return Array.from(modules.values()).map(snapshotModule);
}

export function getRegisteredRouteEntries() {
    return getModuleRouteDescriptors()
        .filter(route => typeof route.pattern === 'function');
}

export function getRegisteredNavigationSections() {
    const sectionMap = new Map();

    for (const module of modules.values()) {
        for (const nav of module.navItems || []) {
            if (!sectionMap.has(nav.section.id)) {
                sectionMap.set(nav.section.id, {
                    id: nav.section.id,
                    items: [],
                    title: nav.section.title
                });
            }

            sectionMap.get(nav.section.id).items.push(nav.item);
        }
    }

    return Array.from(sectionMap.values());
}

export function getRegisteredWidgets() {
    return getModuleWidgets();
}

export function getFeatureRegistry() {
    return {
        modules: getRegisteredModules(),
        navigation: getRegisteredNavigationSections(),
        routes: getRegisteredRouteEntries().map(route => ({
            className: route.className,
            density: route.density,
            elevation: route.elevation,
            features: route.features,
            id: route.id,
            layout: route.layout,
            navigationItemId: route.navigationItemId,
            owner: route.owner,
            pageType: route.pageType
        })),
        widgets: getRegisteredWidgets()
    };
}

function installFeatureRegistrationApi() {
    const ptv = window.PTV || (window.PTV = {});

    ptv.registerModule = registerModule;
    ptv.modules = {
        ...ptv.modules,
        get: getRegisteredModules,
        diagnostics: getModuleDiagnostics,
        refresh: refreshModules,
        registry: getFeatureRegistry,
        register: registerModule,
        scopes: getRuntimeScopeNames,
        widgets: getRegisteredWidgets
    };
}

export function applyRoute(route) {
    activeRoute = route;

    for (const module of modules.values()) {
        const shouldRun = routeMatches(module, route);

        if (shouldRun && !module.active) {
            activateModule(module, route);
            continue;
        }

        if (!shouldRun && module.active) {
            deactivateModule(module, route);
        }

        if (shouldRun && module.active) {
            refreshModule(module, route);
        }
    }

    emit('modulesupdated', { route });
}

on('routechange', ({ detail }) => {
    applyRoute(detail);
});

installFeatureRegistrationApi();
