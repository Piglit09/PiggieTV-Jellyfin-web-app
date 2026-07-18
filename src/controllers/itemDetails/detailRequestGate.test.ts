import { describe, expect, it } from 'vitest';

import { DetailRequestGate } from './detailRequestGate';

describe('DetailRequestGate', () => {
    it('retires an older response when navigation starts for another item', () => {
        const gate = new DetailRequestGate();
        const series = gate.begin('series');
        const episode = gate.begin('episode');

        expect(gate.isCurrent(series)).toBe(false);
        expect(gate.isCurrent(episode)).toBe(true);
    });

    it('retires active work when a detail view is hidden', () => {
        const gate = new DetailRequestGate();
        const request = gate.begin('movie');

        gate.retire();

        expect(gate.isCurrent(request)).toBe(false);
    });
});

