import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const musicPageSource = readFileSync(
    resolve(process.cwd(), 'src/ptv/modules/music/musicPage.tsx'),
    'utf8'
);

describe('generated music playlist presentation', () => {
    it('renders the complete generated playlist and keeps row playback on the complete queue', () => {
        expect(musicPageSource).toContain('{generated.items.map((item, index) => (');
        expect(musicPageSource).toContain('contextItems={generated.items}');
        expect(musicPageSource).not.toContain('generated.items.slice(0, 9)');
    });
});
