/* eslint-disable sonarjs/no-nested-functions -- Deferred promise releases intentionally expose live worker concurrency. */
import { describe, expect, it } from 'vitest';

import {
    getProgressiveHomeRowPlan,
    runBoundedHomeWork
} from './homeWorkPlan';

describe('progressive Home and Movies work planning', () => {
    it('keeps row order while separating route-critical and deferred shelves', () => {
        const rows = [ 'first', 'second', 'third', 'fourth', 'fifth' ];

        expect(getProgressiveHomeRowPlan(rows, 2)).toEqual({
            criticalRows: [ 'first', 'second' ],
            deferredRows: [ 'third', 'fourth', 'fifth' ]
        });
    });

    it('bounds concurrent shelf work and stops launching work after retirement', async () => {
        const releases: Array<() => void> = [];
        let active = 0;
        let peak = 0;
        let current = true;
        const worker = (value: number) => {
            return new Promise<number>(resolve => {
                active += 1;
                peak = Math.max(peak, active);
                releases.push(() => {
                    active -= 1;
                    resolve(value);
                });
            });
        };
        const work = runBoundedHomeWork([ 1, 2, 3, 4 ], 2, worker, () => current);

        await Promise.resolve();
        expect(active).toBe(2);
        releases.shift()?.();
        await Promise.resolve();
        expect(active).toBe(2);
        current = false;
        releases.splice(0).forEach(release => {
            release();
        });

        expect(await work).toEqual([ 1, 2, 3 ]);
        expect(peak).toBe(2);
    });
});

/* eslint-enable sonarjs/no-nested-functions */
