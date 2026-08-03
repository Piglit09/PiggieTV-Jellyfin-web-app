import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const menuSources = [
    readFileSync(resolve(process.cwd(), 'src/ptv/shell/PTVShell.tsx'), 'utf8'),
    readFileSync(resolve(process.cwd(), 'src/components/toolbar/AppUserMenu.tsx'), 'utf8')
];

describe('user menu policy', () => {
    it('excludes session switching, server selection, and admin navigation from both user menus', () => {
        menuSources.forEach(source => {
            expect(source).not.toContain('Switch User');
            expect(source).not.toContain('Select Server');
            expect(source).not.toContain('Admin Dashboard');
            expect(source).not.toContain("to='/dashboard'");
        });
    });

    it('retains Profile, Quick Connect, Settings, and Sign Out ownership', () => {
        menuSources.forEach(source => {
            expect(source).toMatch(/Profile/);
            expect(source).toMatch(/QuickConnect|Quick Connect/);
            expect(source).toMatch(/Settings/);
            expect(source).toMatch(/Sign Out|ButtonSignOut/);
        });
    });
});
