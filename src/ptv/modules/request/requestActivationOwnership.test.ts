import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const activationSources = [
    'src/controllers/home.js',
    'src/ptv/modules/sidebar/SidebarItem.tsx',
    'src/ptv/modules/sidebar/Sidebar.tsx',
    'src/ptv/modules/header/AppHeader.tsx',
    'src/ptv/modules/header/index.js',
    'src/ptv/modules/integrations/arrActions.js'
].map(file => readFileSync(resolve(process.cwd(), file), 'utf8'));

describe('Request lazy activation ownership', () => {
    it('routes every Request action through the shared activation boundary', () => {
        activationSources.forEach(source => {
            expect(source).not.toContain("import('../request')");
            expect(source).toContain('request/requestLoader');
        });
    });

    it('keeps the Request implementation out of static action imports', () => {
        const loaderSource = readFileSync(
            resolve(process.cwd(), 'src/ptv/modules/request/requestLoader.ts'),
            'utf8'
        );

        expect(loaderSource).toContain("import(\n        /* webpackChunkName: \"ptv-request\" */ './index'");
    });
});
