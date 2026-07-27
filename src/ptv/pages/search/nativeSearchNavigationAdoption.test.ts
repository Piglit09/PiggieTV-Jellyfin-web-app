import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const searchPageSource = fs.readFileSync(
    path.join(__dirname, 'NativeSearchPage.tsx'),
    'utf8'
);

describe('native Search navigation adoption wiring', () => {
    it('delegates card activation to the shared Search details boundary', () => {
        expect(searchPageSource).toContain('import { activateNativeSearchCard } from \'./nativeSearchDetailsNavigation\'');
        expect(searchPageSource).toContain('activateNativeSearchCard({');
        expect(searchPageSource).not.toContain('onClick={() => recordPtvItemRouteClick');
    });
});
