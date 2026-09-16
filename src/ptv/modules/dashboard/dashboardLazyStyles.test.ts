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
        const appOverrides = readSource('src/apps/dashboard/AppOverrides.scss');

        expect(dashboardRuntime).toContain("import './dashboard.bundle.scss';");
        expect(dashboardBundle).toContain("@use './dashboard';");
        expect(dashboardBundle).toContain("@use '../../styles/dashboard' as theme-dashboard;");
        expect(dashboardBundle).toContain("@use './admin-forms';");
        expect(dashboardBundle).toContain("@use './admin-system';");
        expect(appOverrides).toContain("@use '../../ptv/modules/settings/admin/adminDashboard';");
    });

    it('keeps legacy dashboard infrastructure inside the shared PTV administration shell', () => {
        const appLayout = readSource('src/apps/dashboard/AppLayout.tsx');

        expect(appLayout).toContain("import PtvAdminLayout from 'ptv/modules/settings/admin/PtvAdminLayout';");
        expect(appLayout).toContain("<PtvAdminLayout mode='dashboard'>");
        expect(appLayout).toContain('<AppBody>');
        expect(appLayout).toContain('<Outlet />');
        expect(appLayout).toContain('<ThemeCss dashboard />');
        expect(appLayout).not.toContain('<AppDrawer');
    });

    it('contains the legacy Metadata Manager tree within the shared administration content column', () => {
        const dashboardStyles = readSource('src/apps/dashboard/AppOverrides.scss');

        expect(dashboardStyles).toContain('.ptv-admin-shell-dashboard .metadataEditorPage .editPageSidebar');
        expect(dashboardStyles).toContain('position: absolute;');
        expect(dashboardStyles).toContain('.ptv-admin-shell-dashboard .metadataEditorPage .editPageInnerContent');
    });

    it('loads dashboard features and redirects only the exact dashboard index', () => {
        const moduleOwner = readSource('src/ptv/modules/index.js');
        const routes = readSource('src/apps/dashboard/routes/routes.tsx');
        const dashboardPathOffset = routes.indexOf('path: DASHBOARD_APP_PATHS.Dashboard');
        const dashboardIndexOffset = routes.indexOf('index: true', dashboardPathOffset);
        const dashboardRedirectOffset = routes.indexOf("element: <Navigate replace to='/settings/admin' />", dashboardIndexOffset);
        const nestedRoutesOffset = routes.indexOf('...ASYNC_ADMIN_ROUTES.map(toAsyncPageRoute)', dashboardPathOffset);

        expect(moduleOwner).toContain("on('routechange', loadRouteFeatures);");
        expect(dashboardPathOffset).toBeGreaterThan(-1);
        expect(dashboardIndexOffset).toBeGreaterThan(dashboardPathOffset);
        expect(dashboardRedirectOffset).toBeGreaterThan(dashboardIndexOffset);
        expect(nestedRoutesOffset).toBeGreaterThan(dashboardRedirectOffset);
    });

    it('keeps Signup native styles independent while Calendar retains the dashboard surface', () => {
        expect(readSource('src/ptv/modules/signup/InviteAdminPage.tsx'))
            .not.toContain("import '../dashboard/dashboard.scss';");
        expect(readSource('src/ptv/modules/signup/InviteAdminPage.tsx'))
            .toContain("import './signup.scss';");
        expect(readSource('src/ptv/modules/calendar/PiggieTvCalendarPage.tsx'))
            .toContain("import '../dashboard/dashboard.scss';");
    });
});
