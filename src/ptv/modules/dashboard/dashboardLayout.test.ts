import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboardRuntimeSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/dashboard/index.js'), 'utf8');
const dashboardStylesSource = readFileSync(resolve(process.cwd(), 'src/ptv/styles/dashboard.scss'), 'utf8');
const adminSystemStylesSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/dashboard/admin-system.scss'), 'utf8');

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
});
