import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ASYNC_USER_ROUTES as STABLE_USER_ROUTES } from '../../apps/stable/routes/asyncRoutes/user';

describe('PTV reading async routes', () => {
    it('registers the canonical reading page in stable routes', () => {
        expect(STABLE_USER_ROUTES).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: 'reading', page: 'reading' }),
            expect.objectContaining({ path: 'reading/*', page: 'reading' })
        ]));
    });

    it('registers the canonical reading page in experimental routes', () => {
        const experimentalRoutes = readFileSync(
            resolve(process.cwd(), 'src/apps/experimental/routes/asyncRoutes/user.ts'),
            'utf8'
        );

        expect(experimentalRoutes).toContain("{ path: 'reading', page: 'reading' }");
        expect(experimentalRoutes).toContain("{ path: 'reading/*', page: 'reading' }");
    });
});
