import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dashboard lazy style ownership', () => {
    it('keeps dashboard-only styles out of the eager PTV stylesheet', () => {
        const eagerStyles = readSource('src/ptv/styles/ptv.scss');

        expect(eagerStyles).not.toContain('../modules/dashboard/dashboard');
        expect(eagerStyles).not.toContain('./dashboard\' as theme-dashboard');
        expect(eagerStyles).not.toContain('../modules/dashboard/admin-forms');
        expect(eagerStyles).not.toContain('../modules/dashboard/admin-system');
    });

    it('loads the complete dashboard style surface from the lazy dashboard owner', () => {
        const dashboardRuntime = readSource('src/ptv/modules/dashboard/index.js');
        const dashboardBundle = readSource('src/ptv/modules/dashboard/dashboard.bundle.scss');

        expect(dashboardRuntime).toContain("import './dashboard.bundle.scss';");
        expect(dashboardBundle).toContain("@use './dashboard';");
        expect(dashboardBundle).toContain("@use '../../styles/dashboard' as theme-dashboard;");
        expect(dashboardBundle).toContain("@use './admin-forms';");
        expect(dashboardBundle).toContain("@use './admin-system';");
    });

    it('loads dashboard features for internal history transitions and preserves the exact dashboard index', () => {
        const moduleOwner = readSource('src/ptv/modules/index.js');
        const routes = readSource('src/apps/dashboard/routes/routes.tsx');
        const dashboardPathOffset = routes.indexOf('path: DASHBOARD_APP_PATHS.Dashboard');
        const dashboardIndexOffset = routes.indexOf('index: true', dashboardPathOffset);

        expect(moduleOwner).toContain("on('routechange', loadRouteFeatures);");
        expect(dashboardPathOffset).toBeGreaterThan(-1);
        expect(dashboardIndexOffset).toBeGreaterThan(dashboardPathOffset);
    });

    it('preserves dashboard card styling for independently lazy Signup and Calendar pages', () => {
        expect(readSource('src/ptv/modules/signup/InviteAdminPage.tsx'))
            .toContain("import '../dashboard/dashboard.scss';");
        expect(readSource('src/ptv/modules/calendar/PiggieTvCalendarPage.tsx'))
            .toContain("import '../dashboard/dashboard.scss';");
    });
});
