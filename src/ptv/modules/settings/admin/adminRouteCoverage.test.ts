import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    PTV_ADMIN_DESTINATIONS,
    PTV_ADMIN_DYNAMIC_ROUTE_PATHS,
    PTV_ADMIN_ROUTE_EXCLUSIONS
} from './adminNavigation';

function registryPath(href: string) {
    return href.replace(/^#\//, '').replace(/^\//, '').split('?')[0];
}

function registeredPathsFromSource(file: string) {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    return Array.from(source.matchAll(/\bpath:\s*'([^']+)'/g), match => `dashboard/${match[1]}`);
}

describe('PTV administration route coverage', () => {
    it('maps or explicitly excludes every registered dashboard administrator route', () => {
        const mappedPaths = new Set(
            PTV_ADMIN_DESTINATIONS.flatMap(destination => [ destination.href, ...(destination.aliases || []) ])
                .map(registryPath)
        );
        const excludedPaths = new Set<string>(PTV_ADMIN_ROUTE_EXCLUSIONS.map(exclusion => exclusion.path));
        const registeredPaths = [
            ...registeredPathsFromSource('src/apps/dashboard/routes/_asyncRoutes.ts'),
            ...registeredPathsFromSource('src/apps/dashboard/routes/_legacyRoutes.ts'),
            'dashboard',
            'metadata',
            'configurationpage'
        ];
        const missing = registeredPaths.filter(path => (
            !mappedPaths.has(path)
            && !excludedPaths.has(path)
            && !PTV_ADMIN_DYNAMIC_ROUTE_PATHS.includes(path as typeof PTV_ADMIN_DYNAMIC_ROUTE_PATHS[number])
        ));

        expect(missing).toEqual([]);
        expect(PTV_ADMIN_ROUTE_EXCLUSIONS.every(exclusion => exclusion.reason.length > 0)).toBe(true);
    });

    it('covers the generic protected plugin configuration route dynamically', () => {
        expect(PTV_ADMIN_DESTINATIONS.some(destination => destination.category === 'plugins')).toBe(true);
        expect(PTV_ADMIN_DYNAMIC_ROUTE_PATHS).toContain('configurationpage');
    });

    it('keeps app-wide Manage Server entry points on the canonical PTV Administration route', () => {
        const appRouter = readFileSync(resolve(process.cwd(), 'src/components/router/appRouter.js'), 'utf8');
        const libraryMenu = readFileSync(resolve(process.cwd(), 'src/scripts/libraryMenu.js'), 'utf8');
        const ptvShell = readFileSync(resolve(process.cwd(), 'src/ptv/shell/PTVShell.tsx'), 'utf8');

        expect(appRouter).toContain("if (item === 'manageserver')");
        expect(appRouter).toContain("return '#/settings/admin';");
        expect(libraryMenu).toContain('lnkManageServer');
        expect(libraryMenu).toContain('href="#/settings/admin"');
        expect(libraryMenu).not.toContain('lnkManageServer" data-itemid="dashboard" href="#/dashboard"');
        expect(ptvShell).not.toContain("id: 'dashboard-recommendations'");
    });
});
