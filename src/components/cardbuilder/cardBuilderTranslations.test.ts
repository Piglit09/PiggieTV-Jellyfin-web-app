import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cardBuilderSource = readFileSync(
    resolve(process.cwd(), 'src/components/cardbuilder/cardBuilder.js'),
    'utf8'
);

describe('card builder translations', () => {
    it('uses the localized resume-button key', () => {
        expect(cardBuilderSource).toContain("globalize.translate('ButtonResume')");
        expect(cardBuilderSource).not.toContain("globalize.translate('Resume')");
    });
});
