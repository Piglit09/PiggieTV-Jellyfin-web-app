import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const homeStyles = fs.readFileSync(
    path.resolve(process.cwd(), 'src/ptv/pages/home/nativeHome.scss'),
    'utf8'
);

function ruleFor(selector: string) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`).exec(homeStyles);

    expect(match, `Expected ${selector} rule`).not.toBeNull();

    return match?.[1] || '';
}

describe('native Home renderer performance policy', () => {
    it('keeps repeated card surfaces free of idle backdrop filters', () => {
        expect(ruleFor('.ptv-native-card')).not.toMatch(/backdrop-filter:\s*(?!none)/);
        expect(ruleFor('.ptv-native-card-menu')).not.toMatch(/backdrop-filter:\s*(?!none)/);
        expect(ruleFor('.ptv-native-card-spotlight')).not.toMatch(/backdrop-filter:\s*(?!none)/);
        expect(ruleFor('.ptv-native-card .ptv-card-play-pill')).toContain('backdrop-filter: none');
        expect(ruleFor('.ptv-native-card-image')).toContain('filter: none');
    });

    it('keeps inactive spotlights out of rendering until a card is active', () => {
        expect(ruleFor('.ptv-native-card-spotlight')).toContain('visibility: hidden');
        expect(ruleFor('.ptv-native-card.show-focus .ptv-native-card-spotlight')).toContain('visibility: visible');
        expect(homeStyles).toContain('backdrop-filter: blur(var(--ptv-elevation-2-blur))');
    });
});
