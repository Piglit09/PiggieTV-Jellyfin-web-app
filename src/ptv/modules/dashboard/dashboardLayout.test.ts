import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboardRuntimeSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/dashboard/index.js'), 'utf8');
const dashboardStylesSource = readFileSync(resolve(process.cwd(), 'src/ptv/styles/dashboard.scss'), 'utf8');
const adminSystemStylesSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/dashboard/admin-system.scss'), 'utf8');
const dashboardPageSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/dashboard/PiggieTvDashboardPage.tsx'), 'utf8');
const diagnosticsPageSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/dashboard/PtvDiagnosticsDashboardPage.tsx'), 'utf8');
const rowBuilderPageSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/dashboard/PiggieTvRowsPage.tsx'), 'utf8');

describe('PiggieTV dashboard layout ownership', () => {
    it('reserves the shared header space for Jellyfin admin content', () => {
        expect(dashboardRuntimeSource).toContain("element.classList.add('ptv-admin-content');");
        expect(dashboardRuntimeSource).toContain("element.classList.remove('ptv-admin-shell-spaced');");
        expect(dashboardRuntimeSource).not.toContain("element.classList.add('ptv-admin-content', 'ptv-admin-shell-spaced');");
        expect(dashboardStylesSource).toContain('.dashboardDocument .content-primary.ptv-admin-shell-spaced');
        expect(dashboardStylesSource).toContain('padding-top: var(--ptv-dashboard-shell-top-offset) !important;');
        expect(adminSystemStylesSource).toContain('.ptv-admin-document .ptv-admin-content.ptv-admin-shell-spaced');
        expect(adminSystemStylesSource).toContain('scroll-margin-top: 0;');
    });

    it('keeps diagnostics and debug controls on the dedicated diagnostics route', () => {
        expect(diagnosticsPageSource).toContain("'Performance'");
        expect(diagnosticsPageSource).toContain("'Requests'");
        expect(diagnosticsPageSource).toContain("'Export'");
        expect(diagnosticsPageSource).toContain('<RemoteDiagnosticsPanel />');
        expect(dashboardPageSource).not.toContain('<RemoteDiagnosticsPanel />');
        expect(dashboardPageSource).not.toContain('Run Debug Report');
        expect(dashboardPageSource).not.toContain('Copy Debug Report');
        expect(dashboardPageSource).not.toContain('Enable performance overlay');
        expect(rowBuilderPageSource).not.toContain('Real World Monitor');
        expect(rowBuilderPageSource).not.toContain('Diagnostics / Integrations');
        expect(rowBuilderPageSource).not.toContain('Export Debug JSON');
    });
});
